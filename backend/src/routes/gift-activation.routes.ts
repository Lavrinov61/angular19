/**
 * Account-first gift activation routes.
 *
 * Namespace: /api/subscriptions/gift-activation/*
 * Session: httpOnly cookie `gift_activation_sid` (TTL 900s) + `activation_token`
 *          body fallback for cookie-less / cross-site clients.
 *
 * Flow:
 *   POST /start  → validate promo + identity, open session, send voice+email
 *   POST /email  → verify the 4-digit email code
 *   POST /verify → verify voice code (or viaEmailOnly) and FINALIZE atomically
 *   POST /resend → re-send a code (email correction allowed)
 *
 * The gift recognition route (GET /subscriptions/trial-info/:code) lives in
 * subscriptions.routes.ts and is intentionally untouched.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';

import type { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';

import { config } from '../config/index.js';
import { ErrorCode } from '../constants/error-codes.js';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import { getRequestId } from '../middleware/request-context.js';
import { signJwt } from '../utils/jwt-keys.js';
import {
  giftActivationStartSchema,
  giftActivationCodeSchema,
  giftActivationFinalizeSchema,
  giftActivationResendSchema,
} from '../schemas/subscriptions.schema.js';
import {
  startGiftActivation,
  requireSession,
  verifyEmailCode,
  verifyPhoneCode,
  resendCode,
  finalizeActivation,
  GIFT_ACTIVATION_SESSION_TTL_SEC,
  getMaskedPhone,
  getMaskedEmail,
  type GiftActivationSession,
} from '../services/gift-activation.service.js';
import { createLogger } from '../utils/logger.js';
import { setAuthCookies } from './auth-cookies.js';

const router = express.Router();
const logger = createLogger('gift-activation.routes');

const SESSION_COOKIE = 'gift_activation_sid';
const COOKIE_PATH = '/api/subscriptions/gift-activation';
const RESEND_COOLDOWN_SEC = 60;

const RATE_WINDOW_MS = 10 * 60 * 1000;
const START_IP_MAX = 10; // 10 /10min per IP
const START_FINGERPRINT_MAX = 6; // 6 /10min per device

// ─── Feature gate ─────────────────────────────────────

function requireGiftActivationEnabled(_req: Request, _res: Response, next: NextFunction): void {
  if (!config.featureFlags.giftActivationEnabled) {
    throw new AppError(503, 'Активация подарка временно недоступна', ErrorCode.ACTIVATION_DISABLED);
  }
  next();
}

// ─── Session id resolution (cookie OR body token) ─────

function getSessionId(req: Request): string | undefined {
  const cookieId = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
  if (typeof cookieId === 'string' && cookieId) return cookieId;
  const bodyToken = (req.body as { activation_token?: unknown } | undefined)?.activation_token;
  if (typeof bodyToken === 'string' && bodyToken) return bodyToken;
  return undefined;
}

function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: GIFT_ACTIVATION_SESSION_TTL_SEC * 1000,
    path: COOKIE_PATH,
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: COOKIE_PATH });
}

// ─── DOB validation (range 1900..today) ───────────────

function assertValidDateOfBirth(dob: string | undefined): void {
  if (!dob) return;
  const parsed = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError(400, 'Некорректная дата рождения', ErrorCode.VALIDATION_ERROR);
  }
  const year = parsed.getUTCFullYear();
  const today = new Date();
  if (year < 1900 || parsed.getTime() > today.getTime()) {
    throw new AppError(400, 'Дата рождения вне допустимого диапазона', ErrorCode.VALIDATION_ERROR);
  }
}

// ─── Rate limiters for /start ─────────────────────────

function getFingerprint(req: Request): string | undefined {
  const fp = (req.body as { fingerprint_visitor_id?: unknown } | undefined)?.fingerprint_visitor_id;
  return typeof fp === 'string' && fp.trim() ? fp.trim() : undefined;
}

function startRateLimitExceeded(_req: Request, res: Response, scope: 'ip' | 'device'): void {
  logger.warn('Gift activation /start rate limit hit', { requestId: getRequestId(), scope });
  res.status(429).json({
    success: false,
    error: 'Слишком много попыток активации. Подождите 10 минут.',
    code: ErrorCode.ACTIVATION_RATE_LIMITED,
  });
}

const startIpLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: START_IP_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('gift-activation-start-ip:'),
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  handler: (req, res) => startRateLimitExceeded(req, res, 'ip'),
});

const startFingerprintLimiter = rateLimit({
  windowMs: RATE_WINDOW_MS,
  max: START_FINGERPRINT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('gift-activation-start-fp:'),
  skip: (req) => !getFingerprint(req),
  keyGenerator: (req) => getFingerprint(req) || 'missing-fingerprint',
  handler: (req, res) => startRateLimitExceeded(req, res, 'device'),
});

// ─── Response shaping ─────────────────────────────────

function voiceExpiresIn(session: GiftActivationSession): number {
  return Math.max(0, Math.floor((session.voice.expiresAt - Date.now()) / 1000));
}

function emailExpiresIn(session: GiftActivationSession): number {
  return Math.max(0, Math.floor((session.emailCode.expiresAt - Date.now()) / 1000));
}

// ─── POST /start ──────────────────────────────────────

router.post(
  '/start',
  requireGiftActivationEnabled,
  validate(giftActivationStartSchema),
  startIpLimiter,
  startFingerprintLimiter,
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as {
      promo_code: string;
      full_name: string;
      date_of_birth?: string;
      phone: string;
      email: string;
      policy_version: string;
      fingerprint_visitor_id?: string;
    };

    assertValidDateOfBirth(body.date_of_birth);

    const { session, voiceSent } = await startGiftActivation({
      promoCode: body.promo_code,
      fullName: body.full_name,
      dateOfBirth: body.date_of_birth,
      phone: body.phone,
      email: body.email,
      policyVersion: body.policy_version,
      fingerprintVisitorId: body.fingerprint_visitor_id,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    setSessionCookie(res, session.id);

    res.json({
      success: true,
      activation_token: session.id,
      maskedPhone: getMaskedPhone(session.phone),
      maskedEmail: getMaskedEmail(session.email),
      voice: { expiresIn: voiceExpiresIn(session) },
      email: { expiresIn: emailExpiresIn(session) },
      resendCooldownSec: RESEND_COOLDOWN_SEC,
      voiceSent,
    });
  },
);

// ─── POST /verify-email ───────────────────────────────

router.post(
  '/verify-email',
  requireGiftActivationEnabled,
  validate(giftActivationCodeSchema),
  async (req: Request, res: Response): Promise<void> => {
    const session = await requireSession(getSessionId(req));
    await verifyEmailCode(session, (req.body as { code: string }).code);

    res.json({
      success: true,
      emailVerified: true,
      // canFinalize === emailVerified: phone is optional via the email-only branch.
      canFinalize: true,
    });
  },
);

// ─── POST /verify-phone ───────────────────────────────

router.post(
  '/verify-phone',
  requireGiftActivationEnabled,
  validate(giftActivationCodeSchema),
  async (req: Request, res: Response): Promise<void> => {
    const session = await requireSession(getSessionId(req));
    // verifyPhoneCode also marks verification_codes(purpose='phone_login') used
    // right here — closing the side-channel at verify time, not just finalize.
    await verifyPhoneCode(session, (req.body as { code: string }).code);

    res.json({
      success: true,
      phoneVerified: true,
      canFinalize: session.emailCode.verified,
    });
  },
);

// ─── POST /finalize ───────────────────────────────────

router.post(
  '/finalize',
  requireGiftActivationEnabled,
  validate(giftActivationFinalizeSchema),
  async (req: Request, res: Response): Promise<void> => {
    const session = await requireSession(getSessionId(req));
    const { viaEmailOnly } = req.body as { viaEmailOnly: boolean };

    // emailVerified is required ALWAYS.
    if (!session.emailCode.verified) {
      throw new AppError(409, 'Сначала подтвердите email', ErrorCode.ACTIVATION_NOT_VERIFIED);
    }
    // phoneVerified is required UNLESS the client explicitly chose email-only.
    if (!viaEmailOnly && !session.voice.verified) {
      throw new AppError(409, 'Сначала подтвердите телефон', ErrorCode.ACTIVATION_NOT_VERIFIED);
    }

    // Server is the sole authority on phone verification — never trust the
    // client's `viaEmailOnly` here beyond letting it opt OUT of the phone step.
    const phoneVerified = session.voice.verified;

    const result = await finalizeActivation(session, phoneVerified, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // ── Account-takeover guard ──────────────────────────────────────────────
    // NEVER mint a login session when the phone was not verified. The session
    // initiator has only proven control of the supplied email, not of the phone
    // the account is keyed on — auto-login would let an attacker who started an
    // activation with a victim's phone + their own email hijack the victim's
    // account. The gift IS still activated (subscription attached to the phone);
    // the user signs in afterward through the normal phone-OTP flow, which
    // proves phone ownership. (email-only is the "не поступает звонок" fallback.)
    if (!phoneVerified) {
      clearSessionCookie(res);
      res.json({
        success: true,
        user: { id: result.user.id },
        account: result.account,
        subscription: result.subscription,
        isNewUser: result.isNewUser,
        phone_verified: false,
        requiresPhoneLogin: true,
        ...(result.emailLinkedElsewhere ? { emailLinkedElsewhere: true } : {}),
      });
      return;
    }

    const tokens = await issueLoginTokens(result.user.id, result.user.email, result.user.role);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    clearSessionCookie(res);

    res.json({
      success: true,
      user: result.user,
      account: result.account,
      subscription: result.subscription,
      isNewUser: result.isNewUser,
      phone_verified: result.phone_verified,
      requiresPhoneLogin: false,
      ...(result.emailLinkedElsewhere ? { emailLinkedElsewhere: true } : {}),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  },
);

// ─── POST /resend ─────────────────────────────────────

router.post(
  '/resend',
  requireGiftActivationEnabled,
  validate(giftActivationResendSchema),
  async (req: Request, res: Response): Promise<void> => {
    const session = await requireSession(getSessionId(req));
    const body = req.body as { channel: 'voice' | 'email'; email?: string };

    try {
      const result = await resendCode(session, body.channel, body.email, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.json({
        success: true,
        [body.channel]: { expiresIn: result.expiresIn },
        resendCooldownSec: result.resendCooldownSec,
        ...(result.maskedEmail ? { maskedEmail: result.maskedEmail } : {}),
      });
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.ACTIVATION_RATE_LIMITED) {
        const retryAfterSec = (err as AppError & { retryAfterSec?: number }).retryAfterSec;
        res.status(429).json({
          success: false,
          error: err.message,
          code: ErrorCode.ACTIVATION_RATE_LIMITED,
          ...(typeof retryAfterSec === 'number' ? { retryAfterSec } : {}),
        });
        return;
      }
      throw err;
    }
  },
);

export default router;

// ─── JWT issuance ─────────────────────────────────────

/**
 * Mirrors phone-auth token issuance: signs an access + refresh JWT and persists
 * the refresh token. Kept local so the gift-activation flow does not depend on
 * phone-auth route internals.
 */
async function issueLoginTokens(
  userId: string,
  email: string | null,
  role: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signJwt(
    { userId, email: email || '', role },
    { expiresIn: config.jwt.expiresIn as StringValue } as SignOptions,
  );
  const refreshToken = signJwt(
    { userId, email, role },
    { expiresIn: config.jwt.refreshExpiresIn as StringValue } as SignOptions,
  );
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [userId, refreshToken],
  );
  return { accessToken, refreshToken };
}
