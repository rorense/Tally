import type { SQLiteDatabase } from 'expo-sqlite';
import {
  listCategoryBudgets,
  listCountries,
  listExpenses,
  listMembers,
} from '../db/repository';
import { CATEGORIES, type Trip } from '../db/types';
import { round2 } from './money';
import { buildXlsx, type Sheet } from './xlsx';

export interface ExportData {
  csv: string;
  xlsx: Uint8Array;
  /** Filename stem, without an extension. */
  baseName: string;
  rowCount: number;
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Builds both export formats from one pass over the data, so the CSV and the
 * workbook can never disagree.
 */
export async function buildExport(db: SQLiteDatabase, trip: Trip): Promise<ExportData> {
  const [expenses, countries, budgets, members] = await Promise.all([
    listExpenses(db, trip.id),
    listCountries(db),
    listCategoryBudgets(db, trip.id),
    listMembers(db, trip.id),
  ]);

  const countryName = (code: string) =>
    countries.find((c) => c.country_code === code)?.name ?? code;
  const memberName = (id: string | null) =>
    id ? (members.find((m) => m.user_id === id)?.display_name ?? 'Traveller') : '';

  // Oldest first reads better in a spreadsheet than the newest-first app list.
  const ordered = [...expenses].sort((a, b) => a.local_date.localeCompare(b.local_date));

  const headers = [
    'Date',
    'Category',
    'Description',
    'Country',
    'Amount',
    'Currency',
    'Rate to NZD',
    'Amount NZD',
    'Paid by',
  ];

  const rows = ordered.map((e) => [
    e.local_date,
    e.category,
    e.description,
    countryName(e.country_code),
    round2(e.amount),
    e.currency,
    e.rate_to_nzd,
    round2(e.amount_nzd),
    memberName(e.paid_by),
  ]);

  const csv = [
    headers.join(','),
    ...rows.map((r) => r.map(csvEscape).join(',')),
  ].join('\n');

  const total = round2(ordered.reduce((sum, e) => sum + e.amount_nzd, 0));

  const expensesSheet: Sheet = {
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
    rows,
  };

  const budgetFor = (category: string) =>
    budgets.find((b) => b.category === category)?.budget_nzd ?? 0;

  const summaryRows: (string | number)[][] = [
    ['Trip', trip.name],
    ['Dates', `${trip.start_date} to ${trip.end_date}`],
    ['Type', trip.trip_type === 'single' ? 'Single country' : 'Multiple countries'],
    ['Total budget NZD', round2(trip.total_budget_nzd)],
    ['Total spent NZD', total],
    ['Remaining NZD', round2(trip.total_budget_nzd - total)],
    ['Expenses recorded', ordered.length],
    ['', ''],
    ['Category', 'Spent NZD'],
  ];

  for (const cat of CATEGORIES) {
    const spent = round2(
      ordered.filter((e) => e.category === cat).reduce((s, e) => s + e.amount_nzd, 0)
    );
    summaryRows.push([cat, spent]);
    const budget = budgetFor(cat);
    if (budget > 0) summaryRows.push([`${cat} budget`, round2(budget)]);
  }

  summaryRows.push(['', '']);
  summaryRows.push(['Country', 'Spent NZD']);
  const countryTotals = new Map<string, number>();
  for (const e of ordered) {
    countryTotals.set(e.country_code, (countryTotals.get(e.country_code) ?? 0) + e.amount_nzd);
  }
  for (const [code, amount] of [...countryTotals].sort((a, b) => b[1] - a[1])) {
    summaryRows.push([countryName(code), round2(amount)]);
  }

  const summarySheet: Sheet = {
    name: 'Summary',
    columns: [
      { header: 'Item', width: 26 },
      { header: 'Value', width: 22 },
    ],
    rows: summaryRows,
  };

  return {
    csv,
    xlsx: buildXlsx([summarySheet, expensesSheet]),
    baseName: `${trip.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-expenses`,
    rowCount: ordered.length,
  };
}
