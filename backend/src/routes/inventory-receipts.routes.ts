import { Router, Response } from 'express';
import db from '../database/db.js';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

router.use(authenticateToken, requirePermission('pos:use'));

// POST /api/inventory/receive — приёмка товара
router.post('/receive', async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  const { supplier, invoice_number, items, notes, studio_id } = req.body;

  if (!items?.length || !studio_id) {
    throw new AppError(400, 'items and studio_id are required');
  }

  // Валидация items
  for (const item of items) {
    if (!item.product_id || !item.quantity || item.quantity <= 0) {
      throw new AppError(400, 'Каждый элемент должен иметь product_id и quantity > 0');
    }
  }

  await db.transaction(async (client) => {
    // 1. Создать запись приёмки
    await client.query(
      `INSERT INTO inventory_receipts
         (employee_id, studio_id, supplier, invoice_number, items, total_items, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        req.user!.id,
        studio_id,
        supplier ?? null,
        invoice_number ?? null,
        JSON.stringify(items),
        items.length,
        notes ?? null,
      ]
    );

    // 2. Обновить stock для каждого товара
    for (const item of items) {
      if (item.condition === 'damaged') continue; // Бракованное не добавляем в stock

      await client.query(
        `INSERT INTO product_stock (product_id, studio_id, quantity, min_quantity)
         VALUES ($1, $2, $3, 0)
         ON CONFLICT (product_id, studio_id)
         DO UPDATE SET
           quantity = product_stock.quantity + $3,
           updated_at = NOW()`,
        [item.product_id, studio_id, item.quantity]
      );
    }
  });

  res.status(201).json({ success: true });
});

// GET /api/inventory/receipts — история приёмок
router.get('/receipts', async (req: AuthRequest, res: Response) => {
  const studioId = req.query['studio_id'] as string | undefined;
  const dateFrom = req.query['date_from'] as string | undefined;
  const dateTo = req.query['date_to'] as string | undefined;
  const limit = parseInt(req.query['limit'] as string || '50', 10);
  const offset = parseInt(req.query['offset'] as string || '0', 10);

  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (studioId) { conditions.push(`ir.studio_id = $${idx++}`); params.push(studioId); }
  if (dateFrom) { conditions.push(`ir.received_at >= $${idx++}`); params.push(dateFrom); }
  if (dateTo) { conditions.push(`ir.received_at < $${idx++}`); params.push(dateTo); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [receipts, countResult] = await Promise.all([
    db.query(
      `SELECT ir.*, u.display_name as employee_name, s.name as studio_name
       FROM inventory_receipts ir
       JOIN users u ON ir.employee_id = u.id
       JOIN studios s ON ir.studio_id = s.id
       ${where}
       ORDER BY ir.received_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM inventory_receipts ir ${where}`,
      params
    ),
  ]);

  res.json({
    success: true,
    receipts,
    total: parseInt(countResult?.count || '0', 10),
  });
});

// GET /api/inventory/receipts/:id — детали приёмки
router.get('/receipts/:id', async (req: AuthRequest, res: Response) => {
  const receipt = await db.queryOne(
    `SELECT ir.*, u.display_name as employee_name, s.name as studio_name
     FROM inventory_receipts ir
     JOIN users u ON ir.employee_id = u.id
     JOIN studios s ON ir.studio_id = s.id
     WHERE ir.id = $1`,
    [req.params['id']]
  );
  if (!receipt) throw new AppError(404, 'Receipt not found');
  res.json({ success: true, receipt });
});

// GET /api/inventory/low-stock/:studioId — товары с низким остатком
router.get('/low-stock/:studioId', async (req: AuthRequest, res: Response) => {
  const items = await db.query(
    `SELECT ps.product_id, p.name as product_name, pc.name as category_name,
            ps.quantity::numeric as current_stock,
            ps.min_quantity::numeric as min_quantity,
            p.unit
     FROM product_stock ps
     JOIN products p ON ps.product_id = p.id
     LEFT JOIN product_categories pc ON p.category_id = pc.id
     WHERE ps.studio_id = $1
       AND ps.min_quantity > 0
       AND ps.quantity <= ps.min_quantity
     ORDER BY (ps.quantity / NULLIF(ps.min_quantity, 0)) ASC`,
    [req.params['studioId']]
  );
  res.json({ success: true, items });
});

// PUT /api/inventory/stock/:productId/min — установить минимальный остаток
router.put('/stock/:productId/min', async (req: AuthRequest, res: Response) => {
  const { studio_id, min_quantity } = req.body;
  if (!studio_id || min_quantity === undefined) {
    throw new AppError(400, 'studio_id and min_quantity are required');
  }
  await db.query(
    `UPDATE product_stock SET min_quantity = $1, updated_at = NOW()
     WHERE product_id = $2 AND studio_id = $3`,
    [min_quantity, req.params['productId'], studio_id]
  );
  res.json({ success: true });
});

export default router;
