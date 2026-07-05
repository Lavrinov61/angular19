import { config } from '../config/index.js';
import { calculateOrderWeight } from './weight-calculator.service.js';
import { withServiceCall, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';

import { createLogger } from '../utils/logger.js';
// ========== DaData Address Validation ==========

const logger = createLogger('delivery.service');
export interface DadataAddressResult {
  /** Стандартизированный полный адрес */
  result: string;
  /** Город */
  city: string | null;
  /** Регион */
  region: string | null;
  /** Почтовый индекс */
  postalCode: string | null;
  /** Широта */
  geoLat: string | null;
  /** Долгота */
  geoLon: string | null;
  /** Качество: 0=точный, 1=приблизительный, ≥2=плохой */
  qc: number;
  /** Улица с типом (для Otpravka API): "ул Стачки" */
  streetWithType: string | null;
  /** Номер дома: "26" */
  house: string | null;
  /** Квартира/офис: "12" */
  flat: string | null;
}

/**
 * Валидация и стандартизация адреса через DaData Cleaner API.
 * Использует native fetch (axios несовместим с DaData — 400 из-за заголовков).
 * Возвращает null если API недоступен или ключи не настроены.
 */
export async function validateAddress(rawAddress: string): Promise<DadataAddressResult | null> {
  const { apiKey, secretKey, cleanerUrl } = config.dadata;
  if (!apiKey || !secretKey) {
    logger.warn('[DaData] API keys not configured, skipping address validation');
    return null;
  }

  try {
    return await withServiceCall(SERVICE_BREAKERS.dadata, async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(cleanerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${apiKey}`,
          'X-Secret': secretKey,
        },
        body: JSON.stringify([rawAddress]),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        logger.error(`[DaData] HTTP ${response.status}: ${response.statusText}`);
        throw new Error(`DaData HTTP ${response.status}`);
      }

      const data = await response.json() as Record<string, unknown>[];
      if (!Array.isArray(data) || data.length === 0) return null;

      const item = data[0] as Record<string, unknown>;
      return {
        result: (item['result'] as string) || rawAddress,
        city: (item['city'] as string) || null,
        region: (item['region'] as string) || null,
        postalCode: (item['postal_code'] as string) || null,
        geoLat: (item['geo_lat'] as string) || null,
        geoLon: (item['geo_lon'] as string) || null,
        qc: typeof item['qc'] === 'number' ? item['qc'] : parseInt(String(item['qc'] || '3'), 10),
        streetWithType: (item['street_with_type'] as string) || null,
        house: (item['house'] as string) || null,
        flat: (item['flat'] as string) || null,
      };
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[DaData] Address validation failed:', { detail: msg });
    return null;
  }
}

// ========== Почта России Tariff API ==========

export interface DeliveryCostResult {
  /** Стоимость без НДС (руб.) */
  cost: number;
  /** Стоимость с НДС (руб.) */
  costWithNds: number;
  /** Мин. срок доставки (дней) */
  daysMin: number;
  /** Макс. срок доставки (дней) */
  daysMax: number;
}

/**
 * Рассчитать стоимость доставки через Почту России (tariff.pochta.ru).
 * Публичный API без аутентификации.
 * Возвращает null если API недоступен.
 */
export async function calculateDeliveryCost(
  postalCodeTo: string,
  weightGrams?: number,
  items?: Array<{ format: string; quantity: number }>,
): Promise<DeliveryCostResult | null> {
  const { senderPostalCode, defaultWeight, tariffUrl, objectType } = config.delivery;
  // Приоритет: явный вес > расчётный из items > дефолтный
  const weight = weightGrams || (items && items.length > 0 ? calculateOrderWeight(items) : defaultWeight);

  try {
    return await withServiceCall(SERVICE_BREAKERS.pochta, async () => {
      const tariffParams = new URLSearchParams({
        object: String(objectType),
        from: senderPostalCode,
        to: postalCodeTo,
        weight: String(weight),
        json: 'json',
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const [tariffRes, deliveryRes] = await Promise.all([
        fetch(`${tariffUrl}?${tariffParams}`, { signal: controller.signal }).then(r => r.json()),
        fetch(`${tariffUrl.replace('/tariff', '/tariff/delivery')}?${tariffParams}`, { signal: controller.signal })
          .then(r => r.json())
          .catch(() => null),
      ]);

      clearTimeout(timeoutId);

      const data = tariffRes as Record<string, unknown>;

      if (!data['pay'] && Array.isArray(data['errors']) && (data['errors'] as Array<{ msg: string }>).length > 0) {
        logger.warn('[Pochta] Tariff error', { detail: (data['errors'] as Array<{ msg: string }>).map(e => e.msg).join('; ') });
        throw new Error('Pochta tariff error');
      }

      // Цена приходит в копейках → делим на 100
      const payKop = parseFloat(String(data['pay'])) || 0;
      const payndsKop = parseFloat(String(data['paynds'])) || payKop;

      // Сроки доставки из delivery endpoint
      let daysMin = 5;
      let daysMax = 14;
      const deliveryData = (deliveryRes as Record<string, unknown> | null)?.['delivery'] as Record<string, unknown> | undefined;
      if (deliveryData?.['min']) daysMin = parseInt(String(deliveryData['min']), 10) || 5;
      if (deliveryData?.['max']) daysMax = parseInt(String(deliveryData['max']), 10) || 14;

      return {
        cost: Math.ceil(payKop / 100),
        costWithNds: Math.ceil(payndsKop / 100),
        daysMin,
        daysMax,
      };
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('[Pochta] Tariff calculation failed:', { detail: msg });
    return null;
  }
}
