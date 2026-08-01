import { render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';
import { Image as ReactNativeImage } from 'react-native';
import type { CatalogClient } from '@/catalog/CatalogClient';
import { MockCatalogClient } from '@/catalog/mock/MockCatalogClient';
import { ProductScreen } from '@/screens/ProductScreen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ slug: '1' }), useRouter: () => ({ replace: mockReplace }) }));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
const pendingClient: CatalogClient = { getCatalog: () => new Promise(() => undefined), getFilters: () => new Promise(() => undefined), getProduct: () => new Promise(() => undefined) };

describe('ProductScreen', () => {
  it('renders loading while product is pending', () => { const screen = render(<ProductScreen client={pendingClient} />); expect(screen.getByText('Preparando a coleção')).toBeTruthy(); });
  it('renders gallery, prices, colors, sizes and the no-purchase notice', async () => { const screen = render(<ProductScreen client={new MockCatalogClient({ latencyMs: 0 })} productIdOverride="1" />); expect(await screen.findByRole('header', { name: 'Polo Pima Marinho' })).toBeTruthy(); expect(screen.getByText(/Osklen · Polos/)).toBeTruthy(); expect(screen.getByText('CÓDIGO AERO-000001')).toBeTruthy(); expect(screen.getByText('Marinho • M')).toBeTruthy(); expect(screen.getByText('Compra disponível em breve.')).toBeTruthy(); expect(screen.UNSAFE_getAllByType(ReactNativeImage)).not.toHaveLength(0); });
  it('renders an accessible image placeholder', async () => { const client = new MockCatalogClient({ latencyMs: 0 }); const response = await client.getProduct('1'); jest.spyOn(client, 'getProduct').mockResolvedValue({ ...response, data: { product: { ...response.data.product, images: [] } } }); const screen = render(<ProductScreen client={client} productIdOverride="1" />); await screen.findByRole('header', { name: 'Polo Pima Marinho' }); expect(screen.getByLabelText('Imagem do produto indisponível')).toHaveProp('accessibilityRole', 'image'); });
  it('renders product not found and retryable failure', async () => { const missing = render(<ProductScreen client={new MockCatalogClient({ scenario: 'product_not_found', latencyMs: 0 })} productIdOverride="999" />); expect(await missing.findByText('Esta peça não está disponível')).toBeTruthy(); missing.unmount(); const failed = render(<ProductScreen client={new MockCatalogClient({ scenario: 'internal_error', latencyMs: 0 })} productIdOverride="1" />); expect(await failed.findByLabelText('Tentar carregar novamente')).toBeTruthy(); });
});
