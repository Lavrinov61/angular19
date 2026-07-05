import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { OrdersApiService, PhotoPrintOrder, CreateWalkInOrderRequest } from './orders-api.service';

const makeOrder = (overrides: Partial<PhotoPrintOrder> = {}): PhotoPrintOrder => ({
  id: 'order-1',
  order_id: 'ORD-001',
  contact_name: 'Иван Иванов',
  contact_phone: '+79001234567',
  contact_email: null,
  total_price: 500,
  status: 'new',
  payment_status: 'none',
  priority: 'normal',
  items: [],
  comments: null,
  delivery_address: null,
  delivery_cost: null,
  tracking_number: null,
  receipt_url: null,
  payment_card_info: null,
  telegram_username: null,
  promo_code: null,
  promo_discount: null,
  created_at: '2025-01-01T10:00:00Z',
  updated_at: '2025-01-01T10:00:00Z',
  paid_at: null,
  completed_at: null,
  assigned_employee_id: null,
  assigned_at: null,
  chat_session_id: null,
  reminder_sent_at: null,
  ...overrides,
});

const okEnvelope = (data: unknown) => ({ success: true, data });

describe('OrdersApiService', () => {
  let service: OrdersApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(OrdersApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  // ─── getOrders ─────────────────────────────────────────────────────────────

  describe('getOrders()', () => {
    it('GETs /api/orders/photo-print/staff-list with no params by default', () => {
      service.getOrders().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/orders/photo-print/staff-list');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 50 });
    });

    it('adds status, priority, search and page params when provided', () => {
      service.getOrders({ status: 'processing', priority: 'urgent', search: 'Иван', page: 2 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/orders/photo-print/staff-list');
      expect(req.request.params.get('status')).toBe('processing');
      expect(req.request.params.get('priority')).toBe('urgent');
      expect(req.request.params.get('search')).toBe('Иван');
      expect(req.request.params.get('page')).toBe('2');
      req.flush({ success: true, data: [], total: 0, page: 2, limit: 50 });
    });

    it('adds chat_session_id when provided', () => {
      service.getOrders({ chat_session_id: 'session-42', limit: 10 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/orders/photo-print/staff-list');
      expect(req.request.params.get('chat_session_id')).toBe('session-42');
      expect(req.request.params.get('limit')).toBe('10');
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 10 });
    });

    it('omits empty-string params from the query string', () => {
      service.getOrders({ status: '', payment_status: 'paid' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/orders/photo-print/staff-list');
      expect(req.request.params.has('status')).toBe(false);
      expect(req.request.params.get('payment_status')).toBe('paid');
      req.flush({ success: true, data: [], total: 0, page: 1, limit: 50 });
    });
  });

  // ─── updateStatus ─────────────────────────────────────────────────────────

  describe('updateStatus()', () => {
    it('PUTs to /api/orders/photo-print/:id/status with { status }', () => {
      service.updateStatus('order-1', 'processing').subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/order-1/status');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ status: 'processing' });
      req.flush(okEnvelope(makeOrder({ status: 'processing' })));
    });
  });

  // ─── editOrder ─────────────────────────────────────────────────────────────

  describe('editOrder()', () => {
    it('PUTs to /api/orders/photo-print/:id/edit with partial update fields', () => {
      const updates = { contact_name: 'Новое имя', priority: 'high' as const };
      service.editOrder('order-2', updates).subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/order-2/edit');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updates);
      req.flush(okEnvelope(makeOrder(updates)));
    });
  });

  // ─── assignOrder ──────────────────────────────────────────────────────────

  describe('assignOrder()', () => {
    it('PUTs to /api/orders/photo-print/:id/assign with { employee_id }', () => {
      service.assignOrder('order-3', 'emp-12').subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/order-3/assign');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ employee_id: 'emp-12' });
      req.flush(okEnvelope(makeOrder({ assigned_employee_id: 'emp-12' })));
    });

    it('sends null to unassign an order', () => {
      service.assignOrder('order-3', null).subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/order-3/assign');
      expect(req.request.body).toEqual({ employee_id: null });
      req.flush(okEnvelope(makeOrder()));
    });
  });

  // ─── getOrderQueue ────────────────────────────────────────────────────────

  describe('getOrderQueue()', () => {
    it('GETs /api/orders/photo-print/staff-list/queue with bucket=active by default', () => {
      service.getOrderQueue().subscribe();
      const req = httpMock.expectOne(r =>
        r.url === '/api/orders/photo-print/staff-list/queue' && r.params.get('bucket') === 'active');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [], total: 0, staleTotal: 0, page: 1, limit: 40 });
    });

    it('passes bucket=stale for the "Зависшие" tab', () => {
      service.getOrderQueue('stale').subscribe();
      const req = httpMock.expectOne(r =>
        r.url === '/api/orders/photo-print/staff-list/queue' && r.params.get('bucket') === 'stale');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [], total: 0, staleTotal: 0, page: 1, limit: 100 });
    });
  });

  // ─── createWalkInOrder ────────────────────────────────────────────────────

  describe('createWalkInOrder()', () => {
    it('POSTs to /api/orders/photo-print/walk-in with the full order data', () => {
      const orderData: CreateWalkInOrderRequest = {
        items: [{ name: '10×15', quantity: 10, price: 50 }],
        client_name: 'Ольга',
        client_phone: '+79009876543',
        total_price: 500,
        payment_method: 'card',
      };
      service.createWalkInOrder(orderData).subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/walk-in');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(orderData);
      req.flush(okEnvelope({ orderId: 'new-order-1', receiptNumber: '#001', taskId: null, taskNumber: null, activeTaskCount: 0 }));
    });

    it('works without optional fields (client_name, payment_method)', () => {
      const minimal: CreateWalkInOrderRequest = {
        items: [{ name: '10×15', quantity: 5, price: 50 }],
        total_price: 250,
      };
      service.createWalkInOrder(minimal).subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/walk-in');
      expect(req.request.body).toEqual(minimal);
      req.flush(okEnvelope({ orderId: 'o2', receiptNumber: null, taskId: null, taskNumber: null, activeTaskCount: 0 }));
    });
  });

  // ─── linkChatSession ─────────────────────────────────────────────────────

  describe('linkChatSession()', () => {
    it('PUTs to /api/orders/photo-print/:id/edit with { chat_session_id }', () => {
      service.linkChatSession('order-5', 'sess-abc').subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/order-5/edit');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ chat_session_id: 'sess-abc' });
      req.flush(okEnvelope(makeOrder({ chat_session_id: 'sess-abc' })));
    });

    it('can unlink a session by passing null', () => {
      service.linkChatSession('order-5', null).subscribe();
      const req = httpMock.expectOne('/api/orders/photo-print/order-5/edit');
      expect(req.request.body).toEqual({ chat_session_id: null });
      req.flush(okEnvelope(makeOrder()));
    });
  });
});
