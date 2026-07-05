import express, { type Response } from 'express';
import { z } from 'zod';
import db from '../database/db.js';
import { authenticateToken, type AuthRequest, optionalAuth, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { PaginatedResponse } from '../types/index.js';
import type { PickupLocationRow, PickupWorkingHourJson } from '../types/views/studio-views.js';
import { createLogger } from '../utils/logger.js';

const router = express.Router();
const log = createLogger('studios.routes');

const todayIsoUTC = (): string => new Date().toISOString().slice(0, 10);

const UpdateStudioSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  coordinates: z.record(z.unknown()).optional(),
  images: z.array(z.unknown()).optional(),
  description: z.string().max(2000).nullable().optional(),
  amenities: z.array(z.string()).optional(),
  is_popular: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  status: z.enum(['open', 'closed', 'maintenance']).optional(),
  status_message: z.string().max(500).nullable().optional(),
  status_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'status_until должен быть YYYY-MM-DD')
    .nullable()
    .optional()
    .refine(
      (v) => v == null || v >= todayIsoUTC(),
      { message: 'status_until не может быть в прошлом' },
    ),
}).refine(
  (data) => {
    if (data.status && data.status !== 'open') {
      return !!(data.status_message && data.status_until);
    }
    return true;
  },
  { message: 'Для closed/maintenance требуются status_message и status_until' },
);

type UpdateStudioInput = z.infer<typeof UpdateStudioSchema>;

interface CountRow {
  total: string;
}

interface StudioMutationRow {
  id: string;
  location_code: string | null;
  status: string | null;
  status_message: string | null;
  status_until: string | null;
  [key: string]: unknown;
}

const UPDATE_STUDIO_FIELDS = [
  'name',
  'address',
  'coordinates',
  'images',
  'description',
  'amenities',
  'is_popular',
  'is_featured',
  'status',
  'status_message',
  'status_until',
] as const;

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;
const PUBLIC_STUDIO_LOCATION_CODES: readonly string[] = ['soborny'];

function timeLabel(value: string): string {
  return value.slice(0, 5);
}

function formatPickupWorkHours(hours: PickupWorkingHourJson[]): string {
  const openHours = hours
    .filter(hour => hour.isOpen)
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek);

  if (openHours.length === 0) return 'Часы работы уточните в чате';

  const first = openHours[0];
  const sameTime = openHours.every(
    hour => timeLabel(hour.startTime) === timeLabel(first.startTime)
      && timeLabel(hour.endTime) === timeLabel(first.endTime),
  );

  if (sameTime && openHours.length === 7) {
    return `Ежедневно ${timeLabel(first.startTime)}-${timeLabel(first.endTime)}`;
  }

  return openHours
    .map(hour => `${DAY_LABELS[hour.dayOfWeek] ?? ''} ${timeLabel(hour.startTime)}-${timeLabel(hour.endTime)}`)
    .join(', ');
}

// List studios (public)
router.get('/', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { isPopular, isFeatured } = req.query;
  const page = typeof req.query.page === 'string' ? req.query.page : '1';
  const limit = typeof req.query.limit === 'string' ? req.query.limit : '10';

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  let whereConditions: string[] = [];
  const queryParams: unknown[] = [PUBLIC_STUDIO_LOCATION_CODES];
  let paramIndex = 1;

  whereConditions.push(`location_code = ANY($${paramIndex++}::text[])`);

  if (isPopular === 'true') {
    whereConditions.push(`is_popular = $${paramIndex++}`);
    queryParams.push(true);
  }

  if (isFeatured === 'true') {
    whereConditions.push(`is_featured = $${paramIndex++}`);
    queryParams.push(true);
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Get total count
  const countResult = await db.queryOne<CountRow>(
    `SELECT COUNT(*) as total FROM studios ${whereClause}`,
    queryParams
  );
  const total = parseInt(countResult?.total || '0', 10);
  const totalPages = Math.ceil(total / limitNum);

  // Get studios
  const studios = await db.query(
    `SELECT id, name, address, coordinates, images, rating, is_popular, is_featured, description, amenities, location_code, created_at, updated_at FROM studios ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...queryParams, limitNum, offset]
  );

  const response: PaginatedResponse<unknown> = {
    success: true,
    data: studios,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  };

  res.json(response);
});

// Public pickup locations for website photo-print checkout
router.get('/pickup-locations', async (_req: AuthRequest, res: Response): Promise<void> => {
  const locations = await db.query<PickupLocationRow>(
    `SELECT s.id::text,
            s.name,
            s.address,
            s.description,
            s.amenities,
            s.location_code,
            CASE WHEN s.status_until IS NOT NULL AND s.status_until < CURRENT_DATE
                 THEN 'open'
                 ELSE COALESCE(s.status, 'open')
            END AS status,
            CASE WHEN s.status_until IS NOT NULL AND s.status_until < CURRENT_DATE
                 THEN NULL
                 ELSE s.status_message
            END AS status_message,
            CASE WHEN s.status_until IS NOT NULL AND s.status_until < CURRENT_DATE
                 THEN NULL
                 ELSE s.status_until::text
            END AS status_until,
            COALESCE(
              json_agg(
                json_build_object(
                  'dayOfWeek', wh.day_of_week,
                  'startTime', to_char(wh.start_time, 'HH24:MI'),
                  'endTime', to_char(wh.end_time, 'HH24:MI'),
                  'isOpen', wh.is_open
                ) ORDER BY wh.day_of_week
              ) FILTER (WHERE wh.id IS NOT NULL),
              '[]'::json
            ) AS hours
     FROM studios s
     LEFT JOIN studio_working_hours wh ON wh.studio_id = s.id
     WHERE s.location_code = ANY($1::text[])
     GROUP BY s.id, s.name, s.address, s.description, s.amenities, s.location_code, s.status, s.status_message, s.status_until
     ORDER BY CASE s.location_code
                WHEN 'soborny' THEN 0
                ELSE 2
              END,
              s.name`,
    [PUBLIC_STUDIO_LOCATION_CODES],
  );

  res.json({
    success: true,
    data: locations.map(location => ({
      id: location.location_code || location.id,
      studioId: location.id,
      name: location.name,
      address: location.address,
      description: location.description,
      amenities: location.amenities ?? [],
      status: location.status || 'open',
      statusMessage: location.status_message,
      statusUntil: location.status_until,
      workHours: formatPickupWorkHours(location.hours ?? []),
      hours: location.hours ?? [],
    })),
  });
});

// List studios for admin — raw status (без CASE WHEN), status_until::text
router.get(
  '/admin',
  authenticateToken,
  requirePermission('settings:manage'),
  async (_req: AuthRequest, res: Response): Promise<void> => {
    const studios = await db.query(
      `SELECT id, name, address, coordinates, images, rating, is_popular, is_featured,
              description, amenities, location_code,
              status, status_message, status_until::text AS status_until,
              created_at, updated_at
       FROM studios
       ORDER BY name`,
    );
    res.json({ success: true, data: studios });
  },
);

// Get studio by ID (public)
router.get('/:id', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) {
    throw new AppError(400, 'Studio id is required');
  }

  const studio = await db.queryOne('SELECT id, name, address, coordinates, images, rating, is_popular, is_featured, description, amenities, location_code, created_at, updated_at FROM studios WHERE id = $1', [id]);

  if (!studio) {
    throw new AppError(404, 'Studio not found');
  }

  res.json({ success: true, data: studio });
});

// Create studio (admin only)
router.post('/', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    name,
    address,
    coordinates,
    images,
    description,
    amenities,
  } = req.body;

  if (!name || !address) {
    throw new AppError(400, 'Name and address are required');
  }

  const studio = await db.queryOne(
    `INSERT INTO studios (name, address, coordinates, images, description, amenities)
     VALUES ($1, $2, $3::jsonb, $4::jsonb[], $5, $6)
     RETURNING *`,
    [
      name,
      address,
      JSON.stringify(coordinates || {}),
      JSON.stringify(images || []),
      description,
      amenities || [],
    ]
  );

  res.status(201).json({ success: true, data: studio });
});

// Update studio (admin only)
router.put('/:id', authenticateToken, requirePermission('settings:manage'), validate(UpdateStudioSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) {
    throw new AppError(400, 'Studio id is required');
  }
  const updateData = req.body as UpdateStudioInput;

  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;
  
  for (const field of UPDATE_STUDIO_FIELDS) {
    if (updateData[field] !== undefined) {
      if (field === 'coordinates') {
        updates.push(`${field} = $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(updateData[field]));
      } else if (field === 'images') {
        updates.push(`${field} = $${paramIndex++}::jsonb[]`);
        values.push(JSON.stringify(updateData[field]));
      } else {
        updates.push(`${field} = $${paramIndex++}`);
        values.push(updateData[field]);
      }
    }
  }

  if (updates.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(id);

  const studio = await db.queryOne<StudioMutationRow>(
    `UPDATE studios SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (!studio) {
    throw new AppError(404, 'Studio not found');
  }

  const statusFieldsTouched =
    updateData.status !== undefined ||
    updateData.status_message !== undefined ||
    updateData.status_until !== undefined;

  if (statusFieldsTouched) {
    const socketServer = req.app.socketServer;
    if (socketServer) {
      try {
        socketServer.getIO().emit('studio:status-changed', {
          studioId: studio.id,
          locationCode: studio.location_code ?? null,
          status: studio.status,
          status_message: studio.status_message ?? null,
          status_until: studio.status_until ? String(studio.status_until).slice(0, 10) : null,
        });
      } catch (err) {
        log.warn('studio:status-changed emit failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  res.json({ success: true, data: studio });
});

// Delete studio (admin only)
router.delete('/:id', authenticateToken, requirePermission('settings:manage'), async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) {
    throw new AppError(400, 'Studio id is required');
  }

  const result = await db.query('DELETE FROM studios WHERE id = $1 RETURNING id', [id]);

  if (result.length === 0) {
    throw new AppError(404, 'Studio not found');
  }

  res.json({ success: true, message: 'Studio deleted successfully' });
});

// Get studio reviews
router.get('/:id/reviews', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const id = req.params['id'];
  if (!id) {
    throw new AppError(400, 'Studio id is required');
  }
  const page = typeof req.query.page === 'string' ? req.query.page : '1';
  const limit = typeof req.query.limit === 'string' ? req.query.limit : '10';

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  // Verify studio exists
  const studio = await db.queryOne('SELECT id FROM studios WHERE id = $1', [id]);
  if (!studio) {
    throw new AppError(404, 'Studio not found');
  }

  // Get total count
  const countResult = await db.queryOne<CountRow>(
    'SELECT COUNT(*) as total FROM studio_reviews WHERE studio_id = $1',
    [id]
  );
  const total = parseInt(countResult?.total || '0', 10);
  const totalPages = Math.ceil(total / limitNum);

  // Get reviews
  const reviews = await db.query(
    `SELECT r.*, u.display_name as author_display_name
     FROM studio_reviews r
     JOIN users u ON r.user_id = u.id
     WHERE r.studio_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [id, limitNum, offset]
  );

  res.json({
    success: true,
    data: reviews,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  });
});

// Add review to studio
router.post('/:id/reviews', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const id = req.params['id'];
  if (!id) {
    throw new AppError(400, 'Studio id is required');
  }
  const { rating, comment } = req.body;

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    throw new AppError(400, 'Rating must be between 1 and 5');
  }

  // Verify studio exists
  const studio = await db.queryOne('SELECT id FROM studios WHERE id = $1', [id]);
  if (!studio) {
    throw new AppError(404, 'Studio not found');
  }

  // Check if user already reviewed this studio
  const existingReview = await db.queryOne(
    'SELECT id FROM studio_reviews WHERE studio_id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (existingReview) {
    throw new AppError(400, 'You have already reviewed this studio');
  }

  // Insert review (rating will be updated automatically via trigger)
  const review = await db.queryOne(
    `INSERT INTO studio_reviews (studio_id, user_id, rating, comment)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [id, req.user.id, rating, comment || '']
  );

  res.status(201).json({ success: true, data: review });
});

export default router;
