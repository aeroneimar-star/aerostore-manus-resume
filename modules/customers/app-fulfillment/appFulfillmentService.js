"use strict";

const { randomUUID } = require("crypto");
const { fulfillmentDto, storeSummaryDto, deliverySummaryDto, formatCentsBrl, envelope } = require("./appFulfillmentDto");

class AppFulfillmentError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "AppFulfillmentError";
    this.code = code;
    this.status = status || 400;
  }
}

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }
function generateId() { return randomUUID(); }

// Lojas operacionais (reutilizando padrao do PDV)
const ACTIVE_STORES = [
  { id: "vila", name: "Vila", city: "Ribeirao Preto", state: "SP", address: "R. Saldanha Marinho, 807 — Centro", openingHours: "Seg-Sab 10h-20h, Dom 12h-18h" },
  { id: "botanico", name: "Botanico", city: "Ribeirao Preto", state: "SP", address: "R. Jose Bonifacio, 1100 — Jardim Botanico", openingHours: "Seg-Sab 10h-20h, Dom 12h-18h" },
  { id: "sul", name: "Sul", city: "Camboriu", state: "SC", address: "Av. Nereu Ramos, 2384 — Centro", openingHours: "Seg-Sab 10h-20h, Dom 12h-18h" }
];

const STORES_BY_ID = ACTIVE_STORES.reduce((acc, s) => { acc[s.id] = s; return acc; }, {});

function getActiveStores() {
  return ACTIVE_STORES.map(s => ({ ...s }));
}

function createAppFulfillmentService(options = {}) {
  const db = options.dbApi;
  if (!db || ["run", "get", "all"].some((name) => typeof db[name] !== "function")) {
    throw new Error("APP_FULFILLMENT_DB_REQUIRED");
  }
  const catalogService = options.catalogService;
  const recordAudit = options.recordAudit || (async () => null);
  const shippingProvider = options.shippingProvider || null;
  const catalogServiceResolve = catalogService ? (async (productId) => {
    try {
      const all = await catalogService.loadProductsForRefresh();
      return all.find(p => p.id === String(productId)) || null;
    } catch { return null; }
  }) : null;

  function audit(action, metadata = {}, entityId = "") {
    return recordAudit({
      module: "app_fulfillment",
      action,
      entity_type: "fulfillment",
      entity_id: entityId,
      includeBody: false,
      metadata,
      source: "app"
    });
  }

  async function getActiveCart(accountId) {
    const cart = await db.get("SELECT * FROM app_carts WHERE account_id = ? AND status = 'ACTIVE'", [accountId]);
    if (!cart) return null;
    const items = await db.all("SELECT * FROM app_cart_items WHERE cart_id = ? AND removed_at IS NULL", [cart.id]);
    return { cart, items };
  }

  async function getFulfillmentOptions(accountId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(accountId || ""))) {
      throw new AppFulfillmentError("INVALID_ACCOUNT_ID", 400, "Identificador de conta invalido.");
    }

    const existing = await db.get("SELECT * FROM app_cart_fulfillment WHERE account_id = ? ORDER BY updated_at DESC LIMIT 1", [accountId]);
    const current = existing ? fulfillmentDto(existing) : null;

    const stores = getActiveStores().map(s => storeSummaryDto(s));

    // Enderecos ativos
    const addresses = await db.all("SELECT * FROM app_customer_addresses WHERE account_id = ? AND archived_at IS NULL ORDER BY is_default DESC", [accountId]);

    return envelope({
      currentFulfillment: current,
      availableFulfillmentTypes: ["PICKUP", "DELIVERY"],
      pickupStores: stores,
      availableAddresses: addresses.map(addr => ({
        id: addr.id,
        label: addr.label || "",
        recipientName: addr.recipient_name || "",
        postalCode: addr.postal_code_masked || "",
        street: addr.street || "",
        number: addr.number || "",
        neighborhood: addr.neighborhood || "",
        city: addr.city || "",
        state: addr.state || "",
        isDefault: Boolean(addr.is_default)
      }))
    });
  }

  async function setFulfillment(accountId, input = {}) {
    const cart = await getActiveCart(accountId);
    if (!cart) throw new AppFulfillmentError("NO_ACTIVE_CART", 400, "Nenhum carrinho ativo encontrado.");

    const type = String(input.fulfillment_type || "").toUpperCase();
    if (!["PICKUP", "DELIVERY"].includes(type)) {
      throw new AppFulfillmentError("INVALID_FULFILLMENT_TYPE", 400, "Modalidade deve ser PICKUP ou DELIVERY.");
    }

    // Validar dados por modalidade
    if (type === "PICKUP") {
      if (!input.pickup_store_id || !STORES_BY_ID[input.pickup_store_id]) {
        throw new AppFulfillmentError("INVALID_PICKUP_STORE", 400, "Loja de retirada invalida ou indisponivel.");
      }
    } else {
      // DELIVERY
      if (!input.address_id) {
        throw new AppFulfillmentError("ADDRESS_REQUIRED", 400, "Endereco de entrega obrigatorio para modalidade de entrega.");
      }
      const addr = await db.get("SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL", [input.address_id, accountId]);
      if (!addr) throw new AppFulfillmentError("ADDRESS_NOT_FOUND", 404, "Endereco de entrega nao encontrado.");
    }

    const currentIso = iso(clock());
    const existing = await db.get("SELECT * FROM app_cart_fulfillment WHERE cart_id = ? AND account_id = ?", [cart.cart.id, accountId]);

    let id, payload;
    if (existing) {
      // Atualizar
      const expectedVersion = Number(input.expectedVersion || existing.version);
      if (expectedVersion !== Number(existing.version)) {
        throw new AppFulfillmentError("FULFILLMENT_VERSION_CONFLICT", 409, "Opcao de entrega foi modificada. Recarregue e tente novamente.");
      }

      const updates = [
        "fulfillment_type = ?",
        "pickup_store_id = ?",
        "address_id = ?",
        "shipping_provider = ?",
        "shipping_service_code = ?",
        "shipping_quote_cents = ?",
        "shipping_status = ?",
        "version = version + 1",
        "updated_at = ?"
      ];
      const params = [
        type,
        type === "PICKUP" ? input.pickup_store_id : null,
        type === "DELIVERY" ? input.address_id : null,
        type === "DELIVERY" ? (input.shipping_provider || "") : "",
        type === "DELIVERY" ? (input.shipping_service_code || "") : "",
        type === "DELIVERY" ? Number(input.shipping_quote_cents || 0) : 0,
        type === "DELIVERY" ? (input.shipping_quote_cents ? "CALCULATED" : "PENDING") : "PENDING",
        currentIso
      ];

      await db.run(`UPDATE app_cart_fulfillment SET ${updates.join(", ")} WHERE id = ? AND account_id = ? AND version = ?`, [...params, existing.id, accountId, expectedVersion]);
      payload = fulfillmentDto(await db.get("SELECT * FROM app_cart_fulfillment WHERE id = ?", [existing.id]));
    } else {
      // Criar
      id = generateId();
      await db.run(
        `INSERT INTO app_cart_fulfillment (id, cart_id, account_id, fulfillment_type, address_id, pickup_store_id, shipping_provider, shipping_service_code, shipping_quote_cents, shipping_quote_currency, shipping_quote_expires_at, shipping_status, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BRL', NULL, ?, 1, ?, ?)`,
        [id, cart.cart.id, accountId, type,
          type === "DELIVERY" ? input.address_id : null,
          type === "PICKUP" ? input.pickup_store_id : null,
          type === "DELIVERY" ? (input.shipping_provider || "") : "",
          type === "DELIVERY" ? (input.shipping_service_code || "") : "",
          type === "DELIVERY" ? Number(input.shipping_quote_cents || 0) : 0,
          type === "DELIVERY" ? (input.shipping_quote_cents ? "CALCULATED" : "PENDING") : "PENDING",
          currentIso, currentIso]
      );
      payload = fulfillmentDto(await db.get("SELECT * FROM app_cart_fulfillment WHERE id = ?", [id]));
    }

    await audit("FULFILLMENT_SET", {
      fulfillment_type: type,
      cart_id: cart.cart.id,
      pickup_store_id: type === "PICKUP" ? input.pickup_store_id : null,
      address_id: type === "DELIVERY" ? input.address_id : null
    }, payload.id);

    return envelope(payload);
  }

  async function requestShippingQuote(accountId) {
    const cart = await getActiveCart(accountId);
    if (!cart) throw new AppFulfillmentError("NO_ACTIVE_CART", 400, "Nenhum carrinho ativo encontrado.");

    const fulfillment = await db.get("SELECT * FROM app_cart_fulfillment WHERE cart_id = ? AND account_id = ? AND shipping_status NOT IN ('EXPIRED','FAILED') ORDER BY updated_at DESC LIMIT 1", [cart.cart.id, accountId]);
    if (!fulfillment || fulfillment.fulfillment_type !== "DELIVERY") {
      throw new AppFulfillmentError("FULFILLMENT_NOT_DELIVERY", 400, "Cotação de frete requer modalidade de entrega selecionada.");
    }
    if (!fulfillment.address_id) {
      throw new AppFulfillmentError("ADDRESS_REQUIRED_FOR_QUOTE", 400, "Endereco de entrega obrigatorio para cotacao de frete.");
    }

    const address = await db.get("SELECT * FROM app_customer_addresses WHERE id = ? AND account_id = ? AND archived_at IS NULL", [fulfillment.address_id, accountId]);
    if (!address) throw new AppFulfillmentError("ADDRESS_NOT_FOUND", 404, "Endereco de entrega nao encontrado.");

    // Buscar produtos do carrinho para peso/dimensoes
    if (!catalogServiceResolve) {
      throw new AppFulfillmentError("CATALOG_UNAVAILABLE", 503, "Servico de catalogo indisponivel para cotação.");
    }

    const items = cart.items.map(item => ({
      productId: item.product_id,
      quantity: Number(item.quantity)
    }));

    // Resolver produtos e montar payload de frete
    const productData = [];
    for (const item of items) {
      const product = await catalogServiceResolve(item.productId);
      if (!product) continue;
      productData.push({
        productId: item.productId,
        weight: product.weight_kg || 0.5,
        width: product.width_cm || 30,
        height: product.height_cm || 5,
        length: product.length_cm || 40,
        declaredValue: item.effective_unit_price_cents || 0,
        quantity: item.quantity
      });
    }

    if (productData.length === 0) {
      throw new AppFulfillmentError("SHIPPING_DATA_INCOMPLETE", 400, "Nao foi possivel obter dados logisticos dos produtos.");
    }

    const originPostalCode = fulfillment.pickup_store_id === "sul" ? "88301300" : "14010030"; // Ribeirao Preto ou Camboriu

    let quote;
    if (shippingProvider) {
      try {
        quote = await shippingProvider.quote({
          originPostalCode,
          destinationPostalCode: address.postal_code_protected,
          items: productData
        });
      } catch (error) {
        if (error.code === "SHIPPING_PROVIDER_UNCONFIGURED" || error.code === "SHIPPING_PROVIDER_UNAVAILABLE") {
          // Fallback: usar mock
          const MockShippingProvider = require("./shippingQuoteProvider").MockShippingProvider;
          const fallback = new MockShippingProvider({});
          quote = await fallback.quote({ originPostalCode, destinationPostalCode: address.postal_code_protected, items: productData });
        } else {
          throw new AppFulfillmentError("SHIPPING_QUOTE_FAILED", 502, "Falha ao obter cotação de frete.");
        }
      }
    } else {
      // Sem provider configurado: usar mock
      const MockShippingProvider = require("./shippingQuoteProvider").MockShippingProvider;
      const fallback = new MockShippingProvider({});
      quote = await fallback.quote({ originPostalCode, destinationPostalCode: address.postal_code_protected, items: productData });
    }

    // Atualizar fulfillment com cotacao
    const currentIso = iso(clock());
    await db.run(
      "UPDATE app_cart_fulfillment SET shipping_provider = ?, shipping_service_code = ?, shipping_quote_cents = ?, shipping_status = 'CALCULATED', shipping_quote_expires_at = ?, version = version + 1, updated_at = ? WHERE id = ?",
      [quote.provider, quote.serviceCode, quote.priceCents, quote.expiresAt, currentIso, fulfillment.id]
    );

    await audit("SHIPPING_QUOTE_REQUESTED", {
      cart_id: cart.cart.id,
      provider: quote.provider,
      price_cents: quote.priceCents,
      postal_code: address.postal_code_masked
    }, fulfillment.id);

    return envelope({
      shippingQuote: {
        provider: quote.provider,
        serviceCode: quote.serviceCode,
        serviceName: quote.serviceName,
        priceCents: quote.priceCents,
        priceFormatted: formatCentsBrl(quote.priceCents),
        estimatedMinDays: quote.estimatedMinDays,
        estimatedMaxDays: quote.estimatedMaxDays,
        expiresAt: quote.expiresAt,
        warnings: quote.warnings || []
      }
    });
  }

  async function getDeliverySummary(accountId) {
    if (!/^[a-f0-9-]{36}$/i.test(String(accountId || ""))) {
      throw new AppFulfillmentError("INVALID_ACCOUNT_ID", 400, "Identificador de conta invalido.");
    }

    const cart = await getActiveCart(accountId);
    if (!cart) {
      return envelope({
        fulfillmentType: null,
        addressSummary: null,
        pickupStoreSummary: null,
        shippingMethod: null,
        shippingPriceCents: 0,
        shippingPriceFormatted: "R$ 0,00",
        estimatedDelivery: null,
        cartSubtotalCents: 0,
        cartSubtotalFormatted: "R$ 0,00",
        estimatedTotalCents: 0,
        estimatedTotalFormatted: "R$ 0,00",
        blockingIssues: ["Nenhum carrinho ativo."],
        canContinueToCheckoutFuture: false,
        updatedAt: null
      });
    }

    const fulfillment = await db.get("SELECT * FROM app_cart_fulfillment WHERE cart_id = ? AND account_id = ? AND shipping_status NOT IN ('EXPIRED','FAILED') ORDER BY updated_at DESC LIMIT 1", [cart.cart.id, accountId]);
    const currentIso = iso(clock());

    const blockingIssues = [];
    let addressSummary = null;
    let pickupStoreSummary = null;
    let shippingMethod = null;
    let shippingPriceCents = 0;
    let estimatedDelivery = null;

    if (fulfillment) {
      const f = fulfillmentDto(fulfillment);

      if (f.fulfillmentType === "PICKUP") {
        const store = STORES_BY_ID[f.pickupStoreId];
        if (store) {
          pickupStoreSummary = storeSummaryDto(store);
        } else {
          blockingIssues.push("Loja de retirada indisponivel.");
        }
      } else if (f.fulfillmentType === "DELIVERY") {
        if (!f.addressId) {
          blockingIssues.push("Endereco de entrega nao selecionado.");
        } else {
          const addr = await db.get("SELECT * FROM app_customer_addresses WHERE id = ? AND archived_at IS NULL", [f.addressId]);
          if (addr) {
            addressSummary = {
              label: addr.label || "",
              recipientName: addr.recipient_name || "",
              postalCode: addr.postal_code_masked || "",
              street: `${addr.street || ""}, ${addr.number || ""}`,
              complement: addr.complement || "",
              neighborhood: addr.neighborhood || "",
              city: addr.city || "",
              state: addr.state || ""
            };
          } else {
            blockingIssues.push("Endereco de entrega arquivado ou removido.");
          }
        }

        if (f.shippingStatus === "CALCULATED" || f.shippingStatus === "CONFIRMED") {
          shippingMethod = `${f.shippingProvider || "padrao"} — ${f.shippingServiceCode || "padrao"}`;
          shippingPriceCents = f.shippingQuoteCents;
          // Verificar se cotacao expirou
          if (f.shippingQuoteExpiresAt && new Date(f.shippingQuoteExpiresAt) <= new Date()) {
            blockingIssues.push("Cotação de frete expirada. Solicite nova cotacao.");
          } else if (f.estimatedMinDays) {
            const minDate = new Date(currentIso);
            minDate.setDate(minDate.getDate() + f.estimatedMinDays);
            const maxDate = new Date(currentIso);
            maxDate.setDate(maxDate.getDate() + f.estimatedMaxDays);
            estimatedDelivery = {
              minDays: f.estimatedMinDays,
              maxDays: f.estimatedMaxDays,
              minFormatted: minDate.toLocaleDateString("pt-BR"),
              maxFormatted: maxDate.toLocaleDateString("pt-BR")
            };
          }
        } else {
          shippingMethod = null;
          shippingPriceCents = 0;
        }
      }
    } else {
      blockingIssues.push("Modalidade de entrega nao selecionada.");
    }

    if (cart.items.length === 0) {
      blockingIssues.push("Carrinho vazio.");
    }

    const cartSubtotalCents = cart.cart.subtotal_cents || 0;
    const estimatedTotalCents = cartSubtotalCents + shippingPriceCents;
    const canContinue = blockingIssues.length === 0 && fulfillment && cart.items.length > 0;

    return envelope(deliverySummaryDto({
      fulfillmentType: fulfillment ? fulfillmentDto(fulfillment).fulfillmentType : null,
      addressSummary,
      pickupStoreSummary,
      shippingMethod,
      shippingPriceCents,
      estimatedDelivery,
      cartSubtotalCents,
      estimatedTotalCents,
      blockingIssues,
      canContinueToCheckoutFuture: canContinue,
      updatedAt: currentIso
    }));
  }

  return {
    getFulfillmentOptions,
    setFulfillment,
    requestShippingQuote,
    getDeliverySummary,
    getActiveStores,
    getActiveCart
  };
}

module.exports = { AppFulfillmentError, createAppFulfillmentService };
