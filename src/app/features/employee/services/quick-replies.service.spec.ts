import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { QuickRepliesService, QuickReply } from './quick-replies.service';

const makeReply = (overrides: Partial<QuickReply> = {}): QuickReply => ({
  id: 'reply-1',
  category: 'greeting',
  trigger_keywords: ['привет'],
  title: 'Приветствие',
  content: 'Здравствуйте! Чем могу помочь?',
  sort_order: 1,
  ...overrides,
});

describe('QuickRepliesService', () => {
  let service: QuickRepliesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });

    service = TestBed.inject(QuickRepliesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── Initial state ─────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('replies is an empty array before any load', () => {
      expect(service.replies()).toEqual([]);
    });

    it('groups is an empty array before any load', () => {
      expect(service.groups()).toEqual([]);
    });
  });

  // ─── load() — once-only behaviour ─────────────────────────────────────────

  describe('load()', () => {
    it('makes an HTTP GET to /api/visitor-chat/quick-replies on first call', () => {
      service.load();

      const req = httpMock.expectOne('/api/visitor-chat/quick-replies');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });

    it('does NOT make a second HTTP request if called again after the first', () => {
      service.load();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [] });

      // Second call — no new request should appear
      service.load();
      httpMock.expectNone('/api/visitor-chat/quick-replies');
    });

    it('updates replies signal on successful response', () => {
      const replies = [makeReply(), makeReply({ id: 'reply-2', category: 'order', title: 'Заказ' })];
      service.load();

      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: replies });

      expect(service.replies()).toHaveLength(2);
      expect(service.replies()[0].id).toBe('reply-1');
    });

    it('does NOT update replies when success is false', () => {
      service.load();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: false, data: [] });

      expect(service.replies()).toEqual([]);
    });

    it('handles empty data array — replies remains []', () => {
      service.load();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [] });

      expect(service.replies()).toEqual([]);
      expect(service.groups()).toEqual([]);
    });
  });

  // ─── reload() ─────────────────────────────────────────────────────────────

  describe('reload()', () => {
    it('always makes an HTTP GET regardless of _loaded flag', () => {
      service.load();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [] });

      // reload() should still fire
      service.reload();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [] });
    });
  });

  // ─── groups computed ──────────────────────────────────────────────────────

  describe('groups computed', () => {
    it('groups replies by category and assigns localised label', () => {
      service.reload();
      const replies: QuickReply[] = [
        makeReply({ id: '1', category: 'greeting', title: 'Привет 1' }),
        makeReply({ id: '2', category: 'greeting', title: 'Привет 2' }),
        makeReply({ id: '3', category: 'order',    title: 'Заказ' }),
      ];
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: replies });

      const groups = service.groups();
      expect(groups).toHaveLength(2);

      const greetingGroup = groups.find(g => g.category === 'greeting');
      expect(greetingGroup).toBeDefined();
      expect(greetingGroup!.label).toBe('Приветствие');
      expect(greetingGroup!.replies).toHaveLength(2);

      const orderGroup = groups.find(g => g.category === 'order');
      expect(orderGroup).toBeDefined();
      expect(orderGroup!.label).toBe('Заказ');
      expect(orderGroup!.replies).toHaveLength(1);
    });

    it('uses the raw category key as label for unknown categories', () => {
      service.reload();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({
        success: true,
        data: [makeReply({ category: 'custom_cat' })],
      });

      const groups = service.groups();
      expect(groups[0].label).toBe('custom_cat');
    });

    it('recomputes groups when replies change', () => {
      service.reload();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [] });
      expect(service.groups()).toHaveLength(0);

      service.reload();
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({
        success: true,
        data: [makeReply()],
      });
      expect(service.groups()).toHaveLength(1);
    });
  });

  // ─── create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('POSTs to /api/visitor-chat/admin/quick-replies with the provided data', () => {
      const payload = { title: 'Новый ответ', content: 'Текст', category: 'price' };
      let result: QuickReply | undefined;

      service.create(payload).subscribe(r => (result = r));

      const createReq = httpMock.expectOne('/api/visitor-chat/admin/quick-replies');
      expect(createReq.request.method).toBe('POST');
      expect(createReq.request.body).toEqual(payload);

      const created = makeReply({ id: 'new-1', ...payload });
      createReq.flush({ success: true, data: created });

      // After tap, reload is called
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [created] });

      expect(result).toEqual(created);
    });

    it('calls reload() after successful create', () => {
      service.create({ title: 'T', content: 'C' }).subscribe();

      httpMock.expectOne('/api/visitor-chat/admin/quick-replies').flush({
        success: true, data: makeReply(),
      });

      // reload() must have been triggered
      const reloadReq = httpMock.expectOne('/api/visitor-chat/quick-replies');
      expect(reloadReq.request.method).toBe('GET');
      reloadReq.flush({ success: true, data: [] });
    });
  });

  // ─── update() ─────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('PUTs to /api/visitor-chat/admin/quick-replies/:id with the provided data', () => {
      const updates = { title: 'Updated', sort_order: 5 };
      service.update('reply-123', updates).subscribe();

      const req = httpMock.expectOne('/api/visitor-chat/admin/quick-replies/reply-123');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updates);
      req.flush({ success: true, data: makeReply({ title: 'Updated' }) });

      // reload after tap
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [] });
    });
  });

  // ─── remove() ─────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('DELETEs /api/visitor-chat/admin/quick-replies/:id', () => {
      service.remove('reply-456').subscribe();

      const req = httpMock.expectOne('/api/visitor-chat/admin/quick-replies/reply-456');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });

      // reload after tap
      httpMock.expectOne('/api/visitor-chat/quick-replies').flush({ success: true, data: [] });
    });

    it('calls reload() after successful delete', () => {
      let completed = false;
      service.remove('reply-789').subscribe({ complete: () => (completed = true) });

      httpMock.expectOne('/api/visitor-chat/admin/quick-replies/reply-789').flush({ success: true });

      const reloadReq = httpMock.expectOne('/api/visitor-chat/quick-replies');
      reloadReq.flush({ success: true, data: [] });
      expect(completed).toBe(true);
    });
  });
});
