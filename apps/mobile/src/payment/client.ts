import {
  type CreatePaymentAttemptResponse,
  type GetPaymentAttemptResponse,
  type PaymentClient,
  PAYMENT_API_VERSION,
} from './contracts';
import { PaymentClientError } from './PaymentClientError';

const DEFAULT_TIMEOUT_MS = 15000;

function createHttpPaymentClient(): PaymentClient {
  const baseUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL || '';
  if (!baseUrl) {
    throw new PaymentClientError('INTERNAL_ERROR', 'API URL não configurada.');
  }

  async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = new PaymentClientError(
          'INTERNAL_ERROR',
          `Erro HTTP ${response.status}`,
          response.status
        );
        throw error;
      }

      const json = await response.json();
      if (!json.success) {
        throw new PaymentClientError(
          json.error?.code || 'INTERNAL_ERROR',
          json.error?.message || 'Erro desconhecido',
          json.error?.httpStatus
        );
      }
      return json;
    } catch (err) {
      if (err instanceof PaymentClientError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new PaymentClientError('TIMEOUT_ERROR', 'Tempo limite excedido.');
      }
      throw new PaymentClientError('NETWORK_ERROR', 'Falha de rede ao conectar ao servidor.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async createPaymentAttempt(orderId: string) {
      const result = await request(`/app/v1/orders/${orderId}/payment-attempts`, {
        method: 'POST',
      });
      return result as CreatePaymentAttemptResponse;
    },
    async getPaymentAttempt(attemptId: string) {
      const result = await request(`/app/v1/payment-attempts/${attemptId}/status`);
      return result as GetPaymentAttemptResponse;
    },
  };
}

function createMockPaymentClient(): PaymentClient {
  return {
    async createPaymentAttempt(_orderId: string) {
      return {
        success: true,
        data: {
          attempt: {
            id: 'mock-attempt-1',
            order_id: _orderId,
            status: 'PENDING',
            amount_cents: 0,
            currency: 'BRL',
            method: 'pix',
            checkout_url: 'https://mock-infinitepay.com/checkout/mock-attempt-1',
            provider_reference: 'mock-ref-1',
            provider_transaction_nsu: null,
            receipt_url: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            expires_at: null,
          },
        },
        meta: { api_version: PAYMENT_API_VERSION },
      };
    },
    async getPaymentAttempt(attemptId: string) {
      return {
        success: true,
        data: {
          id: attemptId,
          order_id: '',
          status: 'PENDING',
          amount_cents: 0,
          currency: 'BRL',
          method: 'pix',
          checkout_url: null,
          provider_reference: null,
          provider_transaction_nsu: null,
          receipt_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expires_at: null,
        },
        meta: { api_version: PAYMENT_API_VERSION },
      };
    },
  };
}

export function createPaymentClient(): PaymentClient {
  const source = process.env.EXPO_PUBLIC_PAYMENT_SOURCE || 'http';
  if (source === 'mock') {
    return createMockPaymentClient();
  }
  return createHttpPaymentClient();
}
