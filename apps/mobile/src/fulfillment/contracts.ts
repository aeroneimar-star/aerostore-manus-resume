export const FULFILLMENT_API_VERSION = 'v1' as const;

export type FulfillmentType = 'PICKUP' | 'DELIVERY';

export type FulfillmentErrorCode =
  | 'NO_ACTIVE_CART'
  | 'INVALID_FULFILLMENT_TYPE'
  | 'INVALID_PICKUP_STORE'
  | 'ADDRESS_REQUIRED'
  | 'ADDRESS_NOT_FOUND'
  | 'FULFILLMENT_VERSION_CONFLICT'
  | 'CART_VERSION_CONFLICT'
  | 'PICKUP_NOT_AVAILABLE'
  | 'SHIPPING_DATA_INCOMPLETE'
  | 'SHIPPING_QUOTE_EXPIRED'
  | 'SHIPPING_QUOTE_FAILED'
  | 'SHIPPING_PROVIDER_UNAVAILABLE'
  | 'FREE_LOCAL_DELIVERY'
  | 'FIXED_LOCAL_DELIVERY'
  | 'INTERNAL_ERROR'
  | 'APP_SESSION_INVALID'
  | 'APP_ACCESS_NOT_APPROVED';

export interface FulfillmentApiMeta {
  api_version: typeof FULFILLMENT_API_VERSION;
}

export type FulfillmentShipmentStatus =
  | 'NOT_SHIPPED'
  | 'AWAITING_PICKUP'
  | 'IN_TRANSIT'
  | 'SHIPPED'
  | 'NOT_APPLICABLE';

export interface CurrentFulfillment {
  fulfillmentType: FulfillmentType | null;
  addressId: string | null;
  addressSummary: string | null;
  pickupStoreId: string | null;
  pickupStoreSummary: string | null;
  shippingProvider: string | null;
  shippingServiceCode: string | null;
  shippingQuoteCents: number | null;
  shippingQuoteCurrency: string | null;
  shippingQuoteExpiresAt: string | null;
  shippingStatus: FulfillmentShipmentStatus;
  version: number;
  updatedAt: string;
}

export interface PickupStore {
  id: string;
  name: string;
  city: string;
  state: string;
  addressSummary: string;
  distanceKm: number | null;
  recommended: boolean;
  availabilityStatus: 'AVAILABLE' | 'INSUFFICIENT_STOCK' | 'UNAVAILABLE';
  openingHours?: string;
}

export interface PickupStoreAvailability {
  storeId: string;
  storeName: string;
  isEligible: boolean;
  missingItems: Array<{ productId: string; productSku: string; needed: number; available: number }>;
}

export interface FulfillmentOptions {
  currentFulfillment: CurrentFulfillment;
  availableFulfillmentTypes: FulfillmentType[];
  pickupStores: PickupStore[];
  availableAddresses: Array<{ id: string; label: string; city: string; state: string; isDefault: boolean }>;
}

export interface FulfillmentOptionsResponse {
  success: true;
  data: FulfillmentOptions;
  meta: FulfillmentApiMeta;
}

export interface SetFulfillmentPayload {
  fulfillment_type: FulfillmentType;
  pickup_store_id?: string;
  address_id?: string;
  shipping_provider?: string;
  shipping_service_code?: string;
  shipping_quote_cents?: number;
  expectedCartVersion?: number;
  expectedFulfillmentVersion?: number;
}

export interface ShippingQuote {
  provider: string;
  serviceCode: string;
  serviceName: string;
  priceCents: number;
  estimatedMinDays: number;
  estimatedMaxDays: number;
  expiresAt: string;
  warnings: string[];
}

export interface ShippingQuoteResponse {
  success: true;
  data: { shippingQuote: ShippingQuote };
  meta: FulfillmentApiMeta;
}

export interface ShippingQuoteRequest {
  address_id: string;
  shipping_provider: string;
}

export interface DeliverySummary {
  fulfillmentType: FulfillmentType | null;
  addressSummary: string | null;
  pickupStoreSummary: string | null;
  shippingMethod: string | null;
  shippingPriceCents: number | null;
  shippingPriceFormatted: string | null;
  estimatedDelivery: string | null;
  cartSubtotalCents: number | null;
  cartSubtotalFormatted: string | null;
  estimatedTotalCents: number | null;
  estimatedTotalFormatted: string | null;
  blockingIssues: string[];
  canContinueToCheckoutFuture: boolean;
  updatedAt: string;
}

export interface DeliverySummaryResponse {
  success: true;
  data: DeliverySummary;
  meta: FulfillmentApiMeta;
}

export interface FulfillmentClient {
  getFulfillmentOptions(): Promise<FulfillmentOptionsResponse>;
  setFulfillment(payload: SetFulfillmentPayload): Promise<FulfillmentOptionsResponse>;
  requestShippingQuote(payload: ShippingQuoteRequest): Promise<ShippingQuoteResponse>;
  getDeliverySummary(): Promise<DeliverySummaryResponse>;
}
