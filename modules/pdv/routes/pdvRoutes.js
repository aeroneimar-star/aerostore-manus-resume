"use strict";

const { PDV_BASE_ROUTES } = require("../utils/pdvConfig");

const PDV_WEB_ROUTES = Array.from(new Set(PDV_BASE_ROUTES));

function isPdvWebRoute(route) {
  return PDV_WEB_ROUTES.includes(String(route || "").trim());
}

module.exports = {
  PDV_WEB_ROUTES,
  isPdvWebRoute
};
