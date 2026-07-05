/**
 * FNS Self-Employment Verification Service
 * Проверка статуса самозанятого через API ФНС (statusnpd.nalog.ru)
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('fns-verification');

const FNS_API_URL = 'https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status';
const FNS_TIMEOUT_MS = 10_000;

export type SelfEmployedStatus = 'not_checked' | 'pending' | 'verified' | 'rejected';

export interface FnsCheckResult {
  is_self_employed: boolean;
  checked_at: string;
  raw_message: string;
  source: 'fns_api' | 'admin_manual';
}

// ── INN Validation ──────────────────────────────────────────

const INN12_WEIGHTS_1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const INN12_WEIGHTS_2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

/**
 * Validate INN format and checksum (12 digits for individual)
 */
export function validateInn(inn: string): boolean {
  if (!/^\d{12}$/.test(inn)) return false;

  const digits = inn.split('').map(Number);

  // Check digit 11 (index 10)
  const sum1 = INN12_WEIGHTS_1.reduce((acc, w, i) => acc + w * digits[i], 0);
  const check1 = (sum1 % 11) % 10;
  if (check1 !== digits[10]) return false;

  // Check digit 12 (index 11)
  const sum2 = INN12_WEIGHTS_2.reduce((acc, w, i) => acc + w * digits[i], 0);
  const check2 = (sum2 % 11) % 10;
  if (check2 !== digits[11]) return false;

  return true;
}

// ── FNS API Check ───────────────────────────────────────────

/**
 * Check self-employed status via FNS public API
 * POST https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status
 */
export async function checkSelfEmployedStatus(inn: string): Promise<FnsCheckResult> {
  if (!validateInn(inn)) {
    return {
      is_self_employed: false,
      checked_at: new Date().toISOString(),
      raw_message: 'Некорректный ИНН (не проходит проверку контрольной суммы)',
      source: 'fns_api',
    };
  }

  const requestDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FNS_TIMEOUT_MS);

  try {
    const response = await fetch(FNS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inn, requestDate }),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error('[FNS] API returned non-OK status', { status: response.status, inn: inn.slice(0, 4) + '****' });
      throw new Error(`FNS API HTTP ${response.status}`);
    }

    const data = await response.json() as { status: boolean; message?: string };

    return {
      is_self_employed: data.status === true,
      checked_at: new Date().toISOString(),
      raw_message: data.message || (data.status ? 'Является самозанятым' : 'Не является самозанятым'),
      source: 'fns_api',
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.error('[FNS] API timeout', { inn: inn.slice(0, 4) + '****' });
      throw new Error('ФНС API недоступен (таймаут)');
    }
    logger.error('[FNS] API error', { error: String(err), inn: inn.slice(0, 4) + '****' });
    throw new Error('ФНС API недоступен');
  } finally {
    clearTimeout(timeout);
  }
}
