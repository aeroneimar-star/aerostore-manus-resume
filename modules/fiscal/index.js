"use strict";

/**
 * Módulo fiscal AEROSTORE — Stage 2 (estabelecimentos, perfis, produto fiscal).
 * Sem provedor externo, sem certificado, sem SEFAZ, sem emissão.
 */

const { isFiscalModuleEnabled, getFiscalDefaultEnvironment, getFiscalDefaultModel } = require("./utils/fiscalConfig");
const {
  FISCAL_STATUSES,
  FISCAL_STATUS_TRANSITIONS,
  canTransitionFiscalStatus,
  assertFiscalStatusTransition
} = require("./domain/fiscalStatuses");
const {
  FISCAL_OPERATION_TYPES,
  FISCAL_OPERATION_TYPES_ACTIVE,
  normalizeFiscalOperationType
} = require("./domain/fiscalOperations");
const { buildFiscalIdempotencyKey } = require("./domain/fiscalIdempotency");
const { buildFiscalSnapshot } = require("./domain/buildFiscalSnapshot");
const { ensureFiscalSchema, getFiscalSchemaStatus } = require("./persistence/ensureFiscalSchema");
const { FiscalEstablishmentRepository } = require("./repositories/FiscalEstablishmentRepository");
const { FiscalDocumentRepository } = require("./repositories/FiscalDocumentRepository");
const { FiscalDocumentEventRepository } = require("./repositories/FiscalDocumentEventRepository");
const { FiscalTaxProfileRepository } = require("./repositories/FiscalTaxProfileRepository");
const { FiscalProductTaxRepository, buildProductRef } = require("./repositories/FiscalProductTaxRepository");
const {
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  getNoopProvider
} = require("./application/FiscalRequestService");
const { resolveForSaleItem } = require("./application/FiscalTaxResolver");
const { buildFiscalGapsReport } = require("./application/FiscalGapsService");
const { fiscalRouter, allowFiscalTestOnlyMutations } = require("./routes/fiscalRoutes");
const { NoopFiscalProvider } = require("./providers/NoopFiscalProvider");

module.exports = {
  isFiscalModuleEnabled,
  getFiscalDefaultEnvironment,
  getFiscalDefaultModel,
  FISCAL_STATUSES,
  FISCAL_STATUS_TRANSITIONS,
  canTransitionFiscalStatus,
  assertFiscalStatusTransition,
  FISCAL_OPERATION_TYPES,
  FISCAL_OPERATION_TYPES_ACTIVE,
  normalizeFiscalOperationType,
  buildFiscalIdempotencyKey,
  buildFiscalSnapshot,
  ensureFiscalSchema,
  getFiscalSchemaStatus,
  FiscalEstablishmentRepository,
  FiscalDocumentRepository,
  FiscalDocumentEventRepository,
  FiscalTaxProfileRepository,
  FiscalProductTaxRepository,
  buildProductRef,
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  resolveForSaleItem,
  buildFiscalGapsReport,
  getNoopProvider,
  NoopFiscalProvider,
  fiscalRouter,
  allowFiscalTestOnlyMutations
};
