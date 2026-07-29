/**
 * Emits a sample workbook so the generated .xlsx can be opened by a real
 * spreadsheet application. Run: npm run sample:xlsx
 */
import { writeFileSync } from 'node:fs';
import { buildXlsx, type Sheet } from '../src/lib/xlsx.ts';

const finances: Sheet = {
  name: 'finances',
  columns: [
    { header: 'Date', width: 10 },
    { header: 'Category', width: 14 },
    { header: 'Description', width: 36 },
    { header: 'Amount', width: 12, format: 'money' },
    { header: 'Currency', width: 10 },
    { header: 'NZD Equivalent', width: 14, format: 'money' },
    { header: 'Day Total', width: 12, format: 'money' },
    { header: 'Currency Conversion (1 unit equals to NZD)', width: 42 },
    { header: '', width: 14, format: 'money' },
  ],
  rows: [
    ['Preflight', 'Transport', 'Auckland to Rome', 1890, 'NZD', 1890, 2243.93, 'EUR', 1.9663],
    ['Preflight', 'Accommodation', 'Rome hotel', 180, 'EUR', 353.93, '', 'NZD', 1],
    ['14/01', 'Food', 'Dinner in Trastevere', 46.8, 'EUR', 92.02, 158.87, '', ''],
    ['', 'Activity', 'Colosseum & forum', 34, 'EUR', 66.85, '', 'Total', 2802.8],
    ['15/01', 'Transport', 'Train to Florence', 29.9, 'EUR', 58.79, 58.79, '', ''],
    ['', '', '', '', '', '', '', 'Category Spends', ''],
    ['', '', '', '', '', '', '', 'Transport', 1948.79],
    ['', '', '', '', '', '', '', 'Accommodation', 353.93],
    ['', '', '', '', '', '', '', 'Activity', 66.85],
    ['', '', '', '', '', '', '', 'Food', 92.02],
  ],
};

const out = process.argv[2] ?? 'sample-export.xlsx';
writeFileSync(out, buildXlsx([finances]));
console.log(`wrote ${out}`);
