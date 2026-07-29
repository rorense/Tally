import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { Colors, onFill, radius, spacing, type } from '../theme/theme';
import { useTheme, useThemedStyles } from '../theme/useTheme';
import { TripSwitcherHeader } from './TripSwitcherHeader';

/**
 * Compact header control. When signed out, opens the account modal. When signed
 * in, a tap on the email snippet jumps to Settings for sync / sign-out.
 */
export function AuthHeaderButton() {
  const { configured, session, email } = useAuth();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();

  if (!configured) return null;

  if (!session) {
    return (
      <Pressable
        onPress={() => router.push('/sign-in')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Sign in or create an account"
        style={styles.signInHit}>
        <Text style={[styles.signInLabel, { color: onFill(colors.accent) }]}>Sign in</Text>
      </Pressable>
    );
  }

  const short = email?.split('@')[0] ?? 'Account';
  return (
    <Pressable
      onPress={() => router.push('/(tabs)/settings')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={`Signed in as ${email}. Open settings.`}
      style={styles.accountHit}>
      <Text style={styles.accountLabel} numberOfLines={1}>
        {short}
      </Text>
    </Pressable>
  );
}

/** Trip switcher (when a trip is active) plus auth, for tab headerRight. */
export function HeaderActions() {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <AuthHeaderButton />
      <TripSwitcherHeader />
    </View>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginRight: spacing.sm,
    },
    signInHit: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: c.accent,
    },
    signInLabel: {
      ...type.caption,
      fontWeight: '700',
    },
    accountHit: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceRaised,
      borderWidth: 1,
      borderColor: c.border,
      maxWidth: 100,
    },
    accountLabel: {
      ...type.caption,
      color: c.textMuted,
      fontWeight: '600',
    },
  });
