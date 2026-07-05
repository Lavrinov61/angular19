/**
 * xAI Grok AI Provider
 * Использует OpenAI-совместимый API xAI
 * Config: GROK_API_KEY env, модель grok-3-mini
 * Docs: https://docs.x.ai/api
 */

import { config } from '../../config/index.js';
import type { AIProvider, ChatMessage, AIProviderOptions } from './provider.interface.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../../utils/circuit-breaker.js';

const GROK_BASE = 'https://api.x.ai/v1';

export class GrokProvider implements AIProvider {
  readonly name = 'grok';

  async chat(messages: ChatMessage[], options: AIProviderOptions = {}): Promise<string> {
    const apiKey = config.ai.grokApiKey;
    if (!apiKey) throw new Error('GROK_API_KEY не настроен');

    const body = {
      model: 'grok-3-mini',
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 1024,
    };

    const response = await fetchWithCB(SERVICE_BREAKERS.grok, `${GROK_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Grok API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;

    if (!text) throw new Error('Grok: пустой ответ');
    return text;
  }
}
