/**
 * Internal Customer API — кросс-канальная идентификация клиентов.
 *
 * Используется PHP-воркерами (WhatsApp, Telegram) и внутренними сервисами
 * для создания/обновления записей в таблице customers.
 *
 * Авторизация: X-Internal-Key header.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { config } from '../config/index.js';
import { findOrCreateCustomer, recordPaidOrder } from '../services/customer.service.js';
import db from '../database/db.js';

const router = Router();

// ============================================================================
// Middleware: авторизация по API-ключу
// ============================================================================

function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-internal-key'] as string | undefined;
  if (!config.internalApiKey || key !== config.internalApiKey) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

router.use(internalAuth);

// ============================================================================
// POST /customer/identify — найти или создать клиента
// ============================================================================

router.post('/customer/identify', async (req: Request, res: Response): Promise<void> => {
  const { phone, telegramUserId, telegramUsername, visitorId, email, name } = req.body;

  if (!phone && !telegramUserId && !visitorId && !email) {
    throw new AppError(400, 'At least one identifier required (phone, telegramUserId, visitorId, email)');
  }

  const customer = await findOrCreateCustomer({
    phone: phone || undefined,
    telegramUserId: telegramUserId ? Number(telegramUserId) : undefined,
    visitorId: visitorId || undefined,
    email: email || undefined,
    name: name || undefined,
  });

  // Обновить telegram_username если передан и отсутствует
  if (telegramUsername && !customer.telegram_username) {
    await db.queryOne(
      `UPDATE customers SET telegram_username = $1 WHERE id = $2`,
      [telegramUsername, customer.id]
    );
  }

  // 6.2 Loyalty link: слинковать loyalty_profile с customer через telegram_user_id
  if (customer.telegram_user_id) {
    await db.query(
      `UPDATE loyalty_profiles lp
       SET customer_id = $1, updated_at = NOW()
       FROM telegram_users tu
       WHERE tu.telegram_id = $2
         AND lp.telegram_user_id = tu.id
         AND lp.customer_id IS NULL`,
      [customer.id, customer.telegram_user_id]
    );
  }

  res.json({
    success: true,
    data: {
      customerId: customer.id,
      isNew: customer.total_orders === 0,
      usedBasicPromo: customer.used_basic_promo,
      totalOrders: customer.total_orders,
      totalSpent: customer.total_spent,
    },
  });
});

// ============================================================================
// POST /customer/record-order — записать оплаченный заказ
// ============================================================================

router.post('/customer/record-order', async (req: Request, res: Response): Promise<void> => {
  const { customerId, amount, serviceType } = req.body;

  if (!customerId || !amount) throw new AppError(400, 'customerId and amount are required');

  await recordPaidOrder(customerId, Number(amount), serviceType || undefined);

  res.json({ success: true });
});

export default router;
