import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CountryPicker } from '../../src/components/CountryPicker';
import { DateField } from '../../src/components/DateField';
import { Button, Card, ChipRow, Field, Screen } from '../../src/components/ui';
import {
  createExpense,
  deleteExpense,
  findLegForDate,
  getExpense,
  getLatestExpense,
  listCountries,
  listMembers,
  updateExpense,
} from '../../src/db/repository';
import {
  CATEGORIES,
  type Category,
  type Country,
  type Expense,
  type TripMember,
} from '../../src/db/types';
import { isValidDate, nowIso, todayLocal } from '../../src/lib/dates';
import { convertToNzd, formatNzd, parseAmount } from '../../src/lib/money';
import { isRateStale, rateAgeLabel } from '../../src/lib/fx';
import { useApp } from '../../src/hooks/useApp';
import { useAuth } from '../../src/hooks/useAuth';
import { useRates } from '../../src/hooks/useRates';
import { Colors, onFill, radius, spacing, type } from '../../src/theme/theme';
import { useTheme, useThemedStyles } from '../../src/theme/useTheme';

export default function ExpenseScreen() {
  const db = useSQLiteContext();
  const { activeTrip, settings, refresh } = useApp();
  const { rateFor } = useRates();
  const { userId } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const isNew = params.id === 'new';

  const [loaded, setLoaded] = useState(false);
  const [existing, setExisting] = useState<Expense | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);
  const [members, setMembers] = useState<TripMember[]>([]);

  const [date, setDate] = useState(todayLocal());
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [currency, setCurrency] = useState('EUR');
  const [legId, setLegId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('Food');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  // Tracks the date we last applied an itinerary leg for, so changing the date
  // re-infers country, but opening a fresh form keeps the last-used country.
  const lastAppliedDate = useRef<string | null>(null);

  // Loads the expense being edited, or seeds a new one from the last entry /
  // today's leg so consecutive logging does not re-ask for country.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const allCountries = await listCountries(db);
      const tripMembers = activeTrip ? await listMembers(db, activeTrip.id) : [];
      if (cancelled) return;
      setCountries(allCountries);
      setMembers(tripMembers);

      if (!isNew) {
        const e = await getExpense(db, params.id);
        if (cancelled || !e) return;
        setExisting(e);
        setDate(e.local_date);
        setCountryCode(e.country_code);
        setCurrency(e.currency);
        setLegId(e.leg_id);
        setCategory(e.category);
        setDescription(e.description);
        setAmount(String(e.amount));
        setPaidBy(e.paid_by);
        lastAppliedDate.current = e.local_date;
      } else {
        setPaidBy(userId);
        const today = todayLocal();
        if (activeTrip) {
          const latest = await getLatestExpense(db, activeTrip.id);
          if (cancelled) return;
          if (latest) {
            setCountryCode(latest.country_code);
            setCurrency(latest.currency);
            setLegId(latest.leg_id);
            lastAppliedDate.current = today;
          } else {
            const leg = await findLegForDate(db, activeTrip.id, today);
            if (cancelled) return;
            if (leg) {
              setLegId(leg.id);
              setCountryCode(leg.country_code);
              setCurrency(leg.currency_code);
            }
            lastAppliedDate.current = today;
          }
        }
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [db, params.id, isNew, activeTrip, userId]);

  /**
   * Changing the date re-checks the itinerary. The initial country comes from
   * the previous expense (or the first matching leg), so logging several
   * purchases in the same place does not bounce you back to a different country.
   */
  const applyLegForDate = useCallback(
    async (nextDate: string) => {
      if (!activeTrip || !isValidDate(nextDate)) return;
      const leg = await findLegForDate(db, activeTrip.id, nextDate);
      if (!leg) return;
      setLegId(leg.id);
      setCountryCode(leg.country_code);
      setCurrency(leg.currency_code);
    },
    [db, activeTrip]
  );

  useEffect(() => {
    if (!loaded || !isNew) return;
    if (lastAppliedDate.current === date) return;
    lastAppliedDate.current = date;
    applyLegForDate(date);
  }, [loaded, isNew, date, applyLegForDate]);

  const rate = rateFor(currency);

  /**
   * An existing expense keeps the rate it was logged at, so historical totals
   * never shift. That lock only holds while the currency is unchanged: switching
   * currency mid-edit means the old rate describes the wrong thing, so fall back
   * to the current cached rate.
   */
  const keptRate = existing && existing.currency === currency ? existing.rate_to_nzd : null;
  const effectiveRate = keptRate ?? rate?.rate_to_nzd ?? null;
  const parsedAmount = parseAmount(amount);

  const nzdPreview = useMemo(() => {
    if (parsedAmount === null || effectiveRate === null) return null;
    return convertToNzd(parsedAmount, effectiveRate, settings.cardMarkupPct);
  }, [parsedAmount, effectiveRate, settings.cardMarkupPct]);

  async function handleSave() {
    if (!activeTrip) return Alert.alert('No trip', 'Create a trip first.');
    if (parsedAmount === null || parsedAmount === 0) {
      return Alert.alert('Amount required', 'Enter how much you spent.');
    }
    if (!countryCode) return Alert.alert('Country required', 'Pick where you spent it.');
    if (!isValidDate(date)) return Alert.alert('Check the date', 'Use a real YYYY-MM-DD date.');
    if (effectiveRate === null) {
      return Alert.alert(
        'No rate yet',
        `No cached rate for ${currency}. Connect once to fetch rates, or enter the amount in a currency you already have a rate for.`
      );
    }

    const payload = {
      trip_id: activeTrip.id,
      leg_id: legId,
      country_code: countryCode,
      category,
      description: description.trim(),
      amount: parsedAmount,
      currency,
      // Frozen at entry time so past totals never shift when rates move.
      rate_to_nzd: effectiveRate,
      amount_nzd: convertToNzd(parsedAmount, effectiveRate, settings.cardMarkupPct),
      spent_at: existing?.spent_at ?? nowIso(),
      local_date: date,
      paid_by: paidBy,
    };

    if (isNew) await createExpense(db, payload);
    else await updateExpense(db, params.id, payload);

    refresh();
    router.back();
  }

  function handleDelete() {
    Alert.alert('Delete expense', 'This removes it on every device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExpense(db, params.id);
          refresh();
          router.back();
        },
      },
    ]);
  }

  if (!activeTrip) {
    return (
      <Screen>
        <Card>
          <Text style={styles.noTrip}>Create a trip before logging expenses.</Text>
        </Card>
      </Screen>
    );
  }

  const ageLabel = rateAgeLabel(rate?.fetched_at);
  const stale = isRateStale(rate?.fetched_at);

  return (
    <Screen>
      <Card>
        <Field
          label="Amount"
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          keyboardType="decimal-pad"
          autoFocus={isNew}
          style={styles.amountInput}
          containerStyle={{ marginBottom: spacing.sm }}
        />

        <View style={styles.conversionRow}>
          <Text style={styles.currencyBadge}>{currency}</Text>
          <View style={{ flex: 1 }} />
          {nzdPreview !== null ? (
            <Text style={styles.nzd}>{formatNzd(nzdPreview)}</Text>
          ) : (
            <Text style={styles.nzdMissing}>No rate for {currency}</Text>
          )}
        </View>

        {nzdPreview !== null ? (
          <Text style={[styles.rateNote, keptRate !== null || !stale ? null : { color: colors.warning }]}>
            {keptRate !== null
              ? 'Locked at the rate from when this was logged'
              : ageLabel
                ? `Rate ${ageLabel}`
                : 'Using cached rate'}
            {settings.cardMarkupPct > 0 ? ` \u00B7 includes ${settings.cardMarkupPct}% card markup` : ''}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>Category</Text>
        <ChipRow
          options={CATEGORIES}
          value={category}
          onChange={setCategory}
          colorFor={(c) => colors.category[c]}
        />

        <View style={{ height: spacing.lg }} />

        <Field
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="Dinner in Trastevere"
        />

        <DateField
          label="Date"
          value={date}
          onChange={setDate}
          hint={
            isNew
              ? 'Defaults to your last country. Changing the date re-checks the itinerary.'
              : undefined
          }
        />

        <CountryPicker
          label="Country"
          countries={countries}
          value={countryCode}
          onChange={(c) => {
            setCountryCode(c.country_code);
            setCurrency(c.currency_code);
          }}
        />

        <Text style={styles.sectionLabel}>Currency</Text>
        <ChipRow
          options={currencyOptions(countries, currency)}
          value={currency}
          onChange={setCurrency}
        />
      </Card>

      {members.length > 1 ? (
        <Card>
          <Text style={styles.sectionLabel}>Paid by</Text>
          <View style={styles.payerRow}>
            {members.map((m) => {
              const active = m.user_id === paidBy;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => setPaidBy(m.user_id)}
                  style={[styles.payer, active && styles.payerActive]}>
                  <Text style={[styles.payerText, active && { color: onFill(colors.accent) }]}>
                    {m.display_name || 'Traveller'}
                    {m.user_id === userId ? ' (you)' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ) : null}

      <Button title={isNew ? 'Add expense' : 'Save changes'} onPress={handleSave} />

      {!isNew ? (
        <>
          <View style={{ height: spacing.md }} />
          <Button title="Delete expense" variant="danger" onPress={handleDelete} />
        </>
      ) : null}
    </Screen>
  );
}

/** Currencies present in the seed list, with the current one guaranteed first. */
function currencyOptions(countries: Country[], current: string): string[] {
  const set = new Set<string>([current, 'EUR', 'GBP', 'CHF', 'NZD']);
  for (const c of countries) set.add(c.currency_code);
  return Array.from(set);
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    amountInput: { fontSize: 34, fontWeight: '700', paddingVertical: spacing.lg },
    conversionRow: { flexDirection: 'row', alignItems: 'center' },
    currencyBadge: {
      ...type.label,
      color: c.accent,
      backgroundColor: c.accentSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: 4,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    nzd: { ...type.title, color: c.success },
    nzdMissing: { ...type.label, color: c.warning },
    rateNote: { ...type.caption, color: c.textFaint, marginTop: spacing.sm },
    sectionLabel: {
      ...type.label,
      color: c.textMuted,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    payerRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
    payer: {
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm + 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceRaised,
    },
    payerActive: { backgroundColor: c.accent, borderColor: c.accent },
    payerText: { ...type.label, color: c.textMuted },
    noTrip: { ...type.body, color: c.textMuted, textAlign: 'center' },
  });
