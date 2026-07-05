/**
 * AI Provider Factory
 * Выбирает провайдера по config.ai.provider (env AI_PROVIDER)
 *
 * getAgentProvider() — отдельная фабрика для AI-агента (tool-calling через OpenRouter).
 * НЕ путать с getAIProvider() (легаси chat()->string для веб-suggest/ботов).
 */

import { GeminiProvider } from './gemini.provider.js';
import { GrokProvider } from './grok.provider.js';
import { ClaudeProvider } from './claude.provider.js';
import { OpenRouterProvider } from './openrouter.provider.js';
import { config } from '../../config/index.js';
import type { AIProvider, AgentProvider } from './provider.interface.js';

export { type AIProvider, type ChatMessage, type AIProviderOptions } from './provider.interface.js';
export {
  type AgentProvider,
  type ToolDef,
  type ToolCall,
  type ChatWithToolsResult,
  type ChatWithToolsOptions,
  type ChatMessageToolCall,
} from './provider.interface.js';
export { OpenRouterProvider, modelSupportsTemperature } from './openrouter.provider.js';

export function getAIProvider(): AIProvider {
  const name = config.ai.provider;
  switch (name) {
    case 'claude':  return new ClaudeProvider();
    case 'grok':    return new GrokProvider();
    case 'gemini':
    default:        return new GeminiProvider();
  }
}

/**
 * Провайдер для AI-агента — единый транспорт OpenRouter (один ключ, любая модель
 * задаётся параметром options.model). Возвращает AgentProvider с chatWithTools.
 */
export function getAgentProvider(): AgentProvider {
  return new OpenRouterProvider();
}
