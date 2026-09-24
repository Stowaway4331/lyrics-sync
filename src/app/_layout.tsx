import '@/global.css';

import { PortalHost } from '@rn-primitives/portal';
import { Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect } from 'react';

import { startLive } from '@/lib/live';
import { loadPrefs } from '@/lib/player-store';
import { NAV_THEME } from '@/lib/theme';

export default function RootLayout() {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';

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
