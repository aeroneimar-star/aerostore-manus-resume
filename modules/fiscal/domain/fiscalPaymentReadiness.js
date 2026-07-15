"use strict";

/**
 * Catálogo de prontidão de pagamentos — Stage 3.
 * NÃO inventa nfce_tpag. Valores permanecem null até confirmação contábil.
 */

const PAYMENT_MAPPING_STATUSES = Object.freeze({
  PENDING_ACCOUNTING: "pending_accounting",
  CONFIRMED: "confirmed",
  AMBIGUOUS: "ambiguous",
  BLOCKED_FOR_EMIT: "blocked_for_emit"
});

const DEFAULT_PAYMENT_MAPPINGS = Object.freeze([
  { method: "dinheiro", label: "Dinheiro", mapping_status: "pending_accounting", notes: "Aguardando confirmacao de tPag com contabilidae" },
  { method: "pix", label: "Pix", mapping_status: "pending_accounting", notes: "Aguardando confirmacao de tPag com contabilidae" },
  { method: "debito", label: "Debito", mapping_status: "pending_accounting", notes: "Aguardando confirmacao de tPag/bandeira/credenciadora" },
  { method: "credito", label: "Credito", mapping_status: "pending_accounting", notes: "Alias operacional; aguardando mapeamento" },
  { method: "credito_ate_10x", label: "Credito ate 10x", mapping_status: "pending_accounting", notes: "Aguardando confirmacao de tPag" },
  { method: "cheque", label: "Cheque", mapping_status: "pending_accounting", notes: "Aguardando confirmacao de tPag" },
  { method: "cashback", label: "Cashback", mapping_status: "ambiguous", notes: "Natureza ambigua — nao mapear automaticamente para tPag" },
  { method: "credito_troca", label: "Credito de troca", mapping_status: "ambiguous", notes: "Natureza ambigua — nao mapear automaticamente" },
  { method: "vale_presente", label: "Vale-presente", mapping_status: "ambiguous", notes: "Natureza ambigua — nao mapear automaticamente" },
  { method: "permuta", label: "Permuta", mapping_status: "ambiguous", notes: "Natureza ambigua — nao mapear automaticamente" },
  { method: "desconto_folha", label: "Desconto em folha", mapping_status: "ambiguous", notes: "Natureza ambigua — nao mapear automaticamente" },
  { method: "link_pagamento", label: "Link de pagamento", mapping_status: "pending_accounting", notes: "Depende do meio efetivamente liquidado" }
]);

function normalizePaymentMethod(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["debit", "cartao_debito"].includes(raw)) return "debito";
  if (["credit", "cartao_credito"].includes(raw)) return "credito";
  return raw;
}

function listDefaultPaymentMappings() {
  return DEFAULT_PAYMENT_MAPPINGS.map((item) => ({
    ...item,
    nfce_tpag: null,
    acquirer_cnpj: null,
    brand: null,
    integration: null
  }));
}

module.exports = {
  PAYMENT_MAPPING_STATUSES,
  DEFAULT_PAYMENT_MAPPINGS,
  normalizePaymentMethod,
  listDefaultPaymentMappings
};
