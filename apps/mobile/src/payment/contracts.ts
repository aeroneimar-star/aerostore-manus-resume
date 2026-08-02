export const B2C_API_VERSION = "2026-08-02";

export type PaymentStatus =
  | "AWAITING_PAYMENT"
  | "PAYMENT_PROCESSING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "PAYMENT_CANCELLED"
  | "PAYMENT_EXPIRED"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";

export type PaymentMethod = "PIX" | "CREDIT_CARD" | "BOLETO";

export type AttemptStatus = "PENDING" | "PROCESSING" | "APPROVED" | "REJECTED" | "ERROR" | "EXPIRED";

export interface PixPaymentData {
  qrCodeText: string;
  qrCodeImage: string;
  expiresAt: string;
  amountCents: number;
  pixKey?: string;
}

export interface PaymentAttempt {
  id: string;
  paymentId: string;
  method: PaymentMethod;
  status: AttemptStatus;
  amountCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  gatewayData: Record<string, unknown> | null;
}

export interface PaymentResponse {
  id: string;
  orderId: string;
  accountId: string;
  status: PaymentStatus;
  method: PaymentMethod;
  amountCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  pixData: PixPaymentData | null;
  attempts: PaymentAttempt[];
}

export interface CreatePaymentRequest {
  orderId: string;
  method: PaymentMethod;
  amountCents: number;
  currency: string;
}

export interface PaymentEnvelopes {
  ok: PaymentResponse;
  error: { code: string; status: number; message?: string };
}

// PaymentClientError is defined at the top of this file

export interface PaymentClient {
  createPayment(request: CreatePaymentRequest): Promise<PaymentResponse>;
  getPayment(paymentId: string): Promise<PaymentResponse>;
  createPaymentAttempt(paymentId: string): Promise<PaymentAttempt>;
  cancelPayment(paymentId: string, reason: string): Promise<{ id: string; status: string; reason: string }>;
  getPaymentMethods(): Promise<{ methods: PaymentMethod[] }>;
}
