"use strict";

const { registerShopPublicRoutes } = require("./routes/shopPublicRoutes");
const { registerShopPublicApiRoutes } = require("./routes/shopPublicApiRoutes");
const { registerShopAdminRoutes } = require("./routes/shopAdminRoutes");

function registerShopModule(app) {
  registerShopPublicApiRoutes(app);
  registerShopPublicRoutes(app);
  registerShopAdminRoutes(app);
}

module.exports = {
  registerShopModule,
  registerShopPublicRoutes,
  registerShopPublicApiRoutes,
  registerShopAdminRoutes
};
