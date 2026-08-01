import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AccessSnapshot, AccessStatus, AppAuthClient, OtpChallenge, VerifiedAccess } from './contracts';

const apiUrl = process.env.EXPO_PUBLIC_APP_AUTH_API_URL?.replace(/\/$/, '') ?? '';

export class AppAuthClientError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly accessStatus?: AccessStatus) { super(message); }
}

const metadata = (deviceId: string) => ({
  'x-device-id': deviceId,
  'x-device-name': Platform.OS === 'web' ? 'Navegador AEROSTORE' : 'Dispositivo AEROSTORE',
  'x-app-platform': Platform.OS.toUpperCase(),
  'x-app-version': Constants.expoConfig?.version ?? '1.0.0',
});

async function request<T>(path: string, options: { method?: string; body?: object; token?: string; deviceId: string }): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', ...metadata(options.deviceId), ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new AppAuthClientError(String(payload.message || 'Não foi possível concluir agora.'), response.status, String(payload.error || 'APP_AUTH_ERROR'), payload.accessStatus);
  return payload as T;
}

export const httpAppAuthClient: AppAuthClient = {
  start: (phone, deviceId) => request<OtpChallenge>('/app/v1/auth/start', { body: { phone, deviceId, purpose: 'APP_LOGIN' }, deviceId }),
  verify: (challengeId, code, deviceId) => request<VerifiedAccess>('/app/v1/auth/verify', { body: { challengeId, code, deviceId }, deviceId }),
  resend: (challengeId, deviceId) => request<OtpChallenge>('/app/v1/auth/resend', { body: { challengeId, deviceId }, deviceId }),
  sms: (challengeId, deviceId) => request<OtpChallenge>('/app/v1/auth/sms', { body: { challengeId, deviceId }, deviceId }),
  refresh: (refreshToken, deviceId) => request<VerifiedAccess>('/app/v1/auth/refresh', { body: { refreshToken, deviceId }, deviceId }),
  status: (accessToken, deviceId) => request<AccessSnapshot>('/app/v1/access/status', { method: 'GET', token: accessToken, deviceId }),
  logout: (accessToken, deviceId) => request<void>('/app/v1/auth/logout', { token: accessToken, deviceId }),
  logoutAll: (accessToken, deviceId) => request<void>('/app/v1/auth/logout-all', { token: accessToken, deviceId }),
};

const visualTokens = (accessStatus: AccessStatus, accessToken = `visual-${accessStatus.toLowerCase()}`, refreshToken = 'visual-refresh-valid'): VerifiedAccess => ({ accessToken, refreshToken, accessExpiresIn: 900, refreshExpiresIn: 2592000, accessStatus });
export const visualAppAuthClient: AppAuthClient = {
  async start() { return { challengeId: 'visual-safe-challenge', phoneMasked: '+55 (***) *****-4321', channel: 'WHATSAPP', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async verify(_challengeId, code) {
    if (code === '000000') throw new AppAuthClientError('Código inválido ou expirado. Confira e tente novamente.', 400, 'OTP_INVALID');
    if (code === '111111') return visualTokens('APPROVED', 'visual-access-expired', 'visual-refresh-expired');
    if (code === '222222') return visualTokens('APPROVED', 'visual-access-expired', 'visual-refresh-valid');
    if (code === '333333') return visualTokens('BLOCKED');
    return visualTokens(code === '654321' ? 'APPROVED' : 'PENDING_APPROVAL');
  },
  async resend() { return { challengeId: 'visual-safe-challenge-2', phoneMasked: '+55 (***) *****-4321', channel: 'WHATSAPP', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async sms() { return { challengeId: 'visual-safe-sms', phoneMasked: '+55 (***) *****-4321', channel: 'SMS', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async refresh(refreshToken) { if (refreshToken === 'visual-refresh-expired') throw new AppAuthClientError('Sua sessão expirou.', 401, 'REFRESH_TOKEN_EXPIRED'); return visualTokens('APPROVED', 'visual-access-refreshed', 'visual-refresh-rotated'); },
  async status(accessToken) { if (accessToken === 'visual-access-expired') throw new AppAuthClientError('Sua sessão expirou.', 401, 'ACCESS_TOKEN_EXPIRED'); if (accessToken === 'visual-blocked') throw new AppAuthClientError('Seu acesso está indisponível.', 403, 'APP_ACCOUNT_RESTRICTED', 'BLOCKED'); return { phoneVerified: true, accessStatus: accessToken.includes('pending_approval') ? 'PENDING_APPROVAL' : 'APPROVED', accountStatus: 'ACTIVE' }; },
  async logout() {}, async logoutAll() {},
};

export const appAuthClient = process.env.EXPO_PUBLIC_APP_AUTH_SOURCE === 'visual' ? visualAppAuthClient : httpAppAuthClient;
