/**
 * AI-помощник для сотрудников (ПЛАН 9)
 * POST /api/crm/ai-assist — задать вопрос AI с контекстом студии
 * Требует авторизации (employee / admin / manager)
 */

import { Router, type Response } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken, requirePermission, type AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import db from '../database/db.js';
import { getAIProvider } from '../services/ai-providers/index.js';

const router = Router();
router.use(authenticateToken);
router.use(requirePermission('inbox:view'));

interface AiAssistRequestContext {
  orderId?: string;
  clientPhone?: string;
  serviceType?: string;
}

interface AiAssistRequestBody {
  question: string;
  context?: AiAssistRequestContext;
}

interface AiAssistClientRow {
  display_name: string | null;
  email: string | null;
}

interface AiAssistOrderRow {
  status: string;
  total_amount: number;
  service_type: string | null;
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseAiAssistRequestBody(body: unknown): AiAssistRequestBody {
  const question = isObject(body) ? Reflect.get(body, 'question') : undefined;
  const rawContext = isObject(body) ? Reflect.get(body, 'context') : undefined;
  const context = isObject(rawContext)
    ? {
        orderId: optionalString(Reflect.get(rawContext, 'orderId')),
        clientPhone: optionalString(Reflect.get(rawContext, 'clientPhone')),
        serviceType: optionalString(Reflect.get(rawContext, 'serviceType')),
      }
    : undefined;

  return {
    question: typeof question === 'string' ? question : '',
    ...(context ? { context } : {}),
  };
}

// Загружаем knowledge_base.yaml один раз (текст, без парсинга YAML)
const PROMPTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../workers/prompts'
);

function loadKnowledgeBase(): string {
  try {
    return readFileSync(join(PROMPTS_DIR, 'knowledge_base.yaml'), 'utf-8');
  } catch {
    return 'Фотостудия «Своё Фото». Ростов-на-Дону, пер. Соборный 21. Тел: 8(901)417-86-68. Часы: Пн-Вс 9:00-19:30.';
  }
}

const KNOWLEDGE_BASE = loadKnowledgeBase();

const SYSTEM_PROMPT = `Ты — AI-помощник сотрудника фотостудии «Своё Фото».
Помогай быстро отвечать на вопросы клиентов, находить информацию, рассчитывать цены.
Отвечай кратко и по делу. Используй данные студии ниже.

=== БАЗА ЗНАНИЙ ===
${KNOWLEDGE_BASE}
=================

Правила:
- Отвечай только по теме фотостудии
- Если нет точных данных — скажи об этом честно
- Предлагай конкретные формулировки для клиентов
- Используй цифры из базы знаний`;

// POST /api/crm/ai-assist
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const { question, context } = parseAiAssistRequestBody(req.body);

  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    throw new AppError(400, 'question обязателен');
  }
  if (question.length > 1000) {
    throw new AppError(400, 'Вопрос слишком длинный (макс. 1000 символов)');
  }

  // Дополнительный контекст из БД (если переданы параметры)
  const contextParts: string[] = [];

  if (context?.clientPhone) {
    const client = await db.queryOne<AiAssistClientRow>(
      'SELECT display_name, email FROM users WHERE phone LIKE $1 LIMIT 1',
      [`%${context.clientPhone.replace(/\D/g, '').slice(-10)}`]
    );
    if (client) {
      contextParts.push(`Клиент: ${client.display_name || 'Без имени'} (${context.clientPhone})`);
    }
  }

  if (context?.orderId) {
    const order = await db.queryOne<AiAssistOrderRow>(
      'SELECT status, total_amount, service_type FROM photo_print_orders WHERE id = $1',
      [context.orderId]
    ).catch(() => null);

    if (order) {
      contextParts.push(
        `Заказ ${context.orderId}: статус=${order.status}, сумма=${order.total_amount} ₽, услуга=${order.service_type || 'не указана'}`
      );
    }
  }

  if (context?.serviceType) {
    contextParts.push(`Тип услуги: ${context.serviceType}`);
  }

  const systemWithContext = contextParts.length > 0
    ? `${SYSTEM_PROMPT}\n\n=== КОНТЕКСТ ЗАПРОСА ===\n${contextParts.join('\n')}`
    : SYSTEM_PROMPT;

  const provider = getAIProvider();

  const answer = await provider.chat([
    { role: 'system', content: systemWithContext },
    { role: 'user', content: question.trim() },
  ], {
    temperature: 0.5,
    maxTokens: 512,
  });

  res.json({
    success: true,
    data: { answer, provider: provider.name },
  });
});

export default router;
