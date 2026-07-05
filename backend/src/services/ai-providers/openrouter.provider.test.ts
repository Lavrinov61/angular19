import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatMessage, ToolDef } from './provider.interface.js';

// ─── Mocks (hoisted so they exist before vi.mock factories run) ───────────────
const h = vi.hoisted(() => ({
  fetchWithCB: vi.fn(),
}));

vi.mock('../../config/index.js', () => ({
  config: { ai: { openrouterApiKey: 'sk-or-test-key' } },
}));
vi.mock('../../utils/circuit-breaker.js', () => ({
  fetchWithCB: (...args: unknown[]) => h.fetchWithCB(...args),
  SERVICE_BREAKERS: { openrouter: { name: 'openrouter-ai' } },
}));

import {
  modelSupportsTemperature,
  buildRequestBody,
  OpenRouterProvider,
} from './openrouter.provider.js';

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: { name: 'calculate_price', description: 'считает цену', parameters: { type: 'object' } },
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('modelSupportsTemperature', () => {
  it('возвращает false для рассуждающих моделей (gpt-5*, opus-4.8*)', () => {
    expect(modelSupportsTemperature('openai/gpt-5.5')).toBe(false);
    expect(modelSupportsTemperature('openai/gpt-5')).toBe(false);
    expect(modelSupportsTemperature('anthropic/claude-opus-4.8')).toBe(false);
    expect(modelSupportsTemperature('anthropic/claude-opus-4.8:thinking')).toBe(false);
  });

  it('возвращает true для обычных моделей (sonnet/grok/gemini/deepseek)', () => {
    expect(modelSupportsTemperature('anthropic/claude-sonnet-4.6')).toBe(true);
    expect(modelSupportsTemperature('x-ai/grok-4')).toBe(true);
    expect(modelSupportsTemperature('google/gemini-2.5-flash')).toBe(true);
    expect(modelSupportsTemperature('deepseek/deepseek-v4-flash')).toBe(true);
  });

  it('не зависит от регистра', () => {
    expect(modelSupportsTemperature('OpenAI/GPT-5.5')).toBe(false);
    expect(modelSupportsTemperature('Anthropic/Claude-Sonnet-4.6')).toBe(true);
  });
});

describe('buildRequestBody — capability-aware temperature', () => {
  const messages: ChatMessage[] = [{ role: 'user', content: 'привет' }];

  it('НЕ кладёт temperature для opus-4.8 даже когда она задана', () => {
    const body = buildRequestBody(messages, TOOLS, {
      model: 'anthropic/claude-opus-4.8',
      temperature: 0.7,
    });
    expect(body.temperature).toBeUndefined();
  });

  it('НЕ кладёт temperature для gpt-5.5 даже когда она задана', () => {
    const body = buildRequestBody(messages, TOOLS, {
      model: 'openai/gpt-5.5',
      temperature: 0.3,
    });
    expect(body.temperature).toBeUndefined();
  });

  it('кладёт temperature для поддерживающей модели (sonnet-4.6)', () => {
    const body = buildRequestBody(messages, TOOLS, {
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0.5,
    });
    expect(body.temperature).toBe(0.5);
  });

  it('не кладёт temperature, если она не задана вовсе', () => {
    const body = buildRequestBody(messages, TOOLS, { model: 'anthropic/claude-sonnet-4.6' });
    expect(body.temperature).toBeUndefined();
  });
});

describe('buildRequestBody — структура и мапинг', () => {
  it('кладёт tools и tool_choice=auto по умолчанию при наличии инструментов', () => {
    const body = buildRequestBody([{ role: 'user', content: 'q' }], TOOLS, {
      model: 'anthropic/claude-sonnet-4.6',
    });
    expect(body.tools).toEqual(TOOLS);
    expect(body.tool_choice).toBe('auto');
  });

  it('не кладёт tools/tool_choice при пустом списке инструментов', () => {
    const body = buildRequestBody([{ role: 'user', content: 'q' }], [], {
      model: 'anthropic/claude-sonnet-4.6',
    });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it('пробрасывает tool_choice=none', () => {
    const body = buildRequestBody([{ role: 'user', content: 'q' }], TOOLS, {
      model: 'anthropic/claude-sonnet-4.6',
      toolChoice: 'none',
    });
    expect(body.tool_choice).toBe('none');
  });

  it('мапит role=tool с tool_call_id и assistant с tool_calls без потерь', () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'сколько стоит А4' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'calculate_price', arguments: '{"size":"A4"}' } },
        ],
      },
      { role: 'tool', content: '{"price":3}', tool_call_id: 'call_1' },
    ];
    const body = buildRequestBody(history, TOOLS, { model: 'anthropic/claude-sonnet-4.6' });

    expect(body.messages).toHaveLength(4);
    const assistantMsg = body.messages[2];
    expect(assistantMsg?.role).toBe('assistant');
    expect(assistantMsg?.tool_calls?.[0]?.id).toBe('call_1');
    const toolMsg = body.messages[3];
    expect(toolMsg?.role).toBe('tool');
    expect(toolMsg?.tool_call_id).toBe('call_1');
    // у user-сообщения служебные поля не появляются
    expect(body.messages[1]?.tool_call_id).toBeUndefined();
    expect(body.messages[1]?.tool_calls).toBeUndefined();
  });
});

describe('buildRequestBody — prompt caching (Anthropic)', () => {
  const withSystem: ChatMessage[] = [
    { role: 'system', content: 'большой системный промпт + правила' },
    { role: 'user', content: 'привет' },
  ];

  it('ставит cache_control на системное сообщение для Anthropic-модели', () => {
    const body = buildRequestBody(withSystem, TOOLS, { model: 'anthropic/claude-sonnet-4.6' });
    const sys = body.messages.find(m => m.role === 'system');
    expect(Array.isArray(sys?.content)).toBe(true);
    const parts = sys?.content as { type: string; text: string; cache_control?: { type: string } }[];
    expect(parts[0]).toEqual({
      type: 'text',
      text: 'большой системный промпт + правила',
      cache_control: { type: 'ephemeral' },
    });
    // user-сообщение остаётся строкой (точка кэша только на стабильном префиксе)
    expect(typeof body.messages.find(m => m.role === 'user')?.content).toBe('string');
    // Anthropic-маршрут закреплён, иначе кэш не переживает смену провайдера.
    expect(body.provider).toEqual({ order: ['anthropic'], allow_fallbacks: true });
  });

  it('НЕ трогает контент и не пиннит провайдера для не-Anthropic модели (классификатор)', () => {
    const body = buildRequestBody(withSystem, TOOLS, { model: 'deepseek/deepseek-v4-flash' });
    const sys = body.messages.find(m => m.role === 'system');
    expect(sys?.content).toBe('большой системный промпт + правила');
    expect(body.provider).toBeUndefined();
  });

  it('без системного сообщения ничего не ломает', () => {
    const body = buildRequestBody([{ role: 'user', content: 'q' }], TOOLS, { model: 'anthropic/claude-sonnet-4.6' });
    expect(typeof body.messages[0]?.content).toBe('string');
  });
});

describe('OpenRouterProvider.chatWithTools — парсинг ответа', () => {
  function mockResponse(payload: unknown, ok = true, status = 200): void {
    h.fetchWithCB.mockResolvedValue({
      ok,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    });
  }

  it('парсит tool_calls в ToolCall[] и usage.cost', async () => {
    mockResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: 'call_42', type: 'function', function: { name: 'calculate_price', arguments: '{"size":"A4"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 30, cost: 0.0004 },
    });

    const provider = new OpenRouterProvider();
    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'сколько стоит печать А4' }],
      TOOLS,
      { model: 'anthropic/claude-sonnet-4.6', temperature: 0.2 },
    );

    expect(res.text).toBeNull();
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toEqual({
      id: 'call_42',
      name: 'calculate_price',
      arguments: '{"size":"A4"}',
    });
    expect(res.usage).toEqual({ promptTokens: 120, completionTokens: 30, cachedTokens: 0 });
    expect(res.cost).toBe(0.0004);
  });

  it('пробрасывает cached_tokens из prompt_tokens_details (cache read)', async () => {
    mockResponse({
      choices: [{ message: { content: 'ответ из кэша' } }],
      usage: { prompt_tokens: 2789, completion_tokens: 40, cost: 0.0009, prompt_tokens_details: { cached_tokens: 2600 } },
    });

    const provider = new OpenRouterProvider();
    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'q' }],
      TOOLS,
      { model: 'anthropic/claude-sonnet-4.6' },
    );

    expect(res.usage).toEqual({ promptTokens: 2789, completionTokens: 40, cachedTokens: 2600 });
  });

  it('парсит обычный текстовый ответ без tool_calls', async () => {
    mockResponse({
      choices: [{ message: { content: 'Печать А4 стоит 3 рубля.' } }],
      usage: { prompt_tokens: 50, completion_tokens: 12 },
    });

    const provider = new OpenRouterProvider();
    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'q' }],
      [],
      { model: 'anthropic/claude-sonnet-4.6' },
    );

    expect(res.text).toBe('Печать А4 стоит 3 рубля.');
    expect(res.toolCalls).toEqual([]);
    expect(res.cost).toBeUndefined();
  });

  it('ответ без поля usage не роняет парсинг (usage/cost = undefined)', async () => {
    // Некоторые модели OpenRouter не присылают usage вовсе. Парсер не должен падать.
    mockResponse({ choices: [{ message: { content: 'ok' } }] });

    const provider = new OpenRouterProvider();
    const res = await provider.chatWithTools(
      [{ role: 'user', content: 'q' }],
      [],
      { model: 'anthropic/claude-sonnet-4.6' },
    );

    expect(res.text).toBe('ok');
    expect(res.toolCalls).toEqual([]);
    expect(res.usage).toBeUndefined();
    expect(res.cost).toBeUndefined();
  });

  it('бросает ошибку при не-ok ответе', async () => {
    mockResponse({ error: 'bad model' }, false, 400);
    const provider = new OpenRouterProvider();
    await expect(
      provider.chatWithTools([{ role: 'user', content: 'q' }], [], { model: 'anthropic/claude-sonnet-4.6' }),
    ).rejects.toThrow(/OpenRouter API error 400/);
  });

  it('отправляет Authorization: Bearer и не шлёт temperature для opus-4.8', async () => {
    mockResponse({ choices: [{ message: { content: 'ok' } }] });
    const provider = new OpenRouterProvider();
    await provider.chatWithTools(
      [{ role: 'user', content: 'q' }],
      [],
      { model: 'anthropic/claude-opus-4.8', temperature: 0.9 },
    );

    expect(h.fetchWithCB).toHaveBeenCalledTimes(1);
    const [, url, init] = h.fetchWithCB.mock.calls[0] as [unknown, string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-or-test-key');
    const sentBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sentBody['temperature']).toBeUndefined();
    expect(sentBody['model']).toBe('anthropic/claude-opus-4.8');
  });
});
