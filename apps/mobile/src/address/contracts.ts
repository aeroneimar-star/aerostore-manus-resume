export const ADDRESS_API_VERSION = 'v1' as const;

export type AddressErrorCode =
  | 'ADDRESS_NOT_FOUND'
  | 'INVALID_ADDRESS_FIELDS'
  | 'ADDRESS_VERSION_CONFLICT'
  | 'ADDRESS_IN_USE_BY_CART'
  | 'INVALID_ACCOUNT_ID'
  | 'POSTAL_CODE_INVALID'
  | 'POSTAL_CODE_NOT_FOUND'
  | 'POSTAL_CODE_SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'APP_SESSION_INVALID'
  | 'APP_ACCESS_NOT_APPROVED';

export interface AddressApiMeta {
  api_version: typeof ADDRESS_API_VERSION;
}

export interface AddressApiError {
  code: AddressErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface AddressApiErrorResponse {
  success: false;
  error: AddressApiError;
  meta: AddressApiMeta;
}

export type AddressValidationStatus = 'PENDING' | 'VALID' | 'INVALID' | 'MANUAL';

export interface Address {
  id: string;
  label: string;
  recipientName: string;
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  deliveryInstructions: string;
  validationStatus: AddressValidationStatus;
  isDefault: boolean;
  version: number;
  updatedAt: string;
}

export interface AddressListResponse {
  success: true;
  data: Address[];
  meta: AddressApiMeta;
}

export interface AddressResponse {
  success: true;
  data: Address;
  meta: AddressApiMeta;
}

export interface EmptyAddressResponse {
  success: true;
  data: [];
  meta: AddressApiMeta;
}

export interface CreateAddressPayload {
  recipient_name: string;
  postal_code: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  label?: string;
  delivery_instructions?: string;
}

export interface UpdateAddressPayload {
  recipient_name?: string;
  postal_code?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  label?: string;
  delivery_instructions?: string;
  expectedVersion?: number;
}

export interface PostalCodeLookupResult {
  postalCode: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  source: string;
  found: boolean;
  manualEntryAllowed: boolean;
}

export interface PostalCodeResponse {
  success: true;
  data: PostalCodeLookupResult;
  meta: AddressApiMeta;
}

export interface AddressClient {
  listAddresses(): Promise<AddressListResponse | EmptyAddressResponse>;
  getAddress(addressId: string): Promise<AddressResponse>;
  createAddress(payload: CreateAddressPayload): Promise<AddressResponse>;
  updateAddress(addressId: string, payload: UpdateAddressPayload): Promise<AddressResponse>;
  archiveAddress(addressId: string): Promise<{ success: true; meta: AddressApiMeta }>;
  setDefaultAddress(addressId: string): Promise<AddressResponse>;
  lookupPostalCode(cep: string): Promise<PostalCodeResponse>;
}

export type AddressError = AddressErrorCode;
