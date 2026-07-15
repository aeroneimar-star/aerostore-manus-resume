"use strict";

const express = require("express");
const {
  createFromCompletedSale,
  documentRepository,
  eventRepository,
  establishmentRepository,
  transitionDocumentStatus
} = require("../application/FiscalRequestService");
const { FiscalTaxProfileRepository } = require("../repositories/FiscalTaxProfileRepository");
const { FiscalProductTaxRepository } = require("../repositories/FiscalProductTaxRepository");
const { resolveForSaleItem } = require("../application/FiscalTaxResolver");
const { buildFiscalGapsReport } = require("../application/FiscalGapsService");
const { recordFiscalAudit } = require("../application/fiscalAudit");
const { isFiscalModuleEnabled, getFiscalDefaultEnvironment } = require("../utils/fiscalConfig");
const { FISCAL_STATUSES } = require("../domain/fiscalStatuses");
const { FISCAL_OPERATION_TYPES, FISCAL_OPERATION_TYPES_ACTIVE } = require("../domain/fiscalOperations");

const router = express.Router();
const profileRepository = new FiscalTaxProfileRepository();
const productTaxRepository = new FiscalProductTaxRepository();

function hasPermission(user = {}, permission = "") {
  return Boolean(user?.permissions?.[permission]);
}

function hasAnyPermission(user = {}, permissions = []) {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireFiscalRead(req, res, next) {
  const user = req.user || {};
  if (hasAnyPermission(user, [
    "can_view_fiscal",
    "can_manage_fiscal",
    "can_view_audit",
    "can_manage_global_settings",
    "can_manage_users"
  ])) {
    return next();
  }
  return res.status(403).json({
    error: "Seu perfil nao pode consultar o modulo fiscal.",
    permissions: ["can_view_fiscal", "can_manage_fiscal"]
  });
}

function requireFiscalWrite(req, res, next) {
  const user = req.user || {};
  // Stage 2: escrita apenas com can_manage_fiscal (admin) ou settings global.
  // Gestor com can_view_fiscal permanece somente leitura.
  if (hasAnyPermission(user, ["can_manage_fiscal", "can_manage_global_settings"])) {
    return next();
  }
  return res.status(403).json({
    error: "Seu perfil nao pode alterar cadastros fiscais.",
    permissions: ["can_manage_fiscal"]
  });
}

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

router.use(requireFiscalRead);

router.get("/status", async (_req, res) => {
  res.json({
    module: "fiscal",
    stage: 2,
    enabled: isFiscalModuleEnabled(),
    transmission: "disabled",
    default_environment: getFiscalDefaultEnvironment(),
    statuses: Object.values(FISCAL_STATUSES),
    operation_types: Object.values(FISCAL_OPERATION_TYPES),
    operation_types_active: FISCAL_OPERATION_TYPES_ACTIVE,
    runtime_document_mutations: allowFiscalTestOnlyMutations() ? "test_only" : "disabled",
    configuration_markers_are_not_operational_proof: true,
    category_filter_supported: false,
    tax_correctness_policy: "unverified_until_accounting_approval"
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
      const links = await establishmentRepository.listStoreLinks(item.id);
      enriched.push({
        ...item,
        store_ids: links.filter((link) => link.active).map((link) => link.store_id),
        store_links: links,
        gaps: establishmentRepository.completenessGaps(item)
      });
    }
    res.json({ establishments: enriched });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar estabelecimentos fiscais." });
  }
});

router.get("/establishments/:id", async (req, res) => {
  try {
    const establishment = await establishmentRepository.findById(req.params.id);
    if (!establishment) {
      return res.status(404).json({ error: "Estabelecimento nao encontrado." });
    }
    const links = await establishmentRepository.listStoreLinks(establishment.id);
    res.json({
      establishment,
      store_links: links,
      gaps: establishmentRepository.completenessGaps(establishment)
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao consultar estabelecimento." });
  }
});

router.post("/establishments", requireFiscalWrite, async (req, res) => {
  try {
    const created = await establishmentRepository.create(req.body || {});
    await recordFiscalAudit({
      action: "FISCAL_ESTABLISHMENT_CREATED",
      entityId: created.id,
      user: req.user || {},
      metadata: { cnpj: created.cnpj, uf: created.uf }
    });
    res.status(201).json({ establishment: created });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message,
      code: error.code || "FISCAL_ERROR",
      errors: error.errors || []
    });
  }
});

router.put("/establishments/:id", requireFiscalWrite, async (req, res) => {
  try {
    const before = await establishmentRepository.findById(req.params.id);
    const updated = await establishmentRepository.update(req.params.id, req.body || {});
    await recordFiscalAudit({
      action: "FISCAL_ESTABLISHMENT_UPDATED",
      entityId: updated.id,
      user: req.user || {},
      metadata: {
        before: { legal_name: before?.legal_name, cnpj: before?.cnpj, uf: before?.uf, active: before?.active },
        after: { legal_name: updated.legal_name, cnpj: updated.cnpj, uf: updated.uf, active: updated.active }
      }
    });
    res.json({ establishment: updated });
  } catch (error) {
    res.status(error.statusCode || 400).json({
      error: error.message,
      code: error.code || "FISCAL_ERROR",
      errors: error.errors || []
    });
  }
});

router.post("/establishments/:id/stores", requireFiscalWrite, async (req, res) => {
  try {
    const storeId = req.body?.store_id || req.body?.loja || "";
    const active = req.body?.active !== false && req.body?.active !== 0;
    const link = await establishmentRepository.linkStore(req.params.id, storeId, { active });
    await recordFiscalAudit({
      action: active ? "FISCAL_STORE_LINKED" : "FISCAL_STORE_UNLINKED",
      entityId: req.params.id,
      storeId,
      user: req.user || {},
      metadata: { store_id: storeId, active }
    });
    res.status(201).json({ link });
  } catch (error) {
    await recordFiscalAudit({
      action: "FISCAL_STORE_LINK_CONFLICT",
      entityId: req.params.id,
      user: req.user || {},
      result: "error",
      message: error.message,
      metadata: { code: error.code || "" }
    });
    res.status(error.statusCode || 400).json({
      error: error.message,
      code: error.code || "FISCAL_ERROR"
    });
  }
});

router.get("/tax-profiles", async (req, res) => {
  try {
    const profiles = await profileRepository.list({
      activeOnly: String(req.query.active_only || "") === "1",
      operationType: req.query.operation_type || "",
      includeTest: String(req.query.include_test || "1") !== "0"
    });
    res.json({ profiles });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar perfis tributarios." });
  }
});

router.get("/tax-profiles/:id", async (req, res) => {
  try {
    const profile = await profileRepository.findById(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: "Perfil tributario nao encontrado." });
    }
    res.json({ profile });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao consultar perfil." });
  }
});

router.post("/tax-profiles", requireFiscalWrite, async (req, res) => {
  try {
    const created = await profileRepository.create(req.body || {});
    await recordFiscalAudit({
      action: "FISCAL_TAX_PROFILE_CREATED",
      entityId: created.id,
      user: req.user || {},
      metadata: { code: created.code, operation_type: created.operation_type }
    });
    res.status(201).json({ profile: created });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message, code: error.code || "FISCAL_ERROR" });
  }
});

router.put("/tax-profiles/:id", requireFiscalWrite, async (req, res) => {
  try {
    const before = await profileRepository.findById(req.params.id);
    const updated = await profileRepository.update(req.params.id, req.body || {});
    await recordFiscalAudit({
      action: "FISCAL_TAX_PROFILE_UPDATED",
      entityId: updated.id,
      user: req.user || {},
      metadata: {
        before: { code: before?.code, cfop: before?.cfop, csosn: before?.csosn },
        after: { code: updated.code, cfop: updated.cfop, csosn: updated.csosn }
      }
    });
    res.json({ profile: updated });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message, code: error.code || "FISCAL_ERROR" });
  }
});

router.get("/product-tax", async (req, res) => {
  try {
    const rows = await productTaxRepository.list({
      profileId: req.query.profile_id,
      limit: req.query.limit,
      offset: req.query.offset
    });
    res.json({ items: rows });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao listar dados fiscais de produto." });
  }
});

router.get("/product-tax/:productRef", async (req, res) => {
  try {
    const item = await productTaxRepository.findByProductRef(decodeURIComponent(req.params.productRef));
    if (!item) {
      return res.status(404).json({ error: "Cadastro fiscal de produto nao encontrado." });
    }
    res.json({ item });
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao consultar produto fiscal." });
  }
});

router.put("/product-tax", requireFiscalWrite, async (req, res) => {
  try {
    const before = req.body?.product_ref
      ? await productTaxRepository.findByProductRef(req.body.product_ref)
      : null;
    const item = await productTaxRepository.upsert(req.body || {}, req.user || {});
    await recordFiscalAudit({
      action: before ? "FISCAL_PRODUCT_TAX_UPDATED" : "FISCAL_PRODUCT_TAX_CREATED",
      entityId: item.id,
      user: req.user || {},
      metadata: {
        product_ref: item.product_ref,
        before: before ? { ncm: before.ncm, profile_id: before.profile_id } : null,
        after: { ncm: item.ncm, profile_id: item.profile_id }
      }
    });
    res.json({ item });
  } catch (error) {
    res.status(error.statusCode || 400).json({ error: error.message, code: error.code || "FISCAL_ERROR" });
  }
});

router.post("/resolve-item", async (req, res) => {
  try {
    const resolved = await resolveForSaleItem(req.body || {});
    res.json({ resolved });
  } catch (error) {
    res.status(400).json({ error: error.message || "Falha ao resolver tributacao do item." });
  }
});

router.get("/gaps", async (req, res) => {
  try {
    const report = await buildFiscalGapsReport(req.query || {});
    res.json(report);
  } catch (error) {
    res.status(500).json({ error: error.message || "Falha ao gerar relatorio de pendencias fiscais." });
  }
});

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

router.post("/documents/:id/transition", rejectMutationOutsideTest, async (req, res) => {
  try {
    const toStatus = String(req.body?.to_status || req.body?.status || "").trim().toUpperCase();
    if (!toStatus) {
      return res.status(400).json({ error: "Informe to_status." });
    }
    const result = await transitionDocumentStatus(req.params.id, toStatus, {
      user: req.user || {},
      detail: req.body?.detail || { source: "test_route_stage2" },
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
