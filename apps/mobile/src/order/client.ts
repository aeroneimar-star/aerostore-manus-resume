import { OrderClient } from "./OrderClient";
import { HttpOrderClient } from "./http/HttpOrderClient";
import { MockOrderClient } from "./mock/MockOrderClient";

const ENV = (typeof process !== "undefined" && process.env) ? process.env as Record<string, string> : {};

export function createOrderClient(): OrderClient {
  if (ENV.ORDER_MODE === "mock" || ENV.APP_MODE === "mock") {
    return new MockOrderClient();
  }
  const baseUrl = ENV.API_BASE_URL || "http://localhost:3000/api/app/v1";
  return new HttpOrderClient(baseUrl);
}
