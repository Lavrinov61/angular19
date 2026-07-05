import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';

import { config } from '../config/index.js';
import { ErrorCode } from '../constants/error-codes.js';
import db from '../database/db.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import { getRequestId } from '../middleware/request-context.js';
import { authenticateToken, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { phoneCodeSchema, phoneVerifySchema, profilePhoneVerifySchema } from '../schemas/auth.schema.js';
import { linkApprovalSessionsByPhone } from '../services/approval-counters.service.js';
import { runPostLoginBackfill } from '../services/account-backfill.service.js';
import { logAudit } from '../services/audit.service.js';
import {
  checkDeliveryChannel,
  getCachedVoiceCallProviderPreflight,
  isVoiceCallProviderAvailable,
} from '../services/code-delivery.service.js';
import { normalizePhone } from '../services/sms.service.js';
import { requestVoiceOtpDispatch } from '../services/voice-otp-dispatcher.service.js';
import { recordPhoneOtpEventSafely } from '../services/phone-otp-event.service.js';
import { signJwt } from '../utils/jwt-keys.js';
import { createLogger } from '../utils/logger.js';
import { setAuthCookies } from './auth-cookies.js';

const router = express.Router();
const logger = createLogger('phone-auth.routes');

const PHONE_CODE_WINDOW_MS = 10 * 60 * 1000;
const PHONE_CODE_IP_MAX = 10;
const PHONE_CODE_DEVICE_MAX = 6;
const PHONE_VERIFY_IP_MAX = 30;
const PHONE_VERIFY_DEVICE_MAX = 15;
const STAFF_ROLES = ['employee', 'admin', 'photographer', 'manager'];
const MOBILE_GRPC_SECRET_HEADER = 'x-svf-mobile-grpc-secret';

interface VerificationCountRow {
  count: string;
}

interface VerificationCodeRow {
  id: string;
  code: string;
  attempts: number;
  method: string;
}

interface InsertedVerificationCodeRow {
  id: string;
}

interface PhoneAuthUserRow {
  id: string;
  email: string | null;
  role: string;
  display_name: string | null;
  is_active: boolean;
}

interface InsertedPhoneAuthUserRow {
  id: string;
  role: string;
  display_name: string | null;
}

interface PhoneOwnerRow {
  id: string;
}

interface PhoneRegistrationProfile {
  displayName: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
}

interface PhoneVerifyRequestBody {
  phone: string;
  code: string;
  staffOnly?: boolean;
  fingerprintVisitorId?: string;
  profile?: PhoneRegistrationProfile;
}

interface PhoneAuthCheckResult {
  available: boolean;
  provider: string;
}

interface PhoneAuthCaptchaPublicConfig {
  required: false;
  provider: null;
  challengeUrl: null;
}

export interface PhoneAuthPublicConfig {
  available: boolean;
  providers: string[];
  captcha: PhoneAuthCaptchaPublicConfig;
}

const PHONE_AUTH_CAPTCHA_DISABLED: PhoneAuthCaptchaPublicConfig = {
  required: false,
  provider: null,
  challengeUrl: null,
};

function getPhoneAuthProviderIds(): string[] {
  const providers: string[] = [];
  if (config.voximplant.voiceCall.enabled) {
    providers.push('voice_call');
  }
  return providers;
}

export async function getPhoneAuthPublicConfig(options?: {
  liveAvailability?: boolean;
}): Promise<PhoneAuthPublicConfig> {
  const providers = getPhoneAuthProviderIds();
  const available = options?.liveAvailability
    ? providers.length > 0 && await isVoiceCallProviderAvailable()
    : providers.length > 0;

  return {
    available,
    providers,
    captcha: PHONE_AUTH_CAPTCHA_DISABLED,
  };
}

export function ensurePhoneAuthRoutesAvailable(): void {
  if (!config.voximplant.voiceCall.enabled) {
    throw new AppError(503, 'Вход по телефону временно недоступен');
  }
}

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

export async function isPhoneAuthHardReady(): Promise<boolean> {
  return (await getPhoneAuthPublicConfig({ liveAvailability: true })).available;
}

export async function runPhoneAuthProviderPreflight(): Promise<'ok' | 'skipped'> {
  return getCachedVoiceCallProviderPreflight();
}

function maskPhoneForLogs(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function maskOpaqueId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function hasFingerprintVisitorId(body: unknown): body is { fingerprintVisitorId?: unknown } {
  return typeof body === 'object' && body !== null && 'fingerprintVisitorId' in body;
}

function getFingerprintVisitorId(body: unknown): string | undefined {
  if (!hasFingerprintVisitorId(body)) return undefined;
  const raw = body.fingerprintVisitorId;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isTrustedMobileGrpcRequest(req: Request): boolean {
  const expectedSecret = config.mobileGrpc.internalSecret;
  const suppliedSecret = req.get(MOBILE_GRPC_SECRET_HEADER);

  return !!expectedSecret
    && !!suppliedSecret
    && timingSafeStringEqual(suppliedSecret, expectedSecret);
}

function hasPhone(body: unknown): body is { phone?: unknown } {
  return typeof body === 'object' && body !== null && 'phone' in body;
}

function getRequestPhone(body: unknown): string | undefined {
  if (!hasPhone(body)) return undefined;
  const raw = body.phone;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function getMaskedRequestPhone(body: unknown): string | undefined {
  const phone = getRequestPhone(body);
  if (!phone) return undefined;
  return maskPhoneForLogs(normalizePhone(phone));
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getPhoneRegistrationProfile(body: unknown): PhoneRegistrationProfile | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const rawProfile = Reflect.get(body, 'profile');
  if (typeof rawProfile !== 'object' || rawProfile === null) return undefined;

  const displayName = getOptionalString(Reflect.get(rawProfile, 'displayName'));
  if (!displayName) return undefined;

  return {
    displayName,
    firstName: getOptionalString(Reflect.get(rawProfile, 'firstName')),
    lastName: getOptionalString(Reflect.get(rawProfile, 'lastName')),
    dateOfBirth: getOptionalString(Reflect.get(rawProfile, 'dateOfBirth')),
  };
}

function getPhoneVerifyRequestBody(body: unknown): PhoneVerifyRequestBody {
  if (typeof body !== 'object' || body === null) {
    throw new AppError(400, 'Некорректное тело запроса');
  }

  const phone = getOptionalString(Reflect.get(body, 'phone'));
  const code = getOptionalString(Reflect.get(body, 'code'));
  if (!phone || !code) {
    throw new AppError(400, 'Телефон и код обязательны');
  }

  const staffOnly = Reflect.get(body, 'staffOnly');
  return {
    phone,
    code,
    staffOnly: typeof staffOnly === 'boolean' ? staffOnly : undefined,
    fingerprintVisitorId: getOptionalString(Reflect.get(body, 'fingerprintVisitorId')),
    profile: getPhoneRegistrationProfile(body),
  };
}

function hasRequiredDisplayName(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length >= 2;
}

function buildProfilePersonalDataPatch(profile: PhoneRegistrationProfile): string {
  return JSON.stringify({
    firstName: profile.firstName ?? profile.displayName,
    ...(profile.lastName ? { lastName: profile.lastName } : {}),
    ...(profile.dateOfBirth ? { dateOfBirth: profile.dateOfBirth } : {}),
  });
}

async function markVerificationCodeUsed(id: string): Promise<void> {
  await db.query('UPDATE verification_codes SET used_at = NOW() WHERE id = $1', [id]);
}

async function markUserPhoneVerified(userId: string, phone: string): Promise<void> {
  await db.query(
    'UPDATE users SET phone = $1, phone_verified = true, updated_at = NOW() WHERE id = $2',
    [phone, userId],
  );
}

function requirePhoneAuth(_req: Request, _res: Response, next: NextFunction): void {
  ensurePhoneAuthRoutesAvailable();
  next();
}

function phoneCodeRateLimitExceeded(
  req: Request,
  res: Response,
  message: string,
  scope: 'ip' | 'device',
): void {
  logger.warn('Phone OTP rate limit hit', {
    requestId: getRequestId(),
    scope,
    fingerprintVisitorId: maskOpaqueId(getFingerprintVisitorId(req.body)),
  });
  res.status(429).json({
    success: false,
    error: message,
    code: ErrorCode.PHONE_SEND_LIMIT,
  });
}

const phoneCodeIpLimiter = rateLimit({
  windowMs: PHONE_CODE_WINDOW_MS,
  max: PHONE_CODE_IP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('auth-phone-code-ip:'),
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  handler: (req, res) => {
    phoneCodeRateLimitExceeded(
      req,
      res,
      'Слишком много запросов кода с этого IP. Подождите 10 минут.',
      'ip',
    );
  },
});

const phoneCodeDeviceLimiter = rateLimit({
  windowMs: PHONE_CODE_WINDOW_MS,
  max: PHONE_CODE_DEVICE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('auth-phone-code-device:'),
  skip: (req) => !getFingerprintVisitorId(req.body),
  keyGenerator: (req) => getFingerprintVisitorId(req.body) || 'missing-fingerprint',
  handler: (req, res) => {
    phoneCodeRateLimitExceeded(
      req,
      res,
      'Слишком много запросов кода с этого устройства. Подождите 10 минут.',
      'device',
    );
  },
});

function phoneVerifyRateLimitExceeded(
  req: Request,
  res: Response,
  message: string,
  scope: 'ip' | 'device',
): void {
  logger.warn('Phone OTP verify rate limit hit', {
    requestId: getRequestId(),
    scope,
    phoneMasked: getMaskedRequestPhone(req.body),
    fingerprintVisitorId: maskOpaqueId(getFingerprintVisitorId(req.body)),
  });
  res.status(429).json({
    success: false,
    error: message,
    code: ErrorCode.PHONE_VERIFY_LIMIT,
  });
}

const phoneVerifyIpLimiter = rateLimit({
  windowMs: PHONE_CODE_WINDOW_MS,
  max: PHONE_VERIFY_IP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  skipSuccessfulRequests: true,
  store: createRateLimitStore('auth-phone-verify-ip:'),
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  handler: (req, res) => {
    phoneVerifyRateLimitExceeded(
      req,
      res,
      'Слишком много попыток проверки кода с этого IP. Подождите 10 минут.',
      'ip',
    );
  },
});

const phoneVerifyDeviceLimiter = rateLimit({
  windowMs: PHONE_CODE_WINDOW_MS,
  max: PHONE_VERIFY_DEVICE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  skipSuccessfulRequests: true,
  store: createRateLimitStore('auth-phone-verify-device:'),
  skip: (req) => !getFingerprintVisitorId(req.body),
  keyGenerator: (req) => getFingerprintVisitorId(req.body) || 'missing-fingerprint',
  handler: (req, res) => {
    phoneVerifyRateLimitExceeded(
      req,
      res,
      'Слишком много попыток проверки кода с этого устройства. Подождите 10 минут.',
      'device',
    );
  },
});

router.get('/phone-check', requirePhoneAuth, async (req: Request, res: Response): Promise<void> => {
  const phone = typeof req.query['phone'] === 'string' ? req.query['phone'] : undefined;
  if (!phone) {
    throw new AppError(400, 'Телефон обязателен');
  }
  const normalized = normalizePhone(phone);
  if (normalized.length < 11) {
    throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
  }
  const result = await checkDeliveryChannel(normalized) as PhoneAuthCheckResult;
  res.json({ success: true, data: result });
});

router.post(
  '/phone-code',
  requirePhoneAuth,
  validate(phoneCodeSchema),
  phoneCodeIpLimiter,
  phoneCodeDeviceLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { phone, fingerprintVisitorId } = req.body;
    const trustedMobileGrpc = isTrustedMobileGrpcRequest(req);

    const normalized = normalizePhone(phone);
    if (normalized.length < 11) {
      throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
    }
    if (trustedMobileGrpc && !fingerprintVisitorId) {
      throw new AppError(
        400,
        'device_id обязателен для мобильного gRPC входа',
        ErrorCode.VALIDATION_ERROR,
      );
    }
    const phoneMasked = maskPhoneForLogs(normalized);

    logger.info('Phone OTP requested', {
      requestId: getRequestId(),
      phoneMasked,
      fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
      channel: 'voice_call',
      client: trustedMobileGrpc ? 'mobile_grpc' : 'rest',
    });
    await recordPhoneOtpEventSafely({
      phone: normalized,
      eventType: 'code_requested',
      fingerprintVisitorId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        channel: 'voice_call',
        client: trustedMobileGrpc ? 'mobile_grpc' : 'rest',
      },
    });

    const recentResult = await db.queryOne<VerificationCountRow>(
      `SELECT COUNT(*) as count FROM verification_codes
       WHERE phone = $1 AND purpose = 'phone_login' AND created_at > NOW() - INTERVAL '10 minutes'`,
      [normalized],
    );
    if (parseInt(recentResult?.count || '0', 10) >= 3) {
      logger.warn('Phone OTP phone-level limit hit', {
        requestId: getRequestId(),
        phoneMasked,
        fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
      });
      await recordPhoneOtpEventSafely({
        phone: normalized,
        eventType: 'delivery_failed',
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          reason: 'phone_send_limit',
          channel: 'voice_call',
          client: trustedMobileGrpc ? 'mobile_grpc' : 'rest',
        },
      });
      throw new AppError(429, 'Превышен лимит отправки кодов. Подождите 10 минут', ErrorCode.PHONE_SEND_LIMIT);
    }

    const ttlSeconds = Math.max(30, config.voximplant.voiceCall.ttlSeconds || 120);
    const code = crypto.randomInt(1000, 9999).toString();

    const dispatchResult = await requestVoiceOtpDispatch(normalized, code);
    if (!dispatchResult.success) {
      logger.warn('Phone OTP delivery failed', {
        requestId: getRequestId(),
        phoneMasked,
        fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
        reason: dispatchResult.reason,
        dispatchError: dispatchResult.error,
      });
      await recordPhoneOtpEventSafely({
        phone: normalized,
        eventType: 'delivery_failed',
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          reason: dispatchResult.reason,
          channel: 'voice_call',
          providerError: dispatchResult.error,
          client: trustedMobileGrpc ? 'mobile_grpc' : 'rest',
        },
      });
      if (dispatchResult.reason === 'busy') {
        throw new AppError(
          503,
          'Голосовой сервис OTP сейчас перегружен. Попробуйте через несколько секунд.',
          ErrorCode.PHONE_SEND_BUSY,
        );
      }
      throw new AppError(503, 'Не удалось отправить код подтверждения. Попробуйте позже.', ErrorCode.PHONE_SEND_FAILED);
    }

    const delivery = dispatchResult.data;
    const verificationCode = delivery.verificationCode || code;
    const acceptedAt = new Date(delivery.acceptedAt);
    const expiresAt = new Date(acceptedAt.getTime() + ttlSeconds * 1000);

    await db.query(
      `UPDATE verification_codes
          SET used_at = NOW()
        WHERE phone = $1 AND purpose = 'phone_login' AND used_at IS NULL`,
      [normalized],
    );

    const insertedCode = await db.queryOne<InsertedVerificationCodeRow>(
      `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
       VALUES (NULL, $1, $2, $3, 'phone_login', $4)
       RETURNING id`,
      [normalized, verificationCode, delivery.provider, expiresAt],
    );
    if (!insertedCode) {
      throw new AppError(500, 'Не удалось создать код подтверждения');
    }

    logger.info('Phone OTP delivery started', {
      requestId: getRequestId(),
      phoneMasked,
      fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
      provider: delivery.provider,
      providerRequestId: delivery.requestId,
      callSessionHistoryId: delivery.callSessionHistoryId,
      callerId: delivery.callerId,
      acceptedAt: delivery.acceptedAt,
      expiresIn: ttlSeconds,
    });
    await recordPhoneOtpEventSafely({
      verificationCodeId: insertedCode.id,
      phone: normalized,
      eventType: 'delivery_started',
      provider: delivery.provider,
      providerRequestId: delivery.requestId,
      callSessionHistoryId: delivery.callSessionHistoryId,
      callerId: delivery.callerId,
      fingerprintVisitorId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        acceptedAt: delivery.acceptedAt,
        expiresAt: expiresAt.toISOString(),
        expiresIn: ttlSeconds,
        channel: 'voice_call',
        client: trustedMobileGrpc ? 'mobile_grpc' : 'rest',
      },
    });

    res.json({ success: true, data: { expiresIn: ttlSeconds, provider: delivery.provider } });
  },
);

router.post(
  '/phone-verify',
  requirePhoneAuth,
  validate(phoneVerifySchema),
  phoneVerifyIpLimiter,
  phoneVerifyDeviceLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const { phone, code, staffOnly, fingerprintVisitorId, profile } = getPhoneVerifyRequestBody(req.body);

    const normalized = normalizePhone(phone);
    if (normalized.length < 11) {
      throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
    }
    const phoneMasked = maskPhoneForLogs(normalized);

    const record = await db.queryOne<VerificationCodeRow>(
      `SELECT id, code, attempts, method FROM verification_codes
       WHERE phone = $1 AND purpose = 'phone_login'
         AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [normalized],
    );

    if (!record) {
      logger.warn('Phone OTP verify rejected', {
        requestId: getRequestId(),
        phoneMasked,
        fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
        reason: 'expired_or_missing',
      });
      await recordPhoneOtpEventSafely({
        phone: normalized,
        eventType: 'code_expired_or_missing',
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'expired_or_missing' },
      });
      throw new AppError(400, 'Код недействителен или истёк. Запросите новый.', ErrorCode.PHONE_CODE_EXPIRED);
    }
    const maxAttempts = record.method === 'flash_call' ? 3 : 5;
    if (record.attempts >= maxAttempts) {
      logger.warn('Phone OTP verify rejected', {
        requestId: getRequestId(),
        phoneMasked,
        fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
        reason: 'max_attempts',
      });
      await recordPhoneOtpEventSafely({
        verificationCodeId: record.id,
        phone: normalized,
        eventType: 'verify_max_attempts',
        provider: record.method,
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'max_attempts', attempts: record.attempts, maxAttempts },
      });
      throw new AppError(400, 'Превышено количество попыток. Запросите новый код.', ErrorCode.PHONE_CODE_MAX_ATTEMPTS);
    }
    if (record.code !== code) {
      await db.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
      logger.warn('Phone OTP verify rejected', {
        requestId: getRequestId(),
        phoneMasked,
        fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
        reason: 'invalid_code',
      });
      await recordPhoneOtpEventSafely({
        verificationCodeId: record.id,
        phone: normalized,
        eventType: 'verify_failed',
        provider: record.method,
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'invalid_code', attemptsAfter: record.attempts + 1, maxAttempts },
      });
      throw new AppError(400, 'Неверный код', ErrorCode.PHONE_CODE_INVALID);
    }

    await recordPhoneOtpEventSafely({
      verificationCodeId: record.id,
      phone: normalized,
      eventType: 'verified',
      provider: record.method,
      fingerprintVisitorId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { staffOnly: !!staffOnly },
    });

    let user = await db.queryOne<PhoneAuthUserRow>(
      'SELECT id, email, role, display_name, is_active FROM users WHERE phone = $1 LIMIT 1',
      [normalized],
    );

    let isNewUser = false;

    if (!user) {
      if (staffOnly) {
        throw new AppError(403, 'Сотрудник с таким телефоном не найден');
      }

      if (!profile) {
        logger.info('Phone OTP verified for new client; profile required before session issue', {
          requestId: getRequestId(),
          phoneMasked,
          fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
        });
        res.json({
          success: true,
          data: {
            requiresProfile: true,
            isNewUser: true,
            phone: normalized,
          },
        });
        return;
      }

      const firstName = profile.firstName ?? profile.displayName;
      const lastName = profile.lastName ?? null;
      const newUser = await db.queryOne<InsertedPhoneAuthUserRow>(
        `INSERT INTO users (phone, phone_verified, role, is_active, display_name, first_name, last_name, personal_data, created_at, updated_at)
         VALUES ($1, true, 'client', true, $2, $3, $4, $5::jsonb, NOW(), NOW())
         RETURNING id, role, display_name`,
        [
          normalized,
          profile.displayName,
          firstName,
          lastName,
          buildProfilePersonalDataPatch(profile),
        ],
      );
      if (!newUser) {
        throw new AppError(500, 'Ошибка создания аккаунта');
      }

      await markVerificationCodeUsed(record.id);

      user = { ...newUser, email: null, is_active: true };
      isNewUser = true;

      logAudit({
        userId: newUser.id,
        action: 'register_phone',
        entityType: 'user',
        entityId: newUser.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    } else {
      if (!user.is_active) {
        await markVerificationCodeUsed(record.id);
        throw new AppError(403, 'Аккаунт деактивирован');
      }
      if (staffOnly && !STAFF_ROLES.includes(user.role)) {
        await markVerificationCodeUsed(record.id);
        throw new AppError(403, 'Доступ только для сотрудников');
      }

      if (!hasRequiredDisplayName(user.display_name)) {
        if (!profile) {
          logger.info('Phone OTP verified for existing user; profile name required before session issue', {
            requestId: getRequestId(),
            phoneMasked,
            fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
            userId: user.id,
          });
          res.json({
            success: true,
            data: {
              requiresProfile: true,
              isNewUser: false,
              phone: normalized,
            },
          });
          return;
        }

        const updatedUser = await db.queryOne<PhoneAuthUserRow>(
          `UPDATE users
              SET display_name = $2,
                  first_name = COALESCE(NULLIF(first_name, ''), $3),
                  last_name = COALESCE(NULLIF(last_name, ''), $4),
                  personal_data = COALESCE(personal_data, '{}'::jsonb) || $5::jsonb,
                  updated_at = NOW()
            WHERE id = $1
            RETURNING id, email, role, display_name, is_active`,
          [
            user.id,
            profile.displayName,
            profile.firstName ?? profile.displayName,
            profile.lastName ?? null,
            buildProfilePersonalDataPatch(profile),
          ],
        );

        if (!updatedUser) {
          throw new AppError(404, 'Пользователь не найден');
        }

        user = updatedUser;
      }

      await markVerificationCodeUsed(record.id);
      await markUserPhoneVerified(user.id, normalized);

      logAudit({
        userId: user.id,
        action: 'login_phone',
        entityType: 'user',
        entityId: user.id,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    const tokens = generateTokens(user.id, user.email || '', user.role);
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
      [user.id, tokens.refreshToken],
    );

    linkApprovalSessionsByPhone(user.id, normalized).catch((error: unknown) =>
      logger.error('approval link error', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
      }),
    );

    runPostLoginBackfill(user.id, normalized, user.email).catch((error: unknown) =>
      logger.error('post-login backfill error', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
      }),
    );

    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          displayName: user.display_name,
          phone: normalized,
          phone_verified: true,
          phoneVerified: true,
          role: user.role,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        isNewUser,
      },
    });

    logger.info('Phone OTP verified', {
      requestId: getRequestId(),
      phoneMasked,
      fingerprintVisitorId: maskOpaqueId(fingerprintVisitorId),
      staffOnly: !!staffOnly,
      isNewUser,
      role: user.role,
    });
  },
);

router.post(
  '/profile-phone-verify',
  requirePhoneAuth,
  authenticateToken,
  validate(profilePhoneVerifySchema),
  phoneVerifyIpLimiter,
  phoneVerifyDeviceLimiter,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.user) {
      throw new AppError(401, 'Unauthorized', ErrorCode.UNAUTHORIZED);
    }
    const userId = req.user.id;
    const userEmail = req.user.email;

    const { phone, code, fingerprintVisitorId } = req.body;
    const normalized = normalizePhone(phone);
    if (normalized.length < 11) {
      throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
    }
    const phoneMasked = maskPhoneForLogs(normalized);

    const record = await db.queryOne<VerificationCodeRow>(
      `SELECT id, code, attempts, method FROM verification_codes
       WHERE phone = $1 AND purpose = 'phone_login'
         AND used_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [normalized],
    );

    if (!record) {
      logger.warn('Profile phone voice OTP rejected', {
        requestId: getRequestId(),
        phoneMasked,
        userId,
        reason: 'expired_or_missing',
      });
      await recordPhoneOtpEventSafely({
        userId,
        phone: normalized,
        eventType: 'code_expired_or_missing',
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'expired_or_missing', scope: 'profile_phone' },
      });
      throw new AppError(400, 'Код недействителен или истёк. Запросите новый.', ErrorCode.PHONE_CODE_EXPIRED);
    }

    const maxAttempts = record.method === 'flash_call' ? 3 : 5;
    if (record.attempts >= maxAttempts) {
      logger.warn('Profile phone voice OTP rejected', {
        requestId: getRequestId(),
        phoneMasked,
        userId,
        reason: 'max_attempts',
      });
      await recordPhoneOtpEventSafely({
        userId,
        verificationCodeId: record.id,
        phone: normalized,
        eventType: 'verify_max_attempts',
        provider: record.method,
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'max_attempts', attempts: record.attempts, maxAttempts, scope: 'profile_phone' },
      });
      throw new AppError(400, 'Превышено количество попыток. Запросите новый код.', ErrorCode.PHONE_CODE_MAX_ATTEMPTS);
    }

    if (record.code !== code) {
      await db.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
      logger.warn('Profile phone voice OTP rejected', {
        requestId: getRequestId(),
        phoneMasked,
        userId,
        reason: 'invalid_code',
      });
      await recordPhoneOtpEventSafely({
        userId,
        verificationCodeId: record.id,
        phone: normalized,
        eventType: 'verify_failed',
        provider: record.method,
        fingerprintVisitorId,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        details: { reason: 'invalid_code', attemptsAfter: record.attempts + 1, maxAttempts, scope: 'profile_phone' },
      });
      throw new AppError(400, 'Неверный код', ErrorCode.PHONE_CODE_INVALID);
    }

    await recordPhoneOtpEventSafely({
      userId,
      verificationCodeId: record.id,
      phone: normalized,
      eventType: 'verified',
      provider: record.method,
      fingerprintVisitorId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      details: { scope: 'profile_phone' },
    });

    const existingOwner = await db.queryOne<PhoneOwnerRow>(
      'SELECT id FROM users WHERE phone = $1 AND id <> $2 LIMIT 1',
      [normalized, userId],
    );
    if (existingOwner) {
      throw new AppError(409, 'Этот телефон уже привязан к другому аккаунту');
    }

    await markVerificationCodeUsed(record.id);
    await db.query(
      'UPDATE users SET phone = $1, phone_verified = true, updated_at = NOW() WHERE id = $2',
      [normalized, userId],
    );

    linkApprovalSessionsByPhone(userId, normalized).catch((error: unknown) =>
      logger.error('approval link error', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      }),
    );

    runPostLoginBackfill(userId, normalized, userEmail).catch((error: unknown) =>
      logger.error('post-login backfill error', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      }),
    );

    logAudit({
      userId,
      action: 'verify_phone_voice',
      entityType: 'user',
      entityId: userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ success: true });
  },
);

export default router;
