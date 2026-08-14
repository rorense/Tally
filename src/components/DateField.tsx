import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatLongDate, isValidDate, parseLocalDate, toLocalDate, todayLocal } from '../lib/dates';
import { Colors, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';
import { BottomSheet } from './BottomSheet';

/**
 * Calendar date field. Opens the native date picker; still stores
 * `YYYY-MM-DD` so the rest of the app stays timezone-safe.
 */
export function DateField({
  label,
  value,
  onChange,
  hint,
  minimumDate,
  maximumDate,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  minimumDate?: string;
  maximumDate?: string;
  disabled?: boolean;
}) {
  const [iosOpen, setIosOpen] = useState(false);
  const [iosDraft, setIosDraft] = useState(() =>
    isValidDate(value) ? parseLocalDate(value) : new Date()
  );
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  const insets = useSafeAreaInsets();

  const display = isValidDate(value) ? formatLongDate(value) : 'Pick a date';
  const selected = isValidDate(value) ? parseLocalDate(value) : parseLocalDate(todayLocal());
  const min = minimumDate && isValidDate(minimumDate) ? parseLocalDate(minimumDate) : undefined;
  const max = maximumDate && isValidDate(maximumDate) ? parseLocalDate(maximumDate) : undefined;

  function openPicker() {
    if (disabled) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: selected,
        mode: 'date',
        display: 'default',
        minimumDate: min,
        maximumDate: max,
        onValueChange: (_event, date) => {
          if (date) onChange(toLocalDate(date));
        },
      });
      return;
    }
    setIosDraft(selected);
    setIosOpen(true);
  }

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        onPress={openPicker}
        disabled={disabled}
        style={[styles.trigger, disabled && styles.triggerDisabled]}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={`${label}, ${display}`}>
        <Text
          style={[
            styles.triggerText,
            !isValidDate(value) && styles.placeholder,
            disabled && styles.triggerTextDisabled,
          ]}>
          {display}
        </Text>
        {!disabled ? <Text style={styles.chevron}>{'\u25BE'}</Text> : null}
      </Pressable>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      {Platform.OS === 'ios' ? (
        <BottomSheet
          visible={iosOpen}
          onClose={() => setIosOpen(false)}
          closeLabel={`Close the ${label} picker`}
          style={{ paddingBottom: Math.max(insets.bottom, spacing.xxl) }}>
          <View style={styles.sheetHeader}>
            <Pressable onPress={() => setIosOpen(false)} hitSlop={12}>
              <Text style={styles.sheetAction}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                onChange(toLocalDate(iosDraft));
                setIosOpen(false);
              }}
              hitSlop={12}>
              <Text style={[styles.sheetAction, styles.sheetDone]}>Done</Text>
            </Pressable>
          </View>
          <DateTimePicker
            value={iosDraft}
            mode="date"
            display="spinner"
            themeVariant={scheme}
            textColor={colors.text}
            minimumDate={min}
            maximumDate={max}
            onValueChange={(_event, date) => {
              if (date) setIosDraft(date);
            }}
          />
        </BottomSheet>
      ) : null}
    </View>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    label: {
      ...type.label,
      color: c.textMuted,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    trigger: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md + 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    triggerDisabled: { opacity: 0.55 },
    triggerText: { color: c.text, fontSize: 16, flex: 1 },
    triggerTextDisabled: { color: c.textFaint },
    placeholder: { color: c.textFaint },
    chevron: { color: c.textFaint, fontSize: 16, marginLeft: spacing.sm },
    hint: { ...type.caption, color: c.textFaint, marginTop: spacing.xs },
    sheetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    sheetAction: { ...type.heading, color: c.textMuted },
    sheetDone: { color: c.accent },
  });
