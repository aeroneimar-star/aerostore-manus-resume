import { OrderClientError } from './OrderClientError';
import { HttpOrderClient } from './http/HttpOrderClient';
import { MockOrderClient } from './mock/MockOrderClient';
import type { OrderClient } from './contracts';

export type OrderSource = 'mock' | 'http';

const readOrderSource = (value: string | undefined): OrderSource => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return process.env.EXPO_PUBLIC_APP_AUTH_SOURCE === 'visual' ? 'mock' : 'http';
  if (normalized === 'mock' || normalized === 'http') return normalized;
  throw new OrderClientError('INTERNAL_ERROR', 'EXPO_PUBLIC_ORDER_SOURCE deve ser mock ou http.');
};

export function createOrderClient(): OrderClient {
  const source = readOrderSource(process.env.EXPO_PUBLIC_ORDER_SOURCE);
  if (source === 'mock') return new MockOrderClient({ scenario: 'success' });
  const baseUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL?.trim() ?? '';
  if (!baseUrl) {
    const unavailable = async () => { throw new OrderClientError('INTERNAL_ERROR', 'A API de pedidos nao foi configurada.'); };
    return {
      createOrder: unavailable,
      listOrders: unavailable,
      getOrder: unavailable,
    } as unknown as OrderClient;
  }
  return new HttpOrderClient({ baseUrl });
}

export const orderClient = createOrderClient();
