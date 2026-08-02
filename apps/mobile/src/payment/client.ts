import type { PaymentClient } from "./PaymentClient";
import { createHttpPaymentClient } from "./http/HttpPaymentClient";
import { createMockPaymentClient } from "./mock/MockPaymentClient";

interface AuthProvider {
  getAccessToken(): Promise<string>;
}

const MOCK_MODE = process.env.EXPO_PUBLIC_MOCK_MODE === "1" || !process.env.EXPO_PUBLIC_MOCK_MODE;

export function createPaymentClient(auth: AuthProvider): PaymentClient {
  if (MOCK_MODE) {
    return createMockPaymentClient();
  }
  return createHttpPaymentClient(auth);
}

// Export mock directly for screens that don't need auth
export { createMockPaymentClient };
