import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
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
import { countPendingChanges, getLastPulledAt, runSync, SyncTrigger } from '../lib/sync';
import { isSyncConfigured } from '../lib/supabase';
import { useApp } from './useApp';
import { useAuth } from './useAuth';

interface SyncContextValue {
  syncing: boolean;
  pending: number;
  lastPulledAt: string | null;
  lastError: string | null;
  online: boolean;
  onWifi: boolean;
  syncNow: (trigger: SyncTrigger) => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { session } = useAuth();
  const { settings, refresh, revision } = useApp();

  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [lastPulledAt, setLastPulledAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [net, setNet] = useState<NetInfoState | null>(null);

  // Guards against overlapping passes when several triggers fire at once.
  const inFlight = useRef(false);
  const wifiOnly = settings.wifiOnlySync;

  const online = net?.isConnected === true;
  const onWifi = net?.type === 'wifi';

  const refreshStatus = useCallback(async () => {
    setPending(await countPendingChanges(db));
    setLastPulledAt(await getLastPulledAt(db));
  }, [db]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, settings.activeTripId, revision]);

  useEffect(() => {
    const unsub = NetInfo.addEventListener(setNet);
    NetInfo.fetch().then(setNet);
    return () => unsub();
  }, []);

  const syncNow = useCallback(
    async (trigger: SyncTrigger) => {
      if (!isSyncConfigured || !session || inFlight.current) return;

      // Manual pull-to-refresh overrides the wifi-only preference: the user is
      // standing there asking for it, so honour the request.
      if (trigger !== 'manual') {
        const state = await NetInfo.fetch();
        if (!state.isConnected) return;
        if (wifiOnly && state.type !== 'wifi') return;
      }

      inFlight.current = true;
      setSyncing(true);
      try {
        const result = await runSync(db, settings.displayName);
        setLastError(result.ok ? null : (result.error ?? 'Sync failed'));
        await refreshStatus();
        if (result.ok && result.pulled > 0) refresh();
      } finally {
        inFlight.current = false;
        setSyncing(false);
      }
    },
    [db, session, wifiOnly, settings.displayName, refreshStatus, refresh]
  );

  // Reconnect. Fires when the phone finds wifi after a day with no signal.
  const wasConnected = useRef(false);
  useEffect(() => {
    const connected = net?.isConnected === true;
    if (connected && !wasConnected.current) syncNow('reconnect');
    wasConnected.current = connected;
  }, [net, syncNow]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncNow('foreground');
    });
    return () => sub.remove();
  }, [syncNow]);

  useEffect(() => {
    if (session) syncNow('startup');
  }, [session, syncNow]);

  const value = useMemo(
    () => ({ syncing, pending, lastPulledAt, lastError, online, onWifi, syncNow }),
    [syncing, pending, lastPulledAt, lastError, online, onWifi, syncNow]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used inside SyncProvider');
  return ctx;
}
