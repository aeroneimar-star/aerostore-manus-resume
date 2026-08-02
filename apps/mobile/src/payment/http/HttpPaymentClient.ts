import type { PaymentClient } from "../PaymentClient";
import type {
  PaymentResponse,
  PaymentAttempt,
  CreatePaymentRequest,
  PaymentMethod
} from "../contracts";
import { PaymentClientError } from "../PaymentClientError";

interface AuthProvider {
  getAccessToken(): Promise<string>;
}

export function createHttpPaymentClient(auth: AuthProvider): PaymentClient {
  const base = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000";
  const prefix = `${base}/api/v1/app-customers`;

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await auth.getAccessToken();
    const res = await fetch(`${prefix}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-B2C-API-Version": "2026-08-02"
      }
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new PaymentClientError(
        body.code || "UNKNOWN_ERROR",
        res.status,
        body.message
      );
    }

    return res.json() as Promise<T>;
  }

  return {
    createPayment(req: CreatePaymentRequest) {
      return request<PaymentResponse>("/payments", {
        method: "POST",
        body: JSON.stringify(req)
      });
    },

    getPayment(paymentId: string) {
      return request<PaymentResponse>(`/payments/${paymentId}`);
    },

    createPaymentAttempt(paymentId: string) {
      return request<PaymentAttempt>(`/payments/${paymentId}/attempts`, {
        method: "POST"
      });
    },

    cancelPayment(paymentId: string, reason: string) {
      return request<{ id: string; status: string; reason: string }>(
        `/payments/${paymentId}/cancel`,
        { method: "POST", body: JSON.stringify({ reason }) }
      );
    },

    getPaymentMethods() {
      return request<{ methods: PaymentMethod[] }>("/payments/methods");
    }
  };
}
