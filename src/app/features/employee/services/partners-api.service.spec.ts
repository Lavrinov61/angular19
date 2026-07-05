import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PartnersApiService, Partner } from './partners-api.service';

const makePartner = (overrides: Partial<Partner> = {}): Partner => ({
  id: 1, user_id: null, name: 'ООО Партнёр', email: null, phone: null,
  type: 'referral', status: 'approved',
  commission_rate: '10.00', balance: '500.00', total_earned: '1500.00',
  promo_code: 'PART10', referral_url: null, payout_details: {}, notes: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('PartnersApiService', () => {
  let service: PartnersApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PartnersApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('list()', () => {
    it('GETs /api/partners/ without filters', () => {
      service.list().subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/partners/'));
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [], total: 0 });
    });

    it('appends status and type filters', () => {
      service.list({ status: 'approved', type: 'referral' }).subscribe();
      const req = httpMock.expectOne(r => r.url.startsWith('/api/partners/'));
      expect(req.request.url).toContain('status=approved');
      expect(req.request.url).toContain('type=referral');
      req.flush({ success: true, data: [], total: 0 });
    });
  });

  describe('get()', () => {
    it('GETs /api/partners/:id', () => {
      service.get(1).subscribe();
      const req = httpMock.expectOne('/api/partners/1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: makePartner() });
    });
  });

  describe('create()', () => {
    it('POSTs to /api/partners with partner data', () => {
      const data = { name: 'Новый', type: 'referral' as const, commission_rate: 5 };
      service.create(data).subscribe();
      const req = httpMock.expectOne('/api/partners');
      expect(req.request.method).toBe('POST');
      req.flush({ success: true, data: makePartner() });
    });
  });

  describe('approve()', () => {
    it('POSTs to /api/partners/:id/approve with status', () => {
      service.approve(1, 'approved').subscribe();
      const req = httpMock.expectOne('/api/partners/1/approve');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ status: 'approved' });
      req.flush({ success: true, data: makePartner({ status: 'approved' }) });
    });
  });

  describe('getReferrals()', () => {
    it('GETs /api/partners/:id/referrals', () => {
      service.getReferrals(1).subscribe();
      const req = httpMock.expectOne('/api/partners/1/referrals');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, data: [], total: 0, total_commission: '0.00' });
    });
  });
});
