import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../hooks/useApp';
import { formatShortDate } from '../lib/dates';
import { Colors, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';
import { BottomSheet } from './BottomSheet';
import { TripIllustration } from './TripIllustration';

/**
 * Compact trip picker for the header's right side. Opens a sheet so you can
 * switch trips without bouncing back to the Trip tab.
 */
export function TripSwitcherHeader() {
  const { activeTrip, trips, setActiveTrip } = useApp();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!activeTrip) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Active trip ${activeTrip.name}. Tap to switch.`}
        style={styles.headerHit}>
        <Text style={styles.tripName} numberOfLines={1}>
          {activeTrip.name}
        </Text>
        <Text style={styles.chevron}>{'\u25BE'}</Text>
      </Pressable>

      <BottomSheet
        visible={open}
        onClose={() => setOpen(false)}
        closeLabel="Close the trip switcher"
        style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Switch trip</Text>
        <ScrollView
          style={styles.list}
          contentContainerStyle={{ paddingBottom: spacing.lg }}
          keyboardShouldPersistTaps="handled">
          {trips.map((t) => {
            const active = t.id === activeTrip.id;
            return (
              <Pressable
                key={t.id}
                style={[styles.row, active && styles.rowActive]}
                onPress={async () => {
                  // Dismiss first. The switch reads SQLite, and awaiting it
                  // here left the sheet sitting open for the round trip.
                  setOpen(false);
                  if (!active) await setActiveTrip(t.id);
                }}>
                <TripIllustration tripType={t.trip_type} active={active} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, active && { color: colors.accent }]} numberOfLines={1}>
                    {t.name}
                  </Text>
                  <Text style={styles.rowMeta}>
                    {formatShortDate(t.start_date)} to {formatShortDate(t.end_date)}
                  </Text>
                </View>
                {active ? <Text style={styles.activeTag}>Active</Text> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    headerHit: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      maxWidth: 140,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
    },
    tripName: { ...type.caption, color: c.textMuted, fontWeight: '600', flexShrink: 1 },
    chevron: { color: c.textFaint, fontSize: 11, marginTop: 1 },
    sheet: { paddingHorizontal: spacing.lg, maxHeight: '70%' },
    sheetHandle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: c.border,
      marginTop: spacing.md,
      marginBottom: spacing.md,
    },
    sheetTitle: { ...type.title, color: c.text, marginBottom: spacing.md },
    list: { flexGrow: 0 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.bg,
      marginBottom: spacing.sm,
    },
    rowActive: { borderColor: c.accent, backgroundColor: c.accentSoft },
    rowName: { ...type.body, color: c.text, fontWeight: '600' },
    rowMeta: { ...type.caption, color: c.textFaint, marginTop: 2 },
    activeTag: { ...type.caption, color: c.accent, fontWeight: '700' },
  });
