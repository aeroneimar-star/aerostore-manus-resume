/**
 * BrandContext — Contexto da marca ativa para propagação no app.
 * Encapsula informações da marca para que qualquer camada possa acessar.
 */

class BrandContext {
  constructor(brandService) {
    /** @type {import('./BrandService')} */
    this._brandService = brandService;
  }

  /**
   * Obtém o nome de exibição da marca ativa.
   * @returns {string}
   */
  get displayName() {
    return this._brandService.getActiveBrand()?.displayName || 'AEROSTORE';
  }

  /**
   * Obtém o nome curto da marca ativa.
   * @returns {string}
   */
  get shortName() {
    return this._brandService.getActiveBrand()?.shortName || 'AERO';
  }

  /**
   * Obtém o slug da marca ativa.
   * @returns {string}
   */
  get slug() {
    return this._brandService.getActiveBrand()?.slug || 'aerostore';
  }

  /**
   * Obtém o ID da marca ativa.
   * @returns {string}
   */
  get id() {
    return this._brandService.getActiveBrand()?.id || 'aerostore';
  }

  /**
   * Obtém o logo adequado para o tema.
   * @param {'LIGHT'|'DARK'} mode
   * @returns {string}
   */
  getLogo(mode = 'LIGHT') {
    const assets = this._brandService.getBrandAssets();
    return mode === 'DARK' ? (assets.logoDark || assets.logo) : (assets.logoLight || assets.logo);
  }

  /**
   * Obtém o ícone da marca.
   * @returns {string}
   */
  get icon() {
    return this._brandService.getBrandAssets().icon || '';
  }

  /**
   * Obtém o splash da marca.
   * @returns {string}
   */
  get splash() {
    return this._brandService.getBrandAssets().splash || '';
  }

  /**
   * Obtém as cores da marca.
   * @returns {Object}
   */
  get colors() {
    return this._brandService.getBrandColors();
  }

  /**
   * Obtém o email de contato da marca.
   * @returns {string}
   */
  get supportEmail() {
    return this._brandService.getBrandContacts().supportEmail || '';
  }

  /**
   * Obtém o WhatsApp de suporte da marca.
   * @returns {string}
   */
  get supportWhatsApp() {
    return this._brandService.getBrandContacts().supportWhatsApp || '';
  }

  /**
   * Obtém o telefone de suporte da marca.
   * @returns {string}
   */
  get supportPhone() {
    return this._brandService.getBrandContacts().supportPhone || '';
  }

  /**
   * Verifica se uma feature está habilitada.
   * @param {string} feature
   * @returns {boolean}
   */
  isFeatureEnabled(feature) {
    return this._brandService.isFeatureEnabled(feature);
  }

  /**
   * Obtém a URL de política de privacidade.
   * @returns {string}
   */
  get privacyPolicyUrl() {
    return this._brandService.getBrandContacts().privacyPolicyUrl || '';
  }

  /**
   * Obtém a URL de termos de uso.
   * @returns {string}
   */
  get termsUrl() {
    return this._brandService.getBrandContacts().termsUrl || '';
  }

  /**
   * Obtém o website da marca.
   * @returns {string}
   */
  get website() {
    return this._brandService.getBrandContacts().website || '';
  }

  /**
   * Obtém o Instagram da marca.
   * @returns {string}
   */
  get instagram() {
    return this._brandService.getBrandContacts().instagram || '';
  }

  /**
   * Obtém o Facebook da marca.
   * @returns {string}
   */
  get facebook() {
    return this._brandService.getBrandContacts().facebook || '';
  }

  /**
   * Obtém a moeda da marca.
   * @returns {string}
   */
  get currency() {
    return this._brandService.getActiveBrand()?.currency || 'BRL';
  }

  /**
   * Obtém o fuso horário da marca.
   * @returns {string}
   */
  get timezone() {
    return this._brandService.getActiveBrand()?.timezone || 'America/Sao_Paulo';
  }

  /**
   * Obtém o locale da marca.
   * @returns {string}
   */
  get locale() {
    return this._brandService.getActiveBrand()?.locale || 'pt-BR';
  }

  /**
   * Verifica se a marca está habilitada.
   * @returns {boolean}
   */
  get isEnabled() {
    const brand = this._brandService.getActiveBrand();
    return brand ? brand.enabled : false;
  }

  /**
   * Obtém a serialização completa da marca ativa (para transporte/API).
   * @returns {Object|null}
   */
  toJSON() {
    return this._brandService.getActiveBrandSerialized();
  }
}

module.exports = BrandContext;
