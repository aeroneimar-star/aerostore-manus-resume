export const B2C_API_VERSION = "v1";

export type OrderStatus =
  | "AWAITING_PAYMENT"
  | "PAID"
  | "EXPIRED"
  | "CANCELLED";

export type FulfillmentType = "DELIVERY" | "PICKUP";

export interface OrderItemDto {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  quantity: number;
  unitPriceCents: number;
  effectiveUnitPriceCents: number;
  lineTotalCents: number;
  promotionName?: string | null;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  addressId?: string | null;
  pickupStoreId?: string | null;
  totalCents: number;
  subtotalCents: number;
  shippingQuoteCents: number;
  totalFormatted: string;
  subtotalFormatted: string;
  shippingFormatted: string;
  snapshotJson: string;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderInput {
  idempotencyKey?: string;
}

export interface CreateOrderResponse {
  success: boolean;
  data: {
    order: OrderDto;
    items: OrderItemDto[];
    duplicate: boolean;
    message: string;
  };
  meta: { timestamp: string };
}

export interface OrderListResponse {
  success: boolean;
  data: {
    orders: OrderDto[];
    count: number;
  };
  meta: { timestamp: string };
}

export interface OrderDetailResponse {
  success: boolean;
  data: {
    order: OrderDto;
    items: OrderItemDto[];
  };
  meta: { timestamp: string };
}

export interface ReleaseOrderResponse {
  success: boolean;
  data: {
    released: boolean;
    message: string;
  };
  meta: { timestamp: string };
}
