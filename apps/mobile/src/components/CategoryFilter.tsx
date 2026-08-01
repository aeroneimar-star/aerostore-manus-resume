import type { B2cCatalogFilter } from '@/catalog/contracts';
import { FilterChips } from './FilterChips';

export function CategoryFilter({ categories, value, onChange }: { categories: B2cCatalogFilter[]; value?: string; onChange(value?: string): void }) {
  return <FilterChips label="Filtrar por categoria" value={value} onChange={onChange} options={[{ label: 'Todas', value: undefined }, ...categories.map((item) => ({ label: item.label, value: item.slug, count: item.count }))]} />;
}
