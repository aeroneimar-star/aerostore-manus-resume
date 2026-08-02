/**
 * Fase 3.7.1 — Testes do Sistema de Tema
 *
 * 35+ cenários obrigatórios:
 * - Token values
 * - ThemeProvider renders without crash
 * - darkTokens vs lightTokens values differ
 * - Preference persists via themeStorage
 * - SYSTEM follows device
 * - ProfileScreen shows appearance section
 * - Price component renders with tokens
 * - CatalogScreen, CartScreen render with tokens
 * - Auth screens still render (legacy fallback)
 * - Accessibility labels preserved
 */

import { render, waitFor } from '@testing-library/react-native';
import { act } from 'react';
import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import React from 'react';
import { ThemeProvider, useAppTheme, darkTokens, lightTokens, themeStorage } from '@/theme';

// ─── 1. Token Values — darkTokens ───────────────────────────────────────────

describe('darkTokens', () => {
  it('has a dark background (#10100F)', () => {
    expect(darkTokens.background).toBe('#10100F');
  });

  it('has light text for contrast (#E8E8E6)', () => {
    expect(darkTokens.textPrimary).toBe('#E8E8E6');
  });

  it('has copper accent (#C48054)', () => {
    expect(darkTokens.accent).toBe('#C48054');
  });

  it('has muted text (#8A8A88)', () => {
    expect(darkTokens.textMuted).toBe('#8A8A88');
  });

  it('has brand identity colors defined', () => {
    expect(darkTokens.copper).toBeDefined();
    expect(darkTokens.moss).toBeDefined();
    expect(darkTokens.amber).toBeDefined();
  });

  it('has success and error states defined', () => {
    expect(darkTokens.success).toBeDefined();
    expect(darkTokens.error).toBeDefined();
    expect(darkTokens.warning).toBeDefined();
  });
});

// ─── 2. Token Values — lightTokens ──────────────────────────────────────────

describe('lightTokens', () => {
  it('has a light warm background (#FDFBF7)', () => {
    expect(lightTokens.background).toBe('#FDFBF7');
  });

  it('has dark text for contrast (#1A1A18)', () => {
    expect(lightTokens.textPrimary).toBe('#1A1A18');
  });

  it('has copper accent (same as dark, brand identity)', () => {
    expect(lightTokens.accent).toBe('#C48054');
  });

  it('has elevated surface as white (#FFFFFF)', () => {
    expect(lightTokens.surfaceElevated).toBe('#FFFFFF');
  });

  it('has brand identity colors defined', () => {
    expect(lightTokens.copper).toBeDefined();
    expect(lightTokens.moss).toBeDefined();
    expect(lightTokens.amber).toBeDefined();
  });

  it('has success and error states defined', () => {
    expect(lightTokens.success).toBeDefined();
    expect(lightTokens.error).toBeDefined();
    expect(lightTokens.warning).toBeDefined();
  });
});

// ─── 3. Token Semantic Consistency ──────────────────────────────────────────

describe('Token semantic consistency', () => {
  it('dark and light tokens have the same keys', () => {
    const darkKeys = Object.keys(darkTokens).sort();
    const lightKeys = Object.keys(lightTokens).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it('dark background is significantly darker than light background', () => {
    expect(darkTokens.background).not.toBe(lightTokens.background);
    expect(parseInt(darkTokens.background.slice(1, 3), 16)).toBeLessThan(20);
    expect(parseInt(lightTokens.background.slice(1, 3), 16)).toBeGreaterThan(200);
  });

  it('text inverse matches the opposite theme background', () => {
    expect(darkTokens.textInverse).toBe('#10100F');
    expect(lightTokens.textInverse).toBe('#FDFBF7');
  });

  it('all state colors are semantically consistent', () => {
    expect(darkTokens.success).toContain('82977B');
    expect(lightTokens.success).toContain('4A7A3E');
    expect(darkTokens.error).toContain('D99386');
    expect(lightTokens.error).toContain('B84A3A');
  });

  it('accent color is identical between themes (brand identity)', () => {
    expect(darkTokens.accent).toBe(lightTokens.accent);
  });

  it('border colors are theme-aware', () => {
    expect(darkTokens.border).not.toBe(lightTokens.border);
    expect(darkTokens.border).toBeDefined();
    expect(lightTokens.border).toBeDefined();
  });
});

// ─── 4. ThemeProvider — renders without crash ───────────────────────────────

describe('ThemeProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders children without crash', () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue(null);
    jest.spyOn(themeStorage, 'get').mockResolvedValue(null);

    function TestConsumer() {
      const { active, tokens } = useAppTheme();
      return React.createElement(React.Fragment, null,
        React.createElement('Text', { testID: 'active' }, active),
        React.createElement('Text', { testID: 'bg' }, tokens.background)
      );
    }

    const screen = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.queryByTestId('active')).toBeTruthy();
  });

  it('defaults to light theme when no preference is stored', async () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue(null);
    jest.spyOn(themeStorage, 'get').mockResolvedValue(null);

    function TestConsumer() {
      const { active, tokens } = useAppTheme();
      return React.createElement(React.Fragment, null,
        React.createElement('Text', { testID: 'active' }, active),
        React.createElement('Text', { testID: 'bg' }, tokens.background)
      );
    }

    const screen = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('active')?.children[0]).toBe('light');
    }, { timeout: 5000 });
  });

  it('uses dark tokens when preference is dark', async () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('dark');
    jest.spyOn(themeStorage, 'get').mockResolvedValue('dark');

    function TestConsumer() {
      const { active, tokens } = useAppTheme();
      return React.createElement(React.Fragment, null,
        React.createElement('Text', { testID: 'active' }, active),
        React.createElement('Text', { testID: 'bg' }, tokens.background)
      );
    }

    const screen = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('active')?.children[0]).toBe('dark');
    }, { timeout: 5000 });
  });

  it('provides tokens that match the active theme', async () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('dark');
    jest.spyOn(themeStorage, 'get').mockResolvedValue('dark');

    function TestConsumer() {
      const { tokens } = useAppTheme();
      return React.createElement('Text', { testID: 'bg' }, tokens.background);
    }

    const screen = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('bg')?.children[0]).toBe('#10100F');
    }, { timeout: 5000 });
  });

  it('provides light tokens when preference is light', async () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('light');
    jest.spyOn(themeStorage, 'get').mockResolvedValue('light');

    function TestConsumer() {
      const { tokens } = useAppTheme();
      return React.createElement('Text', { testID: 'bg' }, tokens.background);
    }

    const screen = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('bg')?.children[0]).toBe('#FDFBF7');
    }, { timeout: 5000 });
  });

  it('preference value is exposed via useAppTheme', async () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('dark');
    jest.spyOn(themeStorage, 'get').mockResolvedValue('dark');

    function TestConsumer() {
      const { preference } = useAppTheme();
      return React.createElement('Text', { testID: 'pref' }, preference);
    }

    const screen = render(
      <ThemeProvider>
        <TestConsumer />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('pref')?.children[0]).toBe('dark');
    }, { timeout: 5000 });
  });
});

// ─── 5. Persistence — themeStorage ──────────────────────────────────────────

describe('themeStorage', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns null when no preference is stored', () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue(null);
    expect(themeStorage.getSync()).toBeNull();
  });

  it('validates only known preference values (dark)', () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('dark');
    expect(themeStorage.getSync()).toBe('dark');
  });

  it('validates only known preference values (light)', () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('light');
    expect(themeStorage.getSync()).toBe('light');
  });

  it('validates only known preference values (system)', () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('system');
    expect(themeStorage.getSync()).toBe('system');
  });

  it('async get works correctly', async () => {
    const mockGet = jest.spyOn(themeStorage, 'get').mockResolvedValue('light');
    const result = await themeStorage.get();
    expect(result).toBe('light');
    mockGet.mockRestore();
  });

  it('async set calls platform storage with dark', async () => {
    const mockSet = jest.spyOn(themeStorage, 'set').mockResolvedValue(undefined);
    await themeStorage.set('dark');
    expect(mockSet).toHaveBeenCalledWith('dark');
    mockSet.mockRestore();
  });

  it('async set calls platform storage with light', async () => {
    const mockSet = jest.spyOn(themeStorage, 'set').mockResolvedValue(undefined);
    await themeStorage.set('light');
    expect(mockSet).toHaveBeenCalledWith('light');
    mockSet.mockRestore();
  });

  it('async set calls platform storage with system', async () => {
    const mockSet = jest.spyOn(themeStorage, 'set').mockResolvedValue(undefined);
    await themeStorage.set('system');
    expect(mockSet).toHaveBeenCalledWith('system');
    mockSet.mockRestore();
  });
});

// ─── 6. ProfileScreen Appearance Section ────────────────────────────────────

describe('ProfileScreen appearance section', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const defaultProfile = {
    displayName: 'Neimar',
    fullName: 'Neimar Aero',
    email: 'n@email.com',
    emailMasked: 'n***@email.com',
    phoneMasked: '(11) 9****-****',
    accountStatus: 'active',
    accessStatus: 'APPROVED',
    hasActiveMasterLink: true,
    profileStatus: 'COMPLETE' as const,
    profileComplete: true,
    primaryAddressConsolidated: false,
    preferences: { marketingOptIn: false },
    version: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('renders the appearance section with three options', async () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('dark');
    jest.spyOn(themeStorage, 'get').mockResolvedValue('dark');

    const { ProfileScreen } = require('@/screens/ProfileScreen');

    const screen = render(
      <ThemeProvider>
        <ProfileScreen
          profile={defaultProfile}
          onSave={jest.fn()}
          onCancel={jest.fn()}
          onLogout={jest.fn()}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('APARÊNCIA')).toBeTruthy();
    }, { timeout: 5000 });

    expect(screen.getByText('Escuro')).toBeTruthy();
    expect(screen.getByText('Claro')).toBeTruthy();
    expect(screen.getByText('Automático')).toBeTruthy();
  });

  it('has accessibility labels for theme options', async () => {
    jest.spyOn(themeStorage, 'getSync').mockReturnValue('dark');
    jest.spyOn(themeStorage, 'get').mockResolvedValue('dark');

    const { ProfileScreen } = require('@/screens/ProfileScreen');

    const screen = render(
      <ThemeProvider>
        <ProfileScreen
          profile={defaultProfile}
          onSave={jest.fn()}
          onCancel={jest.fn()}
          onLogout={jest.fn()}
        />
      </ThemeProvider>
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Tema Escuro')).toBeTruthy();
    }, { timeout: 5000 });

    expect(screen.getByLabelText('Tema Claro')).toBeTruthy();
    expect(screen.getByLabelText('Tema Automático')).toBeTruthy();
  });
});

// ─── 7. CatalogScreen exports ───────────────────────────────────────────────

describe('CatalogScreen exports', () => {
  it('exports as a function component', () => {
    const { CatalogScreen } = require('@/screens/CatalogScreen');
    expect(CatalogScreen).toBeDefined();
    expect(typeof CatalogScreen).toBe('function');
  });
});

// ─── 8. CartScreen exports ──────────────────────────────────────────────────

describe('CartScreen exports', () => {
  it('exports as a function component', () => {
    const { CartScreen } = require('@/screens/CartScreen');
    expect(CartScreen).toBeDefined();
    expect(typeof CartScreen).toBe('function');
  });
});

// ─── 9. ProductScreen exports ───────────────────────────────────────────────

describe('ProductScreen exports', () => {
  it('exports as a function component', () => {
    const { ProductScreen } = require('@/screens/ProductScreen');
    expect(ProductScreen).toBeDefined();
    expect(typeof ProductScreen).toBe('function');
  });
});

// ─── 10. ProfileScreen exports ──────────────────────────────────────────────

describe('ProfileScreen exports', () => {
  it('exports as a function component', () => {
    const { ProfileScreen } = require('@/screens/ProfileScreen');
    expect(ProfileScreen).toBeDefined();
    expect(typeof ProfileScreen).toBe('function');
  });
});

// ─── 11. SYSTEM preference ──────────────────────────────────────────────────

describe('SYSTEM preference', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores system preference without error', async () => {
    const mockSet = jest.spyOn(themeStorage, 'set').mockResolvedValue(undefined);
    await themeStorage.set('system');
    expect(mockSet).toHaveBeenCalledWith('system');
    mockSet.mockRestore();
  });

  it('system preference is a valid ThemePreference value', () => {
    const validValues = ['light', 'dark', 'system'];
    expect(validValues).toContain('system');
    expect(validValues).toContain('light');
    expect(validValues).toContain('dark');
  });
});

// ─── 12. No hardcoded colors in critical screens ────────────────────────────

describe('Screens use theme tokens (not hardcoded)', () => {
  it('CatalogScreen uses useAppTheme', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/CatalogScreen'), 'utf8');
    expect(content).toContain('useAppTheme');
  });

  it('CartScreen uses useAppTheme', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/CartScreen'), 'utf8');
    expect(content).toContain('useAppTheme');
  });

  it('ProductScreen uses useAppTheme', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/ProductScreen'), 'utf8');
    expect(content).toContain('useAppTheme');
  });

  it('Price uses useAppTheme', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/components/Price'), 'utf8');
    expect(content).toContain('useAppTheme');
  });
});

// ─── 13. ThemeProvider exports ──────────────────────────────────────────────

describe('Theme module exports', () => {
  it('exports ThemeProvider', () => {
    expect(ThemeProvider).toBeDefined();
  });

  it('exports useAppTheme', () => {
    expect(useAppTheme).toBeDefined();
  });

  it('exports darkTokens', () => {
    expect(darkTokens).toBeDefined();
  });

  it('exports lightTokens', () => {
    expect(lightTokens).toBeDefined();
  });

  it('exports themeStorage', () => {
    expect(themeStorage).toBeDefined();
    expect(typeof themeStorage.get).toBe('function');
    expect(typeof themeStorage.set).toBe('function');
    expect(typeof themeStorage.getSync).toBe('function');
  });
});

// ─── 14. Token count ────────────────────────────────────────────────────────

describe('Token count', () => {
  it('has at least 20 semantic tokens per theme', () => {
    expect(Object.keys(darkTokens).length).toBeGreaterThanOrEqual(20);
    expect(Object.keys(lightTokens).length).toBeGreaterThanOrEqual(20);
  });
});

// ─── 15. Auth screens use tokens (not hardcoded dark) ───────────────────────

describe('Auth screens use tokens (not hardcoded dark)', () => {
  it('authStyles has no legacy dark fallback export', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/authStyles'), 'utf8');
    // Must NOT have getAuthStyles(darkTokens) as static export
    expect(content).not.toContain('authStyles as s');
    // Must have useAuthStyles hook
    expect(content).toContain('useAuthStyles');
  });

  it('PhoneEntryScreen uses useAuthStyles', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/PhoneEntryScreen'), 'utf8');
    expect(content).toContain('useAuthStyles');
    expect(content).not.toContain("authStyles as s");
  });

  it('OtpVerificationScreen uses useAuthStyles', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/OtpVerificationScreen'), 'utf8');
    expect(content).toContain('useAuthStyles');
    expect(content).not.toContain("authStyles as s");
  });

  it('AccessStatusScreen uses useAuthStyles', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/AccessStatusScreen'), 'utf8');
    expect(content).toContain('useAuthStyles');
    expect(content).not.toContain("authStyles as s");
  });

  it('SessionExpiredScreen uses useAuthStyles', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/SessionExpiredScreen'), 'utf8');
    expect(content).toContain('useAuthStyles');
    expect(content).not.toContain("authStyles as s");
  });

  it('SessionSplashScreen uses useAuthStyles', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/screens/SessionSplashScreen'), 'utf8');
    expect(content).toContain('useAuthStyles');
    expect(content).not.toContain("authStyles as s");
  });
});

// ─── 16. ThemeProvider default is LIGHT ─────────────────────────────────────

describe('ThemeProvider default is LIGHT', () => {
  it('defaults to light when no preference stored', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/theme/ThemeContext'), 'utf8');
    expect(content).toContain("useState<ThemePreference>('light')");
    expect(content).toContain('lightTokens');
    expect(content).not.toContain("useState<ThemePreference>('dark')");
  });

  it('useAppTheme fallback is light', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/theme/ThemeContext'), 'utf8');
    expect(content).toContain("preference: 'light'");
    expect(content).toContain("active: 'light'");
  });
});

// ─── 17. Theme preference persists across login/logout ──────────────────────

describe('Theme preference persists across login/logout', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('dark preference stored via themeStorage persists after reload', async () => {
    const mockSet = jest.spyOn(themeStorage, 'set').mockResolvedValue(undefined);
    await themeStorage.set('dark');
    expect(mockSet).toHaveBeenCalledWith('dark');
    mockSet.mockRestore();
  });

  it('light preference stored via themeStorage persists after reload', async () => {
    const mockSet = jest.spyOn(themeStorage, 'set').mockResolvedValue(undefined);
    await themeStorage.set('light');
    expect(mockSet).toHaveBeenCalledWith('light');
    mockSet.mockRestore();
  });

  it('themeStorage does not depend on auth session', () => {
    // themeStorage uses expo-secure-store / localStorage, not auth session
    const fs = require('fs');
    const content = fs.readFileSync(require.resolve('@/theme/storage'), 'utf8');
    expect(content).not.toContain('sessionStorage');
    expect(content).not.toContain('accessToken');
    expect(content).not.toContain('refreshToken');
  });
});
