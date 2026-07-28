import type { CatalogClient } from './CatalogClient';
import { CatalogClientError } from './CatalogClientError';
import { HttpCatalogClient } from './http/HttpCatalogClient';
import {
  MockCatalogClient,
  type MockCatalogScenario,
} from './mock/MockCatalogClient';

export type CatalogSource = 'mock' | 'http';

const readCatalogSource = (value: string | undefined): CatalogSource => {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'mock') return 'mock';
  if (normalized === 'http') return 'http';
  throw new CatalogClientError(
    'CATALOG_SOURCE_UNAVAILABLE',
    'EXPO_PUBLIC_CATALOG_SOURCE deve ser mock ou http.',
  );
};

const readMockScenario = (value: string | undefined): MockCatalogScenario => {
  const scenarios: MockCatalogScenario[] = [
    'success',
    'empty',
    'catalog_disabled',
    'product_not_found',
    'internal_error',
  ];
  const normalized = value?.trim().toLowerCase() as MockCatalogScenario | undefined;
  return normalized && scenarios.includes(normalized) ? normalized : 'success';
};

export function createCatalogClient(): CatalogClient {
  const source = readCatalogSource(process.env.EXPO_PUBLIC_CATALOG_SOURCE);
  if (source === 'mock') {
    return new MockCatalogClient({
      scenario: readMockScenario(process.env.EXPO_PUBLIC_MOCK_CATALOG_SCENARIO),
    });
  }
  const baseUrl = process.env.EXPO_PUBLIC_B2C_API_URL?.trim() ?? '';
  if (!baseUrl) {
    throw new CatalogClientError(
      'CATALOG_SOURCE_UNAVAILABLE',
      'EXPO_PUBLIC_B2C_API_URL é obrigatória quando a fonte HTTP está ativa.',
    );
  }
  return new HttpCatalogClient({ baseUrl });
}

export const catalogClient = createCatalogClient();
