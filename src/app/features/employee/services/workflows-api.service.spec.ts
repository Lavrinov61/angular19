import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { WorkflowsApiService, Workflow } from './workflows-api.service';

const makeWorkflow = (overrides: Partial<Workflow> = {}): Workflow => ({
  id: 1,
  name: 'Уведомление после оплаты',
  description: null,
  trigger_type: 'order_paid',
  conditions: [],
  actions: [{ type: 'notify_team', params: {}, delay_seconds: 0 }],
  is_active: true,
  run_count: 5,
  last_run_at: '2026-01-01T10:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('WorkflowsApiService', () => {
  let service: WorkflowsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(WorkflowsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('list()', () => {
    it('GETs /api/workflows/ without params by default', () => {
      service.list().subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/workflows/'));
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });

    it('appends is_active filter', () => {
      service.list({ is_active: true }).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/workflows/'));
      expect(req.request.url).toContain('is_active=true');
      req.flush({ success: true, data: [] });
    });

    it('appends trigger_type filter', () => {
      service.list({ trigger_type: 'order_paid' }).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/workflows/'));
      expect(req.request.url).toContain('trigger_type=order_paid');
      req.flush({ success: true, data: [] });
    });
  });

  describe('get()', () => {
    it('GETs /api/workflows/:id', () => {
      service.get(1).subscribe();
      const req = httpMock.expectOne('/api/workflows/1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeWorkflow() });
    });
  });

  describe('create()', () => {
    it('POSTs to /api/workflows with workflow data', () => {
      const data = {
        name: 'Новый', description: null, trigger_type: 'manual' as const,
        conditions: [], actions: [], is_active: false,
      };
      service.create(data).subscribe();
      const req = httpMock.expectOne('/api/workflows');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, data: makeWorkflow() });
    });
  });

  describe('update()', () => {
    it('PATCHes /api/workflows/:id with update data', () => {
      service.update(1, { name: 'Обновлено', is_active: false }).subscribe();
      const req = httpMock.expectOne('/api/workflows/1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Обновлено', is_active: false });
      req.flush({ success: true, data: makeWorkflow({ name: 'Обновлено' }) });
    });
  });

  describe('delete()', () => {
    it('DELETEs /api/workflows/:id', () => {
      service.delete(1).subscribe();
      const req = httpMock.expectOne('/api/workflows/1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('run()', () => {
    it('POSTs to /api/workflows/:id/run with optional payload', () => {
      service.run(1, { order_id: 'ord-1' }).subscribe();
      const req = httpMock.expectOne('/api/workflows/1/run');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ order_id: 'ord-1' });
      req.flush({ success: true, message: 'Workflow queued' });
    });
  });

  describe('getRuns()', () => {
    it('GETs /api/workflows/:id/runs with limit', () => {
      service.getRuns(1, 25).subscribe();
      const req = httpMock.expectOne('/api/workflows/1/runs?limit=25');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [], total: 0 });
    });
  });
});
