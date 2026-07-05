/**
 * Omnichannel v2 — AI Turn Worker (Этап 2, связующее ядро).
 *
 * Очередь `omni-ai-turn`: один «ход бота» на диалог. Отделена от горячего
 * конвейера сообщений (omni-inbound/omni-outbound), чтобы дорогой и медленный
 * ход модели НЕ блокировал доставку и приём сообщений живых операторов.
 *
 * Поток (enqueueAiTurn -> processAiTurn):
 *   inbound-worker (S4) после INSERT сообщения клиента ставит ход в очередь с
 *   дебаунсом AGENT_DEBOUNCE_MS и КОАЛЕСИНГОМ по conversationId: пока клиент
 *   досылает сообщения, отложенный ход переставляется заново (один ответ на
 *   серию реплик, а не на каждую). Затем processAiTurn проводит ход через
 *   набор гейтов и, если все пройдены, генерирует ответ и ставит его в
 *   omni-outbound.
 *
 * Гейты processAiTurn (порядок важен — дешёвое и критичное раньше дорогого):
 *   (0) KILLSWITCH: Redis `ai:enabled` == 'false' -> no-op (мгновенный стоп).
 *       Fail-CLOSED: при недоступном Redis ход подавляется (бот пишет наружу
 *       реальным людям — последний стоп-кран должен сработать и в деградации).
 *   (1) SINGLETON-LOCK (P0 dev-защита): обрабатывает ТОЛЬКО держатель выделенного
 *       advisory-lock AI_TURN_LOCK_ID. dev и prod делят одну БД, поэтому лок —
 *       глобальный singleton: ход исполняет один процесс на сервер (в prod это
 *       worker-outbound, см. startAiTurnWorker). Лок ОТДЕЛЬНЫЙ от scheduler-leader
 *       (737001) — здесь свой id, чтобы не конкурировать со scheduler-процессом.
 *       Иначе dev-процесс (`dev:worker-outbound`) ответил бы реальному клиенту.
 *   (2) Перечитать conversation: mode != 'bot' -> молчим (off / перехвачен).
 *   (3) classifyInbound: skip -> ничего; handoff -> эскалация оператору (громко).
 *   (4) runAgentTurn(mode:'bot') -> генерация текста (без отправки).
 *   (5) CAS-гейт turn_count: если оператор перехватил пока бот думал -> suppress.
 *   (6) INSERT messages(bot/system) + enqueueOutbound(dedupKey='ai:'+runId).
 *
 * Идемпотентность отправки — через dedupKey по runId: повтор хода (ретрай джоба)
 * не плодит второе исходящее (ON CONFLICT в outbound_queue, см. enqueueOutbound).
 */

import { Worker, Queue } from 'bullmq';
import type { PoolClient } from 'pg';
import db from '../../../database/db.js';
import { pool } from '../../../database/db.js';
import { config } from '../../../config/index.js';
import { createLogger } from '../../../utils/logger.js';
import { captureException } from '../../../utils/error-tracker.js';
import { getCrmRedis } from '../../redis-cache.service.js';
import { broadcastToRoom } from '../../../websocket/broadcast-to-room.js';
import { enqueueCrmEvent } from '../../crm-event-queue.service.js';
import { runAgentTurn } from '../../ai-agent/ai-agent-orchestrator.service.js';
import { classifyInbound } from '../../ai-agent/ai-agent-classifier.js';
import type { ToolContext } from '../../ai-agent/ai-agent-tools.js';
import type { ChatMessage } from '../../ai-providers/provider.interface.js';
import {
  formatAiVisibleMessageContent,
  isAiMediaOnlyMessage,
  loadAiVisibleHistoryRows,
  type AiVisibleHistoryRow,
} from '../../ai-agent/ai-visible-history.js';
import { enqueueOutbound } from './outbound-worker.js';
import { autoAssignOperator } from '../../auto-assign.service.js';
import type { ChannelType } from '../core/types.js';

const log = createLogger('ai-turn-worker');

// ─── Настройки ───────────────────────────────────────────────────────────────

/**
 * Дебаунс хода, мс. Откладываем запуск, чтобы серия быстрых реплик клиента
 * схлопнулась в один ход (см. коалесинг в enqueueAiTurn). Переопределяется env.
 */
const AGENT_DEBOUNCE_MS = (() => {
  const raw = Number.parseInt(process.env['AGENT_DEBOUNCE_MS'] ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 4_000;
})();

/** jobId хода: один отложенный ход на диалог (база коалесинга).
 *  Подчёркивание, НЕ двоеточие: BullMQ запрещает ':' в custom job id
 *  (Error: Custom Id cannot contain ':') — иначе enqueueAiTurn падает. */
export function turnJobId(conversationId: string): string {
  return `ai_${conversationId}`;
}

/** Сколько последних сообщений диалога подмешиваем classifyInbound для контекста. */
const CLASSIFY_HISTORY_LIMIT = 8;

/**
 * Короткое сервисное подтверждение на голые вложения (файлы/фото на печать) —
 * НЕ оформление заказа: бот один раз говорит «получили, готовим / подойдите на
 * кассу», без конкретных цен/сроков. Без `**`-разметки и без тире (outbound не
 * ставит parse_mode; правило копирайта no-em-dash).
 */
const FILES_ACK_TEXT =
  'Спасибо, файлы получили, уже готовим их к печати. Если удобно, подойдите на ' +
  'кассу на Соборном 21, и мы всё распечатаем. Подскажите, ' +
  'если есть пожелания по формату или количеству.';

// ─── BullMQ setup ──────────────────────────────────────────────────────────────

const redisOpts = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  tls: config.redis.tls,
  maxRetriesPerRequest: null as null,
};

const aiTurnQueue = new Queue('omni-ai-turn', { connection: { ...redisOpts } });

interface AiTurnJobData {
  conversationId: string;
  triggerMessageId: string;
  channel: ChannelType;
}

interface AiTurnProcessJob {
  data: AiTurnJobData;
}

// ─── Singleton lock (P0 dev-защита) ───────────────────────────────────────────

/**
 * Выделенный PG advisory-lock для ai-turn-worker. ОТДЕЛЬНЫЙ от scheduler-leader
 * (737001): ход бота крутится в worker-outbound, который НЕ участвует в выборах
 * scheduler-лидера, поэтому полагаться на getLeaderStatus() нельзя (там всегда
 * follower). Свой id даёт независимый singleton, не конкурирующий со scheduler.
 *
 * dev и prod делят ОДНУ базу — лок глобален поперёк обоих: ход исполняет ровно
 * один процесс на сервер. В prod держатель — постоянно живущий worker-outbound
 * (берёт лок при старте). dev-процесс (`dev:worker-outbound`, если запущен) лок
 * не получит -> processAiTurn у него no-op -> dev НЕ пишет реальным клиентам.
 * Это и есть критерий «dev не отвечает», обеспеченный механизмом БД, а не env
 * (флаг AI_AGENT_ENABLED — включатель тёмного запуска, в dev он как раз true).
 *
 * ВТОРАЯ защита (defense-in-depth) — NODE_ENV='production': prod-процессы имеют
 * его из ecosystem.config.cjs, dev (`dev:worker-outbound` через tsx watch) — нет
 * (dev .env = development). Лок свободен лишь в узкое окно рестарта prod (деплой);
 * теоретически dev мог бы его перехватить. NODE_ENV-гейт не даёт dev даже ПЫТАТЬСЯ
 * брать лок -> окно закрыто. Лок = singleton-гарантия, NODE_ENV = dev/prod-граница.
 */
const AI_TURN_LOCK_ID = 737002;
const LOCK_RETRY_MS = 30_000;
const LOCK_HEARTBEAT_MS = 60_000;

let lockClient: PoolClient | null = null;
let aiWorkerIsLeader = false;
let lockRetryTimer: ReturnType<typeof setInterval> | null = null;
let lockHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
let devGuardLogged = false;

/** Текущий процесс держит singleton-лок ai-turn-worker (только он исполняет ходы). */
export function isAiTurnLeader(): boolean {
  return aiWorkerIsLeader;
}

/** Попытаться захватить advisory-lock. Идемпотентно: если уже держим — no-op. */
async function tryAcquireAiTurnLock(): Promise<void> {
  if (aiWorkerIsLeader) return;

  // Вторая защита: вне production вообще не претендуем на лок (закрывает окно
  // рестарта prod, когда лок на миг свободен). Логируем единожды, чтобы retry
  // не спамил лог каждые LOCK_RETRY_MS.
  if (config.server.nodeEnv !== 'production') {
    if (!devGuardLogged) {
      log.info('ai-turn lock: NODE_ENV!=production -> не претендуем (dev НЕ отвечает клиентам)', {
        nodeEnv: config.server.nodeEnv,
      });
      devGuardLogged = true;
    }
    return;
  }

  try {
    const client = await pool.connect();
    const { rows } = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [AI_TURN_LOCK_ID],
    );

    if (rows[0]?.acquired) {
      lockClient = client;
      aiWorkerIsLeader = true;
      log.info('ai-turn singleton-лок захвачен — этот процесс исполняет ходы бота', {
        lockId: AI_TURN_LOCK_ID,
      });

      // Держим PG-сессию живой; при разрыве — теряем лидерство.
      lockHeartbeatTimer = setInterval(() => {
        lockClient?.query('SELECT 1').catch(() => releaseAiTurnLeadership());
      }, LOCK_HEARTBEAT_MS);
      lockHeartbeatTimer.unref?.();

      client.on('error', () => releaseAiTurnLeadership());
    } else {
      // Лок занят другим процессом (в норме — prod worker-outbound). Остаёмся
      // follower: ходы no-op. Соединение вернуть в пул, лок не наш.
      client.release();
    }
  } catch (err) {
    log.warn('ai-turn lock: ошибка захвата (остаёмся follower)', { err: String(err) });
  }
}

/** Сбросить лидерство (heartbeat упал / соединение умерло). Лок освободит retry заново. */
function releaseAiTurnLeadership(): void {
  if (!aiWorkerIsLeader && !lockClient) return;
  aiWorkerIsLeader = false;
  log.warn('ai-turn lock: лидерство потеряно (PG-сессия разорвана)');
  if (lockClient) {
    try { lockClient.release(); } catch { /* соединение уже мертво */ }
    lockClient = null;
  }
}

/**
 * Старт выборов держателя ai-turn-лока. Вызывается из startAiTurnWorker. Первый
 * захват — синхронно (await), затем retry каждые LOCK_RETRY_MS: follower
 * подхватит лок за ~30с, если prod-держатель упал.
 */
export async function startAiTurnLock(): Promise<void> {
  await tryAcquireAiTurnLock();
  if (!lockRetryTimer) {
    lockRetryTimer = setInterval(() => { void tryAcquireAiTurnLock(); }, LOCK_RETRY_MS);
    lockRetryTimer.unref?.();
  }
}

/** Освободить лок и остановить таймеры (graceful shutdown воркера). */
export async function stopAiTurnLock(): Promise<void> {
  if (lockRetryTimer) { clearInterval(lockRetryTimer); lockRetryTimer = null; }
  if (lockHeartbeatTimer) { clearInterval(lockHeartbeatTimer); lockHeartbeatTimer = null; }
  if (lockClient) {
    try {
      await lockClient.query('SELECT pg_advisory_unlock($1)', [AI_TURN_LOCK_ID]);
    } catch (err) {
      log.warn('ai-turn lock: unlock при остановке не прошёл', { err: String(err) });
    }
    try { lockClient.release(); } catch { /* ignore */ }
    lockClient = null;
  }
  aiWorkerIsLeader = false;
}

/**
 * Test-only: принудительно выставить флаг лидерства для unit-тестов processAiTurn
 * (happy-path не вызывает startAiTurnWorker и реальный захват лока). НЕ
 * использовать в продакшн-коде.
 */
export function __setAiTurnLeaderForTests(value: boolean): void {
  aiWorkerIsLeader = value;
}

// ─── Enqueue API ────────────────────────────────────────────────────────────────

export interface EnqueueAiTurnParams {
  conversationId: string;
  triggerMessageId: string;
  channel: ChannelType;
}

/**
 * Ставит (или переставляет) ход бота для диалога.
 *
 * КОАЛЕСИНГ: jobId фиксирован на conversationId, поэтому в очереди живёт не
 * более одного отложенного хода на диалог. На каждое новое входящее сообщение
 * убираем прежний отложенный ход и ставим заново с обновлённым triggerMessageId
 * и свежим дебаунсом — так серия реплик клиента даёт один ответ, а не цепочку.
 *
 * Reschedule делаем явным remove+add (а не полагаемся на jobId-дедуп BullMQ): у
 * delayed-джоба с тем же jobId повторный add БЕЗ remove был бы проигнорирован, и
 * дебаунс не сдвинулся бы на последнюю реплику.
 */
export async function enqueueAiTurn(params: EnqueueAiTurnParams): Promise<void> {
  const jobId = turnJobId(params.conversationId);

  // Снять прежний отложенный ход (если ещё не начал исполняться).
  const existing = await aiTurnQueue.getJob(jobId);
  if (existing) {
    try {
      await existing.remove();
    } catch (err) {
      // Джоб мог уже взяться в работу (lock) — remove бросит. Это не ошибка:
      // активный ход доведём, а новый сразу поставить нельзя (jobId занят) —
      // S4 поставит следующий ход на следующее сообщение.
      log.debug('enqueueAiTurn: не сняли активный ход, пропускаем reschedule', {
        conversationId: params.conversationId,
        err: String(err),
      });
      return;
    }
  }

  const data: AiTurnJobData = {
    conversationId: params.conversationId,
    triggerMessageId: params.triggerMessageId,
    channel: params.channel,
  };

  await aiTurnQueue.add('process-ai-turn', data, {
    jobId,
    delay: AGENT_DEBOUNCE_MS,
    attempts: 2,
    backoff: { type: 'exponential', delay: 3_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  });

  log.debug('ai turn enqueued', {
    conversationId: params.conversationId,
    triggerMessageId: params.triggerMessageId,
    channel: params.channel,
    delayMs: AGENT_DEBOUNCE_MS,
  });
}

/**
 * Снимает отложенный ход бота для диалога (для будущей отмены при перехвате
 * оператором). S2 пока не интегрирует — экспортируем как seam. No-op, если хода
 * в очереди нет или он уже в работе.
 */
export async function removeAiTurnJob(conversationId: string): Promise<void> {
  const job = await aiTurnQueue.getJob(turnJobId(conversationId));
  if (!job) return;
  try {
    await job.remove();
    log.debug('ai turn job removed', { conversationId });
  } catch (err) {
    log.debug('removeAiTurnJob: ход уже в работе, не сняли', {
      conversationId,
      err: String(err),
    });
  }
}

// ─── Killswitch ──────────────────────────────────────────────────────────────

/**
 * Мгновенный стоп: Redis-ключ `ai:enabled` == 'false' глушит все ходы (очередь
 * продолжает копиться, конвейер сообщений не страдает).
 *
 * Fail-CLOSED: бот пишет НАРУЖУ реальным людям, поэтому последний стоп-кран
 * должен срабатывать и в деградации. Если Redis недоступен или клиент не
 * инициализирован — считаем killswitch ВЗВЕДЁННЫМ (ход подавляем). «Лучше
 * молчать, чем отвечать без возможности экстренно остановить». Копящаяся
 * очередь ходов и так заявлена приемлемой; зато оператор всегда может заглушить
 * бота даже когда Redis флапает.
 */
async function isKillswitchEngaged(): Promise<boolean> {
  const redis = getCrmRedis();
  if (!redis) {
    log.warn('killswitch: Redis-клиент недоступен -> fail-closed (ход подавлен)');
    return true;
  }
  try {
    const value = await redis.get('ai:enabled');
    return value === 'false';
  } catch (err) {
    log.warn('killswitch check failed -> fail-closed (ход подавлен)', { err: String(err) });
    return true;
  }
}

// ─── Conversation row ──────────────────────────────────────────────────────────

interface ConversationTurnRow {
  ai_agent_mode: string | null;
  ai_agent_locked_at: Date | null;
  contact_id: string | null;
  user_id: string | null;
  channel: ChannelType;
  external_chat_id: string | null;
  visitor_phone: string | null;
  // Контакт явно исключён из ИИ-автоответов (напр. сам администратор/сотрудник,
  // пишущий через мессенджер). Бот для него молчит на ВСЕХ путях постановки хода.
  contact_opt_out: boolean | null;
}

interface IdOnlyRow {
  id: string;
}

interface EscalationOperatorRow {
  assigned_operator_id: string | null;
  operator_name: string | null;
}

/**
 * История диалога для классификатора. Повторяет запрос loadHistory оркестратора:
 * та функция приватная и лежит в чужом слайсе (S5b), реюз напрямую невозможен,
 * поэтому повторяем тот же SELECT здесь. Формат ролей по контракту classifyInbound:
 * 'assistant' — прошлые ходы бота, 'user' — клиент И оператор (недоверенный
 * контекст; сообщение человека в assistant НЕ мапим, иначе модель примет чужой
 * текст за свой прошлый ход).
 */
async function loadHistoryForClassifier(conversationId: string, limit: number): Promise<ChatMessage[]> {
  const rows = await loadAiVisibleHistoryRows(conversationId, limit);

  return rows
    .map((row): ChatMessage => {
      const content = formatAiVisibleMessageContent(row);
      if (row.sender_type === 'bot') {
        return { role: 'assistant', content };
      }
      return { role: 'user', content };
    });
}

/** Текст конкретного сообщения-триггера (вход для классификатора). */
async function loadTriggerMessage(triggerMessageId: string): Promise<AiVisibleHistoryRow | null> {
  const row = await db.queryOne<AiVisibleHistoryRow>(
    `SELECT m.sender_type,
            m.message_type,
            m.content,
            ma.file_name AS original_file_name,
            ma.mime_type AS original_mime_type
       FROM messages m
       LEFT JOIN LATERAL (
         SELECT file_name, mime_type
           FROM media_attachments
          WHERE message_id = m.id
            AND processing_status = 'uploaded'
          ORDER BY created_at ASC
          LIMIT 1
       ) ma ON TRUE
      WHERE m.id = $1`,
    [triggerMessageId],
  );
  if (!row?.content) return null;
  return row;
}

// ─── Эскалация ───────────────────────────────────────────────────────────────

/**
 * Передача диалога живому оператору: переводим в режим 'operator' + ставим lock
 * (бот молчит для диалога навсегда), затем ГРОМКО уведомляем оператора.
 *
 * Перевод режима — CAS по mode='bot' (не трогаем уже-перехваченный руками
 * оператором диалог: тот сам выставил operator+lock, повторно не назначаем).
 *
 * ГРОМКОЕ уведомление (критерий «бот передаёт оператору громко»): autoAssign
 * пишет системное сообщение + chat:assigned ТОЛЬКО когда сам впервые закрепляет
 * оператора (claim по assigned_operator_id IS NULL). Но в bot-режиме диалог уже
 * имеет ТИХО назначенного наблюдателя (inbound-worker: autoAssign({silent:true}))
 * -> claim вернёт 0 строк -> autoAssign выйдет молча, и оператор НЕ узнает об
 * эскалации. Поэтому после autoAssign досылаем громкое уведомление сами, если
 * оператор уже был назначен (autoAssign вернул null, но assigned_operator_id есть).
 */
async function escalateToOperator(conversationId: string, reason: string): Promise<void> {
  const moved = await db.queryOne<IdOnlyRow>(
    `UPDATE conversations
        SET ai_agent_mode = 'operator',
            ai_agent_locked_at = COALESCE(ai_agent_locked_at, NOW()),
            ai_agent_mode_set_by = 'agent_handoff',
            updated_at = NOW()
      WHERE id = $1
        AND ai_agent_mode = 'bot'
      RETURNING id`,
    [conversationId],
  );

  if (!moved) {
    // Уже не 'bot' (оператор/возврат вмешались между перечитыванием и сюда) —
    // не назначаем повторно, выходим тихо.
    log.info('эскалация пропущена — диалог уже не в режиме бота', { conversationId, reason });
    return;
  }

  log.info('бот эскалирует диалог оператору', { conversationId, reason });

  let assignedId: string | null = null;
  try {
    // Свежее назначение (был NULL) -> autoAssign уже громко уведомил, вернёт id.
    assignedId = await autoAssignOperator(conversationId);
  } catch (err) {
    // Назначение могло не пройти (никого онлайн) — режим уже operator+lock,
    // диалог попадёт в общую очередь неназначенных. Не валим джоб.
    log.warn('autoAssign при эскалации не прошёл', { conversationId, err: String(err) });
  }

  if (!assignedId) {
    // autoAssign не назначал (либо оператор уже был тихо назначен наблюдателем,
    // либо никого нет онлайн). Громкое уведомление надо доставить вручную.
    await notifyEscalation(conversationId);
  }
}

/**
 * Громкое уведомление об эскалации, когда autoAssign не сработал (диалог уже
 * имел тихо назначенного наблюдателя или операторов нет онлайн). Пишет системное
 * сообщение в ленту + chat:assigned broadcast (если оператор есть) + CRM-событие,
 * чтобы оператор увидел переданный ботом диалог в очереди. Best-effort: ошибки
 * логируем, джоб не валим.
 */
async function notifyEscalation(conversationId: string): Promise<void> {
  try {
    const row = await db.queryOne<EscalationOperatorRow>(
      `SELECT c.assigned_operator_id,
              COALESCE(u.display_name, u.email) AS operator_name
         FROM conversations c
         LEFT JOIN users u ON u.id = c.assigned_operator_id
        WHERE c.id = $1`,
      [conversationId],
    );

    // Системное сообщение в ленту — клиент/оператор видят, что подключают человека.
    await db.query(
      `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
       VALUES ($1, 'bot', 'system', 'Система', 'system', $2)`,
      [conversationId, 'Ассистент передал диалог оператору'],
    );

    const operatorId = row?.assigned_operator_id ?? null;
    const operatorName = row?.operator_name || 'Оператор';

    if (operatorId) {
      // Громкий сигнал в админ-очередь: диалог переназначен/активен у оператора.
      broadcastToRoom('chat:assigned', 'admin:visitor-chats', {
        sessionId: conversationId,
        operatorId,
        operatorName,
        assignedBy: 'agent-handoff',
      });
    }

    // Обновить CRM-инбокс (маршрутизация/счётчики) независимо от наличия оператора.
    enqueueCrmEvent('chat', conversationId, 'assignment_changed', {
      assigned_to: operatorId,
      assigned_to_name: operatorId ? operatorName : null,
      status: 'active',
      priority: 2,
    }).catch(err => log.warn('enqueueCrmEvent при эскалации не прошёл', { error: String(err) }));

    log.info('громкое уведомление об эскалации доставлено', { conversationId, operatorId });
  } catch (err) {
    log.warn('notifyEscalation не прошёл', { conversationId, err: String(err) });
  }
}

// ─── File-ack (короткое подтверждение на голые вложения) ───────────────────────

/**
 * Сервисное подтверждение на media-only сообщение (файлы/фото на печать без
 * подписи): один раз отвечаем коротким шаблоном FILES_ACK_TEXT, НЕ оформляя
 * заказ. Вызывается ВМЕСТО тихого return ветки isAiMediaOnlyMessage — то есть
 * УЖЕ под пройденными гейтами killswitch + singleton-лок + перечитка mode='bot'.
 *
 * Тёмный запуск: при выключенном флаге (config.ai.filesAckEnabled=false) тихо
 * выходим, как было до фичи (клиент-видимое сообщение включается отдельно).
 *
 * Анти-дубль на серию (клиент шлёт 40 фото подряд) — три пояса: (1) КОАЛЕСИНГ
 * хода (один processAiTurn на серию), (2) CAS+cooldown по files_ack_at (даже
 * если ходов несколько — повторный INSERT подавлен в пределах cooldown),
 * (3) dedupKey enqueueOutbound. CAS заодно перепроверяет mode='bot' атомарно
 * (оператор мог перехватить между перечиткой и сюда).
 */
async function maybeSendFilesAck(conversationId: string, conv: ConversationTurnRow): Promise<void> {
  if (!config.ai.filesAckEnabled) {
    log.debug('file-ack пропущен — флаг выключен (тёмный запуск)', { conversationId });
    return;
  }

  if (!conv.external_chat_id) {
    log.debug('file-ack пропущен — нет external_chat_id', { conversationId });
    return;
  }

  // CAS+cooldown: ставим files_ack_at только если диалог всё ещё 'bot' и с
  // прошлого подтверждения прошло >= cooldown (или его не было). 0 строк =>
  // недавно слали / режим сменился => молчим (анти-спам на серию вложений).
  const claimed = await db.queryOne<IdOnlyRow>(
    `UPDATE conversations
        SET files_ack_at = NOW(),
            updated_at = NOW()
      WHERE id = $1
        AND ai_agent_mode = 'bot'
        AND (files_ack_at IS NULL OR files_ack_at < NOW() - ($2 || ' hours')::interval)
      RETURNING id`,
    [conversationId, config.ai.filesAckCooldownHours],
  );

  if (!claimed) {
    log.debug('file-ack пропущен — недавно отправляли / режим сменился (CAS)', { conversationId });
    return;
  }

  // Запишем подтверждение в ленту как обычный bot-ход. botMsg.id нужен как
  // sourceMessageId в enqueueOutbound: иначе второй гейт processOutbound не
  // подавит сообщение при перехвате оператором между CAS и доставкой.
  const botMsg = await db.queryOne<IdOnlyRow>(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content)
     VALUES ($1, 'bot', 'system', 'Ассистент', 'text', $2)
     RETURNING id`,
    [conversationId, FILES_ACK_TEXT],
  );

  if (!botMsg) {
    log.error('file-ack: не удалось записать сообщение бота', { conversationId });
    return;
  }

  // dedupKey с time-bucket по окну cooldown. Глобальный UNIQUE outbound_queue.dedup_key
  // без TTL: стабильный ключ `files-ack:${conv}` подавил бы ЛЮБОЙ повторный ack по этому
  // диалогу навсегда (ON CONFLICT DO NOTHING) — клиент после cooldown прошёл бы CAS, но
  // сообщение не ушло бы (фантом в ленте). Бакет по окну делает ключ уникальным на каждое
  // cooldown-окно: ретрай job В ПРЕДЕЛАХ окна подавлен (идемпотентность), легитимный ack в
  // следующем окне проходит. Согласован с CAS files_ack_at (та же гранулярность cooldown).
  const cooldownMs = config.ai.filesAckCooldownHours * 3_600_000;
  const bucket = Math.floor(Date.now() / cooldownMs);

  await enqueueOutbound({
    channel: conv.channel,
    externalChatId: conv.external_chat_id,
    content: FILES_ACK_TEXT,
    conversationId,
    sourceMessageId: botMsg.id,
    dedupKey: `files-ack:${conversationId}:${bucket}`,
  });

  log.info('FILES_ACK: sent', { conversationId, channel: conv.channel });
}

// ─── Processor ─────────────────────────────────────────────────────────────────

export async function processAiTurn(job: AiTurnProcessJob): Promise<void> {
  const { conversationId, triggerMessageId, channel } = job.data;

  // (0) KILLSWITCH — дешёвый мгновенный стоп.
  if (await isKillswitchEngaged()) {
    log.info('ход подавлен killswitch (ai:enabled=false)', { conversationId });
    return;
  }

  // (1) SINGLETON-LOCK (P0 dev-защита): ход исполняет только держатель ai-turn-лока.
  //     На общей dev/prod БД это один процесс на сервер (prod worker-outbound) —
  //     dev-процесс лок не держит и реальным клиентам не пишет.
  if (!isAiTurnLeader()) {
    log.debug('ход пропущен — процесс не держит ai-turn-лок (dev-защита)', { conversationId });
    return;
  }

  // (2) Перечитать актуальное состояние диалога (за время дебаунса мог смениться режим).
  const conv = await db.queryOne<ConversationTurnRow>(
    `SELECT c.ai_agent_mode, c.ai_agent_locked_at, c.contact_id, c.user_id,
            c.channel, c.external_chat_id, c.visitor_phone,
            ct.ai_agent_opt_out AS contact_opt_out
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.id = $1`,
    [conversationId],
  );

  if (!conv) {
    log.warn('ход пропущен — диалог не найден', { conversationId });
    return;
  }

  if (conv.ai_agent_mode !== 'bot') {
    // off (бот выключен) либо operator (перехвачен) — не отвечаем.
    log.debug('ход пропущен — диалог не в режиме бота', {
      conversationId,
      mode: conv.ai_agent_mode,
    });
    return;
  }

  // Контакт в исключениях ИИ (opt-out) — напр. сам администратор/сотрудник пишет
  // через мессенджер для теста или координации, бот ему НЕ отвечает. Единая точка:
  // покрывает авто-ход (inbound), ручную кнопку «Ответить клиенту» (/ai-reply) и
  // file-ack, т.к. все они проходят через processAiTurn. Гейт ДО классификатора —
  // 0 затрат на модель.
  if (conv.contact_opt_out === true) {
    log.info('ход подавлен — контакт в исключениях ИИ (opt-out)', {
      conversationId,
      contactId: conv.contact_id,
    });
    return;
  }

  // (3) Классификатор «вышибала»: дешёвая модель решает skip / handoff / respond.
  const triggerMessage = await loadTriggerMessage(triggerMessageId);
  if (triggerMessage === null) {
    log.warn('ход пропущен — сообщение-триггер не найдено', { conversationId, triggerMessageId });
    return;
  }

  if (isAiMediaOnlyMessage(triggerMessage)) {
    // Голые вложения на печать без вопроса: не гоняем классификатор/мозг, а при
    // включённом флаге шлём короткое сервисное подтверждение (один раз за cooldown).
    log.debug('media-only сообщение без подписи — пробуем file-ack', { conversationId, triggerMessageId });
    await maybeSendFilesAck(conversationId, conv);
    return;
  }

  const ctx: ToolContext = {
    conversationId,
    contactId: conv.contact_id,
    userId: conv.user_id,
    phone: conv.visitor_phone,
    channel: conv.channel,
  };

  const history = await loadHistoryForClassifier(conversationId, CLASSIFY_HISTORY_LIMIT);
  const triggerText = formatAiVisibleMessageContent(triggerMessage);
  const decision = await classifyInbound(triggerText, ctx, history);

  if (decision === 'skip') {
    log.debug('ход пропущен — классификатор: skip', { conversationId });
    return;
  }

  if (decision === 'handoff') {
    await escalateToOperator(conversationId, 'classifier_handoff');
    return;
  }

  // (4) Ход модели: генерация текста (runAgentTurn в режиме bot НЕ отправляет сам).
  //     try/catch: при падении провайдера/таймауте runAgentTurn БРОСАЕТ. Без
  //     перехвата джоб упал бы -> BullMQ-ретрай -> второй проход взял бы reused-run
  //     с пустым text -> всё равно эскалация, но лишним циклом (повторный
  //     классификатор + прогон). Ловим здесь и эскалируем СРАЗУ — клиент не
  //     остаётся без ответа, джоб завершается без бесконечных ретраев.
  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn({
      conversationId,
      contactId: conv.contact_id,
      userId: conv.user_id,
      phone: conv.visitor_phone,
      channel: conv.channel,
      mode: 'bot',
      triggerMessageId,
    });
  } catch (err) {
    log.warn('ход модели упал — эскалируем оператору', { conversationId, err: String(err) });
    await escalateToOperator(conversationId, 'agent_turn_error');
    return;
  }

  // Модель сама решила, что нужен человек (жалоба/деньги/неуверенность) — эскалируем.
  if (result.escalate) {
    await escalateToOperator(conversationId, result.escalationReason ?? 'agent_escalate');
    return;
  }

  const text = result.text.trim();
  if (!text) {
    // Пустой ответ при не-escalate (теоретически редко): отдаём оператору, чтобы
    // клиент не остался без ответа.
    log.info('пустой ответ бота, эскалируем оператору', { conversationId, runId: result.runId });
    await escalateToOperator(conversationId, 'empty_agent_text');
    return;
  }

  // (5) CAS-гейт: атомарно поднимаем счётчик хода ТОЛЬКО если диалог всё ещё
  //     'bot' и не залочен. 0 строк => оператор перехватил, пока бот думал =>
  //     ответ подавляем (клиенту уже отвечает человек).
  const claimed = await db.queryOne<IdOnlyRow>(
    `UPDATE conversations
        SET ai_agent_turn_count = ai_agent_turn_count + 1,
            updated_at = NOW()
      WHERE id = $1
        AND ai_agent_mode = 'bot'
        AND ai_agent_locked_at IS NULL
      RETURNING id`,
    [conversationId],
  );

  if (!claimed) {
    log.info('ответ бота подавлен — диалог перехвачен оператором (CAS)', {
      conversationId,
      runId: result.runId,
    });
    return;
  }

  if (!conv.external_chat_id) {
    log.warn('ответ бота не отправлен — нет external_chat_id', { conversationId, channel });
    return;
  }

  // (6) Записать ответ бота в ленту и поставить в исходящую очередь.
  //     dedupKey по runId защищает от дублей при ретрае джоба.
  const botMsg = await db.queryOne<IdOnlyRow>(
    `INSERT INTO messages (conversation_id, sender_type, sender_id, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', 'system', 'Ассистент', 'text', $2, $3::jsonb)
     RETURNING id`,
    [
      conversationId,
      text,
      JSON.stringify({ kind: 'ai_agent_reply', aiAgentRunId: result.runId }),
    ],
  );

  if (!botMsg) {
    log.error('не удалось записать сообщение бота', { conversationId, runId: result.runId });
    return;
  }

  await db.queryOne<IdOnlyRow>(
    `UPDATE ai_agent_runs
        SET final_message_id = $1
      WHERE id = $2
      RETURNING id`,
    [botMsg.id, result.runId],
  );

  await enqueueOutbound({
    channel: conv.channel,
    externalChatId: conv.external_chat_id,
    content: text,
    conversationId,
    sourceMessageId: botMsg.id,
    dedupKey: `ai:${result.runId}`,
  });

  log.info('ответ бота поставлен в очередь', {
    conversationId,
    channel: conv.channel,
    runId: result.runId,
    messageId: botMsg.id,
  });
}

// ─── Worker lifecycle ───────────────────────────────────────────────────────────

let worker: Worker | null = null;

/**
 * Старт воркера ходов бота. Concurrency=2: ходы дорогие и нечастые, не нужен
 * широкий параллелизм горячего конвейера. Длинный lockDuration — ход модели
 * может идти десятки секунд (см. WALL_TIMEOUT_MS оркестратора).
 */
export function startAiTurnWorker(): Worker {
  if (worker) return worker;

  // Захватить singleton-лок (P0 dev-защита). Fire-and-forget: BullMQ-воркер
  // создаём сразу, но ходы исполняем только когда лок наш (гейт isAiTurnLeader в
  // processAiTurn). Дебаунс хода (AGENT_DEBOUNCE_MS) даёт фору первому захвату;
  // до захвата ход — no-op (бот промолчит первые секунды после рестарта).
  startAiTurnLock().catch((err: unknown) =>
    log.warn('startAiTurnLock failed', { err: String(err) }),
  );

  worker = new Worker('omni-ai-turn', processAiTurn, {
    connection: { ...redisOpts },
    concurrency: 2,
    lockDuration: 5 * 60 * 1000,
    lockRenewTime: 60 * 1000,
    stalledInterval: 2 * 60 * 1000,
    maxStalledCount: 1,
  });

  worker.on('completed', (job) => {
    log.debug('ai turn job completed', { jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    captureException(err, {
      tags: { worker: 'ai-turn' },
      extra: { jobId: job?.id, data: job?.data },
      level: 'error',
    });
    log.error('ai turn job failed', { jobId: job?.id, error: String(err) });
  });

  log.info('ai turn worker started');
  return worker;
}

export async function stopAiTurnWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    log.info('ai turn worker stopped');
  }
  // Освобождаем singleton-лок, чтобы другой инстанс (follower) подхватил ходы
  // быстро, не дожидаясь PG-таймаута мёртвой сессии.
  await stopAiTurnLock();
}

export { aiTurnQueue };
