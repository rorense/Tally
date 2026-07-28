import * as FileSystem from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SyncBanner } from '../../src/components/SyncBanner';
import { Body, Button, Card, Caption, Field, Screen } from '../../src/components/ui';
import { listMembers } from '../../src/db/repository';
import type { TripMember } from '../../src/db/types';
import { buildExport } from '../../src/lib/export';
import { rateAgeLabel } from '../../src/lib/fx';
import { parseAmount } from '../../src/lib/money';
import { seedRehearsalTrip } from '../../src/lib/seed';
import { useApp } from '../../src/hooks/useApp';
import { useAuth } from '../../src/hooks/useAuth';
import { useRates } from '../../src/hooks/useRates';
import { useSync } from '../../src/hooks/useSync';
import { colors, radius, spacing, type } from '../../src/theme/theme';

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { activeTrip, trips, setActiveTrip, settings, updateSetting, refresh } = useApp();
  const { session, email, configured, signOut } = useAuth();
  const { rates, refresh: refreshRates, refreshing } = useRates();
  const { syncNow, syncing, pending } = useSync();

  const [members, setMembers] = useState<TripMember[]>([]);
  const [markup, setMarkup] = useState(String(settings.cardMarkupPct));
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [exporting, setExporting] = useState<'xlsx' | 'csv' | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (activeTrip) listMembers(db, activeTrip.id).then(setMembers);
    }, [db, activeTrip])
  );

  const nzdSample = rates.get('EUR');

  async function runExport(format: 'xlsx' | 'csv') {
    if (!activeTrip) return;
    setExporting(format);
    try {
      const data = await buildExport(db, activeTrip);
      if (data.rowCount === 0) {
        return Alert.alert('Nothing to export', 'Log some expenses first.');
      }

      const isExcel = format === 'xlsx';
      const file = new FileSystem.File(
        FileSystem.Paths.cache,
        `${data.baseName}.${isExcel ? 'xlsx' : 'csv'}`
      );
      if (file.exists) file.delete();
      file.create();

      if (isExcel) file.write(data.xlsx);
      else file.write(data.csv);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: isExcel
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
          dialogTitle: `${activeTrip.name} expenses`,
          UTI: isExcel ? 'org.openxmlformats.spreadsheetml.sheet' : 'public.comma-separated-values-text',
        });
      } else {
        Alert.alert('Exported', `Saved to ${file.uri}`);
      }
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Could not build the file.');
    } finally {
      setExporting(null);
    }
  }

  function saveMarkup() {
    const parsed = parseAmount(markup) ?? 0;
    const clamped = Math.min(Math.max(parsed, 0), 15);
    setMarkup(String(clamped));
    updateSetting('cardMarkupPct', clamped);
  }

  return (
    <Screen>
      <SyncBanner />

      <Card>
        <Text style={styles.cardTitle}>Trips</Text>
        {trips.length === 0 ? (
          <Body muted>No trips yet.</Body>
        ) : (
          trips.map((t) => (
            <Pressable
              key={t.id}
              style={[styles.tripRow, t.id === activeTrip?.id && styles.tripRowActive]}
              onPress={() => setActiveTrip(t.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.tripName}>{t.name}</Text>
                <Text style={styles.tripMeta}>
                  {`${t.start_date} to ${t.end_date}`}
                </Text>
              </View>
              {t.id === activeTrip?.id ? <Text style={styles.activeTag}>Active</Text> : null}
            </Pressable>
          ))
        )}
        <View style={{ height: spacing.md }} />
        <Button title="New trip" variant="secondary" onPress={() => router.push('/trip/edit')} />
      </Card>

      {activeTrip ? (
        <Card>
          <Text style={styles.cardTitle}>Share this trip</Text>
          <Caption>
            Your travel partner installs the app, signs in, then taps Join a trip and enters this
            code.
          </Caption>
          <View style={styles.codeBox}>
            <Text style={styles.code}>{activeTrip.join_code}</Text>
          </View>
          <Button
            title="Share code"
            variant="secondary"
            onPress={() => router.push(`/trip/share?id=${activeTrip.id}`)}
          />
          <View style={{ height: spacing.lg }} />
          <Text style={styles.subLabel}>Members</Text>
          {members.length === 0 ? (
            <Caption>Just you so far.</Caption>
          ) : (
            members.map((m) => (
              <Text key={m.id} style={styles.member}>
                {m.display_name || 'Traveller'}
                {m.user_id === session?.user.id ? ' (you)' : ''}
              </Text>
            ))
          )}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.cardTitle}>Sync</Text>
        {!configured ? (
          <Caption>
            This build has no Supabase credentials, so it runs as a local-only ledger. Add
            EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable sharing.
          </Caption>
        ) : session ? (
          <>
            <Body muted>{email}</Body>
            <View style={{ height: spacing.lg }} />
            <Field
              label="Your name"
              value={displayName}
              onChangeText={setDisplayName}
              onBlur={() => updateSetting('displayName', displayName.trim())}
              placeholder="Shown on expenses you pay for"
              autoCapitalize="words"
            />
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchLabel}>Only sync on wifi</Text>
                <Caption>Protects a limited eSIM plan. Pull to refresh syncs regardless.</Caption>
              </View>
              <Switch
                value={settings.wifiOnlySync}
                onValueChange={(v) => updateSetting('wifiOnlySync', v)}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
            </View>
            <View style={{ height: spacing.lg }} />
            <Button
              title={syncing ? 'Syncing' : pending > 0 ? `Sync now (${pending} waiting)` : 'Sync now'}
              variant="secondary"
              loading={syncing}
              onPress={async () => {
                await syncNow('manual');
                refresh();
              }}
            />
            <View style={{ height: spacing.md }} />
            <Button title="Sign out" variant="secondary" onPress={signOut} />
          </>
        ) : (
          <>
            <Caption>
              Sign in to share this trip with your travel partner. Everything works offline either
              way.
            </Caption>
            <View style={{ height: spacing.lg }} />
            <Button title="Sign in" onPress={() => router.push('/sign-in')} />
            <View style={{ height: spacing.md }} />
            <Button
              title="Join a trip with a code"
              variant="secondary"
              onPress={() => router.push('/trip/join')}
            />
          </>
        )}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Exchange rates</Text>
        <Caption>
          {rates.size > 0
            ? `${rates.size} currencies cached \u00B7 ${rateAgeLabel(nzdSample?.fetched_at) ?? 'unknown age'}`
            : 'No rates cached yet. Connect once before you fly.'}
        </Caption>
        <View style={{ height: spacing.lg }} />
        <Field
          label="Card markup %"
          value={markup}
          onChangeText={setMarkup}
          onBlur={saveMarkup}
          keyboardType="decimal-pad"
          placeholder="0"
          hint="Banks add roughly 1-3% over the mid-market rate. Setting this makes NZD totals match your statement more closely."
        />
        <Button
          title={refreshing ? 'Refreshing' : 'Refresh rates now'}
          variant="secondary"
          loading={refreshing}
          onPress={async () => {
            const ok = await refreshRates();
            if (!ok) Alert.alert('Could not reach the rate service', 'Cached rates are still in use.');
          }}
        />
      </Card>

      <Card>
        <Text style={styles.cardTitle}>Export</Text>
        <Caption>
          Every expense on this trip, including the rate each one was locked at. The Excel
          workbook adds a summary sheet with totals by category and country.
        </Caption>
        <View style={{ height: spacing.lg }} />
        <Button
          title={exporting === 'xlsx' ? 'Building workbook' : 'Export to Excel'}
          loading={exporting === 'xlsx'}
          onPress={() => runExport('xlsx')}
        />
        <View style={{ height: spacing.md }} />
        <Button
          title={exporting === 'csv' ? 'Building CSV' : 'Export CSV'}
          variant="secondary"
          loading={exporting === 'csv'}
          onPress={() => runExport('csv')}
        />
      </Card>

      {__DEV__ ? (
        <Card>
          <Text style={styles.cardTitle}>Rehearsal</Text>
          <Caption>
            Creates a throwaway trip with three legs and sample expenses. Use it to run the
            airplane-mode sync test on both phones before you fly.
          </Caption>
          <View style={{ height: spacing.lg }} />
          <Button
            title="Seed rehearsal trip"
            variant="secondary"
            onPress={async () => {
              const id = await seedRehearsalTrip(db);
              await setActiveTrip(id);
              refresh();
              Alert.alert('Seeded', 'A rehearsal trip is now active.');
            }}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardTitle: { ...type.heading, color: colors.text, marginBottom: spacing.sm },
  subLabel: {
    ...type.label,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xs,
  },
  tripRowActive: { backgroundColor: colors.accentSoft },
  tripName: { ...type.body, color: colors.text },
  tripMeta: { ...type.caption, color: colors.textFaint, marginTop: 1 },
  activeTag: { ...type.caption, color: colors.accent, fontWeight: '700' },
  codeBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  code: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: 4 },
  member: { ...type.body, color: colors.text, paddingVertical: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  switchLabel: { ...type.body, color: colors.text },
});
