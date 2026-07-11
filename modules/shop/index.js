"use strict";

const { registerShopPublicRoutes } = require("./routes/shopPublicRoutes");
const { registerShopPublicApiRoutes } = require("./routes/shopPublicApiRoutes");
const { registerShopPublicCatalogDisabledRoutes } = require("./routes/shopPublicCatalogDisabledRoutes");
const { registerShopAdminRoutes } = require("./routes/shopAdminRoutes");
const { isShopPublicCatalogEnabled } = require("./services/shopSettingsService");

function registerShopModule(app) {
  if (isShopPublicCatalogEnabled()) {
    registerShopPublicApiRoutes(app);
    registerShopPublicRoutes(app);
  } else {
    registerShopPublicCatalogDisabledRoutes(app);
  }
  // Rotas /api/shop/* registradas em server.js após authMiddleware.
}

module.exports = {
  registerShopModule,
  registerShopPublicRoutes,
  registerShopPublicApiRoutes,
  registerShopPublicCatalogDisabledRoutes,
  registerShopAdminRoutes,
  isShopPublicCatalogEnabled
};
