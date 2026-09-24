import { languageFromCode } from '../../src/lib/languages';
import type { Song } from './types';

const TIMEOUT_MS = 8000;
/** ACRCloud rejects samples of 5 MB or more. */
export const MAX_SAMPLE_BYTES = 5 * 1024 * 1024;

export interface AcrMusic {
  acrid: string;
  title: string;
  /** ISO 639-1 code of the song's language, e.g. "en". */
  language?: string;
  artists?: { name: string }[];
  album?: { name: string };
  duration_ms?: number;
  play_offset_ms?: number;
  db_end_time_offset_ms?: number;
  sample_end_time_offset_ms?: number;
  score?: number;
}

interface AcrResponse {
  status: { code: number; msg: string };
  metadata?: { music?: AcrMusic[] };
}

export type IdentifyResult =
  | { kind: 'match'; music: AcrMusic }
  | { kind: 'no_match' }
  | { kind: 'error'; code: number; message: string };

async function sign(stringToSign: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(stringToSign)));
  let binary = '';
  for (const b of sig) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Identifies an audio clip with ACRCloud's Identification API (signature version 1). */
export async function identify(
  audio: ArrayBuffer,
  contentType: string,
  cfg: { host: string; accessKey: string; accessSecret: string }
): Promise<IdentifyResult> {
  const httpUri = '/v1/identify';
  const dataType = 'audio';
  const signatureVersion = '1';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = [
    'POST',
    httpUri,
    cfg.accessKey,
    dataType,
    signatureVersion,
    timestamp,
  ].join('\n');

  const form = new FormData();
  form.append('sample', new Blob([audio], { type: contentType }), 'sample');
  form.append('sample_bytes', String(audio.byteLength));
  form.append('access_key', cfg.accessKey);
  form.append('data_type', dataType);
  form.append('signature_version', signatureVersion);
  form.append('signature', await sign(stringToSign, cfg.accessSecret));
  form.append('timestamp', timestamp);

  const res = await fetch(`https://${cfg.host}${httpUri}`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return { kind: 'error', code: res.status, message: `ACRCloud HTTP ${res.status}` };

  const body = (await res.json()) as AcrResponse;
  // 1001 = "No result"; everything else non-zero is a real error (bad key, quota, bad audio...).
  if (body.status.code === 1001) return { kind: 'no_match' };
  if (body.status.code !== 0) return { kind: 'error', code: body.status.code, message: body.status.msg };
  const music = body.metadata?.music?.[0];
  return music ? { kind: 'match', music } : { kind: 'no_match' };
}

/**
 * Position in the track (ms) at the moment recording stopped.
 * `db_end_time_offset_ms` is where the matched part ends in the original track;
 * anything recorded after the matched part (clipMs - sample_end) is added on top.
 */
export function offsetAtStop(music: AcrMusic, clipMs: number): number {
  const tail =
    music.sample_end_time_offset_ms != null ? Math.max(0, clipMs - music.sample_end_time_offset_ms) : 0;
  const base = music.db_end_time_offset_ms ?? music.play_offset_ms ?? 0;
  return Math.max(0, Math.round(base + tail));
}

export function toSong(music: AcrMusic): Song {
  return {
    lrclibId: null,
    acrId: music.acrid,
    title: music.title,
    artist: (music.artists ?? []).map((a) => a.name).join(', '),
    album: music.album?.name ?? '',
    durationMs: music.duration_ms ?? 0,
    language: music.language ? languageFromCode(music.language) : null,
  };
}
