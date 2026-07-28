import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { Suspense } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-url-polyfill/auto';
import { migrateDbIfNeeded } from '../src/db/migrations';
import { AppProvider } from '../src/hooks/useApp';
import { AuthProvider } from '../src/hooks/useAuth';
import { RatesProvider } from '../src/hooks/useRates';
import { SyncProvider } from '../src/hooks/useSync';
import { colors } from '../src/theme/theme';

function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

const styles = {
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Suspense fallback={<Loading />}>
          <SQLiteProvider databaseName="travelbudget.db" onInit={migrateDbIfNeeded} useSuspense>
            <AuthProvider>
              <AppProvider>
                <RatesProvider>
                  <SyncProvider>
                    <Stack
                      screenOptions={{
                        headerStyle: { backgroundColor: colors.bg },
                        headerTintColor: colors.text,
                        headerTitleStyle: { fontWeight: '700' },
                        headerShadowVisible: false,
                        contentStyle: { backgroundColor: colors.bg },
                      }}>
                      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                      <Stack.Screen
                        name="expense/[id]"
                        options={{ title: 'Expense', presentation: 'modal' }}
                      />
                      <Stack.Screen name="trip/edit" options={{ title: 'Trip' }} />
                      <Stack.Screen name="trip/join" options={{ title: 'Join a trip' }} />
                      <Stack.Screen name="trip/share" options={{ title: 'Share' }} />
                      <Stack.Screen
                        name="sign-in"
                        options={{ title: 'Sign in', presentation: 'modal' }}
                      />
                      <Stack.Screen name="join/[code]" options={{ headerShown: false }} />
                    </Stack>
                  </SyncProvider>
                </RatesProvider>
              </AppProvider>
            </AuthProvider>
          </SQLiteProvider>
        </Suspense>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
