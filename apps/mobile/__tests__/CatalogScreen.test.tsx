import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RefreshControl } from 'react-native';
import type { CatalogClient } from '@/catalog/CatalogClient';
import { CatalogClientError } from '@/catalog/CatalogClientError';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';
import { CatalogScreen } from '@/screens/CatalogScreen';

const mockPush = jest.fn(); const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

const pendingClient: CatalogClient = { getCatalog: () => new Promise(() => undefined), getFilters: () => new Promise(() => undefined), getProduct: () => new Promise(() => undefined) };

describe('CatalogScreen', () => {
  beforeEach(() => { mockPush.mockClear(); mockReplace.mockClear(); jest.useRealTimers(); });

  it('shows the catalog skeleton while loading', () => { const screen = render(<CatalogScreen client={pendingClient} />); expect(screen.getByLabelText('Carregando catálogo')).toBeTruthy(); });

  it('renders products and opens detail by public product id', async () => { const screen = render(<CatalogScreen client={new MockCatalogClient({ latencyMs: 0 })} />); await screen.findByText('Polo Pima Marinho'); fireEvent.press(screen.getByLabelText('Ver produto Polo Pima Marinho')); expect(mockPush).toHaveBeenCalledWith('/product/1'); });

  it('renders empty, error and retry states', async () => {
    const empty = render(<CatalogScreen client={new MockCatalogClient({ scenario: 'empty', latencyMs: 0 })} />); expect(await empty.findByText('Nada por aqui ainda')).toBeTruthy(); empty.unmount();
    const client = new MockCatalogClient({ scenario: 'internal_error', latencyMs: 0 }); const error = render(<CatalogScreen client={client} />); expect(await error.findByText('A coleção fez uma pausa')).toBeTruthy(); fireEvent.press(error.getByLabelText('Tentar carregar novamente')); expect(error.getByLabelText('Carregando catálogo')).toBeTruthy();
  });

  it('applies category, debounced search and ordering', async () => {
    jest.useFakeTimers(); const client = new MockCatalogClient({ latencyMs: 0 }); const getCatalog = jest.spyOn(client, 'getCatalog'); const screen = render(<CatalogScreen client={client} />);
    await act(async () => { jest.runOnlyPendingTimers(); }); await screen.findByText('Polo Pima Marinho');
    fireEvent.press(screen.getByLabelText('Polos, 1 produtos')); await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ category: 'polos' })));
    fireEvent.changeText(screen.getByLabelText('Buscar no catálogo'), 'pima'); await act(async () => { jest.advanceTimersByTime(350); }); await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ search: 'pima' })));
    fireEvent.press(screen.getByLabelText('Menor preço')); await waitFor(() => expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ sort: 'preco_asc' })));
  });

  it('supports pagination and pull-to-refresh', async () => {
    const client = new MockCatalogClient({ latencyMs: 0 }); const getCatalog = jest.spyOn(client, 'getCatalog'); const screen = render(<CatalogScreen client={client} />); await screen.findByText('Polo Pima Marinho');
    fireEvent.press(screen.getByLabelText('Carregar mais peças')); await screen.findByText('Mocassim Couro Caramelo'); expect(getCatalog).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
    act(() => { screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); }); await waitFor(() => expect(getCatalog.mock.calls.filter(([query]) => query?.page === 1).length).toBeGreaterThan(1));
  });

  it('returns denied customers to access status', async () => {
    const denied: CatalogClient = { ...pendingClient, getCatalog: async () => { throw new CatalogClientError('APP_ACCESS_NOT_APPROVED', 'denied', { status: 403 }); }, getFilters: async () => ({ success: true, data: { categories: [] }, meta: { api_version: 'v1' } }) };
    render(<CatalogScreen client={denied} />); await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/access-status'));
  });
});
