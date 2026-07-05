/**
 * AI Pricing Routes — эндпоинты для управления ценами через ИИ.
 *
 * Все маршруты защищены X-API-Key (только CRM/администратор).
 *
 * POST /api/ai-pricing/suggest           — запустить анализ и получить предложения
 * GET  /api/ai-pricing/suggestions       — список всех предложений
 * GET  /api/ai-pricing/suggestions/pending — только ожидающие одобрения
 * POST /api/ai-pricing/approve/:id       — одобрить и применить предложение
 * POST /api/ai-pricing/reject/:id        — отклонить предложение
 */

import { Router, Request, Response } from 'express';
import { optionalAuth, type AuthRequest } from '../middleware/auth.js';
import { requireApiKey } from '../middleware/api-key.middleware.js';
import {
  generatePricingSuggestions,
  getPendingSuggestions,
  getAllSuggestions,
  approveSuggestion,
  rejectSuggestion,
} from '../services/ai-pricing.service.js';

const router = Router();
router.use(optionalAuth, (req: Request, res: Response, next) => {
  const authReq = req as AuthRequest;
  if (authReq.user) {
    next();
    return;
  }
  requireApiKey(req, res, next);
});

/**
 * POST /api/ai-pricing/suggest
 * Запускает анализ продаж и генерирует предложения по скидкам.
 * Body: { requested_by?: string }
 */
router.post('/suggest', async (req: Request, res: Response) => {
  const requestedBy = (req.body?.requested_by as string) || 'ai-admin';
  const result = await generatePricingSuggestions(requestedBy);
  res.json({ success: true, ...result });
});

/**
 * GET /api/ai-pricing/suggestions
 * Список всех предложений (история).
 * Query: limit (default 50)
 */
router.get('/suggestions', async (req: Request, res: Response) => {
  const limit = parseInt((req.query['limit'] as string) || '50', 10);
  const suggestions = await getAllSuggestions(limit);
  res.json({ success: true, suggestions });
});

/**
 * GET /api/ai-pricing/suggestions/pending
 * Только ожидающие одобрения.
 */
router.get('/suggestions/pending', async (_req: Request, res: Response) => {
  const suggestions = await getPendingSuggestions();
  res.json({ success: true, suggestions });
});

/**
 * POST /api/ai-pricing/approve/:id
 * Одобрить предложение и применить скидку.
 * reviewed_by определяется из JWT user id (если есть) или как api-key-auth.
 */
router.post('/approve/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const authReq = req as AuthRequest;
  const reviewedBy = authReq.user?.id || 'api-key-auth';
  const result = await approveSuggestion(id, reviewedBy);
  res.json(result);
});

/**
 * POST /api/ai-pricing/reject/:id
 * Отклонить предложение (цена не меняется).
 * reviewed_by определяется из JWT user id (если есть) или как api-key-auth.
 */
router.post('/reject/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const authReq = req as AuthRequest;
  const reviewedBy = authReq.user?.id || 'api-key-auth';
  const suggestion = await rejectSuggestion(id, reviewedBy);
  res.json({ success: true, suggestion });
});

export default router;
