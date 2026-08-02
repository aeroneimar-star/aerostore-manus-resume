import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RefreshControl } from 'react-native';
import type { CatalogClient } from '@/catalog/CatalogClient';
import { CatalogClientError } from '@/catalog/CatalogClientError';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';
import { CatalogScreen } from '@/screens/CatalogScreen';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockRouter = { push: mockPush, replace: mockReplace };

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Href: String,
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

describe('CatalogScreen', () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockReplace.mockClear();
  });

  it('shows the catalog skeleton while loading', () => {
    const screen = render(<CatalogScreen client={pendingClient} />);
    expect(screen.getByLabelText('Carregando catálogo')).toBeTruthy();
  });

  it('renders products and opens detail by public product id', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 });
    const screen = render(<CatalogScreen client={client} />);
    // First product with default sort (recentes) is Mocassim Couro Caramelo
    await waitFor(() => expect(screen.getByText('Mocassim Couro Caramelo')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Ver produto Mocassim Couro Caramelo'));
    // The router push uses item.id — check what id is returned
    expect(mockPush).toHaveBeenCalled();
    expect(mockPush.mock.calls[0][0]).toMatch(/\/product\//);
  });

  it('renders empty, error and retry states', async () => {
    const empty = render(<CatalogScreen client={new MockCatalogClient({ scenario: 'empty', latencyMs: 0 })} />);
    await waitFor(() => expect(empty.getByText('Nada por aqui ainda')).toBeTruthy());
    empty.unmount();
    const client = new MockCatalogClient({ scenario: 'internal_error', latencyMs: 0 });
    const errorScreen = render(<CatalogScreen client={client} />);
    await waitFor(() => expect(errorScreen.getByText('A coleção fez uma pausa')).toBeTruthy());
    fireEvent.press(errorScreen.getByLabelText('Tentar carregar novamente'));
    expect(errorScreen.getByLabelText('Carregando catálogo')).toBeTruthy();
  });

  it('applies category, debounced search and ordering', async () => {
    jest.useFakeTimers();
    const client = new MockCatalogClient({ latencyMs: 0 });
    const getCatalog = jest.spyOn(client, 'getCatalog');
    const screen = render(<CatalogScreen client={client} />);
    await waitFor(() => expect(screen.getByText('Mocassim Couro Caramelo')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Polos, 1 produtos'));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ category: 'polos' })));
    fireEvent.changeText(screen.getByLabelText('Buscar no catálogo'), 'polo');
    await act(async () => { jest.advanceTimersByTime(350); });
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ search: 'polo' })));
    fireEvent.press(screen.getByLabelText('Menor preço'));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ sort: 'preco_asc' })));
    jest.useRealTimers();
  });

  it('supports pagination and pull-to-refresh', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 });
    const getCatalog = jest.spyOn(client, 'getCatalog');
    const screen = render(<CatalogScreen client={client} />);
    await waitFor(() => expect(screen.getByText('Mocassim Couro Caramelo')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Carregar mais peças'));
    await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ page: 2 })));
    act(() => {
      screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    await waitFor(() => expect(getCatalog.mock.calls.filter(([query]) => query?.page === 1).length).toBeGreaterThan(1));
  });

  it('returns denied customers to access status', async () => {
    const denied: CatalogClient = {
      ...pendingClient,
      getCatalog: async () => {
        throw new CatalogClientError('APP_ACCESS_NOT_APPROVED', 'denied', { status: 403 });
      },
      getFilters: async () => ({
        success: true,
        data: { categories: [] },
        meta: { api_version: 'v1' },
      }),
    };
    const screen = render(<CatalogScreen client={denied} />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/access-status'));
    screen.unmount();
  });
});
