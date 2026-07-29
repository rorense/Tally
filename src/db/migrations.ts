import type { SQLiteDatabase } from 'expo-sqlite';
import { COUNTRY_SEED } from './countries';

const DATABASE_VERSION = 5;

/**
 * Runs on every app launch via SQLiteProvider's `onInit`. Uses the
 * `PRAGMA user_version` pattern so each migration applies exactly once.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;

  if (version >= DATABASE_VERSION) return;

  if (version === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = 'wal';

      CREATE TABLE trips (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        total_budget_nzd REAL NOT NULL DEFAULT 0,
        join_code TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE trip_legs (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL,
        country_code TEXT NOT NULL,
        currency_code TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_legs_trip ON trip_legs (trip_id);

      CREATE TABLE trip_members (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX idx_members_unique ON trip_members (trip_id, user_id);

      CREATE TABLE category_budgets (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL,
        category TEXT NOT NULL,
        budget_nzd REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 1
      );
      CREATE UNIQUE INDEX idx_catbudget_unique ON category_budgets (trip_id, category);

      CREATE TABLE expenses (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL,
        leg_id TEXT,
        country_code TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        rate_to_nzd REAL NOT NULL,
        amount_nzd REAL NOT NULL,
        spent_at TEXT NOT NULL,
        local_date TEXT NOT NULL,
        paid_by TEXT,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        dirty INTEGER NOT NULL DEFAULT 1
      );
      CREATE INDEX idx_expenses_trip ON expenses (trip_id, local_date);

      -- Device-local caches. Never synced.
      CREATE TABLE fx_rates (
        currency TEXT PRIMARY KEY NOT NULL,
        rate_to_nzd REAL NOT NULL,
        fetched_at TEXT NOT NULL
      );

      CREATE TABLE countries (
        country_code TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        currency_code TEXT NOT NULL
      );

      CREATE TABLE sync_state (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT
      );
    `);

    const values = COUNTRY_SEED.map(() => '(?, ?, ?)').join(',');
    const params = COUNTRY_SEED.flatMap((c) => [c.code, c.name, c.currency]);
    await db.runAsync(
      `INSERT INTO countries (country_code, name, currency_code) VALUES ${values}`,
      params
    );

    version = 1;
  }

  if (version === 1) {
    // Single-country trips hide the itinerary editor and keep one implicit leg
    // covering the whole trip. Existing trips predate the choice, so they are
    // treated as multi-country, which is the behaviour they already had.
    await db.execAsync(
      `ALTER TABLE trips ADD COLUMN trip_type TEXT NOT NULL DEFAULT 'multi'`
    );
    version = 2;
  }

  if (version === 2) {
    // Optional ShopBack cashback per expense: flat amount or percentage, with a
    // pending → confirmed / cancelled verification flow.
    await db.execAsync(`
      ALTER TABLE expenses ADD COLUMN shopback_type TEXT;
      ALTER TABLE expenses ADD COLUMN shopback_value REAL;
      ALTER TABLE expenses ADD COLUMN shopback_amount REAL;
      ALTER TABLE expenses ADD COLUMN shopback_amount_nzd REAL;
      ALTER TABLE expenses ADD COLUMN shopback_status TEXT;
      ALTER TABLE expenses ADD COLUMN shopback_confirmed_at TEXT;
    `);
    version = 3;
  }

  if (version === 3) {
    // ShopBack NZD must use the mid-market rate only (no card markup). Rewrite
    // any values that were saved while markup was incorrectly applied.
    await db.execAsync(`
      UPDATE expenses
      SET shopback_amount_nzd = ROUND(shopback_amount * rate_to_nzd, 2)
      WHERE shopback_amount IS NOT NULL
    `);
    version = 4;
  }

  if (version === 4) {
    // Flights/hotels bought before the trip: still count toward budget, but are
    // not pinned to a calendar day inside the trip window.
    await db.execAsync(
      `ALTER TABLE expenses ADD COLUMN is_preflight INTEGER NOT NULL DEFAULT 0`
    );
    version = 5;
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
