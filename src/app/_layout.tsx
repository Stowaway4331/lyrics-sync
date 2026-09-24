import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

import { startLive } from '@/lib/live';
import { loadPrefs } from '@/lib/player-store';
import { NAV_THEME, ROOT_BACKGROUND } from '@/lib/theme';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';

  // The native root view shows through during screen transitions; if it stays
  // white, dark mode flashes white on every navigation.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(ROOT_BACKGROUND[scheme]);
  }, [scheme]);

  useEffect(() => {
    void startLive();
    void loadPrefs();
  }, []);

  return (
    <ThemeProvider value={NAV_THEME[scheme]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShadowVisible: false, headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="player" options={{ title: '' }} />
        <Stack.Screen name="language" options={{ presentation: 'modal', title: 'Translate to' }} />
      </Stack>
      <PortalHost />
    </ThemeProvider>
  );
}
