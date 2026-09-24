import { useSyncExternalStore } from 'react';

import * as api from './api';
import type { Lyrics, RecognizeResponse, Song } from './api';
import { awaitJob } from './live';
import { now } from './sync';

export interface Translation {
  lang: string;
  status: 'running' | 'complete' | 'failed';
  lines: string[] | null;
}

export interface PlayerState {
  song: Song;
  lyrics: Lyrics | null;
  /** "finding" while lookup recovery runs in the background. */
  lyricsStatus: 'found' | 'finding' | 'none';
  /** Closest LRCLIB version was used, but its duration differs from the recording. */
  versionMismatch: boolean;
  /** Present when the lyrics are synced to audio that was heard. */
  sync: { offsetAtStopMs: number; stoppedAt: number } | null;
  nudgeMs: number;
  translation: Translation | null;
}

interface State {
  player: PlayerState | null;
  prefs: api.Prefs;
}

let state: State = { player: null, prefs: { targetLanguage: null, languages: [], calibrationMs: 0 } };
const subscribers = new Set<() => void>();

function set(update: (s: State) => State) {
  state = update(state);
  subscribers.forEach((fn) => fn());
}

function setPlayer(update: (p: PlayerState) => PlayerState | null) {
  set((s) => (s.player ? { ...s, player: update(s.player) } : s));
}

export function usePlayerStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => select(state),
    () => select(state)
  );
}

export const getPlayer = () => state.player;

export async function loadPrefs() {
  try {
    const prefs = await api.getPrefs();
    set((s) => ({ ...s, prefs }));
  } catch {
    // Offline: keep defaults.
  }
}

const sameSong = (a: Song, b: Song) =>
  (a.acrId != null && a.acrId === b.acrId) || (a.lrclibId != null && a.lrclibId === b.lrclibId);

/** Applies a recognition result. A resync of the same song keeps lyrics and translation. */
export function applyRecognition(result: Extract<RecognizeResponse, { match: true }>, stoppedAt: number) {
  const current = state.player;
  const sync = { offsetAtStopMs: result.offsetAtStopMs, stoppedAt };

  if (current && sameSong(current.song, result.song) && current.lyrics) {
    setPlayer((p) => ({ ...p, sync }));
    return;
  }

  set((s) => ({
    ...s,
    player: {
      song: result.song,
      lyrics: result.lyrics,
      lyricsStatus: result.lyrics ? 'found' : result.lyricsStatus === 'recovering' ? 'finding' : 'none',
      versionMismatch: result.versionMismatch,
      sync,
      nudgeMs: 0,
      translation: null,
    },
  }));
  if (result.jobId) void followRecovery(result.jobId, result.song);
  else if (result.lyrics) void autoTranslate();
}

/** Opens a song from history or chat: lyrics without audio sync until the user listens. */
export async function openSong(lrclibId: number, source?: 'chat') {
  const { song, lyrics } = await api.getLyrics(lrclibId, source);
  set((s) => ({
    ...s,
    player: { song, lyrics, lyricsStatus: 'found', versionMismatch: false, sync: null, nudgeMs: 0, translation: null },
  }));
  void autoTranslate();
}

async function followRecovery(jobId: string, song: Song) {
  const update = await awaitJob(jobId);
  const current = state.player;
  if (!current || !sameSong(current.song, song)) return; // user moved on
  if (update.status === 'complete' && update.result && 'lyrics' in update.result) {
    const { lyrics, versionMismatch, song: found } = update.result;
    setPlayer((p) => ({
      ...p,
      song: { ...p.song, lrclibId: found.lrclibId },
      lyrics,
      lyricsStatus: 'found',
      versionMismatch,
      translation: null,
    }));
    void autoTranslate();
  } else {
    setPlayer((p) => ({ ...p, lyricsStatus: p.lyrics ? 'found' : 'none' }));
  }
}

/**
 * "This line is playing now": sets the song position to the line's timestamp
 * from this moment, and clears the nudge so +/- fine-tunes from here.
 */
export function syncToLine(timeMs: number) {
  const calibrationMs = state.prefs.calibrationMs;
  setPlayer((p) => ({ ...p, sync: { offsetAtStopMs: timeMs - calibrationMs, stoppedAt: now() }, nudgeMs: 0 }));
}

export function nudge(deltaMs: number) {
  setPlayer((p) => ({ ...p, nudgeMs: p.nudgeMs + deltaMs }));
}

/** "Wrong version": look for another LRCLIB version of the current song. */
export async function reportWrongVersion(jobId?: string) {
  const p = state.player;
  if (p?.song.lrclibId == null) return;
  const song = p.song;
  setPlayer((x) => ({ ...x, lyricsStatus: 'finding' }));
  try {
    const id = jobId ?? (await api.recover(song, song.lrclibId != null ? [song.lrclibId] : [])).jobId;
    await followRecovery(id, song);
  } catch {
    setPlayer((x) => ({ ...x, lyricsStatus: 'found' }));
  }
}

/** Moves a just-picked language to the front locally; the server keeps the real ranking. */
function pickLanguage(lang: string) {
  set((s) => ({
    ...s,
    prefs: { ...s.prefs, targetLanguage: lang, languages: [lang, ...s.prefs.languages.filter((l) => l !== lang)] },
  }));
}

/** Sets the translation language (null = off) and translates the current song. */
export async function setTranslationLanguage(lang: string | null) {
  if (!lang) {
    set((s) => ({ ...s, prefs: { ...s.prefs, targetLanguage: null } }));
    setPlayer((p) => ({ ...p, translation: null }));
    void api.putPrefs({ targetLanguage: null }).catch(() => {});
    return;
  }
  pickLanguage(lang);
  void api.putPrefs({ targetLanguage: lang }).catch(() => {});
  await requestTranslation(lang);
}

/** Applies a translation the chat already started or found in cache. */
export async function applyChatTranslation(lang: string, jobId?: string, lines?: string[]) {
  pickLanguage(lang);
  if (lines) setPlayer((p) => ({ ...p, translation: { lang, status: 'complete', lines } }));
  else if (jobId) await followTranslation(lang, jobId);
}

async function autoTranslate() {
  const lang = state.prefs.targetLanguage;
  if (lang) await requestTranslation(lang);
}

async function requestTranslation(lang: string) {
  const p = state.player;
  const id = p?.song.lrclibId ?? p?.lyrics?.lrclibId;
  if (!p || id == null || !p.lyrics || p.lyrics.instrumental) return;
  setPlayer((x) => ({ ...x, translation: { lang, status: 'running', lines: null } }));
  try {
    const res = await api.translate(id, lang);
    if (res.status === 'complete') {
      setPlayer((x) => (x.translation?.lang === lang ? { ...x, translation: { lang, status: 'complete', lines: res.lines } } : x));
    } else {
      await followTranslation(lang, res.jobId);
    }
  } catch {
    setPlayer((x) => ({ ...x, translation: { lang, status: 'failed', lines: null } }));
  }
}

async function followTranslation(lang: string, jobId: string) {
  setPlayer((x) => ({ ...x, translation: { lang, status: 'running', lines: null } }));
  const update = await awaitJob(jobId);
  setPlayer((x) => {
    if (x.translation?.lang !== lang) return x; // language changed meanwhile
    if (update.status === 'complete' && update.result && 'lines' in update.result)
      return { ...x, translation: { lang, status: 'complete', lines: update.result.lines } };
    return { ...x, translation: { lang, status: 'failed', lines: null } };
  });
}
