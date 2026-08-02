import {
  CreateOrderInput,
  CreateOrderResponse,
  OrderDetailResponse,
  OrderListResponse,
  ReleaseOrderResponse,
} from "./contracts";

export interface OrderClient {
  createOrder(input: CreateOrderInput): Promise<CreateOrderResponse>;
  getOrder(orderId: string): Promise<OrderDetailResponse>;
  listOrders(): Promise<OrderListResponse>;
  releaseOrder(orderId: string): Promise<ReleaseOrderResponse>;
}
