import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Тесты autoAssignOperator (slice S4): обычный «громкий» путь и тихий (silent).
 *
 * Силовая точка S4: при ведущем боте (mode='bot') оператор закрепляется как
 * наблюдатель, но БЕЗ системного сообщения «назначен» и БЕЗ chat:assigned
 * broadcast (иначе лента/UI покажут, будто чат уже у человека). CRM-событие
 * назначения шлётся в обоих режимах — оно нужно инбоксу для маршрутизации.
 *
 * Мокинг: db.query диспетчеризуется по SQL (SELECT operators -> массив,
 * INSERT system message -> []), db.queryOne -> UPDATE assign (claim).
 */

const {
  mockQuery,
  mockQueryOne,
  mockGetCrmRedis,
  mockZrange,
  mockBroadcastToRoom,
  mockEnqueueCrmEvent,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockQueryOne: vi.fn(),
  mockGetCrmRedis: vi.fn(),
  mockZrange: vi.fn<() => Promise<string[]>>().mockResolvedValue([]),
  mockBroadcastToRoom: vi.fn(),
  mockEnqueueCrmEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../database/db.js', () => ({
  default: { query: mockQuery, queryOne: mockQueryOne },
}));

vi.mock('./redis-cache.service.js', () => ({
  getCrmRedis: mockGetCrmRedis,
}));

vi.mock('../websocket/broadcast-to-room.js', () => ({
  broadcastToRoom: mockBroadcastToRoom,
}));

vi.mock('./crm-event-queue.service.js', () => ({
  enqueueCrmEvent: mockEnqueueCrmEvent,
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
}));

// Импорт ПОСЛЕ моков.
const { autoAssignOperator } = await import('./auto-assign.service.js');

const CONV_ID = 'conv-1';
const OP = { id: 'op-1', display_name: 'Аня', active_count: 0 };

/** Один онлайн-оператор, успешный claim диалога. */
function programHappyPath(): void {
  mockZrange.mockResolvedValue([OP.id]);
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('online_ops') || sql.includes('FROM online_ops')) return [OP];
    return []; // INSERT system message и прочее
  });
  mockQueryOne.mockResolvedValue({ id: CONV_ID }); // UPDATE assign claimed
}

/** Найти вызов db.query с INSERT системного сообщения «назначен». */
function findSystemMessageInsert() {
  return mockQuery.mock.calls.find(c =>
    typeof c[0] === 'string'
      && c[0].includes('INSERT INTO messages')
      && c[0].includes("'system'"),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCrmRedis.mockReturnValue({ zrange: mockZrange });
  mockZrange.mockResolvedValue([]);
  mockEnqueueCrmEvent.mockResolvedValue(undefined);
});

describe('autoAssignOperator — нет онлайн-операторов', () => {
  it('пустой ws:online -> null, ничего не назначаем', async () => {
    mockZrange.mockResolvedValue([]);

    const result = await autoAssignOperator(CONV_ID);

    expect(result).toBeNull();
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockBroadcastToRoom).not.toHaveBeenCalled();
  });
});

describe('autoAssignOperator — громкий путь (по умолчанию)', () => {
  it('назначает, пишет системное сообщение, шлёт broadcast и CRM-событие', async () => {
    programHappyPath();

    const result = await autoAssignOperator(CONV_ID);

    expect(result).toBe(OP.id);
    // Системное сообщение «назначен» записано.
    expect(findSystemMessageInsert()).toBeDefined();
    // Громкий broadcast.
    expect(mockBroadcastToRoom).toHaveBeenCalledWith(
      'chat:assigned',
      'admin:visitor-chats',
      expect.objectContaining({ sessionId: CONV_ID, operatorId: OP.id }),
    );
    // CRM-событие назначения.
    expect(mockEnqueueCrmEvent).toHaveBeenCalledWith(
      'chat', CONV_ID, 'assignment_changed', expect.any(Object),
    );
  });
});

describe('autoAssignOperator — тихий путь (silent: ведущий бот)', () => {
  it('назначает, но НЕ пишет системное сообщение и НЕ шлёт broadcast; CRM-событие шлёт', async () => {
    programHappyPath();

    const result = await autoAssignOperator(CONV_ID, { silent: true });

    // Назначение состоялось (наблюдатель закреплён).
    expect(result).toBe(OP.id);
    // Тишина в ленте: нет системного сообщения «назначен».
    expect(findSystemMessageInsert()).toBeUndefined();
    // Тишина в UI: нет chat:assigned broadcast.
    expect(mockBroadcastToRoom).not.toHaveBeenCalled();
    // Но CRM-событие назначения шлём всегда (инбоксу нужна маршрутизация).
    expect(mockEnqueueCrmEvent).toHaveBeenCalledWith(
      'chat', CONV_ID, 'assignment_changed', expect.any(Object),
    );
  });

  it('silent: false эквивалентен громкому пути', async () => {
    programHappyPath();

    await autoAssignOperator(CONV_ID, { silent: false });

    expect(findSystemMessageInsert()).toBeDefined();
    expect(mockBroadcastToRoom).toHaveBeenCalledOnce();
  });
});

describe('autoAssignOperator — гонка claim (уже назначен)', () => {
  it('UPDATE вернул 0 строк -> null, без сообщения/broadcast (даже в громком режиме)', async () => {
    mockZrange.mockResolvedValue([OP.id]);
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('online_ops')) return [OP];
      return [];
    });
    mockQueryOne.mockResolvedValue(null); // claim проигран

    const result = await autoAssignOperator(CONV_ID);

    expect(result).toBeNull();
    expect(findSystemMessageInsert()).toBeUndefined();
    expect(mockBroadcastToRoom).not.toHaveBeenCalled();
  });
});
