"use strict";

const { randomUUID } = require("crypto");
const {
  orderDto, orderItemDto, orderSummaryDto, reservationDto, eventDto,
  formatCentsBrl, envelope, AppOrderError
} = require("./appOrderDto");

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

const RESERVATION_TTL_MS = 30 * 60 * 1000; // 30 minutos
const RESERVATION_TTL_SECONDS = 30 * 60;

function createAppOrderService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("APP_ORDER_DB_REQUIRED");
  }
  const catalogService = options.catalogService;
  const fulfillmentService = options.fulfillmentService;
  const recordAudit = options.recordAudit || (async () => null);

  function audit(action, metadata = {}, entityId = "") {
    return recordAudit({
      module: "app_orders",
      action,
      entity_type: "order",
      entity_id: entityId,
      includeBody: false,
      metadata,
      source: "app"
    });
  }

  function validateAccountId(accountId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(accountId || ""))) {
      throw new AppOrderError("INVALID_ACCOUNT_ID", 400, "Identificador de conta invalido.");
    }
  }

  async function validateSession(accountId) {
    const account = await db.get(`SELECT * FROM app_customer_accounts WHERE id = ?`, [accountId]);
    if (!account) throw new AppOrderError("ACCOUNT_NOT_FOUND", 404, "Conta nao encontrada.");
    if (account.access_status !== "APPROVED") {
      throw new AppOrderError("ACCESS_NOT_APPROVED", 403, "Acesso nao aprovado.");
    }
    if (account.account_status !== "ACTIVE") {
      throw new AppOrderError("ACCOUNT_INACTIVE", 403, "Conta inativa.");
    }
    return account;
  }

  async function validateCart(accountId) {
    const cart = await db.get(`SELECT * FROM app_carts WHERE account_id = ? AND status = 'ACTIVE'`, [accountId]);
    if (!cart) throw new AppOrderError("NO_ACTIVE_CART", 400, "Nenhum carrinho ativo encontrado.");

    const items = await db.all(`SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL`, [cart.id]);
    if (items.length === 0) throw new AppOrderError("CART_EMPTY", 400, "Carrinho vazio.");

    return { cart, items };
  }

  async function validateFulfillment(accountId) {
    const fulfillment = await db.get(
      `SELECT * FROM app_cart_fulfillment WHERE account_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [accountId]
    );
    if (!fulfillment) throw new AppOrderError("NO_FULFILLMENT", 400, "Modalidade de entrega nao selecionada.");

    if (fulfillment.fulfillment_type === "DELIVERY") {
      if (!fulfillment.address_id) {
        throw new AppOrderError("ADDRESS_REQUIRED", 400, "Endereco de entrega obrigatorio.");
      }
      const addr = await db.get(`SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL`, [fulfillment.address_id, accountId]);
      if (!addr) throw new AppOrderError("ADDRESS_NOT_FOUND", 404, "Endereco de entrega nao encontrado.");
    }

    if (fulfillment.fulfillment_type === "PICKUP") {
      if (!fulfillment.pickup_store_id) {
        throw new AppOrderError("PICKUP_STORE_REQUIRED", 400, "Loja de retirada obrigatoria.");
      }
    }

    return fulfillment;
  }

  async function recalculateCart(accountId, cartId, items) {
    // Recalcular precos com base no catalogo atual
    const recalculatedItems = [];
    let newSubtotalCents = 0;

    for (const item of items) {
      let effectivePriceCents = Number(item.unit_price_cents);
      let promotionName = null;

      if (catalogService) {
        try {
          const all = await catalogService.loadProductsForRefresh();
          const product = all.find(p => p.id === String(item.product_id));
          if (product) {
            if (product.promotion_active && product.promotion_price_cents) {
              effectivePriceCents = Number(product.promotion_price_cents);
              promotionName = product.promotion_name || "Promocao ativa";
            }
            // Usar nome atual do catalogo
            const productName = product.name || item.product_name || "Produto";
            const variantName = item.variant_name || "";
            recalculatedItems.push({
              ...item,
              product_name: productName,
              effective_unit_price_cents: effectivePriceCents,
              promotion_name: promotionName,
              line_total_cents: effectivePriceCents * Number(item.quantity)
            });
            newSubtotalCents += effectivePriceCents * Number(item.quantity);
            continue;
          }
        } catch {
          // Usar dados do carrinho se catalogo falhar
        }
      }

      // Extrair nome do snapshot se não houver product_name
      let snapName = item.product_name || "";
      let snapVariant = item.variant_name || "";
      if (!snapName && item.product_snapshot_json) {
        try {
          const snap = JSON.parse(item.product_snapshot_json);
          snapName = snap.name || "";
          snapVariant = snap.variant || "";
        } catch {}
      }
      recalculatedItems.push({
        ...item,
        product_name: snapName || "Produto",
        variant_name: snapVariant || "",
        effective_unit_price_cents: effectivePriceCents,
        promotion_name: promotionName,
        line_total_cents: effectivePriceCents * Number(item.quantity)
      });
      newSubtotalCents += effectivePriceCents * Number(item.quantity);
    }

    return { items: recalculatedItems, subtotalCents: newSubtotalCents };
  }

  async function recalculateShipping(fulfillment, subtotalCents) {
    let shippingQuoteCents = 0;
    let shippingServiceCode = "";
    let shippingProvider = "";

    if (fulfillment.fulfillment_type === "PICKUP") {
      // Retirada = frete gratis
      shippingQuoteCents = 0;
      shippingServiceCode = "pickup";
      shippingProvider = "pickup";
    } else if (fulfillment.shipping_quote_cents) {
      // Manter cotação existente
      shippingQuoteCents = Number(fulfillment.shipping_quote_cents);
      shippingServiceCode = fulfillment.shipping_service_code || "";
      shippingProvider = fulfillment.shipping_provider || "";
    }

    return { shippingQuoteCents, shippingServiceCode, shippingProvider };
  }

  async function validateStock(items) {
    // Verificar disponibilidade de cada item
    for (const item of items) {
      const availability = String(item.availability_status || "").toUpperCase();
      if (availability === "OUT_OF_STOCK") {
        throw new AppOrderError("STOCK_INSUFFICIENT", 400,
          `Produto ${item.product_name} (variacao ${item.variant_name}) sem estoque.`);
      }
      if (availability === "LOW_STOCK" && Number(item.quantity) > 1) {
        throw new AppOrderError("STOCK_INSUFFICIENT", 400,
          `Produto ${item.product_name} (variacao ${item.variant_name}) com estoque baixo.`);
      }
    }
    return true;
  }

  function generateOrderNumber(accountId) {
    const now = clock();
    const year = now.getUTCFullYear();
    const seq = now.getTime() % 1000000000;
    const padded = String(seq).padStart(9, "0");
    return `AERO-${year}-${padded}`;
  }

  async function createReservations(orderId, items, expiresAt) {
    const reservations = [];
    for (const item of items) {
      const resId = generateId();
      const now = iso(clock());
      await db.run(
        `INSERT INTO app_stock_reservations (id, order_id, product_id, variant_id, quantity, status, reserved_at, expires_at, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, 1, ?, ?)`,
        [resId, orderId, item.product_id, item.variant_id, Number(item.quantity), now, expiresAt, now, now]
      );
      reservations.push({
        id: resId,
        orderId,
        productId: item.product_id,
        variantId: item.variant_id,
        quantity: Number(item.quantity),
        status: "ACTIVE",
        reservedAt: now,
        expiresAt
      });
    }
    return reservations;
  }

  async function releaseReservations(orderId) {
    const reservations = await db.all(
      `SELECT * FROM app_stock_reservations WHERE order_id = ? AND status = 'ACTIVE'`,
      [orderId]
    );
    const now = iso(clock());
    for (const r of reservations) {
      await db.run(
        `UPDATE app_stock_reservations SET status = 'RELEASED', released_at = ?, version = version + 1, updated_at = ? WHERE id = ?`,
        [now, now, r.id]
      );
    }
    return reservations.length;
  }

  async function expireReservations(orderId) {
    const now = iso(clock());
    await db.run(
      `UPDATE app_stock_reservations SET status = 'EXPIRED', released_at = ?, version = version + 1, updated_at = ? WHERE order_id = ? AND status = 'ACTIVE'`,
      [now, now, orderId]
    );
  }

  async function recordEvent(orderId, eventType, details = null) {
    const eventId = generateId();
    const now = iso(clock());
    await db.run(
      `INSERT INTO app_order_events (id, order_id, event_type, details_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      [eventId, orderId, eventType, details ? JSON.stringify(details) : null, now]
    );
    return eventId;
  }

  async function createOrder(accountId, input = {}) {
    validateAccountId(accountId);

    // 1-3. Validar sessão, conta, acesso
    await validateSession(accountId);

    // 4. Validar carrinho
    const { cart, items } = await validateCart(accountId);

    // 5. Validar endereço ou retirada
    const fulfillment = await validateFulfillment(accountId);

    // 6-11. Recalcular preços, promoções, disponibilidade, frete, estoque, regras
    const recalc = await recalculateCart(accountId, cart.id, items);
    const shipping = await recalculateShipping(fulfillment, recalc.subtotalCents);
    await validateStock(recalc.items);

    const totalCents = recalc.subtotalCents + shipping.shippingQuoteCents;

    // 12. Idempotência
    if (input.idempotencyKey) {
      const existingOrder = await db.get(
        `SELECT * FROM app_orders WHERE account_id = ? AND idempotency_key = ?`,
        [accountId, input.idempotencyKey]
      );
      if (existingOrder) {
        const orderItems = await db.all(`SELECT * FROM app_order_items WHERE order_id = ?`, [existingOrder.id]);
        return envelope({
          order: orderDto(existingOrder),
          items: orderItems.map(orderItemDto),
          duplicate: true,
          message: "Pedido ja existente para esta chave de idempotencia."
        });
      }
    }

    const now = iso(clock());
    const orderId = generateId();
    const orderNumber = generateOrderNumber(accountId);
    const expiresAt = iso(new Date(Date.now() + RESERVATION_TTL_MS));

    // Snapshot imutável
    const snapshot = {
      orderId,
      orderNumber,
      accountId,
      cartId: cart.id,
      fulfillmentType: fulfillment.fulfillment_type,
      addressId: fulfillment.address_id || null,
      pickupStoreId: fulfillment.pickup_store_id || null,
      items: recalc.items.map(i => ({
        productId: i.product_id,
        variantId: i.variant_id,
        productName: i.product_name,
        variantName: i.variant_name,
        quantity: Number(i.quantity),
        unitPriceCents: Number(i.unit_price_cents),
        effectiveUnitPriceCents: Number(i.effective_unit_price_cents),
        promotionName: i.promotion_name || null,
        lineTotalCents: Number(i.line_total_cents),
        availabilityStatus: i.availability_status || "UNKNOWN"
      })),
      shipping: {
        provider: shipping.shippingProvider,
        serviceCode: shipping.shippingServiceCode,
        quoteCents: shipping.shippingQuoteCents,
        currency: "BRL"
      },
      subtotalCents: recalc.subtotalCents,
      totalCents,
      createdAt: now
    };

    try {
      // 13-16. Reserva de estoque + criar pedido + número sequencial + auditoria
      await db.run(
        `INSERT INTO app_orders (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, subtotal_cents, total_cents, status, idempotency_key, snapshot_json, version, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AWAITING_PAYMENT', ?, ?, 1, ?, ?, ?)`,
        [orderId, orderNumber, accountId, fulfillment.fulfillment_type,
         fulfillment.address_id || null, fulfillment.pickup_store_id || null,
         shipping.shippingProvider, shipping.shippingServiceCode,
         shipping.shippingQuoteCents, "BRL", recalc.subtotalCents, totalCents,
         input.idempotencyKey || null, JSON.stringify(snapshot),
         now, now, expiresAt]
      );

      // Inserir itens do pedido
      for (const item of recalc.items) {
        const itemId = generateId();
        await db.run(
          `INSERT INTO app_order_items (id, order_id, product_id, variant_id, product_name, variant_name, quantity, unit_price_cents, effective_unit_price_cents, promotion_name, line_total_cents, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [itemId, orderId, item.product_id, item.variant_id, item.product_name,
           item.variant_name, Number(item.quantity), Number(item.unit_price_cents),
           Number(item.effective_unit_price_cents), item.promotion_name || null,
           Number(item.line_total_cents), now, now]
        );
      }

      // Reserva de estoque
      const reservations = await createReservations(orderId, recalc.items, expiresAt);

      // Eventos de auditoria
      await recordEvent(orderId, "ORDER_CREATED", { orderNumber });
      await recordEvent(orderId, "STOCK_RESERVED", { items: recalc.items.length });

      // Marcar carrinho como finalizado
      await db.run(`UPDATE app_carts SET status = 'CONVERTED', updated_at = ? WHERE id = ?`, [now, cart.id]);

      // Auditar
      await audit("ORDER_CREATED", {
        orderNumber,
        fulfillmentType: fulfillment.fulfillment_type,
        totalCents,
        itemCount: recalc.items.length
      }, orderId);

      const orderItems = await db.all(`SELECT * FROM app_order_items WHERE order_id = ?`, [orderId]);

      return envelope({
        order: orderDto({ ...await db.get(`SELECT * FROM app_orders WHERE id = ?`, [orderId]), ...{} }),
        items: orderItems.map(orderItemDto),
        duplicate: false,
        message: "Pedido criado com sucesso."
      });

    } catch (err) {
      // Rollback completo
      await db.run(`DELETE FROM app_order_items WHERE order_id = ?`, [orderId]);
      await db.run(`DELETE FROM app_orders WHERE id = ?`, [orderId]);
      await db.run(`DELETE FROM app_order_events WHERE order_id = ?`, [orderId]);
      await releaseReservations(orderId);
      await audit("ORDER_ROLLBACK", { error: err.message }, orderId);
      
      throw new AppOrderError("ORDER_CREATION_FAILED", 500, "Falha ao criar pedido. Tentando novamente. Original: " + err.message);
    }
  }

  async function getOrder(accountId, orderId) {
    validateAccountId(accountId);
    const order = await db.get(
      `SELECT * FROM app_orders WHERE id = ? AND account_id = ?`,
      [orderId, accountId]
    );
    if (!order) throw new AppOrderError("ORDER_NOT_FOUND", 404, "Pedido nao encontrado.");

    const items = await db.all(`SELECT * FROM app_order_items WHERE order_id = ?`, [orderId]);
    const reservations = await db.all(`SELECT * FROM app_stock_reservations WHERE order_id = ?`, [orderId]);
    const events = await db.all(`SELECT * FROM app_order_events WHERE order_id = ? ORDER BY created_at DESC`, [orderId]);

    return envelope({
      order: orderDto(order),
      items: items.map(orderItemDto),
      reservations: reservations.map(reservationDto),
      events: events.map(eventDto)
    });
  }

  async function listOrders(accountId) {
    validateAccountId(accountId);
    const orders = await db.all(
      `SELECT * FROM app_orders WHERE account_id = ? ORDER BY created_at DESC`,
      [accountId]
    );
    return envelope({
      orders: orders.map(orderDto),
      count: orders.length
    });
  }

  async function expireOrder(accountId, orderId) {
    validateAccountId(accountId);
    const order = await db.get(
      `SELECT * FROM app_orders WHERE id = ? AND account_id = ? AND status = 'AWAITING_PAYMENT'`,
      [orderId, accountId]
    );
    if (!order) throw new AppOrderError("ORDER_NOT_EXPIRABLE", 400, "Pedido nao pode ser expirado.");

    const now = iso(clock());
    await db.run(
      `UPDATE app_orders SET status = 'EXPIRED', version = version + 1, updated_at = ? WHERE id = ?`,
      [now, orderId]
    );
    await expireReservations(orderId);
    await recordEvent(orderId, "ORDER_EXPIRED", { reason: "timeout" });
    await audit("ORDER_EXPIRED", { orderNumber: order.order_number }, orderId);

    return envelope({ expired: true, orderNumber: order.order_number });
  }

  async function releaseOrder(accountId, orderId) {
    validateAccountId(accountId);
    const order = await db.get(
      `SELECT * FROM app_orders WHERE id = ? AND account_id = ?`,
      [orderId, accountId]
    );
    if (!order) throw new AppOrderError("ORDER_NOT_FOUND", 404, "Pedido nao encontrado.");

    if (order.status === "AWAITING_PAYMENT") {
      const now = iso(clock());
      await db.run(
        `UPDATE app_orders SET status = 'CANCELLED', version = version + 1, updated_at = ? WHERE id = ?`,
        [now, orderId]
      );
    }

    await releaseReservations(orderId);
    await recordEvent(orderId, "ORDER_RELEASED", { previousStatus: order.status });
    await audit("ORDER_RELEASED", { orderNumber: order.order_number }, orderId);

    return envelope({ released: true, orderNumber: order.order_number });
  }

  return {
    createOrder,
    getOrder,
    listOrders,
    expireOrder,
    releaseOrder,
    validateSession,
    validateCart,
    validateFulfillment,
    generateOrderNumber
  };
}

module.exports = { createAppOrderService, AppOrderError };
