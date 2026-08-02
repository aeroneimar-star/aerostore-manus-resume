/**
 * Theme persistence storage.
 *
 * Mobile: expo-secure-store (keychain)
 * Web: localStorage (isolated key)
 *
 * Preference is available before and after login.
 * Restored during splash without visual flash.
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const THEME_KEY = 'aerostore_theme_preference';

export type ThemePreference = 'light' | 'dark' | 'system';

export const themeStorage = {
  async get(): Promise<ThemePreference | null> {
    if (Platform.OS === 'web') {
      try {
        const value = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null;
        if (value === 'light' || value === 'dark' || value === 'system') return value;
        return null;
      } catch {
        return null;
      }
    }
    try {
      const value = await SecureStore.getItemAsync(THEME_KEY);
      if (value === 'light' || value === 'dark' || value === 'system') return value;
      return null;
    } catch {
      return null;
    }
  },

  async set(preference: ThemePreference): Promise<void> {
    if (Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(THEME_KEY, preference);
        }
      } catch {
        // silent fail on web
      }
      return;
    }
    try {
      await SecureStore.setItemAsync(THEME_KEY, preference);
    } catch {
      // silent fail on native
    }
  },

  getSync(): ThemePreference | null {
    if (Platform.OS === 'web') {
      try {
        const value = typeof window !== 'undefined' ? window.localStorage.getItem(THEME_KEY) : null;
        if (value === 'light' || value === 'dark' || value === 'system') return value;
        return null;
      } catch {
        return null;
      }
    }
    try {
      const value = SecureStore.getItem(THEME_KEY);
      if (value === 'light' || value === 'dark' || value === 'system') return value;
      return null;
    } catch {
      return null;
    }
  },
};
