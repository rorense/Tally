import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ChipRow, EmptyState, ProgressBar } from '../../src/components/ui';
import {
  listShopbackExpenses,
  shopbackByCategory,
  shopbackSummary,
  totalSpentNzd,
  updateShopbackStatus,
  type ShopbackSummary,
} from '../../src/db/repository';
import type { Category, Expense, ShopbackStatus } from '../../src/db/types';
import { formatLongDate } from '../../src/lib/dates';
import { formatMoney, formatNzd, round2 } from '../../src/lib/money';
import { shopbackStatusLabel } from '../../src/lib/shopback';
import { useApp } from '../../src/hooks/useApp';
import { Colors, radius, spacing, type } from '../../src/theme/theme';
import { useTheme, useThemedStyles } from '../../src/theme/useTheme';

type Filter = 'Pending' | 'Confirmed' | 'Cancelled' | 'All';

function statusFromFilter(f: Filter): ShopbackStatus | null {
  if (f === 'Pending') return 'pending';
  if (f === 'Confirmed') return 'confirmed';
  if (f === 'Cancelled') return 'cancelled';
  return null;
}

export default function ShopbackScreen() {
  const db = useSQLiteContext();
  const { activeTrip, revision, refresh } = useApp();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  const [filter, setFilter] = useState<Filter>('Pending');
  const [items, setItems] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ShopbackSummary | null>(null);
  const [byCategory, setByCategory] = useState<{ category: Category; total: number }[]>([]);
  const [tripSpend, setTripSpend] = useState(0);

  const load = useCallback(async () => {
    if (!activeTrip) {
      setItems([]);
      setSummary(null);
      setByCategory([]);
      setTripSpend(0);
      return;
    }
    const [list, sum, cats, spent] = await Promise.all([
      listShopbackExpenses(db, activeTrip.id, statusFromFilter(filter)),
      shopbackSummary(db, activeTrip.id),
      shopbackByCategory(db, activeTrip.id),
      totalSpentNzd(db, activeTrip.id),
    ]);
    setItems(list);
    setSummary(sum);
    setByCategory(cats);
    setTripSpend(spent);
  }, [db, activeTrip, filter]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, revision])
  );

  const analytics = useMemo(() => {
    if (!summary) return null;
    const totalClaims =
      summary.pending_count + summary.confirmed_count + summary.cancelled_count;
    const settled = summary.confirmed_count + summary.cancelled_count;
    const confirmRate = settled > 0 ? summary.confirmed_count / settled : null;
    const expectedNzd = round2(summary.pending_nzd + summary.confirmed_nzd);
    // tripSpend is already net of confirmed cashback; add it back for the rate base.
    const grossSpend = tripSpend + summary.confirmed_nzd;
    const cashbackRate =
      grossSpend > 0 && summary.confirmed_nzd > 0
        ? (summary.confirmed_nzd / grossSpend) * 100
        : null;
    return { totalClaims, confirmRate, expectedNzd, cashbackRate };
  }, [summary, tripSpend]);

  async function setStatus(id: string, status: ShopbackStatus) {
    await updateShopbackStatus(db, id, status);
    refresh();
    await load();
  }

  if (!activeTrip) {
    return (
      <View style={styles.screen}>
        <EmptyState title="No trip yet" subtitle="Create a trip to track ShopBack cashback." />
      </View>
    );
  }

  if (!summary || analytics?.totalClaims === 0) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <EmptyState
          title="No ShopBack yet"
          subtitle="When you log an expense with Flat or % cashback, it shows up here so you can confirm it landed in ShopBack."
        />
      </ScrollView>
    );
  }

  const maxCat = Math.max(...byCategory.map((c) => c.total), 1);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.statRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Pending</Text>
          <Text style={[styles.statValue, { color: colors.warning }]}>
            {formatNzd(summary.pending_nzd)}
          </Text>
          <Text style={styles.statMeta}>{summary.pending_count} claims</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Confirmed</Text>
          <Text style={[styles.statValue, { color: colors.success }]}>
            {formatNzd(summary.confirmed_nzd)}
          </Text>
          <Text style={styles.statMeta}>{summary.confirmed_count} claims</Text>
        </View>
      </View>

      <Card>
        <Text style={styles.sectionLabel}>Analytics</Text>
        <View style={styles.analyticsRow}>
          <Text style={styles.analyticsKey}>Expected (pending + confirmed)</Text>
          <Text style={styles.analyticsVal}>{formatNzd(analytics!.expectedNzd)}</Text>
        </View>
        {analytics!.confirmRate != null ? (
          <View style={styles.analyticsRow}>
            <Text style={styles.analyticsKey}>Confirmation rate</Text>
            <Text style={styles.analyticsVal}>
              {Math.round(analytics!.confirmRate * 100)}%
            </Text>
          </View>
        ) : null}
        {analytics!.cashbackRate != null ? (
          <View style={styles.analyticsRow}>
            <Text style={styles.analyticsKey}>Confirmed vs trip spend</Text>
            <Text style={styles.analyticsVal}>{analytics!.cashbackRate.toFixed(1)}%</Text>
          </View>
        ) : null}
        {summary.cancelled_count > 0 ? (
          <View style={styles.analyticsRow}>
            <Text style={styles.analyticsKey}>Cancelled</Text>
            <Text style={[styles.analyticsVal, { color: colors.textFaint }]}>
              {formatNzd(summary.cancelled_nzd)} · {summary.cancelled_count}
            </Text>
          </View>
        ) : null}

        {byCategory.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.sectionLabel}>Confirmed by category</Text>
            {byCategory.map((c) => (
              <View key={c.category} style={styles.catRow}>
                <View style={styles.catHeader}>
                  <Text style={styles.catName}>{c.category}</Text>
                  <Text style={styles.catTotal}>{formatNzd(c.total)}</Text>
                </View>
                <ProgressBar
                  value={c.total}
                  max={maxCat}
                  color={colors.category[c.category]}
                />
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      <Text style={styles.sectionLabel}>Claims</Text>
      <ChipRow
        options={['Pending', 'Confirmed', 'Cancelled', 'All'] as const}
        value={filter}
        onChange={setFilter}
        colorFor={(v) =>
          v === 'Pending'
            ? colors.warning
            : v === 'Confirmed'
              ? colors.success
              : v === 'Cancelled'
                ? colors.textFaint
                : colors.accent
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title={`No ${filter.toLowerCase()} claims`}
          subtitle="Try another filter, or add ShopBack on an expense."
        />
      ) : (
        items.map((item) => {
          const status = item.shopback_status ?? 'pending';
          const valueLabel =
            item.shopback_type === 'percent'
              ? `${item.shopback_value}%`
              : formatMoney(item.shopback_value ?? 0, item.currency);

          return (
            <View key={item.id} style={styles.claim}>
              <Pressable
                style={styles.claimTop}
                onPress={() => router.push(`/expense/${item.id}`)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.claimTitle} numberOfLines={1}>
                    {item.description || item.category}
                  </Text>
                  <Text style={styles.claimMeta}>
                    {item.is_preflight === 1 ? 'Preflight' : formatLongDate(item.local_date)} ·{' '}
                    {item.category} · {valueLabel}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={styles.claimNzd}>
                    {formatNzd(item.shopback_amount_nzd ?? 0)}
                  </Text>
                  <Text
                    style={[
                      styles.statusBadge,
                      status === 'pending' && { color: colors.warning },
                      status === 'confirmed' && { color: colors.success },
                      status === 'cancelled' && { color: colors.textFaint },
                    ]}>
                    {shopbackStatusLabel(status)}
                  </Text>
                </View>
              </Pressable>

              {status === 'pending' ? (
                <View style={styles.actions}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Confirmed"
                      onPress={() => setStatus(item.id, 'confirmed')}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Didn't land"
                      variant="secondary"
                      onPress={() => setStatus(item.id, 'cancelled')}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.actions}>
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Mark pending"
                      variant="secondary"
                      onPress={() => setStatus(item.id, 'pending')}
                    />
                  </View>
                  {status === 'cancelled' ? (
                    <View style={{ flex: 1 }}>
                      <Button
                        title="Confirm instead"
                        onPress={() => setStatus(item.id, 'confirmed')}
                      />
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
    statRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
    stat: {
      flex: 1,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.lg,
    },
    statLabel: {
      ...type.label,
      color: c.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: spacing.xs,
    },
    statValue: { ...type.title, color: c.text },
    statMeta: { ...type.caption, color: c.textFaint, marginTop: 2 },
    sectionLabel: {
      ...type.label,
      color: c.textMuted,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    analyticsRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
      gap: spacing.md,
    },
    analyticsKey: { ...type.body, color: c.textMuted, flex: 1 },
    analyticsVal: { ...type.heading, color: c.text },
    catRow: { marginBottom: spacing.md },
    catHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    catName: { ...type.label, color: c.text },
    catTotal: { ...type.label, color: c.textMuted },
    claim: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.lg,
      marginTop: spacing.md,
    },
    claimTop: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
    claimTitle: { ...type.body, color: c.text, fontWeight: '600' },
    claimMeta: { ...type.caption, color: c.textFaint, marginTop: 2 },
    claimNzd: { ...type.heading, color: c.text },
    statusBadge: { ...type.caption, marginTop: 2, fontWeight: '600' },
    actions: { flexDirection: 'row', gap: spacing.sm },
  });
