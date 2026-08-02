import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppTheme, theme } from '@/theme';

interface TrackingEvent {
  at: string;
  description: string;
  location: string;
}

interface Props {
  orderId?: string;
  orderNumber?: string;
  trackingCode?: string;
  carrier?: string;
  trackingUrl?: string;
  status?: string;
  estimatedDelivery?: string;
  events?: TrackingEvent[];
}

const DEFAULT_EVENTS: TrackingEvent[] = [
  { at: '2026-08-01T10:00:00Z', description: 'Objeto postado', location: 'CD São Paulo' },
  { at: '2026-08-01T14:00:00Z', description: 'Em trânsito para unidade de destino', location: 'CD São Paulo' },
  { at: '2026-08-02T08:00:00Z', description: 'Em trânsito - Unidade de Tratamento', location: 'CD Rio de Janeiro' },
  { at: '2026-08-02T16:00:00Z', description: 'Saiu para entrega', location: 'Agência São Conrado' },
];

export default function OrderTrackingScreen({
  orderId = 'ORD-2026-0001',
  orderNumber = 'AERO-1A2B3C4D',
  trackingCode = 'BR123456789AA',
  carrier = 'Correios',
  trackingUrl = 'https://rastreamento.correios.com.br',
  status = 'IN_TRANSIT',
  estimatedDelivery = '05/08/2026',
  events = DEFAULT_EVENTS,
}: Props) {
  const { active, tokens } = useAppTheme();

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
      ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const statusLabel: Record<string, string> = {
    IN_TRANSIT: 'Em Trânsito',
    LABEL_CREATED: 'Etiqueta Gerada',
    DELIVERED: 'Entregue',
    RETURNED: 'Retornado',
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <Text style={[styles.orderNumber, { color: tokens.textPrimary }]}>
          #{orderNumber}
        </Text>
        <Text style={[styles.orderId, { color: tokens.textMuted }]}>
          {orderId}
        </Text>
      </View>

      {/* Tracking Code Card */}
      <View style={[styles.trackingCard, { backgroundColor: tokens.surface }]}>
        <Text style={[styles.trackingLabel, { color: tokens.textSecondary }]}>
          Código de Rastreio
        </Text>
        <Text style={[styles.trackingCode, { color: tokens.primary }]}>
          {trackingCode}
        </Text>
        <Text style={[styles.carrierText, { color: tokens.textMuted }]}>
          {carrier}
        </Text>
        <Text style={[styles.urlText, { color: tokens.info }]}>
          {trackingUrl}
        </Text>
      </View>

      {/* Status Banner */}
      <View style={[styles.statusBanner, { backgroundColor: tokens.infoSurface }]}>
        <Text style={[styles.statusLabel, { color: tokens.info }]}>
          Status
        </Text>
        <Text style={[styles.statusValue, { color: tokens.textPrimary }]}>
          {statusLabel[status] || status}
        </Text>
        <Text style={[styles.estimatedLabel, { color: tokens.textMuted }]}>
          Previsão de entrega
        </Text>
        <Text style={[styles.estimatedValue, { color: tokens.textPrimary }]}>
          {estimatedDelivery}
        </Text>
      </View>

      {/* Timeline Events */}
      <View style={styles.eventsSection}>
        <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>
          Histórico de Rastreamento
        </Text>
        {events.map((event, index) => {
          const isFirst = index === 0;
          return (
            <View key={index} style={styles.eventRow}>
              <View style={[styles.eventDot, { backgroundColor: isFirst ? tokens.primary : tokens.divider }]} />
              {!isFirst && <View style={[styles.eventLine, { backgroundColor: tokens.divider }]} />}
              <View style={styles.eventContent}>
                <Text style={[styles.eventDesc, { color: tokens.textPrimary }]}>
                  {event.description}
                </Text>
                <Text style={[styles.eventLocation, { color: tokens.textSecondary }]}>
                  {event.location}
                </Text>
                <Text style={[styles.eventDate, { color: tokens.textMuted }]}>
                  {formatDate(event.at)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

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
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  orderNumber: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: '700',
  },
  orderId: {
    fontSize: 12,
    marginTop: 2,
  },
  trackingCard: {
    margin: 20,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  trackingLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trackingCode: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'Georgia',
    marginTop: 4,
  },
  carrierText: {
    fontSize: 13,
    marginTop: 4,
  },
  urlText: {
    fontSize: 12,
    marginTop: 2,
  },
  statusBanner: {
    marginHorizontal: 20,
    padding: 16,
    borderRadius: 14,
    marginBottom: 20,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusValue: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Georgia',
    marginTop: 4,
  },
  estimatedLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
  },
  estimatedValue: {
    fontSize: 14,
    fontWeight: '500',
    marginTop: 2,
  },
  eventsSection: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Georgia',
    marginBottom: 16,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 60,
  },
  eventDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
    marginRight: 12,
    flexShrink: 0,
  },
  eventLine: {
    position: 'absolute',
    left: 4,
    top: 16,
    width: 2,
    height: 60,
    borderRadius: 1,
  },
  eventContent: {
    flex: 1,
    paddingBottom: 16,
  },
  eventDesc: {
    fontSize: 14,
    fontWeight: '500',
  },
  eventLocation: {
    fontSize: 13,
    marginTop: 2,
  },
  eventDate: {
    fontSize: 12,
    marginTop: 2,
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
  },
});
