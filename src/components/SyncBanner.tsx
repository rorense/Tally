import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { useSync } from '../hooks/useSync';
import { colors, radius, spacing, type } from '../theme/theme';

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const mins = (Date.now() - new Date(iso).getTime()) / 60000;
  if (mins < 1) return 'just now';
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Ambient sync status. Deliberately non-blocking: everything still works while
 * this says "offline", because the UI reads from SQLite regardless.
 */
export function SyncBanner() {
  const { configured, session } = useAuth();
  const { syncing, pending, lastPulledAt, online, onWifi, wifiBlocked } = useSyncStatus();

  if (!configured) return null;

  if (!session) {
    return (
      <Pressable style={styles.banner} onPress={() => router.push('/sign-in')}>
        <View style={[styles.dot, { backgroundColor: colors.textFaint }]} />
        <Text style={styles.text}>Sign in to sync with your travel partner</Text>
        <Text style={styles.action}>Sign in</Text>
      </Pressable>
    );
  }

  const label = syncing
    ? 'Syncing'
    : !online
      ? `Offline${pending > 0 ? ` \u00B7 ${pending} waiting` : ''}`
      : wifiBlocked
        ? `On cellular \u00B7 ${pending} waiting for wifi`
        : pending > 0
          ? `${pending} waiting to sync`
          : `Synced ${relativeTime(lastPulledAt)}`;

  const tint = syncing
    ? colors.accent
    : !online || wifiBlocked
      ? colors.warning
      : pending > 0
        ? colors.warning
        : colors.success;

  return (
    <View style={styles.banner}>
      <View style={[styles.dot, { backgroundColor: tint }]} />
      <Text style={styles.text}>{label}</Text>
      {!onWifi && online ? <Text style={styles.meta}>cellular</Text> : null}
    </View>
  );
}

function useSyncStatus() {
  const sync = useSync();
  return {
    ...sync,
    wifiBlocked: sync.online && !sync.onWifi && sync.pending > 0,
  };
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.lg,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { ...type.caption, color: colors.textMuted, flex: 1 },
  meta: { ...type.caption, color: colors.textFaint },
  action: { ...type.caption, color: colors.accent, fontWeight: '700' },
});
