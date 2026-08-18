import { Tabs } from 'expo-router';
import { ColorValue, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderActions } from '../../src/components/AuthHeader';
import { BrandHeaderTitle } from '../../src/components/BrandHeader';
import { spacing } from '../../src/theme/theme';
import { useTheme } from '../../src/theme/useTheme';

/**
 * Room for a tab's glyph, its label, and the padding the tab itself carries.
 *
 * The bar is a fixed-height box, and the safe area below it is padding inside
 * that box rather than extra height, so whatever the content does not fit into
 * spills over the home indicator instead of pushing the bar taller. React
 * Navigation's stock 49 only just covers a default tab; the glyph and label
 * here are a little larger, and the breathing space above them costs more
 * still, so the bar is measured for what it actually holds.
 */
const tabBarContentHeight = 56;

/**
 * Text glyph icons rather than an icon font: keeps the bundle small and avoids
 * a native dependency for something this simple.
 */
function TabIcon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;
}

function brandHeader(section?: string) {
  return {
    title: section ?? 'Tally',
    headerTitleAlign: 'left' as const,
    headerTitle: () => <BrandHeaderTitle section={section} />,
    headerRight: () => <HeaderActions />,
  };
}

export default function TabsLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700' },
        headerShadowVisible: false,
        headerRight: () => <HeaderActions />,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingTop: spacing.xs,
          // Naming a height means naming the inset too: React Navigation reads
          // a numeric height as the whole bar and stops adding its own safe
          // area allowance on top.
          height: tabBarContentHeight + insets.bottom,
        },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          ...brandHeader(),
          tabBarLabel: 'Trip',
          tabBarIcon: ({ color }) => <TabIcon glyph={'\u25C6'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="expenses"
        options={{
          ...brandHeader('Expenses'),
          tabBarIcon: ({ color }) => <TabIcon glyph={'\u2261'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="charts"
        options={{
          ...brandHeader('Charts'),
          tabBarIcon: ({ color }) => <TabIcon glyph={'\u25E7'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cashback"
        options={{
          ...brandHeader('Cashback'),
          tabBarIcon: ({ color }) => <TabIcon glyph={'\u21BA'} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          ...brandHeader('Settings'),
          tabBarIcon: ({ color }) => <TabIcon glyph={'\u2699'} color={color} />,
        }}
      />
    </Tabs>
  );
}
