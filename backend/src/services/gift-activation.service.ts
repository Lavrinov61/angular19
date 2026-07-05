/**
 * Account-first gift activation — session + code orchestration.
 *
 * The flow is multi-step and stateful, so each in-progress activation lives in
 * a short-lived Redis session (15 min TTL) keyed by an opaque UUID. The session
 * id is delivered to the client both as an httpOnly cookie (`gift_activation_sid`)
 * and as an `activation_token` body field (cookie-less fallback for embedded /
 * cross-site contexts).
 *
 * Codes:
 *  - voice: 4-digit OTP delivered via the same Voximplant dispatcher used by
 *    phone-login, and ALSO written to verification_codes(purpose='phone_login')
 *    so the existing /phone-verify path stays consistent. The finalize step
 *    burns that row to close the side-channel.
 *  - email: 4-digit code delivered by SMTP, verified purely against the session.
 *
 * Anti-brute: 5 wrong tries per code → the code is burned (regenerate via
 * /resend). Session is the single source of truth for verification state.
 */

import crypto from 'crypto';
import type { PoolClient } from 'pg';

import { config } from '../config/index.js';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { ErrorCode } from '../constants/error-codes.js';
import { createLazyRedis, isRedisReady } from './redis-factory.js';
import { createLogger } from '../utils/logger.js';
import { recordPrivacyConsentTx } from './privacy-consent.service.js';
import { sendGiftActivationCodeEmail } from './email.service.js';
import { requestVoiceOtpDispatch } from './voice-otp-dispatcher.service.js';
import { recordPhoneOtpEventSafely } from './phone-otp-event.service.js';
import {
  getGiftSubscriptionPromoInfo,
  finalizeGiftActivation,
  normalizePhone,
  type FinalizeGiftActivationResult,
} from './subscription.service.js';
import {
  giftActivationStartedTotal,
  giftActivationFinalizedTotal,
  giftActivationCodeRejectedTotal,
  giftActivationCodeLockedTotal,
} from './metrics.service.js';

const logger = createLogger('gift-activation.service');

// ─── Constants ────────────────────────────────────────

export const GIFT_ACTIVATION_SESSION_TTL_SEC = 15 * 60; // 15 min
const SESSION_KEY_PREFIX = 'activation:';
const MAX_CODE_ATTEMPTS = 5; // 5 wrong tries → burn the code
const RESEND_COOLDOWN_SEC = 60;
const MAX_RESENDS_PER_CHANNEL = 3;
const VOICE_PHONE_WINDOW_MIN = 10;
const VOICE_PHONE_MAX_PER_WINDOW = 3;

const getRedis = createLazyRedis('gift-activation', { keyPrefix: '' });

// ─── Types ────────────────────────────────────────────

export type GiftActivationChannel = 'voice' | 'email';

interface CodeState {
  code: string;
  /** epoch ms */
  expiresAt: number;
  attempts: number;
  /** true once burned (max attempts / consumed). Never re-verifiable. */
  burned: boolean;
  verified: boolean;
  /** how many times this channel has been (re)sent in this session */
  sends: number;
  /** epoch ms of the last send, for cooldown */
  lastSentAt: number;
}

export interface GiftActivationSession {
  id: string;
  promoCode: string;
  planId: string;
  planName: string;
  fullName: string;
  dateOfBirth?: string;
  phone: string;
  email: string;
  policyVersion: string;
  fingerprintVisitorId?: string;
  voice: CodeState;
  emailCode: CodeState;
  createdAt: number;
}

export interface StartGiftActivationInput {
  promoCode: string;
  fullName: string;
  dateOfBirth?: string;
  phone: string;
  email: string;
  policyVersion: string;
  fingerprintVisitorId?: string;
  ip?: string | null;
  userAgent?: string | string[] | null;
}

export interface StartGiftActivationResult {
  session: GiftActivationSession;
  voiceSent: boolean;
}

// ─── Redis helpers ────────────────────────────────────

function sessionKey(id: string): string {
  return `${SESSION_KEY_PREFIX}${id}`;
}

function requireRedis() {
  const redis = getRedis();
  if (!redis || !isRedisReady(redis)) {
    throw new AppError(503, 'Сервис активации временно недоступен. Попробуйте позже.', ErrorCode.INTERNAL_ERROR);
  }
  return redis;
}

async function saveSession(session: GiftActivationSession): Promise<void> {
  const redis = requireRedis();
  // Preserve the original TTL window: a 15-min session should not be extended
  // by every code attempt, so we anchor expiry to createdAt.
  const elapsedSec = Math.floor((Date.now() - session.createdAt) / 1000);
  const ttl = Math.max(1, GIFT_ACTIVATION_SESSION_TTL_SEC - elapsedSec);
  await redis.set(sessionKey(session.id), JSON.stringify(session), 'EX', ttl);
}

export async function getSession(id: string): Promise<GiftActivationSession | null> {
  const redis = requireRedis();
  const raw = await redis.get(sessionKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GiftActivationSession;
  } catch {
    logger.warn('Corrupt gift activation session JSON', { sessionId: id });
    return null;
  }
}

export async function deleteSession(id: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  await redis.del(sessionKey(id)).catch((err: unknown) =>
    logger.warn('Failed to delete gift activation session', {
      sessionId: id,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/** Loads a session or throws ACTIVATION_SESSION_INVALID (401). */
export async function requireSession(id: string | undefined | null): Promise<GiftActivationSession> {
  if (!id) {
    throw new AppError(401, 'Сессия активации не найдена или истекла', ErrorCode.ACTIVATION_SESSION_INVALID);
  }
  const session = await getSession(id);
  if (!session) {
    throw new AppError(401, 'Сессия активации не найдена или истекла', ErrorCode.ACTIVATION_SESSION_INVALID);
  }
  return session;
}

// ─── Code utilities ───────────────────────────────────

function generate4DigitCode(): string {
  return crypto.randomInt(1000, 10000).toString();
}

function newCodeState(): CodeState {
  return { code: '', expiresAt: 0, attempts: 0, burned: true, verified: false, sends: 0, lastSentAt: 0 };
}

function getVoiceTtlSeconds(): number {
  return Math.max(30, config.voximplant.voiceCall.ttlSeconds || 120);
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `+7 (${digits.slice(1, 4)}) •••-••-${digits.slice(-2)}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 1);
  return `${head}${'•'.repeat(Math.max(1, local.length - 1))}@${domain}`;
}

export function getMaskedPhone(phone: string): string {
  return maskPhone(phone);
}

export function getMaskedEmail(email: string): string {
  return maskEmail(email);
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ─── Code senders ─────────────────────────────────────

/**
 * Sends a 4-digit voice OTP through the shared dispatcher and records it in
 * verification_codes(purpose='phone_login'). Returns the sent code on success.
 *
 * Mirrors phone-auth /phone-code: phone-level rate limit (3/10min) then
 * dispatch. Returns null when delivery failed — the caller decides whether to
 * fall back to email-only (at /start) or surface a 503 (at /resend).
 */
async function sendVoiceCode(
  phone: string,
  ctx: { ip?: string | null; userAgent?: string | string[] | null; fingerprintVisitorId?: string },
): Promise<{ code: string; expiresIn: number } | null> {
  if (!config.voximplant.voiceCall.enabled) return null;

  // Phone-level rate limit (max 3 / 10 min), tracked in Redis. We deliberately
  // do NOT persist the code to verification_codes(purpose='phone_login'): such a
  // row would be replayable against the regular /auth/phone-verify endpoint and
  // let a caller log in by phone WITHOUT going through the account-first flow
  // (bypassing the email step). The activation voice code lives ONLY in the
  // Redis session and is validated there (verifyPhoneCode).
  const redis = requireRedis();
  const rateLimitKey = `gift-voice-rl:${phone}`;
  const sentInWindow = parseInt((await redis.get(rateLimitKey)) || '0', 10);
  if (sentInWindow >= VOICE_PHONE_MAX_PER_WINDOW) {
    logger.warn('Gift activation voice phone-level limit hit', { phoneMasked: maskPhone(phone) });
    return null;
  }

  const ttlSeconds = getVoiceTtlSeconds();
  const code = generate4DigitCode();
  const dispatch = await requestVoiceOtpDispatch(phone, code);
  if (!dispatch.success) {
    logger.warn('Gift activation voice OTP delivery failed', {
      phoneMasked: maskPhone(phone),
      reason: dispatch.reason,
    });
    return null;
  }

  const delivery = dispatch.data;
  const verificationCode = delivery.verificationCode || code;

  // Count only successfully-dispatched calls toward the window.
  const sentCount = await redis.incr(rateLimitKey);
  if (sentCount === 1) await redis.expire(rateLimitKey, VOICE_PHONE_WINDOW_MIN * 60);

  await recordPhoneOtpEventSafely({
    phone,
    eventType: 'delivery_started',
    provider: delivery.provider,
    providerRequestId: delivery.requestId,
    callSessionHistoryId: delivery.callSessionHistoryId,
    callerId: delivery.callerId,
    fingerprintVisitorId: ctx.fingerprintVisitorId,
    ip: ctx.ip ?? undefined,
    userAgent: Array.isArray(ctx.userAgent) ? ctx.userAgent.join(', ') : ctx.userAgent ?? undefined,
    details: { channel: 'voice_call', client: 'gift_activation', expiresIn: ttlSeconds },
  });

  return { code: verificationCode, expiresIn: ttlSeconds };
}

/** Sends the email code. Returns true if SMTP accepted the message. */
async function sendEmailCode(email: string, code: string): Promise<boolean> {
  return sendGiftActivationCodeEmail(email, code, Math.floor(GIFT_ACTIVATION_SESSION_TTL_SEC / 60));
}

// ─── Start ────────────────────────────────────────────

/**
 * Opens an activation session: validates the gift promo, generates codes,
 * dispatches voice + email, persists the session.
 *
 * Throws 503 only when BOTH channels fail (the client then has no way to
 * proceed). A voice-only failure returns voiceSent=false — the UI falls back to
 * email-only verification.
 */
export async function startGiftActivation(input: StartGiftActivationInput): Promise<StartGiftActivationResult> {
  const cleanPhone = normalizePhone(input.phone);
  if (cleanPhone.length < 11) {
    throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
  }

  const promo = await getGiftSubscriptionPromoInfo(input.promoCode);
  if (!promo) {
    throw new AppError(404, 'Подарочный промокод не найден или уже использован', ErrorCode.GIFT_PROMO_INVALID);
  }

  const email = input.email.trim().toLowerCase();
  const now = Date.now();
  const sessionId = crypto.randomUUID();

  // Generate the email code now; the voice code is owned by the dispatcher.
  const emailCodeValue = generate4DigitCode();

  const voiceResult = await sendVoiceCode(cleanPhone, {
    ip: input.ip,
    userAgent: input.userAgent,
    fingerprintVisitorId: input.fingerprintVisitorId,
  });
  const emailSent = await sendEmailCode(email, emailCodeValue);

  if (!voiceResult && !emailSent) {
    throw new AppError(
      503,
      'Не удалось отправить код ни по телефону, ни на email. Попробуйте позже.',
      ErrorCode.PHONE_SEND_FAILED,
    );
  }

  const voiceTtl = voiceResult?.expiresIn ?? getVoiceTtlSeconds();
  const session: GiftActivationSession = {
    id: sessionId,
    promoCode: promo.promo_code,
    planId: promo.plan_id,
    planName: promo.plan_name,
    fullName: input.fullName.trim(),
    dateOfBirth: input.dateOfBirth,
    phone: cleanPhone,
    email,
    policyVersion: input.policyVersion,
    fingerprintVisitorId: input.fingerprintVisitorId,
    voice: voiceResult
      ? {
          code: voiceResult.code,
          expiresAt: now + voiceTtl * 1000,
          attempts: 0,
          burned: false,
          verified: false,
          sends: 1,
          lastSentAt: now,
        }
      : { ...newCodeState(), sends: 0 },
    emailCode: emailSent
      ? {
          code: emailCodeValue,
          expiresAt: now + GIFT_ACTIVATION_SESSION_TTL_SEC * 1000,
          attempts: 0,
          burned: false,
          verified: false,
          sends: 1,
          lastSentAt: now,
        }
      : { ...newCodeState(), sends: 0 },
    createdAt: now,
  };

  await saveSession(session);
  giftActivationStartedTotal.inc({ voice_sent: voiceResult ? 'true' : 'false' });

  logger.info('Gift activation session started', {
    sessionId,
    phoneMasked: maskPhone(cleanPhone),
    emailMasked: maskEmail(email),
    voiceSent: !!voiceResult,
    emailSent,
  });

  return { session, voiceSent: !!voiceResult };
}

// ─── Verify a code against the session ────────────────

type VerifyOutcome = 'ok';

/**
 * Verifies a code against session state, mutating attempts/verified/burned.
 * The caller is responsible for persisting the session afterward.
 *
 * Throws:
 *  - 400 *_CODE_EXPIRED when the code expired / was never sent on this channel
 *  - 423 ACTIVATION_CODE_LOCKED once burned (max attempts reached)
 *  - 400 *_CODE_INVALID on a wrong code (and burns on the 5th wrong try)
 */
function verifyCodeState(
  state: CodeState,
  supplied: string,
  channel: GiftActivationChannel,
): VerifyOutcome {
  const expiredCode = channel === 'email' ? ErrorCode.EMAIL_CODE_EXPIRED : ErrorCode.PHONE_CODE_EXPIRED;
  const invalidCode = channel === 'email' ? ErrorCode.EMAIL_CODE_INVALID : ErrorCode.PHONE_CODE_INVALID;

  if (state.burned) {
    giftActivationCodeLockedTotal.inc({ channel });
    throw new AppError(423, 'Код заблокирован. Запросите новый.', ErrorCode.ACTIVATION_CODE_LOCKED);
  }
  if (!state.code || Date.now() > state.expiresAt) {
    throw new AppError(400, 'Код недействителен или истёк. Запросите новый.', expiredCode);
  }
  if (state.attempts >= MAX_CODE_ATTEMPTS) {
    state.burned = true;
    giftActivationCodeLockedTotal.inc({ channel });
    throw new AppError(423, 'Код заблокирован. Запросите новый.', ErrorCode.ACTIVATION_CODE_LOCKED);
  }

  if (!timingSafeEqual(state.code, supplied)) {
    state.attempts += 1;
    giftActivationCodeRejectedTotal.inc({ channel, reason: 'invalid' });
    if (state.attempts >= MAX_CODE_ATTEMPTS) {
      state.burned = true;
      giftActivationCodeLockedTotal.inc({ channel });
      throw new AppError(423, 'Код заблокирован. Запросите новый.', ErrorCode.ACTIVATION_CODE_LOCKED);
    }
    throw new AppError(400, 'Неверный код', invalidCode);
  }

  state.verified = true;
  return 'ok';
}

/**
 * Verifies the email code and persists the session. The session is saved on
 * BOTH success and failure so the attempt counter / burn flag survive wrong
 * tries (anti-brute state must not be lost when verifyCodeState throws).
 */
export async function verifyEmailCode(session: GiftActivationSession, code: string): Promise<GiftActivationSession> {
  try {
    verifyCodeState(session.emailCode, code, 'email');
  } finally {
    await saveSession(session);
  }
  return session;
}

/**
 * Verifies the phone (voice) code and persists the session (success and failure
 * alike, see {@link verifyEmailCode}).
 *
 * On a SUCCESSFUL match this also marks the phone's verification_codes row
 * (purpose='phone_login') as used immediately — closing the side-channel right
 * at /verify-phone instead of waiting for /finalize, so the code cannot be
 * replayed against the regular /phone-verify endpoint in the meantime.
 */
export async function verifyPhoneCode(session: GiftActivationSession, code: string): Promise<void> {
  let matched = false;
  try {
    verifyCodeState(session.voice, code, 'voice');
    matched = true;
  } finally {
    await saveSession(session);
  }
  if (matched) {
    await db.query(
      `UPDATE verification_codes
          SET used_at = NOW()
        WHERE phone = $1 AND purpose = 'phone_login' AND used_at IS NULL`,
      [session.phone],
    );
  }
}

// ─── Resend ───────────────────────────────────────────

export interface ResendResult {
  expiresIn: number;
  resendCooldownSec: number;
  maskedEmail?: string;
}

/**
 * Re-sends a code on the requested channel. Email correction allowed (channel
 * 'email' + new email). Enforces 60s cooldown and max 3 sends/channel/session.
 */
export async function resendCode(
  session: GiftActivationSession,
  channel: GiftActivationChannel,
  newEmail: string | undefined,
  ctx: { ip?: string | null; userAgent?: string | string[] | null },
): Promise<ResendResult> {
  const state = channel === 'voice' ? session.voice : session.emailCode;
  const now = Date.now();

  if (state.sends >= MAX_RESENDS_PER_CHANNEL) {
    throw new AppError(429, 'Превышен лимит повторных отправок кода.', ErrorCode.ACTIVATION_RATE_LIMITED);
  }
  const sinceLast = Math.floor((now - state.lastSentAt) / 1000);
  if (state.lastSentAt > 0 && sinceLast < RESEND_COOLDOWN_SEC) {
    const retryAfterSec = RESEND_COOLDOWN_SEC - sinceLast;
    const err = new AppError(429, 'Слишком частые запросы кода. Подождите.', ErrorCode.ACTIVATION_RATE_LIMITED);
    // attach retryAfterSec for the route to surface
    (err as AppError & { retryAfterSec?: number }).retryAfterSec = retryAfterSec;
    throw err;
  }

  if (channel === 'voice') {
    const result = await sendVoiceCode(session.phone, {
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      fingerprintVisitorId: session.fingerprintVisitorId,
    });
    if (!result) {
      throw new AppError(503, 'Не удалось отправить код звонком. Попробуйте email.', ErrorCode.PHONE_SEND_FAILED);
    }
    session.voice = {
      code: result.code,
      expiresAt: now + result.expiresIn * 1000,
      attempts: 0,
      burned: false,
      verified: false,
      sends: state.sends + 1,
      lastSentAt: now,
    };
    await saveSession(session);
    return { expiresIn: result.expiresIn, resendCooldownSec: RESEND_COOLDOWN_SEC };
  }

  // email channel — allow correction
  if (newEmail) {
    session.email = newEmail.trim().toLowerCase();
  }
  const code = generate4DigitCode();
  const sent = await sendEmailCode(session.email, code);
  if (!sent) {
    throw new AppError(503, 'Не удалось отправить код на email. Попробуйте позже.', ErrorCode.PHONE_SEND_FAILED);
  }
  session.emailCode = {
    code,
    expiresAt: now + GIFT_ACTIVATION_SESSION_TTL_SEC * 1000,
    attempts: 0,
    burned: false,
    verified: false,
    sends: state.sends + 1,
    lastSentAt: now,
  };
  await saveSession(session);
  return {
    expiresIn: Math.floor(GIFT_ACTIVATION_SESSION_TTL_SEC),
    resendCooldownSec: RESEND_COOLDOWN_SEC,
    maskedEmail: maskEmail(session.email),
  };
}

// ─── Finalize ─────────────────────────────────────────

export interface FinalizeResult extends FinalizeGiftActivationResult {
  phone_verified: boolean;
  /** Convenience top-level mirror of !account.already_existed. */
  isNewUser: boolean;
}

/**
 * Runs the atomic finalize: account find-or-create + subscription create/extend
 * + promo burn + privacy consent — all in ONE db.transaction. On success the
 * voice verification_codes row is burned (close the side-channel) and the Redis
 * session is deleted. Returns the data the route needs to set auth cookies.
 *
 * `phoneVerified` reflects whether the voice code was confirmed (false for the
 * email-only path).
 */
export async function finalizeActivation(
  session: GiftActivationSession,
  phoneVerified: boolean,
  ctx: { ip?: string | null; userAgent?: string | string[] | null },
): Promise<FinalizeResult> {
  if (!session.emailCode.verified) {
    throw new AppError(409, 'Сначала подтвердите email', ErrorCode.ACTIVATION_NOT_VERIFIED);
  }

  const result = await db.transaction(async (client: PoolClient) => {
    const finalized = await finalizeGiftActivation(client, {
      promo_code: session.promoCode,
      phone: session.phone,
      email: session.email,
      full_name: session.fullName,
      date_of_birth: session.dateOfBirth,
      phone_verified: phoneVerified,
    });

    // Close the side-channel: any phone_login code for this phone is now spent,
    // so it cannot be replayed against the regular /phone-verify endpoint.
    await client.query(
      `UPDATE verification_codes
          SET used_at = NOW()
        WHERE phone = $1 AND purpose = 'phone_login' AND used_at IS NULL`,
      [session.phone],
    );

    await recordPrivacyConsentTx(client, {
      userId: finalized.user.id,
      visitorId: session.fingerprintVisitorId ?? null,
      documentType: 'gift_activation_pdn',
      documentVersion: session.policyVersion,
      scope: ['personal_data', 'privacy_policy', 'public_offer', 'subscription_activation'],
      source: 'gift_activation',
      accepted: true,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
      details: {
        promoCode: session.promoCode,
        planId: session.planId,
        phoneVerified,
        emailLinkedElsewhere: finalized.emailLinkedElsewhere,
      },
    });

    return finalized;
  });

  await deleteSession(session.id);

  giftActivationFinalizedTotal.inc({
    mode: result.subscription.mode,
    account: result.account.already_existed ? 'existing' : 'new',
    via: phoneVerified ? 'voice' : 'email',
  });

  logger.info('Gift activation finalized', {
    sessionId: session.id,
    userId: result.user.id,
    mode: result.subscription.mode,
    accountExisted: result.account.already_existed,
    phoneVerified,
    emailLinkedElsewhere: result.emailLinkedElsewhere,
  });

  return { ...result, phone_verified: phoneVerified, isNewUser: !result.account.already_existed };
}
