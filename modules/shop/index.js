"use strict";

const { registerShopPublicRoutes } = require("./routes/shopPublicRoutes");
const { registerShopPublicApiRoutes } = require("./routes/shopPublicApiRoutes");
const { registerShopAdminRoutes } = require("./routes/shopAdminRoutes");

function registerShopModule(app) {
  registerShopPublicApiRoutes(app);
  registerShopPublicRoutes(app);
  // Rotas /api/shop/* registradas em server.js após authMiddleware.
}

module.exports = {
  registerShopModule,
  registerShopPublicRoutes,
  registerShopPublicApiRoutes,
  registerShopAdminRoutes
};
