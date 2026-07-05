/**
 * Google Gemini AI Provider
 * Использует Gemini 2.0 Flash (бесплатный tier) через REST API
 * Config: GEMINI_API_KEY env
 */

import { config } from '../../config/index.js';
import type { AIProvider, ChatMessage, AIProviderOptions } from './provider.interface.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../../utils/circuit-breaker.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  async chat(messages: ChatMessage[], options: AIProviderOptions = {}): Promise<string> {
    const apiKey = config.ai.geminiApiKey;
    if (!apiKey) throw new Error('GEMINI_API_KEY не настроен');

    const model = 'gemini-2.0-flash';

    // Разделяем system и остальные
    const systemParts = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    const convMessages = messages.filter(m => m.role !== 'system');

    // Gemini API формат
    const body: Record<string, unknown> = {
      contents: convMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 1024,
      },
    };

    if (systemParts) {
      body['systemInstruction'] = { parts: [{ text: systemParts }] };
    }

    const response = await fetchWithCB(SERVICE_BREAKERS.gemini,
      `${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${err.slice(0, 200)}`);
    }

    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) throw new Error('Gemini: пустой ответ');
    return text;
  }
}
