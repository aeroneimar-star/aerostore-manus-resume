"use strict";

/**
 * InfinitePayAdapter — Adapter isolado para comunicação com a InfinitePay.
 *
 * Recebe transporte HTTP por injeção de dependência.
 * Nenhuma chamada de rede em testes (transporte fake).
 *
 * Contratos:
 *   createPixPayment({ handle, items, order_nsu, customer, redirect_url, webhook_url })
 *   getPixPaymentStatus({ handle, order_nsu, transaction_nsu, slug })
 *
 * Resposta normalizada:
 *   { success, provider, url, invoice_slug, order_nsu, amount_cents, raw }
 *
 * Erros normalizados:
 *   { code, message, details }
 *
 * NOTA: O adapter NÃO valida PIX-only — isso é feito no service layer.
 * O adapter apenas expõe os dados brutos do provider.
 */

const INFINITEPAY_BASE_URL = "https://api.checkout.infinitepay.io";
const INFINITEPAY_TIMEOUT_MS = 15000;

function createInfinitePayAdapter(options = {}) {
  const httpTransport = options.httpTransport || defaultFetchTransport;
  const timeoutMs = options.timeoutMs || INFINITEPAY_TIMEOUT_MS;

  function buildPayload(params = {}) {
    const handle = params.handle || "";
    if (!handle) {
      return {
        ok: false,
        code: "INFINITEPAY_HANDLE_MISSING",
        message: "Handle (InfiniteTag) obrigatório",
      };
    }

    const items = Array.isArray(params.items) && params.items.length > 0
      ? params.items
      : [{ quantity: 1, price: params.amount_cents || 0, description: "Pedido" }];

    const payload = {
      handle,
      order_nsu: params.order_nsu || "",
      items,
    };

    if (params.customer) {
      payload.customer = params.customer;
    }
    if (params.redirect_url) {
      payload.redirect_url = params.redirect_url;
    }
    if (params.webhook_url) {
      payload.webhook_url = params.webhook_url;
    }

    return { ok: true, payload };
  }

  async function createPixPayment(params = {}) {
    const built = buildPayload(params);
    if (!built.ok) {
      return {
        success: false,
        error: built.code,
        message: built.message,
      };
    }

    try {
      const response = await httpTransport({
        method: "POST",
        url: `${INFINITEPAY_BASE_URL}/links`,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "AEROSTORE-SHOP",
        },
        body: JSON.stringify(built.payload),
        timeoutMs,
      });

      if (!response.ok) {
        return {
          success: false,
          error: "INFINITEPAY_API_ERROR",
          statusCode: response.status,
          message: "Erro na API InfinitePay",
          details: response.data,
        };
      }

      const body = response.data || {};
      const url = body.url || body.checkout_url || "";
      if (!url) {
        return {
          success: false,
          error: "INFINITEPAY_NO_CHECKOUT_URL",
          message: "InfinitePay não retornou URL de checkout",
        };
      }

      return {
        success: true,
        provider: "infinitepay",
        url,
        invoice_slug: body.invoice_slug || body.slug || null,
        order_nsu: built.payload.order_nsu,
        amount_cents: params.amount_cents || 0,
        raw: body,
      };
    } catch (err) {
      if (err.code === "TIMEOUT" || err.message?.includes("timeout")) {
        return {
          success: false,
          error: "INFINITEPAY_TIMEOUT",
          message: "Timeout na comunicação com InfinitePay",
        };
      }
      return {
        success: false,
        error: "INFINITEPAY_TRANSPORT_ERROR",
        message: err.message || "Erro de transporte",
      };
    }
  }

  async function getPixPaymentStatus(params = {}) {
    const handle = params.handle || "";
    if (!handle) {
      return {
        success: false,
        error: "INFINITEPAY_HANDLE_MISSING",
        message: "Handle obrigatório",
      };
    }

    if (!params.order_nsu && !params.transaction_nsu && !params.slug) {
      return {
        success: false,
        error: "INFINITEPAY_MISSING_IDENTIFIER",
        message: "Informe order_nsu, transaction_nsu ou slug",
      };
    }

    try {
      const response = await httpTransport({
        method: "POST",
        url: `${INFINITEPAY_BASE_URL}/payment_check`,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "AEROSTORE-SHOP",
        },
        body: JSON.stringify({
          handle,
          order_nsu: params.order_nsu || "",
          transaction_nsu: params.transaction_nsu || "",
          slug: params.slug || "",
        }),
        timeoutMs,
      });

      if (!response.ok) {
        return {
          success: false,
          error: "INFINITEPAY_API_ERROR",
          statusCode: response.status,
          message: "Erro ao consultar status na InfinitePay",
        };
      }

      const body = response.data || {};
      return {
        success: true,
        provider: "INFINITEPAY",
        paid: body.paid === true,
        amount: body.amount,
        paid_amount: body.paid_amount,
        installments: body.installments,
        capture_method: body.capture_method,
        method: body.capture_method === "pix" ? "PIX" : "UNKNOWN",
        status: body.status || "",
        order_nsu: body.order_nsu || params.order_nsu || "",
        transaction_nsu: body.transaction_nsu || body.nsu || "",
        receipt_url: body.receipt_url || "",
        invoice_slug: body.invoice_slug || body.slug || "",
        raw: body,
      };
    } catch (err) {
      if (err.code === "TIMEOUT" || err.message?.includes("timeout")) {
        return {
          success: false,
          error: "INFINITEPAY_TIMEOUT",
          message: "Timeout na consulta de status",
        };
      }
      return {
        success: false,
        error: "INFINITEPAY_TRANSPORT_ERROR",
        message: err.message || "Erro de transporte",
      };
    }
  }

  return {
    createPixPayment,
    getPixPaymentStatus,
    base_url: INFINITEPAY_BASE_URL,
  };
}

/**
 * Transporte HTTP padrão usando fetch (Node 18+).
 * Substituído por fake em testes.
 */
async function defaultFetchTransport(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs || INFINITEPAY_TIMEOUT_MS);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      throw Object.assign(new Error("timeout"), { code: "TIMEOUT" });
    }
    throw err;
  }
}

module.exports = { createInfinitePayAdapter, defaultFetchTransport, INFINITEPAY_BASE_URL };
