import { useCallback, useEffect, useRef, useState } from 'react';
import { type Href, useRouter } from 'expo-router';
import { appAuthClient, AppAuthClientError } from '@/app-auth/AppAuthClient';
import type { CustomerProfile, ProfileUpdate } from '@/app-auth/contracts';
import { closeLocalSession, MissingSessionError, withSessionRefresh } from '@/app-auth/SessionCoordinator';
import { sessionStorage } from '@/app-auth/SessionStorage';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { SessionSplashScreen } from '@/screens/SessionSplashScreen';

export default function ProfileRoute() {
  const router = useRouter(); const [profile, setProfile] = useState<CustomerProfile>(); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [success, setSuccess] = useState(''); const credentials = useRef({ accessToken: '', deviceId: '' });
  const handleSessionFailure = useCallback(async (reason: unknown) => { if (reason instanceof MissingSessionError || reason instanceof AppAuthClientError && reason.status === 401) { await sessionStorage.clear(); router.replace('/?expired=1'); return true; } return false; }, [router]);
  const load = useCallback(async () => { setLoading(true); setError(''); try { const result = await withSessionRefresh((token, device) => appAuthClient.profile(token, device)); credentials.current = { accessToken: result.accessToken, deviceId: result.deviceId }; setProfile(result.value); } catch (reason) { if (!await handleSessionFailure(reason)) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar seu perfil.'); } finally { setLoading(false); } }, [handleSessionFailure]);
  useEffect(() => { void load(); }, [load]);
  const save = async (input: ProfileUpdate) => { setLoading(true); setError(''); setSuccess(''); try { const result = await withSessionRefresh((token, device) => appAuthClient.updateProfile(token, device, input)); credentials.current = { accessToken: result.accessToken, deviceId: result.deviceId }; setProfile(result.value); setSuccess('Perfil atualizado com segurança.'); } catch (reason) { if (!await handleSessionFailure(reason)) setError(reason instanceof Error ? reason.message : 'Não foi possível salvar seu perfil.'); } finally { setLoading(false); } };
  const logout = async () => { setLoading(true); await closeLocalSession(credentials.current.accessToken, credentials.current.deviceId); router.replace('/'); };
  if (!profile) return <SessionSplashScreen message={error || 'Carregando seu perfil…'} />;
  return <ProfileScreen profile={profile} loading={loading} error={error} success={success} onSave={(input) => void save(input)} onCancel={() => router.replace('/access-status' as Href)} onLogout={() => void logout()} />;
}
