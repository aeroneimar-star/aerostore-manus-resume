"use strict";

const { randomUUID } = require("crypto");
const { cartDto, envelope } = require("./appCartDto");

class AppCartError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AppCartError";
    this.code = code;
    this.status = status || 400;
  }
}

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

const MAX_ITEMS_PER_CART = 50;
const MAX_QUANTITY_PER_ITEM = 99;

function createAppCartService(options = {}) {
  const db = options.dbApi;
  if (!db?.all) throw new Error("APP_CART_DB_REQUIRED");
  const catalogService = options.catalogService;
  if (!catalogService) throw new Error("APP_CART_CATALOG_SERVICE_REQUIRED");
  const recordAudit = options.recordAudit || (async () => null);

  function audit(action, metadata = {}, entityId = "") {
    return recordAudit({
      module: "app_cart",
      action,
      entity_type: "cart",
      entity_id: entityId,
      includeBody: false,
      metadata,
      source: "app"
    });
  }

  // Busca dados atualizados do produto via catálogo (usando list com filtro por id)
  async function resolveProduct(productId) {
    const allProducts = await catalogService.loadProductsForRefresh();
    return allProducts.find((p) => p.id === String(productId)) || null;
  }

  async function getActiveCart(accountId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(accountId || ""))) {
      throw new AppCartError("INVALID_ACCOUNT_ID", 400, "Identificador de conta invalido.");
    }
    const cart = await db.get(
      "SELECT * FROM app_carts WHERE account_id = ? AND status = 'ACTIVE'",
      [accountId]
    );
    if (!cart) return null;
    const items = await db.all(
      "SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL ORDER BY created_at ASC",
      [cart.id]
    );
    return { cart, items };
  }

  async function getCart(accountId, cartId) {
    const cart = await db.get(
      "SELECT * FROM app_carts WHERE id = ? AND account_id = ?",
      [cartId, accountId]
    );
    if (!cart) throw new AppCartError("CART_NOT_FOUND", 404, "Carrinho nao encontrado.");
    const items = await db.all(
      "SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL ORDER BY created_at ASC",
      [cart.id]
    );
    return envelope({ cart: cartDto(cart, items) });
  }

  async function getOrRefreshCart(accountId) {
    const existing = await getActiveCart(accountId);
    if (!existing) {
      return { success: true, data: { cart: null, items: [] }, meta: { api_version: "v1" } };
    }
    const { cart, items } = existing;
    if (items.length === 0) {
      return envelope({ cart: cartDto(cart, []), items: [] });
    }

    // Revalidar todos os itens com dados atualizados do catálogo
    const activeItems = [];
    let hasChanges = false;

    for (const item of items) {
      const product = await resolveProduct(item.product_id);
      if (!product) {
        // Produto foi removido do catálogo — marcar como removido
        const currentIso = iso(clock());
        await db.run(
          "UPDATE app_cart_items SET removed_at = ?, availability_status = 'out_of_stock', updated_at = ? WHERE id = ?",
          [currentIso, currentIso, item.id]
        );
        hasChanges = true;
        continue;
      }

      const variant = product.variants.find((v) => v.slug === item.variant_slug);
      const isPromo = product.compare_at_price_cents && product.compare_at_price_cents > product.price_cents;
      const effectivePrice = variant ? (variant.price_cents || product.price_cents) : product.price_cents;
      const unitPrice = isPromo ? product.compare_at_price_cents : effectivePrice;
      const promoPrice = isPromo ? product.price_cents : null;
      const newAvailability = variant ? variant.availability : product.availability;
      const newLineTotal = effectivePrice * item.quantity;
      const snapshot = JSON.stringify({
        title: product.title,
        brand: product.brand,
        category_label: product.category_label,
        color: variant ? variant.color : item.color || "",
        size: variant ? variant.size : item.size || "",
        sku: product.sku,
        primary_image: product.primary_image
      });

      // Verificar se algo mudou
      const priceChanged = item.effective_unit_price_cents !== effectivePrice ||
        Number(item.promotional_price_cents || 0) !== (promoPrice || 0) ||
        item.line_total_cents !== newLineTotal;
      const statusChanged = item.availability_status !== newAvailability;
      const snapshotChanged = item.product_snapshot_json !== snapshot;

      if (priceChanged || statusChanged || snapshotChanged) {
        const currentIso = iso(clock());
        const fields = promoPrice
          ? "unit_price_cents = ?, promotional_price_cents = ?, effective_unit_price_cents = ?, line_total_cents = ?, availability_status = ?, product_snapshot_json = ?, version = version + 1, updated_at = ?"
          : "unit_price_cents = ?, promotional_price_cents = NULL, effective_unit_price_cents = ?, line_total_cents = ?, availability_status = ?, product_snapshot_json = ?, version = version + 1, updated_at = ?";
        const params = promoPrice
          ? [unitPrice, promoPrice, effectivePrice, newLineTotal, newAvailability, snapshot, currentIso, item.id]
          : [unitPrice, effectivePrice, newLineTotal, newAvailability, snapshot, currentIso, item.id];
        await db.run(`UPDATE app_cart_items SET ${fields} WHERE id = ?`, params);
        hasChanges = true;
      }

      activeItems.push({
        ...item,
        unit_price_cents: unitPrice,
        promotional_price_cents: promoPrice,
        effective_unit_price_cents: effectivePrice,
        line_total_cents: newLineTotal,
        availability_status: newAvailability,
        product_snapshot_json: snapshot
      });
    }

    // Recalcular subtotal
    const subtotalCents = activeItems.reduce((sum, item) => sum + item.line_total_cents, 0);

    if (hasChanges) {
      const currentIso = iso(clock());
      await db.run(
        "UPDATE app_carts SET item_count = ?, subtotal_cents = ?, updated_at = ? WHERE id = ?",
        [activeItems.length, subtotalCents, currentIso, cart.id]
      );
    }

    const updatedCart = { ...cart, item_count: activeItems.length, subtotal_cents: subtotalCents };
    return envelope({ cart: cartDto(updatedCart, activeItems), items: activeItems });
  }

  async function addItem(accountId, productId, variantId, quantity = 1) {
    const qty = Number(quantity) || 1;
    if (qty < 1 || qty > MAX_QUANTITY_PER_ITEM) {
      throw new AppCartError("INVALID_QUANTITY", 400, `Quantidade deve estar entre 1 e ${MAX_QUANTITY_PER_ITEM}.`);
    }

    const product = await resolveProduct(productId);
    if (!product) throw new AppCartError("PRODUCT_NOT_FOUND", 404, "Produto nao encontrado no catalogo.");

    const variant = variantId ? product.variants.find((v) => v.slug === String(variantId)) : null;
    if (variantId && !variant) {
      throw new AppCartError("VARIANT_NOT_FOUND", 404, "Variante nao encontrada no produto.");
    }
    if (variant && variant.availability === "out_of_stock") {
      throw new AppCartError("VARIANT_UNAVAILABLE", 400, "Variante indisponivel no momento.");
    }

    const isPromo = product.compare_at_price_cents && product.compare_at_price_cents > product.price_cents;
    const effectivePrice = variant ? (variant.price_cents || product.price_cents) : product.price_cents;
    const unitPrice = isPromo ? product.compare_at_price_cents : effectivePrice;
    const promoPrice = isPromo ? product.price_cents : null;

    // Buscar ou criar carrinho ativo
    let cart = await db.get("SELECT * FROM app_carts WHERE account_id = ? AND status = 'ACTIVE'", [accountId]);
    if (!cart) {
      const currentIso = iso(clock());
      cart = {
        id: generateId(),
        account_id: accountId,
        status: "ACTIVE",
        currency: "BRL",
        item_count: 0,
        subtotal_cents: 0,
        version: 1,
        created_at: currentIso,
        updated_at: currentIso
      };
      await db.run(
        "INSERT INTO app_carts (id, account_id, status, currency, item_count, subtotal_cents, version, created_at, updated_at) VALUES (?, ?, 'ACTIVE', 'BRL', 0, 0, 1, ?, ?)",
        [cart.id, cart.account_id, cart.created_at, cart.updated_at]
      );
    }

    const currentIso = iso(clock());
    const variantSlug = variant ? variant.slug : `${product.slug}-default`;
    const itemVariantId = variantId || `${product.id}-default`;
    const snapshot = JSON.stringify({
      title: product.title,
      brand: product.brand,
      category_label: product.category_label,
      color: variant ? variant.color : "",
      size: variant ? variant.size : "",
      sku: product.sku,
      primary_image: product.primary_image
    });
    const availability = variant ? variant.availability : product.availability;

    // Verificar se já existe item com mesma variante
    const existing = await db.get(
      "SELECT * FROM app_cart_items WHERE cart_id = ? AND variant_id = ? AND removed_at IS NULL",
      [cart.id, itemVariantId]
    );

    if (existing) {
      const newQty = Math.min(Number(existing.quantity) + qty, MAX_QUANTITY_PER_ITEM);
      const newLineTotal = effectivePrice * newQty;
      const fields = promoPrice
        ? "quantity = ?, unit_price_cents = ?, promotional_price_cents = ?, effective_unit_price_cents = ?, line_total_cents = ?, product_snapshot_json = ?, version = version + 1, updated_at = ?"
        : "quantity = ?, unit_price_cents = ?, promotional_price_cents = NULL, effective_unit_price_cents = ?, line_total_cents = ?, product_snapshot_json = ?, version = version + 1, updated_at = ?";
      const params = promoPrice
        ? [newQty, unitPrice, promoPrice, effectivePrice, newLineTotal, snapshot, currentIso, existing.id]
        : [newQty, unitPrice, effectivePrice, newLineTotal, snapshot, currentIso, existing.id];
      await db.run(`UPDATE app_cart_items SET ${fields} WHERE id = ?`, params);

      // Recalcular carrinho
      const allItems = await db.all("SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL", [cart.id]);
      const newSubtotal = allItems.reduce((sum, item) => sum + item.line_total_cents, 0);
      await db.run("UPDATE app_carts SET item_count = ?, subtotal_cents = ?, updated_at = ? WHERE id = ?", [allItems.length, newSubtotal, currentIso, cart.id]);

      await audit("ADD_ITEM", { quantity: newQty, product_id: productId }, cart.id);
      return envelope({ cart: cartDto({ ...cart, item_count: allItems.length, subtotal_cents: newSubtotal }, allItems) });
    }

    // Adicionar novo item
    const itemId = generateId();
    const fields = promoPrice
      ? "(id, cart_id, product_id, variant_id, variant_slug, quantity, unit_price_cents, promotional_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)"
      : "(id, cart_id, product_id, variant_id, variant_slug, quantity, unit_price_cents, effective_unit_price_cents, line_total_cents, product_snapshot_json, availability_status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)";
    const params = promoPrice
      ? [itemId, cart.id, product.id, itemVariantId, variantSlug, qty, unitPrice, promoPrice, effectivePrice, effectivePrice * qty, snapshot, availability, currentIso, currentIso]
      : [itemId, cart.id, product.id, itemVariantId, variantSlug, qty, unitPrice, effectivePrice, effectivePrice * qty, snapshot, availability, currentIso, currentIso];
    await db.run(`INSERT INTO app_cart_items ${fields}`, params);

    // Recalcular carrinho
    const allItems = await db.all("SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL", [cart.id]);
    const newSubtotal = allItems.reduce((sum, item) => sum + item.line_total_cents, 0);
    await db.run("UPDATE app_carts SET item_count = ?, subtotal_cents = ?, updated_at = ? WHERE id = ?", [allItems.length, newSubtotal, currentIso, cart.id]);

    await audit("ADD_ITEM", { quantity: qty, product_id: productId }, cart.id);
    return envelope({ cart: cartDto({ ...cart, item_count: allItems.length, subtotal_cents: newSubtotal }, allItems) });
  }

  async function updateItemQuantity(accountId, cartId, itemId, quantity) {
    const qty = Number(quantity) || 1;
    if (qty < 1 || qty > MAX_QUANTITY_PER_ITEM) {
      throw new AppCartError("INVALID_QUANTITY", 400, `Quantidade deve estar entre 1 e ${MAX_QUANTITY_PER_ITEM}.`);
    }

    const item = await db.get(
      "SELECT i.*, c.account_id FROM app_cart_items i JOIN app_carts c ON c.id = i.cart_id WHERE i.id = ? AND c.account_id = ? AND i.removed_at IS NULL",
      [itemId, accountId]
    );
    if (!item) throw new AppCartError("CART_ITEM_NOT_FOUND", 404, "Item nao encontrado no carrinho.");

    const currentIso = iso(clock());
    const newLineTotal = item.effective_unit_price_cents * qty;
    await db.run(
      "UPDATE app_cart_items SET quantity = ?, line_total_cents = ?, version = version + 1, updated_at = ? WHERE id = ?",
      [qty, newLineTotal, currentIso, itemId]
    );

    // Recalcular carrinho
    const items = await db.all("SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL", [item.cart_id]);
    const newSubtotal = items.reduce((sum, item) => sum + item.line_total_cents, 0);
    await db.run("UPDATE app_carts SET item_count = ?, subtotal_cents = ?, updated_at = ? WHERE id = ?", [items.length, newSubtotal, currentIso, item.cart_id]);

    await audit("UPDATE_ITEM", { quantity: qty, item_id: itemId }, cartId);
    const updatedCart = await db.get("SELECT * FROM app_carts WHERE id = ?", [item.cart_id]);
    return envelope({ cart: cartDto(updatedCart, items) });
  }

  async function removeItem(accountId, cartId, itemId) {
    const item = await db.get(
      "SELECT i.*, c.account_id FROM app_cart_items i JOIN app_carts c ON c.id = i.cart_id WHERE i.id = ? AND c.account_id = ? AND i.removed_at IS NULL",
      [itemId, accountId]
    );
    if (!item) throw new AppCartError("CART_ITEM_NOT_FOUND", 404, "Item nao encontrado no carrinho.");

    const currentIso = iso(clock());
    await db.run("UPDATE app_cart_items SET removed_at = ?, updated_at = ? WHERE id = ?", [currentIso, currentIso, itemId]);

    const items = await db.all("SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL", [item.cart_id]);
    const newSubtotal = items.reduce((sum, item) => sum + item.line_total_cents, 0);
    await db.run("UPDATE app_carts SET item_count = ?, subtotal_cents = ?, updated_at = ? WHERE id = ?", [items.length, newSubtotal, currentIso, item.cart_id]);

    await audit("REMOVE_ITEM", { item_id: itemId }, cartId);
    const updatedCart = await db.get("SELECT * FROM app_carts WHERE id = ?", [item.cart_id]);
    return envelope({ cart: cartDto(updatedCart, items) });
  }

  async function clearCart(accountId, cartId) {
    const cart = await db.get("SELECT * FROM app_carts WHERE id = ? AND account_id = ? AND status = 'ACTIVE'", [cartId, accountId]);
    if (!cart) throw new AppCartError("CART_NOT_FOUND", 404, "Carrinho nao encontrado.");

    const currentIso = iso(clock());
    await db.run("UPDATE app_cart_items SET removed_at = ?, updated_at = ? WHERE cart_id = ? AND removed_at IS NULL", [currentIso, currentIso, cart.id]);
    await db.run("UPDATE app_carts SET item_count = 0, subtotal_cents = 0, updated_at = ? WHERE id = ?", [currentIso, cart.id]);

    await audit("CLEAR_CART", {}, cart.id);
    const emptyCart = { ...cart, item_count: 0, subtotal_cents: 0, updated_at: currentIso };
    return envelope({ cart: cartDto(emptyCart, []) });
  }

  async function closeCart(accountId, cartId) {
    const cart = await db.get("SELECT * FROM app_carts WHERE id = ? AND account_id = ? AND status = 'ACTIVE'", [cartId, accountId]);
    if (!cart) throw new AppCartError("CART_NOT_FOUND", 404, "Carrinho nao encontrado.");

    const currentIso = iso(clock());
    await db.run("UPDATE app_carts SET status = 'CLOSED', closed_at = ?, updated_at = ? WHERE id = ?", [currentIso, currentIso, cart.id]);

    await audit("CLOSE_CART", {}, cart.id);
    return envelope({ cart: cartDto({ ...cart, status: "CLOSED", closed_at: currentIso, updated_at: currentIso }, []) });
  }

  return {
    getActiveCart,
    getCart,
    getOrRefreshCart,
    addItem,
    updateItemQuantity,
    removeItem,
    clearCart,
    closeCart,
    limits: { maxItemsPerCart: MAX_ITEMS_PER_CART, maxQuantityPerItem: MAX_QUANTITY_PER_ITEM }
  };
}

module.exports = { AppCartError, createAppCartService };
