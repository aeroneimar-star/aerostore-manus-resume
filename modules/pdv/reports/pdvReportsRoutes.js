"use strict";

const express = require("express");
const {
  parseFilters,
  buildSummaryReport,
  buildSalesReport,
  buildSellersReport,
  buildStoresReport,
  buildCashbackReport,
  buildPaymentsReport,
  buildInventoryReport,
  buildCustomersReport,
  buildExchangesReport,
  buildGiftCardsReport,
  buildInternalConsumptionReport,
  buildManagementAlerts,
  logReportAccess,
  toCsv
} = require("./pdvReportsService");
const {
  normalizeCockpitFilters,
  buildCockpitSummary,
  buildCockpitCurve,
  buildCockpitMargin,
  buildCockpitDecisionMap,
  buildCockpitTrends
} = require("./pdvCockpitService");

const router = express.Router();

function sendMaybeExport(res, reportType, payload, filters) {
  if (filters.format === "csv") {
    const rows = payload.items || payload.alerts || payload.sales || [];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pdv-${reportType}.csv"`);
    return res.send(toCsv(rows));
  }
  if (filters.format === "json") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="pdv-${reportType}.json"`);
  }
  return res.json(payload);
}

function buildHandler(reportType, builder, errorMessage) {
  return async (req, res) => {
    try {
      const filters = parseFilters(req.query || {});
      const payload = builder(filters, req);
      logReportAccess(reportType, filters, req.user || {}, { export: filters.format || "", format: filters.format || "" });
      return sendMaybeExport(res, reportType, payload, filters);
    } catch (error) {
      return res.status(400).json({ error: error.message || errorMessage });
    }
  };
}

function buildCockpitHandler(reportType, builder, errorMessage) {
  return async (req, res) => {
    try {
      const filters = normalizeCockpitFilters(req.query || {});
      const payload = builder(filters, req);
      logReportAccess(`cockpit_${reportType}`, {
        period: filters.period,
        start: filters.start,
        end: filters.end,
        store: filters.store_id
      }, req.user || {}, { export: "", format: "json" });
      return res.json(payload);
    } catch (error) {
      return res.status(400).json({ error: error.message || errorMessage });
    }
  };
}

router.get("/summary", buildHandler("summary", (filters) => buildSummaryReport(filters), "Falha ao carregar o dashboard gerencial do PDV."));
router.get("/sales", buildHandler("sales", (filters) => buildSalesReport(filters), "Falha ao carregar o relatorio de vendas do PDV."));
router.get("/sellers", buildHandler("sellers", (filters) => buildSellersReport(filters), "Falha ao carregar o relatorio de vendedores do PDV."));
router.get("/stores", buildHandler("stores", (filters) => buildStoresReport(filters), "Falha ao carregar o relatorio por loja do PDV."));
router.get("/cashback", buildHandler("cashback", (filters) => buildCashbackReport(filters), "Falha ao carregar o relatorio de cashback do PDV."));
router.get("/payments", buildHandler("payments", (filters) => buildPaymentsReport(filters), "Falha ao carregar o relatorio de pagamentos do PDV."));
router.get("/inventory", buildHandler("inventory", (filters) => buildInventoryReport(filters), "Falha ao carregar o relatorio de estoque do PDV."));
router.get("/customers", buildHandler("customers", (filters) => buildCustomersReport(filters), "Falha ao carregar o relatorio de clientes do PDV."));
router.get("/exchanges", buildHandler("exchanges", (filters) => buildExchangesReport(filters), "Falha ao carregar o relatorio de trocas do PDV."));
router.get("/gift-cards", buildHandler("gift-cards", (filters) => buildGiftCardsReport(filters), "Falha ao carregar o relatorio de vales presente do PDV."));
router.get("/internal-consumption", buildHandler("internal-consumption", (filters) => buildInternalConsumptionReport(filters), "Falha ao carregar o relatorio de uso e consumo do PDV."));
router.get("/alerts", buildHandler("alerts", (filters) => buildManagementAlerts(filters), "Falha ao carregar os alertas gerenciais do PDV."));

router.get("/cockpit/summary", buildCockpitHandler("summary", (filters) => buildCockpitSummary(filters), "Falha ao carregar o resumo do Cockpit."));
router.get("/cockpit/curve", buildCockpitHandler("curve", (filters) => buildCockpitCurve(filters), "Falha ao carregar a curva inteligente do Cockpit."));
router.get("/cockpit/margin", buildCockpitHandler("margin", (filters) => buildCockpitMargin(filters), "Falha ao carregar o diagnostico de margem do Cockpit."));
router.get("/cockpit/decision-map", buildCockpitHandler("decision-map", (filters) => buildCockpitDecisionMap(filters), "Falha ao carregar o mapa de decisao do Cockpit."));
router.get("/cockpit/trends", buildCockpitHandler("trends", (filters) => buildCockpitTrends(filters), "Falha ao carregar as tendencias do Cockpit."));

module.exports = {
  pdvReportsRouter: router
};
