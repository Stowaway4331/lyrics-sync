import type { Lyrics, Song } from './types';

const BASE = 'https://lrclib.net/api';
// LRCLIB asks clients to identify themselves.
const USER_AGENT = 'lyrics-sync/0.1';
const TIMEOUT_MS = 5000;

export interface LrclibTrack {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  /** Seconds. */
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

export class LrclibUnavailable extends Error {}

async function request<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

  // LRCLIB answers 503 "server is busy" under load; one quick retry usually succeeds.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 503 || attempt === 1) throw new LrclibUnavailable(`LRCLIB ${res.status}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

/** Exact lookup: LRCLIB matches the duration within about ±2 s. */
export function getTrack(t: { title: string; artist: string; album: string; durationS: number }) {
  return request<LrclibTrack>('/get', {
    track_name: t.title,
    artist_name: t.artist,
    album_name: t.album,
    duration: String(Math.round(t.durationS)),
  });
}

export function getById(id: number) {
  return request<LrclibTrack>(`/get/${id}`);
}

export async function searchTracks(q: { title: string; artist?: string } | { q: string }) {
  const params: Record<string, string> =
    'q' in q
      ? { q: q.q }
      : { track_name: q.title, ...(q.artist ? { artist_name: q.artist } : {}) };
  return (await request<LrclibTrack[]>('/search', params)) ?? [];
}

export function toLyrics(t: LrclibTrack): Lyrics {
  return {
    lrclibId: t.id,
    synced: t.syncedLyrics,
    plain: t.plainLyrics,
    instrumental: t.instrumental,
    durationMs: Math.round(t.duration * 1000),
  };
}

export function toSong(t: LrclibTrack, acrId: string | null = null): Song {
  return {
    lrclibId: t.id,
    acrId,
    title: t.trackName,
    artist: t.artistName,
    album: t.albumName,
    durationMs: Math.round(t.duration * 1000),
  };
}
