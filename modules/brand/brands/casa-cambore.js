/**
 * Marca Casa CAMBORÊ — Configuração.
 * Marca desabilitada por configuração (enabled: false).
 */

const { createBrandConfig } = require('../BrandDTO');

const casaCambore = createBrandConfig({
  id: 'casa-cambore',
  slug: 'casa-cambore',
  displayName: 'Casa CAMBORÊ',
  shortName: 'CAMBORÊ',
  assets: {
    logo: '/assets/brands/casa-cambore/logo.png',
    logoDark: '/assets/brands/casa-cambore/logo-dark.png',
    logoLight: '/assets/brands/casa-cambore/logo-light.png',
    icon: '/assets/brands/casa-cambore/icon.png',
    splash: '/assets/brands/casa-cambore/splash.png'
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
    warningColor: '#CA8A04'
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
    supportWhatsApp: '+5511999990002'
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
    avaliacoes: false
  },
  stores: {
    participatingStores: ['store-cambore-001', 'store-cambore-002'],
    hiddenStores: ['store-cambore-003'],
    distributionCenters: ['cd-cambore-sp'],
    pickupRules: {
      maxDaysToPickup: 3,
      requireDocument: true
    },
    localShipping: {
      baseRate: 20.00,
      freeAbove: 300.00,
      maxDistanceKm: 25
    }
  },
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
  enabled: false
});

module.exports = casaCambore;
