import { withSessionRefresh } from '@/app-auth/SessionCoordinator';
import { OrderClientError } from '../OrderClientError';
import type { OrderClient } from '../OrderClient';
import {
  ORDER_API_VERSION,
  type OrderApiMeta,
  type OrderErrorCode,
  type CreateOrderPayload,
  type CreateOrderResponse,
  type ListOrdersResponse,
  type GetOrderResponse,
  type Order,
  type OrderDetail,
  type OrderItem,
  type OrderEvent,
  type OrderSummary,
} from '../contracts';

const ERROR_CODES: Set<OrderErrorCode> = new Set([
  'UNAUTHORIZED',
  'VALIDATION_ERROR',
  'STOCK_UNAVAILABLE',
  'FULFILLMENT_INVALID',
  'ADDRESS_NOT_FOUND',
  'PICKUP_STORE_INVALID',
  'ORDER_NOT_FOUND',
  'ORDER_ALREADY_EXISTS',
  'ORDER_CREATION_FAILED',
  'INTERNAL_ERROR',
]);

type AuthorizedRunner = <T>(operation: (accessToken: string, deviceId: string) => Promise<T>) => Promise<T>;

interface HttpOrderClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  authorizedRunner?: AuthorizedRunner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMeta(value: unknown): value is OrderApiMeta {
  return isRecord(value) && value.api_version === ORDER_API_VERSION;
}

function isOrderStatus(value: unknown): boolean {
  const valid = [
    'STOCK_RESERVED', 'READY_FOR_PAYMENT', 'PAYMENT_PENDING', 'PAYMENT_APPROVED',
    'PAYMENT_DECLINED', 'FULFILLING', 'SHIPPED', 'DELIVERED', 'COMPLETED',
    'CANCELLED', 'FAILED', 'EXPIRED',
  ];
  return valid.includes(value as string);
}

function isFulfillmentType(value: unknown): boolean {
  return value === 'PICKUP' || value === 'DELIVERY';
}

function isOrder(value: unknown): value is Order {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.order_number === 'string'
    && isFulfillmentType(value.fulfillment_type)
    && isOrderStatus(value.status)
    && typeof value.subtotal_cents === 'number'
    && typeof value.total_cents === 'number'
    && typeof value.created_at === 'string';
}

function isOrderItem(value: unknown): value is OrderItem {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.order_id === 'string'
    && typeof value.product_id === 'string'
    && typeof value.variant_id === 'string'
    && typeof value.quantity === 'number'
    && typeof value.line_total_cents === 'number';
}

function isOrderEvent(value: unknown): value is OrderEvent {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.order_id === 'string'
    && typeof value.event_type === 'string';
}

/**
 * Envelope real do backend: { ok: true, data }
 * O cliente adiciona o meta wrapper para manter a interface consistente.
 */
function wrapResponse(data: unknown): { success: true; data: unknown; meta: OrderApiMeta } {
  return {
    success: true,
    data,
    meta: { api_version: ORDER_API_VERSION },
  };
}

function isCreateOrderResponse(value: unknown): value is CreateOrderResponse {
  if (!isRecord(value)) return false;
  // Accept both envelope formats
  const innerData = value.ok === true ? value.data : (value.success === true ? value.data : null);
  if (!isRecord(innerData)) return false;
  return isOrder(innerData.order) && Array.isArray(innerData.items) && innerData.items.every(isOrderItem);
}

function isListOrdersResponse(value: unknown): value is ListOrdersResponse {
  if (!isRecord(value)) return false;
  const innerData = value.ok === true ? value.data : (value.success === true ? value.data : null);
  if (!Array.isArray(innerData)) return false;
  return innerData.every((item: unknown) => {
    if (!isRecord(item)) return false;
    return typeof item.id === 'string' && typeof item.order_number === 'string' && isOrderStatus(item.status);
  });
}

function isGetOrderResponse(value: unknown): value is GetOrderResponse {
  if (!isRecord(value)) return false;
  const innerData = value.ok === true ? value.data : (value.success === true ? value.data : null);
  if (!isRecord(innerData)) return false;
  return isOrder(innerData.order) && Array.isArray(innerData.items) && innerData.items.every(isOrderItem)
    && Array.isArray(innerData.events) && innerData.events.every(isOrderEvent);
}

function mapErrorStatus(status: number, rawCode: string): OrderErrorCode {
  switch (status) {
    case 401: return 'UNAUTHORIZED';
    case 403: return 'UNAUTHORIZED';
    case 404: return 'ORDER_NOT_FOUND';
    case 409: return 'ORDER_ALREADY_EXISTS';
    case 400:
      return ERROR_CODES.has(rawCode as OrderErrorCode) ? rawCode as OrderErrorCode : 'VALIDATION_ERROR';
    case 500: return 'INTERNAL_ERROR';
    default: return 'INTERNAL_ERROR';
  }
}

export class HttpOrderClient implements OrderClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authorizedRunner: AuthorizedRunner;

  constructor(options: HttpOrderClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!this.baseUrl) throw new OrderClientError('INTERNAL_ERROR', 'A URL da API nao foi configurada.');
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.authorizedRunner = options.authorizedRunner ?? ((op) => (async () => {
      const result = await withSessionRefresh(async (token, deviceId) => op(token, deviceId));
      return result.value;
    })());
  }

  private async request<T>(method: string, path: string, body?: unknown, validate?: (value: unknown) => value is T): Promise<T> {
    return this.authorizedRunner(async (accessToken, deviceId) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-device-id': deviceId,
        };
        const response = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const payload: unknown = await response.json().catch(() => ({}));

        if (!response.ok) {
          const rawCode: string = isRecord(payload) && (
            typeof payload.error === 'string' ? payload.error
              : isRecord(payload.error) && typeof payload.error.code === 'string' ? payload.error.code : ''
          ) || '';
          const code = mapErrorStatus(response.status, rawCode);
          const message = isRecord(payload) && (
            typeof payload.message === 'string' ? payload.message
              : isRecord(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : ''
          ) || 'Erro desconhecido.';
          throw new OrderClientError(code, message, { status: response.status });
        }

        if (validate && !validate(payload)) {
          throw new OrderClientError('INVALID_RESPONSE', 'Resposta invalida do servidor.');
        }
        return payload as T;
      } catch (error) {
        if (error instanceof OrderClientError) throw error;
        if (error instanceof Error && error.name === 'AbortError') {
          throw new OrderClientError('TIMEOUT_ERROR', 'A requisicao excedeu o tempo de resposta.');
        }
        if (error instanceof TypeError || (error && typeof error === 'object' && 'message' in (error as object) && (error as { message: string }).message?.includes('fetch'))) {
          throw new OrderClientError('NETWORK_ERROR', 'Nao foi possivel conectar ao servidor.');
        }
        throw new OrderClientError('NETWORK_ERROR', 'Nao foi possivel acessar a API.');
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  async createOrder(payload: CreateOrderPayload): Promise<CreateOrderResponse> {
    return this.request('POST', '/app/v1/orders', payload, isCreateOrderResponse);
  }

  async listOrders(): Promise<ListOrdersResponse> {
    return this.request('GET', '/app/v1/orders', undefined, isListOrdersResponse);
  }

  async getOrder(orderId: string): Promise<GetOrderResponse> {
    return this.request('GET', `/app/v1/orders/${orderId}`, undefined, isGetOrderResponse);
  }
}
