import type { SQLiteDatabase } from 'expo-sqlite';
import { getSyncState, setSyncState, upsertMember } from '../db/repository';
import { SETTING_KEYS } from './settings';
import { supabase } from './supabase';
import {
  canonicalInstant,
  isNewerThan,
  normaliseForPostgres,
  normaliseForSqlite,
} from './syncCodec';

/**
 * Tables synced to Supabase, in dependency order. Parents push before children
 * so a foreign key never points at a row the server has not seen yet.
 */
const SYNCED_TABLES = [
  'trips',
  'trip_members',
  'trip_legs',
  'category_budgets',
  'expenses',
] as const;

type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * Tables whose rows carry an identity beyond the primary key.
 *
 * Anything both devices can create independently ends up here. A membership is
 * one: joining runs `join_trip_with_code`, which mints an id in Postgres, while
 * `ensureSelfMembership` mints a different one on the device. A category budget
 * is the other: saving the trip editor writes a row for every category, so two
 * travellers who each open that screen mint two ids for the same category of
 * the same trip.
 *
 * Either way it is two ids for one row, and `unique (trip_id, ...)` on both
 * stores rejects the second copy — the push fails on the server constraint and
 * the pull fails on the local index, wedging sync in both directions with no
 * way out, because the rejected rows stay dirty and are retried forever.
 *
 * Pushing and pulling on this key instead of `id` lets the two copies collapse
 * into one wherever they meet.
 */
const NATURAL_KEYS: Partial<Record<SyncedTable, readonly string[]>> = {
  trip_members: ['trip_id', 'user_id'],
  category_budgets: ['trip_id', 'category'],
};

const LAST_PULLED_KEY = 'last_pulled_at';
const FULL_PULL_KEY = 'full_pull_pending';
const LAST_USER_KEY = 'last_user_id';

/**
 * Rows per request when pulling.
 *
 * PostgREST caps every response at the project's `max-rows` setting (1000 by
 * default), and it does so silently — a truncated page looks exactly like a
 * complete one. Paging until a request comes back empty is what makes a trip
 * with more expenses than the cap arrive in full instead of stopping at an
 * arbitrary row and never being fetched again.
 */
const PULL_PAGE_SIZE = 500;

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

async function columnsOf(db: SQLiteDatabase, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

/**
 * Identity of a row for matching a pushed copy against what the server
 * returned. JSON rather than a joined string so no separator can appear inside
 * a value and make two different keys collide.
 */
function matchKey(row: Record<string, unknown>, naturalKey?: readonly string[]): string {
  return JSON.stringify((naturalKey ?? ['id']).map((c) => String(row[c] ?? '')));
}

/**
 * Marks a pushed row as clean and adopts whatever the server decided about it.
 *
 * `updated_at` is stamped by a database trigger rather than taken from the
 * phone, so the value that actually landed comes back in the response and is
 * written here. Without that, local and remote hold different timestamps for
 * the same write and the next pull compares them as a conflict.
 *
 * The `WHERE` clause is what keeps an edit made during the network round trip:
 * it bumped `updated_at`, so this no longer matches, the row stays dirty, and
 * the next pass sends it.
 */
async function stampPushedRow(
  db: SQLiteDatabase,
  table: SyncedTable,
  row: Record<string, unknown>,
  serverUpdatedAt: string | null,
  extraColumns: Record<string, string> = {}
): Promise<void> {
  const sets = ['dirty = 0'];
  const params: (string | number)[] = [];

  if (serverUpdatedAt) {
    sets.push('updated_at = ?');
    params.push(canonicalInstant(serverUpdatedAt));
  }
  for (const [column, value] of Object.entries(extraColumns)) {
    sets.push(`${column} = ?`);
    params.push(value);
  }

  await db.runAsync(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND updated_at = ?`,
    ...params,
    row.id as string,
    row.updated_at as string
  );
}

/**
 * Sends a batch, and falls back to one request per row when the batch was
 * rejected for something a single row did.
 *
 * PostgREST applies a batch as one statement, so one row Postgres will not take
 * fails every other row in the request alongside it. All of them keep their
 * dirty flag, the next pass assembles the same doomed batch, and that table
 * stops moving for good — which is how one category budget holding a
 * `(trip_id, category)` the server already had under another id stopped a
 * trip's expenses syncing too.
 *
 * `23xxx` is Postgres' integrity-violation class: unique, foreign key, not
 * null, check. Each is a property of one row, so resending individually isolates
 * the offender and lets everything else land. Anything else — an expired token,
 * RLS, a dropped connection — would fail identically row by row, so it is
 * reported as it stands instead of being turned into one request per row.
 */
async function upsertRows(
  table: SyncedTable,
  payload: Record<string, unknown>[],
  onConflict: string
): Promise<{ landed: Record<string, unknown>[]; problem?: string }> {
  if (!supabase) return { landed: [] };
  const client = supabase;
  const send = (rows: Record<string, unknown>[]) =>
    client.from(table).upsert(rows, { onConflict }).select();

  const { data, error } = await send(payload);
  if (!error) return { landed: (data ?? []) as Record<string, unknown>[] };
  if (payload.length === 1 || !error.code?.startsWith('23')) {
    throw new Error(`push ${table}: ${error.message}`);
  }

  const landed: Record<string, unknown>[] = [];
  let problem: string | undefined;
  for (const row of payload) {
    const single = await send([row]);
    if (single.error) problem ??= `push ${table}: ${single.error.message}`;
    else landed.push(...((single.data ?? []) as Record<string, unknown>[]));
  }
  return { landed, problem };
}

/** Pushes every locally-changed row, then clears the dirty flag on success. */
async function pushTable(
  db: SQLiteDatabase,
  table: SyncedTable,
  displayName = ''
): Promise<number> {
  if (!supabase) return 0;

  const dirtyRows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE dirty = 1`
  );
  if (dirtyRows.length === 0) return 0;

  if (table === 'trips') {
    // Plain upsert needs INSERT+UPDATE RLS. A new trip fails the UPDATE check
    // before membership exists, so trips go through a security-definer RPC.
    //
    // One trip per request already, so a rejected one is recorded and the rest
    // are still attempted. Throwing here instead would let a single trip the
    // server will not take stop every other trip on the phone from syncing.
    let pushedTrips = 0;
    let tripProblem: string | undefined;
    for (const row of dirtyRows) {
      const payload = normaliseForPostgres(row);
      const { data, error } = await supabase.rpc('upsert_own_trip', {
        p_trip: payload,
        p_display_name: displayName,
      });
      if (error) {
        tripProblem ??= `push trips: ${error.message}`;
        continue;
      }

      // Both of these belong to the server. `join_code` comes back rewritten in
      // the one case this device cannot detect on its own: the code it generated
      // was already taken by somebody else's trip.
      const stamped = (data ?? {}) as { updated_at?: string; join_code?: string };
      const extra: Record<string, string> = {};
      if (stamped.join_code && stamped.join_code !== row.join_code) {
        extra.join_code = stamped.join_code;
      }
      await stampPushedRow(db, table, row, stamped.updated_at ?? null, extra);
      pushedTrips += 1;
    }
    if (tripProblem) throw new Error(tripProblem);
    return pushedTrips;
  }

  const payload = dirtyRows.map(normaliseForPostgres);
  const naturalKey = NATURAL_KEYS[table];
  const onConflict = (naturalKey ?? ['id']).join(',');
  const { landed, problem } = await upsertRows(table, payload, onConflict);

  // Matched on the natural key where there is one: the server may have resolved
  // the upsert onto a row it minted under a different id.
  const serverRows = new Map<string, Record<string, unknown>>();
  for (const remote of landed) {
    serverRows.set(matchKey(remote, naturalKey), remote);
  }

  // Only rows the server actually confirmed lose their dirty flag. Clearing it
  // on a row that was rejected would mark it clean while the server has never
  // seen it, and nothing would ever send it again.
  let pushed = 0;
  for (const row of dirtyRows) {
    const remote = serverRows.get(matchKey(row, naturalKey));
    if (!remote) continue;
    const serverUpdatedAt = typeof remote.updated_at === 'string' ? remote.updated_at : null;
    await stampPushedRow(db, table, row, serverUpdatedAt);
    pushed += 1;
  }

  if (problem) throw new Error(problem);
  return pushed;
}

/**
 * Writes one page of remote rows into SQLite.
 *
 * Conflicts resolve last-write-wins on `updated_at`, with one exception the
 * WHERE clause spells out: a row still marked dirty holds an edit the server
 * has not seen, so it is never overwritten. It wins until the next push carries
 * it up, which is the whole promise of an offline-first store.
 */
async function applyRemoteRows(
  db: SQLiteDatabase,
  table: SyncedTable,
  rows: Record<string, unknown>[]
): Promise<void> {
  const localColumns = await columnsOf(db, table);
  const naturalKey = NATURAL_KEYS[table];

  await db.withTransactionAsync(async () => {
    for (const remote of rows) {
      const row = normaliseForSqlite(remote);

      if (naturalKey) {
        // The same row under a different id. `ON CONFLICT(id)` cannot see that
        // collision, so the unique index would abort the entire pull. Settle it
        // the way every other conflict here is settled — newest write wins,
        // except that a dirty duplicate holds an edit the server has not seen
        // and is never deleted, exactly as the WHERE clause below never
        // overwrites one. Skipped instead: the next push carries the local row
        // up on this same key, and the two stores converge on it then.
        const dup = await db.getFirstAsync<{ id: string; updated_at: string; dirty: number }>(
          `SELECT id, updated_at, dirty FROM ${table}
           WHERE ${naturalKey.map((c) => `${c} = ?`).join(' AND ')} AND id <> ?`,
          ...naturalKey.map((c) => row[c] as string),
          row.id as string
        );
        if (dup) {
          if (dup.dirty === 1 || !isNewerThan(row.updated_at as string, dup.updated_at)) {
            continue;
          }
          await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, dup.id);
        }
      }

      const cols = localColumns.filter((c) => c !== 'dirty' && c in row);
      const values = cols.map((c) => row[c] as string | number | null);

      const updates = cols
        .filter((c) => c !== 'id')
        .map((c) => `${c} = excluded.${c}`)
        .concat('dirty = 0')
        .join(', ');

      await db.runAsync(
        `INSERT INTO ${table} (${cols.join(', ')}, dirty) VALUES (${cols
          .map(() => '?')
          .join(', ')}, 0)
         ON CONFLICT(id) DO UPDATE SET ${updates}
         WHERE excluded.updated_at > ${table}.updated_at AND ${table}.dirty = 0`,
        values
      );
    }
  });
}

/** Whoever is signed in right now, read from the local session store. */
async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Pulls rows changed since the last successful sync, a page at a time. */
async function pullTable(
  db: SQLiteDatabase,
  table: SyncedTable,
  since: string | null,
  userId: string
): Promise<number> {
  if (!supabase) return 0;

  let pulled = 0;
  let from = 0;

  for (;;) {
    let query = supabase
      .from(table)
      .select('*')
      // A total order is what makes paging safe. Ordering on `updated_at` alone
      // leaves rows sharing a timestamp free to swap places between requests,
      // which drops some and repeats others; `id` breaks every remaining tie.
      .order('updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PULL_PAGE_SIZE - 1);
    if (since) query = query.gt('updated_at', since);

    const { data, error } = await query;
    if (error) throw new Error(`pull ${table}: ${error.message}`);
    if (!data || data.length === 0) break;

    // The session can end while a pass is in flight. Signing out erases this
    // device, and a page that was already on the wire would otherwise put the
    // rows straight back — quietly undoing the one thing the confirmation
    // dialog promised. Checked before the write, not before the request, so it
    // catches a response that outlived the account it was fetched for.
    if ((await currentUserId()) !== userId) break;

    await applyRemoteRows(db, table, data as Record<string, unknown>[]);
    pulled += data.length;
    // Advanced by what actually arrived rather than by the page size, so a
    // project configured with a lower `max-rows` than we ask for still walks
    // the whole table instead of stopping after the first short page.
    from += data.length;
  }

  return pulled;
}

export type SyncTrigger = 'manual' | 'reconnect' | 'foreground' | 'startup';

/**
 * Guarantees the signed-in user is a member of every *unclaimed* trip on this
 * device.
 *
 * Trips can be created offline, before any account exists, so membership cannot
 * be written at creation time. Without this backfill the creator would push a
 * trip and then be locked out of it by their own RLS policy, which scopes
 * access through trip_members.
 *
 * "Unclaimed" is doing real work in that sentence. A trip that already has a
 * member belongs to whoever that is, and the local database outlives a sign-out
 * — so enrolling into every local trip meant the next account signed in on a
 * borrowed phone was quietly granted permanent server-side access to the
 * previous traveller's trips and expenses.
 */
async function ensureSelfMembership(
  db: SQLiteDatabase,
  userId: string,
  displayName: string
): Promise<void> {
  const unclaimed = await db.getAllAsync<{ id: string }>(
    `SELECT t.id FROM trips t
     WHERE t.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM trip_members m
         WHERE m.trip_id = t.id AND m.deleted_at IS NULL
       )`
  );

  for (const { id } of unclaimed) {
    await upsertMember(db, { trip_id: id, user_id: userId, display_name: displayName });
  }
}

/**
 * Resets the watermark when a different account signs in on this device.
 *
 * The watermark means "this device already holds everything written before
 * now", which is only ever true of one account's view of the server. Carrying
 * it across a switch makes the new account's first pull skip every row written
 * before it signed in — the same empty-budget failure `requestFullPull` exists
 * to prevent, arrived at from the other direction.
 */
async function resetWatermarkOnAccountChange(
  db: SQLiteDatabase,
  userId: string
): Promise<void> {
  const previous = await getSyncState(db, LAST_USER_KEY);
  if (previous === userId) return;

  await setSyncState(db, LAST_PULLED_KEY, '');
  await setSyncState(db, FULL_PULL_KEY, '1');
  await setSyncState(db, LAST_USER_KEY, userId);
}

/** The database's own clock, or null when the RPC cannot be reached. */
async function serverNow(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('server_now');
  if (!error && typeof data === 'string') return canonicalInstant(data);
  return null;
}

/**
 * One full sync pass. Push before pull so local work is never overwritten by a
 * server copy that predates it.
 */
export async function runSync(db: SQLiteDatabase, displayName = ''): Promise<SyncResult> {
  if (!supabase) return { ok: false, pushed: 0, pulled: 0, error: 'Sync not configured' };

  const { data: sessionData } = await supabase.auth.getSession();
  const session = sessionData.session;
  if (!session) {
    return { ok: false, pushed: 0, pulled: 0, error: 'Not signed in' };
  }

  let pushed = 0;
  let pulled = 0;

  try {
    await resetWatermarkOnAccountChange(db, session.user.id);
    await ensureSelfMembership(db, session.user.id, displayName);

    // One rejected row must not cost the user everything else. Record the
    // failure and keep going: the pull below is what fills in a trip they have
    // just joined, and skipping it leaves them staring at an empty budget with
    // no way to recover. A failed push keeps its dirty flag and retries.
    const problems: string[] = [];
    for (const table of SYNCED_TABLES) {
      try {
        pushed += await pushTable(db, table, displayName);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : `push ${table} failed`);
      }
    }

    const fullPull = (await getSyncState(db, FULL_PULL_KEY)) === '1';
    const since = fullPull ? null : await getSyncState(db, LAST_PULLED_KEY);
    const startedAt = await serverNow();

    for (const table of SYNCED_TABLES) {
      pulled += await pullTable(db, table, since || null, session.user.id);
    }

    // Signing out mid-pass clears the watermark along with everything else.
    // Writing a fresh one here would tell the next account that this empty
    // database had already seen every row up to now.
    if ((await currentUserId()) !== session.user.id) {
      return { ok: false, pushed, pulled, error: 'Signed out during sync' };
    }

    // The watermark only moves once every pull has landed, so a failed pull is
    // retried rather than skipped. A failed push does not hold it back: those
    // rows are tracked by their dirty flag, not by the clock.
    //
    // It has to be the database's clock. The device's would let a phone running
    // fast park the watermark in the future and skip every partner write from
    // then on, so a pass that could not read the server clock leaves it where
    // it was: the next pass re-pulls this window, which costs bandwidth and
    // loses nothing.
    if (startedAt) {
      await setSyncState(db, LAST_PULLED_KEY, startedAt);
      if (fullPull) await setSyncState(db, FULL_PULL_KEY, '');
    } else {
      problems.push('Could not read the server clock, so the next sync will re-check everything.');
    }

    return { ok: problems.length === 0, pushed, pulled, error: problems[0] };
  } catch (e) {
    return {
      ok: false,
      pushed,
      pulled,
      error: e instanceof Error ? e.message : 'Sync failed',
    };
  }
}

/**
 * Removes everything belonging to the account, leaving the device's own
 * preferences alone. Runs on sign-out.
 *
 * The local database outlives a session, so without this a phone handed to
 * someone else still shows the previous traveller's trips and expenses to
 * whoever signs in next. They can no longer sync them — membership settles
 * that — but they can still read them, which is not what signing out looks
 * like it does.
 *
 * The FX cache and the country list stay: neither is personal, and refetching
 * rates needs a connection the next traveller may not have. Appearance and the
 * wifi-only preference stay for the same reason — they describe the phone, not
 * the person. `sync_state` goes, so signing the same account back in starts
 * from a clean watermark and pulls the trips down again rather than trusting a
 * record of what a now-empty database had already seen.
 *
 * Anything still dirty is genuinely gone. The caller is expected to have said
 * so before getting here.
 */
export async function clearAccountData(db: SQLiteDatabase): Promise<void> {
  await db.withExclusiveTransactionAsync(async (txn) => {
    // Children first. Nothing here declares a foreign key, but the order costs
    // nothing and keeps the intent legible.
    for (const table of [...SYNCED_TABLES].reverse()) {
      await txn.runAsync(`DELETE FROM ${table}`);
    }
    await txn.runAsync('DELETE FROM sync_state');
    await txn.runAsync(
      'DELETE FROM settings WHERE key IN (?, ?)',
      SETTING_KEYS.activeTripId,
      SETTING_KEYS.displayName
    );
  });
}

export async function countPendingChanges(db: SQLiteDatabase): Promise<number> {
  let total = 0;
  for (const table of SYNCED_TABLES) {
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ${table} WHERE dirty = 1`
    );
    total += row?.n ?? 0;
  }
  return total;
}

export async function getLastPulledAt(db: SQLiteDatabase): Promise<string | null> {
  return (await getSyncState(db, LAST_PULLED_KEY)) || null;
}

/**
 * Asks the next pass to ignore the watermark and fetch every row the account
 * can see.
 *
 * Joining a trip is what needs this. The watermark means "this device holds
 * everything written before now", which is only true of trips it was already a
 * member of. Every row of a trip joined today was written before it, so an
 * incremental pull skips the trip's legs, budgets and expenses for good and the
 * new member is left looking at an empty budget.
 *
 * It is a stored flag rather than a cleared watermark because a pass already in
 * flight is about to write a fresh watermark of its own, which would swallow
 * the request. The flag survives that and is only cleared by a pull that
 * actually ran without one.
 */
export async function requestFullPull(db: SQLiteDatabase): Promise<void> {
  await setSyncState(db, FULL_PULL_KEY, '1');
}
