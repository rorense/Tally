import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCompleteJoinCode, normalizeJoinCode } from './joinCode.ts';
import { budgetPaceNzd } from './pace.ts';
import { normaliseForPostgres, normaliseForSqlite, stripLocalColumns } from './syncCodec.ts';

test('normalizeJoinCode inserts the hyphen and uppercases', () => {
  assert.equal(normalizeJoinCode('euro4k7p'), 'EURO-4K7P');
  assert.equal(normalizeJoinCode('EURO-4K7P'), 'EURO-4K7P');
  assert.equal(normalizeJoinCode(' euro 4k7p '), 'EURO-4K7P');
  assert.equal(normalizeJoinCode('EURO4K7P'), 'EURO-4K7P');
});

test('normalizeJoinCode leaves incomplete input alone enough to keep typing usable', () => {
  assert.equal(normalizeJoinCode('euro'), 'EURO');
  assert.equal(normalizeJoinCode('euro4'), 'EURO4');
});

test('isCompleteJoinCode requires eight alphanumeric characters', () => {
  assert.equal(isCompleteJoinCode('EURO-4K7P'), true);
  assert.equal(isCompleteJoinCode('EURO4K7P'), true);
  assert.equal(isCompleteJoinCode('EURO'), false);
  assert.equal(isCompleteJoinCode('EURO-4K7'), false);
});

test('budgetPaceNzd spreads the budget across the full trip, not only days elapsed', () => {
  // 30-day trip, $3000 budget. By day 10 the even pace is $1000, not $3000.
  assert.equal(budgetPaceNzd(3000, '2027-01-01', '2027-01-30', 10), 1000);
  assert.equal(budgetPaceNzd(3000, '2027-01-01', '2027-01-30', 30), 3000);
  assert.equal(budgetPaceNzd(3000, '2027-01-01', '2027-01-30', 0), 0);
  assert.equal(budgetPaceNzd(0, '2027-01-01', '2027-01-30', 10), 0);
});

test('stripLocalColumns drops the dirty flag before a push', () => {
  const out = stripLocalColumns({ id: '1', name: 'Rome', dirty: 1 });
  assert.deepEqual(out, { id: '1', name: 'Rome' });
});

test('normaliseForPostgres turns empty strings into null', () => {
  const out = normaliseForPostgres({ id: '1', leg_id: '', dirty: 1, paid_by: '' });
  assert.equal(out.leg_id, null);
  assert.equal(out.paid_by, null);
  assert.equal('dirty' in out, false);
});

test('normaliseForSqlite stores booleans as 0/1', () => {
  const out = normaliseForSqlite({ flag: true, other: false, missing: null });
  assert.equal(out.flag, 1);
  assert.equal(out.other, 0);
  assert.equal(out.missing, null);
});
