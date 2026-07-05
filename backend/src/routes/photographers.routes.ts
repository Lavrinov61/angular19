import express, { Response } from 'express';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import db from '../database/db.js';
import { authenticateToken, AuthRequest, optionalAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { NotificationService } from '../services/notification.service.js';
import { createUploadLimiter } from '../middleware/upload-limiter.js';
import { PaginatedResponse } from '../types/index.js';
import { config } from '../config/index.js';

/** Элемент списка фотографов для API-ответа */
interface PhotographerListItem {
  id: string;
  userId: string;
  name: string;
  slug: string | null;
  email: string;
  bio: string | null;
  location: unknown;
  experience: number;
  specializations: string[];
  portfolio: unknown[];
  availability: unknown;
  pricing: unknown;
  rating: unknown;
  social_media: unknown;
  verified: boolean;
  isActive: boolean;
  sortOrder: number;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}

/** team_display JSONB из metadata */
interface TeamDisplay {
  role: string;
  tagline: string;
  portrait_hero: string;
  portrait_card: string;
  experience_years: number;
  sessions_completed: number;
  signature: string;
  specialties: string[];
  personal_fact: string | null;
}

/** Элемент для GET /team-members */
interface TeamMemberItem {
  slug: string;
  name: string;
  role: string;
  tagline: string;
  portraitHero: string;
  portraitCard: string;
  experienceYears: number;
  sessionsCompleted: number;
  signature: string;
  specialties: string[];
  personalFact: string | null;
}

// Multer для загрузки документов фотографа
const docsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.upload.dir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `photographer-doc-${uuidv4()}${ext}`);
  },
});
const docsUpload = multer({
  storage: docsStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 МБ
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const router = express.Router();

// Get photographers list (public, with optional auth)
router.get('/', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    city,
    specializations,
    minRating,
    search,
    include_inactive,
    page = 1,
    limit = 10,
  } = req.query as Record<string, string | string[] | undefined>;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  // Build query
  const whereConditions: string[] = [];
  const queryParams: unknown[] = [];
  let paramIndex = 1;

  // По умолчанию показываем только активных; CRM (admin/employee) может запросить всех
  const showInactive = include_inactive === 'true'
    && req.user
    && (req.user.role === 'admin' || req.user.role === 'employee');
  if (!showInactive) {
    whereConditions.push('p.is_active = true');
  }

  if (city) {
    whereConditions.push(`(p.location->>'city') = $${paramIndex++}`);
    queryParams.push(city);
  }

  if (minRating) {
    whereConditions.push(`(p.rating->>'average')::numeric >= $${paramIndex++}`);
    queryParams.push(parseFloat(String(minRating)));
  }

  if (specializations) {
    const specs = Array.isArray(specializations) ? specializations : [specializations];
    if (specs.length > 0) {
      whereConditions.push(`p.specializations && $${paramIndex++}`);
      queryParams.push(specs);
    }
  }

  if (search) {
    whereConditions.push(`(p.name ILIKE $${paramIndex++} OR p.bio ILIKE $${paramIndex})`);
    const searchPattern = `%${search}%`;
    queryParams.push(searchPattern, searchPattern);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // Get total count
  const countQuery = `SELECT COUNT(*) as total FROM photographers p ${whereClause}`;
  const countResult = await db.queryOne<Pick<{ total: string }, 'total'>>(countQuery, queryParams);
  const total = parseInt(countResult?.total || '0', 10);
  const totalPages = Math.ceil(total / limitNum);

  // Get photographers
  const selectQuery = `
    SELECT p.*, u.email, u.display_name as user_display_name
    FROM photographers p
    JOIN users u ON p.user_id = u.id
    ${whereClause}
    ORDER BY p.sort_order ASC, p.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}
  `;

  queryParams.push(limitNum, offset);
  const photographers = await db.query(selectQuery, queryParams);

  const response: PaginatedResponse<PhotographerListItem> = {
    success: true,
    data: photographers.map(p => ({
      id: p.id,
      userId: p.user_id,
      name: p.name,
      slug: p.slug,
      email: p.email,
      bio: p.bio,
      location: p.location,
      experience: p.experience,
      specializations: p.specializations,
      portfolio: p.portfolio,
      availability: p.availability,
      pricing: p.pricing,
      rating: p.rating,
      social_media: p.social_media,
      verified: p.verified,
      isActive: p.is_active,
      sortOrder: p.sort_order,
      metadata: p.metadata,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    })),
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      totalPages,
    },
  };

  res.json(response);
});

// Get current photographer profile
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  // Check if user is a photographer
  if (req.user.role !== 'photographer') {
    throw new AppError(403, 'You must be a photographer to access this resource');
  }

  const photographer = await db.queryOne(
    `SELECT p.*, u.email, u.display_name as user_display_name
     FROM photographers p
     JOIN users u ON p.user_id = u.id
     WHERE p.user_id = $1`,
    [req.user.id]
  );

  if (!photographer) {
    throw new AppError(404, 'Photographer profile not found');
  }

  res.json({
    success: true,
    data: {
      id: photographer.id,
      userId: photographer.user_id,
      name: photographer.name,
      email: photographer.email,
      bio: photographer.bio,
      location: photographer.location,
      experience: photographer.experience,
      specializations: photographer.specializations,
      services: photographer.services,
      equipment: photographer.equipment,
      portfolio: photographer.portfolio,
      availability: photographer.availability,
      pricing: photographer.pricing,
      rating: photographer.rating,
      social_media: photographer.social_media,
      verified: photographer.verified,
      createdAt: photographer.created_at,
      updatedAt: photographer.updated_at,
    },
  });
});

// Get team members for public /photographers page
router.get('/team-members', async (_req: AuthRequest, res: Response): Promise<void> => {
  const photographers = await db.query(
    `SELECT slug, name, metadata->'team_display' as team_display
     FROM photographers
     WHERE is_active = true
     ORDER BY sort_order ASC`
  );

  const data: TeamMemberItem[] = photographers.map(p => {
    const td = p.team_display as TeamDisplay | null;
    return {
      slug: p.slug,
      name: p.name,
      role: td?.role || 'Фотограф',
      tagline: td?.tagline || '',
      portraitHero: td?.portrait_hero || '',
      portraitCard: td?.portrait_card || '',
      experienceYears: td?.experience_years || 0,
      sessionsCompleted: td?.sessions_completed || 0,
      signature: td?.signature || '',
      specialties: td?.specialties || [],
      personalFact: td?.personal_fact || null,
    };
  });

  res.json({ success: true, data });
});

// Get photographer by slug (public)
router.get('/by-slug/:slug', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { slug } = req.params;

  const photographer = await db.queryOne(
    `SELECT p.*, u.email, u.display_name as user_display_name
     FROM photographers p
     JOIN users u ON p.user_id = u.id
     WHERE p.slug = $1`,
    [slug]
  );

  if (!photographer) {
    throw new AppError(404, 'Фотограф не найден');
  }

  res.json({
    success: true,
    data: {
      id: photographer.id,
      userId: photographer.user_id,
      name: photographer.name,
      slug: photographer.slug,
      email: photographer.email,
      bio: photographer.bio,
      location: photographer.location,
      experience: photographer.experience,
      specializations: photographer.specializations,
      services: photographer.services,
      equipment: photographer.equipment,
      portfolio: photographer.portfolio,
      availability: photographer.availability,
      pricing: photographer.pricing,
      rating: photographer.rating,
      social_media: photographer.social_media,
      verified: photographer.verified,
      isActive: photographer.is_active,
      sortOrder: photographer.sort_order,
      metadata: photographer.metadata,
      createdAt: photographer.created_at,
      updatedAt: photographer.updated_at,
    },
  });
});

// Get photographer by ID (public)
router.get('/:id', optionalAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  const photographer = await db.queryOne(
    `SELECT p.*, u.email, u.display_name as user_display_name
     FROM photographers p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = $1`,
    [id]
  );

  if (!photographer) {
    throw new AppError(404, 'Photographer profile not found');
  }

  res.json({
    success: true,
    data: {
      id: photographer.id,
      userId: photographer.user_id,
      name: photographer.name,
      email: photographer.email,
      bio: photographer.bio,
      location: photographer.location,
      experience: photographer.experience,
      specializations: photographer.specializations,
      services: photographer.services,
      equipment: photographer.equipment,
      portfolio: photographer.portfolio,
      availability: photographer.availability,
      pricing: photographer.pricing,
      rating: photographer.rating,
      social_media: photographer.social_media,
      verified: photographer.verified,
      createdAt: photographer.created_at,
      updatedAt: photographer.updated_at,
    },
  });
});

// Update current photographer profile
router.put('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user || req.user.role !== 'photographer') {
    throw new AppError(403, 'You must be a photographer to update this profile');
  }

  const {
    name,
    bio,
    location,
    experience,
    specializations,
    services,
    equipment,
    portfolio,
    availability,
    pricing,
    social_media,
  } = req.body;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (name !== undefined) {
    updates.push(`name = $${paramIndex++}`);
    values.push(name);
  }
  if (bio !== undefined) {
    updates.push(`bio = $${paramIndex++}`);
    values.push(bio);
  }
  if (location !== undefined) {
    updates.push(`location = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(location));
  }
  if (experience !== undefined) {
    updates.push(`experience = $${paramIndex++}`);
    values.push(experience);
  }
  if (specializations !== undefined) {
    updates.push(`specializations = $${paramIndex++}`);
    values.push(specializations);
  }
  if (services !== undefined) {
    updates.push(`services = $${paramIndex++}`);
    values.push(services);
  }
  if (equipment !== undefined) {
    updates.push(`equipment = $${paramIndex++}`);
    values.push(equipment);
  }
  if (portfolio !== undefined) {
    updates.push(`portfolio = $${paramIndex++}::jsonb[]`);
    values.push(JSON.stringify(portfolio));
  }
  if (availability !== undefined) {
    updates.push(`availability = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(availability));
  }
  if (pricing !== undefined) {
    updates.push(`pricing = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(pricing));
  }
  if (social_media !== undefined) {
    updates.push(`social_media = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(social_media));
  }

  if (updates.length === 0) {
    throw new AppError(400, 'No fields to update');
  }

  values.push(req.user!.id);

  const query = `
    UPDATE photographers
    SET ${updates.join(', ')}, updated_at = NOW()
    WHERE user_id = $${paramIndex}
    RETURNING *
  `;

  const updated = await db.queryOne(query, values);

  if (!updated) {
    throw new AppError(404, 'Photographer profile not found');
  }

  res.json({ success: true, data: updated });
});

// ─── /me/* sub-routes (все требуют auth + role photographer) ────────────────

function requirePhotographer(req: AuthRequest): void {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  if (req.user.role !== 'photographer') throw new AppError(403, 'Только для фотографов');
}

async function getPhotographerRow(userId: string) {
  const row = await db.queryOne<{ id: string }>(
    'SELECT id FROM photographers WHERE user_id = $1',
    [userId]
  );
  if (!row) throw new AppError(404, 'Профиль фотографа не найден');
  return row;
}

// GET /me/schedule
router.get('/me/schedule', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  const { id } = await getPhotographerRow(req.user!.id);
  const row = await db.queryOne<{ availability: any }>(
    'SELECT availability FROM photographers WHERE id = $1',
    [id]
  );
  res.json({ success: true, data: row?.availability || {} });
});

// PUT /me/schedule
router.put('/me/schedule', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  const { id } = await getPhotographerRow(req.user!.id);
  const { availability } = req.body;
  if (!availability || typeof availability !== 'object') {
    throw new AppError(400, 'availability должен быть объектом');
  }
  await db.queryOne(
    'UPDATE photographers SET availability = $1::jsonb, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(availability), id]
  );
  res.json({ success: true, data: availability });
});

// GET /me/services
router.get('/me/services', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  const { id } = await getPhotographerRow(req.user!.id);
  const row = await db.queryOne<{ services: any }>(
    'SELECT services FROM photographers WHERE id = $1',
    [id]
  );
  res.json({ success: true, data: row?.services || [] });
});

// PUT /me/services
router.put('/me/services', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  const { id } = await getPhotographerRow(req.user!.id);
  const { services } = req.body;
  if (!Array.isArray(services)) {
    throw new AppError(400, 'services должен быть массивом');
  }
  await db.queryOne(
    'UPDATE photographers SET services = $1, updated_at = NOW() WHERE id = $2',
    [services, id]
  );
  res.json({ success: true, data: services });
});

// GET /me/services/manage — photographer_services + pricing info
router.get('/me/services/manage', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  const { id } = await getPhotographerRow(req.user!.id);
  const rows = await db.query(
    `SELECT ps.id, ps.service_id, ps.is_enabled, ps.price, ps.created_at, ps.updated_at
     FROM photographer_services ps
     WHERE ps.photographer_id = $1
     ORDER BY ps.service_id`,
    [id]
  );
  res.json({ success: true, data: rows });
});

// PUT /me/notification-settings
router.put('/me/notification-settings', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  const { id } = await getPhotographerRow(req.user!.id);
  const { notificationSettings } = req.body;
  if (!notificationSettings || typeof notificationSettings !== 'object') {
    throw new AppError(400, 'notificationSettings должен быть объектом');
  }
  await db.queryOne(
    `UPDATE photographers
     SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{notification_settings}', $1::jsonb),
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify(notificationSettings), id]
  );
  res.json({ success: true, data: notificationSettings });
});

// POST /me/test-notification
router.post('/me/test-notification', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  await NotificationService.create({
    userId: req.user!.id,
    title: 'Тестовое уведомление',
    body: 'Уведомления работают корректно',
    type: 'system',
    data: { test: true },
  });
  res.json({ success: true, message: 'Тестовое уведомление отправлено' });
});

// POST /me/documents/upload
const photographerUploadLimiter = createUploadLimiter('ul-photog:', 20, 15 * 60 * 1000);

router.post('/me/documents/upload', authenticateToken, photographerUploadLimiter, docsUpload.single('file'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    requirePhotographer(req);
    if (!req.file) throw new AppError(400, 'Файл не загружен');

    const fileRecord = await db.queryOne<{ id: string }>(
      `INSERT INTO files (user_id, file_name, original_name, file_path, file_size, mime_type, storage_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'local', $7::jsonb)
       RETURNING id`,
      [
        req.user!.id,
        req.file.filename,
        req.file.originalname,
        req.file.path,
        req.file.size,
        req.file.mimetype,
        JSON.stringify({ type: 'photographer_document' }),
      ]
    );

    res.status(201).json({
      success: true,
      data: {
        id: fileRecord?.id,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
  }
);

// GET /me/stats — агрегат: сессии, отзывы, рейтинг
router.get('/me/stats', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requirePhotographer(req);
  const { id } = await getPhotographerRow(req.user!.id);

  const [bookingsCount, reviewsStats] = await Promise.all([
    db.queryOne<{ total: string; completed: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE status != 'cancelled') AS total,
         COUNT(*) FILTER (WHERE status = 'completed') AS completed
       FROM bookings WHERE photographer_id = $1`,
      [id]
    ),
    db.queryOne<{ count: string; avg_rating: string }>(
      `SELECT COUNT(*) AS count, AVG(rating)::numeric(3,2) AS avg_rating
       FROM reviews WHERE photographer_id = $1`,
      [id]
    ),
  ]);

  res.json({
    success: true,
    data: {
      bookings: {
        total: parseInt(bookingsCount?.total || '0', 10),
        completed: parseInt(bookingsCount?.completed || '0', 10),
      },
      reviews: {
        count: parseInt(reviewsStats?.count || '0', 10),
        avgRating: parseFloat(reviewsStats?.avg_rating || '0'),
      },
    },
  });
});

// ─── Admin CRUD (require admin role) ────────────────────────────────────────

function requireAdmin(req: AuthRequest): void {
  if (!req.user) throw new AppError(401, 'Unauthorized');
  if (req.user.role !== 'admin') throw new AppError(403, 'Admin access required');
}

// POST /photographers — create photographer (admin only)
router.post('/', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireAdmin(req);

  const { userId, name, bio, location, experience, specializations, services, equipment, portfolio, availability, pricing, social_media } = req.body;

  if (!userId || !name) {
    throw new AppError(400, 'userId and name are required');
  }

  // Verify user exists
  const user = await db.queryOne<{ id: string; role: string }>('SELECT id, role FROM users WHERE id = $1', [userId]);
  if (!user) throw new AppError(404, 'User not found');

  // Check no existing photographer profile
  const existing = await db.queryOne('SELECT id FROM photographers WHERE user_id = $1', [userId]);
  if (existing) throw new AppError(409, 'Photographer profile already exists for this user');

  const photographer = await db.queryOne(
    `INSERT INTO photographers (user_id, name, bio, location, experience, specializations, services, equipment, portfolio, availability, pricing, social_media)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9::jsonb[], $10::jsonb, $11::jsonb, $12::jsonb)
     RETURNING *`,
    [
      userId, name, bio || null,
      JSON.stringify(location || {}),
      experience || 0,
      specializations || [],
      services || [],
      equipment || [],
      portfolio ? JSON.stringify(portfolio) : '{}',
      JSON.stringify(availability || {}),
      JSON.stringify(pricing || {}),
      JSON.stringify(social_media || {}),
    ]
  );

  // Update user role to photographer if not already
  if (user.role !== 'photographer') {
    await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', ['photographer', userId]);
  }

  res.status(201).json({ success: true, data: photographer });
});

// ─── /:id routes ─────────────────────────────────────────────────────────────

// PUT /photographers/:id — admin update
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireAdmin(req);
  const { id } = req.params;

  const { name, bio, location, experience, specializations, services, equipment, portfolio, availability, pricing, social_media } = req.body;

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (name !== undefined) { updates.push(`name = $${paramIndex++}`); values.push(name); }
  if (bio !== undefined) { updates.push(`bio = $${paramIndex++}`); values.push(bio); }
  if (location !== undefined) { updates.push(`location = $${paramIndex++}::jsonb`); values.push(JSON.stringify(location)); }
  if (experience !== undefined) { updates.push(`experience = $${paramIndex++}`); values.push(experience); }
  if (specializations !== undefined) { updates.push(`specializations = $${paramIndex++}`); values.push(specializations); }
  if (services !== undefined) { updates.push(`services = $${paramIndex++}`); values.push(services); }
  if (equipment !== undefined) { updates.push(`equipment = $${paramIndex++}`); values.push(equipment); }
  if (portfolio !== undefined) { updates.push(`portfolio = $${paramIndex++}::jsonb[]`); values.push(JSON.stringify(portfolio)); }
  if (availability !== undefined) { updates.push(`availability = $${paramIndex++}::jsonb`); values.push(JSON.stringify(availability)); }
  if (pricing !== undefined) { updates.push(`pricing = $${paramIndex++}::jsonb`); values.push(JSON.stringify(pricing)); }
  if (social_media !== undefined) { updates.push(`social_media = $${paramIndex++}::jsonb`); values.push(JSON.stringify(social_media)); }

  if (updates.length === 0) throw new AppError(400, 'No fields to update');

  values.push(id);
  const updated = await db.queryOne(
    `UPDATE photographers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (!updated) throw new AppError(404, 'Photographer not found');
  res.json({ success: true, data: updated });
});

// PATCH /photographers/:id — partial update (admin)
router.patch('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireAdmin(req);
  const { id } = req.params;

  const allowedFields = ['name', 'bio', 'location', 'experience', 'specializations', 'services', 'equipment', 'portfolio', 'availability', 'pricing', 'social_media'];
  const jsonbFields = ['location', 'availability', 'pricing', 'social_media'];
  const jsonbArrayFields = ['portfolio'];

  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (jsonbFields.includes(field)) {
        updates.push(`${field} = $${paramIndex++}::jsonb`);
        values.push(JSON.stringify(req.body[field]));
      } else if (jsonbArrayFields.includes(field)) {
        updates.push(`${field} = $${paramIndex++}::jsonb[]`);
        values.push(JSON.stringify(req.body[field]));
      } else {
        updates.push(`${field} = $${paramIndex++}`);
        values.push(req.body[field]);
      }
    }
  }

  if (updates.length === 0) throw new AppError(400, 'No fields to update');

  values.push(id);
  const updated = await db.queryOne(
    `UPDATE photographers SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (!updated) throw new AppError(404, 'Photographer not found');
  res.json({ success: true, data: updated });
});

// DELETE /photographers/:id — admin only
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireAdmin(req);
  const { id } = req.params;

  const photographer = await db.queryOne<{ id: string; user_id: string }>('SELECT id, user_id FROM photographers WHERE id = $1', [id]);
  if (!photographer) throw new AppError(404, 'Photographer not found');

  await db.query('DELETE FROM photographers WHERE id = $1', [id]);

  // Revert user role back to client
  await db.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', ['client', photographer.user_id]);

  res.json({ success: true, message: 'Photographer deleted' });
});

// ─── Portfolio routes ───────────────────────────────────────────────────────

// GET /photographers/:id/portfolio
router.get('/:id/portfolio', async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const photographer = await db.queryOne<{ portfolio: any[] }>('SELECT portfolio FROM photographers WHERE id = $1', [id]);
  if (!photographer) throw new AppError(404, 'Photographer not found');
  res.json({ success: true, data: photographer.portfolio || [] });
});

// POST /photographers/:id/portfolio — add portfolio item (admin or own)
router.post('/:id/portfolio', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { id } = req.params;
  const photographer = await db.queryOne<{ id: string; user_id: string; portfolio: any[] }>(
    'SELECT id, user_id, portfolio FROM photographers WHERE id = $1', [id]
  );
  if (!photographer) throw new AppError(404, 'Photographer not found');

  const isOwner = photographer.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) throw new AppError(403, 'Forbidden');

  const { title, description, imageUrl, category } = req.body;
  if (!title || !imageUrl) throw new AppError(400, 'title and imageUrl are required');

  const newItem = {
    id: uuidv4(),
    title,
    description: description || '',
    imageUrl,
    category: category || 'general',
    createdAt: new Date().toISOString(),
  };

  const currentPortfolio = Array.isArray(photographer.portfolio) ? photographer.portfolio : [];
  const updatedPortfolio = [...currentPortfolio, newItem];

  await db.query(
    'UPDATE photographers SET portfolio = $1::jsonb[], updated_at = NOW() WHERE id = $2',
    [JSON.stringify(updatedPortfolio), id]
  );

  res.status(201).json({ success: true, data: newItem });
});

// DELETE /photographers/:id/portfolio/:itemId
router.delete('/:id/portfolio/:itemId', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { id, itemId } = req.params;
  const photographer = await db.queryOne<{ id: string; user_id: string; portfolio: any[] }>(
    'SELECT id, user_id, portfolio FROM photographers WHERE id = $1', [id]
  );
  if (!photographer) throw new AppError(404, 'Photographer not found');

  const isOwner = photographer.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) throw new AppError(403, 'Forbidden');

  const currentPortfolio = Array.isArray(photographer.portfolio) ? photographer.portfolio : [];
  const updatedPortfolio = currentPortfolio.filter((item: any) => item.id !== itemId);

  if (updatedPortfolio.length === currentPortfolio.length) {
    throw new AppError(404, 'Portfolio item not found');
  }

  await db.query(
    'UPDATE photographers SET portfolio = $1::jsonb[], updated_at = NOW() WHERE id = $2',
    [JSON.stringify(updatedPortfolio), id]
  );

  res.json({ success: true, message: 'Portfolio item deleted' });
});

// ─── Schedule routes ────────────────────────────────────────────────────────

// GET /photographers/:id/schedule
router.get('/:id/schedule', async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const photographer = await db.queryOne<{ availability: any }>('SELECT availability FROM photographers WHERE id = $1', [id]);
  if (!photographer) throw new AppError(404, 'Photographer not found');
  res.json({ success: true, data: photographer.availability || {} });
});

// PUT /photographers/:id/schedule — admin or own
router.put('/:id/schedule', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { id } = req.params;
  const photographer = await db.queryOne<{ id: string; user_id: string }>('SELECT id, user_id FROM photographers WHERE id = $1', [id]);
  if (!photographer) throw new AppError(404, 'Photographer not found');

  const isOwner = photographer.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) throw new AppError(403, 'Forbidden');

  const schedule = req.body;
  if (!schedule || typeof schedule !== 'object') throw new AppError(400, 'Schedule must be an object');

  await db.query(
    'UPDATE photographers SET availability = $1::jsonb, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(schedule), id]
  );

  res.json({ success: true, data: schedule });
});

// ─── Verify route ───────────────────────────────────────────────────────────

// POST /photographers/:id/verify — admin only
router.post('/:id/verify', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  requireAdmin(req);
  const { id } = req.params;

  const updated = await db.queryOne(
    `UPDATE photographers SET verified = true, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );

  if (!updated) throw new AppError(404, 'Photographer not found');

  // Notify photographer about verification
  if (updated.user_id) {
    NotificationService.create({
      userId: updated.user_id,
      title: 'Профиль верифицирован',
      body: 'Ваш профиль фотографа успешно прошёл верификацию',
      type: 'system',
      data: { photographerId: id },
    }).catch(() => { /* non-critical */ });
  }

  res.json({ success: true, data: updated });
});

// Get photographer reviews
router.get('/:id/reviews', async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { page = 1, limit = 10 } = req.query as Record<string, any>;

  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  // Verify photographer exists
  const photographer = await db.queryOne('SELECT id FROM photographers WHERE id = $1', [id]);
  if (!photographer) {
    throw new AppError(404, 'Photographer not found');
  }

  // Get total count
  const countResult = await db.queryOne<{ total: string }>(
    'SELECT COUNT(*) as total FROM reviews WHERE photographer_id = $1',
    [id]
  );
  const total = parseInt(countResult?.total || '0', 10);
  const totalPages = Math.ceil(total / limitNum);

  // Get reviews
  const reviews = await db.query(
    `SELECT r.*, u.display_name as author_display_name, u.photo_url as author_photo_url
     FROM reviews r
     JOIN users u ON r.user_id = u.id
     WHERE r.photographer_id = $1
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

// Add review to photographer
router.post('/:id/reviews', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) {
    throw new AppError(401, 'Unauthorized');
  }

  const { id } = req.params;
  const { rating, comment } = req.body;

  if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
    throw new AppError(400, 'Rating must be between 1 and 5');
  }

  // Check if user is a client
  if (req.user.role !== 'client') {
    throw new AppError(403, 'Only clients can leave reviews');
  }

  // Verify photographer exists
  const photographer = await db.queryOne('SELECT id, user_id FROM photographers WHERE id = $1', [id]);
  if (!photographer) {
    throw new AppError(404, 'Photographer not found');
  }

  // Check if user is not reviewing themselves
  if (photographer.user_id === req.user.id) {
    throw new AppError(400, 'You cannot review yourself');
  }

  // Check if user already reviewed this photographer
  const existingReview = await db.queryOne(
    'SELECT id FROM reviews WHERE photographer_id = $1 AND user_id = $2',
    [id, req.user.id]
  );

  if (existingReview) {
    throw new AppError(400, 'You have already reviewed this photographer');
  }

  // Get user display name
  const user = await db.queryOne<{ display_name: string }>(
    'SELECT display_name FROM users WHERE id = $1',
    [req.user.id]
  );

  // Insert review (rating will be updated automatically via trigger)
  const review = await db.queryOne(
    `INSERT INTO reviews (photographer_id, user_id, rating, comment, author_display_name)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, req.user.id, rating, comment || '', user?.display_name || 'Anonymous']
  );

  res.status(201).json({ success: true, data: review });
});

export default router;
