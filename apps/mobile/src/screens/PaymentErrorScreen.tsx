import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAppTheme } from "@/theme";

export default function PaymentErrorScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{
    orderId: string;
    amountCents: string;
    errorCode: string;
    errorMessage: string;
  }>();
  const orderId = params.orderId || "order-demo";
  const amountCents = Number(params.amountCents) || 9900;
  const errorCode = (params.errorCode as string) || "INTERNAL";
  const errorMessage = (params.errorMessage as string) || "Ocorreu um erro ao processar o pagamento.";

  const formatBRL = (cents: number) =>
    `R$ ${Math.floor(cents / 100).toLocaleString("pt-BR")},${String(cents % 100).padStart(2, "0")}`;

  const errorDetails: Record<string, { emoji: string; suggestion: string }> = {
    INTERNAL: { emoji: "⚠️", suggestion: "Tente novamente em instantes." },
    GATEWAY_UNAVAILABLE: { emoji: "🌐", suggestion: "O gateway está temporariamente indisponível." },
    PAYMENT_EXPIRED: { emoji: "⏰", suggestion: "O tempo limite para pagamento expirou." },
    FRAUD_SUSPECTED: { emoji: "🛡️", suggestion: "Pagamento bloqueado por segurança." },
    REJECTED: { emoji: "❌", suggestion: "O pagamento foi recusado pelo banco." }
  };

  const detail = errorDetails[errorCode] || errorDetails.INTERNAL;

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.push("/" as any)} style={styles.backBtn}>
          <Text style={[styles.backText, { color: tokens.primary }]}>← Início</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>
          Erro no Pagamento
        </Text>
      </View>

      <View style={[styles.errorCard, { backgroundColor: tokens.errorSurface }]}>
        <Text style={styles.errorEmoji}>{detail.emoji}</Text>
        <Text style={[styles.errorTitle, { color: tokens.error }]}>
          Pagamento não processado
        </Text>
        <Text style={[styles.errorDesc, { color: tokens.textPrimary }]}>
          {errorMessage}
        </Text>
      </View>

      <View style={[styles.detailsCard, { backgroundColor: tokens.surfaceMuted }]}>
        <Text style={[styles.detailsTitle, { color: tokens.textPrimary }]}>
          Detalhes
        </Text>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textSecondary }]}>
            Pedido
          </Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>
            #{orderId.replace("order-", "").toUpperCase()}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textSecondary }]}>
            Código
          </Text>
          <Text style={[styles.detailValue, { color: tokens.error }]}>
            {errorCode}
          </Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={[styles.detailLabel, { color: tokens.textSecondary }]}>
            Valor
          </Text>
          <Text style={[styles.detailValue, { color: tokens.textPrimary }]}>
            {formatBRL(amountCents)}
          </Text>
        </View>
      </View>

      <View style={[styles.suggestionCard, { backgroundColor: tokens.surfaceMuted }]}>
        <Text style={styles.suggestionEmoji}>💡</Text>
        <Text style={[styles.suggestionText, { color: tokens.textPrimary }]}>
          {detail.suggestion}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.retryBtn, { backgroundColor: tokens.primary }]}
        onPress={() => router.push({
          pathname: "/payment" as any,
          params: { orderId, amountCents: String(amountCents) }
        })}
      >
        <Text style={styles.retryText}>Tentar novamente</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.homeBtn, { borderColor: tokens.border }]}
        onPress={() => router.push("/" as any)}
      >
        <Text style={[styles.homeText, { color: tokens.textPrimary }]}>
          Voltar ao início
        </Text>
      </TouchableOpacity>

      <View style={styles.noteCard}>
        <Text style={[styles.noteText, { color: tokens.textSecondary }]}>
          Nenhum pagamento foi cobrado. Seu pedido permanece aberto.
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
  errorCard: { borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 20 },
  errorEmoji: { fontSize: 48, marginBottom: 12 },
  errorTitle: { fontSize: 18, fontWeight: "bold" as const, marginBottom: 8 },
  errorDesc: { fontSize: 14, textAlign: "center" as const },
  detailsCard: { borderRadius: 12, padding: 16, marginBottom: 16 },
  detailsTitle: { fontSize: 16, fontWeight: "600" as const, marginBottom: 12 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  detailLabel: { fontSize: 14 },
  detailValue: { fontSize: 14, fontWeight: "500" as const },
  suggestionCard: { borderRadius: 12, padding: 16, marginBottom: 20, flexDirection: "row", alignItems: "center" },
  suggestionEmoji: { fontSize: 24, marginRight: 12 },
  suggestionText: { fontSize: 14, flex: 1 },
  retryBtn: { padding: 16, borderRadius: 12, alignItems: "center", marginBottom: 12 },
  retryText: { color: "white" as const, fontSize: 16, fontWeight: "bold" as const },
  homeBtn: { padding: 16, borderRadius: 12, alignItems: "center", borderWidth: 1, marginBottom: 16 },
  homeText: { fontSize: 16, fontWeight: "600" as const },
  noteCard: { marginTop: 10, padding: 12, alignItems: "center" },
  noteText: { fontSize: 12, textAlign: "center" as const }
});
