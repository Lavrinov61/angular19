import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { ShiftsApiService, EmployeeShift } from './shifts-api.service';

const makeShift = (overrides: Partial<EmployeeShift> = {}): EmployeeShift => ({
  id: 'shift-1',
  employee_id: 'emp-1',
  studio_id: 'studio-1',
  shift_date: '2026-01-10',
  start_time: '09:00',
  end_time: '19:30',
  status: 'scheduled',
  cash_at_open: null,
  cash_at_close: null,
  base_pay_rate: 2000,
  online_earnings: 0,
  online_count: 0,
  commission_total: 0,
  sales_total: 0,
  receipts_count: 0,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const ok = (data: unknown) => ({ success: true, data });

describe('ShiftsApiService', () => {
  let service: ShiftsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ShiftsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── getShifts ───────────────────────────────────────────────────────────

  describe('getShifts()', () => {
    it('GETs /api/shifts without params by default', () => {
      service.getShifts().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/shifts');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush(ok([]));
    });

    it('passes studio_id and date range params', () => {
      service.getShifts({ studio_id: 's1', date_from: '2026-01-01', date_to: '2026-01-31' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/shifts');
      expect(req.request.params.get('studio_id')).toBe('s1');
      expect(req.request.params.get('date_from')).toBe('2026-01-01');
      expect(req.request.params.get('date_to')).toBe('2026-01-31');
      req.flush(ok([]));
    });

    it('passes employee_id filter', () => {
      service.getShifts({ employee_id: 'emp-1' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/shifts');
      expect(req.request.params.get('employee_id')).toBe('emp-1');
      req.flush(ok([]));
    });
  });

  // ─── getToday ────────────────────────────────────────────────────────────

  describe('getToday()', () => {
    it('GETs /api/shifts/today', () => {
      service.getToday().subscribe();
      const req = httpMock.expectOne('/api/shifts/today');
      expect(req.request.method).toBe('GET');
      req.flush(ok([]));
    });
  });

  describe('getMyShifts()', () => {
    it('GETs /api/shifts/my with optional date range', () => {
      service.getMyShifts('2026-02-01', '2026-02-28').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/shifts/my');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('date_from')).toBe('2026-02-01');
      expect(req.request.params.get('date_to')).toBe('2026-02-28');
      req.flush(ok([]));
    });
  });

  describe('getShiftStudios()', () => {
    it('GETs studios with employee shift rates', () => {
      service.getShiftStudios().subscribe();
      const req = httpMock.expectOne('/api/shifts/studios');
      expect(req.request.method).toBe('GET');
      req.flush(ok([{ id: 'studio-1', name: 'Соборный 21', address: null, location_code: 'soborny', status: 'active', shift_rate: 1500 }]));
    });
  });

  // ─── createShift ─────────────────────────────────────────────────────────

  describe('createShift()', () => {
    it('POSTs to /api/shifts with shift data', () => {
      const data = { employee_id: 'emp-1', studio_id: 's1', shift_date: '2026-02-01' };
      service.createShift(data).subscribe();
      const req = httpMock.expectOne('/api/shifts');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush(ok(makeShift()));
    });
  });

  // ─── updateShift ──────────────────────────────────────────────────────────

  describe('updateShift()', () => {
    it('PUTs to /api/shifts/:id', () => {
      service.updateShift('shift-1', { status: 'cancelled' }).subscribe();
      const req = httpMock.expectOne('/api/shifts/shift-1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'cancelled' });
      req.flush(ok(makeShift({ status: 'cancelled' })));
    });
  });

  describe('updateMyShift()', () => {
    it('PUTs employee-owned shift changes to /api/shifts/my/:id', () => {
      const updates = { studio_id: 'studio-2', start_time: '10:00', end_time: '19:00' };
      service.updateMyShift('shift-1', updates).subscribe();
      const req = httpMock.expectOne('/api/shifts/my/shift-1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updates);
      req.flush(ok(makeShift(updates)));
    });
  });

  // ─── deleteShift ──────────────────────────────────────────────────────────

  describe('deleteShift()', () => {
    it('DELETEs /api/shifts/:id', () => {
      service.deleteShift('shift-1').subscribe();
      const req = httpMock.expectOne('/api/shifts/shift-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(ok(null));
    });
  });

  // ─── checkIn / checkOut ──────────────────────────────────────────────────

  describe('checkIn()', () => {
    it('POSTs to /api/shifts/:id/check-in', () => {
      service.checkIn('shift-1', 1000).subscribe();
      const req = httpMock.expectOne('/api/shifts/shift-1/check-in');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ cash_at_open: 1000 });
      req.flush(ok(makeShift({ status: 'active' })));
    });
  });

  describe('checkOut()', () => {
    it('POSTs to /api/shifts/:id/check-out', () => {
      service.checkOut('shift-1', 1500).subscribe();
      const req = httpMock.expectOne('/api/shifts/shift-1/check-out');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ cash_at_close: 1500 });
      req.flush(ok({ ...makeShift({ status: 'completed' }), pending_tasks: [] }));
    });

    it('retries once after a gateway timeout', async () => {
      vi.useFakeTimers();
      try {
        let response: unknown;
        const completedResponse = ok({ ...makeShift({ status: 'completed' }), pending_tasks: [] });

        service.checkOut('shift-1', 1500).subscribe(res => {
          response = res;
        });

        const firstReq = httpMock.expectOne('/api/shifts/shift-1/check-out');
        firstReq.flush({ error: 'Gateway Timeout' }, { status: 504, statusText: 'Gateway Timeout' });

        await vi.advanceTimersByTimeAsync(1000);

        const retryReq = httpMock.expectOne('/api/shifts/shift-1/check-out');
        expect(retryReq.request.method).toBe('POST');
        expect(retryReq.request.body).toEqual({ cash_at_close: 1500 });
        retryReq.flush(completedResponse);

        expect(response).toEqual(completedResponse);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ─── getBriefing ─────────────────────────────────────────────────────────

  describe('getBriefing()', () => {
    it('GETs /api/shifts/:id/briefing', () => {
      service.getBriefing('shift-1').subscribe();
      const req = httpMock.expectOne('/api/shifts/shift-1/briefing');
      expect(req.request.method).toBe('GET');
      req.flush(ok(null));
    });
  });

  // ─── getDashboard ────────────────────────────────────────────────────────

  describe('getDashboard()', () => {
    it('GETs /api/shifts/employee-dashboard', () => {
      service.getDashboard().subscribe();
      const req = httpMock.expectOne('/api/shifts/employee-dashboard');
      expect(req.request.method).toBe('GET');
      req.flush(ok(null));
    });
  });

  // ─── Schedule Requests ────────────────────────────────────────────────────

  describe('createScheduleRequest()', () => {
    it('POSTs to /api/shifts/requests with request data', () => {
      const data = { shift_pattern: '2/2' as const, pattern_start_date: '2026-02-01' };
      service.createScheduleRequest(data).subscribe();
      const req = httpMock.expectOne('/api/shifts/requests');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush(ok(null));
    });
  });

  describe('getScheduleRequests()', () => {
    it('GETs /api/shifts/requests', () => {
      service.getScheduleRequests().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/shifts/requests');
      expect(req.request.method).toBe('GET');
      req.flush(ok([]));
    });

    it('passes status filter', () => {
      service.getScheduleRequests({ status: 'pending' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/shifts/requests');
      expect(req.request.params.get('status')).toBe('pending');
      req.flush(ok([]));
    });
  });

  describe('approveScheduleRequest()', () => {
    it('PUTs to /api/shifts/requests/:id/approve with studio_id', () => {
      service.approveScheduleRequest('req-1', 'studio-1').subscribe();
      const req = httpMock.expectOne('/api/shifts/requests/req-1/approve');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ studio_id: 'studio-1' });
      req.flush(ok(null));
    });

    it('PUTs an empty body when request already contains studios per day', () => {
      service.approveScheduleRequest('req-1').subscribe();
      const req = httpMock.expectOne('/api/shifts/requests/req-1/approve');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({});
      req.flush(ok(null));
    });
  });

  describe('rejectScheduleRequest()', () => {
    it('PUTs to /api/shifts/requests/:id/reject with comment', () => {
      service.rejectScheduleRequest('req-1', 'Нет свободных смен').subscribe();
      const req = httpMock.expectOne('/api/shifts/requests/req-1/reject');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ comment: 'Нет свободных смен' });
      req.flush(ok(null));
    });
  });
});
