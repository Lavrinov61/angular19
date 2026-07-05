/**
 * chat-cart-waterfall.routes.ts — Waterfall v2 пересчёт корзины оператора.
 *
 * Для items с serviceOptionId вызывает calculatePriceWaterfall.
 * Items без serviceOptionId (ручной ввод оператора) суммируются напрямую.
 */

import { Router, Response } from 'express';
import { pool } from '../../database/db.js';
import { authenticateToken, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/errorHandler.js';
import { calculatePriceWaterfall, type PriceWaterfallInput } from '../../services/pricing-engine.service.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('chat-cart-waterfall');
const router = Router();

interface RecalcItem {
  serviceOptionId?: string;
  price: number;
  nextPrice?: number;
  quantity: number;
  name: string;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isRecalcItem(value: unknown): value is RecalcItem {
  if (typeof value !== 'object' || value === null) return false;
  const price = optionalNumber(Reflect.get(value, 'price'));
  const quantity = optionalNumber(Reflect.get(value, 'quantity'));
  const name = optionalString(Reflect.get(value, 'name'));
  const serviceOptionId = Reflect.get(value, 'serviceOptionId');
  const nextPrice = Reflect.get(value, 'nextPrice');
  return price !== undefined
    && quantity !== undefined
    && name !== undefined
    && (serviceOptionId === undefined || typeof serviceOptionId === 'string')
    && (nextPrice === undefined || optionalNumber(nextPrice) !== undefined);
}

/** Простой подсчёт для позиций без serviceOptionId */
function manualItemTotal(item: RecalcItem): number {
  const restPrice = item.nextPrice ?? item.price;
  return item.price + restPrice * Math.max(0, (item.quantity || 1) - 1);
}

/**
 * POST /admin/sessions/:sessionId/cart/recalculate
 *
 * Body: { items, customerPhone?, promoCode? }
 */
router.post(
  '/admin/sessions/:sessionId/cart/recalculate',
  authenticateToken,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { sessionId } = req.params;
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const rawItems = Reflect.get(body, 'items');
    const items = Array.isArray(rawItems) ? rawItems.filter(isRecalcItem) : undefined;
    const customerPhone = optionalString(Reflect.get(body, 'customerPhone'));
    const promoCode = optionalString(Reflect.get(body, 'promoCode'));

    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError(400, 'items обязателен');
    }

    const waterfallItems: PriceWaterfallInput['items'] = [];
    let manualTotal = 0;

    for (const item of items) {
      if (item.serviceOptionId) {
        waterfallItems.push({
          serviceOptionId: item.serviceOptionId,
          quantity: item.quantity || 1,
        });
      } else {
        manualTotal += manualItemTotal(item);
      }
    }

    // Нечего считать через waterfall — простая сумма
    if (waterfallItems.length === 0) {
      res.json({
        success: true,
        total: manualTotal,
        savings: 0,
        waterfallApplied: false,
      });
      return;
    }

    // Телефон клиента из сессии если не передан
    let phone = customerPhone;
    if (!phone) {
      const conv = await pool.query(
        `SELECT visitor_phone FROM conversations WHERE id = $1`,
        [sessionId],
      );
      phone = conv.rows[0]?.visitor_phone || undefined;
    }

    const result = await calculatePriceWaterfall({
      items: waterfallItems,
      customerPhone: phone,
      channel: 'crm',
      promoCode,
    });

    log.info('[recalculate] Waterfall v2', {
      sessionId,
      waterfallTotal: result.total,
      manualTotal,
      savings: result.savings,
    });

    res.json({
      success: true,
      total: result.total + manualTotal,
      waterfallTotal: result.total,
      manualTotal,
      savings: result.savings,
      waterfallApplied: true,
      items: result.items,
      isReturning: result.isReturning,
      discounts: {
        account: result.accountDiscount,
        subscriber: result.subscriberDiscount,
        loyalty: result.loyaltyDiscount,
        promo: result.promoDiscount,
      },
      promoBlocked: result.promoBlocked || undefined,
      detectedCombos: result.detectedCombos,
    });
  },
);

export default router;
