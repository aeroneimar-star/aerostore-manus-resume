import { describe, expect, it } from '@jest/globals';

import { B2C_API_VERSION } from '@/catalog/contracts';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';

const forbiddenKeys = new Set([
  'internal_id',
  'product_id',
  'pdv_product_ref',
  'publication_id',
  'variant_id',
  'legacy_ai_product_id',
  'tiny_id',
  'barcode',
  'cost',
  'cost_cents',
  'cost_price_cents',
  'store_id',
  'available_qty',
  'reserved_qty',
  'local_path',
  'metadata_json',
  'margin',
  'notes',
  'source',
]);

function collectKeys(value: unknown, keys = new Set<string>()) {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
    return keys;
  }
  Object.entries(value).forEach(([key, nested]) => {
    keys.add(key);
    collectKeys(nested, keys);
  });
  return keys;
}

describe('mock B2C V1 contract', () => {
  const client = new MockCatalogClient({ latencyMs: 0 });

  it('returns catalog with required public fields and v1 meta', async () => {
    const response = await client.getCatalog({ pageSize: 48 });
    expect(response.meta.api_version).toBe(B2C_API_VERSION);
    expect(response.success).toBe(true);
    expect(response.data.items.length).toBeGreaterThan(0);
    expect(response.data.pagination).toEqual({
      page: 1,
      limit: 48,
      total: expect.any(Number),
      total_pages: expect.any(Number),
    });
    expect(response.data.items[0]).toEqual(expect.objectContaining({
      slug: expect.any(String),
      title: expect.any(String),
      price_cents: expect.any(Number),
      featured: expect.any(Boolean),
      availability: expect.stringMatching(/^(in_stock|low_stock|out_of_stock)$/),
      variant_count: expect.any(Number),
      colors: expect.any(Array),
      color_slugs: expect.any(Array),
      sizes: expect.any(Array),
    }));
  });

  it('contains no internal fields in catalog, filters or product', async () => {
    const payloads: unknown[] = [
      await client.getCatalog({ pageSize: 48 }),
      await client.getFilters(),
      await client.getProduct('1'),
    ];
    for (const payload of payloads) {
      const keys = collectKeys(payload);
      for (const forbidden of forbiddenKeys) {
        expect(keys.has(forbidden)).toBe(false);
      }
    }
  });

  it('covers editorial variants and availability states', async () => {
    const response = await client.getCatalog({ pageSize: 48 });
    const items = response.data.items;
    expect(items.some((item) => item.featured)).toBe(true);
    expect(items.some((item) => !item.featured)).toBe(true);
    expect(items.some((item) => item.compare_at_price_cents)).toBe(true);
    expect(new Set(items.map((item) => item.availability))).toEqual(
      new Set(['in_stock', 'low_stock', 'out_of_stock']),
    );
  });
});
