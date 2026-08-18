import type { Expense, CashbackStatus, CashbackType } from '../db/types';
// Explicit extension so Node's type stripping can load this module directly
// from cashback.test.ts; Metro resolves the exact path just the same.
import { formatMoney, round2 } from './money.ts';

/**
 * Cashback in the expense currency from a flat amount or a percentage. `card`
 * is a percentage of the spend, same as `percent` — only where the rate comes
 * from differs.
 */
export function computeCashbackAmount(
  expenseAmount: number,
  type: CashbackType,
  value: number
): number {
  if (type === 'flat') return round2(value);
  return round2((expenseAmount * value) / 100);
}

/**
 * Cashback to NZD at the expense's frozen mid-market rate. No card markup —
 * cashback is a rebate, not a card charge.
 */
export function computeCashbackNzd(cashbackAmount: number, rateToNzd: number): number {
  return round2(cashbackAmount * rateToNzd);
}

/** Confirmed cashback already earned; pending/cancelled do not reduce spend. */
export function confirmedCashbackNzd(expense: Pick<Expense, 'shopback_status' | 'shopback_amount_nzd'>): number {
  if (expense.shopback_status !== 'confirmed') return 0;
  return expense.shopback_amount_nzd ?? 0;
}

/** True trip cost of one expense after confirmed cashback. */
export function netExpenseNzd(expense: Pick<Expense, 'amount_nzd' | 'shopback_status' | 'shopback_amount_nzd'>): number {
  return round2(expense.amount_nzd - confirmedCashbackNzd(expense));
}

/**
 * Card cashback posts to the statement whether or not you chase it, so it is
 * confirmed from the moment it is logged. ShopBack offers have to be verified
 * in the app, so they start pending.
 */
export function initialCashbackStatus(type: CashbackType): CashbackStatus {
  return type === 'card' ? 'confirmed' : 'pending';
}

export function cashbackStatusLabel(status: CashbackStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Confirmed';
    case 'cancelled':
      return 'Cancelled';
  }
}

/** Where the cashback comes from, for rows that mix both schemes. */
export function cashbackSourceLabel(type: CashbackType): string {
  return type === 'card' ? 'Card' : 'ShopBack';
}

/** The rate or amount a claim was worked out from, e.g. `0.8%` or `€4.50`. */
export function cashbackValueLabel(
  type: CashbackType,
  value: number | null,
  currency: string
): string {
  if (type === 'flat') return formatMoney(value ?? 0, currency);
  return `${value ?? 0}%`;
}
