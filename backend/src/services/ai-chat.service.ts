/**
 * AI Chat Service
 *
 * Логика:
 * - Посетитель пишет текст → AI отвечает через 5 сек
 * - Если оператор подключился (ответил хотя бы раз) → AI отключается для этой сессии
 * - Кнопки и interactive-сообщения не попадают в историю AI
 * - Цены подгружаются из magnus_photo_db (pricing engine) и вшиваются в системный промпт
 * - ИИ сам решает как ответить, никакой пост-обработки
 *
 * AI-вызов: getAIProvider() — Gemini 2.0 Flash (primary) | Grok (alternative)
 * Провайдер выбирается через config.ai.provider (env AI_PROVIDER)
 */

import { pool } from '../database/db.js';
import { config } from '../config/index.js';
import type { Server as SocketIOServer } from 'socket.io';
import { getAIProvider, type ChatMessage as ProviderMessage } from './ai-providers/index.js';
import { getKonturPrices, formatPricesForAI } from './kontur-prices.service.js';
import {
  DOCUMENT_ACTIONS,
  TARIFF_ACTIONS,
  getAvailableActionsForStep,
  mapAiActionToButton,
  type AiActionCall,
  type AiActionDefinition,
} from '../data/ai-actions.js';
import { executeChatAction, type BotMessageResult } from './chat-actions.service.js';
import { sendVisitorChatPush } from './visitor-push.service.js';
import { broadcastChatMessage } from './chat-broadcast.service.js';
import { broadcastToRoom } from '../websocket/broadcast-to-room.js';
import { runAgentTurn } from './ai-agent/ai-agent-orchestrator.service.js';
import {
  formatAiVisibleMessageContent,
  loadAiVisibleHistoryRows,
} from './ai-agent/ai-visible-history.js';

import { createLogger } from '../utils/logger.js';
// ============================================================================
// Types
// ============================================================================

const logger = createLogger('ai-chat.service');
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

interface ActionContext {
  lastStep: string | null;
  selectedDoc: string | null;
  selectedTariff: string | null;
  uploadedPhotos: number;
  pendingOrder: { price?: number; tariff?: string; service?: string } | null;
  availableActions: AiActionDefinition[];
  channel: 'online' | 'studio';
}

interface AIWorkerResult {
  text: string;
  action?: AiActionCall | null;
}

interface ParsedChips {
  text: string;
  chips: string[];
}

interface ExtractedRawAction {
  cleanText: string;
  action: AiActionCall | null;
}

// ============================================================================
// Constants
// ============================================================================

/** Delay before AI responds (ms) — debounce для группировки быстрых сообщений */
const AI_DELAY_MS = 1_500;

/** Max text messages to include in conversation history */
const MAX_HISTORY = 20;

/** Bot display name */
const BOT_NAME = 'Своё Фото';

// ============================================================================
// Singleton state
// ============================================================================

const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const operatorActiveSessions = new Set<string>();
/**
 * Optional Socket.IO reference — установлен только в api-процессе через initAIChatService(io).
 * Используется ТОЛЬКО для `io.in(room).allSockets()` (presence check).
 * Все эмиты идут через `broadcastToRoom()` (PM2-split aware).
 */
let io: SocketIOServer | null = null;

/** Redis key prefix для хранения оператор-сессий (persist across pm2 restart) */
const OPERATOR_REDIS_PREFIX = 'operator_active:';
const OPERATOR_TTL_SEC = 7200; // 2 часа (было 86400)

/** Lazy Redis singleton для AI-сервиса (with resilient reconnect) */
let _redis: import('ioredis').default | null = null;
async function getRedis(): Promise<import('ioredis').default> {
  if (_redis) return _redis;
  const { createResilientRedis } = await import('./redis-factory.js');
  _redis = createResilientRedis('ai-chat', { lazyConnect: false, enableOfflineQueue: false });
  return _redis;
}

function buildFallbackChips(context: ActionContext): string[] {
  if (context.lastStep === 'document_select') {
    return ['Паспорт РФ', 'Загранпаспорт', 'Виза', 'Показать цены'];
  }
  if (context.lastStep === 'service_select') {
    return ['Без обработки', 'С обработкой', 'VIP-обработка', 'Назад в меню'];
  }
  if (context.lastStep === 'waiting_photo') {
    return ['Загрузить фото', 'Какие требования к фото?', 'Назад в меню'];
  }
  if (context.lastStep === 'order_confirmed') {
    return ['Оплатить', 'Изменить документ', 'Добавить пожелания', 'В меню'];
  }
  if (context.lastStep === 'ask_phone' || context.lastStep === 'delivery_awaiting_phone') {
    return ['Пропустить телефон', 'Назад к заказу'];
  }
  if (context.lastStep === 'cart_opened') {
    return ['Оплатить', 'В меню', 'Продолжить заказ'];
  }
  if (context.lastStep === 'online_print_ask') {
    return ['Да, нужна печать', 'Нет, только электронный вид', 'Назад'];
  }
  if (context.lastStep === 'wishes_text') {
    return ['Пропустить', 'Назад к заказу'];
  }
  if (context.lastStep === 'studio_photo_action') {
    return ['Печать фотографий', 'Ретушь', 'Фото на документы', 'В меню'];
  }
  if (context.lastStep === 'pickup_select') {
    return ['Самовывоз Соборный', 'Доставка курьером', 'Связаться с оператором'];
  }
  if (context.channel === 'studio') {
    return ['Записаться', 'Печать документов', 'Маршрут', 'Связаться с оператором'];
  }
  return ['Фото на документы', 'Показать цены', 'Загрузить фото', 'Связаться с оператором'];
}

function ensureChipsTag(text: string, chips: string[]): string {
  if (!text.trim()) return text;
  if (/\[CHIPS:\s*[^\]]+\]\s*$/i.test(text)) return text;
  const payload = chips.slice(0, 4).map(chip => `"${chip}"`).join(', ');
  return `${text.trim()}\n[CHIPS: ${payload}]`;
}

function parseRawActionCandidate(candidate: string): AiActionCall | null {
  try {
    const parsed: unknown = JSON.parse(candidate);
    if (!parsed || typeof parsed !== 'object') return null;

    const rawName = Reflect.get(parsed, 'name');
    if (typeof rawName !== 'string' || !rawName.trim()) return null;
    const name = rawName.trim();

    const rawParam = Reflect.get(parsed, 'param');
    if (typeof rawParam === 'string' && rawParam.trim()) {
      return { name, param: rawParam.trim() };
    }

    const args = Reflect.get(parsed, 'arguments');
    if (!args || typeof args !== 'object') {
      return { name };
    }

    const preferredKeys = ['type', 'tariff', 'method', 'pickup', 'service', 'value', 'id', 'option'];
    for (const key of preferredKeys) {
      const value = Reflect.get(args, key);
      if (typeof value === 'string' && value.trim()) {
        return { name, param: value.trim() };
      }
    }

    const firstStringArg = Object.values(args).find(
      value => typeof value === 'string' && value.trim().length > 0,
    );

    if (typeof firstStringArg === 'string') {
      return { name, param: firstStringArg.trim() };
    }

    return { name };
  } catch {
    return null;
  }
}

function extractRawJsonAction(text: string): ExtractedRawAction {
  if (!text.trim()) {
    return { cleanText: text.trim(), action: null };
  }

  const candidates = Array.from(
    text.matchAll(/\{\s*"name"\s*:\s*"[^"\n]+"[\s\S]*?"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g),
  );

  if (candidates.length === 0) {
    return { cleanText: text.trim(), action: null };
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const match = candidates[index];
    if (!match) continue;
    const action = parseRawActionCandidate(match[0]);
    if (!action) continue;

    const cleanText = text.replace(match[0], '').replace(/```json|```/gi, '').trim();
    return { cleanText, action };
  }

  return { cleanText: text.trim(), action: null };
}

/** Загрузить operator sessions из Redis при старте */
async function loadOperatorSessionsFromRedis(): Promise<void> {
  try {
    const redis = await getRedis();
    const keys = await redis.keys(`${OPERATOR_REDIS_PREFIX}*`);
    for (const key of keys) {
      operatorActiveSessions.add(key.replace(OPERATOR_REDIS_PREFIX, ''));
    }
    if (keys.length > 0) {
      logger.info(`[AI-Chat] Loaded ${keys.length} operator sessions from Redis`);
    }
  } catch (err) {
    logger.warn('[AI-Chat] Failed to load operator sessions from Redis:', { error: String(err) });
  }
}

// ============================================================================
// Public API
// ============================================================================

export function initAIChatService(socketIO: SocketIOServer): void {
  io = socketIO;
  loadOperatorSessionsFromRedis().catch(err =>
    logger.warn('[AI-Chat] Failed to load operator sessions on init', { error: String(err) }),
  );
  logger.info('[AI-Chat] Service initialized');
}

export function scheduleAIResponse(
  sessionId: string,
  visitorMessage: string,
  messageSentAt: Date,
): void {
  if (!config.ai.autoReplyEnabled) {
    return;
  }

  cancelPendingAI(sessionId);

  // Показать typing сразу — клиент видит что бот "думает"
  emitTyping(sessionId, true);

  logger.info(`[AI-Chat] Scheduling AI response for session ${sessionId} in ${AI_DELAY_MS / 1000}s`);

  const timer = setTimeout(async () => {
    pendingTimers.delete(sessionId);

    try {
      if (operatorActiveSessions.has(sessionId)) {
        const recentlyActive = await isOperatorRecentlyActive(sessionId);
        if (recentlyActive) {
          emitTyping(sessionId, false);
          return;
        }
      }

      // 1. Get conversation history
      const history = await getChatHistory(sessionId, MAX_HISTORY);
      if (history.length === 0) {
        logger.info(`[AI-Chat] No history found for session ${sessionId} — skipping AI`);
        emitTyping(sessionId, false);
        return;
      }

      // 2. Get action context (channel, step, selected doc/tariff)
      const actionContext = await getActionContext(sessionId);

      // 3. Call the AI worker — промпт собирается внутри worker из YAML
      const aiResult = await callAIProvider(history, actionContext.availableActions, actionContext);
      if (!aiResult.text && !aiResult.action) {
        logger.info(`[AI-Chat] Worker returned empty response for session ${sessionId}`);
        emitTyping(sessionId, false);
        return;
      }

      // 4. Final check — operator might have replied while AI was thinking
      if (operatorActiveSessions.has(sessionId)) {
        logger.info(`[AI-Chat] Operator replied during AI call for session ${sessionId} — discarding`);
        emitTyping(sessionId, false);
        return;
      }

      let aiText = aiResult.text || '';
      let aiAction = aiResult.action || null;

      if (!aiAction && aiText) {
        const extracted = extractRawJsonAction(aiText);
        aiText = extracted.cleanText;
        aiAction = extracted.action;
      }

      // 5. Save and send the AI response
      if (aiText) {
        const fallbackChips = buildFallbackChips(actionContext);
        const aiTextWithChips = ensureChipsTag(aiText, fallbackChips);
        await sendHumanLikeResponse(sessionId, aiTextWithChips);
      } else {
        emitTyping(sessionId, false);
      }

      if (aiAction) {
        await handleAiAction(sessionId, aiAction, actionContext);
      }
      logger.info(`[AI-Chat] AI response sent for session ${sessionId}`);
    } catch (err) {
      logger.error(`[AI-Chat] Error processing AI response for session ${sessionId}:`, { error: String(err) });
      emitTyping(sessionId, false);
    }
  }, AI_DELAY_MS);

  pendingTimers.set(sessionId, timer);
}

export function cancelPendingAI(sessionId: string): void {
  const timer = pendingTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(sessionId);
    emitTyping(sessionId, false);
    logger.info(`[AI-Chat] Cancelled pending AI for session ${sessionId}`);
  }
}

export function stopAIChatService(): void {
  for (const [sessionId, timer] of pendingTimers) {
    clearTimeout(timer);
  }
  const timerCount = pendingTimers.size;
  const sessionCount = operatorActiveSessions.size;
  pendingTimers.clear();
  operatorActiveSessions.clear();
  io = null;
  logger.info(`[AI-Chat] Service stopped (cleared ${timerCount} timers, ${sessionCount} operator sessions)`);
}

export function markOperatorActive(sessionId: string): void {
  operatorActiveSessions.add(sessionId);
  cancelPendingAI(sessionId);
  // Persist в Redis (fire-and-forget) — выживает pm2 restart
  getRedis()
    .then(redis => redis.set(`${OPERATOR_REDIS_PREFIX}${sessionId}`, '1', 'EX', OPERATOR_TTL_SEC))
    .catch(err => logger.warn('[AI-Chat] Failed to persist operator active session', {
      sessionId,
      error: String(err),
    }));
  logger.info(`[AI-Chat] Operator is now active in session ${sessionId} — AI disabled`);
}

export function clearOperatorActive(sessionId: string): void {
  operatorActiveSessions.delete(sessionId);
  getRedis()
    .then(redis => redis.del(`${OPERATOR_REDIS_PREFIX}${sessionId}`))
    .catch(err => logger.warn('[AI-Chat] Failed to clear operator active session', {
      sessionId,
      error: String(err),
    }));
  logger.info(`[AI-Chat] Operator cleared for session ${sessionId} — AI re-enabled`);
}

async function isOperatorRecentlyActive(sessionId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT created_at FROM messages
     WHERE conversation_id = $1 AND sender_type = 'operator'
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  );
  if (result.rows.length === 0) {
    clearOperatorActive(sessionId);
    return false;
  }
  const minutesAgo = (Date.now() - new Date(result.rows[0].created_at).getTime()) / 60_000;
  if (minutesAgo > 30) {
    logger.info(`[AI-Chat] Operator idle ${Math.round(minutesAgo)}min in ${sessionId} — re-enabling AI`);
    clearOperatorActive(sessionId);
    return false;
  }
  return true;
}

export function getPendingAICount(): number {
  return pendingTimers.size;
}

/**
 * Identity текущего диалога для контекста AI-агента (read-tools берут её из ctx,
 * а не из аргументов модели). Резолвится одним SELECT по conversation_id.
 */
interface SuggestionIdentity {
  contactId: string | null;
  userId: string | null;
  phone: string | null;
}

/**
 * Резолвит identity по conversation_id для orchestrator-а.
 * conversations.contact_id NOT NULL; user_id берём из conversations, при пусто —
 * из contacts; телефон — из contacts.phone, при пусто — из visitor_phone веб-сессии.
 */
async function resolveSuggestionIdentity(sessionId: string): Promise<SuggestionIdentity> {
  const result = await pool.query(
    `SELECT cv.contact_id AS contact_id,
            COALESCE(cv.user_id, c.user_id) AS user_id,
            COALESCE(c.phone, cv.visitor_phone) AS phone
       FROM conversations cv
       LEFT JOIN contacts c ON c.id = cv.contact_id
      WHERE cv.id = $1
      LIMIT 1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (!row) {
    return { contactId: null, userId: null, phone: null };
  }
  return {
    contactId: row.contact_id ?? null,
    userId: row.user_id ?? null,
    phone: row.phone ?? null,
  };
}

/**
 * Прямая (легаси) генерация подсказки через ClaudeProvider (Anthropic-ключ).
 * Fallback-путь: используется при выключенном флаге AI_AGENT_ENABLED, отсутствии
 * ключа OpenRouter или ЛЮБОЙ ошибке orchestrator-а. Голый Haiku без прайса и tools.
 */
async function generateSuggestionLegacy(sessionId: string): Promise<string> {
  const history = await getChatHistory(sessionId, 10);
  if (history.length === 0) throw new Error('No messages in session');

  const { ClaudeProvider } = await import('./ai-providers/claude.provider.js');
  const claude = new ClaudeProvider();

  const systemPrompt =
    'Ты помощник оператора фотостудии «Своё Фото». ' +
    'На основе переписки предложи краткий ответ клиенту. ' +
    'Отвечай на русском, кратко (1-3 предложения), дружелюбно, обращайся на «Вы». ' +
    'Без маркдауна, без списков, без подписи. Чистый текст как в мессенджере.';

  const messages: import('./ai-providers/provider.interface.js').ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.text,
    })),
  ];

  const suggestion = await claude.chat(messages, {
    temperature: 0.3,
    maxTokens: 200,
  });

  return suggestion || 'Не удалось сгенерировать подсказку';
}

/**
 * Generate AI suggestion for an operator reply.
 *
 * При включённом AI-агенте (config.ai.agentEnabled + наличие ключа OpenRouter)
 * ход идёт через orchestrator: единый OpenRouter-провайдер + read-tools (живые
 * цены/подписка/скидки/статус заказа) вместо «голого» Haiku без данных. Identity
 * (contact/user/phone) резолвится по sessionId и уходит в ToolContext.
 *
 * Иначе (флаг выключен / нет ключа) или при ЛЮБОЙ ошибке orchestrator-а — graceful
 * fallback на прежнее поведение (прямой ClaudeProvider). Эндпоинт и фронт не меняются.
 */
export async function generateOperatorSuggestion(sessionId: string): Promise<string> {
  const agentReady = config.ai.agentEnabled && config.ai.openrouterApiKey.trim() !== '';

  if (agentReady) {
    try {
      const identity = await resolveSuggestionIdentity(sessionId);
      const result = await runAgentTurn({
        conversationId: sessionId,
        contactId: identity.contactId,
        userId: identity.userId,
        phone: identity.phone,
        mode: 'suggest',
        model: config.ai.agentModel,
        // triggerMessageId намеренно не задаём: подсказка по кнопке оператора,
        // каждый клик — новый ход, идемпотентность не нужна.
      });

      const text = result.text.trim();
      if (text) return text;

      // Пусто/эскалация: модель не дала готовый вариант. Отдаём вежливую заглушку
      // вместо falling back на голый Haiku (он тут не точнее).
      logger.info('[AI-Chat] Agent suggestion empty/escalated, returning placeholder', {
        sessionId,
        runId: result.runId,
        escalate: result.escalate ?? false,
        reason: result.escalationReason ?? null,
      });
      return 'Не удалось сформировать подсказку, ответьте клиенту самостоятельно.';
    } catch (err) {
      // Любая ошибка хода (таймаут/провайдер/БД) — не падаем, идём на легаси-путь.
      logger.warn('[AI-Chat] Agent suggestion failed, falling back to legacy', {
        sessionId,
        error: String(err),
      });
      return generateSuggestionLegacy(sessionId);
    }
  }

  return generateSuggestionLegacy(sessionId);
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Get the last N TEXT messages from a session.
 * Includes both visitor and bot/operator messages for natural conversation context.
 */
async function getChatHistory(
  sessionId: string,
  limit: number,
): Promise<ChatMessage[]> {
  const rows = await loadAiVisibleHistoryRows(sessionId, limit);

  return rows.map(row => ({
    role: (row.sender_type === 'visitor' ? 'user' : 'assistant') as 'user' | 'assistant',
    text: formatAiVisibleMessageContent(row),
  }));
}

/**
 * Строит системный промпт для AI из бизнес-правил и контекста сессии.
 * Эквивалент Python prompt_builder.py::build_system_prompt().
 */
function buildSystemPrompt(
  channel: 'online' | 'studio',
  context: ActionContext,
  pricesText: string,
  actions: AiActionDefinition[],
): string {
  const parts: string[] = [];

  // 1. Роль
  parts.push(
    'Ты — менеджер по продажам фотостудии «Своё Фото» в Ростове-на-Дону. ' +
    'Твоя главная цель — продать услугу и привести клиента к следующему действию.',
  );

  // 2. О нас
  parts.push(
    '\nО нас:' +
    '\n- Студия: пер. Соборный 21.' +
    '\n- Режим: Пн-Вс 9:00-19:30.' +
    '\n- Тел: 8(901)417-86-68.' +
    '\n- Запись онлайн: через чат или на сайте /booking',
  );

  // 3. Стиль общения
  parts.push(
    '\nКак общаться:' +
    '\n- Пиши как живой человек — коротко, тепло, с энергией. Обращайся к клиенту строго на «Вы». 1-3 предложения.' +
    '\n- Чистый текст как в переписке, без маркдауна, списков, буллетов, таблиц.' +
    '\n- Отвечай на русском.',
  );

  // 4. Общие запреты
  const prohibitions = [
    'Не говори что ты бот или ИИ.',
    'Не представляйся по имени — у тебя НЕТ имени. Никогда не начинай сообщение с имени или подписи.',
    'Не добавляй подпись, имя или адрес студии в начале или в конце ответа.',
    'Не придумывай имён сотрудников, фотографов, кабинетов — ты этого не знаешь.',
    'Не вставляй телефон и ссылку в каждый ответ — только когда клиент просит контакты.',
    'Не придумывай цены — НИКОГДА. Если услуги нет в прайсе — скажи «Сейчас уточню стоимость».',
    'Не противоречь себе — если назвал факт, не меняй его в следующем сообщении.',
    'Не называй сроки изготовления, если не уверен. Исключение: «фото на документы — 15 минут».',
    'Не говори что фото отправим на email, на почту или по ссылке. Готовое фото мы отправляем прямо в чат после оплаты.',
  ];
  for (const p of prohibitions) parts.push(`- ${p}`);

  // 5. Правила канала
  if (channel === 'online') {
    parts.push('\nКанал: online (онлайн-заказ):');
    const instructions = [
      'Все онлайн-тарифы доступны прямо сейчас. Веди к выбору документа/тарифа, загрузке фото и оформлению.',
      'Называй ОНЛАЙН-цены (позиции с «онлайн» в названии).',
      'НЕ говори «только для онлайн» — клиент УЖЕ в онлайне.',
      'Не упоминай офлайн-цены и визит в студию — клиент уже оформляет онлайн.',
      'Предлагай допуслуги: к фото на документы — электронную версию, к печати — ламинацию, к портрету — ретушь.',
      'Если клиент сомневается — снимай возражения: «У нас всё готово за 15 минут», «Если не примут — переснимем бесплатно».',
      'Не говори «нажмите кнопку» — кнопки появляются автоматически.',
    ];
    for (const instr of instructions) parts.push(`- ${instr}`);
  } else {
    parts.push('\nКанал: studio (офлайн-студия):');
    const instructions = [
      'Все услуги доступны без записи — активно приглашай прийти в любое удобное время в часы работы.',
      'Называй ОФЛАЙН-цены.',
      'Можешь упомянуть что есть онлайн-вариант дешевле.',
      'Предлагай допуслуги: к фото на документы — электронную версию, к печати — ламинацию, к портрету — ретушь.',
      'Если клиент сомневается — снимай возражения: «У нас всё готово за 15 минут», «Если не примут — переснимем бесплатно».',
    ];
    for (const instr of instructions) parts.push(`- ${instr}`);
  }

  // 6. Правила по ценам
  parts.push('\nПравила по ценам:');
  parts.push('- Никогда не придумывай цены.');
  parts.push('- Грин-карта (Green Card) — отдельная услуга, не путай с обычным «фото на документы».');
  parts.push('- Если позиции нет в прайсе — скажи «Сейчас уточню стоимость, одну секунду».');
  if (channel === 'online') {
    parts.push('- ОНЛАЙН: клиент загружает своё фото, мы обрабатываем и отправляем результат прямо в чат. Цены ниже, т.к. нет съёмки и печати.');
  } else {
    parts.push('- ОФЛАЙН: клиент приходит в студию: фотосъёмка + обработка + печатный комплект.');
    parts.push('- При желании упомяни что есть онлайн-вариант дешевле.');
  }

  // 6.5. Доставка
  parts.push('\nГотовый результат:');
  if (channel === 'online') {
    parts.push('- Готовое фото отправляем прямо в чат после оплаты. НЕ на email, НЕ на почту — именно в этот чат.');
  } else {
    parts.push('- Клиент получает готовые фото в студии на месте, сразу после съёмки (15 минут).');
  }
  parts.push('- НИКОГДА не говори что фото отправим на email, на почту или по ссылке.');

  // 7. Запись
  parts.push('\nЗапись:');
  parts.push('- Все услуги доступны без предварительной записи — можно прийти в любое время в часы работы.');
  parts.push('- Запись онлайн — удобная опция для тех, кто хочет зарезервировать конкретное время.');

  // 8. Строгие правила
  parts.push('\nСТРОГИЕ ПРАВИЛА (нарушение = критическая ошибка):');
  const strictRules = [
    'У тебя НЕТ ИМЕНИ. Ты НЕ Ольга, НЕ Мария, НЕ Анна, НЕ Елена, НЕ кто-либо ещё. Никогда не подписывайся именем.',
    'ЗАПРЕЩЕНО придумывать цены. Называй ТОЛЬКО цены из списка ниже, СЛОВО В СЛОВО.',
    'ЗАПРЕЩЕНО использовать маркдаун: **, ##, -, * и т.д.',
    'ЗАПРЕЩЕНО писать больше 3 предложений.',
    'ЗАПРЕЩЕНО говорить «нажмите кнопку» — кнопки появляются автоматически от системы.',
    'ЗАПРЕЩЕНО подтверждать статус или готовность заказа — скажи «уточню у коллег».',
  ];
  for (const rule of strictRules) parts.push(`- ${rule}`);
  parts.push('Формат ответа: 1-3 предложения чистого текста. Начинай сразу с сути. Без списков. Без подписи. Без имени.');

  // 9. Цены из pricing engine
  if (pricesText) {
    parts.push('\nАктуальные цены (используй СТРОГО ТОЛЬКО позиции из этого списка; если услуги нет — скажи «уточню стоимость»):');
    parts.push(pricesText);
  }

  // 10. Контекст текущей сессии
  const ctxLines: string[] = [];
  ctxLines.push(`Канал: ${channel === 'studio' ? 'studio (офлайн-студия)' : 'online (онлайн-заказ)'}`);
  if (context.lastStep) ctxLines.push(`Текущий шаг: ${context.lastStep}`);
  if (context.selectedDoc) ctxLines.push(`Выбранный документ: ${context.selectedDoc}`);
  if (context.selectedTariff) ctxLines.push(`Выбранный тариф: ${context.selectedTariff}`);
  ctxLines.push(`Загружено фото: ${context.uploadedPhotos}`);
  if (context.pendingOrder?.price) {
    const label = context.pendingOrder.service || context.pendingOrder.tariff || 'заказ';
    ctxLines.push(`Текущий заказ: ${label} — ${context.pendingOrder.price}₽`);
  } else {
    ctxLines.push('Текущий заказ: нет');
  }
  parts.push('\nТекущий контекст сессии:\n' + ctxLines.join('\n'));

  // 11. Доступные UI-действия (если есть)
  if (actions.length > 0) {
    parts.push('\nДоступные действия (если уместно — верни JSON-вызов действия в конце ответа):');
    for (const action of actions) parts.push(`- ${action.name}: ${action.description}`);
    parts.push('Формат: {"name": "action_name", "arguments": {"param": "value"}}');
  }

  return parts.join('\n');
}

/**
 * Вызвать AI провайдер (Gemini / Grok) напрямую через HTTP.
 * Заменяет Python worker (Yandex AI Studio SDK).
 * Цены загружаются из magnus_photo_db и вшиваются в системный промпт.
 */
async function callAIProvider(
  messages: ChatMessage[],
  actions: AiActionDefinition[],
  actionContext: ActionContext,
): Promise<AIWorkerResult> {
  const provider = getAIProvider();

  // Загрузить цены из pricing engine (60s кэш)
  const prices = await getKonturPrices().catch(() => ({}));
  const pricesText = formatPricesForAI(prices);

  // Системный промпт
  const systemPrompt = buildSystemPrompt(actionContext.channel, actionContext, pricesText, actions);

  // Конвертация: local ChatMessage { text } → ProviderMessage { content }
  const providerMessages: ProviderMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.text })),
  ];

  const responseText = await provider.chat(providerMessages, {
    temperature: 0.2,
    maxTokens: 400,
  });

  logger.info(`[AI-Chat] Provider=${provider.name}, response length=${responseText.length}`);

  return { text: responseText, action: null };
}

/**
 * Emit typing indicator to visitor socket.
 */
function emitTyping(sessionId: string, isTyping: boolean): void {
  broadcastToRoom('operator:typing', `visitor:${sessionId}`, { isTyping });
}

function calculateTypingDelay(text: string): number {
  const typingSpeedMs = 40; // ms per character
  const minDelayMs = 1_500;
  const maxDelayMs = 8_000;
  const delay = text.length * typingSpeedMs;
  return Math.min(Math.max(delay, minDelayMs), maxDelayMs);
}

function splitHumanLikeMessage(text: string): { first: string; rest: string | null } {
  if (text.length < 80) {
    return { first: text.trim(), rest: null };
  }

  const candidates = [
    text.indexOf('. '),
    text.indexOf('! '),
    text.indexOf('? '),
  ].filter(index => index > 10);

  if (candidates.length === 0) {
    return { first: text.trim(), rest: null };
  }

  const splitIndex = Math.min(...candidates);
  if (splitIndex < 10 || splitIndex > text.length - 10) {
    return { first: text.trim(), rest: null };
  }

  return {
    first: text.slice(0, splitIndex + 1).trim(),
    rest: text.slice(splitIndex + 1).trim(),
  };
}

/**
 * Extract optional chips from AI output.
 * Supported formats:
 * - [CHIPS: one, two, three]
 * - [CHIPS: "one", "two"]
 */
export function parseChips(text: string): ParsedChips {
  const matches = Array.from(text.matchAll(/\[CHIPS:\s*([^\]]+)\]/gi));
  if (matches.length === 0) {
    return { text: text.trim(), chips: [] };
  }

  const match = matches[matches.length - 1];
  if (!match) {
    return { text: text.trim(), chips: [] };
  }

  const chipsRaw = match[1].trim();
  const cleanedText = text.replace(/\[CHIPS:\s*[^\]]+\]/gi, '').trim();

  let chips: string[] = [];

  // Try quoted format first: "one", "two"
  if (chipsRaw.includes('"')) {
    chips = Array.from(chipsRaw.matchAll(/"([^"]{1,80})"/g)).map(m => m[1].trim()).filter(Boolean);
  }

  // Fallback to comma-separated list
  if (chips.length === 0) {
    chips = chipsRaw
      .split(',')
      .map(chip => chip.trim().replace(/^[-*\s]+/, ''))
      .filter(Boolean)
      .slice(0, 6);
  }

  // Deduplicate while preserving order
  const unique = Array.from(new Set(chips)).slice(0, 6);

  return {
    text: cleanedText,
    chips: unique,
  };
}

async function sendHumanLikeResponse(sessionId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  // Typing уже показан с момента scheduleAIResponse — убираем и отправляем ответ
  emitTyping(sessionId, false);

  const { first, rest } = splitHumanLikeMessage(trimmed);
  await sendAIResponse(sessionId, first);

  if (!rest || operatorActiveSessions.has(sessionId)) return;

  // Для второй части — короткая пауза (500ms) чтобы было естественнее
  emitTyping(sessionId, true);
  await new Promise(resolve => setTimeout(resolve, 500));
  emitTyping(sessionId, false);
  await sendAIResponse(sessionId, rest);
}

/**
 * Save the AI message to the database and emit it via WebSocket.
 */
async function sendAIResponse(sessionId: string, text: string): Promise<void> {
  const parsed = parseChips(text);
  if (!parsed.text && parsed.chips.length === 0) return;

  const interactive = parsed.chips.length > 0
    ? {
      type: 'chips' as const,
      chips: parsed.chips,
      step: 'ai_suggestions',
    }
    : null;

  const metadata = interactive ? JSON.stringify({ interactive }) : null;
  const messageType = 'text';

  const result = await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', $2, $3, $4, $5)
     RETURNING *`,
    [sessionId, BOT_NAME, messageType, parsed.text || 'Выберите следующий шаг', metadata],
  );

  const savedMessage = result.rows[0];

  broadcastToRoom('operator:message', `visitor:${sessionId}`, {
    sessionId,
    content: parsed.text || 'Выберите следующий шаг',
    senderName: BOT_NAME,
    senderType: 'bot',
    messageType,
    attachmentUrl: null,
    timestamp: savedMessage.created_at,
    id: savedMessage.id,
    interactive,
  });

  broadcastChatMessage({
    sessionId,
    message: {
      id: savedMessage.id,
      sender_type: 'bot',
      sender_name: BOT_NAME,
      content: parsed.text || 'Выберите следующий шаг',
      message_type: messageType,
      created_at: savedMessage.created_at,
    },
  }).catch(err => logger.error('[AI-Chat] CRM broadcast failed', { error: String(err) }));

  // Push-уведомление если посетитель офлайн (только в api-процессе, где io доступен)
  if (io) {
    try {
      const sockets = await io.in(`visitor:${sessionId}`).allSockets();
      logger.info(`[AI-Chat] Push check: session=${sessionId}, activeSockets=${sockets.size}`);
      if (sockets.size === 0) {
        logger.info(`[AI-Chat] Sending push notification for session ${sessionId}`);
        await sendVisitorChatPush(sessionId, {
          title: BOT_NAME,
          body: parsed.text.length > 100 ? parsed.text.substring(0, 100) + '…' : parsed.text,
          tag: `sf-chat-${sessionId}`,
        });
        logger.info(`[AI-Chat] Push notification sent for session ${sessionId}`);
      }
    } catch (pushErr) {
      logger.warn('[AI-Chat] Failed to send push notification:', { error: String(pushErr) });
    }
  }

}

async function sendBotResult(sessionId: string, result: BotMessageResult): Promise<void> {
  const interactivePayload = result.interactive
    ? JSON.stringify({ interactive: result.interactive })
    : null;

  const botResult = await pool.query(
    `INSERT INTO messages
      (conversation_id, sender_type, sender_name, message_type, content, metadata)
     VALUES ($1, 'bot', $2, $3, $4, $5)
     RETURNING *`,
    [sessionId, BOT_NAME, result.interactive ? 'interactive' : 'text', result.content, interactivePayload],
  );

  const savedMessage = botResult.rows[0];

  broadcastToRoom('operator:message', `visitor:${sessionId}`, {
    sessionId,
    content: result.content,
    senderName: BOT_NAME,
    senderType: 'bot',
    messageType: result.interactive ? 'interactive' : 'text',
    attachmentUrl: null,
    timestamp: savedMessage.created_at,
    id: savedMessage.id,
    interactive: result.interactive ?? null,
  });

  broadcastChatMessage({
    sessionId,
    message: {
      id: savedMessage.id,
      sender_type: 'bot',
      sender_name: BOT_NAME,
      content: result.content,
      message_type: result.interactive ? 'interactive' : 'text',
      created_at: savedMessage.created_at,
    },
  }).catch(err => logger.error('[AI-Chat] CRM broadcast failed', { error: String(err) }));
}

async function getActionContext(sessionId: string): Promise<ActionContext> {
  const [lastBot, photoCount, messagesRes, sessionRes] = await Promise.all([
    pool.query(
      `SELECT metadata FROM messages
       WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [sessionId],
    ),
    pool.query(
      `SELECT COUNT(*) FROM messages
       WHERE conversation_id = $1 AND sender_type = 'visitor' AND message_type = 'image'`,
      [sessionId],
    ),
    pool.query(
      `SELECT sender_type, content FROM messages
       WHERE conversation_id = $1 AND sender_type = 'visitor' AND message_type = 'text'
       ORDER BY created_at ASC`,
      [sessionId],
    ),
    pool.query(
      `SELECT metadata, channel FROM conversations WHERE id = $1`,
      [sessionId],
    ),
  ]);

  let lastStep: string | null = null;
  if (lastBot.rows.length > 0) {
    try {
      const meta = typeof lastBot.rows[0].metadata === 'string'
        ? JSON.parse(lastBot.rows[0].metadata)
        : lastBot.rows[0].metadata;
      lastStep = meta?.interactive?.step || null;
    } catch {
      lastStep = null;
    }
  }

  const uploadedPhotos = parseInt(photoCount.rows[0]?.count || '0', 10) || 0;

  const docValues = Object.values(DOCUMENT_ACTIONS);
  const tariffValues = Object.values(TARIFF_ACTIONS);
  let selectedDoc: string | null = null;
  let selectedTariff: string | null = null;

  for (const row of messagesRes.rows) {
    const content = row.content as string;
    if (!content) continue;
    const docMatch = docValues.find(doc => content === doc || content.includes(doc));
    if (docMatch) selectedDoc = docMatch;
    const tariffMatch = tariffValues.find(tariff => content === tariff || content.includes(tariff));
    if (tariffMatch) selectedTariff = tariffMatch;
  }

  let pendingOrder: { price?: number; tariff?: string; service?: string } | null = null;
  let channel: 'online' | 'studio' = 'online';
  if (sessionRes.rows.length > 0) {
    const sessionRow = sessionRes.rows[0];
    channel = sessionRow.channel === 'studio' ? 'studio' : 'online';
    try {
      const meta = typeof sessionRow.metadata === 'string'
        ? JSON.parse(sessionRow.metadata)
        : sessionRow.metadata;
      pendingOrder = meta?.pendingOrder || null;
    } catch {
      pendingOrder = null;
    }
  }

  const availableActions = getAvailableActionsForStep(lastStep);

  return {
    lastStep,
    selectedDoc,
    selectedTariff,
    uploadedPhotos,
    pendingOrder,
    availableActions,
    channel,
  };
}

async function handleAiAction(
  sessionId: string,
  action: AiActionCall,
  context: ActionContext,
): Promise<void> {
  const actionName = action.name?.trim().toLowerCase();
  if (!actionName) return;

  const allowed = new Set(context.availableActions.map(a => a.name));
  if (!allowed.has(actionName as AiActionDefinition['name'])) {
    logger.info(`[AI-Chat] Action ${actionName} is not allowed for step ${context.lastStep}`);
    return;
  }

  const normalizedParam = action.param
    ? (actionName === 'request_delivery' ? action.param.trim() : action.param.trim().toLowerCase())
    : undefined;
  const mapped = mapAiActionToButton({ name: actionName, param: normalizedParam });
  if (!mapped) {
    logger.info(`[AI-Chat] Failed to map action ${actionName}`);
    return;
  }

  const botResult = await executeChatAction(sessionId, mapped.buttonValue, mapped.buttonData, {
    followupInput: mapped.followupInput,
  });

  if (botResult) {
    await sendBotResult(sessionId, botResult);
  }
}
