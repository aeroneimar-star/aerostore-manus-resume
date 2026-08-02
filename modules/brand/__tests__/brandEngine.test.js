/**
 * Testes do BrandEngine — BrandDTO, BrandService, BrandResolver, BrandContext, Middleware.
 *
 * Suítes:
 * 1. BrandDTO (validação, criação, serialização)
 * 2. BrandService (registro, consulta, ativação, freeze, fallback)
 * 3. BrandResolver (config, slug, estratégia, erro)
 * 4. BrandContext (propriedades, feature flags, contatos)
 * 5. Feature Flags (habilitadas/desabilitadas por marca)
 * 6. Assets (logo, icon, splash)
 * 7. Theme por marca (cores por marca)
 * 8. Fallback (marca inexistente, marca desabilitada, padrão)
 * 9. Middleware (injeção, requireActiveBrand)
 * 10. Marca padrão
 */

const {
  BrandService,
  BrandResolver,
  BrandContext,
  brandMiddleware,
  requireActiveBrand,
  validateBrandConfig,
  createBrandConfig,
  serializeBrandConfig,
  createBrandEngine,
  AEROSTORE,
  CASA_CAMBORE,
  RESOLUTION_STRATEGIES,
} = require('../index');

// Simples test runner
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function describe(name, fn) {
  console.log(`\n  ${name}`);
  fn();
}

function it(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`    ✓ ${name}`);
  } catch (err) {
    failedTests++;
    console.log(`    ✗ ${name}: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn, message) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  assert(threw, message || 'Expected function to throw');
}

// ============================================
// 1. BrandDTO
// ============================================
describe('BrandDTO', () => {
  it('validateBrandConfig rejeita config sem id', () => {
    const result = validateBrandConfig({ slug: 'test' });
    assert(!result.valid);
    assert(result.errors.some(e => e.includes('id')));
  });

  it('validateBrandConfig rejeita slug inválido', () => {
    const result = validateBrandConfig({ id: 'x', slug: 'INVALID_SLUG' });
    assert(!result.valid);
    assert(result.errors.some(e => e.includes('slug')));
  });

  it('validateBrandConfig aceita config mínima válida', () => {
    const result = validateBrandConfig({
      id: 'test',
      slug: 'test-brand',
      displayName: 'Test Brand',
      shortName: 'TEST',
    });
    assert(result.valid);
    assertEqual(result.errors.length, 0);
  });

  it('createBrandConfig preenche valores padrão', () => {
    const config = createBrandConfig({
      id: 'test',
      slug: 'test',
      displayName: 'Test',
      shortName: 'TST',
    });
    assertEqual(config.currency, 'BRL');
    assertEqual(config.timezone, 'America/Sao_Paulo');
    assertEqual(config.locale, 'pt-BR');
    assertEqual(config.enabled, true);
    assert(config.colors.primaryColor);
    assert(config.featureFlags.pix !== undefined);
  });

  it('serializeBrandConfig retorna objeto serializável', () => {
    const config = createBrandConfig({
      id: 'test',
      slug: 'test',
      displayName: 'Test',
      shortName: 'TST',
    });
    const serialized = serializeBrandConfig(config);
    assert(typeof serialized === 'object');
    assertEqual(serialized.id, 'test');
    assert(serialized.colors);
    assert(serialized.assets);
    assert(serialized.contacts);
    assert(serialized.featureFlags);
  });
});

// ============================================
// 2. BrandService
// ============================================
describe('BrandService', () => {
  it('registra marcas com sucesso', () => {
    const service = new BrandService();
    const brand = service.register(AEROSTORE);
    assertEqual(brand.id, 'aerostore');
    assertEqual(brand.displayName, 'AEROSTORE');
  });

  it('rejeita registro duplicado', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    assertThrows(() => service.register(AEROSTORE), 'Expected duplicate registration to throw');
  });

  it('rejeita registro após freeze', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.freeze();
    assertThrows(() => service.register(CASA_CAMBORE), 'Expected frozen registration to throw');
  });

  it('primeira marca registrada é a padrão', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    const defaultBrand = service.getDefaultBrand();
    assertEqual(defaultBrand.id, 'aerostore');
  });

  it('getBrand por id retorna marca correta', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);
    const brand = service.getBrand('casa-cambore');
    assertEqual(brand.id, 'casa-cambore');
    assertEqual(brand.displayName, 'Casa CAMBORÊ');
  });

  it('getBrand por slug retorna marca correta', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    const brand = service.getBrandBySlug('aerostore');
    assertEqual(brand.id, 'aerostore');
  });

  it('getBrand por slug inexistente retorna null', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    assertEqual(service.getBrandBySlug('nonexistent'), null);
  });

  it('listBrands inclui/desabilita conforme flag', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);

    const enabled = service.listBrands(false);
    assertEqual(enabled.length, 1);
    assertEqual(enabled[0].id, 'aerostore');

    const all = service.listBrands(true);
    assertEqual(all.length, 2);
  });

  it('setDefaultBrand altera marca padrão', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);
    service.setDefaultBrand('casa-cambore');
    assertEqual(service.getDefaultBrand().id, 'casa-cambore');
  });

  it('setDefaultBrand rejeita marca inexistente', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    assertThrows(() => service.setDefaultBrand('nonexistent'));
  });

  it('getActiveBrand retorna marca padrão quando nenhuma ativa', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    assertEqual(service.getActiveBrand().id, 'aerostore');
  });

  it('setActiveBrand altera marca ativa (quando habilitada)', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);
    // Habilitar casa-cambore para o teste
    const cambore = service.getBrand('casa-cambore');
    cambore.enabled = true;
    service.setActiveBrand('casa-cambore');
    assertEqual(service.getActiveBrand().id, 'casa-cambore');
    // Restaurar
    cambore.enabled = false;
  });

  it('clearActiveBrand volta para padrão', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);
    service.setActiveBrand('casa-cambore');
    service.clearActiveBrand();
    assertEqual(service.getActiveBrand().id, 'aerostore');
  });

  it('getActiveBrand faz fallback quando marca ativa está desabilitada', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);
    service.setActiveBrand('casa-cambore'); // desabilitada
    const active = service.getActiveBrand();
    assertEqual(active.id, 'aerostore'); // fallback para padrão habilitada
  });

  it('brandCount retorna quantidade correta', () => {
    const service = new BrandService();
    assertEqual(service.brandCount, 0);
    service.register(AEROSTORE);
    assertEqual(service.brandCount, 1);
    service.register(CASA_CAMBORE);
    assertEqual(service.brandCount, 2);
  });
});

// ============================================
// 3. BrandResolver
// ============================================
describe('BrandResolver', () => {
  it('resolve por config retorna marca padrão', () => {
    const engine = createBrandEngine();
    const resolved = engine.resolver.resolve();
    assertEqual(resolved.id, 'aerostore');
  });

  it('setBrandById ativa marca correta', () => {
    const engine = createBrandEngine();
    // Casa CAMBORÊ está desabilitada, precisa ativar primeiro
    const service = engine.service;
    const cambore = service.getBrand('casa-cambore');
    cambore.enabled = true;

    engine.resolver.setBrandById('casa-cambore');
    const resolved = engine.resolver.resolve();
    assertEqual(resolved.id, 'casa-cambore');
  });

  it('setBrandBySlug ativa marca correta', () => {
    const engine = createBrandEngine();
    const cambore = engine.service.getBrand('casa-cambore');
    cambore.enabled = true;

    engine.resolver.setBrandBySlug('casa-cambore');
    const resolved = engine.resolver.resolve();
    assertEqual(resolved.id, 'casa-cambore');
  });

  it('setBrandById rejeita marca inexistente', () => {
    const engine = createBrandEngine();
    assertThrows(() => engine.resolver.setBrandById('nonexistent'));
  });

  it('setBrandById rejeita marca desabilitada', () => {
    const engine = createBrandEngine();
    // Casa CAMBORÊ está desabilitada por padrão
    assertThrows(() => engine.resolver.setBrandById('casa-cambore'));
  });

  it('getResolutionInfo retorna informações corretas', () => {
    const engine = createBrandEngine();
    const info = engine.resolver.getResolutionInfo();
    assertEqual(info.strategy, 'config');
    assertEqual(info.activeBrand, 'aerostore');
    assertEqual(info.defaultBrand, 'aerostore');
  });

  it('getStrategy retorna estratégia atual', () => {
    const engine = createBrandEngine();
    assertEqual(engine.resolver.getStrategy(), 'config');
    engine.resolver.setStrategy('domain');
    assertEqual(engine.resolver.getStrategy(), 'domain');
  });

  it('setStrategy rejeita estratégia inválida', () => {
    const engine = createBrandEngine();
    assertThrows(() => engine.resolver.setStrategy('invalid'));
  });
});

// ============================================
// 4. BrandContext
// ============================================
describe('BrandContext', () => {
  it('displayName retorna nome da marca ativa', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.displayName, 'AEROSTORE');
  });

  it('shortName retorna nome curto da marca ativa', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.shortName, 'AERO');
  });

  it('slug retorna slug da marca ativa', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.slug, 'aerostore');
  });

  it('currency retorna BRL', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.currency, 'BRL');
  });

  it('locale retorna pt-BR', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.locale, 'pt-BR');
  });

  it('timezone retorna America/Sao_Paulo', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.timezone, 'America/Sao_Paulo');
  });

  it('supportEmail retorna email de suporte', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.supportEmail, 'suporte@aerostore.com.br');
  });

  it('supportWhatsApp retorna WhatsApp de suporte', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.supportWhatsApp, '+5511999990001');
  });

  it('website retorna URL do site', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.website, 'https://aerostore.com.br');
  });

  it('privacyPolicyUrl retorna URL de privacidade', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.privacyPolicyUrl, 'https://aerostore.com.br/privacidade');
  });

  it('termsUrl retorna URL de termos', () => {
    const engine = createBrandEngine();
    assertEqual(engine.context.termsUrl, 'https://aerostore.com.br/termos');
  });

  it('isEnabled retorna true para marca habilitada', () => {
    const engine = createBrandEngine();
    assert(engine.context.isEnabled === true);
  });

  it('getLogo retorna logo da marca', () => {
    const engine = createBrandEngine();
    const logo = engine.context.getLogo('LIGHT');
    assert(logo.includes('aerostore'));
  });

  it('getLogo retorna logoDark quando mode é DARK', () => {
    const engine = createBrandEngine();
    const logo = engine.context.getLogo('DARK');
    assert(logo.includes('logo-dark'));
  });

  it('toJSON retorna serialização completa', () => {
    const engine = createBrandEngine();
    const json = engine.context.toJSON();
    assertEqual(json.id, 'aerostore');
    assert(json.colors);
    assert(json.assets);
    assert(json.contacts);
    assert(json.featureFlags);
  });
});

// ============================================
// 5. Feature Flags
// ============================================
describe('Feature Flags', () => {
  it('AEROSTORE: PIX habilitado', () => {
    const engine = createBrandEngine();
    assert(engine.context.isFeatureEnabled('pix') === true);
  });

  it('AEROSTORE: Cartão habilitado', () => {
    const engine = createBrandEngine();
    assert(engine.context.isFeatureEnabled('cartao') === true);
  });

  it('AEROSTORE: Cupons habilitado', () => {
    const engine = createBrandEngine();
    assert(engine.context.isFeatureEnabled('cupons') === true);
  });

  it('AEROSTORE: Marketplace desabilitado', () => {
    const engine = createBrandEngine();
    assert(engine.context.isFeatureEnabled('marketplace') === false);
  });

  it('AEROSTORE: Gift Card desabilitado', () => {
    const engine = createBrandEngine();
    assert(engine.context.isFeatureEnabled('giftCard') === false);
  });

  it('AEROSTORE: Programa Fidelidade desabilitado', () => {
    const engine = createBrandEngine();
    assert(engine.context.isFeatureEnabled('programaFidelidade') === false);
  });

  it('Casa CAMBORÊ: Gift Card habilitado', () => {
    const engine = createBrandEngine();
    // Ativar Casa CAMBORÊ temporariamente
    const cambore = engine.service.getBrand('casa-cambore');
    cambore.enabled = true;
    engine.service.setActiveBrand('casa-cambore');
    assert(engine.context.isFeatureEnabled('giftCard') === true);
    // Restaurar
    engine.service.setActiveBrand('aerostore');
    cambore.enabled = false;
  });

  it('Casa CAMBORÊ: Programa Fidelidade habilitado', () => {
    const engine = createBrandEngine();
    const cambore = engine.service.getBrand('casa-cambore');
    cambore.enabled = true;
    engine.service.setActiveBrand('casa-cambore');
    assert(engine.context.isFeatureEnabled('programaFidelidade') === true);
    engine.service.setActiveBrand('aerostore');
    cambore.enabled = false;
  });

  it('Casa CAMBORÊ: Avaliações desabilitado', () => {
    const engine = createBrandEngine();
    const cambore = engine.service.getBrand('casa-cambore');
    cambore.enabled = true;
    engine.service.setActiveBrand('casa-cambore');
    assert(engine.context.isFeatureEnabled('avaliacoes') === false);
    engine.service.setActiveBrand('aerostore');
    cambore.enabled = false;
  });

  it('Casa CAMBORÊ: Motoboy habilitado', () => {
    const engine = createBrandEngine();
    const cambore = engine.service.getBrand('casa-cambore');
    cambore.enabled = true;
    engine.service.setActiveBrand('casa-cambore');
    assert(engine.context.isFeatureEnabled('motoboy') === true);
    engine.service.setActiveBrand('aerostore');
    cambore.enabled = false;
  });
});

// ============================================
// 6. Assets
// ============================================
describe('Assets', () => {
  it('getBrandAssets retorna assets da marca ativa', () => {
    const engine = createBrandEngine();
    const assets = engine.context.assets || engine.service.getBrandAssets();
    assert(assets.logo);
    assert(assets.logoDark);
    assert(assets.logoLight);
    assert(assets.icon);
    assert(assets.splash);
  });

  it('AEROSTORE logo contém aerostore', () => {
    const engine = createBrandEngine();
    const assets = engine.service.getBrandAssets();
    assert(assets.logo.includes('aerostore'));
  });

  it('getBrandColors retorna cores da marca ativa', () => {
    const engine = createBrandEngine();
    const colors = engine.service.getBrandColors();
    assertEqual(colors.primaryColor, '#C8834A');
    assertEqual(colors.secondaryColor, '#1A3A3A');
  });
});

// ============================================
// 7. Theme por marca
// ============================================
describe('Theme por marca', () => {
  it('cores da AEROSTORE são corretas', () => {
    const engine = createBrandEngine();
    const colors = engine.service.getBrandColors();
    assertEqual(colors.primaryColor, '#C8834A');
    assertEqual(colors.accentColor, '#E6A96E');
    assertEqual(colors.backgroundColor, '#FAF6F0');
  });

  it('cores da Casa CAMBORÊ são diferentes', () => {
    const engine = createBrandEngine();
    const cambore = engine.service.getBrand('casa-cambore');
    cambore.enabled = true;
    engine.service.setActiveBrand('casa-cambore');
    const colors = engine.service.getBrandColors();
    assertEqual(colors.primaryColor, '#4A6741');
    assertEqual(colors.accentColor, '#D4A76A');
    assertEqual(colors.backgroundColor, '#FDFBF7');
    engine.service.setActiveBrand('aerostore');
    cambore.enabled = false;
  });
});

// ============================================
// 8. Fallback
// ============================================
describe('Fallback', () => {
  it('marca inexistente retorna null', () => {
    const service = new BrandService();
    assertEqual(service.getBrand('nonexistent'), null);
  });

  it('marca padrão é AEROSTORE quando registrada primeiro', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);
    assertEqual(service.getDefaultBrand().id, 'aerostore');
  });

  it('marca desabilitada faz fallback para padrão habilitada', () => {
    const service = new BrandService();
    service.register(AEROSTORE);
    service.register(CASA_CAMBORE);
    service.setActiveBrand('casa-cambore'); // desabilitada
    const active = service.getActiveBrand();
    assertEqual(active.id, 'aerostore');
  });

  it('getActiveBrand retorna null quando nenhuma marca registrada', () => {
    const service = new BrandService();
    assertEqual(service.getActiveBrand(), null);
  });
});

// ============================================
// 9. Middleware
// ============================================
describe('Middleware', () => {
  it('brandMiddleware injeta brand na requisição', () => {
    const engine = createBrandEngine();
    const middleware = engine.middleware;

    // Mock Express req/res/next
    const req = { headers: {} };
    const res = {};
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });

    assert(nextCalled);
    assert(req.brand);
    assertEqual(req.brand.id, 'aerostore');
    assertEqual(req.brand.displayName, 'AEROSTORE');
    assert(req.brand.colors);
    assert(req.brand.featureFlags);
  });

  it('req.brand.isFeatureEnabled funciona no middleware', () => {
    const engine = createBrandEngine();
    const middleware = engine.middleware;

    const req = { headers: {} };
    const res = {};
    middleware(req, res, () => {});

    assert(req.brand.isFeatureEnabled('pix') === true);
    assert(req.brand.isFeatureEnabled('marketplace') === false);
  });

  it('middleware aceita header X-Brand-ID', () => {
    const engine = createBrandEngine();
    const middleware = engine.middleware;

    // Ativar casa-cambore para o teste
    const cambore = engine.service.getBrand('casa-cambore');
    cambore.enabled = true;

    const req = { headers: { 'x-brand-id': 'casa-cambore' } };
    const res = {};
    middleware(req, res, () => {});

    assertEqual(req.brand.id, 'casa-cambore');
    assertEqual(req.brand.displayName, 'Casa CAMBORÊ');

    // Restaurar
    cambore.enabled = false;
    engine.service.setActiveBrand('aerostore');
  });
});

// ============================================
// 10. createBrandEngine
// ============================================
describe('createBrandEngine', () => {
  it('cria engine com 2 marcas', () => {
    const engine = createBrandEngine();
    assertEqual(engine.service.brandCount, 2);
  });

  it('AEROSTORE é a marca padrão', () => {
    const engine = createBrandEngine();
    assertEqual(engine.service.getDefaultBrand().id, 'aerostore');
  });

  it('AEROSTORE está ativa por padrão', () => {
    const engine = createBrandEngine();
    assertEqual(engine.service.getActiveBrand().id, 'aerostore');
  });

  it('Casa CAMBORÊ está desabilitada por configuração', () => {
    const engine = createBrandEngine();
    const cambore = engine.service.getBrand('casa-cambore');
    assertEqual(cambore.enabled, false);
  });

  it('brands exportados contêm ambas as marcas', () => {
    const engine = createBrandEngine();
    assert(engine.brands.AEROSTORE);
    assert(engine.brands.CASA_CAMBORE);
    assertEqual(engine.brands.AEROSTORE.id, 'aerostore');
    assertEqual(engine.brands.CASA_CAMBORE.id, 'casa-cambore');
  });
});

// ============================================
// Resultados
// ============================================
console.log(`\n${'='.repeat(50)}`);
console.log(`TOTAL: ${totalTests} tests`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
console.log(`${'='.repeat(50)}\n`);

if (failedTests > 0) {
  process.exit(1);
}
