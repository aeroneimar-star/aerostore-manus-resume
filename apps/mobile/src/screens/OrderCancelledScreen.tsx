import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAppTheme, theme } from '@/theme';

interface Props {
  orderId?: string;
  orderNumber?: string;
  reason?: string;
  cancelledAt?: string;
  refundStatus?: string;
  refundValue?: string;
  refundMethod?: string;
  refundExpectedDate?: string;
  supportContact?: string;
}

export default function OrderCancelledScreen({
  orderId = 'ORD-2026-0001',
  orderNumber = 'AERO-1A2B3C4D',
  reason = 'Solicitação do cliente',
  cancelledAt = '2026-08-02T10:00:00Z',
  refundStatus = 'PROCESSING',
  refundValue = 'R$ 65,00',
  refundMethod = 'PIX (mesma chave do pagamento)',
  refundExpectedDate = 'Em até 5 dias úteis',
  supportContact = 'suporte@aerostore.com.br',
}: Props) {
  const { active, tokens } = useAppTheme();

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const refundLabels: Record<string, string> = {
    PROCESSING: 'Processando reembolso',
    COMPLETED: 'Reembolso concluído',
    FAILED: 'Reembolso falhou',
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      {/* Cancel Icon */}
      <View style={styles.iconSection}>
        <View style={[styles.cancelCircle, { backgroundColor: tokens.errorSurface }]}>
          <Text style={[styles.cancelIcon, { color: tokens.error }]}>✕</Text>
        </View>
      </View>

      <View style={styles.titleSection}>
        <Text style={[styles.title, { color: tokens.error }]}>
          Pedido Cancelado
        </Text>
        <Text style={[styles.orderNumber, { color: tokens.primary }]}>
          #{orderNumber}
        </Text>
      </View>

      {/* Cancel Details */}
      <View style={[styles.card, { backgroundColor: tokens.surface }]}>
        <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>
          Detalhes do Cancelamento
        </Text>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Pedido</Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>{orderId}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Motivo</Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>{reason}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Data</Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>
            {formatDate(cancelledAt)}
          </Text>
        </View>
      </View>

      {/* Refund Info */}
      <View style={[styles.refundCard, { backgroundColor: tokens.warningSurface }]}>
        <Text style={[styles.refundTitle, { color: tokens.warning }]}>
          Reembolso
        </Text>

        <View style={styles.refundStatusRow}>
          <View style={[styles.refundDot, { backgroundColor: tokens.warning }]} />
          <Text style={[styles.refundStatusText, { color: tokens.warning }]}>
            {refundLabels[refundStatus] || refundStatus}
          </Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Valor</Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>{refundValue}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Método</Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>{refundMethod}</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textMuted }]}>Prazo</Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>{refundExpectedDate}</Text>
        </View>
      </View>

      {/* Support */}
      <View style={[styles.supportCard, { backgroundColor: tokens.surface }]}>
        <Text style={[styles.supportLabel, { color: tokens.textSecondary }]}>
          Precisa de ajuda?
        </Text>
        <Text style={[styles.supportEmail, { color: tokens.primary }]}>
          {supportContact}
        </Text>
      </View>

      {/* No charge notice */}
      <View style={styles.noticeRow}>
        <Text style={[styles.noticeText, { color: tokens.textMuted }]}>
          Nenhum pagamento adicional foi cobrado.
        </Text>
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
  iconSection: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  cancelCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelIcon: {
    fontSize: 28,
    fontWeight: '700',
  },
  titleSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '700',
  },
  orderNumber: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: 4,
  },
  card: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.04)',
  },
  detailLabel: {
    fontSize: 13,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '500',
  },
  refundCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
  },
  refundTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  refundStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  refundDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  refundStatusText: {
    fontSize: 13,
    fontWeight: '600',
  },
  supportCard: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  supportLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  supportEmail: {
    fontSize: 14,
    fontWeight: '500',
  },
  noticeRow: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  noticeText: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  footer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 11,
  },
});
