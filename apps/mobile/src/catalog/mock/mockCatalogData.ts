import type {
  B2cCatalogFilter,
  B2cCatalogItem,
  B2cProduct,
} from '../contracts';

const image = (seed: string, alt: string, sortOrder = 0) => ({
  url: `https://images.unsplash.com/${seed}?auto=format&fit=crop&w=1200&q=85`,
  alt,
  sort_order: sortOrder,
  role: sortOrder === 0 ? 'primary' : 'gallery',
});

export const mockProducts: B2cProduct[] = [
  {
    slug: 'polo-pima-marinho',
    title: 'Polo Pima Marinho',
    short_description: 'Malha pima de toque macio e construção precisa.',
    description:
      'Uma polo essencial elevada pelo algodão pima, gola estruturada e acabamento limpo. Pensada para atravessar trabalho, viagem e fim de semana.',
    category_slug: 'polos',
    category_label: 'Polos',
    price_cents: 19990,
    compare_at_price_cents: null,
    featured: true,
    availability: 'in_stock',
    images: [
      image('photo-1617137968427-85924c800a22', 'Homem usando polo marinho'),
      image('photo-1610652492500-ded49ceeb378', 'Detalhe da malha marinho', 1),
    ],
    variants: [
      { slug: 'polo-pima-marinho-m', color: 'Marinho', color_slug: 'marinho', size: 'M', size_slug: 'm', price_cents: 19990, availability: 'in_stock' },
      { slug: 'polo-pima-marinho-g', color: 'Marinho', color_slug: 'marinho', size: 'G', size_slug: 'g', price_cents: 19990, availability: 'in_stock' },
      { slug: 'polo-pima-branco-m', color: 'Branco', color_slug: 'branco', size: 'M', size_slug: 'm', price_cents: 19990, availability: 'low_stock' },
    ],
    seo: {
      title: 'Polo Pima Marinho | AEROSTORE',
      description: 'Polo masculina em algodão pima.',
    },
  },
  {
    slug: 'camiseta-essencial-branca',
    title: 'Camiseta Essencial',
    short_description: 'Algodão encorpado, proporção contemporânea.',
    description:
      'A camiseta de todos os dias com gramatura consistente, caimento reto e gola que preserva a forma.',
    category_slug: 'camisetas',
    category_label: 'Camisetas',
    price_cents: 14990,
    featured: true,
    availability: 'in_stock',
    images: [image('photo-1521572163474-6864f9cf17ab', 'Camiseta branca essencial')],
    variants: [
      { slug: 'camiseta-essencial-branca-m', color: 'Branco', color_slug: 'branco', size: 'M', size_slug: 'm', price_cents: 14990, availability: 'in_stock' },
      { slug: 'camiseta-essencial-branca-g', color: 'Branco', color_slug: 'branco', size: 'G', size_slug: 'g', price_cents: 14990, availability: 'in_stock' },
    ],
  },
  {
    slug: 'calca-chino-petroleo',
    title: 'Chino Azul Petróleo',
    short_description: 'Alfaiataria casual com movimento.',
    description:
      'Construção limpa, tecido confortável e cor profunda. Uma base versátil para composições precisas sem formalidade excessiva.',
    category_slug: 'calcas',
    category_label: 'Calças',
    price_cents: 28990,
    compare_at_price_cents: 31990,
    featured: false,
    availability: 'in_stock',
    images: [
      image('photo-1506629082955-511b1aa562c8', 'Calça chino azul petróleo'),
      image('photo-1473966968600-fa801b869a1a', 'Detalhe da calça chino', 1),
    ],
    variants: [
      { slug: 'calca-chino-petroleo-42', color: 'Azul Petróleo', color_slug: 'petroleo', size: '42', size_slug: '42', price_cents: 28990, compare_at_price_cents: 31990, availability: 'in_stock' },
      { slug: 'calca-chino-petroleo-44', color: 'Azul Petróleo', color_slug: 'petroleo', size: '44', size_slug: '44', price_cents: 28990, compare_at_price_cents: 31990, availability: 'in_stock' },
      { slug: 'calca-chino-areia-42', color: 'Areia', color_slug: 'areia', size: '42', size_slug: '42', price_cents: 28990, compare_at_price_cents: 31990, availability: 'low_stock' },
    ],
  },
  {
    slug: 'tenis-nobuck-cognac',
    title: 'Tênis Nobuck Cognac',
    short_description: 'Perfil mínimo, matéria-prima tátil.',
    description:
      'Tênis de linhas essenciais com acabamento em nobuck e sola de perfil baixo. Uma leitura sofisticada para o cotidiano.',
    category_slug: 'calcados',
    category_label: 'Calçados',
    price_cents: 36990,
    featured: true,
    availability: 'low_stock',
    images: [
      image('photo-1542291026-7eec264c27ff', 'Tênis em nobuck cognac'),
      image('photo-1549298916-b41d501d3772', 'Tênis visto de perfil', 1),
    ],
    variants: [
      { slug: 'tenis-nobuck-cognac-40', color: 'Cognac', color_slug: 'cognac', size: '40', size_slug: '40', price_cents: 36990, availability: 'in_stock' },
      { slug: 'tenis-nobuck-cognac-41', color: 'Cognac', color_slug: 'cognac', size: '41', size_slug: '41', price_cents: 36990, availability: 'low_stock' },
      { slug: 'tenis-nobuck-preto-42', color: 'Preto', color_slug: 'preto', size: '42', size_slug: '42', price_cents: 36990, availability: 'out_of_stock' },
    ],
  },
  {
    slug: 'bermuda-sarja-areia',
    title: 'Bermuda Sarja Areia',
    short_description: 'Textura natural e corte equilibrado.',
    description:
      'Sarja leve com toque lavado, comprimento contemporâneo e construção confortável para dias de ritmo mais leve.',
    category_slug: 'bermudas',
    category_label: 'Bermudas',
    price_cents: 21990,
    featured: false,
    availability: 'low_stock',
    images: [image('photo-1591195853828-11db59a44f6b', 'Bermuda de sarja em tom areia')],
    variants: [
      { slug: 'bermuda-sarja-areia-42', color: 'Areia', color_slug: 'areia', size: '42', size_slug: '42', price_cents: 21990, availability: 'in_stock' },
      { slug: 'bermuda-sarja-areia-44', color: 'Areia', color_slug: 'areia', size: '44', size_slug: '44', price_cents: 21990, availability: 'low_stock' },
    ],
  },
  {
    slug: 'mocassim-couro-caramelo',
    title: 'Mocassim Couro Caramelo',
    short_description: 'Clássico leve para uma rotina contemporânea.',
    description:
      'Mocassim de linhas suaves, couro caramelo e acabamento discreto. Elegância sem excesso para composições urbanas.',
    category_slug: 'calcados',
    category_label: 'Calçados',
    price_cents: 39990,
    featured: false,
    availability: 'out_of_stock',
    images: [image('photo-1614252369475-531eba835eb1', 'Mocassim de couro caramelo')],
    variants: [
      { slug: 'mocassim-couro-caramelo-40', color: 'Caramelo', color_slug: 'caramelo', size: '40', size_slug: '40', price_cents: 39990, availability: 'out_of_stock' },
      { slug: 'mocassim-couro-caramelo-41', color: 'Caramelo', color_slug: 'caramelo', size: '41', size_slug: '41', price_cents: 39990, availability: 'out_of_stock' },
    ],
  },
];

const statusCopy = {
  in_stock: 'Disponível na coleção',
  low_stock: 'Últimas disponibilidades',
  out_of_stock: 'Indisponível no momento',
} as const;

export const mockCatalogItems: B2cCatalogItem[] = mockProducts.map((product) => {
  const colors = [...new Set(product.variants.flatMap((variant) => variant.color ? [variant.color] : []))];
  const colorSlugs = [...new Set(product.variants.flatMap((variant) => variant.color_slug ? [variant.color_slug] : []))];
  const sizes = [...new Set(product.variants.flatMap((variant) => variant.size ? [variant.size] : []))];
  return {
    slug: product.slug,
    title: product.title,
    short_description: product.short_description,
    category_slug: product.category_slug,
    category_label: product.category_label,
    price_cents: product.price_cents,
    compare_at_price_cents: product.compare_at_price_cents,
    featured: product.featured,
    availability: product.availability,
    primary_image: product.images[0] ?? null,
    variant_count: product.variants.length,
    colors,
    color_slugs: colorSlugs,
    sizes,
    action_label: 'Ver produto',
    status_copy: statusCopy[product.availability],
    badge_label: product.featured ? 'Destaque' : undefined,
  };
});

const toSlug = (value: string) =>
  value.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const countBy = (values: (string | undefined)[]): B2cCatalogFilter[] => {
  const counts = new Map<string, { label: string; count: number }>();
  for (const value of values) {
    if (!value) continue;
    const slug = toSlug(value);
    const current = counts.get(slug);
    counts.set(slug, { label: value, count: (current?.count ?? 0) + 1 });
  }
  return [...counts.entries()]
    .map(([slug, entry]) => ({ slug, ...entry }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
};

export const mockFilters = {
  categories: countBy(mockCatalogItems.map((item) => item.category_label)),
  colors: countBy(mockCatalogItems.flatMap((item) => item.colors)),
  sizes: countBy(mockCatalogItems.flatMap((item) => item.sizes)),
};
