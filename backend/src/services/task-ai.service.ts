/**
 * AI-сервис для задач: handoff summary и shift briefing.
 * Использует Python worker (ai_chat_worker.py) через execFile.
 */
import { execFile } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database/db.js';

import { createLogger } from '../utils/logger.js';
const __dirname2 = dirname(fileURLToPath(import.meta.url));

const logger = createLogger('task-ai.service');
const PYTHON_PATH = '/var/www/apimain/multiplatformpublic/venv/bin/python3';
const WORKER_PATH = resolve(__dirname2, '../../workers/ai_chat_worker.py');
const WORKER_TIMEOUT = 25000; // 25 seconds

interface AIResult {
  text: string;
  tokensUsed: number;
}

/**
 * Вызвать AI worker с промптом и сообщениями
 */
async function callAIWorker(systemPrompt: string, messages: Array<{ role: string; text: string }>): Promise<AIResult | null> {
  const input = JSON.stringify({ systemPrompt, messages, actions: [] });

  return new Promise((resolve) => {
    const child = execFile(PYTHON_PATH, [WORKER_PATH], {
      timeout: WORKER_TIMEOUT,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stderr) {
        logger.info('[TaskAI] Worker stderr:', { detail: stderr });
      }
      if (error) {
        logger.error('[TaskAI] Worker error:', { detail: error.message });
        resolve(null);
        return;
      }
      try {
        const result = JSON.parse(stdout);
        if (result.success && result.result) {
          resolve({
            text: result.result.text,
            tokensUsed: result.result.tokensUsed || 0,
          });
        } else {
          logger.error('[TaskAI] Worker returned error:', result.error);
          resolve(null);
        }
      } catch (e) {
        logger.error('[TaskAI] Failed to parse worker output:', { error: String(e) });
        resolve(null);
      }
    });

    child.stdin?.write(input);
    child.stdin?.end();
  });
}

/**
 * Сгенерировать AI-сводку при передаче задачи (handoff)
 */
export async function generateHandoffSummary(taskId: string, handoffNote: string): Promise<string | null> {
  try {
    // Получаем задачу и её историю
    const taskResult = await pool.query(
      `SELECT t.*,
              u.display_name as client_display_name
       FROM work_tasks t
       LEFT JOIN users u ON t.client_id = u.id
       WHERE t.id = $1`,
      [taskId],
    );
    const task = taskResult.rows[0];
    if (!task) return null;

    // Получаем все заметки
    const notesResult = await pool.query(
      `SELECT tn.content, tn.note_type, tn.created_at,
              u.display_name as author_name
       FROM task_notes tn
       LEFT JOIN users u ON tn.author_id = u.id
       WHERE tn.task_id = $1
       ORDER BY tn.created_at ASC`,
      [taskId],
    );

    // Формируем контекст
    const context: string[] = [];
    context.push(`Задача #${task.task_number}: ${task.title}`);
    context.push(`Тип: ${task.task_type}, Приоритет: ${task.priority}, Статус: ${task.status}`);
    if (task.client_name) context.push(`Клиент: ${task.client_name}${task.client_phone ? ' (' + task.client_phone + ')' : ''}`);
    if (task.description) context.push(`Описание: ${task.description}`);

    if (notesResult.rows.length > 0) {
      context.push('\nИстория заметок:');
      for (const note of notesResult.rows) {
        const time = new Date(note.created_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        context.push(`[${time}] ${note.author_name || 'Система'}: ${note.content}`);
      }
    }

    context.push(`\nЗаметка при передаче: ${handoffNote}`);

    const systemPrompt = 'Ты — помощник фотостудии "Своё Фото". Составь краткую сводку (3-5 предложений) для передачи задачи следующему сотруднику. Включи: что хотел клиент, что сделано, что осталось сделать. Пиши от третьего лица, кратко и по делу.';

    const result = await callAIWorker(systemPrompt, [
      { role: 'user', text: context.join('\n') },
    ]);

    if (result) {
      logger.info(`[TaskAI] Handoff summary generated for task ${taskId}, ${result.tokensUsed} tokens`);
      return result.text;
    }
    return null;
  } catch (err) {
    logger.error('[TaskAI] generateHandoffSummary error:', { error: String(err) });
    return null;
  }
}

/**
 * Сгенерировать AI-сводку для начала смены (shift briefing)
 */
export async function generateShiftBriefing(
  employeeId: string,
  studioId: string,
  shiftDate: string,
): Promise<{ summary: string; structuredData: any } | null> {
  try {
    // Активные задачи на точке
    const activeTasksResult = await pool.query(
      `SELECT t.task_number, t.title, t.task_type, t.priority, t.status,
              t.client_name, t.client_phone, t.description, t.ai_summary,
              u.display_name as assigned_name
       FROM work_tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.assigned_studio_id = $1::uuid
         AND t.status NOT IN ('completed', 'cancelled')
       ORDER BY
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         t.created_at ASC`,
      [studioId],
    );

    // Pending handoffs для сотрудника
    const handoffsResult = await pool.query(
      `SELECT h.handoff_note, h.ai_context_summary, h.created_at,
              t.task_number, t.title, t.client_name,
              uf.display_name as from_name
       FROM task_handoffs h
       JOIN work_tasks t ON h.task_id = t.id
       LEFT JOIN users uf ON h.from_employee_id = uf.id
       WHERE (h.to_employee_id = $1 OR h.to_employee_id IS NULL)
         AND h.acknowledged = false
       ORDER BY h.created_at DESC`,
      [employeeId],
    );

    // Бронирования на сегодня для этой точки
    const bookingsResult = await pool.query(
      `SELECT b.start_time, b.end_time, b.status,
              uc.display_name as client_name,
              ps.name as service_name
       FROM bookings b
       LEFT JOIN users uc ON b.client_id = uc.id
       LEFT JOIN photo_sessions ps ON b.service_id = ps.id
       WHERE b.start_time::date = $1::date
         AND b.status != 'cancelled'
       ORDER BY b.start_time ASC`,
      [shiftDate],
    );

    const activeTasks = activeTasksResult.rows;
    const handoffs = handoffsResult.rows;
    const bookings = bookingsResult.rows;

    // Если нет данных — возвращаем простую сводку без AI
    if (activeTasks.length === 0 && handoffs.length === 0 && bookings.length === 0) {
      return {
        summary: 'Нет активных задач, передач или бронирований на сегодня.',
        structuredData: {
          active_tasks: 0,
          handed_off_tasks: 0,
          urgent_tasks: 0,
          todays_bookings: 0,
        },
      };
    }

    // Формируем контекст для AI
    const context: string[] = [];
    context.push(`Сводка для начала смены (${new Date(shiftDate).toLocaleDateString('ru-RU')}):\n`);

    if (activeTasks.length > 0) {
      context.push(`АКТИВНЫЕ ЗАДАЧИ (${activeTasks.length}):`);
      for (const t of activeTasks) {
        context.push(`  #${t.task_number} [${t.priority}] ${t.title} — ${t.client_name || 'без клиента'} (${t.status}${t.assigned_name ? ', назначена: ' + t.assigned_name : ''})`);
        if (t.ai_summary) context.push(`    AI: ${t.ai_summary}`);
      }
    }

    if (handoffs.length > 0) {
      context.push(`\nПЕРЕДАЧИ ОТ ПРОШЛОЙ СМЕНЫ (${handoffs.length}):`);
      for (const h of handoffs) {
        context.push(`  #${h.task_number} ${h.title} (от ${h.from_name || 'неизвестно'}): ${h.handoff_note || ''}`);
        if (h.ai_context_summary) context.push(`    AI-контекст: ${h.ai_context_summary}`);
      }
    }

    if (bookings.length > 0) {
      context.push(`\nБРОНИРОВАНИЯ НА СЕГОДНЯ (${bookings.length}):`);
      for (const b of bookings) {
        const time = new Date(b.start_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        context.push(`  ${time} — ${b.client_name || 'Клиент'} (${b.service_name || 'услуга'})`);
      }
    }

    const systemPrompt = 'Ты — помощник фотостудии "Своё Фото". Составь краткую сводку для сотрудника в начале смены. Выдели самое важное: срочные задачи, переданные с прошлой смены, бронирования. Пиши кратко (5-8 предложений), понятно, по делу. Используй маркированные списки.';

    const result = await callAIWorker(systemPrompt, [
      { role: 'user', text: context.join('\n') },
    ]);

    const urgentCount = activeTasks.filter((t: any) => t.priority === 'urgent').length;

    const structuredData = {
      active_tasks: activeTasks.length,
      handed_off_tasks: handoffs.length,
      urgent_tasks: urgentCount,
      todays_bookings: bookings.length,
    };

    if (result) {
      logger.info(`[TaskAI] Shift briefing generated, ${result.tokensUsed} tokens`);
      return { summary: result.text, structuredData };
    }

    // Fallback без AI — просто текстовая сводка
    const fallbackLines = [];
    if (activeTasks.length > 0) fallbackLines.push(`Активных задач: ${activeTasks.length}${urgentCount > 0 ? ` (срочных: ${urgentCount})` : ''}`);
    if (handoffs.length > 0) fallbackLines.push(`Непринятых передач: ${handoffs.length}`);
    if (bookings.length > 0) fallbackLines.push(`Бронирований на сегодня: ${bookings.length}`);

    return {
      summary: fallbackLines.join('. ') + '.',
      structuredData,
    };
  } catch (err) {
    logger.error('[TaskAI] generateShiftBriefing error:', { error: String(err) });
    return null;
  }
}

// ============================================================================
// Кэш AI-приоритизации (5 мин)
// ============================================================================
const priorityCache = new Map<string, { text: string; ts: number }>();
const PRIORITY_CACHE_TTL = 5 * 60 * 1000;

let priorityCacheCleanupInterval: ReturnType<typeof setInterval> | null = null;

function cleanupPriorityCache(): void {
  const now = Date.now();
  for (const [key, entry] of priorityCache) {
    if (now - entry.ts > PRIORITY_CACHE_TTL) {
      priorityCache.delete(key);
    }
  }
}

export function startPriorityCacheCleanup(): void {
  if (priorityCacheCleanupInterval) return;
  priorityCacheCleanupInterval = setInterval(cleanupPriorityCache, 10 * 60 * 1000);
}

export function stopPriorityCacheCleanup(): void {
  if (priorityCacheCleanupInterval) {
    clearInterval(priorityCacheCleanupInterval);
    priorityCacheCleanupInterval = null;
  }
  priorityCache.clear();
}

/**
 * AI-рекомендации по приоритизации задач рабочего дня
 */
export async function generateWorkdayPrioritization(
  employeeId: string,
  studioId: string,
): Promise<string | null> {
  const cacheKey = `${employeeId}:${studioId}`;
  const cached = priorityCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PRIORITY_CACHE_TTL) {
    return cached.text;
  }

  try {
    const tasksResult = await pool.query(
      `SELECT t.task_number, t.title, t.task_type, t.priority, t.status,
              t.client_name, t.due_date, t.description
       FROM work_tasks t
       WHERE (t.assigned_to = $1 OR (t.assigned_studio_id = $2::uuid AND t.assigned_to IS NULL))
         AND t.status NOT IN ('completed', 'cancelled')
       ORDER BY t.created_at ASC`,
      [employeeId, studioId],
    );

    const tasks = tasksResult.rows;
    if (tasks.length === 0) return null;

    const context: string[] = [];
    context.push(`Задачи на сегодня (${tasks.length}):`);
    for (const t of tasks) {
      const due = t.due_date ? `, срок: ${new Date(t.due_date).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '';
      context.push(`  #${t.task_number} [${t.priority}] ${t.title} (${t.task_type}${due}) — ${t.client_name || 'без клиента'}`);
    }

    const systemPrompt = 'Ты — помощник фотостудии "Своё Фото". Помоги расставить приоритеты. Правила: клиент на точке важнее ретуши, срочные заказы важнее внутренних задач, просроченные задачи — в первую очередь. Дай короткий совет (3-4 предложения): в каком порядке выполнять задачи.';

    const result = await callAIWorker(systemPrompt, [
      { role: 'user', text: context.join('\n') },
    ]);

    if (result) {
      logger.info(`[TaskAI] Workday prioritization generated, ${result.tokensUsed} tokens`);
      priorityCache.set(cacheKey, { text: result.text, ts: Date.now() });
      return result.text;
    }
    return null;
  } catch (err) {
    logger.error('[TaskAI] generateWorkdayPrioritization error:', { error: String(err) });
    return null;
  }
}
