import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = vi.hoisted(() => ({
  queryOne: vi.fn().mockResolvedValue(null),
  query: vi.fn().mockResolvedValue([]),
}));

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { connect: vi.fn(), query: vi.fn() },
}));

vi.mock('../utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

import { createRetouchTaskFromCrm, getRetouchQueue, markRetouchRevision } from './retouch.service.js';

describe('createRetouchTaskFromCrm', () => {
  beforeEach(() => {
    vi.mocked(mockDb.queryOne).mockReset();
    vi.mocked(mockDb.query).mockReset();
  });

  it('дедуплицирует по print_order_id: при существующей задаче не делает INSERT и возвращает null', async () => {
    // 1-й queryOne (дедуп) находит задачу.
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ id: 'existing-task-id' });

    const result = await createRetouchTaskFromCrm({
      print_order_id: 'print-order-uuid-1',
      order_id_label: 'CRM-260530-AB12',
      retouch_options: [],
      created_by: 'user-1',
    });

    expect(result).toBeNull();
    // Только дедуп-запрос; INSERT не выполнялся.
    expect(mockDb.queryOne).toHaveBeenCalledTimes(1);
    const dedupCall = vi.mocked(mockDb.queryOne).mock.calls[0];
    expect(dedupCall[0]).toContain('SELECT id FROM work_tasks WHERE print_order_id = $1');
    expect(dedupCall[1]).toEqual(['print-order-uuid-1']);
  });

  it('пишет print_order_id (НЕ order_id) в FK-колонку и метаданные source=crm', async () => {
    // 1-й queryOne (дедуп) — нет существующей задачи; 2-й (INSERT) — созданная задача.
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'new-task-id', task_number: 42, status: 'open' });

    const result = await createRetouchTaskFromCrm({
      print_order_id: 'print-order-uuid-2',
      order_id_label: 'CRM-260530-CD34',
      studio_id: 'studio-1',
      client_name: 'Иван Петров',
      client_phone: '+79991234567',
      chat_session_id: 'chat-uuid-9',
      gender: 'male',
      retouch_options: [{ group: 'skin', group_name: 'Кожа', slug: 'skin-cleanup', label: 'Чистка кожи' }],
      notes: 'Без сильного сглаживания',
      created_by: 'operator-7',
    });

    expect(result).toEqual({ id: 'new-task-id', task_number: 42, status: 'open' });
    expect(mockDb.queryOne).toHaveBeenCalledTimes(2);

    const insertCall = vi.mocked(mockDb.queryOne).mock.calls[1];
    const sql = insertCall[0] as string;
    const params = insertCall[1] as unknown[];

    // INSERT в work_tasks; print_order_id в списке колонок, order_id остаётся NULL.
    expect(sql).toContain('INSERT INTO work_tasks');
    expect(sql).toContain('print_order_id');
    expect(sql).toContain("'retouch', 'open'");
    expect(sql).toContain("'super'");

    // print_order_id ($4) = UUID заказа, НЕ человекочитаемый ярлык.
    expect(params[3]).toBe('print-order-uuid-2');
    expect(params).not.toContain('CRM-260530-CD34'); // ярлык не попадает в FK-колонку

    // metadata ($9) — JSON со source='crm' и order_id_label.
    const metadata = JSON.parse(params[8] as string);
    expect(metadata.source).toBe('crm');
    expect(metadata.order_id_label).toBe('CRM-260530-CD34');
    expect(metadata.gender).toBe('male');
    expect(metadata.item_count).toBe(1);
    expect(metadata.chat_session_id).toBe('chat-uuid-9');
  });

  it('создаёт задачу даже при пустых retouch_options (P0-2)', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'task-empty', task_number: 1, status: 'open' });

    const result = await createRetouchTaskFromCrm({
      print_order_id: 'print-order-uuid-3',
      order_id_label: 'CRM-260530-EF56',
      retouch_options: [],
      created_by: 'operator-1',
    });

    expect(result).not.toBeNull();
    const params = vi.mocked(mockDb.queryOne).mock.calls[1][1] as unknown[];
    // retouch_options ($3) = пустой массив; title несёт ярлык заказа.
    expect(params[2]).toBe('[]');
    expect(params[0]).toContain('CRM-260530-EF56');
    const metadata = JSON.parse(params[8] as string);
    expect(metadata.item_count).toBe(0);
    expect(metadata.gender).toBe('any'); // дефолт при отсутствии gender
  });

  it('подрезает client_name(255)/client_phone(20)/title(255)', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'task-trim', task_number: 2, status: 'open' });

    await createRetouchTaskFromCrm({
      print_order_id: 'print-order-uuid-4',
      order_id_label: 'CRM-260530-GH78',
      client_name: 'Я'.repeat(400),
      client_phone: '+7'.repeat(40),
      retouch_options: [],
      created_by: 'operator-2',
    });

    const params = vi.mocked(mockDb.queryOne).mock.calls[1][1] as unknown[];
    expect((params[0] as string).length).toBeLessThanOrEqual(255); // title
    expect((params[5] as string).length).toBe(255); // client_name
    expect((params[6] as string).length).toBe(20); // client_phone
  });
});

describe('markRetouchRevision', () => {
  beforeEach(() => {
    vi.mocked(mockDb.queryOne).mockReset();
    vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  });

  it('возвращает null и НЕ трогает задачу, если waiting-задачи по сессии нет', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(null);

    const result = await markRetouchRevision({
      approvalSessionId: 'session-none',
      reason: 'нужна доработка',
      changedBy: 'user-1',
    });

    expect(result).toBeNull();
    // Только SELECT задачи; UPDATE/history не выполнялись.
    expect(mockDb.query).not.toHaveBeenCalled();
    const sel = vi.mocked(mockDb.queryOne).mock.calls[0];
    expect(sel[0]).toContain("status = 'waiting'");
    expect(sel[1]).toEqual(['session-none']);
  });

  it('возвращает задачу в работу + СБРАСЫВАЕТ обратный отсчёт (sla_deadline/due_date)', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce({ id: 'task-rev-1' });

    const result = await markRetouchRevision({
      approvalSessionId: 'session-1',
      reason: 'поправить кожу',
      changedBy: 'client-7',
    });

    expect(result).toEqual({ taskId: 'task-rev-1' });

    // 1-й query — UPDATE work_tasks со сбросом дедлайна; 2-й — insertHistory.
    const updateCall = vi.mocked(mockDb.query).mock.calls[0];
    const updateSql = updateCall[0] as string;
    expect(updateSql).toContain("status = 'in_progress'");
    expect(updateSql).toContain('revision_count = revision_count + 1');
    expect(updateSql).toContain('result_photo_url = NULL');
    expect(updateSql).toContain('sla_deadline = NOW()');
    expect(updateSql).toContain('due_date = NOW()');
    expect(updateCall[1]?.[0]).toBe('task-rev-1');

    const historyCall = vi.mocked(mockDb.query).mock.calls[1];
    expect(historyCall[0]).toContain('INSERT INTO retouch_task_history');
    const historyParams = historyCall[1] as unknown[];
    expect(historyParams[2]).toBe('in_progress'); // to_status
    expect(historyParams[4]).toBe('поправить кожу'); // reason
  });
});

describe('getRetouchQueue', () => {
  beforeEach(() => {
    vi.mocked(mockDb.queryOne).mockReset();
    vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  });

  it('фильтрует очередь по order_id для панели заказа', async () => {
    await getRetouchQueue({ order_id: 'CRM-260630-JWBF' });

    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('rq.order_id::text = $1'),
      ['CRM-260630-JWBF'],
    );
    const sql = vi.mocked(mockDb.query).mock.calls[0][0] as string;
    expect(sql).toContain('photo_print_orders p');
    expect(sql).toContain('p.order_id = $1');
    expect(sql).toContain("wt.metadata->>'order_id_label' = $1");
  });
});
