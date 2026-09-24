import { Tabs } from 'expo-router/js-tabs';
import { History, MessageCircle, Mic } from 'lucide-react-native';
import { useColorScheme } from 'nativewind';

import { THEME } from '@/lib/theme';

export default function TabLayout() {
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        tabBarActiveTintColor: theme.foreground,
        tabBarInactiveTintColor: theme.mutedForeground,
        tabBarStyle: { borderTopColor: theme.border },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Listen', tabBarIcon: ({ color, size }) => <Mic color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="chat"
        options={{ title: 'Chat', tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="history"
        options={{ title: 'History', tabBarIcon: ({ color, size }) => <History color={color} size={size} /> }}
      />
    </Tabs>
  );
}
