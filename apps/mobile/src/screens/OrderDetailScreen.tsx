import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { useAppTheme, theme } from '@/theme';
import { orderClient } from '@/orders/client';
import { toOrderClientError } from '@/orders/OrderClientError';
import type { OrderDetail, OrderEvent, OrderItem, OrderStatus } from '@/orders/contracts';

type ScreenState = 'loading' | 'ready' | 'error';

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

const EVENT_LABELS: Record<string, string> = {
  ORDER_CREATED: 'Pedido criado',
  STOCK_RESERVED: 'Estoque reservado',
  READY_FOR_PAYMENT: 'Aguardando pagamento',
  PAYMENT_INITIATED: 'Pagamento iniciado',
  PAYMENT_APPROVED: 'Pagamento aprovado',
  PAYMENT_DECLINED: 'Pagamento recusado',
  ORDER_CANCELLED: 'Pedido cancelado',
  ORDER_FAILED: 'Pedido falhou',
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

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getStatusColor(status: OrderStatus, tokens: any): string {
  const key = STATUS_COLORS[status] || 'textMuted';
  return (tokens[key] as string) || tokens.textMuted;
}

export function OrderDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const { tokens } = useAppTheme();
  const [state, setState] = useState<ScreenState>('loading');
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState('');
  const isDesktop = Dimensions.get('window').width > 768;

  const loadOrder = useCallback(async () => {
    const orderId = params.id;
    if (!orderId) {
      setError('ID do pedido inválido.');
      setState('error');
      return;
    }

    setState('loading');
    setError('');
    try {
      const response = await orderClient.getOrder(orderId);
      setDetail(response.data);
      setState('ready');
    } catch (err) {
      const oErr = toOrderClientError(err);
      if (oErr.code === 'SESSION_EXPIRED' || oErr.code === 'UNAUTHORIZED') {
        router.navigate('/?expired=1');
        return;
      }
      setError(oErr.message);
      setState('error');
    }
  }, [params.id, router]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  if (state === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={tokens.accent} />
          <Text style={[styles.centerText, { color: tokens.textMuted }]}>Carregando pedido...</Text>
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
          <Pressable style={[styles.retryButton, { borderColor: tokens.accent }]} onPress={loadOrder} testID="order-detail-retry">
            <Text style={[styles.retryText, { color: tokens.accent }]}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!detail) return null;

  const { order, items, events } = detail;
  const statusColor = getStatusColor(order.status as OrderStatus, tokens);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tokens.background }]}
      contentContainerStyle={isDesktop ? styles.desktopContent : styles.scrollContent}
      testID="order-detail-screen"
    >
      {/* Header */}
      <Text style={[styles.orderNumber, { color: tokens.textPrimary }]}>{order.order_number}</Text>
      <View style={[styles.statusBadge, { backgroundColor: statusColor + '22' }]}>
        <Text style={[styles.statusText, { color: statusColor }]}>
          {STATUS_LABELS[order.status as OrderStatus] || order.status}
        </Text>
      </View>

      {/* Fulfillment info */}
      <View style={[styles.sectionCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Entrega</Text>
        <View style={styles.infoRow}>
          <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Modalidade</Text>
          <Text style={[styles.infoValue, { color: tokens.textPrimary }]}>
            {order.fulfillment_type === 'PICKUP' ? 'Retirada na loja' : 'Entrega'}
          </Text>
        </View>
        {order.pickup_store_id && (
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Loja</Text>
            <Text style={[styles.infoValue, { color: tokens.textPrimary }]}>{order.pickup_store_id}</Text>
          </View>
        )}
        {order.address_id && (
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Endereco</Text>
            <Text style={[styles.infoValue, { color: tokens.textPrimary }]}>{order.address_id}</Text>
          </View>
        )}
      </View>

      {/* Items */}
      <View style={[styles.sectionCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Itens</Text>
        {items.map((item, i) => (
          <View key={item.id} style={[styles.itemRow, i > 0 && { borderTopColor: tokens.divider, borderTopWidth: 1, paddingTop: 8, marginTop: 8 }]}>
            <View style={styles.itemInfo}>
              <Text style={[styles.itemName, { color: tokens.textPrimary }]}>Produto (ID: {item.variant_id})</Text>
              <Text style={[styles.itemQty, { color: tokens.textMuted }]}>{item.quantity}x {formatBrl(item.unit_price_cents)}</Text>
            </View>
            <Text style={[styles.itemTotal, { color: tokens.textPrimary }]}>{formatBrl(item.line_total_cents)}</Text>
          </View>
        ))}
      </View>

      {/* Totals */}
      <View style={[styles.totalsCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: tokens.textMuted }]}>Subtotal</Text>
          <Text style={[styles.totalValue, { color: tokens.textPrimary }]}>{formatBrl(order.subtotal_cents)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={[styles.totalLabel, { color: tokens.textMuted }]}>Frete</Text>
          <Text style={[styles.totalValue, { color: order.shipping_quote_cents === 0 ? tokens.success : tokens.textPrimary }]}>
            {formatBrl(order.shipping_quote_cents || 0)}
          </Text>
        </View>
        <View style={[styles.grandTotalRow, { borderTopColor: tokens.divider }]}>
          <Text style={[styles.grandTotalLabel, { color: tokens.textPrimary }]}>Total</Text>
          <Text style={[styles.grandTotalValue, { color: tokens.accent }]}>{formatBrl(order.total_cents)}</Text>
        </View>
      </View>

      {/* Timeline */}
      {events.length > 0 && (
        <View style={[styles.sectionCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
          <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Histórico</Text>
          {events.map((event, i) => (
            <View key={event.id} style={styles.timelineItem}>
              <View style={styles.timelineDot} />
              <View style={styles.timelineContent}>
                <Text style={[styles.eventLabel, { color: tokens.textPrimary }]}>
                  {EVENT_LABELS[event.event_type] || event.event_type}
                </Text>
                <Text style={[styles.eventTime, { color: tokens.textMuted }]}>{formatDateTime(event.created_at)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Created/Updated */}
      <View style={styles.metaRow}>
        <Text style={[styles.metaText, { color: tokens.textMuted }]}>
          Criado em {formatDateTime(order.created_at)}
        </Text>
      </View>

      {/* Failed reason */}
      {order.failed_reason && (
        <View style={[styles.failedCard, { backgroundColor: tokens.errorSurface }]}>
          <Text style={[styles.failedText, { color: tokens.error }]}>{order.failed_reason}</Text>
        </View>
      )}

      <Pressable
        style={[styles.backButton, { borderColor: tokens.accent }]}
        onPress={() => router.navigate('/orders')}
        testID="order-detail-back"
      >
        <Text style={[styles.backButtonText, { color: tokens.accent }]}>Voltar aos pedidos</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  desktopContent: { padding: 24, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%', paddingBottom: 80 },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  centerText: { marginTop: 16, fontSize: 14 },
  errorSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  errorBody: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderRadius: 6 },
  retryText: { fontSize: 14, fontWeight: '600' },
  orderNumber: { fontSize: 22, fontWeight: '700', letterSpacing: 2, marginBottom: 8 },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignSelf: 'flex-start', marginBottom: 20 },
  statusText: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  sectionCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '500' },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '500', marginBottom: 2 },
  itemQty: { fontSize: 12 },
  itemTotal: { fontSize: 14, fontWeight: '600', marginLeft: 12 },
  totalsCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  totalLabel: { fontSize: 14 },
  totalValue: { fontSize: 14, fontWeight: '500' },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginTop: 4, borderTopWidth: 1 },
  grandTotalLabel: { fontSize: 16, fontWeight: '600' },
  grandTotalValue: { fontSize: 16, fontWeight: '700' },
  timelineItem: { flexDirection: 'row', marginBottom: 12, gap: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ccc', marginTop: 4 },
  timelineContent: { flex: 1 },
  eventLabel: { fontSize: 13, fontWeight: '500', marginBottom: 2 },
  eventTime: { fontSize: 12 },
  metaRow: { marginBottom: 12 },
  metaText: { fontSize: 12 },
  failedCard: { padding: 12, borderRadius: 8, marginBottom: 16 },
  failedText: { fontSize: 13, fontWeight: '500' },
  backButton: { paddingVertical: 12, borderWidth: 1, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  backButtonText: { fontSize: 14, fontWeight: '600' },
});
