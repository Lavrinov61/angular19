/**
 * Polaroid Routes — generate Polaroid-style photos for printing.
 * SECURITY: Auth required, URL whitelist (SSRF prevention), rate limiting via app.ts
 */
import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generatePolaroid, generatePolaroidBatch } from '../services/polaroid.service.js';
import { MEDIA_ALLOWED_DOMAINS } from '../config/media-domains.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('polaroid.routes');
const router = Router();

// Allowed media domains (SSRF prevention) — centralized in media-domains.ts
const allowedDomainCheck = (u: string) => {
  const url = new URL(u);
  return MEDIA_ALLOWED_DOMAINS.some(d => url.hostname === d || url.hostname?.endsWith(`.${d}`));
};

const imageUrlSchema = z.string()
  .url('Must be valid URL')
  .refine(allowedDomainCheck, 'URL must be from allowed media origins')
  .refine(u => {
    const protocol = new URL(u).protocol;
    return protocol === 'https:' || protocol === 'http:';
  }, 'Only HTTP(S) URLs allowed');

// Single generation
const generateSchema = z.object({
  image_url: imageUrlSchema,
  face_data: z.object({
    forehead_y: z.number(),
    chin_y: z.number(),
    image_width: z.number(),
    image_height: z.number(),
  }).optional(),
});

// Batch generation (up to 50 photos)
const generateBatchSchema = z.object({
  image_urls: z.array(imageUrlSchema).min(1).max(50),
});

router.use(authenticateToken);

// POST /api/polaroid/generate — single photo
router.post('/generate',
  requirePermission('catalog:manage'),
  validate(generateSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { image_url, face_data } = req.body;

    const result = await generatePolaroid(image_url, {
      faceData: face_data,
      createdBy: req.user?.id,
    });

    res.json({ success: true, data: result });
  },
);

// POST /api/polaroid/batch — multiple photos
router.post('/batch',
  requirePermission('catalog:manage'),
  validate(generateBatchSchema),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const { image_urls } = req.body;

    const result = await generatePolaroidBatch(image_urls, {
      createdBy: req.user?.id,
    });

    res.json({ success: true, data: result });
  },
);

export default router;
