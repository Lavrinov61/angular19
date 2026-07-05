import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ReplayApiService, ReplayStats, ReplaySession } from './replay-api.service';

const mockStats: ReplayStats = {
  total_sessions: 100, avg_duration: 120, error_sessions: 5,
  desktop_count: 70, mobile_count: 25, tablet_count: 5, unique_visitors: 80,
};

const mockSession: ReplaySession = {
  id: 'sess-1', visitor_id: 'v1', user_id: null, landing_page: '/', device_type: 'desktop',
  started_at: '2025-01-01T10:00:00Z', ended_at: '2025-01-01T10:10:00Z', duration_seconds: 600,
  total_pages: 3, total_clicks: 15, chunk_count: 2, has_error: false, is_complete: true,
};

describe('ReplayApiService', () => {
  let service: ReplayApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ReplayApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── getStats ───────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('GETs /api/replay/stats with default days=30', () => {
      service.getStats().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/stats');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('days')).toBe('30');
      req.flush({ success: true, data: mockStats });
    });

    it('passes custom days parameter', () => {
      service.getStats(7).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/stats');
      expect(req.request.params.get('days')).toBe('7');
      req.flush({ success: true, data: mockStats });
    });

    it('unwraps the data field from the response envelope', () => {
      let result: ReplayStats | undefined;
      service.getStats().subscribe(r => (result = r));
      httpMock.expectOne(r => r.url === '/api/replay/stats').flush({ success: true, data: mockStats });
      expect(result).toEqual(mockStats);
    });
  });

  // ─── getSessions ────────────────────────────────────────────────────────────

  describe('getSessions()', () => {
    it('GETs /api/replay/sessions with no params when called with empty options', () => {
      service.getSessions({}).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/sessions');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, data: [], pagination: { total: 0, pages: 0 } });
    });

    it('adds phone param when provided', () => {
      service.getSessions({ phone: '79001234567' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/sessions');
      expect(req.request.params.get('phone')).toBe('79001234567');
      req.flush({ success: true, data: [], pagination: { total: 0, pages: 0 } });
    });

    it('adds days, device_type, sort, sort_dir params when provided', () => {
      service.getSessions({ days: 14, device_type: 'mobile', sort: 'duration_seconds', sort_dir: 'asc' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/sessions');
      expect(req.request.params.get('days')).toBe('14');
      expect(req.request.params.get('device_type')).toBe('mobile');
      expect(req.request.params.get('sort')).toBe('duration_seconds');
      expect(req.request.params.get('sort_dir')).toBe('asc');
      req.flush({ success: true, data: [], pagination: { total: 0, pages: 0 } });
    });

    it('adds has_error=true param when provided', () => {
      service.getSessions({ has_error: true }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/sessions');
      expect(req.request.params.get('has_error')).toBe('true');
      req.flush({ success: true, data: [], pagination: { total: 0, pages: 0 } });
    });

    it('does NOT add has_error param when it is null/undefined', () => {
      service.getSessions({}).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/sessions');
      expect(req.request.params.has('has_error')).toBe(false);
      req.flush({ success: true, data: [], pagination: { total: 0, pages: 0 } });
    });

    it('returns both data and pagination from response', () => {
      let result: { data: ReplaySession[]; pagination: { total: number; pages: number } } | undefined;
      service.getSessions().subscribe(r => (result = r));
      httpMock.expectOne(r => r.url === '/api/replay/sessions').flush({
        success: true,
        data: [mockSession],
        pagination: { total: 1, pages: 1 },
      });
      expect(result?.data).toHaveLength(1);
      expect(result?.pagination.total).toBe(1);
    });
  });

  // ─── getSessionDetails ───────────────────────────────────────────────────────

  describe('getSessionDetails()', () => {
    it('GETs /api/replay/sessions/:id', () => {
      service.getSessionDetails('sess-42').subscribe();
      const req = httpMock.expectOne('/api/replay/sessions/sess-42');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: { ...mockSession, event_summary: [] } });
    });
  });

  // ─── getSessionChunks ────────────────────────────────────────────────────────

  describe('getSessionChunks()', () => {
    it('GETs /api/replay/sessions/:id/chunks', () => {
      service.getSessionChunks('sess-42').subscribe();
      const req = httpMock.expectOne('/api/replay/sessions/sess-42/chunks');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: { chunks: [], timeline: [] } });
    });
  });

  // ─── getHeatmapData ───────────────────────────────────────────────────────────

  describe('getHeatmapData()', () => {
    it('GETs /api/replay/heatmap with no params by default', () => {
      service.getHeatmapData().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/heatmap');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, data: { clicks: [], pages: [] } });
    });

    it('includes page_path, days and device_type when provided', () => {
      service.getHeatmapData({ page_path: '/services', days: 30, device_type: 'desktop' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/heatmap');
      expect(req.request.params.get('page_path')).toBe('/services');
      expect(req.request.params.get('days')).toBe('30');
      expect(req.request.params.get('device_type')).toBe('desktop');
      req.flush({ success: true, data: { clicks: [], pages: [] } });
    });
  });

  // ─── getFunnelData ────────────────────────────────────────────────────────────

  describe('getFunnelData()', () => {
    it('GETs /api/replay/analytics/funnel with default days=30', () => {
      service.getFunnelData().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/analytics/funnel');
      expect(req.request.params.get('days')).toBe('30');
      req.flush({ success: true, data: [] });
    });

    it('passes custom days param', () => {
      service.getFunnelData(60).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/analytics/funnel');
      expect(req.request.params.get('days')).toBe('60');
      req.flush({ success: true, data: [] });
    });
  });

  // ─── getTopPages ──────────────────────────────────────────────────────────────

  describe('getTopPages()', () => {
    it('GETs /api/replay/analytics/top-pages with default days=30', () => {
      service.getTopPages().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/analytics/top-pages');
      expect(req.request.params.get('days')).toBe('30');
      req.flush({ success: true, data: [] });
    });

    it('passes custom days param', () => {
      service.getTopPages(14).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/replay/analytics/top-pages');
      expect(req.request.params.get('days')).toBe('14');
      req.flush({ success: true, data: [] });
    });
  });
});
