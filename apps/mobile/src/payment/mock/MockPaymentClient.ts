import type { PaymentClient } from "../PaymentClient";
import type {
  PaymentResponse,
  PaymentAttempt,
  CreatePaymentRequest,
  PaymentMethod,
  PixPaymentData
} from "../contracts";

const MOCK_QR_CODE_IMAGE =
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <rect width="200" height="200" fill="white"/>
      <rect x="10" y="10" width="50" height="50" fill="black"/>
      <rect x="140" y="10" width="50" height="50" fill="black"/>
      <rect x="10" y="140" width="50" height="50" fill="black"/>
      <rect x="70" y="70" width="60" height="60" fill="black"/>
    </svg>`
  ).toString("base64");

let paymentCounter = 0;

function generateId(prefix: string): string {
  paymentCounter += 1;
  return `${prefix}-${paymentCounter}-${Date.now().toString(36)}`;
}

function makePixData(amountCents: number): PixPaymentData {
  return {
    qrCodeText: `00020126580014br.gov.bcb.pix2536qrcode-pix.example.com/${generateId("pix")}/5204000053039865802BR5913AEROSTORE6009SAO PAULO62070503***6304ABCD`,
    qrCodeImage: MOCK_QR_CODE_IMAGE,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    amountCents,
    pixKey: "aerostore@example.com"
  };
}

export function createMockPaymentClient(): PaymentClient {
  const payments = new Map<string, PaymentResponse>();
  const attempts = new Map<string, PaymentAttempt[]>();

  return {
    async createPayment(req: CreatePaymentRequest): Promise<PaymentResponse> {
      const paymentId = generateId("pay");
      const pixData = req.method === "PIX" ? makePixData(req.amountCents) : null;
      const payment: PaymentResponse = {
        id: paymentId,
        orderId: req.orderId,
        accountId: "acc-mock",
        status: "PAYMENT_PROCESSING",
        method: req.method,
        amountCents: req.amountCents,
        currency: req.currency,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        pixData,
        attempts: []
      };
      payments.set(paymentId, payment);
      attempts.set(paymentId, []);
      return payment;
    },

    async getPayment(paymentId: string): Promise<PaymentResponse> {
      const payment = payments.get(paymentId);
      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      return { ...payment, attempts: attempts.get(paymentId) || [] };
    },

    async createPaymentAttempt(paymentId: string): Promise<PaymentAttempt> {
      const attempt: PaymentAttempt = {
        id: generateId("att"),
        paymentId,
        method: "PIX",
        status: "APPROVED",
        amountCents: payments.get(paymentId)?.amountCents || 0,
        currency: "BRL",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        gatewayData: { mock: true, approved: true }
      };
      const list = attempts.get(paymentId) || [];
      list.push(attempt);
      attempts.set(paymentId, list);

      // Update payment status
      const payment = payments.get(paymentId);
      if (payment) {
        payment.status = "PAID";
        payment.updatedAt = new Date().toISOString();
      }

      return attempt;
    },

    async cancelPayment(
      paymentId: string,
      reason: string
    ): Promise<{ id: string; status: string; reason: string }> {
      const payment = payments.get(paymentId);
      if (!payment) throw new Error("PAYMENT_NOT_FOUND");
      payment.status = "PAYMENT_CANCELLED";
      payment.updatedAt = new Date().toISOString();
      return { id: paymentId, status: "PAYMENT_CANCELLED", reason };
    },

    async getPaymentMethods(): Promise<{ methods: PaymentMethod[] }> {
      return { methods: ["PIX", "CREDIT_CARD", "BOLETO"] };
    }
  };
}
