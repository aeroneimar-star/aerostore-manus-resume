import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { useAppTheme, theme } from '@/theme';
import { createAddressClient } from '@/address/client';
import { AddressClientError } from '@/address/AddressClientError';
import type { Address } from '@/address/contracts';

type FormState = 'loading' | 'ready' | 'saving' | 'error';

const CEP_REGEX = /^\d{8}$/;
const CEP_DISPLAY_REGEX = /^(\d{5})-?(\d{3})$/;

function formatCep(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length <= 5) return digits;
  return digits.slice(0, 5) + '-' + digits.slice(5, 8);
}

function unformatCep(displayed: string): string {
  return displayed.replace(/\D/g, '');
}

export function AddressFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ addressId?: string; addressJson?: string }>();
  const { tokens } = useAppTheme();
  const client = createAddressClient();

  const [formState, setFormState] = useState<FormState>('ready');
  const [error, setError] = useState<string>('');
  const [cepLoading, setCepLoading] = useState(false);

  // Form fields
  const [label, setLabel] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [street, setStreet] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');

  // Existing address for edit mode
  const [existingVersion, setExistingVersion] = useState<number>(0);

  useEffect(() => {
    if (params.addressId && params.addressJson) {
      try {
        const addr = JSON.parse(params.addressJson) as Address;
        setLabel(addr.label || '');
        setRecipientName(addr.recipientName || '');
        setPostalCode(addr.postalCode?.replace('-', '') || '');
        setStreet(addr.street || '');
        setNumber(addr.number || '');
        setComplement(addr.complement || '');
        setNeighborhood(addr.neighborhood || '');
        setCity(addr.city || '');
        setState(addr.state || '');
        setDeliveryInstructions(addr.deliveryInstructions || '');
        setExistingVersion(addr.version || 0);
      } catch {
        setError('Erro ao carregar endereco.');
      }
    }
  }, [params.addressId, params.addressJson]);

  const handleCepLookup = useCallback(async () => {
    const digits = unformatCep(postalCode);
    if (digits.length !== 8) {
      setError('CEP deve ter 8 digitos.');
      return;
    }
    setCepLoading(true);
    setError('');
    try {
      const response = await client.lookupPostalCode(digits);
      if (response.data.found) {
        setStreet(response.data.street);
        setNeighborhood(response.data.neighborhood);
        setCity(response.data.city);
        setState(response.data.state);
      }
      // If not found, manual entry is allowed
    } catch {
      // Allow manual entry on failure
    } finally {
      setCepLoading(false);
    }
  }, [postalCode]);

  const handleSave = useCallback(async () => {
    if (!recipientName.trim()) { setError('Nome e obrigatorio.'); return; }
    if (unformatCep(postalCode).length !== 8) { setError('CEP e obrigatorio (8 digitos).'); return; }
    if (!street.trim()) { setError('Logradouro e obrigatorio.'); return; }
    if (!number.trim()) { setError('Numero e obrigatorio.'); return; }
    if (!neighborhood.trim()) { setError('Bairro e obrigatorio.'); return; }
    if (!city.trim()) { setError('Cidade e obrigatorio.'); return; }
    if (!state.trim()) { setError('Estado e obrigatorio.'); return; }

    setFormState('saving');
    setError('');
    try {
      const digits = unformatCep(postalCode);
      const payload = {
        recipient_name: recipientName.trim(),
        postal_code: digits,
        street: street.trim(),
        number: number.trim(),
        complement: complement.trim() || undefined,
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim(),
        label: label.trim() || undefined,
        delivery_instructions: deliveryInstructions.trim() || undefined,
      };

      if (params.addressId) {
        await client.updateAddress(params.addressId, { ...payload, expectedVersion: existingVersion || undefined });
      } else {
        await client.createAddress(payload);
      }
      router.back();
    } catch (err) {
      const addrError = err instanceof AddressClientError ? err : new AddressClientError('INTERNAL_ERROR', 'Erro ao salvar endereco.');
      if (addrError.code === 'ADDRESS_VERSION_CONFLICT') {
        setError('Este endereco foi modificado. Recarregue e tente novamente.');
      } else {
        setError(addrError.message);
      }
      setFormState('ready');
    }
  }, [params.addressId, recipientName, postalCode, street, number, complement, neighborhood, city, state, label, deliveryInstructions, existingVersion]);

  const inputStyle = [styles.input, { backgroundColor: tokens.inputBackground, borderColor: tokens.inputBorder, color: tokens.textPrimary }];

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: tokens.background }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} testID="address-form-screen">
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={[styles.headerTitle, { color: tokens.textPrimary }]}>
            {params.addressId ? 'Editar Endereco' : 'Novo Endereco'}
          </Text>
        </View>

        {/* Label */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Apelido (opcional)</Text>
          <TextInput style={inputStyle} value={label} onChangeText={setLabel} placeholder="Ex: Casa, Trabalho" placeholderTextColor={tokens.inputPlaceholder} testID="input-label" />
        </View>

        {/* Nome */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Nome completo *</Text>
          <TextInput style={inputStyle} value={recipientName} onChangeText={setRecipientName} placeholder="Nome do destinatario" placeholderTextColor={tokens.inputPlaceholder} testID="input-name" />
        </View>

        {/* CEP */}
        <View style={styles.fieldGroup}>
          <View style={styles.cepRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>CEP *</Text>
              <TextInput
                style={inputStyle}
                value={formatCep(postalCode)}
                onChangeText={(text) => setPostalCode(unformatCep(text))}
                placeholder="00000-000"
                placeholderTextColor={tokens.inputPlaceholder}
                keyboardType="numeric"
                maxLength={9}
                testID="input-cep"
              />
            </View>
            <Pressable
              style={[styles.cepButton, { borderColor: tokens.accent }, cepLoading && { opacity: 0.5 }]}
              onPress={handleCepLookup}
              disabled={cepLoading}
              testID="cep-lookup"
            >
              {cepLoading ? (
                <ActivityIndicator size="small" color={tokens.accent} />
              ) : (
                <Text style={[styles.cepButtonText, { color: tokens.accent }]}>Buscar</Text>
              )}
            </Pressable>
          </View>
        </View>

        {/* Logradouro */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Logradouro *</Text>
          <TextInput style={inputStyle} value={street} onChangeText={setStreet} placeholder="Rua, Avenida..." placeholderTextColor={tokens.inputPlaceholder} testID="input-street" />
        </View>

        {/* Numero + Complemento */}
        <View style={styles.row}>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Numero *</Text>
            <TextInput style={inputStyle} value={number} onChangeText={setNumber} placeholder="N" placeholderTextColor={tokens.inputPlaceholder} keyboardType="numeric" testID="input-number" />
          </View>
          <View style={[styles.fieldGroup, { flex: 2 }]}>
            <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Complemento</Text>
            <TextInput style={inputStyle} value={complement} onChangeText={setComplement} placeholder="Apto, Bloco..." placeholderTextColor={tokens.inputPlaceholder} testID="input-complement" />
          </View>
        </View>

        {/* Bairro */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Bairro *</Text>
          <TextInput style={inputStyle} value={neighborhood} onChangeText={setNeighborhood} placeholder="Bairro" placeholderTextColor={tokens.inputPlaceholder} testID="input-neighborhood" />
        </View>

        {/* Cidade + Estado */}
        <View style={styles.row}>
          <View style={[styles.fieldGroup, { flex: 3 }]}>
            <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Cidade *</Text>
            <TextInput style={inputStyle} value={city} onChangeText={setCity} placeholder="Cidade" placeholderTextColor={tokens.inputPlaceholder} testID="input-city" />
          </View>
          <View style={[styles.fieldGroup, { flex: 1 }]}>
            <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>UF *</Text>
            <TextInput style={inputStyle} value={state} onChangeText={setState} placeholder="SP" placeholderTextColor={tokens.inputPlaceholder} maxLength={2} testID="input-state" />
          </View>
        </View>

        {/* Instrucoes */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Instrucoes para entrega</Text>
          <TextInput
            style={[styles.input, styles.textArea, { backgroundColor: tokens.inputBackground, borderColor: tokens.inputBorder, color: tokens.textPrimary }]}
            value={deliveryInstructions}
            onChangeText={setDeliveryInstructions}
            placeholder="Ex: Portao azul, tocar campainha..."
            placeholderTextColor={tokens.inputPlaceholder}
            multiline
            numberOfLines={3}
            testID="input-instructions"
          />
        </View>

        {/* Error */}
        {error ? (
          <View style={[styles.errorContainer, { backgroundColor: tokens.errorSurface }]}>
            <Text style={[styles.errorText, { color: tokens.error }]}>{error}</Text>
          </View>
        ) : null}

        {/* Save button */}
        <Pressable
          style={[styles.saveButton, { backgroundColor: formState === 'saving' ? tokens.buttonDisabled : tokens.accent }]}
          onPress={handleSave}
          disabled={formState === 'saving'}
          testID="address-save"
        >
          {formState === 'saving' ? (
            <ActivityIndicator size="small" color={tokens.textInverse} />
          ) : (
            <Text style={[styles.saveButtonText, { color: tokens.textInverse }]}>Salvar endereco</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 80 },
  header: { marginBottom: 24 },
  headerTitle: { fontSize: 20, fontWeight: '700', letterSpacing: 2 },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '500', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { height: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: 8, fontSize: 15 },
  textArea: { height: 80, textAlignVertical: 'top', paddingTop: 10 },
  row: { flexDirection: 'row', gap: 12 },
  cepRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  cepButton: { height: 44, paddingHorizontal: 16, borderWidth: 1, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginBottom: 0 },
  cepButtonText: { fontSize: 13, fontWeight: '600' },
  errorContainer: { padding: 12, borderRadius: 8, marginBottom: 16 },
  errorText: { fontSize: 13, fontWeight: '500' },
  saveButton: { height: 50, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  saveButtonText: { fontSize: 15, fontWeight: '600' },
});
