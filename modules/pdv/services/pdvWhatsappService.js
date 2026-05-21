"use strict";

const { get, all, run } = require("../../../db");
const {
  getSessionById,
  searchProductsDetailed,
  searchCustomersDetailed,
  buildCustomerBehaviorSnapshot
} = require("./pdvOperationalService");
const {
  getCustomerCashbackBalance,
  getSaleById,
  buildSalePaymentLinkPayload,
  markSalePaymentLinkSent
} = require("../sales/pdvSalesService");
const { formatStoreLabel, normalizeStoreKey } = require("../utils/pdvStoreUtils");
const { toPublicUrl } = require("../utils/pdvPublicUrl");
const { getStorePublicContext } = require("../../../services/storeSettingsService");

const IMPLEMENTED_TYPES = ["sale_summary", "payment_pending", "product_offer", "cashback_available"];
const PREPARED_TYPES = [
  "post_sale",
  "product_recommendation",
  "stock_confirmation",
  "stock_transfer",
  "customer_reactivation",
  "birthday_message",
  "manual_ai_message"
];
const DUPLICATE_WINDOW_SECONDS = 60;

function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value = "") {
  const digits = normalizeDigits(value);
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length > 11) {
    return digits.slice(2);
  }
  return digits;
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value) {
  return Number(toNumber(value).toFixed(2));
}

function formatCurrencyBR(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(toNumber(value));
}

function formatDateBR(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatPaymentMethodLabel(method = "") {
  const normalized = normalizeText(method).toLowerCase();
  const labels = {
    dinheiro: "Dinheiro",
    pix: "Pix",
    debito: "Debito",
    credito: "Credito",
    credito_ate_10x: "Credito",
    cashback: "Cashback",
    credito_troca: "Credito troca",
    vale_presente: "Vale presente",
    permuta: "Permuta",
    link_pagamento: "Link de pagamento"
  };
  return labels[normalized] || normalizeText(method || "-");
}

function isUnsafeLocalUrl(url = "") {
  const raw = normalizeText(url || "");
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const hostname = normalizeText(parsed.hostname || "").toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch (error) {
    return false;
  }
}

function getFirstName(name = "") {
  const cleaned = normalizeText(name || "");
  if (!cleaned) return "cliente";
  return cleaned.split(" ")[0] || "cliente";
}

function buildCustomerLookupKey(customer = {}) {
  const contactId = Number(customer.contactId || customer.contact_id || 0);
  if (contactId > 0) return `contact_${contactId}`;
  const crmContactId = Number(customer.crmContactId || customer.crm_contact_id || 0);
  if (crmContactId > 0) return `crm_${crmContactId}`;
  const legacyId = Number(customer.legacyContactId || customer.legacy_contact_id || 0);
  if (legacyId > 0) return `legacy_${legacyId}`;
  const masterId = normalizeText(customer.master_customer_id || customer.masterCustomerId || "");
  if (masterId) return masterId;
  const phone = normalizePhone(customer.phone || customer.whatsapp || "");
  if (phone) return `phone_${phone}`;
  const document = normalizeDigits(customer.document || customer.cpf || "");
  if (document) return `document_${document}`;
  const name = normalizeText(customer.name || "");
  return name ? `name_${name.toLowerCase()}` : "";
}

function sanitizeCommercialHint(notes = "") {
  const text = normalizeText(notes);
  if (!text) return "";
  if (text.length <= 80) return text;
  return `${text.slice(0, 77)}...`;
}

function maskSensitiveWhatsappContext(context = {}) {
  return {
    type: context.type || "",
    origin: context.origin || "",
    timestamp: context.timestamp || "",
    customer: context.customer ? {
      id: context.customer.id || "",
      name: context.customer.name || "",
      whatsapp: context.customer.whatsapp || ""
    } : null,
    seller: context.seller ? {
      id: context.seller.id || "",
      name: context.seller.name || ""
    } : null,
    store: context.store ? {
      id: context.store.id || "",
      name: context.store.name || ""
    } : null,
    sale: context.sale ? {
      id: context.sale.id || "",
      total: context.sale.total || 0,
      status: context.sale.status || ""
    } : null,
    cart: context.cart ? {
      items: Array.isArray(context.cart.items)
        ? context.cart.items.map((item) => ({
          name: item.name || "",
          quantity: item.quantity || 0,
          total: item.total || 0
        }))
        : [],
      total: context.cart.total || 0
    } : null,
    cashback: context.cashback ? {
      available: context.cashback.available || 0,
      pending: context.cashback.pending || 0,
      expired: context.cashback.expired || 0
    } : null,
    product: context.product ? {
      id: context.product.id || "",
      name: context.product.name || "",
      price: context.product.price || 0,
      sku: context.product.sku || "",
      codigo_etiqueta: context.product.codigo_etiqueta || "",
      ean: context.product.ean || "",
      brand: context.product.brand || "",
      category: context.product.category || "",
      size: context.product.size || "",
      color: context.product.color || "",
      status: context.product.status || ""
    } : null,
    observation: context.observation || ""
  };
}

function buildSellerContext(user = {}, fallbackName = "") {
  return {
    id: Number(user.id || 0) || null,
    name: normalizeText(user.name || user.email || fallbackName || "Equipe AEROSTORE"),
    role: normalizeText(user.role || "")
  };
}

function buildStoreContext(rawStore = "", fallback = "") {
  const storeContext = getStorePublicContext(rawStore || fallback || "", {
    store_id: normalizeStoreKey(rawStore || fallback || ""),
    display_name: formatStoreLabel(rawStore || fallback || "LOJA_GERAL")
  });
  const normalized = normalizeStoreKey(storeContext.store_id || rawStore || fallback || "");
  return {
    id: normalized || normalizeStoreKey(fallback || ""),
    name: storeContext.display_name || formatStoreLabel(normalized || fallback || "LOJA_GERAL"),
    publicContext: storeContext
  };
}

function buildCartSummary(session = {}) {
  const items = Array.isArray(session.cart_items)
    ? session.cart_items.map((item) => {
      const quantity = Math.max(1, Math.round(toNumber(item.quantidade || 1)));
      const unitPrice = roundMoney(item.preco_referencia || 0);
      return {
        id: normalizeText(item.item_id || item.product_id || item.sku || item.codigo || ""),
        name: normalizeText(item.nome || item.sku || item.codigo || "Produto"),
        quantity,
        unitPrice,
        total: roundMoney(unitPrice * quantity),
        color: normalizeText(item.cor || ""),
        size: normalizeText(item.tamanho || "")
      };
    })
    : [];
  return {
    items,
    total: roundMoney(items.reduce((sum, item) => sum + toNumber(item.total), 0))
  };
}

function buildSaleCartSummary(sale = {}) {
  const items = Array.isArray(sale.items)
    ? sale.items.map((item) => {
      const quantity = Math.max(1, Math.round(toNumber(item.quantidade || 1)));
      const unitPrice = roundMoney(item.preco_referencia || item.preco_venda || 0);
      return {
        id: normalizeText(item.item_id || item.product_id || item.sku || item.codigo || ""),
        name: normalizeText(item.nome || "Produto"),
        quantity,
        unitPrice,
        total: roundMoney(unitPrice * quantity),
        color: normalizeText(item.cor || ""),
        size: normalizeText(item.tamanho || "")
      };
    })
    : [];
  return {
    items,
    total: roundMoney(sale.total_final || sale.total || items.reduce((sum, item) => sum + toNumber(item.total), 0))
  };
}

function buildSaleCustomerContext(sale = {}) {
  const rawCustomer = sale?.customer || {};
  const phone = normalizePhone(rawCustomer.phone || rawCustomer.whatsapp || "");
  const name = normalizeText(rawCustomer.name || "");
  if (!name && !phone) {
    return null;
  }
  return {
    lookupKey: buildCustomerLookupKey(rawCustomer),
    id: normalizeText(rawCustomer.master_customer_id || rawCustomer.customer_id || rawCustomer.id || "") || null,
    contactId: Number(rawCustomer.contactId || rawCustomer.contact_id || 0) || null,
    crmContactId: Number(rawCustomer.crmContactId || rawCustomer.crm_contact_id || 0) || null,
    masterCustomerId: normalizeText(rawCustomer.master_customer_id || ""),
    name,
    phone,
    whatsapp: phone,
    email: normalizeText(rawCustomer.email || ""),
    city: normalizeText(rawCustomer.city || ""),
    state: normalizeText(rawCustomer.state || ""),
    topSize: normalizeText(rawCustomer.top_size || ""),
    bottomSize: normalizeText(rawCustomer.bottom_size || ""),
    shoeSize: normalizeText(rawCustomer.shoe_size || ""),
    commercialHint: "",
    availableCashback: roundMoney(getCustomerCashbackBalance(phone || "")),
    pendingCashback: 0,
    expiredCashback: 0,
    favoriteStore: normalizeText(rawCustomer.loja_favorita || sale.loja || ""),
    favoriteSeller: normalizeText(rawCustomer.vendedor_favorito || sale.vendedor || ""),
    behavior: {}
  };
}

function buildSalePaymentSummary(sale = {}, session = null) {
  const source = Array.isArray(sale?.pagamentos)
    ? sale.pagamentos
    : Array.isArray(session?.payment_plan?.methods)
      ? session.payment_plan.methods
      : [];
  return source
    .filter((item) => toNumber(item?.amount) > 0)
    .map((item) => ({
      method: normalizeText(item.method || ""),
      label: formatPaymentMethodLabel(item.method || ""),
      amount: roundMoney(item.amount || 0)
    }));
}

async function resolveCustomerContext(payload = {}) {
  const contactId = Number(payload.contactId || payload.contact_id || payload.customer?.contactId || payload.customer?.contact_id || 0);
  if (contactId > 0) {
    const contact = await get(
      `SELECT id, name, phone, document, email, city, state, top_size, bottom_size, shoe_size, notes, status, seller_name, store
       FROM contacts
       WHERE id = ?
       LIMIT 1`,
      [contactId]
    );
    if (contact) {
      const behavior = await buildCustomerBehaviorSnapshot({
        name: contact.name,
        phone: contact.phone,
        document: contact.document,
        top_size: contact.top_size,
        bottom_size: contact.bottom_size,
        shoe_size: contact.shoe_size
      });
      return {
        lookupKey: buildCustomerLookupKey({ contactId }),
        id: contact.id,
        contactId: contact.id,
        crmContactId: null,
        masterCustomerId: "",
        name: normalizeText(contact.name || ""),
        phone: normalizePhone(contact.phone || ""),
        whatsapp: normalizePhone(contact.phone || ""),
        email: normalizeText(contact.email || ""),
        city: normalizeText(contact.city || ""),
        state: normalizeText(contact.state || ""),
        topSize: normalizeText(contact.top_size || ""),
        bottomSize: normalizeText(contact.bottom_size || ""),
        shoeSize: normalizeText(contact.shoe_size || ""),
        commercialHint: sanitizeCommercialHint(contact.notes || ""),
        availableCashback: roundMoney(getCustomerCashbackBalance(contact.phone || "")),
        pendingCashback: roundMoney(behavior?.cashback_pendente || 0),
        expiredCashback: roundMoney(behavior?.cashback_expirando || 0),
        favoriteStore: normalizeText(behavior?.loja_favorita || contact.store || ""),
        favoriteSeller: normalizeText(behavior?.vendedor_favorito || contact.seller_name || ""),
        behavior
      };
    }
  }

  const rawCustomer = payload.customer || {};
  const explicitName = normalizeText(rawCustomer.name || payload.customerName || payload.name || "");
  const explicitPhone = normalizePhone(rawCustomer.phone || rawCustomer.whatsapp || payload.phone || payload.whatsapp || "");
  const explicitDocument = normalizeDigits(rawCustomer.document || rawCustomer.cpf || payload.document || payload.cpf || "");
  const explicitMasterId = normalizeText(rawCustomer.master_customer_id || payload.master_customer_id || "");
  const lookupCandidates = [
    explicitMasterId,
    explicitPhone,
    explicitDocument,
    explicitName
  ].filter(Boolean);

  for (const candidate of lookupCandidates) {
    const search = await searchCustomersDetailed(candidate, { limit: 10 });
    const rows = Array.isArray(search?.unified) ? search.unified : [];
    const exactMatch = rows.find((item) => {
      const phone = normalizePhone(item.phone || "");
      const document = normalizeDigits(item.document || "");
      const masterId = normalizeText(item.master_customer_id || "");
      return candidate === phone || candidate === document || candidate === masterId || normalizeText(item.name || "").toLowerCase() === candidate.toLowerCase();
    });
    const canUseApproximateByName = !explicitMasterId && !explicitPhone && !explicitDocument && candidate === explicitName;
    const match = exactMatch || (canUseApproximateByName ? rows[0] : null);
    if (match) {
      const behavior = await buildCustomerBehaviorSnapshot(match);
      return {
        lookupKey: buildCustomerLookupKey({
          contactId: match.legacy_contact_id,
          crmContactId: match.crm_contact_id,
          master_customer_id: match.master_customer_id,
          phone: match.phone,
          document: match.document,
          name: match.name
        }),
        id: normalizeText(match.master_customer_id || "") || Number(match.crm_contact_id || match.legacy_contact_id || 0) || null,
        contactId: Number(match.legacy_contact_id || 0) || null,
        crmContactId: Number(match.crm_contact_id || 0) || null,
        masterCustomerId: normalizeText(match.master_customer_id || ""),
        name: normalizeText(match.name || ""),
        phone: normalizePhone(match.phone || ""),
        whatsapp: normalizePhone(match.phone || ""),
        email: normalizeText(match.email || ""),
        city: normalizeText(match.city || ""),
        state: normalizeText(match.state || ""),
        topSize: normalizeText(match.top_size || ""),
        bottomSize: normalizeText(match.bottom_size || ""),
        shoeSize: normalizeText(match.shoe_size || ""),
        commercialHint: sanitizeCommercialHint(match.notes || ""),
        availableCashback: roundMoney(getCustomerCashbackBalance(match.phone || "")),
        pendingCashback: roundMoney(behavior?.cashback_pendente || 0),
        expiredCashback: roundMoney(behavior?.cashback_expirando || 0),
        favoriteStore: normalizeText(behavior?.loja_favorita || ""),
        favoriteSeller: normalizeText(behavior?.vendedor_favorito || ""),
        behavior
      };
    }
  }

  if (explicitName || explicitPhone) {
    return {
      lookupKey: buildCustomerLookupKey(rawCustomer),
      id: explicitMasterId || null,
      contactId: contactId || null,
      crmContactId: Number(rawCustomer.crmContactId || rawCustomer.crm_contact_id || 0) || null,
      masterCustomerId: explicitMasterId,
      name: explicitName,
      phone: explicitPhone,
      whatsapp: explicitPhone,
      email: normalizeText(rawCustomer.email || ""),
      city: normalizeText(rawCustomer.city || ""),
      state: normalizeText(rawCustomer.state || ""),
      topSize: normalizeText(rawCustomer.topSize || rawCustomer.top_size || ""),
      bottomSize: normalizeText(rawCustomer.bottomSize || rawCustomer.bottom_size || ""),
      shoeSize: normalizeText(rawCustomer.shoeSize || rawCustomer.shoe_size || ""),
      commercialHint: "",
      availableCashback: roundMoney(getCustomerCashbackBalance(explicitPhone || "")),
      pendingCashback: 0,
      expiredCashback: 0,
      favoriteStore: "",
      favoriteSeller: "",
      behavior: {}
    };
  }

  return null;
}

function productMatchesLookup(product = {}, payload = {}) {
  const matches = [
    ["product_id", normalizeText(product.product_id || product.id || ""), normalizeText(payload.product_id || payload.productId || payload.id || "")],
    ["sku", normalizeText(product.sku || ""), normalizeText(payload.sku || "")],
    ["codigo", normalizeText(product.codigo || ""), normalizeText(payload.codigo || "")],
    ["codigo_tiny", normalizeText(product.codigo_tiny || ""), normalizeText(payload.codigo_tiny || payload.codigoTiny || "")],
    ["codigo_etiqueta", normalizeText(product.codigo_etiqueta || ""), normalizeText(payload.codigo_etiqueta || payload.codigoEtiqueta || "")],
    ["ean", normalizeDigits(product.ean || product.codigo_barras || ""), normalizeDigits(payload.ean || payload.codigo_barras || payload.codigoBarras || "")],
    ["codigo_interno", normalizeText(product.codigo_interno || ""), normalizeText(payload.codigo_interno || payload.codigoInterno || "")]
  ];
  return matches.some(([, left, right]) => left && right && left === right);
}

async function resolveProductContext(payload = {}, { storeId = "" } = {}) {
  const raw = payload.product || payload || {};
  const candidates = [
    normalizeText(raw.product_id || raw.id || ""),
    normalizeText(raw.sku || ""),
    normalizeText(raw.codigo_tiny || raw.codigoTiny || ""),
    normalizeText(raw.codigo_etiqueta || raw.codigoEtiqueta || ""),
    normalizeDigits(raw.ean || raw.codigo_barras || raw.codigoBarras || ""),
    normalizeText(raw.codigo_interno || raw.codigoInterno || ""),
    normalizeText(raw.codigo || ""),
    normalizeText(raw.nome || raw.name || "")
  ].filter(Boolean);
  for (const candidate of candidates) {
    const search = await searchProductsDetailed(candidate, { storeId, limit: 10 });
    const rows = Array.isArray(search?.unified) ? search.unified : [];
    const match = rows.find((item) => productMatchesLookup(item, raw))
      || rows.find((item) => normalizeText(item.nome || "").toLowerCase() === normalizeText(raw.nome || raw.name || "").toLowerCase())
      || rows[0];
    if (match) {
      return {
        id: normalizeText(match.product_id || match.id || ""),
        name: normalizeText(match.nome || match.name || ""),
        price: roundMoney(match.preco_venda || match.price || 0),
        sku: normalizeText(match.sku || ""),
        codigo: normalizeText(match.codigo || ""),
        codigo_tiny: normalizeText(match.codigo_tiny || ""),
        codigo_etiqueta: normalizeText(match.codigo_etiqueta || ""),
        ean: normalizeDigits(match.ean || match.codigo_barras || ""),
        codigo_interno: normalizeText(match.codigo_interno || ""),
        brand: normalizeText(match.marca || ""),
        category: normalizeText(match.categoria || ""),
        size: normalizeText(match.tamanho || ""),
        color: normalizeText(match.cor || ""),
        status: normalizeText(match.status || match.normalizedStatus || ""),
        availabilityLabel: normalizeText(match.availability_label || ""),
        availableQty: toNumber(match.available_qty ?? match.estoque ?? 0),
        storeId: normalizeStoreKey(match.store_id || storeId || ""),
        origin: normalizeText(match.origin_label || match.origin || "")
      };
    }
  }
  return null;
}

async function buildPdvWhatsappContext(payload = {}, user = {}, requestContext = {}) {
  const type = normalizeText(payload.type || "").toLowerCase();
  if (!IMPLEMENTED_TYPES.includes(type) && !PREPARED_TYPES.includes(type)) {
    throw new Error("Tipo de mensagem não permitido no PDV.");
  }

  const origin = normalizeText(payload.origin || payload.route || "pdv");
  const timestamp = new Date().toISOString();
  const req = requestContext?.req || null;

  if (type === "sale_summary" || type === "payment_pending") {
    const sessionId = normalizeText(payload.sessionId || payload.session_id || "");
    const saleId = normalizeText(payload.saleId || payload.sale_id || "");
    const session = sessionId ? getSessionById(sessionId) : null;
    const sale = saleId ? getSaleById(saleId) : null;
    const paymentLink = buildSalePaymentLinkPayload(sale);
    const saleCustomer = sale ? buildSaleCustomerContext(sale) : null;
    const customer = session?.customer ? {
      lookupKey: buildCustomerLookupKey(session.customer),
      id: session.customer.master_customer_id || null,
      name: normalizeText(session.customer.name || ""),
      phone: normalizePhone(session.customer.phone || ""),
      whatsapp: normalizePhone(session.customer.phone || ""),
      topSize: normalizeText(session.customer.top_size || ""),
      bottomSize: normalizeText(session.customer.bottom_size || ""),
      shoeSize: normalizeText(session.customer.shoe_size || ""),
      availableCashback: roundMoney(getCustomerCashbackBalance(session.customer.phone || "")),
      pendingCashback: roundMoney(session.customer.behavior?.cashback_pendente || 0),
      expiredCashback: 0,
      favoriteStore: normalizeText(session.customer.behavior?.loja_favorita || session.customer.loja_favorita || ""),
      favoriteSeller: normalizeText(session.customer.behavior?.vendedor_favorito || session.customer.vendedor_favorito || ""),
      behavior: session.customer.behavior || {}
    } : saleCustomer || await resolveCustomerContext(payload);
    const cart = session ? buildCartSummary(session) : buildSaleCartSummary(sale || {});
    const paymentSummary = buildSalePaymentSummary(sale || {}, session);
    const defaultCouponLink = sale?.sale_id
      ? `/api/pdv/experience/coupon/${encodeURIComponent(sale.sale_id)}/document?format=html&mode=normal`
      : "";
    const couponLink = toPublicUrl(
      sale?.coupon_experience?.document_url
        || sale?.coupon_payload?.document_url
        || defaultCouponLink,
      req
    );
    return {
      type,
      origin,
      timestamp,
      customer,
      seller: buildSellerContext(user, session?.seller || sale?.vendedor || ""),
      store: buildStoreContext(session?.loja || sale?.loja || "", user.store || ""),
      cart,
      sale: sale ? {
        id: normalizeText(sale.sale_id || ""),
        total: roundMoney(sale.total_final || sale.total || cart.total),
        status: normalizeText(sale.status || ""),
        storeId: normalizeStoreKey(sale.loja || sale.loja_venda || ""),
        createdAt: sale.data_hora || sale.created_at || "",
        paymentSummary,
        paymentLink,
        hasCoupon: Boolean(couponLink),
        couponId: normalizeText(sale.coupon_experience?.coupon_id || sale.coupon_payload?.coupon_id || ""),
        couponLink
      } : session ? {
        id: normalizeText(session.session_id || ""),
        total: cart.total,
        status: normalizeText(session.status || "OPEN"),
        storeId: normalizeStoreKey(session.loja || ""),
        createdAt: session.updated_at || session.created_at || "",
        paymentSummary,
        hasCoupon: false
      } : null,
      cashback: customer ? {
        available: roundMoney(customer.availableCashback || 0),
        pending: roundMoney(customer.pendingCashback || 0),
        expired: roundMoney(customer.expiredCashback || 0)
      } : null
    };
  }

  if (type === "product_offer") {
    const customer = await resolveCustomerContext(payload);
    const product = await resolveProductContext(payload, { storeId: payload.storeId || payload.store_id || user.store || "" });
    return {
      type,
      origin,
      timestamp,
      customer,
      seller: buildSellerContext(user),
      store: buildStoreContext(payload.storeId || payload.store_id || product?.storeId || "", user.store || ""),
      product,
      cashback: customer ? {
        available: roundMoney(customer.availableCashback || 0),
        pending: roundMoney(customer.pendingCashback || 0),
        expired: roundMoney(customer.expiredCashback || 0)
      } : null
    };
  }

  if (type === "cashback_available") {
    const customer = await resolveCustomerContext(payload);
    return {
      type,
      origin,
      timestamp,
      customer,
      seller: buildSellerContext(user),
      store: buildStoreContext(payload.storeId || payload.store_id || customer?.favoriteStore || "", user.store || ""),
      cashback: customer ? {
        available: roundMoney(customer.availableCashback || 0),
        pending: roundMoney(customer.pendingCashback || 0),
        expired: roundMoney(customer.expiredCashback || 0)
      } : null
    };
  }

  return {
    type,
    origin,
    timestamp,
    customer: null,
    seller: buildSellerContext(user),
    store: buildStoreContext(user.store || "", user.store || "")
  };
}

function buildPdvWhatsappMessage(type, context = {}) {
  if (type === "payment_pending") {
    const customerFirstName = getFirstName(context.customer?.name || "");
    const paymentLinkUrl = normalizeText(context.sale?.paymentLink?.url || "");
    const couponLink = normalizeText(context.sale?.couponLink || "");
    const safeCouponLink = !isUnsafeLocalUrl(couponLink) ? couponLink : "";
    return [
      `Ola, ${customerFirstName}!`,
      "Segue o link para pagamento da sua compra na AEROSTORE.",
      "",
      `Venda: ${context.sale?.id || "-"}`,
      `Loja: ${context.store?.name || "AEROSTORE"}`,
      `Total: ${formatCurrencyBR(context.sale?.total || context.cart?.total || 0)}`,
      "",
      "Pague por aqui:",
      paymentLinkUrl,
      "",
      "Assim que o pagamento for confirmado, seguimos com a proxima etapa.",
      safeCouponLink ? "" : null,
      safeCouponLink ? "Comprovante do pedido:" : null,
      safeCouponLink || null,
      "",
      "Obrigado pela preferencia!"
    ].filter(Boolean).join("\n");
  }

  if (type === "__sale_summary_legacy__") {
    const customerFirstName = getFirstName(context.customer?.name || "");
    const paymentLines = Array.isArray(context.sale?.paymentSummary) ? context.sale.paymentSummary : [];
    const totalPaid = paymentLines.length
      ? roundMoney(paymentLines.reduce((sum, item) => sum + toNumber(item.amount || 0), 0))
      : roundMoney(context.sale?.total || context.cart?.total || 0);
    const couponLink = normalizeText(context.sale?.couponLink || "");
    return [
      `Ola, ${customerFirstName}!`,
      "Segue o comprovante da sua compra na AEROSTORE.",
      "",
      `Venda: ${context.sale?.id || "-"}`,
      `Loja: ${context.store?.name || "AEROSTORE"}`,
      `Total pago: ${formatCurrencyBR(totalPaid)}`,
      "",
      "Acesse seu comprovante:",
      couponLink,
      "",
      "Obrigado pela preferencia!",
    ].filter(Boolean).join("\n");
  }

  if (type === "sale_summary") {
    const customerName = normalizeText(context.customer?.name || "");
    const items = Array.isArray(context.cart?.items) ? context.cart.items : [];
    const summaryLines = items.slice(0, 8).map((item) => {
      const details = [item.color, item.size].filter(Boolean).join(" - ");
      return `- ${item.name}${details ? ` - ${details}` : ""} - ${item.quantity}x - ${formatCurrencyBR(item.total)}`;
    });
    const paymentLines = Array.isArray(context.sale?.paymentSummary) ? context.sale.paymentSummary : [];
    const paymentText = paymentLines.length
      ? paymentLines.map((item) => `${item.label} ${formatCurrencyBR(item.amount)}`).join(" • ")
      : "Nao informado";
    return [
      customerName ? `Ola, ${customerName}!` : "Ola!",
      "Aqui e a AEROSTORE.",
      "",
      "Resumo da sua compra:",
      `Pedido: ${context.sale?.id || "-"}`,
      `Loja: ${context.store?.name || "AEROSTORE"}`,
      "Itens:",
      ...(summaryLines.length ? summaryLines : ["- Itens nao disponiveis neste resumo."]),
      "",
      `Total: ${formatCurrencyBR(context.sale?.total || context.cart?.total || 0)}`,
      `Pagamento: ${paymentText}`,
      context.sale?.hasCoupon ? "Seu comprovante digital nao fiscal esta disponivel no sistema da loja." : "",
      "",
      "Obrigado pela compra.",
      "AEROSTORE"
    ].filter(Boolean).join("\n");
    const lines = items.slice(0, 8).map((item) => {
      const details = [item.color, item.size].filter(Boolean).join(" • ");
      const quantityLabel = item.quantity > 1 ? ` (${item.quantity}x)` : "";
      return `• ${item.name}${details ? ` ${details}` : ""}${quantityLabel} — ${formatCurrencyBR(item.total)}`;
    });
    return `Oi, ${customerName}! Segue o resumo da sua compra na AEROSTORE:\n\n${lines.join("\n")}\n\nTotal: ${formatCurrencyBR(context.sale?.total || context.cart?.total || 0)}\nAtendimento: ${context.seller?.name || "Equipe AEROSTORE"}\nLoja: ${context.store?.name || "AEROSTORE"}\n\nPosso te ajudar a finalizar?`;
  }

  if (type === "product_offer") {
    const customerName = normalizeText(context.customer?.name || "cliente");
    const product = context.product || {};
    const title = [product.name, product.brand, product.color].filter(Boolean).join(" ");
    const sizeLine = product.size ? `Tamanho: ${product.size}\n` : "";
    return `Oi, ${customerName}! Temos essa opção aqui na AEROSTORE:\n\n${title || "Produto selecionado"}\nValor: ${formatCurrencyBR(product.price || 0)}\n${sizeLine}\nQuer que eu confirme disponibilidade certinho?`;
  }

  if (type === "cashback_available") {
    const customerName = normalizeText(context.customer?.name || "cliente");
    return `Oi, ${customerName}! Você tem ${formatCurrencyBR(context.cashback?.available || 0)} de cashback disponível na AEROSTORE.\n\nPosso te mostrar algumas opções para aproveitar esse benefício?`;
  }

  return "";
}

async function checkRecentPdvWhatsappDuplicate({ phone = "", type = "" } = {}) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedType = normalizeText(type || "").toLowerCase();
  if (!normalizedPhone || !normalizedType) {
    return null;
  }
  const row = await get(
    `SELECT id, phone, customer_name, message_text, created_at, status, whatsapp_message_id
     FROM ai_message_logs
     WHERE phone = ?
       AND intent = ?
       AND direction = 'sent'
       AND status = 'ok'
       AND datetime(created_at) >= datetime('now', ?)
     ORDER BY id DESC
     LIMIT 1`,
    [normalizedPhone, normalizedType, `-${DUPLICATE_WINDOW_SECONDS} seconds`]
  );
  return row || null;
}

async function validatePdvWhatsappSend({
  type = "",
  context = {},
  message = "",
  runtimeState = {},
  overrideDuplicate = false,
  confirmPendingReview = false
} = {}) {
  const normalizedType = normalizeText(type || "").toLowerCase();
  const isSaleFlow = normalizedType === "sale_summary" || normalizedType === "payment_pending";
  const missingSalePhone = isSaleFlow && (!context.customer?.whatsapp || context.customer.whatsapp.length < 10);
  const missingSaleId = isSaleFlow && !context.sale?.id;
  if (!IMPLEMENTED_TYPES.includes(normalizedType)) {
    return {
      ok: false,
      statusCode: 400,
      message: PREPARED_TYPES.includes(normalizedType)
        ? "Este tipo de mensagem já está preparado, mas ainda não foi liberado nesta etapa do PDV."
        : "Tipo de mensagem não permitido."
    };
  }
  if (missingSaleId) {
    return {
      ok: false,
      statusCode: 404,
      code: "SALE_NOT_FOUND",
      message: normalizedType === "payment_pending"
        ? "Venda finalizada nao encontrada para enviar o link de pagamento."
        : "Venda finalizada nao encontrada para enviar o cupom."
    };
  }
  if (!context.customer?.name) {
    return {
      ok: false,
      statusCode: 400,
      code: "CUSTOMER_MISSING",
      message: isSaleFlow
        ? (normalizedType === "payment_pending"
          ? "Esta venda nao possui cliente vinculado para enviar o link de pagamento."
          : "Esta venda nao possui cliente vinculado para envio do cupom.")
        : "Selecione um cliente antes de enviar."
    };
  }
  if (missingSalePhone) {
    return {
      ok: false,
      statusCode: 400,
      code: "CUSTOMER_PHONE_MISSING",
      message: normalizedType === "payment_pending"
        ? "Cliente sem telefone cadastrado. Cadastre o telefone para enviar o link de pagamento pelo motor WhatsApp."
        : "Cliente sem telefone cadastrado. Cadastre o telefone para enviar o cupom pelo motor WhatsApp."
    };
  }
  if (!context.customer?.whatsapp || context.customer.whatsapp.length < 10) {
    return {
      ok: false,
      statusCode: 400,
      code: "CUSTOMER_PHONE_MISSING",
      message: normalizedType === "payment_pending"
        ? "Cliente sem telefone cadastrado. Cadastre o telefone para enviar o link de pagamento pelo motor WhatsApp."
        : "Cliente sem telefone cadastrado. Cadastre o telefone para enviar o cupom pelo motor WhatsApp."
    };
  }
  if (normalizedType === "sale_summary" && !normalizeText(context.sale?.couponLink || "")) {
    return {
      ok: false,
      statusCode: 503,
      code: "PUBLIC_BASE_URL_MISSING",
      message: "AEROSTORE_PUBLIC_BASE_URL nao configurada. Defina a URL publica para enviar o comprovante por WhatsApp."
    };
  }
  if (normalizedType === "payment_pending" && !normalizeText(context.sale?.paymentLink?.url || "")) {
    return {
      ok: false,
      statusCode: 409,
      code: "PAYMENT_LINK_MISSING",
      message: "Esta venda em Link pagamento ainda nao possui URL real para envio."
    };
  }
  if (!message || !normalizeText(message)) {
    return { ok: false, statusCode: 400, message: "Não foi possível montar a mensagem do cliente." };
  }
  if (!context.seller?.id && !context.seller?.name) {
    return { ok: false, statusCode: 401, message: "Usuário não autenticado para enviar mensagens do PDV." };
  }
  if (normalizedType === "sale_summary" && !(context.cart?.items || []).length) {
    return { ok: false, statusCode: 400, message: "Não há carrinho para enviar." };
  }
  if (normalizedType === "product_offer" && !context.product?.name) {
    return { ok: false, statusCode: 400, message: "Não há produto para enviar." };
  }
  if (normalizedType === "cashback_available") {
    const available = roundMoney(context.cashback?.available || 0);
    if (available <= 0) {
      return { ok: false, statusCode: 400, message: "Este cliente não possui cashback disponível para envio agora." };
    }
  }
  if (normalizedType === "product_offer" && String(context.product?.status || "").toLowerCase() === "pending_review" && !confirmPendingReview) {
    return {
      ok: false,
      statusCode: 409,
      code: "PRODUCT_PENDING_REVIEW",
      message: "Este produto está pendente de revisão. Confirme o envio somente se o vendedor validar o item antes."
    };
  }
  const duplicate = await checkRecentPdvWhatsappDuplicate({
    phone: context.customer.whatsapp,
    type: normalizedType
  });
  if (duplicate && !overrideDuplicate) {
    return {
      ok: false,
      statusCode: 409,
      code: "DUPLICATE_RECENT",
      message: "Mensagem semelhante já foi enviada há pouco tempo para este cliente.",
      duplicate
    };
  }
  if (runtimeState?.status !== "conectado") {
    return {
      ok: false,
      statusCode: 503,
      code: "WHATSAPP_DISCONNECTED",
      message: normalizedType === "payment_pending"
        ? "Motor WhatsApp desconectado. Conecte o WhatsApp no CRM para enviar o link de pagamento pelo sistema."
        : "Motor WhatsApp desconectado. Conecte o WhatsApp no CRM para enviar o cupom pelo sistema."
    };
  }
  return { ok: true, duplicate };
}

function buildPdvWhatsappCustomerSearchRows(payload = {}) {
  const rows = Array.isArray(payload?.unified) ? payload.unified : [];
  return rows.map((item) => ({
    customer_key: buildCustomerLookupKey({
      contactId: item.legacy_contact_id,
      crmContactId: item.crm_contact_id,
      master_customer_id: item.master_customer_id,
      phone: item.phone,
      document: item.document,
      name: item.name
    }),
    contact_id: Number(item.legacy_contact_id || 0) || null,
    crm_contact_id: Number(item.crm_contact_id || 0) || null,
    master_customer_id: normalizeText(item.master_customer_id || ""),
    name: normalizeText(item.name || ""),
    phone: normalizePhone(item.phone || ""),
    document: normalizeDigits(item.document || ""),
    available_cashback: roundMoney(item.saldo_cashback || item.cashback_legado || 0),
    origin: normalizeText(item.origin_label || item.origin || "")
  })).filter((item) => item.customer_key && item.name);
}

async function registerPdvWhatsappSent({
  logger = null,
  context = {},
  type = "",
  message = "",
  sendResult = null,
  error = null,
  overrideDuplicate = false
} = {}) {
  const masked = maskSensitiveWhatsappContext(context);
  const payload = {
    contactId: Number(context.customer?.contactId || 0) || null,
    phone: normalizePhone(context.customer?.whatsapp || context.customer?.phone || ""),
    phoneOriginal: context.customer?.phone || "",
    inboundChatId: sendResult?.chatId || "",
    senderUserId: String(context.seller?.id || ""),
    debugContext: {
      ...masked,
      channel: "whatsapp_motor",
      sale: {
        id: normalizeText(context.sale?.id || ""),
        status: normalizeText(context.sale?.status || ""),
        coupon_id: normalizeText(context.sale?.couponId || ""),
        coupon_link: normalizeText(context.sale?.couponLink || ""),
        payment_link_url: normalizeText(context.sale?.paymentLink?.url || ""),
        payment_link_checkout_id: normalizeText(context.sale?.paymentLink?.checkout_id || ""),
        payment_link_status: normalizeText(context.sale?.paymentLink?.status || "")
      },
      operator: {
        id: String(context.seller?.id || ""),
        name: normalizeText(context.seller?.name || "")
      },
      customer: {
        id: context.customer?.id || null,
        contactId: Number(context.customer?.contactId || 0) || null,
        crmContactId: Number(context.customer?.crmContactId || 0) || null
      },
      overrideDuplicate: Boolean(overrideDuplicate),
      sendResult: sendResult ? {
        messageId: sendResult.messageId || "",
        chatId: sendResult.chatId || "",
        connectedNumber: sendResult.numberIdSerialized || ""
      } : null
    },
    customerName: context.customer?.name || "",
    customerMessage: "",
    direction: error ? "error" : "sent",
    source: "pdv_whatsapp",
    connectedNumber: sendResult?.numberIdSerialized || "",
    messageText: message,
    intent: normalizeText(type || "").toLowerCase(),
    needsHuman: false,
    autoSent: false,
    productId: Number(context.product?.id || 0) || null,
    mediaId: null,
    status: error ? "erro" : "ok",
    errorMessage: error ? String(error.userMessage || error.message || error) : "",
    whatsappMessageId: sendResult?.messageId || ""
  };
  if (typeof logger === "function") {
    await logger(payload);
    if (!error && normalizeText(type || "").toLowerCase() === "payment_pending" && normalizeText(context.sale?.id || "")) {
      markSalePaymentLinkSent(context.sale.id, { sentAt: new Date().toISOString() });
    }
    return;
  }
  await run(
    `INSERT INTO ai_message_logs
    (contact_id, phone, phone_original, inbound_chat_id, sender_user_id, debug_context, customer_name, customer_message, direction, source, connected_number, message_text, intent, needs_human, auto_sent, product_id, media_id, status, error_message, whatsapp_message_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      payload.contactId,
      payload.phone,
      payload.phoneOriginal,
      payload.inboundChatId,
      payload.senderUserId,
      JSON.stringify(payload.debugContext || {}),
      payload.customerName,
      payload.customerMessage,
      payload.direction,
      payload.source,
      payload.connectedNumber,
      payload.messageText,
      payload.intent,
      payload.needsHuman ? 1 : 0,
      payload.autoSent ? 1 : 0,
      payload.productId,
      payload.mediaId,
      payload.status,
      payload.errorMessage,
      payload.whatsappMessageId
    ]
  );
  if (!error && normalizeText(type || "").toLowerCase() === "payment_pending" && normalizeText(context.sale?.id || "")) {
    markSalePaymentLinkSent(context.sale.id, { sentAt: new Date().toISOString() });
  }
}

module.exports = {
  IMPLEMENTED_TYPES,
  PREPARED_TYPES,
  buildPdvWhatsappContext,
  buildPdvWhatsappMessage,
  buildPdvWhatsappCustomerSearchRows,
  validatePdvWhatsappSend,
  checkRecentPdvWhatsappDuplicate,
  registerPdvWhatsappSent,
  maskSensitiveWhatsappContext,
  resolveCustomerContext,
  resolveProductContext
};
