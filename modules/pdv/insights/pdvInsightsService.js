"use strict";

const { appendEvent } = require("../services/pdvOperationalService");
const {
  parseFilters,
  buildSummaryReport,
  buildSellersReport,
  buildStoresReport,
  buildCashbackReport,
  buildInventoryReport,
  buildCustomersReport,
  buildExchangesReport,
  buildManagementAlerts
} = require("../reports/pdvReportsService");

function roundValue(value, digits = 2) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(digits)) : 0;
}

function getCommercialInsights(query = {}, user = {}) {
  const filters = parseFilters(query);
  const summary = buildSummaryReport(filters);
  const sellers = buildSellersReport(filters);
  const stores = buildStoresReport(filters);
  const cashback = buildCashbackReport(filters);
  const inventory = buildInventoryReport(filters);
  const customers = buildCustomersReport(filters);
  const exchanges = buildExchangesReport(filters);
  const alerts = buildManagementAlerts(filters);

  const insights = [];
  const topSeller = sellers.items[0];
  if (topSeller) {
    insights.push({
      type: "seller_performance",
      title: `Melhor vendedor do período: ${topSeller.vendedor}`,
      description: `${topSeller.vendedor} lidera com ${topSeller.total_vendido} em vendas e ticket médio de ${topSeller.ticket_medio}.`,
      severity: "info"
    });
  }

  const sellerDiscountAlert = sellers.items.find((item) => item.alerta_desconto_alto);
  if (sellerDiscountAlert) {
    insights.push({
      type: "seller_discount_pressure",
      title: `${sellerDiscountAlert.vendedor} está acima da média de desconto`,
      description: `Desconto percentual médio de ${sellerDiscountAlert.desconto_percentual_medio}%. Vale revisar negociação e mix.`,
      severity: "warning"
    });
  }

  const topStore = stores.items[0];
  if (topStore) {
    insights.push({
      type: "store_performance",
      title: `Loja líder: ${topStore.loja}`,
      description: `${topStore.loja} lidera o período com ${topStore.venda_liquida} em venda líquida.`,
      severity: "info"
    });
  }

  const idleStore = stores.items.find((item) => item.estoque_parado > 0);
  if (idleStore) {
    insights.push({
      type: "idle_stock",
      title: `Estoque parado relevante em ${idleStore.loja}`,
      description: `${idleStore.loja} tem ${idleStore.estoque_parado} produto(s) sem giro recente no operacional.`,
      severity: "warning"
    });
  }

  const vipDormant = customers.items.find((item) => item.segmento_vip && item.segmento_sumido);
  if (vipDormant) {
    insights.push({
      type: "vip_reactivation",
      title: `Cliente VIP sem retorno recente`,
      description: `${vipDormant.customer_name} está há ${vipDormant.dias_desde_ultima_compra} dias sem comprar.`,
      severity: "warning"
    });
  }

  const cashbackDormant = cashback.items.find((item) => item.saldo_disponivel > 0);
  if (cashbackDormant) {
    insights.push({
      type: "cashback_opportunity",
      title: "Há cashback disponível esperando reativação",
      description: `${cashbackDormant.customer_name} tem saldo disponível de ${cashbackDormant.saldo_disponivel}.`,
      severity: "info"
    });
  }

  const exchangeIssue = exchanges.metrics.total_trocas > 0 ? exchanges.metrics : null;
  if (exchangeIssue && exchangeIssue.total_trocas >= 3) {
    insights.push({
      type: "exchange_pattern",
      title: "Trocas relevantes no período",
      description: `${exchangeIssue.total_trocas} troca(s) registradas. Motivo dominante: ${exchangeIssue.motivo_mais_comum || "não identificado"}.`,
      severity: "warning"
    });
  }

  const inventoryAlert = inventory.alerts.find((item) => item.type === "negative_stock" || item.type === "movement_divergence");
  if (inventoryAlert) {
    insights.push({
      type: "inventory_risk",
      title: "Risco operacional no estoque",
      description: `${inventoryAlert.nome || inventoryAlert.product_name || inventoryAlert.product_id || "Produto"} em ${inventoryAlert.store_id || inventoryAlert.loja || "loja"} precisa de conferência.`,
      severity: "error"
    });
  }

  if (summary.metrics.permuta_total > 0) {
    insights.push({
      type: "permuta_pressure",
      title: "Permutas apareceram no período",
      description: `O volume de permuta chegou a ${summary.metrics.permuta_total}. Isso merece leitura comercial por vendedor e loja.`,
      severity: "info"
    });
  }

  const usageRatio = summary.metrics.venda_liquida > 0 ? summary.metrics.uso_consumo / summary.metrics.venda_liquida : 0;
  if (usageRatio > 0.08) {
    insights.push({
      type: "internal_consumption_ratio",
      title: "Uso e consumo acima do normal",
      description: `Uso e consumo representa ${roundValue(usageRatio * 100, 2)}% da venda líquida no período filtrado.`,
      severity: "warning"
    });
  }

  appendEvent("INSIGHT_GENERATED", { origem: "pdv_reports", loja: filters.store || "" }, {
    total_insights: insights.length,
    total_alerts: alerts.items.length,
    period: filters.period
  }, user);

  return {
    filters,
    items: insights.slice(0, 20),
    alerts: alerts.items.slice(0, 20)
  };
}

module.exports = {
  getCommercialInsights
};
