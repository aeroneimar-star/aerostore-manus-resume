import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { useAppTheme } from '@/theme';
import { appAuthClient } from '@/app-auth/AppAuthClient';
import { sessionStorage } from '@/app-auth/SessionStorage';

type AllowedStatus = 'APPROVED' | 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'BLOCKED';

interface AccessStatusGuardProps {
  children: React.ReactNode;
  allowed: AllowedStatus[];
}

export function AccessStatusGuard({ children, allowed }: AccessStatusGuardProps) {
  const router = useRouter();
  const { tokens } = useAppTheme();
  const [status, setStatus] = useState<'checking' | 'granted' | 'denied' | 'expired'>('checking');
  const [userStatus, setUserStatus] = useState<string>('');

  useEffect(() => {
    void (async () => {
      try {
        const stored = await sessionStorage.load();
        if (!stored) {
          setStatus('expired');
          return;
        }
        const profile = await appAuthClient.getProfile(stored.accessToken);
        const accessStatus = profile.data.accessStatus || 'PENDING';
        setUserStatus(accessStatus);
        if (allowed.includes(accessStatus as AllowedStatus)) {
          setStatus('granted');
        } else {
          setStatus('denied');
        }
      } catch (error: unknown) {
        const err = error as { status?: number };
        if (err.status === 401) {
          setStatus('expired');
        } else {
          setStatus('denied');
        }
      }
    })();
  }, [allowed]);

  if (status === 'checking') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <ActivityIndicator size="large" color={tokens.accent} />
      </View>
    );
  }

  if (status === 'expired') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.messageContainer}>
          <Text style={[styles.symbol, { color: tokens.accent }]}>!</Text>
          <Text style={[styles.title, { color: tokens.textPrimary }]}>Sessao expirada</Text>
          <Text style={[styles.body, { color: tokens.textMuted }]}>Faca login novamente para continuar.</Text>
          <Pressable
            style={[styles.button, { backgroundColor: tokens.accent }]}
            onPress={() => router.navigate('/')}
            testID="access-expired-login"
          >
            <Text style={[styles.buttonText, { color: tokens.textInverse }]}>Fazer login</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (status === 'denied') {
    return (
      <View style={[styles.container, { backgroundColor: tokens.background }]}>
        <View style={styles.messageContainer}>
          <Text style={[styles.symbol, { color: tokens.error }]}>!</Text>
          <Text style={[styles.title, { color: tokens.textPrimary }]}>Acesso restrito</Text>
          <Text style={[styles.body, { color: tokens.textMuted }]}>
            Seu acesso esta em status: {userStatus}
          </Text>
          <Pressable
            style={[styles.button, { backgroundColor: tokens.accent }]}
            onPress={() => router.navigate('/')}
            testID="access-denied-back"
          >
            <Text style={[styles.buttonText, { color: tokens.textInverse }]}>Voltar</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  messageContainer: { alignItems: 'center', paddingHorizontal: 32 },
  symbol: { fontSize: 48, marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 8, textAlign: 'center' },
  body: { fontSize: 14, textAlign: 'center', marginBottom: 24, opacity: 0.7 },
  button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 6 },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
