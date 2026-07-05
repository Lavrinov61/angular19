/**
 * SLA Config API — admin UI для настройки estimated_minutes на service_options.
 *
 * GET  /api/crm/sla-config        — список категорий → групп → опций (сгруппированно)
 * PATCH /api/crm/sla-config/:optionId — обновить estimated_minutes для конкретной опции
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, requireUser, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import type { ServiceOptionsId } from '../types/generated/public/ServiceOptions.js';

interface SlaOptionRow {
  category_id: string;
  category_slug: string;
  category_name: string;
  group_id: string;
  group_slug: string;
  group_name: string;
  selection_type: string;
  option_id: ServiceOptionsId;
  option_slug: string;
  option_name: string;
  estimated_minutes: number | null;
  base_price: string;
  is_active: boolean;
}

interface SlaOption {
  id: ServiceOptionsId;
  slug: string;
  name: string;
  estimated_minutes: number | null;
  base_price: string;
}

interface SlaGroup {
  id: string;
  slug: string;
  name: string;
  selection_type: string;
  options: SlaOption[];
}

interface SlaCategory {
  id: string;
  slug: string;
  name: string;
  groups: SlaGroup[];
}

const router = Router();

// All routes require admin
router.use(authenticateToken, requirePermission('settings:manage'));

// ============================================================================
// GET / — сгруппированный список категорий → групп → опций
// ============================================================================
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const rows = await db.query<SlaOptionRow>(
    `SELECT sc.id as category_id, sc.slug as category_slug, sc.name as category_name,
            og.id as group_id, og.slug as group_slug, og.name as group_name, og.selection_type,
            so.id as option_id, so.slug as option_slug, so.name as option_name,
            so.estimated_minutes, so.base_price, so.is_active
     FROM service_options so
     JOIN option_groups og ON og.id = so.option_group_id
     JOIN service_categories sc ON sc.id = og.service_category_id
     WHERE so.is_active = true
     ORDER BY sc.name, og.sort_order, so.sort_order`
  );

  // Group into categories → groups → options
  const categoryMap = new Map<string, SlaCategory>();

  for (const row of rows) {
    let category = categoryMap.get(row.category_id);
    if (!category) {
      category = {
        id: row.category_id,
        slug: row.category_slug,
        name: row.category_name,
        groups: [],
      };
      categoryMap.set(row.category_id, category);
    }

    let group = category.groups.find(g => g.id === row.group_id);
    if (!group) {
      group = {
        id: row.group_id,
        slug: row.group_slug,
        name: row.group_name,
        selection_type: row.selection_type,
        options: [],
      };
      category.groups.push(group);
    }

    group.options.push({
      id: row.option_id,
      slug: row.option_slug,
      name: row.option_name,
      estimated_minutes: row.estimated_minutes,
      base_price: row.base_price,
    });
  }

  res.json({
    success: true,
    data: { categories: [...categoryMap.values()] },
  });
});

// ============================================================================
// PATCH /:optionId — обновить estimated_minutes
// ============================================================================
router.patch('/:optionId', async (req: AuthRequest, res: Response): Promise<void> => {
  requireUser(req);

  const optionId = req.params['optionId'] as ServiceOptionsId;
  const { estimated_minutes } = req.body as { estimated_minutes: unknown };

  if (typeof estimated_minutes !== 'number' || !Number.isInteger(estimated_minutes) || estimated_minutes <= 0) {
    throw new AppError(400, 'estimated_minutes должен быть целым числом > 0');
  }

  const existing = await db.queryOne(
    'SELECT id FROM service_options WHERE id = $1',
    [optionId]
  );
  if (!existing) {
    throw new AppError(404, 'Опция не найдена');
  }

  await db.query(
    'UPDATE service_options SET estimated_minutes = $1, updated_at = NOW() WHERE id = $2',
    [estimated_minutes, optionId]
  );

  res.json({ success: true });
});

export default router;
