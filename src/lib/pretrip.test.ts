import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { IS_PRETRIP_SQL, isPretrip } from './pretrip.ts';

const START = '2027-01-10';

/** The shapes the two halves of the rule have to separate. */
const rows = [
  { id: 'flagged-inside', is_pretrip: 1, local_date: '2027-01-14' },
  { id: 'flagged-before', is_pretrip: 1, local_date: '2027-01-02' },
  { id: 'dated-before', is_pretrip: 0, local_date: '2027-01-05' },
  { id: 'dated-day-before', is_pretrip: 0, local_date: '2027-01-09' },
  { id: 'on-the-start-date', is_pretrip: 0, local_date: START },
  { id: 'mid-trip', is_pretrip: 0, local_date: '2027-01-14' },
  { id: 'after-the-end', is_pretrip: 0, local_date: '2027-03-01' },
];

test('the flag alone makes an expense pretrip', () => {
  assert.equal(isPretrip({ is_pretrip: 1, local_date: '2027-01-14' }, START), true);
});

test('a date before the trip starts makes an expense pretrip without the flag', () => {
  // The case the old per-call-site spellings disagreed on: the charts drew an
  // axis from the start date, so this row had no column to land in, while the
  // Expenses list filed it under an ordinary trip day.
  assert.equal(isPretrip({ is_pretrip: 0, local_date: '2027-01-09' }, START), true);
});

test('the start date itself is a trip day, not pretrip', () => {
  assert.equal(isPretrip({ is_pretrip: 0, local_date: START }, START), false);
});

test('an ordinary day inside the trip is not pretrip', () => {
  assert.equal(isPretrip({ is_pretrip: 0, local_date: '2027-01-14' }, START), false);
});

test('a date past the trip end is still not pretrip', () => {
  // Only the start edge is part of this rule; the charts clamp the far end.
  assert.equal(isPretrip({ is_pretrip: 0, local_date: '2027-03-01' }, START), false);
});

test('the SQL spelling and the function agree row for row', () => {
  // The aggregates cannot call isPretrip, so the rule exists twice. This is
  // what stops the copies drifting the way the call sites did.
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE expenses (id TEXT, is_pretrip INTEGER NOT NULL, local_date TEXT NOT NULL)`);
  const insert = db.prepare('INSERT INTO expenses (id, is_pretrip, local_date) VALUES (?, ?, ?)');
  for (const r of rows) insert.run(r.id, r.is_pretrip, r.local_date);

  const sqlSays = new Set(
    db
      .prepare(`SELECT id FROM expenses WHERE ${IS_PRETRIP_SQL}`)
      .all(START)
      .map((r) => (r as { id: string }).id)
  );
  const fnSays = new Set(rows.filter((r) => isPretrip(r, START)).map((r) => r.id));

  assert.deepEqual([...fnSays].sort(), [...sqlSays].sort());

  // And the complements, so `NOT (...)` in spentByDay is covered too.
  const sqlNot = db
    .prepare(`SELECT id FROM expenses WHERE NOT ${IS_PRETRIP_SQL}`)
    .all(START)
    .map((r) => (r as { id: string }).id);
  assert.deepEqual(
    sqlNot.sort(),
    rows.filter((r) => !isPretrip(r, START)).map((r) => r.id).sort()
  );

  db.close();
});
