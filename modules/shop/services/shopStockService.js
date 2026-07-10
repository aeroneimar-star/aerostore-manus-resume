"use strict";

const { loadShopSettings } = require("./shopSettingsService");

/**
 * Fase 2: stub — disponibilidade vem do pilot JSON.
 * Fase 7: calcular a partir de pdv_inventory_balances_v2 + fulfillment pool.
 */
function getAvailabilityLabel(availableQty = 0, reservedQty = 0, threshold = 2) {
  const sellable = Math.max(0, Number(availableQty || 0) - Number(reservedQty || 0));
  if (sellable <= 0) {
    return "out_of_stock";
  }
  if (sellable <= threshold) {
    return "low_stock";
  }
  return "in_stock";
}

function getFulfillmentConfig() {
  const settings = loadShopSettings();
  return {
    store_ids: Array.isArray(settings?.fulfillment?.store_ids) ? settings.fulfillment.store_ids : [],
    stock_policy: settings?.fulfillment?.stock_policy || "min_across_stores",
    low_stock_threshold: Number(settings?.fulfillment?.low_stock_threshold || 2),
    reservation_ttl_minutes: Number(settings?.fulfillment?.reservation_ttl_minutes || 30)
  };
}

async function computeVariantAvailability() {
  return {
    implemented: false,
    message: "Disponibilidade real via PDV disponível na Fase 7 após migrations."
  };
}

module.exports = {
  getAvailabilityLabel,
  getFulfillmentConfig,
  computeVariantAvailability
};
