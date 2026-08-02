"use strict";

const { randomUUID } = require("crypto");
const { addressDto, envelope } = require("./appAddressDto");

class AppAddressError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AppAddressError";
    this.code = code;
    this.status = status || 400;
  }
}

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

const MAX_LABEL = 40;
const MAX_NAME = 120;
const MAX_STREET = 200;
const MAX_NUMBER = 20;
const MAX_COMPLEMENT = 80;
const MAX_NEIGHBORHOOD = 100;
const MAX_CITY = 100;
const MAX_STATE = 2;
const MAX_INSTRUCTIONS = 300;

function clean(value, max) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function validateAddressInput(input = {}) {
  const errors = [];
  if (!input.recipient_name || !String(input.recipient_name).trim()) errors.push("recipient_name");
  if (!input.postal_code || !/^\d{8}$/.test(String(input.postal_code).replace(/\D/g, ""))) errors.push("postal_code");
  if (!input.street || !String(input.street).trim()) errors.push("street");
  if (!input.number || !String(input.number).trim()) errors.push("number");
  if (!input.neighborhood || !String(input.neighborhood).trim()) errors.push("neighborhood");
  if (!input.city || !String(input.city).trim()) errors.push("city");
  if (!input.state || !/^[A-Z]{2}$/i.test(String(input.state).trim())) errors.push("state");
  return errors;
}

function sanitizeAddress(input = {}) {
  const cep = String(input.postal_code || "").replace(/\D/g, "");
  return {
    label: clean(input.label || "Casa", MAX_LABEL),
    recipient_name: clean(input.recipient_name, MAX_NAME),
    postal_code_protected: cep,
    postal_code_masked: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : "",
    street: clean(input.street, MAX_STREET),
    number: clean(input.number, MAX_NUMBER),
    complement: clean(input.complement || "", MAX_COMPLEMENT),
    neighborhood: clean(input.neighborhood, MAX_NEIGHBORHOOD),
    city: clean(input.city, MAX_CITY),
    state: clean(input.state, MAX_STATE).toUpperCase(),
    delivery_instructions: clean(input.delivery_instructions || "", MAX_INSTRUCTIONS),
    latitude: input.latitude !== undefined ? Number(input.latitude) : null,
    longitude: input.longitude !== undefined ? Number(input.longitude) : null,
    validation_status: input.validation_status || "PENDING"
  };
}

function createAppAddressService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("APP_ADDRESS_DB_REQUIRED");
  }
  const recordAudit = options.recordAudit || (async () => null);
  const postalCodeService = options.postalCodeService || null;

  function audit(action, metadata = {}, entityId = "") {
    return recordAudit({
      module: "app_address",
      action,
      entity_type: "address",
      entity_id: entityId,
      includeBody: false,
      metadata,
      source: "app"
    });
  }

  async function listAddresses(accountId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(accountId || ""))) {
      throw new AppAddressError("INVALID_ACCOUNT_ID", 400, "Identificador de conta invalido.");
    }
    const rows = await db.all(
      "SELECT * FROM app_customer_addresses WHERE account_id = ? AND archived_at IS NULL ORDER BY is_default DESC, updated_at DESC",
      [accountId]
    );
    const addresses = rows.map(addressDto);
    await audit("ADDRESS_LIST_VIEW", { count: addresses.length });
    return envelope(addresses);
  }

  async function getAddress(accountId, addressId) {
    const addr = await db.get(
      "SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL",
      [addressId, accountId]
    );
    if (!addr) throw new AppAddressError("ADDRESS_NOT_FOUND", 404, "Endereco nao encontrado.");
    return envelope(addressDto(addr));
  }

  async function createAddress(accountId, input = {}) {
    const inputErrors = validateAddressInput(input);
    if (inputErrors.length > 0) {
      throw new AppAddressError("INVALID_ADDRESS_FIELDS", 400, `Campos obrigatorios: ${inputErrors.join(", ")}.`);
    }

    const sanitized = sanitizeAddress(input);
    const currentIso = iso(clock());
    const id = generateId();

    // Determinar se sera default (primeiro endereco ou solicitado)
    const existingCount = Number((await db.get("SELECT COUNT(*) total FROM app_customer_addresses WHERE account_id = ? AND archived_at IS NULL", [accountId]))?.total || 0);
    const isDefault = existingCount === 0 || Boolean(input.is_default);

    if (isDefault) {
      // Desativar default existente
      await db.run("UPDATE app_customer_addresses SET is_default = 0, updated_at = ? WHERE account_id = ? AND is_default = 1 AND archived_at IS NULL", [currentIso, accountId]);
    }

    await db.run(
      `INSERT INTO app_customer_addresses (id, account_id, label, recipient_name, postal_code_protected, postal_code_masked, street, number, complement, neighborhood, city, state, delivery_instructions, latitude, longitude, validation_status, is_default, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, accountId, sanitized.label, sanitized.recipient_name, sanitized.postal_code_protected, sanitized.postal_code_masked, sanitized.street, sanitized.number, sanitized.complement, sanitized.neighborhood, sanitized.city, sanitized.state, sanitized.delivery_instructions, sanitized.latitude, sanitized.longitude, sanitized.validation_status, isDefault ? 1 : 0, currentIso, currentIso]
    );

    const created = await db.get("SELECT * FROM app_customer_addresses WHERE id = ?", [id]);
    await audit("APP_ADDRESS_CREATED", { address_id: id, is_default: isDefault ? 1 : 0, postal_code: sanitized.postal_code_masked, city: sanitized.city, state: sanitized.state }, id);
    return envelope(addressDto(created));
  }

  async function updateAddress(accountId, addressId, input = {}) {
    const existing = await db.get(
      "SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL",
      [addressId, accountId]
    );
    if (!existing) throw new AppAddressError("ADDRESS_NOT_FOUND", 404, "Endereco nao encontrado.");

    // Versionamento otimista
    const expectedVersion = Number(input.expectedVersion || existing.version);
    if (expectedVersion !== Number(existing.version)) {
      throw new AppAddressError("ADDRESS_VERSION_CONFLICT", 409, "Endereco foi modificado por outra sessao. Recarregue e tente novamente.");
    }

    const sanitized = sanitizeAddress({ ...existing, ...input });
    // Preservar valores que nao foram sobrescritos
    const fields = [];
    const params = [];
    const currentIso = iso(clock());

    if (input.label !== undefined) { fields.push("label = ?"); params.push(sanitized.label); }
    if (input.recipient_name !== undefined) { fields.push("recipient_name = ?"); params.push(sanitized.recipient_name); }
    if (input.postal_code !== undefined) { fields.push("postal_code_protected = ?", "postal_code_masked = ?"); params.push(sanitized.postal_code_protected, sanitized.postal_code_masked); }
    if (input.street !== undefined) { fields.push("street = ?"); params.push(sanitized.street); }
    if (input.number !== undefined) { fields.push("number = ?"); params.push(sanitized.number); }
    if (input.complement !== undefined) { fields.push("complement = ?"); params.push(sanitized.complement); }
    if (input.neighborhood !== undefined) { fields.push("neighborhood = ?"); params.push(sanitized.neighborhood); }
    if (input.city !== undefined) { fields.push("city = ?"); params.push(sanitized.city); }
    if (input.state !== undefined) { fields.push("state = ?"); params.push(sanitized.state); }
    if (input.delivery_instructions !== undefined) { fields.push("delivery_instructions = ?"); params.push(sanitized.delivery_instructions); }
    if (input.latitude !== undefined) { fields.push("latitude = ?"); params.push(sanitized.latitude); }
    if (input.longitude !== undefined) { fields.push("longitude = ?"); params.push(sanitized.longitude); }

    // Nao sobrescrever numero/complemento ja preenchidos se nao foram enviados
    if (input.number === undefined && existing.number) { /* manter existente */ }
    if (input.complement === undefined && existing.complement) { /* manter existente */ }

    fields.push("version = version + 1", "updated_at = ?");
    params.push(currentIso);

    if (fields.length > 2) {
      await db.run(`UPDATE app_customer_addresses SET ${fields.join(", ")} WHERE id = ? AND account_id = ? AND archived_at IS NULL AND version = ?`, [...params, addressId, accountId, expectedVersion]);
    }

    const updated = await db.get("SELECT * FROM app_customer_addresses WHERE id = ?", [addressId]);
    await audit("APP_ADDRESS_UPDATED", { address_id: addressId, version: Number(updated.version), postal_code: sanitized.postal_code_masked }, addressId);
    return envelope(addressDto(updated));
  }

  async function archiveAddress(accountId, addressId) {
    const existing = await db.get(
      "SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL",
      [addressId, accountId]
    );
    if (!existing) throw new AppAddressError("ADDRESS_NOT_FOUND", 404, "Endereco nao encontrado.");

    // Verificar se esta selecionado em algum carrinho
    const cartUsage = await db.get(
      "SELECT COUNT(*) total FROM app_cart_fulfillment WHERE address_id = ? AND shipping_status NOT IN ('EXPIRED','FAILED')",
      [addressId]
    );
    if (Number(cartUsage?.total || 0) > 0) {
      throw new AppAddressError("ADDRESS_IN_USE_BY_CART", 409, "Este endereco esta em uso por um carrinho ativo. Altere a modalidade de entrega antes de arquivar.");
    }

    const currentIso = iso(clock());
    const wasDefault = Boolean(existing.is_default);

    await db.run("BEGIN IMMEDIATE");
    try {
      await db.run("UPDATE app_customer_addresses SET archived_at = ?, updated_at = ? WHERE id = ? AND account_id = ? AND archived_at IS NULL", [currentIso, currentIso, addressId, accountId]);
      if (wasDefault) {
        // Escolher outro endereco como default se existir
        const next = await db.get("SELECT id FROM app_customer_addresses WHERE account_id = ? AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1", [accountId]);
        if (next) {
          await db.run("UPDATE app_customer_addresses SET is_default = 1, updated_at = ? WHERE id = ?", [currentIso, next.id]);
        }
      }
      await db.run("COMMIT");
    } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }

    await audit("APP_ADDRESS_ARCHIVED", { address_id: addressId, was_default: wasDefault ? 1 : 0 }, addressId);
    return { success: true, meta: { api_version: "v1" } };
  }

  async function setDefaultAddress(accountId, addressId) {
    const existing = await db.get(
      "SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL",
      [addressId, accountId]
    );
    if (!existing) throw new AppAddressError("ADDRESS_NOT_FOUND", 404, "Endereco nao encontrado.");

    const currentIso = iso(clock());
    await db.run("BEGIN IMMEDIATE");
    try {
      await db.run("UPDATE app_customer_addresses SET is_default = 0, updated_at = ? WHERE account_id = ? AND archived_at IS NULL", [currentIso, accountId]);
      await db.run("UPDATE app_customer_addresses SET is_default = 1, updated_at = ? WHERE id = ?", [currentIso, addressId]);
      await db.run("COMMIT");
    } catch (error) { await db.run("ROLLBACK").catch(() => null); throw error; }

    await audit("APP_ADDRESS_DEFAULT_CHANGED", { address_id: addressId }, addressId);
    return envelope(addressDto(await db.get("SELECT * FROM app_customer_addresses WHERE id = ?", [addressId])));
  }

  return { listAddresses, getAddress, createAddress, updateAddress, archiveAddress, setDefaultAddress };
}

module.exports = { AppAddressError, createAppAddressService, sanitizeAddress, validateAddressInput };
