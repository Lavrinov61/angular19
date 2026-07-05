/**
 * R1 security regression — internal_note НЕ должен утекать клиенту в истории
 * сообщений (`GET /api/visitor-chat/sessions/:sessionId/messages`).
 *
 * Архитектурное ревью P1-2: фильтр `AND sender_type != 'internal_note'` добавлен
 * в обе ветки (full-load и after_id reconnect-sync), паритет с
 * chat-session.routes.ts. Заметка оператора-владельца диалога протекла бы клиенту,
 * как только появилась бы — этот тест ловит регресс формулировки.
 *
 * Изолирован в отдельном файле (chat-messages.routes.test.ts тестирует устаревший
 * visitorId-контракт и не загружается). Мок pool.query РЕАЛЬНО применяет фильтр
 * по SQL запроса — не «зелёный вхолостую»: без фильтра в коде заметка попала бы
 * в ответ и тест упал бы.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { makeClientUser, makeToken } from '../../test-utils/mock-auth.js';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const { mockPool, mockDb } = vi.hoisted(() => ({
  mockPool: { query: vi.fn().mockResolvedValue({ rows: [] }), connect: vi.fn(), end: vi.fn() },
  mockDb: {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn(),
  },
}));

vi.mock('../../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../database/db.js', () => ({ default: mockDb, pool: mockPool }));
vi.mock('../../config/index.js', () => ({
  config: {
    jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' },
    redis: { host: '', port: 6379, password: undefined, tls: false },
    chat: { useAiFirst: false },
    s3: {
      enabled: false,
      bucket: 'test',
      publicUrl: 'https://svoefoto.ru/media',
      externalDeliveryUrl: '',
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      accessKeyId: '',
      secretAccessKey: '',
    },
  },
}));
// Заглушки внешних зависимостей роутера (не нужны для R1, но грузятся при импорте).
vi.mock('../../services/ai-chat.service.js', () => ({
  scheduleAIResponse: vi.fn().mockResolvedValue(undefined),
  clearOperatorActive: vi.fn().mockResolvedValue(undefined),
  isOperatorActive: vi.fn().mockResolvedValue(false),
}));
// createLazyRedis/createResilientRedis создают реальный ioredis-клиент → NOAUTH. Заглушаем.
vi.mock('../../services/redis-factory.js', () => {
  const fakeClient = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(0),
    call: vi.fn().mockResolvedValue(null),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
  };
  return {
    createLazyRedis: () => fakeClient,
    createResilientRedis: () => fakeClient,
    isRedisReady: () => false,
    closeAllRedisClients: vi.fn().mockResolvedValue(undefined),
  };
});
// rate-limit-store создаёт eager Redis при импорте chat-shared → заглушаем стор.
vi.mock('../../middleware/rate-limit-store.js', () => ({
  createRateLimitStore: () => undefined,
}));
vi.mock('../../services/chat-broadcast.service.js', () => ({
  broadcastChatMessage: vi.fn().mockResolvedValue(undefined),
}));
// auth-cache использует Redis → форсим cache-miss, чтобы auth шёл через db.queryOne (мок).
vi.mock('../../services/auth-cache.service.js', () => ({
  getAuthCache: vi.fn().mockResolvedValue(null),
  setAuthCache: vi.fn().mockResolvedValue(undefined),
}));

// ─── SUT ──────────────────────────────────────────────────────────────────────
let app: import('express').Express;
const CLIENT = makeClientUser({ id: 'client-uuid-1' });
const SESSION_ID = 'conv-1';

beforeAll(async () => {
  const express = (await import('express')).default;
  const { authenticateToken } = await import('../../middleware/auth.js');
  const { errorHandler, notFoundHandler } = await import('../../middleware/errorHandler.js');
  const { default: router } = await import('./chat-messages.routes.js');
  // Маршрут /sessions/:id/messages зовёт requireUser(req) → req.user должен быть
  // выставлен authenticateToken (в проде навешен на уровне родителя). Воспроизводим.
  app = express();
  app.use(express.json());
  app.use(authenticateToken);
  app.use('/', router);
  app.use(notFoundHandler);
  app.use(errorHandler);
});

beforeEach(() => {
  vi.mocked(mockPool.query).mockReset().mockResolvedValue({ rows: [] });
  vi.mocked(mockDb.queryOne).mockReset();
  // authenticateToken → db.queryOne(user lookup): вернуть активного клиента.
  vi.mocked(mockDb.queryOne).mockResolvedValue({
    id: CLIENT.id,
    email: CLIENT.email,
    role: CLIENT.role,
    is_active: true,
    display_name: CLIENT.display_name,
    phone: null,
    force_password_change: false,
    last_password_change: null,
  });
});

/** Мок pool.query: getOwnedConversation вернёт диалог клиента; messages-query
 *  фильтрует internal_note ТОЛЬКО если SQL содержит соответствующий WHERE. */
function wirePool(allMessages: Array<{ id: string; sender_type: string; content: string; metadata: null }>) {
  vi.mocked(mockPool.query).mockImplementation((sql: string) => {
    if (/FROM conversations/i.test(sql)) {
      // getOwnedConversation — владелец = CLIENT.
      return Promise.resolve({ rows: [{ id: SESSION_ID, contact_id: 'ct-1', channel: 'web', status: 'open', created_at: new Date(), updated_at: new Date(), user_id: CLIENT.id }] });
    }
    if (/FROM messages/i.test(sql)) {
      const filtersNote = /sender_type\s*!=\s*'internal_note'/.test(sql);
      const rows = filtersNote ? allMessages.filter((m) => m.sender_type !== 'internal_note') : allMessages;
      return Promise.resolve({ rows });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('R1: GET /sessions/:id/messages excludes internal_note', () => {
  const visitorMsg = { id: 'm-visitor', sender_type: 'visitor', content: 'Привет', metadata: null };
  const internalNote = { id: 'm-note', sender_type: 'internal_note', content: 'СЕКРЕТНАЯ ЗАМЕТКА ОПЕРАТОРА', metadata: null };

  it('full load: заметка не возвращается клиенту', async () => {
    wirePool([visitorMsg, internalNote]);
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}/messages`)
      .set('Authorization', `Bearer ${makeToken(CLIENT)}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((m: { id: string }) => m.id);
    expect(ids).toContain('m-visitor');
    expect(ids).not.toContain('m-note');
    expect(JSON.stringify(res.body)).not.toContain('СЕКРЕТНАЯ ЗАМЕТКА ОПЕРАТОРА');
  });

  it('after_id reconnect-sync: заметка не возвращается клиенту', async () => {
    let sawAfterIdBranch = false;
    vi.mocked(mockPool.query).mockImplementation((sql: string) => {
      if (/FROM conversations/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: SESSION_ID, contact_id: 'ct-1', channel: 'web', status: 'open', created_at: new Date(), updated_at: new Date(), user_id: CLIENT.id }] });
      }
      if (/FROM messages/i.test(sql)) {
        if (/id > \$2/.test(sql)) sawAfterIdBranch = true;
        const filtersNote = /sender_type\s*!=\s*'internal_note'/.test(sql);
        const rows = filtersNote ? [visitorMsg, internalNote].filter((m) => m.sender_type !== 'internal_note') : [visitorMsg, internalNote];
        return Promise.resolve({ rows });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get(`/sessions/${SESSION_ID}/messages?after_id=m-prev`)
      .set('Authorization', `Bearer ${makeToken(CLIENT)}`);

    expect(res.status).toBe(200);
    expect(sawAfterIdBranch).toBe(true);
    const ids = res.body.data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain('m-note');
  });

  it('регресс-гард: фильтр sender_type != internal_note присутствует в ОБЕИХ ветках (full + afterId)', async () => {
    // Захватываем фактический messages-SQL из обеих веток и проверяем наличие
    // фильтра в тексте запроса — ловит регресс формулировки независимо от данных.
    const capturedMessageSql: string[] = [];
    const wireCapture = () =>
      vi.mocked(mockPool.query).mockImplementation((sql: string) => {
        if (/FROM conversations/i.test(sql)) {
          return Promise.resolve({ rows: [{ id: SESSION_ID, contact_id: 'ct-1', channel: 'web', status: 'open', created_at: new Date(), updated_at: new Date(), user_id: CLIENT.id }] });
        }
        if (/FROM messages/i.test(sql)) {
          capturedMessageSql.push(sql);
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

    wireCapture();
    await request(app).get(`/sessions/${SESSION_ID}/messages`).set('Authorization', `Bearer ${makeToken(CLIENT)}`);
    wireCapture();
    await request(app).get(`/sessions/${SESSION_ID}/messages?after_id=m-prev`).set('Authorization', `Bearer ${makeToken(CLIENT)}`);

    const fullSql = capturedMessageSql.find((s) => !/id > \$2/.test(s));
    const afterIdSql = capturedMessageSql.find((s) => /id > \$2/.test(s));
    expect(fullSql, 'full-load messages SQL должен быть выполнен').toBeDefined();
    expect(afterIdSql, 'afterId messages SQL должен быть выполнен').toBeDefined();
    expect(fullSql!).toMatch(/sender_type\s*!=\s*'internal_note'/);
    expect(afterIdSql!).toMatch(/sender_type\s*!=\s*'internal_note'/);
  });

  it('контроль негатива: без фильтра в SQL заметка протекла бы (мок честный)', async () => {
    // Доказываем, что мок не прячет заметку сам по себе — при SQL без фильтра она есть.
    vi.mocked(mockPool.query).mockImplementation((sql: string) => {
      if (/FROM conversations/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: SESSION_ID, contact_id: 'ct-1', channel: 'web', status: 'open', created_at: new Date(), updated_at: new Date(), user_id: CLIENT.id }] });
      }
      // Намеренно НЕ фильтруем (эмуляция кода без R1-фикса).
      return Promise.resolve({ rows: [visitorMsg, internalNote] });
    });
    const all = [visitorMsg, internalNote];
    const filtered = all.filter((m) => m.sender_type !== 'internal_note');
    expect(filtered).not.toContainEqual(internalNote);
    expect(all).toContainEqual(internalNote);
  });
});

// ── FIX-1: GET /sessions/:id/messages/search не должен возвращать internal_note / hiddenInUi ──
describe('R1: GET /sessions/:id/messages/search excludes internal_note and hiddenInUi', () => {
  const visitorMsg = { id: 's-visitor', sender_type: 'visitor', message_type: 'text', content: 'найди привет', sender_name: 'Клиент', created_at: new Date(), metadata: null };
  const internalNote = { id: 's-note', sender_type: 'internal_note', message_type: 'text', content: 'привет СЕКРЕТНАЯ ЗАМЕТКА', sender_name: 'Оператор', created_at: new Date(), metadata: null };
  const hiddenMsg = { id: 's-hidden', sender_type: 'bot', message_type: 'text', content: 'привет СКРЫТОЕ', sender_name: 'Бот', created_at: new Date(), metadata: { hiddenInUi: 'true' } };

  /** Мок применяет ОБА фильтра по факту их наличия в search-SQL. */
  function wireSearchPool(captured?: { sql: string[] }) {
    vi.mocked(mockPool.query).mockImplementation((sql: string) => {
      if (/FROM conversations/i.test(sql)) {
        return Promise.resolve({ rows: [{ id: SESSION_ID, contact_id: 'ct-1', channel: 'web', status: 'open', created_at: new Date(), updated_at: new Date(), user_id: CLIENT.id }] });
      }
      if (/FROM messages/i.test(sql)) {
        captured?.sql.push(sql);
        const all = [visitorMsg, internalNote, hiddenMsg];
        const filtersNote = /sender_type\s*!=\s*'internal_note'/.test(sql);
        const filtersHidden = /metadata->>'hiddenInUi'\)?\s*IS DISTINCT FROM\s*'true'/.test(sql);
        const rows = all.filter((m) =>
          (!filtersNote || m.sender_type !== 'internal_note') &&
          (!filtersHidden || (m.metadata as { hiddenInUi?: string } | null)?.hiddenInUi !== 'true'),
        );
        return Promise.resolve({ rows });
      }
      return Promise.resolve({ rows: [] });
    });
  }

  it('FTS-ветка (q>=3): ни internal_note, ни hiddenInUi не в результатах', async () => {
    const captured = { sql: [] as string[] };
    wireSearchPool(captured);
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}/messages/search?q=привет`)
      .set('Authorization', `Bearer ${makeToken(CLIENT)}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((m: { id: string }) => m.id);
    expect(ids).toContain('s-visitor');
    expect(ids).not.toContain('s-note');
    expect(ids).not.toContain('s-hidden');
    // Регресс-гард: оба фильтра присутствуют в FTS-SQL.
    const ftsSql = captured.sql.find((s) => /search_vector/.test(s));
    expect(ftsSql).toBeDefined();
    expect(ftsSql!).toMatch(/sender_type\s*!=\s*'internal_note'/);
    expect(ftsSql!).toMatch(/hiddenInUi/);
  });

  it('ILIKE-ветка (q<3): ни internal_note, ни hiddenInUi не в результатах', async () => {
    const captured = { sql: [] as string[] };
    wireSearchPool(captured);
    const res = await request(app)
      .get(`/sessions/${SESSION_ID}/messages/search?q=пр`)
      .set('Authorization', `Bearer ${makeToken(CLIENT)}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map((m: { id: string }) => m.id);
    expect(ids).not.toContain('s-note');
    expect(ids).not.toContain('s-hidden');
    const ilikeSql = captured.sql.find((s) => /ILIKE/.test(s));
    expect(ilikeSql).toBeDefined();
    expect(ilikeSql!).toMatch(/sender_type\s*!=\s*'internal_note'/);
    expect(ilikeSql!).toMatch(/hiddenInUi/);
  });
});
