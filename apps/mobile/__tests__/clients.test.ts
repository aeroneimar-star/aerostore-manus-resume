import { describe, expect, it, jest } from '@jest/globals';

import { CatalogClientError } from '@/catalog/CatalogClientError';
import { createCatalogClient } from '@/catalog/client';
import { HttpCatalogClient } from '@/catalog/http/HttpCatalogClient';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';

const response = (
  body: unknown,
  options: { status?: number; contentType?: string } = {},
) => {
  const status = options.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: () => options.contentType ?? 'application/json; charset=utf-8',
    },
    json: async () => body,
  } as unknown as Response;
};

const authorizedRunner = async <T>(operation: (accessToken: string, deviceId: string) => Promise<T>): Promise<T> => {
  return operation('mock-access-token', 'mock-device-id');
};

const catalogPayload = {
  success: true,
  data: {
    items: [],
    pagination: { page: 1, limit: 24, total: 0, total_pages: 1 },
    filters: { categories: [] },
  },
  meta: { api_version: 'v1' },
};

describe('catalog clients', () => {
  it('parses a successful catalog response and sends supported filters', async () => {
    const fetchImpl = jest.fn(async () => response(catalogPayload)) as unknown as typeof fetch;
    const client = new HttpCatalogClient({
      baseUrl: 'https://api.example.test/',
      fetchImpl,
      authorizedRunner,
    });
    const result = await client.getCatalog({
      page: 2,
      category: 'polos',
    });
    expect(result.success).toBe(true);
    expect(result.data.items).toEqual([]);
    expect(result.data.pagination).toEqual({ page: 1, limit: 24, total: 0, total_pages: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/app/v1/catalog?page=2&categoria=polos',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('preserves CATALOG_DISABLED from the error envelope', async () => {
    const fetchImpl = jest.fn(async () => response({
      success: false,
      error: { code: 'CATALOG_DISABLED', message: 'Catálogo desabilitado.' },
      meta: { api_version: 'v1' },
    }, { status: 404 })) as unknown as typeof fetch;
    const client = new HttpCatalogClient({ baseUrl: 'https://api.example.test', fetchImpl, authorizedRunner });
    await expect(client.getCatalog()).rejects.toMatchObject({
      code: 'CATALOG_DISABLED',
      status: 404,
    });
  });

  it('preserves PRODUCT_NOT_FOUND', async () => {
    const fetchImpl = jest.fn(async () => response({
      success: false,
      error: { code: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.' },
      meta: { api_version: 'v1' },
    }, { status: 404 })) as unknown as typeof fetch;
    const client = new HttpCatalogClient({ baseUrl: 'https://api.example.test', fetchImpl, authorizedRunner });
    await expect(client.getProduct('ausente')).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('rejects non-JSON responses as source unavailable', async () => {
    const fetchImpl = jest.fn(async () => response(
      '<html>erro</html>',
      { status: 502, contentType: 'text/html' },
    )) as unknown as typeof fetch;
    const client = new HttpCatalogClient({ baseUrl: 'https://api.example.test', fetchImpl, authorizedRunner });
    await expect(client.getFilters()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });

  it('rejects a malformed success envelope', async () => {
    const fetchImpl = jest.fn(async () => response({
      ...catalogPayload,
      data: {
        ...catalogPayload.data,
        items: [{ slug: 'incompleto' }],
      },
    })) as unknown as typeof fetch;
    const client = new HttpCatalogClient({ baseUrl: 'https://api.example.test', fetchImpl, authorizedRunner });
    await expect(client.getCatalog()).rejects.toMatchObject({
      code: 'CATALOG_SOURCE_UNAVAILABLE',
    });
  });

  it('aborts requests after the configured timeout', async () => {
    const fetchImpl = jest.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as unknown as typeof fetch;
    const client = new HttpCatalogClient({
      baseUrl: 'https://api.example.test',
      fetchImpl,
      authorizedRunner,
      timeoutMs: 5,
    });
    await expect(client.getCatalog()).rejects.toMatchObject({
      code: 'CATALOG_SOURCE_UNAVAILABLE',
    });
  });

  it('simulates all approved mock failures without visual coupling', async () => {
    await expect(
      new MockCatalogClient({ scenario: 'catalog_disabled', latencyMs: 0 }).getCatalog(),
    ).rejects.toBeInstanceOf(CatalogClientError);
    await expect(
      new MockCatalogClient({ scenario: 'product_not_found', latencyMs: 0 })
        .getProduct('999'),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    await expect(
      new MockCatalogClient({ scenario: 'internal_error', latencyMs: 0 }).getFilters(),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('does not silently fall back when the configured source is invalid', () => {
    const previous = process.env.EXPO_PUBLIC_CATALOG_SOURCE;
    process.env.EXPO_PUBLIC_CATALOG_SOURCE = 'typo';
    try {
      expect(() => createCatalogClient()).toThrow(
        expect.objectContaining({ code: 'CATALOG_SOURCE_UNAVAILABLE' }),
      );
    } finally {
      if (previous === undefined) delete process.env.EXPO_PUBLIC_CATALOG_SOURCE;
      else process.env.EXPO_PUBLIC_CATALOG_SOURCE = previous;
    }
  });
});
