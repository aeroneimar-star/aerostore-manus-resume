import { render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';
import { Image as ReactNativeImage } from 'react-native';

import type { CatalogClient } from '@/catalog/CatalogClient';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';
import { ProductScreen } from '@/screens/ProductScreen';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ slug: 'polo-pima-marinho' }),
}));

jest.mock('expo-image', () => ({
  Image: require('react-native').Image,
}));

const pendingClient: CatalogClient = {
  getCatalog: () => new Promise(() => undefined),
  getFilters: () => new Promise(() => undefined),
  getProductBySlug: () => new Promise(() => undefined),
};

describe('ProductScreen', () => {
  it('renders loading while product is pending', () => {
    const screen = render(<ProductScreen client={pendingClient} />);
    expect(screen.getByText('Preparando a coleção')).toBeTruthy();
  });

  it('renders approved product fields, variants and prototype notice', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 });
    const screen = render(
      <ProductScreen client={client} slugOverride="polo-pima-marinho" />,
    );
    expect(
      await screen.findByRole('header', { name: 'Polo Pima Marinho' }),
    ).toBeTruthy();
    expect(screen.getByText('Malha pima de toque macio e construção precisa.')).toBeTruthy();
    expect(screen.getByText('Marinho • M')).toBeTruthy();
    expect(screen.getByText('Indisponível para compra nesta versão')).toBeTruthy();
    expect(screen.UNSAFE_getAllByType(ReactNativeImage)).not.toHaveLength(0);
    expect(screen.queryByText('Imagem indisponível')).toBeNull();
  });

  it('renders an accessible placeholder when product images are empty', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 });
    const response = await client.getProductBySlug('polo-pima-marinho');
    jest.spyOn(client, 'getProductBySlug').mockResolvedValue({
      ...response,
      data: {
        product: {
          ...response.data.product,
          images: [],
        },
      },
    });
    const screen = render(
      <ProductScreen
        client={client}
        slugOverride="polo-pima-marinho"
      />,
    );
    expect(
      await screen.findByRole('header', { name: 'Polo Pima Marinho' }),
    ).toBeTruthy();
    expect(screen.getByText('Imagem indisponível')).toBeTruthy();
    expect(screen.getByLabelText('Imagem do produto indisponível')).toHaveProp(
      'accessibilityRole',
      'image',
    );
    expect(screen.UNSAFE_queryAllByType(ReactNativeImage)).toHaveLength(0);
    expect(screen.getByLabelText(/199,90/)).toBeTruthy();
  });

  it('renders product not found', async () => {
    const client = new MockCatalogClient({
      scenario: 'product_not_found',
      latencyMs: 0,
    });
    const screen = render(<ProductScreen client={client} slugOverride="ausente" />);
    expect(await screen.findByText('Esta peça não está disponível')).toBeTruthy();
  });

  it('renders recoverable product error', async () => {
    const client = new MockCatalogClient({
      scenario: 'internal_error',
      latencyMs: 0,
    });
    const screen = render(<ProductScreen client={client} />);
    expect(await screen.findByText('A coleção fez uma pausa')).toBeTruthy();
    expect(screen.getByLabelText('Tentar carregar novamente')).toBeTruthy();
  });
});
