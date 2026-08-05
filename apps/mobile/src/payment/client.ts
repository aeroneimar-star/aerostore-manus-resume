import {
  type CreatePaymentAttemptResponse,
  type GetPaymentAttemptResponse,
  type PaymentClient,
  PAYMENT_API_VERSION,
} from './contracts';
import { PaymentClientError } from './PaymentClientError';

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * createHttpPaymentClient — Cliente HTTP real para o backend.
 *
 * Autenticação:
 *   Usa o Authorization header com o Bearer token do usuário.
 *   O token é obtido do AuthContext global (AsyncStorage).
 *
 * Contrato:
 *   Todas as respostas usam { ok: true, data: ... } ou { ok: false, error: { code, message } }.
 *
 * Rotas:
 *   POST /app/v1/orders/:id/pay — Criar tentativa PIX
 *   GET  /app/v1/payment-attempts/:id/status — Consultar status
 *   GET  /app/v1/orders/:id/payments — Listar tentativas
 */
function createHttpPaymentClient(): PaymentClient {
  const baseUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL || '';
  if (!baseUrl) {
    throw new PaymentClientError('INTERNAL_ERROR', 'API URL não configurada.');
  }

  async function getAuthToken(): Promise<string | null> {
    try {
      const { getToken } = await import('expo-secure-store');
      const token = await getToken('authToken');
      return token || null;
    } catch {
      // Fallback para AsyncStorage se expo-secure-store não disponível
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        return await AsyncStorage.getItem('authToken');
      } catch {
        return null;
      }
    }
  }

  async function request(path: string, options: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      // Incluir token de autenticação
      const token = await getAuthToken();
      const authHeaders: Record<string, string> = {};
      if (token) {
        authHeaders['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      // Parsear resposta
      let json: any;
      try {
        json = await response.json();
      } catch {
        if (!response.ok) {
          throw new PaymentClientError(
            'INTERNAL_ERROR',
            `Erro HTTP ${response.status}`,
            response.status
          );
        }
        return json;
      }

      // Contrato ok/data
      if (response.ok && json.ok) {
        return json;
      }

      // Erro: { ok: false, error: { code, message } }
      if (!response.ok || json.ok === false) {
        const error = new PaymentClientError(
          json.error?.code || 'INTERNAL_ERROR',
          json.error?.message || `Erro HTTP ${response.status}`,
          response.status
        );
        throw error;
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
      const result = await request(`/app/v1/orders/${orderId}/pay`, {
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

/**
 * createMockPaymentClient — Cliente mock para desenvolvimento/testes.
 *
 * Simula o ciclo completo: PENDING → PAID após delay.
 */
function createMockPaymentClient(): PaymentClient {
  let mockAttemptId = 0;
  const mockPaidAttempts = new Set<string>();

  return {
    async createPaymentAttempt(orderId: string) {
      mockAttemptId++;
      const attemptId = `mock-attempt-${mockAttemptId}-${Date.now()}`;
      return {
        ok: true,
        data: {
          attempt: {
            id: attemptId,
            order_id: orderId,
            status: 'PENDING',
            amount_cents: 5000,
            currency: 'BRL',
            method: 'PIX',
            provider: 'INFINITEPAY',
            checkout_url: `https://mock-infinitepay.com/checkout/${attemptId}`,
            provider_reference: `mock-ref-${attemptId}`,
            provider_transaction_nsu: null,
            receipt_url: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 600000).toISOString(),
          },
        },
        meta: { api_version: PAYMENT_API_VERSION },
      };
    },
    async getPaymentAttempt(attemptId: string) {
      // Simular pagamento aprovado após 3 segundos
      const isPaid = mockPaidAttempts.has(attemptId) || 
        (Date.now() > 3000 && mockAttemptId > 0);
      if (isPaid) {
        mockPaidAttempts.add(attemptId);
      }
      return {
        ok: true,
        data: {
          id: attemptId,
          order_id: '',
          status: isPaid ? 'PAID' : 'PENDING',
          amount_cents: 5000,
          currency: 'BRL',
          method: 'PIX',
          provider: 'INFINITEPAY',
          provider_checkout_url: null,
          provider_reference: null,
          provider_transaction_nsu: isPaid ? 'NSU-MOCK-001' : null,
          receipt_url: isPaid ? 'https://mock.receipt/1' : null,
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
