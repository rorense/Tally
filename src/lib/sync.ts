import type { SQLiteDatabase } from 'expo-sqlite';
import { getSyncState, setSyncState, upsertMember } from '../db/repository';
import { supabase } from './supabase';
import { normaliseForPostgres, normaliseForSqlite } from './syncCodec';

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

const LAST_PULLED_KEY = 'last_pulled_at';

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
  const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
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

  await db.withTransactionAsync(async () => {
    for (const remote of data) {
      const row = normaliseForSqlite(remote as Record<string, unknown>);
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

    for (const table of SYNCED_TABLES) {
      pushed += await pushTable(db, table, displayName);
    }

    const since = await getSyncState(db, LAST_PULLED_KEY);
    // Prefer the database clock so a phone set to the wrong timezone or with a
    // skewed clock cannot park the watermark in the future and permanently
    // skip partner writes. Fall back to the device clock if the RPC is absent
    // on an older project.
    const startedAt = await serverNow();

    for (const table of SYNCED_TABLES) {
      pulled += await pullTable(db, table, since);
    }

    await setSyncState(db, LAST_PULLED_KEY, startedAt);
    return { ok: true, pushed, pulled };
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
  return getSyncState(db, LAST_PULLED_KEY);
}
