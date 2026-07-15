"use strict";

/**
 * Matriz de regras de prontidão fiscal (Stage 3).
 * Severidade default — pode ser sobrescrita em fiscal_readiness_rules.
 * Não inventa regra tributária; só classifica gaps cadastrais conhecidos.
 */

const { FISCAL_READINESS_SEVERITIES } = require("./fiscalReadinessStatuses");

const DEFAULT_READINESS_RULES = Object.freeze([
  { code: "NCM_MISSING", severity: "blocking", entity_scope: "product", description: "NCM ausente" },
  { code: "NCM_INVALID", severity: "blocking", entity_scope: "product", description: "NCM invalido" },
  { code: "ORIGIN_MISSING", severity: "blocking", entity_scope: "product", description: "Origem fiscal ausente" },
  { code: "ORIGIN_INVALID", severity: "warning", entity_scope: "product", description: "Origem fiscal invalida" },
  { code: "UNIT_MISSING", severity: "blocking", entity_scope: "product", description: "Unidade comercial ausente" },
  { code: "PROFILE_MISSING", severity: "blocking", entity_scope: "product", description: "Perfil tributario ausente" },
  { code: "PROFILE_INACTIVE", severity: "blocking", entity_scope: "profile", description: "Perfil tributario inativo" },
  { code: "PROFILE_OPERATION_MISMATCH", severity: "blocking", entity_scope: "profile", description: "Perfil incompativel com operacao" },
  { code: "CFOP_MISSING", severity: "blocking", entity_scope: "profile", description: "CFOP ausente" },
  { code: "CFOP_INVALID", severity: "blocking", entity_scope: "profile", description: "CFOP invalido" },
  { code: "CSOSN_OR_CST_MISSING", severity: "blocking", entity_scope: "profile", description: "CSOSN ou CST ICMS ausente" },
  { code: "CSOSN_AND_CST_BOTH_SET", severity: "warning", entity_scope: "profile", description: "CSOSN e CST ICMS ambos preenchidos" },
  { code: "PIS_CST_MISSING", severity: "blocking", entity_scope: "profile", description: "CST PIS ausente" },
  { code: "COFINS_CST_MISSING", severity: "blocking", entity_scope: "profile", description: "CST COFINS ausente" },
  { code: "TEST_PROFILE_IN_PRODUCTION", severity: "blocking", entity_scope: "profile", description: "Perfil de teste em producao" },
  { code: "TEST_PROFILE_IN_NON_PRODUCTION", severity: "informational", entity_scope: "profile", description: "Perfil de teste em homologacao" },
  { code: "PROFILE_ORIGIN_UF_MISMATCH", severity: "warning", entity_scope: "profile", description: "UF origem do perfil diverge" },
  { code: "PROFILE_DESTINATION_UF_MISMATCH", severity: "warning", entity_scope: "profile", description: "UF destino do perfil diverge" },
  { code: "GTIN_MISSING", severity: "warning", entity_scope: "product", description: "GTIN ausente" },
  { code: "GTIN_INVALID", severity: "warning", entity_scope: "product", description: "GTIN invalido" },
  { code: "CEST_REQUIRED_UNKNOWN", severity: "warning", entity_scope: "product", description: "Obrigatoriedade de CEST desconhecida" },
  { code: "CEST_REQUIRED_MISSING", severity: "blocking", entity_scope: "product", description: "CEST obrigatorio ausente" },
  { code: "CEST_NOT_APPLICABLE", severity: "informational", entity_scope: "product", description: "CEST marcado como nao aplicavel" },
  { code: "VARIANT_OVERRIDE_INCOMPLETE", severity: "warning", entity_scope: "product", description: "Override de variacao incompleto" },
  { code: "ESTABLISHMENT_MISSING", severity: "blocking", entity_scope: "establishment", description: "Estabelecimento ausente" },
  { code: "ESTABLISHMENT_INACTIVE", severity: "blocking", entity_scope: "establishment", description: "Estabelecimento inativo" },
  { code: "EMITTER_CNPJ_MISSING", severity: "blocking", entity_scope: "establishment", description: "CNPJ do emitente invalido/ausente" },
  { code: "EMITTER_LEGAL_NAME_MISSING", severity: "blocking", entity_scope: "establishment", description: "Razao social ausente" },
  { code: "EMITTER_UF_MISSING", severity: "blocking", entity_scope: "establishment", description: "UF do emitente ausente" },
  { code: "EMITTER_IE_MISSING", severity: "warning", entity_scope: "establishment", description: "IE ausente (pode ser exigida)" },
  { code: "EMITTER_CRT_MISSING", severity: "warning", entity_scope: "establishment", description: "CRT/regime ausente" },
  { code: "EMITTER_CITY_MISSING", severity: "warning", entity_scope: "establishment", description: "Municipio ausente" },
  { code: "EMITTER_IBGE_MISSING", severity: "warning", entity_scope: "establishment", description: "Codigo IBGE ausente" },
  { code: "EMITTER_ADDRESS_MISSING", severity: "warning", entity_scope: "establishment", description: "Endereco incompleto" },
  { code: "STORE_WITHOUT_ACTIVE_ESTABLISHMENT", severity: "blocking", entity_scope: "store", description: "Loja sem estabelecimento ativo" },
  { code: "DUAL_ACTIVE_STORE_LINK", severity: "blocking", entity_scope: "store", description: "Mais de um vinculo ativo" },
  { code: "CERTIFICATE_MARKER_UNSET", severity: "informational", entity_scope: "emission_future", description: "Marcador certificado nao setado (nao bloqueia Stage 3)" },
  { code: "CSC_MARKER_UNSET", severity: "informational", entity_scope: "emission_future", description: "Marcador CSC nao setado (nao bloqueia Stage 3)" },
  { code: "PROVIDER_MARKER_UNSET", severity: "informational", entity_scope: "emission_future", description: "Marcador provedor nao setado (nao bloqueia Stage 3)" },
  { code: "CUSTOMER_DOCUMENT_INVALID", severity: "blocking", entity_scope: "customer", description: "Documento do cliente invalido" },
  { code: "CUSTOMER_NAME_MISSING_IDENTIFIED", severity: "warning", entity_scope: "customer", description: "Nome ausente em NFC-e identificada" },
  { code: "PAYMENT_MAPPING_PENDING", severity: "blocking", entity_scope: "payment", description: "Pagamento sem mapeamento confirmado pela contabilidae" },
  { code: "PAYMENT_MAPPING_AMBIGUOUS", severity: "blocking", entity_scope: "payment", description: "Natureza de pagamento ambigua" },
  { code: "PAYMENT_MAPPING_BLOCKED", severity: "blocking", entity_scope: "payment", description: "Pagamento bloqueado para emissao futura" },
  { code: "SALE_TOTALS_MISMATCH", severity: "blocking", entity_scope: "sale", description: "Totais da venda inconsistentes com pagamentos" },
  { code: "ITEM_UNRESOLVED", severity: "warning", entity_scope: "product", description: "Item sem referencia estavel" }
]);

function defaultSeverityForCode(code = "") {
  const found = DEFAULT_READINESS_RULES.find((rule) => rule.code === String(code || "").toUpperCase());
  return found?.severity || FISCAL_READINESS_SEVERITIES.WARNING;
}

function listDefaultReadinessRules() {
  return DEFAULT_READINESS_RULES.map((rule) => ({ ...rule }));
}

module.exports = {
  DEFAULT_READINESS_RULES,
  defaultSeverityForCode,
  listDefaultReadinessRules
};
