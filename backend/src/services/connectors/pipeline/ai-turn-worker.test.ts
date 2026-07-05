import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelType } from '../core/types.js';
import type { EnqueueOutboundParams } from './outbound-worker.js';

/**
 * Тесты оркестрации processAiTurn (слайс S3): гейты killswitch, leader-check,
 * режим диалога, классификатор, CAS-гейт, эскалация, happy-path с dedupKey.
 *
 * Стратегия мокинга (как outbound-worker.test.ts): hoisted-моки всех соседей,
 * db.queryOne диспетчеризуется по содержимому SQL (несколько разных запросов).
 */

interface IdRow {
  id: string;
}

interface ConversationTurnFixture {
  ai_agent_mode: string | null;
  ai_agent_locked_at: Date | null;
  contact_id: string | null;
  user_id: string | null;
  channel: string;
  external_chat_id: string | null;
  visitor_phone: string | null;
  contact_opt_out?: boolean | null;
}

interface TriggerMessageFixture {
  sender_type: string;
  message_type: string | null;
  content: string;
  original_file_name: string | null;
  original_mime_type: string | null;
}

interface EscalationOperatorFixture {
  assigned_operator_id: string | null;
  operator_name: string | null;
}

type QueryOneResult =
  | ConversationTurnFixture
  | TriggerMessageFixture
  | EscalationOperatorFixture
  | IdRow
  | null;

type QueryOneMock = (sql: string, params?: unknown[]) => Promise<QueryOneResult>;
type EnqueueOutboundMock = (params: EnqueueOutboundParams) => Promise<string>;

interface QueueOptionsWithDelay {
  delay: number;
}

function hasQueueDelay(value: unknown): value is QueueOptionsWithDelay {
  return typeof value === 'object'
    && value !== null
    && 'delay' in value
    && typeof value.delay === 'number';
}

const {
  mockQueryOne,
  mockQuery,
  mockPoolQuery,
  mockPoolConnect,
  mockLockClientQuery,
  mockLockClientRelease,
  mockLockClientOn,
  mockRedisGet,
  mockGetCrmRedis,
  mockRunAgentTurn,
  mockClassifyInbound,
  mockEnqueueOutbound,
  mockAutoAssignOperator,
  mockBroadcastToRoom,
  mockEnqueueCrmEvent,
  mockQueueAdd,
  mockQueueGetJob,
  mockWorkerClose,
} = vi.hoisted(() => ({
  mockQueryOne: vi.fn<QueryOneMock>(),
  mockQuery: vi.fn().mockResolvedValue([]),
  mockPoolQuery: vi.fn().mockResolvedValue({ rows: [] }),
  mockPoolConnect: vi.fn(),
  mockLockClientQuery: vi.fn(),
  mockLockClientRelease: vi.fn(),
  mockLockClientOn: vi.fn(),
  mockRedisGet: vi.fn<(key: string) => Promise<string | null>>().mockResolvedValue(null),
  mockGetCrmRedis: vi.fn(),
  mockRunAgentTurn: vi.fn(),
  mockClassifyInbound: vi.fn<() => Promise<'respond' | 'skip' | 'handoff'>>(),
  mockEnqueueOutbound: vi.fn<EnqueueOutboundMock>().mockResolvedValue('queue-1'),
  mockAutoAssignOperator: vi.fn().mockResolvedValue('operator-1'),
  mockBroadcastToRoom: vi.fn(),
  mockEnqueueCrmEvent: vi.fn().mockResolvedValue(undefined),
  mockQueueAdd: vi.fn().mockResolvedValue(undefined),
  mockQueueGetJob: vi.fn().mockResolvedValue(null),
  mockWorkerClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('bullmq', () => {
  function MockQueue() {
    return { add: mockQueueAdd, getJob: mockQueueGetJob };
  }
  function MockWorker() {
    return { on: vi.fn(), close: mockWorkerClose };
  }
  return { Queue: MockQueue, Worker: MockWorker };
});

vi.mock('../../../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne },
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

vi.mock('../../../config/index.js', () => ({
  config: {
    redis: { host: 'localhost', port: 6379, password: '', tls: undefined },
    // filesAck* нужны file-ack-ветке media-only сообщения. Дефолт флага false
    // (как в проде, тёмный запуск); кейсы file-ack включают его явно.
    ai: { agentEnabled: true, filesAckEnabled: false, filesAckCooldownHours: 12 },
    // По умолчанию production — lock-тесты ожидают захват. Кейс dev переопределяет.
    server: { nodeEnv: 'production' },
  },
}));

vi.mock('../../../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

vi.mock('../../../utils/error-tracker.js', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../redis-cache.service.js', () => ({
  getCrmRedis: mockGetCrmRedis,
}));

vi.mock('../../../websocket/broadcast-to-room.js', () => ({
  broadcastToRoom: mockBroadcastToRoom,
}));

vi.mock('../../crm-event-queue.service.js', () => ({
  enqueueCrmEvent: mockEnqueueCrmEvent,
}));

vi.mock('../../ai-agent/ai-agent-orchestrator.service.js', () => ({
  runAgentTurn: mockRunAgentTurn,
}));

vi.mock('../../ai-agent/ai-agent-classifier.js', () => ({
  classifyInbound: mockClassifyInbound,
}));

vi.mock('./outbound-worker.js', () => ({
  enqueueOutbound: mockEnqueueOutbound,
}));

vi.mock('../../auto-assign.service.js', () => ({
  autoAssignOperator: mockAutoAssignOperator,
}));

// Импорт ПОСЛЕ моков.
const {
  processAiTurn,
  enqueueAiTurn,
  removeAiTurnJob,
  startAiTurnLock,
  stopAiTurnLock,
  isAiTurnLeader,
  __setAiTurnLeaderForTests,
  turnJobId,
} = await import('./ai-turn-worker.js');

describe('turnJobId — BullMQ-совместимый id (regression: двоеточие роняло enqueueAiTurn)', () => {
  it('не содержит ":" и начинается с ai_', () => {
    const id = turnJobId('8816c6cc-3cfe-49eb-993f-5640e635d5fd');
    expect(id).not.toContain(':');
    expect(id.startsWith('ai_')).toBe(true);
    expect(id).toBe('ai_8816c6cc-3cfe-49eb-993f-5640e635d5fd');
  });
});

// ─── Хелперы ───────────────────────────────────────────────────────────────────

const CONV_ID = 'conv-1';
const TRIGGER_ID = 'msg-trigger';
const RUN_ID = 'run-42';
const TEST_CHANNEL: ChannelType = 'telegram';

function makeJob() {
  return {
    data: { conversationId: CONV_ID, triggerMessageId: TRIGGER_ID, channel: TEST_CHANNEL },
  };
}

/** Диалог в режиме bot, готовый к ответу. */
const BOT_CONV_ROW: ConversationTurnFixture = {
  ai_agent_mode: 'bot',
  ai_agent_locked_at: null,
  contact_id: 'contact-1',
  user_id: null,
  channel: 'telegram',
  external_chat_id: '111222',
  visitor_phone: '+79990000000',
};

/**
 * Программирует db.queryOne по SQL: SELECT conversation -> conv; SELECT content ->
 * trigger text; CAS UPDATE -> claim; escalate UPDATE -> moved; INSERT messages -> bot id;
 * notifyEscalation SELECT (LEFT JOIN users) -> escalateOperatorRow.
 */
function programQueryOne(opts: {
  conv?: ConversationTurnFixture | null;
  triggerText?: string | null;
  triggerMessageType?: string | null;
  casClaim?: IdRow | null;
  escalateMoved?: IdRow | null;
  botMsg?: IdRow | null;
  escalateOperatorRow?: EscalationOperatorFixture | null;
  filesAckClaim?: IdRow | null;
}): void {
  mockQueryOne.mockImplementation(async (sql: string) => {
    // file-ack CAS UPDATE conversations SET files_ack_at — проверять ДО общего
    // 'FROM conversations' (это UPDATE, не SELECT, но держим в начале для ясности).
    if (sql.includes('files_ack_at = NOW()')) {
      return opts.filesAckClaim === undefined ? { id: CONV_ID } : opts.filesAckClaim;
    }
    // notifyEscalation SELECT — проверять ДО общего 'FROM conversations'
    // (тоже содержит FROM conversations, но с JOIN users и alias).
    if (sql.includes('LEFT JOIN users')) {
      return opts.escalateOperatorRow === undefined
        ? { assigned_operator_id: null, operator_name: null }
        : opts.escalateOperatorRow;
    }
    if (sql.includes('FROM conversations')) {
      return opts.conv === undefined ? BOT_CONV_ROW : opts.conv;
    }
    if (sql.includes('FROM messages m') && sql.includes('WHERE m.id = $1')) {
      const content = opts.triggerText === undefined ? 'Здравствуйте, есть вопрос' : opts.triggerText;
      if (content === null) return null;
      const messageType = opts.triggerMessageType ?? (content.startsWith('[Файл:') ? 'file' : 'text');
      return {
        sender_type: 'visitor',
        message_type: messageType,
        content,
        original_file_name: messageType === 'file' ? content.replace(/^\[Файл:\s*|\]$/g, '') : null,
        original_mime_type: messageType === 'file' ? 'application/pdf' : null,
      };
    }
    if (sql.includes('ai_agent_turn_count = ai_agent_turn_count + 1')) {
      return opts.casClaim === undefined ? { id: CONV_ID } : opts.casClaim;
    }
    if (sql.includes("ai_agent_mode = 'operator'")) {
      return opts.escalateMoved === undefined ? { id: CONV_ID } : opts.escalateMoved;
    }
    if (sql.includes('INSERT INTO messages')) {
      return opts.botMsg === undefined ? { id: 'bot-msg-1' } : opts.botMsg;
    }
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // processAiTurn гейтится singleton-локом; для happy-path форсим лидерство.
  __setAiTurnLeaderForTests(true);
  mockGetCrmRedis.mockReturnValue({ get: mockRedisGet });
  mockRedisGet.mockResolvedValue(null);
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mockClassifyInbound.mockResolvedValue('respond');
  mockRunAgentTurn.mockResolvedValue({ text: 'Конечно, помогу. Что именно нужно?', runId: RUN_ID, stepCount: 1, costUsd: 0.01 });
  mockEnqueueOutbound.mockResolvedValue('queue-1');
  mockAutoAssignOperator.mockResolvedValue('operator-1');
  // Дефолт для lock-механизма: connect отдаёт клиента, lock берётся.
  mockLockClientQuery.mockResolvedValue({ rows: [{ acquired: true }] });
  mockPoolConnect.mockResolvedValue({
    query: mockLockClientQuery,
    release: mockLockClientRelease,
    on: mockLockClientOn,
  });
});

afterEach(async () => {
  // Снять лок/таймеры между тестами (startAiTurnLock мог завести retry-interval).
  __setAiTurnLeaderForTests(false);
  await stopAiTurnLock();
});

// ─── (0) Killswitch ──────────────────────────────────────────────────────────

describe('processAiTurn — killswitch (fail-closed)', () => {
  it('ai:enabled=false -> no-op (ни ход, ни отправка)', async () => {
    mockRedisGet.mockResolvedValue('false');
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
    // До перечитывания диалога не дошли (killswitch — первый гейт).
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('Redis-клиент недоступен (null) -> fail-closed, ход подавлен', async () => {
    mockGetCrmRedis.mockReturnValue(null);
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('Redis.get бросает -> fail-closed, ход подавлен', async () => {
    mockRedisGet.mockRejectedValue(new Error('redis down'));
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});

// ─── (1) Singleton-lock (P0 dev-защита) ───────────────────────────────────────

describe('processAiTurn — singleton-lock', () => {
  it('не держим лок -> no-op, не трогает БД и модель', async () => {
    __setAiTurnLeaderForTests(false);
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
    expect(mockClassifyInbound).not.toHaveBeenCalled();
  });
});

describe('ai-turn lock — захват/освобождение', () => {
  it('pg_try_advisory_lock=true -> становимся держателем', async () => {
    __setAiTurnLeaderForTests(false);
    mockLockClientQuery.mockResolvedValue({ rows: [{ acquired: true }] });

    await startAiTurnLock();

    expect(isAiTurnLeader()).toBe(true);
    // Лок-id 737002 (НЕ scheduler-leader 737001).
    expect(mockLockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('pg_try_advisory_lock'),
      [737002],
    );
    // Соединение НЕ возвращается в пул (держим сессию-лок).
    expect(mockLockClientRelease).not.toHaveBeenCalled();
  });

  it('лок занят другим процессом (acquired=false) -> follower, соединение в пул', async () => {
    __setAiTurnLeaderForTests(false);
    mockLockClientQuery.mockResolvedValue({ rows: [{ acquired: false }] });

    await startAiTurnLock();

    expect(isAiTurnLeader()).toBe(false);
    expect(mockLockClientRelease).toHaveBeenCalledOnce();
  });

  it('ошибка connect -> остаёмся follower, не падаем', async () => {
    __setAiTurnLeaderForTests(false);
    mockPoolConnect.mockRejectedValue(new Error('pool exhausted'));

    await startAiTurnLock();

    expect(isAiTurnLeader()).toBe(false);
  });

  it('NODE_ENV!=production (dev) -> лок НЕ запрашиваем (вторая защита), connect не зовётся', async () => {
    __setAiTurnLeaderForTests(false);
    const { config } = await import('../../../config/index.js');
    const serverConfig = config.server;
    const prev = serverConfig.nodeEnv;
    serverConfig.nodeEnv = 'development';
    try {
      await startAiTurnLock();

      expect(isAiTurnLeader()).toBe(false);
      expect(mockPoolConnect).not.toHaveBeenCalled();
    } finally {
      serverConfig.nodeEnv = prev;
    }
  });

  it('stopAiTurnLock -> unlock + release + сброс лидерства', async () => {
    __setAiTurnLeaderForTests(false);
    mockLockClientQuery.mockResolvedValue({ rows: [{ acquired: true }] });
    await startAiTurnLock();
    expect(isAiTurnLeader()).toBe(true);

    await stopAiTurnLock();

    expect(isAiTurnLeader()).toBe(false);
    expect(mockLockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_unlock'),
      [737002],
    );
    expect(mockLockClientRelease).toHaveBeenCalled();
  });
});

// ─── (2) Режим диалога ─────────────────────────────────────────────────────────

describe('processAiTurn — режим диалога', () => {
  it("mode='operator' -> skip (не отвечаем)", async () => {
    programQueryOne({ conv: { ...BOT_CONV_ROW, ai_agent_mode: 'operator' } });

    await processAiTurn(makeJob());

    expect(mockClassifyInbound).not.toHaveBeenCalled();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it("mode='off' -> skip", async () => {
    programQueryOne({ conv: { ...BOT_CONV_ROW, ai_agent_mode: 'off' } });

    await processAiTurn(makeJob());

    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it('диалог не найден -> skip', async () => {
    programQueryOne({ conv: null });

    await processAiTurn(makeJob());

    expect(mockClassifyInbound).not.toHaveBeenCalled();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
  });

  it('контакт в исключениях ИИ (opt-out) -> ход подавлен ДО классификатора', async () => {
    programQueryOne({ conv: { ...BOT_CONV_ROW, contact_opt_out: true } });

    await processAiTurn(makeJob());

    expect(mockClassifyInbound).not.toHaveBeenCalled();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });
});

// ─── (3) Классификатор ─────────────────────────────────────────────────────────

describe('processAiTurn — классификатор', () => {
  it('skip -> ход не запускается, ничего не отправляется', async () => {
    mockClassifyInbound.mockResolvedValue('skip');
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockClassifyInbound).toHaveBeenCalledOnce();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it('handoff -> эскалация: mode=operator + autoAssign, без хода/отправки', async () => {
    mockClassifyInbound.mockResolvedValue('handoff');
    programQueryOne({});

    await processAiTurn(makeJob());

    // Перевод в operator выполнен.
    const escalateCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes("ai_agent_mode = 'operator'"),
    );
    expect(escalateCall).toBeDefined();
    expect(mockAutoAssignOperator).toHaveBeenCalledWith(CONV_ID);
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it('handoff, но диалог уже не bot (CAS перевода 0 строк) -> autoAssign НЕ зовётся', async () => {
    mockClassifyInbound.mockResolvedValue('handoff');
    programQueryOne({ escalateMoved: null });

    await processAiTurn(makeJob());

    expect(mockAutoAssignOperator).not.toHaveBeenCalled();
  });

  it('сообщение-триггер не найдено -> skip без классификации', async () => {
    programQueryOne({ triggerText: null });

    await processAiTurn(makeJob());

    expect(mockClassifyInbound).not.toHaveBeenCalled();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
  });

  it('пустой документ без подписи -> skip без классификации и ответа', async () => {
    programQueryOne({ triggerText: '[Файл: Листовка по продуктам 2ГИС.pdf]' });

    await processAiTurn(makeJob());

    expect(mockClassifyInbound).not.toHaveBeenCalled();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });
});

// ─── (S4) File-ack: подтверждение на голые вложения ────────────────────────────

describe('processAiTurn — file-ack (media-only)', () => {
  /** Включить флаг file-ack на время теста (дефолт мока — false). */
  async function withFilesAckEnabled(enabled: boolean): Promise<() => void> {
    const { config } = await import('../../../config/index.js');
    const prev = config.ai.filesAckEnabled;
    config.ai.filesAckEnabled = enabled;
    return () => { config.ai.filesAckEnabled = prev; };
  }

  it('флаг ON + CAS вернул строку -> один enqueueOutbound с FILES_ACK_TEXT и sourceMessageId; классификатор/мозг НЕ зовутся', async () => {
    const restore = await withFilesAckEnabled(true);
    try {
      programQueryOne({ triggerText: '[Файл: Реферат.docx]' });

      await processAiTurn(makeJob());

      // CAS file-ack выполнен (UPDATE files_ack_at).
      const casCall = mockQueryOne.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('files_ack_at = NOW()'),
      );
      expect(casCall).toBeDefined();

      // INSERT bot-сообщения с текстом подтверждения.
      const insertCall = mockQueryOne.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall?.[1]?.[1]).toBe(
        'Спасибо, файлы получили, уже готовим их к печати. Если удобно, подойдите на ' +
        'кассу на Соборном 21, и мы всё распечатаем. Подскажите, ' +
        'если есть пожелания по формату или количеству.',
      );

      // Один enqueueOutbound с правильным контентом, sourceMessageId и dedupKey c bucket.
      expect(mockEnqueueOutbound).toHaveBeenCalledOnce();
      const enqueueArg = mockEnqueueOutbound.mock.calls[0]?.[0];
      if (!enqueueArg) throw new Error('Expected enqueueOutbound call');
      expect(enqueueArg).toMatchObject({
        channel: 'telegram',
        externalChatId: '111222',
        conversationId: CONV_ID,
        sourceMessageId: 'bot-msg-1',
      });
      // dedupKey содержит time-bucket (P1): формат files-ack:<conv>:<число>, иначе глобальный
      // UNIQUE outbound_queue подавил бы легитимный повторный ack после cooldown навсегда.
      expect(enqueueArg.dedupKey).toMatch(new RegExp(`^files-ack:${CONV_ID}:\\d+$`));
      expect(enqueueArg.content).toContain('файлы получили');
      // sourceMessageId обязателен (P1-4): без него второй гейт не подавит при перехвате.
      expect(enqueueArg.sourceMessageId).toBeTruthy();

      // Дорогой путь не запускался.
      expect(mockClassifyInbound).not.toHaveBeenCalled();
      expect(mockRunAgentTurn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('текст подтверждения без `**`-разметки и без тире', async () => {
    const restore = await withFilesAckEnabled(true);
    try {
      programQueryOne({ triggerText: '[Файл: Реферат.docx]' });

      await processAiTurn(makeJob());

      const enqueueArg = mockEnqueueOutbound.mock.calls[0]?.[0];
      if (!enqueueArg) throw new Error('Expected enqueueOutbound call');
      const content = enqueueArg.content;
      expect(content).not.toContain('**');
      expect(content).not.toContain('—');
      expect(content).not.toContain('–');
    } finally {
      restore();
    }
  });

  it('флаг ON + CAS вернул 0 строк (cooldown активен / режим сменился) -> 0 enqueueOutbound, INSERT не делаем', async () => {
    const restore = await withFilesAckEnabled(true);
    try {
      programQueryOne({ triggerText: '[Файл: Реферат.docx]', filesAckClaim: null });

      await processAiTurn(makeJob());

      const insertCall = mockQueryOne.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'),
      );
      expect(insertCall).toBeUndefined();
      expect(mockEnqueueOutbound).not.toHaveBeenCalled();
      expect(mockClassifyInbound).not.toHaveBeenCalled();
      expect(mockRunAgentTurn).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('флаг OFF -> тихий return (как раньше): ни CAS, ни INSERT, ни enqueueOutbound', async () => {
    // Флаг по умолчанию false в моке — явный кейс «как было до фичи».
    programQueryOne({ triggerText: '[Файл: Реферат.docx]' });

    await processAiTurn(makeJob());

    const casCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('files_ack_at = NOW()'),
    );
    expect(casCall).toBeUndefined();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
    expect(mockClassifyInbound).not.toHaveBeenCalled();
    expect(mockRunAgentTurn).not.toHaveBeenCalled();
  });

  it('флаг ON, но нет external_chat_id -> CAS не делаем, не отправляем', async () => {
    const restore = await withFilesAckEnabled(true);
    try {
      programQueryOne({
        triggerText: '[Файл: Реферат.docx]',
        conv: { ...BOT_CONV_ROW, external_chat_id: null },
      });

      await processAiTurn(makeJob());

      const casCall = mockQueryOne.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('files_ack_at = NOW()'),
      );
      expect(casCall).toBeUndefined();
      expect(mockEnqueueOutbound).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('флаг ON + CAS прошёл, но INSERT bot-сообщения вернул null -> guard: не отправляем (P1-B)', async () => {
    const restore = await withFilesAckEnabled(true);
    try {
      // CAS зарезервировал окно (filesAckClaim по умолчанию ok), но INSERT упал -> null.
      programQueryOne({ triggerText: '[Файл: Реферат.docx]', botMsg: null });

      await processAiTurn(makeJob());

      // CAS выполнен, INSERT попытан, но без botMsg.id отправку не делаем (sourceMessageId
      // обязателен P1-4; без него лучше промолчать, чем слать без второго гейта).
      const casCall = mockQueryOne.mock.calls.find(c =>
        typeof c[0] === 'string' && c[0].includes('files_ack_at = NOW()'),
      );
      expect(casCall).toBeDefined();
      expect(mockEnqueueOutbound).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('флаг ON + enqueueOutbound reject -> ход падает (BullMQ-ретрай), как обычный ход бота', async () => {
    const restore = await withFilesAckEnabled(true);
    try {
      programQueryOne({ triggerText: '[Файл: Реферат.docx]' });
      mockEnqueueOutbound.mockRejectedValueOnce(new Error('outbound down'));

      // enqueueOutbound не обёрнут в try/catch (как и happy-path хода ~678): reject
      // пробрасывается -> джоб падает -> BullMQ ретраит. Поведение определено, не глотаем.
      await expect(processAiTurn(makeJob())).rejects.toThrow('outbound down');

      expect(mockEnqueueOutbound).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });
});

// ─── Эскалация — громкое уведомление (P1) ──────────────────────────────────────

describe('escalateToOperator — громкое уведомление', () => {
  it('autoAssign назначил свежего (вернул id) -> notifyEscalation НЕ дублирует', async () => {
    mockClassifyInbound.mockResolvedValue('handoff');
    mockAutoAssignOperator.mockResolvedValue('operator-1'); // свежее назначение
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockAutoAssignOperator).toHaveBeenCalledWith(CONV_ID);
    // autoAssign сам уже громко уведомил -> своё системное сообщение/broadcast не шлём.
    expect(mockBroadcastToRoom).not.toHaveBeenCalled();
    const insertCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'),
    );
    expect(insertCall).toBeUndefined();
  });

  it('оператор уже тихо назначен (autoAssign вернул null) -> громкое уведомление досылаем', async () => {
    mockClassifyInbound.mockResolvedValue('handoff');
    mockAutoAssignOperator.mockResolvedValue(null); // claim-by-NULL не сработал
    programQueryOne({ escalateOperatorRow: { assigned_operator_id: 'op-7', operator_name: 'Оля' } });

    await processAiTurn(makeJob());

    // Системное сообщение в ленту через db.query (mockQuery).
    const sysMsg = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string'
      && c[0].includes('INSERT INTO messages')
      && String(c[1]?.[1] ?? '').includes('передал диалог'),
    );
    expect(sysMsg).toBeDefined();
    // Громкий chat:assigned на админ-очередь с фактическим оператором.
    expect(mockBroadcastToRoom).toHaveBeenCalledWith(
      'chat:assigned',
      'admin:visitor-chats',
      expect.objectContaining({ sessionId: CONV_ID, operatorId: 'op-7', operatorName: 'Оля' }),
    );
    expect(mockEnqueueCrmEvent).toHaveBeenCalled();
  });

  it('никого онлайн (autoAssign null, оператор не назначен) -> системное сообщение есть, broadcast без оператора не шлём', async () => {
    mockClassifyInbound.mockResolvedValue('handoff');
    mockAutoAssignOperator.mockResolvedValue(null);
    programQueryOne({ escalateOperatorRow: { assigned_operator_id: null, operator_name: null } });

    await processAiTurn(makeJob());

    const sysMsg = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'),
    );
    expect(sysMsg).toBeDefined();
    // Нет оператора -> chat:assigned не шлём (некому), но CRM-инбокс обновляем.
    expect(mockBroadcastToRoom).not.toHaveBeenCalled();
    expect(mockEnqueueCrmEvent).toHaveBeenCalled();
  });
});

// ─── (4)-(6) Happy path ──────────────────────────────────────────────────────

describe('processAiTurn — happy path (respond)', () => {
  it('respond -> runAgentTurn -> INSERT bot + enqueueOutbound с dedupKey=ai:runId', async () => {
    programQueryOne({});

    await processAiTurn(makeJob());

    // Ход запущен в режиме bot с triggerMessageId.
    expect(mockRunAgentTurn).toHaveBeenCalledOnce();
    expect(mockRunAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: CONV_ID,
      mode: 'bot',
      triggerMessageId: TRIGGER_ID,
      channel: 'telegram',
    }));

    // CAS-гейт поднял счётчик.
    const casCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('ai_agent_turn_count = ai_agent_turn_count + 1'),
    );
    expect(casCall).toBeDefined();

    // INSERT сообщения бота.
    const insertCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'),
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[0]).toContain("'bot', 'system'");
    expect(insertCall?.[0]).toContain('metadata');
    expect(insertCall?.[1]).toEqual([
      CONV_ID,
      'Конечно, помогу. Что именно нужно?',
      JSON.stringify({ kind: 'ai_agent_reply', aiAgentRunId: RUN_ID }),
    ]);

    const finalMessageUpdateCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('final_message_id'),
    );
    expect(finalMessageUpdateCall).toBeDefined();
    expect(finalMessageUpdateCall?.[1]).toEqual(['bot-msg-1', RUN_ID]);

    // Отправка с dedupKey по runId.
    expect(mockEnqueueOutbound).toHaveBeenCalledOnce();
    expect(mockEnqueueOutbound).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'telegram',
      externalChatId: '111222',
      content: 'Конечно, помогу. Что именно нужно?',
      conversationId: CONV_ID,
      sourceMessageId: 'bot-msg-1',
      dedupKey: `ai:${RUN_ID}`,
    }));
  });

  it('runAgentTurn вернул escalate -> эскалация, ответ не отправляется', async () => {
    mockRunAgentTurn.mockResolvedValue({ text: '', runId: RUN_ID, stepCount: 6, costUsd: 0.2, escalate: true, escalationReason: 'max_steps' });
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockAutoAssignOperator).toHaveBeenCalledWith(CONV_ID);
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it('пустой текст без escalate -> эскалация (клиент не остаётся без ответа)', async () => {
    mockRunAgentTurn.mockResolvedValue({ text: '   ', runId: RUN_ID, stepCount: 1, costUsd: 0.01 });
    programQueryOne({});

    await processAiTurn(makeJob());

    expect(mockAutoAssignOperator).toHaveBeenCalledWith(CONV_ID);
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it('runAgentTurn БРОСИЛ (провайдер упал) -> эскалация в один проход, без отправки', async () => {
    mockRunAgentTurn.mockRejectedValue(new Error('openrouter 502'));
    programQueryOne({});

    await processAiTurn(makeJob());

    // Перевод в operator + autoAssign выполнен (не оставляем клиента без ответа).
    const escalateCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes("ai_agent_mode = 'operator'"),
    );
    expect(escalateCall).toBeDefined();
    expect(mockAutoAssignOperator).toHaveBeenCalledWith(CONV_ID);
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });
});

// ─── (5) CAS-гейт: перехват во время хода ──────────────────────────────────────

describe('processAiTurn — CAS-гейт (перехват пока бот думал)', () => {
  it('CAS 0 строк -> ответ подавлен (ни INSERT, ни enqueueOutbound)', async () => {
    programQueryOne({ casClaim: null });

    await processAiTurn(makeJob());

    // Ход модели прошёл (текст уже сгенерён), но отправку подавили.
    expect(mockRunAgentTurn).toHaveBeenCalledOnce();
    const insertCall = mockQueryOne.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO messages'),
    );
    expect(insertCall).toBeUndefined();
    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });

  it('CAS прошёл, но нет external_chat_id -> не отправляем', async () => {
    programQueryOne({ conv: { ...BOT_CONV_ROW, external_chat_id: null } });

    await processAiTurn(makeJob());

    expect(mockEnqueueOutbound).not.toHaveBeenCalled();
  });
});

// ─── enqueueAiTurn — коалесинг ─────────────────────────────────────────────────

describe('enqueueAiTurn — коалесинг (remove+add)', () => {
  it('нет прежнего хода -> просто add с jobId/delay/attempts', async () => {
    mockQueueGetJob.mockResolvedValue(null);

    await enqueueAiTurn({ conversationId: CONV_ID, triggerMessageId: TRIGGER_ID, channel: 'telegram' });

    expect(mockQueueAdd).toHaveBeenCalledOnce();
    const [, data, opts] = mockQueueAdd.mock.calls[0]!;
    expect(data).toMatchObject({ conversationId: CONV_ID, triggerMessageId: TRIGGER_ID, channel: 'telegram' });
    expect(opts).toMatchObject({ jobId: `ai_${CONV_ID}`, attempts: 2 });
    expect(hasQueueDelay(opts)).toBe(true);
    if (hasQueueDelay(opts)) {
      expect(opts.delay).toBeGreaterThan(0);
    }
  });

  it('есть прежний отложенный ход -> remove, затем add (переставлен на новую реплику)', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockQueueGetJob.mockResolvedValue({ remove });

    await enqueueAiTurn({ conversationId: CONV_ID, triggerMessageId: 'msg-newer', channel: 'telegram' });

    expect(remove).toHaveBeenCalledOnce();
    expect(mockQueueAdd).toHaveBeenCalledOnce();
    const [, data] = mockQueueAdd.mock.calls[0]!;
    expect(data).toMatchObject({ triggerMessageId: 'msg-newer' });
  });

  it('прежний ход уже в работе (remove бросает) -> не переставляем (add не зовётся)', async () => {
    const remove = vi.fn().mockRejectedValue(new Error('locked'));
    mockQueueGetJob.mockResolvedValue({ remove });

    await enqueueAiTurn({ conversationId: CONV_ID, triggerMessageId: TRIGGER_ID, channel: 'telegram' });

    expect(remove).toHaveBeenCalledOnce();
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

// ─── removeAiTurnJob ─────────────────────────────────────────────────────────

describe('removeAiTurnJob', () => {
  it('нет хода -> no-op', async () => {
    mockQueueGetJob.mockResolvedValue(null);
    await removeAiTurnJob(CONV_ID);
    // не падает; remove не зовётся (нечего снимать)
    expect(mockQueueGetJob).toHaveBeenCalledWith(`ai_${CONV_ID}`);
  });

  it('есть ход -> снимает', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    mockQueueGetJob.mockResolvedValue({ remove });
    await removeAiTurnJob(CONV_ID);
    expect(remove).toHaveBeenCalledOnce();
  });
});
