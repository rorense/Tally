export const CATEGORIES = [
  'Transport',
  'Accommodation',
  'Activity',
  'Food',
  'Souvenir',
  'Material',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** Columns every synced table carries. `dirty` is local-only and never sent up. */
export interface SyncColumns {
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
}

/**
 * A single-country trip keeps one implicit leg spanning the whole trip, so the
 * itinerary editor stays hidden and every expense already knows its country.
 */
export type TripType = 'single' | 'multi';

export interface Trip extends SyncColumns {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  total_budget_nzd: number;
  join_code: string;
  trip_type: TripType;
}

export interface TripLeg extends SyncColumns {
  id: string;
  trip_id: string;
  country_code: string;
  currency_code: string;
  start_date: string;
  end_date: string;
}

export interface TripMember extends SyncColumns {
  id: string;
  trip_id: string;
  user_id: string;
  display_name: string;
}

export interface CategoryBudget extends SyncColumns {
  id: string;
  trip_id: string;
  category: Category;
  budget_nzd: number;
}

/**
 * How cashback is calculated on an expense. `card` is a percentage too, but
 * from the credit card's own rate rather than a per-purchase offer, so it
 * defaults to the rate in Settings instead of being typed in each time.
 *
 * `card` is now only ever read out of `shopback_type`, never written there.
 * Builds from before a purchase could claim both schemes stored the card claim
 * in the `shopback_*` columns, and rows in that shape still arrive from a
 * partner phone that has not updated yet.
 */
export type CashbackType = 'flat' | 'percent' | 'card';

/**
 * Which scheme pays a claim. One purchase can earn from both at once — going
 * through ShopBack to reach the merchant and then tapping the card at the till
 * — so the two are stored side by side rather than as one exclusive choice.
 */
export type CashbackSource = 'card' | 'shopback';

/**
 * Lifecycle of a cashback claim. ShopBack offers start `pending` until you
 * verify the rebate landed; card cashback starts `confirmed` because it posts
 * to the statement on its own. `cancelled` covers declined or expired offers.
 */
export type CashbackStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Expense extends SyncColumns {
  id: string;
  trip_id: string;
  leg_id: string | null;
  country_code: string;
  category: Category;
  description: string;
  amount: number;
  currency: string;
  rate_to_nzd: number;
  amount_nzd: number;
  spent_at: string;
  /**
   * The calendar date in the timezone the purchase happened in. Charts group by
   * this rather than `spent_at`, so an evening meal in Europe does not land on
   * the next day once converted to UTC or NZ time.
   *
   * Ignored for display/grouping when `is_pretrip` is set (flights/hotels
   * bought before the trip window).
   */
  local_date: string;
  /**
   * 1 when the purchase was made before travel (e.g. flights, accommodation).
   * Pretrip spend still counts toward the trip budget but is not attributed
   * to a trip day.
   */
  is_pretrip: number;
  paid_by: string | null;
  /**
   * Null when the purchase earns no cashback.
   *
   * The `shopback_` column prefix predates card cashback and stays as-is: the
   * name is shared with Postgres and with whatever build the other phone is
   * running, so renaming it mid-trip would need a migration on both sides for
   * no behavioural gain.
   */
  shopback_type: CashbackType | null;
  /** Flat amount in the expense currency, or a percentage (e.g. 5 for 5%). */
  shopback_value: number | null;
  /** Cashback in the expense currency, derived from type + value. */
  shopback_amount: number | null;
  shopback_amount_nzd: number | null;
  shopback_status: CashbackStatus | null;
  shopback_confirmed_at: string | null;
  /**
   * The credit card's own cashback, kept in its own columns so one purchase can
   * earn from the card and from ShopBack at the same time. Always a percentage
   * of the spend, so there is no `card_type` to match `shopback_type`.
   */
  card_value: number | null;
  card_amount: number | null;
  card_amount_nzd: number | null;
  card_status: CashbackStatus | null;
  card_confirmed_at: string | null;
  /**
   * The card's currency conversion fee on this purchase, as a percentage, or
   * null when none was charged — cash, NZD spend, or a fee-free card.
   *
   * The fee is already inside `amount_nzd`; the rate is kept so it can be shown
   * on its own, and so reopening the expense restores the tick rather than
   * quietly dropping the fee on the next save.
   *
   * Cashback is deliberately unaffected. Both schemes pay on the pre-fee spend,
   * and the cashback columns are worked out from `amount` at the mid-market
   * `rate_to_nzd`, so a fee can never inflate a rebate.
   */
  fx_fee_pct: number | null;
}

export interface FxRate {
  currency: string;
  rate_to_nzd: number;
  fetched_at: string;
}

export interface Country {
  country_code: string;
  name: string;
  currency_code: string;
}
