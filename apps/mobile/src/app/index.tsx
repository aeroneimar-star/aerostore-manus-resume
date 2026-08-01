import { useMemo, useState } from 'react';
import { appAuthClient } from '@/app-auth/AppAuthClient';
import type { AccessStatus, OtpChallenge } from '@/app-auth/contracts';
import { AccessStatusScreen } from '@/screens/AccessStatusScreen';
import { OtpVerificationScreen } from '@/screens/OtpVerificationScreen';
import { PhoneEntryScreen } from '@/screens/PhoneEntryScreen';

export default function IndexRoute() {
  const deviceId=useMemo(()=>`app-${Math.random().toString(36).slice(2)}`,[]); const [challenge,setChallenge]=useState<OtpChallenge>(); const [status,setStatus]=useState<AccessStatus>(); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const perform=async(task:()=>Promise<void>)=>{setLoading(true);setError('');try{await task();}catch(reason){setError(reason instanceof Error?reason.message:'Não foi possível concluir agora.');}finally{setLoading(false);}};
  if(status) return <AccessStatusScreen status={status}/>;
  if(challenge) return <OtpVerificationScreen channel={challenge.channel} phoneMasked={challenge.phoneMasked} resendAfter={challenge.resendAfter} smsSupported={challenge.smsSupported} smsAvailableAfter={challenge.smsAvailableAfter} smsAvailable={challenge.smsAvailable} loading={loading} error={error} onVerify={(code)=>perform(async()=>setStatus((await appAuthClient.verify(challenge.challengeId,code,deviceId)).accessStatus))} onResend={()=>perform(async()=>setChallenge(await appAuthClient.resend(challenge.challengeId,deviceId)))} onSms={()=>perform(async()=>setChallenge(await appAuthClient.sms(challenge.challengeId,deviceId)))}/>;
  return <PhoneEntryScreen loading={loading} error={error} onContinue={(phone)=>perform(async()=>setChallenge(await appAuthClient.start(phone,deviceId)))}/>;
}
