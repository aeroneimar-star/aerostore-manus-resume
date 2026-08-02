import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";
import { useAppTheme, theme } from "@/theme";
import { useRouter, useLocalSearchParams } from "expo-router";

export default function OrderSuccessScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId?: string; orderNumber?: string }>();
  const orderId = params.orderId || "N/A";
  const orderNumber = params.orderNumber || "AERO-2026-000000000";

  const handleGoHome = () => {
    router.replace("/");
  };

  const handleViewOrders = () => {
    router.push("/order-list" as any);
  };

  const styles = {
    container: { flex: 1, backgroundColor: tokens.background },
    content: { flex: 1, padding: 24, alignItems: "center" as const, justifyContent: "center" as const },
    icon: { fontSize: 64, marginBottom: 16 },
    title: { fontSize: 22, fontWeight: "700" as const, color: tokens.success, textAlign: "center" as const, marginBottom: 8 },
    subtitle: { fontSize: 16, color: tokens.textSecondary, textAlign: "center" as const, marginBottom: 32 },
    card: { backgroundColor: tokens.card, borderRadius: 12, padding: 20, width: "100%" as const, marginBottom: 24 },
    cardRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, paddingVertical: 8 },
    cardLabel: { fontSize: 14, color: tokens.textSecondary },
    cardValue: { fontSize: 14, fontWeight: "600" as const, color: tokens.textPrimary },
    notice: { fontSize: 13, color: tokens.textSecondary, textAlign: "center" as const, marginBottom: 24, paddingHorizontal: 16 },
    buttons: { width: "100%" as const, paddingHorizontal: 16 },
    primaryButton: { padding: 16, borderRadius: 12, alignItems: "center" as const, backgroundColor: tokens.primary, marginBottom: 12 },
    primaryButtonText: { fontSize: 16, fontWeight: "700" as const, color: "#FFFFFF" },
    secondaryButton: { padding: 16, borderRadius: 12, alignItems: "center" as const, borderWidth: 1, borderColor: tokens.border },
    secondaryButtonText: { fontSize: 16, fontWeight: "600" as const, color: tokens.textPrimary },
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.icon}>✓</Text>
        <Text style={styles.title}>Pedido Confirmado!</Text>
        <Text style={styles.subtitle}>Seu pedido foi criado com sucesso.</Text>

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Numero do Pedido</Text>
            <Text style={styles.cardValue}>{orderNumber}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Status</Text>
            <Text style={[styles.cardValue, { color: tokens.success }]}>Aguardando Pagamento</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>ID do Pedido</Text>
            <Text style={styles.cardValue}>{orderId.slice(0, 8)}...</Text>
          </View>
        </View>

        <Text style={styles.notice}>
          O pagamento sera iniciado em breve. Voce recebera uma notificacao quando o pagamento for processado.
        </Text>

        <View style={styles.buttons}>
          <TouchableOpacity style={styles.primaryButton} onPress={handleGoHome}>
            <Text style={styles.primaryButtonText}>Voltar para Inicio</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleViewOrders}>
            <Text style={styles.secondaryButtonText}>Ver Meus Pedidos</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}
