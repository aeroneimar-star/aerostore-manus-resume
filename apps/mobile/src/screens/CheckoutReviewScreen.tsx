import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Alert } from "react-native";
import { useAppTheme, theme } from "@/theme";
import { useRouter } from "expo-router";
import { createOrderClient } from "../order/client";
import { OrderClientError } from "../order/OrderClientError";

const orderClient = createOrderClient();

export default function CheckoutReviewScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await orderClient.createOrder({});
      if (result.data.order.status === "AWAITING_PAYMENT") {
        router.push({ pathname: '/order-success', params: { orderId: result.data.order.id, orderNumber: result.data.order.orderNumber } } as any);
      }
    } catch (err: any) {
      if (err instanceof OrderClientError) {
        setError(err.message);
      } else {
        setError("Erro inesperado ao criar pedido.");
      }
    } finally {
      setLoading(false);
    }
  }, [loading, router]);

  const styles = {
    container: { flex: 1, backgroundColor: tokens.background },
    header: { padding: 16, borderBottomWidth: 1, borderBottomColor: tokens.border },
    headerTitle: { fontSize: 18, fontWeight: "700" as const, color: tokens.textPrimary },
    content: { flex: 1, padding: 16 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 16, fontWeight: "600" as const, color: tokens.textPrimary, marginBottom: 8 },
    row: { flexDirection: "row" as const, justifyContent: "space-between" as const, paddingVertical: 6 },
    rowLabel: { fontSize: 14, color: tokens.textSecondary },
    rowValue: { fontSize: 14, fontWeight: "500" as const, color: tokens.textPrimary },
    totalRow: { borderTopWidth: 1, borderTopColor: tokens.border, paddingTop: 12 },
    totalLabel: { fontSize: 16, fontWeight: "600" as const, color: tokens.textPrimary },
    totalValue: { fontSize: 18, fontWeight: "700" as const, color: tokens.primary },
    button: { padding: 16, borderRadius: 12, alignItems: "center" as const, marginHorizontal: 16 },
    buttonEnabled: { backgroundColor: tokens.primary },
    buttonDisabled: { backgroundColor: tokens.border },
    buttonText: { fontSize: 16, fontWeight: "700" as const, color: "#FFFFFF" },
    error: { padding: 16, backgroundColor: "#FFF0F0", borderRadius: 8, marginHorizontal: 16, marginBottom: 16 },
    errorText: { color: "#CC0000", fontSize: 14 },
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Revisao do Pedido</Text>
      </View>
      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Itens</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Camiseta Basica - P/Preta (x2)</Text>
            <Text style={styles.rowValue}>R$ 50,00</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Entrega</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Modalidade</Text>
            <Text style={styles.rowValue}>Entrega</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Endereco</Text>
            <Text style={styles.rowValue}>Rua Teste, 100 - Centro</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resumo</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Subtotal</Text>
            <Text style={styles.rowValue}>R$ 50,00</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Frete</Text>
            <Text style={styles.rowValue}>R$ 15,00</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>R$ 65,00</Text>
          </View>
        </View>
      </ScrollView>

      {error && (
        <View style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.button, loading ? styles.buttonDisabled : styles.buttonEnabled]}
        onPress={handleConfirm}
        disabled={loading}
      >
        <Text style={styles.buttonText}>{loading ? "Criando pedido..." : "Confirmar Pedido"}</Text>
      </TouchableOpacity>
    </View>
  );
}
