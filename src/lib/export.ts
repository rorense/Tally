import type { SQLiteDatabase } from 'expo-sqlite';
import { listCategoryBudgets, listExpenses } from '../db/repository';
import { CATEGORIES, type Expense, type Trip } from '../db/types';
import { csvEscape } from './csv';
import { fxFeeNzd, round2 } from './money';
import { cashbackClaims, confirmedCashbackNzd, netExpenseNzd } from './cashback';
import { isPretrip } from './pretrip';
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

  const pretrip = (e: Expense) => isPretrip(e, trip.start_date);

  // Oldest first reads better in a spreadsheet than the newest-first app list.
  // Pretrip rows sort before dated spend so the ledger matches the workbook.
  // Grouped on the same test the ledger labels with, so the block stays
  // contiguous rather than relying on dated-before-start rows happening to
  // sort next to flagged ones.
  const ordered = [...expenses].sort((a, b) => {
    if (pretrip(a) !== pretrip(b)) return pretrip(a) ? -1 : 1;
    const byDate = a.local_date.localeCompare(b.local_date);
    if (byDate !== 0) return byDate;
    return a.spent_at.localeCompare(b.spent_at);
  });

  const dayKey = (e: Expense) => (pretrip(e) ? 'pretrip' : e.local_date);

  const dayTotals = new Map<string, number>();
  for (const e of ordered) {
    const key = dayKey(e);
    dayTotals.set(key, (dayTotals.get(key) ?? 0) + netExpenseNzd(e));
  }

  /**
   * Only rows that recorded a fee. One logged before the fee was tracked has it
   * baked into `amount_nzd` with nothing to say so, and reporting the gap from
   * the mid-market rate as a fee would be a guess dressed up as a figure.
   */
  const feeNzd = (e: Expense) =>
    e.fx_fee_pct != null ? fxFeeNzd(e.amount_nzd, e.amount, e.rate_to_nzd) : null;

  const total = round2(ordered.reduce((sum, e) => sum + netExpenseNzd(e), 0));
  const conversionFees = round2(ordered.reduce((sum, e) => sum + (feeNzd(e) ?? 0), 0));
  const cashbackConfirmed = round2(
    ordered.reduce((sum, e) => sum + confirmedCashbackNzd(e), 0)
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
  if (conversionFees > 0) {
    sidePanel.push(['Conversion fees', conversionFees]);
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

    // Split by scheme rather than by column, so a purchase that claimed both
    // exports both, and one whose card claim still sits in the shopback_*
    // columns exports under Card where it belongs.
    const claims = cashbackClaims(e);
    const shopback = claims.find((c) => c.source === 'shopback');
    const card = claims.find((c) => c.source === 'card');

    ledgerRows.push([
      dateLabel,
      e.category,
      e.description,
      round2(e.amount),
      e.currency,
      round2(e.amount_nzd),
      feeNzd(e) ?? '',
      shopback?.type ?? '',
      shopback?.value != null ? round2(shopback.value) : '',
      shopback?.amount != null ? round2(shopback.amount) : '',
      shopback ? round2(shopback.amount_nzd) : '',
      shopback?.status ?? '',
      card?.value != null ? round2(card.value) : '',
      card ? round2(card.amount_nzd) : '',
      card?.status ?? '',
      round2(netExpenseNzd(e)),
      isFirstOfDay ? round2(dayTotals.get(key) ?? 0) : '',
    ]);
  }

  const emptyLedger = Array<string>(17).fill('');
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
    'Conversion Fee NZD',
    'ShopBack Type',
    'ShopBack Value',
    'ShopBack Amount',
    'ShopBack NZD',
    'ShopBack Status',
    'Card %',
    'Card NZD',
    'Card Status',
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
      { header: 'Conversion Fee NZD', width: 16, format: 'money' },
      { header: 'ShopBack Type', width: 12 },
      { header: 'ShopBack Value', width: 12, format: 'money' },
      { header: 'ShopBack Amount', width: 14, format: 'money' },
      { header: 'ShopBack NZD', width: 12, format: 'money' },
      { header: 'ShopBack Status', width: 12 },
      { header: 'Card %', width: 10 },
      { header: 'Card NZD', width: 12, format: 'money' },
      { header: 'Card Status', width: 12 },
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
