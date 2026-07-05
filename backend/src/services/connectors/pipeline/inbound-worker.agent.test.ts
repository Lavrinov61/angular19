import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Тесты test-seam `resolveAgentModeForInbound` (slice S4) — ленивый автозапуск
 * бота и гонки режимов. Это самая рискованная часть S4: CAS off->bot не должен
 * перетирать 'operator' (перехват) и обязан уважать глобальный гейт agentEnabled.
 *
 * Мокинг: db.queryOne диспетчеризуется по SQL (SELECT режим -> строка диалога;
 * CAS UPDATE off->bot -> moved|null). bullmq замокан, чтобы импорт модуля (и
 * транзитивного ai-turn-worker) не открывал реальные очереди.
 */

const { mockQueryOne, mockQuery, agentEnabledRef, autoReturnRef, redisGetRef } = vi.hoisted(() => ({
  mockQueryOne: vi.fn(),
  mockQuery: vi.fn().mockResolvedValue([]),
  agentEnabledRef: { value: true },
  // Управление новыми ветками авто-возврата operator->bot (slice S2).
  autoReturnRef: { enabled: true, handoffMin: 30, operatorMin: 240 },
  // Redis-override ai:auto_return: 'value' возвращается из redis.get,
  // 'client' позволяет смоделировать недоступность Redis (getCrmRedis=null),
  // 'throws' — реджект самого .get() (Redis флапает на чтении).
  redisGetRef: { value: null as string | null, client: true, throws: false },
}));

vi.mock('bullmq', () => {
  function MockQueue() {
    return { add: vi.fn().mockResolvedValue(undefined), getJob: vi.fn().mockResolvedValue(null) };
  }
  function MockWorker() {
    return { on: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('../../../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne },
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock('../../../config/index.js', () => ({
  config: {
    redis: { host: 'localhost', port: 6379, password: '', tls: undefined },
    telegram: { botToken: 'test-token' },
    whatsapp: { mediaDeliveryUrl: '' },
    get ai() {
      return {
        agentEnabled: agentEnabledRef.value,
        autoReturnEnabled: autoReturnRef.enabled,
        handoffReturnMinutes: autoReturnRef.handoffMin,
        operatorReturnMinutes: autoReturnRef.operatorMin,
      };
    },
  },
}));

// Redis-override авто-возврата: getCrmRedis()?.get('ai:auto_return').
vi.mock('../../redis-cache.service.js', () => ({
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  getCrmRedis: () =>
    redisGetRef.client
      ? {
          get: redisGetRef.throws
            ? vi.fn().mockRejectedValue(new Error('redis down'))
            : vi.fn().mockResolvedValue(redisGetRef.value),
        }
      : null,
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('../../../utils/error-tracker.js', () => ({
  captureException: vi.fn(),
}));

// Тяжёлые соседи inbound-worker тянут очереди/alerting/storage на верхнем уровне
// модуля. Для теста чистой функции resolveAgentModeForInbound они не нужны —
// глушим их импорт (как ai-turn-worker.test глушит своих соседей).
vi.mock('./outbound-worker.js', () => ({ enqueueOutbound: vi.fn() }));
vi.mock('./ai-turn-worker.js', () => ({ enqueueAiTurn: vi.fn() }));
vi.mock('./broadcast.js', () => ({
  broadcastNewMessage: vi.fn(),
  broadcastMergeSuggestion: vi.fn(),
  broadcastConversationUpdate: vi.fn(),
}));

// Импорт ПОСЛЕ моков.
const { resolveAgentModeForInbound } = await import('./inbound-worker.js');

const CONV_ID = 'conv-1';

/** Найти CAS-UPDATE off->bot среди вызовов db.queryOne. */
function findCasUpdate() {
  return mockQueryOne.mock.calls.find(c =>
    typeof c[0] === 'string'
      && c[0].includes("ai_agent_mode = 'bot'")
      && c[0].includes("ai_agent_mode = 'off'"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  agentEnabledRef.value = true;
  autoReturnRef.enabled = true;
  autoReturnRef.handoffMin = 30;
  autoReturnRef.operatorMin = 240;
  redisGetRef.value = null; // ai:auto_return отсутствует -> авто-возврат активен
  redisGetRef.client = true;
  redisGetRef.throws = false;
});

/** Найти CAS-UPDATE авто-возврата operator->bot среди вызовов db.queryOne. */
function findAutoReturnUpdate() {
  return mockQueryOne.mock.calls.find(c =>
    typeof c[0] === 'string'
      && c[0].includes("ai_agent_mode = 'bot'")
      && c[0].includes("ai_agent_mode = 'operator'")
      && c[0].includes('NOT EXISTS'),
  );
}

describe('resolveAgentModeForInbound — глобальный гейт', () => {
  it('agentEnabled=false -> mode=null, БД не трогаем (поведение как до Этапа 2)', async () => {
    agentEnabledRef.value = false;

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: null, hasChannel: false });
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});

describe('resolveAgentModeForInbound — ленивый автозапуск off->bot', () => {
  it("mode='off' + есть канал -> CAS переводит в 'bot'", async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ai_agent_mode, external_chat_id')) {
        return { ai_agent_mode: 'off', external_chat_id: '111' };
      }
      if (sql.includes("ai_agent_mode = 'off'")) {
        return { ai_agent_mode: 'bot' }; // CAS успешен
      }
      return null;
    });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'bot', hasChannel: true });
    const cas = findCasUpdate();
    expect(cas).toBeDefined();
    expect(cas?.[0]).toContain("ai_agent_mode_set_by = 'auto'");
  });

  it("CAS off->bot проигран (гонка: уже перехвачен) -> mode НЕ 'bot' (operator), ход не поставят", async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ai_agent_mode, external_chat_id')) {
        return { ai_agent_mode: 'off', external_chat_id: '111' };
      }
      if (sql.includes("ai_agent_mode = 'off'")) {
        return null; // CAS не сработал (режим уже сменился)
      }
      return null;
    });

    const res = await resolveAgentModeForInbound(CONV_ID);

    // Не 'bot' => вызывающий не поставит ход и не назначит тихо.
    expect(res.mode).not.toBe('bot');
    expect(res.hasChannel).toBe(true);
  });
});

describe('resolveAgentModeForInbound — авто-возврат operator->bot (slice S2)', () => {
  /**
   * Хелпер: мок SELECT-строки диалога (operator + set_by/locked_at) и CAS-UPDATE
   * авто-возврата. `casReturned` — что вернул RETURNING (строка -> возврат удался,
   * null -> порог не прошёл / оператор писал недавно / гонка set_by).
   */
  function mockOperatorRow(
    setBy: string | null,
    casReturned: { ai_agent_mode: string } | null,
  ) {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ai_agent_mode, external_chat_id')) {
        return {
          ai_agent_mode: 'operator',
          external_chat_id: '111',
          ai_agent_mode_set_by: setBy,
          ai_agent_locked_at: new Date('2026-06-06T00:00:00Z'),
        };
      }
      if (sql.includes("ai_agent_mode = 'operator'") && sql.includes('NOT EXISTS')) {
        return casReturned;
      }
      return null;
    });
  }

  it('autoReturnEnabled=false -> operator, CAS не зовём', async () => {
    autoReturnRef.enabled = false;
    mockOperatorRow('agent_handoff', { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    expect(findAutoReturnUpdate()).toBeUndefined();
  });

  it("Redis ai:auto_return='false' -> operator без CAS (override)", async () => {
    redisGetRef.value = 'false';
    mockOperatorRow('agent_handoff', { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    expect(findAutoReturnUpdate()).toBeUndefined();
  });

  it('Redis недоступен (getCrmRedis=null) -> fail-closed, operator без CAS', async () => {
    redisGetRef.client = false;
    mockOperatorRow('agent_handoff', { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    expect(findAutoReturnUpdate()).toBeUndefined();
  });

  it('P1-A: redis.get реджектит (Redis флапает) -> fail-closed, operator без CAS', async () => {
    redisGetRef.throws = true; // сам .get('ai:auto_return') бросает
    mockOperatorRow('agent_handoff', { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    // isAutoReturnSilenced ловит throw -> true (подавляем). Оператора не перебиваем.
    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    expect(findAutoReturnUpdate()).toBeUndefined();
  });

  it("set_by='agent_handoff' + CAS вернул строку (тишина>=порог) -> 'bot' (auto:handoff_return)", async () => {
    mockOperatorRow('agent_handoff', { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'bot', hasChannel: true });
    const cas = findAutoReturnUpdate();
    expect(cas).toBeDefined();
    // newSetBy, прежний set_by, порог минут (handoff=30).
    expect(cas?.[1]).toEqual([CONV_ID, 'auto:handoff_return', 'agent_handoff', '30']);
  });

  it("set_by='operator:<uuid>' + CAS вернул строку (тишина>=порог) -> 'bot' (auto:operator_return)", async () => {
    mockOperatorRow('operator:abc-123', { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'bot', hasChannel: true });
    const cas = findAutoReturnUpdate();
    expect(cas).toBeDefined();
    // newSetBy, прежний set_by, порог минут (operator=240).
    expect(cas?.[1]).toEqual([CONV_ID, 'auto:operator_return', 'operator:abc-123', '240']);
  });

  it('set_by=agent_handoff + CAS вернул 0 строк (тишина<порог) -> operator', async () => {
    mockOperatorRow('agent_handoff', null);

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    // CAS вызывался, но вернул пусто.
    expect(findAutoReturnUpdate()).toBeDefined();
  });

  it('P1-1: тот же оператор дописал -> CAS поймал свежее operator-сообщение (0 строк) -> operator', async () => {
    // NOT EXISTS внутри CAS видит свежий operator-reply -> UPDATE 0 строк.
    mockOperatorRow('operator:abc-123', null);

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    expect(findAutoReturnUpdate()).toBeDefined();
  });

  it('set_by=NULL -> operator без CAS (нет понятного источника паузы)', async () => {
    mockOperatorRow(null, { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    expect(findAutoReturnUpdate()).toBeUndefined();
  });

  it("set_by неизвестный ('auto' и т.п.) -> operator без CAS", async () => {
    mockOperatorRow('auto', { ai_agent_mode: 'bot' });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'operator', hasChannel: true });
    expect(findAutoReturnUpdate()).toBeUndefined();
  });
});

describe('resolveAgentModeForInbound — режимы, которые не трогаем', () => {
  it("mode='bot' (уже ведёт) -> возвращаем 'bot', без повторного CAS", async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ai_agent_mode, external_chat_id')) {
        return { ai_agent_mode: 'bot', external_chat_id: '111' };
      }
      return null;
    });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: 'bot', hasChannel: true });
    expect(findCasUpdate()).toBeUndefined();
  });

  it("mode='suggest' (легаси) -> не bot, CAS не делаем", async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ai_agent_mode, external_chat_id')) {
        return { ai_agent_mode: 'suggest', external_chat_id: '111' };
      }
      return null;
    });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res.mode).toBe('suggest');
    expect(findCasUpdate()).toBeUndefined();
  });
});

describe('resolveAgentModeForInbound — нет канала для ответа', () => {
  it('external_chat_id=null -> hasChannel=false, CAS off->bot НЕ делаем (бот не сможет ответить)', async () => {
    mockQueryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT ai_agent_mode, external_chat_id')) {
        return { ai_agent_mode: 'off', external_chat_id: null };
      }
      return null;
    });

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res.hasChannel).toBe(false);
    expect(findCasUpdate()).toBeUndefined();
  });

  it('диалог не найден -> mode=null, hasChannel=false', async () => {
    mockQueryOne.mockResolvedValue(null);

    const res = await resolveAgentModeForInbound(CONV_ID);

    expect(res).toEqual({ mode: null, hasChannel: false });
  });
});
