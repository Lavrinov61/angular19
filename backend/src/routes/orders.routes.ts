import express, { Response } from 'express';
import db from '../database/db.js';
import { config } from '../config/index.js';
import { authenticateToken, optionalAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { PaginatedResponse } from '../types/index.js';
import { NotificationService } from '../services/notification.service.js';
import { createTaskFromOrder } from '../services/task-auto.service.js';
import { validatePartnerPromoCode, recordReferral, confirmReferral } from '../services/partners.service.js';
import { recordRedemption } from '../services/campaign.service.js';
import { calculatePrice, calculatePriceWaterfall, getCategories } from '../services/pricing-engine.service.js';
import type { PromoRedemptionLookup } from '../types/views/index.js';
import { idempotent } from '../middleware/idempotency.js';
import { autoPrintOrderItems, shouldAutoPrint } from '../services/print.service.js';
import { registerConversion } from '../services/attribution.service.js';

import { validate } from '../middleware/validate.js';
import { createMobileOrderSchema, updateOrderStatusSchema, addOrderCommentSchema } from '../schemas/orders.schema.js';
import { piiAudit } from '../middleware/pii-audit.js';
import { createLogger } from '../utils/logger.js';
const router = express.Router();

const logger = createLogger('orders.routes');
// Create order (from mobile app — guests allowed)
router.post('/', optionalAuth, validate(createMobileOrderSchema), idempotent(60), async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, contact, totalAmount: clientAmount, deliveryMethod, deliveryAddress, comment, promoCode, fingerprintVisitorId, partnerPromoCode, categorySlug, selectedOptions } = req.body;

  // ── Server-side price validation ──
  // If frontend sent categorySlug + selectedOptions, recalculate via pricing engine
  // F119: v2 waterfall adds volume modifiers, category degressive, subscription per-item
  const useWaterfallV2 = process.env['PRICE_ENGINE_V2'] === 'true';
  let totalAmount = clientAmount;
  if (categorySlug && selectedOptions && typeof selectedOptions === 'object') {
    try {
      const flatOptions: { option_slug: string; quantity: number }[] = [];
      for (const [, slugs] of Object.entries(selectedOptions)) {
        if (Array.isArray(slugs)) {
          for (const slug of slugs) {
            if (typeof slug === 'string') {
              flatOptions.push({ option_slug: slug, quantity: 1 });
            }
          }
        }
      }
      if (flatOptions.length > 0) {
        let serverTotal: number;
        if (useWaterfallV2) {
          // v2: slug → UUID resolve (same pattern as pos.routes.ts)
          const categories = await getCategories();
          const cat = categories.find(c => c.slug === categorySlug);
          const optionMap = new Map<string, string>();
          if (cat) {
            for (const group of cat.optionGroups) {
              for (const opt of group.options) {
                optionMap.set(opt.slug, opt.id);
              }
            }
          }
          const waterfallItems: { serviceOptionId: string; quantity: number }[] = [];
          for (const fo of flatOptions) {
            const optId = optionMap.get(fo.option_slug);
            if (optId) {
              waterfallItems.push({ serviceOptionId: optId, quantity: fo.quantity });
            }
          }
          if (waterfallItems.length > 0) {
            const channel: 'online' | 'pos' | 'crm' =
              deliveryMethod === 'pickup' ? 'pos' : 'online';
            const v2Result = await calculatePriceWaterfall({
              items: waterfallItems,
              channel,
              customerPhone: contact?.phone ?? undefined,
              customerEmail: contact?.email ?? undefined,
              promoCode: promoCode || undefined,
            });
            serverTotal = v2Result.total;
          } else {
            serverTotal = clientAmount;
          }
        } else {
          // v1: legacy slug-based calculation
          const v1Result = await calculatePrice({
            categorySlug,
            selectedOptions: flatOptions,
            deliveryMethod: deliveryMethod || 'electronic',
            promoCode: promoCode || undefined,
          });
          serverTotal = v1Result.breakdown.total;
        }
        if (Math.abs(serverTotal - clientAmount) > 1) {
          logger.warn('[Orders] AMOUNT MISMATCH — using server amount', {
            clientAmount, serverTotal, categorySlug, engine: useWaterfallV2 ? 'v2' : 'v1',
          });
          totalAmount = serverTotal;
        }
      }
    } catch (err) {
      // Pricing engine error — log but don't block order creation
      logger.warn('[Orders] Price validation failed, using client amount', {
        error: err instanceof Error ? err.message : String(err),
        engine: useWaterfallV2 ? 'v2' : 'v1',
      });
    }
  }

  const clientId = req.user?.id || null;

  // Increment promo code usage if provided
  if (promoCode) {
    await db.query(
      `UPDATE promotions SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = NOW()
       WHERE UPPER(promo_code) = UPPER($1) AND is_active = true
         AND (usage_limit IS NULL OR COALESCE(usage_count, 0) < usage_limit)`,
      [promoCode],
    );
  }

  const partnerCode = (partnerPromoCode || '').trim() || undefined;

  const metadata = {
    items,
    contact,
    deliveryMethod: deliveryMethod || 'pickup',
    deliveryAddress: deliveryAddress || '',
    comment: comment || '',
    ...(promoCode ? { promo_code: promoCode } : {}),
    ...(partnerCode ? { partner_promo_code: partnerCode } : {}),
    ...(fingerprintVisitorId ? { fingerprint_visitor_id: fingerprintVisitorId } : {}),
  };

  const order = await db.queryOne(
    `INSERT INTO orders (client_id, type, status, payment_status, total_amount, currency, metadata)
     VALUES ($1, 'product', 'pending_payment', 'pending', $2, 'RUB', $3)
     RETURNING *`,
    [clientId, totalAmount, JSON.stringify(metadata)]
  );

  logger.info(`[Orders] Created order ${order.id} for ${clientId ? 'user ' + clientId : 'guest'}, amount: ${totalAmount}${promoCode ? ', promo: ' + promoCode : ''}${partnerCode ? ', partner: ' + partnerCode : ''}`);

  // Partner attribution: record pending referral (fire-and-forget)
  if (partnerCode) {
    validatePartnerPromoCode(partnerCode).then(partner => {
      if (!partner) return;
      return recordReferral({
        partner_id: partner.id,
        order_id: String(order.id),
        order_type: 'order',
        order_amount: totalAmount,
        promo_code: partnerCode,
        client_phone: contact.phone,
        status: 'pending',
      });
    }).catch(err => logger.error('[Orders] recordReferral failed', { error: String(err) }));
  }

  // Record promo redemption for campaign analytics
  if (promoCode) {
    db.queryOne<PromoRedemptionLookup>(
      `SELECT id, discount_percent, discount_amount FROM promotions
       WHERE UPPER(promo_code) = UPPER($1) AND is_active = true`,
      [promoCode],
    ).then(async (promo) => {
      if (!promo) return;
      let discountVal = 0;
      if (promo.discount_percent) {
        discountVal = Math.round(totalAmount * promo.discount_percent / 100);
      } else if (promo.discount_amount) {
        discountVal = Math.min(parseFloat(promo.discount_amount), totalAmount);
      }
      if (discountVal > 0) {
        await recordRedemption({
          promotion_id: promo.id,
          promo_code: String(promoCode).trim().toUpperCase(),
          discount_amount: discountVal,
          original_amount: totalAmount,
          order_id: String(order.id),
          order_type: 'order',
          customer_id: clientId ?? undefined,
          customer_phone: contact.phone,
        });
      }
    }).catch(err => logger.error('[Orders] recordRedemption failed', { error: String(err) }));
  }

  // Трекинг создания заказа для воронки продаж (fire-and-forget)
  fetch(`${config.bridge.url}/api/bridge/track-order-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_type: 'order_created',
      order_id: order.id,
      order_source: 'app_order',
      amount: totalAmount,
      fingerprint_visitor_id: fingerprintVisitorId || undefined,
      phone: contact.phone,
      services: items.map((i: Record<string, unknown>) => i['name'] || i['service'] || 'Заказ'),
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err: unknown) => logger.error('[Funnel] track-order-event error', { error: err instanceof Error ? err.message : String(err) }));

  // Автосоздание задачи на рабочей доске
  createTaskFromOrder({
    orderId: order.id,
    orderTable: 'orders',
    clientName: contact.name,
    clientPhone: contact.phone,
    clientChannel: 'online',
    title: `Заказ — ${contact.name}`,
    description: `Сумма: ${totalAmount}₽. ${comment || ''}`.trim(),
    createdBy: clientId || undefined,
  }).catch(err => logger.error('[Orders] Auto-task creation error', { error: String(err) }));

  res.status(201).json({ success: true, data: order });
});

// List orders (auth required)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { clientId, photographerId, status, type, page = 1, limit = 10 } = req.query;

  // Authorization: users can only see their own orders unless admin
  if (req.user.role !== 'admin') {
    if (clientId && clientId !== req.user.id) {
      throw new AppError(403, 'You can only view your own orders');
    }
    if (!clientId && req.user.role === 'client') {
      // Default to user's own orders
    }
  }

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  let whereConditions: string[] = [];
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (clientId) {
    whereConditions.push(`client_id = $${paramIndex++}`);
    queryParams.push(clientId);
  } else if (req.user.role === 'client') {
    whereConditions.push(`client_id = $${paramIndex++}`);
    queryParams.push(req.user.id);
  }

  if (photographerId) {
    whereConditions.push(`photographer_id = $${paramIndex++}`);
    queryParams.push(photographerId);
  }

  if (status) {
    whereConditions.push(`status = $${paramIndex++}`);
    queryParams.push(status);
  }

  if (type) {
    whereConditions.push(`type = $${paramIndex++}`);
    queryParams.push(type);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Get total count
  const countResult = await db.queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM orders ${whereClause}`,
    queryParams
  );
  const total = parseInt(countResult?.total || '0', 10);
  const totalPages = Math.ceil(total / limitNum);

  // Get orders
  const orders = await db.query(
    `SELECT id, client_id, photographer_id, payment_id, amount, status, service_type, notes, created_at, updated_at FROM orders ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...queryParams, limitNum, offset]
  );

  const response: PaginatedResponse<any> = {
    success: true,
    data: orders,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  };

  res.json(response);
});

// My order history from photo_print_orders (auth required)
router.get('/my-history', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const limit = Math.min(parseInt(req.query['limit'] as string || '10', 10), 50);
  const offset = parseInt(req.query['offset'] as string || '0', 10);

  const [orders, countResult] = await Promise.all([
    db.query(
      `SELECT ppo.order_id as id, ppo.total_price, ppo.status, ppo.payment_status, ppo.mode,
              ppo.items, ppo.created_at, ppo.delivery_method
       FROM photo_print_orders ppo
       JOIN conversations vcs ON vcs.id = ppo.chat_session_id
       WHERE vcs.user_id = $1
       ORDER BY ppo.created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    ),
    db.queryOne<{ total: string }>(
      `SELECT COUNT(*) as total FROM photo_print_orders ppo
       JOIN conversations vcs ON vcs.id = ppo.chat_session_id
       WHERE vcs.user_id = $1`,
      [req.user.id]
    ),
  ]);

  res.json({ success: true, data: orders, total: parseInt(countResult?.total || '0', 10) });
});

// Get order details (auth required)
router.get('/:id', authenticateToken, piiAudit('order', 'id'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { id } = req.params;

  const order = await db.queryOne('SELECT id, client_id, photographer_id, payment_id, amount, status, service_type, notes, created_at, updated_at FROM orders WHERE id = $1', [id]);

  if (!order) {
    throw new AppError(404, 'Order not found');
  }

  // Authorization: user must be client, photographer, or admin
  const isOwner = order.client_id === req.user.id || order.photographer_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    throw new AppError(403, 'Forbidden');
  }

  // Get order comments
  const comments = await db.query(
    'SELECT id, order_id, user_id, content, created_at FROM order_comments WHERE order_id = $1 ORDER BY created_at ASC',
    [id]
  );

  res.json({
    success: true,
    data: {
      ...order,
      comments,
    },
  });
});

// Update order status (auth required)
router.put('/:id/status', authenticateToken, validate(updateOrderStatusSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { id } = req.params;
  const { status } = req.body;

  const updated = await db.queryOne(
    'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, id]
  );

  if (!updated) {
    throw new AppError(404, 'Order not found');
  }

  // Notify client about order status change
  if (updated.client_id) {
    const statusNames: Record<string, string> = {
      processing: 'В обработке',
      ready: 'Готов к выдаче',
      completed: 'Завершён',
      cancelled: 'Отменён',
    };
    NotificationService.create({
      userId: updated.client_id,
      title: 'Статус заказа обновлён',
      body: `Заказ — ${statusNames[status] || status}`,
      type: 'order_status',
      data: { orderId: updated.id, status },
    }).catch(err => logger.error('[Orders] Notification error', { error: String(err) }));
  }

  // Auto-print: when order transitions to configured status, queue print jobs
  if (shouldAutoPrint(status)) {
    autoPrintOrderItems(id, req.user!.id).catch(err =>
      logger.error('[AutoPrint] Failed to auto-print', { orderId: id, error: String(err) })
    );
  }

  // Partner attribution: confirm referral on order completion
  if (status === 'completed') {
    const orderMeta = typeof updated.metadata === 'string'
      ? JSON.parse(updated.metadata)
      : updated.metadata;
    const partnerCodeFromMeta = orderMeta?.partner_promo_code as string | undefined;
    if (partnerCodeFromMeta) {
      confirmReferral(String(updated.id), 'order').catch(err =>
        logger.error('[Orders] confirmReferral failed:', { error: String(err) })
      );
    }

    const phoneFromMeta = (orderMeta?.contact_phone as string | undefined) ?? undefined;
    const fingerprintFromMeta = (orderMeta?.fingerprint_visitor_id as string | undefined) ?? undefined;
    if (phoneFromMeta || fingerprintFromMeta) {
      registerConversion({
        phone: phoneFromMeta,
        fingerprint_visitor_id: fingerprintFromMeta,
        conversion_type: 'order_completed',
        conversion_value: Number(updated.total_amount) || undefined,
        order_id: String(updated.id),
      }).catch((err: unknown) =>
        logger.error('[Orders] registerConversion failed', { error: String(err), orderId: updated.id })
      );
    }
  }

  res.json({ success: true, data: updated });
});

// Add order comment (auth required)
router.post('/:id/comments', authenticateToken, validate(addOrderCommentSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { id } = req.params;
  const { comment } = req.body;

  const commentRecord = await db.queryOne(
    `INSERT INTO order_comments (order_id, user_id, comment)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [id, req.user.id, comment]
  );

  res.status(201).json({ success: true, data: commentRecord });
});

export default router;
