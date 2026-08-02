/**
 * Marca AEROSTORE — Configuração padrão.
 * Marca principal ativa por padrão.
 */

const { createBrandConfig } = require('../BrandDTO');

const aerostore = createBrandConfig({
  id: 'aerostore',
  slug: 'aerostore',
  displayName: 'AEROSTORE',
  shortName: 'AERO',
  assets: {
    logo: '/assets/brands/aerostore/logo.png',
    logoDark: '/assets/brands/aerostore/logo-dark.png',
    logoLight: '/assets/brands/aerostore/logo-light.png',
    icon: '/assets/brands/aerostore/icon.png',
    splash: '/assets/brands/aerostore/splash.png'
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
    warningColor: '#D97706'
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
    supportWhatsApp: '+5511999990001'
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
    avaliacoes: true
  },
  stores: {
    participatingStores: ['store-sp-001', 'store-rj-001', 'store-mg-001'],
    hiddenStores: [],
    distributionCenters: ['cd-sp', 'cd-rj'],
    pickupRules: {
      maxDaysToPickup: 5,
      requireDocument: true
    },
    localShipping: {
      baseRate: 15.00,
      freeAbove: 200.00,
      maxDistanceKm: 30
    }
  },
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  locale: 'pt-BR',
  enabled: true
});

module.exports = aerostore;
