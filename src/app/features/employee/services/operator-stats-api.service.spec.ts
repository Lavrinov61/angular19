import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OperatorStatsApiService, OperatorStatsData } from './operator-stats-api.service';

const makeStats = (): OperatorStatsData => ({
  summary: {
    totalChats: 150, totalMessages: 1200,
    avgFirstResponseSec: 45, avgResolutionSec: 600,
  },
  operators: [
    {
      operator_id: 'emp-1', operator_name: 'Иван',
      chats_handled: 50, messages_sent: 400,
      avg_first_response_sec: 30, avg_resolution_sec: 500,
      active_sessions: 3, avg_csat: 4.8,
    },
  ],
});

describe('OperatorStatsApiService', () => {
  let service: OperatorStatsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OperatorStatsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getStats()', () => {
    it('GETs /api/crm/operator-stats?period=30d', () => {
      service.getStats('30d').subscribe();
      const req = httpMock.expectOne('/api/crm/operator-stats?period=30d');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeStats() });
    });

    it('uses correct period in URL for different values', () => {
      service.getStats('7d').subscribe();
      httpMock.expectOne('/api/crm/operator-stats?period=7d')
        .flush({ success: true, data: makeStats() });
    });

    it('returns the operator stats data', () => {
      let result: OperatorStatsData | undefined;
      service.getStats('30d').subscribe(d => (result = d));
      httpMock.expectOne('/api/crm/operator-stats?period=30d')
        .flush({ success: true, data: makeStats() });
      expect(result?.summary.totalChats).toBe(150);
      expect(result?.operators).toHaveLength(1);
      expect(result?.operators[0].operator_name).toBe('Иван');
    });
  });
});
