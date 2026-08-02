/**
 * ThemeContext — global theme provider for AEROSTORE app.
 *
 * Provides:
 * - ThemeProvider: wraps the app, persists preference
 * - useAppTheme: hook to access tokens + preference + active theme
 * - setThemePreference: function to change theme
 *
 * Logic:
 * - preference LIGHT → active 'light'
 * - preference DARK → active 'dark'
 * - preference SYSTEM → follows device appearance
 * - no preference → 'light' (default)
 * - no flash on startup (useLayoutEffect + initial state from storage)
 */

import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { darkTokens, lightTokens, type ThemeTokens } from './tokens';
import { themeStorage, type ThemePreference } from './storage';

export type ActiveTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** The user's saved preference: 'light' | 'dark' | 'system' */
  preference: ThemePreference;
  /** The active resolved theme: 'light' | 'dark' */
  active: ActiveTheme;
  /** The current token set */
  tokens: ThemeTokens;
  /** Whether the theme has been initialized (restored from storage) */
  initialized: boolean;
  /** Change the user's theme preference */
  setThemePreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Default tokens (light) — used during initial render before storage is read
const DEFAULT_TOKENS = lightTokens;

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const deviceColorScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('light');
  const [initialized, setInitialized] = useState(false);

  // Restore preference from storage on mount (synchronous on web, async on native)
  useLayoutEffect(() => {
    const sync = themeStorage.getSync();
    if (sync) {
      setPreference(sync);
      setInitialized(true);
    } else {
      // Async read for native (expo-secure-store may need async)
      themeStorage.get().then((stored) => {
        if (stored) setPreference(stored);
        setInitialized(true);
      }).catch(() => setInitialized(true));
    }
  }, []);

  // Determine active theme from preference + device
  const active = useMemo<ActiveTheme>(() => {
    if (preference === 'light') return 'light';
    if (preference === 'dark') return 'dark';
    // system: follow device
    return (deviceColorScheme === 'dark' ? 'dark' : 'light');
  }, [preference, deviceColorScheme]);

  const tokens = useMemo(() => (active === 'dark' ? darkTokens : lightTokens), [active]);

  const setThemePreference = useCallback((newPref: ThemePreference) => {
    setPreference(newPref);
    themeStorage.set(newPref).catch(() => {});
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    active,
    tokens,
    initialized,
    setThemePreference,
  }), [preference, active, tokens, initialized, setThemePreference]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access the current theme.
 * Returns tokens, preference, active theme, and setter.
 * Safe to call even outside ThemeProvider (returns defaults).
 */
export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback: light theme with default tokens (before provider mounts)
    return {
      preference: 'light',
      active: 'light',
      tokens: DEFAULT_TOKENS,
      initialized: true,
      setThemePreference: () => {},
    };
  }
  return ctx;
}

/**
 * Test helper: get theme context for testing.
 */
export function getThemeContext() {
  return ThemeContext;
}
