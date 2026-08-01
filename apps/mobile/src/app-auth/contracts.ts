export type AccessStatus = 'PENDING_PHONE_VERIFICATION' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'BLOCKED' | 'CLOSED';

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

export interface AccessSnapshot {
  accountStatus: 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'CLOSED';
  accessStatus: 'PENDING_PHONE_VERIFICATION' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  effectiveStatus: AccessStatus;
  phoneVerified: boolean;
  hasActiveMasterLink: boolean;
  requestStatus: string | null;
  updatedAt: string;
  canViewCatalog: boolean;
  requiresAction: boolean;
  safeReasonCode: string;
  permissions: { canViewProfile: boolean; canEditProfile: boolean; canViewCatalog: boolean };
}

export interface CustomerProfile {
  displayName: string;
  fullName: string;
  email: string;
  emailMasked: string;
  phoneMasked: string;
  accountStatus: string;
  accessStatus: string;
  hasActiveMasterLink: boolean;
  profileStatus: 'INCOMPLETE' | 'COMPLETE';
  profileComplete: boolean;
  primaryAddressConsolidated: false;
  preferences: { marketingOptIn?: boolean; styleUpdates?: boolean };
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileUpdate {
  version: number;
  displayName?: string;
  fullName?: string;
  email?: string;
  preferences?: { marketingOptIn?: boolean; styleUpdates?: boolean };
}

export interface AppAuthClient {
  start(phone: string, deviceId: string): Promise<OtpChallenge>;
  verify(challengeId: string, code: string, deviceId: string): Promise<VerifiedAccess>;
  resend(challengeId: string, deviceId: string): Promise<OtpChallenge>;
  sms(challengeId: string, deviceId: string): Promise<OtpChallenge>;
  refresh(refreshToken: string, deviceId: string): Promise<VerifiedAccess>;
  status(accessToken: string, deviceId: string): Promise<AccessSnapshot>;
  profile(accessToken: string, deviceId: string): Promise<CustomerProfile>;
  updateProfile(accessToken: string, deviceId: string, input: ProfileUpdate): Promise<CustomerProfile>;
  logout(accessToken: string, deviceId: string): Promise<void>;
  logoutAll(accessToken: string, deviceId: string): Promise<void>;
}
