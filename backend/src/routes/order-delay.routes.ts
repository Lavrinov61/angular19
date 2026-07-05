import express, { Response } from 'express';
import { z } from 'zod';
import db from '../database/db.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const log = createLogger('order-delay');

const DAILY_LIMIT = 500;

const delaySchema = z.object({
  reason: z.enum(['processing', 'equipment', 'materials', 'quality_check', 'other']),
  compensation_amount: z.coerce.number().min(0).max(500),
});

/**
 * POST /api/order-delay/:orderId
 * Register order delay + optional loyalty compensation + auto-message to client
 */
router.post(
  '/:orderId',
  authenticateToken,
  requirePermission('production:manage'),
  validate(delaySchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { orderId } = req.params;
    const { reason, compensation_amount } = req.body as z.infer<typeof delaySchema>;
    const userId = req.user!.id;

    // 1. Verify order exists
    const order = await db.queryOne<{ id: string; chat_session_id: string | null; contact_name: string | null }>(
      `SELECT id, chat_session_id, contact_name FROM photo_print_orders WHERE order_id = $1`,
      [orderId],
    );
    if (!order) {
      res.status(404).json({ success: false, error: 'Заказ не найден' });
      return;
    }

    // 2. Daily limit check
    if (compensation_amount > 0) {
      const dailyRow = await db.queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(compensation_amount), 0) AS total
         FROM order_delay_compensations
         WHERE credited_by = $1 AND created_at >= CURRENT_DATE`,
        [userId],
      );
      const dailyTotal = parseFloat(dailyRow?.total || '0');
      if (dailyTotal + compensation_amount > DAILY_LIMIT) {
        res.status(400).json({
          success: false,
          error: `Дневной лимит компенсаций (${DAILY_LIMIT}₽) превышен. Уже начислено: ${dailyTotal}₽`,
        });
        return;
      }
    }

    // 3. Double-credit protection (1 hour cooldown)
    const recent = await db.queryOne<{ id: string }>(
      `SELECT id FROM order_delay_compensations
       WHERE order_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [orderId],
    );
    if (recent) {
      res.status(409).json({
        success: false,
        error: 'Компенсация по этому заказу уже была начислена менее часа назад',
      });
      return;
    }

    // 4. Insert compensation record
    const comp = await db.queryOne<{ id: string }>(
      `INSERT INTO order_delay_compensations (order_id, reason, compensation_amount, chat_session_id, credited_by, message_sent)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING id`,
      [orderId, reason, compensation_amount, order.chat_session_id, userId],
    );

    // 5. Credit loyalty points if amount > 0
    if (compensation_amount > 0) {
      // Find customer via order -> try to credit loyalty_profiles.points
      const customerRow = await db.queryOne<{ user_id: string }>(
        `SELECT u.id AS user_id
         FROM photo_print_orders ppo
         LEFT JOIN users u ON u.phone = ppo.contact_phone
         WHERE ppo.order_id = $1 AND u.id IS NOT NULL`,
        [orderId],
      );
      if (customerRow) {
        await db.query(
          `INSERT INTO loyalty_profiles (user_id, points, total_points_earned)
           VALUES ($1, $2, $2)
           ON CONFLICT (user_id) DO UPDATE
           SET points = COALESCE(loyalty_profiles.points, 0) + $2,
               total_points_earned = COALESCE(loyalty_profiles.total_points_earned, 0) + $2,
               updated_at = NOW()`,
          [customerRow.user_id, Math.round(compensation_amount)],
        );
      }
    }

    // 6. Send message to chat
    let messageSent = false;
    if (order.chat_session_id) {
      const reasonLabels: Record<string, string> = {
        processing: 'обработка заказа',
        equipment: 'техническое обслуживание оборудования',
        materials: 'ожидание материалов',
        quality_check: 'дополнительный контроль качества',
        other: 'непредвиденные обстоятельства',
      };
      const reasonText = reasonLabels[reason] || reason;

      let messageText = `Уважаемый клиент, приносим извинения за задержку вашего заказа. Причина: ${reasonText}.`;
      if (compensation_amount > 0) {
        messageText += ` В качестве компенсации мы начислили ${compensation_amount}₽ на ваш бонусный счёт.`;
      }
      messageText += ' Благодарим за понимание!';

      try {
        await db.query(
          `INSERT INTO messages (conversation_id, sender_type, sender_name, message_type, content)
           VALUES ($1, 'bot', 'Своё Фото', 'text', $2)`,
          [order.chat_session_id, messageText],
        );
        messageSent = true;
        await db.query(
          `UPDATE order_delay_compensations SET message_sent = true WHERE id = $1`,
          [comp!.id],
        );
      } catch (err) {
        log.error('Failed to send delay message to chat', { orderId, error: String(err) });
      }
    }

    log.info('Order delay compensation created', {
      orderId,
      reason,
      amount: compensation_amount,
      messageSent,
      compensationId: comp!.id,
    });

    res.json({
      success: true,
      compensation: {
        id: comp!.id,
        amount: compensation_amount,
        reason,
        message_sent: messageSent,
      },
    });
  },
);

export default router;
