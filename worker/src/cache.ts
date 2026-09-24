import { getById, toLyrics, toSong, type LrclibTrack } from './lrclib';
import type { Lyrics, Song } from './types';

const DAY_S = 24 * 3600;

interface CachedLyrics {
  song: Song;
  lyrics: Lyrics;
}

const keys = {
  lyrics: (id: number) => `lyrics:${id}`,
  acr: (acrId: string) => `acr:${acrId}`,
  miss: (acrId: string) => `miss:${acrId}`,
  translation: (id: number, lang: string) => `translation:${id}:${lang.trim().toLowerCase()}`,
};

export async function putTrack(kv: KVNamespace, track: LrclibTrack): Promise<CachedLyrics> {
  const value: CachedLyrics = { song: toSong(track), lyrics: toLyrics(track) };
  await kv.put(keys.lyrics(track.id), JSON.stringify(value), { expirationTtl: 30 * DAY_S });
  return value;
}

/** Lyrics by LRCLIB id, from KV if possible. Null if LRCLIB doesn't have the id. */
export async function getLyricsById(kv: KVNamespace, id: number): Promise<CachedLyrics | null> {
  const cached = await kv.get<CachedLyrics>(keys.lyrics(id), 'json');
  if (cached) return cached;
  const track = await getById(id);
  return track ? putTrack(kv, track) : null;
}

export const getAcrMapping = (kv: KVNamespace, acrId: string) =>
  kv.get(keys.acr(acrId)).then((v) => (v ? Number(v) : null));
export const putAcrMapping = (kv: KVNamespace, acrId: string, lrclibId: number) =>
  kv.put(keys.acr(acrId), String(lrclibId));

/** A failed recovery is remembered so repeat recognitions of the same track don't re-run it. */
export const hasMiss = (kv: KVNamespace, acrId: string) => kv.get(keys.miss(acrId)).then((v) => v !== null);
export const putMiss = (kv: KVNamespace, acrId: string) =>
  kv.put(keys.miss(acrId), '1', { expirationTtl: 7 * DAY_S });

/** `prefetched`: made silently ahead of time and not yet requested by anyone. */
export async function getTranslationEntry(kv: KVNamespace, id: number, lang: string) {
  const { value, metadata } = await kv.getWithMetadata<string[], { prefetched?: boolean }>(
    keys.translation(id, lang),
    'json'
  );
  return value ? { lines: value, prefetched: metadata?.prefetched === true } : null;
}
export const getTranslation = (kv: KVNamespace, id: number, lang: string) =>
  getTranslationEntry(kv, id, lang).then((e) => e?.lines ?? null);
export const putTranslation = (kv: KVNamespace, id: number, lang: string, lines: string[], prefetched = false) =>
  kv.put(keys.translation(id, lang), JSON.stringify(lines), { metadata: { prefetched } });
