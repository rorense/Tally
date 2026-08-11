/**
 * Design tokens. Everything visual in the app resolves back to these values so
 * the look stays consistent without pulling in a UI framework.
 *
 * Colours come in a light and a dark palette sharing one shape. Nothing should
 * import a palette directly: use `useTheme` / `useThemedStyles` so a change of
 * scheme re-renders. Only the sizing and type scales below are shared, since
 * they do not vary between schemes.
 */

export type ColorScheme = 'light' | 'dark';

export type CategoryName =
  | 'Transport'
  | 'Accommodation'
  | 'Activity'
  | 'Food'
  | 'Souvenir'
  | 'Material';

export interface Colors {
  bg: string;
  surface: string;
  surfaceRaised: string;
  border: string;

  text: string;
  textMuted: string;
  textFaint: string;

  accent: string;
  accentSoft: string;

  success: string;
  warning: string;
  danger: string;

  category: Record<CategoryName, string>;
}

/**
 * Category colours are deliberately identical in both schemes. They are the
 * one thing the eye uses to track a category across the list rows and every
 * chart, so shifting them per scheme would cost more than the slight contrast
 * it would buy. They are only ever used as fills, never as text.
 */
const category: Record<CategoryName, string> = {
  Transport: '#4F8DFF',
  Accommodation: '#A47CF3',
  Activity: '#3ECF8E',
  Food: '#F5B54B',
  Souvenir: '#F2545B',
  Material: '#4BC5D9',
};

export const darkColors: Colors = {
  bg: '#0B0E14',
  surface: '#141924',
  surfaceRaised: '#1C2230',
  border: '#262E3D',

  text: '#F2F5FA',
  textMuted: '#93A0B5',
  textFaint: '#5E6B80',

  accent: '#4F8DFF',
  accentSoft: 'rgba(79, 141, 255, 0.14)',

  success: '#3ECF8E',
  warning: '#F5B54B',
  danger: '#F2545B',

  category,
};

/**
 * Not a straight inversion. The accent and status colours are darkened well
 * past their dark-scheme values, because a tint that reads as vivid on near
 * black drops to roughly 3:1 against white and stops being legible as text.
 */
export const lightColors: Colors = {
  bg: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceRaised: '#EEF2F8',
  border: '#DCE3ED',

  text: '#121826',
  textMuted: '#5A6779',
  textFaint: '#8B95A6',

  accent: '#2C67D6',
  accentSoft: 'rgba(44, 103, 214, 0.12)',

  success: '#12805A',
  warning: '#A96B00',
  danger: '#C8323F',

  category,
};

export const palettes: Record<ColorScheme, Colors> = {
  light: lightColors,
  dark: darkColors,
};

/**
 * Picks black or white text for an arbitrary fill. Chips and chart labels sit
 * on category colours that span pale yellow to deep violet, so a fixed
 * foreground is wrong for one end of that range whichever end you pick.
 */
export function onFill(fill: string): string {
  const hex = fill.replace('#', '');
  if (hex.length !== 6) return '#FFFFFF';
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.4 ? '#0B0E14' : '#FFFFFF';
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Durations in milliseconds. A sheet leaves faster than it arrives: an
 * entrance is being read as it happens and wants room to settle, while a
 * dismissal has already been decided and only needs to get out of the way.
 */
export const motion = {
  sheetIn: 260,
  sheetOut: 200,
} as const;

export const type = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
} as const;
