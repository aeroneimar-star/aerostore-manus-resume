import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppTheme, theme } from '@/theme';

interface TimelineEntry {
  id: string;
  status: string;
  statusLabel: string;
  event: string;
  description: string;
  type: string;
  icon: string;
  visibleToCustomer: boolean;
  at: string;
}

interface Props {
  orderId?: string;
  orderNumber?: string;
  currentStatus?: string;
  currentStatusLabel?: string;
  entries?: TimelineEntry[];
  fulfillmentStep?: {
    step: number;
    total: number;
    label: string;
    nextLabel: string | null;
    status: string;
    at: string;
  };
}

const DEFAULT_ENTRIES: TimelineEntry[] = [
  { id: '1', status: 'PAID', statusLabel: 'Pago', event: 'PAYMENT_CONFIRMED', description: 'Pagamento confirmado via PIX', type: 'CUSTOMER', icon: 'payment', visibleToCustomer: true, at: '2026-08-01T10:00:00Z' },
  { id: '2', status: 'RESERVED', statusLabel: 'Reserva confirmada', event: 'RESERVATION_CONSUMED', description: 'Reserva de estoque consumida', type: 'INTERNAL', icon: 'inventory', visibleToCustomer: false, at: '2026-08-01T10:01:00Z' },
  { id: '3', status: 'PICKING', statusLabel: 'Separando', event: 'PICKING_STARTED', description: 'Separação iniciada no CD', type: 'INTERNAL', icon: 'picking', visibleToCustomer: false, at: '2026-08-01T11:00:00Z' },
  { id: '4', status: 'PACKED', statusLabel: 'Embalado', event: 'PACKED', description: 'Pedido embalado', type: 'INTERNAL', icon: 'package', visibleToCustomer: false, at: '2026-08-01T12:30:00Z' },
  { id: '5', status: 'READY_TO_SHIP', statusLabel: 'Pronto para envio', event: 'READY_TO_SHIP', description: 'Pronto para envio', type: 'INTERNAL', icon: 'truck', visibleToCustomer: false, at: '2026-08-01T13:00:00Z' },
  { id: '6', status: 'SHIPPED', statusLabel: 'Enviado', event: 'SHIPPED', description: 'Pedido enviado via Correios', type: 'CUSTOMER', icon: 'truck', visibleToCustomer: true, at: '2026-08-01T15:00:00Z' },
  { id: '7', status: 'DELIVERED', statusLabel: 'Entregue', event: 'DELIVERED', description: 'Pedido entregue', type: 'CUSTOMER', icon: 'check', visibleToCustomer: true, at: '2026-08-03T14:00:00Z' },
];

export default function OrderTimelineScreen({
  orderId = 'ORD-2026-0001',
  orderNumber = 'AERO-1A2B3C4D',
  currentStatus = 'SHIPPED',
  currentStatusLabel = 'Enviado',
  entries = DEFAULT_ENTRIES,
  fulfillmentStep,
}: Props) {
  const { active, tokens } = useAppTheme();

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      PAID: tokens.success,
      RESERVED: tokens.success,
      PICKING: tokens.info,
      PACKED: tokens.success,
      READY_TO_SHIP: tokens.info,
      READY_FOR_PICKUP: tokens.success,
      SHIPPED: tokens.info,
      DELIVERED: tokens.success,
      CANCELLED: tokens.error,
      RETURN_REQUESTED: tokens.warning,
      RETURN_APPROVED: tokens.info,
      RETURN_REJECTED: tokens.error,
      RETURN_RECEIVED: tokens.info,
      REFUNDED: tokens.success,
      PARTIALLY_REFUNDED: tokens.warning,
      AWAITING_PAYMENT: tokens.warning,
      PAYMENT_PROCESSING: tokens.info,
    };
    return map[status] || tokens.textMuted;
  };

  const iconForStatus = (icon: string) => {
    const icons: Record<string, string> = {
      payment: '$',
      inventory: '📦',
      picking: '🔍',
      package: '📋',
      truck: '🚚',
      store: '🏪',
      check: '✓',
      return: '↩',
      refund: '💰',
      cancel: '✕',
      error: '!',
      order: '📄',
      info: 'i',
    };
    return icons[icon] || '•';
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <Text style={[styles.orderNumber, { color: tokens.primary }]}>
          #{orderNumber}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(currentStatus) + '20' }]}>
          <Text style={[styles.statusText, { color: statusColor(currentStatus) }]}>
            {currentStatusLabel}
          </Text>
        </View>
      </View>

      {/* Fulfillment Step */}
      {fulfillmentStep && (
        <View style={[styles.stepCard, { backgroundColor: tokens.surface }]}>
          <Text style={[styles.stepLabel, { color: tokens.textSecondary }]}>
            Etapa {fulfillmentStep.step} de {fulfillmentStep.total}
          </Text>
          <Text style={[styles.stepName, { color: tokens.textPrimary }]}>
            {fulfillmentStep.label}
          </Text>
          {fulfillmentStep.nextLabel && (
            <Text style={[styles.nextStep, { color: tokens.textMuted }]}>
              Próxima: {fulfillmentStep.nextLabel}
            </Text>
          )}
        </View>
      )}

      {/* Timeline */}
      <View style={styles.timeline}>
        {entries.map((entry, index) => {
          const isLast = index === entries.length - 1;
          const isCustomerVisible = entry.visibleToCustomer;
          return (
            <View key={entry.id}>
              <View style={styles.entryRow}>
                {/* Icon */}
                <View style={[styles.iconCircle, { backgroundColor: statusColor(entry.status) + '15' }]}>
                  <Text style={[styles.iconText, { color: statusColor(entry.status) }]}>
                    {iconForStatus(entry.icon)}
                  </Text>
                </View>
                {/* Content */}
                <View style={styles.entryContent}>
                  <Text style={[styles.entryTitle, { color: tokens.textPrimary }]}>
                    {entry.description}
                  </Text>
                  <Text style={[styles.entryDate, { color: tokens.textMuted }]}>
                    {formatDate(entry.at)}
                  </Text>
                  {!isCustomerVisible && (
                    <Text style={[styles.internalTag, { color: tokens.textDisabled }]}>
                      Internal
                    </Text>
                  )}
                </View>
              </View>
              {/* Connector line */}
              {!isLast && (
                <View style={styles.connectorRow}>
                  <View style={[styles.connectorLine, { backgroundColor: tokens.divider }]} />
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Pickup Info - for READY_FOR_PICKUP */}
      {currentStatus === 'READY_FOR_PICKUP' && (
        <View style={[styles.pickupCard, { backgroundColor: tokens.infoSurface }]}>
          <Text style={[styles.pickupTitle, { color: tokens.info }]}>
            Pronto para Retirada
          </Text>
          <Text style={[styles.pickupLabel, { color: tokens.textSecondary }]}>Loja</Text>
          <Text style={[styles.pickupValue, { color: tokens.textPrimary }]}>AEROSTORE - Ibirapuera</Text>
          <Text style={[styles.pickupLabel, { color: tokens.textSecondary }]}>Endereço</Text>
          <Text style={[styles.pickupValue, { color: tokens.textPrimary }]}>Av. Paulista, 1000 - São Paulo, SP</Text>
          <Text style={[styles.pickupLabel, { color: tokens.textSecondary }]}>Horário</Text>
          <Text style={[styles.pickupValue, { color: tokens.textPrimary }]}>Seg-Sáb: 10h-20h | Dom: 12h-18h</Text>
          <Text style={[styles.pickupLabel, { color: tokens.textSecondary }]}>Documento</Text>
          <Text style={[styles.pickupValue, { color: tokens.textPrimary }]}>RG ou CNH com foto</Text>
        </View>
      )}

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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  orderNumber: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: '700',
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  stepCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  stepName: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Georgia',
  },
  nextStep: {
    fontSize: 13,
    marginTop: 4,
  },
  timeline: {
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  iconText: {
    fontSize: 14,
    fontWeight: '700',
  },
  entryContent: {
    flex: 1,
    paddingVertical: 8,
  },
  entryTitle: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  entryDate: {
    fontSize: 12,
  },
  internalTag: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  connectorRow: {
    paddingLeft: 17,
    paddingVertical: 4,
  },
  connectorLine: {
    width: 2,
    height: 24,
    borderRadius: 1,
  },
  pickupCard: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 14,
  },
  pickupTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  pickupLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 10,
    marginBottom: 2,
  },
  pickupValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
  },
});
