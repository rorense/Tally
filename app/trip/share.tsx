import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Caption, H1, Screen } from '../../src/components/ui';
import { getTrip } from '../../src/db/repository';
import type { Trip } from '../../src/db/types';
import { colors, radius, spacing, type } from '../../src/theme/theme';

export default function ShareTripScreen() {
  const db = useSQLiteContext();
  const params = useLocalSearchParams<{ id: string }>();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (params.id) getTrip(db, params.id).then(setTrip);
  }, [db, params.id]);

  if (!trip) return <Screen />;

  const link = `tally://join/${trip.join_code}`;
  const message = `Join my "${trip.name}" budget on Tally.\n\nCode: ${trip.join_code}\n\nOr tap: ${link}`;

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
        <Button title="Share link" onPress={() => Share.share({ message })} />
      </Card>

      <Card>
        <Text style={styles.note}>
          The link only opens the app if it is already installed. Before the app is on the stores,
          typing the code by hand is the reliable path, which is why the code avoids characters
          that are easy to confuse.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  code: { fontSize: 34, fontWeight: '800', color: colors.text, letterSpacing: 5 },
  note: { ...type.caption, color: colors.textMuted, lineHeight: 18 },
});
