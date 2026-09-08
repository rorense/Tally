import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/repository';
import { isThemePreference, type ThemePreference } from '../theme/useTheme';

export const SETTING_KEYS = {
  activeTripId: 'active_trip_id',
  wifiOnlySync: 'wifi_only_sync',
  // Still spelled `card_markup_pct` on disk. Renaming the key would read as
  // unset on a phone that already has a rate saved, silently resetting it to
  // the default, for no behavioural gain.
  fxFeePct: 'card_markup_pct',
  cardCashbackPct: 'card_cashback_pct',
  displayName: 'display_name',
  themePreference: 'theme_preference',
} as const;

export interface AppSettings {
  activeTripId: string | null;
  /** Defaults on, to protect a limited European eSIM plan. */
  wifiOnlySync: boolean;
  /**
   * The card's currency conversion fee, prefilled when the fee is ticked on an
   * expense. Never applied on its own: a purchase converts at the mid-market
   * rate unless that expense says the fee was charged, because cash and NZD
   * spend carry no conversion at all.
   */
  fxFeePct: number;
  /** Rate the credit card pays back, prefilled when tagging a card expense. */
  cardCashbackPct: number;
  displayName: string;
  themePreference: ThemePreference;
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeTripId: null,
  wifiOnlySync: true,
  fxFeePct: 1.9,
  cardCashbackPct: 0.8,
  displayName: '',
  themePreference: 'system',
};

export async function loadSettings(db: SQLiteDatabase): Promise<AppSettings> {
  const [activeTripId, wifiOnly, fxFee, cardCashback, displayName, theme] = await Promise.all([
    getSetting(db, SETTING_KEYS.activeTripId),
    getSetting(db, SETTING_KEYS.wifiOnlySync),
    getSetting(db, SETTING_KEYS.fxFeePct),
    getSetting(db, SETTING_KEYS.cardCashbackPct),
    getSetting(db, SETTING_KEYS.displayName),
    getSetting(db, SETTING_KEYS.themePreference),
  ]);

  return {
    activeTripId,
    wifiOnlySync: wifiOnly === null ? DEFAULT_SETTINGS.wifiOnlySync : wifiOnly === '1',
    // Only an unset key falls back to the default; an explicit 0 stays 0.
    fxFeePct: fxFee === null ? DEFAULT_SETTINGS.fxFeePct : Number(fxFee) || 0,
    cardCashbackPct:
      cardCashback === null ? DEFAULT_SETTINGS.cardCashbackPct : Number(cardCashback) || 0,
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
