import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { isValidDate } from '../lib/dates';
import { Colors, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';

/**
 * Plain `YYYY-MM-DD` text entry with auto-inserted dashes. Deliberately not a
 * native date picker: the dates being entered are usually not today (itinerary
 * planning), and typing eight digits beats scrolling a wheel.
 */
export function DateField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  const [touched, setTouched] = useState(false);
  const invalid = touched && value.length > 0 && !isValidDate(value);
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  function handleChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 4)}-${digits.slice(4)}`;
    if (digits.length > 6) out = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
    onChange(out);
  }

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={handleChange}
        onBlur={() => setTouched(true)}
        placeholder="YYYY-MM-DD"
        placeholderTextColor={colors.textFaint}
        keyboardType="number-pad"
        maxLength={10}
        style={[styles.input, invalid && { borderColor: colors.danger }]}
      />
      {invalid ? (
        <Text style={styles.error}>Not a real date</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
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
    input: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      color: c.text,
      fontSize: 16,
      letterSpacing: 1,
    },
    hint: { ...type.caption, color: c.textFaint, marginTop: spacing.xs },
    error: { ...type.caption, color: c.danger, marginTop: spacing.xs },
  });
