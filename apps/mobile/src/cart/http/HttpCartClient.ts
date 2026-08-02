import type {
  AddItemPayload,
  CartResponse,
  EmptyCartResponse,
  UpdateQuantityPayload,
} from '../contracts';
import { CartClientError, toCartClientError } from '../CartClientError';

interface HttpCartClientOptions {
  baseUrl: string;
  accessToken?: string;
  timeoutMs?: number;
}

function isCartResponse(value: unknown): value is CartResponse {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (obj.success !== true) return false;
  const data = obj.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') return false;
  return true;
}

function isCartApiError(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return obj.success === false && typeof obj.error === 'object';
}

export class HttpCartClient {
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly timeoutMs: number;

  constructor(options: HttpCartClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs || 15000;
  }

  setAccessToken(token: string | undefined): void {
    this.accessToken = token;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    return headers;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: this.headers(),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok) {
        if (isCartApiError(data)) {
          const errorBody = data as Record<string, unknown>;
          const error = errorBody.error as Record<string, unknown> | undefined;
          throw new CartClientError(
            (error?.code as string) || 'INTERNAL_ERROR',
            (error?.message as string) || 'Erro desconhecido.',
            { status: response.status }
          );
        }
        throw { status: response.status, message: `HTTP ${response.status}` };
      }
      if (!isCartResponse(data)) {
        throw new CartClientError('INTERNAL_ERROR', 'Resposta invalida do servidor.');
      }
      return data as T;
    } catch (error) {
      throw toCartClientError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async getCart(): Promise<CartResponse | EmptyCartResponse> {
    return this.request<CartResponse | EmptyCartResponse>('GET', '/app/v1/cart');
  }

  async addItem(payload: AddItemPayload): Promise<CartResponse> {
    return this.request<CartResponse>('POST', '/app/v1/cart/items', payload);
  }

  async updateQuantity(itemId: string, payload: UpdateQuantityPayload): Promise<CartResponse> {
    return this.request<CartResponse>('PATCH', `/app/v1/cart/items/${itemId}`, payload);
  }

  async removeItem(itemId: string): Promise<CartResponse> {
    return this.request<CartResponse>('DELETE', `/app/v1/cart/items/${itemId}`);
  }

  async clearCart(): Promise<CartResponse> {
    return this.request<CartResponse>('DELETE', '/app/v1/cart');
  }

  async closeCart(): Promise<CartResponse> {
    return this.request<CartResponse>('POST', '/app/v1/cart/close');
  }
}
