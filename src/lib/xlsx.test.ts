import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { buildXlsx, columnName, toBase64, type Sheet } from './xlsx.ts';

const sample: Sheet = {
  name: 'Expenses',
  columns: [
    { header: 'Date', width: 12 },
    { header: 'Description', width: 30 },
    { header: 'Amount NZD', width: 14, format: 'money' },
  ],
  rows: [
    ['2027-01-14', 'Dinner in Trastevere', 92.02],
    ['2027-01-15', 'Museum & "tour"', 34.5],
    ['2027-01-16', '', 0],
  ],
};

function open(sheets: Sheet[]) {
  const files = unzipSync(buildXlsx(sheets));
  return {
    names: Object.keys(files),
    text: (path: string) => strFromU8(files[path]),
  };
}

test('columnName follows spreadsheet column lettering', () => {
  assert.equal(columnName(0), 'A');
  assert.equal(columnName(25), 'Z');
  assert.equal(columnName(26), 'AA');
  assert.equal(columnName(27), 'AB');
  assert.equal(columnName(51), 'AZ');
  assert.equal(columnName(52), 'BA');
});

test('the workbook contains every part an xlsx reader requires', () => {
  const { names } = open([sample]);
  for (const required of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
  ]) {
    assert.ok(names.includes(required), `missing part: ${required}`);
  }
});

test('every sheet is declared, related and typed consistently', () => {
  const twoSheets = [sample, { ...sample, name: 'Summary' }];
  const { text } = open(twoSheets);

  const workbook = text('xl/workbook.xml');
  assert.match(workbook, /name="Expenses" sheetId="1" r:id="rId1"/);
  assert.match(workbook, /name="Summary" sheetId="2" r:id="rId2"/);

  // Styles must take the id after the last sheet or Excel reports corruption.
  const rels = text('xl/_rels/workbook.xml.rels');
  assert.match(rels, /Id="rId1"[^>]*worksheets\/sheet1\.xml/);
  assert.match(rels, /Id="rId2"[^>]*worksheets\/sheet2\.xml/);
  assert.match(rels, /Id="rId3"[^>]*styles\.xml/);

  const types = text('[Content_Types].xml');
  assert.match(types, /\/xl\/worksheets\/sheet1\.xml/);
  assert.match(types, /\/xl\/worksheets\/sheet2\.xml/);
});

test('headers and values land in the right cells', () => {
  const { text } = open([sample]);
  const sheet = text('xl/worksheets/sheet1.xml');

  assert.match(sheet, /<c r="A1"[^>]*><is><t[^>]*>Date<\/t>/);
  assert.match(sheet, /<c r="C1"[^>]*><is><t[^>]*>Amount NZD<\/t>/);

  // Row 2 is the first data row, since row 1 holds the headers.
  assert.match(sheet, /<c r="A2"[^>]*><is><t[^>]*>2027-01-14<\/t>/);
  assert.match(sheet, /<c r="C2"[^>]*><v>92\.02<\/v><\/c>/);
  assert.match(sheet, /dimension ref="A1:C4"/);
});

test('numbers are written as numbers, not text', () => {
  const { text } = open([sample]);
  const sheet = text('xl/worksheets/sheet1.xml');
  // A numeric cell must use <v>, never an inline string, or Excel cannot sum it.
  assert.match(sheet, /<c r="C3" s="2"><v>34\.5<\/v><\/c>/);
  assert.doesNotMatch(sheet, /<c r="C3"[^>]*t="inlineStr"/);
});

test('XML-hostile characters in user text are escaped', () => {
  const { text } = open([sample]);
  const sheet = text('xl/worksheets/sheet1.xml');
  assert.match(sheet, /Museum &amp; &quot;tour&quot;/);
  assert.doesNotMatch(sheet, /Museum & "tour"/);
});

test('sheet names are sanitised so Excel does not report a corrupt file', () => {
  const { text } = open([{ ...sample, name: 'Trip: France/Italy [2027]' }]);
  const workbook = text('xl/workbook.xml');

  // Scope the check to the name attribute: the document itself legitimately
  // contains colons and slashes in its XML namespace URLs.
  const name = workbook.match(/<sheet name="([^"]*)"/)?.[1];
  assert.ok(name, 'no sheet name found');
  assert.doesNotMatch(name, /[:\\/?*[\]]/, `illegal character survived in ${name}`);
  assert.equal(name, 'Trip  France Italy  2027');
});

test('over-long sheet names are truncated to the 31 character limit', () => {
  const { text } = open([{ ...sample, name: 'A'.repeat(60) }]);
  const workbook = text('xl/workbook.xml');
  const match = workbook.match(/name="(A+)"/);
  assert.ok(match);
  assert.equal(match[1].length, 31);
});

test('an empty sheet still produces a readable workbook', () => {
  const { text } = open([{ name: 'Empty', columns: [{ header: 'Nothing' }], rows: [] }]);
  const sheet = text('xl/worksheets/sheet1.xml');
  assert.match(sheet, /dimension ref="A1:A1"/);
  assert.match(sheet, /<is><t[^>]*>Nothing<\/t>/);
});

test('toBase64 matches Buffer for binary input of every length remainder', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 255, 1024]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = (i * 37 + 11) % 256;
    assert.equal(
      toBase64(bytes),
      Buffer.from(bytes).toString('base64'),
      `mismatch at length ${length}`
    );
  }
});

test('the workbook round-trips through base64 unchanged', () => {
  const bytes = buildXlsx([sample]);
  const restored = new Uint8Array(Buffer.from(toBase64(bytes), 'base64'));
  assert.deepEqual(restored, bytes);

  // And the restored bytes still unzip, so the file written to disk is valid.
  const files = unzipSync(restored);
  assert.ok(files['xl/workbook.xml']);
});

test('the file starts with the ZIP magic number', () => {
  const bytes = buildXlsx([sample]);
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});
