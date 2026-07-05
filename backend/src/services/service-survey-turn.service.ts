/**
 * Разговорный опрос-забота — один ход диалога.
 *
 * Backend БЕЗ состояния: VoxEngine-сценарий копит историю реплик и присылает её
 * целиком в каждом ходе (`/telephony/service-survey/turn`). Здесь:
 *   1) первый ход (клиент ещё не говорил) → отдаём заготовленное приветствие
 *      с дисклеймером о записи (мозг не дёргаем, дёшево и мгновенно);
 *   2) дальше → короткая тёплая реплика от мозга (Claude через OpenRouter, БЕЗ
 *      инструментов — это опрос, не продажи и не оформление заказа);
 *   3) после лимита ходов → вежливое прощание и end=true (страховка от зацикливания);
 *   4) озвучка реплики: gpt-audio (голос OpenAI) → WAV в S3 → URL для URLPlayer.
 *      Сбой синтеза = audioUrl:null, VoxEngine озвучит встроенным TTS (фолбэк).
 *
 * Принципы опроса — из аналитики владельца: забота, не прайс-автомат; коротко,
 * two-way, реагировать эмпатично; ИИ честно представляется. Без тире в копирайте.
 * См. файл памяти ai-survey-care-plan-2026-06-03 и voximplant-voice-agent-stack-2026-06-03.
 */

import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { ChatMessage } from './ai-providers/provider.interface.js';

// Тяжёлые зависимости (провайдер OpenRouter с circuit-breaker, TTS, storage) грузим
// ЛЕНИВО внутри функций: иначе сам импорт turn-сервиса тянет на import-time
// circuit-breaker/redis/s3, что ломает тесты роутера с частичным моком config.

const log = createLogger('service-survey-turn');

export type SurveyTurnRole = 'bot' | 'client';

export interface SurveyTurnMessage {
  role: SurveyTurnRole;
  text: string;
}

export interface RunSurveyTurnInput {
  sessionId: string;
  /** Полная история диалога к этому моменту (как её ведёт VoxEngine). */
  history: SurveyTurnMessage[];
  /** Индекс хода от VoxEngine — для идемпотентности (ретрай не дёргает мозг/TTS дважды). */
  turnIndex: number;
}

export interface SurveyTurnResult {
  replyText: string;
  /** Публичный HTTPS URL WAV-файла для проигрывания, либо null (фолбэк на say). */
  audioUrl: string | null;
  /** true = это последняя реплика, после неё VoxEngine прощается и кладёт трубку. */
  end: boolean;
}

const SURVEY_SYSTEM_PROMPT = [
  'Ты доброжелательный голосовой ассистент фотостудии «Своё Фото». Ты звонишь клиенту',
  'после оказанной услуги, чтобы искренне узнать его впечатление и позаботиться о нём.',
  '',
  'Правила:',
  '1. Это забота и живой разговор, а не анкета и не продажа. Никаких «оцените по шкале».',
  '2. Говори коротко и тепло: одна, максимум две короткие фразы за реплику (это телефон).',
  '3. Внимательно слушай и реагируй на то, что сказал человек: уточняй, благодари, сочувствуй.',
  '4. Если клиент доволен — порадуйся вместе с ним и мягко поблагодари.',
  '5. Если клиент недоволен или указал на проблему — извинись, поблагодари за честность и пообещай',
  '   передать это команде, чтобы стать лучше. Не оправдывайся и не спорь.',
  '6. Не навязывай услуги и не называй цены. Если спросят про запись или заказ — предложи,',
  '   что с ними свяжется студия, и продолжи разговор.',
  '7. Ты ИИ-ассистент, при прямом вопросе честно это признай.',
  '8. Не используй тире и длинные перечисления в речи — говори естественно, как человек по телефону.',
  '9. Веди разговор к мягкому завершению за несколько реплик: поблагодари и тепло попрощайся.',
].join('\n');

const FAREWELL_TEXT = 'Спасибо большое за ваше время и за тёплый отклик! Нам очень приятно. Хорошего вам дня и до встречи в Своём Фото.';
const BRAIN_FALLBACK_TEXT = 'Спасибо вам большое за ответ! Нам очень важно ваше мнение. Хорошего дня!';

// ─── Идемпотентность в пределах звонка (ретраи VoxEngine) ─────────────────────
interface CachedTurn { result: SurveyTurnResult; at: number }
const turnCache = new Map<string, CachedTurn>();
// Идущие прямо сейчас вычисления хода: если ретрай прилетит, пока первый запрос
// ещё считает (мозг+TTS), отдаём тот же Promise, а не дёргаем модель повторно.
const turnsInFlight = new Map<string, Promise<SurveyTurnResult>>();
const TURN_CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(sessionId: string, turnIndex: number): string {
  return `${sessionId}:${turnIndex}`;
}

function pruneCache(now: number): void {
  for (const [key, entry] of turnCache) {
    if (now - entry.at > TURN_CACHE_TTL_MS) turnCache.delete(key);
  }
}

function countClientTurns(history: SurveyTurnMessage[]): number {
  return history.filter(m => m.role === 'client' && m.text.trim().length > 0).length;
}

/** История диалога → сообщения для мозга (bot=assistant, client=user). */
function toBrainMessages(history: SurveyTurnMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: 'system', content: SURVEY_SYSTEM_PROMPT }];
  for (const m of history) {
    const text = m.text.trim();
    if (!text) continue;
    messages.push({ role: m.role === 'bot' ? 'assistant' : 'user', content: text });
  }
  return messages;
}

/** Озвучивает реплику: gpt-audio → WAV в S3 → URL. Сбой = null (фолбэк на say). */
async function buildAudioUrl(sessionId: string, turnIndex: number, text: string): Promise<string | null> {
  if (config.voximplant.serviceSurvey.voiceEngine !== 'remote') return null;
  try {
    const { synthesizeSpeech } = await import('./ai-providers/openrouter-tts.service.js');
    const speech = await synthesizeSpeech(text);
    const { storageService } = await import('./storage.service.js');
    // Детерминированный ключ по (sessionId, turnIndex): ретрай перезапишет тот же
    // файл, без накопления мусора в S3 и лишних загрузок.
    const key = `service-survey-audio/${encodeURIComponent(sessionId)}/${turnIndex}.${speech.ext}`;
    await storageService.upload(speech.buffer, key, speech.mime);
    // Bucket приватный (public URL отдаёт 403), поэтому отдаём VoxEngine ПОДПИСАННЫЙ
    // URL (через публичный s3-proxy) с запасом по времени на проигрывание.
    return await storageService.generatePresignedGetUrl(key, 3600);
  } catch (error) {
    log.warn('TTS-синтез не удался, VoxEngine озвучит встроенным голосом', {
      sessionId, turnIndex, error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function generateReplyText(history: SurveyTurnMessage[]): Promise<string> {
  try {
    const { OpenRouterProvider } = await import('./ai-providers/openrouter.provider.js');
    const provider = new OpenRouterProvider();
    const result = await provider.chatWithTools(toBrainMessages(history), [], {
      model: config.voximplant.serviceSurvey.brainModel,
      maxTokens: 200,
      temperature: 0.6,
    });
    const text = (result.text ?? '').trim();
    log.info('Реплика опроса сгенерирована', {
      model: config.voximplant.serviceSurvey.brainModel,
      costUsd: result.cost,
      promptTokens: result.usage?.promptTokens,
      completionTokens: result.usage?.completionTokens,
    });
    return text || BRAIN_FALLBACK_TEXT;
  } catch (error) {
    log.warn('Мозг опроса недоступен, отдаём запасную реплику', {
      error: error instanceof Error ? error.message : String(error),
    });
    return BRAIN_FALLBACK_TEXT;
  }
}

/**
 * Один ход разговорного опроса. Идемпотентен по (sessionId, turnIndex).
 */
export async function runSurveyTurn(input: RunSurveyTurnInput): Promise<SurveyTurnResult> {
  const now = Date.now();
  pruneCache(now);
  const key = cacheKey(input.sessionId, input.turnIndex);

  const cached = turnCache.get(key);
  if (cached) return cached.result;

  // Ретрай прилетел, пока первый запрос ещё считает — ждём его, не дублируем мозг/TTS.
  const inFlight = turnsInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<SurveyTurnResult> => {
    const clientTurns = countClientTurns(input.history);
    const maxTurns = config.voximplant.serviceSurvey.maxTurns;

    let replyText: string;
    let end = false;

    if (clientTurns === 0) {
      // Первый ход: приветствие + дисклеймер о записи. Мозг не нужен.
      replyText = config.voximplant.serviceSurvey.greeting;
    } else if (clientTurns >= maxTurns) {
      // Достигли лимита ходов — вежливо прощаемся.
      replyText = FAREWELL_TEXT;
      end = true;
    } else {
      replyText = await generateReplyText(input.history);
    }

    const audioUrl = await buildAudioUrl(input.sessionId, input.turnIndex, replyText);
    const result: SurveyTurnResult = { replyText, audioUrl, end };
    turnCache.set(key, { result, at: Date.now() });
    return result;
  })();

  turnsInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    turnsInFlight.delete(key);
  }
}

/** Для тестов: сбросить кэш идемпотентности. */
export function __resetSurveyTurnCache(): void {
  turnCache.clear();
  turnsInFlight.clear();
}
