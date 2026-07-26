import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { CatalogClient } from '@/catalog/CatalogClient';
import { CatalogClientError } from '@/catalog/CatalogClientError';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';
import { CatalogScreen } from '@/screens/CatalogScreen';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-image', () => ({
  Image: require('react-native').Image,
}));

const pendingClient: CatalogClient = {
  getCatalog: () => new Promise(() => undefined),
  getFilters: () => new Promise(() => undefined),
  getProductBySlug: () => new Promise(() => undefined),
};

describe('CatalogScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('announces loading while the source is pending', () => {
    const screen = render(<CatalogScreen client={pendingClient} />);
    expect(screen.getByText('Preparando a coleção')).toBeTruthy();
    expect(screen.getByLabelText('Carregando coleção')).toBeTruthy();
  });

  it('renders products and opens a product route', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 });
    const screen = render(<CatalogScreen client={client} />);
    const title = await screen.findByText('Polo Pima Marinho');
    expect(title).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Ver produto Polo Pima Marinho'));
    expect(mockPush).toHaveBeenCalledWith('/product/polo-pima-marinho');
  });

  it('renders empty state', async () => {
    const client = new MockCatalogClient({ scenario: 'empty', latencyMs: 0 });
    const screen = render(<CatalogScreen client={client} />);
    expect(await screen.findByText('Nada por aqui ainda')).toBeTruthy();
  });

  it('renders the dedicated catalog disabled state without technical code', async () => {
    const client = new MockCatalogClient({
      scenario: 'catalog_disabled',
      latencyMs: 0,
    });
    const screen = render(<CatalogScreen client={client} />);
    expect(
      await screen.findByText('O catálogo ainda não está disponível.'),
    ).toBeTruthy();
    expect(screen.queryByText('CATALOG_DISABLED')).toBeNull();
  });

  it('renders a retry action for recoverable errors', async () => {
    const client = new MockCatalogClient({
      scenario: 'internal_error',
      latencyMs: 0,
    });
    const screen = render(<CatalogScreen client={client} />);
    expect(await screen.findByText('A coleção fez uma pausa')).toBeTruthy();
    expect(screen.getByLabelText('Tentar carregar novamente')).toBeTruthy();
  });

  it('passes category and both featured values to the client', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 });
    const getCatalog = jest.spyOn(client, 'getCatalog');
    const screen = render(<CatalogScreen client={client} />);
    await screen.findByText('Polo Pima Marinho');

    fireEvent.press(screen.getByLabelText('Polos, 1 produtos'));
    await waitFor(() => {
      expect(getCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'polos' }),
      );
    });

    fireEvent.press(screen.getByLabelText('Destaques'));
    await waitFor(() => {
      expect(getCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'polos', featured: true }),
      );
    });

    fireEvent.press(screen.getByLabelText('Não destacados'));
    await waitFor(() => {
      expect(getCatalog).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'polos', featured: false }),
      );
    });
  });

  it('normalizes unknown failures as an internal screen error', async () => {
    const client: CatalogClient = {
      getCatalog: async () => {
        throw new Error('private network detail');
      },
      getFilters: async () => {
        throw new CatalogClientError('INTERNAL_ERROR', 'private');
      },
      getProductBySlug: pendingClient.getProductBySlug,
    };
    const screen = render(<CatalogScreen client={client} />);
    expect(await screen.findByText('A coleção fez uma pausa')).toBeTruthy();
    expect(screen.queryByText('private network detail')).toBeNull();
  });
});
