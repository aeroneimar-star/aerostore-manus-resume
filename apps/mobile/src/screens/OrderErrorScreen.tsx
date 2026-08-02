import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { useAppTheme, theme } from "@/theme";
import { useRouter, useLocalSearchParams } from "expo-router";

export default function OrderErrorScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; message?: string }>();
  const code = params.code || "ORDER_ERROR";
  const message = params.message || "Ocorreu um erro ao processar seu pedido. Tente novamente.";

  const handleRetry = () => {
    router.back();
  };

  const handleGoHome = () => {
    router.replace("/");
  };

  const styles = {
    container: { flex: 1, backgroundColor: tokens.background },
    content: { flex: 1, padding: 24, alignItems: "center" as const, justifyContent: "center" as const },
    icon: { fontSize: 64, marginBottom: 16 },
    title: { fontSize: 22, fontWeight: "700" as const, color: tokens.error, textAlign: "center" as const, marginBottom: 8 },
    subtitle: { fontSize: 16, color: tokens.textSecondary, textAlign: "center" as const, marginBottom: 32 },
    card: { backgroundColor: tokens.card, borderRadius: 12, padding: 20, width: "100%" as const, marginBottom: 24 },
    cardRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, paddingVertical: 8 },
    cardLabel: { fontSize: 14, color: tokens.textSecondary },
    cardValue: { fontSize: 14, fontWeight: "600" as const, color: tokens.error },
    buttons: { width: "100%" as const, paddingHorizontal: 16 },
    primaryButton: { padding: 16, borderRadius: 12, alignItems: "center" as const, backgroundColor: tokens.primary, marginBottom: 12 },
    primaryButtonText: { fontSize: 16, fontWeight: "700" as const, color: "#FFFFFF" },
    secondaryButton: { padding: 16, borderRadius: 12, alignItems: "center" as const, borderWidth: 1, borderColor: tokens.border },
    secondaryButtonText: { fontSize: 16, fontWeight: "600" as const, color: tokens.textPrimary },
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.icon}>!</Text>
        <Text style={styles.title}>Erro no Pedido</Text>
        <Text style={styles.subtitle}>{message}</Text>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Codigo do Erro</Text>
            <Text style={styles.cardValue}>{code}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Status do Carrinho</Text>
            <Text style={[styles.cardValue, { color: tokens.textPrimary }]}>Mantido</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Pagamento</Text>
            <Text style={[styles.cardValue, { color: tokens.textPrimary }]}>Nao iniciado</Text>
          </View>
        </View>

        <Text style={{ fontSize: 13, color: tokens.textSecondary, textAlign: "center" as const, marginBottom: 24, paddingHorizontal: 16 }}>
          Nenhum pagamento foi iniciado. Seu carrinho esta seguro e voce pode tentar novamente.
        </Text>

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
            <Text style={styles.primaryButtonText}>Tentar Novamente</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleGoHome}>
            <Text style={styles.secondaryButtonText}>Voltar para Inicio</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
