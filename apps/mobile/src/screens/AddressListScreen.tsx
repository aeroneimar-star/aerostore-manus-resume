import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme, theme } from '@/theme';
import { createAddressClient } from '@/address/client';
import { AddressClientError } from '@/address/AddressClientError';
import type { Address } from '@/address/contracts';

type ScreenState = 'loading' | 'empty' | 'ready' | 'error';

export function AddressListScreen() {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const client = createAddressClient();
  const [state, setState] = useState<ScreenState>('loading');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [message, setMessage] = useState<string>('');

  const loadAddresses = useCallback(async () => {
    setState('loading');
    try {
      const response = await client.listAddresses();
      if (Array.isArray(response.data) && response.data.length === 0) {
        setState('empty');
        setAddresses([]);
        return;
      }
      setAddresses(response.data as Address[]);
      setState('ready');
    } catch (error) {
      const addrError = error instanceof AddressClientError ? error : new AddressClientError('INTERNAL_ERROR', 'Erro ao carregar enderecos.');
      setMessage(addrError.message);
      setState('error');
    }
  }, []);

  useEffect(() => { void loadAddresses(); }, [loadAddresses]);

  const handleAdd = () => router.navigate('/address-form');

  const handleEdit = (address: Address) => {
    router.navigate({ pathname: '/address-form', params: { addressId: address.id, addressJson: JSON.stringify(address) } });
  };

  const handleArchive = useCallback(async (addressId: string) => {
    try {
      await client.archiveAddress(addressId);
      setAddresses((prev) => prev.filter((a) => a.id !== addressId));
    } catch {
      // Silently fail — refresh on next load
    }
  }, []);

  const handleSetDefault = useCallback(async (addressId: string) => {
    try {
      const response = await client.setDefaultAddress(addressId);
      setAddresses((prev) => prev.map((a) => ({ ...a, isDefault: a.id === addressId })));
    } catch {
      // Silently fail
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Address }) => (
      <Pressable
        style={[styles.addressCard, { backgroundColor: tokens.surface, borderColor: item.isDefault ? tokens.accent : tokens.border }]}
        onPress={() => handleEdit(item)}
        testID={`address-${item.id}`}
      >
        <View style={styles.addressHeader}>
          <View style={styles.labelRow}>
            <Text style={[styles.addressLabel, { color: tokens.textPrimary }]}>{item.label || 'Endereco'}</Text>
            {item.isDefault && (
              <View style={[styles.defaultBadge, { backgroundColor: tokens.accent }]}>
                <Text style={[styles.defaultBadgeText, { color: tokens.textInverse }]}>Padrao</Text>
              </View>
            )}
          </View>
          <Text style={[styles.addressRecipient, { color: tokens.textSecondary }]}>{item.recipientName}</Text>
        </View>
        <View style={styles.addressBody}>
          <Text style={[styles.addressLine, { color: tokens.textMuted }]}>
            {item.street}, {item.number}
            {item.complement ? ` - ${item.complement}` : ''}
          </Text>
          <Text style={[styles.addressLine, { color: tokens.textMuted }]}>
            {item.neighborhood} - {item.city}/{item.state}
          </Text>
          <Text style={[styles.addressLine, { color: tokens.textMuted }]}>CEP: {item.postalCode}</Text>
        </View>
        <View style={styles.addressActions}>
          {!item.isDefault && (
            <Pressable
              style={[styles.actionButton, { borderColor: tokens.accent }]}
              onPress={() => handleSetDefault(item.id)}
              testID={`set-default-${item.id}`}
            >
              <Text style={[styles.actionButtonText, { color: tokens.accent }]}>Tornar padrao</Text>
            </Pressable>
          )}
          <Pressable
            style={[styles.actionButton, { borderColor: tokens.error }]}
            onPress={() => handleArchive(item.id)}
            testID={`archive-${item.id}`}
          >
            <Text style={[styles.actionButtonText, { color: tokens.error }]}>Excluir</Text>
          </Pressable>
        </View>
      </Pressable>
    ),
    [handleSetDefault, handleArchive, tokens]
  );

  if (state === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={tokens.accent} />
          <Text style={[styles.loadingText, { color: tokens.textSecondary }]}>Carregando enderecos...</Text>
        </View>
      </View>
    );
  }

  if (state === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.stateContainer}>
          <Text style={[styles.stateSymbol, { color: tokens.accent }]}>!</Text>
          <Text style={[styles.stateTitle, { color: tokens.textPrimary }]}>Erro ao carregar enderecos</Text>
          <Text style={[styles.stateBody, { color: tokens.textMuted }]}>{message || 'Nao foi possivel carregar os enderecos.'}</Text>
          <Pressable style={[styles.retryButton, { borderColor: tokens.accent }]} onPress={loadAddresses} testID="address-retry">
            <Text style={[styles.retryText, { color: tokens.accent }]}>Tentar novamente</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (state === 'empty') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.stateContainer}>
          <Text style={[styles.stateSymbol, { color: tokens.accent }]}>+</Text>
          <Text style={[styles.stateTitle, { color: tokens.textPrimary }]}>Nenhum endereco cadastrado</Text>
          <Text style={[styles.stateBody, { color: tokens.textMuted }]}>
            Adicione um endereco para receber seus pedidos.
          </Text>
          <Pressable style={[styles.addButton, { backgroundColor: tokens.accent }]} onPress={handleAdd} testID="address-add-first">
            <Text style={[styles.addButtonText, { color: tokens.textInverse }]}>Adicionar endereco</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: tokens.background }]} testID="address-list-screen">
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: tokens.textPrimary }]}>Meus Enderecos</Text>
        <Text style={[styles.headerSubtitle, { color: tokens.textMuted }]}>
          {addresses.length} {addresses.length === 1 ? 'endereco' : 'enderecos'}
        </Text>
      </View>
      <FlatList
        data={addresses}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
      />
      <View style={[styles.footer, { borderTopColor: tokens.border }]}>
        <Pressable style={[styles.addButton, { backgroundColor: tokens.accent }]} onPress={handleAdd} testID="address-add">
          <Text style={[styles.addButtonText, { color: tokens.textInverse }]}>Novo endereco</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, fontSize: 14, opacity: 0.7 },
  stateContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  stateSymbol: { fontSize: 48, marginBottom: 16, fontWeight: '300' },
  stateTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  stateBody: { fontSize: 14, opacity: 0.7, textAlign: 'center', marginBottom: 24 },
  retryButton: { paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderRadius: 6 },
  retryText: { fontSize: 14, fontWeight: '600' },
  addButton: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 6 },
  addButtonText: { fontSize: 14, fontWeight: '600' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  headerTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 2 },
  headerSubtitle: { fontSize: 13, opacity: 0.6, marginTop: 2 },
  listContent: { padding: 16, paddingBottom: 100 },
  addressCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, overflow: 'hidden' },
  addressHeader: { marginBottom: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  addressLabel: { fontSize: 15, fontWeight: '600' },
  defaultBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
  defaultBadgeText: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  addressRecipient: { fontSize: 13 },
  addressBody: { marginBottom: 12 },
  addressLine: { fontSize: 13, lineHeight: 18, marginBottom: 2 },
  addressActions: { flexDirection: 'row', gap: 8 },
  actionButton: { paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderRadius: 6 },
  actionButtonText: { fontSize: 12, fontWeight: '500' },
  footer: { padding: 16, position: 'absolute', bottom: 0, left: 0, right: 0 },
});
