/**
 * BrandMiddleware — Middleware Express para injeção de BrandContext nas requisições.
 * Permite que cada rota da API tenha acesso à marca ativa.
 */

const { RESOLUTION_STRATEGIES } = require('./BrandResolver');

/**
 * Cria middleware de brand para Express.
 * @param {import('./BrandResolver')} resolver
 * @returns {Function} Middleware Express
 */
function brandMiddleware(resolver) {
  return (req, res, next) => {
    try {
      // Tenta resolver por header X-Brand-ID (se estratégia é header)
      const headerBrandId = req.headers['x-brand-id'];
      if (headerBrandId) {
        const brand = resolver._brandService.getBrand(headerBrandId);
        if (brand && brand.enabled) {
          resolver._brandService.setActiveBrand(brand.id);
        }
      }

      // Injeta BrandContext na requisição
      req.brand = {
        id: resolver._brandService.getActiveBrand()?.id || 'aerostore',
        slug: resolver._brandService.getActiveBrand()?.slug || 'aerostore',
        displayName: resolver._brandService.getActiveBrand()?.displayName || 'AEROSTORE',
        shortName: resolver._brandService.getActiveBrand()?.shortName || 'AERO',
        colors: resolver._brandService.getBrandColors(),
        assets: resolver._brandService.getBrandAssets(),
        contacts: resolver._brandService.getBrandContacts(),
        featureFlags: resolver._brandService.getActiveBrand()?.featureFlags || {},
        stores: resolver._brandService.getBrandStores(),
        currency: resolver._brandService.getActiveBrand()?.currency || 'BRL',
        timezone: resolver._brandService.getActiveBrand()?.timezone || 'America/Sao_Paulo',
        locale: resolver._brandService.getActiveBrand()?.locale || 'pt-BR'
      };

      // Método auxiliar para verificar feature
      req.brand.isFeatureEnabled = (feature) => {
        return req.brand.featureFlags[feature] === true;
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Middleware para proteger rotas que dependem de marca habilitada.
 * @param {import('./BrandResolver')} resolver
 * @returns {Function} Middleware Express
 */
function requireActiveBrand(resolver) {
  return (req, res, next) => {
    const brand = resolver.resolve();
    if (!brand || !brand.enabled) {
      return res.status(503).json({
        error: 'BRAND_UNAVAILABLE',
        message: 'Nenhuma marca ativa disponível.'
      });
    }
    next();
  };
}

module.exports = { brandMiddleware, requireActiveBrand };
