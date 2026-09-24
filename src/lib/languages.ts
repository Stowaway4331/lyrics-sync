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

/** ISO 639-1 codes for the languages above (ACRCloud reports song languages this way). */
const CODES: Record<string, Language> = {
  en: 'English', zh: 'Chinese (Simplified)', hi: 'Hindi', es: 'Spanish', ar: 'Arabic', fr: 'French',
  bn: 'Bengali', pt: 'Portuguese', ru: 'Russian', ur: 'Urdu', id: 'Indonesian', de: 'German',
  ja: 'Japanese', ta: 'Tamil', tr: 'Turkish', ko: 'Korean', vi: 'Vietnamese', it: 'Italian',
  th: 'Thai', tl: 'Tagalog', pl: 'Polish', uk: 'Ukrainian', nl: 'Dutch', ro: 'Romanian',
  el: 'Greek', cs: 'Czech', hu: 'Hungarian', sv: 'Swedish', he: 'Hebrew',
};

/** Language name for a code like "en" or "zh-Hant"; null if it isn't one we translate to. */
export function languageFromCode(code: string): Language | null {
  const c = code.trim().toLowerCase();
  if (c === 'zh-hant' || c === 'zh-tw' || c === 'zh-hk') return 'Chinese (Traditional)';
  return CODES[c.split(/[-_]/)[0]] ?? null;
}

/** Popularity rank of a language name (lower = more used); unknown names sort last. */
export function languageRank(name: string): number {
  const i = LANGUAGES.findIndex((l) => l.toLowerCase() === name.trim().toLowerCase());
  return i === -1 ? LANGUAGES.length : i;
}
