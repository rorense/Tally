import type { SQLiteDatabase } from 'expo-sqlite';
import { getSyncState, setSyncState, upsertMember } from '../db/repository';
import { supabase } from './supabase';

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

/** `dirty` is a local bookkeeping flag and must never be sent to Postgres. */
const LOCAL_ONLY_COLUMNS = new Set(['dirty']);

const LAST_PULLED_KEY = 'last_pulled_at';

export interface SyncResult {
  ok: boolean;
  pushed: number;
  pulled: number;
  error?: string;
}

function stripLocalColumns(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!LOCAL_ONLY_COLUMNS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * SQLite has no boolean or null-date types, so empty strings creep in where
 * Postgres wants a real null.
 */
function normaliseForPostgres(row: Record<string, unknown>) {
  const out = stripLocalColumns(row);
  for (const [k, v] of Object.entries(out)) {
    if (v === '') out[k] = null;
  }
  return out;
}

function normaliseForSqlite(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}

async function columnsOf(db: SQLiteDatabase, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

/** Pushes every locally-changed row, then clears the dirty flag on success. */
async function pushTable(db: SQLiteDatabase, table: SyncedTable): Promise<number> {
  if (!supabase) return 0;

  const dirtyRows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ${table} WHERE dirty = 1`
  );
  if (dirtyRows.length === 0) return 0;

  const payload = dirtyRows.map(normaliseForPostgres);
  const { error } = await supabase.from(table).upsert(payload, { onConflict: 'id' });
  if (error) throw new Error(`push ${table}: ${error.message}`);

  const ids = dirtyRows.map((r) => r.id as string);
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE id IN (${placeholders})`, ids);

  return ids.length;
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
      pushed += await pushTable(db, table);
    }

    const since = await getSyncState(db, LAST_PULLED_KEY);
    // Read the server clock before pulling, so rows written during this pass
    // are picked up next time rather than being skipped.
    const startedAt = new Date().toISOString();

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
