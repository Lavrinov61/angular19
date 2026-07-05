import { config } from '../config/index.js';
import { isVoximplantSmsConfigured, sendVoximplantSms } from './voximplant.service.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('sms.service');
// ─── Types ──────────────────────────────────────────────────────────────

export interface SmsResult {
  success: boolean;
  smsId?: string;
  cost?: number;
  provider?: 'voximplant';
  error?: string;
}

export interface SmsStatus {
  smsId: string;
  status: 'delivered' | 'sent' | 'failed' | 'not_found' | string;
  cost?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Нормализует телефон: убирает всё кроме цифр, добавляет +7 если нет
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return `7${digits.slice(1)}`;
  }
  return digits;
}

// ─── API calls ──────────────────────────────────────────────────────────

/**
 * Отправить SMS через Voximplant.
 */
export async function sendSms(phone: string, message: string): Promise<SmsResult> {
  if (!config.sms.enabled) {
    const masked = `***${phone.replace(/\D/g, '').slice(-4)}`;
    logger.info(`[SMS] Disabled — would send to ${masked}`);
    return { success: true, smsId: 'disabled' };
  }

  if (config.sms.testMode) {
    const masked = `***${phone.replace(/\D/g, '').slice(-4)}`;
    logger.info(`[SMS] Test mode — to ${masked}`);
    return { success: true, smsId: 'test' };
  }

  if (isVoximplantSmsConfigured()) {
    const result = await sendVoximplantSms(phone, message);
    if (result.success) {
      return {
        success: true,
        provider: 'voximplant',
        smsId: result.smsId ? `voximplant:${result.smsId}` : 'voximplant',
        cost: result.cost,
      };
    }
    logger.warn('[SMS] Voximplant failed', { error: result.error });
    return { success: false, provider: 'voximplant', error: result.error || 'Voximplant SMS failed' };
  }

  return { success: false, error: 'No SMS provider configured' };
}

/**
 * Проверить статус SMS.
 * Voximplant delivery callbacks/status polling are handled outside this legacy API.
 */
export async function getSmsStatus(smsId: string): Promise<SmsStatus> {
  if (!config.sms.enabled || smsId === 'disabled' || smsId === 'test') {
    return { smsId, status: 'delivered' };
  }
  if (smsId.startsWith('voximplant:') || smsId === 'voximplant') {
    return { smsId, status: 'sent' };
  }
  return { smsId, status: 'not_found' };
}

/**
 * Баланс SMS больше не запрашивается из legacy-провайдера.
 */
export async function getSmsBalance(): Promise<number> {
  return 0;
}
