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
  statusToken: string;
  accessStatus: AccessStatus;
}

export interface AppAuthClient {
  start(phone: string, deviceId: string): Promise<OtpChallenge>;
  verify(challengeId: string, code: string, deviceId: string): Promise<VerifiedAccess>;
  resend(challengeId: string, deviceId: string): Promise<OtpChallenge>;
  sms(challengeId: string, deviceId: string): Promise<OtpChallenge>;
}
