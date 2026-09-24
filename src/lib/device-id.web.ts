import * as Crypto from 'expo-crypto';

const KEY = 'lyrics-sync.device-id';
let cached: string | null = null;

/** Anonymous per-browser ID; picks this user's Durable Object on the Worker. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    cached = window.localStorage.getItem(KEY);
  } catch {
    // Storage blocked (private mode): fall back to a per-session id.
  }
  if (!cached) {
    cached = Crypto.randomUUID();
    try {
      window.localStorage.setItem(KEY, cached);
    } catch {}
  }
  return cached;
}
