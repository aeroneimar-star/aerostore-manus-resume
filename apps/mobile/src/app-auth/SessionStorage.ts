import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
}

const SESSION_KEY = 'aerostore.app.session.v1';
const DEVICE_KEY = 'aerostore.app.device.v1';
const memory = new Map<string, string>();

async function read(key: string): Promise<string | null> {
  if (Platform.OS !== 'web') return SecureStore.getItemAsync(key);
  if (typeof globalThis.sessionStorage !== 'undefined') return globalThis.sessionStorage.getItem(key);
  return memory.get(key) ?? null;
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS !== 'web') return SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  if (typeof globalThis.sessionStorage !== 'undefined') globalThis.sessionStorage.setItem(key, value);
  else memory.set(key, value);
}

async function remove(key: string): Promise<void> {
  if (Platform.OS !== 'web') return SecureStore.deleteItemAsync(key);
  if (typeof globalThis.sessionStorage !== 'undefined') globalThis.sessionStorage.removeItem(key);
  memory.delete(key);
}

export const sessionStorage = {
  async load(): Promise<StoredSession | null> {
    const raw = await read(SESSION_KEY); if (!raw) return null;
    try { const value = JSON.parse(raw) as StoredSession; return value.accessToken && value.refreshToken ? value : null; } catch { return null; }
  },
  save: (value: StoredSession) => write(SESSION_KEY, JSON.stringify(value)),
  clear: () => remove(SESSION_KEY),
  async getOrCreateDeviceId(): Promise<string> {
    const current = await read(DEVICE_KEY); if (current) return current;
    const next = `aerostore-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    await write(DEVICE_KEY, next); return next;
  },
};
