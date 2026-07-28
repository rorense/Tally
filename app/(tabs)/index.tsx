import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SyncBanner } from '../../src/components/SyncBanner';
import { Button, Card, EmptyState, ProgressBar } from '../../src/components/ui';
import {
  findLegForDate,
  listCategoryBudgets,
  listCountries,
  listExpenses,
  spentByCategory,
  spentOnDay,
  totalSpentNzd,
} from '../../src/db/repository';
import { CATEGORIES, type Category, type Expense } from '../../src/db/types';
import { daysBetween, formatShortDate, todayLocal } from '../../src/lib/dates';
import { formatNzd, formatNzdCompact } from '../../src/lib/money';
import { useApp } from '../../src/hooks/useApp';
import { useSync } from '../../src/hooks/useSync';
import { colors, radius, spacing, type } from '../../src/theme/theme';

interface Dash {
  total: number;
  today: number;
  byCategory: { category: Category; total: number }[];
  budgets: Record<string, number>;
  recent: Expense[];
  currentCountry: string | null;
  currentCurrency: string | null;
}

export default function DashboardScreen() {
  const db = useSQLiteContext();
  const { activeTrip, revision, refresh } = useApp();
  const { syncNow, syncing } = useSync();
  const [data, setData] = useState<Dash | null>(null);

  const load = useCallback(async () => {
    if (!activeTrip) return setData(null);
    const today = todayLocal();

    const [total, today_, byCategory, budgetRows, recent, leg, countries] = await Promise.all([
      totalSpentNzd(db, activeTrip.id),
      spentOnDay(db, activeTrip.id, today),
      spentByCategory(db, activeTrip.id),
      listCategoryBudgets(db, activeTrip.id),
      listExpenses(db, activeTrip.id),
      findLegForDate(db, activeTrip.id, today),
      listCountries(db),
    ]);

    const country = leg ? countries.find((c) => c.country_code === leg.country_code) : null;

    setData({
      total,
      today: today_,
      byCategory,
      budgets: Object.fromEntries(budgetRows.map((b) => [b.category, b.budget_nzd])),
      recent: recent.slice(0, 6),
      currentCountry: country?.name ?? null,
      currentCurrency: leg?.currency_code ?? null,
    });
  }, [db, activeTrip]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, revision])
  );

  if (!activeTrip) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyState
          title="No trip yet"
          subtitle="Create a trip, add the countries you are visiting, and start logging."
        />
        <Button title="Create a trip" onPress={() => router.push('/trip/edit')} />
      </ScrollView>
    );
  }

  const budget = activeTrip.total_budget_nzd;
  const spent = data?.total ?? 0;
  const remaining = budget - spent;
  const tripDays = daysBetween(activeTrip.start_date, activeTrip.end_date) + 1;
  const elapsed = Math.min(
    Math.max(daysBetween(activeTrip.start_date, todayLocal()) + 1, 0),
    tripDays
  );
  // Pacing only makes sense once the trip has actually started.
  const expectedPace = budget > 0 && elapsed > 0 ? (budget / tripDays) * elapsed : 0;
  const onTrack = expectedPace === 0 || spent <= expectedPace;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={syncing}
          onRefresh={async () => {
            await syncNow('manual');
            refresh();
          }}
          tintColor={colors.accent}
        />
      }>
      <SyncBanner />

      <Card>
        <Text style={styles.tripName}>{activeTrip.name}</Text>
        <Text style={styles.tripDates}>
          {formatShortDate(activeTrip.start_date)} to {formatShortDate(activeTrip.end_date)}
          {data?.currentCountry ? ` \u00B7 currently in ${data.currentCountry}` : ''}
        </Text>

        <View style={{ height: spacing.xl }} />

        <Text style={styles.bigTotal}>{formatNzd(spent)}</Text>
        <Text style={styles.bigTotalLabel}>
          {budget > 0 ? `of ${formatNzd(budget)} budget` : 'spent so far'}
        </Text>

        {budget > 0 ? (
          <>
            <View style={{ height: spacing.lg }} />
            <ProgressBar value={spent} max={budget} />
            <View style={styles.statRow}>
              <Text style={[styles.stat, remaining < 0 && { color: colors.danger }]}>
                {remaining >= 0
                  ? `${formatNzd(remaining)} left`
                  : `${formatNzd(-remaining)} over`}
              </Text>
              <Text style={[styles.stat, { color: onTrack ? colors.success : colors.warning }]}>
                {elapsed <= 0
                  ? 'Not started'
                  : onTrack
                    ? 'On track'
                    : `${formatNzdCompact(spent - expectedPace)} ahead of pace`}
              </Text>
            </View>
          </>
        ) : null}
      </Card>

      <View style={styles.tileRow}>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{formatNzd(data?.today ?? 0)}</Text>
          <Text style={styles.tileLabel}>Today</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>
            {elapsed > 0 ? formatNzdCompact(spent / elapsed) : '$0'}
          </Text>
          <Text style={styles.tileLabel}>Daily average</Text>
        </View>
        <View style={styles.tile}>
          <Text style={styles.tileValue}>{Math.max(tripDays - elapsed, 0)}</Text>
          <Text style={styles.tileLabel}>Days left</Text>
        </View>
      </View>

      <Card>
        <Text style={styles.sectionTitle}>By category</Text>
        {CATEGORIES.map((cat) => {
          const catSpent = data?.byCategory.find((c) => c.category === cat)?.total ?? 0;
          const catBudget = data?.budgets[cat] ?? 0;
          if (catSpent === 0 && catBudget === 0) return null;
          return (
            <View key={cat} style={styles.catRow}>
              <View style={styles.catHeader}>
                <View style={[styles.dot, { backgroundColor: colors.category[cat] }]} />
                <Text style={styles.catName}>{cat}</Text>
                <Text style={styles.catAmount}>
                  {formatNzd(catSpent)}
                  {catBudget > 0 ? (
                    <Text style={styles.catBudget}> / {formatNzdCompact(catBudget)}</Text>
                  ) : null}
                </Text>
              </View>
              {catBudget > 0 ? (
                <ProgressBar value={catSpent} max={catBudget} color={colors.category[cat]} />
              ) : null}
            </View>
          );
        })}
        {(data?.byCategory.length ?? 0) === 0 ? (
          <Text style={styles.muted}>Nothing logged yet.</Text>
        ) : null}
      </Card>

      <Card>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent</Text>
          <Pressable onPress={() => router.push('/(tabs)/expenses')}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>
        {data?.recent.length ? (
          data.recent.map((e) => (
            <Pressable
              key={e.id}
              style={styles.expenseRow}
              onPress={() => router.push(`/expense/${e.id}`)}>
              <View style={[styles.dot, { backgroundColor: colors.category[e.category] }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.expenseDesc} numberOfLines={1}>
                  {e.description || e.category}
                </Text>
                <Text style={styles.expenseMeta}>
                  {`${formatShortDate(e.local_date)} \u00B7 ${e.country_code}`}
                </Text>
              </View>
              <Text style={styles.expenseAmount}>{formatNzd(e.amount_nzd)}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.muted}>Nothing logged yet.</Text>
        )}
      </Card>

      <Button title="Add expense" onPress={() => router.push('/expense/new')} />
      <View style={{ height: spacing.md }} />
      <Button
        title="Trip settings"
        variant="secondary"
        onPress={() => router.push(`/trip/edit?id=${activeTrip.id}`)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  tripName: { ...type.title, color: colors.text },
  tripDates: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  bigTotal: { fontSize: 40, fontWeight: '800', color: colors.text, letterSpacing: -1 },
  bigTotalLabel: { ...type.caption, color: colors.textMuted, marginTop: 2 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md },
  stat: { ...type.label, color: colors.textMuted },
  tileRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
  },
  tileValue: { ...type.heading, color: colors.text },
  tileLabel: { ...type.caption, color: colors.textFaint, marginTop: 2 },
  sectionTitle: { ...type.heading, color: colors.text, marginBottom: spacing.md },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: { ...type.label, color: colors.accent, marginBottom: spacing.md },
  catRow: { marginBottom: spacing.lg },
  catHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.md },
  catName: { ...type.body, color: colors.text, flex: 1 },
  catAmount: { ...type.label, color: colors.text },
  catBudget: { color: colors.textFaint },
  expenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  expenseDesc: { ...type.body, color: colors.text },
  expenseMeta: { ...type.caption, color: colors.textFaint, marginTop: 1 },
  expenseAmount: { ...type.label, color: colors.text },
  muted: { ...type.body, color: colors.textFaint },
});
