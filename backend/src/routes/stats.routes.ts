import { Router, Request, Response } from 'express';
import db from '../database/db.js';

const router = Router();

/**
 * GET /api/stats/clients — расчёт общего числа клиентов и заказов.
 * Публичный эндпоинт. Кэшируется на 1 час.
 *
 * Формула:
 *   Офлайн: 1999–2005 → 50 чеков/день, 2005–текущий год → 15 чеков/день
 *   Онлайн: оплаченные заказы из photo_print_orders
 *   POS: уникальные клиенты и чеки из pos_receipts
 */
router.get('/clients', async (_req: Request, res: Response) => {
  const currentYear = new Date().getFullYear();

  // Офлайн-клиенты по годам
  const y2005 = Math.min(currentYear, 2005) - 1999; // до 2005
  const yAfter = Math.max(0, currentYear - 2005);    // после 2005
  const offline = y2005 * 365 * 50 + yAfter * 365 * 15;

  // Онлайн: оплаченные заказы из БД
  const onlineRows = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM photo_print_orders WHERE payment_status = 'paid'`,
  );
  const online = parseInt(onlineRows[0]?.count ?? '0', 10);

  // POS: уникальные клиенты по телефону
  const posClientsRows = await db.query<{ count: string }>(
    `SELECT COUNT(DISTINCT customer_phone) AS count FROM pos_receipts WHERE NOT is_refund AND customer_phone IS NOT NULL`,
  );
  const posClients = parseInt(posClientsRows[0]?.count ?? '0', 10);

  // POS: общее число чеков
  const posReceiptsRows = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM pos_receipts WHERE NOT is_refund`,
  );
  const ordersPos = parseInt(posReceiptsRows[0]?.count ?? '0', 10);

  const clientCount = offline + online + posClients;
  const orderCount = online + ordersPos;

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    success: true,
    data: {
      clientCount,
      offline,
      online,
      pos: posClients,
      orderCount,
      ordersOnline: online,
      ordersPos,
    },
  });
});

export default router;
