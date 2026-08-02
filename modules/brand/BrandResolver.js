/**
 * BrandResolver — Resolução da marca ativa por diferentes estratégias.
 * Suporta: configuração, domínio, subdomínio, header, build, QRCode.
 * Na fase atual, apenas configuração fixa é utilizada.
 */

/**
 * Estratégias de resolução suportadas.
 */
const RESOLUTION_STRATEGIES = {
  CONFIG: 'config',
  DOMAIN: 'domain',
  SUBDOMAIN: 'subdomain',
  HEADER: 'header',
  BUILD: 'build',
  QRCODE: 'qrcode'
};

class BrandResolver {
  constructor(brandService) {
    /** @type {import('./BrandService')} */
    this._brandService = brandService;
    this._currentStrategy = RESOLUTION_STRATEGIES.CONFIG;
    this._configBrandId = null;
  }

  /**
   * Resolve a marca ativa com base na estratégia atual.
   * @returns {Object|null} Marca resolvida ou null
   */
  resolve() {
    switch (this._currentStrategy) {
      case RESOLUTION_STRATEGIES.CONFIG:
        return this._resolveByConfig();

      case RESOLUTION_STRATEGIES.DOMAIN:
        return this._resolveByDomain();

      case RESOLUTION_STRATEGIES.SUBDOMAIN:
        return this._resolveBySubdomain();

      case RESOLUTION_STRATEGIES.HEADER:
        return this._resolveByHeader();

      case RESOLUTION_STRATEGIES.BUILD:
        return this._resolveByBuild();

      case RESOLUTION_STRATEGIES.QRCODE:
        return this._resolveByQRCode();

      default:
        return this._brandService.getActiveBrand();
    }
  }

  /**
   * Resolução por configuração fixa (estratégia padrão nesta fase).
   * @returns {Object|null}
   */
  _resolveByConfig() {
    if (this._configBrandId) {
      const brand = this._brandService.getBrand(this._configBrandId);
      if (brand && brand.enabled) {
        this._brandService.setActiveBrand(this._configBrandId);
        return brand;
      }
    }
    // Fallback para marca padrão
    return this._brandService.getActiveBrand();
  }

  /**
   * Resolução por domínio (preparada para uso futuro).
   * @returns {Object|null}
   */
  _resolveByDomain() {
    // Implementação futura: mapear domínio para slug de marca
    return this._resolveByConfig();
  }

  /**
   * Resolução por subdomínio (preparada para uso futuro).
   * @returns {Object|null}
   */
  _resolveBySubdomain() {
    // Implementação futura: extrair slug do subdomínio
    return this._resolveByConfig();
  }

  /**
   * Resolução por header HTTP (preparada para uso futuro em middleware).
   * @returns {Object|null}
   */
  _resolveByHeader() {
    // Implementação futura: ler X-Brand-ID do header
    return this._resolveByConfig();
  }

  /**
   * Resolução por build (preparada para uso futuro em mobile).
   * @returns {Object|null}
   */
  _resolveByBuild() {
    // Implementação futura: ler brand do build variant
    return this._resolveByConfig();
  }

  /**
   * Resolução por QRCode (preparada para uso futuro).
   * @returns {Object|null}
   */
  _resolveByQRCode() {
    // Implementação futura: extrair brand do QR code scanned
    return this._resolveByConfig();
  }

  /**
   * Define a estratégia de resolução.
   * @param {string} strategy
   */
  setStrategy(strategy) {
    if (!Object.values(RESOLUTION_STRATEGIES).includes(strategy)) {
      throw new Error(`BrandResolver: estratégia "${strategy}" não suportada.`);
    }
    this._currentStrategy = strategy;
  }

  /**
   * Obtém a estratégia atual.
   * @returns {string}
   */
  getStrategy() {
    return this._currentStrategy;
  }

  /**
   * Define a marca por configuração fixa.
   * @param {string} brandId
   */
  setBrandById(brandId) {
    const brand = this._brandService.getBrand(brandId);
    if (!brand) {
      throw new Error(`BrandResolver: marca "${brandId}" não encontrada.`);
    }
    if (!brand.enabled) {
      throw new Error(`BrandResolver: marca "${brandId}" está desabilitada.`);
    }
    this._configBrandId = brandId;
    this._brandService.setActiveBrand(brandId);
  }

  /**
   * Define a marca por slug.
   * @param {string} slug
   */
  setBrandBySlug(slug) {
    const brand = this._brandService.getBrandBySlug(slug);
    if (!brand) {
      throw new Error(`BrandResolver: marca com slug "${slug}" não encontrada.`);
    }
    if (!brand.enabled) {
      throw new Error(`BrandResolver: marca "${brand.id}" está desabilitada.`);
    }
    this._configBrandId = brand.id;
    this._brandService.setActiveBrand(brand.id);
  }

  /**
   * Obtém a estratégia utilizada (para logs/diagnóstico).
   * @returns {string}
   */
  getResolutionInfo() {
    return {
      strategy: this._currentStrategy,
      activeBrand: this._brandService.getActiveBrand()
        ? this._brandService.getActiveBrand().id
        : null,
      configBrandId: this._configBrandId,
      defaultBrand: this._brandService.getDefaultBrand()
        ? this._brandService.getDefaultBrand().id
        : null
    };
  }
}

module.exports = { BrandResolver, RESOLUTION_STRATEGIES };
