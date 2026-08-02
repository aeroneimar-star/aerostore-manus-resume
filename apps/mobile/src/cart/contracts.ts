import type { B2cApiMeta, B2cApiErrorCode, B2cAvailability } from '../catalog/contracts';

export type CartErrorCode =
  | 'CART_NOT_FOUND'
  | 'CART_ITEM_NOT_FOUND'
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'VARIANT_UNAVAILABLE'
  | 'INVALID_QUANTITY'
  | 'INVALID_ACCOUNT_ID'
  | 'PRODUCT_ID_REQUIRED'
  | 'QUANTITY_REQUIRED'
  | 'INTERNAL_ERROR'
  | 'APP_SESSION_INVALID'
  | 'APP_ACCESS_NOT_APPROVED';

export interface CartApiError {
  code: CartErrorCode;
  message: string;
}

export interface CartApiErrorResponse {
  success: false;
  error: CartApiError;
  meta: B2cApiMeta;
}

export interface CartProductSnapshot {
  id: string;
  title: string;
  brand: string;
  category_label?: string;
  color?: string;
  size?: string;
  sku?: string;
  primary_image?: {
    url: string;
    alt?: string;
    sort_order?: number;
    role?: string;
  } | null;
}

export interface CartItem {
  id: string;
  product_id: string;
  variant_id: string;
  quantity: number;
  unit_price_cents: number;
  promotional_price_cents: number | null;
  effective_unit_price_cents: number;
  line_total_cents: number;
  availability: B2cAvailability;
  version: number;
  updated_at: string;
  product: CartProductSnapshot;
}

export interface Cart {
  id: string;
  status: 'ACTIVE' | 'CONVERTED' | 'ABANDONED' | 'CLOSED';
  currency: string;
  item_count: number;
  subtotal_cents: number;
  version: number;
  updated_at: string;
  items: CartItem[];
}

export interface CartResponse {
  success: true;
  data: {
    cart: Cart | null;
    items?: CartItem[];
  };
  meta: B2cApiMeta;
}

export interface EmptyCartResponse {
  success: true;
  data: {
    cart: null;
    items: [];
  };
  meta: B2cApiMeta;
}

export interface AddItemPayload {
  product_id: string;
  variant_id?: string;
  quantity?: number;
}

export interface UpdateQuantityPayload {
  quantity: number;
}

export interface CartClient {
  getCart(): Promise<CartResponse | EmptyCartResponse>;
  addItem(payload: AddItemPayload): Promise<CartResponse>;
  updateQuantity(itemId: string, payload: UpdateQuantityPayload): Promise<CartResponse>;
  removeItem(itemId: string): Promise<CartResponse>;
  clearCart(): Promise<CartResponse>;
  closeCart(): Promise<CartResponse>;
}

export type CartError = CartErrorCode | B2cApiErrorCode;
