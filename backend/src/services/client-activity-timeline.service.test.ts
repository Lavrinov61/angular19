import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildActivityTimeline, toActivityItems } from './client-activity-timeline.service.js';
import type { TimelineEventRow } from '../types/views/crm-views.js';

const dbMock = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../database/db.js', () => ({
  default: dbMock,
}));

/** Перехватывает SQL и params последнего вызова db.query. */
function lastCall(): { sql: string; params: unknown[] } {
  const call = dbMock.query.mock.calls.at(-1);
  return { sql: call?.[0] as string, params: (call?.[1] as unknown[]) ?? [] };
}

describe('buildActivityTimeline — построение запроса', () => {
  beforeEach(() => {
    dbMock.query.mockReset();
    dbMock.query.mockResolvedValue([]);
  });

  it('возвращает пустой массив без обращения к БД при пустом identity', async () => {
    const rows = await buildActivityTimeline({}, { includeMessages: false });
    expect(rows).toEqual([]);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('параметры: $1=userId, $2=phoneLast10, $3=limit', async () => {
    await buildActivityTimeline(
      { userId: '00000000-0000-0000-0000-000000000001', phoneLast10: '9001234567' },
      { includeMessages: false },
      77,
    );
    const { params } = lastCall();
    expect(params).toEqual(['00000000-0000-0000-0000-000000000001', '9001234567', 77]);
  });

  it('userId undefined → $1=NULL (нет ложного match по $1::uuid IS NOT NULL), phone-only путь', async () => {
    await buildActivityTimeline(
      { phoneLast10: '9001234567', userId: undefined },
      { includeMessages: false },
    );
    const { params } = lastCall();
    // undefined нормализуется в null — иначе $1::uuid IS NOT NULL дал бы ложное
    // срабатывание ветки по user_id (или ошибку приведения undefined→uuid).
    expect(params[0]).toBeNull();
    expect(params[1]).toBe('9001234567');
  });

  it('includeMessages:false — НЕ включает ветки message и note (дедуп с data/previousMessages)', async () => {
    await buildActivityTimeline({ userId: 'u1' }, { includeMessages: false });
    const { sql } = lastCall();
    expect(sql).not.toMatch(/'message' AS type/);
    expect(sql).not.toMatch(/'note' AS type/);
    // Activity-ветки на месте.
    expect(sql).toMatch(/'booking' AS type/);
    expect(sql).toMatch(/'subscription' AS type/);
    expect(sql).toMatch(/'call' AS type/);
  });

  it('includeMessages:true — включает ветки message и note (контракт /timeline)', async () => {
    await buildActivityTimeline({ phoneLast10: '9001234567' }, { includeMessages: true });
    const { sql } = lastCall();
    expect(sql).toMatch(/'message' AS type/);
    expect(sql).toMatch(/'note' AS type/);
  });

  it('бронь матчится одним WHERE (client_id OR phone) — не двумя ветками (P2-3, без дублей)', async () => {
    await buildActivityTimeline({ userId: 'u1', phoneLast10: '9001234567' }, { includeMessages: false });
    const { sql } = lastCall();
    // Ровно одна booking-ветка.
    expect(sql.match(/'booking' AS type/g)).toHaveLength(1);
    // В ней — OR по client_id и phone (одна строка результата на бронь).
    const bookingBranch = sql.slice(sql.indexOf("'booking' AS type"), sql.indexOf("'order' AS type"));
    expect(bookingBranch).toMatch(/b\.client_id = \$1/);
    expect(bookingBranch).toMatch(/b\.client_phone/);
    expect(bookingBranch).toMatch(/\bOR\b/);
  });

  it('подписка включена и денежная (NEW): user_subscriptions + subscription_plans.name + monthly_price', async () => {
    await buildActivityTimeline({ userId: 'u1' }, { includeMessages: false });
    const { sql } = lastCall();
    expect(sql).toMatch(/FROM user_subscriptions us/);
    expect(sql).toMatch(/subscription_plans sp/);
    expect(sql).toMatch(/sp\.name/);
    expect(sql).toMatch(/us\.monthly_price/);
  });

  it('заказ печати использует реальные колонки description/photo_format (не doc_type/format)', async () => {
    await buildActivityTimeline({ phoneLast10: '9001234567' }, { includeMessages: false });
    const { sql } = lastCall();
    // Регресс-гард: legacy ссылался на несуществующие po.doc_type/po.format → 500.
    expect(sql).not.toMatch(/po\.doc_type/);
    expect(sql).not.toMatch(/po\.format\b/);
    expect(sql).toMatch(/po\.description/);
    expect(sql).toMatch(/po\.photo_format/);
  });

  it('звонок матчит client_user_id ИЛИ caller/called по телефону', async () => {
    await buildActivityTimeline({ userId: 'u1', phoneLast10: '9001234567' }, { includeMessages: false });
    const { sql } = lastCall();
    const callBranch = sql.slice(sql.indexOf("'call' AS type"), sql.indexOf("'subscription' AS type"));
    expect(callBranch).toMatch(/cl\.client_user_id = \$1/);
    expect(callBranch).toMatch(/cl\.caller_number/);
    expect(callBranch).toMatch(/cl\.called_number/);
  });
});

describe('toActivityItems — маппинг в ActivityItem', () => {
  function row(overrides: Partial<TimelineEventRow>): TimelineEventRow {
    return {
      type: 'booking',
      id: 'src-1',
      ts: '2026-05-30T10:00:00.000Z',
      title: 'Запись: фотосессия',
      detail: 'confirmed',
      amount: 3000,
      ...overrides,
    };
  }

  it('маппит booking → ActivityItem со стабильным id и денежной суммой', () => {
    const [item] = toActivityItems([row({ type: 'booking', id: 'b-1', amount: 3000, detail: 'confirmed' })]);
    expect(item).toEqual({
      kind: 'activity',
      id: 'activity:booking:b-1',
      activity_type: 'booking',
      created_at: '2026-05-30T10:00:00.000Z',
      title: 'Запись: фотосессия',
      detail: 'confirmed',
      amount: 3000,
      status: 'confirmed',
    });
  });

  it('маппит все activity-типы и сохраняет порядок', () => {
    const types = ['booking', 'order', 'pos_receipt', 'subscription', 'call', 'loyalty'] as const;
    const items = toActivityItems(types.map((t, i) => row({ type: t, id: `${t}-${i}` })));
    expect(items.map((i) => i.activity_type)).toEqual([...types]);
    items.forEach((i) => expect(i.id).toBe(`activity:${i.activity_type}:${i.activity_type}-${types.indexOf(i.activity_type)}`));
  });

  it('ДЕДУП: отбрасывает ветки message и note (приходят через data/previousMessages)', () => {
    const items = toActivityItems([
      row({ type: 'message', id: 'm-1', amount: null }),
      row({ type: 'note', id: 'n-1', amount: null }),
      row({ type: 'booking', id: 'b-1' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].activity_type).toBe('booking');
  });

  it('amount null остаётся null; нечисловой amount нормализуется в null', () => {
    const [callItem] = toActivityItems([row({ type: 'call', id: 'c-1', amount: null, detail: '35 сек' })]);
    expect(callItem.amount).toBeNull();
    expect(callItem.status).toBe('35 сек');
  });

  it('amount строкой из numeric (pg возвращает строку) приводится к числу', () => {
    const [item] = toActivityItems([row({ type: 'pos_receipt', id: 'r-1', amount: '199.50' as unknown as number })]);
    expect(item.amount).toBe(199.5);
  });
});
