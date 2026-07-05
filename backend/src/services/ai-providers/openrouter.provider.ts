/**
 * OpenRouter AI Provider (AI-агент, Этап 0-1)
 *
 * Единый транспорт для всех моделей агента (вышибала/мозг/будущий аудио):
 * один эндпоинт OpenRouter + один ключ OPENROUTER_API_KEY. «Какая модель» —
 * это значение options.model. Прямые claude/gemini/grok.provider.ts остаются
 * легаси веб-suggest и через этот провайдер НЕ идут.
 *
 * Формат запроса OpenAI-совместимый (chat/completions) с tools/tool_choice.
 * Docs: https://openrouter.ai/docs/api-reference/chat-completion
 */

import { config } from '../../config/index.js';
import type {
  AgentProvider,
  ChatMessage,
  ChatWithToolsOptions,
  ChatWithToolsResult,
  ToolCall,
  ToolDef,
} from './provider.interface.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../../utils/circuit-breaker.js';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// Атрибуция приложения для рейтингов OpenRouter (необязательна, но рекомендована).
const OPENROUTER_REFERER = 'https://svoefoto.ru';
const OPENROUTER_TITLE = 'Svoe Foto AI Agent';

/**
 * CAPABILITY-AWARE: рассуждающие модели фиксируют температуру на стороне
 * провайдера. У них в OpenRouter /models supported_parameters НЕ содержит
 * temperature (проверено 2026-06-02: всё openai/gpt-5* и anthropic/claude-opus-4.8*
 * = temperature:false). Для таких моделей НЕ кладём temperature в тело запроса:
 * консервативно, чтобы исключить риск 400 на маршрутах/провайдерах, которые
 * параметр не дропают молча.
 *
 * Список префиксов (хардкод, надёжнее похода в /models на каждый запрос):
 *  - 'openai/gpt-5'            — всё семейство GPT-5 (gpt-5, 5.1..5.5, pro/codex/mini/nano).
 *                               Зацепит и редкие gpt-5-image* (у них temperature:true),
 *                               но потеря необязательного параметра безопасна.
 *  - 'anthropic/claude-opus-4.8' — Opus 4.8 (включая -fast), температура фиксирована.
 *
 * Остальные модели (sonnet-4.6, grok, gemini, deepseek и т.п.) temperature поддерживают.
 */
const TEMPERATURE_UNSUPPORTED_PREFIXES = [
  'openai/gpt-5',
  'anthropic/claude-opus-4.8',
] as const;

export function modelSupportsTemperature(model: string): boolean {
  const normalized = model.toLowerCase();
  return !TEMPERATURE_UNSUPPORTED_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

// ─── Тело запроса (вынесено отдельно для юнит-тестов без мока fetch) ──────────

/**
 * Текстовая часть контента. cache_control — точка prompt-кэширования Anthropic
 * (через OpenRouter): помеченный блок и весь префикс до него кэшируются.
 */
interface ContentPart {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

/** Сообщение в OpenAI-формате (то, что реально уходит в тело запроса). */
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  tool_call_id?: string;
  tool_calls?: ChatMessage['tool_calls'];
}

/** Anthropic-модели OpenRouter поддерживают prompt caching через cache_control. */
function isAnthropicModel(model: string): boolean {
  return model.toLowerCase().startsWith('anthropic/');
}

interface OpenRouterRequestBody {
  model: string;
  messages: OpenAIMessage[];
  tools?: ToolDef[];
  tool_choice?: 'auto' | 'none';
  max_tokens?: number;
  temperature?: number;
  usage?: { include: boolean };
  provider?: { order?: string[]; allow_fallbacks?: boolean };
}

/**
 * Закрепление провайдера для Anthropic-моделей. Prompt-кэш живёт НА СТОРОНЕ
 * провайдера: если соседние вызовы хода уходят к разным провайдерам (Anthropic
 * vs Google Vertex vs Bedrock), общего кэша нет и cache_control бесполезен.
 * Пиннинг порядком гарантирует, что все вызовы идут к одному провайдеру (Anthropic),
 * поэтому префикс реально читается из кэша. allow_fallbacks=true оставляет
 * запасные провайдеры на случай недоступности (тогда просто без кэша, но без сбоя).
 */
const ANTHROPIC_PROVIDER_ORDER = ['anthropic'] as const;

/** Мапим наш ChatMessage в OpenAI-сообщение, пробрасывая tool-поля как есть. */
function toOpenAIMessage(m: ChatMessage): OpenAIMessage {
  const out: OpenAIMessage = { role: m.role, content: m.content };
  if (m.tool_call_id !== undefined) {
    out.tool_call_id = m.tool_call_id;
  }
  if (m.tool_calls !== undefined) {
    out.tool_calls = m.tool_calls;
  }
  return out;
}

/**
 * Собирает тело запроса к OpenRouter. Экспортируется для юнит-тестов:
 * проверяем, что temperature НЕ уходит для не поддерживающих её моделей.
 */
export function buildRequestBody(
  messages: ChatMessage[],
  tools: ToolDef[],
  options: ChatWithToolsOptions,
): OpenRouterRequestBody {
  const body: OpenRouterRequestBody = {
    model: options.model,
    messages: messages.map(toOpenAIMessage),
    // usage accounting включаем, чтобы получить usage.cost в ответе
    usage: { include: true },
  };

  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = options.toolChoice ?? 'auto';
  }

  // Prompt caching (Anthropic через OpenRouter): ставим точку кэширования на
  // системное сообщение. Anthropic кэширует префикс до неё включительно в порядке
  // [инструменты, системный промпт], а это самый тяжёлый и НЕизменный между шагами
  // хода и между диалогами блок (схемы инструментов + правила). Повторные вызовы
  // читают его из кэша (~10% цены входных токенов), а не оплачивают заново.
  // Для не-Anthropic моделей (классификатор) не трогаем — формат частей им не нужен.
  if (isAnthropicModel(options.model)) {
    const sys = body.messages.find(m => m.role === 'system');
    if (sys && typeof sys.content === 'string' && sys.content.length > 0) {
      sys.content = [{ type: 'text', text: sys.content, cache_control: { type: 'ephemeral' } }];
    }
    // Закрепляем Anthropic-маршрут, иначе кэш не переживает смену провайдера.
    body.provider = { order: [...ANTHROPIC_PROVIDER_ORDER], allow_fallbacks: true };
  }

  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }

  // CAPABILITY-AWARE: добавляем temperature только если модель её поддерживает
  if (options.temperature !== undefined && modelSupportsTemperature(options.model)) {
    body.temperature = options.temperature;
  }

  return body;
}

// ─── Парсинг ответа ───────────────────────────────────────────────────────────

interface OpenRouterToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenRouterChoiceMessage {
  content?: string | null;
  tool_calls?: OpenRouterToolCall[];
}

interface OpenRouterResponse {
  choices?: { message?: OpenRouterChoiceMessage }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
    /** Сколько входных токенов взято из prompt-кэша (cache read). */
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function parseToolCalls(raw: OpenRouterToolCall[] | undefined): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const result: ToolCall[] = [];
  for (const tc of raw) {
    const name = tc.function?.name;
    if (!name) continue; // без имени вызов бесполезен — пропускаем
    result.push({
      id: tc.id ?? '',
      name,
      arguments: tc.function?.arguments ?? '',
    });
  }
  return result;
}

// ─── Провайдер ──────────────────────────────────────────────────────────────

export class OpenRouterProvider implements AgentProvider {
  readonly name = 'openrouter';

  async chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResult> {
    const apiKey = config.ai.openrouterApiKey;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY не настроен');

    const body = buildRequestBody(messages, tools, options);

    const response = await fetchWithCB(SERVICE_BREAKERS.openrouter, `${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': OPENROUTER_REFERER,
        'X-Title': OPENROUTER_TITLE,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${err.slice(0, 300)}`);
    }

    const data = await response.json() as OpenRouterResponse;
    const message = data.choices?.[0]?.message;
    const toolCalls = parseToolCalls(message?.tool_calls);

    const result: ChatWithToolsResult = {
      text: message?.content ?? null,
      toolCalls,
    };

    if (data.usage) {
      result.usage = {
        promptTokens: data.usage.prompt_tokens ?? 0,
        completionTokens: data.usage.completion_tokens ?? 0,
        cachedTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
      };
      if (typeof data.usage.cost === 'number') {
        result.cost = data.usage.cost;
      }
    }

    return result;
  }
}
