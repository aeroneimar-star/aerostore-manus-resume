/**
 * BrandEngine — Módulo compartilhado para plataforma multimarca (white-label).
 *
 * Fluxo: App → BrandEngine → ThemeEngine → Assets → Configuração da Marca
 *
 * Componentes:
 * - BrandDTO: Validação e normalização de BrandConfig
 * - BrandService: Registro, consulta e ativação de marcas
 * - BrandResolver: Resolução da marca por diferentes estratégias
 * - BrandContext: Contexto da marca para propagação no app
 * - BrandMiddleware: Middleware Express para API
 */

const BrandService = require('./BrandService');
const { BrandResolver, RESOLUTION_STRATEGIES } = require('./BrandResolver');
const BrandContext = require('./BrandContext');
const { brandMiddleware, requireActiveBrand } = require('./BrandMiddleware');
const {
  validateBrandConfig,
  createBrandConfig,
  serializeBrandConfig
} = require('./BrandDTO');

// Marcas registradas
const AEROSTORE = require('./brands/aerostore');
const CASA_CAMBORE = require('./brands/casa-cambore');

/**
 * Cria uma instância completa do BrandEngine com as marcas padrão.
 * @returns {{ service, resolver, context, middleware, requireActiveBrand }}
 */
function createBrandEngine() {
  const service = new BrandService();

  // Registrar marcas padrão
  service.register(AEROSTORE);
  service.register(CASA_CAMBORE);

  // AEROSTORE é a marca padrão
  service.setDefaultBrand('aerostore');

  // Congelar registro
  service.freeze();

  // Criar resolver com estratégia de configuração
  const resolver = new BrandResolver(service);

  // Criar contexto
  const context = new BrandContext(service);

  return {
    service,
    resolver,
    context,
    middleware: brandMiddleware(resolver),
    requireActiveBrand: requireActiveBrand(resolver),
    // Marcas pré-registradas
    brands: {
      AEROSTORE,
      CASA_CAMBORE
    }
  };
}

module.exports = {
  BrandService,
  BrandResolver,
  BrandContext,
  brandMiddleware,
  requireActiveBrand,
  RESOLUTION_STRATEGIES,
  validateBrandConfig,
  createBrandConfig,
  serializeBrandConfig,
  createBrandEngine,
  AEROSTORE,
  CASA_CAMBORE
};
