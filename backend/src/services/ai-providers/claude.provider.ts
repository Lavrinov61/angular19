/**
 * Anthropic Claude AI Provider
 * Использует Claude API (Messages) через REST
 * Config: ANTHROPIC_API_KEY env, модель claude-haiku-4-5-20251001
 * Docs: https://docs.anthropic.com/en/api/messages
 */

import { config } from '../../config/index.js';
import type { AIProvider, ChatMessage, AIProviderOptions } from './provider.interface.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../../utils/circuit-breaker.js';

const CLAUDE_BASE = 'https://api.anthropic.com/v1';

interface ClaudeMessageContent {
  type: 'text';
  text: string;
}

interface ClaudeResponse {
  content: ClaudeMessageContent[];
}

export class ClaudeProvider implements AIProvider {
  readonly name = 'claude';

  async chat(messages: ChatMessage[], options: AIProviderOptions = {}): Promise<string> {
    const apiKey = config.ai.anthropicApiKey;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY не настроен');

    // Разделяем system и остальные
    const systemText = messages
      .filter(m => m.role === 'system')
      .map(m => m.content)
      .join('\n\n');

    const convMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const body: Record<string, unknown> = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: options.maxTokens ?? 300,
      messages: convMessages,
    };

    if (systemText) {
      body['system'] = systemText;
    }

    // Claude не поддерживает temperature=0, минимум 0.0 допустим
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }

    const response = await fetchWithCB(SERVICE_BREAKERS.claude, `${CLAUDE_BASE}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as ClaudeResponse;
    const textBlock = data.content?.find(block => block.type === 'text');

    if (!textBlock?.text) throw new Error('Claude: пустой ответ');
    return textBlock.text;
  }
}
