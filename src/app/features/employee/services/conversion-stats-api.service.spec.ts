import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ConversionStatsApiService, ConversionStatsData } from './conversion-stats-api.service';

const makeStats = (): ConversionStatsData => ({
  summary: {
    totalChats: 200, totalOrders: 40, totalBookings: 15,
    totalRevenue: 35000, conversionRate: 0.2, avgCheck: 875,
  },
  daily: [],
  byChannel: [],
});

describe('ConversionStatsApiService', () => {
  let service: ConversionStatsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ConversionStatsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getStats()', () => {
    it('GETs /api/crm/inbox/conversion-stats?period=30d', () => {
      service.getStats('30d').subscribe();
      const req = httpMock.expectOne('/api/crm/inbox/conversion-stats?period=30d');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeStats() });
    });

    it('sends different period values', () => {
      service.getStats('7d').subscribe();
      const req = httpMock.expectOne('/api/crm/inbox/conversion-stats?period=7d');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeStats() });
    });

    it('returns the stats data', () => {
      let result: ConversionStatsData | undefined;
      service.getStats('30d').subscribe(d => (result = d));
      httpMock.expectOne('/api/crm/inbox/conversion-stats?period=30d')
        .flush({ success: true, data: makeStats() });
      expect(result?.summary.conversionRate).toBe(0.2);
      expect(result?.summary.totalChats).toBe(200);
    });
  });
});
