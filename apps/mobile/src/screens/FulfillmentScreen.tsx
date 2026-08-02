import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme, theme } from '@/theme';
import { createFulfillmentClient } from '@/fulfillment/client';
import { FulfillmentClientError } from '@/fulfillment/FulfillmentClientError';
import { createAddressClient } from '@/address/client';
import type {
  CurrentFulfillment,
  DeliverySummary,
  FulfillmentOptions,
  FulfillmentType,
  PickupStore,
} from '@/fulfillment/contracts';

type ScreenState = 'loading' | 'ready' | 'error';
type ViewMode = 'select' | 'delivery' | 'pickup' | 'summary';

export function FulfillmentScreen() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const fulfillmentClient = createFulfillmentClient();
  const addressClient = createAddressClient();

  const [screenState, setScreenState] = useState<ScreenState>('loading');
  const [viewMode, setViewMode] = useState<ViewMode>('select');
  const [options, setOptions] = useState<FulfillmentOptions | null>(null);
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [error, setError] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const loadOptions = useCallback(async () => {
    setScreenState('loading');
    setError('');
    try {
      const response = await fulfillmentClient.getFulfillmentOptions();
      setOptions(response.data);
      setScreenState('ready');
    } catch (err) {
      const fError = err instanceof FulfillmentClientError ? err : new FulfillmentClientError('INTERNAL_ERROR', 'Erro ao carregar opcoes de entrega.');
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
        setError('A selecao foi alterada. Recarregando...');
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
        setError('A selecao foi alterada. Recarregando...');
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

  // Loading
  if (screenState === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={tokens.accent} />
          <Text style={[styles.centerText, { color: tokens.textSecondary }]}>Carregando opcoes de entrega...</Text>
        </View>
      </View>
    );
  }

  // Error
  if (screenState === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.centerContent}>
          <Text style={[styles.errorSymbol, { color: tokens.error }]}>!</Text>
          <Text style={[styles.errorTitle, { color: tokens.textPrimary }]}>Erro ao carregar opcoes</Text>
          <Text style={[styles.errorBody, { color: tokens.textMuted }]}>{error || 'Tente novamente em alguns instantes.'}</Text>
          <Pressable style={[styles.retryButton, { borderColor: tokens.accent }]} onPress={loadOptions} testID="fulfillment-retry">
            <Text style={[styles.retryText, { color: tokens.accent }]}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!options) return null;

  // Summary view
  if (viewMode === 'summary' && summary) {
    return (
      <ScrollView style={[styles.container, { backgroundColor: tokens.background }]} contentContainerStyle={styles.scrollContent} testID="fulfillment-summary-screen">
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
              <Text style={[styles.summaryLabel, { color: tokens.textSecondary }]}>Endereco</Text>
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
            O estoque sera confirmado antes do pedido. Nenhum pagamento sera processado agora.
          </Text>
        </View>

        <Pressable
          style={[styles.backButton, { borderColor: tokens.accent }]}
          onPress={() => setViewMode('select')}
          testID="fulfillment-change"
        >
          <Text style={[styles.backButtonText, { color: tokens.accent }]}>Alterar opcoes de entrega</Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Select mode
  return (
    <ScrollView style={[styles.container, { backgroundColor: tokens.background }]} contentContainerStyle={styles.scrollContent} testID="fulfillment-screen">
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
          <Text style={[styles.panelTitle, { color: tokens.textPrimary }]}>Selecione um endereco</Text>

          {options.availableAddresses.length === 0 ? (
            <View style={styles.emptyPanel}>
              <Text style={[styles.emptyText, { color: tokens.textMuted }]}>Nenhum endereco cadastrado.</Text>
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
                      <Text style={[styles.defaultBadgeText, { color: tokens.textInverse }]}>Padrao</Text>
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
            <Text style={[styles.addAddressButtonText, { color: tokens.accent }]}>+ Adicionar novo endereco</Text>
          </Pressable>

          {options.availableAddresses.length > 0 && (
            <Pressable style={[styles.editAddressButton, { borderColor: tokens.border }]} onPress={() => {
              const defaultAddr = options.availableAddresses.find((a) => a.isDefault);
              if (defaultAddr) handleEditAddress(defaultAddr.id);
            }} testID="edit-address">
              <Text style={[styles.editAddressButtonText, { color: tokens.textMuted }]}>Editar endereco</Text>
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
                O estoque sera confirmado antes do pedido.
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
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  centerText: { marginTop: 16, fontSize: 14, opacity: 0.7 },
  errorSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  errorTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  errorBody: { fontSize: 14, opacity: 0.7, textAlign: 'center', marginBottom: 24 },
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
  emptySubtext: { fontSize: 12, textAlign: 'center', opacity: 0.7 },
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
  backButton: { paddingVertical: 12, borderWidth: 1, borderRadius: 8, alignItems: 'center' },
  backButtonText: { fontSize: 14, fontWeight: '600' },
  errorInline: { padding: 12, borderRadius: 8, marginBottom: 12 },
  errorInlineText: { fontSize: 13, fontWeight: '500' },
  submittingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 8 },
  submittingText: { fontSize: 13 },
});
