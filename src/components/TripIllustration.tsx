import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { TripType } from '../db/types';
import { useTheme } from '../theme/useTheme';

/**
 * Small travel illustration for a trip bubble. Drawn in SVG so it picks up
 * the active scheme's accent colours rather than shipping fixed raster art.
 */
export function TripIllustration({
  tripType,
  active,
  size = 56,
}: {
  tripType: TripType;
  active?: boolean;
  size?: number;
}) {
  const { colors } = useTheme();
  const ink = active ? colors.accent : colors.textMuted;
  const soft = active ? colors.accentSoft : colors.surfaceRaised;
  const ground = active ? colors.accent : colors.border;

  if (tripType === 'single') {
    return (
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <Circle cx="32" cy="48" r="10" fill={soft} />
        <Path
          d="M32 10c-8.3 0-15 6.5-15 14.5 0 10.2 12.4 24.7 14.3 26.8a1 1 0 0 0 1.4 0C34.6 49.2 47 34.7 47 24.5 47 16.5 40.3 10 32 10z"
          fill={ink}
        />
        <Circle cx="32" cy="24" r="6.5" fill={soft} />
        <Path
          d="M29 23.2h6M32 20.5v5.5"
          stroke={ink}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Path
        d="M8 42c8-10 16-14 24-14s16 4 24 14"
        stroke={ground}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <Circle cx="14" cy="36" r="3.2" fill={ink} />
      <Circle cx="32" cy="26" r="3.2" fill={ink} />
      <Circle cx="50" cy="36" r="3.2" fill={ink} />
      <Rect x="22" y="14" width="20" height="16" rx="3" fill={soft} stroke={ink} strokeWidth="2" />
      <Path d="M28 14v-2.5a4 4 0 0 1 8 0V14" stroke={ink} strokeWidth="2" fill="none" />
      <Path
        d="M40 18.5h8.5l3 3.5-3 3.5H40"
        fill={ink}
      />
    </Svg>
  );
}
