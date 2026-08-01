import { fireEvent, render } from '@testing-library/react-native';
import { describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { visualAppAuthClient } from '@/app-auth/AppAuthClient';
import { AccessStatusScreen } from '@/screens/AccessStatusScreen';
import { SessionExpiredScreen } from '@/screens/SessionExpiredScreen';
import { SessionSplashScreen } from '@/screens/SessionSplashScreen';

describe('persistent app session flow', () => {
  it('renders an elegant restoration splash', () => { const screen = render(<SessionSplashScreen />); expect(screen.getByLabelText('Restaurando sessão')).toBeTruthy(); expect(screen.getByText('Protegendo seu acesso…')).toBeTruthy(); });
  it('renders expired state and returns to login', () => { const onLogin = jest.fn(); const screen = render(<SessionExpiredScreen onLogin={onLogin} />); fireEvent.press(screen.getByLabelText('Entrar novamente')); expect(onLogin).toHaveBeenCalledTimes(1); });
  it('logout is explicit and keeps catalog unavailable', async () => { const onLogout = jest.fn(); const snapshot = await visualAppAuthClient.status('visual-approved', 'device'); const screen = render(<AccessStatusScreen snapshot={snapshot} onLogout={onLogout} onRefresh={jest.fn()} onProfile={jest.fn()} onVerifyPhone={jest.fn()} />); fireEvent.press(screen.getByLabelText('Sair da conta')); expect(onLogout).toHaveBeenCalledTimes(1); expect(screen.queryByText(/Abrir catálogo/i)).toBeNull(); });
  it('visual session supports automatic refresh simulation', async () => { const initial = await visualAppAuthClient.verify('challenge', '222222', 'device'); await expect(visualAppAuthClient.status(initial.accessToken, 'device')).rejects.toMatchObject({ status: 401 }); const refreshed = await visualAppAuthClient.refresh(initial.refreshToken, 'device'); expect((await visualAppAuthClient.status(refreshed.accessToken, 'device')).effectiveStatus).toBe('APPROVED'); });
  it('visual session supports expiry and blocked access simulations', async () => { const expired = await visualAppAuthClient.verify('challenge', '111111', 'device'); await expect(visualAppAuthClient.refresh(expired.refreshToken, 'device')).rejects.toMatchObject({ status: 401 }); const blocked = await visualAppAuthClient.verify('challenge', '333333', 'device'); expect((await visualAppAuthClient.status(blocked.accessToken, 'device')).effectiveStatus).toBe('BLOCKED'); });
  it('storage isolates SecureStore and temporary Web sessionStorage without localStorage', () => { const source = fs.readFileSync(path.join(process.cwd(), 'src', 'app-auth', 'SessionStorage.ts'), 'utf8'); expect(source).toMatch(/expo-secure-store/); expect(source).toMatch(/sessionStorage/); expect(source).not.toMatch(/localStorage/); });
  it('bootstrap restores, refreshes, clears and never navigates to catalog', () => { const coordinator = fs.readFileSync(path.join(process.cwd(), 'src', 'app-auth', 'SessionCoordinator.ts'), 'utf8'); const index = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'index.tsx'), 'utf8'); expect(index).toMatch(/sessionStorage\.load/); expect(coordinator).toMatch(/appAuthClient\.refresh/); expect(coordinator).toMatch(/sessionStorage\.clear/); expect(index).not.toMatch(/catalog/i); });
});
