import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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
  type ShopbackType,
  type TripMember,
} from '../../src/db/types';
import { isValidDate, nowIso, todayLocal } from '../../src/lib/dates';
import { convertToNzd, formatMoney, formatNzd, parseAmount } from '../../src/lib/money';
import { isRateStale, rateAgeLabel } from '../../src/lib/fx';
import { computeShopbackAmount, computeShopbackNzd } from '../../src/lib/shopback';
import { useApp } from '../../src/hooks/useApp';
import { useAuth } from '../../src/hooks/useAuth';
import { useRates } from '../../src/hooks/useRates';
import { Colors, onFill, radius, spacing, type } from '../../src/theme/theme';
import { useTheme, useThemedStyles } from '../../src/theme/useTheme';

type ShopbackMode = 'None' | 'Flat' | '%';

function modeFromType(t: ShopbackType | null | undefined): ShopbackMode {
  if (t === 'flat') return 'Flat';
  if (t === 'percent') return '%';
  return 'None';
}

function typeFromMode(m: ShopbackMode): ShopbackType | null {
  if (m === 'Flat') return 'flat';
  if (m === '%') return 'percent';
  return null;
}

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
  const [isPretrip, setIsPretrip] = useState(false);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [currency, setCurrency] = useState('EUR');
  const [legId, setLegId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('Food');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [shopbackMode, setShopbackMode] = useState<ShopbackMode>('None');
  const [shopbackValue, setShopbackValue] = useState('');
  // Tracks the date we last applied an itinerary leg for, so changing the date
  // re-infers country, but opening a fresh form keeps the last-used country.
  const lastAppliedDate = useRef<string | null>(null);
  // Remembers country/currency/leg when toggling Pretrip on, so turning it
  // off restores the trip-day defaults instead of leaving NZ stuck on.
  const beforePretrip = useRef<{
    countryCode: string | null;
    currency: string;
    legId: string | null;
  } | null>(null);

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
        setIsPretrip(e.is_pretrip === 1);
        setCountryCode(e.country_code);
        setCurrency(e.currency);
        setLegId(e.leg_id);
        setCategory(e.category);
        setDescription(e.description);
        setAmount(String(e.amount));
        setPaidBy(e.paid_by);
        setShopbackMode(modeFromType(e.shopback_type));
        setShopbackValue(e.shopback_value != null ? String(e.shopback_value) : '');
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
    if (!loaded || !isNew || isPretrip) return;
    if (lastAppliedDate.current === date) return;
    lastAppliedDate.current = date;
    applyLegForDate(date);
  }, [loaded, isNew, isPretrip, date, applyLegForDate]);

  function setPretrip(next: boolean) {
    if (next && !isPretrip) {
      beforePretrip.current = { countryCode, currency, legId };
      setCountryCode('NZ');
      setCurrency('NZD');
      setLegId(null);
    } else if (!next && isPretrip) {
      const prev = beforePretrip.current;
      beforePretrip.current = null;
      if (prev) {
        setCountryCode(prev.countryCode);
        setCurrency(prev.currency);
        setLegId(prev.legId);
      } else if (isValidDate(date)) {
        applyLegForDate(date);
      }
    }
    setIsPretrip(next);
  }

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
  const parsedShopbackValue = parseAmount(shopbackValue);
  const shopbackType = typeFromMode(shopbackMode);

  const nzdPreview = useMemo(() => {
    if (parsedAmount === null || effectiveRate === null) return null;
    if (
      existing &&
      keptRate !== null &&
      existing.amount === parsedAmount &&
      existing.currency === currency
    ) {
      return existing.amount_nzd;
    }
    return convertToNzd(parsedAmount, effectiveRate, settings.cardMarkupPct);
  }, [parsedAmount, effectiveRate, settings.cardMarkupPct, existing, keptRate, currency]);

  const shopbackPreview = useMemo(() => {
    if (!shopbackType || parsedAmount === null || parsedShopbackValue === null) return null;
    if (parsedShopbackValue <= 0) return null;
    if (shopbackType === 'percent' && parsedShopbackValue > 100) return null;
    const amountLocal = computeShopbackAmount(parsedAmount, shopbackType, parsedShopbackValue);
    if (effectiveRate === null) return { amountLocal, amountNzd: null as number | null };
    return {
      amountLocal,
      amountNzd: computeShopbackNzd(amountLocal, effectiveRate),
    };
  }, [
    shopbackType,
    parsedAmount,
    parsedShopbackValue,
    effectiveRate,
  ]);

  async function handleSave() {
    if (!activeTrip) return Alert.alert('No trip', 'Create a trip first.');
    if (parsedAmount === null || parsedAmount <= 0) {
      return Alert.alert('Amount required', 'Enter how much you spent.');
    }
    if (!description.trim()) {
      return Alert.alert('Description required', 'Say what the purchase was.');
    }
    if (!isPretrip && !countryCode) {
      return Alert.alert('Country required', 'Pick where you spent it.');
    }
    if (!isPretrip && !isValidDate(date)) {
      return Alert.alert('Check the date', 'Use a real YYYY-MM-DD date.');
    }
    if (effectiveRate === null) {
      return Alert.alert(
        'No rate yet',
        `No cached rate for ${currency}. Connect once to fetch rates, or enter the amount in a currency you already have a rate for.`
      );
    }

    let shopbackFields: Pick<
      Expense,
      | 'shopback_type'
      | 'shopback_value'
      | 'shopback_amount'
      | 'shopback_amount_nzd'
      | 'shopback_status'
      | 'shopback_confirmed_at'
    > = {
      shopback_type: null,
      shopback_value: null,
      shopback_amount: null,
      shopback_amount_nzd: null,
      shopback_status: null,
      shopback_confirmed_at: null,
    };

    if (shopbackType) {
      if (parsedShopbackValue === null || parsedShopbackValue <= 0) {
        return Alert.alert(
          'ShopBack value',
          shopbackType === 'percent'
            ? 'Enter the cashback percentage.'
            : 'Enter the flat ShopBack amount.'
        );
      }
      if (shopbackType === 'percent' && parsedShopbackValue > 100) {
        return Alert.alert('ShopBack value', 'Percentage must be 100 or less.');
      }
      const sbAmount = computeShopbackAmount(parsedAmount, shopbackType, parsedShopbackValue);
      const sbNzd = computeShopbackNzd(sbAmount, effectiveRate);
      // Keep confirmation state when editing an existing claim; new ones start pending.
      const keepStatus =
        existing?.shopback_type && existing.shopback_status
          ? existing.shopback_status
          : 'pending';
      shopbackFields = {
        shopback_type: shopbackType,
        shopback_value: parsedShopbackValue,
        shopback_amount: sbAmount,
        shopback_amount_nzd: sbNzd,
        shopback_status: keepStatus,
        shopback_confirmed_at:
          keepStatus === 'confirmed' ? (existing?.shopback_confirmed_at ?? nowIso()) : null,
      };
    }

    // Reopening an expense and saving without changing amount/currency must not
    // rewrite history when the card-markup setting has moved in the meantime.
    const unchanged =
      existing !== null &&
      keptRate !== null &&
      existing.amount === parsedAmount &&
      existing.currency === currency;

    const payload = {
      trip_id: activeTrip.id,
      leg_id: isPretrip ? null : legId,
      country_code: isPretrip ? 'NZ' : countryCode!,
      category,
      description: description.trim(),
      amount: parsedAmount,
      currency: isPretrip ? currency || 'NZD' : currency,
      // Frozen at entry time so past totals never shift when rates move.
      rate_to_nzd: effectiveRate,
      amount_nzd: unchanged
        ? existing.amount_nzd
        : convertToNzd(parsedAmount, effectiveRate, settings.cardMarkupPct),
      spent_at: existing?.spent_at ?? nowIso(),
      // Pretrip keeps a date for the NOT NULL column; grouping uses is_pretrip.
      local_date: isValidDate(date) ? date : activeTrip.start_date,
      is_pretrip: isPretrip ? 1 : 0,
      paid_by: paidBy,
      ...shopbackFields,
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

        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchLabel}>Pretrip</Text>
            <Text style={styles.switchHint}>
              Bought in NZ before the trip. Counts toward the budget, not a trip day.
            </Text>
          </View>
          <Switch
            value={isPretrip}
            onValueChange={setPretrip}
            trackColor={{ true: colors.accent, false: colors.border }}
          />
        </View>

        {!isPretrip ? (
          <DateField
            label="Date"
            value={date}
            onChange={setDate}
            minimumDate={activeTrip.start_date}
            maximumDate={activeTrip.end_date}
            hint={
              isNew
                ? 'Defaults to your last country. Changing the date re-checks the itinerary.'
                : undefined
            }
          />
        ) : null}

        {!isPretrip ? (
          <CountryPicker
            label="Country"
            countries={countries}
            value={countryCode}
            onChange={(c) => {
              setCountryCode(c.country_code);
              setCurrency(c.currency_code);
              // Manual override must not keep pointing at a leg for another country.
              setLegId(null);
            }}
          />
        ) : null}

        <Text style={styles.sectionLabel}>Currency</Text>
        <ChipRow
          options={currencyOptions(countries, currency)}
          value={currency}
          onChange={setCurrency}
        />
      </Card>

      <Card>
        <Text style={styles.sectionLabel}>ShopBack</Text>
        <ChipRow
          options={['None', 'Flat', '%'] as const}
          value={shopbackMode}
          onChange={setShopbackMode}
        />
        {shopbackMode !== 'None' ? (
          <>
            <View style={{ height: spacing.md }} />
            <Field
              label={shopbackMode === 'Flat' ? `Cashback (${currency})` : 'Cashback %'}
              value={shopbackValue}
              onChangeText={setShopbackValue}
              placeholder={shopbackMode === 'Flat' ? '0.00' : '5'}
              keyboardType="decimal-pad"
              hint={
                shopbackMode === 'Flat'
                  ? 'Flat amount that ShopBack will credit for this purchase.'
                  : 'Percentage of the spend returned as ShopBack.'
              }
            />
            {shopbackPreview ? (
              <Text style={styles.shopbackPreview}>
                Expect{' '}
                {formatMoney(shopbackPreview.amountLocal, currency)}
                {shopbackPreview.amountNzd != null
                  ? ` (${formatNzd(shopbackPreview.amountNzd)})`
                  : ''}{' '}
                back · verify on the ShopBack tab
              </Text>
            ) : null}
          </>
        ) : null}
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
    shopbackPreview: { ...type.caption, color: c.success, marginTop: spacing.xs },
    sectionLabel: {
      ...type.label,
      color: c.textMuted,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      marginBottom: spacing.lg,
    },
    switchLabel: { ...type.body, color: c.text },
    switchHint: { ...type.caption, color: c.textFaint, marginTop: 2 },
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
