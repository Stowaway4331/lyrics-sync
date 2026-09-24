import type { LrclibTrack } from './lrclib';

/** LRCLIB and ACRCloud durations for the same recording usually agree within this. */
export const DURATION_TOLERANCE_S = 2;

/**
 * Cheap, deterministic title cleanup tried before asking the LLM:
 * drops "(feat. X)", "[Remastered 2011]", "- Radio Edit" and similar suffixes.
 */
export function basicCleanTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*\b(feat|ft|with|remaster(ed)?|version|edit|mix|live|mono|stereo|deluxe|bonus)\b[^)\]]*[)\]]/gi, '')
    .replace(/\s+-\s+.*\b(remaster(ed)?|version|edit|mix|live|mono|stereo)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function primaryArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|;|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0]?.trim() || artist;
}

export interface DurationPick {
  track: LrclibTrack;
  diffS: number;
  withinTolerance: boolean;
}

/**
 * Picks the candidate closest in duration, preferring ones with synced lyrics.
 * Returns null when there are no usable candidates.
 */
export function pickByDuration(
  candidates: LrclibTrack[],
  durationS: number,
  excludeIds: number[] = []
): DurationPick | null {
  const usable = candidates.filter(
    (c) => !excludeIds.includes(c.id) && (c.syncedLyrics || c.plainLyrics || c.instrumental)
  );
  if (usable.length === 0) return null;

  const score = (c: LrclibTrack) => {
    const diffS = Math.abs(c.duration - durationS);
    const within = diffS <= DURATION_TOLERANCE_S;
    // Within tolerance beats outside; then synced beats plain; then closer beats further.
    return (within ? 0 : 1_000_000) + (c.syncedLyrics ? 0 : 10_000) + diffS;
  };
  const best = usable.reduce((a, b) => (score(b) < score(a) ? b : a));
  const diffS = Math.abs(best.duration - durationS);
  return { track: best, diffS, withinTolerance: diffS <= DURATION_TOLERANCE_S };
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * How well a remembered snippet matches real lyrics, 0..1: the best share of
 * snippet words found in any same-length window of the lyrics. Tolerates
 * misheard words and small reorderings.
 */
export function snippetScore(snippet: string, lyrics: string): number {
  const s = tokens(snippet);
  const l = tokens(lyrics);
  if (s.length === 0 || l.length === 0) return 0;

  const windowSize = Math.min(l.length, s.length + 2);
  let best = 0;
  for (let start = 0; start + windowSize <= l.length; start++) {
    const window = new Map<string, number>();
    for (let i = start; i < start + windowSize; i++) window.set(l[i], (window.get(l[i]) ?? 0) + 1);
    let hits = 0;
    for (const word of s) {
      const n = window.get(word) ?? 0;
      if (n > 0) {
        hits++;
        window.set(word, n - 1);
      }
    }
    best = Math.max(best, hits / s.length);
    if (best === 1) break;
  }
  return best;
}

export const SNIPPET_MATCH_THRESHOLD = 0.7;
