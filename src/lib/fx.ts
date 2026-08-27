import type { SQLiteDatabase } from 'expo-sqlite';
import { getFxRate, listFxRates, saveFxRates } from '../db/repository';
import type { FxRate } from '../db/types';

// The old api.frankfurter.app host now answers 301 and redirects here. Following
// it works, but a redirect is one more thing to fail on a bad hotel connection,
// so the current host is used directly.
const FRANKFURTER = 'https://api.frankfurter.dev/v1/latest?base=NZD';
const ER_API = 'https://open.er-api.com/v6/latest/NZD';
const TIMEOUT_MS = 12_000;

/**
 * Both upstreams quote "1 NZD buys X units of the foreign currency". The app
 * stores the inverse (how many NZD one unit of foreign currency costs), because
 * that is the direction every conversion in the UI runs.
 */
function invert(rates: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { NZD: 1 };
  for (const [code, perNzd] of Object.entries(rates)) {
    if (typeof perNzd === 'number' && perNzd > 0) out[code] = 1 / perNzd;
  }
  return out;
}

/** Turns a thrown value into something short enough to show on the settings card. */
function describe(err: unknown): string {
  if (err instanceof Error) {
    return err.name === 'AbortError' ? `timed out after ${TIMEOUT_MS / 1000}s` : err.message;
  }
  return String(err);
}

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchRatesResult {
  rates: Record<string, number>;
  source: 'frankfurter' | 'er-api';
}

/**
 * Frankfurter (ECB) is the primary source but only publishes ~30 currencies, so
 * open.er-api.com fills in the rest. Their results are merged rather than one
 * replacing the other, with ECB winning where both have a value.
 *
 * When neither responds the thrown message names both reasons. Nothing else in
 * the app records why a refresh failed, and "it just doesn't update" is not a
 * fault anyone can act on from the other side of the world.
 */
export async function fetchRates(): Promise<FetchRatesResult> {
  const results: Record<string, number> = {};
  const failures: string[] = [];
  let source: FetchRatesResult['source'] = 'er-api';
  let sawAny = false;

  // Broad coverage first, so ECB values can overwrite on top.
  try {
    const data = await fetchJson(ER_API);
    if (data?.result === 'success' && data.rates) {
      Object.assign(results, invert(data.rates));
      sawAny = true;
    } else {
      failures.push('er-api: unexpected response');
    }
  } catch (err) {
    // Offline or upstream down. The cached rates in SQLite remain valid.
    failures.push(`er-api: ${describe(err)}`);
  }

  try {
    const data = await fetchJson(FRANKFURTER);
    if (data?.rates) {
      Object.assign(results, invert(data.rates));
      source = 'frankfurter';
      sawAny = true;
    } else {
      failures.push('frankfurter: unexpected response');
    }
  } catch (err) {
    // ECB unavailable; whatever er-api returned still stands.
    failures.push(`frankfurter: ${describe(err)}`);
  }

  if (!sawAny) throw new Error(failures.join(' \u00B7 ') || 'No rate source reachable');
  return { rates: results, source };
}

export interface RefreshResult {
  ok: boolean;
  /** Null on success. Shown verbatim on the settings card when it is not. */
  error: string | null;
}

/** Fetches and caches. Reports why it failed rather than throwing. */
export async function refreshRates(db: SQLiteDatabase): Promise<RefreshResult> {
  try {
    const { rates } = await fetchRates();
    await saveFxRates(db, rates);
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: describe(err) };
  }
}

export async function loadRateMap(db: SQLiteDatabase): Promise<Map<string, FxRate>> {
  const rows = await listFxRates(db);
  return new Map(rows.map((r) => [r.currency, r]));
}

export async function rateFor(db: SQLiteDatabase, currency: string): Promise<FxRate | null> {
  if (currency === 'NZD') {
    return { currency: 'NZD', rate_to_nzd: 1, fetched_at: new Date().toISOString() };
  }
  return getFxRate(db, currency);
}

/**
 * How stale a cached rate is, phrased for the UI. ECB publishes on weekdays
 * only, so a couple of days old over a weekend is normal rather than a fault.
 */
export function rateAgeLabel(fetchedAt: string | null | undefined): string | null {
  if (!fetchedAt) return null;
  const then = new Date(fetchedAt).getTime();
  if (Number.isNaN(then)) return null;

  const hours = (Date.now() - then) / 3_600_000;
  if (hours < 1) return 'just updated';
  if (hours < 24) return `${Math.floor(hours)}h old`;

  const days = Math.floor(hours / 24);
  return days === 1 ? 'from yesterday' : `${days} days old`;
}

/** Rates older than this get a visible warning next to the converted amount. */
export function isRateStale(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return true;
  const then = new Date(fetchedAt).getTime();
  if (Number.isNaN(then)) return true;
  return Date.now() - then > 4 * 24 * 3_600_000;
}
