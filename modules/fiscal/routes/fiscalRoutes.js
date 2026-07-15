"use strict";

const express = require("express");
const {
  createFromCompletedSale,
  documentRepository,
  eventRepository,
  establishmentRepository,
  transitionDocumentStatus
} = require("../application/FiscalRequestService");
const { isFiscalModuleEnabled, getFiscalDefaultEnvironment } = require("../utils/fiscalConfig");
const { FISCAL_STATUSES } = require("../domain/fiscalStatuses");

const router = express.Router();

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireFiscalAdmin(req, res, next) {
  const user = req.user || {};
  if (hasAnyPermission(user, ["can_view_audit", "can_manage_global_settings", "can_manage_users"])) {
    return next();
  }
  return res.status(403).json({
    error: "Seu perfil nao pode inspecionar o modulo fiscal.",
    permissions: ["can_view_audit", "can_manage_global_settings", "can_manage_users"]
  });
}

/**
 * Mutações HTTP (criar solicitação / transition) só existem em NODE_ENV=test.
 * Em development/production retornam 404 — Stage 1 é somente inspeção via GET.
 */
function allowFiscalTestOnlyMutations() {
  return String(process.env.NODE_ENV || "").trim().toLowerCase() === "test";
}

function rejectMutationOutsideTest(req, res, next) {
  if (!allowFiscalTestOnlyMutations()) {
    return res.status(404).json({
      error: "Not found.",
      code: "FISCAL_MUTATION_ROUTE_DISABLED"
    });
  }
  return next();
}

router.use(requireFiscalAdmin);

router.get("/status", async (_req, res) => {
  res.json({
    module: "fiscal",
    stage: 1,
    enabled: isFiscalModuleEnabled(),
    transmission: "disabled",
    default_environment: getFiscalDefaultEnvironment(),
    statuses: Object.values(FISCAL_STATUSES),
    runtime_mutations: allowFiscalTestOnlyMutations() ? "test_only" : "disabled"
  });
});

router.get("/documents", async (req, res) => {
  try {
    const documents = await documentRepository.list({
      status: req.query.status || "",
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json({
      count: documents.length,
      documents: documents.map((doc) => ({
        ...doc,
        snapshot: undefined,
        snapshot_json: undefined,
        has_snapshot: Boolean(doc.snapshot_json)
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar documentos fiscais." });
  }
});

router.get("/documents/by-sale/:saleId", async (req, res) => {
  try {
    const documents = await documentRepository.listBySaleId(req.params.saleId);
    res.json({ sale_id: req.params.saleId, documents });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao consultar documentos da venda." });
  }
});

router.get("/documents/:id", async (req, res) => {
  try {
    const document = await documentRepository.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Documento fiscal nao encontrado." });
    }
    const events = await eventRepository.listByDocumentId(document.id);
    res.json({ document, events });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao consultar documento fiscal." });
  }
});

router.get("/documents/:id/events", async (req, res) => {
  try {
    const document = await documentRepository.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Documento fiscal nao encontrado." });
    }
    const events = await eventRepository.listByDocumentId(document.id);
    res.json({ fiscal_document_id: document.id, events });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao consultar eventos fiscais." });
  }
});

router.get("/establishments", async (_req, res) => {
  try {
    const establishments = await establishmentRepository.list({ activeOnly: false });
    const enriched = [];
    for (const item of establishments) {
      const storeIds = await establishmentRepository.listStoreIds(item.id, { activeOnly: false });
      enriched.push({ ...item, store_ids: storeIds });
    }
    res.json({ establishments: enriched });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar estabelecimentos fiscais." });
  }
});

/**
 * Criação manual — apenas NODE_ENV=test (fora disso: 404).
 * Não emite nota — apenas PENDING.
 */
router.post("/requests/from-sale/:saleId", rejectMutationOutsideTest, async (req, res) => {
  try {
    const result = await createFromCompletedSale(req.params.saleId, {
      user: req.user || {},
      model: req.body?.model,
      purpose: req.body?.purpose,
      environment: req.body?.environment,
      skipFeatureFlag: true
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message || "Falha ao criar solicitacao fiscal.",
      code: error.code || "FISCAL_ERROR"
    });
  }
});

/**
 * Transição de status — apenas NODE_ENV=test (fora disso: 404).
 * Em Stage 1 o serviço também bloqueia AUTHORIZED/CANCELLED/etc. sem flag avançada.
 */
router.post("/documents/:id/transition", rejectMutationOutsideTest, async (req, res) => {
  try {
    const toStatus = String(req.body?.to_status || req.body?.status || "").trim().toUpperCase();
    if (!toStatus) {
      return res.status(400).json({ error: "Informe to_status." });
    }
    const result = await transitionDocumentStatus(req.params.id, toStatus, {
      user: req.user || {},
      detail: req.body?.detail || { source: "test_route_stage1" },
      extra: req.body?.extra || {}
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message || "Falha na transicao de status fiscal.",
      code: error.code || "FISCAL_ERROR"
    });
  }
});

module.exports = {
  fiscalRouter: router,
  allowFiscalTestOnlyMutations,
  rejectMutationOutsideTest
};
