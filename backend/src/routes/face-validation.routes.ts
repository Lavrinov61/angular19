/**
 * Face Validation Routes — Rust passport photo estimate.
 * SECURITY: Zod validation, URL whitelist, DPI bounds, rate limiting applied
 */
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import {
  validateFaceAndSave,
  getByPhotoApproval,
  getByMessage,
} from '../services/face-validation.service.js';
import { MEDIA_ALLOWED_DOMAINS } from '../config/media-domains.js';
import { pool } from '../database/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('face-validation.routes');
const router = Router();

// Schema for POST /validate
const validateFaceSchema = z.object({
  image_url: z.string()
    .url('Must be valid URL')
    .refine(u => {
      const url = new URL(u);
      return MEDIA_ALLOWED_DOMAINS.some(d => url.hostname === d || url.hostname?.endsWith(`.${d}`));
    }, 'URL must be from allowed media origins')
    .refine(u => {
      const protocol = new URL(u).protocol;
      return protocol === 'https:' || protocol === 'http:';
    }, 'Only HTTP(S) URLs allowed'),
  dpi_override: z.number()
    .min(72, 'DPI must be at least 72')
    .max(1200, 'DPI must not exceed 1200')
    .optional(),
  photo_approval_id: z.string().uuid().optional(),
  message_id: z.string().uuid().optional(),
});

type ValidateFaceInput = z.infer<typeof validateFaceSchema>;

router.use(authenticateToken);

// POST /api/face-validation/validate — on-demand validation
router.post('/validate',
  requirePermission('bookings:manage'),
  validate(validateFaceSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const {
      image_url,
      dpi_override,
      photo_approval_id,
      message_id,
    } = req.body as ValidateFaceInput;

    const row = await validateFaceAndSave(image_url, {
      photoApprovalId: photo_approval_id,
      messageId: message_id,
      validatedBy: req.user?.id,
      dpiOverride: dpi_override,
    });

    res.json({ success: true, data: row });
  },
);

// GET /api/face-validation/by-photo/:photoApprovalId
router.get('/by-photo/:photoApprovalId', requirePermission('bookings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const row = await getByPhotoApproval(req.params['photoApprovalId']);
    res.json({ success: true, data: row });
  },
);

// GET /api/face-validation/by-message/:messageId
router.get('/by-message/:messageId', requirePermission('bookings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const row = await getByMessage(req.params['messageId']);
    res.json({ success: true, data: row });
  },
);

// GET /api/face-validation/:id
router.get('/:id', requirePermission('bookings:manage'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { rows } = await pool.query(
      'SELECT * FROM face_validations WHERE id = $1',
      [req.params['id']],
    );
    if (!rows[0]) throw new AppError(404, 'Face validation not found');
    res.json({ success: true, data: rows[0] });
  },
);

export default router;
