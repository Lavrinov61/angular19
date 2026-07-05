/**
 * AI CRM Routes — API для AI-автоматизации ФотоПульта
 */

import { Router, Response } from 'express';
import { authenticateToken, requirePermission, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  summarizeChat,
  suggestReplies,
  suggestAssignment,
  autoAssignTask,
  scoreTaskPriority,
  generateFollowUp,
  findFollowUpCandidates,
  generateInsights,
} from '../services/ai-crm.service.js';

const router = Router();
// AI CRM — только сотрудники, умеющие работать с inbox
router.use(authenticateToken, requirePermission('inbox:view'));

// ─── A1: Chat Summarization ──────────────────────────────

/**
 * GET /api/ai-crm/summary/:sessionId
 * Получить AI-резюме чата для задачи
 */
router.get('/summary/:sessionId', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { sessionId } = req.params;
  const summary = await summarizeChat(sessionId);
  res.json({ success: true, data: summary });
});

// ─── A2: Suggested Replies ───────────────────────────────

/**
 * GET /api/ai-crm/suggestions/:sessionId
 * Получить 3 варианта ответа для оператора
 */
router.get('/suggestions/:sessionId', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { sessionId } = req.params;
  const replies = await suggestReplies(sessionId);
  res.json({ success: true, data: replies });
});

// ─── A3: Auto-Assignment ─────────────────────────────────

/**
 * GET /api/ai-crm/assignment/:taskId
 * Получить рекомендации по назначению задачи
 */
router.get('/assignment/:taskId', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { taskId } = req.params;
  const suggestions = await suggestAssignment(taskId);
  res.json({ success: true, data: suggestions });
});

/**
 * POST /api/ai-crm/auto-assign/:taskId
 * Автоматически назначить задачу лучшему кандидату
 */
router.post('/auto-assign/:taskId', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { taskId } = req.params;
  const assignedTo = await autoAssignTask(taskId);

  if (assignedTo) {
    res.json({ success: true, data: { assignedTo } });
  } else {
    res.json({ success: false, error: 'no_suitable_employee', message: 'Не удалось найти подходящего сотрудника' });
  }
});

// ─── A4: Priority Scoring ────────────────────────────────

/**
 * POST /api/ai-crm/priority
 * Определить приоритет задачи по содержимому
 */
router.post('/priority', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { title, description, clientPhone } = req.body;
  if (!title) {
    throw new AppError(400, 'title is required');
  }

  const score = await scoreTaskPriority(title, description || '', clientPhone);
  res.json({ success: true, data: score });
});

// ─── A5: Follow-Up ───────────────────────────────────────

/**
 * GET /api/ai-crm/follow-up/candidates
 * Найти клиентов для автоматического follow-up
 */
router.get('/follow-up/candidates', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const candidates = await findFollowUpCandidates();
  res.json({ success: true, data: candidates });
});

/**
 * POST /api/ai-crm/follow-up/generate
 * Сгенерировать follow-up сообщение
 */
router.post('/follow-up/generate', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const { type, context } = req.body;
  const validTypes = ['no_show', 'review_request', 'win_back', 'abandoned_chat'];
  if (!type || !validTypes.includes(type)) {
    throw new AppError(400, 'Valid type required: ' + validTypes.join(', '));
  }

  const message = await generateFollowUp(type, context || {});
  res.json({ success: true, data: message });
});

// ─── A6: Insights ────────────────────────────────────────

/**
 * GET /api/ai-crm/insights
 * Получить AI-аналитику: прогнозы, тренды, рекомендации
 */
router.get('/insights', async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) throw new AppError(401, 'Unauthorized');

  const insights = await generateInsights();
  res.json({ success: true, data: insights });
});

export default router;
