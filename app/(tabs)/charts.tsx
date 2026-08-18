import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { matchFont } from '@shopify/react-native-skia';
import { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bar, CartesianChart, Line, Pie, PolarChart } from 'victory-native';
import { Card, EmptyState } from '../../src/components/ui';
import {
  listCountries,
  pretripSpentNzd,
  spentByCategory,
  spentByCountry,
  spentByDay,
} from '../../src/db/repository';
import type { Category, Country } from '../../src/db/types';
import { dateRange, formatShortDate, todayLocal } from '../../src/lib/dates';
import { formatNzd, formatNzdCompact, round2 } from '../../src/lib/money';
import { budgetPaceNzd } from '../../src/lib/pace';
import { useApp } from '../../src/hooks/useApp';
import { Colors, radius, spacing, type } from '../../src/theme/theme';
import { useTheme, useThemedStyles } from '../../src/theme/useTheme';

const axisFont = matchFont({
  fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }) ?? 'sans-serif',
  fontSize: 10,
  fontWeight: '500',
});

export default function ChartsScreen() {
  const db = useSQLiteContext();
  const { activeTrip, revision } = useApp();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  const [byCategory, setByCategory] = useState<{ category: Category; total: number }[]>([]);
  const [byCountry, setByCountry] = useState<{ country_code: string; total: number }[]>([]);
  const [byDay, setByDay] = useState<{ local_date: string; total: number }[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [pretripTotal, setPretripTotal] = useState(0);

  const load = useCallback(async () => {
    if (!activeTrip) return;
    const [cat, country, day, allCountries, pretrip] = await Promise.all([
      spentByCategory(db, activeTrip.id),
      spentByCountry(db, activeTrip.id),
      spentByDay(db, activeTrip.id, activeTrip.start_date),
      listCountries(db),
      pretripSpentNzd(db, activeTrip.id, activeTrip.start_date),
    ]);
    setByCategory(cat);
    setByCountry(country);
    setByDay(day);
    setCountries(allCountries);
    setPretripTotal(pretrip);
  }, [db, activeTrip]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, revision])
  );

  const pieData = useMemo(
    () =>
      byCategory
        .filter((c) => c.total > 0)
        .map((c) => ({
          label: c.category,
          value: round2(c.total),
          color: colors.category[c.category] ?? colors.accent,
        })),
    [byCategory, colors]
  );

  /**
   * Charts run over every day of the trip so far, not just days with spending.
   * A gap-free axis is what makes a quiet day visible.
   */
  const dailyData = useMemo(() => {
    if (!activeTrip) return [];
    const today = todayLocal();
    const end = today < activeTrip.end_date ? today : activeTrip.end_date;
    if (end < activeTrip.start_date) return [];

    const spendByDate = new Map(byDay.map((d) => [d.local_date, d.total]));
    return dateRange(activeTrip.start_date, end).map((date, i) => ({
      index: i,
      date,
      spend: round2(spendByDate.get(date) ?? 0),
    }));
  }, [activeTrip, byDay]);

  const dailyXTicks = useMemo(() => {
    const n = dailyData.length;
    if (n === 0) return [];
    if (n <= 7) return dailyData.map((d) => d.index);
    const step = Math.ceil((n - 1) / 5);
    const ticks = new Set<number>([0, n - 1]);
    for (let i = step; i < n - 1; i += step) ticks.add(i);
    return Array.from(ticks).sort((a, b) => a - b);
  }, [dailyData]);

  const cumulativeData = useMemo(() => {
    if (!activeTrip) return [];
    const budget = activeTrip.total_budget_nzd;
    // The line starts at pre-trip spend rather than at zero. Flights and hotels
    // bought before leaving have no day on this axis, but the budget still pays
    // for them, so leaving them out compared a partial total against the whole
    // budget: the chart read "on track" while the dashboard, which counts them,
    // said the budget was already gone.
    let running = pretripTotal;
    return dailyData.map((d, i) => {
      running = round2(running + d.spend);
      return {
        index: i,
        actual: running,
        // Straight-line budget across the whole trip, not just the days so far.
        pace: budgetPaceNzd(budget, activeTrip.start_date, activeTrip.end_date, i + 1),
      };
    });
  }, [dailyData, activeTrip, pretripTotal]);

  if (!activeTrip) {
    return (
      <View style={styles.screen}>
        <EmptyState title="No trip yet" subtitle="Create a trip to see charts." />
      </View>
    );
  }

  const total = byCategory.reduce((s, c) => s + c.total, 0);

  if (total === 0) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title="Nothing to chart yet"
          subtitle="Log a few expenses and the breakdowns will appear here."
        />
      </View>
    );
  }

  const maxCountry = Math.max(...byCountry.map((c) => c.total), 1);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.title}>Where the money went</Text>
        <Text style={styles.subtitle}>{formatNzd(total)} total · NZD</Text>
        <View style={{ height: 240, marginTop: spacing.lg }}>
          <PolarChart data={pieData} labelKey="label" valueKey="value" colorKey="color">
            <Pie.Chart innerRadius="55%" />
          </PolarChart>
        </View>
        <View style={styles.legend}>
          {pieData.map((slice) => (
            <View key={slice.label} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: slice.color }]} />
              <Text style={styles.legendLabel}>{slice.label}</Text>
              <Text style={styles.legendValue}>
                {`${formatNzdCompact(slice.value)} \u00B7 ${Math.round((slice.value / total) * 100)}%`}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <Text style={styles.title}>Daily spend</Text>
        <Text style={styles.subtitle}>
          {dailyData.length > 0
            ? `${formatShortDate(dailyData[0].date)} to ${formatShortDate(dailyData[dailyData.length - 1].date)} · NZD`
            : 'NZD'}
          {pretripTotal > 0 ? ` · excludes ${formatNzd(pretripTotal)} pretrip` : ''}
        </Text>
        <View style={{ height: 220, marginTop: spacing.lg }}>
          <CartesianChart
            data={dailyData}
            xKey="index"
            yKeys={['spend']}
            domainPadding={{ left: 12, right: 12, top: 20 }}
            xAxis={{
              font: axisFont,
              tickValues: dailyXTicks,
              labelColor: colors.textFaint,
              lineColor: colors.border,
              formatXLabel: (value) => {
                const i = Math.round(Number(value));
                const row = dailyData[i];
                return row ? formatShortDate(row.date) : '';
              },
            }}
            yAxis={[
              {
                font: axisFont,
                tickCount: 4,
                labelColor: colors.textFaint,
                lineColor: colors.border,
                formatYLabel: (v) => formatNzdCompact(Number(v)),
              },
            ]}>
            {({ points, chartBounds }) => (
              <Bar
                chartBounds={chartBounds}
                points={points.spend}
                color={colors.accent}
                roundedCorners={{ topLeft: 4, topRight: 4 }}
              />
            )}
          </CartesianChart>
        </View>
      </Card>

      {activeTrip.total_budget_nzd > 0 ? (
        <Card>
          <Text style={styles.title}>Cumulative vs budget</Text>
          <Text style={styles.subtitle}>
            {`Budget ${formatNzd(activeTrip.total_budget_nzd)} spread evenly across the trip`}
            {pretripTotal > 0 ? ` · starts at ${formatNzd(pretripTotal)} pretrip` : ''}
          </Text>
          <View style={{ height: 220, marginTop: spacing.lg }}>
            <CartesianChart
              data={cumulativeData}
              xKey="index"
              yKeys={['actual', 'pace']}
              domainPadding={{ top: 20 }}>
              {({ points }) => (
                <>
                  <Line
                    points={points.pace}
                    color={colors.textFaint}
                    strokeWidth={2}
                    curveType="linear"
                  />
                  <Line
                    points={points.actual}
                    color={colors.success}
                    strokeWidth={3}
                    curveType="linear"
                  />
                </>
              )}
            </CartesianChart>
          </View>
          <View style={styles.legendRow}>
            <LegendKey color={colors.success} label="Actual" />
            <LegendKey color={colors.textFaint} label="Even pace" />
          </View>
        </Card>
      ) : null}

      <Card>
        <Text style={styles.title}>By country</Text>
        <View style={{ height: spacing.md }} />
        {byCountry.map((c) => {
          const country = countries.find((x) => x.country_code === c.country_code);
          return (
            <View key={c.country_code} style={styles.countryRow}>
              <Text style={styles.countryName}>{country?.name ?? c.country_code}</Text>
              <View style={styles.countryBarTrack}>
                <View
                  style={[
                    styles.countryBarFill,
                    { width: `${(c.total / maxCountry) * 100}%` },
                  ]}
                />
              </View>
              <Text style={styles.countryValue}>{formatNzdCompact(c.total)}</Text>
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.legendKey}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
    title: { ...type.heading, color: c.text },
    subtitle: { ...type.caption, color: c.textMuted, marginTop: 2 },
    legend: { marginTop: spacing.lg, gap: spacing.sm },
    legendItem: { flexDirection: 'row', alignItems: 'center' },
    legendRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
    legendKey: { flexDirection: 'row', alignItems: 'center' },
    dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
    legendLabel: { ...type.body, color: c.text, flex: 1 },
    legendValue: { ...type.caption, color: c.textMuted },
    countryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    countryName: { ...type.caption, color: c.text, width: 96 },
    countryBarTrack: {
      flex: 1,
      height: 10,
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    countryBarFill: { height: '100%', backgroundColor: c.accent, borderRadius: radius.pill },
    countryValue: { ...type.caption, color: c.textMuted, width: 52, textAlign: 'right' },
  });
