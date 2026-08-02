import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme, theme } from '@/theme';
import { useRouter } from 'expo-router';

interface OrderListItem {
  id: string;
  orderNumber: string;
  status: string;
  statusLabel: string;
  totalAmount: string;
  itemCount: number;
  createdAt: string;
  fulfillmentType: string;
}

interface Props {
  orders?: OrderListItem[];
}

const DEFAULT_ORDERS: OrderListItem[] = [
  {
    id: 'ORD-2026-0003',
    orderNumber: 'AERO-5F6G7H8I',
    status: 'SHIPPED',
    statusLabel: 'Enviado',
    totalAmount: 'R$ 134,00',
    itemCount: 2,
    createdAt: '2026-08-01T10:00:00Z',
    fulfillmentType: 'DELIVERY',
  },
  {
    id: 'ORD-2026-0002',
    orderNumber: 'AERO-3C4D5E6F',
    status: 'DELIVERED',
    statusLabel: 'Entregue',
    totalAmount: 'R$ 89,00',
    itemCount: 1,
    createdAt: '2026-07-28T14:00:00Z',
    fulfillmentType: 'DELIVERY',
  },
  {
    id: 'ORD-2026-0001',
    orderNumber: 'AERO-1A2B3C4D',
    status: 'PAID',
    statusLabel: 'Pago',
    totalAmount: 'R$ 65,00',
    itemCount: 2,
    createdAt: '2026-07-25T09:00:00Z',
    fulfillmentType: 'PICKUP',
  },
];

export default function OrderListScreen({ orders = DEFAULT_ORDERS }: Props) {
  const { active, tokens } = useAppTheme();
  const router = useRouter();

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      AWAITING_PAYMENT: tokens.warning,
      PAYMENT_PROCESSING: tokens.info,
      PAID: tokens.success,
      RESERVED: tokens.success,
      PICKING: tokens.info,
      PACKED: tokens.success,
      READY_FOR_PICKUP: tokens.success,
      READY_TO_SHIP: tokens.info,
      SHIPPED: tokens.info,
      DELIVERED: tokens.success,
      CANCELLED: tokens.error,
      RETURN_REQUESTED: tokens.warning,
      RETURN_APPROVED: tokens.info,
      RETURN_REJECTED: tokens.error,
      RETURN_RECEIVED: tokens.info,
      REFUNDED: tokens.success,
      PARTIALLY_REFUNDED: tokens.warning,
      CREATED: tokens.textMuted,
    };
    return map[status] || tokens.textMuted;
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const handleOrderPress = (order: OrderListItem) => {
    if (order.status === 'CANCELLED') {
      router.push('/order-cancelled' as any);
    } else if (order.status === 'SHIPPED' || order.status === 'READY_TO_SHIP') {
      router.push('/order-tracking' as any);
    } else {
      router.push('/order-timeline' as any);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>
          Meus Pedidos
        </Text>
        <Text style={[styles.subtitle, { color: tokens.textMuted }]}>
          {orders.length} pedido{orders.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {orders.map((order) => (
        <TouchableOpacity
          key={order.id}
          style={[styles.orderCard, { backgroundColor: tokens.surface }]}
          onPress={() => handleOrderPress(order)}
          activeOpacity={0.7}
        >
          <View style={styles.orderHeader}>
            <View style={styles.orderNumberSection}>
              <Text style={[styles.orderNumber, { color: tokens.primary }]}>
                #{order.orderNumber}
              </Text>
              <Text style={[styles.orderDate, { color: tokens.textMuted }]}>
                {formatDate(order.createdAt)}
              </Text>
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusColor(order.status) + '15' }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor(order.status) }]}>
                {order.statusLabel}
              </Text>
            </View>
          </View>

          <View style={styles.orderDetails}>
            <View style={styles.detailItem}>
              <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Itens</Text>
              <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>
                {order.itemCount} {order.itemCount !== 1 ? 'itens' : 'item'}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Entrega</Text>
              <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>
                {order.fulfillmentType === 'PICKUP' ? 'Retirada' : 'Entrega'}
              </Text>
            </View>
            <View style={styles.detailItem}>
              <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Total</Text>
              <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>
                {order.totalAmount}
              </Text>
            </View>
          </View>

          <View style={styles.orderActions}>
            <Text style={[styles.actionText, { color: tokens.primary }]}>
              Ver detalhes →
            </Text>
            {(order.status === 'DELIVERED') && (
              <Text style={[styles.actionText, { color: tokens.warning, marginLeft: 16 }]}>
                Devolver ↩
              </Text>
            )}
            {order.status === 'SHIPPED' && (
              <Text style={[styles.actionText, { color: tokens.info, marginLeft: 16 }]}>
                Rastrear 🚚
              </Text>
            )}
          </View>
        </TouchableOpacity>
      ))}

      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: tokens.textMuted }]}>
          Tema: {active.toUpperCase()}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  orderCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  orderNumberSection: {
    flex: 1,
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: '700',
  },
  orderDate: {
    fontSize: 12,
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  orderDetails: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
    paddingTop: 12,
    marginBottom: 12,
  },
  detailItem: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  orderActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
    paddingTop: 12,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
  },
});
