"use strict";

const {
  listPdvPublicationCandidates,
  getPdvPublicationCandidate,
  listPublicationRecords,
  getShopPublicationSchemaStatus,
  getPublicationLayerStats
} = require("../services/shopPublicationService");
const {
  isPilotJsonEnabled,
  isShopPublicCatalogEnabled
} = require("../services/shopSettingsService");

function createShopAdminAuthGuard(requireAnyPermission) {
  return requireAnyPermission(
    ["can_manage_global_settings"],
    "Acesso restrito à publicação shop do CRM."
  );
}

function registerShopAdminRoutes(app, deps = {}) {
  if (!app) {
    return;
  }

  const requireAnyPermission = deps.requireAnyPermission;
  if (typeof requireAnyPermission !== "function") {
    return;
  }

  const guard = createShopAdminAuthGuard(requireAnyPermission);

  app.get("/api/shop/publication/status", guard, async (req, res) => {
    try {
      const schema = await getShopPublicationSchemaStatus();
      const layer = await getPublicationLayerStats();
      res.json({
        success: true,
        schema_ready: schema.ready,
        tables: schema.tables,
        message: schema.message,
        publication_layer: layer,
        public_catalog_enabled: isShopPublicCatalogEnabled(),
        pilot_json_active: isPilotJsonEnabled()
      });
    } catch (error) {
      res.status(500).json({ error: "Falha ao consultar status da camada shop." });
    }
  });

  app.get("/api/shop/publication/candidates", guard, async (req, res) => {
    try {
      const payload = await listPdvPublicationCandidates(req.query || {});
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: "Falha ao listar candidatos PDV para publicação." });
    }
  });

  app.get("/api/shop/publication/candidates/:pdvProductRef", guard, async (req, res) => {
    try {
      const payload = await getPdvPublicationCandidate(req.params.pdvProductRef);
      if (!payload) {
        res.status(404).json({ error: "Candidato PDV não encontrado." });
        return;
      }
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: "Falha ao carregar candidato PDV." });
    }
  });

  app.get("/api/shop/publications", guard, async (req, res) => {
    try {
      const payload = await listPublicationRecords(req.query || {});
      res.json(payload);
    } catch (error) {
      res.status(500).json({ error: "Falha ao listar publicações shop." });
    }
  });

  // Escrita (Fase 2.9+):
  // POST   /api/shop/publications
  // PATCH  /api/shop/publications/:id
  // DELETE /api/shop/publications/:id
}

module.exports = {
  registerShopAdminRoutes,
  createShopAdminAuthGuard
};
