"use strict";

const { normalizeStoreKey } = require("../../pdv/utils/pdvStoreUtils");
const {
  isFiscalModuleEnabled,
  getFiscalDefaultEnvironment,
  getFiscalDefaultModel
} = require("../utils/fiscalConfig");
const {
  FISCAL_STATUSES,
  assertFiscalStatusTransition
} = require("../domain/fiscalStatuses");
const { buildFiscalIdempotencyKey } = require("../domain/fiscalIdempotency");
const { buildFiscalSnapshot } = require("../domain/buildFiscalSnapshot");
const { FiscalEstablishmentRepository } = require("../repositories/FiscalEstablishmentRepository");
const { FiscalDocumentRepository } = require("../repositories/FiscalDocumentRepository");
const { FiscalDocumentEventRepository } = require("../repositories/FiscalDocumentEventRepository");
const { NoopFiscalProvider } = require("../providers/NoopFiscalProvider");
const { recordFiscalAudit } = require("./fiscalAudit");

const establishmentRepository = new FiscalEstablishmentRepository();
const documentRepository = new FiscalDocumentRepository();
const eventRepository = new FiscalDocumentEventRepository();
const noopProvider = new NoopFiscalProvider();

function normalizeActor(user = {}) {
  return String(user?.name || user?.email || user?.username || "sistema").trim() || "sistema";
}

function isSaleCompleted(sale = {}) {
  const status = String(sale.status || "").trim().toUpperCase();
  return status === "COMPLETED" || status === "EXCHANGE";
}

function createHttpError(message, statusCode = 400, code = "FISCAL_ERROR", extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function getSaleLoader() {
  // Lazy require evita ciclo com pdvSalesService no hook pós-venda.
  const { getSaleById } = require("../../pdv/sales/pdvSalesService");
  return getSaleById;
}

async function resolveEstablishmentForSale(sale, { environment = "" } = {}) {
  const storeId = normalizeStoreKey(
    sale.loja || sale.loja_venda || sale.store_id || sale.store_context?.store_id || ""
  );
  const env = environment || getFiscalDefaultEnvironment();
  const establishment = await establishmentRepository.findActiveByStoreId(storeId, {
    environment: env
  });
  const linkedStoreIds = establishment
    ? await establishmentRepository.listStoreIds(establishment.id, { activeOnly: true })
    : [];
  return { storeId, environment: env, establishment, linkedStoreIds };
}

/**
 * Cria solicitação fiscal PENDING a partir de venda concluída.
 * Nunca chama provedor/SEFAZ.
 */
async function createFromCompletedSale(saleId, options = {}) {
  const user = options.user || {};
  const actor = normalizeActor(user);
  const model = String(options.model || getFiscalDefaultModel());
  const purpose = String(options.purpose || "sale_emit");
  const skipFeatureFlag = Boolean(options.skipFeatureFlag);

  if (!skipFeatureFlag && !isFiscalModuleEnabled()) {
    await recordFiscalAudit({
      action: "FISCAL_REQUEST_SKIPPED_FLAG_OFF",
      saleId,
      user,
      result: "skipped",
      message: "Modulo fiscal desligado (FISCAL_MODULE_ENABLED=false)."
    });
    return {
      created: false,
      skipped: true,
      reason: "feature_flag_disabled",
      document: null
    };
  }

  const getSaleById = options.getSaleById || getSaleLoader();
  const sale = typeof options.sale === "object" && options.sale
    ? options.sale
    : getSaleById(saleId);

  if (!sale || !sale.sale_id) {
    await recordFiscalAudit({
      action: "FISCAL_REQUEST_SALE_NOT_FOUND",
      saleId,
      user,
      result: "error",
      message: "Venda nao encontrada para solicitacao fiscal."
    });
    throw createHttpError("Venda nao encontrada para solicitacao fiscal.", 404, "FISCAL_SALE_NOT_FOUND");
  }

  if (!isSaleCompleted(sale)) {
    await recordFiscalAudit({
      action: "FISCAL_REQUEST_SALE_NOT_COMPLETED",
      saleId: sale.sale_id,
      storeId: sale.loja || "",
      user,
      result: "error",
      message: `Venda com status '${sale.status}' nao pode gerar solicitacao fiscal.`
    });
    throw createHttpError(
      "Somente vendas concluidas podem gerar solicitacao fiscal.",
      400,
      "FISCAL_SALE_NOT_COMPLETED",
      { sale_status: sale.status }
    );
  }

  const idempotencyKey = buildFiscalIdempotencyKey({
    saleId: sale.sale_id,
    model,
    purpose
  });

  const existing = await documentRepository.findByIdempotencyKey(idempotencyKey)
    || await documentRepository.findBySaleModelPurpose(sale.sale_id, model, purpose);

  if (existing) {
    await recordFiscalAudit({
      action: "FISCAL_REQUEST_DUPLICATE",
      saleId: sale.sale_id,
      entityId: existing.id,
      storeId: sale.loja || "",
      user,
      result: "idempotent",
      message: "Solicitacao fiscal ja existia; snapshot preservado.",
      metadata: {
        idempotency_key: idempotencyKey,
        status: existing.status
      }
    });
    return {
      created: false,
      skipped: false,
      duplicated: true,
      reason: "already_exists",
      document: existing
    };
  }

  const { storeId, environment, establishment, linkedStoreIds } = await resolveEstablishmentForSale(sale, {
    environment: options.environment || ""
  });

  if (!establishment) {
    await recordFiscalAudit({
      action: "FISCAL_REQUEST_ESTABLISHMENT_MISSING",
      saleId: sale.sale_id,
      storeId,
      user,
      result: "error",
      message: `Nenhum estabelecimento fiscal ativo para a loja '${storeId}' (${environment}).`
    });
    throw createHttpError(
      `Estabelecimento fiscal ausente para a loja '${storeId}'.`,
      409,
      "FISCAL_ESTABLISHMENT_MISSING",
      { store_id: storeId, environment }
    );
  }

  let snapshot;
  try {
    snapshot = await buildFiscalSnapshot({
      sale,
      establishment,
      linkedStoreIds,
      model,
      purpose
    });
  } catch (error) {
    await recordFiscalAudit({
      action: "FISCAL_SNAPSHOT_FAILED",
      saleId: sale.sale_id,
      storeId,
      user,
      result: "error",
      message: String(error.message || "Falha ao montar snapshot fiscal.").slice(0, 300)
    });
    throw createHttpError(
      `Falha ao montar snapshot fiscal: ${error.message}`,
      500,
      "FISCAL_SNAPSHOT_FAILED"
    );
  }

  // Stage 1: nunca transmitir
  if (options.attemptProviderEmit) {
    noopProvider.emit(snapshot);
  }

  let document;
  try {
    document = await documentRepository.create({
      saleId: sale.sale_id,
      establishmentId: establishment.id,
      model,
      purpose,
      status: FISCAL_STATUSES.PENDING,
      idempotencyKey,
      snapshot
    });
  } catch (error) {
    if (error.code === "FISCAL_DOCUMENT_DUPLICATE" && error.existing) {
      await recordFiscalAudit({
        action: "FISCAL_REQUEST_DUPLICATE",
        saleId: sale.sale_id,
        entityId: error.existing.id,
        storeId,
        user,
        result: "idempotent",
        message: "Corrida de criacao; documento existente preservado.",
        metadata: { idempotency_key: idempotencyKey }
      });
      return {
        created: false,
        skipped: false,
        duplicated: true,
        reason: "race_already_exists",
        document: error.existing
      };
    }
    throw error;
  }

  assertFiscalStatusTransition(FISCAL_STATUSES.NOT_REQUESTED, FISCAL_STATUSES.PENDING);
  const event = await eventRepository.create({
    fiscalDocumentId: document.id,
    fromStatus: FISCAL_STATUSES.NOT_REQUESTED,
    toStatus: FISCAL_STATUSES.PENDING,
    actor,
    detail: {
      idempotency_key: idempotencyKey,
      establishment_id: establishment.id,
      store_id: storeId,
      transmission: "disabled_stage1"
    }
  });

  await recordFiscalAudit({
    action: "FISCAL_REQUEST_CREATED",
    saleId: sale.sale_id,
    entityId: document.id,
    storeId,
    user,
    result: "success",
    message: "Solicitacao fiscal criada em PENDING (sem transmissao).",
    metadata: {
      idempotency_key: idempotencyKey,
      model,
      purpose,
      event_id: event.id,
      fiscal_gaps_count: Array.isArray(snapshot.fiscal_gaps) ? snapshot.fiscal_gaps.length : 0
    }
  });

  return {
    created: true,
    skipped: false,
    duplicated: false,
    reason: "created",
    document,
    event
  };
}

/**
 * Hook pós-venda: nunca lança erro para o PDV.
 */
async function tryCreateFiscalRequestAfterCompletedSale(sale, user = {}) {
  try {
    if (!isFiscalModuleEnabled()) {
      return {
        created: false,
        skipped: true,
        reason: "feature_flag_disabled",
        document: null
      };
    }
    if (!sale || !sale.sale_id) {
      return {
        created: false,
        skipped: true,
        reason: "sale_missing",
        document: null
      };
    }
    return await createFromCompletedSale(sale.sale_id, {
      sale,
      user,
      skipFeatureFlag: true
    });
  } catch (error) {
    try {
      await recordFiscalAudit({
        action: "FISCAL_REQUEST_POST_SALE_FAILED",
        saleId: sale?.sale_id || "",
        storeId: sale?.loja || "",
        user,
        result: "error",
        message: String(error.message || "Falha isolada na solicitacao fiscal.").slice(0, 300),
        metadata: {
          code: error.code || "FISCAL_POST_SALE_ERROR"
        }
      });
    } catch (_auditError) {
      // ignore
    }
    return {
      created: false,
      skipped: false,
      failed: true,
      reason: error.code || "fiscal_post_sale_error",
      error_message: String(error.message || "").slice(0, 300),
      document: null
    };
  }
}

/** Estados que o Stage 1 não pode forjar sem provider/fluxo futuro. */
const STAGE1_BLOCKED_TARGET_STATUSES = new Set([
  FISCAL_STATUSES.QUEUED,
  FISCAL_STATUSES.PROCESSING,
  FISCAL_STATUSES.AUTHORIZED,
  FISCAL_STATUSES.REJECTED,
  FISCAL_STATUSES.ERROR_RETRYABLE,
  FISCAL_STATUSES.ERROR_FINAL,
  FISCAL_STATUSES.CANCELLATION_PENDING,
  FISCAL_STATUSES.CANCELLED
]);

async function transitionDocumentStatus(documentId, toStatus, options = {}) {
  const document = await documentRepository.findById(documentId);
  if (!document) {
    throw createHttpError("Documento fiscal nao encontrado.", 404, "FISCAL_DOCUMENT_NOT_FOUND");
  }
  const normalizedTarget = String(toStatus || "").trim().toUpperCase();
  if (!options.allowAdvancedTransitions && STAGE1_BLOCKED_TARGET_STATUSES.has(normalizedTarget)) {
    throw createHttpError(
      "Transicoes alem de PENDING estao bloqueadas no Stage 1 (sem provedor/fluxo fiscal).",
      403,
      "FISCAL_STAGE1_TRANSITION_BLOCKED",
      { to_status: normalizedTarget }
    );
  }
  const transition = assertFiscalStatusTransition(document.status, toStatus);
  const updated = await documentRepository.updateStatus(document.id, transition.to_status, options.extra || {});
  const event = await eventRepository.create({
    fiscalDocumentId: document.id,
    fromStatus: transition.from_status,
    toStatus: transition.to_status,
    actor: normalizeActor(options.user || {}),
    detail: options.detail || null
  });
  await recordFiscalAudit({
    action: "FISCAL_STATUS_CHANGED",
    saleId: document.sale_id,
    entityId: document.id,
    user: options.user || {},
    result: "success",
    message: `Status fiscal ${transition.from_status} -> ${transition.to_status}`,
    metadata: {
      from_status: transition.from_status,
      to_status: transition.to_status,
      event_id: event.id
    }
  });
  return { document: updated, event };
}

function getNoopProvider() {
  return noopProvider;
}

module.exports = {
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  resolveEstablishmentForSale,
  isSaleCompleted,
  getNoopProvider,
  establishmentRepository,
  documentRepository,
  eventRepository
};
