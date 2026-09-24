import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const KEY = 'device-id';
let cached: string | null = null;

/** Anonymous per-install ID; picks this user's Durable Object on the Worker. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  cached = (await SecureStore.getItemAsync(KEY)) ?? null;
  if (!cached) {
    cached = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY, cached);
  }
  return cached;
}
