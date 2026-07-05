import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CrmReportsApiService, DailySummary, CashReconciliationReport } from './crm-reports-api.service';

const makeDailySummary = (): DailySummary => ({
  today: {
    revenue: 5000, refunds: 200, net: 4800, receipts: 15, orders: 8,
    avg_check: 333,
    payments: {
      cash: 1000,
      cash_pos_fiscal: 700,
      cash_pos_non_fiscal: 100,
      cash_chat_fiscal: 150,
      cash_chat_non_fiscal: 50,
      card: 3000,
      sbp: 800,
      online: 200,
      subscription: 0,
      transfer: 500,
    },
  },
  yesterday: { revenue: 4500, receipts: 12, orders: 6 },
  last_week_avg: { revenue: 4000, receipts: 11, orders: 5 },
  pending_orders: 3,
});

const makeCashReport = (): CashReconciliationReport => ({
  rows: [{
    shift_id: 'shift-1',
    shift_date: '2026-05-16',
    employee_id: 'employee-1',
    employee_name: 'Employee',
    studio_id: 'studio-1',
    studio_name: '2-ая Баррикадная 4',
    workday_status: 'completed',
    checked_in_at: '2026-05-16T08:45:00.000Z',
    checked_out_at: '2026-05-16T19:45:00.000Z',
    cash_at_open: 1000,
    cash_at_close: 3100,
    cash_payments: 2000,
    cash_pos_fiscal_payments: 1600,
    cash_pos_non_fiscal_payments: 200,
    cash_chat_fiscal_payments: 150,
    cash_chat_non_fiscal_payments: 50,
    cash_withdrawals: 0,
    expected_cash: 3000,
    difference: 100,
    receipts_count: 8,
    status: 'possible_tip',
    status_label: 'Возможно чаевые',
  }],
  summary: {
    total: 1,
    balanced: 0,
    possible_tip: 1,
    shortage: 0,
    surplus: 0,
    missing_open: 0,
    missing_close: 0,
    open: 0,
    issues: 0,
  },
  tolerance: 1,
  possible_tip_limit: 500,
});

describe('CrmReportsApiService', () => {
  let service: CrmReportsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CrmReportsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── getRevenue ──────────────────────────────────────────────────────────

  describe('getRevenue()', () => {
    it('GETs /api/crm/reports/revenue with from, to, groupBy params', () => {
      service.getRevenue('2026-01-01', '2026-01-31', 'day').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/reports/revenue');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('from')).toBe('2026-01-01');
      expect(req.request.params.get('to')).toBe('2026-01-31');
      expect(req.request.params.get('groupBy')).toBe('day');
      req.flush({ success: true, data: [] });
    });

    it('uses day groupBy by default', () => {
      service.getRevenue('2026-01-01', '2026-01-31').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/reports/revenue');
      expect(req.request.params.get('groupBy')).toBe('day');
      req.flush({ success: true, data: [] });
    });

    it('supports week and month groupBy', () => {
      service.getRevenue('2026-01-01', '2026-03-31', 'month').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/reports/revenue');
      expect(req.request.params.get('groupBy')).toBe('month');
      req.flush({ success: true, data: [] });
    });
  });

  // ─── getDailySummary ─────────────────────────────────────────────────────

  describe('getDailySummary()', () => {
    it('GETs /api/crm/reports/daily-summary', () => {
      service.getDailySummary().subscribe();
      const req = httpMock.expectOne('/api/crm/reports/daily-summary');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeDailySummary() });
    });

    it('returns the daily summary data', () => {
      let result: DailySummary | undefined;
      service.getDailySummary().subscribe(d => (result = d));
      httpMock.expectOne('/api/crm/reports/daily-summary')
        .flush({ success: true, data: makeDailySummary() });
      expect(result?.today.net).toBe(4800);
      expect(result?.pending_orders).toBe(3);
    });
  });

  // ─── getTopProducts ──────────────────────────────────────────────────────

  describe('getTopProducts()', () => {
    it('GETs /api/crm/reports/products with from, to, limit params', () => {
      service.getTopProducts('2026-01-01', '2026-01-31', 10).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/reports/products');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('from')).toBe('2026-01-01');
      expect(req.request.params.get('to')).toBe('2026-01-31');
      expect(req.request.params.get('limit')).toBe('10');
      req.flush({ success: true, data: [] });
    });

    it('uses limit=20 by default', () => {
      service.getTopProducts('2026-01-01', '2026-01-31').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/reports/products');
      expect(req.request.params.get('limit')).toBe('20');
      req.flush({ success: true, data: [] });
    });
  });

  // ─── getCashControl ──────────────────────────────────────────────────────

  describe('getCashControl()', () => {
    it('GETs /api/crm/reports/cash-control with from and to params', () => {
      service.getCashControl('2026-05-10', '2026-05-16').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/reports/cash-control');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('from')).toBe('2026-05-10');
      expect(req.request.params.get('to')).toBe('2026-05-16');
      req.flush({ success: true, data: makeCashReport() });
    });

    it('returns the cash reconciliation report data', () => {
      let result: CashReconciliationReport | undefined;
      service.getCashControl('2026-05-10', '2026-05-16').subscribe(data => (result = data));
      httpMock.expectOne(r => r.url === '/api/crm/reports/cash-control')
        .flush({ success: true, data: makeCashReport() });
      expect(result?.rows[0]?.status).toBe('possible_tip');
      expect(result?.summary.possible_tip).toBe(1);
    });
  });
});
