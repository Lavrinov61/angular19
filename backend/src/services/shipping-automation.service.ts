/**
 * Оркестратор автоматической отправки заказов через Почту России.
 *
 * Пайплайн (после успешной оплаты):
 * 1. Загрузить заказ из photo_print_orders
 * 2. Проверить: есть delivery_address + delivery_postal_code
 * 3. Рассчитать вес через calculateOrderWeight
 * 4. Создать отправление через Otpravka API
 * 5. Сгенерировать PDF этикетку
 * 6. Сохранить этикетку в uploads/labels/
 * 7. Обновить заказ: tracking_number, shipment_id, shipment_status, label_url
 *
 * Graceful degradation: если Otpravka не настроена → skip.
 * Если ошибка → shipment_status = 'error'.
 */

import fs from 'fs';
import path from 'path';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { calculateOrderWeight } from './weight-calculator.service.js';
import { createLogger } from '../utils/logger.js';
import {
  isOtpravkaConfigured,
  createShipment,
  generateShippingLabel,
  type ShipmentData,
} from './pochta-otpravka.service.js';

const logger = createLogger('shipping-automation.service');
const LABELS_DIR = path.resolve(process.cwd(), 'uploads/labels');

/** Интерфейс строки из photo_print_orders */
interface PrintOrder {
  order_id: string;
  contact_name: string;
  contact_phone: string;
  delivery_address: string | null;
  delivery_postal_code: string | null;
  items: string | Array<Record<string, unknown>>;
  comments: string | null;
  shipment_status: string;
}

/**
 * Автоматически создать отправление для оплаченного заказа.
 * Вызывается из payments.routes.ts после успешной оплаты.
 *
 * @param orderId — order_id из photo_print_orders (e.g. 'chat-xxx-1', 'PP-250128-ABCD')
 */
export async function automateShipping(orderId: string): Promise<void> {
  // Проверяем конфигурацию
  if (!isOtpravkaConfigured()) {
    logger.info(`[Shipping] Otpravka API not configured, skipping automation for ${orderId}`);
    return;
  }

  // 1. Загрузить заказ
  const order = await db.queryOne<PrintOrder>(
    `SELECT order_id, contact_name, contact_phone, delivery_address, delivery_postal_code,
            items, comments, shipment_status
     FROM photo_print_orders WHERE order_id = $1`,
    [orderId],
  );

  if (!order) {
    logger.error(`[Shipping] Order ${orderId} not found`);
    return;
  }

  // Не создавать отправление повторно
  if (order.shipment_status !== 'none') {
    logger.info(`[Shipping] Order ${orderId} already has shipment_status=${order.shipment_status}, skipping`);
    return;
  }

  // 2. Проверить наличие адреса доставки
  if (!order.delivery_address || !order.delivery_postal_code) {
    logger.info(`[Shipping] Order ${orderId} has no delivery address, skipping`);
    return;
  }

  // 3. Рассчитать вес
  const items = typeof order.items === 'string'
    ? JSON.parse(order.items) as Array<Record<string, unknown>>
    : order.items;

  // Извлечь format + quantity из items для расчёта веса
  const weightItems = items.map(item => ({
    format: (item['format'] as string) || 'document',
    quantity: (item['quantity'] as number) || 1,
  }));
  const weight = calculateOrderWeight(weightItems);

  // 4. Подготовить данные получателя
  const nameParts = (order.contact_name || 'Клиент').trim().split(/\s+/);
  const givenName = nameParts[0] || 'Клиент';
  const surname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : givenName;

  // Извлечь структурированный адрес из comments (JSON metadata)
  let deliveryCity = '';
  let deliveryRegion = '';
  let deliveryStreet = order.delivery_address;
  let deliveryFlat: string | undefined;

  try {
    const commentsMeta = order.comments ? JSON.parse(order.comments) as Record<string, unknown> : {};
    if (commentsMeta['deliveryCity']) deliveryCity = commentsMeta['deliveryCity'] as string;
    if (commentsMeta['deliveryRegion']) deliveryRegion = commentsMeta['deliveryRegion'] as string;
    if (commentsMeta['deliveryStreet']) {
      const street = commentsMeta['deliveryStreet'] as string;
      const house = commentsMeta['deliveryHouse'] as string || '';
      deliveryStreet = house ? `${street}, д ${house}` : street;
    }
    if (commentsMeta['deliveryFlat']) deliveryFlat = commentsMeta['deliveryFlat'] as string;
  } catch {
    // comments может быть не JSON — используем delivery_address as-is
  }

  // Телефон: убираем всё кроме цифр
  const phoneDigits = (order.contact_phone || '').replace(/\D/g, '');

  const shipmentData: ShipmentData = {
    'address-type-to': 'DEFAULT',
    'given-name': givenName,
    'surname': surname,
    'index-to': parseInt(order.delivery_postal_code, 10),
    'mail-direct': 643,
    'mail-category': 'ORDERED',
    'mail-type': 'POSTAL_PARCEL',
    'mass': weight,
    'order-num': orderId,
    'place-to': deliveryCity,
    'region-to': deliveryRegion,
    'street-to': deliveryStreet,
    'postoffice-code': config.delivery.senderPostalCode,
    'sender-name': config.delivery.senderName,
  };

  if (deliveryFlat) {
    shipmentData['room-to'] = deliveryFlat;
  }
  if (phoneDigits) {
    shipmentData['tel-address'] = parseInt(phoneDigits, 10);
  }

  // 5. Создать отправление
  const result = await createShipment(shipmentData);

  if (!result.success) {
    logger.error(`[Shipping] Failed to create shipment for ${orderId}: ${result.error}`);
    await db.query(
      `UPDATE photo_print_orders
       SET shipment_status = 'error', shipment_weight_grams = $1
       WHERE order_id = $2`,
      [weight, orderId],
    );
    return;
  }

  // 6. Сгенерировать этикетку
  let labelPath: string | null = null;

  if (result.shipmentId) {
    const labelBuffer = await generateShippingLabel(result.shipmentId);
    if (labelBuffer) {
      if (!fs.existsSync(LABELS_DIR)) {
        fs.mkdirSync(LABELS_DIR, { recursive: true });
      }
      const filename = `label-${orderId}.pdf`;
      const fullPath = path.join(LABELS_DIR, filename);
      fs.writeFileSync(fullPath, labelBuffer);
      labelPath = `/uploads/labels/${filename}`;
      logger.info(`[Shipping] Label saved: ${fullPath}`);
    }
  }

  // 7. Обновить заказ
  await db.query(
    `UPDATE photo_print_orders SET
       tracking_number = $1,
       shipment_id = $2,
       shipment_status = $3,
       label_url = $4,
       shipment_created_at = NOW(),
       shipment_weight_grams = $5
     WHERE order_id = $6`,
    [
      result.trackingNumber || null,
      result.shipmentId || null,
      labelPath ? 'label_generated' : 'created',
      labelPath,
      weight,
      orderId,
    ],
  );

  logger.info(
    `[Shipping] ✅ Automation complete for ${orderId}: ` +
    `tracking=${result.trackingNumber || 'pending'}, weight=${weight}g, ` +
    `status=${labelPath ? 'label_generated' : 'created'}`,
  );
}
