/**
 * AI CRM Service — AI-мозг ФотоПульта
 *
 * Функции:
 * - summarizeChat() — краткое резюме диалога для задачи
 * - suggestReplies() — 3 варианта ответа оператору
 * - scoreTaskPriority() — автоприоритет задачи по содержимому
 * - suggestAssignment() — рекомендация кому назначить задачу
 * - generateFollowUp() — текст follow-up сообщения клиенту
 * - generateInsights() — аналитика и прогнозы
 *
 * Используем callAIWorker из ai-chat.service.ts (Yandex AI Studio SDK).
 */

import { execFile } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database/db.js';
import db from '../database/db.js';
import { config } from '../config/index.js';
import type {
  AbandonedChatRow,
  AiCrmConversationSummaryRow,
  AssignmentTaskRow,
  DailyCountRow,
  DailyOrderStatsRow,
  EmployeeBriefRow,
  NoShowBookingRow,
  OnShiftEmployeeRow,
  OrderHistoryStatsRow,
  TaskCountRow,
} from '../types/views/ai-crm-views.js';

import { createLogger } from '../utils/logger.js';
const __dirname2 = dirname(fileURLToPath(import.meta.url));

const logger = createLogger('ai-crm.service');
// ============================================================================
// Types
// ============================================================================

export interface ChatSummary {
  summary: string;
  clientIntent: string;
  keyFacts: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

export interface SuggestedReply {
  text: string;
  tone: 'friendly' | 'professional' | 'urgent';
}

export interface PriorityScore {
  priority: 'low' | 'normal' | 'urgent' | 'vip';
  reason: string;
  confidence: number;
}

export interface AssignmentSuggestion {
  employeeId: string;
  employeeName: string;
  reason: string;
  score: number;
}

export interface FollowUpMessage {
  text: string;
  channel: 'chat' | 'sms' | 'push';
  delay_minutes: number;
}

export interface CRMInsights {
  forecast: { date: string; expectedOrders: number; expectedRevenue: number }[];
  recommendations: string[];
  trends: { metric: string; direction: 'up' | 'down' | 'stable'; change: number }[];
}

// ============================================================================
// Constants
// ============================================================================

const PYTHON_PATH = '/var/www/apimain/multiplatformpublic/venv/bin/python3';
const WORKER_PATH = resolve(__dirname2, '../../workers/ai_chat_worker.py');
const WORKER_TIMEOUT_MS = 30_000;

// ============================================================================
// Core AI caller (reuses same worker as ai-chat.service.ts)
// ============================================================================

interface AIResult {
  text: string;
}

async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
  // Старый LLM-воркер отключён флагом — не спавним python/Gemini (backstop для
  // всех вызывающих; горячие функции отсекаются раньше своими фолбэками).
  if (!config.ai.crmLegacyEnabled) {
    throw new Error('ai-crm legacy worker disabled (AI_CRM_LEGACY_ENABLED=false)');
  }

  const messages = [{ role: 'user' as const, text: userMessage }];

  return new Promise((resolve, reject) => {
    const child = execFile(
      PYTHON_PATH,
      [WORKER_PATH],
      { timeout: WORKER_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (stderr) logger.info(`[AI-CRM Worker stderr] ${stderr}`);
        if (error) {
          reject(new Error(`AI worker failed: ${error.message}`));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (result.success) {
            resolve(result.result?.text || '');
          } else {
            reject(new Error(`AI worker error: ${result.error}`));
          }
        } catch (parseErr) {
          reject(new Error(`Failed to parse AI worker output: ${stdout}`));
        }
      },
    );

    const input = JSON.stringify({
      systemPrompt,
      messages,
      actions: [],
      channel: 'online',
    });
    child.stdin?.write(input);
    child.stdin?.end();
  });
}

// ============================================================================
// A1: Chat Summarization
// ============================================================================

export async function summarizeChat(sessionId: string): Promise<ChatSummary> {
  // Старый LLM-воркер отключён — отдаём нейтральное резюме без вызова Gemini.
  if (!config.ai.crmLegacyEnabled) {
    return { summary: 'AI-резюме отключено.', clientIntent: 'unknown', keyFacts: [], sentiment: 'neutral' };
  }
  // Загрузить последние 30 сообщений
  const result = await pool.query(
    `SELECT sender_type, content, message_type, created_at
     FROM messages
     WHERE conversation_id = $1
       AND content IS NOT NULL AND content != ''
       AND message_type = 'text'
     ORDER BY created_at ASC
     LIMIT 30`,
    [sessionId],
  );

  if (result.rows.length === 0) {
    return {
      summary: 'Пустой диалог — сообщений нет.',
      clientIntent: 'unknown',
      keyFacts: [],
      sentiment: 'neutral',
    };
  }

  // Загрузить контекст сессии
  const session = await db.queryOne<AiCrmConversationSummaryRow>(
    `SELECT visitor_name, channel, selected_service, selected_price, context
     FROM conversations WHERE id = $1`,
    [sessionId],
  );

  const transcript = result.rows
    .map((m: { sender_type: string; content: string }) => {
      const label = m.sender_type === 'visitor' ? 'Клиент' : m.sender_type === 'operator' ? 'Оператор' : 'Бот';
      return `${label}: ${m.content}`;
    })
    .join('\n');

  const contextInfo = session
    ? `Имя клиента: ${session.visitor_name || 'неизвестно'}. Канал: ${session.channel || 'online'}. Услуга: ${session.selected_service || 'не выбрана'}. Цена: ${session.selected_price || 'не указана'}.`
    : '';

  const systemPrompt = `Ты — AI-ассистент CRM фотостудии. Проанализируй диалог и верни JSON:
{
  "summary": "Краткое резюме в 2-3 предложениях — что хотел клиент, к чему пришли",
  "clientIntent": "Одно слово/фраза: цель клиента (фото_на_документ, печать, запись, вопрос_о_ценах, жалоба, etc.)",
  "keyFacts": ["факт1", "факт2", "факт3"],
  "sentiment": "positive/neutral/negative"
}
Отвечай ТОЛЬКО JSON, без markdown, без пояснений.`;

  const userMsg = `${contextInfo}\n\nДиалог:\n${transcript}`;

  try {
    const aiResponse = await callAI(systemPrompt, userMsg);
    // Парсим JSON из ответа
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || 'Не удалось создать резюме.',
        clientIntent: parsed.clientIntent || 'unknown',
        keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts.slice(0, 5) : [],
        sentiment: ['positive', 'neutral', 'negative'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
      };
    }
    return { summary: aiResponse.slice(0, 300), clientIntent: 'unknown', keyFacts: [], sentiment: 'neutral' };
  } catch (err) {
    logger.error('[AI-CRM] summarizeChat error:', { error: String(err) });
    return { summary: 'Ошибка AI — попробуйте позже.', clientIntent: 'unknown', keyFacts: [], sentiment: 'neutral' };
  }
}

// ============================================================================
// A2: Suggested Replies
// ============================================================================

export async function suggestReplies(sessionId: string): Promise<SuggestedReply[]> {
  // Старый LLM-воркер отключён — отдаём общие шаблоны без вызова Gemini.
  if (!config.ai.crmLegacyEnabled) {
    return [
      { text: 'Здравствуйте! Чем могу помочь?', tone: 'friendly' },
      { text: 'Добрый день! Подскажите, какая услуга вас интересует?', tone: 'professional' },
      { text: 'Здравствуйте! Готов помочь — напишите ваш вопрос.', tone: 'friendly' },
    ];
  }
  const result = await pool.query(
    `SELECT sender_type, content FROM messages
     WHERE conversation_id = $1 AND message_type = 'text'
       AND content IS NOT NULL AND content != ''
     ORDER BY created_at DESC LIMIT 10`,
    [sessionId],
  );

  if (result.rows.length === 0) {
    return [
      { text: 'Здравствуйте! Чем могу помочь?', tone: 'friendly' },
      { text: 'Добрый день! Какая услуга вас интересует?', tone: 'professional' },
      { text: 'Привет! Подскажу по ценам и услугам — спрашивайте 😊', tone: 'friendly' },
    ];
  }

  const transcript = result.rows
    .reverse()
    .map((m: { sender_type: string; content: string }) => {
      const label = m.sender_type === 'visitor' ? 'Клиент' : m.sender_type === 'operator' ? 'Оператор' : 'Бот';
      return `${label}: ${m.content}`;
    })
    .join('\n');

  const systemPrompt = `Ты — AI-ассистент для оператора фотостудии «Своё Фото». На основе диалога предложи 3 варианта ответа оператора клиенту.

Правила:
- Каждый ответ — 1-2 предложения, от лица оператора
- Первый вариант — дружелюбный, второй — деловой, третий — если клиент торопится (срочный/проактивный)
- НЕ используй маркдаун, НЕ используй эмодзи
- Если клиент спрашивает цену — назови примерную (фото на документы: от 700₽, печать 10x15: от 15₽)
- Если клиент готов заказать — предложи следующий шаг

Верни JSON массив:
[
  {"text": "...", "tone": "friendly"},
  {"text": "...", "tone": "professional"},
  {"text": "...", "tone": "urgent"}
]
Отвечай ТОЛЬКО JSON, без markdown.`;

  try {
    const aiResponse = await callAI(systemPrompt, `Диалог:\n${transcript}`);
    const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length >= 1) {
        return parsed.slice(0, 3).map((r: { text: string; tone: string }) => ({
          text: r.text || '',
          tone: (['friendly', 'professional', 'urgent'].includes(r.tone) ? r.tone : 'friendly') as SuggestedReply['tone'],
        }));
      }
    }
    return [{ text: aiResponse.slice(0, 200), tone: 'friendly' }];
  } catch (err) {
    logger.error('[AI-CRM] suggestReplies error:', { error: String(err) });
    return [
      { text: 'Здравствуйте! Чем могу помочь?', tone: 'friendly' },
      { text: 'Добрый день! Подскажите, какая услуга вас интересует?', tone: 'professional' },
    ];
  }
}

// ============================================================================
// A3: Auto-Assignment
// ============================================================================

export async function suggestAssignment(taskId: string): Promise<AssignmentSuggestion[]> {
  // 1. Получить информацию о задаче
  const task = await db.queryOne<AssignmentTaskRow>(
    `SELECT id, title, task_type, priority, assigned_studio_id, description
     FROM work_tasks WHERE id = $1`,
    [taskId],
  );
  if (!task) return [];

  // 2. Найти сотрудников на текущей смене
  const onShiftEmployees = await db.query<OnShiftEmployeeRow>(
    `SELECT u.id, u.id as user_id, u.name, s.studio_id
     FROM users u
     JOIN shifts s ON s.employee_id = u.id
     WHERE s.status = 'active'
       AND s.started_at >= NOW() - INTERVAL '16 hours'
     ORDER BY s.started_at DESC`,
  );

  if (onShiftEmployees.length === 0) {
    // Фоллбэк — все сотрудники с ролью employee/admin
    const allEmployees = await db.query<EmployeeBriefRow>(
      `SELECT id, name FROM users WHERE role IN ('admin', 'employee') AND name IS NOT NULL LIMIT 10`,
    );
    return allEmployees.map((e) => ({
      employeeId: e.id,
      employeeName: e.name,
      reason: 'Нет активных смен — предложен из списка сотрудников',
      score: 50,
    }));
  }

  // 3. Посчитать текущую загрузку каждого сотрудника
  const suggestions: AssignmentSuggestion[] = [];

  for (const emp of onShiftEmployees) {
    const taskCount = await db.queryOne<TaskCountRow>(
      `SELECT COUNT(*) as cnt FROM work_tasks
       WHERE assigned_to = $1 AND status IN ('new', 'in_progress', 'waiting')`,
      [emp.user_id],
    );
    const activeTaskCount = parseInt(taskCount?.cnt || '0', 10);

    // Бонус за ту же студию
    const studioBonus = task.assigned_studio_id && emp.studio_id === task.assigned_studio_id ? 20 : 0;

    // Чем меньше задач — тем выше score (макс 100)
    const loadScore = Math.max(0, 100 - activeTaskCount * 15);
    const totalScore = loadScore + studioBonus;

    suggestions.push({
      employeeId: emp.user_id,
      employeeName: emp.name,
      reason: `На смене, ${activeTaskCount} активных задач${studioBonus ? ', та же студия' : ''}`,
      score: Math.min(totalScore, 100),
    });
  }

  // Сортировать по score (лучший первым)
  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, 3);
}

/**
 * Auto-assign: выбрать лучшего сотрудника и назначить задачу.
 * Возвращает ID назначенного или null если не удалось.
 */
export async function autoAssignTask(taskId: string): Promise<string | null> {
  const suggestions = await suggestAssignment(taskId);
  if (suggestions.length === 0) return null;

  const best = suggestions[0];
  if (best.score < 30) return null; // Слишком перегружены

  await db.query(
    `UPDATE work_tasks SET assigned_to = $1, updated_at = NOW() WHERE id = $2`,
    [best.employeeId, taskId],
  );

  logger.info(`[AI-CRM] Auto-assigned task ${taskId} to ${best.employeeName} (score: ${best.score})`);
  return best.employeeId;
}

// ============================================================================
// A4: Priority Scoring
// ============================================================================

export async function scoreTaskPriority(
  title: string,
  description: string,
  clientPhone?: string,
): Promise<PriorityScore> {
  // Быстрые правила (без AI) — ключевые слова
  const urgentKeywords = ['срочно', 'сегодня', 'через час', 'прямо сейчас', 'немедленно', 'asap', 'свадьба завтра'];
  const vipKeywords = ['vip', 'вип', 'корпоративный', 'массовый заказ', 'оптом'];
  const lowerTitle = (title + ' ' + description).toLowerCase();

  // Проверить VIP-клиента по истории заказов
  let isRepeatClient = false;
  let orderCount = 0;
  if (clientPhone) {
    const history = await db.queryOne<OrderHistoryStatsRow>(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as total
       FROM orders WHERE metadata->>'contact'->>'phone' = $1 OR metadata @> $2`,
      [clientPhone, JSON.stringify({ contact: { phone: clientPhone } })],
    );
    orderCount = parseInt(history?.cnt || '0', 10);
    if (orderCount >= 5) isRepeatClient = true;
  }

  // VIP: много заказов ИЛИ ключевые слова
  if (isRepeatClient || vipKeywords.some(k => lowerTitle.includes(k))) {
    return {
      priority: 'vip',
      reason: isRepeatClient ? `Постоянный клиент (${orderCount} заказов)` : 'VIP-ключевое слово в описании',
      confidence: 0.9,
    };
  }

  // Urgent: ключевые слова срочности
  if (urgentKeywords.some(k => lowerTitle.includes(k))) {
    return {
      priority: 'urgent',
      reason: 'Срочность в описании задачи',
      confidence: 0.85,
    };
  }

  // Для более сложных случаев — AI-анализ
  try {
    const systemPrompt = `Ты определяешь приоритет задачи в CRM фотостудии. Категории:
- "low": несрочное, информационное, можно отложить
- "normal": стандартный заказ, без спешки
- "urgent": клиент торопится, заказ на сегодня-завтра, проблема
- "vip": корпоративный клиент, массовый заказ, VIP

Верни JSON: {"priority": "...", "reason": "причина в 1 предложении", "confidence": 0.0-1.0}
Только JSON.`;

    const aiResponse = await callAI(systemPrompt, `Задача: ${title}\nОписание: ${description}`);
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validPriorities = ['low', 'normal', 'urgent', 'vip'];
      if (validPriorities.includes(parsed.priority)) {
        return {
          priority: parsed.priority,
          reason: parsed.reason || 'AI-оценка',
          confidence: Math.min(Math.max(parsed.confidence || 0.5, 0), 1),
        };
      }
    }
  } catch (err) {
    logger.error('[AI-CRM] scoreTaskPriority AI error:', { error: String(err) });
  }

  return { priority: 'normal', reason: 'Стандартный приоритет', confidence: 0.5 };
}

// ============================================================================
// A5: Auto-Follow-Up
// ============================================================================

export async function generateFollowUp(
  type: 'no_show' | 'review_request' | 'win_back' | 'abandoned_chat',
  context: {
    clientName?: string;
    serviceName?: string;
    daysSinceLastVisit?: number;
    bookingDate?: string;
  },
): Promise<FollowUpMessage> {
  const templates: Record<string, FollowUpMessage> = {
    no_show: {
      text: `${context.clientName || 'Здравствуйте'}! Вы записывались к нам на ${context.bookingDate || 'сегодня'}, но мы вас не дождались. Хотите перенести на удобное время? Напишите, и мы подберём ближайший слот 📸`,
      channel: 'chat',
      delay_minutes: 120,
    },
    review_request: {
      text: `${context.clientName || 'Здравствуйте'}! Спасибо, что были у нас! Будем рады, если оставите отзыв — это помогает нам становиться лучше. Ссылка: https://2gis.ru/rostov-on-don/firm/70000001006548410`,
      channel: 'push',
      delay_minutes: 1440, // 24 часа
    },
    win_back: {
      text: `${context.clientName || 'Здравствуйте'}! Давно не виделись 😊 У нас обновились услуги и цены. Может, пора обновить фото на документы? Записаться можно прямо в чате!`,
      channel: 'chat',
      delay_minutes: 0, // Batch-рассылка
    },
    abandoned_chat: {
      text: `Если остались вопросы — я здесь, пишите! Могу помочь с выбором услуги или записать на удобное время.`,
      channel: 'chat',
      delay_minutes: 15,
    },
  };

  return templates[type] || templates['abandoned_chat'];
}

/**
 * Найти сессии для auto-follow-up и сгенерировать сообщения.
 */
export async function findFollowUpCandidates(): Promise<Array<{
  sessionId: string;
  type: string;
  message: FollowUpMessage;
}>> {
  const candidates: Array<{ sessionId: string; type: string; message: FollowUpMessage }> = [];

  // 1. Брошенные чаты: последнее сообщение от бота/оператора > 15 мин назад, нет ответа
  const abandoned = await db.query<AbandonedChatRow>(
    `SELECT DISTINCT ON (m.conversation_id) m.conversation_id AS session_id, c.visitor_name
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.sender_type IN ('bot', 'operator')
       AND m.created_at > NOW() - INTERVAL '2 hours'
       AND m.created_at < NOW() - INTERVAL '15 minutes'
       AND c.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM messages newer
         WHERE newer.conversation_id = m.conversation_id
           AND newer.created_at > m.created_at
       )
     ORDER BY m.conversation_id, m.created_at DESC
     LIMIT 10`,
  );

  for (const row of abandoned) {
    const msg = await generateFollowUp('abandoned_chat', { clientName: row.visitor_name });
    candidates.push({ sessionId: row.session_id, type: 'abandoned_chat', message: msg });
  }

  // 2. No-show бронирования: на сегодня, статус != completed/cancelled
  const noShows = await db.query<NoShowBookingRow>(
    `SELECT id, client_name, start_time::text FROM bookings
     WHERE start_time::date = CURRENT_DATE
       AND start_time < NOW() - INTERVAL '2 hours'
       AND status NOT IN ('completed', 'cancelled', 'no_show')
     LIMIT 10`,
  );

  for (const booking of noShows) {
    const msg = await generateFollowUp('no_show', {
      clientName: booking.client_name,
      bookingDate: new Date(booking.start_time).toLocaleDateString('ru-RU'),
    });
    candidates.push({ sessionId: booking.id, type: 'no_show', message: msg });
  }

  return candidates;
}

// ============================================================================
// A6: Insights
// ============================================================================

export async function generateInsights(): Promise<CRMInsights> {
  // Собираем данные за последние 30 дней
  const [ordersData, bookingsData, chatData] = await Promise.all([
    db.query<DailyOrderStatsRow>(
      `SELECT date_trunc('day', created_at)::date::text as day,
              COUNT(*) as cnt,
              COALESCE(SUM(total_amount), 0) as revenue
       FROM orders
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day`,
    ),
    db.query<DailyCountRow>(
      `SELECT date_trunc('day', start_time)::date::text as day, COUNT(*) as cnt
       FROM bookings
       WHERE start_time > NOW() - INTERVAL '30 days' AND status != 'cancelled'
       GROUP BY day ORDER BY day`,
    ),
    db.query<DailyCountRow>(
      `SELECT date_trunc('day', created_at)::date::text as day, COUNT(*) as cnt
       FROM conversations
       WHERE created_at > NOW() - INTERVAL '30 days'
       GROUP BY day ORDER BY day`,
    ),
  ]);

  // Средние значения по дням недели
  const avgByDow = new Map<number, { orders: number; revenue: number; count: number }>();
  for (const row of ordersData) {
    const dow = new Date(row.day).getDay();
    const existing = avgByDow.get(dow) || { orders: 0, revenue: 0, count: 0 };
    existing.orders += parseInt(row.cnt, 10);
    existing.revenue += parseFloat(row.revenue);
    existing.count += 1;
    avgByDow.set(dow, existing);
  }

  // Прогноз на 7 дней
  const forecast: CRMInsights['forecast'] = [];
  for (let i = 1; i <= 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dow = date.getDay();
    const avg = avgByDow.get(dow);
    forecast.push({
      date: date.toISOString().split('T')[0],
      expectedOrders: avg ? Math.round(avg.orders / Math.max(avg.count, 1)) : 0,
      expectedRevenue: avg ? Math.round(avg.revenue / Math.max(avg.count, 1)) : 0,
    });
  }

  // Тренды
  const trends: CRMInsights['trends'] = [];

  // Тренд заказов: сравниваем последние 7 дней vs предыдущие 7
  const recentOrders = ordersData.filter(r => {
    const d = new Date(r.day);
    const daysAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 7;
  });
  const prevOrders = ordersData.filter(r => {
    const d = new Date(r.day);
    const daysAgo = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo > 7 && daysAgo <= 14;
  });

  const recentTotal = recentOrders.reduce((s, r) => s + parseInt(r.cnt, 10), 0);
  const prevTotal = prevOrders.reduce((s, r) => s + parseInt(r.cnt, 10), 0);
  const ordersChange = prevTotal > 0 ? Math.round(((recentTotal - prevTotal) / prevTotal) * 100) : 0;

  trends.push({
    metric: 'Заказы',
    direction: ordersChange > 5 ? 'up' : ordersChange < -5 ? 'down' : 'stable',
    change: ordersChange,
  });

  const recentRevenue = recentOrders.reduce((s, r) => s + parseFloat(r.revenue), 0);
  const prevRevenue = prevOrders.reduce((s, r) => s + parseFloat(r.revenue), 0);
  const revenueChange = prevRevenue > 0 ? Math.round(((recentRevenue - prevRevenue) / prevRevenue) * 100) : 0;

  trends.push({
    metric: 'Выручка',
    direction: revenueChange > 5 ? 'up' : revenueChange < -5 ? 'down' : 'stable',
    change: revenueChange,
  });

  const recentChats = chatData.filter(r => {
    const daysAgo = (Date.now() - new Date(r.day).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo <= 7;
  }).reduce((s, r) => s + parseInt(r.cnt, 10), 0);
  const prevChats = chatData.filter(r => {
    const daysAgo = (Date.now() - new Date(r.day).getTime()) / (1000 * 60 * 60 * 24);
    return daysAgo > 7 && daysAgo <= 14;
  }).reduce((s, r) => s + parseInt(r.cnt, 10), 0);
  const chatsChange = prevChats > 0 ? Math.round(((recentChats - prevChats) / prevChats) * 100) : 0;

  trends.push({
    metric: 'Чаты',
    direction: chatsChange > 5 ? 'up' : chatsChange < -5 ? 'down' : 'stable',
    change: chatsChange,
  });

  // Рекомендации
  const recommendations: string[] = [];

  // Определить загруженные дни
  const busiestDay = forecast.reduce((max, f) => f.expectedOrders > max.expectedOrders ? f : max, forecast[0]);
  if (busiestDay && busiestDay.expectedOrders > 0) {
    const dayName = new Date(busiestDay.date).toLocaleDateString('ru-RU', { weekday: 'long' });
    recommendations.push(`Пиковый день — ${dayName} (${busiestDay.date}): ожидается ~${busiestDay.expectedOrders} заказов. Рекомендуется доп. сотрудник.`);
  }

  if (ordersChange < -15) {
    recommendations.push(`Заказы упали на ${Math.abs(ordersChange)}% за неделю. Рассмотрите акцию или рассылку.`);
  }

  if (recentChats > recentTotal * 3) {
    recommendations.push(`Конверсия чатов низкая: ${recentChats} чатов → ${recentTotal} заказов. Проверьте скорость ответа операторов.`);
  }

  return { forecast, recommendations, trends };
}
