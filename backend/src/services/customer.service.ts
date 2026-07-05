/**
 * Единый сервис идентификации клиентов.
 * Объединяет клиентов из разных каналов (сайт, Telegram, WhatsApp, POS)
 * по phone, visitor_id, telegram_user_id, email.
 */

import db from '../database/db.js';

// ============================================================================
// Типы
// ============================================================================

export interface Customer {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  visitor_ids: string[];
  telegram_user_id: number | null;
  telegram_username: string | null;
  total_orders: number;
  total_spent: number;
  first_order_at: string | null;
  last_order_at: string | null;
  used_basic_promo: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerIdentifiers {
  phone?: string | null;
  visitorId?: string | null;
  telegramUserId?: number | null;
  email?: string | null;
  name?: string | null;
}

// ============================================================================
// Поиск / создание клиента
// ============================================================================

/**
 * Найти или создать клиента по любому набору идентификаторов.
 * Приоритет поиска: phone → telegram_user_id → visitor_id → email.
 * При нахождении дополняет недостающие данные (мердж идентификаторов).
 */
export async function findOrCreateCustomer(ids: CustomerIdentifiers): Promise<Customer> {
  const { phone, visitorId, telegramUserId, email, name } = ids;

  // 1. Поиск по phone (главный идентификатор)
  let customer: Customer | null = null;
  if (phone) {
    customer = await db.queryOne<Customer>(
      `SELECT * FROM customers WHERE phone = $1`, [phone]
    );
  }

  // 2. Поиск по telegram_user_id
  if (!customer && telegramUserId) {
    customer = await db.queryOne<Customer>(
      `SELECT * FROM customers WHERE telegram_user_id = $1`, [telegramUserId]
    );
  }

  // 3. Поиск по visitor_id
  if (!customer && visitorId) {
    customer = await db.queryOne<Customer>(
      `SELECT * FROM customers WHERE $1 = ANY(visitor_ids)`, [visitorId]
    );
  }

  // 4. Поиск по email
  if (!customer && email) {
    customer = await db.queryOne<Customer>(
      `SELECT * FROM customers WHERE email = $1`, [email]
    );
  }

  // 5. Не найден — создаём нового
  if (!customer) {
    const visitorIds = visitorId ? [visitorId] : [];
    customer = await db.queryOne<Customer>(
      `INSERT INTO customers (phone, email, name, visitor_ids, telegram_user_id, telegram_username)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [phone || null, email || null, name || null, visitorIds, telegramUserId || null, null]
    );
    if (!customer) throw new Error('Failed to create customer');
    return customer;
  }

  // 6. Мердж: дополняем недостающие данные
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIdx = 1;

  // Добавить visitor_id если отсутствует
  if (visitorId && !customer.visitor_ids.includes(visitorId)) {
    updates.push(`visitor_ids = array_append(visitor_ids, $${paramIdx++})`);
    values.push(visitorId);
  }

  // Добавить phone если не было
  if (phone && !customer.phone) {
    updates.push(`phone = $${paramIdx++}`);
    values.push(phone);
  }

  // Добавить email если не было
  if (email && !customer.email) {
    updates.push(`email = $${paramIdx++}`);
    values.push(email);
  }

  // Добавить telegram_user_id если не было
  if (telegramUserId && !customer.telegram_user_id) {
    updates.push(`telegram_user_id = $${paramIdx++}`);
    values.push(telegramUserId);
  }

  // Обновить имя если не было
  if (name && !customer.name) {
    updates.push(`name = $${paramIdx++}`);
    values.push(name);
  }

  if (updates.length > 0) {
    values.push(customer.id);
    const updated = await db.queryOne<Customer>(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );
    if (updated) return updated;
  }

  return customer;
}

// ============================================================================
// Промо-проверки
// ============================================================================

/**
 * Проверить, использовал ли клиент стартовое промо базового тарифа.
 */
export function hasUsedBasicPromo(customer: Customer): boolean {
  return customer.used_basic_promo;
}

// ============================================================================
// Обновление статистики после оплаты
// ============================================================================

/**
 * Записать оплаченный заказ в статистику клиента.
 * Вызывается из payment webhook после успешной оплаты.
 */
export async function recordPaidOrder(
  customerId: string,
  amount: number,
  serviceType?: string,
): Promise<void> {
  const setBasicPromo = serviceType && (
    serviceType === 'Экспресс'
      || serviceType.startsWith('Экспресс')
      || serviceType === 'Без обработки'
      || serviceType.startsWith('Без обработки')
  );

  await db.queryOne(
    `UPDATE customers SET
       total_orders = total_orders + 1,
       total_spent = total_spent + $1,
       first_order_at = COALESCE(first_order_at, NOW()),
       last_order_at = NOW()
       ${setBasicPromo ? ', used_basic_promo = true' : ''}
     WHERE id = $2`,
    [amount, customerId]
  );
}

/**
 * Найти customer_id по order (через chat_session_id → visitor_id).
 * Используется в payment webhook когда customer_id ещё не был записан.
 */
export async function findCustomerByOrder(order: Record<string, unknown>): Promise<Customer | null> {
  // Попробовать через customer_id если уже записан
  if (order['customer_id']) {
    return db.queryOne<Customer>(
      `SELECT * FROM customers WHERE id = $1`, [order['customer_id']]
    );
  }

  // Через chat_session_id → visitor_id
  if (order['chat_session_id']) {
    const session = await db.queryOne<{ visitor_id: string; visitor_phone: string | null }>(
      `SELECT visitor_id, visitor_phone FROM conversations WHERE id = $1`,
      [order['chat_session_id']]
    );
    if (session?.visitor_id) {
      return findOrCreateCustomer({
        visitorId: session.visitor_id,
        phone: session.visitor_phone || (order['contact_phone'] as string) || undefined,
        email: (order['contact_email'] as string) || undefined,
        name: (order['contact_name'] as string) || undefined,
      });
    }
  }

  // Через contact_phone
  if (order['contact_phone']) {
    return findOrCreateCustomer({ phone: order['contact_phone'] as string });
  }

  return null;
}
