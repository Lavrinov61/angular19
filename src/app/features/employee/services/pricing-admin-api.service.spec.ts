import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PricingAdminApiService, AdminPricingCategory } from './pricing-admin-api.service';

const makeCategory = (overrides: Partial<AdminPricingCategory> = {}): AdminPricingCategory => ({
  id: 'cat-1', slug: 'photo', name: 'Фото',
  description: null, icon: null, gradient: null, image_url: null,
  price_range: null, display_channels: [], valid_delivery_methods: [],
  sort_order: 1, is_active: true, created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z', option_groups: [],
  ...overrides,
});

describe('PricingAdminApiService', () => {
  let service: PricingAdminApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PricingAdminApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('getCategoriesFull()', () => {
    it('GETs /api/pricing/admin/categories/full', () => {
      service.getCategoriesFull().subscribe();
      const req = httpMock.expectOne('/api/pricing/admin/categories/full');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, categories: [] });
    });

    it('returns the categories array', () => {
      let result: AdminPricingCategory[] | undefined;
      service.getCategoriesFull().subscribe(c => (result = c));
      httpMock.expectOne('/api/pricing/admin/categories/full')
        .flush({ success: true, categories: [makeCategory()] });
      expect(result).toHaveLength(1);
    });
  });

  describe('createCategory()', () => {
    it('POSTs to /api/pricing/admin/categories', () => {
      const data = { name: 'Ретушь', slug: 'retouch' };
      service.createCategory(data).subscribe();
      const req = httpMock.expectOne('/api/pricing/admin/categories');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, category: makeCategory(data) });
    });
  });

  describe('updateCategory()', () => {
    it('PATCHes /api/pricing/admin/categories/:id', () => {
      service.updateCategory('cat-1', { name: 'Обновлено' }).subscribe();
      const req = httpMock.expectOne('/api/pricing/admin/categories/cat-1');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ name: 'Обновлено' });
      req.flush({ success: true, category: makeCategory({ name: 'Обновлено' }) });
    });
  });

  describe('deleteCategory()', () => {
    it('DELETEs /api/pricing/admin/categories/:id', () => {
      service.deleteCategory('cat-1').subscribe();
      const req = httpMock.expectOne('/api/pricing/admin/categories/cat-1');
      expect(req.request.method).toBe('DELETE');
      req.flush({ success: true });
    });
  });

  describe('createOptionGroup()', () => {
    it('POSTs to /api/pricing/admin/option-groups', () => {
      const data = { name: 'Размер', slug: 'size', selection_type: 'single' as const };
      service.createOptionGroup(data).subscribe();
      const req = httpMock.expectOne('/api/pricing/admin/option-groups');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, optionGroup: {} });
    });
  });
});
