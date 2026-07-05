/**
 * AI Provider абстракция (ПЛАН 9)
 * Позволяет переключаться между Gemini, Grok и другими провайдерами через config.ai.provider
 *
 * Дополнено (AI-агент, Этап 0-1): тип AgentProvider с chatWithTools для tool-calling
 * через OpenRouter (OpenAI-совместимый формат). Легаси chat()->string не трогаем.
 */

/**
 * Сообщение для assistant-истории с вызовами инструментов (OpenAI-формат).
 * arguments — JSON-строка, как присылает OpenRouter/OpenAI.
 */
export interface ChatMessageToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Только для role==='tool': id вызова, на который отвечает это сообщение */
  tool_call_id?: string;
  /** Только для role==='assistant': список вызовов инструментов в ответе модели */
  tool_calls?: ChatMessageToolCall[];
}

export interface AIProviderOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface AIProvider {
  name: string;
  chat(messages: ChatMessage[], options?: AIProviderOptions): Promise<string>;
}

// ─── AI-агент: tool-calling через OpenRouter (OpenAI-совместимый формат) ──────

/** Объявление инструмента для модели (OpenAI tools-формат). */
export interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

/** Вызов инструмента, как его вернула модель. arguments — JSON-строка от OpenRouter. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** Результат одного хода chatWithTools. */
export interface ChatWithToolsResult {
  text: string | null;
  toolCalls: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number };
  /** Стоимость хода в USD (usage.cost от OpenRouter, если включён usage accounting). */
  cost?: number;
}

/** Опции хода chatWithTools. model обязателен (модель выбирается на уровне агента). */
export interface ChatWithToolsOptions {
  model: string;
  maxTokens?: number;
  temperature?: number;
  toolChoice?: 'auto' | 'none';
}

/**
 * Провайдер с поддержкой tool-calling. Отдельный интерфейс, чтобы не ломать
 * AIProvider.chat()->string у легаси-провайдеров (Claude/Gemini/Grok).
 */
export interface AgentProvider {
  name: string;
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolDef[],
    options: ChatWithToolsOptions,
  ): Promise<ChatWithToolsResult>;
}
