import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
}));

vi.mock('../database/db.js', () => ({
  pool: mockPool,
  default: { getPool: () => mockPool },
}));

const {
  recordAttribution,
  refreshPrimaryService,
  attributeOrder,
  reconcileAttributions,
  inferAttributionFromMessage,
} = await import('./service-attribution.service.js');

type QueryCall = { sql: string; params: unknown[] };

/** Перехват всех pool.query: запоминает (sql, params), возвращает rows по матчеру. */
function captureQueries(handler?: (sql: string, params: unknown[]) => { rows: unknown[] }) {
  const calls: QueryCall[] = [];
  vi.mocked(mockPool.query).mockImplementation(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    return handler ? handler(sql, params) : { rows: [] };
  });
  return calls;
}

const isInsert = (c: QueryCall) => /INSERT INTO client_service_attributions/i.test(c.sql);
const isUpdateContacts = (c: QueryCall) => /UPDATE contacts/i.test(c.sql);

beforeEach(() => {
  vi.mocked(mockPool.query).mockReset();
});

describe('recordAttribution — идемпотентность', () => {
  it('делает upsert через ON CONFLICT по ключу (source_table, source_id, service_slug)', async () => {
    const calls = captureQueries();
    await recordAttribution({
      contactId: 'c1',
      channel: 'telegram',
      serviceSlug: 'document_photo',
      serviceCategory: 'document_photo',
      serviceLabel: 'Паспорт РФ',
      method: 'order',
      tier: 'fact',
      sourceTable: 'photo_print_orders',
      sourceId: 'o1',
    });

    const insert = calls.find(isInsert);
    expect(insert).toBeDefined();
    // идемпотентный ключ + DO UPDATE (повтор не плодит дубль — БД дедуплицирует)
    expect(insert!.sql).toMatch(
      /ON CONFLICT \(source_table, source_id, service_slug\) WHERE source_id IS NOT NULL/i,
    );
    expect(insert!.sql).toMatch(/DO UPDATE SET/i);
    expect(insert!.sql).toMatch(/updated_at\s*=\s*now\(\)/i);
  });

  it('повтор с тем же источником+услугой шлёт идентичные параметры (БД сводит в одну строку)', async () => {
    const calls = captureQueries();
    const input = {
      contactId: 'c1',
      channel: 'telegram' as const,
      serviceSlug: 'photo_print',
      serviceCategory: 'photo_print',
      method: 'order' as const,
      tier: 'fact' as const,
      sourceTable: 'photo_print_orders',
      sourceId: 'o1',
    };
    await recordAttribution(input);
    await recordAttribution(input);

    const inserts = calls.filter(isInsert);
    expect(inserts).toHaveLength(2);
    // ключевые поля (source_table, source_id, service_slug) совпадают → один ON CONFLICT-ключ
    const key = (p: unknown[]) => [p[8], p[9], p[2]]; // source_table, source_id, service_slug
    expect(key(inserts[0].params)).toEqual(key(inserts[1].params));
  });

  it('fact-атрибуция без явной confidence получает 1.0; inferred — 0.6', async () => {
    const calls = captureQueries();
    await recordAttribution({
      contactId: 'c1',
      channel: 'telegram',
      serviceSlug: 'photo_print',
      method: 'order',
      tier: 'fact',
      sourceTable: 'photo_print_orders',
      sourceId: 'o1',
    });
    await recordAttribution({
      contactId: 'c1',
      channel: 'telegram',
      serviceSlug: 'retouch',
      method: 'text_inference',
      tier: 'inferred',
      sourceTable: 'conversations',
      sourceId: 'conv1',
    });
    const inserts = calls.filter(isInsert);
    expect(inserts[0].params[7]).toBe(1.0); // confidence для fact
    expect(inserts[1].params[7]).toBe(0.6); // confidence для inferred
  });

  it('усекает service_label до 255 символов', async () => {
    const calls = captureQueries();
    await recordAttribution({
      contactId: 'c1',
      channel: 'telegram',
      serviceSlug: 'photo_print',
      serviceLabel: 'x'.repeat(500),
      method: 'text_inference',
      tier: 'inferred',
      sourceTable: 'conversations',
      sourceId: 'conv1',
    });
    const insert = calls.find(isInsert)!;
    expect((insert.params[3] as string).length).toBe(255);
  });

  it('без sourceId НЕ пишет строку (sentinel строкой не пишется, P0-1)', async () => {
    const calls = captureQueries();
    await recordAttribution({
      contactId: 'c1',
      channel: 'telegram',
      serviceSlug: 'not_determined',
      method: 'manual',
      tier: 'fact',
      sourceTable: 'contacts',
      sourceId: '', // пусто
    });
    expect(calls.filter(isInsert)).toHaveLength(0);
  });

  it('после upsert вызывает пересчёт кэша (refreshPrimaryService)', async () => {
    const calls = captureQueries();
    await recordAttribution({
      contactId: 'c1',
      channel: 'telegram',
      serviceSlug: 'document_photo',
      method: 'order',
      tier: 'fact',
      sourceTable: 'photo_print_orders',
      sourceId: 'o1',
    });
    expect(calls.some(isInsert)).toBe(true);
    expect(calls.some(isUpdateContacts)).toBe(true);
  });
});

describe('refreshPrimaryService — детерминизм primary (P0-4)', () => {
  it('UPDATE использует полный детерминированный тай-брейкер', async () => {
    const calls = captureQueries();
    await refreshPrimaryService('c1');
    const upd = calls.find(isUpdateContacts)!;
    expect(upd).toBeDefined();
    // tier-ранг (fact бьёт inferred)
    expect(upd.sql).toMatch(/WHEN 'fact' THEN 0 WHEN 'inferred' THEN 1/i);
    // приоритет категории + позднейшая дата + slug как финальный тай-брейк
    expect(upd.sql).toMatch(/COALESCE\(cp\.priority, 9\) ASC/i);
    expect(upd.sql).toMatch(/a\.determined_at DESC/i);
    expect(upd.sql).toMatch(/a\.service_slug ASC/i);
  });

  it('category_priority детерминирован: document_photo(1) раньше retouch(8)', async () => {
    const calls = captureQueries();
    await refreshPrimaryService('c1');
    const upd = calls.find(isUpdateContacts)!;
    // VALUES-фрагмент содержит обе категории с правильным рангом
    expect(upd.sql).toMatch(/\('document_photo', 1\)/);
    expect(upd.sql).toMatch(/\('retouch', 8\)/);
    expect(upd.sql).toMatch(/\('other', 9\)/);
  });

  it('sentinel при отсутствии атрибуций: not_determined / none / «Обращение без заказа»', async () => {
    const calls = captureQueries();
    await refreshPrimaryService('c1');
    const upd = calls.find(isUpdateContacts)!;
    expect(upd.sql).toMatch(/'not_determined'/);
    expect(upd.sql).toMatch(/'none'/);
    expect(upd.params).toContain('Обращение без заказа');
  });
});

describe('attributeOrder — резолв contact + запись фактов', () => {
  it('резолвит contact через chat_session_id → conversations и пишет факт по items', async () => {
    const calls = captureQueries((sql) => {
      if (/FROM photo_print_orders/i.test(sql)) {
        return {
          rows: [
            {
              id: 'o1',
              items: [
                { slug: 'passport-rf', name: 'Паспорт РФ' },
                { slug: 'processing-max', name: 'Макс. обработка' },
              ],
              chat_session_id: 'conv1',
              created_at: '2026-05-01T10:00:00Z',
              contact_id: 'c1',
              channel: 'telegram',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await attributeOrder('o1');

    // SELECT заказа джойнит conversations через chat_session_id
    const sel = calls.find((c) => /FROM photo_print_orders/i.test(c.sql))!;
    expect(sel.sql).toMatch(/LEFT JOIN conversations conv ON conv\.id = o\.chat_session_id/i);

    const inserts = calls.filter(isInsert);
    // passport-rf → document_photo (услуга), processing-max → retouch (услуга) → 2 строки
    expect(inserts.length).toBe(2);
    const slugs = inserts.map((c) => c.params[2]);
    expect(slugs).toContain('document_photo');
    expect(slugs).toContain('retouch');
    // contact_id из conversations, method=order, tier=fact, source_table/id заказа
    expect(inserts[0].params[0]).toBe('c1');
    expect(inserts[0].params[5]).toBe('order');
    expect(inserts[0].params[6]).toBe('fact');
    expect(inserts[0].params[8]).toBe('photo_print_orders');
    expect(inserts[0].params[9]).toBe('o1');
    // один refresh в конце
    expect(calls.filter(isUpdateContacts).length).toBe(1);
  });

  it('пропускает addon-позиции (processing-none, cropping) и нераспознанные', async () => {
    const calls = captureQueries((sql) => {
      if (/FROM photo_print_orders/i.test(sql)) {
        return {
          rows: [
            {
              id: 'o2',
              items: [
                { slug: 'processing-none', name: 'Без обработки' },
                { slug: 'cropping' },
                { slug: 'totally-unknown-xyz' },
              ],
              chat_session_id: 'conv1',
              created_at: '2026-05-01T10:00:00Z',
              contact_id: 'c1',
              channel: 'telegram',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await attributeOrder('o2');
    expect(calls.filter(isInsert).length).toBe(0);
    // нет факт-записей → refresh не вызывается
    expect(calls.filter(isUpdateContacts).length).toBe(0);
  });

  it('дедуплицирует одинаковый slug в пределах заказа (две фотопозиции → одна строка)', async () => {
    const calls = captureQueries((sql) => {
      if (/FROM photo_print_orders/i.test(sql)) {
        return {
          rows: [
            {
              id: 'o3',
              items: [
                { slug: 'km-фото-10x15-супер', name: 'Фото 10x15' },
                { slug: 'km-фото-20x30-матовое', name: 'Фото 20x30' },
              ],
              chat_session_id: 'conv1',
              created_at: '2026-05-01T10:00:00Z',
              contact_id: 'c1',
              channel: 'telegram',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await attributeOrder('o3');
    const inserts = calls.filter(isInsert);
    expect(inserts.length).toBe(1);
    expect(inserts[0].params[2]).toBe('photo_print');
  });

  it('walk-in заказ без беседы (contact_id=null) → атрибуция пропускается (known gap)', async () => {
    const calls = captureQueries((sql) => {
      if (/FROM photo_print_orders/i.test(sql)) {
        return {
          rows: [
            {
              id: 'o4',
              items: [{ slug: 'passport-rf', name: 'Паспорт' }],
              chat_session_id: null,
              created_at: '2026-05-01T10:00:00Z',
              contact_id: null,
              channel: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await attributeOrder('o4');
    expect(calls.filter(isInsert).length).toBe(0);
    expect(calls.filter(isUpdateContacts).length).toBe(0);
  });

  it('несуществующий заказ → no-op (best-effort)', async () => {
    const calls = captureQueries(() => ({ rows: [] }));
    await attributeOrder('missing');
    expect(calls.filter(isInsert).length).toBe(0);
  });

  it('best-effort: ошибка БД не пробрасывается наружу', async () => {
    vi.mocked(mockPool.query).mockRejectedValueOnce(new Error('db down'));
    await expect(attributeOrder('o5')).resolves.toBeUndefined();
  });

  it('парсит items, пришедшие строкой JSON', async () => {
    const calls = captureQueries((sql) => {
      if (/FROM photo_print_orders/i.test(sql)) {
        return {
          rows: [
            {
              id: 'o6',
              items: JSON.stringify([{ slug: 'file-sleeve', name: 'Переплёт' }]),
              chat_session_id: 'conv1',
              created_at: '2026-05-01T10:00:00Z',
              contact_id: 'c1',
              channel: 'telegram',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await attributeOrder('o6');
    const inserts = calls.filter(isInsert);
    expect(inserts.length).toBe(1);
    expect(inserts[0].params[2]).toBe('binding');
  });
});

describe('inferAttributionFromMessage — online Tier2 (FC-3, H4)', () => {
  it('happy path: текст с явной услугой → пишет inferred-атрибуцию и возвращает true', async () => {
    const calls = captureQueries();
    const wrote = await inferAttributionFromMessage({
      contactId: 'c1',
      conversationId: 'conv1',
      channel: 'telegram',
      text: 'сделайте фото на паспорт пожалуйста',
    });

    expect(wrote).toBe(true);
    const inserts = calls.filter(isInsert);
    expect(inserts.length).toBe(1);
    // паспорт → document_photo, method=text_inference, tier=inferred
    expect(inserts[0].params[2]).toBe('document_photo');
    expect(inserts[0].params[5]).toBe('text_inference');
    expect(inserts[0].params[6]).toBe('inferred');
    // source_id = conversation_id (идемпотентный ключ по беседе)
    expect(inserts[0].params[8]).toBe('conversations');
    expect(inserts[0].params[9]).toBe('conv1');
    // inferred-confidence ниже 1.0 (порог ≥0.6)
    expect(inserts[0].params[7] as number).toBeGreaterThanOrEqual(0.6);
    expect(inserts[0].params[7] as number).toBeLessThan(1.0);
  });

  it('stopword/no-signal: «спасибо» → ничего не пишет и возвращает false', async () => {
    const calls = captureQueries();
    const wrote = await inferAttributionFromMessage({
      contactId: 'c1',
      conversationId: 'conv1',
      channel: 'telegram',
      text: 'Спасибо!',
    });

    expect(wrote).toBe(false);
    expect(calls.filter(isInsert).length).toBe(0);
  });

  it('best-effort: ошибка БД при записи не пробрасывается наружу', async () => {
    // классификация даёт сигнал, но INSERT падает — функция не должна бросать.
    vi.mocked(mockPool.query).mockRejectedValue(new Error('db down'));
    await expect(
      inferAttributionFromMessage({
        contactId: 'c1',
        conversationId: 'conv1',
        channel: 'telegram',
        text: 'распечатайте полароидом',
      }),
    ).resolves.not.toThrow();
  });
});

describe('reconcileAttributions — батч-бэкфилл smoke (H5)', () => {
  it('на пустом наборе данных проходит все шаги без исключений и даёт нулевой результат', async () => {
    // Любой запрос (orphan UPDATE / Tier1 SELECT / phone-union / Tier2 / refresh)
    // возвращает пусто и rowCount=0 → ни одной атрибуции, ни одного затронутого контакта.
    vi.mocked(mockPool.query).mockResolvedValue({ rows: [], rowCount: 0 });

    const result = await reconcileAttributions();

    expect(result).toEqual({ scanned: 0, inserted: 0, contactsTouched: 0 });
    // все ветки реально дёрнули БД (orphan-fix + Tier1 + phone-union + Tier2 + refresh)
    expect(vi.mocked(mockPool.query).mock.calls.length).toBeGreaterThan(0);
  });

  it('уважает batchSize из opts (не зацикливается на пустом наборе)', async () => {
    vi.mocked(mockPool.query).mockResolvedValue({ rows: [], rowCount: 0 });
    const result = await reconcileAttributions({ batchSize: 100 });
    expect(result).toEqual({ scanned: 0, inserted: 0, contactsTouched: 0 });
  });
});

describe('refreshPrimaryService — fact бьёт inferred (M1)', () => {
  it('UPDATE-правило ставит fact(0) строго раньше inferred(1) при выборе primary', async () => {
    const calls = captureQueries();
    await refreshPrimaryService('c1');
    const upd = calls.find(isUpdateContacts)!;

    // Детерминированный выбор делает Postgres ORDER BY (tier_rank ASC) — fact раньше inferred.
    // На уровне юнита проверяем, что правило ранжирования в SQL именно такое.
    expect(upd.sql).toMatch(/WHEN 'fact' THEN 0/i);
    expect(upd.sql).toMatch(/WHEN 'inferred' THEN 1/i);
    // tier_rank — ПЕРВЫЙ ключ сортировки (важнее категории/даты): fact всегда бьёт inferred.
    const orderIdx = upd.sql.search(/ORDER BY/i);
    const tierIdx = upd.sql.indexOf("WHEN 'fact' THEN 0", orderIdx);
    const catIdx = upd.sql.indexOf('cp.priority', orderIdx);
    expect(tierIdx).toBeGreaterThan(-1);
    expect(tierIdx).toBeLessThan(catIdx);
    // выбранный slug/label/tier берутся из chosen-строки (а не хардкод) → fact-запись побеждает.
    expect(upd.sql).toMatch(/SELECT service_slug FROM chosen/i);
    expect(upd.sql).toMatch(/SELECT tier FROM chosen/i);
  });
});
