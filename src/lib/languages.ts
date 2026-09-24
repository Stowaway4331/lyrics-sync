// Shared with the Worker (worker/src imports this file), so keep it free of
// React Native imports.

/**
 * Translation targets, most used first. Ordered by approximate total speakers
 * (native + second-language), which stands in for "most used" until real usage
 * data exists. Names are what the translation prompt receives.
 */
export const LANGUAGES = [
  'English',
  'Chinese (Simplified)',
  'Hindi',
  'Spanish',
  'Arabic',
  'French',
  'Bengali',
  'Portuguese',
  'Russian',
  'Urdu',
  'Indonesian',
  'German',
  'Japanese',
  'Tamil',
  'Turkish',
  'Korean',
  'Vietnamese',
  'Italian',
  'Thai',
  'Tagalog',
  'Chinese (Traditional)',
  'Polish',
  'Ukrainian',
  'Dutch',
  'Romanian',
  'Greek',
  'Czech',
  'Hungarian',
  'Swedish',
  'Hebrew',
] as const;

export type Language = (typeof LANGUAGES)[number];

/** Popularity rank of a language name (lower = more used); unknown names sort last. */
export function languageRank(name: string): number {
  const i = LANGUAGES.findIndex((l) => l.toLowerCase() === name.trim().toLowerCase());
  return i === -1 ? LANGUAGES.length : i;
}
