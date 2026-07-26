"use strict";

const shopCatalogService = require("../../../shop/services/shopCatalogService");

function createPilotCatalogSource(service = shopCatalogService) {
  return {
    listCatalog(params = {}) {
      return service.listCatalog(params);
    },

    getFilters() {
      return service.listCatalogFilters();
    },

    getProductBySlug(slug) {
      return service.getProductBySlug(slug);
    }
  };
}

module.exports = {
  createPilotCatalogSource
};
