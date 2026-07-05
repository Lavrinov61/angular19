/**
 * auth.service.ts — Business logic for authentication and authorization.
 * Extracted from auth.routes.ts (Stage 2C).
 * Functions are HTTP-agnostic: accept data, return results.
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import {
  sendPasswordResetEmail,
  sendEmailVerificationEmail,
  sendLoginAlertEmail,
  sendRegistrationAttemptEmail,
} from './email.service.js';
import { sendSms, normalizePhone } from './sms.service.js';
import { logAudit } from './audit.service.js';
import { sendVerificationCode, checkDeliveryChannel } from './code-delivery.service.js';
import { checkAccountLockout, recordLoginAttempt } from './login-guard.service.js';
import { blacklistToken, blacklistAllUserTokens } from './token-blacklist.service.js';
import { validatePasswordStrength } from '../utils/password-validator.js';
import { createPendingLink, confirmPendingLink } from './oauth-link.service.js';
import { linkApprovalSessionsByPhone } from './approval-counters.service.js';
import { runPostLoginBackfill } from './account-backfill.service.js';
import { createLogger } from '../utils/logger.js';
import { invalidateAuthCache } from './auth-cache.service.js';
import { signJwt, verifyJwt, verifyJwtDerived } from '../utils/jwt-keys.js';

const log = createLogger('auth');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  role: string;
}

export type OAuthProvider = 'yandex' | 'google' | 'apple' | 'vk' | 'sber' | 'mts';

export interface OAuthUserData {
  provider: OAuthProvider;
  providerId: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  extraColumns?: Record<string, unknown>;
}

export type OAuthCallbackResult =
  | { type: 'login'; user: UserInfo; tokens: TokenPair }
  | { type: 'pending'; maskedEmail: string };

export type LoginResult =
  | { type: 'success'; user: UserInfo; tokens: TokenPair }
  | { type: 'email_not_verified' }
  | { type: 'requires_2fa'; tempToken: string };

export interface RegisterResult {
  requiresVerification: boolean;
}

export type VerifyEmailResult = 'success' | 'error' | 'expired';

export interface TelegramUserData {
  telegramId: string;
  firstName: string;
  lastName: string;
  username: string;
  photoUrl: string;
}

export interface TelegramAuthInitResult {
  token: string;
  botUsername: string;
  deepLink: string;
  expiresAt: string;
}

export type TelegramAuthCheckResult =
  | { status: 'pending' | 'used' }
  | { status: 'confirmed'; accessToken: string; refreshToken: string };

export interface TelegramConfirmData {
  token: string;
  telegramId: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export interface PhoneOtpVerifyResult {
  user: UserInfo;
  tokens: TokenPair;
  isNewUser: boolean;
}

// ─── Type Guards ─────────────────────────────────────────────────────────────

function isUserJwtPayload(val: unknown): val is { userId: string; email: string; role: string } {
  return typeof val === 'object' && val !== null
    && 'userId' in val && typeof val.userId === 'string';
}

function is2faJwtPayload(val: unknown): val is { userId: string; phone: string; purpose: string } {
  return typeof val === 'object' && val !== null
    && 'userId' in val && typeof val.userId === 'string'
    && 'purpose' in val && val.purpose === 'two_factor';
}

function isEmailVerifyPayload(val: unknown): val is { userId: string; purpose: string } {
  return typeof val === 'object' && val !== null
    && 'userId' in val && typeof val.userId === 'string'
    && 'purpose' in val && val.purpose === 'email_verify';
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PROVIDER_ID_COLUMN = {
  yandex: 'yandex_id',
  google: 'google_id',
  apple: 'apple_id',
  vk: 'vk_id',
  sber: 'sber_id',
  mts: 'mts_id',
} as const;

const EMPLOYEE_ROLES = ['employee', 'admin', 'photographer', 'manager'];

const resendCooldownMap = new Map<string, number>();
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

let cooldownCleanupInterval: ReturnType<typeof setInterval> | null = null;

function cleanupResendCooldowns(): void {
  const now = Date.now();
  for (const [key, ts] of resendCooldownMap) {
    if (now - ts > RESEND_COOLDOWN_MS) {
      resendCooldownMap.delete(key);
    }
  }
}

export function startResendCooldownCleanup(): void {
  if (cooldownCleanupInterval) return;
  cooldownCleanupInterval = setInterval(cleanupResendCooldowns, 5 * 60 * 1000);
}

export function stopResendCooldownCleanup(): void {
  if (cooldownCleanupInterval) {
    clearInterval(cooldownCleanupInterval);
    cooldownCleanupInterval = null;
  }
  resendCooldownMap.clear();
}

// ─── Core Helpers ────────────────────────────────────────────────────────────

export function generateTokens(userId: string, email: string | null, role: string): TokenPair {
  const accessToken = signJwt(
    { userId, email: email || '', role },
    { expiresIn: config.jwt.expiresIn } as never,
  );
  const refreshToken = signJwt(
    { userId, email, role, type: 'refresh', jti: uuidv4() },
    { expiresIn: config.jwt.refreshExpiresIn } as never,
  );
  return { accessToken, refreshToken };
}

export async function saveRefreshToken(
  userId: string,
  refreshToken: string,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, refreshToken, expiresAt, ip || null, userAgent || ''],
  );
}

export function checkNewIpAndAlert(
  userId: string,
  email: string,
  displayName: string | null,
  ip: string | undefined,
  userAgent: string,
): void {
  if (!ip || !email) return;
  db.queryOne<{ id: string }>(
    `SELECT id FROM audit_log
     WHERE user_id = $1 AND action IN ('login_email', 'login_employee')
       AND ip = $2 AND created_at > NOW() - INTERVAL '90 days'
     LIMIT 1`,
    [userId, ip],
  ).then(existing => {
    if (!existing) {
      sendLoginAlertEmail(email, displayName, ip, userAgent, new Date()).catch(err => {
        log.error('Failed to send login alert email', { error: err });
      });
    }
  }).catch(err => {
    log.error('IP check error', { error: err });
  });
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

export async function handleOAuthCallback(
  data: OAuthUserData,
  ip?: string,
  userAgent?: string,
): Promise<OAuthCallbackResult> {
  const idCol = PROVIDER_ID_COLUMN[data.provider];

  // 1. Find user by provider ID (already linked)
  let user = await db.queryOne<{ id: string; email: string; role: string }>(
    `SELECT id, email, role FROM users WHERE ${idCol} = $1`,
    [data.providerId],
  );

  if (!user) {
    // 2. Try to find by email (might need linking confirmation)
    const lookupEmail = data.email ? data.email.toLowerCase() : null;
    if (lookupEmail) {
      const emailUser = await db.queryOne<{ id: string; email: string; role: string }>(
        'SELECT id, email, role FROM users WHERE LOWER(email) = $1',
        [lookupEmail],
      );
      if (emailUser) {
        const { maskedEmail } = await createPendingLink(
          emailUser.id, emailUser.email, data.displayName, data.provider, data.providerId, ip,
        );
        return { type: 'pending', maskedEmail };
      }
    }

    // 3. No user found — create new
    const userId = uuidv4();
    const userEmail = data.email
      || (data.phone
        ? `${data.phone.replace(/\D/g, '')}@${data.provider}.local`
        : `${data.provider}_${data.providerId}@${data.provider}.local`);

    const cols = ['id', 'email', 'display_name', idCol];
    const vals: unknown[] = [userId, userEmail, data.displayName, data.providerId];

    if (data.phone) {
      cols.push('phone');
      vals.push(data.phone);
    }
    if (data.extraColumns) {
      const allowedExtraCols = ['photo_url', 'first_name', 'last_name', 'username', 'yandex_email'] as const;
      for (const [col, val] of Object.entries(data.extraColumns)) {
        if ((allowedExtraCols as readonly string[]).includes(col)) {
          cols.push(col);
          vals.push(val);
        }
      }
    }
    cols.push('role', 'email_verified', 'is_active');
    vals.push('client', !!data.email, true);

    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
    await db.query(
      `INSERT INTO users (${cols.join(', ')}) VALUES (${placeholders})`,
      vals,
    );

    user = { id: userId, email: userEmail, role: 'client' };
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);
  await saveRefreshToken(user.id, tokens.refreshToken, ip, userAgent);

  if (data.phone) {
    linkApprovalSessionsByPhone(user.id, data.phone).catch(err => {
      log.error('approval link error', { error: err });
    });
  }

  runPostLoginBackfill(user.id, data.phone, user.email).catch(err =>
    log.error('post-login backfill error', { error: err }),
  );

  return {
    type: 'login',
    user: { id: user.id, email: user.email || '', displayName: data.displayName, role: user.role },
    tokens,
  };
}

export async function handleTelegramLogin(
  data: TelegramUserData,
  ip?: string,
  userAgent?: string,
): Promise<{ user: UserInfo; tokens: TokenPair }> {
  const displayName = [data.firstName, data.lastName].filter(Boolean).join(' ')
    || data.username || `tg_${data.telegramId}`;

  let user = await db.queryOne<{ id: string; email: string; role: string }>(
    'SELECT id, email, role FROM users WHERE telegram_id = $1',
    [data.telegramId],
  );

  if (!user) {
    const userId = uuidv4();
    const placeholderEmail = data.username ? `${data.username}@t.me` : `tg${data.telegramId}@t.me`;
    await db.query(
      `INSERT INTO users (id, email, display_name, telegram_id, telegram_username, photo_url, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, placeholderEmail, displayName, data.telegramId,
       data.username || null, data.photoUrl || null, 'client', false, true],
    );
    user = { id: userId, email: placeholderEmail, role: 'client' };
  } else {
    await db.query(
      'UPDATE users SET display_name = $1, photo_url = COALESCE($2, photo_url), telegram_username = $3 WHERE telegram_id = $4',
      [displayName, data.photoUrl || null, data.username || null, data.telegramId],
    );
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);
  await saveRefreshToken(user.id, tokens.refreshToken, ip, userAgent);

  return {
    user: { id: user.id, email: user.email || '', displayName, role: user.role },
    tokens,
  };
}

export async function telegramAuthInit(): Promise<TelegramAuthInitResult> {
  const token = crypto.randomBytes(29).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await db.query(
    `INSERT INTO telegram_auth_tokens (token, status, expires_at) VALUES ($1, 'pending', $2)`,
    [token, expiresAt],
  );

  return {
    token,
    botUsername: config.telegram.botUsername,
    deepLink: `https://t.me/${config.telegram.botUsername}?start=login_${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function telegramAuthCheck(token: string): Promise<TelegramAuthCheckResult> {
  const record = await db.queryOne<{
    status: string; access_token: string | null; refresh_token: string | null;
  }>(
    `SELECT status, access_token, refresh_token FROM telegram_auth_tokens
     WHERE token = $1 AND expires_at > NOW()`,
    [token],
  );

  if (!record) {
    throw new AppError(404, 'Token not found or expired');
  }

  if (record.status === 'confirmed' && record.access_token && record.refresh_token) {
    await db.query(`UPDATE telegram_auth_tokens SET status = 'used' WHERE token = $1`, [token]);
    return { status: 'confirmed', accessToken: record.access_token, refreshToken: record.refresh_token };
  }

  return { status: record.status === 'pending' ? 'pending' : 'used' };
}

export async function telegramAuthConfirm(
  data: TelegramConfirmData,
  ip?: string,
  userAgent?: string,
): Promise<{ userId: string }> {
  const authToken = await db.queryOne<{ id: number; status: string }>(
    `SELECT id, status FROM telegram_auth_tokens WHERE token = $1 AND expires_at > NOW()`,
    [data.token],
  );

  if (!authToken) {
    throw new AppError(404, 'Token not found or expired');
  }
  if (authToken.status !== 'pending') {
    throw new AppError(409, 'Token already used');
  }

  const result = await handleTelegramLogin({
    telegramId: data.telegramId,
    firstName: data.firstName || '',
    lastName: data.lastName || '',
    username: data.username || '',
    photoUrl: data.photoUrl || '',
  }, ip, userAgent);

  await db.query(
    `UPDATE telegram_auth_tokens
     SET status = 'confirmed', telegram_id = $2, telegram_username = $3,
         telegram_first_name = $4, telegram_last_name = $5, telegram_photo_url = $6,
         access_token = $7, refresh_token = $8, user_id = $9, confirmed_at = NOW()
     WHERE token = $1`,
    [data.token, data.telegramId, data.username || null, data.firstName || null,
     data.lastName || null, data.photoUrl || null,
     result.tokens.accessToken, result.tokens.refreshToken, result.user.id],
  );

  log.info(`Telegram bot auth confirmed for user ${data.telegramId}`);
  return { userId: result.user.id };
}

// ─── Confirm Pending OAuth Link ──────────────────────────────────────────────

export async function confirmOAuthLinkAndLogin(
  token: string,
  ip?: string,
  userAgent?: string,
): Promise<{ tokens: TokenPair } | null> {
  const result = await confirmPendingLink(token);
  if (!result) return null;

  const tokens = generateTokens(result.userId, result.email, result.role);
  await saveRefreshToken(result.userId, tokens.refreshToken, ip, userAgent);
  return { tokens };
}

// ─── Email/Password Login ────────────────────────────────────────────────────

export async function loginWithCredentials(
  email: string,
  password: string,
  opts: {
    ip?: string;
    userAgent?: string;
    allowedRoles?: string[];
    endpoint?: string;
  } = {},
): Promise<LoginResult> {
  const { ip, userAgent, allowedRoles, endpoint = 'login' } = opts;

  if (!email || !password) {
    throw new AppError(400, 'Email и пароль обязательны', ErrorCode.VALIDATION_ERROR);
  }

  const lockout = await checkAccountLockout(email);
  if (lockout.locked) {
    logAudit({
      action: 'login_locked',
      entityType: 'user',
      ip,
      userAgent,
      details: { email: email.trim().toLowerCase(), remainingMinutes: lockout.remainingMinutes, endpoint },
    });
    throw new AppError(429, `Слишком много попыток входа. Повторите через ${lockout.remainingMinutes} мин.`, ErrorCode.AUTH_LOCKOUT);
  }

  const user = await db.queryOne<{
    id: string; email: string; role: string; display_name: string;
    password_hash: string | null; is_active: boolean; email_verified: boolean;
    two_factor_enabled: boolean; phone: string | null; two_factor_method: string | null;
  }>(
    'SELECT id, email, role, display_name, password_hash, is_active, email_verified, two_factor_enabled, phone, two_factor_method FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()],
  );

  if (!user || !user.password_hash) {
    recordLoginAttempt(email, ip, userAgent, false);
    logAudit({ action: 'login_failed', entityType: 'user', ip, userAgent, details: { email: email.trim().toLowerCase(), reason: 'not_found', endpoint } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  if (!user.is_active) {
    recordLoginAttempt(email, ip, userAgent, false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip, userAgent, details: { reason: 'inactive', endpoint } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_ACCOUNT_INACTIVE);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recordLoginAttempt(email, ip, userAgent, false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip, userAgent, details: { reason: 'invalid_password', endpoint } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    recordLoginAttempt(email, ip, userAgent, false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip, userAgent, details: { reason: 'not_employee', endpoint } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  recordLoginAttempt(email, ip, userAgent, true);

  if (!allowedRoles && !user.email_verified) {
    return { type: 'email_not_verified' };
  }

  if (user.two_factor_enabled && user.phone) {
    const twoFaCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
       VALUES ($1, $2, $3, $4, 'two_factor', $5)`,
      [user.id, user.phone, twoFaCode, user.two_factor_method || 'sms', expiresAt],
    );

    const smsText = `Своё Фото: код для входа ${twoFaCode}. Действует 5 минут.`;
    sendSms(user.phone, smsText).catch(err => log.error('2FA SMS error', { error: err }));

    // 2FA temp token is signed with a derived key to prevent use as a regular JWT
    const tempToken = jwt.sign(
      { userId: user.id, phone: user.phone, purpose: 'two_factor' },
      config.jwt.secret + '_2fa',
      { expiresIn: '5m' },
    );

    return { type: 'requires_2fa', tempToken };
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 days\')',
    [user.id, tokens.refreshToken],
  );

  const auditAction = allowedRoles ? 'login_employee' : 'login_email';
  logAudit({ userId: user.id, userName: user.display_name, action: auditAction, entityType: 'user', entityId: user.id, ip, userAgent });
  checkNewIpAndAlert(user.id, user.email, user.display_name, ip, userAgent || '');

  if (user.phone) {
    linkApprovalSessionsByPhone(user.id, user.phone).catch(err =>
      log.error('approval link error', { error: err }),
    );
  }

  runPostLoginBackfill(user.id, user.phone, user.email).catch(err =>
    log.error('post-login backfill error', { error: err }),
  );

  return {
    type: 'success',
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
    tokens,
  };
}

// ─── Registration ────────────────────────────────────────────────────────────

export async function registerUser(
  email: string,
  password: string,
  displayName?: string,
): Promise<RegisterResult> {
  if (!email || !password) {
    throw new AppError(400, 'Email и пароль обязательны', ErrorCode.VALIDATION_ERROR);
  }

  const pwCheck = validatePasswordStrength(password, email);
  if (!pwCheck.valid) {
    throw new AppError(400, `Слабый пароль: ${pwCheck.errors.join(', ')}`, ErrorCode.AUTH_WEAK_PASSWORD);
  }

  const existing = await db.queryOne<{ id: string; display_name: string | null }>(
    'SELECT id, display_name FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()],
  );

  if (existing) {
    sendRegistrationAttemptEmail(email.trim().toLowerCase(), existing.display_name).catch(err =>
      log.error('Failed to send registration attempt email', { error: err }),
    );
    return { requiresVerification: true };
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  const cleanName = displayName?.trim() || email.split('@')[0];

  await db.query(
    `INSERT INTO users (id, email, display_name, role, password_hash, email_verified, is_active, last_password_change)
     VALUES ($1, $2, $3, 'client', $4, false, true, NOW())`,
    [userId, email.trim().toLowerCase(), cleanName, passwordHash],
  );

  const verificationToken = signJwt(
    { userId, purpose: 'email_verify' },
    { expiresIn: '24h' },
  );
  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
  const verificationUrl = `${frontendUrl}/api/auth/verify-email?token=${verificationToken}`;

  sendEmailVerificationEmail(email.trim().toLowerCase(), cleanName, verificationUrl).catch(err => {
    log.error('Failed to send verification email', { error: err });
  });

  log.info(`New registration: ${email.trim().toLowerCase()}`);
  return { requiresVerification: true };
}

// ─── Token Refresh ───────────────────────────────────────────────────────────

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  if (!refreshToken) {
    throw new AppError(400, 'Refresh token required', ErrorCode.VALIDATION_ERROR);
  }

  let decoded: unknown;
  try {
    decoded = verifyJwt(refreshToken);
  } catch {
    throw new AppError(401, 'Invalid or expired refresh token', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  if (!isUserJwtPayload(decoded)) {
    throw new AppError(401, 'Invalid or expired refresh token', ErrorCode.AUTH_TOKEN_INVALID);
  }

  const tokenRecord = await db.queryOne<{ user_id: string }>(
    'SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
    [refreshToken],
  );

  if (!tokenRecord) {
    throw new AppError(401, 'Invalid or expired refresh token', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  const user = await db.queryOne<{ id: string; email: string; role: string; is_active: boolean }>(
    'SELECT id, email, role, is_active FROM users WHERE id = $1',
    [decoded.userId],
  );

  if (!user || !user.is_active) {
    throw new AppError(401, 'User not found or inactive', ErrorCode.AUTH_ACCOUNT_INACTIVE);
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.query(
    'UPDATE refresh_tokens SET token = $1, expires_at = $2 WHERE token = $3',
    [tokens.refreshToken, expiresAt, refreshToken],
  );

  return tokens;
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function logoutUser(
  refreshToken: string | undefined,
  accessToken: string | undefined,
): Promise<void> {
  if (accessToken) {
    const decoded = jwt.decode(accessToken);
    if (typeof decoded === 'object' && decoded !== null && 'exp' in decoded && typeof decoded.exp === 'number') {
      blacklistToken(accessToken, decoded.exp).catch(err =>
        log.error('Failed to blacklist token', { error: err }),
      );
    }
  }

  if (refreshToken) {
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
  }
}

// ─── Email Verification ─────────────────────────────────────────────────────

export async function verifyEmailToken(token: string): Promise<VerifyEmailResult> {
  try {
    const decoded = verifyJwt(token);
    if (!isEmailVerifyPayload(decoded)) {
      return 'error';
    }

    const user = await db.queryOne<{ id: string; email_verified: boolean }>(
      'SELECT id, email_verified FROM users WHERE id = $1',
      [decoded.userId],
    );

    if (!user) return 'error';

    if (!user.email_verified) {
      await db.query('UPDATE users SET email_verified = true WHERE id = $1', [decoded.userId]);
      log.info(`Email verified for user ${decoded.userId}`);
    }

    return 'success';
  } catch {
    return 'expired';
  }
}

export async function resendVerification(email: string): Promise<void> {
  if (!email || typeof email !== 'string') return;

  const normalizedEmail = email.trim().toLowerCase();

  const lastSent = resendCooldownMap.get(normalizedEmail);
  if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) return;

  const user = await db.queryOne<{ id: string; display_name: string | null; email_verified: boolean }>(
    'SELECT id, display_name, email_verified FROM users WHERE LOWER(email) = $1 AND is_active = true AND password_hash IS NOT NULL',
    [normalizedEmail],
  );

  if (user && !user.email_verified) {
    resendCooldownMap.set(normalizedEmail, Date.now());

    const verificationToken = signJwt(
      { userId: user.id, purpose: 'email_verify' },
      { expiresIn: '24h' },
    );
    const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
    const verificationUrl = `${frontendUrl}/api/auth/verify-email?token=${verificationToken}`;

    sendEmailVerificationEmail(normalizedEmail, user.display_name, verificationUrl).catch(err => {
      log.error('Failed to resend verification email', { error: err });
    });
  }
}

// ─── Password Reset ─────────────────────────────────────────────────────────

export async function forgotPassword(email: string): Promise<void> {
  if (!email || typeof email !== 'string') {
    throw new AppError(400, 'Email обязателен');
  }

  const normalizedEmail = email.trim().toLowerCase();

  const user = await db.queryOne<{ id: string; display_name: string | null }>(
    'SELECT id, display_name FROM users WHERE email = $1 AND is_active = true',
    [normalizedEmail],
  );

  if (!user) return;

  await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.query(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.id, token, expiresAt],
  );

  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
  const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

  sendPasswordResetEmail(normalizedEmail, user.display_name, resetUrl).catch(err => {
    log.error('Failed to send password reset email', { error: err });
  });
}

export async function resetPassword(
  token: string,
  password: string,
  ip?: string,
  userAgent?: string,
): Promise<void> {
  if (!token || typeof token !== 'string') {
    throw new AppError(400, 'Токен обязателен');
  }
  if (!password || typeof password !== 'string') {
    throw new AppError(400, 'Пароль обязателен');
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.valid) {
    throw new AppError(400, `Слабый пароль: ${pwCheck.errors.join(', ')}`, ErrorCode.AUTH_WEAK_PASSWORD);
  }

  const resetToken = await db.queryOne<{ id: string; user_id: string; expires_at: string; used: boolean }>(
    'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
    [token],
  );

  if (!resetToken || resetToken.used || new Date(resetToken.expires_at) < new Date()) {
    throw new AppError(400, 'Ссылка недействительна или устарела', ErrorCode.AUTH_RESET_LINK_EXPIRED);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW(), last_password_change = NOW() WHERE id = $2',
    [passwordHash, resetToken.user_id],
  );
  await db.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [resetToken.id]);
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [resetToken.user_id]);

  blacklistAllUserTokens(resetToken.user_id).catch(err =>
    log.error('Failed to blacklist tokens after password reset', { error: err }),
  );
  // Invalidate auth cache — password changed
  invalidateAuthCache(resetToken.user_id).catch(() => {});

  logAudit({
    userId: resetToken.user_id,
    action: 'password_reset',
    entityType: 'user',
    entityId: resetToken.user_id,
    ip,
    userAgent,
  });
}

// ─── Phone Verification + 2FA ───────────────────────────────────────────────

export async function sendPhoneCode(
  userId: string,
  phone: string,
  purpose: string,
): Promise<{ method: string; expiresIn: number }> {
  if (!phone || typeof phone !== 'string') {
    throw new AppError(400, 'Телефон обязателен');
  }
  if (!['phone_verify', 'two_factor'].includes(purpose)) {
    throw new AppError(400, 'Некорректная цель');
  }

  const normalized = normalizePhone(phone);
  if (normalized.length < 10) {
    throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
  }

  const recentResult = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM verification_codes
     WHERE phone = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [normalized, purpose],
  );
  if (parseInt(recentResult?.count || '0') >= 3) {
    throw new AppError(429, 'Превышен лимит отправки кодов. Подождите 10 минут', ErrorCode.PHONE_SEND_LIMIT);
  }

  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.query(
    `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
     VALUES ($1, $2, $3, 'sms', $4, $5)`,
    [userId, normalized, code, purpose, expiresAt],
  );

  const smsText = `Своё Фото: код подтверждения ${code}. Действует 10 минут.`;
  sendSms(normalized, smsText).catch(err => log.error('PhoneVerify SMS error', { error: err }));

  return { method: 'sms', expiresIn: 600 };
}

export async function verifyPhone(userId: string, phone: string, code: string): Promise<void> {
  if (!phone || !code) {
    throw new AppError(400, 'Телефон и код обязательны');
  }

  const normalized = normalizePhone(phone);

  const record = await db.queryOne<{ id: string; code: string; attempts: number }>(
    `SELECT id, code, attempts FROM verification_codes
     WHERE phone = $1 AND purpose = 'phone_verify' AND user_id = $2
       AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalized, userId],
  );

  if (!record) {
    throw new AppError(400, 'Код недействителен или истёк', ErrorCode.PHONE_CODE_EXPIRED);
  }
  if (record.attempts >= 5) {
    throw new AppError(400, 'Превышено количество попыток', ErrorCode.PHONE_CODE_MAX_ATTEMPTS);
  }
  if (record.code !== code) {
    await db.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    throw new AppError(400, 'Неверный код', ErrorCode.PHONE_CODE_INVALID);
  }

  await db.query('UPDATE verification_codes SET used_at = NOW() WHERE id = $1', [record.id]);
  await db.query(
    'UPDATE users SET phone = $1, phone_verified = true, updated_at = NOW() WHERE id = $2',
    [normalized, userId],
  );
}

export async function enable2fa(userId: string, method: string): Promise<void> {
  if (!['sms', 'telegram'].includes(method)) {
    throw new AppError(400, 'Метод должен быть: sms или telegram');
  }

  const user = await db.queryOne<{ phone_verified: boolean }>(
    'SELECT phone_verified FROM users WHERE id = $1',
    [userId],
  );

  if (!user?.phone_verified) {
    throw new AppError(400, 'Сначала подтвердите телефон');
  }

  await db.query(
    'UPDATE users SET two_factor_enabled = true, two_factor_method = $1, updated_at = NOW() WHERE id = $2',
    [method, userId],
  );
}

export async function disable2fa(userId: string): Promise<void> {
  await db.query(
    'UPDATE users SET two_factor_enabled = false, two_factor_method = NULL, updated_at = NOW() WHERE id = $1',
    [userId],
  );
}

export async function verify2fa(tempToken: string, code: string): Promise<{
  user: UserInfo;
  tokens: TokenPair;
}> {
  if (!tempToken || !code) {
    throw new AppError(400, 'tempToken и код обязательны');
  }

  let decoded: unknown;
  try {
    decoded = verifyJwtDerived(tempToken, '_2fa');
  } catch {
    throw new AppError(401, 'Сессия истекла, войдите заново', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  if (!is2faJwtPayload(decoded)) {
    throw new AppError(401, 'Неверный токен', ErrorCode.AUTH_TOKEN_INVALID);
  }

  const record = await db.queryOne<{ id: string; code: string; attempts: number }>(
    `SELECT id, code, attempts FROM verification_codes
     WHERE phone = $1 AND purpose = 'two_factor' AND user_id = $2
       AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [decoded.phone, decoded.userId],
  );

  if (!record) {
    throw new AppError(400, 'Код недействителен или истёк', ErrorCode.PHONE_CODE_EXPIRED);
  }
  if (record.attempts >= 5) {
    throw new AppError(400, 'Превышено количество попыток', ErrorCode.PHONE_CODE_MAX_ATTEMPTS);
  }
  if (record.code !== code) {
    await db.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    throw new AppError(400, 'Неверный код', ErrorCode.PHONE_CODE_INVALID);
  }

  await db.query('UPDATE verification_codes SET used_at = NOW() WHERE id = $1', [record.id]);

  const user = await db.queryOne<{ id: string; email: string; role: string; display_name: string }>(
    'SELECT id, email, role, display_name FROM users WHERE id = $1',
    [decoded.userId],
  );

  if (!user) {
    throw new AppError(404, 'Пользователь не найден');
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [user.id, tokens.refreshToken],
  );

  return {
    user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
    tokens,
  };
}

// ─── Phone OTP Auth ─────────────────────────────────────────────────────────

export async function phoneCheck(phone: string): Promise<unknown> {
  if (!phone) {
    throw new AppError(400, 'Телефон обязателен');
  }
  const normalized = normalizePhone(phone);
  if (normalized.length < 11) {
    throw new AppError(400, 'Некорректный номер телефона');
  }
  return checkDeliveryChannel(normalized);
}

export async function phoneOtpSend(phone: string): Promise<{ expiresIn: number; provider: string }> {
  if (!phone || typeof phone !== 'string') {
    throw new AppError(400, 'Телефон обязателен');
  }

  const normalized = normalizePhone(phone);
  if (normalized.length < 11) {
    throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
  }

  const recentResult = await db.queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM verification_codes
     WHERE phone = $1 AND purpose = 'phone_login' AND created_at > NOW() - INTERVAL '10 minutes'`,
    [normalized],
  );
  if (parseInt(recentResult?.count || '0') >= 3) {
    throw new AppError(429, 'Превышен лимит отправки кодов. Подождите 10 минут', ErrorCode.PHONE_SEND_LIMIT);
  }

  const ttlSeconds = Math.max(30, config.voximplant.voiceCall.ttlSeconds || 120);
  const code = crypto.randomInt(1000, 9999).toString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  const delivery = await sendVerificationCode(normalized, code, ttlSeconds);
  if (!delivery.success) {
    throw new AppError(503, 'Не удалось отправить код подтверждения. Попробуйте позже.', ErrorCode.PHONE_SEND_FAILED);
  }
  const verificationCode = delivery.verificationCode || code;

  await db.query(
    `UPDATE verification_codes
        SET used_at = NOW()
      WHERE phone = $1 AND purpose = 'phone_login' AND used_at IS NULL`,
    [normalized],
  );

  await db.query(
    `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
     VALUES (NULL, $1, $2, $3, 'phone_login', $4)`,
    [normalized, verificationCode, delivery.provider, expiresAt],
  );

  return { expiresIn: ttlSeconds, provider: delivery.provider };
}

export async function phoneOtpVerify(
  phone: string,
  code: string,
  ip?: string,
  userAgent?: string,
): Promise<PhoneOtpVerifyResult> {
  if (!phone || !code) {
    throw new AppError(400, 'Телефон и код обязательны');
  }
  if (typeof code !== 'string' || !/^\d{4}$/.test(code)) {
    throw new AppError(400, 'Код должен содержать 4 цифры');
  }

  const normalized = normalizePhone(phone);

  const record = await db.queryOne<{ id: string; code: string; attempts: number; method: string }>(
    `SELECT id, code, attempts, method FROM verification_codes
     WHERE phone = $1 AND purpose = 'phone_login'
       AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalized],
  );

  if (!record) {
    throw new AppError(400, 'Код недействителен или истёк. Запросите новый.', ErrorCode.PHONE_CODE_EXPIRED);
  }
  const maxAttempts = record.method === 'flash_call' ? 3 : 5;
  if (record.attempts >= maxAttempts) {
    throw new AppError(400, 'Превышено количество попыток. Запросите новый код.', ErrorCode.PHONE_CODE_MAX_ATTEMPTS);
  }
  if (record.code !== code) {
    await db.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    throw new AppError(400, 'Неверный код', ErrorCode.PHONE_CODE_INVALID);
  }

  await db.query('UPDATE verification_codes SET used_at = NOW() WHERE id = $1', [record.id]);

  let user = await db.queryOne<{
    id: string; email: string | null; role: string; display_name: string | null; is_active: boolean;
  }>(
    'SELECT id, email, role, display_name, is_active FROM users WHERE phone = $1 LIMIT 1',
    [normalized],
  );

  let isNewUser = false;

  if (!user) {
    const newUser = await db.queryOne<{ id: string; role: string; display_name: string | null }>(
      `INSERT INTO users (phone, phone_verified, role, is_active, created_at, updated_at)
       VALUES ($1, true, 'client', true, NOW(), NOW())
       RETURNING id, role, display_name`,
      [normalized],
    );
    if (!newUser) throw new AppError(500, 'Ошибка создания аккаунта');
    user = { ...newUser, email: null, is_active: true };
    isNewUser = true;

    logAudit({
      userId: newUser.id,
      action: 'register_phone',
      entityType: 'user',
      entityId: newUser.id,
      ip,
      userAgent,
    });
  } else {
    if (!user.is_active) {
      throw new AppError(403, 'Аккаунт деактивирован', ErrorCode.AUTH_ACCOUNT_INACTIVE);
    }
    logAudit({
      userId: user.id,
      action: 'login_phone',
      entityType: 'user',
      entityId: user.id,
      ip,
      userAgent,
    });
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [user.id, tokens.refreshToken],
  );

  linkApprovalSessionsByPhone(user.id, normalized).catch(err =>
    log.error('approval link error', { error: err }),
  );

  runPostLoginBackfill(user.id, normalized, user.email).catch(err =>
    log.error('post-login backfill error', { error: err }),
  );

  return {
    user: {
      id: user.id,
      email: user.email || '',
      displayName: user.display_name || '',
      role: user.role,
    },
    tokens,
    isNewUser,
  };
}
