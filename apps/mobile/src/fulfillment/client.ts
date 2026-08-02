import { FulfillmentClientError } from './FulfillmentClientError';
import { HttpFulfillmentClient } from './http/HttpFulfillmentClient';
import { MockFulfillmentClient } from './mock/MockFulfillmentClient';
import type { FulfillmentClient } from './contracts';

export type FulfillmentSource = 'mock' | 'http';

const readFulfillmentSource = (value: string | undefined): FulfillmentSource => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return process.env.EXPO_PUBLIC_APP_AUTH_SOURCE === 'visual' ? 'mock' : 'http';
  if (normalized === 'mock' || normalized === 'http') return normalized;
  throw new FulfillmentClientError('INTERNAL_ERROR', 'EXPO_PUBLIC_FULFILLMENT_SOURCE deve ser mock ou http.');
};

export function createFulfillmentClient(): FulfillmentClient {
  const source = readFulfillmentSource(process.env.EXPO_PUBLIC_FULFILLMENT_SOURCE);
  if (source === 'mock') return new MockFulfillmentClient({ scenario: 'success', cartSubtotalCents: 18000 });
  const baseUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL?.trim() ?? '';
  if (!baseUrl) {
    const unavailable = async () => { throw new FulfillmentClientError('INTERNAL_ERROR', 'A API de entrega nao foi configurada.'); };
    return {
      getFulfillmentOptions: unavailable,
      setFulfillment: unavailable,
      requestShippingQuote: unavailable,
      getDeliverySummary: unavailable,
    } as unknown as FulfillmentClient;
  }
  return new HttpFulfillmentClient({ baseUrl });
}

export const fulfillmentClient = createFulfillmentClient();
