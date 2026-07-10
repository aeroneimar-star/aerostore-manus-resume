"use strict";

/**
 * Rotas admin CRM para publicação shop (Fase 2.7+).
 * Serviço read-only disponível via shopPublicationService — rotas HTTP ainda não ativas.
 * Nunca registrar em /public-api/*.
 */
function registerShopAdminRoutes(app) {
  if (!app) {
    return;
  }

  // Fase 2.9+ (autenticado CRM, não público):
  // GET  /api/shop/publication/candidates?q=&page=&limit=
  // GET  /api/shop/publication/candidates/:pdvProductRef
  // GET  /api/shop/publications?limit=
  //
  // Escrita (após DDL aplicado + UI admin):
  // POST   /api/shop/publications
  // PATCH  /api/shop/publications/:id
  // DELETE /api/shop/publications/:id
}

module.exports = {
  registerShopAdminRoutes
};
