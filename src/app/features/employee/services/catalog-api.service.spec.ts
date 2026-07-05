import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CatalogApiService, Product, ProductCategory } from './catalog-api.service';

const makeProduct = (overrides: Partial<Product> = {}): Product => ({
  id: 'prod-1',
  category_id: 'cat-1',
  name: 'Фото 10×15',
  product_type: 'product',
  code: null, barcode: null, unit: 'шт',
  sell_price: 50, cost_price: 20, vat_rate: 'none',
  is_discount_allowed: true, is_bonus_allowed: true,
  is_subscription_eligible: false, subscription_credit_value: null,
  image_url: null, sort_order: 1,
  is_active: true, is_favorite: false,
  ...overrides,
});

const makeCategory = (overrides: Partial<ProductCategory> = {}): ProductCategory => ({
  id: 'cat-1',
  parent_id: null,
  name: 'Фото',
  sort_order: 1,
  icon: null,
  is_active: true,
  ...overrides,
});

describe('CatalogApiService', () => {
  let service: CatalogApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CatalogApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── Categories ──────────────────────────────────────────────────────────

  describe('getCategories()', () => {
    it('GETs /api/catalog/categories', () => {
      service.getCategories().subscribe();
      const req = httpMock.expectOne('/api/catalog/categories');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, categories: [] });
    });

    it('returns the categories array', () => {
      let result: ProductCategory[] | undefined;
      service.getCategories().subscribe(c => (result = c));
      httpMock.expectOne('/api/catalog/categories')
        .flush({ success: true, categories: [makeCategory()] });
      expect(result).toHaveLength(1);
      expect(result![0].id).toBe('cat-1');
    });
  });

  describe('createCategory()', () => {
    it('POSTs to /api/catalog/categories', () => {
      const data = { name: 'Новая', sort_order: 10 };
      service.createCategory(data).subscribe();
      const req = httpMock.expectOne('/api/catalog/categories');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, category: makeCategory() });
    });
  });

  describe('updateCategory()', () => {
    it('PATCHes /api/catalog/categories/:id', () => {
      service.updateCategory('cat-1', { name: 'Обновлено' }).subscribe();
      const req = httpMock.expectOne('/api/catalog/categories/cat-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Обновлено' });
      req.flush({ success: true, category: makeCategory({ name: 'Обновлено' }) });
    });
  });

  describe('deleteCategory()', () => {
    it('DELETEs /api/catalog/categories/:id', () => {
      service.deleteCategory('cat-1').subscribe();
      const req = httpMock.expectOne('/api/catalog/categories/cat-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  // ─── Products ────────────────────────────────────────────────────────────

  describe('getProducts()', () => {
    it('GETs /api/catalog/products without params by default', () => {
      service.getProducts().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/catalog/products');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys()).toHaveLength(0);
      req.flush({ success: true, items: [], total: 0 });
    });

    it('passes category_id filter', () => {
      service.getProducts({ category_id: 'cat-1' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/catalog/products');
      expect(req.request.params.get('category_id')).toBe('cat-1');
      req.flush({ success: true, items: [], total: 0 });
    });

    it('passes search filter', () => {
      service.getProducts({ search: 'фото' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/catalog/products');
      expect(req.request.params.get('search')).toBe('фото');
      req.flush({ success: true, items: [], total: 0 });
    });

    it('omits falsy optional flags', () => {
      service.getProducts({ favorites: false, subscription: false }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/catalog/products');
      expect(req.request.params.has('favorites')).toBe(false);
      expect(req.request.params.has('subscription')).toBe(false);
      req.flush({ success: true, items: [], total: 0 });
    });

    it('includes favorites=true when requested', () => {
      service.getProducts({ favorites: true }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/catalog/products');
      expect(req.request.params.get('favorites')).toBe('true');
      req.flush({ success: true, items: [], total: 0 });
    });
  });

  describe('getProductByBarcode()', () => {
    it('GETs /api/catalog/products/barcode/:code', () => {
      service.getProductByBarcode('1234567890').subscribe();
      const req = httpMock.expectOne('/api/catalog/products/barcode/1234567890');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, product: makeProduct() });
    });
  });

  describe('createProduct()', () => {
    it('POSTs to /api/catalog/products', () => {
      const data = { name: 'Новый товар', sell_price: 100 };
      service.createProduct(data).subscribe();
      const req = httpMock.expectOne('/api/catalog/products');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, product: makeProduct(data) });
    });
  });

  describe('updateProduct()', () => {
    it('PATCHes /api/catalog/products/:id', () => {
      service.updateProduct('prod-1', { sell_price: 75 }).subscribe();
      const req = httpMock.expectOne('/api/catalog/products/prod-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ sell_price: 75 });
      req.flush({ success: true, product: makeProduct({ sell_price: 75 }) });
    });
  });

  describe('deleteProduct()', () => {
    it('DELETEs /api/catalog/products/:id', () => {
      service.deleteProduct('prod-1').subscribe();
      const req = httpMock.expectOne('/api/catalog/products/prod-1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('importProducts()', () => {
    it('POSTs to /api/catalog/products/import with items and mode', () => {
      const items = [{ name: 'Фото', sell_price: 50 }];
      service.importProducts(items, 'upsert').subscribe();
      const req = httpMock.expectOne('/api/catalog/products/import');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ items, mode: 'upsert' });
      req.flush({ success: true, created: 1, updated: 0, errors: [] });
    });
  });
});
