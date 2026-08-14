import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Caption, H1, Screen } from '../../src/components/ui';
import { getTrip } from '../../src/db/repository';
import type { Trip } from '../../src/db/types';
import { Colors, radius, spacing, type } from '../../src/theme/theme';
import { useThemedStyles } from '../../src/theme/useTheme';

export default function ShareTripScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ id: string }>();
  const styles = useThemedStyles(createStyles);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (params.id) getTrip(db, params.id).then(setTrip);
  }, [db, params.id]);

  if (!trip) return <Screen />;

  // Sent alongside the code rather than instead of it. The link only opens for
  // someone who already has Tally installed, and `createURL` resolves to the
  // dev server's exp:// address under Expo Go, so the typed code stays the
  // instruction that always works.
  const joinLink = Linking.createURL(`/join/${trip.join_code}`);
  const message =
    `Join my "${trip.name}" budget on Tally.\n\n` +
    `Code: ${trip.join_code}\n\n` +
    `Already have the app? ${joinLink}`;

  return (
    <Screen>
      <View style={{ height: spacing.lg }} />
      <H1>Share {trip.name}</H1>
      <Caption>
        Your travel partner installs the app, creates their own account, then enters this code
        under Join a trip.
      </Caption>

      <View style={{ height: spacing.xl }} />

      <Card>
        <View style={styles.codeBox}>
          <Text style={styles.code}>{trip.join_code}</Text>
        </View>

        <Button
          title={copied ? 'Copied' : 'Copy code'}
          variant="secondary"
          onPress={async () => {
            await Clipboard.setStringAsync(trip.join_code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        />
        <View style={{ height: spacing.md }} />
        <Button title="Share code" onPress={() => Share.share({ message })} />
      </Card>

      <Card>
        <Text style={styles.note}>
          The code avoids characters that are easy to confuse when typed by hand from a phone
          screen.
        </Text>
      </Card>
    </Screen>
  );
}

const createStyles = (c: Colors) =>
  StyleSheet.create({
    codeBox: {
      backgroundColor: c.surfaceRaised,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      paddingVertical: spacing.xl,
      alignItems: 'center',
      marginBottom: spacing.lg,
    },
    code: { fontSize: 34, fontWeight: '800', color: c.text, letterSpacing: 5 },
    note: { ...type.caption, color: c.textMuted, lineHeight: 18 },
  });
