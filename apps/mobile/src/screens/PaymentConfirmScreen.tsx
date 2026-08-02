import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAppTheme } from "@/theme";

export default function PaymentConfirmScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId: string; amountCents: string; method: string }>();
  const orderId = params.orderId || "order-demo";
  const amountCents = Number(params.amountCents) || 9900;
  const method = (params.method as string) || "CREDIT_CARD";

  const [processing, setProcessing] = useState(true);
  const [status, setStatus] = useState<"PROCESSING" | "CONFIRMED">("PROCESSING");

  const methodLabel = method === "CREDIT_CARD" ? "Cartão de Crédito" : "Boleto Bancário";
  const formatBRL = (cents: number) =>
    `R$ ${Math.floor(cents / 100).toLocaleString("pt-BR")},${String(cents % 100).padStart(2, "0")}`;

  useEffect(() => {
    const timer = setTimeout(() => {
      setProcessing(false);
      setStatus("CONFIRMED");
      setTimeout(() => {
        router.push({
          pathname: "/order-success" as any,
          params: { orderId, amountCents: String(amountCents) }
        });
      }, 2000);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: tokens.primary }]}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>
          Confirmar Pagamento
        </Text>
      </View>

      {processing ? (
        <View style={styles.processingCard}>
          <ActivityIndicator size="large" color={tokens.primary} />
          <Text style={[styles.processingText, { color: tokens.textPrimary }]}>
            Processando {methodLabel}...
          </Text>
          <Text style={[styles.processingSub, { color: tokens.textSecondary }]}>
            Aguarde a confirmação do pagamento
          </Text>
        </View>
      ) : (
        <View style={[styles.confirmCard, { backgroundColor: tokens.surfaceMuted }]}>
          <Text style={styles.confirmEmoji}>✅</Text>
          <Text style={[styles.confirmText, { color: tokens.primary }]}>
            Pagamento confirmado!
          </Text>
          <Text style={[styles.confirmMethod, { color: tokens.textSecondary }]}>
            {methodLabel}
          </Text>
        </View>
      )}

      <View style={[styles.summaryCard, { backgroundColor: tokens.surfaceMuted }]}>
        <Text style={[styles.summaryTitle, { color: tokens.textPrimary }]}>
          Resumo
        </Text>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>
            Pedido
          </Text>
          <Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>
            #{orderId.replace("order-", "").toUpperCase()}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>
            Método
          </Text>
          <Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>
            {methodLabel}
          </Text>
        </View>
        <View style={[styles.summaryRow, styles.totalRow]}>
          <Text style={[styles.totalLabel, { color: tokens.textPrimary }]}>
            Total
          </Text>
          <Text style={[styles.totalValue, { color: tokens.primary }]}>
            {formatBRL(amountCents)}
          </Text>
        </View>
      </View>

      <View style={styles.noteCard}>
        <Text style={[styles.noteText, { color: tokens.textSecondary }]}>
          Pagamento processado com segurança. Você receberá um e-mail com os detalhes.
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
  processingCard: { alignItems: "center", padding: 40, borderRadius: 16, marginBottom: 20 },
  processingText: { fontSize: 16, fontWeight: "600" as const, marginTop: 16 },
  processingSub: { fontSize: 14, marginTop: 8 },
  confirmCard: { alignItems: "center", padding: 40, borderRadius: 16, marginBottom: 20 },
  confirmEmoji: { fontSize: 48, marginBottom: 12 },
  confirmText: { fontSize: 18, fontWeight: "bold" as const },
  confirmMethod: { fontSize: 14, marginTop: 8 },
  summaryCard: { borderRadius: 12, padding: 16, marginBottom: 20 },
  summaryTitle: { fontSize: 16, fontWeight: "600" as const, marginBottom: 12 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  summaryLabel: { fontSize: 14 },
  summaryValue: { fontSize: 14, fontWeight: "500" as const },
  totalRow: { borderTopWidth: 1, paddingTop: 10, marginTop: 4 },
  totalLabel: { fontSize: 16, fontWeight: "600" as const },
  totalValue: { fontSize: 20, fontWeight: "bold" as const },
  noteCard: { marginTop: 10, padding: 12, alignItems: "center" },
  noteText: { fontSize: 12, textAlign: "center" as const }
});
