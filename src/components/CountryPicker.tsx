import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Country } from '../db/types';
import { Colors, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';

export function CountryPicker({
  label,
  countries,
  value,
  onChange,
}: {
  label: string;
  countries: Country[];
  value: string | null;
  onChange: (country: Country) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  const selected = countries.find((c) => c.country_code === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) => c.name.toLowerCase().includes(q) || c.currency_code.toLowerCase().includes(q)
    );
  }, [countries, query]);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.trigger} onPress={() => setOpen(true)}>
        <Text style={selected ? styles.triggerText : styles.triggerPlaceholder}>
          {selected ? `${selected.name}` : 'Select a country'}
        </Text>
        {selected ? <Text style={styles.currencyTag}>{selected.currency_code}</Text> : null}
      </Pressable>

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select country</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12}>
              <Text style={styles.close}>Done</Text>
            </Pressable>
          </View>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.textFaint}
            autoCorrect={false}
            style={styles.search}
          />
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.country_code}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={styles.row}
                onPress={() => {
                  onChange(item);
                  setOpen(false);
                  setQuery('');
                }}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowCurrency}>{item.currency_code}</Text>
              </Pressable>
            )}
          />
        </View>
      </Modal>
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
    triggerText: { color: c.text, fontSize: 16 },
    triggerPlaceholder: { color: c.textFaint, fontSize: 16 },
    currencyTag: {
      ...type.caption,
      color: c.accent,
      backgroundColor: c.accentSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    modal: { flex: 1, backgroundColor: c.bg, paddingTop: spacing.xxl + spacing.lg },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.lg,
    },
    modalTitle: { ...type.title, color: c.text },
    close: { ...type.heading, color: c.accent },
    search: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      marginHorizontal: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      color: c.text,
      fontSize: 16,
      marginBottom: spacing.md,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    rowName: { color: c.text, fontSize: 16 },
    rowCurrency: { ...type.label, color: c.textMuted },
  });
