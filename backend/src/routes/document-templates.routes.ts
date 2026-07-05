import { Router, Request, Response } from 'express';
import { pool } from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import type DocumentTemplates from '../types/generated/public/DocumentTemplates.js';

const router = Router();

// GET / — active document templates list (for staff)
router.get('/', authenticateToken, async (_req: Request, res: Response) => {
  const { rows } = await pool.query<DocumentTemplates>(
    `SELECT id, slug, name, category, country_code, photo_width_mm, photo_height_mm,
            default_media_size, photos_per_sheet, is_active, sort_order
     FROM document_templates
     WHERE is_active = true
     ORDER BY sort_order ASC, name ASC`
  );
  res.json({ success: true, data: rows });
});

// GET /:slug — single template by slug
router.get('/:slug', authenticateToken, async (req: Request, res: Response) => {
  const { rows } = await pool.query<DocumentTemplates>(
    `SELECT * FROM document_templates WHERE slug = $1 AND is_active = true`,
    [req.params['slug']]
  );
  if (!rows[0]) throw new AppError(404, 'Template not found');
  res.json({ success: true, data: rows[0] });
});

export default router;
