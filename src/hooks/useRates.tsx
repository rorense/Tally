import NetInfo from '@react-native-community/netinfo';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { FxRate } from '../db/types';
import { loadRateMap, refreshRates, type RefreshResult } from '../lib/fx';

interface RatesContextValue {
  rates: Map<string, FxRate>;
  rateFor: (currency: string) => FxRate | null;
  refreshing: boolean;
  /** Resolves with the outcome, so callers can report the reason without waiting for a re-render. */
  refresh: () => Promise<RefreshResult>;
  lastAttemptFailed: boolean;
  /** Why the last attempt failed, or null. Surfaced on the settings card. */
  lastError: string | null;
}

const RatesContext = createContext<RatesContextValue | null>(null);

/** Do not hammer the upstreams if the app is foregrounded repeatedly. */
const MIN_INTERVAL_MS = 30 * 60 * 1000;

/**
 * After a failure, retry far sooner. A half-hour lockout is right for throttling
 * successful fetches but wrong for a hotel wifi that comes good two minutes
 * later, which is most of what travelling looks like.
 */
const RETRY_INTERVAL_MS = 2 * 60 * 1000;

export function RatesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [rates, setRates] = useState<Map<string, FxRate>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [lastAttemptFailed, setLastAttemptFailed] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const lastAttempt = useRef(0);
  const failed = useRef(false);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    setRates(await loadRateMap(db));
  }, [db]);

  const refresh = useCallback(async () => {
    // Connectivity changes can arrive while a fetch is already running.
    if (inFlight.current) return { ok: !failed.current, error: null };
    inFlight.current = true;
    setRefreshing(true);
    try {
      const { ok, error } = await refreshRates(db);
      lastAttempt.current = Date.now();
      failed.current = !ok;
      setLastAttemptFailed(!ok);
      setLastError(error);
      if (ok) await reload();
      return { ok, error };
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [db, reload]);

  /**
   * Connectivity is no longer a precondition. NetInfo reports `null` before it
   * has settled and stays wrong behind captive portals, and using it as a gate
   * meant a bad reading skipped the fetch silently and left the cache stale with
   * nothing on screen to say so. The fetch itself fails fast when truly offline,
   * so it is cheaper to just try.
   */
  const maybeRefresh = useCallback(async () => {
    const wait = failed.current ? RETRY_INTERVAL_MS : MIN_INTERVAL_MS;
    if (lastAttempt.current > 0 && Date.now() - lastAttempt.current < wait) return;
    await refresh();
  }, [refresh]);

  useEffect(() => {
    // Rejections here used to be unhandled, which is how a broken refresh became
    // invisible: no rates, no error, no clue.
    reload()
      .then(maybeRefresh)
      .catch((err: unknown) => setLastError(err instanceof Error ? err.message : String(err)));
  }, [reload, maybeRefresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void maybeRefresh().catch(() => {});
    });
    return () => sub.remove();
  }, [maybeRefresh]);

  // NetInfo now only *prompts* a retry when a connection appears.
  useEffect(() => {
    return NetInfo.addEventListener((state) => {
      if (state.isConnected) void maybeRefresh().catch(() => {});
    });
  }, [maybeRefresh]);

  const rateForCurrency = useCallback(
    (currency: string): FxRate | null => {
      if (currency === 'NZD') {
        return { currency: 'NZD', rate_to_nzd: 1, fetched_at: new Date().toISOString() };
      }
      return rates.get(currency) ?? null;
    },
    [rates]
  );

  const value = useMemo(
    () => ({ rates, rateFor: rateForCurrency, refreshing, refresh, lastAttemptFailed, lastError }),
    [rates, rateForCurrency, refreshing, refresh, lastAttemptFailed, lastError]
  );

  return <RatesContext.Provider value={value}>{children}</RatesContext.Provider>;
}

export function useRates() {
  const ctx = useContext(RatesContext);
  if (!ctx) throw new Error('useRates must be used inside RatesProvider');
  return ctx;
}
