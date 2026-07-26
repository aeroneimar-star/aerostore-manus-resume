import type { CatalogClient } from '../CatalogClient';
import { CatalogClientError } from '../CatalogClientError';
import {
  B2C_API_VERSION,
  type B2cApiErrorCode,
  type B2cApiErrorResponse,
  type B2cCatalogFiltersResponse,
  type B2cCatalogResponse,
  type B2cProductResponse,
  type CatalogQuery,
} from '../contracts';

const ERROR_CODES = new Set<B2cApiErrorCode>([
  'CATALOG_DISABLED',
  'PRODUCT_NOT_FOUND',
  'INVALID_PAGE',
  'INVALID_LIMIT',
  'INVALID_FILTER',
  'CATALOG_SOURCE_UNAVAILABLE',
  'INTERNAL_ERROR',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isApiMeta = (value: unknown) =>
  isRecord(value) && value.api_version === B2C_API_VERSION;

const isString = (value: unknown): value is string => typeof value === 'string';
const isOptionalString = (value: unknown) => value === undefined || isString(value);
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isOptionalNullableNumber = (value: unknown) =>
  value === undefined || value === null || isNumber(value);
const isAvailability = (value: unknown) =>
  value === 'in_stock' || value === 'low_stock' || value === 'out_of_stock';
const isStringArray = (value: unknown) =>
  Array.isArray(value) && value.every(isString);

const isImage = (value: unknown) =>
  isRecord(value)
  && isString(value.url)
  && isOptionalString(value.alt)
  && (value.sort_order === undefined || isNumber(value.sort_order))
  && isOptionalString(value.role)
  && isOptionalString(value.color_slug);

const isFilter = (value: unknown) =>
  isRecord(value)
  && isString(value.slug)
  && isString(value.label)
  && isNumber(value.count);

const isCatalogItem = (value: unknown) =>
  isRecord(value)
  && isString(value.slug)
  && isString(value.title)
  && isOptionalString(value.short_description)
  && isOptionalString(value.category_slug)
  && isOptionalString(value.category_label)
  && isNumber(value.price_cents)
  && isOptionalNullableNumber(value.compare_at_price_cents)
  && typeof value.featured === 'boolean'
  && isAvailability(value.availability)
  && (value.primary_image === undefined || value.primary_image === null || isImage(value.primary_image))
  && isNumber(value.variant_count)
  && isStringArray(value.colors)
  && isStringArray(value.color_slugs)
  && isStringArray(value.sizes)
  && isOptionalString(value.action_label)
  && isOptionalString(value.status_copy)
  && isOptionalString(value.badge_label);

const isPagination = (value: unknown) =>
  isRecord(value)
  && isNumber(value.page)
  && isNumber(value.limit)
  && isNumber(value.total)
  && isNumber(value.total_pages);

const isVariant = (value: unknown) =>
  isRecord(value)
  && isString(value.slug)
  && isOptionalString(value.color)
  && isOptionalString(value.color_slug)
  && isOptionalString(value.size)
  && isOptionalString(value.size_slug)
  && isNumber(value.price_cents)
  && isOptionalNullableNumber(value.compare_at_price_cents)
  && isAvailability(value.availability);

const isProduct = (value: unknown) =>
  isRecord(value)
  && isString(value.slug)
  && isString(value.title)
  && isOptionalString(value.short_description)
  && isOptionalString(value.description)
  && isOptionalString(value.category_slug)
  && isOptionalString(value.category_label)
  && isNumber(value.price_cents)
  && isOptionalNullableNumber(value.compare_at_price_cents)
  && typeof value.featured === 'boolean'
  && isAvailability(value.availability)
  && Array.isArray(value.images)
  && value.images.every(isImage)
  && Array.isArray(value.variants)
  && value.variants.every(isVariant)
  && (
    value.seo === undefined
    || (
      isRecord(value.seo)
      && isOptionalString(value.seo.title)
      && isOptionalString(value.seo.description)
    )
  );

const isErrorResponse = (value: unknown): value is B2cApiErrorResponse => {
  if (
    !isRecord(value)
    || value.success !== false
    || !isApiMeta(value.meta)
    || !isRecord(value.error)
  ) {
    return false;
  }
  return typeof value.error.code === 'string'
    && ERROR_CODES.has(value.error.code as B2cApiErrorCode)
    && typeof value.error.message === 'string';
};

const isCatalogResponse = (value: unknown): value is B2cCatalogResponse =>
  isRecord(value)
  && value.success === true
  && isApiMeta(value.meta)
  && isRecord(value.data)
  && Array.isArray(value.data.items)
  && value.data.items.every(isCatalogItem)
  && isPagination(value.data.pagination)
  && isRecord(value.data.filters)
  && Array.isArray(value.data.filters.categories)
  && value.data.filters.categories.every(isFilter);

const isFiltersResponse = (value: unknown): value is B2cCatalogFiltersResponse =>
  isRecord(value)
  && value.success === true
  && isApiMeta(value.meta)
  && isRecord(value.data)
  && Array.isArray(value.data.categories)
  && value.data.categories.every(isFilter)
  && Array.isArray(value.data.colors)
  && value.data.colors.every(isFilter)
  && Array.isArray(value.data.sizes)
  && value.data.sizes.every(isFilter);

const isProductResponse = (value: unknown): value is B2cProductResponse =>
  isRecord(value)
  && value.success === true
  && isApiMeta(value.meta)
  && isRecord(value.data)
  && isProduct(value.data.product);

interface HttpCatalogClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class HttpCatalogClient implements CatalogClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpCatalogClientOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      throw new CatalogClientError(
        'CATALOG_SOURCE_UNAVAILABLE',
        'A URL da API B2C não foi configurada.',
      );
    }
    this.baseUrl = baseUrl;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    validate: (value: unknown) => value is T,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.toLowerCase().includes('application/json')) {
        throw new CatalogClientError(
          'CATALOG_SOURCE_UNAVAILABLE',
          'A fonte do catálogo retornou um formato inválido.',
          { status: response.status },
        );
      }
      const payload: unknown = await response.json();
      if (!response.ok) {
        if (isErrorResponse(payload)) {
          throw new CatalogClientError(payload.error.code, payload.error.message, {
            status: response.status,
            details: payload.error.details,
          });
        }
        throw new CatalogClientError(
          'INTERNAL_ERROR',
          'A fonte do catálogo retornou um erro inesperado.',
          { status: response.status },
        );
      }
      if (!validate(payload)) {
        throw new CatalogClientError(
          'CATALOG_SOURCE_UNAVAILABLE',
          'A resposta da fonte não segue o contrato B2C V1.',
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof CatalogClientError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CatalogClientError(
          'CATALOG_SOURCE_UNAVAILABLE',
          'A fonte do catálogo excedeu o tempo de resposta.',
        );
      }
      throw new CatalogClientError(
        'CATALOG_SOURCE_UNAVAILABLE',
        'Não foi possível acessar a fonte do catálogo.',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async getCatalog(params: CatalogQuery = {}) {
    const query = new URLSearchParams();
    if (params.page !== undefined) query.set('page', String(params.page));
    if (params.limit !== undefined) query.set('limit', String(params.limit));
    if (params.category) query.set('category', params.category);
    if (params.featured !== undefined) query.set('featured', String(params.featured));
    const suffix = query.size ? `?${query.toString()}` : '';
    return this.request(`/b2c/v1/catalog${suffix}`, isCatalogResponse);
  }

  async getFilters() {
    return this.request('/b2c/v1/catalog/filters', isFiltersResponse);
  }

  async getProductBySlug(slug: string) {
    return this.request(
      `/b2c/v1/products/${encodeURIComponent(slug)}`,
      isProductResponse,
    );
  }
}
