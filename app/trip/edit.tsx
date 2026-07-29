import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { CountryPicker } from '../../src/components/CountryPicker';
import { DateField } from '../../src/components/DateField';
import { JoinTripForm } from '../../src/components/JoinTripForm';
import { Body, Button, Card, Caption, ChipRow, Field, H2, Screen } from '../../src/components/ui';
import {
  createTrip,
  deleteLeg,
  deleteTrip,
  getTrip,
  listCategoryBudgets,
  listCountries,
  listLegs,
  setCategoryBudget,
  syncSingleCountryLeg,
  updateTrip,
  upsertLeg,
} from '../../src/db/repository';
import {
  CATEGORIES,
  type Category,
  type Country,
  type TripLeg,
  type TripType,
} from '../../src/db/types';
import { formatShortDate, isValidDate, todayLocal } from '../../src/lib/dates';
import { parseAmount } from '../../src/lib/money';
import { useApp } from '../../src/hooks/useApp';
import { Colors, radius, spacing, type } from '../../src/theme/theme';
import { useTheme, useThemedStyles } from '../../src/theme/useTheme';

type NewTripMode = 'create' | 'join';

export default function TripEditScreen() {
  const db = useSQLiteContext();
  const { refresh, setActiveTrip } = useApp();
  const params = useLocalSearchParams<{ id?: string }>();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const tripId = params.id ?? null;
  const isNew = !tripId;

  const [newMode, setNewMode] = useState<NewTripMode>('create');
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(todayLocal());
  const [endDate, setEndDate] = useState(todayLocal());
  const [budget, setBudget] = useState('');
  const [tripType, setTripType] = useState<TripType | null>(isNew ? null : 'multi');
  const [singleCountry, setSingleCountry] = useState<string | null>(null);
  const [legs, setLegs] = useState<TripLeg[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setCountries(await listCountries(db));
    if (!tripId) return;
    const trip = await getTrip(db, tripId);
    if (!trip) return;
    setName(trip.name);
    setStartDate(trip.start_date);
    setEndDate(trip.end_date);
    setBudget(trip.total_budget_nzd ? String(trip.total_budget_nzd) : '');
    setTripType(trip.trip_type);

    const tripLegs = await listLegs(db, tripId);
    setLegs(tripLegs);
    if (trip.trip_type === 'single') setSingleCountry(tripLegs[0]?.country_code ?? null);

    const cbs = await listCategoryBudgets(db, tripId);
    setCategoryBudgets(
      Object.fromEntries(cbs.map((c) => [c.category, c.budget_nzd ? String(c.budget_nzd) : '']))
    );
  }, [db, tripId]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!name.trim()) return Alert.alert('Name required', 'Give the trip a name.');
    if (!tripType) return Alert.alert('Pick a trip type', 'One country, or several?');
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return Alert.alert('Check the dates', 'Both dates need to be real YYYY-MM-DD dates.');
    }
    if (endDate < startDate) {
      return Alert.alert('Check the dates', 'The end date is before the start date.');
    }
    if (tripType === 'single' && !singleCountry) {
      return Alert.alert('Country required', 'Pick the country you are visiting.');
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        start_date: startDate,
        end_date: endDate,
        total_budget_nzd: parseAmount(budget) ?? 0,
        trip_type: tripType,
      };

      let id = tripId;
      if (isNew) {
        const trip = await createTrip(db, payload);
        id = trip.id;
        await setActiveTrip(trip.id);
      } else {
        await updateTrip(db, tripId!, payload);
      }

      if (tripType === 'single') {
        const country = countries.find((c) => c.country_code === singleCountry);
        if (country) await syncSingleCountryLeg(db, id!, country, startDate, endDate);
      }

      for (const cat of CATEGORIES) {
        const raw = categoryBudgets[cat];
        const amount = raw ? (parseAmount(raw) ?? 0) : 0;
        await setCategoryBudget(db, id!, cat, amount);
      }

      refresh();
      router.back();
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!tripId) return;
    Alert.alert('Delete trip', 'This removes the trip and all its expenses on every device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTrip(db, tripId);
          await setActiveTrip(null);
          refresh();
          router.replace('/(tabs)');
        },
      },
    ]);
  }

  async function addLeg() {
    if (!tripId) {
      return Alert.alert('Save first', 'Save the trip before adding itinerary legs.');
    }
    const last = legs[legs.length - 1];
    const from = last ? last.end_date : startDate;
    const fallback = countries[0];
    await upsertLeg(db, {
      trip_id: tripId,
      country_code: fallback?.country_code ?? 'FR',
      currency_code: fallback?.currency_code ?? 'EUR',
      start_date: from,
      end_date: endDate,
    });
    setLegs(await listLegs(db, tripId));
    refresh();
  }

  async function saveLeg(leg: TripLeg, patch: Partial<TripLeg>) {
    await upsertLeg(db, {
      id: leg.id,
      trip_id: leg.trip_id,
      country_code: patch.country_code ?? leg.country_code,
      currency_code: patch.currency_code ?? leg.currency_code,
      start_date: patch.start_date ?? leg.start_date,
      end_date: patch.end_date ?? leg.end_date,
    });
    setLegs(await listLegs(db, leg.trip_id));
    refresh();
  }

  async function removeLeg(leg: TripLeg) {
    await deleteLeg(db, leg.id);
    setLegs(await listLegs(db, leg.trip_id));
    refresh();
  }

  return (
    <Screen>
      {isNew ? (
        <Card>
          <ChipRow
            options={['Create trip', 'Join with code'] as const}
            value={newMode === 'join' ? 'Join with code' : 'Create trip'}
            onChange={(v) => setNewMode(v === 'Join with code' ? 'join' : 'create')}
          />
        </Card>
      ) : null}

      {isNew && newMode === 'join' ? (
        <Card>
          <H2>Join a trip</H2>
          <Caption>
            Enter the code from the person who created the trip. You need to be online and signed
            in for this one step.
          </Caption>
          <View style={{ height: spacing.lg }} />
          <JoinTripForm />
        </Card>
      ) : (
        <>
      <Card>
        <H2>{isNew ? 'New trip' : 'Trip details'}</H2>
        <Field
          label="Trip name"
          value={name}
          onChangeText={setName}
          placeholder="Europe 2027"
          autoCapitalize="words"
        />

        <Text style={styles.sectionLabel}>Is this one country or several?</Text>
        <View style={styles.typeRow}>
          <TypeOption
            title="One country"
            detail="Everything is logged in the same place and currency."
            active={tripType === 'single'}
            onPress={() => setTripType('single')}
          />
          <TypeOption
            title="Several countries"
            detail="Build an itinerary so each expense knows where you were."
            active={tripType === 'multi'}
            onPress={() => setTripType('multi')}
          />
        </View>

        {tripType === 'single' ? (
          <CountryPicker
            label="Country"
            countries={countries}
            value={singleCountry}
            onChange={(c) => setSingleCountry(c.country_code)}
          />
        ) : null}

        <DateField label="Start date" value={startDate} onChange={setStartDate} />
        <DateField label="End date" value={endDate} onChange={setEndDate} />
        <Field
          label="Total budget (NZD)"
          value={budget}
          onChangeText={setBudget}
          placeholder="12000"
          keyboardType="decimal-pad"
          hint="Leave blank if you would rather just track spending."
        />
      </Card>

      {tripType === 'multi' ? (
        <Card>
          <H2>Itinerary</H2>
          <Caption>
            Each leg maps a country and its currency to a date range. When you log an expense, the
            leg covering that day pre-fills the country and currency for you.
          </Caption>
          <View style={{ height: spacing.lg }} />

          {legs.length === 0 ? (
            <Body muted>No legs yet.</Body>
          ) : (
            legs.map((leg) => (
              <LegRow
                key={leg.id}
                leg={leg}
                countries={countries}
                onChange={(patch) => saveLeg(leg, patch)}
                onRemove={() => removeLeg(leg)}
              />
            ))
          )}

          <View style={{ height: spacing.md }} />
          <Button title="Add leg" variant="secondary" onPress={addLeg} />
        </Card>
      ) : null}

      <Card>
        <H2>Category budgets</H2>
        <Caption>Optional. Set to zero for any category you do not want to cap.</Caption>
        <View style={{ height: spacing.lg }} />
        {CATEGORIES.map((cat) => (
          <View key={cat} style={styles.budgetRow}>
            <View style={[styles.dot, { backgroundColor: colors.category[cat as Category] }]} />
            <Text style={styles.budgetLabel}>{cat}</Text>
            <Field
              value={categoryBudgets[cat] ?? ''}
              onChangeText={(v) => setCategoryBudgets((s) => ({ ...s, [cat]: v }))}
              placeholder="0"
              keyboardType="decimal-pad"
              containerStyle={{ marginBottom: 0 }}
              style={styles.budgetInput}
            />
          </View>
        ))}
      </Card>

      <Button title={saving ? 'Saving' : 'Save trip'} onPress={handleSave} loading={saving} />

      {!isNew ? (
        <>
          <View style={{ height: spacing.md }} />
          <Button title="Delete trip" variant="danger" onPress={handleDelete} />
        </>
      ) : null}
        </>
      )}
    </Screen>
  );
}

function TypeOption({
  title,
  detail,
  active,
  onPress,
}: {
  title: string;
  detail: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  return (
    <Pressable style={[styles.typeCard, active && styles.typeCardActive]} onPress={onPress}>
      <Text style={[styles.typeTitle, active && { color: colors.accent }]}>{title}</Text>
      <Text style={styles.typeDetail}>{detail}</Text>
    </Pressable>
  );
}

function LegRow({
  leg,
  countries,
  onChange,
  onRemove,
}: {
  leg: TripLeg;
  countries: Country[];
  onChange: (patch: Partial<TripLeg>) => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const styles = useThemedStyles(createStyles);
  const country = countries.find((c) => c.country_code === leg.country_code);

  return (
    <View style={styles.leg}>
      <Pressable style={styles.legHeader} onPress={() => setExpanded((e) => !e)}>
        <View style={{ flex: 1 }}>
          <Text style={styles.legCountry}>{country?.name ?? leg.country_code}</Text>
          <Text style={styles.legDates}>
            {formatShortDate(leg.start_date)} to {formatShortDate(leg.end_date)}
          </Text>
        </View>
        <Text style={styles.legCurrency}>{leg.currency_code}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.legBody}>
          <CountryPicker
            label="Country"
            countries={countries}
            value={leg.country_code}
            onChange={(c) =>
              onChange({ country_code: c.country_code, currency_code: c.currency_code })
            }
          />
          <DateField
            label="From"
            value={leg.start_date}
            onChange={(v) => isValidDate(v) && onChange({ start_date: v })}
          />
          <DateField
            label="To"
            value={leg.end_date}
            onChange={(v) => isValidDate(v) && onChange({ end_date: v })}
          />
          <Button title="Remove leg" variant="danger" onPress={onRemove} />
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    sectionLabel: {
      ...type.label,
      color: c.textMuted,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    typeRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
    typeCard: {
      flex: 1,
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.lg,
    },
    typeCardActive: { borderColor: c.accent, backgroundColor: c.accentSoft },
    typeTitle: { ...type.heading, color: c.text, marginBottom: 4 },
    typeDetail: { ...type.caption, color: c.textMuted, lineHeight: 16 },
    leg: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      marginBottom: spacing.md,
      overflow: 'hidden',
    },
    legHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: spacing.lg,
    },
    legCountry: { ...type.heading, color: c.text },
    legDates: { ...type.caption, color: c.textMuted, marginTop: 2 },
    legCurrency: {
      ...type.label,
      color: c.accent,
      backgroundColor: c.accentSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    legBody: {
      padding: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    budgetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    dot: { width: 10, height: 10, borderRadius: 5 },
    budgetLabel: { ...type.body, color: c.text, flex: 1 },
    budgetInput: { width: 110, textAlign: 'right' },
  });
