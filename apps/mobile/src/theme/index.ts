/**
 * AEROSTORE Theme Module — Fase 3.7.1
 *
 * Exports:
 * - theme: legacy static theme (backward compat)
 * - ThemeProvider: global theme provider
 * - useAppTheme: hook for semantic tokens + preference
 * - darkTokens / lightTokens: raw token sets
 * - themeStorage: persistence layer
 * - types: ThemeTokens, ThemePreference, ActiveTheme
 */

import { Platform } from 'react-native';

// Legacy static theme — preserved for backward compat where needed
const fonts = Platform.select({
  ios: { display: 'Georgia', body: 'Avenir Next' },
  android: { display: 'serif', body: 'sans-serif' },
  default: { display: 'Georgia', body: 'Arial' },
});

export const theme = {
  colors: {
    ink: '#10100F',
    inkRaised: '#191918',
    ivory: '#F4F0E7',
    paper: '#E8E1D5',
    stone: '#A9A297',
    copper: '#C48054',
    copperSoft: '#E3B18E',
    moss: '#82977B',
    amber: '#C7A45D',
    error: '#D99386',
    white: '#FFFFFF',
    black: '#000000',
  },
  typography: {
    display: fonts?.display ?? 'serif',
    body: fonts?.body ?? 'sans-serif',
  },
  spacing: {
    xxs: 4,
    xs: 8,
    sm: 12,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
    hero: 72,
  },
  radii: {
    sm: 8,
    md: 14,
    lg: 22,
    pill: 999,
  },
  sizes: {
    maxContent: 1180,
    touch: 48,
  },
  shadows: {
    card: Platform.select({
      web: {
        boxShadow: '0 12px 24px rgba(0, 0, 0, 0.18)',
      },
      default: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 5,
      },
    }) ?? {},
  },
} as const;

// New theme system exports
export { ThemeProvider, useAppTheme, getThemeContext } from './ThemeContext';
export { darkTokens, lightTokens } from './tokens';
export type { ThemeTokens } from './tokens';
export { themeStorage } from './storage';
export type { ThemePreference } from './storage';
export type { ActiveTheme } from './ThemeContext';
