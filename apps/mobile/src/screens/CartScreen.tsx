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

import { theme } from '@/theme';
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

function getQuantityState(availability: string): { color: string; label: string } {
  switch (availability) {
    case 'in_stock':
      return { color: theme.colors.mint, label: 'Disponível' };
    case 'low_stock':
      return { color: theme.colors.copper, label: 'Últimas peças' };
    default:
      return { color: theme.colors.rose, label: 'Indisponível' };
  }
}

export function CartScreen() {
  const router = useRouter();
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
      const qtyState = getQuantityState(item.availability);
      return (
        <View style={styles.cartItem} testID="cart-item">
          <View style={styles.itemImageContainer}>
            {item.product.primary_image?.url ? (
              <Image
                source={{ uri: item.product.primary_image.url }}
                style={styles.itemImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.itemImage, styles.itemImagePlaceholder]}>
                <Text style={styles.placeholderText}>PE</Text>
              </View>
            )}
          </View>
          <View style={styles.itemDetails}>
            <Text style={styles.itemBrand} numberOfLines={1}>
              {item.product.brand}
            </Text>
            <Text style={styles.itemTitle} numberOfLines={2}>
              {item.product.title}
            </Text>
            <Text style={styles.itemVariant}>
              {[item.product.color, item.product.size].filter(Boolean).join(' · ')}
            </Text>
            <View style={styles.itemBottom}>
              <View style={styles.quantityRow}>
                <Pressable
                  style={styles.qtyButton}
                  onPress={() => handleQuantityChange(item.id, -1)}
                  accessibilityLabel="Diminuir quantidade"
                  testID={`qty-decrease-${item.id}`}
                >
                  <Text style={styles.qtyButtonText}>−</Text>
                </Pressable>
                <Text style={styles.qtyValue}>{item.quantity}</Text>
                <Pressable
                  style={styles.qtyButton}
                  onPress={() => handleQuantityChange(item.id, 1)}
                  accessibilityLabel="Aumentar quantidade"
                  testID={`qty-increase-${item.id}`}
                >
                  <Text style={styles.qtyButtonText}>+</Text>
                </Pressable>
              </View>
              <View style={styles.itemPriceRow}>
                <Text style={styles.itemTotal}>{formatBrl(item.line_total_cents)}</Text>
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
            <Text style={styles.removeIcon}>✕</Text>
          </Pressable>
        </View>
      );
    },
    [handleRemoveItem, handleQuantityChange]
  );

  if (state.status === 'loading') {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.copper} />
          <Text style={styles.loadingText}>Carregando seu carrinho...</Text>
        </View>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.container}>
        <View style={styles.stateContainer}>
          <Text style={styles.stateSymbol}>⚠</Text>
          <Text style={styles.stateTitle}>Algo deu errado</Text>
          <Text style={styles.stateBody}>{state.message || 'Não foi possível carregar o carrinho.'}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={loadCart}
            accessibilityLabel="Tentar carregar novamente"
            testID="cart-retry"
          >
            <Text style={styles.retryText}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state.status === 'empty') {
    return (
      <View style={styles.container}>
        <View style={styles.stateContainer}>
          <Text style={styles.stateSymbol}>○</Text>
          <Text style={styles.stateTitle}>Seu carrinho está vazio</Text>
          <Text style={styles.stateBody}>
            Explore a coleção e adicione suas peças favoritas.
          </Text>
          <Pressable
            style={styles.continueButton}
            onPress={() => router.navigate('/catalog')}
            testID="cart-continue-shopping"
          >
            <Text style={styles.continueButtonText}>Ver coleção</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="cart-screen">
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Carrinho</Text>
        <Text style={styles.headerSubtitle}>
          {state.itemCount} {state.itemCount === 1 ? 'peça' : 'peças'}
        </Text>
      </View>

      <FlatList
        data={state.items}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={
          <View style={styles.footer}>
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Subtotal</Text>
              <Text style={styles.subtotalValue}>{formatBrl(state.subtotalCents)}</Text>
            </View>
            <Text style={styles.disclaimer}>
              Preços e disponibilidade serão confirmados antes do pedido.
            </Text>
            <Pressable
              style={styles.checkoutButton}
              testID="cart-checkout"
              onPress={() => {
                // Fase 3.7 — carrinho read-only, sem criar pedido
              }}
              accessibilityLabel="Revisar entrega"
            >
              <Text style={styles.checkoutButtonText}>
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
    backgroundColor: theme.colors.ink,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
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
    color: theme.colors.copper,
    marginBottom: 16,
  },
  stateTitle: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  stateBody: {
    color: theme.colors.pearl,
    fontFamily: theme.typography.body,
    fontSize: 14,
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: theme.colors.copper,
    borderRadius: 6,
  },
  retryText: {
    color: theme.colors.copper,
    fontFamily: theme.typography.body,
    fontSize: 14,
    fontWeight: '600',
  },
  continueButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: theme.colors.copper,
    borderRadius: 6,
  },
  continueButtonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerTitle: {
    color: theme.colors.ivory,
    fontFamily: theme.typography.body,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 2,
  },
  headerSubtitle: {
    color: theme.colors.pearl,
    fontFamily: theme.typography.body,
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
    backgroundColor: theme.colors.paper,
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
    backgroundColor: 'rgba(255,255,255,0.05)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: theme.colors.pearl,
    fontSize: 12,
    opacity: 0.4,
  },
  itemDetails: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  itemBrand: {
    color: theme.colors.pearl,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    opacity: 0.7,
  },
  itemTitle: {
    color: theme.colors.ivory,
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  itemVariant: {
    color: theme.colors.pearl,
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
    borderColor: theme.colors.copper,
    borderRadius: 4,
  },
  qtyButtonText: {
    color: theme.colors.copper,
    fontSize: 16,
    fontWeight: '600',
  },
  qtyValue: {
    color: theme.colors.ivory,
    fontSize: 14,
    fontWeight: '600',
    minWidth: 20,
    textAlign: 'center',
  },
  itemPriceRow: {
    alignItems: 'flex-end',
  },
  itemTotal: {
    color: theme.colors.ivory,
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
    color: theme.colors.pearl,
    fontSize: 14,
    opacity: 0.4,
  },
  footer: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  subtotalLabel: {
    color: theme.colors.pearl,
    fontSize: 14,
    opacity: 0.7,
  },
  subtotalValue: {
    color: theme.colors.ivory,
    fontSize: 20,
    fontWeight: '700',
  },
  disclaimer: {
    color: theme.colors.pearl,
    fontSize: 12,
    opacity: 0.5,
    textAlign: 'center',
    marginBottom: 16,
  },
  checkoutButton: {
    backgroundColor: theme.colors.copper,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
  },
  checkoutButtonText: {
    color: theme.colors.ink,
    fontFamily: theme.typography.body,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
});
