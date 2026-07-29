import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Body, Button, Card, Caption, ChipRow, Field, H1, Screen } from '../src/components/ui';
import { useAuth } from '../src/hooks/useAuth';
import { Colors, spacing, type } from '../src/theme/theme';
import { useThemedStyles } from '../src/theme/useTheme';

type Mode = 'in' | 'up';

export default function SignInScreen() {
  const { signIn, signUp, configured } = useAuth();
  const styles = useThemedStyles(createStyles);
  const params = useLocalSearchParams<{ mode?: string }>();
  const [mode, setMode] = useState<Mode>(params.mode === 'up' ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.mode === 'up' || params.mode === 'in') setMode(params.mode);
  }, [params.mode]);

  async function submit() {
    setError(null);
    setNotice(null);
    if (!email.trim() || password.length < 6) {
      return setError('Enter an email and a password of at least 6 characters.');
    }

    setBusy(true);
    try {
      if (mode === 'in') {
        const result = await signIn(email, password);
        if (result.error) setError(result.error);
        else router.back();
        return;
      }

      const result = await signUp(email, password);
      if (result.error) {
        setError(result.error);
      } else if (result.needsEmailConfirmation) {
        // Do not navigate away: there is no session yet, and leaving silently
        // would look like the account was created and then forgotten.
        setNotice(
          'Account created. Check your email for a confirmation link, then come back and sign in. To skip this step, turn off "Confirm email" in Supabase under Authentication > Sign In / Providers.'
        );
        setMode('in');
      } else {
        router.back();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <Screen>
        <Card>
          <H1>Sync not configured</H1>
          <Body muted>
            This build has no Supabase credentials. The app still works as a local-only ledger on
            this device.
          </Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ height: spacing.xl }} />
      <H1>{mode === 'in' ? 'Sign in' : 'Create account'}</H1>
      <Caption>
        Email and password rather than a magic link, so you can always get back in without needing
        working email access while travelling.
      </Caption>

      <View style={{ height: spacing.lg }} />

      <ChipRow
        options={['Sign in', 'Create account'] as const}
        value={mode === 'in' ? 'Sign in' : 'Create account'}
        onChange={(v) => {
          setError(null);
          setNotice(null);
          setMode(v === 'Create account' ? 'up' : 'in');
        }}
      />

      <View style={{ height: spacing.lg }} />

      <Card>
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          placeholder="you@example.com"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          revealable
          autoCapitalize="none"
          textContentType={mode === 'up' ? 'newPassword' : 'password'}
          autoComplete={mode === 'up' ? 'new-password' : 'password'}
          placeholder="At least 6 characters"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <Button
          title={mode === 'in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          loading={busy}
        />
      </Card>
    </Screen>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    error: { ...type.caption, color: c.danger, marginBottom: spacing.md },
    notice: { ...type.caption, color: c.success, marginBottom: spacing.md, lineHeight: 17 },
  });
