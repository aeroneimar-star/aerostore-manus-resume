import type { CatalogClient } from '../CatalogClient';
import { CatalogClientError } from '../CatalogClientError';
import { B2C_API_VERSION, type CatalogQuery } from '../contracts';
import { mockCatalogItems, mockFilters, mockProducts } from './mockCatalogData';

export type MockCatalogScenario =
  | 'success'
  | 'empty'
  | 'catalog_disabled'
  | 'product_not_found'
  | 'internal_error';

interface MockCatalogClientOptions {
  scenario?: MockCatalogScenario;
  latencyMs?: number;
}

const mockError = (scenario: MockCatalogScenario): CatalogClientError | null => {
  if (scenario === 'catalog_disabled') {
    return new CatalogClientError(
      'CATALOG_DISABLED',
      'Catálogo público desabilitado.',
      { status: 404 },
    );
  }
  if (scenario === 'internal_error') {
    return new CatalogClientError(
      'INTERNAL_ERROR',
      'Não foi possível processar a solicitação.',
      { status: 500 },
    );
  }
  return null;
};

export class MockCatalogClient implements CatalogClient {
  private readonly scenario: MockCatalogScenario;
  private readonly latencyMs: number;

  constructor(options: MockCatalogClientOptions = {}) {
    this.scenario = options.scenario ?? 'success';
    this.latencyMs = options.latencyMs ?? 450;
  }

  private async wait() {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }

  private failWhenConfigured() {
    const error = mockError(this.scenario);
    if (error) throw error;
  }

  async getCatalog(params: CatalogQuery = {}) {
    await this.wait();
    this.failWhenConfigured();
    const page = params.page ?? 1;
    const limit = params.limit ?? 4;
    const filtered = this.scenario === 'empty'
      ? []
      : mockCatalogItems.filter((item) => {
          const categoryMatches = !params.category || item.category_slug === params.category;
          const featuredMatches = params.featured === undefined || item.featured === params.featured;
          return categoryMatches && featuredMatches;
        });
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const offset = (page - 1) * limit;
    return {
      success: true as const,
      data: {
        items: filtered.slice(offset, offset + limit),
        pagination: { page, limit, total, total_pages: totalPages },
        filters: { categories: mockFilters.categories },
      },
      meta: { api_version: B2C_API_VERSION },
    };
  }

  async getFilters() {
    await this.wait();
    this.failWhenConfigured();
    return {
      success: true as const,
      data: mockFilters,
      meta: { api_version: B2C_API_VERSION },
    };
  }

  async getProductBySlug(slug: string) {
    await this.wait();
    this.failWhenConfigured();
    const product = this.scenario === 'product_not_found'
      ? undefined
      : mockProducts.find((item) => item.slug === slug);
    if (!product) {
      throw new CatalogClientError(
        'PRODUCT_NOT_FOUND',
        'Produto não encontrado.',
        { status: 404 },
      );
    }
    return {
      success: true as const,
      data: { product },
      meta: { api_version: B2C_API_VERSION },
    };
  }
}
