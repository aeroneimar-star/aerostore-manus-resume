"use strict";

const { registerB2cCatalogRoutes } = require("./catalog/b2cCatalogRoutes");

function registerB2cModule(app, options = {}) {
  registerB2cCatalogRoutes(app, options.catalog || {});
}

module.exports = {
  registerB2cModule,
  registerB2cCatalogRoutes
};
