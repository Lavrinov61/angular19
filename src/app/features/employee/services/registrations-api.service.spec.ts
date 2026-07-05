import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { RegistrationsApiService, RegistrationStatsData } from './registrations-api.service';

const makeStats = (): RegistrationStatsData => ({
  period: '30d',
  summary: {
    totalUsers: 100, newInPeriod: 20, previousPeriodNew: 15, clients: 85, staff: 15,
    viaYandex: 60, viaTelegram: 25, viaGoogle: 0, viaApple: 0, viaVk: 0, viaSber: 0, viaMts: 0,
    viaPhone: 5, viaEmail: 15, viaEmailUnverified: 0,
    emailVerified: 80, hasPhone: 70,
    conversionPct: 10, avgDaysToConversion: null, repeatVisitors: 0, topUtmSources: [],
  },
  daily: [],
  byRole: [],
});

describe('RegistrationsApiService', () => {
  let service: RegistrationsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(RegistrationsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── getStats ────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('GETs /api/crm/registrations/stats with period param', () => {
      service.getStats('30d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/registrations/stats');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('period')).toBe('30d');
      req.flush({ success: true, ...makeStats() });
    });

    it('returns stats data correctly', () => {
      let result: RegistrationStatsData | undefined;
      service.getStats('7d').subscribe(d => (result = d));
      const stats = makeStats();
      stats.period = '7d';
      httpMock.expectOne(r => r.url === '/api/crm/registrations/stats')
        .flush({ success: true, ...stats });
      expect(result?.period).toBe('7d');
      expect(result?.summary.totalUsers).toBe(100);
    });

    it('sends different period values', () => {
      service.getStats('90d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/registrations/stats');
      expect(req.request.params.get('period')).toBe('90d');
      req.flush({ success: true, ...makeStats() });
    });
  });

  // ─── getRecent ───────────────────────────────────────────────────────────

  describe('getRecent()', () => {
    it('GETs /api/crm/registrations/recent with period, page and limit', () => {
      service.getRecent('30d', 1, 50).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/registrations/recent');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('period')).toBe('30d');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('limit')).toBe('50');
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 50 });
    });

    it('uses defaults for page=1, limit=50', () => {
      service.getRecent('7d').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/registrations/recent');
      expect(req.request.params.get('page')).toBe('1');
      expect(req.request.params.get('limit')).toBe('50');
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 50 });
    });

    it('supports custom pagination', () => {
      service.getRecent('30d', 3, 25).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/registrations/recent');
      expect(req.request.params.get('page')).toBe('3');
      expect(req.request.params.get('limit')).toBe('25');
      req.flush({ success: true, data: [], total: 0, page: 3, limit: 25 });
    });

    it('supports phone provider filter', () => {
      service.getRecent('30d', 1, 50, { provider: 'phone' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/registrations/recent');
      expect(req.request.params.get('provider')).toBe('phone');
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 50 });
    });
  });
});
