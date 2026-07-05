/**
 * Pricing API — конфигуратор опций с DB-driven ценообразованием.
 *
 * Public:  GET /categories, GET /categories/:slug, POST /calculate, POST /validate-selection
 * Admin:   CRUD для категорий, групп, опций, правил, аудит
 */

import { Router, Request, Response } from 'express';
import { AppError } from '../middleware/errorHandler.js';
import { authenticateToken, optionalAuth, requirePermission, type AuthRequest } from '../middleware/auth.js';
import db from '../database/db.js';
import {
  getCategories,
  getCategoryBySlug,
  calculatePrice,
  validateSelection,
  invalidatePricingCache,
  calculatePriceWaterfall,
  resolveSlugsToWaterfallItems,
  getVolumeThresholdHints,
  type PriceWaterfallInput,
} from '../services/pricing-engine.service.js';
import { invalidateAiActionsCache } from '../data/ai-actions.js';
import { getRetouchChecklist } from '../services/retouch-checklist.service.js';
import {
  applyModifiers,
  getCurrentDynamicPrice,
  getMinutesToPriceChange,
  getAllModifiers,
  getDynamicConfig,
  createPriceLock,
  checkPriceLock,
  invalidateModifiersCache,
  type DynamicPriceContext,
} from '../services/dynamic-pricing.service.js';
import {
  getQueueStats,
  calculatePrioritySurcharge,
  purchasePriority,
} from '../services/queue.service.js';
import { resolveCustomerPricingPhone } from '../services/customer-pricing-phone.service.js';
import { hasPermission, type Permission } from '../config/permissions.js';
import type ServiceCategories from '../types/generated/public/ServiceCategories.js';
import type {
  PricingCategorySnapshotFields,
  PricingOptionGroupSnapshotFields,
  PricingServiceOptionSnapshotFields,
} from '../types/jsonb/index.js';
import type {
  OrderTemplateAccessRow,
  PricingOptionGroupWithOptionsRow,
  SubscriptionPlanPriceWarningRow,
  UnusedPriceLockCountRow,
} from '../types/views/pricing-admin-views.js';

const router = Router();

const CATEGORY_CHANGE_FIELDS: readonly (keyof PricingCategorySnapshotFields)[] = [
  'slug', 'name', 'description', 'icon', 'gradient', 'image_url', 'price_range',
  'display_channels', 'sort_order', 'is_active',
];

const OPTION_GROUP_CHANGE_FIELDS: readonly (keyof PricingOptionGroupSnapshotFields)[] = [
  'slug', 'name', 'description', 'selection_type', 'is_required',
  'min_selections', 'max_selections', 'sort_order', 'is_active',
];

const SERVICE_OPTION_CHANGE_FIELDS: readonly (keyof PricingServiceOptionSnapshotFields)[] = [
  'slug', 'name', 'description', 'icon', 'color', 'product_id',
  'base_price', 'price_online', 'price_studio', 'price_next_unit', 'price_max',
  'promo_first_price', 'promo_description', 'features', 'popular',
  'original_price', 'discount_percent', 'satisfies_requires', 'sort_order',
  'is_active',
];

function isStaffRole(role: string | undefined): boolean {
  return role === 'admin' || role === 'employee' || role === 'photographer';
}

function pickChangedFields<T extends object>(body: T, fields: readonly (keyof T)[]): Partial<T> {
  const changedFields: Partial<T> = {};
  for (const key of fields) {
    if (key in body) {
      changedFields[key] = body[key];
    }
  }
  return changedFields;
}

function ensurePricingPermission(req: AuthRequest, permission: Permission): void {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const allowed = req.user.permissions?.includes(permission) ?? hasPermission(req.user.role, permission);
  if (!allowed) throw new AppError(403, 'Недостаточно прав');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

interface ComboPackageItemInput {
  service_option_id?: unknown;
  quantity?: unknown;
  sort_order?: unknown;
}

function isComboPackageItemInput(value: unknown): value is ComboPackageItemInput {
  return typeof value === 'object' && value !== null && 'service_option_id' in value;
}

function numericInput(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumericInput(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface WaterfallCalculateItemBody {
  serviceOptionId?: string;
  service_option_id?: string;
  quantity?: number;
  pricingGroupKey?: string;
  pricing_group_key?: string;
  printFillPercent?: unknown;
  print_fill_percent?: unknown;
  fill_percent?: unknown;
  coverage_percent?: unknown;
}

function printFillPercentInput(item: WaterfallCalculateItemBody): number | undefined {
  return optionalNumericInput(
    item.printFillPercent ?? item.print_fill_percent ?? item.fill_percent ?? item.coverage_percent,
  );
}

// ============================================================================
// Public endpoints
// ============================================================================

/**
 * GET /api/pricing/categories — все категории с опциями и правилами
 */
router.get('/categories', async (req: Request, res: Response) => {
  let categories = await getCategories();
  if (req.query['crm'] === 'true') {
    categories = categories.filter(c => c.crm_orderable);
  }
  res.json({ success: true, categories });
});

/**
 * GET /api/pricing/retouch-checklist — каталог «Супер обработки» (группы + варианты)
 * Публичный (как /categories). Без Redis-кэша (таблица ~110 строк).
 */
router.get('/retouch-checklist', async (_req: Request, res: Response) => {
  const checklist = await getRetouchChecklist();
  res.json({ success: true, checklist });
});

/**
 * GET /api/pricing/categories/:slug — одна категория
 */
router.get('/categories/:slug', async (req: Request, res: Response) => {
  const category = await getCategoryBySlug(req.params['slug']!);
  if (!category) throw new AppError(404, 'Категория не найдена');
  res.json({ success: true, category });
});

/**
 * POST /api/pricing/calculate — расчёт цены от выбранных опций
 */
router.post('/calculate', async (req: Request, res: Response) => {
  const { category_slug, selected_options, delivery_method, channel, is_returning, promo_code, loyalty_points_to_use } = req.body;

  if (!category_slug) throw new AppError(400, 'category_slug обязателен');
  if (!Array.isArray(selected_options) || selected_options.length === 0) {
    throw new AppError(400, 'selected_options должен быть непустым массивом');
  }

  const result = await calculatePrice({
    categorySlug: category_slug,
    selectedOptions: selected_options,
    deliveryMethod: delivery_method,
    channel: channel, // backward compat
    isReturning: is_returning || false,
    promoCode: promo_code,
    loyaltyPointsToUse: loyalty_points_to_use,
  });

  res.json({ success: true, ...result });
});

/**
 * POST /api/pricing/validate-selection — лёгкая валидация комбинации опций
 */
router.post('/validate-selection', async (req: Request, res: Response) => {
  const { category_slug, selected_options } = req.body;

  if (!category_slug) throw new AppError(400, 'category_slug обязателен');

  const result = await validateSelection({
    categorySlug: category_slug,
    selectedOptions: selected_options || [],
  });

  res.json({ success: true, ...result });
});

// ============================================================================
// Admin endpoints (authenticateToken)
// ============================================================================


// --- Категории ---

router.get('/admin/categories', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const categories = await db.query(
    `SELECT * FROM service_categories ORDER BY sort_order`
  );
  res.json({ success: true, categories });
});

router.post('/admin/categories', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const { slug, name, description, icon, gradient, image_url, price_range, display_channels, sort_order } = req.body;
  if (!slug || !name) throw new AppError(400, 'slug и name обязательны');

  const result = await db.queryOne(
    `INSERT INTO service_categories (slug, name, description, icon, gradient, image_url, price_range, display_channels, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [slug, name, description || null, icon || null, gradient || null, image_url || null, price_range || null, display_channels || ['website', 'chatbot', 'pos'], sort_order || 0]
  );
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('service_category', $1, $2, '{}'::jsonb, $3, 'Создание категории')`,
    [result.id, (req as AuthRequest).user?.id || null, JSON.stringify(result)]
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.status(201).json({ success: true, category: result });
});

router.patch('/admin/categories/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  const current = await db.queryOne('SELECT * FROM service_categories WHERE id = $1', [req.params['id']]);
  if (!current) throw new AppError(404, 'Категория не найдена');

  const allowed = CATEGORY_CHANGE_FIELDS;
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in req.body) {
      sets.push(`${key} = $${idx++}`);
      values.push(req.body[key]);
    }
  }
  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');
  sets.push('updated_at = NOW()');
  values.push(req.params['id']);

  const result = await db.queryOne(
    `UPDATE service_categories SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  const changedFields = pickChangedFields<PricingCategorySnapshotFields>(req.body, allowed);
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('service_category', $1, $2, $3, $4, $5)`,
    [req.params['id'], (req as AuthRequest).user?.id || null, JSON.stringify(current), JSON.stringify(changedFields), req.body.reason || 'Обновление категории']
  );

  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({ success: true, category: result });
});

router.delete('/admin/categories/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const result = await db.queryOne(
    `UPDATE service_categories SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params['id']]
  );
  if (!result) throw new AppError(404, 'Категория не найдена');
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('service_category', $1, $2, $3, '{"is_active": false}'::jsonb, 'Удаление категории (soft)')`,
    [req.params['id'], (req as AuthRequest).user?.id || null, JSON.stringify(result)]
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({ success: true });
});

// --- Группы опций ---

/**
 * GET /admin/categories/full — полное дерево (категории → группы → опции), включая неактивные
 */
router.get('/admin/categories/full', authenticateToken, requirePermission('pricing:read'), async (req: AuthRequest, res: Response) => {

  const categories = await db.query<ServiceCategories>(`SELECT * FROM service_categories ORDER BY sort_order`);
  const groups = await db.query<PricingOptionGroupWithOptionsRow>(`
    SELECT
      og.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', so.id,
            'option_group_id', so.option_group_id,
            'slug', so.slug,
            'name', so.name,
            'description', so.description,
            'icon', so.icon,
            'color', so.color,
            'base_price', so.base_price,
            'price_online', so.price_online,
            'price_studio', so.price_studio,
            'price_next_unit', so.price_next_unit,
            'price_max', so.price_max,
            'promo_first_price', so.promo_first_price,
            'promo_description', so.promo_description,
            'features', so.features,
            'popular', so.popular,
            'original_price', so.original_price,
            'discount_percent', so.discount_percent,
            'satisfies_requires', so.satisfies_requires,
            'sort_order', so.sort_order,
            'is_active', so.is_active,
            'product_id', so.product_id
          ) ORDER BY so.sort_order
        ) FILTER (WHERE so.id IS NOT NULL),
        '[]'::json
      ) as options
    FROM option_groups og
    LEFT JOIN service_options so ON so.option_group_id = og.id
    GROUP BY og.id
    ORDER BY og.service_category_id, og.sort_order
  `);

  const groupsByCategory = new Map<string, PricingOptionGroupWithOptionsRow[]>();
  for (const group of groups) {
    const catId = group.service_category_id;
    const categoryGroups = groupsByCategory.get(catId) ?? [];
    categoryGroups.push(group);
    groupsByCategory.set(catId, categoryGroups);
  }

  const tree = categories.map(category => ({
    ...category,
    option_groups: groupsByCategory.get(category.id) ?? [],
  }));

  res.json({ success: true, categories: tree });
});

router.get('/admin/option-groups', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const categoryId = req.query['category_id'] as string | undefined;
  // SAFE: conditions use $n placeholders, values array is separate — no SQL injection risk
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (categoryId) { conditions.push(`service_category_id = $${idx++}`); values.push(categoryId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const groups = await db.query(`SELECT * FROM option_groups ${where} ORDER BY sort_order`, values);
  res.json({ success: true, groups });
});

router.delete('/admin/option-groups/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const result = await db.queryOne(
    `UPDATE option_groups SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params['id']]
  );
  if (!result) throw new AppError(404, 'Группа опций не найдена');
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('option_group', $1, $2, $3, '{"is_active": false}'::jsonb, 'Удаление группы (soft)')`,
    [req.params['id'], (req as AuthRequest).user?.id || null, JSON.stringify(result)]
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({ success: true });
});

router.post('/admin/option-groups', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const { service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order } = req.body;
  if (!service_category_id || !slug || !name) throw new AppError(400, 'service_category_id, slug, name обязательны');

  const result = await db.queryOne(
    `INSERT INTO option_groups (service_category_id, slug, name, description, selection_type, is_required, min_selections, max_selections, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [service_category_id, slug, name, description || null, selection_type || 'single', is_required || false, min_selections || 0, max_selections || 1, sort_order || 0]
  );
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('option_group', $1, $2, '{}'::jsonb, $3, 'Создание группы опций')`,
    [result.id, (req as AuthRequest).user?.id || null, JSON.stringify(result)]
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.status(201).json({ success: true, optionGroup: result });
});

router.patch('/admin/option-groups/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  const current = await db.queryOne('SELECT * FROM option_groups WHERE id = $1', [req.params['id']]);
  if (!current) throw new AppError(404, 'Группа опций не найдена');

  const allowed = OPTION_GROUP_CHANGE_FIELDS;
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in req.body) {
      sets.push(`${key} = $${idx++}`);
      values.push(req.body[key]);
    }
  }
  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');
  sets.push('updated_at = NOW()');
  values.push(req.params['id']);

  const result = await db.queryOne(
    `UPDATE option_groups SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  const changedFields = pickChangedFields<PricingOptionGroupSnapshotFields>(req.body, allowed);
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('option_group', $1, $2, $3, $4, $5)`,
    [req.params['id'], (req as AuthRequest).user?.id || null, JSON.stringify(current), JSON.stringify(changedFields), req.body.reason || 'Обновление группы опций']
  );

  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({ success: true, optionGroup: result });
});

// --- Опции ---

router.post('/admin/options', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const {
    option_group_id, product_id, slug, name, description, icon, color,
    base_price, price_online, price_studio, price_next_unit, price_max,
    promo_first_price, promo_description,
    features, popular, original_price, discount_percent, sort_order,
  } = req.body;

  if (!option_group_id || !slug || !name || base_price == null) {
    throw new AppError(400, 'option_group_id, slug, name, base_price обязательны');
  }

  // Записать snapshot старых значений (для новой опции — пустой)
  const result = await db.queryOne(
    `INSERT INTO service_options
      (option_group_id, product_id, slug, name, description, icon, color,
       base_price, price_online, price_studio, price_next_unit, price_max,
       promo_first_price, promo_description,
       features, popular, original_price, discount_percent, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      option_group_id, product_id || null, slug, name, description || null, icon || null, color || null,
      base_price, price_online ?? null, price_studio ?? null, price_next_unit ?? null, price_max ?? null,
      promo_first_price ?? null, promo_description || null,
      JSON.stringify(features || []), popular || false, original_price ?? null, discount_percent ?? null, sort_order || 0,
    ]
  );

  // Аудит
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('service_option', $1, $2, '{}'::jsonb, $3, 'Создание опции')`,
    [result.id, (req as AuthRequest).user?.id || null, JSON.stringify(result)]
  );

  // Синхронизировать с products.sell_price если связана
  if (result.product_id) {
    await db.query(
      `UPDATE products SET sell_price = $1, updated_at = NOW() WHERE id = $2`,
      [base_price, result.product_id]
    );
  }

  invalidatePricingCache();
  invalidateAiActionsCache();
  res.status(201).json({ success: true, option: result });
});

router.patch('/admin/options/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  // Получить текущие значения для snapshot
  const current = await db.queryOne('SELECT * FROM service_options WHERE id = $1', [req.params['id']]);
  if (!current) throw new AppError(404, 'Опция не найдена');

  const allowed = SERVICE_OPTION_CHANGE_FIELDS;
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in req.body) {
      const val = key === 'features' ? JSON.stringify(req.body[key]) : req.body[key];
      sets.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }
  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');
  sets.push('updated_at = NOW()');
  values.push(req.params['id']);

  const result = await db.queryOne(
    `UPDATE service_options SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  // Аудит
  const changedFields = pickChangedFields<PricingServiceOptionSnapshotFields>(req.body, allowed);
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('service_option', $1, $2, $3, $4, $5)`,
    [
      req.params['id'],
      (req as AuthRequest).user?.id || null,
      JSON.stringify(current),
      JSON.stringify(changedFields),
      req.body.reason || 'Обновление опции',
    ]
  );

  // Синхронизировать с products.sell_price
  const productId = result.product_id || current.product_id;
  if (productId && 'base_price' in req.body) {
    await db.query(
      `UPDATE products SET sell_price = $1, updated_at = NOW() WHERE id = $2`,
      [req.body.base_price, productId]
    );
  }

  // 6.3 Subscription warning: проверить активные подписки при смене цены
  const subscriptionWarnings: Array<{ plan_name: string; active_subscriptions: number; locked_price: number }> = [];
  const priceChanged = ['base_price', 'price_online', 'price_studio'].some((f) => f in req.body);
  if (productId && priceChanged) {
    const affected = await db.query<SubscriptionPlanPriceWarningRow>(
      `SELECT sp.name AS plan_name, COUNT(us.id) AS active_count, spi.credit_price
       FROM subscription_plan_items spi
       JOIN subscription_plans sp ON spi.plan_id = sp.id
       LEFT JOIN user_subscriptions us ON us.plan_id = sp.id AND us.status = 'active'
       WHERE spi.product_id = $1
       GROUP BY sp.name, spi.credit_price
       HAVING COUNT(us.id) > 0`,
      [productId]
    );
    for (const row of affected) {
      subscriptionWarnings.push({
        plan_name: row.plan_name,
        active_subscriptions: parseInt(row.active_count),
        locked_price: parseFloat(row.credit_price),
      });
    }
  }

  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({
    success: true,
    option: result,
    ...(subscriptionWarnings.length > 0 && { subscription_warnings: subscriptionWarnings }),
  });
});

router.get('/admin/options', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const groupId = req.query['group_id'] as string | undefined;
  // SAFE: conditions use $n placeholders, values array is separate — no SQL injection risk
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (groupId) { conditions.push(`option_group_id = $${idx++}`); values.push(groupId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const options = await db.query(`SELECT * FROM service_options ${where} ORDER BY sort_order`, values);
  res.json({ success: true, options });
});

router.delete('/admin/options/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const current = await db.queryOne('SELECT * FROM service_options WHERE id = $1', [req.params['id']]);
  if (!current) throw new AppError(404, 'Опция не найдена');
  await db.query(`UPDATE service_options SET is_active = false, updated_at = NOW() WHERE id = $1`, [req.params['id']]);
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('service_option', $1, $2, $3, '{"is_active": false}'::jsonb, 'Удаление опции (soft)')`,
    [req.params['id'], (req as AuthRequest).user?.id || null, JSON.stringify(current)]
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({ success: true });
});

// --- Правила ---

router.get('/admin/rules', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const categoryId = req.query['category_id'] as string | undefined;
  // SAFE: conditions use $n placeholders, values array is separate — no SQL injection risk
  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;
  if (categoryId) { conditions.push(`r.service_category_id = $${idx++}`); values.push(categoryId); }
  const rules = await db.query(
    `SELECT r.*,
       src.slug as source_option_slug, src.name as source_option_name,
       tgt.slug as target_option_slug, tgt.name as target_option_name
     FROM option_rules r
     LEFT JOIN service_options src ON r.source_option_id = src.id
     LEFT JOIN service_options tgt ON r.target_option_id = tgt.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC`,
    values
  );
  res.json({ success: true, rules });
});

router.post('/admin/rules', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const { service_category_id, rule_type, source_option_id, target_option_id, override_price, description } = req.body;
  if (!service_category_id || !rule_type || !source_option_id || !target_option_id) {
    throw new AppError(400, 'service_category_id, rule_type, source_option_id, target_option_id обязательны');
  }

  const result = await db.queryOne(
    `INSERT INTO option_rules (service_category_id, rule_type, source_option_id, target_option_id, override_price, description)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [service_category_id, rule_type, source_option_id, target_option_id, override_price ?? null, description || null]
  );
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('option_rule', $1, $2, '{}'::jsonb, $3, 'Создание правила')`,
    [result.id, (req as AuthRequest).user?.id || null, JSON.stringify(result)]
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.status(201).json({ success: true, rule: result });
});

router.patch('/admin/rules/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const current = await db.queryOne('SELECT * FROM option_rules WHERE id = $1', [req.params['id']]);
  if (!current) throw new AppError(404, 'Правило не найдено');

  const allowed = ['rule_type', 'source_option_id', 'target_option_id', 'override_price', 'description', 'is_active'];
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const key of allowed) {
    if (key in req.body) { sets.push(`${key} = $${idx++}`); values.push(req.body[key]); }
  }
  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');
  values.push(req.params['id']);

  const result = await db.queryOne(
    `UPDATE option_rules SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('option_rule', $1, $2, $3, $4, $5)`,
    [req.params['id'], (req as AuthRequest).user?.id || null, JSON.stringify(current), JSON.stringify(req.body), req.body.reason || 'Обновление правила']
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({ success: true, rule: result });
});

router.delete('/admin/rules/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const result = await db.queryOne(
    `UPDATE option_rules SET is_active = false WHERE id = $1 RETURNING *`,
    [req.params['id']]
  );
  if (!result) throw new AppError(404, 'Правило не найдено');
  await db.query(
    `INSERT INTO pricing_snapshots (entity_type, entity_id, changed_by, old_values, new_values, reason)
     VALUES ('option_rule', $1, $2, $3, '{"is_active": false}'::jsonb, 'Удаление правила (soft)')`,
    [req.params['id'], (req as AuthRequest).user?.id || null, JSON.stringify(result)]
  );
  invalidatePricingCache();
  invalidateAiActionsCache();
  res.json({ success: true });
});

// ============================================================================
// Dynamic Pricing — Public endpoints
// ============================================================================

/**
 * POST /api/pricing/calculate-dynamic — расчёт с динамическими модификаторами
 */
router.post('/calculate-dynamic', async (req: Request, res: Response) => {
  const {
    category_slug, selected_options, delivery_method, channel,
    is_returning, promo_code, loyalty_points_to_use,
    payment_time, loyalty_level, is_subscriber, bundle_count, slot_date,
  } = req.body;

  if (!category_slug) throw new AppError(400, 'category_slug обязателен');
  if (!Array.isArray(selected_options) || selected_options.length === 0) {
    throw new AppError(400, 'selected_options обязателен');
  }

  // Базовый расчёт
  const baseResult = await calculatePrice({
    categorySlug: category_slug,
    selectedOptions: selected_options,
    deliveryMethod: delivery_method,
    channel,
    isReturning: is_returning || false,
    promoCode: promo_code,
    loyaltyPointsToUse: loyalty_points_to_use,
  });

  // Динамические модификаторы
  const context: DynamicPriceContext = {
    paymentTime: payment_time ? new Date(payment_time) : new Date(),
    loyaltyLevel: loyalty_level,
    isSubscriber: is_subscriber,
    categorySlug: category_slug,
    bundleCount: bundle_count || selected_options.length,
    slotDate: slot_date ? new Date(slot_date) : undefined,
  };

  const dynamicResult = await applyModifiers(baseResult.breakdown.total, context);

  const minutesToChange = await getMinutesToPriceChange();

  res.json({
    success: true,
    ...baseResult,
    dynamic: {
      base_price: dynamicResult.basePrice,
      final_price: dynamicResult.finalPrice,
      total_discount: dynamicResult.totalDiscount,
      discount_percent: dynamicResult.discountPercent,
      applied_modifiers: dynamicResult.appliedModifiers,
      reasons: dynamicResult.reasons,
      minutes_to_price_change: minutesToChange,
    },
  });
});

/**
 * GET /api/pricing/current-price/:categorySlug — текущая цена для live-виджета
 * Принимает base_price как query param.
 */
router.get('/current-price/:categorySlug', async (req: Request, res: Response) => {
  const categorySlug = req.params['categorySlug']!;
  const basePrice = parseFloat(req.query['base_price'] as string || '0');
  const loyaltyLevel = parseInt(req.query['loyalty_level'] as string || '0') || undefined;
  const isSubscriber = req.query['is_subscriber'] === 'true';

  if (!basePrice || isNaN(basePrice)) {
    throw new AppError(400, 'base_price обязателен (число)');
  }

  const context: DynamicPriceContext = {
    paymentTime: new Date(),
    loyaltyLevel,
    isSubscriber,
    categorySlug,
  };

  const result = await getCurrentDynamicPrice(basePrice, context);
  const minutesToChange = await getMinutesToPriceChange();

  res.json({
    success: true,
    category_slug: categorySlug,
    base_price: basePrice,
    current_price: result.finalPrice,
    discount_percent: result.discountPercent,
    total_discount: result.totalDiscount,
    reasons: result.reasons,
    minutes_to_price_change: minutesToChange,
    applied_modifiers: result.appliedModifiers,
  });
});

/**
 * POST /api/pricing/lock-price — создать price lock на 24ч
 */
router.post('/lock-price', async (req: Request, res: Response) => {
  const { visitor_id, user_id, category_slug, current_price } = req.body;

  if (!category_slug) throw new AppError(400, 'category_slug обязателен');
  if (!current_price || isNaN(parseFloat(current_price))) {
    throw new AppError(400, 'current_price обязателен');
  }
  if (!visitor_id && !user_id) {
    throw new AppError(400, 'visitor_id или user_id обязателен');
  }

  const lock = await createPriceLock({
    visitorId: visitor_id,
    userId: user_id,
    categorySlug: category_slug,
    currentPrice: parseFloat(current_price),
  });

  res.json({ success: true, lock });
});

/**
 * GET /api/pricing/lock-status — проверить активный lock
 */
router.get('/lock-status', async (req: Request, res: Response) => {
  const visitorId = req.query['visitor_id'] as string | undefined;
  const userId = req.query['user_id'] as string | undefined;
  const categorySlug = req.query['category_slug'] as string | undefined;

  if (!categorySlug) throw new AppError(400, 'category_slug обязателен');
  if (!visitorId && !userId) throw new AppError(400, 'visitor_id или user_id обязателен');

  const lock = await checkPriceLock({ visitorId, userId, categorySlug });

  res.json({ success: true, lock: lock || null });
});

/**
 * POST /api/pricing/priority-quote — стоимость прыжка в очереди
 */
router.post('/priority-quote', async (req: Request, res: Response) => {
  const { order_id, desired_position } = req.body;

  if (!order_id) throw new AppError(400, 'order_id обязателен');
  if (!desired_position || desired_position < 1) {
    throw new AppError(400, 'desired_position обязателен (>= 1)');
  }

  const quote = await calculatePrioritySurcharge(order_id, parseInt(desired_position));
  res.json({ success: true, ...quote });
});

/**
 * POST /api/pricing/priority-purchase — покупка приоритета (MVP: без оплаты)
 */
router.post('/priority-purchase', async (req: Request, res: Response) => {
  const { order_id, desired_position, surcharge_amount, payment_id } = req.body;

  if (!order_id) throw new AppError(400, 'order_id обязателен');
  if (!desired_position || desired_position < 1) {
    throw new AppError(400, 'desired_position обязателен');
  }
  if (surcharge_amount == null) throw new AppError(400, 'surcharge_amount обязателен');

  await purchasePriority({
    orderId: order_id,
    desiredPosition: parseInt(desired_position),
    surchargeAmount: parseFloat(surcharge_amount),
    paymentId: payment_id,
  });

  res.json({ success: true, message: 'Приоритет обновлён, очередь пересчитана' });
});

// ============================================================================
// Dynamic Pricing — Admin endpoints
// ============================================================================

/**
 * GET /api/pricing/admin/modifiers — список модификаторов
 */
router.get('/admin/modifiers', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const modifiers = await getAllModifiers();
  res.json({ success: true, modifiers });
});

/**
 * POST /api/pricing/admin/modifiers — создать модификатор
 */
router.post('/admin/modifiers', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  const {
    name, modifier_type, scope, service_category_id,
    modifier_action, modifier_value, conditions, priority,
    starts_at, ends_at,
  } = req.body;

  if (!name || !modifier_type || !modifier_action || modifier_value == null) {
    throw new AppError(400, 'name, modifier_type, modifier_action, modifier_value обязательны');
  }

  const result = await db.queryOne(
    `INSERT INTO price_modifiers
      (name, modifier_type, scope, service_category_id, modifier_action, modifier_value, conditions, priority, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      name, modifier_type, scope || 'global', service_category_id || null,
      modifier_action, parseFloat(modifier_value),
      JSON.stringify(conditions || {}), priority || 5,
      starts_at || null, ends_at || null,
    ]
  );

  invalidateModifiersCache();
  res.status(201).json({ success: true, modifier: result });
});

/**
 * PATCH /api/pricing/admin/modifiers/:id — обновить модификатор
 */
router.patch('/admin/modifiers/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  const allowed = [
    'name', 'modifier_type', 'scope', 'service_category_id',
    'modifier_action', 'modifier_value', 'conditions', 'priority',
    'starts_at', 'ends_at', 'is_active',
  ];
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in req.body) {
      const val = key === 'conditions' ? JSON.stringify(req.body[key]) : req.body[key];
      sets.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }
  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');
  sets.push('updated_at = NOW()');
  values.push(req.params['id']);

  const result = await db.queryOne(
    `UPDATE price_modifiers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!result) throw new AppError(404, 'Модификатор не найден');

  invalidateModifiersCache();
  res.json({ success: true, modifier: result });
});

/**
 * DELETE /api/pricing/admin/modifiers/:id — удалить (soft) модификатор
 */
router.delete('/admin/modifiers/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  const result = await db.queryOne(
    `UPDATE price_modifiers SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params['id']]
  );
  if (!result) throw new AppError(404, 'Модификатор не найден');

  invalidateModifiersCache();
  res.json({ success: true });
});

/**
 * GET /api/pricing/admin/dynamic-config — конфиг dynamic pricing
 */
router.get('/admin/dynamic-config', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const config = await getDynamicConfig();
  res.json({ success: true, config });
});

/**
 * PATCH /api/pricing/admin/dynamic-config/:key — обновить конфиг
 */
router.patch('/admin/dynamic-config/:key', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  const { config_value } = req.body;
  if (!config_value) throw new AppError(400, 'config_value обязателен');

  const result = await db.queryOne(
    `UPDATE dynamic_pricing_config
     SET config_value = $1, updated_by = $2, updated_at = NOW()
     WHERE config_key = $3
     RETURNING *`,
    [JSON.stringify(config_value), (req as AuthRequest).user?.id || null, req.params['key']]
  );
  if (!result) throw new AppError(404, 'Ключ конфига не найден');

  invalidateModifiersCache();
  res.json({ success: true, config: result });
});

/**
 * GET /api/pricing/admin/dynamic-stats — статистика очереди и динамики
 */
router.get('/admin/dynamic-stats', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {

  const [queueStats, locksResult] = await Promise.all([
    getQueueStats(),
    db.queryOne<UnusedPriceLockCountRow>(
      `SELECT COUNT(*) as count FROM price_locks WHERE used = false AND expires_at > NOW()`
    ),
  ]);

  res.json({
    success: true,
    queue: queueStats,
    active_locks: parseInt(locksResult?.count || '0'),
  });
});

// --- Аудит ---

router.get('/admin/audit', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const limit = Math.min(parseInt(String(req.query['limit'])) || 50, 200);
  const offset = parseInt(String(req.query['offset'])) || 0;
  const entityType = req.query['entity_type'] as string | undefined;

  const conditions = ['1=1'];
  const values: unknown[] = [];
  let idx = 1;

  if (entityType) {
    conditions.push(`ps.entity_type = $${idx++}`);
    values.push(entityType);
  }

  values.push(limit, offset);
  const snapshots = await db.query(
    `SELECT ps.*, u.email as changed_by_email
     FROM pricing_snapshots ps
     LEFT JOIN users u ON ps.changed_by = u.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY ps.created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    values
  );
  res.json({ success: true, snapshots });
});

// ───────────── Order Templates (F57) ─────────────

/** GET /api/pricing/templates — personal + shared templates */
router.get('/templates', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const templates = await db.query(
    `SELECT id, name, icon, description, scope, option_slugs, usage_count, sort_order, created_by
       FROM order_templates
      WHERE is_active
        AND (scope = 'shared' OR created_by = $1)
      ORDER BY sort_order, usage_count DESC, name`,
    [req.user.id],
  );
  res.json({ success: true, templates });
});

/** POST /api/pricing/templates — create template */
router.post('/templates', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const body = req.body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon : 'bookmark';
  const description = typeof body.description === 'string' ? body.description : null;
  const optionSlugs = body.option_slugs;
  const effectiveScope = body.scope === 'shared' ? 'shared' : 'personal';

  if (!name) throw new AppError(400, 'Name is required');
  if (!isStringArray(optionSlugs) || optionSlugs.length === 0) {
    throw new AppError(400, 'At least one option slug is required');
  }

  if (effectiveScope === 'shared') {
    ensurePricingPermission(req, 'pricing:manage');
  }

  const created = await db.query(
    `INSERT INTO order_templates (name, icon, description, created_by, scope, option_slugs)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, icon, description, scope, option_slugs, usage_count, sort_order, created_by`,
    [name, icon, description, req.user.id, effectiveScope, optionSlugs],
  );
  res.status(201).json({ success: true, template: created[0] });
});

/** PATCH /api/pricing/templates/:id — update template */
router.patch('/templates/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const id = req.params['id'];
  const existing = await db.query<OrderTemplateAccessRow>(
    `SELECT id, created_by, scope FROM order_templates WHERE id = $1 AND is_active`,
    [id],
  );
  if (existing.length === 0) throw new AppError(404, 'Template not found');

  const tpl = existing[0];
  if (tpl.created_by !== req.user.id && tpl.scope === 'personal') {
    throw new AppError(403, 'Cannot edit another user\'s personal template');
  }
  if (tpl.scope === 'shared') {
    ensurePricingPermission(req, 'pricing:manage');
  }

  const body = req.body;
  const name = typeof body.name === 'string' ? body.name : undefined;
  const icon = typeof body.icon === 'string' ? body.icon : undefined;
  const description = typeof body.description === 'string' ? body.description : undefined;
  const optionSlugs = isStringArray(body.option_slugs) ? body.option_slugs : undefined;
  const sortOrder = typeof body.sort_order === 'number' && Number.isFinite(body.sort_order)
    ? body.sort_order
    : undefined;

  if ('option_slugs' in body && optionSlugs === undefined) {
    throw new AppError(400, 'option_slugs must be a string array');
  }
  if ('sort_order' in body && sortOrder === undefined) {
    throw new AppError(400, 'sort_order must be a number');
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined) { sets.push(`name = $${idx++}`); values.push(name.trim()); }
  if (icon !== undefined) { sets.push(`icon = $${idx++}`); values.push(icon); }
  if (description !== undefined) { sets.push(`description = $${idx++}`); values.push(description); }
  if (optionSlugs !== undefined) { sets.push(`option_slugs = $${idx++}`); values.push(optionSlugs); }
  if (sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); values.push(sortOrder); }

  if (sets.length === 0) throw new AppError(400, 'Nothing to update');

  sets.push(`updated_at = now()`);
  values.push(id);

  const updated = await db.query(
    `UPDATE order_templates SET ${sets.join(', ')} WHERE id = $${idx} AND is_active
     RETURNING id, name, icon, description, scope, option_slugs, usage_count, sort_order, created_by`,
    values,
  );
  res.json({ success: true, template: updated[0] });
});

/** DELETE /api/pricing/templates/:id — soft delete */
router.delete('/templates/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const id = req.params['id'];
  const existing = await db.query(
    `SELECT id, created_by, scope FROM order_templates WHERE id = $1 AND is_active`,
    [id],
  );
  if (existing.length === 0) throw new AppError(404, 'Template not found');

  const tpl = existing[0];
  if (tpl.created_by !== req.user.id && tpl.scope === 'personal') {
    throw new AppError(403, 'Cannot delete another user\'s personal template');
  }
  if (tpl.scope === 'shared' && req.user.role !== 'admin' && req.user.role !== 'manager') {
    throw new AppError(403, 'Only admin/manager can delete shared templates');
  }

  await db.query(`UPDATE order_templates SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
  res.json({ success: true });
});

/** POST /api/pricing/templates/:id/use — increment usage counter */
router.post('/templates/:id/use', authenticateToken, async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  await db.query(
    `UPDATE order_templates SET usage_count = usage_count + 1, last_used_at = now() WHERE id = $1 AND is_active`,
    [req.params['id']],
  );
  res.json({ success: true });
});

// ============================================================================
// v2 Price Waterfall — полный расчёт с дегрессией, подпиской, volume, промо, лояльностью
// ============================================================================

/**
 * POST /api/pricing/v2/calculate
 * Body: { items: [{ serviceOptionId, quantity, printFillPercent? }], customerId?, customerPhone?, channel, promoCode?, loyaltyPointsToUse? }
 * Response: { items, total, waterfall, discounts }
 */
router.post('/v2/calculate', optionalAuth, async (req: AuthRequest, res: Response) => {
  const {
    items,
    customer_id,
    customer_phone,
    customer_email,
    channel,
    promo_code,
    loyalty_points_to_use,
    loyalty_profile_id,
    apply_volume_discount,
    client_user_id,
    client_contact_id,
  } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError(400, 'items должен быть непустым массивом [{ serviceOptionId, quantity }]');
  }
  if (!channel || !['pos', 'online', 'crm'].includes(channel)) {
    throw new AppError(400, 'channel обязателен: pos | online | crm');
  }

  const hasClientIdentity = typeof client_user_id === 'string' || typeof client_contact_id === 'string';
  if (hasClientIdentity && !isStaffRole(req.user?.role)) {
    throw new AppError(403, 'client identity pricing доступен только сотрудникам');
  }
  const customerPhone = await resolveCustomerPricingPhone({
    phone: typeof customer_phone === 'string' ? customer_phone : null,
    clientUserId: typeof client_user_id === 'string' ? client_user_id : null,
    clientContactId: typeof client_contact_id === 'string' ? client_contact_id : null,
  });

  const input: PriceWaterfallInput = {
    items: items.map((i: WaterfallCalculateItemBody) => {
      const printFillPercent = printFillPercentInput(i);
      return {
        serviceOptionId: i.serviceOptionId || i.service_option_id || '',
        quantity: i.quantity || 1,
        pricingGroupKey: i.pricingGroupKey || i.pricing_group_key || undefined,
        ...(printFillPercent !== undefined ? { printFillPercent } : {}),
      };
    }),
    customerId: customer_id,
    customerPhone: customerPhone ?? undefined,
    customerEmail: customer_email,
    channel,
    promoCode: promo_code,
    loyaltyPointsToUse: loyalty_points_to_use,
    loyaltyProfileId: loyalty_profile_id,
    applyVolumeDiscount: apply_volume_discount,
  };

  const result = await calculatePriceWaterfall(input);

  res.json({
    success: true,
    items: result.items,
    subtotal: result.subtotal,
    total: result.total,
    savings: result.savings,
    waterfall: result.waterfall,
    isReturning: result.isReturning,
    adjustments: result.priceAdjustments,
    discounts: {
      account: result.accountDiscount,
      subscriber: result.subscriberDiscount,
      student: result.studentDiscount,
      loyalty: result.loyaltyDiscount,
      promo: result.promoDiscount,
    },
    promoBlocked: result.promoBlocked || undefined,
    promoBlockedReason: result.promoBlockedReason || undefined,
    detectedCombos: result.detectedCombos,
  });
});

/**
 * POST /api/pricing/v2/calculate-by-slugs
 * Bridge: принимает categorySlug + selectedOptions (slug-based, как chat flow),
 * конвертирует в serviceOptionId и вызывает полный waterfall v2.
 *
 * Body: { category_slug, selected_options: Record<groupSlug, slug[]>, photo_count?,
 *         channel?, customer_phone?, promo_code?, loyalty_points_to_use? }
 */
router.post('/v2/calculate-by-slugs', async (req: Request, res: Response) => {
  const {
    category_slug, selected_options, photo_count,
    channel = 'online', customer_id, customer_phone, customer_email,
    promo_code, loyalty_points_to_use, loyalty_profile_id,
  } = req.body;

  if (!category_slug || typeof category_slug !== 'string') {
    throw new AppError(400, 'category_slug обязателен');
  }
  if (!selected_options || typeof selected_options !== 'object') {
    throw new AppError(400, 'selected_options обязателен (Record<groupSlug, slug[]>)');
  }

  const items = await resolveSlugsToWaterfallItems({
    categorySlug: category_slug,
    selectedOptions: selected_options,
    photoCount: photo_count ?? 1,
  });

  if (items.length === 0) {
    throw new AppError(400, 'Не удалось разрешить опции — проверьте category_slug и selected_options');
  }

  const input: PriceWaterfallInput = {
    items,
    customerId: customer_id,
    customerPhone: customer_phone,
    customerEmail: customer_email,
    channel: ['pos', 'online', 'crm'].includes(channel) ? channel : 'online',
    promoCode: promo_code,
    loyaltyPointsToUse: loyalty_points_to_use,
    loyaltyProfileId: loyalty_profile_id,
  };

  const result = await calculatePriceWaterfall(input);

  res.json({
    success: true,
    items: result.items,
    subtotal: result.subtotal,
    total: result.total,
    savings: result.savings,
    waterfall: result.waterfall,
    isReturning: result.isReturning,
    adjustments: result.priceAdjustments,
    discounts: {
      account: result.accountDiscount,
      subscriber: result.subscriberDiscount,
      student: result.studentDiscount,
      loyalty: result.loyaltyDiscount,
      promo: result.promoDiscount,
    },
    promoBlocked: result.promoBlocked || undefined,
    promoBlockedReason: result.promoBlockedReason || undefined,
    detectedCombos: result.detectedCombos,
  });
});

// ============================================================================
// Volume Threshold Hints — F122: "ещё N шт до скидки X%"
// ============================================================================

/**
 * GET /api/pricing/volume-hints?service_option_id=...&current_qty=...
 * Возвращает подсказку о следующем пороге volume-скидки.
 */
router.get('/volume-hints', async (req: Request, res: Response) => {
  const serviceOptionId = req.query['service_option_id'] as string | undefined;
  const serviceCategoryId = req.query['service_category_id'] as string | undefined;
  const currentQty = parseInt(req.query['current_qty'] as string, 10) || 0;

  if (!serviceOptionId && !serviceCategoryId) {
    throw new AppError(400, 'service_option_id или service_category_id обязателен');
  }

  const hint = await getVolumeThresholdHints({
    serviceOptionId,
    serviceCategoryId,
    currentQty,
  });

  res.json({ success: true, hint });
});

// ============================================================================
// Combo Packages — bundled service offers with discount (F102)
// ============================================================================

import {
  getActiveCombos,
  detectCombos,
} from '../services/combo-packages.service.js';

/**
 * GET /api/pricing/combos — список активных combo packages с items
 */
router.get('/combos', async (req: Request, res: Response) => {
  const combos = await getActiveCombos();
  res.json({ success: true, combos });
});

/**
 * POST /api/pricing/combos/detect — обнаружить combo packages для набора опций
 * Body: { option_ids: string[] }
 */
router.post('/combos/detect', async (req: Request, res: Response) => {
  const { option_ids } = req.body;
  if (!Array.isArray(option_ids)) {
    throw new AppError(400, 'option_ids должен быть массивом UUID');
  }
  const detected = await detectCombos(option_ids);
  res.json({ success: true, detected });
});

/**
 * POST /api/pricing/admin/combos — создать combo package
 */
router.post('/admin/combos', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const { slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order, items } = req.body;
  if (!slug || !name || combo_price == null) {
    throw new AppError(400, 'slug, name, combo_price обязательны');
  }

  const combo = await db.queryOne<Pick<import('../types/generated/public/ComboPackages.js').default, 'id'>>(
    `INSERT INTO combo_packages (slug, name, description, combo_price, original_total, savings_label, display_channels, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [slug, name, description || null, combo_price, original_total || null, savings_label || null, display_channels || ['crm', 'pos'], sort_order || 0]
  );

  if (Array.isArray(items) && items.length > 0 && combo) {
    for (const item of items) {
      if (!isComboPackageItemInput(item) || typeof item.service_option_id !== 'string') {
        throw new AppError(400, 'combo item service_option_id обязателен');
      }
      await db.query(
        `INSERT INTO combo_package_items (combo_package_id, service_option_id, quantity, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [combo.id, item.service_option_id, numericInput(item.quantity, 1), numericInput(item.sort_order, 0)]
      );
    }
  }

  invalidatePricingCache();
  res.status(201).json({ success: true, combo });
});

/**
 * PATCH /api/pricing/admin/combos/:id — обновить combo package
 */
router.patch('/admin/combos/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const current = await db.queryOne('SELECT * FROM combo_packages WHERE id = $1', [req.params['id']]);
  if (!current) throw new AppError(404, 'Combo package не найден');

  const allowed = ['slug', 'name', 'description', 'combo_price', 'original_total', 'savings_label', 'display_channels', 'sort_order', 'is_active'];
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in req.body) {
      sets.push(`${key} = $${idx++}`);
      values.push(req.body[key]);
    }
  }
  if (sets.length === 0) throw new AppError(400, 'Нет полей для обновления');
  sets.push('updated_at = NOW()');
  values.push(req.params['id']);

  const result = await db.queryOne(
    `UPDATE combo_packages SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  invalidatePricingCache();
  res.json({ success: true, combo: result });
});

/**
 * DELETE /api/pricing/admin/combos/:id — soft delete (is_active = false)
 */
router.delete('/admin/combos/:id', authenticateToken, requirePermission('pricing:manage'), async (req: AuthRequest, res: Response) => {
  const result = await db.queryOne(
    `UPDATE combo_packages SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [req.params['id']]
  );
  if (!result) throw new AppError(404, 'Combo package не найден');

  invalidatePricingCache();
  res.json({ success: true });
});

export default router;
