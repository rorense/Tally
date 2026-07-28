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
   */
  local_date: string;
  paid_by: string | null;
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
