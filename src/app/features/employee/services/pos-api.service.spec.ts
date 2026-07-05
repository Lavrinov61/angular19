import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PosApiService, PosShift, PosReceipt, PosReceiptItem, PosReceiptPayment } from './pos-api.service';

const makeShift = (overrides: Partial<PosShift> = {}): PosShift => ({
  id: 'shift-1',
  employee_id: 'emp-1',
  studio_id: 'studio-1',
  shift_number: 1,
  opened_at: '2026-01-01T09:00:00Z',
  closed_at: null,
  cash_at_open: 1000,
  cash_at_close: null,
  expected_cash: null,
  fiscal_enabled: true,
  status: 'open',
  total_sales: 0,
  total_refunds: 0,
  receipt_count: 0,
  ...overrides,
});

const makeReceipt = (overrides: Partial<PosReceipt> = {}): PosReceipt => ({
  id: 'receipt-1',
  receipt_number: '#001',
  shift_id: 'shift-1',
  customer_phone: null,
  customer_name: null,
  is_refund: false,
  subtotal: 150,
  discount_total: 0,
  points_discount: 0,
  subscription_credit_used: 0,
  total: 150,
  items: [],
  payments: [{ payment_type: 'card', amount: 150 }],
  created_at: '2026-01-01T10:00:00Z',
  ...overrides,
});

describe('PosApiService', () => {
  let service: PosApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PosApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  // ─── openShift ────────────────────────────────────────────────────────────

  describe('openShift()', () => {
    it('POSTs to /api/pos/shifts/open with the given data', () => {
      const data = { employee_id: 'emp-1', studio_id: 'studio-1', cash_at_open: 500 };
      service.openShift(data).subscribe();
      const req = httpMock.expectOne('/api/pos/shifts/open');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, shift: makeShift() });
    });

    it('returns the shift from the response', () => {
      let result: PosShift | undefined;
      service.openShift({ employee_id: 'e1', studio_id: 's1', cash_at_open: 0 }).subscribe(s => (result = s));
      httpMock.expectOne('/api/pos/shifts/open').flush({ success: true, shift: makeShift({ id: 'shift-x' }) });
      expect(result?.id).toBe('shift-x');
    });
  });

  describe('openShiftWithFiscalCommand()', () => {
    it('returns the shift and fiscal transaction id from /api/pos/shifts/open', () => {
      let result: { shift: PosShift; fiscalTransactionId?: string | null } | undefined;
      service.openShiftWithFiscalCommand({
        employee_id: 'emp-1',
        studio_id: 'studio-1',
        cash_at_open: 0,
        fiscal_enabled: true,
      }).subscribe(response => (result = response));

      const req = httpMock.expectOne('/api/pos/shifts/open');
      expect(req.request.method).toBe('POST');
      req.flush({
        success: true,
        shift: makeShift({ fiscal_enabled: true }),
        fiscalTransactionId: 'shift-open-tx',
      });

      expect(result?.shift.fiscal_enabled).toBe(true);
      expect(result?.fiscalTransactionId).toBe('shift-open-tx');
    });
  });

  describe('openShiftFiscal()', () => {
    it('POSTs to /api/pos/shifts/:id/fiscal/open and returns the shift', () => {
      let result: PosShift | undefined;
      service.openShiftFiscal('shift-1').subscribe(shift => (result = shift));

      const req = httpMock.expectOne('/api/pos/shifts/shift-1/fiscal/open');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true, shift: makeShift({ fiscal_enabled: true }) });

      expect(result?.fiscal_enabled).toBe(true);
    });
  });

  describe('openShiftFiscalWithCommand()', () => {
    it('returns the shift and fiscal transaction id from /api/pos/shifts/:id/fiscal/open', () => {
      let result: { shift: PosShift; fiscalTransactionId?: string | null; fiscalCommandEnqueued: boolean } | undefined;
      service.openShiftFiscalWithCommand('shift-1').subscribe(response => (result = response));

      const req = httpMock.expectOne('/api/pos/shifts/shift-1/fiscal/open');
      expect(req.request.method).toBe('POST');
      req.flush({
        success: true,
        shift: makeShift({ fiscal_enabled: true }),
        fiscalCommandEnqueued: true,
        fiscalTransactionId: 'fiscal-open-tx',
      });

      expect(result?.shift.fiscal_enabled).toBe(true);
      expect(result?.fiscalCommandEnqueued).toBe(true);
      expect(result?.fiscalTransactionId).toBe('fiscal-open-tx');
    });
  });

  describe('closeShiftFiscalWithCommand()', () => {
    it('returns the shift and fiscal transaction id from /api/pos/shifts/:id/fiscal/close', () => {
      let result: { shift: PosShift; fiscalTransactionId?: string | null; fiscalCommandEnqueued: boolean } | undefined;
      service.closeShiftFiscalWithCommand('shift-1').subscribe(response => (result = response));

      const req = httpMock.expectOne('/api/pos/shifts/shift-1/fiscal/close');
      expect(req.request.method).toBe('POST');
      req.flush({
        success: true,
        shift: makeShift({ fiscal_enabled: true }),
        fiscalCommandEnqueued: true,
        fiscalTransactionId: 'fiscal-close-tx',
      });

      expect(result?.shift.fiscal_enabled).toBe(true);
      expect(result?.fiscalCommandEnqueued).toBe(true);
      expect(result?.fiscalTransactionId).toBe('fiscal-close-tx');
    });
  });

  // ─── closeShift ──────────────────────────────────────────────────────────

  describe('closeShift()', () => {
    it('POSTs to /api/pos/shifts/close with close data', () => {
      const data = { shift_id: 'shift-1', employee_id: 'emp-1', cash_at_close: 800 };
      service.closeShift(data).subscribe();
      const req = httpMock.expectOne('/api/pos/shifts/close');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, shift: makeShift({ status: 'closed' }) });
    });

    it('returns a closed shift', () => {
      let result: { shift: PosShift; zReportSent: boolean } | undefined;
      service.closeShift({ shift_id: 's1', employee_id: 'e1', cash_at_close: 500 }).subscribe(s => (result = s));
      httpMock.expectOne('/api/pos/shifts/close').flush({ success: true, shift: makeShift({ status: 'closed' }), zReportSent: true });
      expect(result?.shift.status).toBe('closed');
      expect(result?.zReportSent).toBe(true);
    });
  });

  // ─── getCurrentShift ──────────────────────────────────────────────────────

  describe('getCurrentShift()', () => {
    it('GETs /api/pos/shifts/current with employee_id param', () => {
      service.getCurrentShift('emp-1').subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/pos/shifts/current');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('employee_id')).toBe('emp-1');
      req.flush({ success: true, shift: makeShift() });
    });

    it('returns null when no active shift', () => {
      let result: PosShift | null | undefined;
      service.getCurrentShift('emp-1').subscribe(s => (result = s));
      httpMock.expectOne(r => r.url === '/api/pos/shifts/current').flush({ success: true, shift: null });
      expect(result).toBeNull();
    });
  });

  describe('getShifts()', () => {
    it('GETs /api/pos/shifts with journal filters', () => {
      service.getShifts({ studio_id: 'studio-1', employee_id: 'emp-1', status: 'closed', limit: 30 }).subscribe();

      const req = httpMock.expectOne(r => r.url === '/api/pos/shifts');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('studio_id')).toBe('studio-1');
      expect(req.request.params.get('employee_id')).toBe('emp-1');
      expect(req.request.params.get('status')).toBe('closed');
      expect(req.request.params.get('limit')).toBe('30');
      req.flush({ success: true, items: [makeShift({ status: 'closed' })], total: 1 });
    });
  });

  describe('createCashWithdrawal()', () => {
    it('POSTs a cash withdrawal for a shift', () => {
      const data = { amount: 1200, reason: 'Инкассация' };
      service.createCashWithdrawal('shift-1', data).subscribe();
      const req = httpMock.expectOne('/api/pos/shifts/shift-1/cash-withdrawals');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({
        success: true,
        movement: {
          id: 'movement-1',
          shift_id: 'shift-1',
          studio_id: 'studio-1',
          employee_id: 'emp-1',
          movement_type: 'withdrawal',
          amount: 1200,
          reason: 'Инкассация',
          created_at: '2026-01-01T12:00:00Z',
        },
      });
    });
  });

  // ─── createReceipt ───────────────────────────────────────────────────────

  describe('createReceipt()', () => {
    it('POSTs to /api/pos/receipts with receipt data', () => {
      const items: PosReceiptItem[] = [
        { product_id: 'p1', product_name: 'Фото', quantity: 2, unit_price: 50, discount_amount: 0, discount_percent: 0, points_used: 0, subscription_credits_used: 0, total: 100 },
      ];
      const payments: PosReceiptPayment[] = [{ payment_type: 'card', amount: 100 }];
      const data = {
        shift_id: 'shift-1', employee_id: 'emp-1', studio_id: 'studio-1',
        items, payments, subtotal: 100, total: 100,
      };

      service.createReceipt(data).subscribe();
      const req = httpMock.expectOne('/api/pos/receipts');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, receipt: makeReceipt() });
    });
  });

  describe('calculateSubscriptionCoverage()', () => {
    it('POSTs to /api/pos/subscription-coverage and returns coverage', () => {
      const item: PosReceiptItem = {
        product_id: 'p1',
        product_name: 'Фото',
        quantity: 2,
        unit_price: 50,
        discount_amount: 0,
        discount_percent: 0,
        points_used: 0,
        subscription_credits_used: 0,
        total: 100,
      };
      const result = {
        subscription_id: 'sub-1',
        total_covered_amount: 100,
        total_credits_consumed: 2,
        items: [{
          index: 0,
          product_id: 'p1',
          credit_product_id: 'p1',
          product_name: 'Фото',
          quantity: 2,
          covered_quantity: 2,
          remaining_quantity: 0,
          credits_consumed: 2,
          covered_amount: 100,
        }],
      };

      let coverage: typeof result | undefined;
      service.calculateSubscriptionCoverage({ subscription_id: 'sub-1', items: [item] })
        .subscribe(value => (coverage = value));

      const req = httpMock.expectOne('/api/pos/subscription-coverage');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ subscription_id: 'sub-1', items: [item] });
      req.flush({ success: true, coverage: result });
      expect(coverage).toEqual(result);
    });
  });

  // ─── getReceipts ──────────────────────────────────────────────────────────

  describe('getReceipts()', () => {
    it('GETs /api/pos/receipts without params by default', () => {
      service.getReceipts().subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/pos/receipts');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, items: [] });
    });

    it('passes shift_id filter when provided', () => {
      service.getReceipts({ shift_id: 'shift-1' }).subscribe();
      const req = httpMock.expectOne(r => r.url === '/api/pos/receipts');
      expect(req.request.params.get('shift_id')).toBe('shift-1');
      req.flush({ success: true, items: [] });
    });
  });

  // ─── lookupCustomer ──────────────────────────────────────────────────────

  describe('lookupCustomer()', () => {
    it('GETs /api/pos/customer/:phone', () => {
      service.lookupCustomer('+79001234567').subscribe();
      const req = httpMock.expectOne('/api/pos/customer/+79001234567');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, loyalty: null, subscription: null, recent_receipts: 0, customer_name: null });
    });
  });

  describe('bridgePay()', () => {
    it('POSTs explicit studioId for point-specific terminal routing', () => {
      const data = {
        amount: 150,
        orderId: 'order-1',
        studioId: '22222222-2222-4222-8222-222222222222',
      };

      service.bridgePay(data).subscribe();

      const req = httpMock.expectOne('/api/pos/bridge/pay');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, transactionId: 'tx-1' });
    });

    it('forwards the cart snapshot (with studioId/source) for order-first persistence', () => {
      const data = {
        amount: 150,
        orderId: 'order-1',
        studioId: '22222222-2222-4222-8222-222222222222',
        snapshot: {
          items: [],
          subtotal: 150,
          total: 150,
          studioId: '22222222-2222-4222-8222-222222222222',
          source: 'cart' as const,
        },
      };

      service.bridgePay(data).subscribe();

      const req = httpMock.expectOne('/api/pos/bridge/pay');
      expect(req.request.body).toEqual(data);
      expect(req.request.body.snapshot.studioId).toBe('22222222-2222-4222-8222-222222222222');
      expect(req.request.body.snapshot.source).toBe('cart');
      req.flush({ success: true, transactionId: 'tx-1' });
    });

    it('forwards pricing params so the backend can build the snapshot for the services branch', () => {
      const data = {
        amount: 2800,
        orderId: 'POS-SVC-1',
        studioId: '22222222-2222-4222-8222-222222222222',
        pricing: {
          category_slug: 'portrait',
          selected_options: [{ option_slug: 'portrait-30', quantity: 1 }],
          delivery_method: 'pickup' as const,
          customer_phone: '79990000000',
          apply_volume_discount: true,
        },
      };

      service.bridgePay(data).subscribe();

      const req = httpMock.expectOne('/api/pos/bridge/pay');
      expect(req.request.body).toEqual(data);
      expect(req.request.body.pricing.category_slug).toBe('portrait');
      req.flush({ success: true, transactionId: 'tx-2' });
    });
  });

  describe('bridgeRefund()', () => {
    it('POSTs terminal refund request for a bank-approved transaction', () => {
      const data = {
        studioId: '22222222-2222-4222-8222-222222222222',
        transactionId: '55555555-5555-4555-8555-555555555555',
      };

      service.bridgeRefund(data).subscribe();

      const req = httpMock.expectOne('/api/pos/bridge/refund');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(data);
      req.flush({ success: true, transactionId: 'refund-tx-1' });
    });
  });

  // ─── getLowStock ──────────────────────────────────────────────────────────

  describe('getLowStock()', () => {
    it('GETs /api/pos/materials/low-stock/:studioId', () => {
      service.getLowStock('studio-1').subscribe();
      const req = httpMock.expectOne('/api/pos/materials/low-stock/studio-1');
      expect(req.request.method).toBe('GET');
      req.flush({ success: true, items: [] });
    });
  });

  // ─── bridgeStatus ─────────────────────────────────────────────────────────

  describe('bridgeStatus()', () => {
    it('GETs /api/pos/bridge/status', () => {
      service.bridgeStatus().subscribe();
      const req = httpMock.expectOne('/api/pos/bridge/status');
      expect(req.request.method).toBe('GET');
      req.flush({ terminal: 'ok', fiscal: 'ok' });
    });
  });

  describe('getBridgeTransaction()', () => {
    it('GETs /api/pos/bridge/transactions/:id', () => {
      let result: { status: string; error_message: string | null } | undefined;
      service.getBridgeTransaction('tx-1').subscribe(tx => (result = tx));

      const req = httpMock.expectOne('/api/pos/bridge/transactions/tx-1');
      expect(req.request.method).toBe('GET');
      req.flush({
        success: true,
        transaction: {
          id: 'tx-1',
          status: 'completed',
          transaction_type: 'shift_open',
          error_message: null,
          terminal_response: null,
        },
      });

      expect(result?.status).toBe('completed');
      expect(result?.error_message).toBeNull();
    });
  });

  describe('bridgeBankSettlement()', () => {
    it('POSTs /api/pos/bridge/bank-settlement', () => {
      service.bridgeBankSettlement('studio-1').subscribe();
      const req = httpMock.expectOne('/api/pos/bridge/bank-settlement');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ studioId: 'studio-1' });
      req.flush({ success: true, transactionId: 'tx-1' });
    });
  });

  describe('getOrphanPayments()', () => {
    it('GETs /api/pos/payments/orphan with studioId and unwraps items', () => {
      let result: { id: string; kind: string }[] | undefined;
      service.getOrphanPayments('studio-1').subscribe(items => (result = items));

      const req = httpMock.expectOne(r => r.url === '/api/pos/payments/orphan');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('studioId')).toBe('studio-1');
      req.flush({
        success: true,
        items: [{
          id: 'pay-960e3b4b', amount: 525, orderId: null, terminalOrderId: null,
          initiatedAt: '2026-06-06T12:14:45Z', initiatedByName: 'Ольга',
          status: 'completed', errorMessage: null, snapshot: null, kind: 'orphan',
        }],
      });

      expect(result?.length).toBe(1);
      expect(result?.[0].id).toBe('pay-960e3b4b');
      expect(result?.[0].kind).toBe('orphan');
    });

    it('returns [] when the response has no items', () => {
      let result: unknown[] | undefined;
      service.getOrphanPayments('studio-1').subscribe(items => (result = items));
      httpMock.expectOne(r => r.url === '/api/pos/payments/orphan').flush({ success: true });
      expect(result).toEqual([]);
    });
  });

  describe('createOrphanReceipt()', () => {
    it('POSTs /api/pos/payments/:id/create-receipt with manual items', () => {
      const items: PosReceiptItem[] = [{
        product_id: null, product_name: 'Печать A4', quantity: 1, unit_price: 525,
        discount_amount: 0, discount_percent: 0, points_used: 0,
        subscription_credits_used: 0, total: 525,
      }];
      service.createOrphanReceipt('pay-960e3b4b', { items }).subscribe();

      const req = httpMock.expectOne('/api/pos/payments/pay-960e3b4b/create-receipt');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ items });
      req.flush({ success: true, payment_resolution: 'resolved_paid' });
    });

    it('POSTs an empty body when no items are passed (snapshot path)', () => {
      service.createOrphanReceipt('pay-1').subscribe();
      const req = httpMock.expectOne('/api/pos/payments/pay-1/create-receipt');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush({ success: true, payment_resolution: 'resolved_paid' });
    });
  });
});
