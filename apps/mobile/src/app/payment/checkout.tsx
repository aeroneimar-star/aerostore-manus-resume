import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';

import { useAppTheme, theme } from '@/theme';
import { createPaymentClient } from '@/payment/client';
import { PaymentClientError, toPaymentClientError } from '@/payment/PaymentClientError';
import type { PaymentAttempt, PaymentAttemptStatus } from '@/payment/contracts';

type CheckoutState = 'loading' | 'ready' | 'opening' | 'waiting' | 'paid' | 'failed' | 'expired' | 'error';

const MAX_CONTENT_WIDTH = 1100;
const POLL_INTERVAL_MS = 5000;

export default function PIXCheckoutScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId?: string }>();
  const { tokens } = useAppTheme();
  const isDesktop = Dimensions.get('window').width > 768;
  const paymentClient = createPaymentClient();

  const [state, setState] = useState<CheckoutState>('loading');
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [error, setError] = useState<string>('');

  const loadAttempt = useCallback(async () => {
    if (!params.orderId) {
      setError('Pedido não informado.');
      setState('error');
      return;
    }

    setState('loading');
    setError('');
    try {
      const response = await paymentClient.createPaymentAttempt(params.orderId);
      const attemptData = response.data.attempt;
      setAttempt(attemptData);
      setState('ready');
    } catch (err) {
      const pErr = toPaymentClientError(err);
      if (pErr.code === 'ORDER_ALREADY_PAID') {
        setState('paid');
        return;
      }
      if (pErr.code === 'ORDER_EXPIRED') {
        setState('expired');
        return;
      }
      setError(pErr.message || 'Erro ao criar tentativa de pagamento.');
      setState('error');
    }
  }, [params.orderId, paymentClient]);

  const openCheckout = useCallback(async () => {
    if (!attempt?.checkout_url) return;
    setState('opening');
    try {
      await Linking.openURL(attempt.checkout_url);
      setState('waiting');
    } catch {
      setError('Não foi possível abrir o checkout. Verifique sua conexão.');
      setState('error');
    }
  }, [attempt]);

  const pollStatus = useCallback(async () => {
    if (!attempt) return;
    try {
      const response = await paymentClient.getPaymentAttempt(attempt.id);
      const updated = response.data;
      setAttempt(updated);

      if (updated.status === 'PAID') {
        setState('paid');
        return;
      }
      if (updated.status === 'DECLINED' || updated.status === 'CANCELLED') {
        setState('failed');
        return;
      }
      if (updated.status === 'EXPIRED') {
        setState('expired');
        return;
      }
    } catch {
      // Polling failure is non-fatal; keep waiting
    }
  }, [attempt, paymentClient]);

  useEffect(() => {
    if (state !== 'waiting') return;
    const interval = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [state, pollStatus]);

  useEffect(() => {
    void loadAttempt();
  }, [loadAttempt]);

  if (state === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={[styles.centerText, { color: tokens.textPrimary }]}>Preparando pagamento PIX...</Text>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={[styles.centerText, { color: tokens.textPrimary }]}>Preparando pagamento PIX...</Text>
          </View>
        )}
      </View>
    );
  }

  if (state === 'paid') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <Text style={[styles.successSymbol, { color: tokens.success }]}>✓</Text>
              <Text style={[styles.successTitle, { color: tokens.textPrimary }]}>Pagamento Confirmado</Text>
              <Text style={[styles.successBody, { color: tokens.textMuted }]}>
                Seu pagamento PIX foi aprovado. Seu pedido está sendo processado.
              </Text>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: tokens.accent, maxWidth: 520 }]}
                onPress={() => params.orderId ? router.replace({ pathname: '/order/[id]', params: { id: params.orderId } }) : router.navigate('/orders')}
              >
                <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Ver pedido</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <Text style={[styles.successSymbol, { color: tokens.success }]}>✓</Text>
            <Text style={[styles.successTitle, { color: tokens.textPrimary }]}>Pagamento Confirmado</Text>
            <Text style={[styles.successBody, { color: tokens.textMuted }]}>
              Seu pagamento PIX foi aprovado. Seu pedido está sendo processado.
            </Text>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: tokens.accent }]}
              onPress={() => params.orderId ? router.replace({ pathname: '/order/[id]', params: { id: params.orderId } }) : router.navigate('/orders')}
            >
              <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Ver pedido</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (state === 'failed') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <Text style={[styles.errorSymbol, { color: tokens.error }]}>✗</Text>
              <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Pagamento Recusado</Text>
              <Text style={[styles.errorBody, { color: tokens.textMuted }]}>
                O pagamento PIX foi recusado ou cancelado. Tente novamente.
              </Text>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: tokens.accent, maxWidth: 520 }]}
                onPress={() => router.navigate('/orders')}
              >
                <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Ver meus pedidos</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <Text style={[styles.errorSymbol, { color: tokens.error }]}>✗</Text>
            <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Pagamento Recusado</Text>
            <Text style={[styles.errorBody, { color: tokens.textMuted }]}>
              O pagamento PIX foi recusado ou cancelado. Tente novamente.
            </Text>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: tokens.accent }]}
              onPress={() => router.navigate('/orders')}
            >
              <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Ver meus pedidos</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (state === 'expired') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <Text style={[styles.errorSymbol, { color: tokens.warning }]}>!</Text>
              <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Tempo Expirado</Text>
              <Text style={[styles.errorBody, { color: tokens.textMuted }]}>
                O tempo para pagamento expirou. Inicie uma nova tentativa.
              </Text>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: tokens.accent, maxWidth: 520 }]}
                onPress={() => router.navigate('/orders')}
              >
                <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Ver meus pedidos</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <Text style={[styles.errorSymbol, { color: tokens.warning }]}>!</Text>
            <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Tempo Expirado</Text>
            <Text style={[styles.errorBody, { color: tokens.textMuted }]}>
              O tempo para pagamento expirou. Inicie uma nova tentativa.
            </Text>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: tokens.accent }]}
              onPress={() => router.navigate('/orders')}
            >
              <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Ver meus pedidos</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
              <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Erro no Pagamento</Text>
              <Text style={[styles.errorBody, { color: tokens.textMuted }]}>{error}</Text>
              <Pressable
                style={[styles.retryButton, { borderColor: tokens.accent, maxWidth: 520 }]}
                onPress={() => router.navigate('/orders')}
              >
                <Text style={[styles.retryText, { color: tokens.accent }]}>Voltar aos pedidos</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
            <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Erro no Pagamento</Text>
            <Text style={[styles.errorBody, { color: tokens.textMuted }]}>{error}</Text>
            <Pressable
              style={[styles.retryButton, { borderColor: tokens.accent }]}
              onPress={() => router.navigate('/orders')}
            >
              <Text style={[styles.retryText, { color: tokens.accent }]}>Voltar aos pedidos</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // Ready or Waiting state — show QR code / checkout button
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tokens.background }]}
      contentContainerStyle={isDesktop ? styles.desktopContent : styles.scrollContent}
    >
      <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Pagamento PIX</Text>

      {attempt && (
        <View style={[styles.infoCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Status</Text>
            <Text style={[
              styles.infoValue,
              { color: attempt.status === 'PENDING' ? tokens.warning : tokens.textPrimary },
            ]}>
              {attempt.status === 'PENDING' ? 'Aguardando pagamento' : attempt.status}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Valor</Text>
            <Text style={[styles.infoValue, { color: tokens.textPrimary }]}>
              R$ {(attempt.amount_cents / 100).toFixed(2).replace('.', ',')}
            </Text>
          </View>
          {attempt.expires_at && (
            <View style={styles.infoRow}>
              <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Expira em</Text>
              <Text style={[styles.infoValue, { color: tokens.warning }]}>
                {new Date(attempt.expires_at).toLocaleTimeString('pt-BR')}
              </Text>
            </View>
          )}
        </View>
      )}

      {state === 'ready' && attempt?.checkout_url && (
        <>
          <Pressable
            style={[styles.primaryButton, { backgroundColor: tokens.accent }]}
            onPress={openCheckout}
          >
            <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>
              Pagar com PIX
            </Text>
          </Pressable>
          <Text style={[styles.hint, { color: tokens.textMuted }]}>
            Você será redirecionado para o checkout InfinitePay
          </Text>
        </>
      )}

      {state === 'waiting' && (
        <>
          <View style={[styles.waitingCard, { backgroundColor: tokens.infoSurface }]}>
            <ActivityIndicator size="small" color={tokens.info} />
            <Text style={[styles.waitingText, { color: tokens.info }]}>
              Aguardando confirmação do pagamento...
            </Text>
          </View>
          <Pressable
            style={[styles.secondaryButton, { borderColor: tokens.accent }]}
            onPress={openCheckout}
          >
            <Text style={[styles.secondaryButtonText, { color: tokens.accent }]}>
              Abrir checkout novamente
            </Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, { borderColor: tokens.border }]}
            onPress={() => router.navigate('/orders')}
          >
            <Text style={[styles.secondaryButtonText, { color: tokens.textMuted }]}>
              Ver meus pedidos
            </Text>
          </Pressable>
          <Text style={[styles.pollingNote, { color: tokens.textMuted }]}>
            Atualização automática a cada 5 segundos
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  desktopContent: { padding: 24, maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', width: '100%', paddingBottom: 80 },
  desktopCompact: { flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  centerText: { marginTop: 16, fontSize: 16, fontWeight: '600' },
  sectionTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 2, marginBottom: 20 },
  successSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  successTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  successBody: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  errorSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  errorBody: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderRadius: 6 },
  retryText: { fontSize: 14, fontWeight: '600' },
  infoCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '500' },
  primaryButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginBottom: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
  secondaryButton: { paddingVertical: 12, borderWidth: 1, borderRadius: 8, alignItems: 'center', marginBottom: 8 },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12, textAlign: 'center', marginTop: 4, marginBottom: 16 },
  waitingCard: { padding: 16, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 16 },
  waitingText: { fontSize: 14, fontWeight: '500' },
  pollingNote: { fontSize: 11, textAlign: 'center', marginTop: 8 },
});
