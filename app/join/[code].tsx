import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Target of the `tally://join/EURO-4K7P` deep link. Forwards straight to
 * the join screen with the code pre-filled.
 */
export default function JoinDeepLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={`/trip/join?code=${encodeURIComponent(code ?? '')}`} />;
}
