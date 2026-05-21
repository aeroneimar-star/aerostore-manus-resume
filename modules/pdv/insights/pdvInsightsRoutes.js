"use strict";

const express = require("express");
const { parseFilters, logReportAccess, toCsv } = require("../reports/pdvReportsService");
const { getCommercialInsights } = require("./pdvInsightsService");

const router = express.Router();

router.get("/commercial", async (req, res) => {
  try {
    const filters = parseFilters(req.query || {});
    const payload = getCommercialInsights(req.query || {}, req.user || {});
    logReportAccess("commercial-insights", filters, req.user || {}, { export: filters.format || "", format: filters.format || "" });

    if (filters.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"pdv-commercial-insights.csv\"");
      return res.send(toCsv(payload.items || []));
    }
    if (filters.format === "json") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=\"pdv-commercial-insights.json\"");
    }
    return res.json(payload);
  } catch (error) {
    return res.status(400).json({ error: error.message || "Falha ao gerar os insights comerciais do PDV." });
  }
});

module.exports = {
  pdvInsightsRouter: router
};
