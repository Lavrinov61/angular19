import express, { Request, Response } from 'express';
import db from '../database/db.js';
import { optionalAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { PaginatedResponse } from '../types/index.js';

const router = express.Router();

// List shooting locations (public)
router.get('/', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const { category, page = 1, limit = 10 } = req.query;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  let whereConditions: string[] = [];
  const queryParams: any[] = [];
  let paramIndex = 1;

  if (category) {
    whereConditions.push(`category = $${paramIndex++}`);
    queryParams.push(category);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Get total count
  const countResult = await db.queryOne<{ total: string }>(
    `SELECT COUNT(*) as total FROM shooting_locations ${whereClause}`,
    queryParams
  );
  const total = parseInt(countResult?.total || '0', 10);
  const totalPages = Math.ceil(total / limitNum);

  // Get locations
  const locations = await db.query(
    `SELECT id, name, address, coordinates, images, description, category, created_at, updated_at FROM shooting_locations ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...queryParams, limitNum, offset]
  );

  const response: PaginatedResponse<any> = {
    success: true,
    data: locations,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  };

  res.json(response);
});

// Get shooting location by ID (public)
router.get('/:id', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const location = await db.queryOne('SELECT id, name, address, coordinates, images, description, category, created_at, updated_at FROM shooting_locations WHERE id = $1', [id]);

  if (!location) {
    throw new AppError(404, 'Shooting location not found');
  }

  res.json({ success: true, data: location });
});

export default router;
