import { withSessionRefresh } from '@/app-auth/SessionCoordinator';
import type { AddressClient } from '../AddressClient';
import { AddressClientError } from '../AddressClientError';
import {
  ADDRESS_API_VERSION,
  type Address,
  type AddressApiMeta,
  type AddressErrorCode,
  type AddressListResponse,
  type AddressResponse,
  type CreateAddressPayload,
  type PostalCodeLookupResult,
  type PostalCodeResponse,
  type UpdateAddressPayload,
} from '../contracts';

const ERROR_CODES: Set<AddressErrorCode> = new Set([
  'ADDRESS_NOT_FOUND', 'INVALID_ADDRESS_FIELDS', 'ADDRESS_VERSION_CONFLICT',
  'ADDRESS_IN_USE_BY_CART', 'INVALID_ACCOUNT_ID', 'POSTAL_CODE_INVALID',
  'POSTAL_CODE_NOT_FOUND', 'POSTAL_CODE_SERVICE_UNAVAILABLE', 'INTERNAL_ERROR',
  'APP_SESSION_INVALID', 'APP_ACCESS_NOT_APPROVED',
]);

type AuthorizedRunner = <T>(operation: (accessToken: string, deviceId: string) => Promise<T>) => Promise<T>;

interface HttpAddressClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  authorizedRunner?: AuthorizedRunner;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isMeta(value: unknown): value is AddressApiMeta {
  return isRecord(value) && value.api_version === ADDRESS_API_VERSION;
}

function isValidationStatus(value: unknown): boolean {
  return value === 'PENDING' || value === 'VALID' || value === 'INVALID' || value === 'MANUAL';
}

function isAddress(value: unknown): value is Address {
  if (!isRecord(value)) return false;
  return isString(value.id) && isString(value.recipientName) && isString(value.postalCode)
    && isString(value.street) && isString(value.number) && isString(value.neighborhood)
    && isString(value.city) && isString(value.state)
    && isOptionalString(value.label) && isOptionalString(value.complement)
    && isOptionalString(value.deliveryInstructions)
    && isValidationStatus(value.validationStatus)
    && isBoolean(value.isDefault) && isNumber(value.version) && isString(value.updatedAt);
}

function isAddressArray(value: unknown): value is Address[] {
  return Array.isArray(value) && value.every(isAddress);
}

function isPostalCodeResult(value: unknown): value is PostalCodeLookupResult {
  if (!isRecord(value)) return false;
  return isString(value.postalCode) && isString(value.street) && isString(value.neighborhood)
    && isString(value.city) && isString(value.state) && isString(value.source)
    && isBoolean(value.found) && isBoolean(value.manualEntryAllowed);
}

export class HttpAddressClient implements AddressClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly authorizedRunner: AuthorizedRunner;

  constructor(options: HttpAddressClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!this.baseUrl) throw new AddressClientError('INTERNAL_ERROR', 'A URL da API nao foi configurada.');
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.authorizedRunner = options.authorizedRunner ?? ((op) => (async () => {
      const result = await withSessionRefresh(async (token, deviceId) => op(token, deviceId));
      return result.value;
    })());
  }

  private async request<T>(method: string, path: string, body?: unknown, validate?: (value: unknown) => value is T): Promise<T> {
    return this.authorizedRunner(async (accessToken, deviceId) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'x-device-id': deviceId,
        };
        const response = await fetch(`${this.baseUrl}${path}`, {
          method, headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          const rawCode = isRecord(payload) && (typeof payload.error === 'string' ? payload.error : isRecord(payload.error) ? payload.error.code : '') || '';
          const code = ERROR_CODES.has(rawCode as AddressErrorCode) ? rawCode as AddressErrorCode : response.status === 401 ? 'APP_SESSION_INVALID' : response.status === 403 ? 'APP_ACCESS_NOT_APPROVED' : 'INTERNAL_ERROR';
          const message = isRecord(payload) && (typeof payload.message === 'string' ? payload.message : isRecord(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : '') || 'Erro desconhecido.';
          throw new AddressClientError(code, message, { status: response.status });
        }
        if (validate && !validate(payload)) throw new AddressClientError('INTERNAL_ERROR', 'Resposta invalida do servidor.');
        return payload as T;
      } catch (error) {
        if (error instanceof AddressClientError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw new AddressClientError('INTERNAL_ERROR', 'A requisicao excedeu o tempo de resposta.');
        throw new AddressClientError('INTERNAL_ERROR', 'Nao foi possivel acessar a API.');
      } finally { clearTimeout(timeout); }
    });
  }

  async listAddresses(): Promise<AddressListResponse> {
    return this.request('GET', '/app/v1/addresses', undefined, (v): v is AddressListResponse => {
      if (!isRecord(v) || v.success !== true || !isMeta(v.meta)) return false;
      const data = v.data;
      if (Array.isArray(data) && data.length === 0) return true;
      return isRecord(v) && Array.isArray(v.data) && (v.data as unknown[]).every(isAddress);
    });
  }

  async getAddress(addressId: string): Promise<AddressResponse> {
    return this.request('GET', `/app/v1/addresses/${encodeURIComponent(addressId)}`, undefined, (v): v is AddressResponse => {
      if (!isRecord(v) || v.success !== true || !isMeta(v.meta)) return false;
      return isAddress((v as Record<string, unknown>).data);
    });
  }

  async createAddress(payload: CreateAddressPayload): Promise<AddressResponse> {
    return this.request('POST', '/app/v1/addresses', payload, (v): v is AddressResponse => {
      if (!isRecord(v) || v.success !== true || !isMeta(v.meta)) return false;
      return isAddress((v as Record<string, unknown>).data);
    });
  }

  async updateAddress(addressId: string, payload: UpdateAddressPayload): Promise<AddressResponse> {
    return this.request('PATCH', `/app/v1/addresses/${encodeURIComponent(addressId)}`, payload, (v): v is AddressResponse => {
      if (!isRecord(v) || v.success !== true || !isMeta(v.meta)) return false;
      return isAddress((v as Record<string, unknown>).data);
    });
  }

  async archiveAddress(addressId: string): Promise<{ success: true; meta: AddressApiMeta }> {
    return this.request('DELETE', `/app/v1/addresses/${encodeURIComponent(addressId)}`, undefined, (v): v is { success: true; meta: AddressApiMeta } => {
      if (!isRecord(v) || v.success !== true || !isMeta(v.meta)) return false;
      return true;
    });
  }

  async setDefaultAddress(addressId: string): Promise<AddressResponse> {
    return this.request('POST', `/app/v1/addresses/${encodeURIComponent(addressId)}/default`, undefined, (v): v is AddressResponse => {
      if (!isRecord(v) || v.success !== true || !isMeta(v.meta)) return false;
      return isAddress((v as Record<string, unknown>).data);
    });
  }

  async lookupPostalCode(cep: string): Promise<PostalCodeResponse> {
    return this.request('GET', `/app/v1/postal-code/${encodeURIComponent(cep)}`, undefined, (v): v is PostalCodeResponse => {
      if (!isRecord(v) || v.success !== true || !isMeta(v.meta)) return false;
      return isPostalCodeResult((v as Record<string, unknown>).data);
    });
  }
}
