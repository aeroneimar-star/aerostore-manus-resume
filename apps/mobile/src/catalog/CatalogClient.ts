import type {
  B2cCatalogFiltersResponse,
  B2cCatalogResponse,
  B2cProductResponse,
  CatalogQuery,
} from './contracts';

export interface CatalogClient {
  getCatalog(params?: CatalogQuery): Promise<B2cCatalogResponse>;
  getFilters(): Promise<B2cCatalogFiltersResponse>;
  getProductBySlug(slug: string): Promise<B2cProductResponse>;
}
