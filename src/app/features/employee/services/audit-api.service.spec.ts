import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuditApiService, AuditEntry } from './audit-api.service';

const makeEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  id: 'entry-1',
  user_id: 'user-1',
  user_name: 'Иван',
  action: 'update_status',
  entity_type: 'order',
  entity_id: 'order-1',
  details: { old: 'new', new: 'processing' },
  ip: '127.0.0.1',
  created_at: '2026-01-01T10:00:00Z',
  ...overrides,
});

describe('AuditApiService', () => {
  let service: AuditApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuditApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getAuditLog()', () => {
    it('GETs /api/crm/audit without params when empty filters', () => {
      service.getAuditLog({}).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/audit');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, data: [], total: 0 });
    });

    it('passes userId filter', () => {
      service.getAuditLog({ userId: 'user-1' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/audit');
      expect(req.request.params.get('userId')).toBe('user-1');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('passes action filter', () => {
      service.getAuditLog({ action: 'update_status' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/audit');
      expect(req.request.params.get('action')).toBe('update_status');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('passes entityType filter', () => {
      service.getAuditLog({ entityType: 'order' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/audit');
      expect(req.request.params.get('entityType')).toBe('order');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('passes date range filters', () => {
      service.getAuditLog({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/audit');
      expect(req.request.params.get('dateFrom')).toBe('2026-01-01');
      expect(req.request.params.get('dateTo')).toBe('2026-01-31');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('passes limit and offset as strings', () => {
      service.getAuditLog({ limit: 25, offset: 50 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/audit');
      expect(req.request.params.get('limit')).toBe('25');
      expect(req.request.params.get('offset')).toBe('50');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('returns items and total from response', () => {
      let result: { items: AuditEntry[]; total: number } | undefined;
      service.getAuditLog({}).subscribe(d => (result = d));
      httpMock.expectOne(r => r.url === '/api/crm/audit')
        .flush({ success: true, data: [makeEntry()], total: 1 });
      expect(result?.total).toBe(1);
      expect(result?.items).toHaveLength(1);
      expect(result?.items[0].action).toBe('update_status');
    });
  });
});
