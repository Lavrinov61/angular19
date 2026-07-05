import { Router, Request, Response } from 'express';
import { pool } from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ─── PHOTOS ────────────────────────────────────────────────────────────────────

/**
 * GET /api/gallery/photos
 * Публичные фотографии галереи с пагинацией и фильтрами
 */
router.get('/photos', async (req: Request, res: Response) => {
  const category  = req.query['category']   as string | undefined;
  const isFeatured = req.query['isFeatured'] as string | undefined;
  const limit  = Math.min(parseInt(req.query['limit']  as string || '20', 10), 100);
  const offset = Math.max(parseInt(req.query['offset'] as string || '0',  10), 0);

  const conditions: string[] = ['is_public = true'];
  const params: unknown[] = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (isFeatured === 'true') {
    conditions.push('is_featured = true');
  }

  const where = conditions.join(' AND ');
  // Отдельный params для COUNT (без limit/offset)
  const countParams = [...params];

  params.push(limit, offset);

  const [dataResult, countResult] = await Promise.all([
    pool.query(
      `SELECT
         id, slug, file_url AS url, thumbnail_url, title, description,
         category, tags, photographer_id, is_public, is_featured,
         sort_order AS "order", width, height,
         created_at AS "createdAt", updated_at AS "updatedAt"
       FROM gallery_photos
       WHERE ${where}
       ORDER BY is_featured DESC, sort_order ASC, created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM gallery_photos WHERE ${where}`,
      countParams
    ),
  ]);

  res.json({
    success: true,
    data:   dataResult.rows,
    total:  countResult.rows[0].total,
    limit,
    offset,
  });
});

// ─── STATS ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/gallery/stats
 * Реальные цифры для блока статистики
 */
router.get('/stats', async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total_photos FROM gallery_photos WHERE is_public = true`
  );
  res.json({ success: true, totalPhotos: result.rows[0].total_photos });
});

// ─── CATEGORIES ────────────────────────────────────────────────────────────────

/**
 * GET /api/gallery/categories
 * Категории с реальным подсчётом публичных фотографий
 */
router.get('/categories', async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT category AS value, COUNT(*)::int AS count
     FROM gallery_photos
     WHERE is_public = true
     GROUP BY category
     ORDER BY count DESC`
  );
  res.json({ success: true, categories: result.rows });
});

export default router;
