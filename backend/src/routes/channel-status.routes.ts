/**
 * Channel Status Routes — public-facing availability for the website.
 *
 * GET /api/channel-status — { whatsapp: { available, checkedAt } }
 *
 * Drives the public "WhatsApp временно не работает" banner. No auth: the data is
 * non-sensitive (a single boolean) and consumed by anonymous site visitors.
 * Backed by a 5-minute Redis cache in channel-availability.service, so the live
 * provider probe runs at most once per cache window regardless of traffic.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { getWhatsappAvailability } from '../services/channel-availability.service.js';
import { createRateLimitStore } from '../middleware/rate-limit-store.js';

const router = Router();

const channelStatusLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  store: createRateLimitStore('rl:chan-status:'),
  message: { success: false, error: 'Too many requests' },
});

router.get('/', channelStatusLimiter, async (_req: Request, res: Response): Promise<void> => {
  const whatsapp = await getWhatsappAvailability();
  // Let browsers/CDN cache briefly; server-side Redis cache (300s) is the real throttle.
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ whatsapp });
});

export default router;
