import { appAuthClient, AppAuthClientError } from './AppAuthClient';
import { sessionStorage } from './SessionStorage';

export class MissingSessionError extends Error {}

export async function withSessionRefresh<T>(operation: (accessToken: string, deviceId: string) => Promise<T>): Promise<{ value: T; accessToken: string; deviceId: string }> {
  const deviceId = await sessionStorage.getOrCreateDeviceId(); const stored = await sessionStorage.load();
  if (!stored) throw new MissingSessionError('SESSION_NOT_FOUND');
  try { return { value: await operation(stored.accessToken, deviceId), accessToken: stored.accessToken, deviceId }; }
  catch (reason) {
    const status = reason && typeof reason === 'object' && 'status' in reason
      ? Number((reason as { status?: number }).status)
      : reason instanceof AppAuthClientError ? reason.status : 0;
    if (status !== 401) throw reason;
    const refreshed = await appAuthClient.refresh(stored.refreshToken, deviceId);
    await sessionStorage.save({ accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken });
    return { value: await operation(refreshed.accessToken, deviceId), accessToken: refreshed.accessToken, deviceId };
  }
}

export async function closeLocalSession(accessToken?: string, deviceId?: string) {
  try { if (accessToken && deviceId) await appAuthClient.logout(accessToken, deviceId); }
  finally { await sessionStorage.clear(); }
}
