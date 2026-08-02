import type {
  CreateOrderPayload,
  CreateOrderResponse,
  GetOrderResponse,
  ListOrdersResponse,
} from './contracts';

export interface OrderClient {
  createOrder(payload: CreateOrderPayload): Promise<CreateOrderResponse>;
  listOrders(): Promise<ListOrdersResponse>;
  getOrder(orderId: string): Promise<GetOrderResponse>;
}
