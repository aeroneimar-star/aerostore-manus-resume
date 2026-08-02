import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl, ScrollView, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme, theme } from '@/theme';
import { orderClient } from '@/orders/client';
import { toOrderClientError } from '@/orders/OrderClientError';
import type { ThemeTokens } from '@/theme';
import type { OrderSummary, OrderStatus } from '@/orders/contracts';

type ScreenState = 'loading' | 'ready' | 'error' | 'empty';
type FilterKey = 'ALL' | 'IN_PROGRESS' | 'DELIVERED' | 'CANCELLED';

const MAX_CONTENT_WIDTH = 1100;

const STATUS_LABELS: Record<OrderStatus, string> = {
  STOCK_RESERVED: 'Reserva em andamento',
  READY_FOR_PAYMENT: 'Aguardando pagamento',
  PAYMENT_PENDING: 'Pagamento pendente',
  PAYMENT_APPROVED: 'Pagamento aprovado',
  PAYMENT_DECLINED: 'Pagamento recusado',
  FULFILLING: 'Em preparação',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
  FAILED: 'Falhou',
  EXPIRED: 'Expirado',
};

const STATUS_COLORS: Record<string, string> = {
  READY_FOR_PAYMENT: 'warning',
  STOCK_RESERVED: 'info',
  PAYMENT_APPROVED: 'success',
  COMPLETED: 'success',
  FULFILLING: 'info',
  SHIPPED: 'info',
  DELIVERED: 'success',
  CANCELLED: 'error',
  FAILED: 'error',
  EXPIRED: 'error',
};

function formatBrl(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

function getStatusColor(status: OrderStatus, tokens: ThemeTokens): string {
  const key = STATUS_COLORS[status] || 'textMuted';
  return (tokens[key as keyof ThemeTokens] as string) || tokens.textMuted;
}

function orderMatchesFilter(order: OrderSummary, filter: FilterKey): boolean {
  switch (filter) {
    case 'ALL': return true;
    case 'IN_PROGRESS': return ['STOCK_RESERVED', 'READY_FOR_PAYMENT', 'PAYMENT_PENDING', 'FULFILLING', 'SHIPPED'].includes(order.status);
    case 'DELIVERED': return ['DELIVERED', 'COMPLETED'].includes(order.status);
    case 'CANCELLED': return ['CANCELLED', 'FAILED', 'EXPIRED'].includes(order.status);
    default: return true;
  }
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'Todos' },
  { key: 'IN_PROGRESS', label: 'Em andamento' },
  { key: 'DELIVERED', label: 'Entregues' },
  { key: 'CANCELLED', label: 'Cancelados' },
];

export function OrderHistoryScreen() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const [state, setState] = useState<ScreenState>('loading');
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ALL');
  const isDesktop = Dimensions.get('window').width > 768;

  const loadOrders = useCallback(async () => {
    setState('loading');
    setError('');
    try {
      const response = await orderClient.listOrders();
      const list = response.data || [];
      setOrders(list);
      setState(list.length === 0 ? 'empty' : 'ready');
    } catch (err) {
      const oErr = toOrderClientError(err);
      if (oErr.code === 'SESSION_EXPIRED' || oErr.code === 'UNAUTHORIZED') {
        router.navigate('/?expired=1');
        return;
      }
      setError(oErr.message);
      setState('error');
    }
  }, [router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const handlePress = useCallback((orderId: string) => {
    router.navigate({ pathname: '/order/[id]', params: { id: orderId } });
  }, [router]);

  const filteredOrders = orders.filter((o) => orderMatchesFilter(o, activeFilter));

  if (state === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={tokens.accent} />
          <Text style={[styles.centerText, { color: tokens.textMuted }]}>Carregando pedidos...</Text>
        </View>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.centerContent}>
          <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
          <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Não foi possível carregar</Text>
          <Text style={[styles.errorBody, { color: tokens.textMuted }]}>{error || 'Tente novamente em alguns instantes.'}</Text>
          <Pressable style={[styles.retryButton, { borderColor: tokens.accent }]} onPress={loadOrders} testID="orders-retry">
            <Text style={[styles.retryText, { color: tokens.accent }]}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state === 'empty') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.centerContent}>
          <Text style={[styles.emptySymbol, { color: tokens.textMuted }]}>○</Text>
          <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>Nenhum pedido</Text>
          <Text style={[styles.emptyBody, { color: tokens.textMuted }]}>
            Você ainda não fez nenhum pedido. Explore nosso catálogo!
          </Text>
          <Pressable style={[styles.ctaButton, { backgroundColor: tokens.accent }]} onPress={() => router.navigate('/catalog')} testID="orders-go-catalog">
            <Text style={[styles.ctaButtonText, { color: tokens.textInverse }]}>Ver catálogo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const content = (
    <>
      {/* Filtros */}
      <View style={styles.filterContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
          {FILTERS.map((f) => (
            <Pressable
              key={f.key}
              style={[
                styles.filterChip,
                {
                  backgroundColor: activeFilter === f.key ? tokens.accent : tokens.surface,
                  borderColor: activeFilter === f.key ? tokens.accent : tokens.border,
                  marginRight: 8,
                },
              ]}
              onPress={() => setActiveFilter(f.key)}
              testID={`filter-${f.key}`}
            >
              <Text style={[
                styles.filterChipText,
                { color: activeFilter === f.key ? tokens.textInverse : tokens.textPrimary },
              ]}>
                {f.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Lista de pedidos */}
      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.accent} />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.orderCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}
            onPress={() => handlePress(item.id)}
            testID={`order-card-${item.id}`}
          >
            <View style={styles.orderHeader}>
              <Text style={[styles.orderNumber, { color: tokens.textPrimary }]}>{item.order_number}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status, tokens) + '22' }]}>
                <Text style={[styles.statusText, { color: getStatusColor(item.status, tokens) }]}>
                  {STATUS_LABELS[item.status] || item.status}
                </Text>
              </View>
            </View>
            <View style={styles.orderMeta}>
              <Text style={[styles.orderMetaText, { color: tokens.textMuted }]}>
                {item.fulfillment_type === 'PICKUP' ? 'Retirada na loja' : 'Entrega'}
                {' \u00B7 '}{item.items_count} {item.items_count === 1 ? 'item' : 'itens'}
              </Text>
            </View>
            <View style={styles.orderFooter}>
              <Text style={[styles.orderDate, { color: tokens.textMuted }]}>{formatDate(item.created_at)}</Text>
              <Text style={[styles.orderTotal, { color: tokens.accent }]}>{formatBrl(item.total_cents)}</Text>
            </View>
          </Pressable>
        )}
      />
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: tokens.background }]}>
      {isDesktop ? (
        <ScrollView style={styles.desktopWrapper} contentContainerStyle={styles.desktopContent}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { padding: 16, paddingBottom: 80 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  centerText: { marginTop: 16, fontSize: 14 },
  errorSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  errorBody: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderRadius: 6 },
  retryText: { fontSize: 14, fontWeight: '600' },
  emptySymbol: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  ctaButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 6 },
  ctaButtonText: { fontSize: 14, fontWeight: '600' },
  filterContainer: { paddingVertical: 12 },
  filterScroll: { paddingHorizontal: 16 },
  filterChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1, minWidth: 80, alignItems: 'center' },
  filterChipText: { fontSize: 13, fontWeight: '600' },
  orderCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  orderNumber: { fontSize: 15, fontWeight: '700', letterSpacing: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  orderMeta: { marginBottom: 8 },
  orderMetaText: { fontSize: 12 },
  orderFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderDate: { fontSize: 12 },
  orderTotal: { fontSize: 15, fontWeight: '700' },
  desktopWrapper: { flex: 1 },
  desktopContent: { padding: 24, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%', paddingBottom: 80 },
});
