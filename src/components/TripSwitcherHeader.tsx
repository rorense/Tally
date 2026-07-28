import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../hooks/useApp';
import { formatShortDate } from '../lib/dates';
import { Colors, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';
import { TripIllustration } from './TripIllustration';

/**
 * Header control for Expenses / Charts. Shows the active trip and opens a
 * picker so you can switch without bouncing back to the Trip tab.
 */
export function TripSwitcherHeader({ section }: { section: string }) {
  const { activeTrip, trips, setActiveTrip } = useApp();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  if (!activeTrip) {
    return <Text style={styles.sectionOnly}>{section}</Text>;
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Active trip ${activeTrip.name}. Tap to switch.`}
        style={styles.headerHit}>
        <Text style={styles.section}>{section}</Text>
        <View style={styles.tripRow}>
          <Text style={styles.tripName} numberOfLines={1}>
            {activeTrip.name}
          </Text>
          <Text style={styles.chevron}>{'\u25BE'}</Text>
        </View>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
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
                    if (!active) await setActiveTrip(t.id);
                    setOpen(false);
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
        </View>
      </Modal>
    </>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    headerHit: { alignItems: 'center', maxWidth: 280 },
    sectionOnly: { ...type.heading, color: c.text, fontWeight: '700' },
    section: { ...type.caption, color: c.textMuted, fontWeight: '600' },
    tripRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
    tripName: { ...type.heading, color: c.text, fontWeight: '700', maxWidth: 220 },
    chevron: { color: c.textMuted, fontSize: 14, marginTop: 1 },
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      maxHeight: '70%',
    },
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
