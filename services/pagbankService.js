const crypto = require("crypto");

class PagBankError extends Error {
  constructor(message, { statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "PagBankError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function getPagBankEnvironment() {
  const env = String(process.env.PAGBANK_ENV || "sandbox").trim().toLowerCase();
  return env === "production" ? "production" : "sandbox";
}

function getPagBankBaseUrl() {
  return getPagBankEnvironment() === "production"
    ? "https://api.pagseguro.com"
    : "https://sandbox.api.pagseguro.com";
}

function getPagBankToken() {
  const env = getPagBankEnvironment();
  return String(env === "production" ? process.env.PAGBANK_PRODUCTION_TOKEN || "" : process.env.PAGBANK_SANDBOX_TOKEN || "").trim();
}

function getPagBankSoftDescriptor() {
  const raw = String(process.env.PAGBANK_SOFT_DESCRIPTOR || "AEROSTORE");
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .slice(0, 17) || "AEROSTORE";
}

function getPagBankInstallmentsLimit() {
  const value = Number(process.env.PAGBANK_INSTALLMENTS_LIMIT || 10);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 6) : 3;
}

function getPagBankInterestFreeInstallments() {
  const value = Number(process.env.PAGBANK_INTEREST_FREE_INSTALLMENTS || 1);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 99) : 1;
}

function getPagBankConfig() {
  return {
    env: getPagBankEnvironment(),
    baseUrl: getPagBankBaseUrl(),
    token: getPagBankToken(),
    webhookUrl: String(process.env.PAGBANK_WEBHOOK_URL || "").trim(),
    redirectUrl: String(process.env.PAGBANK_REDIRECT_URL || "").trim(),
    returnUrl: String(process.env.PAGBANK_RETURN_URL || "").trim(),
    installmentsLimit: getPagBankInstallmentsLimit(),
    interestFreeInstallments: getPagBankInterestFreeInstallments(),
    softDescriptor: getPagBankSoftDescriptor()
  };
}

function toCents(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.round(numeric * 100);
}

function normalizeMoneyInput(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = String(value).trim();
  if (!raw) {
    return 0;
  }
  const digits = raw.replace(/[^\d,.-]/g, "");
  if (!digits) {
    return 0;
  }
  const hasComma = digits.includes(",");
  const hasDot = digits.includes(".");
  if (hasComma && hasDot) {
    const normalized = digits.lastIndexOf(",") > digits.lastIndexOf(".")
      ? digits.replace(/\./g, "").replace(",", ".")
      : digits.replace(/,/g, "");
    return Number(normalized || 0);
  }
  if (hasComma) {
    return Number(digits.replace(/\./g, "").replace(",", ".") || 0);
  }
  return Number(digits || 0);
}

function normalizeString(value, fallback = "") {
  return String(value || fallback || "").trim();
}

function normalizeInteger(value, fallback, { min = 1, max = 18 } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const integer = Math.floor(numeric);
  if (integer < min || integer > max) {
    return fallback;
  }
  return integer;
}

function normalizeCustomerName(name) {
  const normalized = normalizeString(name, "Cliente AEROSTORE")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "Cliente AEROSTORE";
}

function normalizeEmail(email) {
  const normalized = normalizeString(email).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

function normalizePagBankPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) {
    return null;
  }
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length !== 11) {
    return null;
  }
  const area = local.slice(0, 2);
  const number = local.slice(2);
  if (!/^9\d{8}$/.test(number)) {
    return null;
  }
  return {
    country: "+55",
    area,
    number
  };
}

function buildReferenceId(source = "manual") {
  const prefix = String(source || "manual")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase()
    .slice(0, 16) || "MANUAL";
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`.slice(0, 64);
}

function buildPagBankCustomer(customer = {}) {
  const normalized = {
    name: normalizeCustomerName(customer.name),
    email: normalizeEmail(customer.email),
    phone: normalizePagBankPhone(customer.phone)
  };
  const payload = {
    name: normalized.name
  };
  if (normalized.email) {
    payload.email = normalized.email;
  }
  if (normalized.phone) {
    payload.phone = normalized.phone;
  }
  return payload;
}

function buildPagBankItems(items = []) {
  return items.map((item, index) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = normalizeMoneyInput(item.unitPrice);
    if (!normalizeString(item.name)) {
      throw new PagBankError(`O item ${index + 1} precisa ter nome.`, { statusCode: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new PagBankError(`O item ${index + 1} precisa ter quantidade maior que zero.`, { statusCode: 400 });
    }
    if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
      throw new PagBankError(`O item ${index + 1} precisa ter valor unitário maior que zero.`, { statusCode: 400 });
    }
    return {
      reference_id: normalizeString(item.sku || item.reference_id || `ITEM-${index + 1}`).slice(0, 100),
      name: normalizeString(item.name).slice(0, 200),
      quantity: Math.floor(quantity),
      unit_amount: toCents(unitPrice)
    };
  });
}

function getSupportedPaymentMethodTypes() {
  return ["CREDIT_CARD", "PIX", "BOLETO"];
}

function normalizePagBankPaymentMethods(methods = []) {
  const supported = new Set(getSupportedPaymentMethodTypes());
  const normalized = Array.isArray(methods)
    ? methods
        .map((item) => normalizeString(item).toUpperCase())
        .filter((item) => supported.has(item))
    : [];
  const unique = Array.from(new Set(normalized));
  return unique.length ? unique : ["CREDIT_CARD", "PIX", "BOLETO"];
}

function normalizeInstallmentsConfigMode(value) {
  const normalized = normalizeString(value).toLowerCase();
  if (normalized === "limit_only") {
    return "limit_only";
  }
  if (normalized === "none") {
    return "none";
  }
  return "interest_free_full";
}

function clonePagBankPayload(payload = {}) {
  return JSON.parse(JSON.stringify(payload || {}));
}

function removeInstallmentsOption(payload = {}, optionName = "") {
  const normalizedOption = normalizeString(optionName).toUpperCase();
  if (!normalizedOption || !Array.isArray(payload.payment_methods_configs)) {
    return payload;
  }
  payload.payment_methods_configs = payload.payment_methods_configs
    .map((item) => {
      if (String(item?.type || "").toUpperCase() !== "CREDIT_CARD") {
        return item;
      }
      const nextOptions = Array.isArray(item.config_options)
        ? item.config_options.filter((option) => String(option?.option || "").toUpperCase() !== normalizedOption)
        : [];
      return {
        ...item,
        config_options: nextOptions
      };
    })
    .filter((item) => !Array.isArray(item.config_options) || item.config_options.length);
  if (!payload.payment_methods_configs.length) {
    delete payload.payment_methods_configs;
  }
  return payload;
}

function removePaymentMethodsConfigs(payload = {}) {
  delete payload.payment_methods_configs;
  return payload;
}

function removePagBankUrls(payload = {}) {
  delete payload.redirect_url;
  delete payload.return_url;
  delete payload.notification_urls;
  delete payload.payment_notification_urls;
  return payload;
}

function buildPagBankCheckoutPayload(input = {}) {
  const itemsInput = Array.isArray(input.items) ? input.items : [];
  if (!itemsInput.length) {
    throw new PagBankError("Adicione pelo menos 1 item antes de gerar o link PagSeguro/PagBank.", { statusCode: 400 });
  }

  const items = buildPagBankItems(itemsInput);
  const itemsTotal = items.reduce((sum, item) => sum + Number(item.unit_amount || 0) * Number(item.quantity || 0), 0);
  const discountAmount = toCents(normalizeMoneyInput(input.discountAmount));
  const additionalAmount = toCents(normalizeMoneyInput(input.additionalAmount));
  const shippingAmount = toCents(normalizeMoneyInput(input.shippingAmount));

  if (itemsTotal <= 0) {
    throw new PagBankError("O total do pedido precisa ser maior que zero.", { statusCode: 400 });
  }

  if (discountAmount > itemsTotal + additionalAmount + shippingAmount) {
    throw new PagBankError("O desconto não pode ser maior que o total dos itens, frete e adicional.", { statusCode: 400 });
  }

  const selectedPaymentMethods = normalizePagBankPaymentMethods(input.paymentMethods);
  const useMinimalPayload = Boolean(input.useMinimalPayload);
  const rawInstallmentsLimit = Number(input.installmentsLimit);
  const configuredInstallmentsLimit = Number.isFinite(rawInstallmentsLimit)
    ? Math.min(6, Math.max(1, Math.floor(rawInstallmentsLimit)))
    : getPagBankInstallmentsLimit();
  const installmentsConfigMode = normalizeInstallmentsConfigMode(input.installmentsConfigMode);
  const installmentsLimit = configuredInstallmentsLimit || 3;
  const interestFreeInstallments = Math.min(installmentsLimit, installmentsLimit);

  const payload = {
    reference_id: buildReferenceId(input.source || "manual"),
    items,
    additional_amount: additionalAmount,
    discount_amount: discountAmount,
    payment_methods: selectedPaymentMethods.map((type) => ({ type })),
    soft_descriptor: getPagBankSoftDescriptor()
  };

  if (!useMinimalPayload) {
    payload.customer_modifiable = true;
    payload.customer = buildPagBankCustomer(input.customer || {});
  }

  if (!useMinimalPayload && selectedPaymentMethods.includes("CREDIT_CARD") && installmentsConfigMode !== "none") {
    const configOptions = [{ option: "INSTALLMENTS_LIMIT", value: String(installmentsLimit) }];
    if (installmentsConfigMode === "interest_free_full") {
      configOptions.push({ option: "INTEREST_FREE_INSTALLMENTS", value: String(interestFreeInstallments) });
    }
    payload.payment_methods_configs = [
      {
        type: "CREDIT_CARD",
        config_options: configOptions
      }
    ];
  }

  const redirectUrl = normalizeString(process.env.PAGBANK_REDIRECT_URL);
  const returnUrl = normalizeString(process.env.PAGBANK_RETURN_URL);
  const webhookUrl = normalizeString(process.env.PAGBANK_WEBHOOK_URL);

  if (!useMinimalPayload && redirectUrl) {
    payload.redirect_url = redirectUrl;
  }
  if (!useMinimalPayload && returnUrl) {
    payload.return_url = returnUrl;
  }
  if (!useMinimalPayload && webhookUrl) {
    payload.notification_urls = [webhookUrl];
    payload.payment_notification_urls = [webhookUrl];
  }

  if (!useMinimalPayload) {
    payload.shipping = shippingAmount > 0
    ? {
        type: "FIXED",
        amount: shippingAmount,
        address_modifiable: true
      }
    : {
        type: "FREE",
        amount: 0,
        address_modifiable: true
      };
  }

  return {
    payload,
    totals: {
      itemsTotal,
      shippingAmount,
      additionalAmount,
      discountAmount,
      grandTotal: itemsTotal + shippingAmount + additionalAmount - discountAmount
    },
    config: {
      installmentsLimit,
      sellerAssumesFees: true,
      customerCondition: "interest_free",
      installmentsConfigMode,
      interestFreeInstallments,
      paymentMethods: selectedPaymentMethods,
      useMinimalPayload
    }
  };
}

function getPagBankHeaders(token) {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`
  };
}

function sanitizePagBankPayloadForLog(payload = {}) {
  return JSON.parse(JSON.stringify(payload || {}));
}

function normalizePagBankErrorMessages(providerBody) {
  const messages = Array.isArray(providerBody?.error_messages) ? providerBody.error_messages : [];
  return messages.map((item) => ({
    error: normalizeString(item?.error || ""),
    description: normalizeString(item?.description || ""),
    parameter_name: normalizeString(item?.parameter_name || "")
  }));
}

function buildPagBankErrorsText(errorMessages = []) {
  return (Array.isArray(errorMessages) ? errorMessages : [])
    .map((item) => `- ${item.parameter_name || "general"}: ${item.description || "Erro sem descrição"}${item.error ? ` (${item.error})` : ""}`)
    .join("\n");
}

function buildPagBankProviderErrorDetails(parsed = {}, sanitizedPayload = {}) {
  const providerBody = parsed.body || parsed.rawText || "";
  const errorMessages = normalizePagBankErrorMessages(providerBody);
  return {
    providerStatus: parsed.status || 0,
    providerBody,
    error_messages: errorMessages,
    pagbankErrorsText: buildPagBankErrorsText(errorMessages),
    sanitizedPayload
  };
}

async function parsePagBankResponse(response) {
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    json = null;
  }
  return {
    ok: response.ok,
    status: response.status,
    body: json,
    rawText: text
  };
}

function buildPagBankFallbackWarning() {
  return "O link foi gerado, mas o PagBank não aceitou a configuração explícita de parcelas sem juros neste ambiente. Antes de enviar ao cliente, abra o link e confira se o parcelamento aparece sem juros.";
}

function buildPagBankNotApprovedWarning() {
  return "O PagBank gerou o link, mas não aceitou a configuração de parcelamento sem juros. Não envie este link ao cliente, pois ele pode cobrar juros do comprador.";
}

function buildPagBankUrlsRemovedWarning() {
  return "As URLs locais de retorno e webhook foram removidas para o teste no sandbox, mas a configuração de parcelamento sem juros foi mantida.";
}

async function postPagBankCheckout(token, payload) {
  const response = await fetch(`${getPagBankBaseUrl()}/checkouts`, {
    method: "POST",
    headers: getPagBankHeaders(token),
    body: JSON.stringify(payload)
  });
  const parsed = await parsePagBankResponse(response);
  return { response, parsed };
}

function buildPagBankCheckoutSuccess(parsed, payload, totals, config, extra = {}) {
  const paymentUrl = Array.isArray(parsed.body?.links)
    ? parsed.body.links.find((link) => String(link?.rel || "").toUpperCase() === "PAY")?.href || ""
    : "";
  if (!paymentUrl) {
    throw new PagBankError("Checkout criado, mas o PagBank não retornou link de pagamento PAY.", {
      statusCode: 502,
      details: buildPagBankProviderErrorDetails(parsed, sanitizePagBankPayloadForLog(payload))
    });
  }
  return {
    success: true,
    env: getPagBankEnvironment(),
    reference_id: parsed.body?.reference_id || payload.reference_id,
    checkout_id: parsed.body?.id || "",
    payment_url: paymentUrl,
    totals,
    config,
    raw: parsed.body || {},
    ...extra
  };
}

function shouldStripPagBankUrls(details = {}) {
  const messages = Array.isArray(details?.error_messages) ? details.error_messages : [];
  return messages.some((item) => {
    const name = String(item?.parameter_name || "").toLowerCase();
    return (
      name === "redirect_url" ||
      name === "return_url" ||
      name === "notification_urls" ||
      name === "payment_notification_urls"
    );
  });
}

function ensurePagBankToken(message = "Não foi possível gerar o link PagSeguro/PagBank. Verifique token, ambiente e dados enviados.") {
  const token = getPagBankToken();
  if (!token) {
    throw new PagBankError(message, {
      statusCode: 400,
      details: { reason: "missing_token", env: getPagBankEnvironment() }
    });
  }
  return token;
}

async function createPagBankCheckout(input = {}) {
  const { payload, totals, config } = buildPagBankCheckoutPayload(input);
  if (totals.grandTotal <= 0) {
    throw new PagBankError("O valor total do checkout precisa ser maior que zero.", { statusCode: 400 });
  }
  const token = ensurePagBankToken("Não foi possível gerar o link PagSeguro/PagBank. Verifique token, ambiente e dados enviados.");
  const attempts = [];
  const isTechnicalMode = Boolean(config.useMinimalPayload) || config.installmentsConfigMode !== "interest_free_full";

  if (config.useMinimalPayload) {
    attempts.push({ label: "minimal_payload", payload: clonePagBankPayload(payload) });
  } else if (config.installmentsConfigMode === "interest_free_full") {
    attempts.push({ label: "interest_free_full", payload: clonePagBankPayload(payload) });
    attempts.push({ label: "interest_free_full_no_urls", payload: removePagBankUrls(clonePagBankPayload(payload)) });
  } else if (config.installmentsConfigMode === "limit_only") {
    attempts.push({ label: "limit_only", payload: clonePagBankPayload(payload) });
    attempts.push({ label: "limit_only_no_urls", payload: removePagBankUrls(clonePagBankPayload(payload)) });
  } else {
    attempts.push({ label: "no_installments_config", payload: clonePagBankPayload(payload) });
    attempts.push({ label: "no_installments_config_no_urls", payload: removePagBankUrls(clonePagBankPayload(payload)) });
  }

  let lastFailure = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const sanitizedPayload = sanitizePagBankPayloadForLog(attempt.payload);
    const { response, parsed } = await postPagBankCheckout(token, attempt.payload);
    if (parsed.ok) {
      const warnings = [];
      const usedFallback = attempt.label !== attempts[0].label;
      const approvedForCustomer = !isTechnicalMode && (
        attempt.label === "interest_free_full" || attempt.label === "interest_free_full_no_urls"
      );
      if (usedFallback) {
        warnings.push(
          approvedForCustomer && attempt.label === "interest_free_full_no_urls"
            ? buildPagBankUrlsRemovedWarning()
            : buildPagBankFallbackWarning()
        );
      }
      if (!approvedForCustomer) {
        warnings.push(
          isTechnicalMode
            ? "Link técnico de teste — não enviar ao cliente."
            : buildPagBankNotApprovedWarning()
        );
      }
      return buildPagBankCheckoutSuccess(parsed, attempt.payload, totals, {
        ...config,
        appliedInstallmentsConfigMode: attempt.label,
        fallbackApplied: usedFallback,
        installmentsConfigApplied: approvedForCustomer
      }, {
        warnings,
        paymentLinkGenerated: true,
        approvedForCustomer,
        requiresManualReview: !approvedForCustomer,
        reason: approvedForCustomer
          ? null
          : (isTechnicalMode ? "technical_test_link" : "interest_free_installments_not_applied"),
        fallback: usedFallback
          ? {
              attempted: attempts.map((item) => item.label),
              applied: attempt.label
            }
          : null
      });
    }
    lastFailure = { response, parsed, sanitizedPayload };
    if (
      config.installmentsConfigMode === "interest_free_full" &&
      attempt.label === "interest_free_full" &&
      !shouldStripPagBankUrls(buildPagBankProviderErrorDetails(parsed, sanitizedPayload))
    ) {
      break;
    }
  }

  throw new PagBankError("Não foi possível gerar o link PagSeguro/PagBank. Verifique token, ambiente e dados enviados.", {
    statusCode: lastFailure?.response?.status || 502,
    details: buildPagBankProviderErrorDetails(lastFailure?.parsed || {}, lastFailure?.sanitizedPayload || {})
  });
}

async function getPagBankCheckout(checkoutId) {
  const token = ensurePagBankToken("Não foi possível consultar o checkout PagSeguro/PagBank. Verifique token e ambiente configurados.");
  const normalizedId = normalizeString(checkoutId);
  if (!normalizedId) {
    throw new PagBankError("Informe um checkout_id válido para consultar.", { statusCode: 400 });
  }
  const response = await fetch(`${getPagBankBaseUrl()}/checkouts/${encodeURIComponent(normalizedId)}`, {
    method: "GET",
    headers: getPagBankHeaders(token)
  });
  const parsed = await parsePagBankResponse(response);
  if (!parsed.ok) {
    throw new PagBankError("Não foi possível consultar o checkout no PagSeguro/PagBank.", {
      statusCode: response.status || 502,
      details: buildPagBankProviderErrorDetails(parsed, { checkout_id: normalizedId })
    });
  }
  const paymentUrl = Array.isArray(parsed.body?.links)
    ? parsed.body.links.find((link) => String(link?.rel || "").toUpperCase() === "PAY")?.href || ""
    : "";
  const raw = parsed.body || {};
  if (Array.isArray(raw.orders) && raw.orders.length) {
    const enrichedOrders = await Promise.all(raw.orders.map(async (order) => {
      const orderId = normalizeString(order?.id || order?.order_id || "");
      if (!orderId) {
        return order;
      }
      try {
        return await getPagBankOrder(orderId, { token });
      } catch (error) {
        return {
          ...order,
          lookup_error: String(error.message || error)
        };
      }
    }));
    raw.orders = enrichedOrders;
  }
  return {
    success: true,
    env: getPagBankEnvironment(),
    checkout_id: raw.id || normalizedId,
    reference_id: raw.reference_id || "",
    payment_url: paymentUrl,
    raw
  };
}

async function getPagBankOrder(orderId, options = {}) {
  const token = options.token || ensurePagBankToken("NÃ£o foi possÃ­vel consultar o pedido PagSeguro/PagBank. Verifique token e ambiente configurados.");
  const normalizedId = normalizeString(orderId);
  if (!normalizedId) {
    throw new PagBankError("Informe um order_id vÃ¡lido para consultar.", { statusCode: 400 });
  }
  const response = await fetch(`${getPagBankBaseUrl()}/orders/${encodeURIComponent(normalizedId)}`, {
    method: "GET",
    headers: getPagBankHeaders(token)
  });
  const parsed = await parsePagBankResponse(response);
  if (!parsed.ok) {
    throw new PagBankError("NÃ£o foi possÃ­vel consultar o pedido no PagSeguro/PagBank.", {
      statusCode: response.status || 502,
      details: buildPagBankProviderErrorDetails(parsed, { order_id: normalizedId })
    });
  }
  return parsed.body || {};
}

module.exports = {
  PagBankError,
  getPagBankConfig,
  createPagBankCheckout,
  getPagBankCheckout,
  getPagBankOrder,
  buildPagBankCheckoutPayload,
  normalizeMoneyInput,
  toCents
};
