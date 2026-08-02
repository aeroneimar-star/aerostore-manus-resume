import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAppTheme } from "@/theme";
import type { PaymentMethod } from "../payment/contracts";

const METHOD_LABELS: Record<PaymentMethod, string> = {
  PIX: "PIX",
  CREDIT_CARD: "Cartão de Crédito",
  BOLETO: "Boleto Bancário"
};

const METHOD_ICONS: Record<PaymentMethod, string> = {
  PIX: "💠",
  CREDIT_CARD: "💳",
  BOLETO: "📄"
};

export default function PaymentScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId: string; amountCents: string }>();
  const orderId = params.orderId || "order-demo";
  const amountCents = Number(params.amountCents) || 9900;

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("PIX");
  const [processing, setProcessing] = useState(false);

  const methods: PaymentMethod[] = ["PIX", "CREDIT_CARD", "BOLETO"];

  async function handleConfirm() {
    setProcessing(true);
    setTimeout(() => {
      setProcessing(false);
      if (selectedMethod === "PIX") {
        router.push({
          pathname: "/payment-pix" as any,
          params: { orderId, amountCents: String(amountCents) }
        });
      } else {
        router.push({
          pathname: "/payment-confirm" as any,
          params: { orderId, amountCents: String(amountCents), method: selectedMethod }
        });
      }
    }, 800);
  }

  const formatBRL = (cents: number) =>
    `R$ ${Math.floor(cents / 100).toLocaleString("pt-BR")},${String(cents % 100).padStart(2, "0")}`;

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: tokens.primary }]}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>
          Método de Pagamento
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: tokens.surfaceMuted }]}>
        <Text style={[styles.label, { color: tokens.textSecondary }]}>
          Pedido
        </Text>
        <Text style={[styles.value, { color: tokens.textPrimary }]}>
          #{orderId.replace("order-", "").toUpperCase()}
        </Text>
        <Text style={[styles.amount, { color: tokens.primary }]}>
          {formatBRL(amountCents)}
        </Text>
      </View>

      <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>
        Escolha o método
      </Text>

      {methods.map((method) => {
        const isSelected = selectedMethod === method;
        return (
          <TouchableOpacity
            key={method}
            style={[
              styles.methodCard,
              {
                backgroundColor: tokens.surfaceMuted,
                borderColor: isSelected ? tokens.primary : "transparent",
                borderWidth: isSelected ? 2 : 0
              }
            ]}
            onPress={() => setSelectedMethod(method)}
            disabled={processing}
          >
            <Text style={styles.methodIcon}>{METHOD_ICONS[method]}</Text>
            <View style={styles.methodInfo}>
              <Text style={[styles.methodName, { color: tokens.textPrimary }]}>
                {METHOD_LABELS[method]}
              </Text>
              {method === "PIX" && (
                <Text style={[styles.methodDesc, { color: tokens.textSecondary }]}>
                  Aprovação imediata via QR Code
                </Text>
              )}
              {method === "CREDIT_CARD" && (
                <Text style={[styles.methodDesc, { color: tokens.textSecondary }]}>
                  Até 3x sem juros
                </Text>
              )}
              {method === "BOLETO" && (
                <Text style={[styles.methodDesc, { color: tokens.textSecondary }]}>
                  Aprovação em até 2 dias úteis
                </Text>
              )}
            </View>
            {isSelected && (
              <View style={[styles.radio, { borderColor: tokens.primary }]}>
                <View style={[styles.radioDot, { backgroundColor: tokens.primary }]} />
              </View>
            )}
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity
        style={[
          styles.confirmBtn,
          { backgroundColor: tokens.primary },
          processing && styles.confirmBtnDisabled
        ]}
        onPress={handleConfirm}
        disabled={processing}
      >
        <Text style={styles.confirmText}>
          {processing ? "Processando..." : `Pagar ${formatBRL(amountCents)}`}
        </Text>
      </TouchableOpacity>

      <View style={styles.noteCard}>
        <Text style={[styles.noteText, { color: tokens.textSecondary }]}>
          Pagamento seguro. Seus dados são protegidos e nunca armazenados.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 20, paddingTop: 20 },
  backBtn: { marginRight: 12 },
  backText: { fontSize: 16, fontWeight: "500" as const },
  title: { fontSize: 20, fontWeight: "bold" as const },
  card: { borderRadius: 12, padding: 16, marginBottom: 24 },
  label: { fontSize: 13, marginBottom: 4 },
  value: { fontSize: 16, fontWeight: "600" as const },
  amount: { fontSize: 28, fontWeight: "bold" as const, marginTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "600" as const, marginBottom: 12 },
  methodCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    marginBottom: 10
  },
  methodIcon: { fontSize: 24, marginRight: 14 },
  methodInfo: { flex: 1 },
  methodName: { fontSize: 16, fontWeight: "600" as const },
  methodDesc: { fontSize: 13, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center"
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  confirmBtn: { padding: 16, borderRadius: 12, alignItems: "center", marginTop: 20 },
  confirmBtnDisabled: { opacity: 0.6 },
  confirmText: { color: "white" as const, fontSize: 16, fontWeight: "bold" as const },
  noteCard: { marginTop: 20, padding: 12, alignItems: "center" },
  noteText: { fontSize: 12, textAlign: "center" as const }
});
