import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCompleteJoinCode, normalizeJoinCode } from './joinCode.ts';
import { budgetPaceNzd } from './pace.ts';
import {
  canonicalInstant,
  isNewerThan,
  normaliseForPostgres,
  normaliseForSqlite,
  stripLocalColumns,
} from './syncCodec.ts';

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

test('normaliseForPostgres nulls optional FKs but keeps empty NOT NULL text', () => {
  const out = normaliseForPostgres({
    id: '1',
    leg_id: '',
    paid_by: '',
    deleted_at: '',
    display_name: '',
    description: '',
    dirty: 1,
  });
  assert.equal(out.leg_id, null);
  assert.equal(out.paid_by, null);
  assert.equal(out.deleted_at, null);
  assert.equal(out.display_name, '');
  assert.equal(out.description, '');
  assert.equal('dirty' in out, false);
});

test('isNewerThan compares instants, not the two stores spellings of them', () => {
  const postgres = '2027-01-05T09:53:12.123456+00:00';
  const sqlite = '2027-01-05T09:53:12.500Z';
  // Same second, different formats: comparing as strings puts these backwards.
  assert.equal(isNewerThan(sqlite, postgres), true);
  assert.equal(isNewerThan(postgres, sqlite), false);
  assert.equal(isNewerThan(postgres, postgres), false);
  assert.equal(isNewerThan('2027-01-06T00:00:00Z', postgres), true);
});

test('normaliseForSqlite stores booleans as 0/1', () => {
  const out = normaliseForSqlite({ flag: true, other: false, missing: null });
  assert.equal(out.flag, 1);
  assert.equal(out.other, 0);
  assert.equal(out.missing, null);
});

test('canonicalInstant gives Postgres and the device one spelling', () => {
  assert.equal(canonicalInstant('2027-01-05T09:53:12.123456+00:00'), '2027-01-05T09:53:12.123Z');
  assert.equal(canonicalInstant('2027-01-05T09:53:12.5+00:00'), '2027-01-05T09:53:12.500Z');
  // Already canonical, and a non-UTC offset folded to UTC.
  assert.equal(canonicalInstant('2027-01-05T09:53:12.123Z'), '2027-01-05T09:53:12.123Z');
  assert.equal(canonicalInstant('2027-01-05T10:53:12.000+01:00'), '2027-01-05T09:53:12.000Z');
  // Unparseable input is passed through rather than turned into Invalid Date.
  assert.equal(canonicalInstant('not a date'), 'not a date');
});

test('canonical timestamps compare by time rather than by format', () => {
  // The conflict check in pullTable is a SQL string comparison, so this is the
  // property that makes it correct. Raw, these are one instant written two
  // ways and the comparison still picks a winner: 'Z' sorts above '+', so the
  // SQLite spelling always looks newer than the Postgres one.
  const fromPostgres = '2027-01-05T09:53:12.500+00:00';
  const fromSqlite = '2027-01-05T09:53:12.500Z';
  assert.ok(fromSqlite > fromPostgres, 'raw spellings of one instant do not tie');
  assert.equal(canonicalInstant(fromSqlite), canonicalInstant(fromPostgres));

  // A genuinely later write still sorts later, whichever side wrote it.
  const laterFromPostgres = '2027-01-05T09:53:13+00:00';
  assert.ok(canonicalInstant(laterFromPostgres) > canonicalInstant(fromSqlite));
});

test('normaliseForSqlite canonicalises instants but leaves calendar dates alone', () => {
  const out = normaliseForSqlite({
    updated_at: '2027-01-05T09:53:12.123456+00:00',
    spent_at: '2027-01-05T09:53:12.5+00:00',
    shopback_confirmed_at: null,
    // Date-only columns are the day the traveller was standing in. Running
    // these through a Date would shift them across the dateline.
    local_date: '2027-01-05',
    start_date: '2027-01-01',
  });
  assert.equal(out.updated_at, '2027-01-05T09:53:12.123Z');
  assert.equal(out.spent_at, '2027-01-05T09:53:12.500Z');
  assert.equal(out.shopback_confirmed_at, null);
  assert.equal(out.local_date, '2027-01-05');
  assert.equal(out.start_date, '2027-01-01');
});
