import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Моки для тестов generateOperatorSuggestion (parseChips ниже их не использует) ──
// Mock-функции и мутируемый config-холдер поднимаем через vi.hoisted (иначе
// ReferenceError при подъёме vi.mock-фабрик на верх файла).
const { poolQuery, runAgentTurnMock, claudeChat, aiHolder } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  runAgentTurnMock: vi.fn(),
  claudeChat: vi.fn(),
  // Только AI-блок конфига делаем мутируемым; остальное (webPush и т.п.) берём
  // из реального config через importActual, иначе транзитивные импорты падают.
  aiHolder: {
    agentEnabled: false,
    openrouterApiKey: '',
    agentModel: 'anthropic/claude-sonnet-4.6',
  },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../config/index.js', async () => {
  const actual = await vi.importActual<typeof import('../config/index.js')>('../config/index.js');
  // Заливаем реальные ai-поля в holder (не перетирая наши дефолты-флаги), затем
  // отдаём САМ holder как config.ai, тогда мутации полей в тестах видны коду.
  Object.assign(aiHolder, { ...actual.config.ai, ...aiHolder });
  return { config: { ...actual.config, ai: aiHolder } };
});

vi.mock('../database/db.js', () => ({ pool: { query: poolQuery } }));

// Orchestrator: его логику покрывает свой spec, здесь только граница вызова.
vi.mock('./ai-agent/ai-agent-orchestrator.service.js', () => ({
  runAgentTurn: runAgentTurnMock,
}));

// Легаси-провайдер: динамический import('./ai-providers/claude.provider.js')
// vitest перехватывает по тому же спецификатору. new ClaudeProvider().chat -> мок.
// Отдаём класс (а не vi.fn со стрелкой: её нельзя вызвать через new).
vi.mock('./ai-providers/claude.provider.js', () => ({
  ClaudeProvider: class {
    chat = claudeChat;
  },
}));

import { generateOperatorSuggestion, parseChips } from './ai-chat.service.js';

describe('parseChips', () => {
  it('parses quoted chips from tag at message end', () => {
    const result = parseChips('Ответ клиенту\n[CHIPS: "Оплатить", "В меню"]');

    expect(result.text).toBe('Ответ клиенту');
    expect(result.chips).toEqual(['Оплатить', 'В меню']);
  });

  it('parses non-quoted comma chips', () => {
    const result = parseChips('Текст\n[CHIPS: Оплатить, Назад, В меню]');

    expect(result.text).toBe('Текст');
    expect(result.chips).toEqual(['Оплатить', 'Назад', 'В меню']);
  });

  it('uses the last CHIPS tag when multiple are present', () => {
    const result = parseChips('Текст [CHIPS: one, two]\nещё строка\n[CHIPS: "Три", "Четыре"]');

    expect(result.text).toBe('Текст \nещё строка');
    expect(result.chips).toEqual(['Три', 'Четыре']);
  });
});

describe('generateOperatorSuggestion: граница агент/легаси', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Сброс конфига к дефолту (мок-функции clearAllMocks уже очистил, объект нет).
    aiHolder.agentEnabled = false;
    aiHolder.openrouterApiKey = '';
    aiHolder.agentModel = 'anthropic/claude-sonnet-4.6';
  });

  it('C1: agentEnabled=false -> идёт легаси (ClaudeProvider.chat), runAgentTurn не вызывается', async () => {
    aiHolder.agentEnabled = false;
    aiHolder.openrouterApiKey = 'sk-or-irrelevant';

    // getChatHistory: одна реплика клиента (непустая история, иначе legacy кинет).
    poolQuery.mockResolvedValueOnce({
      rows: [{ sender_type: 'visitor', content: 'Сколько стоит фото на паспорт?' }],
    });
    claudeChat.mockResolvedValue('Здравствуйте! Фото на паспорт стоит 300 рублей.');

    const res = await generateOperatorSuggestion('sess-c1');

    expect(res).toBe('Здравствуйте! Фото на паспорт стоит 300 рублей.');
    // Агент не задействован: ход не запускался.
    expect(runAgentTurnMock).not.toHaveBeenCalled();
    // Легаси отработал через ClaudeProvider.chat.
    expect(claudeChat).toHaveBeenCalledTimes(1);
  });

  it('C2: agentEnabled=true + ключ задан, runAgentTurn бросает -> fallback на легаси, не падает', async () => {
    aiHolder.agentEnabled = true;
    aiHolder.openrouterApiKey = 'sk-or-test-key';

    // 1) resolveSuggestionIdentity (agentReady-путь) -> identity-строка;
    // 2) getChatHistory (внутри легаси-fallback) -> история диалога.
    poolQuery
      .mockResolvedValueOnce({
        rows: [{ contact_id: 'c-1', user_id: 'u-1', phone: '+79011234567' }],
      })
      .mockResolvedValueOnce({
        rows: [{ sender_type: 'visitor', content: 'Когда будет готов заказ?' }],
      });

    // Ход агента падает (таймаут/провайдер/БД), функция обязана деградировать.
    runAgentTurnMock.mockRejectedValue(new Error('provider timeout'));
    claudeChat.mockResolvedValue('Уточню по вашему заказу и вернусь к вам.');

    const res = await generateOperatorSuggestion('sess-c2');

    // Не упало: вернулась строка из легаси-fallback.
    expect(res).toBe('Уточню по вашему заказу и вернусь к вам.');
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1);
    // Личность прокинута в ход из резолва по sessionId.
    expect(runAgentTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'sess-c2',
        contactId: 'c-1',
        userId: 'u-1',
        phone: '+79011234567',
        mode: 'suggest',
      }),
    );
    // Легаси-fallback реально отработал.
    expect(claudeChat).toHaveBeenCalledTimes(1);
  });
});
