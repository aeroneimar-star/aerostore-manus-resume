export const B2C_API_VERSION = 'v1' as const;

export type B2cAvailability = 'in_stock' | 'low_stock' | 'out_of_stock';

export type B2cApiErrorCode =
  | 'CATALOG_DISABLED'
  | 'PRODUCT_NOT_FOUND'
  | 'INVALID_PAGE'
  | 'INVALID_LIMIT'
  | 'INVALID_FILTER'
  | 'CATALOG_SOURCE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

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
  slug: string;
  title: string;
  short_description?: string;
  category_slug?: string;
  category_label?: string;
  price_cents: number;
  compare_at_price_cents?: number | null;
  featured: boolean;
  availability: B2cAvailability;
  primary_image?: B2cImage | null;
  variant_count: number;
  colors: string[];
  color_slugs: string[];
  sizes: string[];
  action_label?: string;
  status_copy?: string;
  badge_label?: string;
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
  colors: B2cCatalogFilter[];
  sizes: B2cCatalogFilter[];
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
  slug: string;
  title: string;
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
  limit?: number;
  category?: string;
  featured?: boolean;
}
