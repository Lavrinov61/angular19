import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';

const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    query: vi.fn().mockResolvedValue([]),
    queryOne: vi.fn().mockResolvedValue(null),
    transaction: vi.fn().mockImplementation(async (fn: (c: unknown) => unknown) => fn({})),
  };
  return { mockDb };
});

vi.mock('../database/db.js', () => ({ default: mockDb, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));
vi.mock('../config/index.js', () => ({
  config: { jwt: { secret: 'test-jwt-secret-for-tests', expiresIn: '15m' }, redis: { host: '' } },
}));
vi.mock('../services/notification.service.js', () => ({
  NotificationService: { create: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../services/task-ai.service.js', () => ({
  generateShiftBriefing: vi.fn().mockResolvedValue('Briefing text'),
}));
vi.mock('../services/schedule-validation.service.js', () => ({
  validateShiftPattern: vi.fn().mockReturnValue({ valid: true, errors: [] }),
  generateShiftsFromPattern: vi.fn().mockReturnValue([
    { date: '2026-03-05', start_time: '09:00', end_time: '19:00' },
  ]),
}));
vi.mock('../services/pos.service.js', () => ({
  closeShift: vi.fn().mockResolvedValue({ shift: {}, commissionSummary: null }),
}));
vi.mock('../services/pos-fiscal-shift.service.js', () => ({
  isFiscalShiftOpenForShift: vi.fn().mockResolvedValue(false),
}));
vi.mock('../services/pos-fiscal-command.service.js', () => ({
  enqueueShiftFiscalCommand: vi.fn().mockResolvedValue('fiscal-tx-1'),
}));

let app: import('express').Express;

beforeAll(async () => {
  const { createTestApp } = await import('../test-utils/create-test-app.js');
  const { default: router } = await import('./shifts.routes.js');
  app = createTestApp(router);
});

import { makeAdminUser, makeEmployeeUser, authHeader } from '../test-utils/mock-auth.js';
import { closeShift } from '../services/pos.service.js';
import { enqueueShiftFiscalCommand } from '../services/pos-fiscal-command.service.js';
import { isFiscalShiftOpenForShift } from '../services/pos-fiscal-shift.service.js';

const DB_ADMIN = { id: 'admin-id', email: 'admin@example.com', role: 'admin', is_active: true, display_name: 'Admin', phone: null, force_password_change: false, last_password_change: null };
const DB_EMPLOYEE = { id: 'employee-id', email: 'employee@example.com', role: 'employee', is_active: true, display_name: 'Employee', phone: null, force_password_change: false, last_password_change: null };
const DB_CLIENT = { id: 'client-id', email: 'client@example.com', role: 'client', is_active: true, display_name: 'Client', phone: null, force_password_change: false, last_password_change: null };
const STUDIO_ID = '00000000-0000-4000-8000-000000000001';
const ONLINE_STUDIO_ID = '00000000-0000-4000-8000-000000000003';

// Shift request with requested_shifts array (needed for approve logic)
const SHIFT_REQUEST = {
  id: 'req-1',
  employee_id: 'employee-id',
  status: 'pending',
  shift_pattern: '2/2',
  requested_shifts: [{ date: '2026-03-05', start_time: '09:00', end_time: '19:00' }],
};
const PROPOSED_SHIFT = { date: '2026-03-05', start_time: '09:00', end_time: '19:00', studio_id: STUDIO_ID, action: 'work' };
const PROPOSAL_REQUEST = {
  ...SHIFT_REQUEST,
  shift_pattern: 'custom',
  requested_shifts: [PROPOSED_SHIFT],
  admin_id: 'admin-id',
  admin_comment: 'Нужна смена на Баррикадной',
};
const CLIENT_SHIFT_REQUEST = { ...SHIFT_REQUEST, id: 'client-req-1', employee_id: 'client-id' };
const SHIFT = {
  id: 'shift-1',
  employee_id: 'employee-id',
  shift_date: '2026-03-05',
  studio_id: STUDIO_ID,
  start_time: '09:00:00',
  end_time: '19:00:00',
  status: 'scheduled',
};
const COMPLETED_SHIFT = {
  ...SHIFT,
  status: 'completed',
  notes: null,
  created_at: '2026-03-05T06:00:00.000Z',
  updated_at: '2026-03-05T16:00:00.000Z',
  checked_in_at: '2026-03-05T06:00:00.000Z',
  checked_out_at: '2026-03-05T16:00:00.000Z',
  cash_at_open: '1100.00',
  cash_at_close: '1000.00',
  online_earnings: '0',
  online_count: 0,
  sales_total: '0',
  commission_total: '0',
  receipts_count: 0,
};
const ONLINE_SHIFT = {
  ...COMPLETED_SHIFT,
  id: 'online-shift-1',
  studio_id: ONLINE_STUDIO_ID,
  status: 'active',
  shift_kind: 'virtual',
  studio_name: 'Онлайн смена',
  studio_address: null,
  location_code: 'online',
};

function resetMocks() {
  vi.mocked(mockDb.query).mockReset().mockResolvedValue([]);
  vi.mocked(mockDb.queryOne).mockReset().mockResolvedValue(null);
  vi.mocked(closeShift).mockClear();
  vi.mocked(isFiscalShiftOpenForShift).mockReset().mockResolvedValue(false);
  vi.mocked(enqueueShiftFiscalCommand).mockReset().mockResolvedValue('fiscal-tx-1');
}

// Shift routes require shifts:manage; employees currently have that permission for their pult workflows.

// ─── POST /requests — request shift ──────────────────────────────────────────
describe('POST /requests — request shift', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/requests').send({});
    expect(res.status).toBe(401);
  });

  it('creates shift request for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app)
      .post('/requests')
      .set(authHeader(makeEmployeeUser()))
      .send({ shift_pattern: '2/2', pattern_start_date: '2026-03-01' });
    expect(res.status).toBe(201);
  });

  it('returns 400 if shift_pattern missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/requests')
      .set(authHeader(makeAdminUser()))
      .send({ pattern_start_date: '2026-03-01' });
    expect(res.status).toBe(400);
  });

  it('creates shift request for admin', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)     // auth
      .mockResolvedValueOnce(SHIFT_REQUEST); // INSERT RETURNING
    vi.mocked(mockDb.query).mockResolvedValueOnce([]); // SELECT admins for notifications

    const res = await request(app)
      .post('/requests')
      .set(authHeader(makeAdminUser()))
      .send({ shift_pattern: '2/2', pattern_start_date: '2026-03-01' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /requests/propose — admin proposes shifts ─────────────────────────
describe('POST /requests/propose — propose shifts', () => {
  beforeEach(resetMocks);

  it('creates pending proposal for employee', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)
      .mockResolvedValueOnce(PROPOSAL_REQUEST);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([DB_EMPLOYEE])
      .mockResolvedValueOnce([{ id: STUDIO_ID }]);

    const res = await request(app)
      .post('/requests/propose')
      .set(authHeader(makeAdminUser()))
      .send({
        employee_id: 'employee-id',
        requested_shifts: [PROPOSED_SHIFT],
        comment: 'Нужна смена на Баррикадной',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /requests/my — my shift requests ────────────────────────────────────
describe('GET /requests/my — my shift requests', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/requests/my');
    expect(res.status).toBe(401);
  });

  it('returns shift requests for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([SHIFT_REQUEST]);
    const res = await request(app).get('/requests/my').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns shift requests for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([SHIFT_REQUEST]);

    const res = await request(app).get('/requests/my').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /requests — all shift requests (admin/manager) ───────────────────────
describe('GET /requests — all shift requests', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/requests');
    expect(res.status).toBe(401);
  });

  it('returns all requests for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([SHIFT_REQUEST]);

    const res = await request(app).get('/requests').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /requests/:id/accept — accept admin proposal ───────────────────────
describe('PUT /requests/:id/accept — accept schedule proposal', () => {
  beforeEach(resetMocks);

  it('applies proposed shifts for employee', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce(PROPOSAL_REQUEST)
      .mockResolvedValueOnce({ ...PROPOSAL_REQUEST, status: 'approved' })
      .mockResolvedValueOnce(SHIFT);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([DB_EMPLOYEE])
      .mockResolvedValueOnce([{ id: STUDIO_ID }]);

    const res = await request(app)
      .put('/requests/req-1/accept')
      .set(authHeader(makeEmployeeUser()))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.created_shifts).toBe(1);
  });
});

// ─── PUT /requests/:id/decline — decline admin proposal ─────────────────────
describe('PUT /requests/:id/decline — decline schedule proposal', () => {
  beforeEach(resetMocks);

  it('marks proposal rejected for employee', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({ ...PROPOSAL_REQUEST, status: 'rejected' });

    const res = await request(app)
      .put('/requests/req-1/decline')
      .set(authHeader(makeEmployeeUser()))
      .send({ comment: 'Не могу выйти' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── PUT /requests/:id/approve — approve shift request ───────────────────────
describe('PUT /requests/:id/approve — approve shift request', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).put('/requests/req-1/approve').send({ studio_id: STUDIO_ID });
    expect(res.status).toBe(401);
  });

  it('returns 400 if studio_id missing', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)
      .mockResolvedValueOnce(SHIFT_REQUEST);
    const res = await request(app)
      .put('/requests/req-1/approve')
      .set(authHeader(makeAdminUser()))
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 if request not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(null);    // UPDATE RETURNING → not found

    const res = await request(app)
      .put('/requests/unknown/approve')
      .set(authHeader(makeAdminUser()))
      .send({ studio_id: STUDIO_ID });
    expect(res.status).toBe(404);
  });

  it('approves shift request for admin', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)   // auth
      .mockResolvedValueOnce(SHIFT_REQUEST) // SELECT request
      .mockResolvedValueOnce(SHIFT_REQUEST) // UPDATE RETURNING
      .mockResolvedValueOnce(SHIFT);     // INSERT employee_shifts
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([DB_EMPLOYEE])
      .mockResolvedValueOnce([{ id: STUDIO_ID }]);

    const res = await request(app)
      .put('/requests/req-1/approve')
      .set(authHeader(makeAdminUser()))
      .send({ studio_id: STUDIO_ID });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects approving shift request for client user', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)
      .mockResolvedValueOnce(CLIENT_SHIFT_REQUEST);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_CLIENT]);

    const res = await request(app)
      .put('/requests/client-req-1/approve')
      .set(authHeader(makeAdminUser()))
      .send({ studio_id: STUDIO_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('только сотрудникам');
  });
});

// ─── POST /requests/bulk-approve — bulk approve shift requests ───────────────
describe('POST /requests/bulk-approve — bulk approve shift requests', () => {
  beforeEach(resetMocks);

  it('records failure for client shift requests', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)
      .mockResolvedValueOnce(CLIENT_SHIFT_REQUEST);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_CLIENT]);

    const res = await request(app)
      .post('/requests/bulk-approve')
      .set(authHeader(makeAdminUser()))
      .send({ request_ids: ['client-req-1'], studio_id: STUDIO_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.failed[0].error).toContain('только сотрудникам');
  });
});

// ─── GET / — list shifts ──────────────────────────────────────────────────────
describe('GET / — list shifts', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(401);
  });

  it('returns shifts for employee', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    vi.mocked(mockDb.query).mockResolvedValueOnce([SHIFT]);
    const res = await request(app).get('/').set(authHeader(makeEmployeeUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns shifts for admin', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([SHIFT]);

    const res = await request(app).get('/').set(authHeader(makeAdminUser()));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /workday/start — start workday ─────────────────────────────────────
describe('POST /workday/start — start workday', () => {
  beforeEach(resetMocks);

  it('starts online studio shifts as virtual employee shifts', async () => {
    const clientQueries: { sql: string; params: unknown[] }[] = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        clientQueries.push({ sql, params });
        if (sql.includes('SELECT es.*, es.shift_date::text AS shift_date') && sql.includes('FOR UPDATE OF es')) {
          return { rows: [] };
        }
        if (sql.includes('FROM studios') && sql.includes('kind_studio')) {
          return { rows: [{ shift_kind: 'virtual' }] };
        }
        if (sql.includes('INSERT INTO employee_shifts')) {
          return { rows: [{ id: ONLINE_SHIFT.id }] };
        }
        if (sql.includes('SELECT es.*, es.shift_date::text AS shift_date') && sql.includes('WHERE es.id = $1')) {
          return { rows: [ONLINE_SHIFT] };
        }
        if (sql.includes('UPDATE employee_shifts') && sql.includes('cash_at_open')) {
          return { rows: [{ ...ONLINE_SHIFT, cash_at_open: '1000.00' }] };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({ is_virtual: true })
      .mockResolvedValueOnce({ id: 'today-shift-1', studio_id: ONLINE_STUDIO_ID, status: 'scheduled' })
      .mockResolvedValueOnce(null);
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ id: ONLINE_STUDIO_ID }])
      .mockResolvedValueOnce([]);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn(client));

    const res = await request(app)
      .post('/workday/start')
      .set(authHeader(makeEmployeeUser()))
      .send({ studio_id: ONLINE_STUDIO_ID, cash_at_open: 1000 });

    const insertCall = clientQueries.find(call => call.sql.includes('INSERT INTO employee_shifts'));
    expect(insertCall?.sql).toContain('shift_kind');
    expect(insertCall?.params).toContain('virtual');
    expect(res.status).toBe(201);
    expect(res.body.data.is_virtual).toBe(true);
    expect(res.body.meta.virtual).toBe(true);
  });

  it('does not require an occupied-studio warning for online shifts', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT es.*, es.shift_date::text AS shift_date') && sql.includes('FOR UPDATE OF es')) {
          return { rows: [] };
        }
        if (sql.includes('FROM studios') && sql.includes('kind_studio')) {
          return { rows: [{ shift_kind: 'virtual' }] };
        }
        if (sql.includes('INSERT INTO employee_shifts')) {
          return { rows: [{ id: ONLINE_SHIFT.id }] };
        }
        if (sql.includes('SELECT es.*, es.shift_date::text AS shift_date') && sql.includes('WHERE es.id = $1')) {
          return { rows: [ONLINE_SHIFT] };
        }
        if (sql.includes('UPDATE employee_shifts') && sql.includes('cash_at_open')) {
          return { rows: [{ ...ONLINE_SHIFT, cash_at_open: '1000.00' }] };
        }
        return { rows: [] };
      }),
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce({ is_virtual: true })
      .mockResolvedValueOnce({ id: 'today-shift-1', studio_id: ONLINE_STUDIO_ID, status: 'scheduled' });
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ id: ONLINE_STUDIO_ID }])
      .mockResolvedValueOnce([]);
    vi.mocked(mockDb.transaction).mockImplementationOnce(async (fn: (c: unknown) => unknown) => fn(client));

    const res = await request(app)
      .post('/workday/start')
      .set(authHeader(makeEmployeeUser()))
      .send({ studio_id: ONLINE_STUDIO_ID, cash_at_open: 1000 });

    const occupiedLookup = vi.mocked(mockDb.queryOne).mock.calls.some(([sql]) =>
      typeof sql === 'string' && sql.includes('JOIN users u ON u.id = es.employee_id'),
    );
    expect(occupiedLookup).toBe(false);
    expect(res.status).toBe(201);
    expect(res.body.meta.virtual).toBe(true);
  });
});

// ─── POST / — create shift ─────────────────────────────────────────────────────
describe('POST / — create shift', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 if required fields missing', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ employee_id: 'emp-1' }); // missing studio_id, shift_date
    expect(res.status).toBe(400);
  });

  it('creates shift for admin', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(SHIFT);   // INSERT RETURNING
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_EMPLOYEE]);

    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ employee_id: 'employee-id', studio_id: STUDIO_ID, shift_date: '2026-03-05' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('resolves covered employee work requests after direct shift creation', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)
      .mockResolvedValueOnce(SHIFT);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_EMPLOYEE]);

    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ employee_id: 'employee-id', studio_id: STUDIO_ID, shift_date: '2026-03-05' });

    const resolveCall = vi.mocked(mockDb.query).mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE schedule_requests sr'),
    );
    expect(res.status).toBe(201);
    expect(resolveCall?.[1]).toEqual(['employee-id', 'admin-id', ['2026-03-05']]);
  });

  it('rejects assigning shift to client user', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_CLIENT]);

    const res = await request(app)
      .post('/')
      .set(authHeader(makeAdminUser()))
      .send({ employee_id: 'client-id', studio_id: STUDIO_ID, shift_date: '2026-03-05' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('только сотрудникам');
  });
});

// ─── POST /bulk — create shifts in bulk ──────────────────────────────────────
describe('POST /bulk — create shifts in bulk', () => {
  beforeEach(resetMocks);

  it('creates shifts for staff users', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(SHIFT);   // INSERT RETURNING
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_EMPLOYEE]);

    const res = await request(app)
      .post('/bulk')
      .set(authHeader(makeAdminUser()))
      .send({
        shifts: [
          { employee_id: 'employee-id', studio_id: STUDIO_ID, shift_date: '2026-03-05' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it('resolves covered employee work requests after bulk shift creation', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN)
      .mockResolvedValueOnce(SHIFT);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_EMPLOYEE]);

    const res = await request(app)
      .post('/bulk')
      .set(authHeader(makeAdminUser()))
      .send({
        shifts: [
          { employee_id: 'employee-id', studio_id: STUDIO_ID, shift_date: '2026-03-05' },
        ],
      });

    const resolveCall = vi.mocked(mockDb.query).mock.calls.find(([sql]) =>
      typeof sql === 'string' && sql.includes('UPDATE schedule_requests sr'),
    );
    expect(res.status).toBe(201);
    expect(resolveCall?.[1]).toEqual(['employee-id', 'admin-id', ['2026-03-05']]);
  });

  it('rejects assigning bulk shifts to client users', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN);
    vi.mocked(mockDb.query).mockResolvedValueOnce([DB_CLIENT]);

    const res = await request(app)
      .post('/bulk')
      .set(authHeader(makeAdminUser()))
      .send({
        shifts: [
          { employee_id: 'client-id', studio_id: STUDIO_ID, shift_date: '2026-03-05' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('только сотрудникам');
  });
});

// ─── POST /:id/check-in — check into shift ────────────────────────────────────
describe('POST /:id/check-in — check in', () => {
  beforeEach(resetMocks);

  it('returns 401 without auth', async () => {
    const res = await request(app).post('/shift-1/check-in').send({});
    expect(res.status).toBe(401);
  });

  it('returns 404 if employee has no matching scheduled shift', async () => {
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    const res = await request(app).post('/shift-1/check-in').set(authHeader(makeEmployeeUser())).send({ cash_at_open: 1000 });
    expect(res.status).toBe(404);
  });

  it('returns 404 if shift not found', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(null);    // shift not found

    const res = await request(app).post('/unknown/check-in').set(authHeader(makeAdminUser())).send({ cash_at_open: 1000 });
    expect(res.status).toBe(404);
  });
});

// ─── POST /:id/check-out — check out from shift ──────────────────────────────
describe('POST /:id/check-out — check out', () => {
  beforeEach(resetMocks);

  it('returns success if a previous timed-out request already completed the shift', async () => {
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(null) // active shift update found no row
      .mockResolvedValueOnce(COMPLETED_SHIFT) // completed by the previous request
      .mockResolvedValueOnce(COMPLETED_SHIFT) // cached totals refresh
      .mockResolvedValueOnce({
        hours_worked: '10',
        pos_count: '0',
        pos_total: '0',
        commission_total: '0',
        online_count: '0',
        online_total: '0',
      });
    vi.mocked(mockDb.query).mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/shift-1/check-out')
      .set(authHeader(makeEmployeeUser()))
      .send({ cash_at_close: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('completed');
    expect(res.body.data.cash_at_close).toBe(1000);
    expect(res.body.checkout_summary.hours_worked).toBe(10);
    // Replay-путь не должен повторно закрывать кассовую смену
    expect(closeShift).not.toHaveBeenCalled();
  });

  it('auto-closes the linked POS shift with the entered cash on a fresh check-out', async () => {
    const ACTIVE = { ...COMPLETED_SHIFT, status: 'active', pos_shift_id: 'pos-shift-9' };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(ACTIVE) // active shift update found a row
      .mockResolvedValueOnce({ ...ACTIVE, status: 'completed', cash_at_close: '1500.00' }) // cached totals refresh
      .mockResolvedValueOnce({
        hours_worked: '10', pos_count: '0', pos_total: '0',
        commission_total: '0', online_count: '0', online_total: '0',
      });
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app)
      .post('/shift-1/check-out')
      .set(authHeader(makeEmployeeUser()))
      .send({ cash_at_close: 1500 });

    expect(res.status).toBe(200);
    expect(closeShift).toHaveBeenCalledTimes(1);
    expect(closeShift).toHaveBeenCalledWith(
      expect.objectContaining({ shift_id: 'pos-shift-9', employee_id: 'employee-id', cash_at_close: 1500 }),
    );
  });

  it('enqueues ATOL shift close when check-out auto-closes the last fiscal POS shift', async () => {
    const ACTIVE = { ...COMPLETED_SHIFT, status: 'active', pos_shift_id: 'pos-shift-9' };
    vi.mocked(isFiscalShiftOpenForShift).mockResolvedValueOnce(true);
    vi.mocked(closeShift).mockResolvedValueOnce({
      shift: {
        id: 'pos-shift-9',
        employee_id: 'employee-id',
        studio_id: STUDIO_ID,
        shift_number: 9,
        opened_at: '2026-03-05T06:00:00.000Z',
        closed_at: '2026-03-05T16:00:00.000Z',
        cash_at_open: 1000,
        cash_at_close: 1500,
        expected_cash: 1500,
        status: 'closed',
        total_sales: 0,
        total_refunds: 0,
        receipt_count: 0,
        cash_collected: 0,
        collection_count: 0,
        notes: null,
        fiscal_enabled: true,
      },
      commissionSummary: null,
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce({ ...ACTIVE, status: 'completed', cash_at_close: '1500.00' })
      .mockResolvedValueOnce({ count: '0' })
      .mockResolvedValueOnce({
        hours_worked: '10', pos_count: '0', pos_total: '0',
        commission_total: '0', online_count: '0', online_total: '0',
      });
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app)
      .post('/shift-1/check-out')
      .set(authHeader(makeEmployeeUser()))
      .send({ cash_at_close: 1500 });

    expect(res.status).toBe(200);
    expect(isFiscalShiftOpenForShift).toHaveBeenCalledWith('pos-shift-9');
    expect(enqueueShiftFiscalCommand).toHaveBeenCalledWith(STUDIO_ID, 'shift_close', 'employee-id');
  });

  it('check-out succeeds even if the POS shift auto-close fails', async () => {
    vi.mocked(closeShift).mockRejectedValueOnce(new Error('Смена не найдена или уже закрыта'));
    const ACTIVE = { ...COMPLETED_SHIFT, status: 'active', pos_shift_id: 'pos-shift-9' };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce({ ...ACTIVE, status: 'completed', cash_at_close: '1500.00' })
      .mockResolvedValueOnce({
        hours_worked: '10', pos_count: '0', pos_total: '0',
        commission_total: '0', online_count: '0', online_total: '0',
      });
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app)
      .post('/shift-1/check-out')
      .set(authHeader(makeEmployeeUser()))
      .send({ cash_at_close: 1500 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(closeShift).toHaveBeenCalledTimes(1);
  });

  it('does not auto-close when the workday has no linked POS shift', async () => {
    const ACTIVE = { ...COMPLETED_SHIFT, status: 'active', pos_shift_id: null };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE)
      .mockResolvedValueOnce(ACTIVE)
      .mockResolvedValueOnce({ ...ACTIVE, status: 'completed', cash_at_close: '1500.00' })
      .mockResolvedValueOnce({
        hours_worked: '10', pos_count: '0', pos_total: '0',
        commission_total: '0', online_count: '0', online_total: '0',
      });
    vi.mocked(mockDb.query).mockResolvedValue([]);

    const res = await request(app)
      .post('/shift-1/check-out')
      .set(authHeader(makeEmployeeUser()))
      .send({ cash_at_close: 1500 });

    expect(res.status).toBe(200);
    expect(closeShift).not.toHaveBeenCalled();
  });
});
