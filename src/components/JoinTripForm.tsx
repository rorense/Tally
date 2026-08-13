import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '../hooks/useApp';
import { useAuth } from '../hooks/useAuth';
import { useSync } from '../hooks/useSync';
import { isCompleteJoinCode, normalizeJoinCode } from '../lib/joinCode';
import { supabase } from '../lib/supabase';
import { requestFullPull } from '../lib/sync';
import { Colors, spacing, type } from '../theme/theme';
import { useThemedStyles } from '../theme/useTheme';
import { Button, Field } from './ui';

/**
 * Enter a partner's trip code, pull the shared trip down, and make it active.
 * Used from the dedicated join screen and from New trip.
 */
export function JoinTripForm({
  initialCode = '',
  onJoined,
}: {
  initialCode?: string;
  onJoined?: () => void;
}) {
  const db = useSQLiteContext();
  const { session } = useAuth();
  const { refresh, setActiveTrip, settings, updateSetting } = useApp();
  const { syncNow } = useSync();
  const styles = useThemedStyles(createStyles);

  const [code, setCode] = useState(initialCode ? normalizeJoinCode(initialCode) : '');
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join() {
    setError(null);

    if (!supabase) return setError('This build has no sync credentials configured.');
    if (!session) return setError('Sign in first, then enter the code.');
    const normalised = normalizeJoinCode(code);
    if (!isCompleteJoinCode(normalised)) {
      return setError('Enter the eight-character code from your travel partner.');
    }

    setBusy(true);
    try {
      const name = displayName.trim();
      if (name && name !== settings.displayName) {
        await updateSetting('displayName', name);
      }

      // The lookup runs inside a security definer function: RLS only shows you
      // trips you already belong to, so a non-member cannot find one by code.
      const { data, error: rpcError } = await supabase.rpc('join_trip_with_code', {
        p_code: normalised,
        p_display_name: name,
      });

      if (rpcError) {
        setError(
          rpcError.message.includes('Invalid code')
            ? 'That code did not match a trip. Check it and try again.'
            : rpcError.message
        );
        return;
      }

      // Everything about this trip was written before the device joined it, so
      // an incremental pull would skip the lot. Ask for the full set once.
      await requestFullPull(db);

      // Pull the trip and its expenses down before showing it.
      await syncNow('manual');
      if (typeof data === 'string') await setActiveTrip(data);
      refresh();
      onJoined?.();
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the trip.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Field
        label="Trip code"
        value={code}
        onChangeText={(v) => setCode(normalizeJoinCode(v))}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="EURO-4K7P"
        style={styles.codeInput}
      />
      <Field
        label="Your name"
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Shown on expenses you pay for"
        autoCapitalize="words"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!session ? (
        <>
          <Button title="Sign in first" onPress={() => router.push('/sign-in')} />
          <View style={{ height: spacing.md }} />
        </>
      ) : null}

      <Button title="Join trip" onPress={join} loading={busy} disabled={!session} />
    </>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    codeInput: { fontSize: 22, letterSpacing: 3, fontWeight: '700', textAlign: 'center' },
    error: { ...type.caption, color: c.danger, marginBottom: spacing.md },
  });
