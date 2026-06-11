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

function buildConflictError(message, details = {}) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = details.code || "CONFLICT";
  error.details = details;
  return error;
}

function normalizeText(value = "") {
  return String(value ?? "").trim();
}

function normalizeSku(value = "") {
  return normalizeText(value).toUpperCase();
}

function normalizeVariantColor(value = "") {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeVariantSize(value = "") {
  return normalizeText(value).toUpperCase().replace(/\s+/g, "");
}

function buildVariantSku(baseSku, color, size) {
  return [
    normalizeSku(baseSku),
    normalizeVariantColor(color),
    normalizeVariantSize(size)
  ].filter(Boolean).join("-");
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

function roundQty(value = 0) {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function serializeBalance(row = {}) {
  const physicalQty = roundQty(row.available_qty);
  const reservedQty = roundQty(row.reserved_qty);
  return {
    physical_qty: physicalQty,
    reserved_qty: reservedQty,
    available_qty: roundQty(physicalQty - reservedQty)
  };
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

function buildOperationFingerprint(payload = {}) {
  const canonical = JSON.stringify({
    movement_type: normalizeText(payload.movement_type).toUpperCase(),
    variant_id: normalizeText(payload.variant_id),
    store_id: normalizeStoreKey(payload.store_id || ""),
    quantity_delta: roundQty(payload.quantity_delta),
    origin: normalizeText(payload.origin),
    reference_type: normalizeText(payload.reference_type),
    reference_id: normalizeText(payload.reference_id)
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
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
    throw buildConflictError(`Ja existe uma variacao com o SKU ${sku}.`, {
      code: "VARIANT_SKU_CONFLICT",
      sku
    });
  }
}

async function assertBarcodeAvailable(connection, barcode, exceptVariantId = "") {
  if (!barcode) return;
  const duplicate = await get(
    connection,
    `SELECT id, barcode
     FROM pdv_product_variants
     WHERE barcode = ? COLLATE NOCASE
       AND (? = '' OR id <> ?)
     LIMIT 1`,
    [barcode, exceptVariantId, exceptVariantId]
  );
  if (duplicate) {
    throw buildConflictError(`Ja existe uma variacao com o codigo de barras ${barcode}.`, {
      code: "VARIANT_BARCODE_CONFLICT",
      barcode
    });
  }
}

function parseAttributes(value = "{}") {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

async function loadProductAggregate(connection, productId) {
  const product = await get(connection, "SELECT * FROM pdv_products_v2 WHERE id = ?", [productId]);
  if (!product) return null;
  const rows = await new Promise((resolve, reject) => {
    connection.all(
      `SELECT
         v.*,
         b.id AS balance_id,
         b.store_id,
         b.available_qty AS balance_physical_qty,
         b.reserved_qty AS balance_reserved_qty,
         b.version AS balance_version,
         b.updated_at AS balance_updated_at
       FROM pdv_product_variants v
       LEFT JOIN pdv_inventory_balances_v2 b ON b.variant_id = v.id
       WHERE v.product_id = ?
       ORDER BY v.created_at, v.id, b.store_id`,
      [productId],
      (error, result) => {
        if (error) return reject(error);
        return resolve(result || []);
      }
    );
  });
  const variantMap = new Map();
  rows.forEach((row) => {
    if (!variantMap.has(row.id)) {
      const attributes = parseAttributes(row.attributes_json);
      variantMap.set(row.id, {
        ...row,
        variation_id: row.id,
        color: normalizeText(attributes.color),
        size: normalizeText(attributes.size),
        balances: []
      });
    }
    if (row.balance_id) {
      const balanceValues = serializeBalance({
        available_qty: row.balance_physical_qty,
        reserved_qty: row.balance_reserved_qty
      });
      variantMap.get(row.id).balances.push({
        id: row.balance_id,
        variant_id: row.id,
        store_id: row.store_id,
        version: row.balance_version,
        updated_at: row.balance_updated_at,
        ...balanceValues
      });
    }
  });
  const variants = Array.from(variantMap.values()).map((variant) => {
    const totals = variant.balances.reduce((summary, balance) => ({
      physical_qty: roundQty(summary.physical_qty + balance.physical_qty),
      reserved_qty: roundQty(summary.reserved_qty + balance.reserved_qty),
      available_qty: roundQty(summary.available_qty + balance.available_qty)
    }), { physical_qty: 0, reserved_qty: 0, available_qty: 0 });
    return { ...variant, ...totals };
  });
  const totals = variants.reduce((summary, variant) => ({
    physical_qty: roundQty(summary.physical_qty + variant.physical_qty),
    reserved_qty: roundQty(summary.reserved_qty + variant.reserved_qty),
    available_qty: roundQty(summary.available_qty + variant.available_qty)
  }), { physical_qty: 0, reserved_qty: 0, available_qty: 0 });
  const variant = variants.find((item) => Number(item.is_default) === 1) || variants[0] || null;
  const balance = variant?.balances?.[0]
    ? {
      id: variant.balances[0].id,
      variant_id: variant.id,
      store_id: variant.balances[0].store_id,
      available_qty: variant.balances[0].physical_qty,
      reserved_qty: variant.balances[0].reserved_qty,
      version: variant.balances[0].version,
      updated_at: variant.balances[0].updated_at,
      physical_qty: variant.balances[0].physical_qty,
      sellable_available_qty: variant.balances[0].available_qty
    }
    : null;
  return { product, variants, totals, variant, balance };
}

async function loadAggregate(connection, productId) {
  return loadProductAggregate(connection, productId);
}

function normalizeVariantInputs(payload = {}, baseSku = "") {
  const productType = normalizeText(payload.product_type || "simple").toLowerCase();
  if (!["simple", "variable"].includes(productType)) {
    throw buildValidationError("Tipo de produto invalido.");
  }
  if (productType === "simple") {
    const sku = normalizeSku(payload.sku || payload.codigo || baseSku);
    return [{
      attributeKey: "DEFAULT",
      attributes: {},
      color: "",
      size: "",
      sku,
      barcode: normalizeText(payload.barcode || payload.gtin_ean),
      status: normalizeStatus(payload.status),
      initialStock: normalizeQuantity(payload.stock ?? payload.initial_stock ?? 0),
      isDefault: 1
    }];
  }
  const sourceVariants = Array.isArray(payload.variants) ? payload.variants : [];
  if (!sourceVariants.length) {
    throw buildValidationError("Informe ao menos uma variacao para o produto com grade.");
  }
  const seenAttributes = new Set();
  const seenSkus = new Set();
  const seenBarcodes = new Set();
  return sourceVariants.map((item, index) => {
    const color = normalizeVariantColor(item.color || item.cor);
    const size = normalizeVariantSize(item.size || item.tamanho);
    if (!color || !size) {
      throw buildValidationError(`Informe cor e tamanho na variacao ${index + 1}.`);
    }
    const attributeKey = `${color}|${size}`;
    if (seenAttributes.has(attributeKey)) {
      throw buildConflictError(`A combinacao ${color}/${size} esta duplicada na grade.`, {
        code: "VARIANT_ATTRIBUTE_CONFLICT",
        attribute_key: attributeKey
      });
    }
    seenAttributes.add(attributeKey);
    const sku = normalizeSku(item.sku) || buildVariantSku(baseSku, color, size);
    if (seenSkus.has(sku)) {
      throw buildConflictError(`Ja existe uma variacao com o SKU ${sku}.`, {
        code: "VARIANT_SKU_CONFLICT",
        sku,
        attribute_key: attributeKey
      });
    }
    seenSkus.add(sku);
    const barcode = normalizeText(item.barcode || item.gtin_ean);
    if (barcode && seenBarcodes.has(barcode.toUpperCase())) {
      throw buildConflictError(`Ja existe uma variacao com o codigo de barras ${barcode}.`, {
        code: "VARIANT_BARCODE_CONFLICT",
        barcode,
        attribute_key: attributeKey
      });
    }
    if (barcode) seenBarcodes.add(barcode.toUpperCase());
    return {
      attributeKey,
      attributes: { color, size },
      color,
      size,
      sku,
      barcode,
      status: normalizeStatus(item.status || payload.status),
      initialStock: normalizeQuantity(item.initial_stock ?? item.stock ?? item.quantity ?? 0),
      isDefault: 0
    };
  });
}

async function insertLegacyProduct(connection, payload, {
  name,
  salePriceCents,
  costPriceCents,
  status,
  baseSku,
  storeId,
  totalStock,
  timestamp
}) {
  const promotionalPriceCents = toMoneyCents(payload.promotional_price);
  return run(
    connection,
    `INSERT INTO ai_products
     (name, commercial_name, category, gender, color, sizes, price, promotional_price, cost_price,
      stock, estoque_total, size_stock_json, location, gtin_ean, ncm, sku, codigo,
      marca, store, short_description, sales_argument, tags, priority, status,
     use_in_ai, use_in_pos, source, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      normalizeText(payload.commercial_name || name),
      normalizeText(payload.category),
      normalizeText(payload.gender),
      normalizeText(payload.color),
      normalizeText(payload.sizes),
      salePriceCents / 100,
      promotionalPriceCents === null ? null : promotionalPriceCents / 100,
      costPriceCents === null ? null : costPriceCents / 100,
      totalStock,
      totalStock,
      "[]",
      normalizeText(payload.location),
      normalizeText(payload.gtin_ean),
      normalizeText(payload.ncm),
      baseSku,
      baseSku,
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

async function createProductAggregate(payload = {}, user = {}, options = {}) {
  const name = normalizeText(payload.name || payload.commercial_name);
  if (!name) throw buildValidationError("Nome do produto e obrigatorio.");
  const salePriceCents = toMoneyCents(payload.price ?? payload.sale_price, { required: true });
  const costPriceCents = toMoneyCents(payload.cost_price);
  const status = normalizeStatus(payload.status);
  const storeId = normalizeStoreKey(payload.store_id || payload.store || "");
  if (!storeId) throw buildValidationError("Selecione uma loja para registrar o estoque inicial.");
  const actor = buildActor(user);

  return withTransaction(async (connection) => {
    const baseSku = normalizeSku(payload.base_sku || payload.sku || payload.codigo)
      || await reserveAutomaticSku(connection);
    const variants = normalizeVariantInputs(payload, baseSku);
    for (const variant of variants) {
      await assertSkuAvailable(connection, variant.sku);
      await assertBarcodeAvailable(connection, variant.barcode);
    }
    const totalStock = roundQty(variants.reduce((sum, item) => sum + item.initialStock, 0));
    const timestamp = nowIso();
    const legacyInsert = await insertLegacyProduct(connection, payload, {
      name,
      salePriceCents,
      costPriceCents,
      status,
      baseSku,
      storeId,
      totalStock,
      timestamp
    });

    const productInsert = await run(
      connection,
      `INSERT INTO pdv_products_v2
       (legacy_ai_product_id, name, product_type, status, base_sku, sale_price_cents,
        cost_price_cents, source, created_by_user_id, created_by_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        legacyInsert.lastID,
        name,
        normalizeText(payload.product_type || "simple").toLowerCase(),
        status,
        baseSku,
        salePriceCents,
        costPriceCents,
        normalizeText(payload.source || "manual"),
        actor.id,
        actor.name,
        timestamp,
        timestamp
      ]
    );

    await appendAudit(connection, {
      productId: productInsert.lastID,
      actionType: "PRODUCT_CREATED",
      actor,
      after: { name, status, base_sku: baseSku, product_type: payload.product_type || "simple" }
    });

    for (const variant of variants) {
      const variantId = buildVariantId();
      await run(
        connection,
        `INSERT INTO pdv_product_variants
         (id, product_id, sku, barcode, status, attributes_json, attribute_key,
          is_default, sale_price_cents, cost_price_cents, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          variantId,
          productInsert.lastID,
          variant.sku,
          variant.barcode || null,
          variant.status,
          JSON.stringify(variant.attributes),
          variant.attributeKey,
          variant.isDefault,
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
        [variantId, storeId, variant.initialStock, timestamp]
      );
      await run(
        connection,
        `INSERT INTO pdv_inventory_movements_v2
         (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
          quantity_after, origin, reference_type, reference_id, idempotency_key,
          actor_user_id, actor_name, metadata_json, created_at)
         VALUES (?, ?, ?, 'INITIAL_STOCK', ?, 0, ?, 'product_create',
          'PRODUCT', ?, ?, ?, ?, ?, ?)`,
        [
          buildMovementId(),
          variantId,
          storeId,
          variant.initialStock,
          variant.initialStock,
          String(productInsert.lastID),
          `product-create:${productInsert.lastID}:variant:${variantId}:initial-stock:${storeId}`,
          actor.id,
          actor.name,
          JSON.stringify({ color: variant.color, size: variant.size }),
          timestamp
        ]
      );
      await appendAudit(connection, {
        productId: productInsert.lastID,
        variantId,
        actionType: variant.isDefault ? "DEFAULT_VARIANT_CREATED" : "VARIANT_CREATED",
        actor,
        after: { sku: variant.sku, attribute_key: variant.attributeKey }
      });
      await appendAudit(connection, {
        productId: productInsert.lastID,
        variantId,
        actionType: "INITIAL_STOCK_RECORDED",
        actor,
        after: { store_id: storeId, quantity: variant.initialStock }
      });
    }

    const aggregate = await loadProductAggregate(connection, productInsert.lastID);
    if (typeof options.projectAggregate === "function") {
      aggregate.operational_projection = await options.projectAggregate(aggregate);
    }
    return aggregate;
  });
}

async function createSimpleProduct(payload = {}, user = {}, options = {}) {
  return createProductAggregate({
    ...payload,
    product_type: "simple",
    base_sku: payload.sku || payload.codigo || payload.base_sku
  }, user, options);
}

async function updateProductAggregate(productId, payload = {}, user = {}, options = {}) {
  const actor = buildActor(user);
  return withTransaction(async (connection) => {
    const current = await loadProductAggregate(connection, productId);
    if (!current) throw buildValidationError("Produto normalizado nao encontrado.");
    const name = payload.name === undefined
      ? current.product.name
      : normalizeText(payload.name || payload.commercial_name);
    if (!name) throw buildValidationError("Nome do produto e obrigatorio.");
    const salePriceCents = payload.price === undefined && payload.sale_price === undefined
      ? current.product.sale_price_cents
      : toMoneyCents(payload.price ?? payload.sale_price, { required: true });
    const costPriceCents = payload.cost_price === undefined
      ? current.product.cost_price_cents
      : toMoneyCents(payload.cost_price);
    const status = payload.status === undefined
      ? current.product.status
      : normalizeStatus(payload.status);
    const requestedVariants = Array.isArray(payload.variants) ? payload.variants : null;
    const requestedStoreId = normalizeStoreKey(
      payload.store_id
      || payload.store
      || current.variants[0]?.balances?.[0]?.store_id
      || ""
    );
    const timestamp = nowIso();

    await run(
      connection,
      `UPDATE pdv_products_v2
       SET name = ?, status = ?, sale_price_cents = ?, cost_price_cents = ?,
           version = version + 1, updated_at = ?
       WHERE id = ?`,
      [name, status, salePriceCents, costPriceCents, timestamp, current.product.id]
    );

    if (requestedVariants) {
      const existingByKey = new Map(current.variants.map((item) => [item.attribute_key, item]));
      const existingById = new Map(current.variants.map((item) => [item.variation_id, item]));
      const requestedByKey = new Map();
      const requestedVariantIds = new Set();
      for (const [index, item] of requestedVariants.entries()) {
        const color = normalizeVariantColor(item.color || item.cor);
        const size = normalizeVariantSize(item.size || item.tamanho);
        if (!color || !size) {
          throw buildValidationError(`Informe cor e tamanho na variacao ${index + 1}.`);
        }
        const attributeKey = `${color}|${size}`;
        if (requestedByKey.has(attributeKey)) {
          throw buildConflictError(`A combinacao ${color}/${size} esta duplicada na grade.`, {
            code: "VARIANT_ATTRIBUTE_CONFLICT",
            attribute_key: attributeKey
          });
        }
        const requestedVariationId = normalizeText(item.variation_id);
        const existingForId = requestedVariationId
          ? existingById.get(requestedVariationId) || null
          : null;
        const existingForKey = existingByKey.get(attributeKey) || null;
        if (requestedVariationId && !existingForId) {
          throw buildConflictError("A variacao informada nao pertence a este produto.", {
            code: "VARIANT_ID_NOT_FOUND",
            variation_id: requestedVariationId
          });
        }
        if (existingForKey && existingForId && existingForKey.variation_id !== existingForId.variation_id) {
          throw buildConflictError("A variacao informada nao corresponde a combinacao de cor e tamanho.", {
            code: "VARIANT_ID_ATTRIBUTE_CONFLICT",
            variation_id: requestedVariationId,
            attribute_key: attributeKey
          });
        }
        const existing = existingForId || existingForKey;
        const attributesChanged = Boolean(existing && existing.attribute_key !== attributeKey);
        const previousAutomaticSku = existing
          ? buildVariantSku(current.product.base_sku, existing.color, existing.size)
          : "";
        const canRefreshAutomaticSku = Boolean(
          attributesChanged
          && !existing.first_sold_at
          && !existing.sku_locked_at
          && normalizeSku(existing.sku) === previousAutomaticSku
        );
        const sku = canRefreshAutomaticSku
          ? buildVariantSku(current.product.base_sku, color, size)
          : existing?.sku
            || normalizeSku(item.sku)
            || buildVariantSku(current.product.base_sku, color, size);
        const barcode = normalizeText(item.barcode || item.gtin_ean || existing?.barcode);
        if (!existing) {
          await assertSkuAvailable(connection, sku);
          await assertBarcodeAvailable(connection, barcode);
        } else {
          if (sku !== normalizeSku(existing.sku)) {
            await assertSkuAvailable(connection, sku, existing.variation_id);
          }
          if (barcode !== normalizeText(existing.barcode)) {
            await assertBarcodeAvailable(connection, barcode, existing.variation_id);
          }
        }
        if (existing) requestedVariantIds.add(existing.variation_id);
        requestedByKey.set(attributeKey, {
          item,
          existing,
          attributesChanged,
          color,
          size,
          attributeKey,
          sku,
          barcode,
          desiredStock: normalizeQuantity(
            item.desired_stock ?? item.initial_stock ?? item.stock ?? item.quantity
            ?? existing?.physical_qty ?? 0
          ),
          variantStatus: normalizeStatus(item.status || existing?.status || status)
        });
      }

      for (const existing of current.variants) {
        if (requestedVariantIds.has(existing.variation_id)) continue;
        if (requestedByKey.has(existing.attribute_key)) continue;
        if (existing.physical_qty > 0) {
          throw buildConflictError(
            `A variacao possui ${existing.physical_qty} unidades. Ajuste o saldo para zero antes de inativa-la.`,
            {
              code: "VARIANT_HAS_STOCK",
              variation_id: existing.variation_id,
              physical_qty: existing.physical_qty
            }
          );
        }
        await run(
          connection,
          "UPDATE pdv_product_variants SET status = 'inativo', updated_at = ? WHERE id = ?",
          [timestamp, existing.variation_id]
        );
        await appendAudit(connection, {
          productId: current.product.id,
          variantId: existing.variation_id,
          actionType: "VARIANT_INACTIVATED",
          actor,
          before: { status: existing.status },
          after: { status: "inativo" }
        });
      }

      for (const requested of requestedByKey.values()) {
        let variantId = requested.existing?.variation_id || "";
        if (!requested.existing) {
          variantId = buildVariantId();
          await run(
            connection,
            `INSERT INTO pdv_product_variants
             (id, product_id, sku, barcode, status, attributes_json, attribute_key,
              is_default, sale_price_cents, cost_price_cents, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
            [
              variantId,
              current.product.id,
              requested.sku,
              requested.barcode || null,
              requested.variantStatus,
              JSON.stringify({ color: requested.color, size: requested.size }),
              requested.attributeKey,
              salePriceCents,
              costPriceCents,
              timestamp,
              timestamp
            ]
          );
          const storeId = normalizeStoreKey(
            requested.item.store_id
            || requestedStoreId
            || ""
          );
          if (!storeId) throw buildValidationError("Selecione a loja da nova variacao.");
          await run(
            connection,
            `INSERT INTO pdv_inventory_balances_v2
             (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
             VALUES (?, ?, 0, 0, 1, ?)`,
            [variantId, storeId, timestamp]
          );
          await appendAudit(connection, {
            productId: current.product.id,
            variantId,
            actionType: "VARIANT_CREATED",
            actor,
            after: { sku: requested.sku, attribute_key: requested.attributeKey }
          });
        } else {
          await run(
            connection,
            `UPDATE pdv_product_variants
             SET sku = ?, barcode = ?, status = ?, attributes_json = ?, attribute_key = ?,
                 sale_price_cents = ?, cost_price_cents = ?, updated_at = ?
             WHERE id = ?`,
            [
              requested.sku,
              requested.barcode || null,
              requested.variantStatus,
              JSON.stringify({ color: requested.color, size: requested.size }),
              requested.attributeKey,
              salePriceCents,
              costPriceCents,
              timestamp,
              variantId
            ]
          );
          if (requested.attributesChanged) {
            await appendAudit(connection, {
              productId: current.product.id,
              variantId,
              actionType: "VARIANT_ATTRIBUTES_CHANGED",
              actor,
              before: {
                color: requested.existing.color,
                size: requested.existing.size,
                attribute_key: requested.existing.attribute_key,
                sku: requested.existing.sku
              },
              after: {
                color: requested.color,
                size: requested.size,
                attribute_key: requested.attributeKey,
                sku: requested.sku
              }
            });
          }
        }

        const storeId = normalizeStoreKey(
          requested.item.store_id
          || requestedStoreId
          || requested.existing?.balances?.[0]?.store_id
          || ""
        );
        if (!storeId) throw buildValidationError("Selecione a loja para ajustar o estoque.");
        let balance = await get(
          connection,
          `SELECT * FROM pdv_inventory_balances_v2
           WHERE variant_id = ? AND store_id = ? COLLATE NOCASE
           LIMIT 1`,
          [variantId, storeId]
        );
        if (!balance) {
          await run(
            connection,
            `INSERT INTO pdv_inventory_balances_v2
             (variant_id, store_id, available_qty, reserved_qty, version, updated_at)
             VALUES (?, ?, 0, 0, 1, ?)`,
            [variantId, storeId, timestamp]
          );
          balance = await get(
            connection,
            `SELECT * FROM pdv_inventory_balances_v2
             WHERE variant_id = ? AND store_id = ? COLLATE NOCASE
             LIMIT 1`,
            [variantId, storeId]
          );
        }
        const beforeQty = roundQty(balance?.available_qty);
        const delta = roundQty(requested.desiredStock - beforeQty);
        if (delta !== 0 || !requested.existing) {
          const movementType = requested.existing ? "MANUAL_ADJUSTMENT" : "INITIAL_STOCK";
          await run(
            connection,
            `UPDATE pdv_inventory_balances_v2
             SET available_qty = ?, version = version + 1, updated_at = ?
             WHERE id = ?`,
            [requested.desiredStock, timestamp, balance.id]
          );
          await run(
            connection,
            `INSERT INTO pdv_inventory_movements_v2
             (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
              quantity_after, origin, reference_type, reference_id, idempotency_key,
              actor_user_id, actor_name, metadata_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'product_edit', 'PRODUCT', ?, ?, ?, ?, ?, ?)`,
            [
              buildMovementId(),
              variantId,
              balance.store_id,
              movementType,
              delta,
              beforeQty,
              requested.desiredStock,
              String(current.product.id),
              `product-edit:${current.product.id}:variant:${variantId}:stock:${timestamp}`,
              actor.id,
              actor.name,
              JSON.stringify({ reason: normalizeText(payload.reason || "Edicao de grade") }),
              timestamp
            ]
          );
        }
      }
    }

    const refreshed = await loadProductAggregate(connection, current.product.id);
    const legacyColor = payload.color === undefined && payload.cor === undefined
      ? null
      : normalizeText(payload.color ?? payload.cor);
    await run(
      connection,
      `UPDATE ai_products
       SET name = ?, commercial_name = ?, color = COALESCE(?, color),
           price = ?, cost_price = ?, status = ?, stock = ?, estoque_total = ?, updated_at = ?
       WHERE id = ?`,
      [
        name,
        normalizeText(payload.commercial_name || name),
        legacyColor,
        salePriceCents / 100,
        costPriceCents === null ? null : costPriceCents / 100,
        status,
        refreshed.totals.physical_qty,
        refreshed.totals.physical_qty,
        timestamp,
        current.product.legacy_ai_product_id
      ]
    );
    await appendAudit(connection, {
      productId: current.product.id,
      actionType: "PRODUCT_UPDATED",
      actor,
      before: {
        name: current.product.name,
        status: current.product.status,
        sale_price_cents: current.product.sale_price_cents
      },
      after: { name, status, sale_price_cents: salePriceCents }
    });
    const aggregate = await loadProductAggregate(connection, current.product.id);
    if (typeof options.projectAggregate === "function") {
      aggregate.operational_projection = await options.projectAggregate(aggregate);
    }
    return aggregate;
  });
}

async function updateSimpleProduct(legacyAiProductId, payload = {}, user = {}, options = {}) {
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
    const aggregate = await loadAggregate(connection, current.id);
    if (typeof options.projectAggregate === "function") {
      aggregate.operational_projection = await options.projectAggregate(aggregate);
    }
    return aggregate;
  });
}

async function applyNormalizedInventoryMovement(payload = {}, user = {}, options = {}) {
  const variantId = normalizeText(payload.variant_id);
  const storeId = normalizeStoreKey(payload.store_id || "");
  const idempotencyKey = normalizeText(payload.idempotency_key);
  const movementType = normalizeText(payload.movement_type).toUpperCase();
  const quantityDelta = Number(payload.quantity_delta);
  if (!variantId || !storeId || !idempotencyKey || !movementType || !Number.isFinite(quantityDelta)) {
    throw new Error("Movimento de estoque normalizado invalido.");
  }
  const actor = buildActor(user);
  const operationFingerprint = buildOperationFingerprint(payload);

  return withTransaction(async (connection) => {
    const existing = await get(
      connection,
      "SELECT * FROM pdv_inventory_movements_v2 WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) {
      const existingMetadata = parseAttributes(existing.metadata_json);
      if (
        existingMetadata.operation_fingerprint
        && existingMetadata.operation_fingerprint !== operationFingerprint
      ) {
        throw buildConflictError("Conflito de idempotencia: a mesma chave foi usada com outro payload.", {
          code: "IDEMPOTENCY_CONFLICT",
          idempotency_key: idempotencyKey
        });
      }
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
    const reservedQty = Number(balance.reserved_qty || 0);
    const afterQty = Math.round((beforeQty + quantityDelta) * 1000) / 1000;
    if (afterQty < 0) throw new Error("Estoque insuficiente para concluir o movimento.");
    if (quantityDelta < 0 && afterQty < reservedQty) {
      throw new Error("Disponibilidade insuficiente para concluir o movimento.");
    }
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
        JSON.stringify({
          ...(payload.metadata || {}),
          operation_fingerprint: operationFingerprint
        }),
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

    let operationalProjection = null;
    if (typeof options.projectAggregate === "function" && product?.id) {
      const aggregate = await loadProductAggregate(connection, product.id);
      operationalProjection = await options.projectAggregate(aggregate);
    }
    return {
      movement: await get(connection, "SELECT * FROM pdv_inventory_movements_v2 WHERE id = ?", [movementId]),
      balance: await get(connection, "SELECT * FROM pdv_inventory_balances_v2 WHERE id = ?", [balance.id]),
      replayed: false,
      operational_projection: operationalProjection
    };
  });
}

async function applyNormalizedReservationOperation(payload = {}, user = {}, operation = "", connectionOverride = null, options = {}) {
  const variationId = normalizeText(payload.variation_id);
  const storeId = normalizeStoreKey(payload.store_id || "");
  const idempotencyKey = normalizeText(payload.idempotency_key);
  const quantity = normalizeQuantity(payload.quantity);
  if (!variationId || !storeId || !idempotencyKey || quantity <= 0) {
    throw buildValidationError("Operacao de reserva normalizada invalida.");
  }
  const actor = buildActor(user);
  const movementType = operation === "HOLD"
    ? "RESERVATION_HOLD"
    : operation === "RELEASE"
      ? "RESERVATION_RELEASE"
      : "SALE_OUT";
  const fingerprint = buildOperationFingerprint({
    movement_type: movementType,
    variant_id: variationId,
    store_id: storeId,
    quantity_delta: operation === "HOLD" ? quantity : -quantity,
    origin: "reservation",
    reference_type: "RESERVATION",
    reference_id: payload.reservation_id
  });

  const execute = async (connection) => {
    const existing = await get(
      connection,
      "SELECT * FROM pdv_inventory_movements_v2 WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) {
      const metadata = parseAttributes(existing.metadata_json);
      if (metadata.operation_fingerprint && metadata.operation_fingerprint !== fingerprint) {
        throw buildConflictError("Conflito de idempotencia: a mesma chave foi usada com outro payload.", {
          code: "IDEMPOTENCY_CONFLICT",
          idempotency_key: idempotencyKey
        });
      }
      const balance = await get(
        connection,
        "SELECT * FROM pdv_inventory_balances_v2 WHERE variant_id = ? AND store_id = ? COLLATE NOCASE",
        [variationId, storeId]
      );
      return { movement: existing, balance: { ...balance, ...serializeBalance(balance) }, replayed: true };
    }

    const context = await get(
      connection,
      `SELECT v.*, p.status AS product_status, b.id AS balance_id,
              b.available_qty, b.reserved_qty, b.version AS balance_version
       FROM pdv_product_variants v
       INNER JOIN pdv_products_v2 p ON p.id = v.product_id
       INNER JOIN pdv_inventory_balances_v2 b
         ON b.variant_id = v.id AND b.store_id = ? COLLATE NOCASE
       WHERE v.id = ?`,
      [storeId, variationId]
    );
    if (!context) throw buildValidationError("Variacao normalizada nao encontrada para a loja.");
    if (operation !== "RELEASE") {
      if (context.product_status !== "ativo") throw buildConflictError("Produto bloqueado para venda.", { code: "PRODUCT_NOT_SELLABLE" });
      if (context.status === "bloqueado_para_venda") throw buildConflictError("Variacao bloqueada.", { code: "VARIANT_BLOCKED" });
      if (context.status === "inativo") throw buildConflictError("Variacao inativa.", { code: "VARIANT_INACTIVE" });
    }
    const physicalBefore = roundQty(context.available_qty);
    const reservedBefore = roundQty(context.reserved_qty);
    const availableBefore = roundQty(physicalBefore - reservedBefore);
    let physicalAfter = physicalBefore;
    let reservedAfter = reservedBefore;
    if (operation === "HOLD") {
      if (availableBefore < quantity) throw buildConflictError("Disponibilidade insuficiente para reservar a variacao.", { code: "INSUFFICIENT_AVAILABLE_STOCK" });
      reservedAfter = roundQty(reservedBefore + quantity);
    } else if (operation === "RELEASE") {
      if (reservedBefore < quantity) throw buildConflictError("Quantidade reservada insuficiente para liberar.", { code: "INSUFFICIENT_RESERVED_STOCK" });
      reservedAfter = roundQty(reservedBefore - quantity);
    } else {
      if (reservedBefore < quantity) throw buildConflictError("Quantidade reservada insuficiente para converter em venda.", { code: "INSUFFICIENT_RESERVED_STOCK" });
      if (physicalBefore < quantity) throw buildConflictError("Estoque fisico insuficiente para converter a reserva.", { code: "INSUFFICIENT_PHYSICAL_STOCK" });
      reservedAfter = roundQty(reservedBefore - quantity);
      physicalAfter = roundQty(physicalBefore - quantity);
    }
    const timestamp = nowIso();
    await run(
      connection,
      `UPDATE pdv_inventory_balances_v2
       SET available_qty = ?, reserved_qty = ?, version = version + 1, updated_at = ?
       WHERE id = ?`,
      [physicalAfter, reservedAfter, timestamp, context.balance_id]
    );
    const movementId = buildMovementId();
    const quantityBefore = operation === "HOLD" || operation === "RELEASE"
      ? reservedBefore
      : physicalBefore;
    const quantityAfter = operation === "HOLD" || operation === "RELEASE"
      ? reservedAfter
      : physicalAfter;
    const quantityDelta = operation === "HOLD"
      ? quantity
      : operation === "RELEASE"
        ? -quantity
        : -quantity;
    await run(
      connection,
      `INSERT INTO pdv_inventory_movements_v2
       (id, variant_id, store_id, movement_type, quantity_delta, quantity_before,
        quantity_after, origin, reference_type, reference_id, idempotency_key,
        actor_user_id, actor_name, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'reservation', 'RESERVATION', ?, ?, ?, ?, ?, ?)`,
      [
        movementId,
        variationId,
        storeId,
        movementType,
        quantityDelta,
        quantityBefore,
        quantityAfter,
        normalizeText(payload.reservation_id),
        idempotencyKey,
        actor.id,
        actor.name,
        JSON.stringify({
          operation_fingerprint: fingerprint,
          sale_id: normalizeText(payload.sale_id),
          physical_before: physicalBefore,
          physical_after: physicalAfter,
          reserved_before: reservedBefore,
          reserved_after: reservedAfter,
          available_before: availableBefore,
          available_after: roundQty(physicalAfter - reservedAfter)
        }),
        timestamp
      ]
    );
    if (operation === "CONVERT") {
      await run(
        connection,
        `UPDATE pdv_product_variants
         SET first_sold_at = COALESCE(first_sold_at, ?),
             sku_locked_at = COALESCE(sku_locked_at, ?),
             updated_at = ?
         WHERE id = ?`,
        [timestamp, timestamp, timestamp, variationId]
      );
    }
    const balance = await get(
      connection,
      "SELECT * FROM pdv_inventory_balances_v2 WHERE id = ?",
      [context.balance_id]
    );
    let operationalProjection = null;
    if (typeof options.projectAggregate === "function") {
      const aggregate = await loadProductAggregate(connection, context.product_id);
      operationalProjection = await options.projectAggregate(aggregate);
    }
    return {
      movement: await get(connection, "SELECT * FROM pdv_inventory_movements_v2 WHERE id = ?", [movementId]),
      balance: { ...balance, ...serializeBalance(balance) },
      replayed: false,
      operational_projection: operationalProjection
    };
  };
  return connectionOverride ? execute(connectionOverride) : withTransaction(execute);
}

function holdNormalizedReservation(payload = {}, user = {}, options = {}) {
  return applyNormalizedReservationOperation(payload, user, "HOLD", null, options);
}

function holdNormalizedReservations(payloads = [], user = {}, options = {}) {
  if (!Array.isArray(payloads) || !payloads.length) {
    throw buildValidationError("Informe ao menos uma variacao para reservar.");
  }
  return withTransaction(async (connection) => {
    const results = [];
    for (const payload of payloads) {
      results.push(await applyNormalizedReservationOperation(payload, user, "HOLD", connection, options));
    }
    return results;
  });
}

function releaseNormalizedReservation(payload = {}, user = {}, options = {}) {
  return applyNormalizedReservationOperation(payload, user, "RELEASE", null, options);
}

function convertNormalizedReservationToSale(payload = {}, user = {}, options = {}) {
  return applyNormalizedReservationOperation(payload, user, "CONVERT", null, options);
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

async function findVariantByIdentifier(identifier, storeId = "") {
  const normalizedIdentifier = normalizeText(identifier);
  if (!normalizedIdentifier) return null;
  const connection = createConnection();
  try {
    const row = await get(
      connection,
      `SELECT v.id, v.product_id, v.sku, v.barcode, v.status, v.attributes_json,
              v.attribute_key, v.is_default, v.sale_price_cents, v.cost_price_cents,
              p.name, p.base_sku, p.status AS product_status,
              p.sale_price_cents AS product_sale_price_cents,
              p.cost_price_cents AS product_cost_price_cents,
              b.store_id, b.available_qty, b.reserved_qty
       FROM pdv_product_variants v
       INNER JOIN pdv_products_v2 p ON p.id = v.product_id
       LEFT JOIN pdv_inventory_balances_v2 b
         ON b.variant_id = v.id
        AND (? = '' OR b.store_id = ? COLLATE NOCASE)
       WHERE v.sku = ? COLLATE NOCASE
          OR v.barcode = ? COLLATE NOCASE
       ORDER BY CASE WHEN b.store_id = ? COLLATE NOCASE THEN 0 ELSE 1 END, b.id
       LIMIT 1`,
      [
        normalizeStoreKey(storeId),
        normalizeStoreKey(storeId),
        normalizedIdentifier,
        normalizedIdentifier,
        normalizeStoreKey(storeId)
      ]
    );
    if (!row) return null;
    const attributes = parseAttributes(row.attributes_json);
    return {
      variation_id: row.id,
      product_id: row.product_id,
      parent_product_id: row.product_id,
      normalized_parent_product_id: row.product_id,
      sku: row.sku,
      barcode: row.barcode || "",
      codigo_barras: row.barcode || "",
      nome: row.name,
      name: row.name,
      color: normalizeText(attributes.color),
      cor: normalizeText(attributes.color),
      size: normalizeText(attributes.size),
      tamanho: normalizeText(attributes.size),
      status: row.status,
      product_status: row.product_status,
      store_id: row.store_id || normalizeStoreKey(storeId),
      preco_venda: (row.sale_price_cents ?? row.product_sale_price_cents ?? 0) / 100,
      ...serializeBalance(row)
    };
  } finally {
    await close(connection);
  }
}

async function getProductAggregateById(productId) {
  const connection = createConnection();
  try {
    return await loadProductAggregate(connection, productId);
  } finally {
    await close(connection);
  }
}

async function updateVariantStatus(variationId, status, user = {}, options = {}) {
  const normalizedStatus = normalizeStatus(status);
  const actor = buildActor(user);
  return withTransaction(async (connection) => {
    const variant = await get(
      connection,
      "SELECT * FROM pdv_product_variants WHERE id = ?",
      [normalizeText(variationId)]
    );
    if (!variant) throw buildValidationError("Variacao normalizada nao encontrada.");
    if (normalizedStatus === "inativo") {
      const balance = await get(
        connection,
        `SELECT COALESCE(SUM(available_qty), 0) AS physical_qty
         FROM pdv_inventory_balances_v2
         WHERE variant_id = ?`,
        [variant.id]
      );
      const physicalQty = roundQty(balance?.physical_qty);
      if (physicalQty > 0) {
        throw buildConflictError(
          `A variacao possui ${physicalQty} unidades. Ajuste o saldo para zero antes de inativa-la.`,
          {
            code: "VARIANT_HAS_STOCK",
            variation_id: variant.id,
            physical_qty: physicalQty
          }
        );
      }
    }
    const timestamp = nowIso();
    await run(
      connection,
      "UPDATE pdv_product_variants SET status = ?, updated_at = ? WHERE id = ?",
      [normalizedStatus, timestamp, variant.id]
    );
    await appendAudit(connection, {
      productId: variant.product_id,
      variantId: variant.id,
      actionType: normalizedStatus === "inativo" ? "VARIANT_INACTIVATED" : "VARIANT_STATUS_CHANGED",
      actor,
      before: { status: variant.status },
      after: { status: normalizedStatus }
    });
    const aggregate = await loadProductAggregate(connection, variant.product_id);
    if (typeof options.projectAggregate === "function") {
      aggregate.operational_projection = await options.projectAggregate(aggregate);
    }
    return aggregate;
  });
}

module.exports = {
  buildVariantSku,
  createProductAggregate,
  createSimpleProduct,
  convertNormalizedReservationToSale,
  findVariantByIdentifier,
  getProductAggregateById,
  holdNormalizedReservation,
  holdNormalizedReservations,
  normalizeVariantColor,
  normalizeVariantSize,
  releaseNormalizedReservation,
  updateProductAggregate,
  updateVariantStatus,
  updateSimpleProduct,
  applyNormalizedInventoryMovement,
  getSimpleProductByLegacyId
};
