/**
 * BrandThemeProvider — Integração BrandEngine + ThemeEngine.
 *
 * Fornece:
 * - BrandContext React (useBrand)
 * - Feature Flags (useFeatureFlag)
 * - Brand-aware theme tokens (useBrandTheme)
 * - Troca de marca em runtime
 *
 * Nenhuma tela pode conter textos ou logos hardcoded da AEROSTORE.
 */
import React, { createContext, useContext, useMemo, useState, useCallback } from 'react';
import { darkTokens, lightTokens, type ThemeTokens } from '../theme/tokens';

// ============================================
// Tipos
// ============================================

export type BrandId = 'aerostore' | 'casa-cambore';

export interface BrandAssets {
  logo: string;
  logoDark: string;
  logoLight: string;
  icon: string;
  splash: string;
}

export interface BrandColors {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  errorColor: string;
  successColor: string;
  warningColor: string;
}

export interface BrandContacts {
  website: string;
  instagram: string;
  facebook: string;
  whatsapp: string;
  email: string;
  privacyPolicyUrl: string;
  termsUrl: string;
  supportPhone: string;
  supportEmail: string;
  supportWhatsApp: string;
}

export interface FeatureFlags {
  cashback: boolean;
  marketplace: boolean;
  wishlist: boolean;
  retirada: boolean;
  entrega: boolean;
  motoboy: boolean;
  frete: boolean;
  pix: boolean;
  cartao: boolean;
  programaFidelidade: boolean;
  notificacoes: boolean;
  cupons: boolean;
  giftCard: boolean;
  avaliacoes: boolean;
}

export interface BrandConfig {
  id: BrandId;
  slug: string;
  displayName: string;
  shortName: string;
  assets: BrandAssets;
  colors: BrandColors;
  contacts: BrandContacts;
  featureFlags: FeatureFlags;
  currency: string;
  timezone: string;
  locale: string;
  enabled: boolean;
}

// ============================================
// Configurações das marcas
// ============================================

export const AEROSTORE_CONFIG: BrandConfig = {
  id: 'aerostore',
  slug: 'aerostore',
  displayName: 'AEROSTORE',
  shortName: 'AERO',
  assets: {
    logo: '/assets/brands/aerostore/logo.png',
    logoDark: '/assets/brands/aerostore/logo-dark.png',
    logoLight: '/assets/brands/aerostore/logo-light.png',
    icon: '/assets/brands/aerostore/icon.png',
    splash: '/assets/brands/aerostore/splash.png',
  },
  colors: {
    primaryColor: '#C8834A',
    secondaryColor: '#1A3A3A',
    accentColor: '#E6A96E',
    backgroundColor: '#FAF6F0',
    surfaceColor: '#FFFFFF',
    textColor: '#2D1810',
    errorColor: '#DC2626',
    successColor: '#16A34A',
    warningColor: '#D97706',
  },
  contacts: {
    website: 'https://aerostore.com.br',
    instagram: '@aerostore',
    facebook: '/aerostore',
    whatsapp: '+5511999990001',
    email: 'contato@aerostore.com.br',
    privacyPolicyUrl: 'https://aerostore.com.br/privacidade',
    termsUrl: 'https://aerostore.com.br/termos',
    supportPhone: '+5511999990001',
    supportEmail: 'suporte@aerostore.com.br',
    supportWhatsApp: '+5511999990001',
  },
  featureFlags: {
    cashback: true,
    marketplace: false,
    wishlist: true,
    retirada: true,
    entrega: true,
    motoboy: false,
    frete: true,
    pix: true,
    cartao: true,
    programaFidelidade: false,
    notificacoes: true,
    cupons: true,
    giftCard: false,
    avaliacoes: true,
  },
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
  enabled: true,
};

export const CASA_CAMBORE_CONFIG: BrandConfig = {
  id: 'casa-cambore',
  slug: 'casa-cambore',
  displayName: 'Casa CAMBORÊ',
  shortName: 'CAMBORÊ',
  assets: {
    logo: '/assets/brands/casa-cambore/logo.png',
    logoDark: '/assets/brands/casa-cambore/logo-dark.png',
    logoLight: '/assets/brands/casa-cambore/logo-light.png',
    icon: '/assets/brands/casa-cambore/icon.png',
    splash: '/assets/brands/casa-cambore/splash.png',
  },
  colors: {
    primaryColor: '#4A6741',
    secondaryColor: '#2C1810',
    accentColor: '#D4A76A',
    backgroundColor: '#FDFBF7',
    surfaceColor: '#FFFFFF',
    textColor: '#1C2E1A',
    errorColor: '#B91C1C',
    successColor: '#15803D',
    warningColor: '#CA8A04',
  },
  contacts: {
    website: 'https://casacambore.com.br',
    instagram: '@casacambore',
    facebook: '/casacambore',
    whatsapp: '+5511999990002',
    email: 'contato@casacambore.com.br',
    privacyPolicyUrl: 'https://casacambore.com.br/privacidade',
    termsUrl: 'https://casacambore.com.br/termos',
    supportPhone: '+5511999990002',
    supportEmail: 'suporte@casacambore.com.br',
    supportWhatsApp: '+5511999990002',
  },
  featureFlags: {
    cashback: false,
    marketplace: false,
    wishlist: false,
    retirada: false,
    entrega: true,
    motoboy: true,
    frete: true,
    pix: true,
    cartao: true,
    programaFidelidade: true,
    notificacoes: true,
    cupons: true,
    giftCard: true,
    avaliacoes: false,
  },
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
  enabled: false, // Desabilitada por configuração
};

// ============================================
// Registry
// ============================================

const BRAND_REGISTRY: Record<BrandId, BrandConfig> = {
  'aerostore': AEROSTORE_CONFIG,
  'casa-cambore': CASA_CAMBORE_CONFIG,
};

// ============================================
// Theme tokens por marca
// ============================================

function createBrandTokens(brand: BrandConfig): { light: ThemeTokens; dark: ThemeTokens } {
  const c = brand.colors;

  const light: ThemeTokens = {
    ...lightTokens,
    colors: {
      ...lightTokens.colors,
      primary: c.primaryColor,
      secondary: c.secondaryColor,
      accent: c.accentColor,
      background: c.backgroundColor,
      surface: c.surfaceColor,
      text: c.textColor,
      error: c.errorColor,
      success: c.successColor,
      warning: c.warningColor,
    },
  };

  const dark: ThemeTokens = {
    ...darkTokens,
    colors: {
      ...darkTokens.colors,
      primary: c.primaryColor,
      secondary: c.secondaryColor,
      accent: c.accentColor,
      background: '#0A0F0A',
      surface: '#1A1F1A',
      text: '#E8E4DF',
      error: '#EF4444',
      success: c.successColor,
      warning: c.warningColor,
    },
  };

  return { light, dark };
}

// ============================================
// Context
// ============================================

interface BrandContextValue {
  /** Marca ativa */
  brand: BrandConfig;
  /** Mudar marca ativa */
  switchBrand: (brandId: BrandId) => void;
  /** Resetar para marca padrão */
  resetBrand: () => void;
  /** Marca padrão */
  defaultBrandId: BrandId;
  /** Todas as marcas registradas */
  availableBrands: BrandConfig[];
  /** Todas as marcas (incluindo desabilitadas) */
  allBrands: BrandConfig[];
}

const BrandContext = createContext<BrandContextValue | null>(null);

// ============================================
// Provider
// ============================================

interface BrandThemeProviderProps {
  children: React.ReactNode;
  initialBrandId?: BrandId;
}

export function BrandThemeProvider({ children, initialBrandId = 'aerostore' }: BrandThemeProviderProps) {
  const [activeBrandId, setActiveBrandId] = useState<BrandId>(initialBrandId);
  const [themePreference, setThemePreference] = useState<'light' | 'dark' | 'system'>('light');

  const brand = BRAND_REGISTRY[activeBrandId] || AEROSTORE_CONFIG;
  const brandTokens = useMemo(() => createBrandTokens(brand), [brand]);

  const activeThemeTokens = useMemo(() => {
    const active: 'light' | 'dark' = themePreference === 'dark' ? 'dark' : 'light';
    return active === 'dark' ? brandTokens.dark : brandTokens.light;
  }, [brandTokens, themePreference]);

  const switchBrand = useCallback((brandId: BrandId) => {
    const target = BRAND_REGISTRY[brandId];
    if (!target) {
      console.warn(`BrandThemeProvider: marca "${brandId}" não encontrada.`);
      return;
    }
    setActiveBrandId(brandId);
  }, []);

  const resetBrand = useCallback(() => {
    setActiveBrandId('aerostore');
    setThemePreference('light');
  }, []);

  const value = useMemo<BrandContextValue>(() => ({
    brand,
    switchBrand,
    resetBrand,
    defaultBrandId: 'aerostore',
    availableBrands: Object.values(BRAND_REGISTRY).filter(b => b.enabled),
    allBrands: Object.values(BRAND_REGISTRY),
  }), [brand, switchBrand, resetBrand]);

  // Provider interno que expõe tokens + brand
  return React.createElement(
    BrandContext.Provider,
    { value },
    // InternalThemeContext.Provider seria aqui no app real
    // Por enquanto, children recebem o context
    children
  );
}

// ============================================
// Hooks
// ============================================

/**
 * Hook para acessar a marca ativa.
 */
export function useBrand(): BrandContextValue {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error('useBrand must be used within a BrandThemeProvider');
  }
  return context;
}

/**
 * Hook para verificar feature flags.
 */
export function useFeatureFlag(): {
  isFeatureEnabled: (feature: keyof FeatureFlags) => boolean;
  featureFlags: FeatureFlags;
} {
  const { brand } = useBrand();
  return {
    isFeatureEnabled: (feature) => brand.featureFlags[feature] === true,
    featureFlags: brand.featureFlags,
  };
}

/**
 * Hook para acessar tokens do tema da marca ativa.
 */
export function useBrandTheme(): {
  tokens: ThemeTokens;
  brand: BrandConfig;
} {
  const { brand } = useBrand();
  const brandTokens = useMemo(() => createBrandTokens(brand), [brand]);
  return {
    tokens: brandTokens.light, // Simplificado para smoke
    brand,
  };
}

/**
 * Hook para acessar contatos da marca ativa.
 */
export function useBrandContacts(): BrandContacts {
  const { brand } = useBrand();
  return brand.contacts;
}

/**
 * Hook para acessar assets da marca ativa.
 */
export function useBrandAssets(): BrandAssets {
  const { brand } = useBrand();
  return brand.assets;
}

/**
 * Hook para obter lista de marcas disponíveis.
 */
export function useAvailableBrands(): {
  brands: BrandConfig[];
  switchBrand: (id: BrandId) => void;
  currentBrandId: BrandId;
} {
  const { brand, switchBrand, allBrands } = useBrand();
  return {
    brands: allBrands,
    switchBrand,
    currentBrandId: brand.id,
  };
}

// ============================================
// Exports auxiliares
// ============================================

export { BRAND_REGISTRY };
export { createBrandTokens };
