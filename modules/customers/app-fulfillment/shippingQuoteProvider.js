"use strict";

/**
 * ShippingQuoteProvider — interface para cotacao de frete externo
 *
 * Implementacoes:
 * - MelhorEnvioShippingProvider (requer credenciais explicitas)
 * - MockShippingProvider (testes e smoke)
 */

class ShippingQuoteError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "ShippingQuoteError";
    this.code = code;
    this.status = status || 500;
  }
}

const SHIPPING_QUOTE_TTL_MS = 15 * 60 * 1000; // 15 minutos

function iso(date) { return date.toISOString(); }
function clock() { return new Date(); }

// --- Interface abstrata ---
class ShippingQuoteProvider {
  async quote(/* input */) { throw new Error("NOT_IMPLEMENTED"); }
}

// --- Melhor Envio ---
class MelhorEnvioShippingProvider extends ShippingQuoteProvider {
  constructor(options = {}) {
    super();
    this.token = options.token || process.env.MELHOR_ENVIO_TOKEN || "";
    this.apiUrl = options.apiUrl || process.env.MELHOR_ENVIO_API_URL || "https://sandbox.melhorenvio.com.br/api/v2";
    this.fetchImpl = options.fetchImpl || null;
    this.timeoutMs = options.timeoutMs || 8000;
  }

  get isConfigured() {
    return Boolean(this.token && this.token.length >= 16);
  }

  async quote(input = {}) {
    if (!this.isConfigured) {
      throw new ShippingQuoteError("SHIPPING_PROVIDER_UNCONFIGURED", 503, "Servico de frete externo nao configurado. Contate o suporte.");
    }
    if (!this.fetchImpl) {
      throw new ShippingQuoteError("SHIPPING_PROVIDER_UNAVAILABLE", 503, "Servico de frete externo indisponivel no momento.");
    }

    // Validar dados obrigatorios
    const missing = [];
    if (!input.originPostalCode) missing.push("originPostalCode");
    if (!input.destinationPostalCode) missing.push("destinationPostalCode");
    if (!input.items || input.items.length === 0) missing.push("items");
    if (missing.length > 0) {
      throw new ShippingQuoteError("SHIPPING_DATA_INCOMPLETE", 400, `Dados logisticos incompletos: ${missing.join(", ")}.`);
    }

    // Verificar se itens possuem peso/dimensoes
    const incompleteItems = input.items.filter(item => !item.weight || !item.width || !item.height || !item.length);
    if (incompleteItems.length > 0) {
      throw new ShippingQuoteError("SHIPPING_DATA_INCOMPLETE", 400, "Produtos sem peso ou dimensoes suficientes para cotação.");
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.apiUrl}/me/shipment/calculate`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.token}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            from: { postal_code: input.originPostalCode },
            to: { postal_code: input.destinationPostalCode },
            products: input.items.map(item => ({
              weight: item.weight,
              height: item.height,
              width: item.width,
              length: item.length,
              insurance_value: item.declaredValue || 0,
              quantity: item.quantity || 1
            }))
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          throw new ShippingQuoteError("SHIPPING_QUOTE_FAILED", 502, "Falha ao obter cotação de frete.");
        }
        const data = await response.json();
        if (!data || !Array.isArray(data)) {
          throw new ShippingQuoteError("SHIPPING_QUOTE_FAILED", 502, "Resposta de cotação invalida.");
        }
        // Retornar primeira opcao valida
        const firstOption = data[0];
        if (!firstOption || !firstOption.price) {
          throw new ShippingQuoteError("SHIPPING_QUOTE_FAILED", 502, "Nenhuma opcao de frete disponivel.");
        }
        const expiresAt = iso(new Date(Date.now() + SHIPPING_QUOTE_TTL_MS));
        return {
          provider: "melhor_envio",
          serviceCode: firstOption.company?.id ? `${firstOption.company.id}-${firstOption.id}` : "default",
          serviceName: firstOption.name || "Frete padrao",
          priceCents: Math.round(Number(firstOption.price) * 100),
          estimatedMinDays: Number(firstOption.delivery_range?.min || 1),
          estimatedMaxDays: Number(firstOption.delivery_range?.max || 5),
          expiresAt,
          warnings: []
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      if (error instanceof ShippingQuoteError) throw error;
      if (error && error.name === "AbortError") {
        throw new ShippingQuoteError("SHIPPING_QUOTE_TIMEOUT", 504, "Cotação de frete excedeu o tempo de resposta.");
      }
      throw new ShippingQuoteError("SHIPPING_QUOTE_FAILED", 502, "Falha ao obter cotação de frete.");
    }
  }
}

// --- Mock (para testes e smoke) ---
class MockShippingProvider extends ShippingQuoteProvider {
  constructor(options = {}) {
    super();
    this.configured = options.configured !== false;
    this.mockQuote = options.mockQuote || null;
    this.failMode = options.failMode || null; // "timeout", "error", "incomplete"
  }

  get isConfigured() { return this.configured; }

  async quote(input = {}) {
    if (!this.configured) {
      throw new ShippingQuoteError("SHIPPING_PROVIDER_UNCONFIGURED", 503, "Servico de frete externo nao configurado.");
    }
    if (this.failMode === "timeout") {
      throw new ShippingQuoteError("SHIPPING_QUOTE_TIMEOUT", 504, "Cotação excedeu o tempo de resposta.");
    }
    if (this.failMode === "error") {
      throw new ShippingQuoteError("SHIPPING_QUOTE_FAILED", 502, "Falha ao obter cotação.");
    }
    if (this.failMode === "incomplete") {
      throw new ShippingQuoteError("SHIPPING_DATA_INCOMPLETE", 400, "Dados logisticos incompletos.");
    }
    if (this.mockQuote) {
      return { ...this.mockQuote, expiresAt: iso(new Date(Date.now() + SHIPPING_QUOTE_TTL_MS)) };
    }
    // Fallback: cotacao mock padrao
    return {
      provider: "mock",
      serviceCode: "mock-standard",
      serviceName: "Entrega padrao (simulado)",
      priceCents: 2500,
      estimatedMinDays: 3,
      estimatedMaxDays: 7,
      expiresAt: iso(new Date(Date.now() + SHIPPING_QUOTE_TTL_MS)),
      warnings: ["Cotação simulada para desenvolvimento."]
    };
  }
}

module.exports = {
  ShippingQuoteError,
  ShippingQuoteProvider,
  MelhorEnvioShippingProvider,
  MockShippingProvider,
  SHIPPING_QUOTE_TTL_MS
};
