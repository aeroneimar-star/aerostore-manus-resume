import { act, render, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { describe, expect, it, jest } from '@jest/globals';
import type { CatalogClient } from '@/catalog/CatalogClient';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';
import { ProductScreen } from '@/screens/ProductScreen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ slug: '1' }),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

Dimensions.set({
  window: { width: 800, height: 600, scale: 1, fontScale: 1 },
  screen: { width: 800, height: 600, scale: 1, fontScale: 1 },
});

const pendingClient: CatalogClient = {
  getCatalog: () => new Promise(() => undefined),
  getFilters: () => new Promise(() => undefined),
  getProduct: () => new Promise(() => undefined),
};

describe('ProductScreen', () => {
  it('renders loading while product is pending', () => {
    const screen = render(<ProductScreen client={pendingClient} />);
    expect(screen.getByText('Preparando a coleção')).toBeTruthy();
  });

  it('renders gallery, prices, colors, sizes and the no-purchase notice', async () => {
    const screen = render(<ProductScreen client={new MockCatalogClient({ latencyMs: 0 })} productIdOverride="1" />);
    await waitFor(() => expect(screen.getByText('Polo Pima Marinho')).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Osklen · Polos/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('CÓDIGO AERO-000001')).toBeTruthy());
    await waitFor(() => expect(screen.getByLabelText('Adicionar ao carrinho')).toBeTruthy());
  });

  it('renders an accessible image placeholder', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 });
    const response = await client.getProduct('1');
    jest.spyOn(client, 'getProduct').mockResolvedValue({
      ...response,
      data: { product: { ...response.data.product, images: [] } },
    });
    const screen = render(<ProductScreen client={client} productIdOverride="1" />);
    await waitFor(() =>
      expect(screen.getByLabelText('Imagem do produto indisponível')).toHaveProp('accessibilityRole', 'image'),
    );
  });

  it('renders product not found state', async () => {
    const missing = render(
      <ProductScreen client={new MockCatalogClient({ scenario: 'product_not_found', latencyMs: 0 })} productIdOverride="999" />,
    );
    await waitFor(() => expect(missing.getByText('Esta peça não está disponível')).toBeTruthy());
  });

  it('renders error state with retry', async () => {
    const failed = render(
      <ProductScreen client={new MockCatalogClient({ scenario: 'internal_error', latencyMs: 0 })} productIdOverride="1" />,
    );
    await waitFor(() => expect(failed.getByLabelText('Tentar carregar novamente')).toBeTruthy());
  });
});
