"use strict";

/**
 * PaymentOrchestrator
 * Responsável por escolher a estratégia de pagamento e coordenar providers.
 * PaymentEngine permanece responsável pela consistência, estados e eventos.
 */

function createPaymentOrchestrator(options = {}) {
  const providers = new Map();
  const defaultProviderName = options.defaultProvider || "mock";

  function registerProvider(name, provider) {
    if (!provider || typeof provider.createPayment !== "function") {
      throw new Error("INVALID_PROVIDER_INTERFACE");
    }
    providers.set(name, provider);
  }

  function getProvider(name) {
    const provider = providers.get(name || defaultProviderName);
    if (!provider) {
      throw new Error(`PROVIDER_NOT_REGISTERED: ${name || defaultProviderName}`);
    }
    return provider;
  }

  function listProviders() {
    const list = [];
    providers.forEach((provider, name) => {
      list.push({
        name,
        available: true,
        methods: provider.getMethods ? provider.getMethods() : ["PIX", "CREDIT_CARD", "BOLETO"]
      });
    });
    return list;
  }

  async function selectStrategy(ctx) {
    const { channel, provider: preferredProvider } = ctx;

    // Se o cliente especificou um provider, usar esse
    if (preferredProvider && providers.has(preferredProvider)) {
      return {
        providerName: preferredProvider,
        provider: providers.get(preferredProvider),
        strategy: "SELECTED"
      };
    }

    // Estratégia padrão: usar o provider default
    return {
      providerName: defaultProviderName,
      provider: getProvider(defaultProviderName),
      strategy: "DEFAULT"
    };
  }

  async function executePayment(ctx, engine) {
    const { provider, providerName, strategy } = await selectStrategy(ctx);
    const paymentId = ctx.paymentId;

    // Delegar a criação da tentativa ao PaymentEngine (consistência)
    const attempt = await engine.createPaymentAttempt(paymentId);

    return {
      attemptId: attempt.id,
      providerName,
      strategy,
      status: attempt.status,
      gatewayData: attempt.gateway_data ? JSON.parse(attempt.gateway_data) : null
    };
  }

  async function cancelPayment(providerName, paymentId, reason) {
    const provider = getProvider(providerName);
    const result = await provider.cancelPayment(paymentId, reason);
    return result;
  }

  async function queryPayment(providerName, providerPaymentId) {
    const provider = getProvider(providerName);
    const result = await provider.queryPayment(providerPaymentId);
    return result;
  }

  return {
    registerProvider,
    getProvider,
    listProviders,
    selectStrategy,
    executePayment,
    cancelPayment,
    queryPayment
  };
}

module.exports = { createPaymentOrchestrator };
