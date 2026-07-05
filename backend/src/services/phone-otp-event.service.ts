import { createHmac } from 'node:crypto';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { PhoneOtpEventDetailsJsonb } from '../types/jsonb/phone-otp-event-jsonb.js';
import type {
  ExpiredPhoneOtpCodeRow,
  PhoneOtpEventCreatedRow,
  PhoneOtpEventType,
} from '../types/views/phone-otp-event-views.js';

const log = createLogger('phone-otp-event.service');

const INSERT_PHONE_OTP_EVENT_SQL = `
  INSERT INTO phone_otp_events
    (
      user_id,
      verification_code_id,
      phone_hash,
      phone_last4,
      purpose,
      event_type,
      provider,
      provider_request_id,
      call_session_history_id,
      caller_id,
      fingerprint_visitor_id,
      ip,
      user_agent,
      details
    )
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::inet, $13, $14::jsonb)
  ON CONFLICT (verification_code_id, event_type) WHERE verification_code_id IS NOT NULL DO NOTHING
  RETURNING id
`;

export interface PhoneOtpEventRecordInput {
  userId?: string | null;
  verificationCodeId?: string | null;
  phone: string;
  purpose?: string;
  eventType: PhoneOtpEventType;
  provider?: string | null;
  providerRequestId?: string | null;
  callSessionHistoryId?: string | null;
  callerId?: string | null;
  fingerprintVisitorId?: string | null;
  ip?: string | null;
  userAgent?: string | string[] | null;
  details?: PhoneOtpEventDetailsJsonb;
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function hashPhone(phone: string): string {
  return createHmac('sha256', config.jwt.secret)
    .update(normalizePhoneDigits(phone))
    .digest('hex');
}

function phoneLast4(phone: string): string {
  return normalizePhoneDigits(phone).slice(-4);
}

function normalizeUserAgent(userAgent: PhoneOtpEventRecordInput['userAgent']): string | null {
  if (Array.isArray(userAgent)) return userAgent.join(', ');
  return typeof userAgent === 'string' && userAgent.trim() ? userAgent : null;
}

function buildPhoneOtpEventParams(input: PhoneOtpEventRecordInput): unknown[] {
  return [
    input.userId ?? null,
    input.verificationCodeId ?? null,
    hashPhone(input.phone),
    phoneLast4(input.phone),
    input.purpose ?? 'phone_login',
    input.eventType,
    input.provider ?? null,
    input.providerRequestId ?? null,
    input.callSessionHistoryId ?? null,
    input.callerId ?? null,
    input.fingerprintVisitorId ?? null,
    input.ip ?? null,
    normalizeUserAgent(input.userAgent),
    JSON.stringify(input.details ?? {}),
  ];
}

export async function recordPhoneOtpEvent(input: PhoneOtpEventRecordInput): Promise<PhoneOtpEventCreatedRow | null> {
  const rows = await db.query<PhoneOtpEventCreatedRow>(
    INSERT_PHONE_OTP_EVENT_SQL,
    buildPhoneOtpEventParams(input),
  );
  return rows[0] ?? null;
}

export async function recordPhoneOtpEventSafely(input: PhoneOtpEventRecordInput): Promise<void> {
  try {
    await recordPhoneOtpEvent(input);
  } catch (error: unknown) {
    log.warn('Failed to record phone OTP event', {
      eventType: input.eventType,
      phoneLast4: phoneLast4(input.phone),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function recordAbandonedPhoneOtpEvents(limit = 500): Promise<number> {
  const rows = await db.query<ExpiredPhoneOtpCodeRow>(
    `SELECT id, user_id, phone, method, purpose, attempts, expires_at
       FROM verification_codes
      WHERE purpose = 'phone_login'
        AND used_at IS NULL
        AND expires_at < NOW()
      ORDER BY expires_at ASC
      LIMIT $1`,
    [limit],
  );

  for (const row of rows) {
    await recordPhoneOtpEventSafely({
      userId: row.user_id,
      verificationCodeId: row.id,
      phone: row.phone,
      purpose: row.purpose,
      eventType: 'code_abandoned',
      provider: row.method,
      details: {
        method: row.method,
        attempts: row.attempts,
        expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at,
      },
    });
  }

  return rows.length;
}
