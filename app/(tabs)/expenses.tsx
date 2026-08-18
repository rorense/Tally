import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ChipRow, EmptyState } from '../../src/components/ui';
import {
  listCountries,
  listExpenses,
  listUsedCountryCodes,
} from '../../src/db/repository';
import { CATEGORIES, type Category, type Country, type Expense } from '../../src/db/types';
import { formatLongDate } from '../../src/lib/dates';
import { formatMoney, formatNzd, round2 } from '../../src/lib/money';
import { cashbackSourceLabel, confirmedCashbackNzd } from '../../src/lib/cashback';
import { useApp } from '../../src/hooks/useApp';
import { Colors, onFill, radius, spacing, type } from '../../src/theme/theme';
import { useTheme, useThemedStyles } from '../../src/theme/useTheme';

export default function ExpensesScreen() {
  const db = useSQLiteContext();
  const { activeTrip, revision } = useApp();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  // Only offer country filters for places that actually have expenses — read
  // from the whole trip, not from the currently filtered list.
  const [usedCountries, setUsedCountries] = useState<string[]>([]);
  const [category, setCategory] = useState<Category | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!activeTrip) return setExpenses([]);
    setCountries(await listCountries(db));
    setUsedCountries(await listUsedCountryCodes(db, activeTrip.id));
    setExpenses(
      await listExpenses(db, activeTrip.id, {
        category,
        countryCode,
        search: search.trim() || null,
      })
    );
  }, [db, activeTrip, category, countryCode, search]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, revision])
  );

  const sections = useMemo(() => {
    const groups = new Map<string, Expense[]>();
    for (const e of expenses) {
      const key = e.is_pretrip === 1 ? 'pretrip' : e.local_date;
      const list = groups.get(key) ?? [];
      list.push(e);
      groups.set(key, list);
    }
    return Array.from(groups.entries())
      .sort((a, b) => {
        if (a[0] === 'pretrip') return -1;
        if (b[0] === 'pretrip') return 1;
        return b[0].localeCompare(a[0]);
      })
      .map(([date, data]) => ({
        title: date,
        // Gross, so the day adds up to the row prices printed beneath it. The
        // cashback earned that day is shown beside it rather than folded in.
        total: round2(data.reduce((sum, e) => sum + e.amount_nzd, 0)),
        cashback: round2(data.reduce((sum, e) => sum + confirmedCashbackNzd(e), 0)),
        data,
      }));
  }, [expenses]);

  if (!activeTrip) {
    return (
      <View style={styles.screen}>
        <EmptyState title="No trip yet" subtitle="Create a trip to start logging expenses." />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.filters}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search descriptions"
          placeholderTextColor={colors.textFaint}
          style={styles.search}
        />

        <ChipRow
          options={['All', ...CATEGORIES] as const}
          value={category ?? 'All'}
          onChange={(v) => setCategory(v === 'All' ? null : (v as Category))}
          colorFor={(v) => (v === 'All' ? colors.accent : colors.category[v as Category])}
        />

        {usedCountries.length > 1 || countryCode ? (
          <View style={{ marginTop: spacing.sm }}>
            <ChipRow
              options={['All', ...usedCountries]}
              value={countryCode ?? 'All'}
              onChange={(v) => setCountryCode(v === 'All' ? null : v)}
            />
          </View>
        ) : null}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <EmptyState
            title="Nothing here"
            subtitle={
              search || category || countryCode
                ? 'No expenses match those filters.'
                : 'Tap the button below to log your first purchase.'
            }
          />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionDate}>
              {section.title === 'pretrip' ? 'Pretrip' : formatLongDate(section.title)}
            </Text>
            <View style={styles.sectionTotals}>
              {section.cashback > 0 ? (
                <Text style={[styles.sectionTotal, { color: colors.success }]}>
                  {`−${formatNzd(section.cashback)}`}
                </Text>
              ) : null}
              <Text style={styles.sectionTotal}>{formatNzd(section.total)}</Text>
            </View>
          </View>
        )}
        renderItem={({ item }) => {
          const country = countries.find((c) => c.country_code === item.country_code);
          const cashbackNzd = item.shopback_amount_nzd ?? 0;
          const cashbackStatus = item.shopback_type ? (item.shopback_status ?? 'pending') : null;
          return (
            <Pressable style={styles.row} onPress={() => router.push(`/expense/${item.id}`)}>
              <View style={[styles.bar, { backgroundColor: colors.category[item.category] }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.desc} numberOfLines={1}>
                  {item.description || item.category}
                </Text>
                <Text style={styles.meta}>
                  {`${item.category} \u00B7 ${country?.name ?? item.country_code}`}
                  {item.shopback_type
                    ? ` \u00B7 ${cashbackSourceLabel(item.shopback_type)}`
                    : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {/* What the purchase cost, before any cashback, so the figure
                    matches the receipt. The rebate gets its own line below
                    rather than being netted off silently. */}
                <Text style={styles.nzd}>{formatNzd(item.amount_nzd)}</Text>
                {cashbackStatus && cashbackNzd > 0 ? (
                  <Text
                    style={[
                      styles.cashback,
                      cashbackStatus === 'confirmed'
                        ? { color: colors.success }
                        : cashbackStatus === 'pending'
                          ? { color: colors.warning }
                          : { color: colors.textFaint },
                    ]}>
                    {cashbackStatus === 'confirmed'
                      ? `−${formatNzd(cashbackNzd)}`
                      : `${formatNzd(cashbackNzd)} ${
                          cashbackStatus === 'pending' ? 'pending' : 'declined'
                        }`}
                  </Text>
                ) : null}
                {item.currency !== 'NZD' ? (
                  <Text style={styles.original}>
                    {formatMoney(item.amount, item.currency)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
      />

      <Pressable style={styles.fab} onPress={() => router.push('/expense/new')}>
        <Text style={styles.fabText}>+</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    filters: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    search: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      color: c.text,
      fontSize: 15,
      marginBottom: spacing.md,
    },
    list: { padding: spacing.lg, paddingBottom: spacing.xxl * 3 },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionDate: { ...type.label, color: c.textMuted },
    sectionTotals: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    sectionTotal: { ...type.label, color: c.textFaint },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      gap: spacing.md,
    },
    bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
    desc: { ...type.body, color: c.text },
    meta: { ...type.caption, color: c.textFaint, marginTop: 1 },
    nzd: { ...type.heading, color: c.text },
    cashback: { ...type.caption, fontWeight: '600', marginTop: 1 },
    original: { ...type.caption, color: c.textFaint },
    fab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.xl,
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    fabText: { color: onFill(c.accent), fontSize: 30, fontWeight: '600', marginTop: -3 },
  });
