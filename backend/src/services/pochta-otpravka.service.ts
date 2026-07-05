/**
 * Почта России Otpravka API — создание отправлений и генерация этикеток.
 *
 * API docs: https://otpravka.pochta.ru/specification
 * Base URL: https://otpravka-api.pochta.ru
 *
 * Авторизация двумя заголовками:
 *   Authorization: AccessToken {token}
 *   X-User-Authorization: Basic {base64(login:password)}
 */

import { config } from '../config/index.js';
import { withServiceCall, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';

import { createLogger } from '../utils/logger.js';
const OTPRAVKA_BASE_URL = 'https://otpravka-api.pochta.ru';

const logger = createLogger('pochta-otpravka.service');
// ========== Auth ==========

interface OtpravkaAuth {
  accessToken: string;
  basicAuth: string;
}

function getAuth(): OtpravkaAuth | null {
  const { otpravkaToken, otpravkaLogin, otpravkaPassword } = config.delivery;
  if (!otpravkaToken) return null;

  // Basic auth не обязателен если есть только token (некоторые ЛК работают только по token)
  const basicAuth = otpravkaLogin && otpravkaPassword
    ? Buffer.from(`${otpravkaLogin}:${otpravkaPassword}`).toString('base64')
    : '';

  return { accessToken: otpravkaToken, basicAuth };
}

function buildHeaders(auth: OtpravkaAuth): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json;charset=UTF-8',
    'Authorization': `AccessToken ${auth.accessToken}`,
  };
  if (auth.basicAuth) {
    headers['X-User-Authorization'] = `Basic ${auth.basicAuth}`;
  }
  return headers;
}

// ========== Types ==========

/** Данные для создания отправления */
export interface ShipmentData {
  /** Тип адреса */
  'address-type-to': 'DEFAULT';
  /** Имя получателя */
  'given-name': string;
  /** Фамилия получателя */
  'surname': string;
  /** Почтовый индекс получателя */
  'index-to': number;
  /** Код страны (643 = Россия) */
  'mail-direct': 643;
  /** Категория отправления */
  'mail-category': 'ORDERED' | 'SIMPLE' | 'REGISTERED';
  /** Тип отправления */
  'mail-type': 'POSTAL_PARCEL' | 'LETTER' | 'BANDEROL';
  /** Вес в граммах */
  'mass': number;
  /** Номер заказа (наш внутренний) */
  'order-num': string;
  /** Город получателя */
  'place-to': string;
  /** Регион получателя */
  'region-to': string;
  /** Улица + дом */
  'street-to': string;
  /** Квартира/офис */
  'room-to'?: string;
  /** Телефон получателя (цифры) */
  'tel-address'?: number;
  /** Индекс отделения отправителя */
  'postoffice-code'?: string;
  /** Имя отправителя */
  'sender-name'?: string;
  /** Комментарий отправителя */
  'sender-comment'?: string;
}

/** Результат создания отправления */
export interface CreateShipmentResult {
  success: boolean;
  /** ID отправления в системе Otpravka */
  shipmentId?: string;
  /** Трек-номер (штрих-код) */
  trackingNumber?: string;
  /** Имя партии */
  batchName?: string;
  /** Ошибка (если success=false) */
  error?: string;
}

// ========== API Functions ==========

/**
 * Проверить, настроен ли Otpravka API.
 */
export function isOtpravkaConfigured(): boolean {
  return !!getAuth();
}

/**
 * Создать отправление в системе Почты России.
 * PUT /1.0/user/shipment — принимает массив, возвращает массив результатов.
 */
export async function createShipment(data: ShipmentData): Promise<CreateShipmentResult> {
  const auth = getAuth();
  if (!auth) {
    return { success: false, error: 'Pochta Otpravka API not configured' };
  }

  try {
    return await withServiceCall(SERVICE_BREAKERS.pochtaOtpravka, async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      const response = await fetch(`${OTPRAVKA_BASE_URL}/1.0/user/shipment`, {
        method: 'PUT',
        headers: buildHeaders(auth),
        body: JSON.stringify([data]),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'unknown');
        logger.error(`[Otpravka] Create shipment failed: HTTP ${response.status} — ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json() as Record<string, unknown>;

      // Otpravka PUT /user/shipment возвращает объект с result-ids, batch-name
      // result-ids: массив ID созданных отправлений
      const resultIds = result['result-ids'] as number[] | undefined;
      const batchName = result['batch-name'] as string | undefined;

      if (!resultIds || resultIds.length === 0) {
        // Может быть ошибка в errors
        const errors = result['errors'] as Array<{ 'error-codes'?: Array<{ code: string; description: string }> }> | undefined;
        if (errors && errors.length > 0) {
          const errMsg = errors.flatMap(e =>
            (e['error-codes'] || []).map(c => `${c.code}: ${c.description}`),
          ).join('; ');
          logger.error(`[Otpravka] Shipment validation errors: ${errMsg}`);
          // Validation errors should NOT trip the CB (it's working, just bad data)
          return { success: false, error: errMsg };
        }
        return { success: false, error: 'No result IDs returned' };
      }

      const shipmentId = String(resultIds[0]);

      // Получить трек-номер через отдельный запрос
      const trackingNumber = await getTrackingNumber(auth, shipmentId);

      logger.info(`[Otpravka] Shipment created: id=${shipmentId}, tracking=${trackingNumber || 'pending'}, batch=${batchName}`);

      return {
        success: true,
        shipmentId,
        trackingNumber: trackingNumber || undefined,
        batchName: batchName || undefined,
      };
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Otpravka] Create shipment error:', { detail: msg });
    return { success: false, error: msg };
  }
}

/**
 * Получить трек-номер отправления.
 * GET /1.0/shipment/{id}
 */
async function getTrackingNumber(auth: OtpravkaAuth, shipmentId: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(`${OTPRAVKA_BASE_URL}/1.0/shipment/${shipmentId}`, {
      headers: buildHeaders(auth),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) return null;

    const data = await response.json() as Record<string, unknown>;
    return (data['barcode'] as string) || null;
  } catch {
    return null;
  }
}

/**
 * Сгенерировать этикетку (форма F7) в формате PDF.
 * GET /1.0/forms/{id}/f7pdf
 *
 * @returns PDF как Buffer или null при ошибке
 */
export async function generateShippingLabel(shipmentId: string): Promise<Buffer | null> {
  const auth = getAuth();
  if (!auth) return null;

  try {
    return await withServiceCall(SERVICE_BREAKERS.pochtaOtpravka, async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);

      const headers = buildHeaders(auth);
      // Для PDF не нужен Content-Type json
      delete headers['Content-Type'];
      headers['Accept'] = 'application/pdf';

      const response = await fetch(
        `${OTPRAVKA_BASE_URL}/1.0/forms/${shipmentId}/f7pdf`,
        { headers, signal: controller.signal },
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error(`[Otpravka] Label generation failed: HTTP ${response.status}`);
        throw new Error(`Otpravka label HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      logger.info(`[Otpravka] Label generated for shipment ${shipmentId} (${arrayBuffer.byteLength} bytes)`);
      return Buffer.from(arrayBuffer);
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Otpravka] Label generation error:', { detail: msg });
    return null;
  }
}
