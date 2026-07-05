import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CrmClientsApiService, ClientNote, ClientOrder, ClientLookupResult } from './crm-clients-api.service';

const makeNote = (overrides: Partial<ClientNote> = {}): ClientNote => ({
  id: 'note-1',
  text: 'Постоянный клиент',
  pinned: false,
  created_at: '2026-01-01T10:00:00Z',
  author_name: 'Иван',
  ...overrides,
});

const makeOrder = (overrides: Partial<ClientOrder> = {}): ClientOrder => ({
  type: 'print_order',
  id: 'ord-1',
  date: '2026-01-10',
  description: 'Фото 10×15 × 5',
  amount: 250,
  status: 'completed',
  client_name: 'Анна',
  ...overrides,
});

describe('CrmClientsApiService', () => {
  let service: CrmClientsApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CrmClientsApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── lookupClient ────────────────────────────────────────────────────────

  describe('lookupClient()', () => {
    it('GETs /api/crm/clients with search param', () => {
      service.lookupClient('+79001234567').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/crm/clients');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('search')).toBe('+79001234567');
      req.flush({ success: true, data: [] });
    });

    it('returns client lookup results', () => {
      let result: ClientLookupResult[] | undefined;
      service.lookupClient('+79001234567').subscribe(d => (result = d));
      const client: ClientLookupResult = {
        name: 'Анна', phone: '+79001234567', email: null,
        source: 'booking', source_id: 'bk-1',
        first_seen: '2025-01-01T00:00:00Z', last_activity: '2026-01-01T00:00:00Z',
        total_orders: 5,
      };
      httpMock.expectOne(r => r.url === '/api/crm/clients').flush({ success: true, data: [client] });
      expect(result).toHaveLength(1);
      expect(result![0].name).toBe('Анна');
    });
  });

  // ─── getClientOrders ─────────────────────────────────────────────────────

  describe('getClientOrders()', () => {
    it('GETs /api/crm/clients/:phone/orders (phone encoded)', () => {
      service.getClientOrders('+79001234567').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/orders'));
      expect(req.request.method).toBe('GET');
      expect(req.request.url).toContain(encodeURIComponent('+79001234567'));
      req.flush({ success: true, data: [] });
    });

    it('returns order list', () => {
      let result: ClientOrder[] | undefined;
      service.getClientOrders('+79001234567').subscribe(d => (result = d));
      httpMock.expectOne(r => r.url.includes('/orders')).flush({ success: true, data: [makeOrder()] });
      expect(result).toHaveLength(1);
    });
  });

  // ─── getNotes ────────────────────────────────────────────────────────────

  describe('getNotes()', () => {
    it('GETs /api/crm/clients/:phone/notes', () => {
      service.getNotes('+79001234567').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/notes') && !r.url.includes('note-'));
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });

  // ─── addNote ─────────────────────────────────────────────────────────────

  describe('addNote()', () => {
    it('POSTs to /api/crm/clients/:phone/notes with text and pinned', () => {
      service.addNote('+79001234567', 'Любит срочный заказ', true).subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/notes') && !r.url.includes('note-'));
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ text: 'Любит срочный заказ', pinned: true });
      req.flush({ success: true, data: makeNote({ text: 'Любит срочный заказ', pinned: true }) });
    });

    it('uses pinned=false by default', () => {
      service.addNote('+79001234567', 'Обычная заметка').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/notes') && !r.url.includes('note-'));
      expect(req.request.body.pinned).toBe(false);
      req.flush({ success: true, data: makeNote() });
    });
  });

  // ─── deleteNote ──────────────────────────────────────────────────────────

  describe('deleteNote()', () => {
    it('DELETEs /api/crm/clients/:phone/notes/:noteId', () => {
      service.deleteNote('+79001234567', 'note-1').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/notes/note-1'));
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  // ─── pinNote ─────────────────────────────────────────────────────────────

  describe('pinNote()', () => {
    it('PATCHes /api/crm/clients/:phone/notes/:noteId/pin with { pinned }', () => {
      service.pinNote('+79001234567', 'note-1', true).subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/pin'));
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ pinned: true });
      req.flush(null);
    });
  });

  // ─── getTimeline ─────────────────────────────────────────────────────────

  describe('getTimeline()', () => {
    it('GETs /api/crm/clients/:phone/timeline', () => {
      service.getTimeline('+79001234567').subscribe();
      const req = httpMock.expectOne(r => r.url.includes('/timeline'));
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });
});
