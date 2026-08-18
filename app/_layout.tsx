import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, Suspense } from 'react';
import { ActivityIndicator, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import 'react-native-url-polyfill/auto';
import { migrateDbIfNeeded } from '../src/db/migrations';
import { AppProvider, useApp } from '../src/hooks/useApp';
import { AuthProvider } from '../src/hooks/useAuth';
import { RatesProvider } from '../src/hooks/useRates';
import { SyncProvider } from '../src/hooks/useSync';
import { palettes } from '../src/theme/theme';
import { resolveSystemScheme, ThemeProvider, useTheme } from '../src/theme/useTheme';

/**
 * Shown while the database opens, which is before the stored theme preference
 * can be read, so this one screen follows the OS rather than the app setting.
 */
function Loading() {
  const colors = palettes[resolveSystemScheme(useColorScheme())];
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

/** Bridges the persisted preference into the theme, once settings are readable. */
function Themed({ children }: { children: ReactNode }) {
  const { settings } = useApp();
  return <ThemeProvider preference={settings.themePreference}>{children}</ThemeProvider>;
}

function Navigator() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          // A bare chevron. The screen behind is whichever tab you pushed from,
          // so no one back label is right for all of them. iOS only; Android
          // already draws the arrow on its own.
          headerBackButtonDisplayMode: 'minimal',
          contentStyle: { backgroundColor: colors.bg },
        }}>
        {/*
          * Header hidden, but still titled: the back chevron long-presses into a
          * menu listing earlier screens by title, and with none set React
          * Navigation falls back to the route name and shows "(tabs)" there.
          */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Tally' }} />
        <Stack.Screen name="expense/[id]" options={{ title: 'Expense', presentation: 'modal' }} />
        <Stack.Screen name="trip/edit" options={{ title: 'Trip' }} />
        <Stack.Screen name="trip/join" options={{ title: 'Join a trip' }} />
        <Stack.Screen name="trip/share" options={{ title: 'Share' }} />
        <Stack.Screen name="sign-in" options={{ title: 'Account', presentation: 'modal' }} />
        <Stack.Screen name="join/[code]" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Suspense fallback={<Loading />}>
          <SQLiteProvider databaseName="travelbudget.db" onInit={migrateDbIfNeeded} useSuspense>
            <AuthProvider>
              <AppProvider>
                <Themed>
                  <RatesProvider>
                    <SyncProvider>
                      <Navigator />
                    </SyncProvider>
                  </RatesProvider>
                </Themed>
              </AppProvider>
            </AuthProvider>
          </SQLiteProvider>
        </Suspense>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
