import type { UserPersonalData, UserPreferences } from '../jsonb/user-jsonb.js';

export interface AuthIdRow {
  id: string;
}

interface AuthOAuthUserBaseRow {
  id: string;
  email: string;
  role: string;
}

export interface YandexAuthUserRow extends AuthOAuthUserBaseRow {
  yandex_id: string | null;
}

export interface GoogleAuthUserRow extends AuthOAuthUserBaseRow {
  google_id: string | null;
}

export interface AppleAuthUserRow extends AuthOAuthUserBaseRow {
  apple_id: string | null;
}

export interface VkAuthUserRow extends AuthOAuthUserBaseRow {
  vk_id: string | null;
}

export interface SberAuthUserRow extends AuthOAuthUserBaseRow {
  sber_id: string | null;
}

export interface MtsAuthUserRow extends AuthOAuthUserBaseRow {
  mts_id: string | null;
}

export interface TelegramAuthUserRow extends AuthOAuthUserBaseRow {
  telegram_id: string | null;
}

export interface TelegramAuthPollRow {
  status: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: Date | string | null;
}

export interface TelegramAuthTokenRow {
  id: number;
  status: string | null;
  expires_at: Date | string | null;
}

export interface AuthBasicUserRow extends AuthOAuthUserBaseRow {}

export interface RefreshTokenUserIdRow {
  user_id: string;
}

export interface RefreshUserRow extends AuthOAuthUserBaseRow {
  is_active: boolean;
}

export interface ClientPinCredentialRow {
  user_id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: string | Date | null;
}

export interface ClientPinSessionRow {
  user_id: string;
  refresh_token_hash: string;
  unlocked_until: string | Date;
  revoked_at: string | Date | null;
}

export interface EmailVerificationUserRow {
  id: string;
  email_verified: boolean;
}

export interface AuthUserContactRow {
  phone: string | null;
  email: string | null;
}

export interface AuthMeUserRow {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  photo_url: string | null;
  role: string;
  email_verified: boolean | null;
  phone_verified: boolean | null;
  is_active: boolean;
  account_type: string | null;
  personal_data: UserPersonalData | null;
  preferences: UserPreferences | null;
  pin_enabled: boolean | null;
  created_at: string | Date | null;
  updated_at: string | Date | null;
}

export interface ResendVerificationUserRow {
  id: string;
  display_name: string | null;
  email_verified: boolean;
}

export interface PasswordLoginUserRow extends AuthOAuthUserBaseRow {
  display_name: string;
  password_hash: string | null;
  is_active: boolean;
  email_verified: boolean;
  two_factor_enabled: boolean;
  phone: string | null;
  two_factor_method: string | null;
}

export interface EmployeeLoginUserRow extends AuthOAuthUserBaseRow {
  display_name: string;
  password_hash: string | null;
  is_active: boolean;
  two_factor_enabled: boolean;
  phone: string | null;
  two_factor_method: string | null;
}

export interface ExistingAuthUserRow {
  id: string;
  display_name: string | null;
}

export interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  expires_at: string;
  used: boolean;
}

export interface AuthCountRow {
  count: string;
}

export interface PhoneVerificationCodeRow {
  id: string;
  code: string;
  expires_at: string;
  attempts: number;
}

export interface UserPhoneRow {
  phone: string | null;
}

export interface TwoFactorCodeRow {
  id: string;
  code: string;
  attempts: number;
}

export interface TwoFactorUserRow extends AuthOAuthUserBaseRow {
  display_name: string;
}
