/** `dirty` is a local bookkeeping flag and must never be sent to Postgres. */
const LOCAL_ONLY_COLUMNS = new Set(['dirty']);

/** Strips columns that only exist on the device. */
export function stripLocalColumns(row: Record<string, unknown>) {
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
export function normaliseForPostgres(row: Record<string, unknown>) {
  const out = stripLocalColumns(row);
  for (const [k, v] of Object.entries(out)) {
    if (v === '') out[k] = null;
  }
  return out;
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
