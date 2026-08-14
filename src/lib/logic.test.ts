import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  dateRange,
  daysBetween,
  isValidDate,
  isWithin,
  parseLocalDate,
  toLocalDate,
} from './dates.ts';
import { csvEscape } from './csv.ts';
import { convertToNzd, parseAmount, round2 } from './money.ts';

test('toLocalDate reads the calendar day from local clock components', () => {
  // Holds in any timezone the tests happen to run in: 8:30pm on the 14th is
  // the 14th, full stop.
  assert.equal(toLocalDate(new Date(2027, 0, 14, 20, 30)), '2027-01-14');
});

test('an evening in Rome does not slide to the next day in NZ reckoning', () => {
  // The actual failure mode local_date exists to prevent. 20:30 on 14 Jan in
  // Rome (UTC+1) is 08:30 on 15 Jan in Auckland (UTC+13). Grouping the daily
  // chart by the instant, rendered in the traveller's home timezone, would file
  // this dinner under the 15th.
  const romeDinner = new Date(Date.UTC(2027, 0, 14, 19, 30));

  const nzDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(romeDinner);

  const romeDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(romeDinner);

  assert.equal(romeDay, '2027-01-14', 'the day the traveller experienced');
  assert.equal(nzDay, '2027-01-15', 'the same instant seen from home');
  assert.notEqual(romeDay, nzDay);

  // local_date stores the first of those, captured on the device at entry time.
});

test('toLocalDate does not roll over near midnight', () => {
  assert.equal(toLocalDate(new Date(2027, 0, 14, 23, 59)), '2027-01-14');
  assert.equal(toLocalDate(new Date(2027, 0, 15, 0, 1)), '2027-01-15');
});

test('parseLocalDate avoids the UTC shift that new Date(string) applies', () => {
  const d = parseLocalDate('2027-01-05');
  assert.equal(d.getFullYear(), 2027);
  assert.equal(d.getMonth(), 0);
  assert.equal(d.getDate(), 5);
  // Round trip must be stable regardless of the machine's timezone.
  assert.equal(toLocalDate(d), '2027-01-05');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2027-01-30', 3), '2027-02-02');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2027-03-05', -6), '2027-02-27');
});

test('addDays handles a leap year', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
});

test('daysBetween counts whole days', () => {
  assert.equal(daysBetween('2027-01-05', '2027-01-12'), 7);
  assert.equal(daysBetween('2027-01-05', '2027-01-05'), 0);
});

test('dateRange is inclusive at both ends and has no gaps', () => {
  const range = dateRange('2027-01-05', '2027-01-08');
  assert.deepEqual(range, ['2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08']);
});

test('isWithin matches the leg lookup used to infer country and currency', () => {
  assert.equal(isWithin('2027-01-12', '2027-01-05', '2027-01-12'), true);
  assert.equal(isWithin('2027-01-05', '2027-01-05', '2027-01-12'), true);
  assert.equal(isWithin('2027-01-13', '2027-01-05', '2027-01-12'), false);
});

test('isValidDate rejects dates that do not exist', () => {
  assert.equal(isValidDate('2027-01-05'), true);
  assert.equal(isValidDate('2027-02-30'), false);
  assert.equal(isValidDate('2027-13-01'), false);
  assert.equal(isValidDate('27-01-05'), false);
  assert.equal(isValidDate(''), false);
});

test('convertToNzd multiplies by the rate and rounds to cents', () => {
  // 46.80 EUR at 1.9663 NZD per EUR
  assert.equal(convertToNzd(46.8, 1.9663), 92.02);
  assert.equal(convertToNzd(0, 1.9663), 0);
});

test('convertToNzd applies the card markup on top of the mid-market rate', () => {
  const mid = convertToNzd(100, 2);
  const withMarkup = convertToNzd(100, 2, 2.5);
  assert.equal(mid, 200);
  assert.equal(withMarkup, 205);
  assert.ok(withMarkup > mid, 'a markup must increase the NZD cost');
});

test('parseAmount accepts the comma decimal separator used across Europe', () => {
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount('12.50'), 12.5);
  assert.equal(parseAmount('\u20AC 12.50'), 12.5);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
});

test('parseAmount handles European and US thousand separators', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(parseAmount('1.234'), 1234);
  assert.equal(parseAmount('1,234'), 1234);
  assert.equal(parseAmount('1.234.567'), 1234567);
  assert.equal(parseAmount('-12,50'), -12.5);
});

test('parseAmount does not read a leading zero as a thousands group', () => {
  // The three-trailing-digits rule turned these into whole units: 0.005 came
  // back as 5, overstating the expense by a factor of a thousand.
  assert.equal(parseAmount('0.005'), 0.005);
  assert.equal(parseAmount('0.500'), 0.5);
  assert.equal(parseAmount('0,750'), 0.75);
  assert.equal(parseAmount('.500'), 0.5);
  // The genuine thousands cases still read as thousands.
  assert.equal(parseAmount('1.500'), 1500);
  assert.equal(parseAmount('12,500'), 12500);
});

test('round2 avoids binary floating point drift', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test('csvEscape neutralises text a spreadsheet would run as a formula', () => {
  // A description is free text, and it is opened on someone else's machine.
  assert.equal(csvEscape('=1+1'), "'=1+1");
  assert.equal(csvEscape('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvEscape('+41 rail pass'), "'+41 rail pass");
  assert.equal(csvEscape('-VAT refund'), "'-VAT refund");
  // Quoting still applies on top of the guard.
  assert.equal(csvEscape('=A1,"x"'), '"\'=A1,""x"""');
  // Ordinary text is untouched, and numbers stay numeric so a negative amount
  // is not exported as a string.
  assert.equal(csvEscape('Dinner in Trastevere'), 'Dinner in Trastevere');
  assert.equal(csvEscape(-12.5), '-12.5');
  assert.equal(csvEscape(92.02), '92.02');
});
