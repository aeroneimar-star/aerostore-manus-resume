/**
 * BrandService — Serviço principal do BrandEngine.
 * Gerencia registro, consulta e ativação de marcas.
 */

const { validateBrandConfig, createBrandConfig, serializeBrandConfig } = require('./BrandDTO');

class BrandService {
  constructor() {
    /** @type {Map<string, Object>} */
    this._brands = new Map();
    this._defaultBrandId = null;
    this._activeBrandId = null;
    this._registryFrozen = false;
  }

  /**
   * Registra uma marca no BrandEngine.
   * @param {Object} config - Configuração da marca (será normalizada via createBrandConfig)
   * @returns {Object} Configuração normalizada da marca
   */
  register(config) {
    if (this._registryFrozen) {
      throw new Error('BrandService: registro já finalizado. Não é possível adicionar marcas.');
    }

    const { valid, errors } = validateBrandConfig(config);
    if (!valid) {
      throw new Error(`BrandService: configuração inválida — ${errors.join(', ')}`);
    }

    const normalized = createBrandConfig(config);

    // Verificar se slug já existe
    if (this._brands.has(normalized.id)) {
      throw new Error(`BrandService: marca com id "${normalized.id}" já registrada.`);
    }

    // Verificar se slug já existe em outra marca
    for (const [, existing] of this._brands) {
      if (existing.slug === normalized.slug) {
        throw new Error(`BrandService: marca com slug "${normalized.slug}" já registrada.`);
      }
    }

    this._brands.set(normalized.id, normalized);

    // Primeira marca registrada é a padrão (se não houver uma explícita)
    if (!this._defaultBrandId) {
      this._defaultBrandId = normalized.id;
    }

    return normalized;
  }

  /**
   * Registra múltiplas marcas de uma vez.
   * @param {Object[]} configs - Array de configurações de marca
   * @returns {Object[]} Configurações normalizadas
   */
  registerMany(configs) {
    return configs.map(config => this.register(config));
  }

  /**
   * Finaliza o registro. Nenhuma nova marca pode ser adicionada após isso.
   */
  freeze() {
    this._registryFrozen = true;
  }

  /**
   * Obtém uma marca por id.
   * @param {string} id
   * @returns {Object|null}
   */
  getBrand(id) {
    return this._brands.get(id) || null;
  }

  /**
   * Obtém uma marca por slug.
   * @param {string} slug
   * @returns {Object|null}
   */
  getBrandBySlug(slug) {
    for (const [id, brand] of this._brands) {
      if (brand.slug === slug) {
        return brand;
      }
    }
    return null;
  }

  /**
   * Lista todas as marcas registradas.
   * @param {boolean} includeDisabled - Se true, inclui marcas desabilitadas
   * @returns {Object[]}
   */
  listBrands(includeDisabled = false) {
    const all = Array.from(this._brands.values());
    if (includeDisabled) {
      return all;
    }
    return all.filter(b => b.enabled);
  }

  /**
   * Obtém a marca padrão.
   * @returns {Object|null}
   */
  getDefaultBrand() {
    return this._defaultBrandId ? this._brands.get(this._defaultBrandId) || null : null;
  }

  /**
   * Define a marca padrão.
   * @param {string} id
   */
  setDefaultBrand(id) {
    if (!this._brands.has(id)) {
      throw new Error(`BrandService: marca "${id}" não encontrada.`);
    }
    this._defaultBrandId = id;
  }

  /**
   * Obtém a marca ativa (ou a padrão se nenhuma ativa).
   * @returns {Object|null}
   */
  getActiveBrand() {
    const brand = this._activeBrandId
      ? this._brands.get(this._activeBrandId)
      : this.getDefaultBrand();

    // Se a marca ativa está desabilitada, fallback para padrão habilitada
    if (brand && !brand.enabled) {
      return this.getDefaultBrand();
    }

    return brand || null;
  }

  /**
   * Define a marca ativa.
   * @param {string} id
   */
  setActiveBrand(id) {
    if (!this._brands.has(id)) {
      throw new Error(`BrandService: marca "${id}" não encontrada.`);
    }
    this._activeBrandId = id;
  }

  /**
   * Limpa a marca ativa (volta para padrão).
   */
  clearActiveBrand() {
    this._activeBrandId = null;
  }

  /**
   * Verifica se uma feature está habilitada para a marca ativa.
   * @param {string} featureName - Nome da feature (ex: 'pix', 'cashback')
   * @returns {boolean}
   */
  isFeatureEnabled(featureName) {
    const brand = this.getActiveBrand();
    if (!brand) return false;
    return brand.featureFlags[featureName] === true;
  }

  /**
   * Obtém as cores da marca ativa (para integração com ThemeEngine).
   * @param {'LIGHT'|'DARK'} [mode='LIGHT']
   * @returns {Object}
   */
  getBrandColors(mode = 'LIGHT') {
    const brand = this.getActiveBrand();
    if (!brand) return {};
    return brand.colors;
  }

  /**
   * Obtém os assets da marca ativa.
   * @returns {Object}
   */
  getBrandAssets() {
    const brand = this.getActiveBrand();
    if (!brand) return {};
    return brand.assets;
  }

  /**
   * Obtém os contatos da marca ativa.
   * @returns {Object}
   */
  getBrandContacts() {
    const brand = this.getActiveBrand();
    if (!brand) return {};
    return brand.contacts;
  }

  /**
   * Obtém a configuração completa da marca ativa serializada.
   * @returns {Object|null}
   */
  getActiveBrandSerialized() {
    const brand = this.getActiveBrand();
    if (!brand) return null;
    return serializeBrandConfig(brand);
  }

  /**
   * Verifica se uma loja está disponível para a marca ativa.
   * @param {string} storeId
   * @returns {boolean}
   */
  isStoreAvailable(storeId) {
    const brand = this.getActiveBrand();
    if (!brand) return false;

    const participating = brand.stores.participatingStores || [];
    const hidden = brand.stores.hiddenStores || [];

    return participating.includes(storeId) && !hidden.includes(storeId);
  }

  /**
   * Obtém as lojas da marca ativa.
   * @returns {Object}
   */
  getBrandStores() {
    const brand = this.getActiveBrand();
    if (!brand) return { participatingStores: [], hiddenStores: [], distributionCenters: [], pickupRules: {}, localShipping: {} };
    return brand.stores;
  }

  /**
   * Conta de marcas registradas.
   * @returns {number}
   */
  get brandCount() {
    return this._brands.size;
  }
}

module.exports = BrandService;
