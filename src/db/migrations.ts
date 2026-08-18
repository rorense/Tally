import type { SQLiteDatabase } from 'expo-sqlite';
import { COUNTRY_SEED } from './countries';

const DATABASE_VERSION = 6;

interface Migration {
  /** The `user_version` the database carries once this step has committed. */
  to: number;
  up: (db: SQLiteDatabase) => Promise<void>;
}

/**
 * Ordered schema steps.
 *
 * Each one is applied inside its own transaction that also bumps
 * `user_version`, so a step either lands whole or not at all. That matters more
 * than it looks: SQLite rolls back DDL like everything else, so a migration
 * interrupted by a crash, a full disk, or the OS killing the app on launch
 * leaves the database exactly as it was, and the next launch retries that one
 * step. Bumping the version only after the last step would let a half-applied
 * schema be replayed from the start, where `CREATE TABLE trips` fails on the
 * table it just made and the app can never open its own database again.
 */
const MIGRATIONS: Migration[] = [
  {
    to: 1,
    up: async (db) => {
      await db.execAsync(`
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
    },
  },
  {
    to: 2,
    // Single-country trips hide the itinerary editor and keep one implicit leg
    // covering the whole trip. Existing trips predate the choice, so they are
    // treated as multi-country, which is the behaviour they already had.
    up: async (db) => {
      await db.execAsync(`ALTER TABLE trips ADD COLUMN trip_type TEXT NOT NULL DEFAULT 'multi'`);
    },
  },
  {
    to: 3,
    // Optional cashback per expense: flat amount or percentage, with a
    // pending → confirmed / cancelled verification flow.
    up: async (db) => {
      await db.execAsync(`
        ALTER TABLE expenses ADD COLUMN shopback_type TEXT;
        ALTER TABLE expenses ADD COLUMN shopback_value REAL;
        ALTER TABLE expenses ADD COLUMN shopback_amount REAL;
        ALTER TABLE expenses ADD COLUMN shopback_amount_nzd REAL;
        ALTER TABLE expenses ADD COLUMN shopback_status TEXT;
        ALTER TABLE expenses ADD COLUMN shopback_confirmed_at TEXT;
      `);
    },
  },
  {
    to: 4,
    // Cashback NZD must use the mid-market rate only (no card markup). Rewrite
    // any values that were saved while markup was incorrectly applied.
    up: async (db) => {
      await db.execAsync(`
        UPDATE expenses
        SET shopback_amount_nzd = ROUND(shopback_amount * rate_to_nzd, 2)
        WHERE shopback_amount IS NOT NULL
      `);
    },
  },
  {
    to: 5,
    // Flights/hotels bought before the trip: still count toward budget, but are
    // not pinned to a calendar day inside the trip window.
    up: async (db) => {
      await db.execAsync(
        `ALTER TABLE expenses ADD COLUMN is_preflight INTEGER NOT NULL DEFAULT 0`
      );
    },
  },
  {
    to: 6,
    // Renamed for the product language: pre-trip bookings, not "preflight".
    up: async (db) => {
      await db.execAsync(`ALTER TABLE expenses RENAME COLUMN is_preflight TO is_pretrip`);
    },
  },
];

/**
 * Runs on every app launch via SQLiteProvider's `onInit`. Uses the
 * `PRAGMA user_version` pattern so each migration applies exactly once.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  // WAL is a property of the database file rather than of the schema, and it
  // cannot be set from inside a transaction, so it is applied up front instead
  // of as a versioned step. Re-setting the mode it is already in is a no-op.
  await db.execAsync(`PRAGMA journal_mode = 'wal'`);

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= DATABASE_VERSION) return;

  for (const step of MIGRATIONS) {
    if (version >= step.to) continue;
    await db.withExclusiveTransactionAsync(async (txn) => {
      await step.up(txn);
      await txn.execAsync(`PRAGMA user_version = ${step.to}`);
    });
  }
}
