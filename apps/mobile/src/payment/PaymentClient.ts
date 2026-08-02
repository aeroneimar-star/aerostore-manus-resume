import type {
  PaymentResponse,
  PaymentAttempt,
  CreatePaymentRequest,
  PaymentMethod
} from "./contracts";

export interface PaymentClient {
  createPayment(request: CreatePaymentRequest): Promise<PaymentResponse>;
  getPayment(paymentId: string): Promise<PaymentResponse>;
  createPaymentAttempt(paymentId: string): Promise<PaymentAttempt>;
  cancelPayment(paymentId: string, reason: string): Promise<{ id: string; status: string; reason: string }>;
  getPaymentMethods(): Promise<{ methods: PaymentMethod[] }>;
}
