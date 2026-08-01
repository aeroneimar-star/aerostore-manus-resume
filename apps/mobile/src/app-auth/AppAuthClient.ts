import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { AccessSnapshot, AccessStatus, AppAuthClient, CustomerProfile, OtpChallenge, ProfileUpdate, VerifiedAccess } from './contracts';

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
  profile: (accessToken, deviceId) => request<CustomerProfile>('/app/v1/profile', { method: 'GET', token: accessToken, deviceId }),
  updateProfile: (accessToken, deviceId, input) => request<CustomerProfile>('/app/v1/profile', { method: 'PATCH', token: accessToken, deviceId, body: input }),
  logout: (accessToken, deviceId) => request<void>('/app/v1/auth/logout', { token: accessToken, deviceId }),
  logoutAll: (accessToken, deviceId) => request<void>('/app/v1/auth/logout-all', { token: accessToken, deviceId }),
};

const tokenStatus = (token: string): AccessStatus => {
  for (const status of ['pending_phone_verification', 'pending_approval', 'approved', 'rejected', 'suspended', 'blocked', 'closed'] as const) if (token.includes(status)) return status.toUpperCase() as AccessStatus;
  return 'APPROVED';
};
const visualTokens = (status: AccessStatus, accessToken = `visual-${status.toLowerCase()}`, refreshToken = `visual-refresh-${status.toLowerCase()}`): VerifiedAccess => ({ accessToken, refreshToken, accessExpiresIn: 900, refreshExpiresIn: 2592000, accessStatus: status });
const visualSnapshot = (status: AccessStatus): AccessSnapshot => ({
  accountStatus: (['SUSPENDED', 'BLOCKED', 'CLOSED'].includes(status) ? status : 'ACTIVE') as AccessSnapshot['accountStatus'],
  accessStatus: (['SUSPENDED', 'BLOCKED', 'CLOSED'].includes(status) ? 'APPROVED' : status) as AccessSnapshot['accessStatus'],
  effectiveStatus: status, phoneVerified: status !== 'PENDING_PHONE_VERIFICATION', hasActiveMasterLink: status === 'APPROVED', requestStatus: status === 'PENDING_PHONE_VERIFICATION' ? 'PENDING_PHONE_VERIFICATION' : status === 'PENDING_APPROVAL' ? 'PENDING_APPROVAL' : status === 'REJECTED' ? 'REJECTED' : 'APPROVED', updatedAt: '2026-08-01T12:00:00.000Z', canViewCatalog: false, requiresAction: !['PENDING_APPROVAL', 'APPROVED'].includes(status), safeReasonCode: status === 'APPROVED' ? 'CATALOG_NOT_AVAILABLE_YET' : 'VISUAL_SAFE_STATE', permissions: { canViewProfile: !['BLOCKED', 'CLOSED'].includes(status), canEditProfile: ['PENDING_APPROVAL', 'APPROVED'].includes(status), canViewCatalog: false }
});
let visualProfile: CustomerProfile = { displayName: 'Ana', fullName: 'Ana Cliente', email: 'a***@example.test', emailMasked: 'a***@example.test', phoneMasked: '+55 (***) *****-4321', accountStatus: 'ACTIVE', accessStatus: 'APPROVED', hasActiveMasterLink: true, profileStatus: 'COMPLETE', profileComplete: true, primaryAddressConsolidated: false, preferences: {}, version: 1, createdAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z' };

export const visualAppAuthClient: AppAuthClient = {
  async start() { return { challengeId: 'visual-safe-challenge', phoneMasked: '+55 (***) *****-4321', channel: 'WHATSAPP', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async verify(_challengeId, code) {
    if (code === '000000') throw new AppAuthClientError('Código inválido ou expirado. Confira e tente novamente.', 400, 'OTP_INVALID');
    if (code === '111111') return visualTokens('APPROVED', 'visual-access-expired', 'visual-refresh-expired');
    if (code === '222222') return visualTokens('APPROVED', 'visual-access-expired', 'visual-refresh-approved');
    const map: Record<string, AccessStatus> = { '123456': 'PENDING_APPROVAL', '654321': 'APPROVED', '444444': 'REJECTED', '555555': 'SUSPENDED', '333333': 'BLOCKED', '777777': 'CLOSED', '888888': 'PENDING_PHONE_VERIFICATION' };
    return visualTokens(map[code] || 'PENDING_APPROVAL');
  },
  async resend() { return { challengeId: 'visual-safe-challenge-2', phoneMasked: '+55 (***) *****-4321', channel: 'WHATSAPP', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async sms() { return { challengeId: 'visual-safe-sms', phoneMasked: '+55 (***) *****-4321', channel: 'SMS', expiresIn: 300, resendAfter: 0, smsSupported: true, smsAvailableAfter: 0, smsAvailable: true }; },
  async refresh(refreshToken) { if (refreshToken === 'visual-refresh-expired') throw new AppAuthClientError('Sua sessão expirou.', 401, 'REFRESH_TOKEN_EXPIRED'); const status = tokenStatus(refreshToken); return visualTokens(status, `visual-${status.toLowerCase()}-refreshed`, `visual-refresh-${status.toLowerCase()}-rotated`); },
  async status(accessToken) { if (accessToken === 'visual-access-expired') throw new AppAuthClientError('Sua sessão expirou.', 401, 'ACCESS_TOKEN_EXPIRED'); return visualSnapshot(tokenStatus(accessToken)); },
  async profile() { return visualProfile; },
  async updateProfile(_accessToken, _deviceId, input: ProfileUpdate) { if (input.fullName === 'Conflito') throw new AppAuthClientError('Seu perfil mudou desde a última leitura.', 409, 'APP_PROFILE_VERSION_CONFLICT'); if (input.fullName === 'Erro') throw new AppAuthClientError('Não foi possível salvar agora.', 500, 'APP_PROFILE_UNAVAILABLE'); visualProfile = { ...visualProfile, displayName: input.displayName ?? visualProfile.displayName, fullName: input.fullName ?? visualProfile.fullName, email: input.email ? `${input.email.slice(0, 1)}***@${input.email.split('@')[1] || 'email'}` : visualProfile.email, emailMasked: input.email ? `${input.email.slice(0, 1)}***@${input.email.split('@')[1] || 'email'}` : visualProfile.emailMasked, preferences: input.preferences ?? visualProfile.preferences, version: visualProfile.version + 1, updatedAt: new Date().toISOString() }; return visualProfile; },
  async logout() {}, async logoutAll() {},
};

export const appAuthClient = process.env.EXPO_PUBLIC_APP_AUTH_SOURCE === 'visual' ? visualAppAuthClient : httpAppAuthClient;
