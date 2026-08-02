/**
 * BrandDTO — Data Transfer Object para configuração de marca.
 * Contém todos os campos necessários para identidade visual, institucional e feature flags.
 */

/**
 * @typedef {Object} BrandColors
 * @property {string} primaryColor
 * @property {string} secondaryColor
 * @property {string} accentColor
 * @property {string} backgroundColor
 * @property {string} surfaceColor
 * @property {string} textColor
 * @property {string} errorColor
 * @property {string} successColor
 * @property {string} warningColor
 */

/**
 * @typedef {Object} BrandAssets
 * @property {string} logo - URL ou caminho do logo principal
 * @property {string} logoDark - URL ou caminho do logo para tema escuro
 * @property {string} logoLight - URL ou caminho do logo para tema claro
 * @property {string} icon - Ícone do app
 * @property {string} splash - Splash screen
 */

/**
 * @typedef {Object} BrandContacts
 * @property {string} website
 * @property {string} instagram
 * @property {string} facebook
 * @property {string} whatsapp
 * @property {string} email
 * @property {string} privacyPolicyUrl
 * @property {string} termsUrl
 * @property {string} supportPhone
 * @property {string} supportEmail
 * @property {string} supportWhatsApp
 */

/**
 * @typedef {Object} BrandFeatureFlags
 * @property {boolean} cashback
 * @property {boolean} marketplace
 * @property {boolean} wishlist
 * @property {boolean} retirada
 * @property {boolean} entrega
 * @property {boolean} motoboy
 * @property {boolean} frete
 * @property {boolean} pix
 * @property {boolean} cartao
 * @property {boolean} programaFidelidade
 * @property {boolean} notificacoes
 * @property {boolean} cupons
 * @property {boolean} giftCard
 * @property {boolean} avaliacoes
 */

/**
 * @typedef {Object} BrandStores
 * @property {string[]} participatingStores - Lojas participantes
 * @property {string[]} hiddenStores - Lojas ocultas
 * @property {string[]} distributionCenters - Centros de distribuição
 * @property {Object} pickupRules - Regras de retirada
 * @property {Object} localShipping - Frete local
 */

/**
 * @typedef {Object} BrandConfig
 * @property {string} id
 * @property {string} slug
 * @property {string} displayName
 * @property {string} shortName
 * @property {BrandAssets} assets
 * @property {BrandColors} colors
 * @property {BrandContacts} contacts
 * @property {BrandFeatureFlags} featureFlags
 * @property {BrandStores} stores
 * @property {string} currency - BRL, USD, EUR
 * @property {string} timezone - America/Sao_Paulo
 * @property {string} locale - pt-BR
 * @property {boolean} enabled - Marca ativa ou desativada
 */

/**
 * Validação do BrandConfig.
 * @param {Partial<BrandConfig>} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBrandConfig(config) {
  const errors = [];

  if (!config.id) errors.push('id é obrigatório');
  if (!config.slug) errors.push('slug é obrigatório');
  if (!config.displayName) errors.push('displayName é obrigatório');
  if (!config.shortName) errors.push('shortName é obrigatório');

  // Validar slug: apenas letras minúsculas, números e hifens
  if (config.slug && !/^[a-z0-9-]+$/.test(config.slug)) {
    errors.push('slug deve conter apenas letras minúsculas, números e hifens');
  }

  // Validar cores
  if (config.colors) {
    const colorFields = [
      'primaryColor', 'secondaryColor', 'accentColor',
      'backgroundColor', 'surfaceColor', 'textColor',
      'errorColor', 'successColor', 'warningColor'
    ];
    for (const field of colorFields) {
      if (config.colors[field] && !/^#[0-9A-Fa-f]{3,8}$/.test(config.colors[field])) {
        errors.push(`colors.${field} deve ser uma cor hexadecimal válida`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Cria um BrandConfig com valores padrão para campos ausentes.
 * @param {Partial<BrandConfig>} config
 * @returns {BrandConfig}
 */
function createBrandConfig(config) {
  const defaults = {
    id: '',
    slug: '',
    displayName: '',
    shortName: '',
    assets: {
      logo: '',
      logoDark: '',
      logoLight: '',
      icon: '',
      splash: ''
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
      website: '',
      instagram: '',
      facebook: '',
      whatsapp: '',
      email: '',
      privacyPolicyUrl: '',
      termsUrl: '',
      supportPhone: '',
      supportEmail: '',
      supportWhatsApp: ''
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
      participatingStores: [],
      hiddenStores: [],
      distributionCenters: [],
      pickupRules: {},
      localShipping: {}
    },
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    enabled: true
  };

  // Deep merge
  const merged = JSON.parse(JSON.stringify(defaults));
  for (const key of Object.keys(config)) {
    if (config[key] !== undefined) {
      if (typeof config[key] === 'object' && config[key] !== null && !Array.isArray(config[key])) {
        merged[key] = { ...merged[key], ...config[key] };
      } else {
        merged[key] = config[key];
      }
    }
  }

  return merged;
}

/**
 * Serializa BrandConfig para formato seguro para transporte.
 * @param {BrandConfig} config
 * @returns {Object}
 */
function serializeBrandConfig(config) {
  return {
    id: config.id,
    slug: config.slug,
    displayName: config.displayName,
    shortName: config.shortName,
    enabled: config.enabled,
    currency: config.currency,
    timezone: config.timezone,
    locale: config.locale,
    colors: { ...config.colors },
    assets: { ...config.assets },
    contacts: { ...config.contacts },
    featureFlags: { ...config.featureFlags }
  };
}

module.exports = {
  validateBrandConfig,
  createBrandConfig,
  serializeBrandConfig
};
