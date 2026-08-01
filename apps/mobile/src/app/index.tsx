import { useEffect, useState } from 'react';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { appAuthClient } from '@/app-auth/AppAuthClient';
import type { OtpChallenge, VerifiedAccess } from '@/app-auth/contracts';
import { sessionStorage } from '@/app-auth/SessionStorage';
import { OtpVerificationScreen } from '@/screens/OtpVerificationScreen';
import { PhoneEntryScreen } from '@/screens/PhoneEntryScreen';
import { SessionExpiredScreen } from '@/screens/SessionExpiredScreen';
import { SessionSplashScreen } from '@/screens/SessionSplashScreen';

type Phase = 'BOOT' | 'PHONE' | 'OTP' | 'EXPIRED';

export default function IndexRoute() {
  const router = useRouter(); const params = useLocalSearchParams<{ expired?: string }>();
  const [phase, setPhase] = useState<Phase>('BOOT'); const [deviceId, setDeviceId] = useState(''); const [challenge, setChallenge] = useState<OtpChallenge>(); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  useEffect(() => { void (async () => { const id = await sessionStorage.getOrCreateDeviceId(); setDeviceId(id); if (params.expired === '1') { setPhase('EXPIRED'); return; } const stored = await sessionStorage.load(); if (stored) router.replace('/access-status' as Href); else setPhase('PHONE'); })(); }, [params.expired, router]);
  const perform = async (task: () => Promise<void>) => { setLoading(true); setError(''); try { await task(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível concluir agora.'); } finally { setLoading(false); } };
  const saveTokens = async (tokens: VerifiedAccess) => { await sessionStorage.save({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken }); router.replace('/access-status' as Href); };
  if (phase === 'BOOT') return <SessionSplashScreen />;
  if (phase === 'EXPIRED') return <SessionExpiredScreen onLogin={() => { setPhase('PHONE'); router.replace('/'); }} />;
  if (phase === 'OTP' && challenge) return <OtpVerificationScreen channel={challenge.channel} phoneMasked={challenge.phoneMasked} resendAfter={challenge.resendAfter} smsSupported={challenge.smsSupported} smsAvailableAfter={challenge.smsAvailableAfter} smsAvailable={challenge.smsAvailable} loading={loading} error={error} onVerify={(code) => perform(async () => saveTokens(await appAuthClient.verify(challenge.challengeId, code, deviceId)))} onResend={() => perform(async () => setChallenge(await appAuthClient.resend(challenge.challengeId, deviceId)))} onSms={() => perform(async () => setChallenge(await appAuthClient.sms(challenge.challengeId, deviceId)))} />;
  return <PhoneEntryScreen loading={loading} error={error} onContinue={(phone) => perform(async () => { setChallenge(await appAuthClient.start(phone, deviceId)); setPhase('OTP'); })} />;
}
