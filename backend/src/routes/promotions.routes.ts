import { Router, Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { getPartnerPromoDiscount } from '../services/partners.service.js';
import { requireApiKey } from '../middleware/api-key.middleware.js';

const PROMO_KINDS = ['public_campaign', 'personal', 'prize', 'partner'] as const;
type PromoKind = typeof PROMO_KINDS[number];

const router = Router();

// ============================================================================
// Публичные эндпоинты
// ============================================================================

/**
 * GET /api/promotions — список активных акций
 */
router.get('/', async (_req: Request, res: Response) => {
  const result = await db.query(
    `SELECT id, slug, title, description, image_url, discount_percent, discount_amount, original_price, promo_price, promo_code, usage_limit, usage_count, service_slug, cta_text, cta_url, conditions, starts_at, ends_at, is_active, sort_order, kind, created_at, updated_at FROM promotions
       WHERE kind = 'public_campaign'
         AND is_active = true
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY sort_order ASC, created_at DESC`,
  );
  res.json({ success: true, promotions: result });
});

/**
 * GET /api/promotions/admin/all — все акции (включая неактивные) для админки
 */
router.get('/admin/all', requireApiKey, async (req: Request, res: Response) => {
  const kindFilter = req.query['kind'];
  const params: unknown[] = [];
  let whereClause = '';

  if (kindFilter !== undefined && kindFilter !== '') {
    if (typeof kindFilter !== 'string' || !(PROMO_KINDS as readonly string[]).includes(kindFilter)) {
      throw new AppError(400, `Недопустимый kind. Допустимые: ${PROMO_KINDS.join(', ')}`);
    }
    whereClause = 'WHERE kind = $1';
    params.push(kindFilter);
  }

  const result = await db.query(
    `SELECT id, slug, title, description, image_url, discount_percent, discount_amount, original_price, promo_price, promo_code, usage_limit, usage_count, service_slug, cta_text, cta_url, conditions, starts_at, ends_at, is_active, sort_order, kind, created_at, updated_at FROM promotions ${whereClause} ORDER BY sort_order ASC, created_at DESC`,
    params,
  );
  res.json({ success: true, promotions: result });
});

/**
 * GET /api/promotions/:slug — одна акция по slug
 */
router.get('/:slug', async (req: Request, res: Response) => {
  const promo = await db.queryOne(
    `SELECT id, slug, title, description, image_url, discount_percent, discount_amount, original_price, promo_price, promo_code, usage_limit, usage_count, service_slug, cta_text, cta_url, conditions, starts_at, ends_at, is_active, sort_order, kind, created_at, updated_at FROM promotions WHERE slug = $1 AND kind = 'public_campaign' AND is_active = true`,
    [req.params['slug']],
  );
  if (!promo) throw new AppError(404, 'Акция не найдена');
  res.json({ success: true, promotion: promo });
});

/**
 * GET /api/promotions/validate/:code — валидация промокода
 */
router.get('/validate/:code', async (req: Request, res: Response) => {
  const code = (req.params['code'] || '').trim().toUpperCase();
  const serviceSlug = ((req.query['service_slug'] as string) || '').trim() || null;
  if (!code) {
    res.json({ valid: false, error: 'Промокод не указан' });
    return;
  }

  const rows = await db.query(
    `SELECT id, title, discount_percent, discount_amount, trial_days, usage_limit, usage_count, service_slug
       FROM promotions
       WHERE UPPER(promo_code) = $1
         AND is_active = true
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY CASE WHEN service_slug = $2 THEN 0 WHEN service_slug IS NULL THEN 1 ELSE 2 END`,
    [code, serviceSlug],
  );

  if (!rows.length) {
    // Fallback: партнёрские промокоды (таблица partners)
    const partnerDiscount = await getPartnerPromoDiscount(code);
    if (partnerDiscount) {
      res.json({
        valid: true,
        is_partner_code: true,
        partner_name: partnerDiscount.partner_name,
        title: partnerDiscount.discount_percent > 0 ? 'Скидка по промокоду партнёра' : 'Код партнёра',
        discount_percent: partnerDiscount.discount_percent,
        discount_amount: null,
      });
    } else {
      res.json({ valid: false, error: 'Промокод не найден' });
    }
    return;
  }

  const promo = rows[0];

  if (promo.usage_limit && promo.usage_count >= promo.usage_limit) {
    res.json({ valid: false, error: 'Промокод больше не действует' });
    return;
  }

  res.json({
    valid: true,
    title: promo.title,
    discount_percent: promo.discount_percent || null,
    discount_amount: promo.discount_amount ? parseFloat(promo.discount_amount) : null,
    trial_days: promo.trial_days || 0,
    service_slug: promo.service_slug || null,
    variants: rows,
  });
});

// ============================================================================
// Защищённые эндпоинты (X-API-Key)
// ============================================================================

/**
 * POST /api/promotions — создать акцию
 */
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const {
    slug, title, description, image_url,
    discount_percent, discount_amount, original_price, promo_price,
    promo_code, usage_limit, service_slug,
    cta_text, cta_url, conditions,
    starts_at, ends_at, is_active, sort_order, kind,
  } = req.body;

  if (!slug || !title || !description) throw new AppError(400, 'slug, title, description обязательны');

  const promoKind: PromoKind = kind ?? 'public_campaign';
  if (!(PROMO_KINDS as readonly string[]).includes(promoKind)) {
    throw new AppError(400, `Недопустимый kind. Допустимые: ${PROMO_KINDS.join(', ')}`);
  }

  try {
    const result = await db.queryOne(
      `INSERT INTO promotions
        (slug, title, description, image_url,
         discount_percent, discount_amount, original_price, promo_price,
         promo_code, usage_limit, service_slug,
         cta_text, cta_url, conditions,
         starts_at, ends_at, is_active, sort_order, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        slug, title, description, image_url || null,
        discount_percent || null, discount_amount || null, original_price || null, promo_price || null,
        promo_code || null, usage_limit || null, service_slug || null,
        cta_text || 'Подробнее', cta_url || null, conditions || null,
        starts_at || null, ends_at || null,
        is_active !== undefined ? is_active : true,
        sort_order || 0,
        promoKind,
      ],
    );
    res.status(201).json({ success: true, promotion: result });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('duplicate key')) throw new AppError(409, `Акция с slug "${slug}" уже существует`);
    throw error;
  }
});

/**
 * PUT /api/promotions/:id — обновить акцию
 */
router.put('/:id', requireApiKey, async (req: Request, res: Response) => {
  const { id } = req.params;
  const fields = req.body;

  const allowed = [
    'slug', 'title', 'description', 'image_url',
    'discount_percent', 'discount_amount', 'original_price', 'promo_price',
    'promo_code', 'usage_limit', 'service_slug',
    'cta_text', 'cta_url', 'conditions',
    'starts_at', 'ends_at', 'is_active', 'sort_order', 'kind',
  ];

  if ('kind' in fields && !(PROMO_KINDS as readonly string[]).includes(fields['kind'])) {
    throw new AppError(400, `Недопустимый kind. Допустимые: ${PROMO_KINDS.join(', ')}`);
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key} = $${idx++}`);
      values.push(fields[key]);
    }
  }

  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');

  sets.push(`updated_at = NOW()`);
  values.push(id);

  const result = await db.queryOne(
    `UPDATE promotions SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  if (!result) throw new AppError(404, 'Акция не найдена');
  res.json({ success: true, promotion: result });
});

/**
 * DELETE /api/promotions/:id — удалить акцию
 */
router.delete('/:id', requireApiKey, async (req: Request, res: Response) => {
  const deleted = await db.queryOne(
    `DELETE FROM promotions WHERE id = $1 RETURNING id`,
    [req.params['id']],
  );
  if (!deleted) throw new AppError(404, 'Акция не найдена');
  res.json({ success: true });
});

/**
 * PATCH /api/promotions/:id/toggle — вкл/выкл акцию
 */
router.patch('/:id/toggle', requireApiKey, async (req: Request, res: Response) => {
  const result = await db.queryOne(
    `UPDATE promotions SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 RETURNING id, slug, title, is_active`,
    [req.params['id']],
  );
  if (!result) throw new AppError(404, 'Акция не найдена');
  res.json({ success: true, promotion: result });
});

export default router;
