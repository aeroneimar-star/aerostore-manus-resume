import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme, theme } from '@/theme';
import { createCartClient } from '@/cart/client';
import { CartClientError } from '@/cart/CartClientError';
import type { CartItem } from '@/cart/contracts';

type ScreenState = 'loading' | 'empty' | 'ready' | 'error';

interface CartState {
  status: ScreenState;
  items: CartItem[];
  subtotalCents: number;
  cartId: string | null;
  itemCount: number;
  message?: string;
}

function formatBrl(cents: number): string {
  return Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function getQuantityState(availability: string, tokens: import('@/theme').ThemeTokens): { color: string; label: string } {
  switch (availability) {
    case 'in_stock':
      return { color: tokens.success, label: 'Disponível' };
    case 'low_stock':
      return { color: tokens.accent, label: 'Últimas peças' };
    default:
      return { color: tokens.error, label: 'Indisponível' };
  }
}

export function CartScreen() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const client = createCartClient();
  const [state, setState] = useState<CartState>({
    status: 'loading',
    items: [],
    subtotalCents: 0,
    cartId: null,
    itemCount: 0,
  });

  const loadCart = useCallback(async () => {
    setState((prev) => ({ ...prev, status: 'loading' }));
    try {
      const response = await client.getCart();
      if (!response.data.cart) {
        setState({ status: 'empty', items: [], subtotalCents: 0, cartId: null, itemCount: 0 });
        return;
      }
      setState({
        status: 'ready',
        items: response.data.cart.items,
        subtotalCents: response.data.cart.subtotal_cents,
        cartId: response.data.cart.id,
        itemCount: response.data.cart.item_count,
      });
    } catch (error) {
      const cartError = error instanceof CartClientError ? error : new CartClientError('INTERNAL_ERROR', 'Erro ao carregar carrinho.');
      setState({
        status: 'error',
        items: [],
        subtotalCents: 0,
        cartId: null,
        itemCount: 0,
        message: cartError.message,
      });
    }
  }, []);

  useEffect(() => {
    void loadCart();
  }, [loadCart]);

  const handleRemoveItem = useCallback(async (itemId: string) => {
    try {
      const response = await client.removeItem(itemId);
      if (response.data.cart) {
        setState({
          status: response.data.cart.items.length === 0 ? 'empty' : 'ready',
          items: response.data.cart.items,
          subtotalCents: response.data.cart.subtotal_cents,
          cartId: response.data.cart.id,
          itemCount: response.data.cart.item_count,
        });
      }
    } catch {
      // Silently fail — refresh on next load
    }
  }, []);

  const handleQuantityChange = useCallback(async (itemId: string, delta: number) => {
    setState((prev) => {
      const item = prev.items.find((i) => i.id === itemId);
      if (!item) return prev;
      const newQty = Math.max(1, Math.min(item.quantity + delta, 99));
      if (newQty === item.quantity) return prev;
      return {
        ...prev,
        items: prev.items.map((i) =>
          i.id === itemId
            ? { ...i, quantity: newQty, line_total_cents: i.effective_unit_price_cents * newQty }
            : i
        ),
        subtotalCents: prev.items.reduce(
          (sum, i) =>
            i.id === itemId
              ? sum + i.effective_unit_price_cents * newQty
              : sum + i.line_total_cents,
          0
        ),
      };
    });
    try {
      const item = state.items.find((i) => i.id === itemId);
      if (!item) return;
      const response = await client.updateQuantity(itemId, { quantity: item.quantity + delta });
      if (response.data.cart) {
        setState({
          status: 'ready',
          items: response.data.cart.items,
          subtotalCents: response.data.cart.subtotal_cents,
          cartId: response.data.cart.id,
          itemCount: response.data.cart.item_count,
        });
      }
    } catch {
      // Revert handled by loadCart
    }
  }, [state.items]);

  const renderItem = useCallback(
    ({ item }: { item: CartItem }) => {
      const qtyState = getQuantityState(item.availability, tokens);
      return (
        <View style={[styles.cartItem, { backgroundColor: tokens.surface }]} testID="cart-item">
          <View style={styles.itemImageContainer}>
            {item.product.primary_image?.url ? (
              <Image
                source={{ uri: item.product.primary_image.url }}
                style={styles.itemImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.itemImage, styles.itemImagePlaceholder, { backgroundColor: tokens.surfaceMuted }]}>
                <Text style={[styles.placeholderText, { color: tokens.textMuted }]}>PE</Text>
              </View>
            )}
          </View>
          <View style={styles.itemDetails}>
            <Text style={[styles.itemBrand, { color: tokens.textMuted }]} numberOfLines={1}>
              {item.product.brand}
            </Text>
            <Text style={[styles.itemTitle, { color: tokens.textPrimary }]} numberOfLines={2}>
              {item.product.title}
            </Text>
            <Text style={[styles.itemVariant, { color: tokens.textMuted }]}>
              {[item.product.color, item.product.size].filter(Boolean).join(' · ')}
            </Text>
            <View style={styles.itemBottom}>
              <View style={styles.quantityRow}>
                <Pressable
                  style={[styles.qtyButton, { borderColor: tokens.accent }]}
                  onPress={() => handleQuantityChange(item.id, -1)}
                  accessibilityLabel="Diminuir quantidade"
                  testID={`qty-decrease-${item.id}`}
                >
                  <Text style={[styles.qtyButtonText, { color: tokens.accent }]}>−</Text>
                </Pressable>
                <Text style={[styles.qtyValue, { color: tokens.textPrimary }]}>{item.quantity}</Text>
                <Pressable
                  style={[styles.qtyButton, { borderColor: tokens.accent }]}
                  onPress={() => handleQuantityChange(item.id, 1)}
                  accessibilityLabel="Aumentar quantidade"
                  testID={`qty-increase-${item.id}`}
                >
                  <Text style={[styles.qtyButtonText, { color: tokens.accent }]}>+</Text>
                </Pressable>
              </View>
              <View style={styles.itemPriceRow}>
                <Text style={[styles.itemTotal, { color: tokens.textPrimary }]}>{formatBrl(item.line_total_cents)}</Text>
                <Text style={[styles.availabilityBadge, { color: qtyState.color }]}>
                  {qtyState.label}
                </Text>
              </View>
            </View>
          </View>
          <Pressable
            style={styles.removeButton}
            onPress={() => handleRemoveItem(item.id)}
            accessibilityLabel="Remover item"
            testID={`remove-${item.id}`}
          >
            <Text style={[styles.removeIcon, { color: tokens.textMuted }]}>✕</Text>
          </Pressable>
        </View>
      );
    },
    [handleRemoveItem, handleQuantityChange, tokens]
  );

  if (state.status === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={tokens.accent} />
          <Text style={[styles.loadingText, { color: tokens.textSecondary }]}>Carregando seu carrinho...</Text>
        </View>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.stateContainer}>
          <Text style={[styles.stateSymbol, { color: tokens.accent }]}>⚠</Text>
          <Text style={[styles.stateTitle, { color: tokens.textPrimary }]}>Algo deu errado</Text>
          <Text style={[styles.stateBody, { color: tokens.textMuted }]}>{state.message || 'Não foi possível carregar o carrinho.'}</Text>
          <Pressable
            style={[styles.retryButton, { borderColor: tokens.accent }]}
            onPress={loadCart}
            accessibilityLabel="Tentar carregar novamente"
            testID="cart-retry"
          >
            <Text style={[styles.retryText, { color: tokens.accent }]}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.status === 'empty') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.stateContainer}>
          <Text style={[styles.stateSymbol, { color: tokens.accent }]}>○</Text>
          <Text style={[styles.stateTitle, { color: tokens.textPrimary }]}>Seu carrinho está vazio</Text>
          <Text style={[styles.stateBody, { color: tokens.textMuted }]}>
            Explore a coleção e adicione suas peças favoritas.
          </Text>
          <Pressable
            style={[styles.continueButton, { backgroundColor: tokens.accent }]}
            onPress={() => router.navigate('/catalog')}
            testID="cart-continue-shopping"
          >
            <Text style={[styles.continueButtonText, { color: tokens.textInverse }]}>Ver coleção</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.background }]} testID="cart-screen">
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: tokens.textPrimary }]}>Carrinho</Text>
        <Text style={[styles.headerSubtitle, { color: tokens.textMuted }]}>
          {state.itemCount} {state.itemCount === 1 ? 'peça' : 'peças'}
        </Text>
      </View>

      <FlatList
        data={state.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={
          <View style={[styles.footer, { borderTopColor: tokens.border }]}>
            <View style={styles.subtotalRow}>
              <Text style={[styles.subtotalLabel, { color: tokens.textSecondary }]}>Subtotal</Text>
              <Text style={[styles.subtotalValue, { color: tokens.textPrimary }]}>{formatBrl(state.subtotalCents)}</Text>
            </View>
            <Text style={[styles.disclaimer, { color: tokens.textMuted }]}>
              Preços e disponibilidade serão confirmados antes do pedido.
            </Text>
            <Pressable
              style={[styles.checkoutButton, { backgroundColor: tokens.accent }]}
              testID="cart-checkout"
              onPress={() => {
                // Fase 3.7 — carrinho read-only, sem criar pedido
              }}
              accessibilityLabel="Revisar entrega"
            >
              <Text style={[styles.checkoutButtonText, { color: tokens.textInverse }]}>
                Revisar entrega
              </Text>
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    opacity: 0.7,
  },
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  stateSymbol: {
    fontSize: 48,
    marginBottom: 16,
  },
  stateTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 6,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  continueButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
  },
  continueButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
  },
  headerSubtitle: {
    fontSize: 13,
    opacity: 0.6,
    marginTop: 2,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  cartItem: {
    flexDirection: 'row',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
  },
  itemImageContainer: {
    width: 100,
    height: 120,
  },
  itemImage: {
    width: 100,
    height: 120,
  },
  itemImagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
    opacity: 0.4,
  },
  itemDetails: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  itemBrand: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.7,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  itemVariant: {
    fontSize: 12,
    opacity: 0.6,
    marginTop: 2,
  },
  itemBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  quantityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyButton: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 4,
  },
  qtyButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  qtyValue: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'center',
  },
  itemPriceRow: {
    alignItems: 'flex-end',
  },
  itemTotal: {
    fontSize: 14,
    fontWeight: '600',
  },
  availabilityBadge: {
    fontSize: 10,
    marginTop: 2,
  },
  removeButton: {
    padding: 8,
    justifyContent: 'flex-start',
  },
  removeIcon: {
    fontSize: 14,
    opacity: 0.4,
  },
  footer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  subtotalLabel: {
    fontSize: 14,
    opacity: 0.7,
  },
  subtotalValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  disclaimer: {
    fontSize: 12,
    opacity: 0.5,
    textAlign: 'center',
    marginBottom: 16,
  },
  checkoutButton: {
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  checkoutButtonText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
