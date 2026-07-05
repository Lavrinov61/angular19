import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChannelAdminApiService, ChannelStatus } from './channel-admin-api.service';

const makeChannelStatus = (channel = 'telegram'): ChannelStatus => ({
  channel,
  connectorEnabled: true,
  disabled: false,
  health: 'healthy',
  summary: 'Всё в порядке',
  circuitBreaker: { state: 'CLOSED', failures: 0, lastError: null, lastSuccessAt: null, lastFailureAt: null },
  queueDepth: 0,
  metrics24h: { sent: 100, received: 50, delivered: 95, failed: 5, avgDeliveryMs: 120 },
});

describe('ChannelAdminApiService', () => {
  let service: ChannelAdminApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ChannelAdminApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getChannels()', () => {
    it('GETs /api/admin/channels', () => {
      service.getChannels().subscribe();
      const req = httpMock.expectOne('/api/admin/channels');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [makeChannelStatus()] });
    });
  });

  describe('getChannelStats()', () => {
    it('GETs /api/admin/channels/:channel/stats', () => {
      service.getChannelStats('telegram').subscribe();
      const req = httpMock.expectOne('/api/admin/channels/telegram/stats');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: { channel: 'telegram', days: [], recentErrors: [] } });
    });
  });

  describe('toggleChannel()', () => {
    it('POSTs to /api/admin/channels/:channel/toggle with { enabled }', () => {
      service.toggleChannel('whatsapp', false).subscribe();
      const req = httpMock.expectOne('/api/admin/channels/whatsapp/toggle');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ enabled: false });
      req.flush({ success: true });
    });
  });

  describe('getDeadLetters()', () => {
    it('GETs /api/admin/channels/dead-letters with no params', () => {
      service.getDeadLetters({}).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/admin/channels/dead-letters'));
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [], pagination: { page: 1, limit: 20, total: 0 } });
    });

    it('appends pagination params to URL', () => {
      service.getDeadLetters({ page: 2, limit: 10, channel: 'vk' }).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/admin/channels/dead-letters'));
      expect(req.request.url).toContain('page=2');
      expect(req.request.url).toContain('limit=10');
      expect(req.request.url).toContain('channel=vk');
      req.flush({ success: true, data: [], pagination: { page: 2, limit: 10, total: 0 } });
    });
  });

  describe('retryDeadLetter()', () => {
    it('POSTs to /api/admin/channels/dead-letters/:id/retry', () => {
      service.retryDeadLetter('dl-1').subscribe();
      const req = httpMock.expectOne('/api/admin/channels/dead-letters/dl-1/retry');
      expect(req.request.method).toBe('POST');
      req.flush({ success: true });
    });
  });

  describe('getChannelHealth()', () => {
    it('GETs /api/admin/channels/:channel/health', () => {
      service.getChannelHealth('telegram').subscribe();
      const req = httpMock.expectOne('/api/admin/channels/telegram/health');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: { channel: 'telegram', health: 'healthy' } });
    });
  });

  describe('getHealth()', () => {
    it('GETs /api/admin/channels/health', () => {
      service.getHealth().subscribe();
      const req = httpMock.expectOne('/api/admin/channels/health');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, status: 'ok', channels: {} });
    });
  });
});
