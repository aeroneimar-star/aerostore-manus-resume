import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAppTheme } from "@/theme";

export default function PaymentPixScreen() {
  const { tokens } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId: string; amountCents: string }>();
  const orderId = params.orderId || "order-demo";
  const amountCents = Number(params.amountCents) || 9900;

  const [timeLeft, setTimeLeft] = useState(600);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<"PENDING" | "PAID">("PENDING");

  useEffect(() => {
    if (status === "PAID") return;
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setStatus("PENDING");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setStatus("PAID");
      setTimeout(() => {
        router.push({
          pathname: "/order-success" as any,
          params: { orderId, amountCents: String(amountCents) }
        });
      }, 1500);
    }, 8000);
    return () => clearTimeout(timer);
  }, []);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const formatBRL = (cents: number) =>
    `R$ ${Math.floor(cents / 100).toLocaleString("pt-BR")},${String(cents % 100).padStart(2, "0")}`;

  const pixCode = `00020126580014br.gov.bcb.pix2536qrcode-pix.example.com/pay-${orderId}/5204000053039865802BR5913AEROSTORE6009SAO PAULO62070503***6304ABCD`;

  function handleCopy() {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: tokens.primary }]}>← Voltar</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: tokens.textPrimary }]}>
          Pagar com PIX
        </Text>
      </View>

      <View style={[styles.qrCard, { backgroundColor: tokens.surfaceMuted }]}>
        {status === "PAID" ? (
          <View style={styles.paidContainer}>
            <Text style={styles.paidEmoji}>✅</Text>
            <Text style={[styles.paidText, { color: tokens.primary }]}>
              Pagamento confirmado!
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.qrContainer}>
              <View style={[styles.qrCode, { backgroundColor: "#FFFFFF" }]}>
                <Text style={styles.qrPlaceholder}>QR CODE PIX</Text>
              </View>
            </View>

            <Text style={[styles.timerText, { color: timeLeft < 60 ? tokens.error : tokens.textPrimary }]}>
              Expira em {minutes}:{String(seconds).padStart(2, "0")}
            </Text>

            <Text style={[styles.pixLabel, { color: tokens.textSecondary }]}>
              Ou copie o código PIX:
            </Text>

            <View style={[styles.pixCodeBox, { backgroundColor: tokens.surface }]}>
              <Text style={[styles.pixCodeText, { color: tokens.textPrimary }]} numberOfLines={2}>
                {pixCode}
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.copyBtn, { backgroundColor: tokens.primary }]}
              onPress={handleCopy}
            >
              <Text style={styles.copyText}>
                {copied ? "Copiado!" : "Copiar código PIX"}
              </Text>
            </TouchableOpacity>

            <Text style={[styles.amount, { color: tokens.primary }]}>
              {formatBRL(amountCents)}
            </Text>
          </>
        )}
      </View>

      <View style={[styles.instructions, { backgroundColor: tokens.surfaceMuted }]}>
        <Text style={[styles.instTitle, { color: tokens.textPrimary }]}>
          Como pagar com PIX
        </Text>
        <Text style={[styles.instItem, { color: tokens.textSecondary }]}>
          1. Abra o app do seu banco
        </Text>
        <Text style={[styles.instItem, { color: tokens.textSecondary }]}>
          2. Escolha pagar com QR Code
        </Text>
        <Text style={[styles.instItem, { color: tokens.textSecondary }]}>
          3. Aponte a câmera para o código acima
        </Text>
        <Text style={[styles.instItem, { color: tokens.textSecondary }]}>
          4. Confirme o pagamento
        </Text>
      </View>

      <View style={styles.noteCard}>
        <Text style={[styles.noteText, { color: tokens.textSecondary }]}>
          Após a confirmação, você será redirecionado automaticamente.
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
  qrCard: { borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 20 },
  qrContainer: { marginBottom: 16 },
  qrCode: {
    width: 200,
    height: 200,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center"
  },
  qrPlaceholder: { fontSize: 14, color: "#666", fontWeight: "600" as const },
  timerText: { fontSize: 18, fontWeight: "bold" as const, marginBottom: 16 },
  pixLabel: { fontSize: 14, marginBottom: 8 },
  pixCodeBox: { padding: 12, borderRadius: 8, marginBottom: 12, width: "100%" as const },
  pixCodeText: { fontSize: 11, textAlign: "center" as const, lineHeight: 16 },
  copyBtn: { padding: 12, borderRadius: 8, minWidth: 200, alignItems: "center", marginBottom: 16 },
  copyText: { color: "white" as const, fontSize: 15, fontWeight: "600" as const },
  amount: { fontSize: 28, fontWeight: "bold" as const },
  paidContainer: { alignItems: "center", padding: 20 },
  paidEmoji: { fontSize: 48, marginBottom: 12 },
  paidText: { fontSize: 18, fontWeight: "bold" as const },
  instructions: { borderRadius: 12, padding: 16, marginBottom: 20 },
  instTitle: { fontSize: 16, fontWeight: "600" as const, marginBottom: 10 },
  instItem: { fontSize: 14, marginBottom: 6 },
  noteCard: { marginTop: 10, padding: 12, alignItems: "center" },
  noteText: { fontSize: 12, textAlign: "center" as const }
});
