import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAppTheme, theme } from '@/theme';

interface ReturnItem {
  productId: string;
  name: string;
  quantity: number;
  price: string;
}

interface Props {
  orderId?: string;
  orderNumber?: string;
  items?: ReturnItem[];
  returnId?: string;
  returnStatus?: string;
  returnReason?: string;
  returnDescription?: string;
  showForm?: boolean;
}

const DEFAULT_ITEMS: ReturnItem[] = [
  { productId: 'PRD-001', name: 'Camiseta Oversized AERO', quantity: 1, price: 'R$ 45,00' },
  { productId: 'PRD-002', name: 'Calça Jogger AERO', quantity: 1, price: 'R$ 89,00' },
];

const RETURN_REASONS = [
  { value: 'DEFECTIVE', label: 'Produto com defeito' },
  { value: 'WRONG_ITEM', label: 'Produto errado' },
  { value: 'WRONG_SIZE', label: 'Tamanho incorreto' },
  { value: 'DID_NOT_LIKE', label: 'Não gostei' },
  { value: 'OTHER', label: 'Outro motivo' },
];

const RETURN_STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Solicitada',
  UNDER_REVIEW: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
  ITEM_RECEIVED: 'Recebida',
  REFUND_PENDING: 'Reembolso pendente',
  REFUND_COMPLETED: 'Reembolso concluído',
};

export default function ReturnRequestScreen({
  orderId = 'ORD-2026-0001',
  orderNumber = 'AERO-1A2B3C4D',
  items = DEFAULT_ITEMS,
  returnId = 'RET-LK9X2M',
  returnStatus = 'REQUESTED',
  returnReason = 'WRONG_SIZE',
  returnDescription = 'A calça ficou grande. Solicito troca pelo tamanho M.',
  showForm = true,
}: Props) {
  const { active, tokens } = useAppTheme();
  const [selectedReason, setSelectedReason] = useState(returnReason);
  const [description, setDescription] = useState(returnDescription);

  const statusColor = (status: string) => {
    const map: Record<string, string> = {
      REQUESTED: tokens.warning,
      UNDER_REVIEW: tokens.info,
      APPROVED: tokens.success,
      REJECTED: tokens.error,
      ITEM_RECEIVED: tokens.success,
      REFUND_PENDING: tokens.warning,
      REFUND_COMPLETED: tokens.success,
    };
    return map[status] || tokens.textMuted;
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>
          Solicitar Devolução
        </Text>
        <Text style={[styles.orderNumber, { color: tokens.primary }]}>
          #{orderNumber}
        </Text>
      </View>

      {/* Items to Return */}
      <View style={[styles.card, { backgroundColor: tokens.surface }]}>
        <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>
          Itens do Pedido
        </Text>
        {items.map((item, index) => (
          <View key={item.productId} style={[styles.itemRow, index > 0 && styles.itemBorder]}>
            <View style={styles.itemCheckbox}>
              <View style={[styles.checkbox, { borderColor: tokens.border }]} />
            </View>
            <View style={styles.itemInfo}>
              <Text style={[styles.itemName, { color: tokens.textPrimary }]}>
                {item.name}
              </Text>
              <Text style={[styles.itemMeta, { color: tokens.textMuted }]}>
                {item.productId} | Qtd: {item.quantity}
              </Text>
            </View>
            <Text style={[styles.itemPrice, { color: tokens.textPrimary }]}>
              {item.price}
            </Text>
          </View>
        ))}
      </View>

      {/* Return Reason */}
      <View style={[styles.card, { backgroundColor: tokens.surface }]}>
        <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>
          Motivo da Devolução
        </Text>
        {RETURN_REASONS.map((reason) => (
          <TouchableOpacity
            key={reason.value}
            style={styles.reasonRow}
            onPress={() => setSelectedReason(reason.value)}
          >
            <View style={[
              styles.radioCircle,
              { borderColor: selectedReason === reason.value ? tokens.primary : tokens.border },
            ]}>
              {selectedReason === reason.value && (
                <View style={[styles.radioDot, { backgroundColor: tokens.primary }]} />
              )}
            </View>
            <Text style={[styles.reasonText, { color: tokens.textPrimary }]}>
              {reason.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Description */}
      <View style={[styles.card, { backgroundColor: tokens.surface }]}>
        <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>
          Descrição (opcional)
        </Text>
        <View style={[styles.textArea, { backgroundColor: tokens.inputBackground, borderColor: tokens.inputBorder }]}>
          <Text style={[styles.descriptionText, { color: tokens.textPrimary }]}>
            {description}
          </Text>
        </View>
      </View>

      {/* Return Status - if already exists */}
      <View style={[styles.statusCard, { backgroundColor: statusColor(returnStatus) + '15' }]}>
        <Text style={[styles.statusLabel, { color: tokens.textMuted }]}>
          Status da Devolução
        </Text>
        <Text style={[styles.statusValue, { color: statusColor(returnStatus) }]}>
          {RETURN_STATUS_LABELS[returnStatus] || returnStatus}
        </Text>
        <Text style={[styles.returnId, { color: tokens.textMuted }]}>
          #{returnId}
        </Text>
      </View>

      {/* Submit Button */}
      {showForm && (
        <TouchableOpacity
          style={[styles.submitButton, { backgroundColor: tokens.primary }]}
        >
          <Text style={[styles.submitText, { color: tokens.primaryText }]}>
            Solicitar Devolução
          </Text>
        </TouchableOpacity>
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
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 20,
    fontWeight: '700',
  },
  orderNumber: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  card: {
    marginHorizontal: 20,
    marginTop: 16,
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
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  itemBorder: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
  },
  itemCheckbox: {
    marginRight: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 14,
    fontWeight: '500',
  },
  itemMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: '600',
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  reasonText: {
    fontSize: 14,
    fontWeight: '500',
  },
  textArea: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    minHeight: 80,
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 20,
  },
  statusCard: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    borderRadius: 14,
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
  returnId: {
    fontSize: 12,
    marginTop: 4,
  },
  submitButton: {
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  submitText: {
    fontSize: 16,
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
