import { fetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import type { JobUpdate, Lyrics, Song, SongCard } from '../../worker/src/types';
import { API_URL } from './config';
import { getDeviceId } from './device-id';

export type { JobUpdate, Lyrics, RecoveryResult, Song, SongCard, TranslationResult } from '../../worker/src/types';

export type LyricsStatus = 'found' | 'recovering' | 'none';

export type RecognizeResponse =
  | { match: false }
  | {
      match: true;
      song: Song;
      offsetAtStopMs: number;
      clipMs: number;
      lyrics: Lyrics | null;
      lyricsStatus: LyricsStatus;
      jobId: string | null;
      versionMismatch: boolean;
    };

export interface HistoryEntry extends Song {
  id: number;
  source: 'listen' | 'chat';
  foundAt: number;
}

export interface ChatMessage {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
  cards: SongCard[];
}

export interface Prefs {
  targetLanguage: string | null;
  calibrationMs: number;
}

export interface JobRecord {
  jobId: string;
  status: JobUpdate['status'];
  kind: JobUpdate['kind'];
  result: JobUpdate['result'] | null;
  error: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = (await fetch(API_URL + path, {
      ...(init as object),
      headers: { 'X-Device-Id': await getDeviceId(), ...init.headers },
    })) as unknown as Response;
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body;
}

const jsonInit = (method: string, body: unknown) => ({
  method,
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
});

/** Uploads the recorded clip. `uri` is a file:// URI on native and a blob: URL on web. */
export async function recognize(uri: string, clipMs: number): Promise<RecognizeResponse> {
  let body: Blob | File;
  let type: string;
  if (Platform.OS === 'web') {
    body = await (await window.fetch(uri)).blob();
    type = body.type || 'audio/webm';
  } else {
    body = new File(uri);
    type = 'audio/mp4';
  }
  return request('/recognize', {
    method: 'POST',
    body: body as BodyInit,
    headers: { 'Content-Type': type, 'X-Clip-Ms': String(Math.round(clipMs)) },
  });
}

export const getLyrics = (lrclibId: number, save?: 'chat') =>
  request<{ song: Song; lyrics: Lyrics }>(`/lyrics/${lrclibId}${save ? `?save=${save}` : ''}`);

export const translate = (lrclibId: number, lang: string) =>
  request<{ status: 'complete'; lines: string[] } | { status: 'running'; jobId: string }>(
    '/translate',
    jsonInit('POST', { lrclibId, lang })
  );

export const recover = (song: Song, excludeIds: number[]) =>
  request<{ status: 'running'; jobId: string }>('/recover', jsonInit('POST', { song, excludeIds }));

export const getJob = (jobId: string) => request<JobRecord>(`/jobs/${jobId}`);
export const getHistory = () => request<{ songs: HistoryEntry[] }>('/history').then((r) => r.songs);
export const clearHistory = () => request<{ ok: true }>('/history', { method: 'DELETE' });
export const getChatHistory = () => request<{ messages: ChatMessage[] }>('/chat/history').then((r) => r.messages);
export const getPrefs = () => request<Prefs>('/prefs');
export const putPrefs = (prefs: Partial<Prefs>) => request<Prefs>('/prefs', jsonInit('PUT', prefs));

export type ChatEvent =
  | { type: 'status'; text: string }
  | { type: 'token'; text: string }
  | { type: 'cards'; cards: SongCard[] }
  | { type: 'action'; action: 'translate'; lang: string; jobId?: string; lines?: string[] }
  | { type: 'action'; action: 'wrong_version'; jobId: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** Sends a chat message and calls `onEvent` for each Server-Sent Event as it streams in. */
export async function streamChat(
  message: string,
  currentSong: Song | null,
  onEvent: (event: ChatEvent) => void
): Promise<void> {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Id': await getDeviceId() },
    body: JSON.stringify({ message, currentSong }),
  }).catch(() => {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? 'Chat is unavailable right now');
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep).trim();
      buffer = buffer.slice(sep + 2);
      if (!frame.startsWith('data:')) continue;
      try {
        onEvent(JSON.parse(frame.slice(5).trim()) as ChatEvent);
      } catch {
        // Ignore malformed frames.
      }
    }
  }
}
