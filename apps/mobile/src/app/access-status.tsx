import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { appAuthClient, AppAuthClientError } from '@/app-auth/AppAuthClient';
import type { AccessSnapshot } from '@/app-auth/contracts';
import { closeLocalSession, MissingSessionError, withSessionRefresh } from '@/app-auth/SessionCoordinator';
import { sessionStorage } from '@/app-auth/SessionStorage';
import { AccessStatusScreen } from '@/screens/AccessStatusScreen';
import { SessionSplashScreen } from '@/screens/SessionSplashScreen';

export default function AccessStatusRoute() {
  const router = useRouter(); const [snapshot, setSnapshot] = useState<AccessSnapshot>(); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const credentials = useRef({ accessToken: '', deviceId: '' });
  const loadStatus = useCallback(async () => { setLoading(true); setError(''); try { const result = await withSessionRefresh((token, device) => appAuthClient.status(token, device)); credentials.current = { accessToken: result.accessToken, deviceId: result.deviceId }; setSnapshot(result.value); if (result.value.effectiveStatus === 'CLOSED') await sessionStorage.clear(); } catch (reason) { if (reason instanceof MissingSessionError || reason instanceof AppAuthClientError && reason.status === 401) { await sessionStorage.clear(); router.replace('/?expired=1'); return; } setError(reason instanceof Error ? reason.message : 'Não foi possível atualizar o status.'); } finally { setLoading(false); } }, [router]);
  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { const listener = AppState.addEventListener('change', (next: AppStateStatus) => { if (next === 'active') void loadStatus(); }); return () => listener.remove(); }, [loadStatus]);
  const logout = async () => { setLoading(true); await closeLocalSession(credentials.current.accessToken, credentials.current.deviceId); router.replace('/'); };
  if (!snapshot) return <SessionSplashScreen message={error || 'Consultando seu acesso…'} />;
  return <AccessStatusScreen snapshot={snapshot} loading={loading} error={error} onRefresh={() => void loadStatus()} onProfile={() => router.push('/profile' as Href)} onLogout={() => void logout()} onVerifyPhone={() => { void sessionStorage.clear(); router.replace('/'); }} />;
}
