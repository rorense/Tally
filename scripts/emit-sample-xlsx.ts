/**
 * Emits a sample workbook so the generated .xlsx can be opened by a real
 * spreadsheet application. Run: npm run sample:xlsx
 */
import { writeFileSync } from 'node:fs';
import { buildXlsx, type Sheet } from '../src/lib/xlsx.ts';

const expenses: Sheet = {
  name: 'Expenses',
  columns: [
    { header: 'Date', width: 12 },
    { header: 'Category', width: 15 },
    { header: 'Description', width: 34 },
    { header: 'Country', width: 18 },
    { header: 'Amount', width: 12, format: 'money' },
    { header: 'Currency', width: 10 },
    { header: 'Rate to NZD', width: 13 },
    { header: 'Amount NZD', width: 14, format: 'money' },
    { header: 'Paid by', width: 16 },
  ],
  rows: [
    ['2027-01-14', 'Food', 'Dinner in Trastevere', 'Italy', 46.8, 'EUR', 1.9663, 92.02, 'Sam'],
    ['2027-01-15', 'Activity', 'Colosseum & forum', 'Italy', 34, 'EUR', 1.9663, 66.85, 'Alex'],
    ['2027-01-16', 'Transport', 'Train to Florence', 'Italy', 29.9, 'EUR', 1.9663, 58.79, 'Sam'],
    ['2027-01-18', 'Accommodation', 'Hotel "Le Pont"', 'France', 180, 'EUR', 1.9663, 353.93, 'Alex'],
    ['2027-01-20', 'Souvenir', 'Postcards', 'United Kingdom', 6.5, 'GBP', 2.2991, 14.94, 'Sam'],
  ],
};

const summary: Sheet = {
  name: 'Summary',
  columns: [
    { header: 'Item', width: 26 },
    { header: 'Value', width: 22 },
  ],
  rows: [
    ['Trip', 'Europe 2027'],
    ['Dates', '2027-01-10 to 2027-02-02'],
    ['Type', 'Multiple countries'],
    ['Total budget NZD', 12000],
    ['Total spent NZD', 586.53],
    ['', ''],
    ['Category', 'Spent NZD'],
    ['Food', 92.02],
    ['Activity', 66.85],
    ['Transport', 58.79],
    ['Accommodation', 353.93],
    ['Souvenir', 14.94],
  ],
};

const out = process.argv[2] ?? 'sample-export.xlsx';
writeFileSync(out, buildXlsx([summary, expenses]));
console.log(`wrote ${out}`);
