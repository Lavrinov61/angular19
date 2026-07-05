import { z } from 'zod';

// ── Reusable primitives ──────────────────────────────────────────────

const email = z.string().min(1, 'Email обязателен').email('Некорректный email');
const password = z.string().min(1, 'Пароль обязателен');
const phone = z.string().min(1, 'Телефон обязателен');
const code6 = z.string().regex(/^\d{6}$/, 'Код должен содержать 6 цифр');
const phoneLoginCode = z.string().regex(/^\d{4}$/, 'Код должен содержать 4 цифры');
const pin4 = z.string().regex(/^\d{4}$/, 'PIN должен содержать 4 цифры');
const fingerprintVisitorId = z.string().trim().min(1).max(128).optional();
const privacyConsent = z.object({
  documentType: z.string().trim().min(1).max(64).default('privacy_policy'),
  documentVersion: z.string().trim().min(1).max(32),
  scope: z.array(z.string().trim().min(1).max(64)).max(20).default([]),
  source: z.string().trim().min(1).max(80).default('email_registration'),
  accepted: z.boolean().optional().default(true),
  visitorId: fingerprintVisitorId,
  details: z.record(z.unknown()).optional(),
}).optional();
const phoneRegistrationProfile = z.object({
  displayName: z.string().trim().min(2, 'Имя должно быть не короче 2 символов').max(100, 'Имя слишком длинное'),
  firstName: z.string().trim().min(2, 'Имя должно быть не короче 2 символов').max(100, 'Имя слишком длинное').optional(),
  lastName: z.string().trim().min(2, 'Фамилия должна быть не короче 2 символов').max(100, 'Фамилия слишком длинная').optional(),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата рождения должна быть в формате YYYY-MM-DD').optional(),
});

// ── POST /register ──────────────────────────────────────────────────

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().optional(),
  privacyConsent,
});

export type RegisterInput = z.infer<typeof registerSchema>;

// ── POST /login ─────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().min(1, 'Email обязателен'),
  password,
});

export type LoginInput = z.infer<typeof loginSchema>;

// ── POST /employee-login ────────────────────────────────────────────

export const employeeLoginSchema = z.object({
  email: z.string().min(1, 'Email обязателен'),
  password,
});

export type EmployeeLoginInput = z.infer<typeof employeeLoginSchema>;

// ── POST /refresh ───────────────────────────────────────────────────

export const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional(), // optional — can come from httpOnly cookie instead
});

export type RefreshInput = z.infer<typeof refreshSchema>;

// ── POST /logout ────────────────────────────────────────────────────

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export type LogoutInput = z.infer<typeof logoutSchema>;

// ── Client PIN ─────────────────────────────────────────────────────

export const pinSetupSchema = z.object({
  pin: pin4,
  refreshToken: z.string().min(1).optional(),
});

export type PinSetupInput = z.infer<typeof pinSetupSchema>;

export const pinUnlockSchema = z.object({
  pin: pin4,
  refreshToken: z.string().min(1).optional(),
});

export type PinUnlockInput = z.infer<typeof pinUnlockSchema>;

export const pinDisableSchema = z.object({
  pin: pin4,
});

export type PinDisableInput = z.infer<typeof pinDisableSchema>;

// ── POST /resend-verification ───────────────────────────────────────

export const resendVerificationSchema = z.object({
  email: z.string().min(1, 'Email обязателен').email('Некорректный email'),
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;

// ── POST /forgot-password ───────────────────────────────────────────

export const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Email обязателен').email('Некорректный email'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// ── POST /reset-password ────────────────────────────────────────────

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Токен обязателен'),
  password,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ── POST /send-phone-code ───────────────────────────────────────────

export const sendPhoneCodeSchema = z.object({
  phone,
  purpose: z.enum(['phone_verify', 'two_factor']).optional().default('phone_verify'),
});

export type SendPhoneCodeInput = z.infer<typeof sendPhoneCodeSchema>;

// ── POST /verify-phone ──────────────────────────────────────────────

export const verifyPhoneSchema = z.object({
  phone,
  code: code6,
});

export type VerifyPhoneInput = z.infer<typeof verifyPhoneSchema>;

// ── POST /enable-2fa ────────────────────────────────────────────────

export const enable2faSchema = z.object({
  method: z.enum(['sms', 'telegram'], { message: 'Метод должен быть: sms или telegram' }),
});

export type Enable2faInput = z.infer<typeof enable2faSchema>;

// ── POST /verify-2fa ────────────────────────────────────────────────

export const verify2faSchema = z.object({
  tempToken: z.string().min(1, 'tempToken обязателен'),
  code: code6,
});

export type Verify2faInput = z.infer<typeof verify2faSchema>;

// ── POST /phone-code ────────────────────────────────────────────────

export const phoneCodeSchema = z.object({
  phone,
  fingerprintVisitorId,
});

export type PhoneCodeInput = z.infer<typeof phoneCodeSchema>;

// ── POST /phone-verify ──────────────────────────────────────────────

export const phoneVerifySchema = z.object({
  phone,
  code: phoneLoginCode,
  staffOnly: z.boolean().optional(),
  fingerprintVisitorId,
  profile: phoneRegistrationProfile.optional(),
});

export type PhoneVerifyInput = z.infer<typeof phoneVerifySchema>;

// ── POST /profile-phone-verify ─────────────────────────────────────

export const profilePhoneVerifySchema = z.object({
  phone,
  code: phoneLoginCode,
  fingerprintVisitorId,
});

export type ProfilePhoneVerifyInput = z.infer<typeof profilePhoneVerifySchema>;

// ── POST /telegram/confirm ──────────────────────────────────────────

export const telegramConfirmSchema = z.object({
  token: z.string().min(1, 'Token обязателен'),
  telegramId: z.union([z.string(), z.number()]).transform(String),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  username: z.string().optional(),
  photoUrl: z.string().optional(),
});

export type TelegramConfirmInput = z.infer<typeof telegramConfirmSchema>;

// ── POST /apple/callback ────────────────────────────────────────────

export const appleCallbackSchema = z.object({
  code: z.string().min(1, 'Authorization code обязателен'),
}).passthrough();

export type AppleCallbackInput = z.infer<typeof appleCallbackSchema>;
