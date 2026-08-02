import { OrderClient } from "../OrderClient";
import { OrderClientError } from "../OrderClientError";
import {
  CreateOrderInput,
  CreateOrderResponse,
  OrderDetailResponse,
  OrderListResponse,
  ReleaseOrderResponse,
} from "../contracts";

export class HttpOrderClient implements OrderClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const opts: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Api-Version": "v1",
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    const json = await res.json();

    if (!res.ok) {
      throw new OrderClientError(
        json.error?.code || "HTTP_ERROR",
        res.status,
        json.error?.message || json.message || "Erro no servidor"
      );
    }

    return json as T;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
    return this.request<CreateOrderResponse>("POST", "/orders", input);
  }

  async getOrder(orderId: string): Promise<OrderDetailResponse> {
    return this.request<OrderDetailResponse>("GET", `/orders/${orderId}`);
  }

  async listOrders(): Promise<OrderListResponse> {
    return this.request<OrderListResponse>("GET", "/orders");
  }

  async releaseOrder(orderId: string): Promise<ReleaseOrderResponse> {
    return this.request<ReleaseOrderResponse>("DELETE", `/orders/${orderId}`);
  }
}
