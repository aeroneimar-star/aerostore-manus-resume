"use strict";

/**
 * FakeTransport — Transporte HTTP fake para testes.
 *
 * Simula respostas da InfinitePay sem chamadas de rede.
 * Configurável: success, timeout, malformed, httpError.
 *
 * Registra todas as chamadas em callLog para verificação.
 */

function createFakeTransport(config = {}) {
  const callLog = [];
  const shouldSucceed = config.success !== false;
  const shouldTimeout = config.timeout === true;
  const shouldMalform = config.malformed === true;
  const shouldHttpError = config.httpError || null;
  const delayMs = config.delayMs || 0;

  async function fakeRequest(request) {
    callLog.push({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body ? JSON.parse(request.body) : null,
      timestamp: new Date().toISOString(),
    });

    if (shouldTimeout) {
      const err = new Error("timeout");
      err.code = "TIMEOUT";
      throw err;
    }

    // Delay simulado
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (shouldHttpError) {
      return {
        ok: false,
        status: shouldHttpError.status || 500,
        data: shouldHttpError.data || null,
      };
    }

    if (shouldMalform) {
      return {
        ok: true,
        status: 200,
        data: null, // JSON inválido simulado
      };
    }

    if (!shouldSucceed) {
      return {
        ok: false,
        status: 400,
        data: { error: "INVALID_REQUEST", message: "Dados inválidos" },
      };
    }

    // Resposta de sucesso padrão
    if (request.url?.includes("/links")) {
      return {
        ok: true,
        status: 200,
        data: {
          url: "https://checkout.infinitepay.io/test-link",
          invoice_slug: `INV-${Date.now()}`,
          access_token: "SECRET-TOKEN-DO-NOT-LEAK",
          card_number: "4111111111111111",
        },
      };
    }

    if (request.url?.includes("/payment_check")) {
      return {
        ok: true,
        status: 200,
        data: {
          success: true,
          paid: true,
          amount: 1000,
          paid_amount: 1000,
          installments: 1,
          capture_method: "pix",
        },
      };
    }

    return {
      ok: true,
      status: 200,
      data: {},
    };
  }

  return {
    call: fakeRequest,
    callLog,
    getCalls: () => callLog,
    clearLog: () => { callLog.length = 0; },
  };
}

module.exports = { createFakeTransport };
