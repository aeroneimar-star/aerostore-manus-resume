export const ORDER_API_VERSION = 'v1' as const;

export type OrderErrorCode =
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'
  | 'STOCK_UNAVAILABLE'
  | 'FULFILLMENT_INVALID'
  | 'ADDRESS_NOT_FOUND'
  | 'PICKUP_STORE_INVALID'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_EXISTS'
  | 'ORDER_CREATION_FAILED'
  | 'INTERNAL_ERROR'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR';

export type FulfillmentType = 'PICKUP' | 'DELIVERY';
export type OrderStatus =
  | 'STOCK_RESERVED'
  | 'READY_FOR_PAYMENT'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_DECLINED'
  | 'FULFILLING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'EXPIRED';

export interface OrderApiMeta {
  api_version: typeof ORDER_API_VERSION;
}

export interface Order {
  id: string;
  order_number: string;
  fulfillment_type: FulfillmentType;
  address_id: string | null;
  pickup_store_id: string | null;
  shipping_provider: string | null;
  shipping_service_code: string | null;
  shipping_quote_cents: number | null;
  subtotal_cents: number;
  total_cents: number;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  failed_reason: string | null;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price_cents: number;
  effective_unit_price_cents: number;
  line_total_cents: number;
  availability_status: string;
}

export interface OrderEvent {
  id: string;
  order_id: string;
  event_type: string;
  details_json: string | null;
  created_at: string;
}

export interface CreateOrderPayload {
  fulfillment_type: FulfillmentType;
  address_id?: string;
  pickup_store_id?: string;
  store_origin_id?: string;
  idempotency_key: string;
}

export interface OrderDetail {
  order: Order;
  items: OrderItem[];
  events: OrderEvent[];
}

export interface OrderSummary {
  id: string;
  order_number: string;
  fulfillment_type: FulfillmentType;
  status: OrderStatus;
  subtotal_cents: number;
  total_cents: number;
  items_count: number;
  created_at: string;
}

export interface CreateOrderResponse {
  success: true;
  data: OrderDetail;
  meta: OrderApiMeta;
}

export interface ListOrdersResponse {
  success: true;
  data: OrderSummary[];
  meta: OrderApiMeta;
}

export interface GetOrderResponse {
  success: true;
  data: OrderDetail;
  meta: OrderApiMeta;
}

export interface OrderClient {
  createOrder(payload: CreateOrderPayload): Promise<CreateOrderResponse>;
  listOrders(): Promise<ListOrdersResponse>;
  getOrder(orderId: string): Promise<GetOrderResponse>;
}
