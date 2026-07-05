/**
 * Integration tests for /pos routes.
 *
 * Все маршруты требуют authenticateToken + requirePermission('pos:use').
 * Covers: смены, чеки, клиент-lookup, таймеры, материалы.
 * Failing tests = bugs in production code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  mockDb,
  resetMockDb,
  TEST_JWT_SECRET,
  makeAdminUser,
  makeEmployeeUser,
  makeClientUser,
  authHeader,
} from '../test-utils/index.js';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../database/db.js', () => ({
  default: mockDb,
  pool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
}));

// config.pos.terminalGateEnabled читается гардом /bridge/pay; флаг переключаем
// в тестах через setTerminalGateEnabled (default off — гард не блокирует).
// indoubtResolveEnabled читается /payments/:id/resolve (paid→чек), default off.
// orderFirstEnabled читается /bridge/pay (канонизация/построение snapshot); default
// off — старое поведение ({orderId} либо переданный snapshot как есть).
const posConfig = { terminalGateEnabled: false, reconAlertEnabled: false, indoubtResolveEnabled: false, orphanDetectEnabled: false, orphanPaymentAgeMinutes: 5, orderFirstEnabled: false };
function setTerminalGateEnabled(enabled: boolean): void {
  posConfig.terminalGateEnabled = enabled;
}
function setIndoubtResolveEnabled(enabled: boolean): void {
  posConfig.indoubtResolveEnabled = enabled;
}
function setOrphanDetectEnabled(enabled: boolean): void {
  posConfig.orphanDetectEnabled = enabled;
}
function setOrderFirstEnabled(enabled: boolean): void {
  posConfig.orderFirstEnabled = enabled;
}

vi.mock('../config/index.js', () => ({
  config: {
    jwt: { secret: TEST_JWT_SECRET, expiresIn: '15m', refreshExpiresIn: '30d' },
    bridge: { url: 'http://localhost:5052', posUrl: 'http://localhost:8888' },
    telegram: { botToken: '' },
    pos: posConfig,
  },
}));

vi.mock('../services/token-blacklist.service.js', () => ({
  isTokenBlacklisted: vi.fn().mockResolvedValue(false),
  isUserTokensInvalidated: vi.fn().mockResolvedValue(false),
}));

vi.mock('../services/permission.service.js', () => ({
  permissionService: {
    getUserPermissions: vi.fn().mockResolvedValue([]),
    hasAllPermissions: vi.fn().mockResolvedValue(false),
  },
}));

vi.mock('../workers/pos-fiscal-worker.js', () => ({
  enqueueFiscal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../workers/loyalty-worker.js', () => ({
  enqueueLoyaltyEarn: vi.fn().mockResolvedValue(undefined),
}));

const mockOpenShift = vi.fn();
const mockEnableShiftFiscal = vi.fn();
const mockGetOpenShiftFiscalState = vi.fn();
const mockCloseShift = vi.fn();
const mockGetShifts = vi.fn();
const mockGetCashControl = vi.fn();
const mockGetCurrentShift = vi.fn();
const mockGetShiftReport = vi.fn();
const mockCreateCashWithdrawal = vi.fn();
const mockCreateReceipt = vi.fn();
const mockGetReceiptById = vi.fn();
const mockGetReceipts = vi.fn();
const mockLookupCustomer = vi.fn();
const mockUpdateReceiptFiscal = vi.fn();
const mockInsertPosOrderItems = vi.fn().mockResolvedValue(undefined);
const mockCalculateSubscriptionCoverage = vi.fn();
const mockStartServiceTimer = vi.fn();
const mockStopServiceTimer = vi.fn();
const mockGetActiveTimer = vi.fn();
const mockAddCustomSurcharge = vi.fn();
const mockRecordMaterialUsage = vi.fn();
const mockGetMaterialUsageReport = vi.fn();
const mockGetLowStock = vi.fn();
const mockFindOrphanPayments = vi.fn();
const mockFindOpenShiftIdForStudio = vi.fn();
const mockEnqueueCashDrawerCommand = vi.fn().mockResolvedValue('cash-drawer-tx');
const mockEnqueueCashDrawerCommandSafe = vi.fn();
const mockFindPosAgentId = vi.fn().mockResolvedValue('agent-id');
const mockIsFiscalShiftOpenForShift = vi.fn().mockResolvedValue(true);
const mockReconcileFiscalShiftTransactionFromTelemetry = vi.fn(async (transaction: unknown) => transaction);
const mockGetPosFiscalSettings = vi.fn();
const mockUpsertPosFiscalSettings = vi.fn();

interface MockPaymentLike {
  payment_type?: unknown;
  method?: unknown;
  amount?: unknown;
}

function isMockPaymentLike(value: unknown): value is MockPaymentLike {
  return typeof value === 'object' && value !== null;
}

function mockHasPositiveCashPayment(payments: unknown): boolean {
  if (!Array.isArray(payments)) return false;
  return payments.some(payment => {
    if (!isMockPaymentLike(payment)) return false;
    return (payment.payment_type ?? payment.method) === 'cash' && Number(payment.amount) > 0;
  });
}

vi.mock('../services/pos.service.js', () => ({
  openShift: mockOpenShift,
  enableShiftFiscal: mockEnableShiftFiscal,
  getOpenShiftFiscalState: mockGetOpenShiftFiscalState,
  closeShift: mockCloseShift,
  getShifts: mockGetShifts,
  getCashControl: mockGetCashControl,
  getCurrentShift: mockGetCurrentShift,
  getShiftReport: mockGetShiftReport,
  createCashWithdrawal: mockCreateCashWithdrawal,
  createReceipt: mockCreateReceipt,
  getReceiptById: mockGetReceiptById,
  getReceipts: mockGetReceipts,
  lookupCustomer: mockLookupCustomer,
  updateReceiptFiscal: mockUpdateReceiptFiscal,
  insertPosOrderItems: mockInsertPosOrderItems,
  calculateSubscriptionCoverage: mockCalculateSubscriptionCoverage,
  startServiceTimer: mockStartServiceTimer,
  stopServiceTimer: mockStopServiceTimer,
  getActiveTimer: mockGetActiveTimer,
  addCustomSurcharge: mockAddCustomSurcharge,
  recordMaterialUsage: mockRecordMaterialUsage,
  getMaterialUsageReport: mockGetMaterialUsageReport,
  getLowStock: mockGetLowStock,
  findOrphanPayments: mockFindOrphanPayments,
}));

vi.mock('../services/pos-open-shift.helper.js', () => ({
  findOpenShiftIdForStudio: mockFindOpenShiftIdForStudio,
}));

vi.mock('../services/cash-drawer.service.js', () => ({
  enqueueCashDrawerCommand: mockEnqueueCashDrawerCommand,
  enqueueCashDrawerCommandSafe: mockEnqueueCashDrawerCommandSafe,
  findPosAgentId: mockFindPosAgentId,
  hasPositiveCashPayment: mockHasPositiveCashPayment,
}));

interface MockTerminalGateState {
  blocked: boolean;
  terminalOnline: boolean | null;
  checkedAt: string | null;
  reason: 'fresh_offline' | 'fresh_online' | 'stale' | 'no_telemetry';
}
const mockGetTerminalGateState = vi.fn<() => Promise<MockTerminalGateState>>(async () => ({
  blocked: false,
  terminalOnline: null,
  checkedAt: null,
  reason: 'no_telemetry',
}));

vi.mock('../services/pos-fiscal-shift.service.js', () => ({
  isFiscalShiftOpenForShift: mockIsFiscalShiftOpenForShift,
  reconcileFiscalShiftTransactionFromTelemetry: mockReconcileFiscalShiftTransactionFromTelemetry,
  getTerminalGateState: mockGetTerminalGateState,
}));

// Сверка эквайринга (op59) — мок, реальный op59 на прод-терминал из тестов не слать.
const mockEnqueueShiftReconciliation = vi.fn(async () => ({
  reconciliationId: 'recon-id',
  enqueued: true,
  status: 'pending' as const,
}));

vi.mock('../services/pos-reconciliation.service.js', () => ({
  enqueueShiftReconciliation: mockEnqueueShiftReconciliation,
}));

vi.mock('../services/pos-fiscal-settings.service.js', () => ({
  getPosFiscalSettings: mockGetPosFiscalSettings,
  upsertPosFiscalSettings: mockUpsertPosFiscalSettings,
}));

vi.mock('../services/pricing-engine.service.js', () => ({
  MINIMUM_CHECK_TOTAL: 10,
  MINIMUM_CHECK_WATERFALL_STEP: 'minimum_check',
  calculatePriceWaterfall: vi.fn().mockResolvedValue({
    subtotal: 500,
    total: 500,
    waterfall: [],
    items: [],
    accountDiscount: null,
    subscriberDiscount: null,
    studentDiscount: null,
    loyaltyDiscount: null,
    promoDiscount: null,
    partnerDiscount: null,
  }),
  calculatePrice: vi.fn().mockResolvedValue({
    breakdown: {
      total: 500,
      subtotal: 500,
      base_items: [],
      loyalty_discount: null,
      promo_discount: null,
    },
    validation: { valid: true, errors: [] },
  }),
  getCategories: vi.fn().mockResolvedValue([]),
  minimumCheckSurchargeForTotal: (total: number) => (total > 0 && total < 10 ? 10 - total : 0),
  minimumCheckSurchargeFromWaterfall: () => 0,
}));

// «Супер обработка»: резолв конфигуратора и создание задачи ретуши.
const mockResolveRetouchConfig = vi.fn();
const mockCreateRetouchTaskFromPos = vi.fn().mockResolvedValue({ id: 'task-id', task_number: 1, status: 'open' });

vi.mock('../services/retouch-checklist.service.js', () => ({
  resolveRetouchConfig: mockResolveRetouchConfig,
}));

vi.mock('../services/retouch.service.js', () => ({
  createRetouchTaskFromPos: mockCreateRetouchTaskFromPos,
}));

// ─── SUT import ───────────────────────────────────────────────────────────────

const { default: posRouter } = await import('./pos.routes.js');
const { enqueueFiscal } = await import('../workers/pos-fiscal-worker.js');
const mockEnqueueFiscal = vi.mocked(enqueueFiscal);
const { getCategories, calculatePriceWaterfall } = await import('../services/pricing-engine.service.js');
const mockGetCategories = vi.mocked(getCategories);
const mockCalculatePriceWaterfall = vi.mocked(calculatePriceWaterfall);
const app = createTestApp(posRouter, '/');

// ─── DB fixtures for auth middleware ─────────────────────────────────────────

const DB_ADMIN = {
  id: 'admin-id', email: 'admin@example.com', role: 'admin',
  is_active: true, display_name: 'Admin', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_EMPLOYEE = {
  id: 'employee-id', email: 'emp@example.com', role: 'employee',
  is_active: true, display_name: 'Employee', phone: null,
  force_password_change: false, last_password_change: null,
};
const DB_CLIENT = {
  id: 'client-id', email: 'client@example.com', role: 'client',
  is_active: true, display_name: 'Client', phone: null,
  force_password_change: false, last_password_change: null,
};

const SHIFT_ID = '11111111-1111-4111-8111-111111111111';
const STUDIO_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const WORK_LOG_ID = '44444444-4444-4444-8444-444444444444';
const SHIFT_OPEN_TX_ID = '55555555-5555-4555-8555-555555555555';

// ─── Route fixtures ───────────────────────────────────────────────────────────

const DB_SHIFT = {
  id: SHIFT_ID, employee_id: 'employee-id', studio_id: STUDIO_ID,
  status: 'open', opened_at: new Date().toISOString(), cash_at_open: 0,
};

const DB_RECEIPT = {
  id: RECEIPT_ID, receipt_number: 'REC-001', shift_id: SHIFT_ID,
  employee_id: 'employee-id', studio_id: STUDIO_ID, total: 500,
  subtotal: 500, discount_total: 0, items: [], payments: [],
  is_refund: false, created_at: new Date().toISOString(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POS routes — global auth guard', () => {
  it('returns 401 on any route without auth token', async () => {
    const res = await request(app).post('/shifts/open').send({ studio_id: STUDIO_ID });
    expect(res.status).toBe(401);
  });

  it('returns 403 for client role (no pos:use permission)', async () => {
    const client = makeClientUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_CLIENT); // auth

    const res = await request(app)
      .post('/shifts/open')
      .set(authHeader(client))
      .send({ studio_id: STUDIO_ID });

    expect(res.status).toBe(403);
  });
});

describe('ATOL27F fiscal print settings routes', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('returns fiscal print settings for selected studio', async () => {
    const emp = makeEmployeeUser();
    const settings = {
      studio_id: STUDIO_ID,
      agent_id: null,
      enabled: true,
      receipt_settings: { receipt_copies: 1 },
      slip_settings: { bank_slip_copies: 1 },
      shift_settings: { auto_open_before_card_sbp: true },
      updated_by: null,
      created_at: null,
      updated_at: null,
    };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    mockGetPosFiscalSettings.mockResolvedValueOnce(settings);

    const res = await request(app)
      .get('/fiscal/settings')
      .query({ studio_id: STUDIO_ID })
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.settings).toEqual(settings);
    expect(mockGetPosFiscalSettings).toHaveBeenCalledWith(STUDIO_ID);
  });

  it('updates fiscal print settings for selected studio', async () => {
    const emp = makeEmployeeUser();
    const settings = {
      studio_id: STUDIO_ID,
      agent_id: null,
      enabled: true,
      receipt_settings: { receipt_copies: 2 },
      slip_settings: { bank_slip_copies: 2 },
      shift_settings: { auto_open_before_card_sbp: true },
      updated_by: emp.id,
      created_at: '2026-05-21T09:00:00.000Z',
      updated_at: '2026-05-21T09:00:00.000Z',
    };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE);
    mockUpsertPosFiscalSettings.mockResolvedValueOnce(settings);

    const res = await request(app)
      .put('/fiscal/settings')
      .set(authHeader(emp))
      .send({
        studio_id: STUDIO_ID,
        receipt_settings: { receipt_copies: 2 },
        slip_settings: { bank_slip_copies: 2 },
        shift_settings: { auto_open_before_card_sbp: true },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.settings).toEqual(settings);
    expect(mockUpsertPosFiscalSettings).toHaveBeenCalledWith(STUDIO_ID, expect.objectContaining({
      receipt_settings: expect.objectContaining({ receipt_copies: 2 }),
      slip_settings: expect.objectContaining({ bank_slip_copies: 2 }),
    }), emp.id);
  });
});

// ─── Shifts ───────────────────────────────────────────────────────────────────

describe('GET /shifts', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('lists POS shifts for the current employee by default', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetShifts.mockResolvedValueOnce({ items: [DB_SHIFT], total: 1 });

    const res = await request(app)
      .get('/shifts')
      .query({ studio_id: STUDIO_ID, limit: 30 })
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.items).toEqual([DB_SHIFT]);
    expect(mockGetShifts).toHaveBeenCalledWith({
      studio_id: STUDIO_ID,
      employee_id: emp.id,
      limit: 30,
    });
  });
});

describe('GET /cash-control', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  const CASH_CONTROL_RESULT = {
    shifts: [
      {
        id: SHIFT_ID, shift_number: 48, employee_id: 'employee-id',
        employee_name: 'Яковлева Ольга', studio_id: STUDIO_ID, studio_name: 'Соборный',
        opened_at: new Date().toISOString(), closed_at: new Date().toISOString(),
        status: 'closed', cash_at_open: 9090, cash_sales: 3608, withdrawals: 310,
        expected_cash: 12388, cash_at_close: 11963, diff: -425, reconciled: true,
      },
    ],
    orphan_cash: { count: 22, sum: 4048, by_day: [], by_employee: [] },
  };

  it('returns cash control data for reports:view user (admin)', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    mockGetCashControl.mockResolvedValueOnce(CASH_CONTROL_RESULT);

    const res = await request(app)
      .get('/cash-control')
      .query({ studio_id: STUDIO_ID, date_from: '2026-06-08', date_to: '2026-06-14' })
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.shifts).toEqual(CASH_CONTROL_RESULT.shifts);
    expect(res.body.orphan_cash).toEqual(CASH_CONTROL_RESULT.orphan_cash);
    expect(mockGetCashControl).toHaveBeenCalledWith({
      studio_id: STUDIO_ID,
      date_from: '2026-06-08',
      date_to: '2026-06-14',
    });
  });

  it('returns 403 for employee without reports:view (has pos:use only)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .get('/cash-control')
      .set(authHeader(emp));

    expect(res.status).toBe(403);
    expect(mockGetCashControl).not.toHaveBeenCalled();
  });

  it('passes no filters when query params are absent', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    mockGetCashControl.mockResolvedValueOnce({ shifts: [], orphan_cash: { count: 0, sum: 0, by_day: [], by_employee: [] } });

    const res = await request(app)
      .get('/cash-control')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(mockGetCashControl).toHaveBeenCalledWith({});
  });
});

describe('POST /shifts/open', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('returns 400 if studio_id missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/shifts/open')
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 if cash_at_open missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/shifts/open')
      .set(authHeader(emp))
      .send({ studio_id: STUDIO_ID });

    expect(res.status).toBe(400);
  });

  it('opens shift and returns 201', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: 'agent-id' }) // fiscal agent lookup
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID }); // shift_open transaction
    mockOpenShift.mockResolvedValueOnce({
      posShift: { ...DB_SHIFT, fiscal_enabled: false },
      employeeShiftId: 'employee-shift-1',
    });

    const res = await request(app)
      .post('/shifts/open')
      .set(authHeader(emp))
      .send({ studio_id: STUDIO_ID, cash_at_open: 500 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.shift).toHaveProperty('id');
    expect(res.body.shift.fiscal_enabled).toBe(false);
    expect(res.body.fiscalTransactionId).toBe(SHIFT_OPEN_TX_ID);
  });
});

describe('POST /shifts/:id/fiscal/open', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('enables fiscal registrar for an existing open shift and enqueues shift_open', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: 'agent-id' }) // fiscal agent lookup
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID }); // shift_open transaction
    mockEnableShiftFiscal.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, fiscal_enabled: false },
      fiscalEnabledChanged: true,
    });

    const res = await request(app)
      .post(`/shifts/${SHIFT_ID}/fiscal/open`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fiscalCommandEnqueued).toBe(true);
    expect(res.body.fiscalTransactionId).toBe(SHIFT_OPEN_TX_ID);
    expect(mockEnableShiftFiscal).toHaveBeenCalledWith({
      shift_id: SHIFT_ID,
      employee_id: emp.id,
    });
    expect(mockDb.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [STUDIO_ID, 'agent-id', 'shift_open', emp.id],
    );
  });

  it('does not enqueue duplicate shift_open when fiscal registrar is already enabled', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockEnableShiftFiscal.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, fiscal_enabled: true },
      fiscalEnabledChanged: false,
    });

    const res = await request(app)
      .post(`/shifts/${SHIFT_ID}/fiscal/open`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fiscalCommandEnqueued).toBe(false);
    expect(mockDb.queryOne).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      expect.anything(),
    );
  });
});

describe('POST /shifts/:id/fiscal/close', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('queues shift_close when ATOL reports an open fiscal shift', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: 'agent-id' }) // fiscal agent lookup
      .mockResolvedValueOnce({ id: 'shift-close-tx' }); // shift_close transaction
    mockGetOpenShiftFiscalState.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, fiscal_enabled: true },
      fiscalShiftOpen: true,
    });

    const res = await request(app)
      .post(`/shifts/${SHIFT_ID}/fiscal/close`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fiscalCommandEnqueued).toBe(true);
    expect(res.body.fiscalTransactionId).toBe('shift-close-tx');
    expect(mockGetOpenShiftFiscalState).toHaveBeenCalledWith({
      shift_id: SHIFT_ID,
      employee_id: emp.id,
    });
    expect(mockDb.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [STUDIO_ID, 'agent-id', 'shift_close', emp.id],
    );
  });

  it('does not queue shift_close when fiscal shift is already closed', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetOpenShiftFiscalState.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, fiscal_enabled: false },
      fiscalShiftOpen: false,
    });

    const res = await request(app)
      .post(`/shifts/${SHIFT_ID}/fiscal/close`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.fiscalCommandEnqueued).toBe(false);
    expect(mockDb.queryOne).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      expect.anything(),
    );
  });
});

describe('POST /shifts/close', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('returns 400 if cash_at_close missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/shifts/close')
      .set(authHeader(emp))
      .send({ shift_id: SHIFT_ID }); // missing cash_at_close

    expect(res.status).toBe(400);
  });

  it('closes shift and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCloseShift.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, status: 'closed', cash_at_close: 1000 },
      commissionSummary: null,
    });

    const res = await request(app)
      .post('/shifts/close')
      .set(authHeader(emp))
      .send({ shift_id: SHIFT_ID, cash_at_close: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('sends shift_close when ATOL reports an open fiscal shift even if the POS row was not marked fiscal', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ count: '0' }) // no other open POS shifts
      .mockResolvedValueOnce({ id: 'agent-id' }) // fiscal agent lookup
      .mockResolvedValueOnce({ id: 'shift-close-tx' }); // shift_close transaction
    mockIsFiscalShiftOpenForShift.mockResolvedValueOnce(true);
    mockCloseShift.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, status: 'closed', cash_at_close: 1000, fiscal_enabled: false },
      commissionSummary: null,
    });

    const res = await request(app)
      .post('/shifts/close')
      .set(authHeader(emp))
      .send({ shift_id: SHIFT_ID, cash_at_close: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.zReportSent).toBe(true);
    expect(mockIsFiscalShiftOpenForShift).toHaveBeenCalledWith(SHIFT_ID);
    expect(mockDb.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [STUDIO_ID, 'agent-id', 'shift_close', emp.id],
    );
  });
});

describe('GET /shifts/current', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('returns current shift for employee', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetCurrentShift.mockResolvedValueOnce(DB_SHIFT);

    const res = await request(app)
      .get('/shifts/current')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('non-admin cannot view another employee shift', async () => {
    const emp = makeEmployeeUser({ id: 'emp-1' });
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .get('/shifts/current?employee_id=other-emp')
      .set(authHeader(emp));

    expect(res.status).toBe(403);
  });

  it('admin can view any employee shift', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    mockGetCurrentShift.mockResolvedValueOnce(DB_SHIFT);

    const res = await request(app)
      .get('/shifts/current?employee_id=other-emp')
      .set(authHeader(admin));

    expect(res.status).toBe(200);
  });
});

describe('GET /shifts/:id/report', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns shift report', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetShiftReport.mockResolvedValueOnce({ shift: DB_SHIFT, receipts: [] });

    const res = await request(app)
      .get(`/shifts/${SHIFT_ID}/report`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /shifts/:id/cash-withdrawals', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('creates a cash withdrawal for current employee shift', async () => {
    const emp = makeEmployeeUser();
    const movement = {
      id: 'cash-movement-1',
      shift_id: SHIFT_ID,
      studio_id: STUDIO_ID,
      employee_id: emp.id,
      movement_type: 'withdrawal',
      amount: 300,
      reason: 'Курьеру за воду',
      created_at: new Date().toISOString(),
    };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCreateCashWithdrawal.mockResolvedValueOnce(movement);

    const res = await request(app)
      .post(`/shifts/${SHIFT_ID}/cash-withdrawals`)
      .set(authHeader(emp))
      .send({ amount: 300, reason: 'Курьеру за воду' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockCreateCashWithdrawal).toHaveBeenCalledWith({
      shift_id: SHIFT_ID,
      employee_id: emp.id,
      amount: 300,
      reason: 'Курьеру за воду',
    });
    expect(mockEnqueueCashDrawerCommandSafe).toHaveBeenCalledWith({
      studioId: STUDIO_ID,
      initiatedBy: emp.id,
      source: 'pos.cash-withdrawal',
    });
  });
});

// ─── Receipts ─────────────────────────────────────────────────────────────────

describe('POST /receipts', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('returns 400 if items/payments/total missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({ items: [] });

    expect(res.status).toBe(400);
  });

  it('creates receipt and returns 201', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCreateReceipt.mockResolvedValueOnce(DB_RECEIPT);

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ method: 'cash', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.receipt).toHaveProperty('id');
  });

  it('rejects card receipts without a fiscal shift', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'card', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('rejects SBP receipts without a fiscal shift', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'sbp', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('rejects fiscal-required cash receipts without a fiscal shift', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        fiscal_required: true,
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'cash', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('rejects card receipts on a non-fiscal shift', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockIsFiscalShiftOpenForShift.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        shift_id: SHIFT_ID,
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'card', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('rejects fiscal-required cash receipts on a non-fiscal shift', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockIsFiscalShiftOpenForShift.mockResolvedValueOnce(false);

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        fiscal_required: true,
        shift_id: SHIFT_ID,
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'cash', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('creates card receipt on a fiscal shift and queues fiscalization', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCreateReceipt.mockResolvedValueOnce({
      ...DB_RECEIPT,
      payments: [{ payment_type: 'card', amount: 500 }],
    });

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        shift_id: SHIFT_ID,
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'card', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(201);
    expect(mockEnqueueFiscal).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: RECEIPT_ID,
      operation: 'sale',
    }));
  });

  it('creates fiscal-required cash receipt on a fiscal shift and queues fiscalization', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCreateReceipt.mockResolvedValueOnce({
      ...DB_RECEIPT,
      payments: [{ payment_type: 'cash', amount: 500 }],
    });

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        fiscal_required: true,
        shift_id: SHIFT_ID,
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'cash', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(201);
    expect(mockEnqueueFiscal).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: RECEIPT_ID,
      operation: 'sale',
    }));
  });

  it('queues fiscal-required cash when created receipt omits shift id', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCreateReceipt.mockResolvedValueOnce({
      ...DB_RECEIPT,
      shift_id: null,
      payments: [{ payment_type: 'cash', amount: 500 }],
    });

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        fiscal_required: true,
        shift_id: SHIFT_ID,
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'cash', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(201);
    expect(mockEnqueueFiscal).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: RECEIPT_ID,
      operation: 'sale',
    }));
    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE pos_receipts SET fiscal_status = 'skipped'"),
      [RECEIPT_ID],
    );
  });

  it('creates transfer receipt on a fiscal shift without queueing fiscalization', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCreateReceipt.mockResolvedValueOnce({
      ...DB_RECEIPT,
      payments: [{ payment_type: 'transfer', amount: 500 }],
    });

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        shift_id: SHIFT_ID,
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: 500 }],
        payments: [{ payment_type: 'transfer', amount: 500 }],
        total: 500,
      });

    expect(res.status).toBe(201);
    expect(mockEnqueueFiscal).not.toHaveBeenCalled();
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining(`UPDATE pos_receipts SET fiscal_status = 'skipped'`),
      [RECEIPT_ID],
    );
  });

  it('rejects positive receipt totals below the minimum check', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/receipts')
      .set(authHeader(emp))
      .send({
        studio_id: STUDIO_ID,
        items: [{ product_name: 'Печать', quantity: 1, unit_price: 5, total: 5 }],
        payments: [{ method: 'cash', amount: 5 }],
        total: 5,
      });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });
});

describe('POST /receipts/:id/refund', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('returns 404 if original receipt not found', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetReceiptById.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/receipts/nonexistent/refund')
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(404);
  });

  it('returns 400 if receipt is already a refund', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetReceiptById.mockResolvedValueOnce({ ...DB_RECEIPT, is_refund: true });

    const res = await request(app)
      .post(`/receipts/${RECEIPT_ID}/refund`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(400);
  });

  it('creates refund receipt and returns 201', async () => {
    const emp = makeEmployeeUser();
    const refundReceipt = {
      ...DB_RECEIPT,
      id: 'refund-receipt-id',
      receipt_number: 'REC-REF-001',
      is_refund: true,
      total: -500,
      items: [{ product_name: 'Фото', quantity: 1, unit_price: 500, total: -500 }],
      payments: [{ payment_type: 'cash', amount: -500 }],
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ fiscal_enabled: true });
    mockGetReceiptById.mockResolvedValueOnce(DB_RECEIPT);
    mockCreateReceipt.mockResolvedValueOnce(refundReceipt);

    const res = await request(app)
      .post(`/receipts/${RECEIPT_ID}/refund`)
      .set(authHeader(emp))
      .send({ shift_id: SHIFT_ID });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockEnqueueFiscal).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: 'refund-receipt-id',
      receiptNumber: 'REC-REF-001',
      total: -500,
      operation: 'refund',
    }));
  });

  it('creates full refund for a subscription-paid receipt', async () => {
    const emp = makeEmployeeUser();
    const subscriptionReceipt = {
      ...DB_RECEIPT,
      subscription_id: 'sub-1',
      subscription_credit_used: 300,
      items: [{
        product_id: 'product-1',
        product_name: 'Фото',
        quantity: 3,
        unit_price: 100,
        subscription_credits_used: 300,
        total: 500,
      }],
      payments: [
        { payment_type: 'subscription', amount: 300 },
        { payment_type: 'cash', amount: 200 },
      ],
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ fiscal_enabled: true });
    mockGetReceiptById.mockResolvedValueOnce(subscriptionReceipt);
    mockCreateReceipt.mockResolvedValueOnce({
      ...subscriptionReceipt,
      id: 'subscription-refund-receipt-id',
      receipt_number: 'REC-REF-SUB-001',
      is_refund: true,
      total: -500,
    });

    const res = await request(app)
      .post(`/receipts/${RECEIPT_ID}/refund`)
      .set(authHeader(emp))
      .send({
        shift_id: SHIFT_ID,
        items: [{ product_id: 'ignored-product', total: 1 }],
        payments: [{ payment_type: 'cash', amount: 1 }],
      });

    expect(res.status).toBe(201);
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      subscription_id: 'sub-1',
      total: -500,
      payments: [
        { payment_type: 'subscription', amount: -300 },
        { payment_type: 'cash', amount: -200 },
      ],
      items: [expect.objectContaining({
        product_id: 'product-1',
        total: -500,
        subscription_credits_used: 0,
      })],
    }));
    expect(mockEnqueueFiscal).toHaveBeenCalledWith(expect.objectContaining({
      receiptId: 'subscription-refund-receipt-id',
      receiptNumber: 'REC-REF-SUB-001',
      total: -500,
      operation: 'refund',
    }));
  });
});

describe('GET /receipts/:id', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns 404 if receipt not found', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetReceiptById.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/receipts/nonexistent')
      .set(authHeader(emp));

    expect(res.status).toBe(404);
  });

  it('returns receipt', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetReceiptById.mockResolvedValueOnce(DB_RECEIPT);

    const res = await request(app)
      .get(`/receipts/${RECEIPT_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.receipt).toHaveProperty('id');
  });
});

describe('GET /receipts', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns receipts list', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetReceipts.mockResolvedValueOnce({ receipts: [DB_RECEIPT], total: 1 });

    const res = await request(app)
      .get('/receipts')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Customer lookup ──────────────────────────────────────────────────────────

describe('GET /customer/:phone', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns customer data', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockLookupCustomer.mockResolvedValueOnce({ found: true, name: 'Иван', visits: 3 });

    const res = await request(app)
      .get('/customer/%2B79001234567')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /subscription-coverage', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns server-calculated subscription coverage', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockCalculateSubscriptionCoverage.mockResolvedValueOnce({
      subscription_id: '55555555-5555-4555-8555-555555555555',
      total_covered_amount: 100,
      total_credits_consumed: 1,
      items: [],
    });

    const res = await request(app)
      .post('/subscription-coverage')
      .set(authHeader(emp))
      .send({
        subscription_id: '55555555-5555-4555-8555-555555555555',
        items: [{ product_id: 'prod-1', product_name: 'Фото', quantity: 1, unit_price: 100, total: 100 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.coverage.total_covered_amount).toBe(100);
    expect(mockCalculateSubscriptionCoverage).toHaveBeenCalledOnce();
  });
});

// ─── Fiscal update ────────────────────────────────────────────────────────────

describe('PATCH /receipts/:id/fiscal', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('updates fiscal data and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockUpdateReceiptFiscal.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .patch(`/receipts/${RECEIPT_ID}/fiscal`)
      .set(authHeader(emp))
      .send({ receipt_url: 'https://fiscal.url', receipt_number: 'FN001', fiscal_sign: 'sign' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /receipts/:id/fiscal-correction', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('queues a correction receipt for a failed fiscal receipt', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: RECEIPT_ID,
        receipt_number: '4773',
        fiscal_status: 'failed',
        total: 150,
        studio_id: STUDIO_ID,
        payment_method: 'card',
        created_at: '2026-05-24T17:13:00+03:00',
        is_refund: false,
        voided_at: null,
      })
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post(`/receipts/${RECEIPT_ID}/fiscal-correction`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, transactionId: SHIFT_OPEN_TX_ID });
    expect(mockFindPosAgentId).toHaveBeenCalledWith(STUDIO_ID);
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('fiscal_correction'),
      [
        STUDIO_ID,
        'agent-id',
        150,
        RECEIPT_ID,
        'card',
        'employee-id',
        JSON.stringify({
          correction_type: 'self',
          correction_base_date: '24.05.2026',
          correction_base_number: 'ФД 4773',
          correction_base_name: 'Самостоятельная коррекция после ошибки фискализации',
        }),
      ],
    );
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining("fiscal_status = 'queued'"),
      [RECEIPT_ID],
    );
  });
});

describe('POST /receipts/:id/print-copy', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('enqueues a receipt_copy_print transaction without touching fiscal retry', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: RECEIPT_ID,
        receipt_number: 'SF-POS-000804',
        studio_id: STUDIO_ID,
        voided_at: null,
      })
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const { enqueueFiscal } = await import('../workers/pos-fiscal-worker.js');
    vi.mocked(enqueueFiscal).mockClear();

    const res = await request(app)
      .post(`/receipts/${RECEIPT_ID}/print-copy`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, transactionId: SHIFT_OPEN_TX_ID });
    expect(mockFindPosAgentId).toHaveBeenCalledWith(STUDIO_ID);
    expect(vi.mocked(enqueueFiscal)).not.toHaveBeenCalled();
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [
        STUDIO_ID,
        'agent-id',
        RECEIPT_ID,
        'employee-id',
        JSON.stringify({
          command: 'receipt_copy_print',
          source: 'pos.receipt_journal',
          receipt_id: RECEIPT_ID,
          receipt_number: 'SF-POS-000804',
          copy_type: 'customer',
        }),
      ],
    );
  });

  it('rejects voided receipts', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: RECEIPT_ID,
        receipt_number: 'SF-POS-000804',
        studio_id: STUDIO_ID,
        voided_at: '2026-06-25T12:00:00.000Z',
      });

    const res = await request(app)
      .post(`/receipts/${RECEIPT_ID}/print-copy`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(400);
    expect(String(res.body.message ?? res.body.error)).toContain('аннулированного');
    expect(mockFindPosAgentId).not.toHaveBeenCalled();
  });

  it('returns 503 when the POS agent is offline', async () => {
    const emp = makeEmployeeUser();
    mockFindPosAgentId.mockResolvedValueOnce(null);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: RECEIPT_ID,
        receipt_number: 'SF-POS-000804',
        studio_id: STUDIO_ID,
        voided_at: null,
      });

    const res = await request(app)
      .post(`/receipts/${RECEIPT_ID}/print-copy`)
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(503);
  });
});

describe('POST /bridge/pay', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('requires explicit studioId for point-specific terminal routing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: 'order-1' });

    expect(res.status).toBe(400);
    expect(mockFindPosAgentId).not.toHaveBeenCalled();
  });

  it('creates a payment transaction for the explicit studioId', async () => {
    const emp = makeEmployeeUser();
    const orderId = '3e9280fd-fc40-42ab-a523-47ff03410f36';
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId, studioId: STUDIO_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, transactionId: SHIFT_OPEN_TX_ID });
    expect(mockFindPosAgentId).toHaveBeenCalledWith(STUDIO_ID);
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [STUDIO_ID, 'agent-id', 100, orderId, 'employee-id', JSON.stringify({ orderId })],
    );
  });

  it('does not write terminal order ids into the UUID order column', async () => {
    const emp = makeEmployeeUser();
    const orderId = 'POS-1779527023710';
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId, studioId: STUDIO_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, transactionId: SHIFT_OPEN_TX_ID });
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [STUDIO_ID, 'agent-id', 100, null, 'employee-id', JSON.stringify({ orderId })],
    );
  });

  it('пишет снимок корзины в command_payload, когда фронт прислал snapshot', async () => {
    const emp = makeEmployeeUser();
    const orderId = '3e9280fd-fc40-42ab-a523-47ff03410f36';
    const snapshot = {
      items: [{ product_name: 'Печать 10×15', quantity: 2, unit_price: 50, total: 100, vat_rate: 'NoVat' }],
      subtotal: 100,
      total: 100,
      shiftId: SHIFT_ID,
    };
    // ожидаемый command_payload: zod-схема receiptItem дефолтит discount-поля и
    // сохраняет порядок ключей схемы (discount_* перед total/vat_rate).
    const expectedPayload = JSON.stringify({
      orderId,
      snapshot: {
        items: [{
          product_name: 'Печать 10×15', quantity: 2, unit_price: 50,
          discount_amount: 0, discount_percent: 0, points_used: 0, subscription_credits_used: 0,
          total: 100, vat_rate: 'NoVat',
        }],
        subtotal: 100,
        total: 100,
        shiftId: SHIFT_ID,
      },
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId, studioId: STUDIO_ID, snapshot });

    expect(res.status).toBe(200);
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO pos_transactions'),
      [STUDIO_ID, 'agent-id', 100, orderId, 'employee-id', expectedPayload],
    );
  });
});

// ─── /bridge/pay — order-first (POS_ORDER_FIRST_ENABLED) ──────────────────────
describe('POST /bridge/pay — order-first персистенция состава', () => {
  const ORDER_ID = '3e9280fd-fc40-42ab-a523-47ff03410f36';

  // Категория услуг для pricing-ветки order-first (и зеркального from-pricing).
  const FROM_PRICING_CATEGORY = {
    slug: 'portrait',
    name: 'Портретная съёмка',
    optionGroups: [
      {
        slug: 'shoot',
        options: [{ slug: 'portrait-basic', id: 'opt-portrait', product_id: 'prod-portrait' }],
      },
    ],
  };

  function portraitWaterfall(price: number) {
    return {
      subtotal: price,
      total: price,
      savings: 0,
      waterfall: [],
      items: [{
        serviceOptionId: 'opt-portrait',
        slug: 'portrait-basic',
        name: 'Портретная съёмка',
        quantity: 1,
        unitPrice: price,
        basePrice: price,
        finalPrice: price,
        discountApplied: 'none',
        discountAmount: 0,
        discountLabel: null,
        studentDiscountBenefit: null,
        studentDiscountUnits: 0,
      }],
      isReturning: false,
      priceAdjustments: [],
      accountDiscount: null,
      subscriberDiscount: null,
      studentDiscount: null,
      loyaltyDiscount: null,
      promoDiscount: null,
      educationVolumeConsumed: null,
    };
  }

  interface SnapshotItemShape {
    product_id?: string | null;
    product_name: string;
    quantity: number;
    unit_price: number;
    total: number;
    [key: string]: unknown;
  }
  interface InsertedSnapshotShape {
    items: SnapshotItemShape[];
    subtotal: number;
    total: number;
    discount_total?: number;
    studioId?: string;
    source?: string;
    customerName?: string;
    [key: string]: unknown;
  }
  interface InsertedPayloadShape {
    orderId: string;
    snapshot?: InsertedSnapshotShape;
  }

  /** Парсит command_payload (6-й аргумент INSERT) из последнего INSERT-вызова queryOne. */
  function lastInsertedPayload(): InsertedPayloadShape {
    const calls = vi.mocked(mockDb.queryOne).mock.calls;
    const insertCall = [...calls].reverse().find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO pos_transactions'),
    );
    if (!insertCall) throw new Error('INSERT pos_transactions не найден');
    const raw = insertCall[1]?.[5];
    if (typeof raw !== 'string') throw new Error('command_payload не строка');
    return JSON.parse(raw);
  }

  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); setOrderFirstEnabled(false); });
  afterEach(() => { setOrderFirstEnabled(false); });

  it('флаг OFF: snapshot пишется как прислал фронт, без канонизации (обратная совместимость)', async () => {
    const emp = makeEmployeeUser();
    // unit_price*quantity намеренно НЕ равно total и subtotal — при OFF не пересчитываем.
    const snapshot = {
      items: [{ product_name: 'Печать 10×15', quantity: 2, unit_price: 50, total: 999, vat_rate: 'NoVat' }],
      subtotal: 1, total: 1,
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: ORDER_ID, studioId: STUDIO_ID, snapshot });

    expect(res.status).toBe(200);
    const payload = lastInsertedPayload();
    // total/subtotal сохранены как прислал фронт; studioId/source не добавлены.
    expect(payload.snapshot).toMatchObject({ subtotal: 1, total: 1 });
    expect(payload.snapshot!['items']).toEqual([
      expect.objectContaining({ total: 999 }),
    ]);
    expect(payload.snapshot!['studioId']).toBeUndefined();
    expect(payload.snapshot!['source']).toBeUndefined();
  });

  it('флаг OFF: без snapshot/pricing пишется только {orderId}', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: ORDER_ID, studioId: STUDIO_ID });

    expect(res.status).toBe(200);
    expect(lastInsertedPayload()).toEqual({ orderId: ORDER_ID });
  });

  it('флаг ON, прямая корзина: per-item total и subtotal пересчитаны сервером (фронту не верим)', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    // Фронт прислал заведомо неверные total/subtotal — сервер обязан пересчитать.
    const snapshot = {
      items: [
        { product_name: 'Печать 10×15', quantity: 3, unit_price: 50, total: 1, vat_rate: 'NoVat' },
        { product_name: 'Магнит', quantity: 2, unit_price: 100, total: 7, vat_rate: 'NoVat' },
      ],
      subtotal: 8,
      total: 8,
      discount_total: 30,
      customerName: 'Анастасия',
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 320, orderId: ORDER_ID, studioId: STUDIO_ID, snapshot });

    expect(res.status).toBe(200);
    const snap = lastInsertedPayload().snapshot!;
    expect(snap.items[0].total).toBe(150); // 3*50
    expect(snap.items[1].total).toBe(200); // 2*100
    expect(snap.subtotal).toBe(350); // 150+200
    expect(snap.total).toBe(320); // 350 − discount 30
    expect(snap.studioId).toBe(STUDIO_ID);
    expect(snap.source).toBe('cart');
    expect(snap.customerName).toBe('Анастасия');
  });

  it('флаг ON, прямая корзина с отрицательной ценой → 400 (zod, anti-tamper 54-ФЗ)', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    const snapshot = {
      items: [{ product_name: 'Скидка-хак', quantity: 1, unit_price: -100, total: -100, vat_rate: 'NoVat' }],
      subtotal: -100,
      total: -100,
    };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: ORDER_ID, studioId: STUDIO_ID, snapshot });

    expect(res.status).toBe(400);
    expect(mockFindPosAgentId).not.toHaveBeenCalled();
  });

  it('флаг ON, услуги: pricing → snapshot строится сервером из waterfall', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(portraitWaterfall(2100) as never);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({
        amount: 2100,
        orderId: ORDER_ID,
        studioId: STUDIO_ID,
        pricing: {
          category_slug: 'portrait',
          selected_options: [{ slug: 'portrait-basic', quantity: 1 }],
        },
      });

    expect(res.status).toBe(200);
    const snap = lastInsertedPayload().snapshot!;
    expect(snap.source).toBe('from_pricing');
    expect(snap.studioId).toBe(STUDIO_ID);
    expect(snap.total).toBe(2100);
    expect(snap.subtotal).toBe(2100);
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).toMatchObject({
      product_id: 'prod-portrait',
      product_name: 'Портретная съёмка',
      quantity: 1,
      unit_price: 2100,
      total: 2100,
    });
  });

  it('флаг ON: /bridge/pay (pricing) и /receipts/from-pricing дают идентичный состав (анти-расхождение R1)', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    const selectedOptions = [{ slug: 'portrait-basic', quantity: 1 }];

    // 1) /bridge/pay pricing-ветка
    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(portraitWaterfall(2100) as never);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({
        amount: 2100, orderId: ORDER_ID, studioId: STUDIO_ID,
        pricing: { category_slug: 'portrait', selected_options: selectedOptions },
      });
    const bridgeItems = lastInsertedPayload().snapshot!.items;

    // 2) /receipts/from-pricing happy-path — состав уходит в createReceipt (без сброса
    // глобальных моков: ФР-смена открыта, agent доступен по умолчанию).
    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(portraitWaterfall(2100) as never);
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 2100 });
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const fpRes = await request(app)
      .post('/receipts/from-pricing')
      .set(authHeader(emp))
      .send({
        category_slug: 'portrait',
        selected_options: selectedOptions,
        delivery_method: 'pickup',
        studio_id: STUDIO_ID,
        // cash — состав не зависит от способа оплаты (isSubscriptionPayment=false
        // в обоих путях), а cash не требует открытой ФР-смены в этом тесте.
        payments: [{ method: 'cash', amount: 2100 }],
      });

    expect(fpRes.status).toBe(201);
    const receiptItems: SnapshotItemShape[] = mockCreateReceipt.mock.calls[0][0].items;
    // Состав (product_id, имя, кол-во, цена, total) обязан совпадать — один хелпер.
    expect(bridgeItems).toHaveLength(receiptItems.length);
    expect(bridgeItems[0]).toMatchObject({
      product_id: receiptItems[0].product_id,
      product_name: receiptItems[0].product_name,
      quantity: receiptItems[0].quantity,
      unit_price: receiptItems[0].unit_price,
      total: receiptItems[0].total,
    });
  });

  it('/receipts/from-pricing forwards print_order_id to createReceipt for CRM order linkage', async () => {
    const emp = makeEmployeeUser();
    const printOrderId = '550e8400-e29b-41d4-a716-446655440000';
    const selectedOptions = [{ slug: 'portrait-basic', quantity: 1 }];

    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(portraitWaterfall(2100) as never);
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 2100 });
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/receipts/from-pricing')
      .set(authHeader(emp))
      .send({
        category_slug: 'portrait',
        selected_options: selectedOptions,
        delivery_method: 'pickup',
        studio_id: STUDIO_ID,
        payments: [{ method: 'cash', amount: 2100 }],
        print_order_id: printOrderId,
      });

    expect(res.status).toBe(201);
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      print_order_id: printOrderId,
    }));
  });

  it('флаг ON, скидочная позиция: snapshot.unit_price=эффективная цена → Σ(unit_price*qty)==total (P1: допробитие сходится без 400)', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    // Волюм-скидка: базовая 1000×2=2000, но finalPrice=1500 (эффективная 750/шт).
    // Базовая цена в snapshot завысила бы Σ при допробитии (2000≠1500) → fail-safe.
    const discountedWaterfall = {
      subtotal: 1500,
      total: 1500,
      savings: 500,
      waterfall: [],
      items: [{
        serviceOptionId: 'opt-portrait',
        slug: 'portrait-basic',
        name: 'Портретная съёмка',
        quantity: 2,
        unitPrice: 1000,
        basePrice: 1000,
        finalPrice: 1500,
        discountApplied: 'volume',
        discountAmount: 500,
        discountLabel: 'Объёмная скидка',
        studentDiscountBenefit: null,
        studentDiscountUnits: 0,
      }],
      isReturning: false,
      priceAdjustments: [],
      accountDiscount: null,
      subscriberDiscount: null,
      studentDiscount: null,
      loyaltyDiscount: null,
      promoDiscount: null,
      educationVolumeConsumed: null,
    };
    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(discountedWaterfall as never);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({
        amount: 1500,
        orderId: ORDER_ID,
        studioId: STUDIO_ID,
        pricing: { category_slug: 'portrait', selected_options: [{ slug: 'portrait-basic', quantity: 2 }] },
      });

    expect(res.status).toBe(200);
    const snap = lastInsertedPayload().snapshot!;
    expect(snap.items[0].unit_price).toBe(750); // 1500/2 — эффективная, не базовая 1000
    expect(snap.items[0].total).toBe(1500);
    expect(snap.items[0].discount_amount).toBe(0); // скидка уже в цене, не дублируем
    // КЛЮЧЕВОЕ (P1/P2-1): раскладка как её пересчитает buildResolveReceiptItems сходится с amount.
    const recomputed = snap.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    expect(recomputed).toBe(1500);
    expect(recomputed).toBe(snap.total);
  });

  it('флаг ON, account-discount: pricing snapshot распределяет скидку в строки чека', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    const accountWaterfall = {
      subtotal: 40,
      total: 20,
      savings: 20,
      waterfall: [],
      items: [{
        serviceOptionId: 'opt-portrait',
        slug: 'portrait-basic',
        name: 'Портретная съёмка',
        quantity: 4,
        unitPrice: 10,
        basePrice: 10,
        finalPrice: 40,
        discountApplied: 'none',
        discountAmount: 0,
        discountLabel: null,
        studentDiscountBenefit: null,
        studentDiscountUnits: 0,
      }],
      isReturning: false,
      priceAdjustments: [],
      accountDiscount: {
        accountType: 'education',
        label: 'Студенческий доступ',
        source: 'education_verification',
        percent: 50,
        amount: 20,
        lines: [{
          serviceOptionId: 'opt-portrait',
          name: 'Портретная съёмка',
          kind: 'document_print',
          label: 'Студенческий доступ',
          percent: 50,
          amount: 20,
          quantity: 4,
        }],
      },
      subscriberDiscount: null,
      studentDiscount: null,
      loyaltyDiscount: null,
      promoDiscount: null,
      educationVolumeConsumed: null,
    };
    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(accountWaterfall as never);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({
        amount: 20,
        orderId: ORDER_ID,
        studioId: STUDIO_ID,
        pricing: { category_slug: 'portrait', selected_options: [{ slug: 'portrait-basic', quantity: 4 }] },
      });

    expect(res.status).toBe(200);
    const snap = lastInsertedPayload().snapshot!;
    expect(snap.total).toBe(20);
    expect(snap.items[0]).toMatchObject({
      product_name: 'Портретная съёмка',
      quantity: 4,
      unit_price: 5,
      total: 20,
    });
    const recomputed = snap.items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0);
    expect(recomputed).toBe(snap.total);
  });

  it('флаг ON, pricing: selected_options с option_slug (как шлёт фронт) нормализуются zod-transform (P1-B)', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(portraitWaterfall(2100) as never);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({
        amount: 2100,
        orderId: ORDER_ID,
        studioId: STUDIO_ID,
        // фронт присылает option_slug (а не slug) — zod-transform обязан нормализовать,
        // иначе buildPricingReceiptItems не найдёт позицию и упадёт «Опция не найдена».
        pricing: { category_slug: 'portrait', selected_options: [{ option_slug: 'portrait-basic', quantity: 1 }] },
      });

    expect(res.status).toBe(200);
    const snap = lastInsertedPayload().snapshot!;
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]).toMatchObject({ product_name: 'Портретная съёмка', total: 2100 });
  });

  it('флаг ON, pricing с shift_id: shiftId переносится в snapshot (симметрия с cart, nit-4)', async () => {
    setOrderFirstEnabled(true);
    const emp = makeEmployeeUser();
    mockGetCategories.mockResolvedValueOnce([FROM_PRICING_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(portraitWaterfall(2100) as never);
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID });

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({
        amount: 2100,
        orderId: ORDER_ID,
        studioId: STUDIO_ID,
        pricing: { category_slug: 'portrait', selected_options: [{ slug: 'portrait-basic', quantity: 1 }], shift_id: SHIFT_ID },
      });

    expect(res.status).toBe(200);
    expect(lastInsertedPayload().snapshot!['shiftId']).toBe(SHIFT_ID);
  });
});

describe('POST /bridge/refund', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('queues a refund for a completed terminal payment using the original RRN', async () => {
    const emp = makeEmployeeUser();
    const paymentTransactionId = '66666666-6666-4666-8666-666666666666';
    const refundTransactionId = '77777777-7777-4777-8777-777777777777';
    const orderId = '3e9280fd-fc40-42ab-a523-47ff03410f36';
    const originalPayment = {
      id: paymentTransactionId,
      studio_id: STUDIO_ID,
      amount: 450,
      order_id: orderId,
      rrn: '123456789012',
      status: 'completed',
      transaction_type: 'payment',
    };

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(originalPayment)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: refundTransactionId });

    const res = await request(app)
      .post('/bridge/refund')
      .set(authHeader(emp))
      .send({ studioId: STUDIO_ID, transactionId: paymentTransactionId });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, transactionId: refundTransactionId });
    expect(mockFindPosAgentId).toHaveBeenCalledWith(STUDIO_ID);
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining("VALUES ($1, $2, 'refund'"),
      [
        STUDIO_ID,
        'agent-id',
        originalPayment.amount,
        orderId,
        'employee-id',
        JSON.stringify({
          original_transaction_id: paymentTransactionId,
          original_rrn: '123456789012',
          source: 'card_fiscal_failure',
        }),
      ],
    );
  });

  it('does not queue a refund when the original payment has no RRN', async () => {
    const emp = makeEmployeeUser();
    const paymentTransactionId = '66666666-6666-4666-8666-666666666666';

    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: paymentTransactionId,
        studio_id: STUDIO_ID,
        amount: 450,
        order_id: null,
        rrn: null,
        status: 'completed',
        transaction_type: 'payment',
      });

    const res = await request(app)
      .post('/bridge/refund')
      .set(authHeader(emp))
      .send({ studioId: STUDIO_ID, transactionId: paymentTransactionId });

    expect(res.status).toBe(400);
    expect(mockFindPosAgentId).not.toHaveBeenCalled();
  });
});

describe('GET /bridge/transactions/:id', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('returns transaction status for polling ATOL command result', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: SHIFT_OPEN_TX_ID,
        studio_id: STUDIO_ID,
        status: 'completed',
        transaction_type: 'shift_open',
        error_message: null,
        terminal_response: null,
      });

    const res = await request(app)
      .get(`/bridge/transactions/${SHIFT_OPEN_TX_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.transaction).toEqual({
      id: SHIFT_OPEN_TX_ID,
      status: 'completed',
      transaction_type: 'shift_open',
      error_message: null,
      terminal_response: null,
    });
  });

  it('marks stuck bank settlement transactions as timeout while polling', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: SHIFT_OPEN_TX_ID,
        studio_id: STUDIO_ID,
        status: 'processing',
        transaction_type: 'bank_settlement',
        error_message: null,
        terminal_response: null,
        initiated_at: new Date(Date.now() - 120_000).toISOString(),
      })
      .mockResolvedValueOnce({
        id: SHIFT_OPEN_TX_ID,
        studio_id: STUDIO_ID,
        status: 'timeout',
        transaction_type: 'bank_settlement',
        error_message: 'Не получен ответ от терминала по сверке итогов',
        terminal_response: null,
        initiated_at: new Date(Date.now() - 120_000).toISOString(),
      });

    const res = await request(app)
      .get(`/bridge/transactions/${SHIFT_OPEN_TX_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.transaction).toEqual({
      id: SHIFT_OPEN_TX_ID,
      status: 'timeout',
      transaction_type: 'bank_settlement',
      error_message: 'Не получен ответ от терминала по сверке итогов',
      terminal_response: null,
    });
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining('UPDATE pos_transactions'),
      [SHIFT_OPEN_TX_ID, 'Не получен ответ от терминала по сверке итогов', 660],
    );
    expect(mockReconcileFiscalShiftTransactionFromTelemetry).not.toHaveBeenCalled();
  });

  it('returns 404 when transaction is missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(null);

    const res = await request(app)
      .get(`/bridge/transactions/${SHIFT_OPEN_TX_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(404);
  });
});

// ─── S2: in_doubt оплата, гард терминала, новые роуты ──────────────────────────

const PAYMENT_TX_ID = '88888888-8888-4888-8888-888888888888';

describe('GET /bridge/transactions/:id — оплата картой (контур #1)', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); setTerminalGateEnabled(false); });

  it('помечает failed-оплату с маркером обрыва как in_doubt и отдаёт эффективный статус', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ // SELECT транзакции
        id: PAYMENT_TX_ID,
        studio_id: STUDIO_ID,
        status: 'failed',
        payment_resolution: null,
        transaction_type: 'payment',
        error_message: 'Connection error: localhost:9015',
        terminal_response: null,
        initiated_at: new Date(Date.now() - 5_000).toISOString(),
      })
      .mockResolvedValueOnce({ error_message: 'Connection error: localhost:9015', rrn: null }) // SELECT error_message,rrn
      .mockResolvedValueOnce({ payment_resolution: 'in_doubt' }); // UPDATE payment_resolution

    const res = await request(app)
      .get(`/bridge/transactions/${PAYMENT_TX_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('in_doubt');
    // UPDATE пишет ТОЛЬКО payment_resolution, status не трогает.
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining("payment_resolution = 'in_doubt'"),
      [PAYMENT_TX_ID],
    );
  });

  it('оставляет failed-оплату с RRN как failed (банк ответил отказом)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: PAYMENT_TX_ID,
        studio_id: STUDIO_ID,
        status: 'failed',
        payment_resolution: null,
        transaction_type: 'payment',
        error_message: 'Недостаточно средств',
        terminal_response: null,
        initiated_at: new Date(Date.now() - 5_000).toISOString(),
      })
      .mockResolvedValueOnce({ error_message: 'Недостаточно средств', rrn: '123456789012' }); // классификатор → failed, UPDATE не зовём

    const res = await request(app)
      .get(`/bridge/transactions/${PAYMENT_TX_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('failed');
    // UPDATE payment_resolution НЕ выполнялся.
    expect(mockDb.queryOne).not.toHaveBeenCalledWith(
      expect.stringContaining("payment_resolution = 'in_doubt'"),
      expect.anything(),
    );
  });

  it('помечает зависший pending старше 120с как in_doubt (P1-2)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: PAYMENT_TX_ID,
        studio_id: STUDIO_ID,
        status: 'pending',
        payment_resolution: null,
        transaction_type: 'payment',
        error_message: null,
        terminal_response: null,
        initiated_at: new Date(Date.now() - 200_000).toISOString(),
      })
      .mockResolvedValueOnce({ payment_resolution: 'in_doubt' }); // UPDATE (guard по возрасту в SQL)

    const res = await request(app)
      .get(`/bridge/transactions/${PAYMENT_TX_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('in_doubt');
    expect(mockDb.queryOne).toHaveBeenLastCalledWith(
      expect.stringContaining("status IN ('pending', 'processing')"),
      [PAYMENT_TX_ID, 120],
    );
  });

  it('не зацикливает polling: уже in_doubt оплата отдаётся как in_doubt без default-ветки', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({
        id: PAYMENT_TX_ID,
        studio_id: STUDIO_ID,
        status: 'pending',
        payment_resolution: 'in_doubt',
        transaction_type: 'payment',
        error_message: null,
        terminal_response: null,
        initiated_at: new Date(Date.now() - 5_000).toISOString(),
      })
      .mockResolvedValueOnce(null); // UPDATE по pending guard — строка уже не NULL, ничего не вернёт

    const res = await request(app)
      .get(`/bridge/transactions/${PAYMENT_TX_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.transaction.status).toBe('in_doubt');
  });
});

describe('POST /bridge/pay — гард офлайна терминала (контур #3)', () => {
  // Используем mockResolvedValue (persistent), чтобы незатребованные once-значения
  // не «протекали» между тестами через clearAllMocks (он не чистит очередь once).
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
    setTerminalGateEnabled(false);
    mockGetTerminalGateState.mockResolvedValue({
      blocked: false, terminalOnline: null, checkedAt: null, reason: 'no_telemetry',
    });
  });

  it('флаг выключен: оплата проходит даже при свежем terminal_online=false', async () => {
    const emp = makeEmployeeUser();
    setTerminalGateEnabled(false);
    mockGetTerminalGateState.mockResolvedValue({
      blocked: true, terminalOnline: false, checkedAt: new Date().toISOString(), reason: 'fresh_offline',
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID }); // INSERT payment

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: 'order-1', studioId: STUDIO_ID });

    expect(res.status).toBe(200);
    // флаг выключен → getTerminalGateState даже не вызывается
    expect(mockGetTerminalGateState).not.toHaveBeenCalled();
  });

  it('флаг включён, свежий offline: 503 POS_TERMINAL_OFFLINE, INSERT не выполняется', async () => {
    const emp = makeEmployeeUser();
    setTerminalGateEnabled(true);
    mockGetTerminalGateState.mockResolvedValue({
      blocked: true, terminalOnline: false, checkedAt: new Date().toISOString(), reason: 'fresh_offline',
    });
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth only

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: 'order-1', studioId: STUDIO_ID });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('POS_TERMINAL_OFFLINE');
    // INSERT pos_transactions не выполнялся (после auth queryOne не вызывался для INSERT)
    expect(mockDb.queryOne).not.toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, 'payment'"),
      expect.anything(),
    );
  });

  it('флаг включён, устаревшая telemetry (stale): оплата проходит (мягкая деградация)', async () => {
    const emp = makeEmployeeUser();
    setTerminalGateEnabled(true);
    mockGetTerminalGateState.mockResolvedValue({
      blocked: false, terminalOnline: null, checkedAt: new Date(Date.now() - 200_000).toISOString(), reason: 'stale',
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID }); // INSERT payment

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: 'order-1', studioId: STUDIO_ID });

    expect(res.status).toBe(200);
  });

  it('флаг включён, нет telemetry (null): оплата проходит', async () => {
    const emp = makeEmployeeUser();
    setTerminalGateEnabled(true);
    mockGetTerminalGateState.mockResolvedValue({
      blocked: false, terminalOnline: null, checkedAt: null, reason: 'no_telemetry',
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID }); // INSERT payment

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: 'order-1', studioId: STUDIO_ID });

    expect(res.status).toBe(200);
  });

  it('флаг включён, свежий online: оплата проходит', async () => {
    const emp = makeEmployeeUser();
    setTerminalGateEnabled(true);
    mockGetTerminalGateState.mockResolvedValue({
      blocked: false, terminalOnline: true, checkedAt: new Date().toISOString(), reason: 'fresh_online',
    });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_OPEN_TX_ID }); // INSERT payment

    const res = await request(app)
      .post('/bridge/pay')
      .set(authHeader(emp))
      .send({ amount: 100, orderId: 'order-1', studioId: STUDIO_ID });

    expect(res.status).toBe(200);
  });
});

describe('GET /bridge/status — terminalOnline из telemetry (контур #3)', () => {
  const CHECKED_AT = '2026-06-02T12:00:00.000Z';
  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
    mockGetTerminalGateState.mockResolvedValue({
      blocked: false, terminalOnline: true, checkedAt: CHECKED_AT, reason: 'fresh_online',
    });
  });

  it('добавляет terminalOnline и terminalCheckedAt в ответ', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: 'agent-id', is_online: true, last_heartbeat_at: new Date().toISOString() });

    const res = await request(app)
      .get('/bridge/status')
      .query({ studioId: STUDIO_ID })
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.online).toBe(true);
    expect(res.body.terminalOnline).toBe(true);
    expect(res.body.terminalCheckedAt).toBe(CHECKED_AT);
  });
});

describe('POST /shifts/close — fire-and-forget сверка эквайринга (контур #2)', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('инициирует сверку при закрытии последней смены студии', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ count: '0' }); // нет других открытых смен → последняя
    mockIsFiscalShiftOpenForShift.mockResolvedValueOnce(false); // без Z, но сверку всё равно зовём
    mockCloseShift.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, status: 'closed', cash_at_close: 1000 },
      commissionSummary: null,
    });

    const res = await request(app)
      .post('/shifts/close')
      .set(authHeader(emp))
      .send({ shift_id: SHIFT_ID, cash_at_close: 1000 });

    expect(res.status).toBe(200);
    expect(mockEnqueueShiftReconciliation).toHaveBeenCalledWith(SHIFT_ID, STUDIO_ID);
  });

  it('НЕ инициирует сверку, если у студии остались открытые смены', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ count: '2' }); // ещё есть открытые смены
    mockIsFiscalShiftOpenForShift.mockResolvedValueOnce(false);
    mockCloseShift.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, status: 'closed', cash_at_close: 1000 },
      commissionSummary: null,
    });

    const res = await request(app)
      .post('/shifts/close')
      .set(authHeader(emp))
      .send({ shift_id: SHIFT_ID, cash_at_close: 1000 });

    expect(res.status).toBe(200);
    expect(mockEnqueueShiftReconciliation).not.toHaveBeenCalled();
  });

  it('ответ закрытия смены НЕ падает, если сверка упала (fire-and-forget)', async () => {
    const emp = makeEmployeeUser();
    mockEnqueueShiftReconciliation.mockRejectedValueOnce(new Error('op59 boom'));
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ count: '0' });
    mockIsFiscalShiftOpenForShift.mockResolvedValueOnce(false);
    mockCloseShift.mockResolvedValueOnce({
      shift: { ...DB_SHIFT, status: 'closed', cash_at_close: 1000 },
      commissionSummary: null,
    });

    const res = await request(app)
      .post('/shifts/close')
      .set(authHeader(emp))
      .send({ shift_id: SHIFT_ID, cash_at_close: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /payments/in-doubt — детект зависших (контур #4, P0-3 authz)', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('возвращает зависшие оплаты с эффективным статусом и снимком корзины', async () => {
    const emp = makeEmployeeUser();
    const snapshot = {
      items: [{ product_name: 'Печать 10×15', quantity: 2, unit_price: 925, total: 1850, vat_rate: 'NoVat' }],
      subtotal: 1850,
      total: 1850,
      shiftId: SHIFT_ID,
    };
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // ленивая классификация: нет свежих failed+NULL
      .mockResolvedValueOnce([
        {
          id: PAYMENT_TX_ID, studio_id: STUDIO_ID, amount: '1850.00', order_id: null,
          status: 'failed', payment_resolution: 'in_doubt', error_message: 'Connection error',
          rrn: null, initiated_by: 'employee-id', initiated_by_name: 'Employee User',
          initiated_at: new Date().toISOString(),
          command_payload: { orderId: 'order-1', snapshot },
        },
      ]);

    const res = await request(app)
      .get('/payments/in-doubt')
      .query({ studioId: STUDIO_ID })
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    // Контракт фронта PosInDoubtPayment: { items: [{ id, amount, orderId,
    // initiatedAt, status, errorMessage, snapshot }] } (camelCase).
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: PAYMENT_TX_ID,
      status: 'in_doubt',
      amount: 1850,
      orderId: null,
      errorMessage: 'Connection error',
    });
    expect(res.body.items[0].initiatedAt).toBeTruthy();
    // snapshot ({items, subtotal, total}) прокинут для предпросмотра и кнопки «Подтвердить»
    expect(res.body.items[0].snapshot).toMatchObject({ subtotal: 1850, total: 1850 });
    expect(res.body.items[0].snapshot.items).toHaveLength(1);
    // employee → скоуп по initiated_by (canViewAll=false)
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('transaction_type'),
      [STUDIO_ID, 'employee-id', false, 5],
    );
  });

  it('snapshot=null, если у оплаты нет сохранённого снимка корзины (старые оплаты)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // ленивая классификация
      .mockResolvedValueOnce([
        {
          id: PAYMENT_TX_ID, studio_id: STUDIO_ID, amount: '1400.00', order_id: null,
          status: 'failed', payment_resolution: 'in_doubt', error_message: 'Connection error',
          rrn: null, initiated_by: 'employee-id', initiated_by_name: 'Employee User',
          initiated_at: new Date().toISOString(),
          command_payload: { orderId: 'order-1' }, // без snapshot
        },
      ]);

    const res = await request(app)
      .get('/payments/in-doubt')
      .query({ studioId: STUDIO_ID })
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.items[0].snapshot).toBeNull();
  });

  it('admin видит все оплаты студии (canViewAll=true)', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([]) // ленивая классификация
      .mockResolvedValueOnce([]); // список

    const res = await request(app)
      .get('/payments/in-doubt')
      .query({ studioId: STUDIO_ID })
      .set(authHeader(admin));

    expect(res.status).toBe(200);
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.any(String),
      [STUDIO_ID, 'admin-id', true, 5],
    );
  });

  it('ленивая классификация: свежий connection-error (failed+NULL) попадает в список, Error 16 — нет', async () => {
    const emp = makeEmployeeUser();
    const CONN_ID = '99999999-9999-4999-8999-999999999999';
    const ERR16_ID = 'aaaaaaaa-9999-4999-8999-999999999999';
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      // markPaymentInDoubtIfNeeded(CONN_ID): SELECT error_message/rrn → connection error
      .mockResolvedValueOnce({ error_message: 'Connection error: error sending request', rrn: null })
      .mockResolvedValueOnce({ payment_resolution: 'in_doubt' }) // UPDATE → in_doubt
      // markPaymentInDoubtIfNeeded(ERR16_ID): SELECT → Error 16 (явный отказ)
      .mockResolvedValueOnce({ error_message: 'Error 16', rrn: null });
      // classifier вернёт 'failed' для Error 16 → UPDATE не вызывается
    vi.mocked(mockDb.query)
      .mockResolvedValueOnce([{ id: CONN_ID }, { id: ERR16_ID }]) // freshFailed: 2 свежих failed+NULL
      .mockResolvedValueOnce([
        {
          id: CONN_ID, studio_id: STUDIO_ID, amount: '1400.00', order_id: null,
          status: 'failed', payment_resolution: 'in_doubt', error_message: 'Connection error: error sending request',
          rrn: null, initiated_by: 'employee-id', initiated_by_name: 'Employee User',
          initiated_at: new Date().toISOString(),
        },
      ]); // список (после классификации только connection-error стал in_doubt)

    const res = await request(app)
      .get('/payments/in-doubt')
      .query({ studioId: STUDIO_ID })
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(CONN_ID);
    // connection-error → UPDATE payment_resolution='in_doubt' был вызван
    expect(mockDb.queryOne).toHaveBeenCalledWith(
      expect.stringContaining("payment_resolution = 'in_doubt'"),
      [CONN_ID],
    );
    // Error 16 → классификатор отсеял в failed, UPDATE для него НЕ вызывался
    expect(mockDb.queryOne).not.toHaveBeenCalledWith(
      expect.stringContaining("payment_resolution = 'in_doubt'"),
      [ERR16_ID],
    );
  });

  it('400 без studioId', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .get('/payments/in-doubt')
      .set(authHeader(emp));

    expect(res.status).toBe(400);
  });
});

describe('POST /payments/:id/resolve — ручное разрешение (P0-A authz + деньги)', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); setIndoubtResolveEnabled(false); });

  // Снимок корзины (как пишется в command_payload при /bridge/pay).
  const SNAPSHOT = {
    items: [{ product_name: 'Печать 10×15', quantity: 2, unit_price: 700, total: 1400, vat_rate: 'NoVat' }],
    subtotal: 1400,
    total: 1400,
    shiftId: SHIFT_ID,
  };
  const PAYMENT_LOOKUP_PAID = {
    id: PAYMENT_TX_ID, studio_id: STUDIO_ID, initiated_by: 'employee-id',
    payment_resolution: 'in_doubt', amount: '1400.00',
    command_payload: { orderId: 'order-1', snapshot: SNAPSHOT }, settled_receipt_id: null,
  };

  it('флаг OFF: admin разрешает оплату как paid → resolved_paid (только пометка, без чека)', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup
      .mockResolvedValueOnce({ payment_resolution: 'resolved_paid' }); // CAS UPDATE

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body.payment_resolution).toBe('resolved_paid');
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    expect(mockEnqueueFiscal).not.toHaveBeenCalled();
  });

  it('флаг ON: admin → создаёт один чек, фискализирует, привязывает transaction_id, БЕЗ нового payment-tx', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }) // CAS claim
      .mockResolvedValueOnce(null) // P0-1: findReceiptIdByPaymentTransaction → чека ещё нет
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }); // P0-2: settled UPDATE RETURNING → привязан

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(201);
    expect(res.body.payment_resolution).toBe('resolved_paid');
    expect(res.body.receipt).toBeTruthy();
    expect(res.body.fiscalized).toBe(true);
    // ровно один createReceipt с привязкой к payment-tx через transaction_id
    expect(mockCreateReceipt).toHaveBeenCalledTimes(1);
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      studio_id: STUDIO_ID,
      employee_id: 'admin-id',
      shift_id: SHIFT_ID,
      subtotal: 1400,
      total: 1400,
      payments: [{ payment_type: 'card', amount: 1400, transaction_id: PAYMENT_TX_ID }],
    }));
    // ровно одна фискализация
    expect(mockEnqueueFiscal).toHaveBeenCalledTimes(1);
    expect(mockEnqueueFiscal).toHaveBeenCalledWith(expect.objectContaining({ operation: 'sale', receiptId: RECEIPT_ID }));
    // resolve НЕ создаёт новую payment-транзакцию (нет INSERT ... 'payment')
    expect(mockFindPosAgentId).not.toHaveBeenCalled();
    // settled_receipt_id привязан через RETURNING-guard (queryOne)
    expect(mockDb.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('settled_receipt_id'),
      [PAYMENT_TX_ID, RECEIPT_ID],
    );
  });

  it('флаг ON: P0-1 — чек по transaction_id уже есть ДО createReceipt → возврат существующего, без второго чека/фискализации', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockGetReceiptById.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup (settled_receipt_id=null)
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }) // CAS claim успешен
      .mockResolvedValueOnce({ receipt_id: RECEIPT_ID }); // P0-1: чек уже создан (краш до settled)

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body.payment_resolution).toBe('resolved_paid');
    expect(res.body.receipt).toBeTruthy();
    expect(mockGetReceiptById).toHaveBeenCalledWith(RECEIPT_ID);
    expect(mockCreateReceipt).not.toHaveBeenCalled(); // второй чек НЕ создан
    expect(mockEnqueueFiscal).not.toHaveBeenCalled();
    // достраивает settled_receipt_id (краш-самолечение)
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining('settled_receipt_id'),
      [PAYMENT_TX_ID, RECEIPT_ID],
    );
  });

  it('флаг ON: P0-3 — CAS=0 и чек нигде не найден → 409 «выполняется», receipt НЕ undefined', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup (settled_receipt_id=null)
      .mockResolvedValueOnce(null) // CAS claim → 0 строк
      .mockResolvedValueOnce(null); // findReceiptIdByPaymentTransaction → чека ещё нет (разрешение идёт конкурентно)

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(409);
    expect(res.body.receipt).toBeUndefined();
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('флаг ON: P0-3 — CAS=0, settled пуст, но чек найден по transaction_id → возврат, без второго чека', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockGetReceiptById.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup (settled_receipt_id=null)
      .mockResolvedValueOnce(null) // CAS claim → 0 строк
      .mockResolvedValueOnce({ receipt_id: RECEIPT_ID }); // findReceiptIdByPaymentTransaction → чек есть

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body.receipt).toBeTruthy();
    expect(mockGetReceiptById).toHaveBeenCalledWith(RECEIPT_ID);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('флаг ON: P0-2 — settled UPDATE вернул 0 строк (конкурентная привязка) → enqueueFiscal НЕ вызывается', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }) // CAS claim
      .mockResolvedValueOnce(null) // P0-1: чека нет
      .mockResolvedValueOnce(null); // P0-2: settled UPDATE RETURNING → 0 строк (уже привязан конкурентом)

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(201);
    expect(res.body.fiscalized).toBe(false);
    // фискализация без подтверждённой привязки запрещена (security P0-3)
    expect(mockEnqueueFiscal).not.toHaveBeenCalled();
  });

  it('флаг ON: P1-2 — смена ФР закрылась в гонке (shouldFiscalize=false) → чек создан, fiscalWarning в ответе', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    // assertFiscalShift (гейт перед createReceipt) → открыта; shouldFiscalize (после) → закрыта
    mockIsFiscalShiftOpenForShift
      .mockResolvedValueOnce(true) // гейт пройден
      .mockResolvedValueOnce(false); // смену закрыли между гейтом и созданием
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }) // CAS claim
      .mockResolvedValueOnce(null) // P0-1: чека нет
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }); // P0-2: привязка успешна

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(201);
    expect(res.body.fiscalized).toBe(false);
    expect(res.body.fiscalWarning).toContain('не фискализирован');
    expect(mockEnqueueFiscal).not.toHaveBeenCalled();
  });

  it('флаг ON: P1 — body.items с shiftId реально доходит до createReceipt (успешный фолбэк)', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      // снимок есть, но БЕЗ items (snapshot.shiftId задаёт смену) — items придут из тела
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, command_payload: { orderId: 'order-1', snapshot: { shiftId: SHIFT_ID } } })
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }) // CAS claim
      .mockResolvedValueOnce(null) // P0-1: чека нет
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }); // P0-2: привязка

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({
        outcome: 'paid',
        items: [{ product_name: 'Печать', quantity: 2, unit_price: 700, total: 1400, vat_rate: 'NoVat' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.receipt).toBeTruthy();
    expect(mockCreateReceipt).toHaveBeenCalledTimes(1);
    // total позиции пересчитан сервером (700*2=1400), subtotal из items
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      shift_id: SHIFT_ID,
      subtotal: 1400,
      total: 1400,
      items: [expect.objectContaining({ product_name: 'Печать', quantity: 2, unit_price: 700, total: 1400 })],
    }));
    expect(mockEnqueueFiscal).toHaveBeenCalledTimes(1);
  });

  it('флаг ON: P1-1/3/4 — per-item total и subtotal пересчитываются сервером (не доверяем фронту)', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    // снимок с ВРАНЬЁМ в total/subtotal: item.total=1 и subtotal=1, но unit*qty=700*2=1400
    const liarSnapshot = {
      items: [{ product_name: 'Печать', quantity: 2, unit_price: 700, total: 1, vat_rate: 'NoVat' }],
      subtotal: 1,
      total: 1,
      shiftId: SHIFT_ID,
    };
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, command_payload: { orderId: 'order-1', snapshot: liarSnapshot } })
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }) // CAS claim
      .mockResolvedValueOnce(null) // P0-1
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }); // P0-2

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(201);
    // сервер пересчитал: item.total=1400 (не 1), subtotal=1400 (не 1)
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      subtotal: 1400,
      items: [expect.objectContaining({ total: 1400 })],
    }));
  });

  it('флаг ON: идемпотентность — CAS 0 строк (гонка) → возвращает существующий чек по settled_receipt_id, без второго чека', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockGetReceiptById.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, settled_receipt_id: RECEIPT_ID }) // lookup (уже привязан чек)
      .mockResolvedValueOnce(null); // CAS claim → 0 строк (другой запрос уже разрешил)

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body.payment_resolution).toBe('resolved_paid');
    expect(res.body.receipt).toBeTruthy();
    expect(mockGetReceiptById).toHaveBeenCalledWith(RECEIPT_ID);
    expect(mockCreateReceipt).not.toHaveBeenCalled(); // второй чек НЕ создан
    expect(mockEnqueueFiscal).not.toHaveBeenCalled();
  });

  it('флаг ON: пустые items (нет снимка и нет body.items) → 400, CAS откатывается в in_doubt', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, command_payload: { orderId: 'order-1' } }) // lookup без snapshot
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }); // CAS claim

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    // компенсация: вернули в in_doubt
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining("payment_resolution = 'in_doubt'"),
      [PAYMENT_TX_ID],
    );
  });

  it('флаг ON: закрытая ФР-смена → 400, чек не создаётся, CAS откатывается', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockIsFiscalShiftOpenForShift.mockResolvedValueOnce(false); // assertFiscalShift → закрыта
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }); // CAS claim

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    expect(mockDb.query).toHaveBeenCalledWith(
      expect.stringContaining("payment_resolution = 'in_doubt'"),
      [PAYMENT_TX_ID],
    );
  });

  it('флаг ON: body.items как фолбэк, когда снимок не сохранился', async () => {
    setIndoubtResolveEnabled(true);
    const admin = makeAdminUser();
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 1400 });
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, command_payload: { orderId: 'order-1' } }) // lookup без snapshot
      .mockResolvedValueOnce({ id: PAYMENT_TX_ID }); // CAS claim

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({
        outcome: 'paid',
        items: [{ product_name: 'Печать', quantity: 1, unit_price: 1400, total: 1400, vat_rate: 'NoVat' }],
      });

    // без snapshot.shiftId смена ФР не передана → assertFiscalShift даст 400
    // (карта требует открытой смены). Это корректно: фискальный чек нельзя
    // пробить без ФР-смены. createReceipt не зовём.
    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('кассир (employee) разрешает СВОЮ оплату — флаг OFF, resolved_paid', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, initiated_by: 'employee-id' }) // своя оплата
      .mockResolvedValueOnce({ payment_resolution: 'resolved_paid' }); // CAS UPDATE

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(emp))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(200);
    expect(res.body.payment_resolution).toBe('resolved_paid');
  });

  it('кассир (employee) НЕ может разрешить ЧУЖУЮ оплату → 403', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, initiated_by: 'other-cashier-id' }); // чужая оплата

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(emp))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(403);
  });

  it('400 при некорректном outcome', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'maybe' });

    expect(res.status).toBe(400);
  });

  it('unpaid: 409, если оплата не в статусе in_doubt (CAS guard)', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ ...PAYMENT_LOOKUP_PAID, payment_resolution: null }) // lookup
      .mockResolvedValueOnce(null); // CAS guarded — 0 строк

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'unpaid' });

    expect(res.status).toBe(409);
    expect(res.body.payment_resolution).toBeUndefined();
  });

  it('unpaid: resolved_unpaid при in_doubt', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(PAYMENT_LOOKUP_PAID) // lookup
      .mockResolvedValueOnce({ payment_resolution: 'resolved_unpaid' }); // CAS UPDATE

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'unpaid' });

    expect(res.status).toBe(200);
    expect(res.body.payment_resolution).toBe('resolved_unpaid');
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('404, если оплата не найдена', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce(null); // lookup

    const res = await request(app)
      .post(`/payments/${PAYMENT_TX_ID}/resolve`)
      .set(authHeader(admin))
      .send({ outcome: 'paid' });

    expect(res.status).toBe(404);
  });
});

describe('GET /shifts/:id/reconciliation — чтение сверки (authz)', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('возвращает строку сверки для своей смены', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_ID, employee_id: 'employee-id' }) // shift scope
      .mockResolvedValueOnce({
        id: 'recon-id', shift_id: SHIFT_ID, studio_id: STUDIO_ID, cash_card_sum: '1850.00',
        terminal_card_sum: null, terminal_qr_sum: null, terminal_total_sum: null,
        diff_card: null, diff_total: null, status: 'pending', notes: 'Ожидание отчёта эквайринга (op59)',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });

    const res = await request(app)
      .get(`/shifts/${SHIFT_ID}/reconciliation`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.reconciliation.status).toBe('pending');
  });

  it('возвращает null, если сверки ещё нет', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_ID, employee_id: 'employee-id' }) // shift scope
      .mockResolvedValueOnce(null); // нет строки сверки

    const res = await request(app)
      .get(`/shifts/${SHIFT_ID}/reconciliation`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.reconciliation).toBeNull();
  });

  it('403 при чужой смене для не-admin/manager', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce({ id: SHIFT_ID, employee_id: 'someone-else' }); // чужая смена

    const res = await request(app)
      .get(`/shifts/${SHIFT_ID}/reconciliation`)
      .set(authHeader(emp));

    expect(res.status).toBe(403);
  });

  it('404, если смена не найдена', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth
      .mockResolvedValueOnce(null); // смена не найдена

    const res = await request(app)
      .get(`/shifts/${SHIFT_ID}/reconciliation`)
      .set(authHeader(emp));

    expect(res.status).toBe(404);
  });
});

// ─── Service timers ───────────────────────────────────────────────────────────

describe('POST /service/start-timer', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns 400 if studio_id missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/service/start-timer')
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(400);
  });

  it('starts timer and returns 201', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockStartServiceTimer.mockResolvedValueOnce({ id: WORK_LOG_ID, started_at: new Date().toISOString() });

    const res = await request(app)
      .post('/service/start-timer')
      .set(authHeader(emp))
      .send({ studio_id: STUDIO_ID });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /service/stop-timer', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns 400 if work_log_id missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/service/stop-timer')
      .set(authHeader(emp))
      .send({});

    expect(res.status).toBe(400);
  });

  it('stops timer and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockStopServiceTimer.mockResolvedValueOnce({ id: WORK_LOG_ID, stopped_at: new Date().toISOString() });

    const res = await request(app)
      .post('/service/stop-timer')
      .set(authHeader(emp))
      .send({ work_log_id: WORK_LOG_ID });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /service/active-timer', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns active timer or null', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetActiveTimer.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/service/active-timer')
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.log).toBeNull();
  });
});

describe('POST /service/custom-surcharge', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns 400 if required fields missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/service/custom-surcharge')
      .set(authHeader(emp))
      .send({ work_log_id: WORK_LOG_ID }); // missing amount and reason

    expect(res.status).toBe(400);
  });

  it('adds surcharge and returns 200', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockAddCustomSurcharge.mockResolvedValueOnce({ id: WORK_LOG_ID, custom_surcharge: 200 });

    const res = await request(app)
      .post('/service/custom-surcharge')
      .set(authHeader(emp))
      .send({ work_log_id: WORK_LOG_ID, amount: 200, reason: 'Сложная работа' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── Materials ────────────────────────────────────────────────────────────────

describe('POST /materials/usage', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns 400 if required fields missing', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth

    const res = await request(app)
      .post('/materials/usage')
      .set(authHeader(emp))
      .send({ product_id: 'prod-1' }); // missing quantity, unit, studio_id

    expect(res.status).toBe(400);
  });

  it('records material usage and returns 201', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockRecordMaterialUsage.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/materials/usage')
      .set(authHeader(emp))
      .send({ product_id: 'prod-1', quantity: 2, unit: 'sheets', studio_id: STUDIO_ID });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /materials/report/:studioId', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns material usage report', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetMaterialUsageReport.mockResolvedValueOnce([]);

    const res = await request(app)
      .get(`/materials/report/${STUDIO_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /materials/low-stock/:studioId', () => {
  beforeEach(() => { vi.clearAllMocks(); resetMockDb(); });

  it('returns low stock items', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetLowStock.mockResolvedValueOnce([]);

    const res = await request(app)
      .get(`/materials/low-stock/${STUDIO_ID}`)
      .set(authHeader(emp));

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /receipts/from-pricing — «Супер обработка» (контракт задачи ретуши) ──

describe('POST /receipts/from-pricing — super retouch task contract', () => {
  // Категория photo-docs с двумя уровнями обработки.
  const PHOTO_DOCS_CATEGORY = {
    slug: 'photo-docs',
    name: 'Фото на документы',
    optionGroups: [
      {
        slug: 'processing-level',
        options: [
          { slug: 'processing-basic', id: 'opt-basic', product_id: null },
          { slug: 'processing-super', id: 'opt-super', product_id: null },
        ],
      },
    ],
  };

  function waterfallFor(slug: string, name: string, price: number) {
    return {
      subtotal: price,
      total: price,
      savings: 0,
      waterfall: [],
      items: [
        {
          serviceOptionId: slug === 'processing-super' ? 'opt-super' : 'opt-basic',
          slug,
          name,
          quantity: 1,
          unitPrice: price,
          basePrice: price,
          finalPrice: price,
          discountApplied: 'none',
          discountAmount: 0,
          discountLabel: null,
          studentDiscountBenefit: null,
          studentDiscountUnits: 0,
        },
      ],
      isReturning: false,
      priceAdjustments: [],
      accountDiscount: null,
      subscriberDiscount: null,
      studentDiscount: null,
      loyaltyDiscount: null,
      promoDiscount: null,
      educationVolumeConsumed: null,
    };
  }

  beforeEach(() => {
    resetMockDb();
    vi.clearAllMocks();
    mockCreateRetouchTaskFromPos.mockResolvedValue({ id: 'task-id', task_number: 1, status: 'open' });
  });

  it('creates a retouch work_task when processing-super is selected with retouch_config', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetCategories.mockResolvedValueOnce([PHOTO_DOCS_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(waterfallFor('processing-super', 'Супер обработка', 3000) as never);
    mockResolveRetouchConfig.mockResolvedValueOnce({
      options: [
        { group: 'makeup-style', group_name: 'Стиль макияжа', slug: 'makeup-natural', label: 'Натуральный' },
      ],
      notes: 'убрать блики',
      gender: 'female',
    });
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 3000 });

    const res = await request(app)
      .post('/receipts/from-pricing')
      .set(authHeader(emp))
      .send({
        category_slug: 'photo-docs',
        selected_options: [{ slug: 'processing-super', quantity: 1 }],
        delivery_method: 'pickup',
        studio_id: STUDIO_ID,
        customer_name: 'Иванов Иван',
        payments: [{ method: 'cash', amount: 3000 }],
        retouch_config: {
          gender: 'female',
          groups: { 'makeup-style': ['makeup-natural'] },
          notes: 'убрать блики',
        },
      });

    expect(res.status).toBe(201);
    expect(mockResolveRetouchConfig).toHaveBeenCalledTimes(1);
    expect(mockCreateRetouchTaskFromPos).toHaveBeenCalledTimes(1);
    const taskArg = mockCreateRetouchTaskFromPos.mock.calls[0][0];
    expect(taskArg).toMatchObject({
      receipt_id: RECEIPT_ID,
      gender: 'female',
      notes: 'убрать блики',
      created_by: 'employee-id',
    });
    expect(taskArg.retouch_options).toEqual([
      { group: 'makeup-style', group_name: 'Стиль макияжа', slug: 'makeup-natural', label: 'Натуральный' },
    ]);
    // snapshot записан в чек атомарно (передан в createReceipt.metadata)
    expect(mockCreateReceipt.mock.calls[0][0].metadata).toMatchObject({
      retouch_config: { gender: 'female' },
    });
  });

  it('still creates the retouch task when processing-super is selected WITHOUT retouch_config (empty selection, P0-2)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetCategories.mockResolvedValueOnce([PHOTO_DOCS_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(waterfallFor('processing-super', 'Супер обработка', 3000) as never);
    mockResolveRetouchConfig.mockResolvedValueOnce({ options: [], notes: null, gender: 'any' });
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 3000 });

    const res = await request(app)
      .post('/receipts/from-pricing')
      .set(authHeader(emp))
      .send({
        category_slug: 'photo-docs',
        selected_options: [{ slug: 'processing-super', quantity: 1 }],
        delivery_method: 'pickup',
        studio_id: STUDIO_ID,
        payments: [{ method: 'cash', amount: 3000 }],
      });

    expect(res.status).toBe(201);
    expect(mockCreateRetouchTaskFromPos).toHaveBeenCalledTimes(1);
    expect(mockCreateRetouchTaskFromPos.mock.calls[0][0].retouch_options).toEqual([]);
  });

  it('creates the retouch task even when resolveRetouchConfig throws (money-path safe, P2-1)', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetCategories.mockResolvedValueOnce([PHOTO_DOCS_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(waterfallFor('processing-super', 'Супер обработка', 3000) as never);
    mockResolveRetouchConfig.mockRejectedValueOnce(new Error('catalog SELECT failed'));
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 3000 });

    const res = await request(app)
      .post('/receipts/from-pricing')
      .set(authHeader(emp))
      .send({
        category_slug: 'photo-docs',
        selected_options: [{ slug: 'processing-super', quantity: 1 }],
        delivery_method: 'pickup',
        studio_id: STUDIO_ID,
        payments: [{ method: 'cash', amount: 3000 }],
      });

    // Чек НЕ должен упасть из-за сбоя резолва каталога
    expect(res.status).toBe(201);
    // metadata snapshot не пишется при упавшем резолве
    expect(mockCreateReceipt.mock.calls[0][0].metadata).toBeNull();
    // но задача ретуши всё равно создаётся (fallback пустой)
    expect(mockCreateRetouchTaskFromPos).toHaveBeenCalledTimes(1);
    expect(mockCreateRetouchTaskFromPos.mock.calls[0][0]).toMatchObject({
      gender: 'any',
      retouch_options: [],
    });
  });

  it('does NOT create a retouch task when processing-super is not selected', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    mockGetCategories.mockResolvedValueOnce([PHOTO_DOCS_CATEGORY] as never);
    mockCalculatePriceWaterfall.mockResolvedValueOnce(waterfallFor('processing-basic', 'Базовая обработка', 700) as never);
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, total: 700 });

    const res = await request(app)
      .post('/receipts/from-pricing')
      .set(authHeader(emp))
      .send({
        category_slug: 'photo-docs',
        selected_options: [{ slug: 'processing-basic', quantity: 1 }],
        delivery_method: 'pickup',
        studio_id: STUDIO_ID,
        payments: [{ method: 'cash', amount: 700 }],
      });

    expect(res.status).toBe(201);
    expect(mockResolveRetouchConfig).not.toHaveBeenCalled();
    expect(mockCreateRetouchTaskFromPos).not.toHaveBeenCalled();
    // metadata не передаётся для не-super чеков
    expect(mockCreateReceipt.mock.calls[0][0].metadata).toBeNull();
  });
});

// ─── Осиротевшие оплаты: GET /payments/orphan ─────────────────────────────────

const PAYMENT_ID = '66666666-6666-4666-8666-666666666666';

describe('GET /payments/orphan', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); setOrphanDetectEnabled(false); });

  it('флаг OFF → пустой список, детектор не зовётся', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth
    const res = await request(app).get('/payments/orphan').query({ studioId: STUDIO_ID }).set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(mockFindOrphanPayments).not.toHaveBeenCalled();
  });

  it('флаг ON → возвращает orphan-оплату с kind:orphan, admin видит всю студию', async () => {
    setOrphanDetectEnabled(true);
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    mockFindOrphanPayments.mockResolvedValueOnce([
      { id: PAYMENT_ID, studio_id: STUDIO_ID, amount: '525.00', order_id: null, status: 'completed',
        rrn: '615712740554', initiated_by: 'cashier-x', initiated_by_name: 'Ольга',
        completed_at: '2026-06-06T12:14:45.261Z', command_payload: null },
    ]);
    const res = await request(app).get('/payments/orphan').query({ studioId: STUDIO_ID }).set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: PAYMENT_ID, kind: 'orphan', amount: 525, snapshot: null });
    expect(mockFindOrphanPayments).toHaveBeenCalledWith(STUDIO_ID, 5);
  });

  it('флаг ON → employee видит только свои инициированные оплаты', async () => {
    setOrphanDetectEnabled(true);
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_EMPLOYEE); // auth (id=employee-id)
    mockFindOrphanPayments.mockResolvedValueOnce([
      { id: PAYMENT_ID, studio_id: STUDIO_ID, amount: '525.00', order_id: null, status: 'completed',
        rrn: null, initiated_by: 'employee-id', initiated_by_name: 'Я', completed_at: null, command_payload: null },
      { id: 'other', studio_id: STUDIO_ID, amount: '80.00', order_id: null, status: 'completed',
        rrn: null, initiated_by: 'someone-else', initiated_by_name: 'Чужой', completed_at: null, command_payload: null },
    ]);
    const res = await request(app).get('/payments/orphan').query({ studioId: STUDIO_ID }).set(authHeader(emp));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(PAYMENT_ID);
  });
});

// ─── Осиротевшие оплаты: POST /payments/:id/create-receipt ────────────────────

describe('POST /payments/:id/create-receipt', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); setOrphanDetectEnabled(true); });

  const ITEMS = [{ product_id: null, product_name: 'Печать', quantity: 1, unit_price: 525, total: 525 }];

  it('флаг OFF → 403', async () => {
    setOrphanDetectEnabled(false);
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({ items: ITEMS });
    expect(res.status).toBe(403);
  });

  it('создаёт чек + settled_receipt_id + enqueueFiscal по введённым позициям', async () => {
    const admin = makeAdminUser();
    const { enqueueFiscal } = await import('../workers/pos-fiscal-worker.js');
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ id: PAYMENT_ID, studio_id: STUDIO_ID, initiated_by: 'cashier-x', payment_resolution: null, amount: '525.00', command_payload: { snapshot: { shiftId: SHIFT_ID } }, settled_receipt_id: null }) // lookup (snapshot.shiftId → гейт ФР проходит)
      .mockResolvedValueOnce({ id: PAYMENT_ID }) // CAS-claim
      .mockResolvedValueOnce(null) // findReceiptIdByPaymentTransaction (priorReceiptId) — нет
      .mockResolvedValueOnce({ id: 'link-row' }); // settled_receipt_id link
    mockIsFiscalShiftOpenForShift.mockResolvedValue(true); // гейт ФР-смены открыт
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, id: RECEIPT_ID, total: 525, payments: [{ payment_type: 'card', amount: 525 }] });

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({ items: ITEMS });

    expect(res.status).toBe(201);
    expect(res.body.payment_resolution).toBe('resolved_paid');
    expect(res.body.receipt.id).toBe(RECEIPT_ID);
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({
      payments: [expect.objectContaining({ payment_type: 'card', transaction_id: PAYMENT_ID })],
    }));
    expect(vi.mocked(enqueueFiscal)).toHaveBeenCalled();
  });

  it('CAS=0 строк (гонка) → возвращает существующий чек, без второго createReceipt', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ id: PAYMENT_ID, studio_id: STUDIO_ID, initiated_by: 'cashier-x', payment_resolution: 'resolved_paid', amount: '525.00', command_payload: null, settled_receipt_id: RECEIPT_ID }) // lookup
      .mockResolvedValueOnce(null); // CAS-claim → 0 строк
    mockGetReceiptById.mockResolvedValueOnce({ ...DB_RECEIPT, id: RECEIPT_ID });

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({ items: ITEMS });

    expect(res.status).toBe(200);
    expect(res.body.receipt.id).toBe(RECEIPT_ID);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('без позиций и без snapshot → 400 + компенсация payment_resolution=NULL', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ id: PAYMENT_ID, studio_id: STUDIO_ID, initiated_by: 'cashier-x', payment_resolution: null, amount: '525.00', command_payload: null, settled_receipt_id: null }) // lookup
      .mockResolvedValueOnce({ id: PAYMENT_ID }) // CAS-claim
      .mockResolvedValueOnce(null); // priorReceiptId — нет
    vi.mocked(mockDb.query).mockResolvedValue([] as never); // revertClaim

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({});

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    // компенсация: revertClaim вернул payment_resolution = NULL
    const revertCall = vi.mocked(mockDb.query).mock.calls.find(([sql]) => String(sql).includes('payment_resolution = NULL'));
    expect(revertCall).toBeDefined();
  });

  it('P1: сумма позиций ≠ списанию amount → 400 + компенсация (54-ФЗ)', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ id: PAYMENT_ID, studio_id: STUDIO_ID, initiated_by: 'cashier-x', payment_resolution: null, amount: '525.00', command_payload: null, settled_receipt_id: null }) // lookup (списание 525)
      .mockResolvedValueOnce({ id: PAYMENT_ID }) // CAS-claim
      .mockResolvedValueOnce(null); // priorReceiptId — нет
    vi.mocked(mockDb.query).mockResolvedValue([] as never); // revertClaim
    // позиции на 100₽ (≠ 525₽ списания) → 400 до createReceipt
    const wrongItems = [{ product_id: null, product_name: 'Печать', quantity: 1, unit_price: 100, total: 100 }];

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({ items: wrongItems });

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/не совпадает/);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    const revertCall = vi.mocked(mockDb.query).mock.calls.find(([sql]) => String(sql).includes('payment_resolution = NULL'));
    expect(revertCall).toBeDefined();
  });

  it('P1: unit_price < 0 → 400 (zod, до обработчика)', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne).mockResolvedValueOnce(DB_ADMIN); // auth
    const negItems = [{ product_id: null, product_name: 'Печать', quantity: 1, unit_price: -10, total: -10 }];

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({ items: negItems });

    expect(res.status).toBe(400);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });

  it('P1-фолбэк: snapshot=null → резолв открытой смены студии, чек оформлен', async () => {
    const admin = makeAdminUser();
    const { enqueueFiscal } = await import('../workers/pos-fiscal-worker.js');
    mockFindOpenShiftIdForStudio.mockResolvedValueOnce(SHIFT_ID); // открытая смена студии есть
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ id: PAYMENT_ID, studio_id: STUDIO_ID, initiated_by: 'cashier-x', payment_resolution: null, amount: '525.00', command_payload: null, settled_receipt_id: null }) // lookup (snapshot=null)
      .mockResolvedValueOnce({ id: PAYMENT_ID }) // CAS-claim
      .mockResolvedValueOnce(null) // priorReceiptId — нет
      .mockResolvedValueOnce({ id: 'link-row' }); // settled_receipt_id link
    mockIsFiscalShiftOpenForShift.mockResolvedValue(true);
    mockCreateReceipt.mockResolvedValueOnce({ ...DB_RECEIPT, id: RECEIPT_ID, total: 525, payments: [{ payment_type: 'card', amount: 525 }] });

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({ items: ITEMS });

    expect(res.status).toBe(201);
    expect(mockFindOpenShiftIdForStudio).toHaveBeenCalledWith(STUDIO_ID);
    expect(mockCreateReceipt).toHaveBeenCalledWith(expect.objectContaining({ shift_id: SHIFT_ID }));
    expect(vi.mocked(enqueueFiscal)).toHaveBeenCalled();
  });

  it('P1-фолбэк: snapshot=null и нет открытой смены студии → 400 «Нет открытой смены ФР» + компенсация', async () => {
    const admin = makeAdminUser();
    mockFindOpenShiftIdForStudio.mockResolvedValueOnce(null); // открытой смены нет
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ id: PAYMENT_ID, studio_id: STUDIO_ID, initiated_by: 'cashier-x', payment_resolution: null, amount: '525.00', command_payload: null, settled_receipt_id: null }) // lookup
      .mockResolvedValueOnce({ id: PAYMENT_ID }) // CAS-claim
      .mockResolvedValueOnce(null); // priorReceiptId — нет
    vi.mocked(mockDb.query).mockResolvedValue([] as never); // revertClaim

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(admin)).send({ items: ITEMS });

    expect(res.status).toBe(400);
    expect(res.body.error || res.body.message).toMatch(/смены ФР/);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
    const revertCall = vi.mocked(mockDb.query).mock.calls.find(([sql]) => String(sql).includes('payment_resolution = NULL'));
    expect(revertCall).toBeDefined();
  });

  it('employee не может оформить чужую оплату → 403', async () => {
    const emp = makeEmployeeUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_EMPLOYEE) // auth (id=employee-id)
      .mockResolvedValueOnce({ id: PAYMENT_ID, studio_id: STUDIO_ID, initiated_by: 'someone-else', payment_resolution: null, amount: '525.00', command_payload: null, settled_receipt_id: null }); // lookup

    const res = await request(app).post(`/payments/${PAYMENT_ID}/create-receipt`).set(authHeader(emp)).send({ items: ITEMS });

    expect(res.status).toBe(403);
    expect(mockCreateReceipt).not.toHaveBeenCalled();
  });
});

// ─── Расширенный guard POST /receipts/:id/fiscal-retry ────────────────────────

describe('POST /receipts/:id/fiscal-retry — расширенный guard + анти-дубль', () => {
  beforeEach(() => { resetMockDb(); vi.clearAllMocks(); });

  it('pending → ставит в очередь повторно', async () => {
    const admin = makeAdminUser();
    const { enqueueFiscal } = await import('../workers/pos-fiscal-worker.js');
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ fiscal_status: 'pending', receipt_number: 'R-1', total: 525, has_completed_fiscal: false }); // lookup+exists
    const res = await request(app).post(`/receipts/${RECEIPT_ID}/fiscal-retry`).set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('повторно');
    expect(vi.mocked(enqueueFiscal)).toHaveBeenCalled();
  });

  it('queued → честное «уже в очереди»', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ fiscal_status: 'queued', receipt_number: 'R-1', total: 525, has_completed_fiscal: false });
    const res = await request(app).post(`/receipts/${RECEIPT_ID}/fiscal-retry`).set(authHeader(admin));
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('уже в очереди');
  });

  it('завершённая фискализация → 409 (анти-дубль)', async () => {
    const admin = makeAdminUser();
    const { enqueueFiscal } = await import('../workers/pos-fiscal-worker.js');
    vi.mocked(enqueueFiscal).mockClear();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ fiscal_status: 'failed', receipt_number: 'R-1', total: 525, has_completed_fiscal: true });
    const res = await request(app).post(`/receipts/${RECEIPT_ID}/fiscal-retry`).set(authHeader(admin));
    expect(res.status).toBe(409);
    expect(vi.mocked(enqueueFiscal)).not.toHaveBeenCalled();
  });

  it('success-статус (не retryable) → 400', async () => {
    const admin = makeAdminUser();
    vi.mocked(mockDb.queryOne)
      .mockResolvedValueOnce(DB_ADMIN) // auth
      .mockResolvedValueOnce({ fiscal_status: 'success', receipt_number: 'R-1', total: 525, has_completed_fiscal: false });
    const res = await request(app).post(`/receipts/${RECEIPT_ID}/fiscal-retry`).set(authHeader(admin));
    expect(res.status).toBe(400);
  });
});
