export const B2C_API_VERSION = 'v1' as const;

export type B2cAvailability = 'in_stock' | 'low_stock' | 'out_of_stock';

export type B2cApiErrorCode =
  | 'CATALOG_DISABLED'
  | 'PRODUCT_NOT_FOUND'
  | 'INVALID_PAGE'
  | 'INVALID_LIMIT'
  | 'INVALID_FILTER'
  | 'CATALOG_SOURCE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'APP_SESSION_INVALID'
  | 'APP_ACCESS_NOT_APPROVED';

export interface B2cApiMeta {
  api_version: typeof B2C_API_VERSION;
}

export interface B2cApiError {
  code: B2cApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface B2cApiErrorResponse {
  success: false;
  error: B2cApiError;
  meta: B2cApiMeta;
}

export interface B2cImage {
  url: string;
  alt?: string;
  sort_order?: number;
  role?: string;
  color_slug?: string;
}

export interface B2cCatalogItem {
  id: string;
  sku: string;
  slug: string;
  title: string;
  brand: string;
  short_description?: string;
  category_slug?: string;
  category_label?: string;
  price_cents: number;
  compare_at_price_cents?: number | null;
  featured: boolean;
  availability: B2cAvailability;
  primary_image?: B2cImage | null;
  images: B2cImage[];
  variant_count: number;
  colors: string[];
  color_slugs: string[];
  sizes: string[];
  action_label?: string;
  status_copy?: string;
  badge_label?: string;
  updated_at: string;
}

export interface B2cCatalogPagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface B2cCatalogFilter {
  slug: string;
  label: string;
  count: number;
}

export interface B2cCatalogFilters {
  categories: B2cCatalogFilter[];
  colors?: B2cCatalogFilter[];
  sizes?: B2cCatalogFilter[];
}

export interface B2cCatalogResponse {
  success: true;
  data: {
    items: B2cCatalogItem[];
    pagination: B2cCatalogPagination;
    filters: Pick<B2cCatalogFilters, 'categories'>;
  };
  meta: B2cApiMeta;
}

export interface B2cCatalogFiltersResponse {
  success: true;
  data: B2cCatalogFilters;
  meta: B2cApiMeta;
}

export interface B2cProductVariant {
  slug: string;
  color?: string;
  color_slug?: string;
  size?: string;
  size_slug?: string;
  price_cents: number;
  compare_at_price_cents?: number | null;
  availability: B2cAvailability;
}

export interface B2cProductSeo {
  title?: string;
  description?: string;
}

export interface B2cProduct {
  id: string;
  sku: string;
  slug: string;
  title: string;
  brand: string;
  short_description?: string;
  description?: string;
  category_slug?: string;
  category_label?: string;
  price_cents: number;
  compare_at_price_cents?: number | null;
  featured: boolean;
  availability: B2cAvailability;
  images: B2cImage[];
  variants: B2cProductVariant[];
  colors: string[];
  sizes: string[];
  updated_at: string;
  seo?: B2cProductSeo;
}

export interface B2cProductResponse {
  success: true;
  data: {
    product: B2cProduct;
  };
  meta: B2cApiMeta;
}

export interface CatalogQuery {
  page?: number;
  pageSize?: number;
  category?: string;
  brand?: string;
  search?: string;
  sort?: 'recentes' | 'nome_asc' | 'nome_desc' | 'preco_asc' | 'preco_desc';
}
