import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions } from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme, theme } from '@/theme';
import { createFulfillmentClient } from '@/fulfillment/client';
import { FulfillmentClientError } from '@/fulfillment/FulfillmentClientError';
import { createAddressClient } from '@/address/client';
import { orderClient } from '@/orders/client';
import { OrderClientError, toOrderClientError } from '@/orders/OrderClientError';
import type {
  CurrentFulfillment,
  DeliverySummary,
  FulfillmentOptions,
  FulfillmentType,
  PickupStore,
} from '@/fulfillment/contracts';

type ScreenState = 'loading' | 'ready' | 'error' | 'creating' | 'created' | 'expired' | 'stock_error' | 'network_error';
type ViewMode = 'select' | 'delivery' | 'pickup' | 'summary';

const MAX_CONTENT_WIDTH = 1100;

export function FulfillmentScreen() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const fulfillmentClient = createFulfillmentClient();
  const addressClient = createAddressClient();
  const isDesktop = Dimensions.get('window').width > 768;

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [viewMode, setViewMode] = useState<ViewMode>('select');
  const [options, setOptions] = useState<FulfillmentOptions | null>(null);
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string>('');
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string>('');
  const [createdOrderNumber, setCreatedOrderNumber] = useState<string>('');

  const loadOptions = useCallback(async () => {
    setScreenState('loading');
    setError('');
    try {
      const response = await fulfillmentClient.getFulfillmentOptions();
      setOptions(response.data);
      setScreenState('ready');
    } catch (err) {
      const fError = err instanceof FulfillmentClientError ? err : new FulfillmentClientError('INTERNAL_ERROR', 'Erro ao carregar opções de entrega.');
      setError(fError.message);
      setScreenState('error');
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const response = await fulfillmentClient.getDeliverySummary();
      setSummary(response.data);
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  const handleSelectPickup = useCallback(async (storeId: string) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fulfillmentClient.setFulfillment({
        fulfillment_type: 'PICKUP',
        pickup_store_id: storeId,
      });
      setOptions(response.data);
      await loadSummary();
      setViewMode('summary');
    } catch (err) {
      const fError = err instanceof FulfillmentClientError ? err : new FulfillmentClientError('INTERNAL_ERROR', 'Erro ao selecionar retirada.');
      if (fError.code === 'FULFILLMENT_VERSION_CONFLICT') {
        setError('A seleção foi alterada. Recarregando...');
        await loadOptions();
      } else {
        setError(fError.message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [loadOptions, loadSummary]);

  const handleSelectDelivery = useCallback(async (addressId: string) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await fulfillmentClient.setFulfillment({
        fulfillment_type: 'DELIVERY',
        address_id: addressId,
      });
      setOptions(response.data);
      await loadSummary();
      setViewMode('summary');
    } catch (err) {
      const fError = err instanceof FulfillmentClientError ? err : new FulfillmentClientError('INTERNAL_ERROR', 'Erro ao selecionar entrega.');
      if (fError.code === 'FULFILLMENT_VERSION_CONFLICT') {
        setError('A seleção foi alterada. Recarregando...');
        await loadOptions();
      } else {
        setError(fError.message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [loadOptions, loadSummary]);

  const handleAddAddress = () => {
    router.navigate('/address-form');
  };

  const handleEditAddress = (addressId: string) => {
    const addr = options?.availableAddresses.find((a) => a.id === addressId);
    router.navigate({
      pathname: '/address-form',
      params: { addressId, addressJson: JSON.stringify(addr) },
    });
  };

  const handleCreateOrder = useCallback(async () => {
    if (!summary || submitting) return;

    setSubmitting(true);
    setScreenState('creating');
    setError('');

    try {
      const idempotencyKey = pendingIdempotencyKey || crypto.randomUUID();
      if (!pendingIdempotencyKey) {
        setPendingIdempotencyKey(idempotencyKey);
      }
      const fulfillmentType = options?.currentFulfillment?.fulfillmentType ?? summary?.fulfillmentType;
      if (!fulfillmentType) {
        setError('Selecione o tipo de entrega ou retirada antes de criar o pedido.');
        setScreenState('ready');
        return;
      }
      const payload: Record<string, unknown> = {
        fulfillment_type: fulfillmentType,
        idempotency_key: idempotencyKey,
      };

      if (fulfillmentType === 'DELIVERY') {
        const addressId = options?.currentFulfillment?.addressId;
        if (addressId) {
          payload.address_id = addressId;
        } else {
          setError('Selecione um endereço de entrega.');
          setScreenState('ready');
          return;
        }
      } else if (fulfillmentType === 'PICKUP') {
        const pickupStoreId = options?.currentFulfillment?.pickupStoreId;
        if (pickupStoreId) {
          payload.pickup_store_id = pickupStoreId;
        } else {
          setError('Selecione uma loja de retirada.');
          setScreenState('ready');
          return;
        }
      }

      const response = await orderClient.createOrder(payload as any);
      setCreatedOrderId(response.data.order.id);
      setCreatedOrderNumber(response.data.order.order_number || '');
      setScreenState('created');
    } catch (err) {
      const oErr = toOrderClientError(err);
      switch (oErr.code) {
        case 'SESSION_EXPIRED':
          setScreenState('expired');
          return;
        case 'UNAUTHORIZED':
          setScreenState('expired');
          return;
        case 'STOCK_UNAVAILABLE':
          setScreenState('stock_error');
          break;
        case 'FULFILLMENT_INVALID':
          setError('Dados de entrega ou retirada inválidos. Verifique as opções selecionadas.');
          break;
        case 'ADDRESS_NOT_FOUND':
          setError('Endereço não encontrado. Selecione outro endereço ou adicione um novo.');
          break;
        case 'PICKUP_STORE_INVALID':
          setError('Loja de retirada inválida. Selecione outra loja.');
          break;
        case 'ORDER_ALREADY_EXISTS':
          setScreenState('ready');
          setViewMode('summary');
          return;
        case 'VALIDATION_ERROR':
          setError('Verifique os dados do pedido e tente novamente.');
          break;
        case 'NETWORK_ERROR':
          setScreenState('network_error');
          break;
        case 'TIMEOUT_ERROR':
          setScreenState('network_error');
          break;
        default:
          setError(oErr.message || 'Erro ao criar pedido. Tente novamente.');
      }
      setSubmitting(false);
      setScreenState('ready');
    }
  }, [summary, router, submitting, pendingIdempotencyKey]);

  const handleViewOrders = useCallback(() => {
    router.navigate('/orders');
  }, [router]);

  const handleViewOrder = useCallback(() => {
    router.navigate({ pathname: '/order/[id]', params: { id: createdOrderId } });
  }, [router, createdOrderId]);

  const handleGoHome = useCallback(() => {
    router.navigate('/');
  }, [router]);

  const handleRetryNetwork = useCallback(async () => {
    setScreenState('ready');
    setSubmitting(false);
    setError('');
    await loadOptions();
  }, [loadOptions]);

  const handleRetryStock = useCallback(async () => {
    setScreenState('ready');
    setSubmitting(false);
    setError('');
  }, []);

  // Sessão expirada
  if (screenState === 'expired') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <Text style={[styles.errorSymbol, { color: tokens.warning }]}>!</Text>
              <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Sua sessão expirou</Text>
              <Text style={[styles.errorBody, { color: tokens.textMuted }]}>Entre novamente para continuar.</Text>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: tokens.accent, marginBottom: 12, maxWidth: 520 }]}
                onPress={handleGoHome}
                testID="login-again"
              >
                <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Entrar novamente</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, { borderColor: tokens.border, maxWidth: 520 }]}
                onPress={() => router.navigate('/')}
                testID="go-home"
              >
                <Text style={[styles.secondaryButtonText, { color: tokens.textMuted }]}>Voltar ao início</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <Text style={[styles.errorSymbol, { color: tokens.warning }]}>!</Text>
            <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Sua sessão expirou</Text>
            <Text style={[styles.errorBody, { color: tokens.textMuted }]}>Entre novamente para continuar.</Text>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: tokens.accent, marginBottom: 12 }]}
              onPress={handleGoHome}
              testID="login-again"
            >
              <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Entrar novamente</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: tokens.border }]}
              onPress={() => router.navigate('/')}
              testID="go-home"
            >
              <Text style={[styles.secondaryButtonText, { color: tokens.textMuted }]}>Voltar ao início</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // Erro de estoque insuficiente
  if (screenState === 'stock_error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <View style={[styles.stockAlertCard, { backgroundColor: tokens.warningSurface }]}>
                <Text style={[styles.stockAlertIcon, { color: tokens.warning }]}>!</Text>
                <Text style={[styles.stockAlertTitle, { color: tokens.warning }]}>Estoque indisponível</Text>
                <Text style={[styles.stockAlertBody, { color: tokens.textMuted }]}>
                  Não foi possível reservar todos os itens. Revise seu carrinho.
                </Text>
              </View>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: tokens.accent, marginTop: 24, maxWidth: 520 }]}
                onPress={() => router.navigate('/cart')}
                testID="review-cart"
              >
                <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Revisar carrinho</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, { borderColor: tokens.accent, marginTop: 12, maxWidth: 520 }]}
                onPress={handleRetryStock}
                testID="check-again"
              >
                <Text style={[styles.secondaryButtonText, { color: tokens.accent }]}>Verificar novamente</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <View style={[styles.stockAlertCard, { backgroundColor: tokens.warningSurface }]}>
              <Text style={[styles.stockAlertIcon, { color: tokens.warning }]}>!</Text>
              <Text style={[styles.stockAlertTitle, { color: tokens.warning }]}>Estoque indisponível</Text>
              <Text style={[styles.stockAlertBody, { color: tokens.textMuted }]}>
                Não foi possível reservar todos os itens. Revise seu carrinho.
              </Text>
            </View>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: tokens.accent, marginTop: 24 }]}
              onPress={() => router.navigate('/cart')}
              testID="review-cart"
            >
              <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Revisar carrinho</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: tokens.accent, marginTop: 12 }]}
              onPress={handleRetryStock}
              testID="check-again"
            >
              <Text style={[styles.secondaryButtonText, { color: tokens.accent }]}>Verificar novamente</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // Erro de rede
  if (screenState === 'network_error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
              <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Conexão indisponível</Text>
              <Text style={[styles.errorBody, { color: tokens.textMuted }]}>
                Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.
              </Text>
              <Pressable
                style={[styles.primaryButton, { backgroundColor: tokens.accent, marginBottom: 12, maxWidth: 520 }]}
                onPress={handleRetryNetwork}
                testID="retry-connection"
              >
                <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Tentar novamente</Text>
              </Pressable>
              <Pressable
                style={[styles.secondaryButton, { borderColor: tokens.border, maxWidth: 520 }]}
                onPress={handleGoHome}
                testID="go-home-from-error"
              >
                <Text style={[styles.secondaryButtonText, { color: tokens.textMuted }]}>Voltar ao início</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
            <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Conexão indisponível</Text>
            <Text style={[styles.errorBody, { color: tokens.textMuted }]}>
              Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.
            </Text>
            <Pressable
              style={[styles.primaryButton, { backgroundColor: tokens.accent, marginBottom: 12 }]}
              onPress={handleRetryNetwork}
              testID="retry-connection"
            >
              <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Tentar novamente</Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryButton, { borderColor: tokens.border }]}
              onPress={handleGoHome}
              testID="go-home-from-error"
            >
              <Text style={[styles.secondaryButtonText, { color: tokens.textMuted }]}>Voltar ao início</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  // Pedido criado com sucesso
  if (screenState === 'created') {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: tokens.background }]}
        contentContainerStyle={isDesktop ? styles.desktopContent : styles.scrollContent}
        testID="fulfillment-created-screen"
      >
        <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Pedido Confirmado</Text>
        <View style={[styles.createdCard, { backgroundColor: tokens.successSurface }]}>
          <Text style={[styles.createdSymbol, { color: tokens.success }]}>✓</Text>
          <Text style={[styles.createdTitle, { color: tokens.textPrimary }]}>Pedido Criado!</Text>
          <Text style={[styles.createdBody, { color: tokens.textMuted }]}>
            Seu pedido foi recebido e o estoque está reservado.
          </Text>
        </View>

        <View style={[styles.infoCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
          <Text style={[styles.infoSectionTitle, { color: tokens.textPrimary }]}>Informações do Pedido</Text>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Número</Text>
            <Text style={[styles.infoValue, { color: tokens.textPrimary }]}>
              {createdOrderNumber || '—'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Status</Text>
            <Text style={[styles.infoValue, { color: tokens.warning }]}>Aguardando pagamento</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.infoLabel, { color: tokens.textMuted }]}>Reserva</Text>
            <Text style={[styles.infoValue, { color: tokens.textPrimary }]}>Válida por 30 minutos</Text>
          </View>
        </View>

        <Pressable
          style={[styles.primaryButton, { backgroundColor: tokens.accent }]}
          onPress={handleViewOrder}
          testID="view-created-order"
        >
          <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>Ver pedido</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { borderColor: tokens.accent }]}
          onPress={handleViewOrders}
          testID="view-all-orders"
        >
          <Text style={[styles.secondaryButtonText, { color: tokens.accent }]}>Ver meus pedidos</Text>
        </Pressable>
        <Pressable
          style={[styles.secondaryButton, { borderColor: tokens.border }]}
          onPress={() => router.navigate('/catalog')}
          testID="continue-shopping"
        >
          <Text style={[styles.secondaryButtonText, { color: tokens.textMuted }]}>Continuar comprando</Text>
        </Pressable>
        <Text style={[styles.idempotencyNote, { color: tokens.textMuted }]}>
          Pedido protegido contra duplicidade
        </Text>
      </ScrollView>
    );
  }

  // Carregando / Criando
  if (screenState === 'creating') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color={tokens.accent} />
              <Text style={[styles.centerText, { color: tokens.textPrimary }]}>Criando seu pedido...</Text>
              <Text style={[styles.centerSubtext, { color: tokens.textSecondary }]}>Reservando estoque e verificando dados</Text>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={[styles.centerText, { color: tokens.textPrimary }]}>Criando seu pedido...</Text>
            <Text style={[styles.centerSubtext, { color: tokens.textSecondary }]}>Reservando estoque e verificando dados</Text>
          </View>
        )}
      </View>
    );
  }

  // Loading
  if (screenState === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <ActivityIndicator size="large" color={tokens.accent} />
              <Text style={[styles.centerText, { color: tokens.textPrimary }]}>Carregando opções de entrega...</Text>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color={tokens.accent} />
            <Text style={[styles.centerText, { color: tokens.textPrimary }]}>Carregando opções de entrega...</Text>
          </View>
        )}
      </View>
    );
  }

  // Error
  if (screenState === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        {isDesktop ? (
          <View style={styles.desktopCompact}>
            <View style={styles.centerContent}>
              <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
              <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Erro ao carregar opções</Text>
              <Text style={[styles.errorBody, { color: tokens.textMuted }]}>{error || 'Tente novamente em alguns instantes.'}</Text>
              <Pressable style={[styles.retryButton, { borderColor: tokens.accent, maxWidth: 520 }]} onPress={loadOptions} testID="fulfillment-retry">
                <Text style={[styles.retryText, { color: tokens.accent }]}>Tentar novamente</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.centerContent}>
            <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
            <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Erro ao carregar opções</Text>
            <Text style={[styles.errorBody, { color: tokens.textMuted }]}>{error || 'Tente novamente em alguns instantes.'}</Text>
            <Pressable style={[styles.retryButton, { borderColor: tokens.accent }]} onPress={loadOptions} testID="fulfillment-retry">
              <Text style={[styles.retryText, { color: tokens.accent }]}>Tentar novamente</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (!options) return null;

  // Summary view
  if (viewMode === 'summary' && summary) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: tokens.background }]}
        contentContainerStyle={isDesktop ? styles.desktopContent : styles.scrollContent}
        testID="fulfillment-summary-screen"
      >
        <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Resumo da Entrega</Text>

        <View style={[styles.summaryCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>Modalidade</Text>
            <Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>
              {summary.fulfillmentType === 'PICKUP' ? 'Retirada na loja' : 'Entrega'}
            </Text>
          </View>
          {summary.addressSummary && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>Endereço</Text>
              <Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>{summary.addressSummary}</Text>
            </View>
          )}
          {summary.pickupStoreSummary && (
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>Loja</Text>
              <Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>{summary.pickupStoreSummary}</Text>
            </View>
          )}
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>Frete</Text>
            <Text style={[styles.summaryValue, { color: summary.shippingPriceCents === 0 ? tokens.success : tokens.textPrimary }]}>
              {summary.shippingMethod || 'Calculando...'}
            </Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>Entrega estimada</Text>
            <Text style={[styles.summaryValue, { color: tokens.textPrimary }]}>{summary.estimatedDelivery || 'A definir'}</Text>
          </View>
        </View>

        {/* Totals */}
        <View style={[styles.totalsCard, { backgroundColor: tokens.surface, borderColor: tokens.border }]}>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: tokens.textSecondary }]}>Subtotal</Text>
            <Text style={[styles.totalValue, { color: tokens.textPrimary }]}>{summary.cartSubtotalFormatted || '-'}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: tokens.textSecondary }]}>Frete</Text>
            <Text style={[styles.totalValue, { color: summary.shippingPriceCents === 0 ? tokens.success : tokens.textPrimary }]}>
              {summary.shippingPriceFormatted || '-'}
            </Text>
          </View>
          <View style={[styles.grandTotalRow, { borderTopColor: tokens.divider }]}>
            <Text style={[styles.grandTotalLabel, { color: tokens.textPrimary }]}>Total estimado</Text>
            <Text style={[styles.grandTotalValue, { color: tokens.accent }]}>
              {summary.estimatedTotalFormatted || '-'}
            </Text>
          </View>
        </View>

        {/* Blocking issues */}
        {summary.blockingIssues.length > 0 && (
          <View style={[styles.blockingCard, { backgroundColor: tokens.warningSurface }]}>
            {summary.blockingIssues.map((issue, i) => (
              <Text key={i} style={[styles.blockingText, { color: tokens.warning }]}>{issue}</Text>
            ))}
          </View>
        )}

        {/* Note about no checkout */}
        <View style={[styles.noteCard, { backgroundColor: tokens.infoSurface }]}>
          <Text style={[styles.noteText, { color: tokens.info }]}>
            O estoque será confirmado antes do pedido. Nenhum pagamento será processado agora.
          </Text>
        </View>

        {/* Inline error */}
        {error ? (
          <View style={[styles.errorInline, { backgroundColor: tokens.errorSurface }]}>
            <Text style={[styles.errorInlineText, { color: tokens.error }]}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.primaryButton, { backgroundColor: submitting ? tokens.buttonDisabled : tokens.accent }]}
          onPress={handleCreateOrder}
          disabled={summary.blockingIssues.length > 0 || submitting}
          testID="fulfillment-create-order"
        >
          {submitting ? (
            <ActivityIndicator size="small" color={tokens.textInverse} />
          ) : (
            <Text style={[styles.primaryButtonText, { color: tokens.textInverse }]}>
              Confirmar reserva e criar pedido
            </Text>
          )}
        </Pressable>

        <Pressable
          style={[styles.backButton, { borderColor: tokens.accent, marginTop: 12 }]}
          onPress={() => setViewMode('select')}
          testID="fulfillment-change"
        >
          <Text style={[styles.backButtonText, { color: tokens.accent }]}>Alterar opções de entrega</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Select mode
  return (
    <ScrollView
      style={[styles.container, { backgroundColor: tokens.background }]}
      contentContainerStyle={isDesktop ? styles.desktopContent : styles.scrollContent}
      testID="fulfillment-screen"
    >
      <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Como deseja receber?</Text>

      {/* Mode selection cards */}
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeCard, { backgroundColor: tokens.surface, borderColor: options.availableFulfillmentTypes.includes('DELIVERY') ? tokens.accent : tokens.buttonDisabled }]}
          onPress={() => options.availableFulfillmentTypes.includes('DELIVERY') && setViewMode('delivery')}
          disabled={!options.availableFulfillmentTypes.includes('DELIVERY')}
          testID="mode-delivery"
        >
          <Text style={[styles.modeIcon, { color: tokens.accent }]}>→</Text>
          <Text style={[styles.modeTitle, { color: options.availableFulfillmentTypes.includes('DELIVERY') ? tokens.textPrimary : tokens.textDisabled }]}>Entrega</Text>
          <Text style={[styles.modeSubtitle, { color: tokens.textMuted }]}>Receba em casa</Text>
        </Pressable>

        <Pressable
          style={[styles.modeCard, { backgroundColor: tokens.surface, borderColor: options.availableFulfillmentTypes.includes('PICKUP') ? tokens.accent : tokens.buttonDisabled }]}
          onPress={() => options.availableFulfillmentTypes.includes('PICKUP') && setViewMode('pickup')}
          disabled={!options.availableFulfillmentTypes.includes('PICKUP')}
          testID="mode-pickup"
        >
          <Text style={[styles.modeIcon, { color: tokens.accent }]}>◉</Text>
          <Text style={[styles.modeTitle, { color: options.availableFulfillmentTypes.includes('PICKUP') ? tokens.textPrimary : tokens.textDisabled }]}>Retirada</Text>
          <Text style={[styles.modeSubtitle, { color: tokens.textMuted }]}>Busque na loja</Text>
        </Pressable>
      </View>

      {/* Delivery mode */}
      {viewMode === 'delivery' && (
        <View style={styles.panel}>
          <Text style={[styles.panelTitle, { color: tokens.textPrimary }]}>Selecione um endereço</Text>

          {options.availableAddresses.length === 0 ? (
            <View style={styles.emptyPanel}>
              <Text style={[styles.emptyText, { color: tokens.textMuted }]}>Nenhum endereço cadastrado.</Text>
            </View>
          ) : (
            options.availableAddresses.map((addr) => (
              <Pressable
                key={addr.id}
                style={[styles.addressOption, { backgroundColor: tokens.surfaceElevated, borderColor: tokens.border }]}
                onPress={() => handleSelectDelivery(addr.id)}
                disabled={submitting}
                testID={`select-address-${addr.id}`}
              >
                <View style={styles.addressOptionHeader}>
                  <Text style={[styles.addressOptionLabel, { color: tokens.textPrimary }]}>{addr.label}</Text>
                  {addr.isDefault && (
                    <View style={[styles.defaultBadge, { backgroundColor: tokens.accent }]}>
                      <Text style={[styles.defaultBadgeText, { color: tokens.textInverse }]}>Padrão</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.addressOptionCity, { color: tokens.textMuted }]}>
                  {addr.city}/{addr.state}
                </Text>
              </Pressable>
            ))
          )}

          <Pressable style={[styles.addAddressButton, { borderColor: tokens.accent }]} onPress={handleAddAddress} testID="add-address">
            <Text style={[styles.addAddressButtonText, { color: tokens.accent }]}>+ Adicionar novo endereço</Text>
          </Pressable>

          {options.availableAddresses.length > 0 && (
            <Pressable style={[styles.editAddressButton, { borderColor: tokens.border }]} onPress={() => {
              const defaultAddr = options.availableAddresses.find((a) => a.isDefault);
              if (defaultAddr) handleEditAddress(defaultAddr.id);
            }} testID="edit-address">
              <Text style={[styles.editAddressButtonText, { color: tokens.textMuted }]}>Editar endereço</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Pickup mode */}
      {viewMode === 'pickup' && (
        <View style={styles.panel}>
          <Text style={[styles.panelTitle, { color: tokens.textPrimary }]}>Selecione uma loja</Text>

          {options.pickupStores.length === 0 || !options.pickupStores.some((s) => s.availabilityStatus === 'AVAILABLE') ? (
            <View style={styles.emptyPanel}>
              <Text style={[styles.emptyText, { color: tokens.textMuted }]}>
                Nenhuma loja possui estoque suficiente para todo o carrinho.
              </Text>
              <Text style={[styles.emptySubtext, { color: tokens.textMuted }]}>
                O estoque será confirmado antes do pedido.
              </Text>
            </View>
          ) : (
            options.pickupStores
              .filter((s) => s.availabilityStatus === 'AVAILABLE')
              .map((store) => (
                <Pressable
                  key={store.id}
                  style={[
                    styles.storeOption,
                    { backgroundColor: tokens.surfaceElevated, borderColor: store.recommended ? tokens.accent : tokens.border },
                  ]}
                  onPress={() => handleSelectPickup(store.id)}
                  disabled={submitting}
                  testID={`select-store-${store.id}`}
                >
                  {store.recommended && (
                    <View style={[styles.recommendedBadge, { backgroundColor: tokens.accent }]}>
                      <Text style={[styles.recommendedBadgeText, { color: tokens.textInverse }]}>Recomendado</Text>
                    </View>
                  )}
                  <Text style={[styles.storeName, { color: tokens.textPrimary }]}>{store.name}</Text>
                  <Text style={[styles.storeAddress, { color: tokens.textMuted }]}>{store.addressSummary}</Text>
                  <Text style={[styles.storeCity, { color: tokens.textMuted }]}>{store.city}/{store.state}</Text>
                  {store.distanceKm !== null && (
                    <Text style={[styles.storeDistance, { color: tokens.textMuted }]}>~{store.distanceKm.toFixed(1)} km</Text>
                  )}
                </Pressable>
              ))
          )}
        </View>
      )}

      {/* Inline error */}
      {error ? (
        <View style={[styles.errorInline, { backgroundColor: tokens.errorSurface }]}>
          <Text style={[styles.errorInlineText, { color: tokens.error }]}>{error}</Text>
        </View>
      ) : null}

      {/* Submitting indicator */}
      {submitting && (
        <View style={styles.submittingRow}>
          <ActivityIndicator size="small" color={tokens.accent} />
          <Text style={[styles.submittingText, { color: tokens.textMuted }]}>Processando...</Text>
        </View>
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
  centerSubtext: { marginTop: 8, fontSize: 14 },
  errorSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  errorBody: { fontSize: 14, textAlign: 'center', marginBottom: 24 },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderRadius: 6 },
  retryText: { fontSize: 14, fontWeight: '600' },
  sectionTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 2, marginBottom: 20 },
  modeRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  modeCard: { flex: 1, padding: 20, borderRadius: 12, borderWidth: 1.5, alignItems: 'center' },
  modeIcon: { fontSize: 24, marginBottom: 8 },
  modeTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  modeSubtitle: { fontSize: 12 },
  panel: { marginBottom: 16 },
  panelTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  emptyPanel: { padding: 24, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center', marginBottom: 4 },
  emptySubtext: { fontSize: 12, textAlign: 'center' },
  addressOption: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  addressOptionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  addressOptionLabel: { fontSize: 14, fontWeight: '600' },
  defaultBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
  defaultBadgeText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  addressOptionCity: { fontSize: 12 },
  addAddressButton: { paddingVertical: 10, borderWidth: 1, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  addAddressButtonText: { fontSize: 14, fontWeight: '600' },
  editAddressButton: { paddingVertical: 10, borderWidth: 1, borderRadius: 8, alignItems: 'center', marginTop: 8 },
  editAddressButtonText: { fontSize: 13 },
  storeOption: { padding: 14, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  recommendedBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginBottom: 6 },
  recommendedBadgeText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  storeName: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  storeAddress: { fontSize: 12, marginBottom: 2 },
  storeCity: { fontSize: 12 },
  storeDistance: { fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  summaryCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  totalsCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  totalLabel: { fontSize: 14 },
  totalValue: { fontSize: 14, fontWeight: '500' },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 12, marginTop: 4, borderTopWidth: 1 },
  grandTotalLabel: { fontSize: 16, fontWeight: '600' },
  grandTotalValue: { fontSize: 16, fontWeight: '700' },
  blockingCard: { padding: 12, borderRadius: 8, marginBottom: 12 },
  blockingText: { fontSize: 13, marginBottom: 4 },
  noteCard: { padding: 12, borderRadius: 8, marginBottom: 16 },
  noteText: { fontSize: 12, lineHeight: 18 },
  createdCard: { padding: 24, borderRadius: 12, alignItems: 'center', marginBottom: 16 },
  createdSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  createdTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  createdBody: { fontSize: 14, textAlign: 'center' },
  infoCard: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 16 },
  infoSectionTitle: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  infoLabel: { fontSize: 13 },
  infoValue: { fontSize: 13, fontWeight: '500' },
  primaryButton: { paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginBottom: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: '600' },
  secondaryButton: { paddingVertical: 12, borderWidth: 1, borderRadius: 8, alignItems: 'center', marginBottom: 8 },
  secondaryButtonText: { fontSize: 14, fontWeight: '600' },
  backButton: { paddingVertical: 12, borderWidth: 1, borderRadius: 8, alignItems: 'center' },
  backButtonText: { fontSize: 14, fontWeight: '600' },
  errorInline: { padding: 12, borderRadius: 8, marginBottom: 12 },
  errorInlineText: { fontSize: 13, fontWeight: '500' },
  submittingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 8 },
  submittingText: { fontSize: 13 },
  idempotencyNote: { fontSize: 11, textAlign: 'center', marginTop: 8 },
  stockAlertCard: { padding: 20, borderRadius: 12, alignItems: 'center', width: '100%' },
  stockAlertIcon: { fontSize: 40, marginBottom: 12, fontWeight: '300' },
  stockAlertTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  stockAlertBody: { fontSize: 14, textAlign: 'center' },
});
