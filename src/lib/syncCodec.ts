/** `dirty` is a local bookkeeping flag and must never be sent to Postgres. */
const LOCAL_ONLY_COLUMNS = new Set(['dirty']);

/**
 * SQLite stores missing optional FKs / timestamps as `''`. Only these may become
 * SQL null — NOT NULL text columns like `display_name` and `description` keep ''.
 */
const EMPTY_STRING_AS_NULL = new Set(['leg_id', 'paid_by', 'deleted_at']);

/** Strips columns that only exist on the device. */
export function stripLocalColumns(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!LOCAL_ONLY_COLUMNS.has(k)) out[k] = v;
  }
  return out;
}

/**
 * Prepares a local row for PostgREST. Empty strings on nullable columns become
 * null; everything else is left alone so NOT NULL defaults stay valid.
 */
export function normaliseForPostgres(row: Record<string, unknown>) {
  const out = stripLocalColumns(row);
  for (const [k, v] of Object.entries(out)) {
    if (v === '' && EMPTY_STRING_AS_NULL.has(k)) out[k] = null;
  }
  return out;
}

/**
 * True when `a` happened after `b`.
 *
 * Postgres and SQLite spell the same instant differently — `...12.123456+00:00`
 * against `...12.123Z` — so the two have to be compared as instants. Comparing
 * the strings orders them by punctuation whenever they land in the same second.
 */
export function isNewerThan(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a > b;
  return ta > tb;
}

export function normaliseForSqlite(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}
