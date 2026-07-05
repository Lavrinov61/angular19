import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { ErrorCode } from '../constants/error-codes.js';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { getRequestId } from '../middleware/request-context.js';
import {
  getStudios,
  getAvailableSlots,
  createBooking,
} from '../services/booking-autonomous.service.js';
import type { StudioAlertRow } from '../types/views/booking-views.js';
import { validatePartnerPromoCode, recordReferral } from '../services/partners.service.js';
import { normalizePhone } from '../services/sms.service.js';
import { requestVoiceOtpDispatch } from '../services/voice-otp-dispatcher.service.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';
import { idempotent } from '../middleware/idempotency.js';

import { createLogger } from '../utils/logger.js';
const router = Router();

const logger = createLogger('public-booking.routes');
const BOOKING_CONFIRM_PURPOSE = 'booking_confirm';
const BOOKING_PHONE_CODE_WINDOW_MS = 10 * 60 * 1000;
const BOOKING_PHONE_CODE_PHONE_MAX = 3;
const BOOKING_PHONE_CODE_LENGTH = 4;

interface VerificationCountRow {
  count: string;
}

interface BookingVerificationCodeRow {
  id: string;
  code: string;
  attempts: number;
  method: string;
}

interface StudioLookupRow {
  id: string;
  name?: string;
}

interface ExistingUserRow {
  id: string;
}

interface BookingRequestBody {
  studio?: string;
  date?: string;
  time?: string;
  clientName?: string;
  clientPhone?: string;
  serviceName?: string;
  serviceCategorySlug?: string;
  partnerPromoCode?: string;
  phoneCode?: string;
}

const PUBLIC_BOOKING_LOCATION_CODES: readonly string[] = ['soborny'];
const PUBLIC_BOOKING_LOCATION_CODE_SET = new Set<string>(PUBLIC_BOOKING_LOCATION_CODES);

// Строгий лимит для публичного бронирования
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Слишком много запросов бронирования. Подождите 15 минут.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('booking:'),
});

const bookingPhoneCodeLimiter = rateLimit({
  windowMs: BOOKING_PHONE_CODE_WINDOW_MS,
  max: 10,
  message: 'Слишком много запросов кода. Подождите 10 минут.',
  standardHeaders: true,
  legacyHeaders: false,
  passOnStoreError: true,
  store: createRateLimitStore('booking-phone-code:'),
});

function getStringField(body: unknown, field: string): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const value = Reflect.get(body, field);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isPublicBookingLocationCode(locationCode: string | null | undefined): locationCode is string {
  return !!locationCode && PUBLIC_BOOKING_LOCATION_CODE_SET.has(locationCode);
}

function getBookingRequestBody(body: unknown): BookingRequestBody {
  return {
    studio: getStringField(body, 'studio'),
    date: getStringField(body, 'date'),
    time: getStringField(body, 'time'),
    clientName: getStringField(body, 'clientName'),
    clientPhone: getStringField(body, 'clientPhone'),
    serviceName: getStringField(body, 'serviceName'),
    serviceCategorySlug: getStringField(body, 'serviceCategorySlug'),
    partnerPromoCode: getStringField(body, 'partnerPromoCode'),
    phoneCode: getStringField(body, 'phoneCode'),
  };
}

function maskPhoneForLogs(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function normalizeBookingPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (normalized.length < 11) {
    throw new AppError(400, 'Некорректный номер телефона', ErrorCode.PHONE_INVALID);
  }
  return normalized;
}

function normalizeBookingCode(code: string | undefined): string {
  const normalized = (code || '').replace(/\D/g, '');
  if (!new RegExp(`^\\d{${BOOKING_PHONE_CODE_LENGTH}}$`).test(normalized)) {
    throw new AppError(400, 'Подтвердите телефон кодом из звонка', ErrorCode.PHONE_CODE_INVALID);
  }
  return normalized;
}

function ensureBookingPhoneVerificationAvailable(): void {
  if (!config.voximplant.voiceCall.enabled) {
    throw new AppError(503, 'Подтверждение телефоном временно недоступно', ErrorCode.PHONE_SEND_FAILED);
  }
}

async function requestBookingPhoneCode(phone: string): Promise<{ expiresIn: number; provider: string }> {
  ensureBookingPhoneVerificationAvailable();

  const normalized = normalizeBookingPhone(phone);
  const phoneMasked = maskPhoneForLogs(normalized);

  const recentResult = await db.queryOne<VerificationCountRow>(
    `SELECT COUNT(*) as count FROM verification_codes
     WHERE phone = $1 AND purpose = $2 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [normalized, BOOKING_CONFIRM_PURPOSE],
  );
  if (parseInt(recentResult?.count || '0', 10) >= BOOKING_PHONE_CODE_PHONE_MAX) {
    logger.warn('Booking phone OTP phone-level limit hit', {
      requestId: getRequestId(),
      phoneMasked,
    });
    throw new AppError(429, 'Превышен лимит звонков с кодом. Подождите 10 минут', ErrorCode.PHONE_SEND_LIMIT);
  }

  const ttlSeconds = Math.max(30, config.voximplant.voiceCall.ttlSeconds || 120);
  const code = crypto.randomInt(1000, 9999).toString();

  const dispatchResult = await requestVoiceOtpDispatch(normalized, code);
  if (!dispatchResult.success) {
    logger.warn('Booking phone OTP delivery failed', {
      requestId: getRequestId(),
      phoneMasked,
      reason: dispatchResult.reason,
      dispatchError: dispatchResult.error,
    });
    if (dispatchResult.reason === 'busy') {
      throw new AppError(
        503,
        'Голосовой сервис сейчас перегружен. Попробуйте через несколько секунд.',
        ErrorCode.PHONE_SEND_BUSY,
      );
    }
    throw new AppError(503, 'Не удалось запустить звонок с кодом. Попробуйте позже.', ErrorCode.PHONE_SEND_FAILED);
  }

  const delivery = dispatchResult.data;
  const verificationCode = delivery.verificationCode || code;
  const acceptedAt = new Date(delivery.acceptedAt);
  const expiresAt = new Date(acceptedAt.getTime() + ttlSeconds * 1000);

  await db.query(
    `UPDATE verification_codes
        SET used_at = NOW()
      WHERE phone = $1 AND purpose = $2 AND used_at IS NULL`,
    [normalized, BOOKING_CONFIRM_PURPOSE],
  );

  await db.query(
    `INSERT INTO verification_codes (user_id, phone, code, method, purpose, expires_at)
     VALUES (NULL, $1, $2, $3, $4, $5)`,
    [normalized, verificationCode, delivery.provider, BOOKING_CONFIRM_PURPOSE, expiresAt],
  );

  logger.info('Booking phone OTP delivery started', {
    requestId: getRequestId(),
    phoneMasked,
    provider: delivery.provider,
    providerRequestId: delivery.requestId,
    callSessionHistoryId: delivery.callSessionHistoryId,
    callerId: delivery.callerId,
    acceptedAt: delivery.acceptedAt,
    expiresIn: ttlSeconds,
  });

  return { expiresIn: ttlSeconds, provider: delivery.provider };
}

async function consumeBookingPhoneCode(phone: string, code: string | undefined): Promise<void> {
  const normalizedCode = normalizeBookingCode(code);
  const phoneMasked = maskPhoneForLogs(phone);

  const record = await db.queryOne<BookingVerificationCodeRow>(
    `SELECT id, code, attempts, method FROM verification_codes
     WHERE phone = $1 AND purpose = $2
       AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, BOOKING_CONFIRM_PURPOSE],
  );

  if (!record) {
    logger.warn('Booking phone OTP rejected', {
      requestId: getRequestId(),
      phoneMasked,
      reason: 'expired_or_missing',
    });
    throw new AppError(400, 'Код недействителен или истёк. Запросите новый.', ErrorCode.PHONE_CODE_EXPIRED);
  }

  const maxAttempts = record.method === 'flash_call' ? 3 : 5;
  if (record.attempts >= maxAttempts) {
    logger.warn('Booking phone OTP rejected', {
      requestId: getRequestId(),
      phoneMasked,
      reason: 'max_attempts',
    });
    throw new AppError(400, 'Превышено количество попыток. Запросите новый код.', ErrorCode.PHONE_CODE_MAX_ATTEMPTS);
  }

  if (record.code !== normalizedCode) {
    await db.query('UPDATE verification_codes SET attempts = attempts + 1 WHERE id = $1', [record.id]);
    logger.warn('Booking phone OTP rejected', {
      requestId: getRequestId(),
      phoneMasked,
      reason: 'invalid_code',
    });
    throw new AppError(400, 'Неверный код', ErrorCode.PHONE_CODE_INVALID);
  }

  await db.query('UPDATE verification_codes SET used_at = NOW() WHERE id = $1', [record.id]);
}

// GET /api/booking/studios
router.get('/studios', async (_req, res) => {
  const studios = (await getStudios()).filter(studio => isPublicBookingLocationCode(studio.location_code));
  res.json({ success: true, data: studios });
});

// Studio alerts (closures, maintenance)
router.get('/alerts', async (req, res) => {
  const studio = getStringField(req.query, 'studio');
  const conditions = [
    'sse.exception_date >= CURRENT_DATE',
    'sse.exception_date <= CURRENT_DATE + 14',
    `s.location_code = ANY($1::text[])`,
  ];
  const params: unknown[] = [PUBLIC_BOOKING_LOCATION_CODES];
  if (studio) {
    params.push(studio);
    conditions.push(`s.location_code = $${params.length}`);
  }
  const alerts = await db.query<StudioAlertRow>(
    `SELECT sse.studio_id, s.location_code, s.name as studio_name,
            sse.exception_date::text, sse.is_closed,
            sse.open_time::text, sse.close_time::text, sse.reason
     FROM studio_schedule_exceptions sse
     JOIN studios s ON s.id = sse.studio_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY sse.exception_date`,
    params,
  );
  res.json({ success: true, data: alerts.filter(alert => isPublicBookingLocationCode(alert.location_code)) });
});

// GET /api/booking/slots?studio=soborny&date=2026-02-25&service_category=marketplace-photo
router.get('/slots', async (req, res) => {
  const studio = getStringField(req.query, 'studio');
  const date = getStringField(req.query, 'date');
  const serviceCategory = getStringField(req.query, 'service_category');

  if (!studio || !date) {
    throw new AppError(400, 'Параметры studio и date обязательны');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'Неверный формат даты (ожидается YYYY-MM-DD)');
  }

  const studioRecord = await db.queryOne<StudioLookupRow>(
    `SELECT id, name FROM studios WHERE location_code = $1`,
    [studio],
  );

  if (!studioRecord) {
    throw new AppError(404, 'Студия не найдена');
  }

  const result = await getAvailableSlots(studioRecord.id, date, serviceCategory);
  res.json({ success: true, data: result });
});

// POST /api/booking/phone-code
router.post('/phone-code', bookingPhoneCodeLimiter, async (req, res) => {
  const phone = getStringField(req.body, 'phone');
  if (!phone) {
    throw new AppError(400, 'Телефон обязателен');
  }

  const data = await requestBookingPhoneCode(phone);
  res.json({ success: true, data });
});

// POST /api/booking/book
router.post('/book', bookingLimiter, idempotent(60), async (req, res) => {
  const { studio, date, time, clientName, clientPhone, serviceName, serviceCategorySlug, partnerPromoCode, phoneCode } =
    getBookingRequestBody(req.body);

  if (!studio || !date || !time || !clientName || !clientPhone) {
    throw new AppError(400, 'Обязательные поля: studio, date, time, clientName, clientPhone');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'Неверный формат даты (ожидается YYYY-MM-DD)');
  }

  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new AppError(400, 'Неверный формат времени (ожидается HH:MM)');
  }

  // Валидация: дата не в прошлом
  const bookingDate = new Date(`${date}T${time}:00+03:00`);
  if (bookingDate.getTime() < Date.now()) {
    throw new AppError(400, 'Нельзя записаться на прошедшее время');
  }

  // Валидация: не больше 30 дней вперёд
  const maxDate = new Date();
  maxDate.setDate(maxDate.getDate() + 30);
  if (bookingDate > maxDate) {
    throw new AppError(400, 'Запись доступна не более чем на 30 дней вперёд');
  }

  const studioRecord = await db.queryOne<StudioLookupRow>(
    `SELECT id FROM studios WHERE location_code = $1`,
    [studio],
  );

  if (!studioRecord) {
    throw new AppError(404, 'Студия не найдена');
  }

  const normalizedClientPhone = normalizeBookingPhone(clientPhone);
  await consumeBookingPhoneCode(normalizedClientPhone, phoneCode);

  const partnerCode = (partnerPromoCode || '').trim() || undefined;

  const result = await createBooking({
    studioId: studioRecord.id,
    date,
    time,
    clientName,
    clientPhone,
    serviceName: serviceName || undefined,
    serviceCategorySlug: serviceCategorySlug || undefined,
    source: 'website',
    partnerPromoCode: partnerCode,
  });

  if (!result.success) {
    throw new AppError(409, result.error || 'Слот занят');
  }

  // Fire-and-forget: record confirmed referral for booking (free → confirmed immediately)
  if (partnerCode && result.bookingId) {
    const partner = await validatePartnerPromoCode(partnerCode);
    if (partner) {
      recordReferral({
        partner_id: partner.id,
        order_id: result.bookingId,
        order_type: 'booking',
        order_amount: 0,
        promo_code: partnerCode,
        client_phone: clientPhone,
        status: 'confirmed',
      }).catch(err => logger.error('[Booking] recordReferral failed', { error: String(err) }));
    }
  }

  // Предложить создать ЛК, если клиент ещё не зарегистрирован
  const existingUser = await db.queryOne<ExistingUserRow>(
    `SELECT id FROM users WHERE phone LIKE '%' || $1 AND is_active = true LIMIT 1`,
    [clientPhone.replace(/\D/g, '').slice(-10)],
  );

  res.status(201).json({
    success: true,
    bookingId: result.bookingId,
    suggestRegistration: !existingUser,
  });
});

export default router;
