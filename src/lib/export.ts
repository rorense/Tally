import type { SQLiteDatabase } from 'expo-sqlite';
import { listCategoryBudgets, listExpenses } from '../db/repository';
import { CATEGORIES, type Trip } from '../db/types';
import { csvEscape } from './csv';
import { round2 } from './money';
import { netExpenseNzd } from './cashback';
import { buildXlsx, type Sheet } from './xlsx';

export interface ExportData {
  csv: string;
  xlsx: Uint8Array;
  /** Filename stem, without an extension. */
  baseName: string;
  rowCount: number;
}

/** `YYYY-MM-DD` → `DD/MM`, matching the hand-maintained trip workbook. */
function formatDayLabel(isoDate: string): string {
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
}

/**
 * Builds both export formats from one pass over the data, so the CSV and the
 * workbook can never disagree.
 *
 * The Excel layout mirrors the Finances tab of the trip planning spreadsheet:
 * a day-grouped ledger on the left, with FX rates, a trip total, and category
 * spends stacked on the right.
 */
export async function buildExport(db: SQLiteDatabase, trip: Trip): Promise<ExportData> {
  const [expenses, budgets] = await Promise.all([
    listExpenses(db, trip.id),
    listCategoryBudgets(db, trip.id),
  ]);

  // Oldest first reads better in a spreadsheet than the newest-first app list.
  // Pretrip rows sort before dated spend so the ledger matches the workbook.
  const ordered = [...expenses].sort((a, b) => {
    if (a.is_pretrip !== b.is_pretrip) return b.is_pretrip - a.is_pretrip;
    const byDate = a.local_date.localeCompare(b.local_date);
    if (byDate !== 0) return byDate;
    return a.spent_at.localeCompare(b.spent_at);
  });

  const dayKey = (e: (typeof ordered)[number]) =>
    e.is_pretrip === 1 || e.local_date < trip.start_date ? 'pretrip' : e.local_date;

  const dayTotals = new Map<string, number>();
  for (const e of ordered) {
    const key = dayKey(e);
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + netExpenseNzd(e));
  }

  const total = round2(ordered.reduce((sum, e) => sum + netExpenseNzd(e), 0));
  const cashbackConfirmed = round2(
    ordered.reduce(
      (sum, e) =>
        sum + (e.shopback_status === 'confirmed' ? (e.shopback_amount_nzd ?? 0) : 0),
      0
    )
  );

  // One rate per currency: prefer the most recent expense's frozen rate.
  const rateByCurrency = new Map<string, number>();
  for (const e of ordered) {
    rateByCurrency.set(e.currency, e.rate_to_nzd);
  }
  if (!rateByCurrency.has('NZD')) rateByCurrency.set('NZD', 1);

  // Stacked beside the ledger, matching the hand workbook: FX table, trip
  // total, then per-category spends (and budgets when set).
  const sidePanel: (string | number)[][] = [];
  for (const [currency, rate] of [...rateByCurrency.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    sidePanel.push([currency, rate]);
  }
  sidePanel.push(['', '']);
  sidePanel.push(['Total (net cashback)', total]);
  if (cashbackConfirmed > 0) {
    sidePanel.push(['Cashback confirmed', cashbackConfirmed]);
  }
  sidePanel.push(['', '']);
  sidePanel.push(['Category Spends', '']);
  for (const cat of CATEGORIES) {
    const spent = round2(
      ordered.filter((e) => e.category === cat).reduce((s, e) => s + netExpenseNzd(e), 0)
    );
    const budget = budgets.find((b) => b.category === cat)?.budget_nzd ?? 0;
    sidePanel.push([cat, spent]);
    if (budget > 0) sidePanel.push([`${cat} budget`, round2(budget)]);
  }

  const ledgerRows: (string | number)[][] = [];
  let previousKey: string | null = null;

  for (const e of ordered) {
    const key = dayKey(e);
    const isFirstOfDay = key !== previousKey;
    previousKey = key;

    const dateLabel =
      key === 'pretrip' ? 'Pretrip' : isFirstOfDay ? formatDayLabel(e.local_date) : '';

    ledgerRows.push([
      dateLabel,
      e.category,
      e.description,
      round2(e.amount),
      e.currency,
      round2(e.amount_nzd),
      e.shopback_type ?? '',
      e.shopback_value != null ? round2(e.shopback_value) : '',
      e.shopback_amount != null ? round2(e.shopback_amount) : '',
      e.shopback_amount_nzd != null ? round2(e.shopback_amount_nzd) : '',
      e.shopback_status ?? '',
      round2(netExpenseNzd(e)),
      isFirstOfDay ? round2(dayTotals.get(key) ?? 0) : '',
    ]);
  }

  const emptyLedger = ['', '', '', '', '', '', '', '', '', '', '', '', ''];
  const rowCount = Math.max(ledgerRows.length, sidePanel.length);
  const sheetRows: (string | number)[][] = [];
  for (let i = 0; i < rowCount; i++) {
    const ledger = ledgerRows[i] ?? emptyLedger;
    const side = sidePanel[i] ?? ['', ''];
    sheetRows.push([...ledger, side[0], side[1]]);
  }

  const csvHeaders = [
    'Date',
    'Category',
    'Description',
    'Amount',
    'Currency',
    'NZD Equivalent',
    'Cashback Type',
    'Cashback Value',
    'Cashback Amount',
    'Cashback NZD',
    'Cashback Status',
    'Net NZD',
    'Day Total',
  ];
  const csv = [
    csvHeaders.join(','),
    ...ledgerRows.map((r) => r.map(csvEscape).join(',')),
  ].join('\n');

  const financesSheet: Sheet = {
    name: 'finances',
    columns: [
      { header: 'Date', width: 10 },
      { header: 'Category', width: 14 },
      { header: 'Description', width: 36 },
      { header: 'Amount', width: 12, format: 'money' },
      { header: 'Currency', width: 10 },
      { header: 'NZD Equivalent', width: 14, format: 'money' },
      { header: 'Cashback Type', width: 12 },
      { header: 'Cashback Value', width: 12, format: 'money' },
      { header: 'Cashback Amount', width: 14, format: 'money' },
      { header: 'Cashback NZD', width: 12, format: 'money' },
      { header: 'Cashback Status', width: 12 },
      { header: 'Net NZD', width: 12, format: 'money' },
      { header: 'Day Total', width: 12, format: 'money' },
      { header: 'Currency Conversion (1 unit equals NZD)', width: 42 },
      { header: '', width: 14, format: 'money' },
    ],
    rows: sheetRows,
  };

  return {
    csv,
    xlsx: buildXlsx([financesSheet]),
    baseName: `${trip.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-finances`,
    rowCount: ordered.length,
  };
}
