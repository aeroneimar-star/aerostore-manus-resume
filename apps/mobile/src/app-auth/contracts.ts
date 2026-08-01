export type AccessStatus = 'PENDING_PHONE_VERIFICATION' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'BLOCKED';

export interface OtpChallenge {
  challengeId: string;
  phoneMasked: string;
  channel: 'WHATSAPP' | 'SMS';
  expiresIn: number;
  resendAfter: number;
  smsSupported: boolean;
  smsAvailableAfter: number;
  smsAvailable: boolean;
}

export interface VerifiedAccess {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  refreshExpiresIn: number;
  accessStatus: AccessStatus;
}

export interface AccessSnapshot { phoneVerified: boolean; accessStatus: AccessStatus; accountStatus: string; }

export interface AppAuthClient {
  start(phone: string, deviceId: string): Promise<OtpChallenge>;
  verify(challengeId: string, code: string, deviceId: string): Promise<VerifiedAccess>;
  resend(challengeId: string, deviceId: string): Promise<OtpChallenge>;
  sms(challengeId: string, deviceId: string): Promise<OtpChallenge>;
  refresh(refreshToken: string, deviceId: string): Promise<VerifiedAccess>;
  status(accessToken: string, deviceId: string): Promise<AccessSnapshot>;
  logout(accessToken: string, deviceId: string): Promise<void>;
  logoutAll(accessToken: string, deviceId: string): Promise<void>;
}
