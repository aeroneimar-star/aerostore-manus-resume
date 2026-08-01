import type { CatalogClient } from './CatalogClient';
import { CatalogClientError } from './CatalogClientError';
import { HttpCatalogClient } from './http/HttpCatalogClient';
import { MockCatalogClient, type MockCatalogScenario } from './mock/MockCatalogClient';

export type CatalogSource = 'mock' | 'http';

const readCatalogSource = (value: string | undefined): CatalogSource => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return process.env.EXPO_PUBLIC_APP_AUTH_SOURCE === 'visual' ? 'mock' : 'http';
  if (normalized === 'mock' || normalized === 'http') return normalized;
  throw new CatalogClientError('CATALOG_SOURCE_UNAVAILABLE', 'EXPO_PUBLIC_CATALOG_SOURCE deve ser mock ou http.');
};

const readMockScenario = (value: string | undefined): MockCatalogScenario => {
  const scenarios: MockCatalogScenario[] = ['success', 'empty', 'catalog_disabled', 'product_not_found', 'internal_error'];
  const normalized = value?.trim().toLowerCase() as MockCatalogScenario | undefined;
  return normalized && scenarios.includes(normalized) ? normalized : 'success';
};

export function createCatalogClient(): CatalogClient {
  const source = readCatalogSource(process.env.EXPO_PUBLIC_CATALOG_SOURCE);
  if (source === 'mock') return new MockCatalogClient({ scenario: readMockScenario(process.env.EXPO_PUBLIC_MOCK_CATALOG_SCENARIO) });
  const baseUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL?.trim() ?? '';
  if (!baseUrl) {
    const unavailable = async () => { throw new CatalogClientError('CATALOG_SOURCE_UNAVAILABLE', 'A API privada do catalogo nao foi configurada.'); };
    return { getCatalog: unavailable, getFilters: unavailable, getProduct: unavailable };
  }
  return new HttpCatalogClient({ baseUrl });
}

export const catalogClient = createCatalogClient();
