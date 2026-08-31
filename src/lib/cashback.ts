import type {
  CashbackSource,
  CashbackStatus,
  CashbackType,
  Expense,
} from '../db/types';
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

/** The cashback columns, so partial rows work as well as whole expenses. */
export type CashbackRow = Pick<
  Expense,
  | 'shopback_type'
  | 'shopback_value'
  | 'shopback_amount'
  | 'shopback_amount_nzd'
  | 'shopback_status'
  | 'shopback_confirmed_at'
  | 'card_value'
  | 'card_amount'
  | 'card_amount_nzd'
  | 'card_status'
  | 'card_confirmed_at'
>;

/** One scheme's claim on one purchase, flattened out of the two column sets. */
export interface CashbackClaim {
  source: CashbackSource;
  /** How the amount was worked out, for the `5%` / `€4.50` label. */
  type: CashbackType;
  value: number | null;
  amount: number | null;
  amount_nzd: number;
  status: CashbackStatus;
  confirmed_at: string | null;
}

/**
 * Every claim on a purchase, at most one per scheme.
 *
 * Reads both the current shape and the old one, where a card claim was written
 * into the `shopback_*` columns with `shopback_type = 'card'`. That shape is
 * not just history: a partner phone on an older build still writes it, and the
 * migration deliberately leaves the server's copy of pre-existing rows alone,
 * so it keeps arriving. Either way it comes back out as a card claim.
 */
export function cashbackClaims(e: CashbackRow): CashbackClaim[] {
  const claims: CashbackClaim[] = [];

  if (e.shopback_type === 'flat' || e.shopback_type === 'percent') {
    claims.push({
      source: 'shopback',
      type: e.shopback_type,
      value: e.shopback_value,
      amount: e.shopback_amount,
      amount_nzd: e.shopback_amount_nzd ?? 0,
      status: e.shopback_status ?? 'pending',
      confirmed_at: e.shopback_confirmed_at,
    });
  }

  if (e.card_value != null || e.card_amount_nzd != null) {
    claims.push({
      source: 'card',
      type: 'card',
      value: e.card_value,
      amount: e.card_amount,
      amount_nzd: e.card_amount_nzd ?? 0,
      status: e.card_status ?? 'confirmed',
      confirmed_at: e.card_confirmed_at,
    });
  } else if (e.shopback_type === 'card') {
    claims.push({
      source: 'card',
      type: 'card',
      value: e.shopback_value,
      amount: e.shopback_amount,
      amount_nzd: e.shopback_amount_nzd ?? 0,
      status: e.shopback_status ?? 'confirmed',
      confirmed_at: e.shopback_confirmed_at,
    });
  }

  return claims;
}

/** Confirmed cashback already earned; pending/cancelled do not reduce spend. */
export function confirmedCashbackNzd(e: CashbackRow): number {
  return round2(
    cashbackClaims(e)
      .filter((c) => c.status === 'confirmed')
      .reduce((sum, c) => sum + c.amount_nzd, 0)
  );
}

/** True trip cost of one expense after confirmed cashback from every scheme. */
export function netExpenseNzd(expense: CashbackRow & Pick<Expense, 'amount_nzd'>): number {
  return round2(expense.amount_nzd - confirmedCashbackNzd(expense));
}

/**
 * Card cashback posts to the statement whether or not you chase it, so it is
 * confirmed from the moment it is logged. ShopBack offers have to be verified
 * in the app, so they start pending.
 */
export function initialCashbackStatus(source: CashbackSource): CashbackStatus {
  return source === 'card' ? 'confirmed' : 'pending';
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
export function cashbackSourceLabel(source: CashbackSource): string {
  return source === 'card' ? 'Card' : 'ShopBack';
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
