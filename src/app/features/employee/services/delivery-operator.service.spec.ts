import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { DeliveryOperatorService, type DeliveryQueueItem } from './delivery-operator.service';
import { ToastService } from '../../../core/services/toast.service';

const makeItem = (overrides: Partial<DeliveryQueueItem> = {}): DeliveryQueueItem => ({
  orderId: 'ord-1',
  orderNumber: '1042',
  orderStatus: 'ready',
  customerName: 'Иван Петров',
  dropoffAddress: 'Соборный 21',
  zone: 'Зона 1 (центр)',
  priceRub: 300,
  shipmentStatus: null,
  claimId: null,
  courierName: null,
  courierPhone: null,
  trackingUrl: null,
  needsAttention: false,
  createdAt: '2026-05-30T10:00:00Z',
  ...overrides,
});

describe('DeliveryOperatorService', () => {
  let service: DeliveryOperatorService;
  let httpMock: HttpTestingController;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    toast = { success: vi.fn(), error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        DeliveryOperatorService,
        { provide: ToastService, useValue: toast },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(DeliveryOperatorService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('loadQueue заполняет очередь из ответа', () => {
    service.loadQueue();
    const req = httpMock.expectOne('/api/delivery/queue');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [makeItem(), makeItem({ orderId: 'ord-2' })] });

    expect(service.queue().length).toBe(2);
    expect(service.loading()).toBe(false);
  });

  it('loadQueue при ошибке оставляет очередь пустой и снимает loading', () => {
    service.loadQueue();
    httpMock.expectOne('/api/delivery/queue').flush('boom', { status: 500, statusText: 'err' });
    expect(service.queue()).toEqual([]);
    expect(service.loading()).toBe(false);
  });

  it('badgeCount = needs_attention + готовые-без-курьера', () => {
    service.loadQueue();
    httpMock.expectOne('/api/delivery/queue').flush({
      items: [
        makeItem({ orderId: 'a', needsAttention: true }),
        makeItem({ orderId: 'b', orderStatus: 'ready', shipmentStatus: null }),
        makeItem({ orderId: 'c', orderStatus: 'processing', shipmentStatus: null }),
        makeItem({ orderId: 'd', orderStatus: 'ready', shipmentStatus: 'in_transit' }),
      ],
    });
    expect(service.attentionCount()).toBe(1);
    expect(service.readyToDispatchCount()).toBe(1);
    expect(service.badgeCount()).toBe(2);
  });

  it('dispatch успешно — POST, тост, дизейбл во время запроса, рефреш очереди', () => {
    let completed = false;
    service.dispatch('ord-1').subscribe(() => (completed = true));
    expect(service.isDispatching('ord-1')).toBe(true);

    const req = httpMock.expectOne('/api/delivery/shipments/ord-1/dispatch');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, shipmentStatus: 'created', claimId: 'claim-9' });

    // По успеху дёргается loadQueue
    httpMock.expectOne('/api/delivery/queue').flush({ items: [] });

    expect(toast.success).toHaveBeenCalledWith('Курьер вызван');
    expect(service.isDispatching('ord-1')).toBe(false);
    expect(completed).toBe(true);
  });

  it('dispatch при 409 order_not_ready показывает понятный тост, очередь не рефрешится', () => {
    service.dispatch('ord-1').subscribe();
    httpMock.expectOne('/api/delivery/shipments/ord-1/dispatch').flush(
      { error: 'order_not_ready' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(toast.error).toHaveBeenCalledWith(
      'Заказ ещё не готов — курьера можно вызвать только для готового заказа',
    );
    expect(service.isDispatching('ord-1')).toBe(false);
    httpMock.expectNone('/api/delivery/queue');
  });

  it('dispatch при 400 feature_disabled — тост «выключена»', () => {
    service.dispatch('ord-1').subscribe();
    httpMock.expectOne('/api/delivery/shipments/ord-1/dispatch').flush(
      { error: 'feature_disabled' },
      { status: 400, statusText: 'Bad Request' },
    );
    expect(toast.error).toHaveBeenCalledWith('Курьерская доставка выключена');
  });

  it('повторный dispatch во время запроса игнорируется (анти-дабл-клик)', () => {
    service.dispatch('ord-1').subscribe();
    const inflight = httpMock.expectOne('/api/delivery/shipments/ord-1/dispatch');

    // Второй вызов не должен порождать второй HTTP, пока первый в полёте
    service.dispatch('ord-1').subscribe();
    httpMock.expectNone('/api/delivery/shipments/ord-1/dispatch');

    inflight.flush({ ok: true, shipmentStatus: 'created', claimId: null });
    httpMock.expectOne('/api/delivery/queue').flush({ items: [] });
  });

  it('cancel успешно — POST + тост + рефреш', () => {
    service.cancel('ord-1').subscribe();
    const req = httpMock.expectOne('/api/delivery/shipments/ord-1/cancel');
    expect(req.request.method).toBe('POST');
    req.flush({ ok: true, shipmentStatus: 'cancelled' });
    httpMock.expectOne('/api/delivery/queue').flush({ items: [] });
    expect(toast.success).toHaveBeenCalledWith('Доставка отменена');
  });

  it('applyWsUpdate перечитывает очередь', () => {
    service.applyWsUpdate('ord-1');
    httpMock.expectOne('/api/delivery/queue').flush({ items: [] });
  });
});
