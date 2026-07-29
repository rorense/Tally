import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { nowIso } from '../lib/dates';
import type {
  Category,
  CategoryBudget,
  Country,
  Expense,
  FxRate,
  ShopbackStatus,
  Trip,
  TripLeg,
  TripMember,
  TripType,
} from './types';

export function newId(): string {
  return Crypto.randomUUID();
}

/**
 * Trip join codes are typed in by hand, so the alphabet omits characters that
 * are easy to confuse (0/O, 1/I).
 */
export function generateJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = Crypto.getRandomBytes(8);
  for (let i = 0; i < 8; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3) out += '-';
  }
  return out;
}

/** Every local write goes through here so `updated_at` and `dirty` are never forgotten. */
function touch() {
  return { updated_at: nowIso(), dirty: 1 };
}

// ---------------------------------------------------------------- trips

export async function listTrips(db: SQLiteDatabase): Promise<Trip[]> {
  return db.getAllAsync<Trip>(
    'SELECT * FROM trips WHERE deleted_at IS NULL ORDER BY start_date DESC'
  );
}

export async function getTrip(db: SQLiteDatabase, id: string): Promise<Trip | null> {
  return db.getFirstAsync<Trip>('SELECT * FROM trips WHERE id = ? AND deleted_at IS NULL', id);
}

export interface TripInput {
  name: string;
  start_date: string;
  end_date: string;
  total_budget_nzd: number;
  trip_type: TripType;
}

export async function createTrip(db: SQLiteDatabase, input: TripInput): Promise<Trip> {
  const t = touch();
  const trip: Trip = {
    id: newId(),
    join_code: generateJoinCode(),
    deleted_at: null,
    ...input,
    ...t,
  };
  await db.runAsync(
    `INSERT INTO trips (id, name, start_date, end_date, total_budget_nzd, join_code, trip_type, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
    trip.id,
    trip.name,
    trip.start_date,
    trip.end_date,
    trip.total_budget_nzd,
    trip.join_code,
    trip.trip_type,
    trip.updated_at
  );
  return trip;
}

export async function updateTrip(db: SQLiteDatabase, id: string, input: TripInput) {
  const t = touch();
  await db.runAsync(
    `UPDATE trips SET name = ?, start_date = ?, end_date = ?, total_budget_nzd = ?,
     trip_type = ?, updated_at = ?, dirty = 1 WHERE id = ?`,
    input.name,
    input.start_date,
    input.end_date,
    input.total_budget_nzd,
    input.trip_type,
    t.updated_at,
    id
  );
}

/**
 * Keeps a single-country trip's one leg in sync with the trip dates and chosen
 * country, so expenses always resolve a leg no matter when they are logged.
 */
export async function syncSingleCountryLeg(
  db: SQLiteDatabase,
  tripId: string,
  country: { country_code: string; currency_code: string },
  startDate: string,
  endDate: string
) {
  const existing = await listLegs(db, tripId);
  const [keep, ...extras] = existing;

  await upsertLeg(db, {
    id: keep?.id,
    trip_id: tripId,
    country_code: country.country_code,
    currency_code: country.currency_code,
    start_date: startDate,
    end_date: endDate,
  });

  // Switching a multi-country trip to single-country leaves stale legs behind.
  for (const extra of extras) await deleteLeg(db, extra.id);
}

/**
 * Soft delete. The row stays so the sync engine can propagate the deletion to
 * the other device; a hard delete would simply reappear on the next pull.
 */
export async function deleteTrip(db: SQLiteDatabase, id: string) {
  const t = touch();
  await db.withTransactionAsync(async () => {
    // Membership is deliberately left intact. RLS scopes every other table
    // through trip_members, so revoking your own membership here would lock the
    // sync engine out of pushing the very deletion it is trying to send.
    for (const table of ['expenses', 'trip_legs', 'category_budgets']) {
      await db.runAsync(
        `UPDATE ${table} SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE trip_id = ?`,
        t.updated_at,
        t.updated_at,
        id
      );
    }
    await db.runAsync(
      'UPDATE trips SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
      t.updated_at,
      t.updated_at,
      id
    );
  });
}

// ---------------------------------------------------------------- legs

export async function listLegs(db: SQLiteDatabase, tripId: string): Promise<TripLeg[]> {
  return db.getAllAsync<TripLeg>(
    'SELECT * FROM trip_legs WHERE trip_id = ? AND deleted_at IS NULL ORDER BY start_date',
    tripId
  );
}

/**
 * The leg whose date range contains `date`. This is what lets the add-expense
 * screen pre-fill country and currency without asking.
 */
export async function findLegForDate(
  db: SQLiteDatabase,
  tripId: string,
  date: string
): Promise<TripLeg | null> {
  return db.getFirstAsync<TripLeg>(
    `SELECT * FROM trip_legs WHERE trip_id = ? AND deleted_at IS NULL
     AND start_date <= ? AND end_date >= ? ORDER BY start_date LIMIT 1`,
    tripId,
    date,
    date
  );
}

export async function upsertLeg(
  db: SQLiteDatabase,
  leg: {
    id?: string;
    trip_id: string;
    country_code: string;
    currency_code: string;
    start_date: string;
    end_date: string;
  }
) {
  const t = touch();
  const id = leg.id ?? newId();
  await db.runAsync(
    `INSERT INTO trip_legs (id, trip_id, country_code, currency_code, start_date, end_date, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET country_code = excluded.country_code,
       currency_code = excluded.currency_code, start_date = excluded.start_date,
       end_date = excluded.end_date, updated_at = excluded.updated_at, dirty = 1`,
    id,
    leg.trip_id,
    leg.country_code,
    leg.currency_code,
    leg.start_date,
    leg.end_date,
    t.updated_at
  );
  return id;
}

export async function deleteLeg(db: SQLiteDatabase, id: string) {
  const t = touch();
  await db.runAsync(
    'UPDATE trip_legs SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
    t.updated_at,
    t.updated_at,
    id
  );
}

// ---------------------------------------------------------------- budgets

export async function listCategoryBudgets(
  db: SQLiteDatabase,
  tripId: string
): Promise<CategoryBudget[]> {
  return db.getAllAsync<CategoryBudget>(
    'SELECT * FROM category_budgets WHERE trip_id = ? AND deleted_at IS NULL',
    tripId
  );
}

export async function setCategoryBudget(
  db: SQLiteDatabase,
  tripId: string,
  category: Category,
  amount: number
) {
  const t = touch();
  const existing = await db.getFirstAsync<CategoryBudget>(
    'SELECT * FROM category_budgets WHERE trip_id = ? AND category = ?',
    tripId,
    category
  );
  if (existing) {
    await db.runAsync(
      `UPDATE category_budgets SET budget_nzd = ?, deleted_at = NULL, updated_at = ?, dirty = 1
       WHERE id = ?`,
      amount,
      t.updated_at,
      existing.id
    );
    return existing.id;
  }
  const id = newId();
  await db.runAsync(
    `INSERT INTO category_budgets (id, trip_id, category, budget_nzd, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, NULL, 1)`,
    id,
    tripId,
    category,
    amount,
    t.updated_at
  );
  return id;
}

// ---------------------------------------------------------------- members

export async function listMembers(db: SQLiteDatabase, tripId: string): Promise<TripMember[]> {
  return db.getAllAsync<TripMember>(
    'SELECT * FROM trip_members WHERE trip_id = ? AND deleted_at IS NULL ORDER BY display_name',
    tripId
  );
}

export async function upsertMember(
  db: SQLiteDatabase,
  member: { id?: string; trip_id: string; user_id: string; display_name: string }
) {
  const t = touch();
  const existing = await db.getFirstAsync<TripMember>(
    'SELECT * FROM trip_members WHERE trip_id = ? AND user_id = ?',
    member.trip_id,
    member.user_id
  );
  if (existing) {
    await db.runAsync(
      `UPDATE trip_members SET display_name = ?, deleted_at = NULL, updated_at = ?, dirty = 1
       WHERE id = ?`,
      member.display_name,
      t.updated_at,
      existing.id
    );
    return existing.id;
  }
  const id = member.id ?? newId();
  await db.runAsync(
    `INSERT INTO trip_members (id, trip_id, user_id, display_name, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, NULL, 1)`,
    id,
    member.trip_id,
    member.user_id,
    member.display_name,
    t.updated_at
  );
  return id;
}

// ---------------------------------------------------------------- expenses

export interface ExpenseFilter {
  category?: Category | null;
  countryCode?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
}

export async function listExpenses(
  db: SQLiteDatabase,
  tripId: string,
  filter: ExpenseFilter = {}
): Promise<Expense[]> {
  const where: string[] = ['trip_id = ?', 'deleted_at IS NULL'];
  const params: (string | number)[] = [tripId];

  if (filter.category) {
    where.push('category = ?');
    params.push(filter.category);
  }
  if (filter.countryCode) {
    where.push('country_code = ?');
    params.push(filter.countryCode);
  }
  if (filter.from) {
    where.push('local_date >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('local_date <= ?');
    params.push(filter.to);
  }
  if (filter.search) {
    where.push('LOWER(description) LIKE ?');
    params.push(`%${filter.search.toLowerCase()}%`);
  }

  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses WHERE ${where.join(' AND ')} ORDER BY local_date DESC, spent_at DESC`,
    params
  );
}

export async function getExpense(db: SQLiteDatabase, id: string): Promise<Expense | null> {
  return db.getFirstAsync<Expense>(
    'SELECT * FROM expenses WHERE id = ? AND deleted_at IS NULL',
    id
  );
}

/** Most recently logged expense on a trip. Used to sticky-default country on the next entry. */
export async function getLatestExpense(
  db: SQLiteDatabase,
  tripId: string
): Promise<Expense | null> {
  return db.getFirstAsync<Expense>(
    `SELECT * FROM expenses WHERE trip_id = ? AND deleted_at IS NULL
     ORDER BY local_date DESC, spent_at DESC LIMIT 1`,
    tripId
  );
}

export type ExpenseInput = Omit<Expense, keyof import('./types').SyncColumns | 'id'>;

export async function createExpense(db: SQLiteDatabase, input: ExpenseInput): Promise<string> {
  const t = touch();
  const id = newId();
  await db.runAsync(
    `INSERT INTO expenses (id, trip_id, leg_id, country_code, category, description, amount,
      currency, rate_to_nzd, amount_nzd, spent_at, local_date, is_pretrip, paid_by,
      shopback_type, shopback_value, shopback_amount, shopback_amount_nzd, shopback_status,
      shopback_confirmed_at, updated_at, deleted_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1)`,
    id,
    input.trip_id,
    input.leg_id,
    input.country_code,
    input.category,
    input.description,
    input.amount,
    input.currency,
    input.rate_to_nzd,
    input.amount_nzd,
    input.spent_at,
    input.local_date,
    input.is_pretrip,
    input.paid_by,
    input.shopback_type,
    input.shopback_value,
    input.shopback_amount,
    input.shopback_amount_nzd,
    input.shopback_status,
    input.shopback_confirmed_at,
    t.updated_at
  );
  return id;
}

export async function updateExpense(db: SQLiteDatabase, id: string, input: ExpenseInput) {
  const t = touch();
  await db.runAsync(
    `UPDATE expenses SET trip_id = ?, leg_id = ?, country_code = ?, category = ?, description = ?,
      amount = ?, currency = ?, rate_to_nzd = ?, amount_nzd = ?, spent_at = ?, local_date = ?,
      is_pretrip = ?, paid_by = ?, shopback_type = ?, shopback_value = ?, shopback_amount = ?,
      shopback_amount_nzd = ?, shopback_status = ?, shopback_confirmed_at = ?,
      updated_at = ?, dirty = 1 WHERE id = ?`,
    input.trip_id,
    input.leg_id,
    input.country_code,
    input.category,
    input.description,
    input.amount,
    input.currency,
    input.rate_to_nzd,
    input.amount_nzd,
    input.spent_at,
    input.local_date,
    input.is_pretrip,
    input.paid_by,
    input.shopback_type,
    input.shopback_value,
    input.shopback_amount,
    input.shopback_amount_nzd,
    input.shopback_status,
    input.shopback_confirmed_at,
    t.updated_at,
    id
  );
}

/** Confirm, cancel, or reopen a ShopBack claim without rewriting the expense. */
export async function updateShopbackStatus(
  db: SQLiteDatabase,
  id: string,
  status: ShopbackStatus
) {
  const t = touch();
  const confirmedAt = status === 'confirmed' ? t.updated_at : null;
  await db.runAsync(
    `UPDATE expenses SET shopback_status = ?, shopback_confirmed_at = ?,
      updated_at = ?, dirty = 1 WHERE id = ?`,
    status,
    confirmedAt,
    t.updated_at,
    id
  );
}

export async function listShopbackExpenses(
  db: SQLiteDatabase,
  tripId: string,
  status: ShopbackStatus | null = null
): Promise<Expense[]> {
  const where = [
    'trip_id = ?',
    'deleted_at IS NULL',
    'shopback_type IS NOT NULL',
    'shopback_amount_nzd IS NOT NULL',
  ];
  const params: (string | number)[] = [tripId];
  if (status) {
    where.push('shopback_status = ?');
    params.push(status);
  }
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses WHERE ${where.join(' AND ')}
     ORDER BY CASE shopback_status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
       local_date DESC, spent_at DESC`,
    params
  );
}

export interface ShopbackSummary {
  pending_nzd: number;
  confirmed_nzd: number;
  cancelled_nzd: number;
  pending_count: number;
  confirmed_count: number;
  cancelled_count: number;
}

export async function shopbackSummary(
  db: SQLiteDatabase,
  tripId: string
): Promise<ShopbackSummary> {
  const rows = await db.getAllAsync<{
    shopback_status: string;
    total: number;
    count: number;
  }>(
    `SELECT shopback_status, SUM(shopback_amount_nzd) AS total, COUNT(*) AS count
     FROM expenses
     WHERE trip_id = ? AND deleted_at IS NULL AND shopback_type IS NOT NULL
     GROUP BY shopback_status`,
    tripId
  );

  const summary: ShopbackSummary = {
    pending_nzd: 0,
    confirmed_nzd: 0,
    cancelled_nzd: 0,
    pending_count: 0,
    confirmed_count: 0,
    cancelled_count: 0,
  };

  for (const row of rows) {
    if (row.shopback_status === 'pending') {
      summary.pending_nzd = row.total ?? 0;
      summary.pending_count = row.count;
    } else if (row.shopback_status === 'confirmed') {
      summary.confirmed_nzd = row.total ?? 0;
      summary.confirmed_count = row.count;
    } else if (row.shopback_status === 'cancelled') {
      summary.cancelled_nzd = row.total ?? 0;
      summary.cancelled_count = row.count;
    }
  }
  return summary;
}

export async function shopbackByCategory(
  db: SQLiteDatabase,
  tripId: string
): Promise<{ category: Category; total: number }[]> {
  return db.getAllAsync(
    `SELECT category, SUM(shopback_amount_nzd) AS total FROM expenses
     WHERE trip_id = ? AND deleted_at IS NULL AND shopback_status = 'confirmed'
     GROUP BY category ORDER BY total DESC`,
    tripId
  );
}

export async function deleteExpense(db: SQLiteDatabase, id: string) {
  const t = touch();
  await db.runAsync(
    'UPDATE expenses SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ?',
    t.updated_at,
    t.updated_at,
    id
  );
}

// ---------------------------------------------------------------- aggregates

/** Confirmed ShopBack reduces effective spend; pending/cancelled do not. */
const NET_NZD = `amount_nzd - CASE
  WHEN shopback_status = 'confirmed' THEN COALESCE(shopback_amount_nzd, 0)
  ELSE 0
END`;

export async function totalSpentNzd(db: SQLiteDatabase, tripId: string): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(${NET_NZD}) AS total FROM expenses WHERE trip_id = ? AND deleted_at IS NULL`,
    tripId
  );
  return row?.total ?? 0;
}

export async function spentByCategory(
  db: SQLiteDatabase,
  tripId: string
): Promise<{ category: Category; total: number }[]> {
  return db.getAllAsync(
    `SELECT category, SUM(${NET_NZD}) AS total FROM expenses
     WHERE trip_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY total DESC`,
    tripId
  );
}

export async function spentByCountry(
  db: SQLiteDatabase,
  tripId: string
): Promise<{ country_code: string; total: number }[]> {
  return db.getAllAsync(
    `SELECT country_code, SUM(${NET_NZD}) AS total FROM expenses
     WHERE trip_id = ? AND deleted_at IS NULL GROUP BY country_code ORDER BY total DESC`,
    tripId
  );
}

export async function spentByDay(
  db: SQLiteDatabase,
  tripId: string
): Promise<{ local_date: string; total: number }[]> {
  return db.getAllAsync(
    `SELECT local_date, SUM(${NET_NZD}) AS total FROM expenses
     WHERE trip_id = ? AND deleted_at IS NULL AND is_pretrip = 0
     GROUP BY local_date ORDER BY local_date`,
    tripId
  );
}

export async function spentOnDay(
  db: SQLiteDatabase,
  tripId: string,
  date: string
): Promise<number> {
  const row = await db.getFirstAsync<{ total: number | null }>(
    `SELECT SUM(${NET_NZD}) AS total FROM expenses
     WHERE trip_id = ? AND local_date = ? AND is_pretrip = 0 AND deleted_at IS NULL`,
    tripId,
    date
  );
  return row?.total ?? 0;
}

// ---------------------------------------------------------------- reference data

export async function listCountries(db: SQLiteDatabase): Promise<Country[]> {
  return db.getAllAsync<Country>('SELECT * FROM countries ORDER BY name');
}

export async function getCountry(
  db: SQLiteDatabase,
  code: string
): Promise<Country | null> {
  return db.getFirstAsync<Country>('SELECT * FROM countries WHERE country_code = ?', code);
}

export async function upsertCountry(db: SQLiteDatabase, c: Country) {
  await db.runAsync(
    `INSERT INTO countries (country_code, name, currency_code) VALUES (?, ?, ?)
     ON CONFLICT(country_code) DO UPDATE SET name = excluded.name,
       currency_code = excluded.currency_code`,
    c.country_code,
    c.name,
    c.currency_code
  );
}

export async function listFxRates(db: SQLiteDatabase): Promise<FxRate[]> {
  return db.getAllAsync<FxRate>('SELECT * FROM fx_rates ORDER BY currency');
}

export async function getFxRate(db: SQLiteDatabase, currency: string): Promise<FxRate | null> {
  return db.getFirstAsync<FxRate>('SELECT * FROM fx_rates WHERE currency = ?', currency);
}

export async function saveFxRates(db: SQLiteDatabase, rates: Record<string, number>) {
  const fetchedAt = nowIso();
  await db.withTransactionAsync(async () => {
    for (const [currency, rate] of Object.entries(rates)) {
      await db.runAsync(
        `INSERT INTO fx_rates (currency, rate_to_nzd, fetched_at) VALUES (?, ?, ?)
         ON CONFLICT(currency) DO UPDATE SET rate_to_nzd = excluded.rate_to_nzd,
           fetched_at = excluded.fetched_at`,
        currency,
        rate,
        fetchedAt
      );
    }
  });
}

// ---------------------------------------------------------------- key/value

export async function getSetting(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM settings WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}

export async function getSyncState(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string | null }>(
    'SELECT value FROM sync_state WHERE key = ?',
    key
  );
  return row?.value ?? null;
}

export async function setSyncState(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value
  );
}
