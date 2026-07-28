import { createContext, ReactNode, useContext, useMemo } from 'react';
import { useColorScheme, type ColorSchemeName } from 'react-native';
import { Colors, ColorScheme, palettes } from './theme';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export function isThemePreference(value: string): value is ThemePreference {
  return (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * React Native reports `null` before the OS setting resolves and
 * `'unspecified'` on platforms that have none, so anything other than an
 * explicit 'light' falls back to the app's own default of dark.
 */
export function resolveSystemScheme(value: ColorSchemeName): ColorScheme {
  return value === 'light' ? 'light' : 'dark';
}

interface ThemeContextValue {
  scheme: ColorScheme;
  colors: Colors;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({
  preference,
  children,
}: {
  preference: ThemePreference;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const scheme: ColorScheme =
    preference === 'system' ? resolveSystemScheme(system) : preference;

  const value = useMemo(() => ({ scheme, colors: palettes[scheme] }), [scheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

/**
 * Built stylesheets, keyed by factory then scheme. `StyleSheet.create` is not
 * free, and without this every mount of every screen would rebuild its sheet.
 * The WeakMap lets a factory be collected if its module ever is.
 */
const sheets = new WeakMap<object, Partial<Record<ColorScheme, unknown>>>();

/**
 * Resolves a stylesheet against the active scheme. Pass a factory defined at
 * module scope, not an inline arrow, so the cache can find it again.
 */
export function useThemedStyles<T>(factory: (colors: Colors) => T): T {
  const { scheme, colors } = useTheme();
  return useMemo(() => {
    let perScheme = sheets.get(factory);
    if (!perScheme) {
      perScheme = {};
      sheets.set(factory, perScheme);
    }
    if (!perScheme[scheme]) perScheme[scheme] = factory(colors);
    return perScheme[scheme] as T;
  }, [factory, scheme, colors]);
}
