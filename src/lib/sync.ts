import type { SQLiteDatabase } from 'expo-sqlite';
import { getSyncState, setSyncState, upsertMember } from '../db/repository';
import { supabase } from './supabase';
import { isNewerThan, normaliseForPostgres, normaliseForSqlite } from './syncCodec';

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
 * A membership is the one row both sides can create on their own: joining runs
 * `join_trip_with_code`, which mints an id in Postgres, while
 * `ensureSelfMembership` mints a different one on the device. Two ids, one
 * person, and `unique (trip_id, user_id)` on both stores rejects the second
 * copy — the push fails on the server constraint and the pull fails on the
 * local index, wedging sync in both directions.
 *
 * Pushing and pulling on this key instead of `id` lets the two copies collapse
 * into one wherever they meet.
 */
const NATURAL_KEYS: Partial<Record<SyncedTable, readonly string[]>> = {
  trip_members: ['trip_id', 'user_id'],
};

const LAST_PULLED_KEY = 'last_pulled_at';
const FULL_PULL_KEY = 'full_pull_pending';

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
    for (const row of dirtyRows) {
      const payload = normaliseForPostgres(row);
      const { error } = await supabase.rpc('upsert_own_trip', {
        p_trip: payload,
        p_display_name: displayName,
      });
      if (error) throw new Error(`push trips: ${error.message}`);
      await db.runAsync(
        `UPDATE trips SET dirty = 0 WHERE id = ? AND updated_at = ?`,
        row.id as string,
        row.updated_at as string
      );
    }
    return dirtyRows.length;
  }

  const payload = dirtyRows.map(normaliseForPostgres);
  const onConflict = (NATURAL_KEYS[table] ?? ['id']).join(',');
  const { error } = await supabase.from(table).upsert(payload, { onConflict });
  if (error) throw new Error(`push ${table}: ${error.message}`);

  // Only clear dirty when the row is still the version we just pushed. An edit
  // during the network await bumps updated_at and must stay dirty so the next
  // pass sends it.
  for (const row of dirtyRows) {
    await db.runAsync(
      `UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at = ?`,
      row.id as string,
      row.updated_at as string
    );
  }

  return dirtyRows.length;
}

/**
 * Pulls rows changed since the last successful sync.
 *
 * Conflicts resolve last-write-wins on `updated_at`. The WHERE clause on the
 * local upsert is what enforces it: a remote row only overwrites the local one
 * if it is genuinely newer, so an unsynced local edit is never clobbered by a
 * stale server copy.
 */
async function pullTable(
  db: SQLiteDatabase,
  table: SyncedTable,
  since: string | null
): Promise<number> {
  if (!supabase) return 0;

  let query = supabase.from(table).select('*');
  if (since) query = query.gt('updated_at', since);

  const { data, error } = await query;
  if (error) throw new Error(`pull ${table}: ${error.message}`);
  if (!data || data.length === 0) return 0;

  const localColumns = await columnsOf(db, table);
  const naturalKey = NATURAL_KEYS[table];

  await db.withTransactionAsync(async () => {
    for (const remote of data) {
      const row = normaliseForSqlite(remote as Record<string, unknown>);

      if (naturalKey) {
        // The same row under a different id. `ON CONFLICT(id)` cannot see that
        // collision, so the unique index would abort the entire pull. Settle it
        // the way every other conflict here is settled — newest write wins. A
        // newer local row keeps its id and hands it to the server on the next
        // push, which upserts on this same key.
        const dup = await db.getFirstAsync<{ id: string; updated_at: string }>(
          `SELECT id, updated_at FROM ${table}
           WHERE ${naturalKey.map((c) => `${c} = ?`).join(' AND ')} AND id <> ?`,
          ...naturalKey.map((c) => row[c] as string),
          row.id as string
        );
        if (dup) {
          if (!isNewerThan(row.updated_at as string, dup.updated_at)) continue;
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
         WHERE excluded.updated_at > ${table}.updated_at`,
        values
      );
    }
  });

  return data.length;
}

export type SyncTrigger = 'manual' | 'reconnect' | 'foreground' | 'startup';

/**
 * Guarantees the signed-in user is a member of every trip created on this
 * device.
 *
 * Trips can be created offline, before any account exists, so membership cannot
 * be written at creation time. Without this backfill the creator would push a
 * trip and then be locked out of it by their own RLS policy, which scopes
 * access through trip_members.
 */
async function ensureSelfMembership(
  db: SQLiteDatabase,
  userId: string,
  displayName: string
): Promise<void> {
  const orphans = await db.getAllAsync<{ id: string }>(
    `SELECT t.id FROM trips t
     WHERE t.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM trip_members m
         WHERE m.trip_id = t.id AND m.user_id = ? AND m.deleted_at IS NULL
       )`,
    userId
  );

  for (const { id } of orphans) {
    await upsertMember(db, { trip_id: id, user_id: userId, display_name: displayName });
  }
}

async function serverNow(): Promise<string> {
  if (!supabase) return new Date().toISOString();
  const { data, error } = await supabase.rpc('server_now');
  if (!error && typeof data === 'string') return data;
  return new Date().toISOString();
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
    await ensureSelfMembership(db, session.user.id, displayName);

    // One rejected row must not cost the user everything else. Record the
    // failure and keep going: the pull below is what fills in a trip they have
    // just joined, and skipping it leaves them staring at an empty budget with
    // no way to recover. A failed push keeps its dirty flag and retries.
    const pushErrors: string[] = [];
    for (const table of SYNCED_TABLES) {
      try {
        pushed += await pushTable(db, table, displayName);
      } catch (e) {
        pushErrors.push(e instanceof Error ? e.message : `push ${table} failed`);
      }
    }

    const fullPull = (await getSyncState(db, FULL_PULL_KEY)) === '1';
    const since = fullPull ? null : await getSyncState(db, LAST_PULLED_KEY);
    // Prefer the database clock so a phone set to the wrong timezone or with a
    // skewed clock cannot park the watermark in the future and permanently
    // skip partner writes. Fall back to the device clock if the RPC is absent
    // on an older project.
    const startedAt = await serverNow();

    for (const table of SYNCED_TABLES) {
      pulled += await pullTable(db, table, since);
    }

    // The watermark only moves once every pull has landed, so a failed pull is
    // retried rather than skipped. A failed push does not hold it back: those
    // rows are tracked by their dirty flag, not by the clock.
    await setSyncState(db, LAST_PULLED_KEY, startedAt);
    if (fullPull) await setSyncState(db, FULL_PULL_KEY, '');
    return { ok: pushErrors.length === 0, pushed, pulled, error: pushErrors[0] };
  } catch (e) {
    return {
      ok: false,
      pushed,
      pulled,
      error: e instanceof Error ? e.message : 'Sync failed',
    };
  }
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
