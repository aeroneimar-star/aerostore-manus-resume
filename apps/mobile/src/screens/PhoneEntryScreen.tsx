import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useWebFocusVisible, webFocusVisibleStyle } from '@/accessibility/useWebFocusVisible';
import { useAuthStyles } from './authStyles';

export function PhoneEntryScreen({ loading, error, onContinue }: { loading: boolean; error?: string; onContinue(phone: string): void }) {
  const s = useAuthStyles();
  const [phone, setPhone] = useState('');
  const focus = useWebFocusVisible();
  const valid = phone.replace(/\D/g, '').length >= 10;
  return (
    <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.eyebrow}>AEROSTORE</Text>
        <Text style={s.title}>Seu acesso começa por aqui.</Text>
        <Text style={s.description}>Informe seu WhatsApp para receber um código seguro de seis dígitos.</Text>
        <Text style={s.label}>WhatsApp</Text>
        <TextInput
          accessibilityLabel="Número de WhatsApp"
          autoComplete="tel"
          keyboardType="phone-pad"
          placeholder="(11) 99999-9999"
          placeholderTextColor={s.input.placeholderTextColor as string}
          value={phone}
          onChangeText={setPhone}
          style={s.input}
        />
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        <Pressable
          accessibilityLabel="Receber código pelo WhatsApp"
          accessibilityRole="button"
          accessibilityState={{ disabled: !valid || loading }}
          disabled={!valid || loading}
          onPress={() => onContinue(phone)}
          onFocus={focus.onFocus}
          onBlur={focus.onBlur}
          style={[s.button, (!valid || loading) && s.buttonMuted, focus.focusVisible && webFocusVisibleStyle]}
        >
          {loading ? (
            <ActivityIndicator accessibilityLabel="Enviando código" color={s.buttonText.color as string} />
          ) : (
            <Text style={s.buttonText}>Receber código pelo WhatsApp</Text>
          )}
        </Pressable>
        <Text style={s.helper}>Usaremos este número somente para confirmar sua identidade e consultar o status de acesso.</Text>
      </View>
    </ScrollView>
  );
}
