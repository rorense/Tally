/** `dirty` is a local bookkeeping flag and must never be sent to Postgres. */
const LOCAL_ONLY_COLUMNS = new Set(['dirty']);

/**
 * SQLite stores missing optional FKs / timestamps as `''`. Only these may become
 * SQL null — NOT NULL text columns like `display_name` and `description` keep ''.
 */
const EMPTY_STRING_AS_NULL = new Set(['leg_id', 'paid_by', 'deleted_at']);

/**
 * Columns holding an absolute instant. Date-only columns (`local_date`,
 * `start_date`, `end_date`) are deliberately absent: they are calendar days in
 * whatever timezone the traveller was standing in, and pushing them through a
 * Date would shift them.
 */
const INSTANT_COLUMNS = new Set([
  'updated_at',
  'deleted_at',
  'spent_at',
  'shopback_confirmed_at',
]);

/**
 * One spelling for one instant.
 *
 * Postgres renders `...12.123456+00:00` where `toISOString()` renders
 * `...12.123Z`, and rows arrive from both. Storing whatever each side happened
 * to send leaves SQLite holding two formats in one column, which matters
 * because the conflict check in `pullTable` is a SQL string comparison: `+`
 * sorts below every digit and `Z` above them, so the same instant can compare
 * either way depending on who wrote it. Normalising on the way in makes every
 * stored timestamp a fixed-width UTC string, where lexical order and
 * chronological order are the same thing.
 */
export function canonicalInstant(value: string): string {
  const t = Date.parse(value);
  return Number.isNaN(t) ? value : new Date(t).toISOString();
}

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
 * Used where the two spellings can still meet — comparing a freshly arrived
 * remote row against one already in SQLite — so the comparison is made on
 * instants rather than on punctuation.
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
    else if (typeof v === 'string' && INSTANT_COLUMNS.has(k)) out[k] = canonicalInstant(v);
    else if (typeof v === 'object') out[k] = JSON.stringify(v);
    else out[k] = v;
  }
  return out;
}
