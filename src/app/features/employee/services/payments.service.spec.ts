import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PaymentsService, PaymentLink, PaymentLinkStatus } from './payments.service';

const mkLink = (overrides: Partial<PaymentLink> = {}): PaymentLink => ({
  id: 'link-1',
  order_ref: 'CRM-190426-ABCD',
  amount: 1200,
  status: 'pending',
  services: [{ name: 'Фото на документы', price: 400, quantity: 3 }],
  description: null,
  contact_id: 'contact-1',
  contact_name: 'Иван',
  contact_phone: '+79001234567',
  created_at: new Date().toISOString(),
  paid_at: null,
  expires_at: null,
  order_ref_linked: null,
  ...overrides,
});

describe('PaymentsService', () => {
  let service: PaymentsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), PaymentsService],
    });
    service = TestBed.inject(PaymentsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getLinksForContact()', () => {
    it('GETs /api/payments/links with contact_id param', () => {
      service.getLinksForContact('contact-1').subscribe();

      const req = httpMock.expectOne(r => r.url === '/api/payments/links');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('contact_id')).toBe('contact-1');
      expect(req.request.params.get('status')).toBeNull();
      req.flush({ success: true, links: [] });
    });

    it('includes status param when provided', () => {
      const status: PaymentLinkStatus = 'paid';
      service.getLinksForContact('contact-1', status).subscribe();

      const req = httpMock.expectOne(r => r.url === '/api/payments/links');
      expect(req.request.params.get('status')).toBe('paid');
      req.flush({ success: true, links: [] });
    });

    it('returns [] when no links in response', () => {
      let result: PaymentLink[] | undefined;
      service.getLinksForContact('contact-1').subscribe(r => (result = r));

      httpMock.expectOne(r => r.url === '/api/payments/links').flush({ success: true, links: [] });
      expect(result).toEqual([]);
    });

    it('returns [] when response has no links field (defensive)', () => {
      let result: PaymentLink[] | undefined;
      service.getLinksForContact('contact-1').subscribe(r => (result = r));

      httpMock.expectOne(r => r.url === '/api/payments/links').flush({ success: true });
      expect(result).toEqual([]);
    });

    it('unwraps links from {success, links} envelope', () => {
      let result: PaymentLink[] | undefined;
      service.getLinksForContact('contact-1').subscribe(r => (result = r));

      const links = [mkLink({ id: 'l1' }), mkLink({ id: 'l2', status: 'paid' })];
      httpMock.expectOne(r => r.url === '/api/payments/links').flush({ success: true, links });

      expect(result).toHaveLength(2);
      expect(result?.[0].id).toBe('l1');
      expect(result?.[1].status).toBe('paid');
    });

    it('propagates 500 error to subscriber', () => {
      let err: HttpErrorResponse | undefined;
      service.getLinksForContact('contact-1').subscribe({
        next: () => undefined,
        error: (e: HttpErrorResponse) => (err = e),
      });

      httpMock.expectOne(r => r.url === '/api/payments/links').flush(
        { success: false, error: 'db down' },
        { status: 500, statusText: 'Server Error' },
      );

      expect(err?.status).toBe(500);
    });
  });

  describe('createOrderFromLink()', () => {
    it('POSTs to /api/payments/link/:id/create-order with body fields', () => {
      service.createOrderFromLink('link-1', {
        comment: 'Срочно',
        uniform_description: 'Прокурор',
        wishes: 'без ретуши',
        priority: 'urgent',
      }).subscribe();

      const req = httpMock.expectOne('/api/payments/link/link-1/create-order');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        comment: 'Срочно',
        uniform_description: 'Прокурор',
        wishes: 'без ретуши',
        priority: 'urgent',
      });
      req.flush({ success: true, data: { orderId: 'ord-1' } });
    });

    it('returns idempotent=false by default when not in response', () => {
      let result: { orderId: string; idempotent: boolean } | undefined;
      service.createOrderFromLink('link-1', {}).subscribe(r => (result = r));

      httpMock.expectOne('/api/payments/link/link-1/create-order').flush({
        success: true,
        data: { orderId: 'ord-1' },
      });

      expect(result).toEqual({ orderId: 'ord-1', idempotent: false });
    });

    it('returns idempotent=true when backend flags replay', () => {
      let result: { orderId: string; idempotent: boolean } | undefined;
      service.createOrderFromLink('link-1', {}).subscribe(r => (result = r));

      httpMock.expectOne('/api/payments/link/link-1/create-order').flush({
        success: true,
        data: { orderId: 'ord-1', idempotent: true },
      });

      expect(result).toEqual({ orderId: 'ord-1', idempotent: true });
    });

    it('propagates 409 conflict to subscriber', () => {
      let err: HttpErrorResponse | undefined;
      service.createOrderFromLink('link-1', {}).subscribe({
        next: () => undefined,
        error: (e: HttpErrorResponse) => (err = e),
      });

      httpMock.expectOne('/api/payments/link/link-1/create-order').flush(
        { success: false, error: 'already linked' },
        { status: 409, statusText: 'Conflict' },
      );

      expect(err?.status).toBe(409);
    });
  });

  describe('resendLink()', () => {
    it('POSTs empty body to /api/payments/resend/:orderRef', () => {
      service.resendLink('CRM-190426-ABCD').subscribe();

      const req = httpMock.expectOne('/api/payments/resend/CRM-190426-ABCD');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true, mode: 'telegram' });
    });

    it('returns parsed response from backend', () => {
      let result: { success: boolean; mode?: string } | undefined;
      service.resendLink('CRM-1').subscribe(r => (result = r));

      httpMock.expectOne('/api/payments/resend/CRM-1').flush({ success: true, mode: 'sms' });
      expect(result).toEqual({ success: true, mode: 'sms' });
    });

    it('propagates 404 error to subscriber', () => {
      let err: HttpErrorResponse | undefined;
      service.resendLink('CRM-UNKNOWN').subscribe({
        next: () => undefined,
        error: (e: HttpErrorResponse) => (err = e),
      });

      httpMock.expectOne('/api/payments/resend/CRM-UNKNOWN').flush(
        { success: false, error: 'not found' },
        { status: 404, statusText: 'Not Found' },
      );

      expect(err?.status).toBe(404);
    });
  });
});
