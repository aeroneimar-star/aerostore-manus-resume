"use strict";

/**
 * Módulo fiscal AEROSTORE — Stage 3 (prontidão / cobertura / saneamento).
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
const {
  FISCAL_READINESS_STATUSES,
  FISCAL_READINESS_SEVERITIES,
  CEST_STATUSES
} = require("./domain/fiscalReadinessStatuses");
const {
  DEFAULT_READINESS_RULES,
  listDefaultReadinessRules
} = require("./domain/fiscalReadinessRules");
const { buildFiscalIdempotencyKey } = require("./domain/fiscalIdempotency");
const { buildFiscalSnapshot } = require("./domain/buildFiscalSnapshot");
const { ensureFiscalSchema, getFiscalSchemaStatus } = require("./persistence/ensureFiscalSchema");
const { FiscalEstablishmentRepository } = require("./repositories/FiscalEstablishmentRepository");
const { FiscalDocumentRepository } = require("./repositories/FiscalDocumentRepository");
const { FiscalDocumentEventRepository } = require("./repositories/FiscalDocumentEventRepository");
const { FiscalTaxProfileRepository } = require("./repositories/FiscalTaxProfileRepository");
const { FiscalProductTaxRepository, buildProductRef } = require("./repositories/FiscalProductTaxRepository");
const { FiscalReadinessRulesRepository } = require("./repositories/FiscalReadinessRulesRepository");
const { FiscalPaymentMappingRepository } = require("./repositories/FiscalPaymentMappingRepository");
const {
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  getNoopProvider
} = require("./application/FiscalRequestService");
const { resolveForSaleItem } = require("./application/FiscalTaxResolver");
const { buildFiscalGapsReport } = require("./application/FiscalGapsService");
const {
  evaluateSale,
  evaluateSaleItem,
  evaluateEstablishment,
  evaluateCustomer,
  evaluatePayments
} = require("./application/FiscalReadinessService");
const { buildFiscalCoverageReport } = require("./application/FiscalCoverageService");
const {
  previewBatchProfileApply,
  applyBatchProfile,
  importProductTaxCsv,
  exportPendingCsv
} = require("./application/FiscalSanitationService");
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
  FISCAL_READINESS_STATUSES,
  FISCAL_READINESS_SEVERITIES,
  CEST_STATUSES,
  DEFAULT_READINESS_RULES,
  listDefaultReadinessRules,
  buildFiscalIdempotencyKey,
  buildFiscalSnapshot,
  ensureFiscalSchema,
  getFiscalSchemaStatus,
  FiscalEstablishmentRepository,
  FiscalDocumentRepository,
  FiscalDocumentEventRepository,
  FiscalTaxProfileRepository,
  FiscalProductTaxRepository,
  FiscalReadinessRulesRepository,
  FiscalPaymentMappingRepository,
  buildProductRef,
  createFromCompletedSale,
  tryCreateFiscalRequestAfterCompletedSale,
  transitionDocumentStatus,
  resolveForSaleItem,
  buildFiscalGapsReport,
  evaluateSale,
  evaluateSaleItem,
  evaluateEstablishment,
  evaluateCustomer,
  evaluatePayments,
  buildFiscalCoverageReport,
  previewBatchProfileApply,
  applyBatchProfile,
  importProductTaxCsv,
  exportPendingCsv,
  getNoopProvider,
  NoopFiscalProvider,
  fiscalRouter,
  allowFiscalTestOnlyMutations
};
