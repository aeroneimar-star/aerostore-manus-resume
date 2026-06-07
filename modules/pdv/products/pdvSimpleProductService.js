"use strict";

const crypto = require("crypto");
const sqlite3 = require("sqlite3").verbose();
const { dbPath } = require("../../../db");
const { normalizeStoreKey } = require("../utils/pdvStoreUtils");

const PRODUCT_STATUSES = new Set(["ativo", "bloqueado_para_venda", "inativo"]);

function buildValidationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeSku(value = "") {
  return normalizeText(value).toUpperCase();
}

function normalizeStatus(value = "ativo") {
  const normalized = normalizeText(value || "ativo").toLowerCase();
  if (normalized === "hidden") return "bloqueado_para_venda";
  if (!PRODUCT_STATUSES.has(normalized)) {
    throw buildValidationError("Status de produto invalido.");
  }
  return normalized;
}

function toMoneyCents(value, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw buildValidationError("Informe o preco de venda do produto.");
    return null;
  }
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || (required && parsed <= 0) || (!required && parsed < 0)) {
    throw buildValidationError(required ? "Informe um preco de venda valido." : "Informe um preco de custo valido.");
  }
  return Math.round(parsed * 100);
}

function normalizeQuantity(value = 0) {
  const parsed = Number(String(value ?? 0).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw buildValidationError("O estoque inicial deve ser maior ou igual a zero.");
  }
  return Math.round(parsed * 1000) / 1000;
}

function buildActor(user = {}) {
  return {
    id: Number(user.id || user.user_id || 0) || null,
    name: normalizeText(user.name || user.email || "sistema")
  };
}

function createConnection() {
  const connection = new sqlite3.Database(dbPath);
  connection.configure("busyTimeout", 10000);
  return connection;
}

function run(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.run(sql, params, function onRun(error) {
      if (error) return reject(error);
      return resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.get(sql, params, (error, row) => {
      if (error) return reject(error);
      return resolve(row || null);
    });
  });
}

function close(connection) {
  return new Promise((resolve) => connection.close(() => resolve()));
}

async function withTransaction(callback) {
  const connection = createConnection();
  try {
    await run(connection, "PRAGMA foreign_keys = ON");
    await run(connection, "BEGIN IMMEDIATE");
    const result = await callback(connection);
    await run(connection, "COMMIT");
    return result;
  } catch (error) {
    await run(connection, "ROLLBACK").catch(() => null);
    throw error;
  } finally {
    await close(connection);
  }
}

function buildVariantId() {
  return `VAR_${crypto.randomUUID().replace(/-/g, "").toUpperCase()}`;
}

function buildMovementId() {
  return `MOV2_${crypto.randomUUID().replace(/-/g, "").toUpperCase()}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function reserveAutomaticSku(connection) {
  const sequence = await run(
    connection,
    "INSERT INTO ai_product_code_sequence (created_at) VALUES (?)",
    [nowIso()]
  );
  return `AERO-${String(sequence.lastID).padStart(6, "0")}`;
}

async function assertSkuAvailable(connection, sku, exceptVariantId = "") {
  const duplicate = await get(
    connection,
    `SELECT sku, id
     FROM pdv_product_variants
     WHERE sku = ? COLLATE NOCASE
       AND (? = '' OR id <> ?)
     UNION ALL
     SELECT COALESCE(sku, codigo) AS sku, 'LEGACY_' || id AS id
     FROM ai_products
     WHERE (sku = ? COLLATE NOCASE OR codigo = ? COLLATE NOCASE)
       AND COALESCE(deleted_at, '') = ''
     LIMIT 1`,
    [sku, exceptVariantId, exceptVariantId, sku, sku]
  );
  if (duplicate) {
    const error = new Error("Ja existe um produto com este codigo interno/SKU.");
    error.statusCode = 400;
    throw error;
  }
}

async function loadAggregate(connection, productId) {
  const product = await get(connection, "SELECT * FROM pdv_products_v2 WHERE id = ?", [productId]);
  if (!product) return null;
  const variant = await get(
    connection,
    "SELECT * FROM pdv_product_variants WHERE product_id = ? AND is_default = 1",
    [productId]
  );
  const balance = variant
    ? await get(
      connection,
      "SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = ? ORDER BY id LIMIT 1",
      [variant.id]
    )
    : null;
  return { product, variant, balance };
}

async function appendAudit(connection, {
  productId,
  variantId = null,
  actionType,
  actor,
  before = {},
  after = {}
}) {
  await run(
    connection,
    `INSERT INTO pdv_product_audit_logs
     (product_id, variant_id, action_type, actor_user_id, actor_name, before_json, after_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productId,
      variantId,
      actionType,
      actor.id,
      actor.name,
      JSON.stringify(before || {}),
      JSON.stringify(after || {}),
      nowIso()
    ]
  );
}

async function createSimpleProduct(payload = {}, user = {}) {
  const name = normalizeText(payload.name || payload.commercial_name);
  if (!name) throw buildValidationError("Nome do produto e obrigatorio.");
  const salePriceCents = toMoneyCents(payload.price ?? payload.sale_price, { required: true });
  const costPriceCents = toMoneyCents(payload.cost_price);
  const status = normalizeStatus(payload.status);
  const stock = normalizeQuantity(payload.stock ?? payload.initial_stock ?? 0);
  const storeId = normalizeStoreKey(payload.store_id || payload.store || "");
  if (!storeId) throw buildValidationError("Selecione uma loja para registrar o estoque inicial.");
  const actor = buildActor(user);

  return withTransaction(async (connection) => {
    const sku = normalizeSku(payload.sku || payload.codigo) || await reserveAutomaticSku(connection);
    await assertSkuAvailable(connection, sku);
    const timestamp = nowIso();

    const legacyInsert = await run(
      connection,
      `INSERT INTO ai_products
       (name, commercial_name, category, gender, color, sizes, price, cost_price,
        stock, estoque_total, size_stock_json, location, gtin_ean, ncm, sku, codigo,
        marca, store, short_description, sales_argument, tags, priority, status,
        use_in_ai, use_in_pos, source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        normalizeText(payload.commercial_name || name),
        normalizeText(payload.category),
        normalizeText(payload.gender),
        normalizeText(payload.color),
        "",
        salePriceCents / 100,
        costPriceCents === null ? null : costPriceCents / 100,
        stock,
        stock,
        normalizeText(payload.location),
        normalizeText(payload.gtin_ean),
        normalizeText(payload.ncm),
        sku,
        sku,
        normalizeText(payload.brand || payload.marca),
        storeId,
        normalizeText(payload.short_description),
        normalizeText(payload.sales_argument),
        normalizeText(payload.tags),
        normalizeText(payload.priority || "media"),
        status,
        Number(Boolean(payload.use_in_ai)),
        payload.use_in_pos === undefined ? 1 : Number(Boolean(payload.use_in_pos)),
        normalizeText(payload.source || "manual"),
        normalizeText(payload.notes),
        timestamp,
        timestamp
      ]
    );

    const productInsert = await run(
      connection,
      `INSERT INTO pdv_products_v2
       (legacy_ai_product_id, name, product_type, status, base_sku, sale_price_cents,
        cost_price_cents, source, created_by_user_id, created_by_name, created_at, updated_at)
       VALUES (?, ?, 'simple', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        legacyInsert.lastID,
        name,
        status,
        sku,
        salePriceCents,
        costPriceCents,
        normalizeText(payload.source || "manual"),
        actor.id,
        actor.name,
        timestamp,
        timestamp
      ]
    );

    const variantId = buildVariantId();
    await run(
      connection,
      `INSERT INTO pdv_product_variants
       (id, product_id, sku, barcode, status, attributes_json, attribute_key,
        is_default, sale_price_cents, cost_price_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', 'DEFAULT', 1, ?, ?, ?, ?)`,
      [
        variantId,
        productInsert.lastID,
        sku,
        normalizeText(payload.barcode || payload.gtin_ean) || null,
        status,
        salePriceCents,
        costPriceCents,
        timestamp,
        timestamp
      ]
    );

    await run(
      connection,
      `INSERT INTO pdv_inventory_balances_v2
       (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
       VALUES (?, ?, ?, 0, 1, ?)`,
      [variantId, storeId, stock, timestamp]
    );

    await run(
      connection,
      `INSERT INTO pdv_inventory_movements_v2
       (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
        quantity_after, origin, reference_type, reference_id, idempotency_key,
        actor_user_id, actor_name, metadata_json, created_at)
       VALUES (?, ?, ?, 'INITIAL_STOCK', ?, 0, ?, 'product_create',
        'PRODUCT', ?, ?, ?, ?, '{}', ?)`,
      [
        buildMovementId(),
        variantId,
        storeId,
        stock,
        stock,
        String(productInsert.lastID),
        `product-create:${productInsert.lastID}:initial-stock:${storeId}`,
        actor.id,
        actor.name,
        timestamp
      ]
    );

    await appendAudit(connection, {
      productId: productInsert.lastID,
      actionType: "PRODUCT_CREATED",
      actor,
      after: { name, status, sku }
    });
    await appendAudit(connection, {
      productId: productInsert.lastID,
      variantId,
      actionType: "DEFAULT_VARIANT_CREATED",
      actor,
      after: { sku, attribute_key: "DEFAULT" }
    });
    await appendAudit(connection, {
      productId: productInsert.lastID,
      variantId,
      actionType: "INITIAL_STOCK_RECORDED",
      actor,
      after: { store_id: storeId, quantity: stock }
    });

    return loadAggregate(connection, productInsert.lastID);
  });
}

async function updateSimpleProduct(legacyAiProductId, payload = {}, user = {}) {
  const actor = buildActor(user);
  return withTransaction(async (connection) => {
    const current = await get(
      connection,
      `SELECT p.*, v.id AS variant_id, v.sku AS variant_sku, v.first_sold_at
       FROM pdv_products_v2 p
       INNER JOIN pdv_product_variants v ON v.product_id = p.id AND v.is_default = 1
       WHERE p.legacy_ai_product_id = ?`,
      [legacyAiProductId]
    );
    if (!current) throw new Error("Produto simples normalizado nao encontrado.");

    const name = payload.name === undefined
      ? current.name
      : normalizeText(payload.name || payload.commercial_name);
    if (!name) throw buildValidationError("Nome do produto e obrigatorio.");
    const salePriceCents = payload.price === undefined && payload.sale_price === undefined
      ? current.sale_price_cents
      : toMoneyCents(payload.price ?? payload.sale_price, { required: true });
    const costPriceCents = payload.cost_price === undefined
      ? current.cost_price_cents
      : toMoneyCents(payload.cost_price);
    const status = payload.status === undefined ? current.status : normalizeStatus(payload.status);
    const requestedSku = normalizeSku(payload.sku || payload.codigo);
    const sku = requestedSku || current.variant_sku;
    if (sku !== current.variant_sku) {
      if (current.first_sold_at) {
        throw new Error("O SKU nao pode ser alterado depois que o produto possui venda.");
      }
      await assertSkuAvailable(connection, sku, current.variant_id);
    }
    const timestamp = nowIso();

    await run(
      connection,
      `UPDATE pdv_products_v2
       SET name = ?, status = ?, base_sku = ?, sale_price_cents = ?,
           cost_price_cents = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [name, status, sku, salePriceCents, costPriceCents, timestamp, current.id]
    );
    await run(
      connection,
      `UPDATE pdv_product_variants
       SET sku = ?, status = ?, sale_price_cents = ?, cost_price_cents = ?, updated_at = ?
       WHERE id = ?`,
      [sku, status, salePriceCents, costPriceCents, timestamp, current.variant_id]
    );
    await run(
      connection,
      `UPDATE ai_products
       SET name = ?, commercial_name = ?, price = ?, cost_price = ?, status = ?,
           sku = ?, codigo = ?, updated_at = ?
       WHERE id = ?`,
      [
        name,
        normalizeText(payload.commercial_name || name),
        salePriceCents / 100,
        costPriceCents === null ? null : costPriceCents / 100,
        status,
        sku,
        sku,
        timestamp,
        legacyAiProductId
      ]
    );
    await appendAudit(connection, {
      productId: current.id,
      variantId: current.variant_id,
      actionType: "PRODUCT_UPDATED",
      actor,
      before: {
        name: current.name,
        status: current.status,
        sku: current.variant_sku,
        sale_price_cents: current.sale_price_cents,
        cost_price_cents: current.cost_price_cents
      },
      after: { name, status, sku, sale_price_cents: salePriceCents, cost_price_cents: costPriceCents }
    });
    return loadAggregate(connection, current.id);
  });
}

async function applyNormalizedInventoryMovement(payload = {}, user = {}) {
  const variantId = normalizeText(payload.variant_id);
  const storeId = normalizeStoreKey(payload.store_id || "");
  const idempotencyKey = normalizeText(payload.idempotency_key);
  const movementType = normalizeText(payload.movement_type).toUpperCase();
  const quantityDelta = Number(payload.quantity_delta);
  if (!variantId || !storeId || !idempotencyKey || !movementType || !Number.isFinite(quantityDelta)) {
    throw new Error("Movimento de estoque normalizado invalido.");
  }
  const actor = buildActor(user);

  return withTransaction(async (connection) => {
    const existing = await get(
      connection,
      "SELECT * FROM pdv_inventory_movements_v2 WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) {
      const balance = await get(
        connection,
        "SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = ? AND store_id = ? COLLATE NOCASE",
        [variantId, storeId]
      );
      return { movement: existing, balance, replayed: true };
    }

    const variant = await get(
      connection,
      "SELECT * FROM pdv_product_variants WHERE id = ?",
      [variantId]
    );
    if (!variant) throw new Error("Variacao de produto nao encontrada.");
    const balance = await get(
      connection,
      "SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = ? AND store_id = ? COLLATE NOCASE",
      [variantId, storeId]
    );
    if (!balance) throw new Error("Saldo da variacao nao encontrado para a loja.");
    const beforeQty = Number(balance.available_qty || 0);
    const afterQty = Math.round((beforeQty + quantityDelta) * 1000) / 1000;
    if (afterQty < 0) throw new Error("Estoque insuficiente para concluir o movimento.");
    const timestamp = nowIso();
    const movementId = buildMovementId();

    await run(
      connection,
      `UPDATE pdv_inventory_balances_v2
       SET available_qty = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [afterQty, timestamp, balance.id]
    );
    await run(
      connection,
      `INSERT INTO pdv_inventory_movements_v2
       (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
        quantity_after, origin, reference_type, reference_id, idempotency_key,
        actor_user_id, actor_name, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        movementId,
        variantId,
        storeId,
        movementType,
        quantityDelta,
        beforeQty,
        afterQty,
        normalizeText(payload.origin),
        normalizeText(payload.reference_type),
        normalizeText(payload.reference_id),
        idempotencyKey,
        actor.id,
        actor.name,
        JSON.stringify(payload.metadata || {}),
        timestamp
      ]
    );

    if (["SALE_OUT", "EXCHANGE_OUT"].includes(movementType)) {
      await run(
        connection,
        `UPDATE pdv_product_variants
         SET first_sold_at = COALESCE(first_sold_at, ?),
             sku_locked_at = COALESCE(sku_locked_at, ?),
             updated_at = ?
         WHERE id = ?`,
        [timestamp, timestamp, timestamp, variantId]
      );
    }

    const product = await get(
      connection,
      `SELECT p.id, p.legacy_ai_product_id
       FROM pdv_products_v2 p
       INNER JOIN pdv_product_variants v ON v.product_id = p.id
       WHERE v.id = ?`,
      [variantId]
    );
    if (product?.legacy_ai_product_id) {
      await run(
        connection,
        "UPDATE ai_products SET stock = ?, estoque_total = ?, updated_at = ? WHERE id = ?",
        [afterQty, afterQty, timestamp, product.legacy_ai_product_id]
      );
    }
    await appendAudit(connection, {
      productId: product.id,
      variantId,
      actionType: "INVENTORY_BALANCE_CHANGED",
      actor,
      before: { store_id: storeId, available_qty: beforeQty },
      after: {
        store_id: storeId,
        available_qty: afterQty,
        movement_type: movementType,
        reference_id: normalizeText(payload.reference_id)
      }
    });

    return {
      movement: await get(connection, "SELECT * FROM pdv_inventory_movements_v2 WHERE id = ?", [movementId]),
      balance: await get(connection, "SELECT * FROM pdv_inventory_balances_v2 WHERE id = ?", [balance.id]),
      replayed: false
    };
  });
}

async function getSimpleProductByLegacyId(legacyAiProductId) {
  const connection = createConnection();
  try {
    const product = await get(
      connection,
      "SELECT id FROM pdv_products_v2 WHERE legacy_ai_product_id = ?",
      [legacyAiProductId]
    );
    return product ? await loadAggregate(connection, product.id) : null;
  } finally {
    await close(connection);
  }
}

module.exports = {
  createSimpleProduct,
  updateSimpleProduct,
  applyNormalizedInventoryMovement,
  getSimpleProductByLegacyId
};
