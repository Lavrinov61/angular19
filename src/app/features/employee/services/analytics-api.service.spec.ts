import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AnalyticsApiService } from './analytics-api.service';

describe('AnalyticsApiService', () => {
  let service: AnalyticsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnalyticsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── getFunnel ────────────────────────────────────────────────────────────

  describe('getFunnel()', () => {
    it('GETs /api/crm/analytics/funnel with type and period params', () => {
      service.getFunnel('online', '30d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/analytics/funnel');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('type')).toBe('online');
      expect(req.request.params.get('period')).toBe('30d');
      req.flush({ success: true, type: 'online', period: '30d', steps: [] });
    });

    it('sends studio type correctly', () => {
      service.getFunnel('studio', '7d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/analytics/funnel');
      expect(req.request.params.get('type')).toBe('studio');
      req.flush({ success: true, type: 'studio', period: '7d', steps: [] });
    });
  });

  // ─── getCohorts ──────────────────────────────────────────────────────────

  describe('getCohorts()', () => {
    it('GETs /api/crm/analytics/cohorts with groupBy and period params', () => {
      service.getCohorts('week', '90d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/analytics/cohorts');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('groupBy')).toBe('week');
      expect(req.request.params.get('period')).toBe('90d');
      req.flush({ success: true, groupBy: 'week', period: '90d', cohorts: [] });
    });

    it('supports month groupBy', () => {
      service.getCohorts('month', '180d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/analytics/cohorts');
      expect(req.request.params.get('groupBy')).toBe('month');
      req.flush({ success: true, groupBy: 'month', period: '180d', cohorts: [] });
    });
  });

  // ─── getRetention ─────────────────────────────────────────────────────────

  describe('getRetention()', () => {
    it('GETs /api/crm/analytics/retention with period param', () => {
      service.getRetention('30d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/analytics/retention');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('period')).toBe('30d');
      req.flush({
        success: true, period: '30d',
        totalCustomers: 100, chatToOrderRate: 0.3, retention: [],
      });
    });
  });

  // ─── getChannels ──────────────────────────────────────────────────────────

  describe('getChannels()', () => {
    it('GETs /api/crm/analytics/channels with period param', () => {
      service.getChannels('30d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/analytics/channels');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('period')).toBe('30d');
      req.flush({
        success: true, period: '30d', onlineChannels: [],
        posTotal: { receipts: 0, revenue: 0 },
      });
    });
  });
});
