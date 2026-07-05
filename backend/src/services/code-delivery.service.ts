import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import {
  getSdkPhoneNumbers,
  isVoximplantSdkConfigured,
} from './voximplant-management-sdk.service.js';

const logger = createLogger('code-delivery.service');

/**
 * code-delivery.service.ts
 * Абстракция для доставки OTP-кодов через различные каналы.
 * Перебирает провайдеров в порядке приоритета, возвращает первый успешный.
 *
 * Приоритет:
 *   1. Voice call through Voximplant: robot dictates the generated OTP code.
 * No fallback channel is used for phone login OTP.
 */

import {
  isVoximplantVoiceCallConfigured,
  startVoximplantVoiceCall,
} from './voximplant.service.js';

const VOICE_CALL_PROVIDER_PROBE_TTL_MS = 30_000;
const VOICE_CALL_PROVIDER_PROBE_FAILURE_TTL_MS = 10_000;

interface VoiceCallProviderProbeCacheEntry {
  error?: string;
  expiresAt: number;
  status: 'failed' | 'ok' | 'skipped';
}

let voiceCallProviderProbeCache: VoiceCallProviderProbeCacheEntry | null = null;
let voiceCallProviderProbePromise: Promise<'ok' | 'skipped'> | null = null;

// ─── Provider Interface ──────────────────────────────────────────────────────

export interface CodeDeliveryResult {
  success: boolean;
  provider: string;
  requestId?: string;
  callSessionHistoryId?: string;
  verificationCode?: string;
}

interface CodeDeliveryProvider {
  readonly name: string;
  canDeliver(phone: string): Promise<boolean>;
  sendCode(phone: string, code: string, ttlSeconds: number): Promise<CodeDeliveryResult>;
}

function normalizePhoneDigits(value: string | undefined): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function findMatchingAttachedNumbers(
  attachedNumbers: { phoneNumber?: string; canBeUsed?: boolean }[],
  callerId: string,
): { phoneNumber?: string; canBeUsed?: boolean }[] {
  const normalizedCallerId = normalizePhoneDigits(callerId);
  return attachedNumbers.filter((number) => normalizePhoneDigits(number.phoneNumber) === normalizedCallerId);
}

function cacheVoiceCallProviderProbeSuccess(status: 'ok' | 'skipped'): void {
  voiceCallProviderProbeCache = {
    status,
    expiresAt: Date.now() + VOICE_CALL_PROVIDER_PROBE_TTL_MS,
  };
}

function cacheVoiceCallProviderProbeFailure(error: unknown): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  voiceCallProviderProbeCache = {
    status: 'failed',
    error: normalized.message,
    expiresAt: Date.now() + VOICE_CALL_PROVIDER_PROBE_FAILURE_TTL_MS,
  };
  return normalized;
}

async function runVoiceCallProviderPreflightUncached(): Promise<'ok' | 'skipped'> {
  if (!config.voximplant.voiceCall.enabled) {
    return 'skipped';
  }

  if (!isVoximplantVoiceCallConfigured()) {
    throw new Error('Voximplant voice OTP is not fully configured');
  }

  if (!isVoximplantSdkConfigured()) {
    return 'skipped';
  }

  const callerId = config.voximplant.voiceCall.callerIds[0];
  if (!callerId) {
    throw new Error('No Voximplant caller ID configured');
  }

  const exactResponse = await getSdkPhoneNumbers({ phoneNumber: callerId, count: 1 });
  const exactMatches = findMatchingAttachedNumbers(
    Array.isArray(exactResponse.result) ? exactResponse.result : [],
    callerId,
  );

  let attachedNumbers = exactMatches;
  if (attachedNumbers.length === 0) {
    const fallbackResponse = await getSdkPhoneNumbers({ count: 100 });
    attachedNumbers = findMatchingAttachedNumbers(
      Array.isArray(fallbackResponse.result) ? fallbackResponse.result : [],
      callerId,
    );
  }

  if (attachedNumbers.length === 0) {
    throw new Error('Configured caller ID is not attached in Voximplant');
  }

  if (attachedNumbers.every((number) => number.canBeUsed === false)) {
    throw new Error('Configured caller ID is attached but unavailable in Voximplant');
  }

  return 'ok';
}

export async function getCachedVoiceCallProviderPreflight(): Promise<'ok' | 'skipped'> {
  const now = Date.now();
  if (voiceCallProviderProbeCache && now < voiceCallProviderProbeCache.expiresAt) {
    if (voiceCallProviderProbeCache.status === 'failed') {
      throw new Error(voiceCallProviderProbeCache.error || 'Voice call provider probe failed');
    }
    return voiceCallProviderProbeCache.status;
  }

  if (voiceCallProviderProbePromise) {
    return voiceCallProviderProbePromise;
  }

  voiceCallProviderProbePromise = runVoiceCallProviderPreflightUncached()
    .then((status) => {
      cacheVoiceCallProviderProbeSuccess(status);
      return status;
    })
    .catch((error: unknown) => {
      const normalized = cacheVoiceCallProviderProbeFailure(error);
      logger.warn('Voice call provider preflight failed', { error: normalized.message });
      throw normalized;
    })
    .finally(() => {
      voiceCallProviderProbePromise = null;
    });

  return voiceCallProviderProbePromise;
}

export async function isVoiceCallProviderAvailable(): Promise<boolean> {
  if (!isVoximplantVoiceCallConfigured()) {
    return false;
  }

  try {
    await getCachedVoiceCallProviderPreflight();
    return true;
  } catch {
    return false;
  }
}

export function resetVoiceCallProviderProbeCacheForTests(): void {
  voiceCallProviderProbeCache = null;
  voiceCallProviderProbePromise = null;
}

// ─── Provider: Voice call ───────────────────────────────────────────────────

const VoiceCallProvider: CodeDeliveryProvider = {
  name: 'voice_call',

  async canDeliver(_phone: string): Promise<boolean> {
    return isVoiceCallProviderAvailable();
  },

  async sendCode(phone: string, code: string, _ttlSeconds: number): Promise<CodeDeliveryResult> {
    const result = await startVoximplantVoiceCall(phone, code);
    return {
      success: result.success,
      provider: 'voice_call',
      requestId: result.requestId,
      callSessionHistoryId: result.callSessionHistoryId,
      verificationCode: result.verificationCode,
    };
  },
};

// ─── Ordered Provider Chain ──────────────────────────────────────────────────

const PROVIDERS: CodeDeliveryProvider[] = [
  VoiceCallProvider,
];

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Отправить OTP-код на номер телефона через первый доступный канал.
 * ttlSeconds — время жизни кода в секундах.
 */
export async function sendVerificationCode(
  phone: string,
  code: string,
  ttlSeconds = 300,
): Promise<CodeDeliveryResult> {
  const phoneMasked = phone.length > 4
    ? `${'*'.repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`
    : phone;

  for (const provider of PROVIDERS) {
    logger.info('Code delivery attempt started', { provider: provider.name, phoneMasked });
    try {
      const result = await provider.sendCode(phone, code, ttlSeconds);
      if (result.success) {
        logger.info('Code delivery attempt succeeded', {
          provider: provider.name,
          phoneMasked,
          providerRequestId: result.requestId,
          callSessionHistoryId: result.callSessionHistoryId,
        });
        return result;
      }
      logger.warn('Code delivery attempt failed', { provider: provider.name, phoneMasked });
    } catch (err) {
      logger.error('Code delivery provider threw', {
        provider: provider.name,
        phoneMasked,
        error: String(err),
      });
    }
  }

  logger.error('All code delivery providers failed', { phoneMasked });
  return { success: false, provider: 'none' };
}

/**
 * Проверить, через какой канал можно доставить код.
 * Используется для UX — показать пользователю доступный способ подтверждения.
 */
export async function checkDeliveryChannel(phone: string): Promise<{
  available: boolean;
  provider: string;
}> {
  for (const provider of PROVIDERS) {
    try {
      const can = await provider.canDeliver(phone);
      if (can) return { available: true, provider: provider.name };
    } catch (err) {
      logger.warn(`[CodeDelivery] ${provider.name} availability check failed`, { error: String(err) });
    }
  }
  return { available: false, provider: 'none' };
}
