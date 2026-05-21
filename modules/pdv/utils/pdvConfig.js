"use strict";

const PDV_BASE_ROUTES = [
  "/pdv",
  "/pdv/dashboard",
  "/pdv/venda",
  "/pdv/orcamentos",
  "/pdv/reservas",
  "/pdv/caixa",
  "/pdv/trocas",
  "/pdv/clientes",
  "/pdv/produtos",
  "/pdv/estoque",
  "/pdv/relatorios",
  "/pdv/relatorios/cockpit",
  "/pdv/testes",
  "/pdv/consumo",
  "/pdv/eventos",
  "/pdv/importacoes",
  "/pdv/consolidacao",
  "/pdv/importacoes/produtos",
  "/pdv/importacoes/clientes",
  "/pdv/importacoes/vendas",
  "/pdv/importacoes/curva-abc",
  "/pdv/importacoes/cashback"
];

const PDV_ROUTE_META = [
  {
    key: "dashboard",
    path: "/pdv/dashboard",
    label: "Dashboard",
    description: "Visao operacional do PDV, caixa, alertas, equipe e indicadores da loja."
  },
  {
    key: "venda",
    path: "/pdv/venda",
    label: "Venda",
    description: "Busca operacional, cliente identificado, carrinho e preparacao de pagamento."
  },
  {
    key: "orcamentos",
    path: "/pdv/orcamentos",
    label: "Orcamentos",
    description: "Orcamentos reabertos, atendimento em andamento e transformacao futura em reserva ou venda."
  },
  {
    key: "reservas",
    path: "/pdv/reservas",
    label: "Reservas",
    description: "Reserva de produtos com validade, vendedor, cliente e controle operacional."
  },
  {
    key: "caixa",
    path: "/pdv/caixa",
    label: "Caixa",
    description: "Abertura, fechamento, sangrias, recebimentos e historico do caixa fisico."
  },
  {
    key: "trocas",
    path: "/pdv/trocas",
    label: "Trocas",
    description: "Controle de creditos, vales, historico de trocas e regras operacionais."
  },
  {
    key: "clientes",
    path: "/pdv/clientes",
    label: "Clientes",
    description: "Central de clientes para busca rápida, cadastro comercial, cashback e leitura consultiva no PDV."
  },
  {
    key: "produtos",
    path: "/pdv/produtos",
    label: "Produtos",
    description: "Central de produtos para cadastro, importação Tiny, revisão de pendências e preparo do catálogo do PDV."
  },
  {
    key: "estoque",
    path: "/pdv/estoque",
    label: "Estoque",
    description: "Estoque operacional por loja, alertas, ajustes, transferencias e movimentacoes auditaveis."
  },
  {
    key: "relatorios",
    path: "/pdv/relatorios",
    label: "Relatorios",
    description: "Painel executivo com vendas, vendedores, lojas, cashback, estoque, clientes e alertas gerenciais."
  },
  {
    key: "relatorios_cockpit",
    path: "/pdv/relatorios/cockpit",
    label: "AEROSTORE Cockpit",
    description: "Inteligencia de vendas para moda com curva, margem, tendencia e mapa de decisao em um shell premium."
  },
  {
    key: "testes",
    path: "/pdv/testes",
    label: "Testes",
    description: "Massa de teste operacional isolada para popular o PDV sem tocar nos dados reais."
  },
  {
    key: "consumo",
    path: "/pdv/consumo",
    label: "Consumo",
    description: "Saidas para uso pessoal, marketing, presente, influenciador, ensaio ou uniforme."
  },
  {
    key: "eventos",
    path: "/pdv/eventos",
    label: "Eventos",
    description: "Motor operacional de eventos, comportamento da loja, logs e timeline futura."
  },
  {
    key: "importacoes",
    path: "/pdv/importacoes",
    label: "Importacoes",
    description: "Previa, validacao, confirmacao, logs e rollback das cargas operacionais."
  },
  {
    key: "consolidacao",
    path: "/pdv/consolidacao",
    label: "Consolidacao",
    description: "Base estrategica consolidada do PDV com cliente mestre, timeline, cashback e qualidade dos dados."
  }
];

const PDV_PAYMENT_METHODS = [
  "dinheiro",
  "pix",
  "debito",
  "credito_ate_10x",
  "cashback",
  "credito_troca",
  "vale_presente",
  "permuta",
  "link_pagamento"
];

const PDV_IMPORT_PIPELINE = ["preview", "validacao", "confirmacao", "logs", "rollback"];

const PDV_SECURITY_FOUNDATION = [
  "login_individual",
  "modo_gerente",
  "permissoes_futuras",
  "historico_operacional",
  "status_em_vez_de_delete"
];

const PDV_BUSINESS_GUARDRAILS = [
  "nao_implementar_fiscal_agora",
  "nao_implementar_nfce_sat_tef_agora",
  "nao_transformar_em_erp_completo",
  "cashback_nao_e_desconto",
  "cashback_nao_entra_como_dinheiro_novo_no_caixa",
  "pdv_isolado_do_chatbot_e_whatsapp_atual"
];

function normalizePdvRoutePath(route) {
  const raw = String(route || "").trim();
  if (!raw || raw === "/pdv") {
    return "/pdv/dashboard";
  }
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  if (normalized.startsWith("/pdv/importacoes/")) {
    return normalized;
  }
  return PDV_BASE_ROUTES.includes(normalized) ? normalized : "/pdv/dashboard";
}

function getPdvRouteMeta(route) {
  const normalized = normalizePdvRoutePath(route);
  return PDV_ROUTE_META.find((item) => item.path === normalized) || PDV_ROUTE_META[0];
}

module.exports = {
  PDV_BASE_ROUTES,
  PDV_ROUTE_META,
  PDV_PAYMENT_METHODS,
  PDV_IMPORT_PIPELINE,
  PDV_SECURITY_FOUNDATION,
  PDV_BUSINESS_GUARDRAILS,
  normalizePdvRoutePath,
  getPdvRouteMeta
};
