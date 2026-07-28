/**
 * Design tokens. Everything visual in the app resolves back to these values so
 * the look stays consistent without pulling in a UI framework.
 */

export const colors = {
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

  // Fixed per-category colours, reused by the list rows and every chart so a
  // category is always the same colour wherever it appears.
  category: {
    Transport: '#4F8DFF',
    Accommodation: '#A47CF3',
    Activity: '#3ECF8E',
    Food: '#F5B54B',
    Souvenir: '#F2545B',
    Material: '#4BC5D9',
  },
} as const;

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

export const type = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
} as const;
