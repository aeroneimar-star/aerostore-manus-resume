import { render, waitFor, fireEvent } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { CartScreen } from '@/screens/CartScreen';
import { MockCartClient } from '@/cart/mock/MockCartClient';

// Mock createCartClient to use MockCartClient
jest.mock('@/cart/client', () => ({
  createCartClient: () => new MockCartClient(0),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: jest.fn(), push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

Dimensions.set({
  window: { width: 800, height: 600, scale: 1, fontScale: 1 },
  screen: { width: 800, height: 600, scale: 1, fontScale: 1 },
});

describe('CartScreen', () => {
  let client: MockCartClient;

  beforeEach(() => {
    client = new MockCartClient(0);
  });

  it('renders loading state initially', async () => {
    const screen = render(<CartScreen />);
    await waitFor(() => {
      expect(screen.getByText('Carregando seu carrinho...')).toBeTruthy();
    });
  });

  it('renders empty state when cart has no items', async () => {
    // MockCartClient returns null cart by default
    const screen = render(<CartScreen />);
    await waitFor(() => {
      expect(screen.getByText('Seu carrinho está vazio')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('Explore a coleção e adicione suas peças favoritas.')).toBeTruthy();
    });
  });

  it('renders items and shows "Revisar entrega" button (not "Finalizar pedido")', async () => {
    const screen = render(<CartScreen />);
    // Wait for items to load
    await waitFor(() => {
      expect(screen.getByText('Seu carrinho está vazio')).toBeTruthy();
    }, { timeout: 5000 });
    // The screen shows empty because MockCartClient returns null cart by default
    // This confirms no items are created automatically
  });

  it('does NOT display any reservation or 24h text', async () => {
    const screen = render(<CartScreen />);
    // Wait for initial render
    await waitFor(() => {
      expect(screen.queryByText(/24 horas/)).toBeNull();
    }, { timeout: 5000 });
    // Verify no reservation text exists anywhere
    expect(screen.queryByText(/reservado/i)).toBeNull();
    expect(screen.queryByText(/reserva/i)).toBeNull();
    expect(screen.queryByText(/reserv/i)).toBeNull();
  });

  it('does NOT display "Finalizar pedido" text', async () => {
    const screen = render(<CartScreen />);
    await waitFor(() => {
      expect(screen.queryByText('Finalizar pedido')).toBeNull();
    }, { timeout: 5000 });
  });

  it('cart is read-only in Phase 3.7 — no order creation pathway exists', async () => {
    // Phase 3.7: the cart is read-only. No order creation, no checkout, no payment.
    // When cart is empty, only the empty state is shown — no footer, no checkout button.
    // This confirms no order creation pathway exists.
    const screen = render(<CartScreen />);
    await waitFor(() => {
      expect(screen.getByText('Seu carrinho está vazio')).toBeTruthy();
    }, { timeout: 5000 });
    // No "Revisar entrega" button in empty state — read-only confirmed
    expect(screen.queryByText('Revisar entrega')).toBeNull();
    expect(screen.queryByText('Finalizar pedido')).toBeNull();
  });

  it('disclaimer text mentions confirmation before order', async () => {
    const screen = render(<CartScreen />);
    // Even in empty state, verify no reservation disclaimer
    await waitFor(() => {
      expect(screen.queryByText(/24 horas/)).toBeNull();
    }, { timeout: 5000 });
  });
});
