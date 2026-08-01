import { useEffect, useState } from 'react';
import { appAuthClient, AppAuthClientError } from '@/app-auth/AppAuthClient';
import type { AccessStatus, OtpChallenge, VerifiedAccess } from '@/app-auth/contracts';
import { sessionStorage } from '@/app-auth/SessionStorage';
import { AccessStatusScreen } from '@/screens/AccessStatusScreen';
import { OtpVerificationScreen } from '@/screens/OtpVerificationScreen';
import { PhoneEntryScreen } from '@/screens/PhoneEntryScreen';
import { SessionExpiredScreen } from '@/screens/SessionExpiredScreen';
import { SessionSplashScreen } from '@/screens/SessionSplashScreen';

type Phase = 'BOOT' | 'PHONE' | 'OTP' | 'STATUS' | 'EXPIRED';

export default function IndexRoute() {
  const [phase,setPhase]=useState<Phase>('BOOT'); const [deviceId,setDeviceId]=useState(''); const [challenge,setChallenge]=useState<OtpChallenge>(); const [status,setStatus]=useState<AccessStatus>(); const [accessToken,setAccessToken]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const saveTokens=async(tokens:VerifiedAccess)=>{await sessionStorage.save({accessToken:tokens.accessToken,refreshToken:tokens.refreshToken});setAccessToken(tokens.accessToken);setStatus(tokens.accessStatus);};
  useEffect(()=>{void(async()=>{const id=await sessionStorage.getOrCreateDeviceId();setDeviceId(id);const stored=await sessionStorage.load();if(!stored){setPhase('PHONE');return;}try{const snapshot=await appAuthClient.status(stored.accessToken,id);setAccessToken(stored.accessToken);setStatus(snapshot.accessStatus);setPhase('STATUS');}catch(reason){if(reason instanceof AppAuthClientError&&reason.status===403&&reason.accessStatus){setAccessToken(stored.accessToken);setStatus(reason.accessStatus);setPhase('STATUS');return;}try{const refreshed=await appAuthClient.refresh(stored.refreshToken,id);await saveTokens(refreshed);setPhase('STATUS');}catch{await sessionStorage.clear();setPhase('EXPIRED');}}})()},[]);
  const perform=async(task:()=>Promise<void>)=>{setLoading(true);setError('');try{await task();}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível concluir agora.');}finally{setLoading(false);}};
  const logout=()=>perform(async()=>{try{if(accessToken)await appAuthClient.logout(accessToken,deviceId);}finally{await sessionStorage.clear();setAccessToken('');setStatus(undefined);setChallenge(undefined);setPhase('PHONE');}});
  if(phase==='BOOT')return <SessionSplashScreen/>;
  if(phase==='EXPIRED')return <SessionExpiredScreen onLogin={()=>setPhase('PHONE')}/>;
  if(phase==='STATUS'&&status)return <AccessStatusScreen status={status} loggingOut={loading} onLogout={logout}/>;
  if(phase==='OTP'&&challenge)return <OtpVerificationScreen channel={challenge.channel} phoneMasked={challenge.phoneMasked} resendAfter={challenge.resendAfter} smsSupported={challenge.smsSupported} smsAvailableAfter={challenge.smsAvailableAfter} smsAvailable={challenge.smsAvailable} loading={loading} error={error} onVerify={(code)=>perform(async()=>{const tokens=await appAuthClient.verify(challenge.challengeId,code,deviceId);await saveTokens(tokens);setPhase('STATUS');})} onResend={()=>perform(async()=>setChallenge(await appAuthClient.resend(challenge.challengeId,deviceId)))} onSms={()=>perform(async()=>setChallenge(await appAuthClient.sms(challenge.challengeId,deviceId)))}/>;
  return <PhoneEntryScreen loading={loading} error={error} onContinue={(phone)=>perform(async()=>{setChallenge(await appAuthClient.start(phone,deviceId));setPhase('OTP');})}/>;
}
