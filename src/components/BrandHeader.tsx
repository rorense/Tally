import { StyleSheet, Text, View } from 'react-native';
import { Colors, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';

/**
 * Five-count tally mark: four uprights crossed by a rising diagonal, matching
 * the app icon. Built from Views so the header stays sharp at any density.
 */
function TallyMark({ size = 22 }: { size?: number }) {
  const { colors } = useTheme();
  const stroke = Math.max(2, Math.round(size * 0.12));
  const gap = size * 0.14;
  const uprightH = size * 0.92;
  const width = stroke * 4 + gap * 3;

  return (
    <View style={{ width: width + stroke, height: size, justifyContent: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap, height: uprightH }}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={{
              width: stroke,
              height: uprightH,
              borderRadius: stroke / 2,
              backgroundColor: i < 2 ? colors.category.Material : colors.accent,
            }}
          />
        ))}
      </View>
      <View
        style={{
          position: 'absolute',
          left: -stroke * 0.2,
          right: -stroke * 0.2,
          height: stroke,
          borderRadius: stroke / 2,
          backgroundColor: colors.text,
          transform: [{ rotate: '-28deg' }],
        }}
      />
    </View>
  );
}

/**
 * Lively tab header: brand mark + Tally, with an optional section line under it
 * on Expenses / Charts / ShopBack / Settings.
 */
export function BrandHeaderTitle({ section }: { section?: string }) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.wrap} accessibilityRole="header">
      <View style={styles.row}>
        <View style={styles.markWell}>
          <TallyMark size={18} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.brand}>Tally</Text>
          {section ? <Text style={styles.section}>{section}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      alignItems: 'center',
      maxWidth: 220,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    markWell: {
      width: 34,
      height: 34,
      borderRadius: radius.md,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    textCol: { justifyContent: 'center', minWidth: 0 },
    brand: {
      fontSize: 20,
      fontWeight: '800',
      color: c.text,
      letterSpacing: -0.4,
      lineHeight: 22,
    },
    section: {
      ...type.caption,
      color: c.accent,
      fontWeight: '700',
      marginTop: 1,
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    },
  });
