import { withSessionRefresh } from '@/app-auth/SessionCoordinator';
import type { CatalogClient } from '../CatalogClient';
import { CatalogClientError } from '../CatalogClientError';
import {
  B2C_API_VERSION,
  type B2cApiErrorCode,
  type B2cCatalogFiltersResponse,
  type B2cCatalogResponse,
  type B2cImage,
  type B2cProductResponse,
  type CatalogQuery,
} from '../contracts';

const ERROR_CODES = new Set<B2cApiErrorCode>([
  'CATALOG_DISABLED', 'PRODUCT_NOT_FOUND', 'INVALID_PAGE', 'INVALID_LIMIT',
  'INVALID_FILTER', 'CATALOG_SOURCE_UNAVAILABLE', 'INTERNAL_ERROR',
  'APP_SESSION_INVALID', 'APP_ACCESS_NOT_APPROVED',
]);
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isOptionalString = (value: unknown) => value === undefined || isString(value);
const isOptionalNumber = (value: unknown) => value === undefined || value === null || isNumber(value);
const isAvailability = (value: unknown) => value === 'in_stock' || value === 'low_stock' || value === 'out_of_stock';
const isStringArray = (value: unknown) => Array.isArray(value) && value.every(isString);
const isMeta = (value: unknown) => isRecord(value) && value.api_version === B2C_API_VERSION;
const isImage = (value: unknown) => isRecord(value) && isString(value.url) && isOptionalString(value.alt) && (value.sort_order === undefined || isNumber(value.sort_order)) && isOptionalString(value.role);
const isFilter = (value: unknown) => isRecord(value) && isString(value.slug) && isString(value.label) && isNumber(value.count);
const isItem = (value: unknown) => isRecord(value)
  && isString(value.id) && isString(value.sku) && isString(value.slug) && isString(value.title)
  && isString(value.brand) && isOptionalString(value.short_description)
  && isOptionalString(value.category_slug) && isOptionalString(value.category_label)
  && isNumber(value.price_cents) && isOptionalNumber(value.compare_at_price_cents)
  && typeof value.featured === 'boolean' && isAvailability(value.availability)
  && (value.primary_image === null || isImage(value.primary_image))
  && Array.isArray(value.images) && value.images.every(isImage)
  && isNumber(value.variant_count) && isStringArray(value.colors) && isStringArray(value.color_slugs)
  && isStringArray(value.sizes) && isString(value.updated_at);
const isPagination = (value: unknown) => isRecord(value) && isNumber(value.page) && isNumber(value.limit) && isNumber(value.total) && isNumber(value.total_pages);
const isVariant = (value: unknown) => isRecord(value) && isString(value.slug) && isOptionalString(value.color) && isOptionalString(value.size) && isNumber(value.price_cents) && isOptionalNumber(value.compare_at_price_cents) && isAvailability(value.availability);
const isProduct = (value: unknown) => isRecord(value)
  && isString(value.id) && isString(value.sku) && isString(value.slug) && isString(value.title) && isString(value.brand)
  && isOptionalString(value.short_description) && isOptionalString(value.description)
  && isOptionalString(value.category_slug) && isOptionalString(value.category_label)
  && isNumber(value.price_cents) && isOptionalNumber(value.compare_at_price_cents)
  && typeof value.featured === 'boolean' && isAvailability(value.availability)
  && Array.isArray(value.images) && value.images.every(isImage) && Array.isArray(value.variants) && value.variants.every(isVariant)
  && isStringArray(value.colors) && isStringArray(value.sizes) && isString(value.updated_at);
const isCatalog = (value: unknown): value is B2cCatalogResponse => isRecord(value) && value.success === true && isMeta(value.meta) && isRecord(value.data) && Array.isArray(value.data.items) && value.data.items.every(isItem) && isPagination(value.data.pagination);
const isCategories = (value: unknown): value is B2cCatalogFiltersResponse => isRecord(value) && value.success === true && isMeta(value.meta) && isRecord(value.data) && Array.isArray(value.data.categories) && value.data.categories.every(isFilter);
const isProductResponse = (value: unknown): value is B2cProductResponse => isRecord(value) && value.success === true && isMeta(value.meta) && isRecord(value.data) && isProduct(value.data.product);

type AuthorizedRunner = <T>(operation: (accessToken: string, deviceId: string) => Promise<T>) => Promise<T>;
interface HttpCatalogClientOptions { baseUrl: string; timeoutMs?: number; fetchImpl?: typeof fetch; authorizedRunner?: AuthorizedRunner; }

export class HttpCatalogClient implements CatalogClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly authorizedRunner: AuthorizedRunner;

  constructor(options: HttpCatalogClientOptions) {
    this.baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!this.baseUrl) throw new CatalogClientError('CATALOG_SOURCE_UNAVAILABLE', 'A URL privada do catalogo nao foi configurada.');
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.authorizedRunner = options.authorizedRunner ?? (async (operation) => (await withSessionRefresh(operation)).value);
  }

  private absoluteImage(image: B2cImage): B2cImage {
    return { ...image, url: /^https?:\/\//i.test(image.url) ? image.url : `${this.baseUrl}${image.url.startsWith('/') ? '' : '/'}${image.url}` };
  }

  private async request<T>(path: string, validate: (value: unknown) => value is T): Promise<T> {
    return this.authorizedRunner(async (accessToken, deviceId) => {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}`, 'x-device-id': deviceId }, signal: controller.signal });
        const payload: unknown = await response.json().catch(() => ({}));
        if (!response.ok) {
          const rawCode = isRecord(payload) && (typeof payload.error === 'string' ? payload.error : isRecord(payload.error) ? payload.error.code : '') || '';
          const code = ERROR_CODES.has(rawCode as B2cApiErrorCode) ? rawCode as B2cApiErrorCode : response.status === 401 ? 'APP_SESSION_INVALID' : response.status === 403 ? 'APP_ACCESS_NOT_APPROVED' : 'INTERNAL_ERROR';
          const message = isRecord(payload) && (typeof payload.message === 'string' ? payload.message : isRecord(payload.error) && typeof payload.error.message === 'string' ? payload.error.message : '') || 'Nao foi possivel carregar o catalogo.';
          throw new CatalogClientError(code, message, { status: response.status });
        }
        if (!validate(payload)) throw new CatalogClientError('CATALOG_SOURCE_UNAVAILABLE', 'A resposta privada do catalogo e invalida.');
        return payload;
      } catch (error) {
        if (error instanceof CatalogClientError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw new CatalogClientError('CATALOG_SOURCE_UNAVAILABLE', 'O catalogo excedeu o tempo de resposta.');
        throw new CatalogClientError('CATALOG_SOURCE_UNAVAILABLE', 'Nao foi possivel acessar o catalogo.');
      } finally { clearTimeout(timeout); }
    });
  }

  async getCatalog(params: CatalogQuery = {}) {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
    if (params.category) query.set('categoria', params.category);
    if (params.brand) query.set('marca', params.brand);
    if (params.search) query.set('busca', params.search);
    if (params.sort) query.set('ordenacao', params.sort);
    const response = await this.request(`/app/v1/catalog${query.size ? `?${query}` : ''}`, isCatalog);
    return { ...response, data: { ...response.data, items: response.data.items.map((item) => ({ ...item, primary_image: item.primary_image ? this.absoluteImage(item.primary_image) : null, images: item.images.map((image) => this.absoluteImage(image)) })) } };
  }

  getFilters() { return this.request('/app/v1/catalog/categories', isCategories); }

  async getProduct(productId: string) {
    const response = await this.request(`/app/v1/catalog/${encodeURIComponent(productId)}`, isProductResponse);
    return { ...response, data: { product: { ...response.data.product, images: response.data.product.images.map((image) => this.absoluteImage(image)) } } };
  }
}
