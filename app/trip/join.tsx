import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { JoinTripForm } from '../../src/components/JoinTripForm';
import { Card, Caption, H1, Screen } from '../../src/components/ui';
import { normalizeJoinCode } from '../../src/lib/joinCode';
import { spacing } from '../../src/theme/theme';

export default function JoinTripScreen() {
  const params = useLocalSearchParams<{ code?: string }>();
  const [code, setCode] = useState(params.code ? normalizeJoinCode(params.code) : '');

  useEffect(() => {
    if (params.code) setCode(normalizeJoinCode(params.code));
  }, [params.code]);

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
        <JoinTripForm key={code || 'empty'} initialCode={code} />
      </Card>
    </Screen>
  );
}
