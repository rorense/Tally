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
import { loadRateMap, refreshRates } from '../lib/fx';

interface RatesContextValue {
  rates: Map<string, FxRate>;
  rateFor: (currency: string) => FxRate | null;
  refreshing: boolean;
  refresh: () => Promise<boolean>;
  lastAttemptFailed: boolean;
}

const RatesContext = createContext<RatesContextValue | null>(null);

/** Do not hammer the upstreams if the app is foregrounded repeatedly. */
const MIN_INTERVAL_MS = 30 * 60 * 1000;

export function RatesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [rates, setRates] = useState<Map<string, FxRate>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [lastAttemptFailed, setLastAttemptFailed] = useState(false);
  const lastAttempt = useRef(0);

  const reload = useCallback(async () => {
    setRates(await loadRateMap(db));
  }, [db]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const ok = await refreshRates(db);
      lastAttempt.current = Date.now();
      setLastAttemptFailed(!ok);
      if (ok) await reload();
      return ok;
    } finally {
      setRefreshing(false);
    }
  }, [db, reload]);

  const maybeRefresh = useCallback(async () => {
    if (Date.now() - lastAttempt.current < MIN_INTERVAL_MS) return;
    const state = await NetInfo.fetch();
    // Rate fetches are tiny, so unlike sync they are allowed on cellular.
    if (!state.isConnected) return;
    await refresh();
  }, [refresh]);

  useEffect(() => {
    reload().then(maybeRefresh);
  }, [reload, maybeRefresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') maybeRefresh();
    });
    return () => sub.remove();
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
    () => ({ rates, rateFor: rateForCurrency, refreshing, refresh, lastAttemptFailed }),
    [rates, rateForCurrency, refreshing, refresh, lastAttemptFailed]
  );

  return <RatesContext.Provider value={value}>{children}</RatesContext.Provider>;
}

export function useRates() {
  const ctx = useContext(RatesContext);
  if (!ctx) throw new Error('useRates must be used inside RatesProvider');
  return ctx;
}
