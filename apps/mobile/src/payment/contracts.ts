export const PAYMENT_API_VERSION = 'v1' as const;

export type PaymentAttemptStatus =
  | 'REQUESTING'
  | 'PENDING'
  | 'PAID'
  | 'DECLINED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'REVIEW_REQUIRED';

export type PaymentErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_PAID'
  | 'ORDER_EXPIRED'
  | 'RESERVATION_INTEGRITY_ERROR'
  | 'PAYMENT_IN_PROGRESS'
  | 'INTERNAL_ERROR'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'PAYMENT_ATTEMPT_NOT_FOUND'
  | 'PAYMENT_RECONCILIATION_REQUIRED';

export interface PaymentApiMeta {
  api_version: typeof PAYMENT_API_VERSION;
}

export interface PaymentAttempt {
  id: string;
  order_id: string;
  status: PaymentAttemptStatus;
  amount_cents: number;
  currency: string;
  method: 'PIX';
  provider: 'INFINITEPAY';
  provider_checkout_url: string | null;
  provider_reference: string | null;
  provider_transaction_nsu: string | null;
  receipt_url: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

/**
 * CreatePaymentAttemptResponse — Contrato ok/data.
 * O campo data.attempt contém a tentativa recém-criada.
 * O campo data.data.attempt.provider_checkout_url é a URL do checkout InfinitePay.
 */
export interface CreatePaymentAttemptResponse {
  ok: true;
  data: {
    attempt: PaymentAttempt;
  };
  meta: PaymentApiMeta;
}

/**
 * GetPaymentAttemptResponse — Contrato ok/data.
 * data contém a tentativa com status atualizado.
 */
export interface GetPaymentAttemptResponse {
  ok: true;
  data: PaymentAttempt;
  meta: PaymentApiMeta;
}

export interface PaymentClient {
  createPaymentAttempt(orderId: string): Promise<CreatePaymentAttemptResponse>;
  getPaymentAttempt(attemptId: string): Promise<GetPaymentAttemptResponse>;
}
