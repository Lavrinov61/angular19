import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrderAssignmentsApiService, OrderAssignment } from './order-assignments-api.service';

const makeAssignment = (overrides: Partial<OrderAssignment> = {}): OrderAssignment => ({
  id: 'assign-1', order_id: 'ord-1', order_type: 'print',
  order_summary: '10×15 × 5 шт', source: 'pos', studio_id: 'studio-1',
  assigned_to: null, assigned_at: null, deadline_at: null,
  estimated_minutes: null, status: 'pending', completed_at: null,
  help_request: null, help_requested_at: null, helpers: [], priority: 0,
  metadata: {}, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z',
  ...overrides,
});

describe('OrderAssignmentsApiService', () => {
  let service: OrderAssignmentsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrderAssignmentsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getPending()', () => {
    it('GETs /api/orders/assignments/pending without params', () => {
      service.getPending().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/orders/assignments/pending');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, orders: [] });
    });

    it('passes studio_id param', () => {
      service.getPending('studio-1').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/orders/assignments/pending');
      expect(req.request.params.get('studio_id')).toBe('studio-1');
      req.flush({ success: true, orders: [] });
    });
  });

  describe('getMy()', () => {
    it('GETs /api/orders/assignments/my', () => {
      service.getMy().subscribe();
      const req = httpMock.expectOne('/api/orders/assignments/my');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, orders: [] });
    });
  });

  describe('create()', () => {
    it('POSTs to /api/orders/assignments with data', () => {
      const data = { order_id: 'ord-1', order_type: 'print' as const };
      service.create(data).subscribe();
      const req = httpMock.expectOne('/api/orders/assignments');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, assignment: makeAssignment() });
    });
  });

  describe('take()', () => {
    it('POSTs to /api/orders/assignments/:id/take', () => {
      service.take('assign-1').subscribe();
      const req = httpMock.expectOne('/api/orders/assignments/assign-1/take');
      expect(req.request.method).toBe('POST');
      req.flush({ success: true, assignment: makeAssignment({ assigned_to: 'emp-1' }) });
    });
  });

  describe('complete()', () => {
    it('POSTs to /api/orders/assignments/:id/complete', () => {
      service.complete('assign-1').subscribe();
      const req = httpMock.expectOne('/api/orders/assignments/assign-1/complete');
      expect(req.request.method).toBe('POST');
      req.flush({ success: true, assignment: makeAssignment({ status: 'completed' }) });
    });
  });

  describe('cancel()', () => {
    it('POSTs to /api/orders/assignments/:id/cancel', () => {
      service.cancel('assign-1').subscribe();
      const req = httpMock.expectOne('/api/orders/assignments/assign-1/cancel');
      expect(req.request.method).toBe('POST');
      req.flush(null);
    });
  });
});
