"use strict";

const FORBIDDEN_KEYS = new Set([
  "cost", "cost_price", "supplier", "fornecedor", "margin", "margem",
  "available_qty", "reserved_qty", "physical_qty", "store_id", "barcode",
  "legacy_ai_product_id", "source", "notes", "audit", "history",
  "postal_code_protected", "account_id", "idempotency_key"
]);

function pick(source = {}, keys = []) {
  return keys.reduce((result, key) => {
    if (source[key] !== undefined) result[key] = source[key];
    return result;
  }, {});
}

function addressDto(addr = {}) {
  return {
    id: addr.id,
    label: addr.label || "",
    recipientName: addr.recipient_name || "",
    postalCode: addr.postal_code_masked || "",
    street: addr.street || "",
    number: addr.number || "",
    complement: addr.complement || "",
    neighborhood: addr.neighborhood || "",
    city: addr.city || "",
    state: addr.state || "",
    deliveryInstructions: addr.delivery_instructions || "",
    validationStatus: addr.validation_status || "PENDING",
    isDefault: Boolean(addr.is_default),
    version: Number(addr.version),
    updatedAt: addr.updated_at
  };
}

function assertAllowList(value, path = "") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertAllowList(item, `${path}[${index}].`));
    return;
  }
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_KEYS.has(String(key).toLowerCase())) {
      throw new Error(`APP_ADDRESS_FORBIDDEN_FIELD:${path}${key}`);
    }
    assertAllowList(nested, `${path}${key}.`);
  });
}

function envelope(data) {
  const response = { success: true, data, meta: { api_version: "v1" } };
  assertAllowList(response);
  return response;
}

module.exports = { FORBIDDEN_KEYS, addressDto, assertAllowList, envelope };
