/**
 * Telegram Gateway API — отправка подтверждений через Telegram вместо SMS.
 * Клиенту приходит сообщение в Telegram по номеру телефона.
 * Документация: https://core.telegram.org/gateway/api
 */

import { fetchWithTimeout } from '../utils/fetch-timeout.js';

import { createLogger } from '../utils/logger.js';
const GATEWAY_URL = 'https://gatewayapi.telegram.org';
const GATEWAY_TOKEN = process.env['TELEGRAM_GATEWAY_TOKEN'] || '';

const logger = createLogger('telegram-gateway.service');
interface GatewayResponse {
  ok: boolean;
  result?: RequestStatus;
  error?: string;
}

interface RequestStatus {
  request_id: string;
  phone_number: string;
  request_cost?: number;
  remaining_balance?: number;
  delivery_status?: {
    status: 'sent' | 'delivered' | 'read' | 'expired' | 'revoked';
    updated_at: number;
  };
  verification_status?: {
    status: 'code_valid' | 'code_invalid' | 'code_max_attempts_exceeded' | 'expired';
    updated_at: number;
  };
}

/**
 * Проверить возможность отправки сообщения на номер (есть ли Telegram)
 */
export async function checkSendAbility(phoneNumber: string): Promise<{
  canSend: boolean;
  requestId?: string;
}> {
  if (!GATEWAY_TOKEN) {
    logger.warn('[TgGateway] TELEGRAM_GATEWAY_TOKEN not set');
    return { canSend: false };
  }

  try {
    const res = await fetchWithTimeout(`${GATEWAY_URL}/checkSendAbility`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ phone_number: phoneNumber }),
    });

    const data = await res.json() as GatewayResponse;

    if (data.ok && data.result) {
      return { canSend: true, requestId: data.result.request_id };
    }

    logger.info(`[TgGateway] Cannot send to ${phoneNumber}: ${data.error || 'unknown'}`);
    return { canSend: false };
  } catch (err) {
    logger.error('[TgGateway] checkSendAbility error:', { error: String(err) });
    return { canSend: false };
  }
}

/**
 * Отправить код подтверждения записи через Telegram Gateway
 * @returns request_id для отслеживания доставки, или null при ошибке
 */
export async function sendBookingConfirmation(
  phoneNumber: string,
  confirmationCode: string,
  requestId?: string,
): Promise<string | null> {
  if (!GATEWAY_TOKEN) {
    logger.warn('[TgGateway] TELEGRAM_GATEWAY_TOKEN not set');
    return null;
  }

  try {
    const body: Record<string, unknown> = {
      phone_number: phoneNumber,
      code: confirmationCode,
      ttl: 3600, // 1 час
    };

    // Если есть request_id от checkSendAbility — вызов бесплатный
    if (requestId) {
      body['request_id'] = requestId;
    }

    const senderUsername = process.env['TELEGRAM_GATEWAY_SENDER'] || '';
    if (senderUsername) {
      body['sender_username'] = senderUsername;
    }

    const callbackUrl = process.env['TELEGRAM_GATEWAY_CALLBACK_URL'] || '';
    if (callbackUrl) {
      body['callback_url'] = callbackUrl;
    }

    const res = await fetchWithTimeout(`${GATEWAY_URL}/sendVerificationMessage`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as GatewayResponse;

    if (data.ok && data.result) {
      logger.info(`[TgGateway] Sent to ${phoneNumber}, request_id: ${data.result.request_id}, cost: ${data.result.request_cost ?? 'N/A'}`);
      return data.result.request_id;
    }

    logger.error(`[TgGateway] Failed to send to ${phoneNumber}: ${data.error}`);
    return null;
  } catch (err) {
    logger.error('[TgGateway] sendBookingConfirmation error:', { error: String(err) });
    return null;
  }
}

/**
 * Проверить статус доставки и валидность кода
 */
export async function checkVerificationStatus(
  requestId: string,
  code?: string,
): Promise<RequestStatus | null> {
  if (!GATEWAY_TOKEN) return null;

  try {
    const body: Record<string, string> = { request_id: requestId };
    if (code) body['code'] = code;

    const res = await fetchWithTimeout(`${GATEWAY_URL}/checkVerificationStatus`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as GatewayResponse;
    return data.ok ? (data.result ?? null) : null;
  } catch (err) {
    logger.error('[TgGateway] checkVerificationStatus error:', { error: String(err) });
    return null;
  }
}

/**
 * Генерация 6-значного кода подтверждения (криптографически безопасный)
 */
export { generateConfirmationCode } from '../utils/secure-random.js';
