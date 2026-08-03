"use strict";

/**
 * appOrderService — Serviço de criação e gerenciamento de pedidos do Shop.
 *
 * Integração real:
 * - fulfillmentService: validação de entrega/retirada (obrigatório)
 * - inventoryService: reserva de estoque no PDV real (obrigatório)
 * - dbApi: persistência em SQLite (app_orders, app_order_items, app_order_events)
 *
 * Fluxo de criação:
 *   1. Validar conta e sessão
 *   2. Validar carrinho (itens disponíveis)
 *   3. Validar fulfillment (entrega ou retirada)
 *   4. Validar estoque PDV real (quantidade disponível por variante+loja)
 *   5. Recalcular subtotal
 *   6. Tentar reservar estoque (holdReservation) — TRANSACAO ATOMICA
 *   7. Se sucesso: criar pedido com status STOCK_RESERVED, atualizar para READY_FOR_PAYMENT
 *   8. Se falha: liberar reservas (releaseReservation), marcar FAILED
 *
 * Regras:
 * - Nenhum pagamento nesta fase (status máximo: READY_FOR_PAYMENT)
 * - fulfillmentService não pode ser null
 * - inventoryService não pode ser null
 * - Idempotência via idempotency_key
 */

const { randomUUID } = require("crypto");
const { orderDto, orderItemDto, orderSummaryDto, reservationDto, eventDto, envelope, formatCentsBrl } = require("./appOrderDto");

class AppOrderError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AppOrderError";
    this.code = code;
    this.status = status || 400;
  }
}

function iso(date) { return date instanceof Date ? date.toISOString() : new Date(date).toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

function createAppOrderService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("APP_ORDER_DB_REQUIRED");
  }

  const fulfillmentService = options.fulfillmentService;
  if (!fulfillmentService || typeof fulfillmentService.validateDelivery !== "function") {
    throw new Error("APP_ORDER_FULFILLMENT_SERVICE_REQUIRED: fulfillmentService deve implementar validateDelivery");
  }

  const inventoryService = options.inventoryService;
  if (!inventoryService || typeof inventoryService.holdReservation !== "function") {
    throw new Error("APP_ORDER_INVENTORY_SERVICE_REQUIRED: inventoryService deve implementar holdReservation");
  }

  const catalogService = options.catalogService || null;
  const recordAudit = options.recordAudit || (async () => null);

  // TTL configurável: inteiro positivo, min 1, max 1440
  const ttlRaw = process.env.ORDER_RESERVATION_TTL_MINUTES;
  const ttlMinutes = ttlRaw ? parseInt(ttlRaw, 10) : 30;
  if (isNaN(ttlMinutes) || ttlMinutes < 1 || ttlMinutes > 1440) {
    throw new Error(`ORDER_RESERVATION_TTL_MINUTES invalid: ${ttlRaw}. Expected integer 1-1440`);
  }

  let orderCounter = 1;

  function audit(action, metadata = {}, entityId = "") {
    return recordAudit({
      module: "app_orders",
      action,
      metadata,
      entity_id: entityId,
    }).catch(() => null);
  }

  function validateAccountId(accountId) {
    if (!accountId || typeof accountId !== "string" || accountId.trim().length < 3) {
      throw new AppOrderError("INVALID_ACCOUNT", 400, "account_id é obrigatório e deve ter pelo menos 3 caracteres");
    }
    return accountId.trim();
  }

  async function validateSession(accountId) {
    const row = await db.get("SELECT id FROM app_customer_accounts WHERE id = ?", [accountId]);
    if (!row) {
      throw new AppOrderError("ACCOUNT_NOT_FOUND", 404, `Conta ${accountId} não encontrada`);
    }
    return row;
  }

  async function validateCart(accountId) {
    // Buscar carrinho ativo do cliente
    const cart = await db.get(
      `SELECT * FROM app_carts WHERE account_id = ? AND status = 'ACTIVE'`,
      [accountId]
    );
    if (!cart) {
      throw new AppOrderError("CART_EMPTY", 400, "Carrinho vazio ou inexistente");
    }
    // Buscar itens do carrinho
    const rows = await db.all(
      `SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL ORDER BY created_at DESC`,
      [cart.id]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppOrderError("CART_EMPTY", 400, "Carrinho vazio ou inexistente");
    }
    // Validar que todos os itens têm status disponível
    const unavailable = rows.filter(r => r.availability_status === "out_of_stock");
    if (unavailable.length > 0) {
      throw new AppOrderError(
        "CART_ITEMS_UNAVAILABLE",
        400,
        `${unavailable.length} itens do carrinho não estão disponíveis`
      );
    }
    return rows;
  }

  async function validateFulfillment(accountId, input) {
    const type = (input.fulfillment_type || "").toUpperCase();
    if (type !== "DELIVERY" && type !== "PICKUP") {
      throw new AppOrderError("INVALID_FULFILLMENT_TYPE", 400, "fulfillment_type deve ser DELIVERY ou PICKUP");
    }

    if (type === "DELIVERY") {
      if (!input.address_id) {
        throw new AppOrderError("ADDRESS_ID_REQUIRED", 400, "address_id é obrigatório para entrega");
      }
      // Verificar que o endereço pertence ao cliente
      const address = await db.get(
        "SELECT id, account_id FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL",
        [input.address_id, accountId]
      );
      if (!address) {
        throw new AppOrderError("ADDRESS_NOT_OWNED", 400, "Endereço não encontrado ou não pertence ao cliente");
      }
      // Validar via fulfillmentService
      try {
        await fulfillmentService.validateDelivery({
          address_id: input.address_id,
          account_id: accountId,
          items: input.items || [],
        });
      } catch (err) {
        throw new AppOrderError("DELIVERY_VALIDATION_FAILED", 400, `Validação de entrega falhou: ${err.message}`);
      }
    }

    if (type === "PICKUP") {
      if (!input.pickup_store_id) {
        throw new AppOrderError("PICKUP_STORE_ID_REQUIRED", 400, "pickup_store_id é obrigatório para retirada");
      }
      // Verificar que a loja existe e está habilitada
      const stores = fulfillmentService.getActiveStores ? fulfillmentService.getActiveStores() : [];
      const store = stores.find(s => s.id === input.pickup_store_id);
      if (!store) {
        throw new AppOrderError("PICKUP_STORE_NOT_FOUND", 400, `Loja ${input.pickup_store_id} não encontrada ou não está habilitada`);
      }
      // Validar via fulfillmentService
      try {
        await fulfillmentService.validatePickup({
          store_id: input.pickup_store_id,
          items: input.items || [],
        });
      } catch (err) {
        throw new AppOrderError("PICKUP_VALIDATION_FAILED", 400, `Validação de retirada falhou: ${err.message}`);
      }
    }

    return type;
  }

  function generateOrderNumber(accountId) {
    orderCounter++;
    const ts = Date.now().toString(36).toUpperCase();
    const seq = String(orderCounter).padStart(4, "0");
    return `ORD-${accountId.slice(0, 4).toUpperCase()}-${ts}-${seq}`;
  }

  async function recalculateCart(accountId, cartId, items) {
    let subtotalCents = 0;
    const orderItems = [];
    const now = iso(new Date());

    for (const cartItem of items) {
      const unitPrice = cartItem.unit_price_cents || cartItem.price_cents || 0;
      const quantity = Math.max(1, Math.floor(cartItem.quantity || 1));
      const lineTotal = unitPrice * quantity;
      subtotalCents += lineTotal;

      orderItems.push({
        id: generateId(),
        order_id: "", // será preenchido após criação do pedido
        product_id: cartItem.product_id,
        variant_id: cartItem.variant_id || cartItem.product_id,
        quantity,
        unit_price_cents: unitPrice,
        promotional_price_cents: cartItem.promotional_price_cents || null,
        effective_unit_price_cents: unitPrice,
        line_total_cents: lineTotal,
        product_snapshot_json: JSON.stringify({
          product_id: cartItem.product_id,
          variant_id: cartItem.variant_id || cartItem.product_id,
          name: cartItem.name || cartItem.product_name || "",
          sku: cartItem.sku || "",
          image_url: cartItem.image_url || "",
        }),
        availability_status: "available",
        version: 1,
        created_at: now,
        updated_at: now,
      });
    }

    return { orderItems, subtotalCents };
  }

  async function recalculateShipping(fulfillmentType, subtotalCents) {
    // Simplificação: frete 0 nesta fase (será integrado depois)
    return {
      shipping_provider: fulfillmentType === "DELIVERY" ? "flat_rate" : null,
      shipping_service_code: fulfillmentType === "DELIVERY" ? "standard" : null,
      shipping_quote_cents: fulfillmentType === "DELIVERY" ? 0 : 0,
      shipping_quote_currency: "BRL",
    };
  }

  /**
   * createOrder — Cria um pedido com reserva real de estoque PDV.
   *
   * Fluxo completo:
   * 1. Validar conta
   * 2. Validar carrinho
   * 3. Validar fulfillment
   * 4. Recalcular itens e subtotal
   * 5. Recalcular frete
   * 6. Verificar idempotência
   * 7. Reserva estoque (holdReservation) — SE FALHAR, ROLLBACK
   * 8. Criar pedido e itens no banco
   * 9. Gravar evento de criação
   * 10. Atualizar status para READY_FOR_PAYMENT
   * 11. Retornar pedido
   */
  async function createOrder(accountId, input = {}) {
    const validatedAccountId = validateAccountId(accountId);
    await validateSession(validatedAccountId);

    // Idempotência
    const idempotencyKey = input.idempotency_key || generateId();

    // Verificar se já existe pedido com esta chave
    const existing = await db.get(
      "SELECT * FROM app_orders WHERE idempotency_key = ?",
      [idempotencyKey]
    );
    if (existing) {
      return envelope(orderDto(existing));
    }

    // Validar carrinho
    const cartItems = await validateCart(validatedAccountId);

    // Validar fulfillment
    const fulfillmentType = await validateFulfillment(validatedAccountId, input);

    // Recalcular itens
    const { orderItems, subtotalCents } = await recalculateCart(validatedAccountId, null, cartItems);

    // Recalcular frete
    const shipping = await recalculateShipping(fulfillmentType, subtotalCents);

    // Determinar store_origin_id
    let storeOriginId;
    if (fulfillmentType === "PICKUP") {
      storeOriginId = input.pickup_store_id;
    } else {
      // Para entrega, usar loja padrão ou loja do item
      storeOriginId = input.store_origin_id || "vila";
    }

    // Gerar orderId antes da reserva (para referência nos movimentos)
    const orderId = generateId();
    const orderNumber = generateOrderNumber(validatedAccountId);

    // Verificar estoque PDV real ANTES de reservar
    const storeId = storeOriginId || "vila";
    const now = iso(new Date());

    try {
      // Reservar estoque no PDV real
      const reservationResult = await inventoryService.holdReservation(
        orderId,
        cartItems.map(item => ({
          variant_id: item.variant_id || item.product_id,
          quantity: item.quantity || 1,
        })),
        storeId,
        idempotencyKey
      );

      // Pedido já tem orderId e orderNumber gerados antes da reserva
      const totalCents = subtotalCents + (shipping.shipping_quote_cents || 0);

      // Preencher order_id nos itens
      for (const item of orderItems) {
        item.order_id = orderId;
      }

      const snapshot = {
        fulfillment_type: fulfillmentType,
        address_id: fulfillmentType === "DELIVERY" ? input.address_id : null,
        pickup_store_id: fulfillmentType === "PICKUP" ? input.pickup_store_id : null,
        store_origin_id: storeOriginId,
        cart_items: cartItems.map(c => ({
          product_id: c.product_id,
          variant_id: c.variant_id || c.product_id,
          quantity: c.quantity || 1,
          name: c.name || c.product_name || "",
          unit_price_cents: c.unit_price_cents || c.price_cents || 0,
        })),
      };

      await db.run(
        `INSERT INTO app_orders
         (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id,
          shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency,
          subtotal_cents, total_cents, status, idempotency_key, snapshot_json,
          reservation_ids_json, version, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          orderNumber,
          validatedAccountId,
          fulfillmentType,
          fulfillmentType === "DELIVERY" ? input.address_id : null,
          fulfillmentType === "PICKUP" ? input.pickup_store_id : null,
          shipping.shipping_provider,
          shipping.shipping_service_code,
          shipping.shipping_quote_cents,
          shipping.shipping_quote_currency,
          subtotalCents,
          totalCents,
          "STOCK_RESERVED",
          idempotencyKey,
          JSON.stringify(snapshot),
          JSON.stringify([reservationResult.reservation_id]),
          1,
          now,
          now,
          iso(new Date(Date.now() + ttlMinutes * 60 * 1000)), // TTL configurável, padrão 30 min
        ]
      );

      // Inserir itens
      for (const item of orderItems) {
        await db.run(
          `INSERT INTO app_order_items
           (id, order_id, product_id, variant_id, quantity, unit_price_cents,
            promotional_price_cents, effective_unit_price_cents, line_total_cents,
            product_snapshot_json, availability_status, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id, item.order_id, item.product_id, item.variant_id,
            item.quantity, item.unit_price_cents, item.promotional_price_cents,
            item.effective_unit_price_cents, item.line_total_cents,
            item.product_snapshot_json, item.availability_status,
            item.version, item.created_at, item.updated_at,
          ]
        );
      }

      // Gravar evento
      const eventId = generateId();
      await db.run(
        `INSERT INTO app_order_events (id, order_id, event_type, details_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [eventId, orderId, "ORDER_CREATED", JSON.stringify({
          fulfillment_type: fulfillmentType,
          store_id: storeId,
          reservation_id: reservationResult.reservation_id,
          items_count: orderItems.length,
        }), now]
      );

      // Atualizar para READY_FOR_PAYMENT
      await db.run(
        `UPDATE app_orders SET status = ?, updated_at = ? WHERE id = ?`,
        ["READY_FOR_PAYMENT", now, orderId]
      );

      // Registrar auditoria
      await audit("order_created", {
        order_id: orderId,
        fulfillment_type: fulfillmentType,
        store_id: storeId,
        items_count: orderItems.length,
        total_cents: totalCents,
      }, orderId);

      const order = await db.get("SELECT * FROM app_orders WHERE id = ?", [orderId]);
      return envelope(orderDto(order));
    } catch (err) {
      // ROLLBACK de reservas de estoque apenas se o hold foi concluído (erro veio depois)
      // Se o erro veio do próprio holdReservation (INSUFFICIENT_STOCK etc.), a transação
      // interna já fez ROLLBACK e nenhum saldo foi alterado — não precisa release.
      const holdFailed = err.code === "INSUFFICIENT_STOCK" ||
                         err.message.includes("INSUFFICIENT_STOCK") ||
                         err.message.includes("STOCK_CONCURRENCY");
      if (!holdFailed) {
        try {
          await inventoryService.releaseReservation(orderId || idempotencyKey, storeId,
            cartItems.map(item => ({
              variant_id: item.variant_id || item.product_id,
              quantity: item.quantity || 1,
            }))
          );
        } catch (releaseErr) {
          console.error("[appOrderService] Falha ao liberar reservas:", releaseErr.message);
        }
      }

      // Criar pedido FAILED se possível
      const failedOrderId = generateId();
      const failedOrderNumber = generateOrderNumber(validatedAccountId);
      try {
        await db.run(
          `INSERT INTO app_orders
           (id, order_number, account_id, fulfillment_type, address_id, pickup_store_id,
            shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency,
            subtotal_cents, total_cents, status, idempotency_key, snapshot_json,
            reservation_ids_json, version, created_at, updated_at, failed_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            failedOrderId, failedOrderNumber, validatedAccountId,
            fulfillmentType,
            fulfillmentType === "DELIVERY" ? input.address_id : null,
            fulfillmentType === "PICKUP" ? input.pickup_store_id : null,
            shipping.shipping_provider, shipping.shipping_service_code,
            shipping.shipping_quote_cents, shipping.shipping_quote_currency,
            subtotalCents, totalCents, "FAILED", idempotencyKey,
            JSON.stringify({ error: err.message }),
            "[]", 1, now, now, err.message,
          ]
        );
      } catch (_) {
        // Se não conseguir criar o pedido FAILED, pelo menos registrar o evento
      }

      await audit("order_failed", { error: err.message, idempotency_key: idempotencyKey }, failedOrderId || "");

      throw new AppOrderError(
        (err.code === "INSUFFICIENT_STOCK" || err.message?.includes("INSUFFICIENT_STOCK")) ? "STOCK_UNAVAILABLE" :
        (err.code === "STOCK_CONCURRENCY_CONFLICT" || err.message?.includes("STOCK_CONCURRENCY_CONFLICT")) ? "STOCK_CONCURRENCY" :
        "ORDER_CREATION_FAILED",
        400,
        `Falha ao criar pedido: ${err.message}`
      );
    }
  }

  async function getOrder(accountId, orderId) {
    const order = await db.get(
      "SELECT * FROM app_orders WHERE id = ? AND account_id = ?",
      [orderId, validateAccountId(accountId)]
    );
    if (!order) {
      throw new AppOrderError("ORDER_NOT_FOUND", 404, `Pedido ${orderId} não encontrado`);
    }
    const items = await db.all("SELECT * FROM app_order_items WHERE order_id = ?", [orderId]);
    const events = await db.all("SELECT * FROM app_order_events WHERE order_id = ?", [orderId]);

    return envelope({
      order: orderDto(order),
      items: items.map(orderItemDto),
      events: events.map(eventDto),
    });
  }

  async function listOrders(accountId) {
    const orders = await db.all(
      "SELECT * FROM app_orders WHERE account_id = ? ORDER BY created_at DESC LIMIT 50",
      [validateAccountId(accountId)]
    );
    return envelope(orders.map(o => orderSummaryDto({
      ...o,
      items_count: 0, // simplificação
    })));
  }

  return {
    createOrder,
    getOrder,
    listOrders,
  };
}

module.exports = { createAppOrderService, AppOrderError };
