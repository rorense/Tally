import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Caption, Field, H1, Screen } from '../../src/components/ui';
import { useApp } from '../../src/hooks/useApp';
import { useAuth } from '../../src/hooks/useAuth';
import { useSync } from '../../src/hooks/useSync';
import { supabase } from '../../src/lib/supabase';
import { colors, spacing, type } from '../../src/theme/theme';

export default function JoinTripScreen() {
  const db = useSQLiteContext();
  const { session } = useAuth();
  const { refresh, setActiveTrip } = useApp();
  const { syncNow } = useSync();
  const params = useLocalSearchParams<{ code?: string }>();

  const [code, setCode] = useState(params.code?.toUpperCase() ?? '');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.code) setCode(params.code.toUpperCase());
  }, [params.code]);

  async function join() {
    setError(null);

    if (!supabase) return setError('This build has no sync credentials configured.');
    if (!session) return setError('Sign in first, then enter the code.');
    if (code.trim().length < 4) return setError('Enter the code from your travel partner.');

    setBusy(true);
    try {
      // The lookup runs inside a security definer function: RLS only shows you
      // trips you already belong to, so a non-member cannot find one by code.
      const { data, error: rpcError } = await supabase.rpc('join_trip_with_code', {
        p_code: code.trim().toUpperCase(),
        p_display_name: displayName.trim(),
      });

      if (rpcError) {
        setError(
          rpcError.message.includes('Invalid code')
            ? 'That code did not match a trip. Check it and try again.'
            : rpcError.message
        );
        return;
      }

      // Pull the trip and its expenses down before showing it.
      await syncNow('manual');
      if (typeof data === 'string') await setActiveTrip(data);
      refresh();
      router.replace('/(tabs)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join the trip.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={{ height: spacing.xl }} />
      <H1>Join a trip</H1>
      <Caption>
        Enter the code from the person who created the trip. You need to be online and signed in
        for this one step.
      </Caption>

      <View style={{ height: spacing.xl }} />

      <Card>
        <Field
          label="Trip code"
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
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
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeInput: { fontSize: 22, letterSpacing: 3, fontWeight: '700', textAlign: 'center' },
  error: { ...type.caption, color: colors.danger, marginBottom: spacing.md },
});
