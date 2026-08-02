import type { FulfillmentClient } from '../FulfillmentClient';
import type {
  CurrentFulfillment,
  DeliverySummary,
  DeliverySummaryResponse,
  FulfillmentOptions,
  FulfillmentOptionsResponse,
  FulfillmentType,
  PickupStore,
  SetFulfillmentPayload,
  ShippingQuote,
  ShippingQuoteRequest,
  ShippingQuoteResponse,
} from '../contracts';
import { FulfillmentClientError } from '../FulfillmentClientError';
import { FULFILLMENT_API_VERSION } from '../contracts';

type MockScenario = 'success' | 'empty' | 'pickup_only' | 'delivery_only' | 'no_store_eligible' | 'shipping_error' | 'internal_error' | 'session_expired' | 'version_conflict';

interface MockFulfillmentClientOptions {
  scenario?: MockScenario;
  latencyMs?: number;
  cartSubtotalCents?: number;
}

const META: { api_version: typeof FULFILLMENT_API_VERSION } = { api_version: FULFILLMENT_API_VERSION };

function iso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

const MOCK_STORES: PickupStore[] = [
  {
    id: 'store-vila',
    name: 'AEROSTORE Vila',
    city: 'Ribeirao Preto',
    state: 'SP',
    addressSummary: 'R. da Vila, 100 - Centro',
    distanceKm: 2.3,
    recommended: true,
    availabilityStatus: 'AVAILABLE',
    openingHours: '10h-18h',
  },
  {
    id: 'store-centro',
    name: 'AEROSTORE Centro',
    city: 'Ribeirao Preto',
    state: 'SP',
    addressSummary: 'Av. Independencia, 200 - Centro',
    distanceKm: 5.1,
    recommended: false,
    availabilityStatus: 'AVAILABLE',
    openingHours: '10h-20h',
  },
  {
    id: 'store-sao-paulo',
    name: 'AEROSTORE SP',
    city: 'Sao Paulo',
    state: 'SP',
    addressSummary: 'R. Oscar Freire, 300 - Jardim Paulista',
    distanceKm: 320,
    recommended: false,
    availabilityStatus: 'INSUFFICIENT_STOCK',
    openingHours: '10h-21h',
  },
];

export class MockFulfillmentClient implements FulfillmentClient {
  private scenario: MockScenario;
  private latencyMs: number;
  private cartSubtotalCents: number;
  private currentFulfillment: CurrentFulfillment;
  private failConfig: { code: string; status: number } | null = null;

  constructor(options: MockFulfillmentClientOptions = {}) {
    this.scenario = options.scenario || 'success';
    this.latencyMs = options.latencyMs ?? 0;
    this.cartSubtotalCents = options.cartSubtotalCents ?? 18000;
    this.currentFulfillment = {
      fulfillmentType: null,
      addressId: null,
      addressSummary: null,
      pickupStoreId: null,
      pickupStoreSummary: null,
      shippingProvider: null,
      shippingServiceCode: null,
      shippingQuoteCents: null,
      shippingQuoteCurrency: null,
      shippingQuoteExpiresAt: null,
      shippingStatus: 'NOT_APPLICABLE',
      version: 1,
      updatedAt: iso(),
    };
  }

  setScenario(s: MockScenario): void { this.scenario = s; }
  setLatency(ms: number): void { this.latencyMs = ms; }
  setSubtotal(cents: number): void { this.cartSubtotalCents = cents; }
  setFail(code: string, status: number): void { this.failConfig = { code, status }; }
  clearFail(): void { this.failConfig = null; }
  reset(): void { this.clearFail(); this.currentFulfillment = { ...this.currentFulfillment, fulfillmentType: null }; }

  private checkFail(): void {
    if (this.failConfig) {
      throw { status: this.failConfig.status, code: this.failConfig.code, message: this.failConfig.code };
    }
  }

  private getStores(): PickupStore[] {
    if (this.scenario === 'no_store_eligible') {
      return MOCK_STORES.map((s) => ({ ...s, availabilityStatus: 'INSUFFICIENT_STOCK' as const, recommended: false }));
    }
    if (this.scenario === 'pickup_only') {
      return MOCK_STORES.filter((s) => s.availabilityStatus === 'AVAILABLE');
    }
    if (this.scenario === 'delivery_only') {
      return [];
    }
    return MOCK_STORES;
  }

  async getFulfillmentOptions(): Promise<FulfillmentOptionsResponse> {
    await wait(this.latencyMs);
    this.checkFail();
    if (this.scenario === 'internal_error') {
      throw new FulfillmentClientError('INTERNAL_ERROR', 'Erro interno simulado.');
    }
    if (this.scenario === 'session_expired') {
      throw { status: 401, code: 'APP_SESSION_INVALID', message: 'Sessao expirada.' };
    }

    const stores = this.getStores();
    const availableTypes: FulfillmentType[] = ['DELIVERY'];
    if (stores.some((s) => s.availabilityStatus === 'AVAILABLE')) {
      availableTypes.push('PICKUP');
    }

    const options: FulfillmentOptions = {
      currentFulfillment: this.currentFulfillment,
      availableFulfillmentTypes: availableTypes,
      pickupStores: stores,
      availableAddresses: [
        { id: 'addr-1', label: 'Casa', city: 'Ribeirao Preto', state: 'SP', isDefault: true },
        { id: 'addr-2', label: 'Trabalho', city: 'Ribeirao Preto', state: 'SP', isDefault: false },
        { id: 'addr-3', label: 'Sao Paulo', city: 'Sao Paulo', state: 'SP', isDefault: false },
      ],
    };

    return { success: true, data: options, meta: META };
  }

  async setFulfillment(payload: SetFulfillmentPayload): Promise<FulfillmentOptionsResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    if (this.scenario === 'version_conflict') {
      throw new FulfillmentClientError('FULFILLMENT_VERSION_CONFLICT', 'Fulfillment foi modificado.', { status: 409 });
    }

    if (payload.fulfillment_type === 'PICKUP' && !payload.pickup_store_id) {
      throw new FulfillmentClientError('INVALID_PICKUP_STORE', 'Loja de retirada e obrigatoria.', { status: 400 });
    }
    if (payload.fulfillment_type === 'DELIVERY' && !payload.address_id) {
      throw new FulfillmentClientError('ADDRESS_REQUIRED', 'Endereco de entrega e obrigatorio.', { status: 400 });
    }

    this.currentFulfillment = {
      ...this.currentFulfillment,
      fulfillmentType: payload.fulfillment_type,
      pickupStoreId: payload.pickup_store_id || null,
      pickupStoreSummary: payload.pickup_store_id ? 'AEROSTORE Vila - Ribeirao Preto' : null,
      addressId: payload.address_id || null,
      addressSummary: payload.address_id ? 'R. Saldanha Marinho, 807 - Centro, Ribeirao Preto' : null,
      version: this.currentFulfillment.version + 1,
      updatedAt: iso(),
    };

    // Return updated options
    const stores = this.getStores();
    const availableTypes: FulfillmentType[] = ['DELIVERY'];
    if (stores.some((s) => s.availabilityStatus === 'AVAILABLE')) {
      availableTypes.push('PICKUP');
    }

    return {
      success: true,
      data: {
        currentFulfillment: this.currentFulfillment,
        availableFulfillmentTypes: availableTypes,
        pickupStores: stores,
        availableAddresses: [
          { id: 'addr-1', label: 'Casa', city: 'Ribeirao Preto', state: 'SP', isDefault: true },
          { id: 'addr-2', label: 'Trabalho', city: 'Ribeirao Preto', state: 'SP', isDefault: false },
          { id: 'addr-3', label: 'Sao Paulo', city: 'Sao Paulo', state: 'SP', isDefault: false },
        ],
      },
      meta: META,
    };
  }

  async requestShippingQuote(payload: ShippingQuoteRequest): Promise<ShippingQuoteResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    if (this.scenario === 'shipping_error') {
      throw new FulfillmentClientError('SHIPPING_DATA_INCOMPLETE', 'Dados logisticos incompletos para cotação.', { status: 400 });
    }

    // Simulate local delivery for Ribeirao Preto
    const quote: ShippingQuote = {
      provider: 'local',
      serviceCode: 'LOCAL_DELIVERY',
      serviceName: this.cartSubtotalCents >= 15000 ? 'Entrega Gratuita' : 'Entrega Fixa',
      priceCents: this.cartSubtotalCents >= 15000 ? 0 : 1000,
      estimatedMinDays: 0,
      estimatedMaxDays: 2,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      warnings: [],
    };

    return { success: true, data: { shippingQuote: quote }, meta: META };
  }

  async getDeliverySummary(): Promise<DeliverySummaryResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    const shippingPriceCents = this.currentFulfillment.fulfillmentType === 'PICKUP'
      ? 0
      : this.cartSubtotalCents >= 15000 ? 0 : 1000;

    const shippingMethod = this.currentFulfillment.fulfillmentType === 'PICKUP'
      ? 'Retirada na loja'
      : this.cartSubtotalCents >= 15000 ? 'Entrega gratuita (Ribeirao Preto)' : 'Entrega fixa (R$ 10,00)';

    const estimatedDelivery = this.currentFulfillment.fulfillmentType === 'PICKUP'
      ? 'Pronto em 2h'
      : '2 a 5 dias uteis';

    const blockingIssues: string[] = [];
    if (!this.currentFulfillment.fulfillmentType) {
      blockingIssues.push('Selecione o modo de entrega ou retirada.');
    }
    if (this.currentFulfillment.fulfillmentType === 'DELIVERY' && !this.currentFulfillment.addressId) {
      blockingIssues.push('Selecione um endereco de entrega.');
    }
    if (this.currentFulfillment.fulfillmentType === 'PICKUP' && !this.currentFulfillment.pickupStoreId) {
      blockingIssues.push('Selecione uma loja para retirada.');
    }

    const summary: DeliverySummary = {
      fulfillmentType: this.currentFulfillment.fulfillmentType,
      addressSummary: this.currentFulfillment.addressSummary,
      pickupStoreSummary: this.currentFulfillment.pickupStoreSummary,
      shippingMethod,
      shippingPriceCents,
      shippingPriceFormatted: formatBrl(shippingPriceCents),
      estimatedDelivery,
      cartSubtotalCents: this.cartSubtotalCents,
      cartSubtotalFormatted: formatBrl(this.cartSubtotalCents),
      estimatedTotalCents: this.cartSubtotalCents + shippingPriceCents,
      estimatedTotalFormatted: formatBrl(this.cartSubtotalCents + shippingPriceCents),
      blockingIssues,
      canContinueToCheckoutFuture: blockingIssues.length === 0,
      updatedAt: iso(),
    };

    return { success: true, data: summary, meta: META };
  }
}
