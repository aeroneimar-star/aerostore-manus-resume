"use strict";

/**
 * Módulo fiscal AEROSTORE — Stage 1 (fundação isolada).
 * Sem provedor externo, sem certificado, sem SEFAZ, sem emissão.
 */

const { isFiscalModuleEnabled, getFiscalDefaultEnvironment, getFiscalDefaultModel } = require("./utils/fiscalConfig");
const {
  FISCAL_STATUSES,
  FISCAL_STATUS_TRANSITIONS,
  canTransitionFiscalStatus,
  assertFiscalStatusTransition
} = require("./domain/fiscalStatuses");
const { buildFiscalIdempotencyKey } = require("./domain/fiscalIdempotency");
const { buildFiscalSnapshot } = require("./domain/buildFiscalSnapshot");
const { ensureFiscalSchema, getFiscalSchemaStatus } = require("./persistence/ensureFiscalSchema");
const { FiscalEstablishmentRepository } = require("./repositories/FiscalEstablishmentRepository");
const { FiscalDocumentRepository } = require("./repositories/FiscalDocumentRepository");
const { FiscalDocumentEventRepository } = require("./repositories/FiscalDocumentEventRepository");
const {
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  getNoopProvider
} = require("./application/FiscalRequestService");
const { fiscalRouter } = require("./routes/fiscalRoutes");
const { allowFiscalTestOnlyMutations } = require("./routes/fiscalRoutes");
const { NoopFiscalProvider } = require("./providers/NoopFiscalProvider");

module.exports = {
  isFiscalModuleEnabled,
  getFiscalDefaultEnvironment,
  getFiscalDefaultModel,
  FISCAL_STATUSES,
  FISCAL_STATUS_TRANSITIONS,
  canTransitionFiscalStatus,
  assertFiscalStatusTransition,
  buildFiscalIdempotencyKey,
  buildFiscalSnapshot,
  ensureFiscalSchema,
  getFiscalSchemaStatus,
  FiscalEstablishmentRepository,
  FiscalDocumentRepository,
  FiscalDocumentEventRepository,
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  getNoopProvider,
  NoopFiscalProvider,
  fiscalRouter,
  allowFiscalTestOnlyMutations
};
