import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  ProductionApiService, PrintingHouse, ProductionOrder,
} from './production-api.service';

const makeHouse = (overrides: Partial<PrintingHouse> = {}): PrintingHouse => ({
  id: 'house-1',
  name: 'ООО Типография',
  code: 'TYPO',
  status: 'active',
  contact_name: null, contact_phone: null, contact_email: null,
  website: null, address: null, notes: null,
  api_type: 'manual',
  capabilities: [], delivery_zones: [],
  min_order_amount: 0, quality_score: 4.5, on_time_rate: 0.9,
  defect_rate: 0.02, total_orders: 10, total_spent: 5000,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeOrder = (overrides: Partial<ProductionOrder> = {}): ProductionOrder => ({
  id: 'pord-1', order_number: 'PROD-001',
  printing_house_id: 'house-1', photo_print_order_id: null,
  customer_id: null, created_by: 'emp-1',
  status: 'pending',
  items: [], total_cost: 500,
  deadline_at: null, estimated_delivery_at: null, actual_delivery_at: null,
  delivery_method: 'pickup', tracking_number: null,
  quality_rating: null, quality_notes: null, has_defects: false,
  internal_notes: null, printing_house_notes: null,
  sent_at: null, confirmed_at: null, completed_at: null,
  cancelled_at: null, cancel_reason: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('ProductionApiService', () => {
  let service: ProductionApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ProductionApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── Houses ──────────────────────────────────────────────────────────────

  describe('getHouses()', () => {
    it('GETs /api/production/houses without params by default', () => {
      service.getHouses().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/production/houses');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, data: [] });
    });

    it('passes status filter when provided', () => {
      service.getHouses('active').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/production/houses');
      expect(req.request.params.get('status')).toBe('active');
      req.flush({ success: true, data: [] });
    });
  });

  describe('getHouse()', () => {
    it('GETs /api/production/houses/:id', () => {
      service.getHouse('house-1').subscribe();
      const req = httpMock.expectOne('/api/production/houses/house-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makeHouse() });
    });
  });

  describe('createHouse()', () => {
    it('POSTs to /api/production/houses', () => {
      const data = { name: 'Новая типография', code: 'NEW', api_type: 'manual' as const };
      service.createHouse(data).subscribe();
      const req = httpMock.expectOne('/api/production/houses');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, data: makeHouse() });
    });
  });

  describe('updateHouse()', () => {
    it('PATCHes /api/production/houses/:id', () => {
      service.updateHouse('house-1', { name: 'Обновлено' }).subscribe();
      const req = httpMock.expectOne('/api/production/houses/house-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Обновлено' });
      req.flush({ success: true, data: makeHouse({ name: 'Обновлено' }) });
    });
  });

  describe('deleteHouse()', () => {
    it('DELETEs /api/production/houses/:id', () => {
      service.deleteHouse('house-1').subscribe();
      const req = httpMock.expectOne('/api/production/houses/house-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  // ─── Products ────────────────────────────────────────────────────────────

  describe('getProducts()', () => {
    it('GETs /api/production/houses/:houseId/products', () => {
      service.getProducts('house-1').subscribe();
      const req = httpMock.expectOne('/api/production/houses/house-1/products');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });

  describe('getAllProducts()', () => {
    it('GETs /api/production/products', () => {
      service.getAllProducts().subscribe();
      const req = httpMock.expectOne('/api/production/products');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });

  describe('compareProducts()', () => {
    it('GETs /api/production/products/compare/:category', () => {
      service.compareProducts('photobook').subscribe();
      const req = httpMock.expectOne('/api/production/products/compare/photobook');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });

  // ─── Orders ──────────────────────────────────────────────────────────────

  describe('getOrders()', () => {
    it('GETs /api/production/orders without params by default', () => {
      service.getOrders().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/production/orders');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, data: { orders: [], total: 0 } });
    });

    it('passes all filter params', () => {
      service.getOrders({ status: 'pending', printing_house_id: 'house-1', limit: 10, offset: 20 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/production/orders');
      expect(req.request.params.get('status')).toBe('pending');
      expect(req.request.params.get('printing_house_id')).toBe('house-1');
      expect(req.request.params.get('limit')).toBe('10');
      expect(req.request.params.get('offset')).toBe('20');
      req.flush({ success: true, data: { orders: [], total: 0 } });
    });
  });

  describe('createOrder()', () => {
    it('POSTs to /api/production/orders with order data', () => {
      const data = {
        printing_house_id: 'house-1',
        items: [{ product_id: 'p1', product_name: 'Фотокнига', specs: {}, quantity: 1, unit_price: 500, total_price: 500 }],
        delivery_method: 'pickup',
      };
      service.createOrder(data).subscribe();
      const req = httpMock.expectOne('/api/production/orders');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.printing_house_id).toBe('house-1');
      req.flush({ success: true, data: makeOrder() });
    });
  });

  describe('updateOrderStatus()', () => {
    it('PATCHes /api/production/orders/:id/status', () => {
      service.updateOrderStatus('pord-1', 'sent', 'Отправлено').subscribe();
      const req = httpMock.expectOne('/api/production/orders/pord-1/status');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ status: 'sent', comment: 'Отправлено' });
      req.flush({ success: true, data: makeOrder({ status: 'sent' }) });
    });
  });

  describe('cancelOrder()', () => {
    it('POSTs to /api/production/orders/:id/cancel with reason', () => {
      service.cancelOrder('pord-1', 'Ошибка').subscribe();
      const req = httpMock.expectOne('/api/production/orders/pord-1/cancel');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ reason: 'Ошибка' });
      req.flush({ success: true, data: makeOrder({ status: 'cancelled' }) });
    });
  });

  describe('rateQuality()', () => {
    it('POSTs to /api/production/orders/:id/quality', () => {
      service.rateQuality('pord-1', 5, 'Отлично').subscribe();
      const req = httpMock.expectOne('/api/production/orders/pord-1/quality');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.rating).toBe(5);
      req.flush({ success: true, data: makeOrder({ quality_rating: 5 }) });
    });
  });

  describe('getTimeline()', () => {
    it('GETs /api/production/orders/:id/timeline', () => {
      service.getTimeline('pord-1').subscribe();
      const req = httpMock.expectOne('/api/production/orders/pord-1/timeline');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });
  });

  // ─── Analytics ───────────────────────────────────────────────────────────

  describe('getAnalytics()', () => {
    it('GETs /api/production/analytics', () => {
      service.getAnalytics().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/production/analytics');
      expect(req.request.method).toBe('GET');
      req.flush({
        success: true, data: {
          spending_by_house: [], spending_by_category: [],
          delivery_performance: { on_time_pct: 0, avg_delay_days: 0, total_orders: 0 },
          quality_metrics: { avg_rating: 0, defect_rate: 0, reprint_count: 0 },
          monthly_trends: [], status_distribution: [],
        },
      });
    });
  });

  // ─── Reference Data ──────────────────────────────────────────────────────

  describe('getReferenceData()', () => {
    it('GETs /api/production/reference-data without params by default', () => {
      service.getReferenceData().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/production/reference-data');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [] });
    });

    it('passes type and category params', () => {
      service.getReferenceData('paper', 'photobook').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/production/reference-data');
      expect(req.request.params.get('type')).toBe('paper');
      expect(req.request.params.get('category')).toBe('photobook');
      req.flush({ success: true, data: [] });
    });
  });
});
