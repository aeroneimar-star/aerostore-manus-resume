import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useAuthStyles } from './authStyles';

export function OtpVerificationScreen({ channel, phoneMasked, resendAfter = 0, smsSupported = true, smsAvailableAfter = 0, smsAvailable, loading, error, onVerify, onResend, onSms }: { channel: 'WHATSAPP' | 'SMS'; phoneMasked?: string; resendAfter?: number; smsSupported?: boolean; smsAvailableAfter?: number; smsAvailable: boolean; loading: boolean; error?: string; onVerify(code: string): void; onResend(): void; onSms(): void }) {
  const s = useAuthStyles();
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(resendAfter);
  const [smsIn, setSmsIn] = useState(smsAvailableAfter);
  const valid = /^\d{6}$/.test(code);

  useEffect(() => {
    if (resendIn <= 0 && smsIn <= 0) return;
    const timer = setInterval(() => {
      setResendIn((value) => Math.max(0, value - 1));
      setSmsIn((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendIn > 0 || smsIn > 0]);

  return (
    <ScrollView style={s.page} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.card}>
        <Text style={s.eyebrow}>CONFIRMAÇÃO SEGURA</Text>
        <Text style={s.title}>Digite o código.</Text>
        <Text style={s.description}>Enviamos para {phoneMasked || 'seu telefone'} pelo {channel === 'SMS' ? 'SMS' : 'WhatsApp'}. Ele expira em 5 minutos.</Text>
        <TextInput
          accessibilityLabel="Código de seis dígitos"
          autoComplete="one-time-code"
          keyboardType="number-pad"
          maxLength={6}
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          style={[s.input, s.otp]}
        />
        {error ? <Text accessibilityRole="alert" style={s.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={!valid || loading}
          onPress={() => onVerify(code)}
          style={[s.button, (!valid || loading) && s.buttonMuted]}
        >
          {loading ? (
            <ActivityIndicator color={s.buttonText.color as string} />
          ) : (
            <Text style={s.buttonText}>Confirmar código</Text>
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={loading || resendIn > 0}
          onPress={onResend}
          style={[s.button, s.secondary, (loading || resendIn > 0) && s.buttonMuted]}
        >
          <Text style={[s.buttonText, s.secondaryText]}>
            {resendIn > 0 ? `Reenviar em ${resendIn}s` : 'Reenviar pelo WhatsApp'}
          </Text>
        </Pressable>
        {smsSupported && (smsAvailable || smsIn === 0) ? (
          <Pressable
            accessibilityRole="button"
            disabled={loading}
            onPress={onSms}
            style={[s.button, s.secondary, loading && s.buttonMuted]}
          >
            <Text style={[s.buttonText, s.secondaryText]}>Receber por SMS</Text>
          </Pressable>
        ) : smsSupported ? (
          <Text style={s.helper}>SMS disponível em {smsIn}s se o WhatsApp demorar.</Text>
        ) : (
          <Text style={s.helper}>SMS indisponível agora. Continue pelo WhatsApp.</Text>
        )}
        <Text style={s.helper}>Por segurança, nunca compartilhe este código.</Text>
      </View>
    </ScrollView>
  );
}
