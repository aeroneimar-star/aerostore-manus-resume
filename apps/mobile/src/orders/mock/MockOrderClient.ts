import type { OrderClient } from '../OrderClient';
import type {
  CreateOrderPayload,
  CreateOrderResponse,
  GetOrderResponse,
  ListOrdersResponse,
  Order,
  OrderDetail,
  OrderEvent,
  OrderItem,
  OrderStatus,
  OrderSummary,
} from '../contracts';
import { ORDER_API_VERSION } from '../contracts';
import { OrderClientError } from '../OrderClientError';
// Use global crypto.randomUUID (available in React Native 0.86+)
const randomUUID = (): string => {
  // Simple UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

type MockScenario =
  | 'success'
  | 'stock_unavailable'
  | 'invalid_address'
  | 'invalid_store'
  | 'session_expired'
  | 'internal_error'
  | 'network_error';

const META = { api_version: ORDER_API_VERSION };

function iso(offsetMs = 0): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function generateOrderNumber(): string {
  return `PED-${Math.floor(Math.random() * 9000 + 1000)}`;
}

export class MockOrderClient implements OrderClient {
  private scenario: MockScenario;
  private latencyMs: number;
  private orders: OrderDetail[] = [];

  constructor(options: { scenario?: MockScenario; latencyMs?: number } = {}) {
    this.scenario = options.scenario || 'success';
    this.latencyMs = options.latencyMs || 0;
  }

  setScenario(s: MockScenario): void { this.scenario = s; }
  setLatency(ms: number): void { this.latencyMs = ms; }

  private wait(): Promise<void> {
    return new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async createOrder(payload: CreateOrderPayload): Promise<CreateOrderResponse> {
    await this.wait();

    if (this.scenario === 'session_expired') {
      throw new OrderClientError('UNAUTHORIZED', 'Sua sessao expirou.', { status: 401 });
    }
    if (this.scenario === 'stock_unavailable') {
      throw new OrderClientError('STOCK_UNAVAILABLE', 'Estoque insuficiente para um dos itens.', { status: 400 });
    }
    if (this.scenario === 'invalid_address') {
      throw new OrderClientError('ADDRESS_NOT_FOUND', 'Endereco de entrega nao encontrado.', { status: 400 });
    }
    if (this.scenario === 'invalid_store') {
      throw new OrderClientError('PICKUP_STORE_INVALID', 'Loja de retirada invalida.', { status: 400 });
    }
    if (this.scenario === 'internal_error') {
      throw new OrderClientError('INTERNAL_ERROR', 'Erro interno do servidor.', { status: 500 });
    }
    if (this.scenario === 'network_error') {
      throw new OrderClientError('NETWORK_ERROR', 'Nao foi possivel conectar ao servidor.');
    }

    const orderId = randomUUID();
    const order: Order = {
      id: orderId,
      order_number: generateOrderNumber(),
      fulfillment_type: payload.fulfillment_type,
      address_id: payload.address_id || null,
      pickup_store_id: payload.pickup_store_id || null,
      shipping_provider: null,
      shipping_service_code: null,
      shipping_quote_cents: 0,
      subtotal_cents: 18000,
      total_cents: 18000,
      status: 'READY_FOR_PAYMENT',
      created_at: iso(),
      updated_at: iso(),
      expires_at: iso(-15 * 60 * 1000),
      failed_reason: null,
    };

    const items: OrderItem[] = [
      {
        id: randomUUID(),
        order_id: orderId,
        product_id: 'prod-1',
        variant_id: 'var-1',
        quantity: 1,
        unit_price_cents: 8990,
        effective_unit_price_cents: 8990,
        line_total_cents: 8990,
        availability_status: 'AVAILABLE',
      },
      {
        id: randomUUID(),
        order_id: orderId,
        product_id: 'prod-2',
        variant_id: 'var-2',
        quantity: 1,
        unit_price_cents: 9010,
        effective_unit_price_cents: 9010,
        line_total_cents: 9010,
        availability_status: 'AVAILABLE',
      },
    ];

    const events: OrderEvent[] = [
      {
        id: randomUUID(),
        order_id: orderId,
        event_type: 'ORDER_CREATED',
        details_json: JSON.stringify({ fulfillment_type: payload.fulfillment_type }),
        created_at: iso(),
      },
      {
        id: randomUUID(),
        order_id: orderId,
        event_type: 'STOCK_RESERVED',
        details_json: JSON.stringify({ items: items.length }),
        created_at: iso(-1000),
      },
      {
        id: randomUUID(),
        order_id: orderId,
        event_type: 'READY_FOR_PAYMENT',
        details_json: null,
        created_at: iso(-500),
      },
    ];

    const detail: OrderDetail = { order, items, events };
    this.orders.push(detail);

    return { success: true, data: detail, meta: META };
  }

  async listOrders(): Promise<ListOrdersResponse> {
    await this.wait();

    if (this.scenario === 'session_expired') {
      throw new OrderClientError('UNAUTHORIZED', 'Sua sessao expirou.', { status: 401 });
    }
    if (this.scenario === 'network_error') {
      throw new OrderClientError('NETWORK_ERROR', 'Nao foi possivel conectar ao servidor.');
    }

    const summaries: OrderSummary[] = this.orders.map((d) => ({
      id: d.order.id,
      order_number: d.order.order_number,
      fulfillment_type: d.order.fulfillment_type,
      status: d.order.status as OrderStatus,
      subtotal_cents: d.order.subtotal_cents,
      total_cents: d.order.total_cents,
      items_count: d.items.length,
      created_at: d.order.created_at,
    }));

    return { success: true, data: summaries, meta: META };
  }

  async getOrder(orderId: string): Promise<GetOrderResponse> {
    await this.wait();

    if (this.scenario === 'session_expired') {
      throw new OrderClientError('UNAUTHORIZED', 'Sua sessao expirou.', { status: 401 });
    }

    const detail = this.orders.find((o) => o.order.id === orderId);
    if (!detail) {
      throw new OrderClientError('ORDER_NOT_FOUND', 'Pedido nao encontrado.', { status: 404 });
    }

    return { success: true, data: detail, meta: META };
  }
}
