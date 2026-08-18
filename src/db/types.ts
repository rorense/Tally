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
 */
export type CashbackType = 'flat' | 'percent' | 'card';

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
