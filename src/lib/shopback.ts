import type { Expense, ShopbackStatus, ShopbackType } from '../db/types';
import { round2 } from './money';

/** Cashback in the expense currency from a flat amount or percentage. */
export function computeShopbackAmount(
  expenseAmount: number,
  type: ShopbackType,
  value: number
): number {
  if (type === 'flat') return round2(value);
  return round2((expenseAmount * value) / 100);
}

/**
 * Cashback to NZD at the expense's frozen mid-market rate. No card markup —
 * ShopBack is a rebate, not a card charge.
 */
export function computeShopbackNzd(shopbackAmount: number, rateToNzd: number): number {
  return round2(shopbackAmount * rateToNzd);
}

/** Confirmed ShopBack already in the account; pending/cancelled do not reduce spend. */
export function confirmedShopbackNzd(expense: Pick<Expense, 'shopback_status' | 'shopback_amount_nzd'>): number {
  if (expense.shopback_status !== 'confirmed') return 0;
  return expense.shopback_amount_nzd ?? 0;
}

/** True trip cost of one expense after confirmed cashback. */
export function netExpenseNzd(expense: Pick<Expense, 'amount_nzd' | 'shopback_status' | 'shopback_amount_nzd'>): number {
  return round2(expense.amount_nzd - confirmedShopbackNzd(expense));
}

export function shopbackStatusLabel(status: ShopbackStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'confirmed':
      return 'Confirmed';
    case 'cancelled':
      return 'Cancelled';
  }
}
