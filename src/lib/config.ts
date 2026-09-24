/**
 * Worker URL. Set EXPO_PUBLIC_API_URL in .env.local — on a physical device use
 * your computer's LAN IP (e.g. http://192.168.1.20:8787), not localhost.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787').replace(/\/+$/, '');

export const WS_URL = API_URL.replace(/^http/, 'ws');

/** Clip length sent to ACRCloud: 10 s by default; over 5 s recommended, under 15 s ideal. */
export const CLIP_MS = Math.min(15_000, Math.max(5_000, Number(process.env.EXPO_PUBLIC_CLIP_MS) || 10_000));

/** Manual timing nudge step in the player. */
export const NUDGE_STEP_MS = 500;
