import { DarkTheme, DefaultTheme, type Theme } from 'expo-router';
import { useColorScheme } from 'nativewind';

export const THEME = {
  light: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(0 0% 3.9%)',
    card: 'hsl(0 0% 100%)',
    primary: 'hsl(0 0% 9%)',
    muted: 'hsl(0 0% 96.1%)',
    mutedForeground: 'hsl(0 0% 45.1%)',
    destructive: 'hsl(0 84.2% 60.2%)',
    border: 'hsl(0 0% 89.8%)',
  },
  dark: {
    background: 'hsl(0 0% 3.9%)',
    foreground: 'hsl(0 0% 98%)',
    card: 'hsl(0 0% 3.9%)',
    primary: 'hsl(0 0% 98%)',
    muted: 'hsl(0 0% 14.9%)',
    mutedForeground: 'hsl(0 0% 63.9%)',
    destructive: 'hsl(0 70.9% 59.4%)',
    border: 'hsl(0 0% 14.9%)',
  },
};

/**
 * Background of the native root view behind React. Hex, because the native side
 * doesn't parse the space-separated hsl() form used above.
 */
export const ROOT_BACKGROUND = { light: '#ffffff', dark: '#0a0a0a' } as const;

/**
 * Placeholder text (muted-foreground). Passed as `placeholderTextColor`
 * because the class-based placeholder colour doesn't follow dark mode on native.
 */
export const PLACEHOLDER_COLOR = { light: '#737373', dark: '#a3a3a3' } as const;

/** Placeholder colour for the current colour scheme. */
export function usePlaceholderColor(): string {
  const { colorScheme } = useColorScheme();
  return PLACEHOLDER_COLOR[colorScheme === 'dark' ? 'dark' : 'light'];
}

export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      background: THEME.light.background,
      border: THEME.light.border,
      card: THEME.light.card,
      notification: THEME.light.destructive,
      primary: THEME.light.primary,
      text: THEME.light.foreground,
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      background: THEME.dark.background,
      border: THEME.dark.border,
      card: THEME.dark.card,
      notification: THEME.dark.destructive,
      primary: THEME.dark.primary,
      text: THEME.dark.foreground,
    },
  },
};
