import express, { Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { config } from '../config/index.js';
import db from '../database/db.js';
import { authenticateToken, AuthRequest } from '../middleware/auth.js';
import { getPermissions } from '../config/permissions.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { validate } from '../middleware/validate.js';
import {
  registerSchema, loginSchema, employeeLoginSchema,
  refreshSchema, logoutSchema, resendVerificationSchema,
  forgotPasswordSchema, resetPasswordSchema,
  sendPhoneCodeSchema, verifyPhoneSchema,
  enable2faSchema, verify2faSchema,
  pinSetupSchema, pinUnlockSchema, pinDisableSchema,
  telegramConfirmSchema, appleCallbackSchema,
} from '../schemas/auth.schema.js';
import { sendPasswordResetEmail, sendEmailVerificationEmail, sendLoginAlertEmail, sendRegistrationAttemptEmail } from '../services/email.service.js';
import { sendSms, normalizePhone } from '../services/sms.service.js';
import { logAudit } from '../services/audit.service.js';
import { checkAccountLockout, recordLoginAttempt } from '../services/login-guard.service.js';
import { blacklistToken, blacklistAllUserTokens } from '../services/token-blacklist.service.js';
import { validatePasswordStrength } from '../utils/password-validator.js';
import { createPendingLink, confirmPendingLink } from '../services/oauth-link.service.js';
import { linkApprovalSessionsByPhone } from '../services/approval-counters.service.js';
import { runPostLoginBackfill } from '../services/account-backfill.service.js';
import { invalidateAuthCache } from '../services/auth-cache.service.js';
import { isTelephonySplitReady } from '../services/telephony-split-readiness.service.js';
import { recordPrivacyConsentTx } from '../services/privacy-consent.service.js';
import { signJwt, verifyJwt, verifyJwtDerived } from '../utils/jwt-keys.js';
import { createLogger } from '../utils/logger.js';
import { getStudentDiscountForUser } from '../services/student-discount.service.js';
import { clearAuthCookies, setAuthCookies } from './auth-cookies.js';
import phoneAuthRouter, { getPhoneAuthPublicConfig } from './phone-auth.routes.js';
import type { PrivacyConsentDetailsJsonb } from '../types/jsonb/privacy-consent-jsonb.js';
import type {
  AppleAuthUserRow,
  AuthBasicUserRow,
  AuthCountRow,
  AuthIdRow,
  AuthMeUserRow,
  AuthUserContactRow,
  ClientPinCredentialRow,
  ClientPinSessionRow,
  EmailVerificationUserRow,
  EmployeeLoginUserRow,
  ExistingAuthUserRow,
  GoogleAuthUserRow,
  MtsAuthUserRow,
  PasswordLoginUserRow,
  PasswordResetTokenRow,
  PhoneVerificationCodeRow,
  RefreshTokenUserIdRow,
  RefreshUserRow,
  ResendVerificationUserRow,
  SberAuthUserRow,
  TelegramAuthPollRow,
  TelegramAuthTokenRow,
  TelegramAuthUserRow,
  TwoFactorCodeRow,
  TwoFactorUserRow,
  UserPhoneRow,
  VkAuthUserRow,
  YandexAuthUserRow,
} from '../types/views/auth-route-views.js';

const router = express.Router();

const logger = createLogger('auth.routes');
const TWO_FACTOR_JWT_OPTIONS: SignOptions = { expiresIn: '5m' as StringValue };
const CLIENT_ROLE = 'client';
const PIN_REQUIRED_CODE = 'PIN_REQUIRED';
const PIN_LOCKED_CODE = 'PIN_LOCKED';
const PIN_INVALID_CODE = 'PIN_INVALID';
const PIN_MAX_FAILED_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;
const PIN_UNLOCK_WINDOW_MS = 24 * 60 * 60 * 1000;

interface RefreshSession {
  refreshToken: string;
  refreshTokenHash: string;
  user: RefreshUserRow;
}

interface JwtClaimPayload {
  [claim: string]: unknown;
}

function isJwtClaimPayload(value: unknown): value is JwtClaimPayload {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringClaim(payload: JwtClaimPayload, claim: string): string | null {
  const value = payload[claim];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function getOptionalStudentDiscountForUser(userId: string): Promise<Awaited<ReturnType<typeof getStudentDiscountForUser>> | null> {
  try {
    return await getStudentDiscountForUser(userId);
  } catch (error) {
    logger.warn('[Auth] Failed to load student discount for /me', { error: String(error) });
    return null;
  }
}

function decodeUnsignedJwtPayload(token: string, providerName: string): JwtClaimPayload {
  const decoded = jwt.decode(token);
  if (!isJwtClaimPayload(decoded)) {
    throw new AppError(400, `${providerName}: invalid id_token payload`);
  }
  return decoded;
}

function verifyTokenPayload(token: string): JwtClaimPayload {
  const decoded = verifyJwt(token);
  if (!isJwtClaimPayload(decoded)) {
    throw new AppError(401, 'Invalid token payload', ErrorCode.AUTH_TOKEN_INVALID);
  }
  return decoded;
}

function verifyDerivedTokenPayload(token: string, suffix: string): JwtClaimPayload {
  const decoded = verifyJwtDerived(token, suffix);
  if (!isJwtClaimPayload(decoded)) {
    throw new AppError(401, 'Invalid token payload', ErrorCode.AUTH_TOKEN_INVALID);
  }
  return decoded;
}

// Generate JWT tokens (with kid header for key rotation)
function generateTokens(userId: string, email: string | null, role: string) {
  const accessToken = signJwt(
    { userId, email: email || '', role },
    { expiresIn: config.jwt.expiresIn as StringValue } as SignOptions,
  );

  const refreshToken = signJwt(
    { userId, email, role },
    { expiresIn: config.jwt.refreshExpiresIn as StringValue } as SignOptions,
  );

  return { accessToken, refreshToken };
}

function getRefreshTokenFromRequest(req: Request): string | undefined {
  const bodyToken = req.body && typeof req.body.refreshToken === 'string'
    ? req.body.refreshToken
    : undefined;
  const cookieToken = typeof req.cookies?.['refresh_token'] === 'string'
    ? req.cookies['refresh_token']
    : undefined;
  return bodyToken || cookieToken;
}

function hashRefreshToken(refreshToken: string): string {
  return crypto.createHash('sha256').update(refreshToken).digest('hex');
}

function dateIsInFuture(value: string | Date | null | undefined): boolean {
  if (!value) return false;
  return new Date(value).getTime() > Date.now();
}

function pinUnlockedUntil(): Date {
  return new Date(Date.now() + PIN_UNLOCK_WINDOW_MS);
}

function sendPinRequired(res: Response): void {
  res.status(423).json({
    success: false,
    error: PIN_REQUIRED_CODE,
    code: PIN_REQUIRED_CODE,
    message: 'Введите PIN для продолжения',
  });
}

function sendPinLocked(res: Response, lockedUntil: string | Date | null): void {
  res.status(423).json({
    success: false,
    error: PIN_LOCKED_CODE,
    code: PIN_LOCKED_CODE,
    message: 'PIN временно заблокирован',
    lockedUntil,
  });
}

async function loadRefreshSession(refreshToken: string): Promise<RefreshSession> {
  let decodedUserId: string | null;
  try {
    decodedUserId = readStringClaim(verifyTokenPayload(refreshToken), 'userId');
  } catch {
    throw new AppError(401, 'Invalid or expired refresh token', ErrorCode.AUTH_TOKEN_INVALID);
  }
  if (!decodedUserId) {
    throw new AppError(401, 'Invalid refresh token payload', ErrorCode.AUTH_TOKEN_INVALID);
  }

  const tokenRecord = await db.queryOne<RefreshTokenUserIdRow>(
    'SELECT user_id FROM refresh_tokens WHERE token = $1 AND expires_at > NOW()',
    [refreshToken],
  );

  if (!tokenRecord || tokenRecord.user_id !== decodedUserId) {
    throw new AppError(401, 'Invalid or expired refresh token', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  const user = await db.queryOne<RefreshUserRow>(
    'SELECT id, email, role, is_active FROM users WHERE id = $1',
    [decodedUserId],
  );

  if (!user || !user.is_active) {
    throw new AppError(401, 'User not found or inactive');
  }

  return {
    refreshToken,
    refreshTokenHash: hashRefreshToken(refreshToken),
    user,
  };
}

async function getClientPinCredential(userId: string): Promise<ClientPinCredentialRow | null> {
  return db.queryOne<ClientPinCredentialRow>(
    `SELECT user_id, pin_hash, failed_attempts, locked_until
     FROM client_pin_credentials
     WHERE user_id = $1`,
    [userId],
  );
}

async function getClientPinSession(userId: string, refreshTokenHash: string): Promise<ClientPinSessionRow | null> {
  return db.queryOne<ClientPinSessionRow>(
    `SELECT user_id, refresh_token_hash, unlocked_until, revoked_at
     FROM client_pin_sessions
     WHERE user_id = $1
       AND refresh_token_hash = $2
       AND revoked_at IS NULL
     LIMIT 1`,
    [userId, refreshTokenHash],
  );
}

async function upsertClientPinSession(userId: string, refreshTokenHash: string, unlockedUntil: Date): Promise<void> {
  await db.query(
    `INSERT INTO client_pin_sessions (user_id, refresh_token_hash, unlocked_until, last_used_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (refresh_token_hash)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       unlocked_until = EXCLUDED.unlocked_until,
       last_used_at = NOW(),
       revoked_at = NULL,
       updated_at = NOW()`,
    [userId, refreshTokenHash, unlockedUntil],
  );
}

async function assertClientPinAllowsRefresh(user: RefreshUserRow, refreshTokenHash: string, res: Response): Promise<boolean> {
  if (user.role !== CLIENT_ROLE) {
    return true;
  }

  const credential = await getClientPinCredential(user.id);
  if (!credential) {
    return true;
  }

  if (dateIsInFuture(credential.locked_until)) {
    sendPinLocked(res, credential.locked_until);
    return false;
  }

  const session = await getClientPinSession(user.id, refreshTokenHash);
  if (!session || !dateIsInFuture(session.unlocked_until)) {
    sendPinRequired(res);
    return false;
  }

  return true;
}

async function rotateRefreshSessionTokens(session: RefreshSession): Promise<{ accessToken: string; refreshToken: string }> {
  const { accessToken, refreshToken: newRefreshToken } = generateTokens(
    session.user.id,
    session.user.email || '',
    session.user.role,
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await db.query(
    `UPDATE refresh_tokens
     SET token = $1, expires_at = $2
     WHERE token = $3`,
    [newRefreshToken, expiresAt, session.refreshToken],
  );

  if (session.user.role === CLIENT_ROLE) {
    await db.query(
      `UPDATE client_pin_sessions
       SET refresh_token_hash = $1, last_used_at = NOW(), updated_at = NOW()
       WHERE user_id = $2
         AND refresh_token_hash = $3
         AND revoked_at IS NULL`,
      [hashRefreshToken(newRefreshToken), session.user.id, session.refreshTokenHash],
    );
  }

  return { accessToken, refreshToken: newRefreshToken };
}

/**
 * Check audit_log for previous login from this IP. If new — send alert email.
 * Fire-and-forget — does not block login response.
 */
function checkNewIpAndAlert(userId: string, email: string, displayName: string | null, ip: string | undefined, userAgent: string): void {
  if (!ip || !email) return;
  db.queryOne<AuthIdRow>(
    `SELECT id FROM audit_log
     WHERE user_id = $1 AND action IN ('login_email', 'login_employee')
       AND ip = $2 AND created_at > NOW() - INTERVAL '90 days'
     LIMIT 1`,
    [userId, ip]
  ).then(existing => {
    if (!existing) {
      sendLoginAlertEmail(email, displayName, ip, userAgent, new Date()).catch(err =>
        logger.error('[LoginAlert] Failed to send:', err.message)
      );
    }
  }).catch(err => logger.error('[LoginAlert] IP check error:', err.message));
}

// Helper: redirect to mobile app via HTML+JS (more reliable than 302 for custom schemes)
function mobileRedirect(res: Response, accessToken: string, refreshToken: string): void {
  const appUrl = `svoefoto://auth/callback?accessToken=${accessToken}&refreshToken=${refreshToken}`;
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Авторизация...</title></head><body>
<script>window.location.replace("${appUrl}");</script>
<p style="text-align:center;margin-top:40px;font-family:sans-serif">
Перенаправляем в приложение...<br><br>
<a href="${appUrl}" style="color:#2AABEE;font-size:18px">Нажмите, если не перешли автоматически</a>
</p></body></html>`);
}

// Helper: set tokens as httpOnly cookies and redirect without tokens in URL
function oauthRedirectWithCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
  frontendUrl: string,
  isMobile: boolean,
): void {
  if (isMobile) {
    mobileRedirect(res, accessToken, refreshToken);
    return;
  }
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    maxAge: 60_000, // 60 seconds — just enough for frontend to pick up
    path: '/',
  };
  res.cookie('oauth_at', accessToken, cookieOpts);
  res.cookie('oauth_rt', refreshToken, cookieOpts);
  res.redirect(`${frontendUrl}/auth/callback`);
}

// Helper: redirect to pending OAuth link page
function oauthPendingRedirect(res: Response, frontendUrl: string, maskedEmail: string): void {
  res.redirect(`${frontendUrl}/auth/oauth-pending?email=${encodeURIComponent(maskedEmail)}`);
}

// GET /api/auth/providers — public endpoint, возвращает список настроенных OAuth-провайдеров.
// Кнопки на фронтенде показываются ТОЛЬКО для провайдеров из этого списка.
router.get('/providers', async (req: Request, res: Response): Promise<void> => {
  interface ProviderInfo { id: string; name: string; url: string; }
  const providers: ProviderInfo[] = [];

  if (config.yandex.clientId && config.yandex.clientSecret) {
    providers.push({ id: 'yandex', name: 'Яндекс ID', url: '/api/auth/yandex' });
  }
  if (config.google.clientId && config.google.clientSecret) {
    providers.push({ id: 'google', name: 'Google', url: '/api/auth/google' });
  }
  if (config.vk.clientId && config.vk.clientSecret) {
    providers.push({ id: 'vk', name: 'VK ID', url: '/api/auth/vk' });
  }
  if (config.sber.clientId && config.sber.clientSecret) {
    providers.push({ id: 'sber', name: 'Сбер ID', url: '/api/auth/sber' });
  }
  if (config.mts.clientId && config.mts.clientSecret) {
    providers.push({ id: 'mts', name: 'МТС ID', url: '/api/auth/mts' });
  }
  if (config.apple.clientId && config.apple.clientSecret) {
    providers.push({ id: 'apple', name: 'Apple', url: '/api/auth/apple' });
  }

  const phoneAuth = await getPhoneAuthPublicConfig({ liveAvailability: true });
  if (config.role === 'api' && phoneAuth.available) {
    phoneAuth.available = await isTelephonySplitReady();
  }

  res.json({ success: true, data: providers, phoneAuth });
});

router.use((req, res, next) => {
  if (config.role !== 'monolith') {
    next();
    return;
  }

  phoneAuthRouter(req, res, next);
});

// Yandex OAuth login - redirect to Yandex
router.get('/yandex', (req: Request, res: Response): void => {
  const isMobile = req.query['mobile'] === '1';
  const state = isMobile ? 'mobile' : 'web';
  const authUrl = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${config.yandex.clientId}&redirect_uri=${encodeURIComponent(config.yandex.redirectUri)}&state=${state}`;
  res.redirect(authUrl);
});

// Yandex OAuth callback
router.get('/yandex/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query;

  if (!code || typeof code !== 'string') {
    throw new AppError(400, 'Authorization code missing', ErrorCode.AUTH_CODE_MISSING);
  }

  // Exchange code for access token
  const tokenResponse = await axios.post('https://oauth.yandex.ru/token', {
    grant_type: 'authorization_code',
    code,
    client_id: config.yandex.clientId,
    client_secret: config.yandex.clientSecret,
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    proxy: false,
  });

  const { access_token: yandexAccessToken } = tokenResponse.data;

  // Get user info from Yandex
  const userResponse = await axios.get('https://login.yandex.ru/info', {
    headers: { Authorization: `OAuth ${yandexAccessToken}` },
    params: { format: 'json' },
    proxy: false,
  });

  const yandexUser = userResponse.data;
  const yandexId = yandexUser.id;
  const email = yandexUser.default_email || yandexUser.emails?.[0];
  const displayName = yandexUser.display_name || yandexUser.real_name || email?.split('@')[0];

  if (!email) {
    throw new AppError(400, 'Email not found in Yandex account');
  }

  // Find or create user
  let user = await db.queryOne<YandexAuthUserRow>(
    'SELECT id, email, role, yandex_id FROM users WHERE yandex_id = $1 OR email = $2',
    [yandexId, email]
  );

  const isMobile = state === 'mobile';
  const frontendUrl = (config.cors.origin || 'http://localhost:4200').split(',')[0];

  if (!user) {
    // Create new user
    const userId = uuidv4();
    await db.query(
      `INSERT INTO users (id, email, display_name, yandex_id, yandex_email, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, email, displayName, yandexId, email, 'client', true, true]
    );
    user = { id: userId, email, role: 'client', yandex_id: yandexId };
  } else if (user.yandex_id && user.yandex_id === yandexId) {
    // Already linked — proceed to login
  } else if (!user.yandex_id) {
    // Email match but no yandex_id — require confirmation
    const { maskedEmail } = await createPendingLink(user.id, user.email, displayName, 'yandex', yandexId, req.ip);
    oauthPendingRedirect(res, frontendUrl, maskedEmail);
    return;
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);

  // Save refresh token
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, isMobile);
});

// Google OAuth login - redirect to Google
router.get('/google', (req: Request, res: Response): void => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id=${config.google.clientId}&redirect_uri=${encodeURIComponent(config.google.redirectUri)}&scope=openid%20email%20profile`;
  res.redirect(authUrl);
});

// Google OAuth callback
router.get('/google/callback', async (req: Request, res: Response): Promise<void> => {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    throw new AppError(400, 'Authorization code missing', ErrorCode.AUTH_CODE_MISSING);
  }

  // Exchange code for access token
  const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
    grant_type: 'authorization_code',
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: config.google.redirectUri,
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    proxy: false,
  });

  const { access_token: googleAccessToken } = tokenResponse.data;

  // Get user info from Google
  const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${googleAccessToken}` },
    proxy: false,
  });

  const googleUser = userResponse.data;
  const googleId = googleUser.id;
  const email = googleUser.email;
  const displayName = googleUser.name || googleUser.given_name || email?.split('@')[0];

  if (!email) {
    throw new AppError(400, 'Email not found in Google account');
  }

  // Find or create user
  let user = await db.queryOne<GoogleAuthUserRow>(
    'SELECT id, email, role, google_id FROM users WHERE google_id = $1 OR email = $2',
    [googleId, email]
  );

  const frontendUrl = (config.cors.origin || 'http://localhost:4200').split(',')[0];

  if (!user) {
    // Create new user
    const userId = uuidv4();
    await db.query(
      `INSERT INTO users (id, email, display_name, google_id, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, email, displayName, googleId, 'client', true, true]
    );
    user = { id: userId, email, role: 'client', google_id: googleId };
  } else if (user.google_id && user.google_id === googleId) {
    // Already linked — proceed to login
  } else if (!user.google_id) {
    // Email match but no google_id — require confirmation
    const { maskedEmail } = await createPendingLink(user.id, user.email, displayName, 'google', googleId, req.ip);
    oauthPendingRedirect(res, frontendUrl, maskedEmail);
    return;
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);

  // Save refresh token
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, false);
});

// Apple OAuth login - redirect to Apple
router.get('/apple', (req: Request, res: Response): void => {
  const authUrl = `https://appleid.apple.com/auth/authorize?response_type=code&client_id=${config.apple.clientId}&redirect_uri=${encodeURIComponent(config.apple.redirectUri)}&scope=email%20name&response_mode=form_post`;
  res.redirect(authUrl);
});

// Apple OAuth callback
router.post('/apple/callback', validate(appleCallbackSchema), async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body;

  // Exchange code for access token
  const tokenResponse = await axios.post('https://appleid.apple.com/auth/token', {
    grant_type: 'authorization_code',
    code,
    client_id: config.apple.clientId,
    client_secret: config.apple.clientSecret,
    redirect_uri: config.apple.redirectUri,
  }, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const { access_token: appleAccessToken, id_token: idToken } = tokenResponse.data;

  // Decode ID token to get user info
  const decodedToken = decodeUnsignedJwtPayload(idToken, 'Apple ID');
  const appleId = readStringClaim(decodedToken, 'sub');
  const email = readStringClaim(decodedToken, 'email');

  if (!appleId) {
    throw new AppError(400, 'Apple ID not found in Apple account');
  }

  if (!email) {
    throw new AppError(400, 'Email not found in Apple account');
  }

  const displayName = email?.split('@')[0];

  // Find or create user
  let user = await db.queryOne<AppleAuthUserRow>(
    'SELECT id, email, role, apple_id FROM users WHERE apple_id = $1 OR email = $2',
    [appleId, email]
  );

  const frontendUrl = (config.cors.origin || 'http://localhost:4200').split(',')[0];

  if (!user) {
    // Create new user
    const userId = uuidv4();
    await db.query(
      `INSERT INTO users (id, email, display_name, apple_id, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, email, displayName, appleId, 'client', true, true]
    );
    user = { id: userId, email, role: 'client', apple_id: appleId };
  } else if (user.apple_id && user.apple_id === appleId) {
    // Already linked — proceed to login
  } else if (!user.apple_id) {
    // Email match but no apple_id — require confirmation
    const { maskedEmail } = await createPendingLink(user.id, user.email, displayName, 'apple', appleId, req.ip);
    oauthPendingRedirect(res, frontendUrl, maskedEmail);
    return;
  }

  // Generate tokens
  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);

  // Save refresh token
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, false);
});

// VK ID login — PKCE (id.vk.ru, RFC 7636)
router.get('/vk', (req: Request, res: Response): void => {
  const isMobile = req.query['mobile'] === '1';

  // Generate PKCE code_verifier (64 URL-safe chars)
  const codeVerifier = crypto.randomBytes(48).toString('base64url').slice(0, 64);

  // code_challenge = BASE64URL(SHA256(code_verifier))
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  // State: prefix encodes mobile flag + 48 random hex chars
  const state = (isMobile ? 'm_' : 'w_') + crypto.randomBytes(24).toString('hex');

  // Store verifier and state in HTTP-only cookies (10 min TTL)
  const cookieOpts = { httpOnly: true, secure: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' as const };
  res.cookie('vk_pkce', codeVerifier, cookieOpts);
  res.cookie('vk_state', state, cookieOpts);

  const authUrl = 'https://id.vk.ru/authorize'
    + '?response_type=code'
    + `&client_id=${config.vk.clientId}`
    + `&redirect_uri=${encodeURIComponent(config.vk.redirectUri)}`
    + `&code_challenge=${encodeURIComponent(codeChallenge)}`
    + '&code_challenge_method=S256'
    + `&state=${encodeURIComponent(state)}`
    + '&scope=email+phone';
  res.redirect(authUrl);
});

// VK ID callback — PKCE
router.get('/vk/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state, device_id } = req.query;

  if (!code || typeof code !== 'string') {
    throw new AppError(400, 'Authorization code missing', ErrorCode.AUTH_CODE_MISSING);
  }

  const storedState = req.cookies?.['vk_state'];
  const codeVerifier = req.cookies?.['vk_pkce'];

  // Verify state to prevent CSRF
  if (!storedState || typeof state !== 'string' || state !== storedState) {
    throw new AppError(400, 'Invalid state parameter');
  }

  if (!codeVerifier) {
    throw new AppError(400, 'PKCE code_verifier missing');
  }

  const isMobile = storedState.startsWith('m_');

  // Clear PKCE cookies immediately
  res.clearCookie('vk_pkce', { httpOnly: true, secure: true, sameSite: 'lax' });
  res.clearCookie('vk_state', { httpOnly: true, secure: true, sameSite: 'lax' });

  // Exchange code for token via VK ID PKCE (no client_secret — PKCE replaces it)
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    client_id: config.vk.clientId,
    redirect_uri: config.vk.redirectUri,
    state,
    ...(device_id && typeof device_id === 'string' ? { device_id } : {}),
  });

  const tokenResponse = await axios.post('https://id.vk.ru/oauth2/auth',
    tokenParams.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, proxy: false }
  );

  const { access_token: vkAccessToken } = tokenResponse.data;

  if (!vkAccessToken) {
    throw new AppError(400, 'VK ID token exchange failed');
  }

  // Get user info
  const userResponse = await axios.post('https://id.vk.ru/oauth2/user_info',
    new URLSearchParams({ client_id: config.vk.clientId, access_token: vkAccessToken }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, proxy: false }
  );

  const vkUser = userResponse.data?.user;
  if (!vkUser?.user_id) {
    throw new AppError(400, 'VK ID user info not found');
  }

  const vkId = String(vkUser.user_id);
  const email: string | null = vkUser.email || null;
  const phone: string | null = vkUser.phone || null;
  const displayName = `${vkUser.first_name || ''} ${vkUser.last_name || ''}`.trim()
    || email?.split('@')[0]
    || `vk_${vkId}`;

  // Find or create user
  const lookupEmail = email ? email.toLowerCase() : null;
  let user = await db.queryOne<VkAuthUserRow>(
    `SELECT id, email, role, vk_id FROM users WHERE vk_id = $1${lookupEmail ? ' OR LOWER(email) = $2' : ''}`,
    lookupEmail ? [vkId, lookupEmail] : [vkId]
  );

  const frontendUrl = (config.cors.origin || 'http://localhost:4200').split(',')[0];

  if (!user) {
    const userId = uuidv4();
    const userEmail = email || (phone ? `${phone.replace(/\D/g, '')}@vk.local` : `vk_${vkId}@vk.local`);
    await db.query(
      `INSERT INTO users (id, email, display_name, vk_id, phone, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, userEmail, displayName, vkId, phone || null, 'client', !!email, true]
    );
    user = { id: userId, email: userEmail, role: 'client', vk_id: vkId };
  } else if (user.vk_id && user.vk_id === vkId) {
    // Already linked — proceed to login
  } else if (!user.vk_id) {
    // Email match but no vk_id — require confirmation
    const { maskedEmail } = await createPendingLink(user.id, user.email, displayName, 'vk', vkId, req.ip);
    oauthPendingRedirect(res, frontendUrl, maskedEmail);
    return;
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  // Auto-link approval sessions by phone (VK)
  if (phone) {
    linkApprovalSessionsByPhone(user.id, phone).catch(err =>
      logger.error('[Auth] approval link error:', err.message)
    );
  }

  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, isMobile);
});

// Сбер ID — OpenID Connect (https://developer.sberbank.ru/doc/v1/sberid/overview)
router.get('/sber', (req: Request, res: Response): void => {
  const isMobile = req.query['mobile'] === '1';
  const state = isMobile ? 'mobile' : 'web';
  const nonce = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://id.sber.ru/CSAFront/oidc/authorize`
    + `?response_type=code`
    + `&client_id=${encodeURIComponent(config.sber.clientId)}`
    + `&redirect_uri=${encodeURIComponent(config.sber.redirectUri)}`
    + `&scope=openid%20name%20email%20mobile`
    + `&state=${state}`
    + `&nonce=${nonce}`;
  res.redirect(authUrl);
});

router.get('/sber/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query;

  if (!code || typeof code !== 'string') {
    throw new AppError(400, 'Authorization code missing', ErrorCode.AUTH_CODE_MISSING);
  }

  // Exchange code for tokens
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.sber.clientId,
    client_secret: config.sber.clientSecret,
    redirect_uri: config.sber.redirectUri,
  });
  const tokenResponse = await axios.post('https://id.sber.ru/CSAFront/oidc/token',
    tokenParams.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, proxy: false }
  );

  const { id_token: idToken } = tokenResponse.data;
  if (!idToken) throw new AppError(400, 'Сбер ID: id_token not received');

  const decoded = decodeUnsignedJwtPayload(idToken, 'Сбер ID');
  const decodedSub = readStringClaim(decoded, 'sub');
  if (!decodedSub) throw new AppError(400, 'Сбер ID: sub not found in token');

  const sberId = decodedSub;
  const email = readStringClaim(decoded, 'email');
  const phone = readStringClaim(decoded, 'phone_number');
  const displayName = readStringClaim(decoded, 'name') || email?.split('@')[0] || `sber_${sberId}`;

  const lookupEmail = email ? email.toLowerCase() : null;
  let user = await db.queryOne<SberAuthUserRow>(
    `SELECT id, email, role, sber_id FROM users WHERE sber_id = $1${lookupEmail ? ' OR LOWER(email) = $2' : ''}`,
    lookupEmail ? [sberId, lookupEmail] : [sberId]
  );

  const frontendUrl = (config.cors.origin || 'http://localhost:4200').split(',')[0];

  if (!user) {
    const userId = uuidv4();
    const userEmail = email || (phone ? `${phone.replace(/\D/g, '')}@sber.local` : `sber_${sberId}@sber.local`);
    await db.query(
      `INSERT INTO users (id, email, display_name, sber_id, phone, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, userEmail, displayName, sberId, phone || null, 'client', !!email, true]
    );
    user = { id: userId, email: userEmail, role: 'client', sber_id: sberId };
  } else if (user.sber_id && user.sber_id === sberId) {
    // Already linked — proceed to login
  } else if (!user.sber_id) {
    // Email match but no sber_id — require confirmation
    const { maskedEmail } = await createPendingLink(user.id, user.email, displayName, 'sber', sberId, req.ip);
    oauthPendingRedirect(res, frontendUrl, maskedEmail);
    return;
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  // Auto-link approval sessions by phone (Sber)
  if (phone) {
    linkApprovalSessionsByPhone(user.id, phone).catch(err =>
      logger.error('[Auth] approval link error:', err.message)
    );
  }

  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, state === 'mobile');
});

// МТС ID — OpenID Connect (https://login.mts.ru)
router.get('/mts', (req: Request, res: Response): void => {
  const isMobile = req.query['mobile'] === '1';
  const state = isMobile ? 'mobile' : 'web';
  const nonce = crypto.randomBytes(16).toString('hex');
  const authUrl = `https://login.mts.ru/amserver/oauth2/authorize`
    + `?response_type=code`
    + `&client_id=${encodeURIComponent(config.mts.clientId)}`
    + `&redirect_uri=${encodeURIComponent(config.mts.redirectUri)}`
    + `&scope=openid%20profile%20phone%20email`
    + `&state=${state}`
    + `&nonce=${nonce}`;
  res.redirect(authUrl);
});

router.get('/mts/callback', async (req: Request, res: Response): Promise<void> => {
  const { code, state } = req.query;

  if (!code || typeof code !== 'string') {
    throw new AppError(400, 'Authorization code missing', ErrorCode.AUTH_CODE_MISSING);
  }

  // Exchange code for tokens
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.mts.clientId,
    client_secret: config.mts.clientSecret,
    redirect_uri: config.mts.redirectUri,
  });
  const tokenResponse = await axios.post('https://login.mts.ru/amserver/oauth2/access_token',
    tokenParams.toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, proxy: false }
  );

  const { access_token: mtsAccessToken } = tokenResponse.data;
  if (!mtsAccessToken) throw new AppError(400, 'МТС ID: access_token not received');

  // Get user info
  const userResponse = await axios.get('https://login.mts.ru/amserver/oauth2/userinfo', {
    headers: { Authorization: `Bearer ${mtsAccessToken}` },
    proxy: false,
  });

  const mtsUser = userResponse.data;
  if (!mtsUser?.sub) throw new AppError(400, 'МТС ID: sub not found in userinfo');

  const mtsId = String(mtsUser.sub);
  const email: string | null = mtsUser.email || null;
  const phone: string | null = mtsUser.phone_number || null;
  const displayName: string = mtsUser.name || mtsUser.given_name
    || email?.split('@')[0] || `mts_${mtsId}`;

  const lookupEmail = email ? email.toLowerCase() : null;
  let user = await db.queryOne<MtsAuthUserRow>(
    `SELECT id, email, role, mts_id FROM users WHERE mts_id = $1${lookupEmail ? ' OR LOWER(email) = $2' : ''}`,
    lookupEmail ? [mtsId, lookupEmail] : [mtsId]
  );

  const frontendUrl = (config.cors.origin || 'http://localhost:4200').split(',')[0];

  if (!user) {
    const userId = uuidv4();
    const userEmail = email || (phone ? `${phone.replace(/\D/g, '')}@mts.local` : `mts_${mtsId}@mts.local`);
    await db.query(
      `INSERT INTO users (id, email, display_name, mts_id, phone, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, userEmail, displayName, mtsId, phone || null, 'client', !!email, true]
    );
    user = { id: userId, email: userEmail, role: 'client', mts_id: mtsId };
  } else if (user.mts_id && user.mts_id === mtsId) {
    // Already linked — proceed to login
  } else if (!user.mts_id) {
    // Email match but no mts_id — require confirmation
    const { maskedEmail } = await createPendingLink(user.id, user.email, displayName, 'mts', mtsId, req.ip);
    oauthPendingRedirect(res, frontendUrl, maskedEmail);
    return;
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  // Auto-link approval sessions by phone (MTS)
  if (phone) {
    linkApprovalSessionsByPhone(user.id, phone).catch(err =>
      logger.error('[Auth] approval link error:', err.message)
    );
  }

  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, state === 'mobile');
});

// Telegram Login - serve widget page (web only)
router.get('/telegram', (req: Request, res: Response): void => {
  const callbackUrl = `https://svoefoto.ru/api/auth/telegram/callback`;
  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вход через Telegram — Своё Фото</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { display: flex; justify-content: center; align-items: center; min-height: 100vh;
    font-family: -apple-system, system-ui, 'Segoe UI', sans-serif;
    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); }
  .card { background: white; border-radius: 16px; padding: 48px 40px; text-align: center;
    box-shadow: 0 4px 24px rgba(0,0,0,0.08); max-width: 380px; width: 90%; }
  .logo { font-size: 28px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }
  .subtitle { color: #666; font-size: 15px; margin-bottom: 32px; line-height: 1.5; }
  .tg-wrap { display: flex; justify-content: center; }
</style>
</head><body>
<div class="card">
  <div class="logo">Своё Фото</div>
  <div class="subtitle">Нажмите кнопку для авторизации<br>через Telegram</div>
  <div class="tg-wrap">
    <script async src="https://telegram.org/js/telegram-widget.js?22"
      data-telegram-login="${config.telegram.botUsername}"
      data-size="large"
      data-radius="8"
      data-auth-url="${callbackUrl}"
      data-request-access="write"></script>
  </div>
</div>
</body></html>`;
  res.send(html);
});

// Telegram Login Widget callback (web only)
router.get('/telegram/callback', async (req: Request, res: Response): Promise<void> => {
  const { hash } = req.query;

  if (!hash || typeof hash !== 'string') {
    throw new AppError(400, 'Missing hash');
  }

  // Build data-check-string (all params except hash, sorted)
  const dataCheckArr: string[] = [];
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== 'hash' && value) {
      dataCheckArr.push(`${key}=${value}`);
    }
  }
  dataCheckArr.sort();
  const dataCheckString = dataCheckArr.join('\n');

  // Verify HMAC-SHA256
  const secretKey = crypto.createHash('sha256').update(config.telegram.botToken).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (hmac !== hash) {
    throw new AppError(403, 'Invalid authentication data', ErrorCode.FORBIDDEN);
  }

  // Check freshness (1 hour max)
  const authDate = parseInt(req.query['auth_date'] as string, 10);
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > 3600) {
    throw new AppError(403, 'Authentication data expired', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  const telegramId = req.query['id'] as string;
  const firstName = req.query['first_name'] as string || '';
  const lastName = req.query['last_name'] as string || '';
  const tgUsername = req.query['username'] as string || '';
  const photoUrl = req.query['photo_url'] as string || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || tgUsername || `tg_${telegramId}`;

  let user = await db.queryOne<TelegramAuthUserRow>(
    'SELECT id, email, role, telegram_id FROM users WHERE telegram_id = $1',
    [telegramId]
  );

  if (!user) {
    const userId = uuidv4();
    const placeholderEmail = tgUsername ? `${tgUsername}@t.me` : `tg${telegramId}@t.me`;
    await db.query(
      `INSERT INTO users (id, email, display_name, telegram_id, telegram_username, photo_url, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, placeholderEmail, displayName, telegramId, tgUsername || null, photoUrl || null, 'client', false, true]
    );
    user = { id: userId, email: placeholderEmail, role: 'client', telegram_id: telegramId };
  } else {
    await db.query(
      'UPDATE users SET display_name = $1, photo_url = COALESCE($2, photo_url), telegram_username = $3 WHERE telegram_id = $4',
      [displayName, photoUrl || null, tgUsername || null, telegramId]
    );
  }

  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  const frontendUrl = (config.cors.origin || 'http://localhost:4200').split(',')[0];
  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, false);
});

// Telegram bot-based auth: init login token (mobile)
router.post('/telegram/init', async (req: Request, res: Response): Promise<void> => {
  // Telegram deep link payload limit: 64 chars. "login_" = 6 chars, so token max 58 chars (29 bytes hex)
  const token = crypto.randomBytes(29).toString('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await db.query(
    `INSERT INTO telegram_auth_tokens (token, status, expires_at) VALUES ($1, 'pending', $2)`,
    [token, expiresAt]
  );

  res.json({
    success: true,
    data: {
      token,
      botUsername: config.telegram.botUsername,
      deepLink: `https://t.me/${config.telegram.botUsername}?start=login_${token}`,
      expiresAt: expiresAt.toISOString(),
    }
  });
});

// Telegram bot-based auth: poll for result (mobile)
router.get('/telegram/check', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    throw new AppError(400, 'Token required');
  }

  const record = await db.queryOne<TelegramAuthPollRow>(
    `SELECT status, access_token, refresh_token, expires_at FROM telegram_auth_tokens WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (!record) {
    throw new AppError(404, 'Token not found or expired', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  if (record.status === 'confirmed' && record.access_token && record.refresh_token) {
    // Mark as used so it can't be polled again
    await db.query(`UPDATE telegram_auth_tokens SET status = 'used' WHERE token = $1`, [token]);

    res.json({
      success: true,
      data: {
        status: 'confirmed',
        accessToken: record.access_token,
        refreshToken: record.refresh_token,
      }
    });
    return;
  }

  res.json({ success: true, data: { status: record.status } });
});

// Telegram bot-based auth: confirm login (called by PHP webhook handler)
router.post('/telegram/confirm', validate(telegramConfirmSchema), async (req: Request, res: Response): Promise<void> => {
  const { token, telegramId, firstName, lastName, username, photoUrl } = req.body;

  // Validate token exists and is pending
  const authToken = await db.queryOne<TelegramAuthTokenRow>(
    `SELECT id, status, expires_at FROM telegram_auth_tokens WHERE token = $1 AND expires_at > NOW()`,
    [token]
  );

  if (!authToken) {
    throw new AppError(404, 'Token not found or expired', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  if (authToken.status !== 'pending') {
    throw new AppError(409, 'Token already used', ErrorCode.AUTH_TOKEN_INVALID);
  }

  const tgUsername = username || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || tgUsername || `tg_${telegramId}`;

  // Find or create user
  let user = await db.queryOne<AuthBasicUserRow>(
    'SELECT id, email, role FROM users WHERE telegram_id = $1',
    [telegramId]
  );

  if (!user) {
    const userId = uuidv4();
    const placeholderEmail = tgUsername ? `${tgUsername}@t.me` : `tg${telegramId}@t.me`;
    await db.query(
      `INSERT INTO users (id, email, display_name, telegram_id, telegram_username, photo_url, role, email_verified, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [userId, placeholderEmail, displayName, telegramId, tgUsername || null, photoUrl || null, 'client', false, true]
    );
    user = { id: userId, email: placeholderEmail, role: 'client' };
  } else {
    await db.query(
      'UPDATE users SET display_name = $1, photo_url = COALESCE($2, photo_url), telegram_username = $3 WHERE telegram_id = $4',
      [displayName, photoUrl || null, tgUsername || null, telegramId]
    );
  }

  // Generate JWT tokens
  const { accessToken, refreshToken } = generateTokens(user.id, user.email || '', user.role);

  // Save refresh token
  const refreshExpiresAt = new Date();
  refreshExpiresAt.setDate(refreshExpiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [user.id, refreshToken, refreshExpiresAt, req.ip, req.get('user-agent') || 'telegram-bot']
  );

  // Update auth token with JWT tokens and mark as confirmed
  await db.query(
    `UPDATE telegram_auth_tokens
     SET status = 'confirmed', telegram_id = $2, telegram_username = $3,
         telegram_first_name = $4, telegram_last_name = $5, telegram_photo_url = $6,
         access_token = $7, refresh_token = $8, user_id = $9, confirmed_at = NOW()
     WHERE token = $1`,
    [token, telegramId, tgUsername || null, firstName || null, lastName || null, photoUrl || null,
     accessToken, refreshToken, user.id]
  );

  logger.info(`Telegram bot auth confirmed for user ${telegramId} (${displayName})`);

  res.json({ success: true, userId: user.id });
});

// ─── Exchange OAuth cookies for tokens (Part 2: token safety) ───
router.post('/exchange-oauth-cookies', (req: Request, res: Response): void => {
  const accessToken = req.cookies?.['oauth_at'];
  const refreshToken = req.cookies?.['oauth_rt'];

  if (!accessToken || !refreshToken) {
    throw new AppError(400, 'OAuth cookies not found');
  }

  // Clear cookies immediately
  const clearOpts = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };
  res.clearCookie('oauth_at', clearOpts);
  res.clearCookie('oauth_rt', clearOpts);

  res.json({ success: true, data: { accessToken, refreshToken } });
});

// ─── Confirm pending OAuth link (Part 1: account takeover fix) ───
router.get('/confirm-oauth-link', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    throw new AppError(400, 'Token required');
  }

  const result = await confirmPendingLink(token);
  if (!result) {
    const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
    res.redirect(`${frontendUrl}/auth/login?error=link_expired`);
    return;
  }

  // Generate JWT tokens for the now-linked user
  const { accessToken, refreshToken } = generateTokens(result.userId, result.email, result.role);

  // Save refresh token
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [result.userId, refreshToken, expiresAt, req.ip, req.get('user-agent') || '']
  );

  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
  oauthRedirectWithCookies(res, accessToken, refreshToken, frontendUrl, false);
});

// Refresh token
router.post('/refresh', validate(refreshSchema), async (req: Request, res: Response): Promise<void> => {
  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) {
    throw new AppError(401, 'Refresh token required', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  const session = await loadRefreshSession(refreshToken);
  const pinAllowsRefresh = await assertClientPinAllowsRefresh(session.user, session.refreshTokenHash, res);
  if (!pinAllowsRefresh) {
    return;
  }

  const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshSessionTokens(session);

  // Set httpOnly cookies + return tokens in body (transition/mobile)
  setAuthCookies(res, accessToken, newRefreshToken);

  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken: newRefreshToken,
    },
  });
});

// Client PIN status
router.get('/pin/status', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  if (req.user.role !== CLIENT_ROLE) {
    res.json({
      success: true,
      data: {
        enabled: false,
        setupAvailable: false,
        unlockRequired: false,
        lockedUntil: null,
      },
    });
    return;
  }

  const credential = await getClientPinCredential(req.user.id);
  res.json({
    success: true,
    data: {
      enabled: Boolean(credential),
      setupAvailable: true,
      unlockRequired: false,
      lockedUntil: credential?.locked_until ?? null,
    },
  });
});

// Setup or change client PIN and unlock the current refresh session
router.post('/pin/setup', authenticateToken, validate(pinSetupSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }
  if (req.user.role !== CLIENT_ROLE) {
    throw new AppError(403, 'PIN is available only for clients');
  }

  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) {
    throw new AppError(401, 'Refresh token required', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  const session = await loadRefreshSession(refreshToken);
  if (session.user.id !== req.user.id) {
    throw new AppError(401, 'Refresh token user mismatch', ErrorCode.AUTH_TOKEN_INVALID);
  }

  const pinHash = await bcrypt.hash(req.body.pin, 10);
  await db.query(
    `INSERT INTO client_pin_credentials (user_id, pin_hash, failed_attempts, locked_until)
     VALUES ($1, $2, 0, NULL)
     ON CONFLICT (user_id)
     DO UPDATE SET
       pin_hash = EXCLUDED.pin_hash,
       failed_attempts = 0,
       locked_until = NULL,
       updated_at = NOW()`,
    [req.user.id, pinHash],
  );

  await upsertClientPinSession(req.user.id, session.refreshTokenHash, pinUnlockedUntil());

  res.json({
    success: true,
    data: {
      enabled: true,
      setupAvailable: true,
      unlockRequired: false,
      lockedUntil: null,
    },
  });
});

// Unlock a client refresh session with PIN and issue fresh tokens
router.post('/pin/unlock', validate(pinUnlockSchema), async (req: Request, res: Response): Promise<void> => {
  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) {
    throw new AppError(401, 'Refresh token required', ErrorCode.AUTH_TOKEN_EXPIRED);
  }

  const session = await loadRefreshSession(refreshToken);
  if (session.user.role !== CLIENT_ROLE) {
    throw new AppError(403, 'PIN is available only for clients');
  }

  const credential = await getClientPinCredential(session.user.id);
  if (!credential) {
    throw new AppError(409, 'PIN is not configured');
  }

  if (dateIsInFuture(credential.locked_until)) {
    sendPinLocked(res, credential.locked_until);
    return;
  }

  const valid = await bcrypt.compare(req.body.pin, credential.pin_hash);
  if (!valid) {
    const nextAttempts = credential.failed_attempts + 1;
    const lockedUntil = nextAttempts >= PIN_MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000)
      : null;

    await db.query(
      `UPDATE client_pin_credentials
       SET failed_attempts = $1,
           locked_until = $2,
           updated_at = NOW()
       WHERE user_id = $3`,
      [nextAttempts, lockedUntil, session.user.id],
    );

    res.status(401).json({
      success: false,
      error: PIN_INVALID_CODE,
      code: PIN_INVALID_CODE,
      message: 'Неверный PIN',
      attemptsRemaining: Math.max(0, PIN_MAX_FAILED_ATTEMPTS - nextAttempts),
      lockedUntil,
    });
    return;
  }

  await db.query(
    `UPDATE client_pin_credentials
     SET failed_attempts = 0,
         locked_until = NULL,
         updated_at = NOW()
     WHERE user_id = $1`,
    [session.user.id],
  );

  await upsertClientPinSession(session.user.id, session.refreshTokenHash, pinUnlockedUntil());
  const { accessToken, refreshToken: newRefreshToken } = await rotateRefreshSessionTokens(session);

  setAuthCookies(res, accessToken, newRefreshToken);
  res.json({
    success: true,
    data: {
      accessToken,
      refreshToken: newRefreshToken,
    },
  });
});

// Disable client PIN after confirming the current PIN
router.post('/pin/disable', authenticateToken, validate(pinDisableSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }
  if (req.user.role !== CLIENT_ROLE) {
    throw new AppError(403, 'PIN is available only for clients');
  }

  const credential = await getClientPinCredential(req.user.id);
  if (!credential) {
    res.json({ success: true, data: { enabled: false } });
    return;
  }

  if (dateIsInFuture(credential.locked_until)) {
    sendPinLocked(res, credential.locked_until);
    return;
  }

  const valid = await bcrypt.compare(req.body.pin, credential.pin_hash);
  if (!valid) {
    throw new AppError(401, PIN_INVALID_CODE, PIN_INVALID_CODE);
  }

  await db.query('DELETE FROM client_pin_sessions WHERE user_id = $1', [req.user.id]);
  await db.query('DELETE FROM client_pin_credentials WHERE user_id = $1', [req.user.id]);

  res.json({ success: true, data: { enabled: false } });
});

// Get current user
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const user = await db.queryOne<AuthMeUserRow>(
    `SELECT u.id, u.email, u.username, u.display_name, u.first_name, u.last_name, u.phone, u.photo_url,
            u.role, u.email_verified, u.phone_verified, u.is_active,
            COALESCE(to_jsonb(u)->>'account_type', 'personal') AS account_type,
            COALESCE(to_jsonb(u)->'personal_data', '{}'::jsonb) AS personal_data,
            COALESCE(to_jsonb(u)->'preferences', '{}'::jsonb) AS preferences,
            EXISTS (
              SELECT 1
              FROM client_pin_credentials cpc
              WHERE cpc.user_id = u.id
            ) AS pin_enabled,
            u.created_at, u.updated_at
     FROM users u WHERE u.id = $1`,
    [req.user.id]
  );

  if (!user) {
    throw new AppError(404, 'User not found');
  }

  const studentDiscount = user.role === CLIENT_ROLE
    ? await getOptionalStudentDiscountForUser(req.user.id)
    : null;

  // permissions already computed in authenticateToken (static map or DB based on RBAC_USE_DB)
  const permissions = req.user?.permissions ?? [];
  res.json({ success: true, data: { ...user, permissions, student_discount: studentDiscount } });
});

// Logout
router.post('/logout', authenticateToken, validate(logoutSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  // Accept refresh token from body (legacy) or httpOnly cookie
  const refreshToken: string | undefined = req.body.refreshToken || req.cookies?.['refresh_token'];

  // Blacklist the current access token immediately (from header or cookie)
  const authHeader = req.headers.authorization;
  const accessToken = authHeader?.split(' ')[1] || req.cookies?.['access_token'];
  if (accessToken) {
    const decoded = jwt.decode(accessToken);
    const expiresAt = isJwtClaimPayload(decoded) ? decoded['exp'] : null;
    if (typeof expiresAt === 'number') {
      blacklistToken(accessToken, expiresAt).catch(err =>
        logger.error('[Logout] Failed to blacklist token:', err.message)
      );
    }
  }

  if (refreshToken) {
    await db.query(
      `UPDATE client_pin_sessions
       SET revoked_at = NOW(), updated_at = NOW()
       WHERE refresh_token_hash = $1`,
      [hashRefreshToken(refreshToken)],
    );
    await db.query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
  }

  // Clear httpOnly auth cookies
  clearAuthCookies(res);

  res.json({ success: true, message: 'Logged out successfully' });
});

// ============================================================================
// Email-верификация
// ============================================================================

// Rate-limit для повторной отправки письма: email → timestamp последней отправки
const resendCooldownMap = new Map<string, number>();
const RESEND_COOLDOWN_MS = 2 * 60 * 1000; // 2 минуты

// GET /api/auth/verify-email?token=JWT
router.get('/verify-email', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.query;
  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];

  if (!token || typeof token !== 'string') {
    res.redirect(`${frontendUrl}/auth/login?verified=error`);
    return;
  }

  try {
    const decoded = verifyTokenPayload(token);
    const decodedUserId = readStringClaim(decoded, 'userId');
    const purpose = readStringClaim(decoded, 'purpose');
    if (purpose !== 'email_verify' || !decodedUserId) {
      res.redirect(`${frontendUrl}/auth/login?verified=error`);
      return;
    }

    const user = await db.queryOne<EmailVerificationUserRow>(
      'SELECT id, email_verified FROM users WHERE id = $1',
      [decodedUserId]
    );

    if (!user) {
      res.redirect(`${frontendUrl}/auth/login?verified=error`);
      return;
    }

    if (!user.email_verified) {
      await db.query('UPDATE users SET email_verified = true WHERE id = $1', [decodedUserId]);
      logger.info(`[Auth] Email verified for user ${decodedUserId}`);

      const verifiedUser = await db.queryOne<AuthUserContactRow>(
        'SELECT phone, email FROM users WHERE id = $1',
        [decodedUserId],
      );
      runPostLoginBackfill(decodedUserId, verifiedUser?.phone ?? null, verifiedUser?.email ?? null).catch(err =>
        logger.error('[Auth] post-login backfill error:', err.message),
      );
    }

    res.redirect(`${frontendUrl}/auth/login?verified=true`);
  } catch (err) {
    logger.warn('[Auth] verify-email: invalid or expired token', { error: String(err) });
    res.redirect(`${frontendUrl}/auth/login?verified=expired`);
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', validate(resendVerificationSchema), async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;

  const normalizedEmail = email.trim().toLowerCase();

  // Rate-limit: 1 письмо в 2 минуты
  const lastSent = resendCooldownMap.get(normalizedEmail);
  if (lastSent && Date.now() - lastSent < RESEND_COOLDOWN_MS) {
    res.json({ success: true }); // тихо игнорируем
    return;
  }

  const user = await db.queryOne<ResendVerificationUserRow>(
    'SELECT id, display_name, email_verified FROM users WHERE LOWER(email) = $1 AND is_active = true AND password_hash IS NOT NULL',
    [normalizedEmail]
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
    logger.error('[Auth] Failed to resend verification email:', { error: String(err) });
    });
  }

  res.json({ success: true });
});

// ============================================================================
// Email/Password авторизация
// ============================================================================

// POST /api/auth/login — вход по email + пароль
router.post('/login', validate(loginSchema), async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  // Account lockout check BEFORE any DB lookup or bcrypt
  const lockout = await checkAccountLockout(email);
  if (lockout.locked) {
    logAudit({
      action: 'login_locked',
      entityType: 'user',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { email: email.trim().toLowerCase(), remainingMinutes: lockout.remainingMinutes },
    });
    throw new AppError(429, `Слишком много попыток входа. Повторите через ${lockout.remainingMinutes} мин.`, ErrorCode.AUTH_LOCKOUT);
  }

  const user = await db.queryOne<PasswordLoginUserRow>(
    'SELECT id, email, role, display_name, password_hash, is_active, email_verified, two_factor_enabled, phone, two_factor_method FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()]
  );

  if (!user || !user.password_hash) {
    recordLoginAttempt(email, req.ip, req.headers['user-agent'], false);
    logAudit({ action: 'login_failed', entityType: 'user', ip: req.ip, userAgent: req.headers['user-agent'], details: { email: email.trim().toLowerCase(), reason: 'not_found' } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  if (!user.is_active) {
    recordLoginAttempt(email, req.ip, req.headers['user-agent'], false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip: req.ip, userAgent: req.headers['user-agent'], details: { reason: 'inactive' } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recordLoginAttempt(email, req.ip, req.headers['user-agent'], false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip: req.ip, userAgent: req.headers['user-agent'], details: { reason: 'invalid_password' } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  // Successful password check
  recordLoginAttempt(email, req.ip, req.headers['user-agent'], true);

  // Email не подтверждён — блокируем вход
  if (!user.email_verified) {
    res.status(403).json({
      success: false,
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Подтвердите email для входа. Проверьте вашу почту.',
    });
    return;
  }

  // Если включена 2FA — выдать tempToken вместо полноценных токенов
  if (user.two_factor_enabled && user.phone) {
    const twoFaCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 минут

    await db.query(
      `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
       VALUES ($1, $2, $3, $4, 'two_factor', $5)`,
      [user.id, user.phone, twoFaCode, user.two_factor_method || 'sms', expiresAt]
    );

    const smsText = `Своё Фото: код для входа ${twoFaCode}. Действует 5 минут.`;
    sendSms(user.phone, smsText).catch(err => logger.error('[2FA] SMS error', { error: String(err) }));

    const tempToken = jwt.sign(
      { userId: user.id, phone: user.phone, purpose: 'two_factor' },
      config.jwt.secret + '_2fa',
      TWO_FACTOR_JWT_OPTIONS
    );

    res.json({ success: true, data: { requiresTwoFactor: true, tempToken } });
    return;
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);

  // Сохраняем refresh token
  await db.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 days\')',
    [user.id, tokens.refreshToken]
  );

  logAudit({ userId: user.id, userName: user.display_name, action: 'login_email', entityType: 'user', entityId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] });

  // Check new IP and send alert (fire-and-forget)
  checkNewIpAndAlert(user.id, user.email, user.display_name, req.ip, req.headers['user-agent'] || '');

  // Auto-link approval sessions by phone
  if (user.phone) {
    linkApprovalSessionsByPhone(user.id, user.phone).catch(err =>
      logger.error('[Auth] approval link error:', err.message)
    );
  }

  runPostLoginBackfill(user.id, user.phone, user.email).catch(err =>
    logger.error('[Auth] post-login backfill error:', err.message),
  );

  // Set httpOnly cookies (primary auth) + return tokens in body (transition/mobile)
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

  res.json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }
  });
});

// POST /api/auth/employee-login — вход только для сотрудников/фотографов/администраторов
// Роль проверяется НА БЭКЕНДЕ до выдачи токенов
router.post('/employee-login', validate(employeeLoginSchema), async (req: Request, res: Response): Promise<void> => {
  const EMPLOYEE_ROLES = ['employee', 'admin', 'photographer', 'manager'];
  const { email, password } = req.body;

  // Account lockout check BEFORE any DB lookup or bcrypt
  const lockout = await checkAccountLockout(email);
  if (lockout.locked) {
    logAudit({
      action: 'login_locked',
      entityType: 'user',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { email: email.trim().toLowerCase(), remainingMinutes: lockout.remainingMinutes, endpoint: 'employee-login' },
    });
    throw new AppError(429, `Слишком много попыток входа. Повторите через ${lockout.remainingMinutes} мин.`, ErrorCode.AUTH_LOCKOUT);
  }

  const user = await db.queryOne<EmployeeLoginUserRow>(
    'SELECT id, email, role, display_name, password_hash, is_active, two_factor_enabled, phone, two_factor_method FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()]
  );

  if (!user || !user.password_hash) {
    recordLoginAttempt(email, req.ip, req.headers['user-agent'], false);
    logAudit({ action: 'login_failed', entityType: 'user', ip: req.ip, userAgent: req.headers['user-agent'], details: { email: email.trim().toLowerCase(), reason: 'not_found', endpoint: 'employee-login' } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  if (!user.is_active) {
    recordLoginAttempt(email, req.ip, req.headers['user-agent'], false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip: req.ip, userAgent: req.headers['user-agent'], details: { reason: 'inactive', endpoint: 'employee-login' } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    recordLoginAttempt(email, req.ip, req.headers['user-agent'], false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip: req.ip, userAgent: req.headers['user-agent'], details: { reason: 'invalid_password', endpoint: 'employee-login' } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  // Проверка роли ДО выдачи токенов — unified error message
  if (!EMPLOYEE_ROLES.includes(user.role)) {
    recordLoginAttempt(email, req.ip, req.headers['user-agent'], false);
    logAudit({ userId: user.id, userName: user.display_name, action: 'login_failed', entityType: 'user', entityId: user.id, ip: req.ip, userAgent: req.headers['user-agent'], details: { reason: 'not_employee', endpoint: 'employee-login' } });
    throw new AppError(401, 'Неверный email или пароль', ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  // Successful password + role check
  recordLoginAttempt(email, req.ip, req.headers['user-agent'], true);

  // 2FA
  if (user.two_factor_enabled && user.phone) {
    const twoFaCode = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
       VALUES ($1, $2, $3, $4, 'two_factor', $5)`,
      [user.id, user.phone, twoFaCode, user.two_factor_method || 'sms', expiresAt]
    );

    const smsText = `Своё Фото: код для входа ${twoFaCode}. Действует 5 минут.`;
    sendSms(user.phone, smsText).catch(err => logger.error('[2FA] SMS error', { error: String(err) }));

    const tempToken = jwt.sign(
      { userId: user.id, phone: user.phone, purpose: 'two_factor' },
      config.jwt.secret + '_2fa',
      TWO_FACTOR_JWT_OPTIONS
    );

    res.json({ success: true, data: { requiresTwoFactor: true, tempToken } });
    return;
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);

  await db.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL \'30 days\')',
    [user.id, tokens.refreshToken]
  );

  logAudit({ userId: user.id, userName: user.display_name, action: 'login_employee', entityType: 'user', entityId: user.id, ip: req.ip, userAgent: req.headers['user-agent'] });

  // Check new IP and send alert (fire-and-forget)
  checkNewIpAndAlert(user.id, user.email, user.display_name, req.ip, req.headers['user-agent'] || '');

  runPostLoginBackfill(user.id, user.phone, user.email).catch(err =>
    logger.error('[Auth] post-login backfill error:', err.message),
  );

  // Set httpOnly cookies (primary auth) + return tokens in body (transition/mobile)
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

  res.json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }
  });
});

// POST /api/auth/register — регистрация по email + пароль
router.post('/register', validate(registerSchema), async (req: Request, res: Response): Promise<void> => {
  const { email, password, displayName, privacyConsent } = req.body;

  if (!email || !password) {
    throw new AppError(400, 'Email и пароль обязательны');
  }
  if (privacyConsent && !privacyConsent.accepted) {
    throw new AppError(400, 'Необходимо согласие на обработку персональных данных');
  }

  const pwCheck = validatePasswordStrength(password, email);
  if (!pwCheck.valid) {
    throw new AppError(400, `Слабый пароль: ${pwCheck.errors.join(', ')}`, ErrorCode.AUTH_WEAK_PASSWORD);
  }

  // Проверяем, не занят ли email
  const existing = await db.queryOne<ExistingAuthUserRow>(
    'SELECT id, display_name FROM users WHERE LOWER(email) = LOWER($1)',
    [email.trim()]
  );

  if (existing) {
    // Anti-enumeration: same response as success + notify existing user
    sendRegistrationAttemptEmail(email.trim().toLowerCase(), existing.display_name).catch(err =>
      logger.error('[Auth] Failed to send registration attempt email:', { error: String(err) })
    );
    res.status(201).json({
      success: true,
      requiresVerification: true,
      message: 'Аккаунт создан. Проверьте почту — мы отправили ссылку для подтверждения.',
    });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const userId = uuidv4();
  const cleanName = displayName?.trim() || email.split('@')[0];

  await db.transaction(async (client) => {
    const insertUserParams: unknown[] = [userId, email.trim().toLowerCase(), cleanName, passwordHash];
    await client.query(
      `INSERT INTO users (id, email, display_name, role, password_hash, email_verified, is_active, last_password_change)
       VALUES ($1, $2, $3, 'client', $4, false, true, NOW())`,
      insertUserParams,
    );

    if (privacyConsent) {
      const details: PrivacyConsentDetailsJsonb = privacyConsent.details ?? {};
      await recordPrivacyConsentTx(client, {
        userId,
        visitorId: privacyConsent.visitorId ?? null,
        documentType: privacyConsent.documentType,
        documentVersion: privacyConsent.documentVersion,
        scope: privacyConsent.scope,
        source: privacyConsent.source,
        accepted: privacyConsent.accepted,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'],
        details: {
          ...details,
          registrationMethod: 'email',
          uiSurface: 'register_form',
        },
      });
    }
  });

  // Отправляем письмо с подтверждением (fire-and-forget)
  const verificationToken = signJwt(
    { userId, purpose: 'email_verify' },
    { expiresIn: '24h' },
  );
  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
  const verificationUrl = `${frontendUrl}/api/auth/verify-email?token=${verificationToken}`;

  sendEmailVerificationEmail(email.trim().toLowerCase(), cleanName, verificationUrl).catch(err => {
    logger.error('[Auth] Failed to send verification email:', { error: String(err) });
  });

  logger.info(`[Auth] New registration: ${email.trim().toLowerCase()} (verification email sent)`);

  res.status(201).json({
    success: true,
    requiresVerification: true,
    message: 'Аккаунт создан. Проверьте почту — мы отправили ссылку для подтверждения.',
  });
});

// ============================================================================
// Сброс пароля
// ============================================================================

// POST /api/auth/forgot-password — запрос сброса пароля
router.post('/forgot-password', validate(forgotPasswordSchema), async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;

  const normalizedEmail = email.trim().toLowerCase();

  const user = await db.queryOne<ExistingAuthUserRow>(
    'SELECT id, display_name FROM users WHERE email = $1 AND is_active = true',
    [normalizedEmail],
  );

  // Возвращаем 200 всегда — защита от энумерации аккаунтов
  if (!user) {
    res.json({ success: true });
    return;
  }

  // Удаляем старые токены этого пользователя
  await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [user.id]);

  // Создаём новый токен (64 hex-символа)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час

  await db.query(
    'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [user.id, token, expiresAt],
  );

  const frontendUrl = (config.cors.origin || 'https://svoefoto.ru').split(',')[0];
  const resetUrl = `${frontendUrl}/auth/reset-password?token=${token}`;

  // Отправляем письмо (fire-and-forget — не блокируем ответ)
  sendPasswordResetEmail(normalizedEmail, user.display_name, resetUrl).catch((err) => {
    logger.error('[Auth] Failed to send password reset email:', { error: String(err) });
  });

  res.json({ success: true });
});

// POST /api/auth/reset-password — применение нового пароля
router.post('/reset-password', validate(resetPasswordSchema), async (req: Request, res: Response): Promise<void> => {
  const { token, password } = req.body;
  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.valid) {
    throw new AppError(400, `Слабый пароль: ${pwCheck.errors.join(', ')}`, ErrorCode.AUTH_WEAK_PASSWORD);
  }

  const resetToken = await db.queryOne<PasswordResetTokenRow>(
    'SELECT id, user_id, expires_at, used FROM password_reset_tokens WHERE token = $1',
    [token],
  );

  if (!resetToken || resetToken.used || new Date(resetToken.expires_at) < new Date()) {
    throw new AppError(400, 'Ссылка недействительна или устарела');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW(), last_password_change = NOW() WHERE id = $2',
    [passwordHash, resetToken.user_id],
  );
  await db.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [resetToken.id]);
  // Отзываем все активные сессии — принудительный re-login
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [resetToken.user_id]);
  // Blacklist all access tokens immediately via Redis
  blacklistAllUserTokens(resetToken.user_id).catch(err =>
    logger.error('[PasswordReset] Failed to blacklist tokens:', err.message)
  );
  // Invalidate auth cache — password changed
  invalidateAuthCache(resetToken.user_id).catch(err =>
    logger.error('[PasswordReset] Failed to invalidate auth cache:', err.message)
  );

  logAudit({
    userId: resetToken.user_id,
    action: 'password_reset',
    entityType: 'user',
    entityId: resetToken.user_id,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.json({ success: true });
});

// ============================================================================
// Верификация телефона + 2FA (ПЛАН 7)
// ============================================================================

// POST /api/auth/send-phone-code — отправить SMS-код подтверждения
router.post('/send-phone-code', authenticateToken, validate(sendPhoneCodeSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { phone, purpose } = req.body;

  const normalized = normalizePhone(phone);
  if (normalized.length < 10) {
    throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
  }

  // Rate limit: не более 3 кодов за 10 минут на один телефон
  const recentResult = await db.queryOne<AuthCountRow>(
    `SELECT COUNT(*) as count FROM verification_codes
     WHERE phone = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [normalized, purpose]
  );
  if (parseInt(recentResult?.count || '0') >= 3) {
    throw new AppError(429, 'Превышен лимит отправки кодов. Подождите 10 минут', ErrorCode.PHONE_SEND_LIMIT);
  }

  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

  await db.query(
    `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
     VALUES ($1, $2, $3, 'sms', $4, $5)`,
    [req.user!.id, normalized, code, purpose, expiresAt]
  );

  const smsText = `Своё Фото: код подтверждения ${code}. Действует 10 минут.`;
  sendSms(normalized, smsText).catch(err => logger.error('[PhoneVerify] SMS error', { error: String(err) }));

  res.json({ success: true, data: { method: 'sms', expiresIn: 600 } });
});

// POST /api/auth/verify-phone — подтвердить телефон кодом из SMS
router.post('/verify-phone', authenticateToken, validate(verifyPhoneSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { phone, code } = req.body;

  const normalized = normalizePhone(phone);

  const record = await db.queryOne<PhoneVerificationCodeRow>(
    `SELECT id, code, expires_at, attempts FROM verification_codes
     WHERE phone = $1 AND purpose = 'phone_verify' AND user_id = $2
       AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [normalized, req.user!.id]
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
    [normalized, req.user!.id]
  );

  runPostLoginBackfill(req.user!.id, normalized, null).catch(err =>
    logger.error('[Auth] post-login backfill error:', err.message),
  );

  res.json({ success: true });
});

// POST /api/auth/enable-2fa — включить 2FA (требует привязанного телефона)
router.post('/enable-2fa', authenticateToken, validate(enable2faSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { method } = req.body;

  const user = await db.queryOne<UserPhoneRow>(
    'SELECT phone FROM users WHERE id = $1',
    [req.user!.id]
  );

  if (!user?.phone?.trim()) {
    throw new AppError(400, 'Сначала привяжите телефон', ErrorCode.PHONE_NOT_VERIFIED);
  }

  await db.query(
    'UPDATE users SET two_factor_enabled = true, two_factor_method = $1, updated_at = NOW() WHERE id = $2',
    [method, req.user!.id]
  );

  res.json({ success: true });
});

// POST /api/auth/disable-2fa — отключить 2FA
router.post('/disable-2fa', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  await db.query(
    'UPDATE users SET two_factor_enabled = false, two_factor_method = NULL, updated_at = NOW() WHERE id = $1',
    [req.user!.id]
  );
  res.json({ success: true });
});

// POST /api/auth/verify-2fa — подтвердить код 2FA (используется при входе)
router.post('/verify-2fa', validate(verify2faSchema), async (req: Request, res: Response): Promise<void> => {
  const { tempToken, code } = req.body;

  let decodedUserId: string | null;
  let decodedPhone: string | null;
  let decodedPurpose: string | null;
  try {
    const decoded = verifyDerivedTokenPayload(tempToken, '_2fa');
    decodedUserId = readStringClaim(decoded, 'userId');
    decodedPhone = readStringClaim(decoded, 'phone');
    decodedPurpose = readStringClaim(decoded, 'purpose');
  } catch {
    throw new AppError(401, 'Сессия истекла, войдите заново');
  }

  if (decodedPurpose !== 'two_factor' || !decodedUserId || !decodedPhone) {
    throw new AppError(401, 'Неверный токен');
  }

  const record = await db.queryOne<TwoFactorCodeRow>(
    `SELECT id, code, attempts FROM verification_codes
     WHERE phone = $1 AND purpose = 'two_factor' AND user_id = $2
       AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [decodedPhone, decodedUserId]
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

  const user = await db.queryOne<TwoFactorUserRow>(
    'SELECT id, email, role, display_name FROM users WHERE id = $1',
    [decodedUserId]
  );

  if (!user) {
    throw new AppError(404, 'Пользователь не найден');
  }

  const tokens = generateTokens(user.id, user.email || '', user.role);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [user.id, tokens.refreshToken]
  );

  // Set httpOnly cookies (primary auth) + return tokens in body (transition/mobile)
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

  res.json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, displayName: user.display_name, role: user.role },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    }
  });
});

export default router;
