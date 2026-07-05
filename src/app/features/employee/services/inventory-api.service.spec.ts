import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { InventoryApiService, ReceiveItemPayload } from './inventory-api.service';
import { LowStockItem } from './pos-api.service';

const makeReceivePayload = (overrides: Partial<ReceiveItemPayload> = {}): ReceiveItemPayload => ({
  product_id: 'prod-1',
  quantity: 10,
  condition: 'good',
  ...overrides,
});

describe('InventoryApiService', () => {
  let service: InventoryApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InventoryApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── receiveItems ────────────────────────────────────────────────────────

  describe('receiveItems()', () => {
    it('POSTs to /api/inventory/receive with full data', () => {
      const data = {
        studio_id: 'studio-1',
        items: [makeReceivePayload()],
        supplier: 'ООО Поставщик',
        invoice_number: 'INV-001',
      };
      service.receiveItems(data).subscribe();
      const req = httpMock.expectOne('/api/inventory/receive');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush(null);
    });

    it('works without optional fields', () => {
      service.receiveItems({ studio_id: 'studio-1', items: [makeReceivePayload()] }).subscribe();
      const req = httpMock.expectOne('/api/inventory/receive');
      expect(req.request.body.supplier).toBeUndefined();
      req.flush(null);
    });

    it('includes damaged items', () => {
      const data = {
        studio_id: 'studio-1',
        items: [makeReceivePayload({ condition: 'damaged', notes: 'Помятая упаковка' })],
      };
      service.receiveItems(data).subscribe();
      const req = httpMock.expectOne('/api/inventory/receive');
      expect(req.request.body.items[0].condition).toBe('damaged');
      req.flush(null);
    });
  });

  // ─── getReceipts ─────────────────────────────────────────────────────────

  describe('getReceipts()', () => {
    it('GETs /api/inventory/receipts without params by default', () => {
      service.getReceipts().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/inventory/receipts');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, receipts: [], total: 0 });
    });

    it('passes studio_id filter', () => {
      service.getReceipts({ studio_id: 'studio-1' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/inventory/receipts');
      expect(req.request.params.get('studio_id')).toBe('studio-1');
      req.flush({ success: true, receipts: [], total: 0 });
    });

    it('passes date filters', () => {
      service.getReceipts({ date_from: '2026-01-01', date_to: '2026-01-31' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/inventory/receipts');
      expect(req.request.params.get('date_from')).toBe('2026-01-01');
      expect(req.request.params.get('date_to')).toBe('2026-01-31');
      req.flush({ success: true, receipts: [], total: 0 });
    });

    it('converts limit and offset to string', () => {
      service.getReceipts({ limit: 20, offset: 40 }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/inventory/receipts');
      expect(req.request.params.get('limit')).toBe('20');
      expect(req.request.params.get('offset')).toBe('40');
      req.flush({ success: true, receipts: [], total: 0 });
    });
  });

  // ─── getReceiptById ──────────────────────────────────────────────────────

  describe('getReceiptById()', () => {
    it('GETs /api/inventory/receipts/:id', () => {
      service.getReceiptById('receipt-abc').subscribe();
      const req = httpMock.expectOne('/api/inventory/receipts/receipt-abc');
      expect(req.request.method).toBe('GET');
      req.flush({
        success: true, receipt: {
          id: 'receipt-abc', employee_id: 'e1', employee_name: 'Ваня',
          studio_id: 's1', studio_name: 'Студия', supplier: null,
          invoice_number: null, items: [], total_items: 0,
          notes: null, received_at: '2026-01-01T10:00:00Z',
        },
      });
    });
  });

  // ─── getLowStock ─────────────────────────────────────────────────────────

  describe('getLowStock()', () => {
    it('GETs /api/inventory/low-stock/:studioId', () => {
      service.getLowStock('studio-1').subscribe();
      const req = httpMock.expectOne('/api/inventory/low-stock/studio-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, items: [] });
    });

    it('returns an array of low-stock items', () => {
      let result: LowStockItem[] | undefined;
      service.getLowStock('studio-1').subscribe(r => (result = r));
      const item: LowStockItem = {
        product_id: 'p1', product_name: 'Бумага 10×15', category_name: 'Расходники',
        current_stock: 2, min_quantity: 10, unit: 'упак',
      };
      httpMock.expectOne('/api/inventory/low-stock/studio-1').flush({ success: true, items: [item] });
      expect(result).toHaveLength(1);
      expect(result![0].product_id).toBe('p1');
    });
  });

  // ─── getStock ────────────────────────────────────────────────────────────

  describe('getStock()', () => {
    it('GETs /api/catalog/stock/:studioId', () => {
      service.getStock('studio-1').subscribe();
      const req = httpMock.expectOne('/api/catalog/stock/studio-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, stock: [] });
    });
  });

  // ─── setMinStock ─────────────────────────────────────────────────────────

  describe('setMinStock()', () => {
    it('PUTs to /api/inventory/stock/:productId/min with studio_id and min_quantity', () => {
      service.setMinStock('prod-1', 'studio-1', 5).subscribe();
      const req = httpMock.expectOne('/api/inventory/stock/prod-1/min');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ studio_id: 'studio-1', min_quantity: 5 });
      req.flush(null);
    });
  });
});
