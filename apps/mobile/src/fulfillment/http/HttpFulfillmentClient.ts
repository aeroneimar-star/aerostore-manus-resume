import { withSessionRefresh } from '@/app-auth/SessionCoordinator';
import { FulfillmentClientError } from '../FulfillmentClientError';
import type { FulfillmentClient } from '../FulfillmentClient';
import {
  FULFILLMENT_API_VERSION,
  type FulfillmentApiMeta,
  type FulfillmentErrorCode,
  type FulfillmentOptionsResponse,
  type SetFulfillmentPayload,
  type ShippingQuoteRequest,
  type ShippingQuoteResponse,
  type DeliverySummaryResponse,
} from '../contracts';

const ERROR_CODES: Set<FulfillmentErrorCode> = new Set([
  'NO_ACTIVE_CART', 'INVALID_FULFILLMENT_TYPE', 'INVALID_PICKUP_STORE',
  'ADDRESS_REQUIRED', 'ADDRESS_NOT_FOUND', 'FULFILLMENT_VERSION_CONFLICT',
  'CART_VERSION_CONFLICT', 'PICKUP_NOT_AVAILABLE', 'SHIPPING_DATA_INCOMPLETE',
  'SHIPPING_QUOTE_EXPIRED', 'SHIPPING_QUOTE_FAILED', 'SHIPPING_PROVIDER_UNAVAILABLE',
  'FREE_LOCAL_DELIVERY', 'FIXED_LOCAL_DELIVERY', 'INTERNAL_ERROR',
  'APP_SESSION_INVALID', 'APP_ACCESS_NOT_APPROVED',
]);

type AuthorizedRunner = <T>(operation: (accessToken: string, deviceId: string) => Promise<T>) => Promise<T>;

interface HttpFulfillmentClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  authorizedRunner?: AuthorizedRunner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isMeta(value: unknown): value is FulfillmentApiMeta {
  return isRecord(value) && value.api_version === FULFILLMENT_API_VERSION;
}

function isFulfillmentType(value: unknown): boolean {
  return value === 'PICKUP' || value === 'DELIVERY';
}

function isShipmentStatus(value: unknown): boolean {
  return ['NOT_SHIPPED', 'AWAITING_PICKUP', 'IN_TRANSIT', 'SHIPPED', 'NOT_APPLICABLE'].includes(value as string);
}

function isFulfillmentOptionsResponse(value: unknown): value is FulfillmentOptionsResponse {
  if (!isRecord(value) || value.success !== true || !isMeta(value.meta)) return false;
  const data = value.data as Record<string, unknown>;
  if (!isRecord(data)) return false;
  const cf = data.currentFulfillment;
  if (!isRecord(cf)) return false;
  return isFulfillmentType(cf.fulfillmentType) || cf.fulfillmentType === null;
}

function isShippingQuoteResponse(value: unknown): value is ShippingQuoteResponse {
  if (!isRecord(value) || value.success !== true || !isMeta(value.meta)) return false;
  const data = value.data as Record<string, unknown>;
  if (!isRecord(data)) return false;
  const sq = data.shippingQuote;
  if (!isRecord(sq)) return false;
  return typeof sq.provider === 'string' && typeof sq.serviceCode === 'string'
    && typeof sq.priceCents === 'number' && typeof sq.expiresAt === 'string';
}

function isDeliverySummaryResponse(value: unknown): value is DeliverySummaryResponse {
  if (!isRecord(value) || value.success !== true || !isMeta(value.meta)) return false;
  const data = value.data as Record<string, unknown>;
  if (!isRecord(data)) return false;
  return typeof data.fulfillmentType === 'string' || data.fulfillmentType === null
    && typeof data.canContinueToCheckoutFuture === 'boolean';
}

export class HttpFulfillmentClient implements FulfillmentClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authorizedRunner: AuthorizedRunner;

  constructor(options: HttpFulfillmentClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!this.baseUrl) throw new FulfillmentClientError('INTERNAL_ERROR', 'A URL da API nao foi configurada.');
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
          method, headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          const rawCode = isRecord(payload) && (typeof payload.error === 'string' ? payload.error : isRecord(payload.error) ? payload.error.code : '') || '';
          const code = ERROR_CODES.has(rawCode as FulfillmentErrorCode) ? rawCode as FulfillmentErrorCode : response.status === 401 ? 'APP_SESSION_INVALID' : response.status === 403 ? 'APP_ACCESS_NOT_APPROVED' : 'INTERNAL_ERROR';
          const message = isRecord(payload) && (typeof payload.message === 'string' ? payload.message : isRecord(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : '') || 'Erro desconhecido.';
          throw new FulfillmentClientError(code, message, { status: response.status });
        }
        if (validate && !validate(payload)) throw new FulfillmentClientError('INTERNAL_ERROR', 'Resposta invalida do servidor.');
        return payload as T;
      } catch (error) {
        if (error instanceof FulfillmentClientError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw new FulfillmentClientError('INTERNAL_ERROR', 'A requisicao excedeu o tempo de resposta.');
        throw new FulfillmentClientError('INTERNAL_ERROR', 'Nao foi possivel acessar a API.');
      } finally { clearTimeout(timeout); }
    });
  }

  async getFulfillmentOptions(): Promise<FulfillmentOptionsResponse> {
    return this.request('GET', '/app/v1/cart/fulfillment-options', undefined, isFulfillmentOptionsResponse);
  }

  async setFulfillment(payload: SetFulfillmentPayload): Promise<FulfillmentOptionsResponse> {
    return this.request('PUT', '/app/v1/cart/fulfillment', payload, isFulfillmentOptionsResponse);
  }

  async requestShippingQuote(payload: ShippingQuoteRequest): Promise<ShippingQuoteResponse> {
    return this.request('POST', '/app/v1/cart/shipping-quote', payload, isShippingQuoteResponse);
  }

  async getDeliverySummary(): Promise<DeliverySummaryResponse> {
    return this.request('GET', '/app/v1/cart/delivery-summary', undefined, isDeliverySummaryResponse);
  }
}
