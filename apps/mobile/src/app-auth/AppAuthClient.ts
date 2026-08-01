import type { AppAuthClient, OtpChallenge, VerifiedAccess } from './contracts';

const apiUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL?.replace(/\/$/, '') ?? '';

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-device-id': String((body as { deviceId?: string }).deviceId ?? '') }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload.message || 'Não foi possível concluir agora.'));
  return payload as T;
}

export const httpAppAuthClient: AppAuthClient = {
  start: (phone, deviceId) => post<OtpChallenge>('/app/v1/auth/start', { phone, deviceId, purpose: 'APP_LOGIN' }),
  verify: (challengeId, code, deviceId) => post<VerifiedAccess>('/app/v1/auth/verify', { challengeId, code, deviceId }),
  resend: (challengeId, deviceId) => post<OtpChallenge>('/app/v1/auth/resend', { challengeId, deviceId }),
  sms: (challengeId, deviceId) => post<OtpChallenge>('/app/v1/auth/sms', { challengeId, deviceId }),
};

export const visualAppAuthClient: AppAuthClient = {
  async start() { return { challengeId: 'visual-safe-challenge', phoneMasked: '+55 (***) *****-4321', channel: 'WHATSAPP', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async verify(_challengeId, code) {
    if (code === '000000') throw new Error('Código inválido ou expirado. Confira e tente novamente.');
    return { statusToken: 'visual-status-only', accessStatus: code === '654321' ? 'APPROVED' : 'PENDING_APPROVAL' };
  },
  async resend() { return { challengeId: 'visual-safe-challenge-2', phoneMasked: '+55 (***) *****-4321', channel: 'WHATSAPP', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async sms() { return { challengeId: 'visual-safe-sms', phoneMasked: '+55 (***) *****-4321', channel: 'SMS', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
};

export const appAuthClient = process.env.EXPO_PUBLIC_APP_AUTH_SOURCE === 'visual' ? visualAppAuthClient : httpAppAuthClient;
