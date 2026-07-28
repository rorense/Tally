import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getTrip, listTrips } from '../db/repository';
import type { Trip } from '../db/types';
import { AppSettings, DEFAULT_SETTINGS, loadSettings, saveSetting } from '../lib/settings';

interface AppContextValue {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  trips: Trip[];
  activeTrip: Trip | null;
  setActiveTrip: (id: string | null) => Promise<void>;
  /** Bumped after any write so screens can re-query. */
  revision: number;
  refresh: () => void;
  ready: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTripState] = useState<Trip | null>(null);
  const [revision, setRevision] = useState(0);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadSettings(db);
      const allTrips = await listTrips(db);
      if (cancelled) return;

      // Fall back to the most recent trip if the stored active id is gone,
      // so deleting a trip never leaves the app pointing at nothing.
      let active: Trip | null = null;
      if (loaded.activeTripId) active = await getTrip(db, loaded.activeTripId);
      if (!active && allTrips.length > 0) active = allTrips[0];

      if (cancelled) return;
      setSettings(loaded);
      setTrips(allTrips);
      setActiveTripState(active);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, revision]);

  const updateSetting = useCallback(
    async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      await saveSetting(db, key, value);
      setSettings((s) => ({ ...s, [key]: value }));
    },
    [db]
  );

  const setActiveTrip = useCallback(
    async (id: string | null) => {
      await saveSetting(db, 'activeTripId', id);
      const trip = id ? await getTrip(db, id) : null;
      setSettings((s) => ({ ...s, activeTripId: id }));
      setActiveTripState(trip);
    },
    [db]
  );

  const value = useMemo(
    () => ({
      settings,
      updateSetting,
      trips,
      activeTrip,
      setActiveTrip,
      revision,
      refresh,
      ready,
    }),
    [settings, updateSetting, trips, activeTrip, setActiveTrip, revision, refresh, ready]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
