/**
 * Voximplant Webhook Authentication Middleware
 *
 * Единая аутентификация всех VoxEngine webhook-эндпоинтов телефонии
 * (/incoming-call, /call-event, /voice-otp/event, /service-survey/result).
 *
 * Поддерживает два формата подписи:
 *   1. HMAC-SHA256 по сырому телу запроса — заголовок
 *      `x-svf-voximplant-signature: sha256=<hex>` (рекомендуемый).
 *      Опц. `x-svf-voximplant-timestamp` (ISO или unix-секунды) для anti-replay.
 *   2. Legacy plain-секрет — заголовок `x-svf-voximplant-secret`
 *      (или `x-voximplant-secret`) для обратной совместимости.
 *
 * Режимы (config.voximplant.webhook.authMode):
 *   - 'dual-accept' (по умолчанию): подписанные/legacy запросы проверяются,
 *     неподписанные ПРОПУСКАЮТСЯ (grace) — нулевая регрессия при раскатке.
 *   - 'enforce': требуется валидная подпись/секрет; при пустом секрете в
 *     production — fail-closed (503, ошибка конфигурации).
 *
 * Сравнение секрета/подписи — constant-time (timingSafeEqual).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { config } from '../config/index.js';
import { AppError } from './errorHandler.js';
import { createLogger } from '../utils/logger.js';
import { voximplantWebhookAuthTotal } from '../services/metrics.service.js';

const log = createLogger('voximplant-webhook-auth');

const SIGNATURE_HEADER = 'x-svf-voximplant-signature';
const TIMESTAMP_HEADER = 'x-svf-voximplant-timestamp';
const LEGACY_SECRET_HEADERS = ['x-svf-voximplant-secret', 'x-voximplant-secret'] as const;

type AuthOutcome =
  | 'signed_ok'
  | 'legacy_ok'
  | 'grace_unsigned'
  | 'rejected_bad_sig'
  | 'rejected_replay'
  | 'rejected_missing'
  | 'rejected_misconfig';

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function expectedSignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Принимает "sha256=<hex>" или голый "<hex>"; возвращает нормализованный hex или null. */
function parseSignatureHeader(value: string): string | null {
  const trimmed = value.trim();
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex > 0 && trimmed.slice(0, eqIndex).toLowerCase() === 'sha256') {
    const hex = trimmed.slice(eqIndex + 1).trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(hex) ? hex : null;
  }
  const bare = trimmed.toLowerCase();
  return /^[a-f0-9]{64}$/.test(bare) ? bare : null;
}

/** true, если timestamp отсутствует (опционален) или в пределах допустимого skew. */
function isTimestampFresh(rawTimestamp: string | undefined, maxSkewSec: number): boolean {
  if (!rawTimestamp) return true;
  const trimmed = rawTimestamp.trim();
  let epochMs = Date.parse(trimmed);
  if (Number.isNaN(epochMs)) {
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return false;
    // 10 цифр → секунды, иначе миллисекунды
    epochMs = trimmed.replace(/\D/g, '').length <= 10 ? numeric * 1000 : numeric;
  }
  return Math.abs(Date.now() - epochMs) <= maxSkewSec * 1000;
}

export function verifyVoximplantWebhook(endpoint: string): RequestHandler {
  return function voximplantWebhookGuard(req: Request, _res: Response, next: NextFunction): void {
    const { secret, authMode, maxSkewSec } = config.voximplant.webhook;
    const enforce = authMode === 'enforce';
    const isProd = process.env['NODE_ENV'] === 'production';

    const record = (outcome: AuthOutcome): void => {
      voximplantWebhookAuthTotal.inc({ endpoint, outcome });
    };

    // Секрет не настроен.
    if (!secret) {
      if (enforce && isProd) {
        record('rejected_misconfig');
        log.error('Voximplant webhook secret missing while enforce mode active', { endpoint });
        throw new AppError(503, 'Voximplant webhook authentication is misconfigured');
      }
      record('grace_unsigned');
      return next();
    }

    const signatureHeader = req.get(SIGNATURE_HEADER);
    if (signatureHeader) {
      const rawBody = req.rawBody;
      if (!rawBody) {
        if (enforce) {
          record('rejected_bad_sig');
          throw new AppError(401, 'Voximplant webhook signature cannot be verified (no raw body)');
        }
        record('grace_unsigned');
        return next();
      }
      const provided = parseSignatureHeader(signatureHeader);
      const expected = expectedSignature(secret, rawBody);
      if (provided && timingSafeEqualString(provided, expected)) {
        if (!isTimestampFresh(req.get(TIMESTAMP_HEADER), maxSkewSec)) {
          record('rejected_replay');
          throw new AppError(401, 'Voximplant webhook timestamp outside allowed skew');
        }
        record('signed_ok');
        return next();
      }
      record('rejected_bad_sig');
      throw new AppError(401, 'Invalid Voximplant webhook signature');
    }

    // Legacy plain-секрет.
    const legacySecret = LEGACY_SECRET_HEADERS
      .map((header) => req.get(header))
      .find((value): value is string => Boolean(value));
    if (legacySecret) {
      if (timingSafeEqualString(legacySecret, secret)) {
        record('legacy_ok');
        return next();
      }
      record('rejected_bad_sig');
      throw new AppError(401, 'Invalid Voximplant webhook secret');
    }

    // Ни подписи, ни legacy-секрета.
    if (enforce) {
      record('rejected_missing');
      throw new AppError(401, 'Missing Voximplant webhook signature');
    }
    record('grace_unsigned');
    return next();
  };
}
