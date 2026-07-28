import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/repository';
import { isThemePreference, type ThemePreference } from '../theme/useTheme';

export const SETTING_KEYS = {
  activeTripId: 'active_trip_id',
  wifiOnlySync: 'wifi_only_sync',
  cardMarkupPct: 'card_markup_pct',
  displayName: 'display_name',
  themePreference: 'theme_preference',
} as const;

export interface AppSettings {
  activeTripId: string | null;
  /** Defaults on, to protect a limited European eSIM plan. */
  wifiOnlySync: boolean;
  cardMarkupPct: number;
  displayName: string;
  themePreference: ThemePreference;
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeTripId: null,
  wifiOnlySync: true,
  cardMarkupPct: 0,
  displayName: '',
  themePreference: 'system',
};

export async function loadSettings(db: SQLiteDatabase): Promise<AppSettings> {
  const [activeTripId, wifiOnly, markup, displayName, theme] = await Promise.all([
    getSetting(db, SETTING_KEYS.activeTripId),
    getSetting(db, SETTING_KEYS.wifiOnlySync),
    getSetting(db, SETTING_KEYS.cardMarkupPct),
    getSetting(db, SETTING_KEYS.displayName),
    getSetting(db, SETTING_KEYS.themePreference),
  ]);

  return {
    activeTripId,
    wifiOnlySync: wifiOnly === null ? DEFAULT_SETTINGS.wifiOnlySync : wifiOnly === '1',
    cardMarkupPct: markup === null ? 0 : Number(markup) || 0,
    displayName: displayName ?? '',
    themePreference:
      theme !== null && isThemePreference(theme) ? theme : DEFAULT_SETTINGS.themePreference,
  };
}

export async function saveSetting<K extends keyof AppSettings>(
  db: SQLiteDatabase,
  key: K,
  value: AppSettings[K]
) {
  const storageKey = SETTING_KEYS[key];
  const serialised =
    typeof value === 'boolean' ? (value ? '1' : '0') : value === null ? '' : String(value);
  await setSetting(db, storageKey, serialised);
}
