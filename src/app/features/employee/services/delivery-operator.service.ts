import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import { ToastService } from '../../../core/services/toast.service';
import type { ShipmentStatus } from '../../../core/services/delivery.service';

/**
 * Один элемент операторской очереди доставки (GET /api/delivery/queue).
 * Заказ `delivery_method='courier'` + данные активного отправления (если есть).
 */
export interface DeliveryQueueItem {
  /** Человекочитаемый order_id (напр. CRM-260530-XDBY) — им же роутятся dispatch/cancel и WS. */
  orderId: string;
  orderNumber: string;
  /** Статус самого заказа (photo_print_orders): new/paid/processing/ready/completed/... */
  orderStatus: string;
  customerName: string;
  dropoffAddress: string | null;
  /** Человекочитаемое имя зоны (напр. «Зона 1 (центр)») либо null. */
  zone: string | null;
  priceRub: number | null;
  /** Статус отправления; null/'pending' — курьер ещё не вызван. */
  shipmentStatus: ShipmentStatus | null;
  claimId: string | null;
  courierName: string | null;
  courierPhone: string | null;
  trackingUrl: string | null;
  needsAttention: boolean;
  createdAt: string;
}

interface DeliveryQueueResponse {
  items: DeliveryQueueItem[];
}

interface DispatchResponse {
  ok: boolean;
  shipmentStatus: ShipmentStatus;
  claimId: string | null;
}

interface CancelResponse {
  ok: boolean;
  shipmentStatus: ShipmentStatus;
}

/** Нормализованный код ошибки backend для dispatch/cancel (для тостов). */
export type DeliveryActionError =
  | 'order_not_ready'
  | 'feature_disabled'
  | 'not_found'
  | 'provider_unavailable'
  | (string & {});

/**
 * Единый источник данных операторской доски доставки и кнопки вызова курьера
 * в карточке заказа. HTTP к новым backend-эндпоинтам
 * (`/api/delivery/queue|shipments/:orderId/dispatch|/cancel`, guard `pos:use`).
 *
 * Кнопка «Вызвать курьера»/«Отменить» дизейблится на время запроса через
 * сигнал `dispatching` (P1-4: двойной клик = лишний HTTP к Яндексу).
 */
@Injectable({ providedIn: 'root' })
export class DeliveryOperatorService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  /** Текущая очередь заказов с доставкой. */
  readonly queue = signal<DeliveryQueueItem[]>([]);
  /** Идёт загрузка очереди. */
  readonly loading = signal(false);
  /** orderId → выполняется dispatch/cancel (для дизейбла кнопки). */
  private readonly dispatchingIds = signal<ReadonlySet<string>>(new Set());

  /** Кол-во заказов, требующих внимания (для badge в меню). */
  readonly attentionCount = computed(
    () => this.queue().filter((i) => i.needsAttention).length,
  );
  /**
   * Заказы, готовые к отправке, но курьер ещё не вызван (для badge в меню).
   * Исключаем `needsAttention` — они уже учтены в `attentionCount` (колонка
   * «Внимание» имеет приоритет на доске), иначе badge даёт двойной счёт.
   */
  readonly readyToDispatchCount = computed(
    () =>
      this.queue().filter(
        (i) =>
          !i.needsAttention &&
          i.orderStatus === 'ready' &&
          (i.shipmentStatus === null || i.shipmentStatus === 'pending'),
      ).length,
  );
  /** Счётчик для badge меню «Доставка» — то, что требует действия оператора. */
  readonly badgeCount = computed(
    () => this.attentionCount() + this.readyToDispatchCount(),
  );

  /** Выполняется ли сейчас dispatch/cancel по конкретному заказу. */
  isDispatching(orderId: string): boolean {
    return this.dispatchingIds().has(orderId);
  }

  /** Загрузка очереди заказов с доставкой. Ошибки гасятся (очередь пустеет). */
  loadQueue(): void {
    this.loading.set(true);
    this.http
      .get<DeliveryQueueResponse>('/api/delivery/queue')
      .pipe(
        map((res) => res.items ?? []),
        catchError(() => of<DeliveryQueueItem[]>([])),
        finalize(() => this.loading.set(false)),
      )
      .subscribe((items) => this.queue.set(items));
  }

  /**
   * Ручной вызов курьера по заказу. Активна только при `orderStatus==='ready'`
   * (иначе backend вернёт 409 order_not_ready). Дизейбл кнопки — через
   * `isDispatching(orderId)`. По успеху перечитывает очередь.
   */
  dispatch(orderId: string): Observable<DispatchResponse | null> {
    if (this.isDispatching(orderId)) return of(null);
    this.setDispatching(orderId, true);
    return this.http
      .post<DispatchResponse>(
        `/api/delivery/shipments/${encodeURIComponent(orderId)}/dispatch`,
        {},
      )
      .pipe(
        tap((res) => {
          this.applyShipmentStatus(orderId, res.shipmentStatus, res.claimId);
          this.toast.success('Курьер вызван');
          this.loadQueue();
        }),
        catchError((err: unknown) => {
          this.toast.error(this.dispatchErrorMessage(err));
          return of(null);
        }),
        finalize(() => this.setDispatching(orderId, false)),
      );
  }

  /**
   * Отмена отправления/вызова курьера. Если claim ещё не создан — backend
   * просто переводит локальный статус в cancelled. По успеху перечитывает очередь.
   */
  cancel(orderId: string): Observable<CancelResponse | null> {
    if (this.isDispatching(orderId)) return of(null);
    this.setDispatching(orderId, true);
    return this.http
      .post<CancelResponse>(
        `/api/delivery/shipments/${encodeURIComponent(orderId)}/cancel`,
        {},
      )
      .pipe(
        tap((res) => {
          this.applyShipmentStatus(orderId, res.shipmentStatus, null);
          this.toast.success('Доставка отменена');
          this.loadQueue();
        }),
        catchError((err: unknown) => {
          this.toast.error(this.cancelErrorMessage(err));
          return of(null);
        }),
        finalize(() => this.setDispatching(orderId, false)),
      );
  }

  /**
   * Точечное обновление одного заказа очереди по WS-событию `order:delivery-status`.
   * Если заказа в очереди ещё нет (новый ready/attention) — перечитывает очередь целиком.
   */
  applyWsUpdate(orderId: string): void {
    if (!orderId) return;
    if (this.queue().some((i) => i.orderId === orderId)) {
      this.loadQueue();
    } else {
      // Заказ мог только что стать курьерским/готовым — подтянуть весь список.
      this.loadQueue();
    }
  }

  private applyShipmentStatus(
    orderId: string,
    shipmentStatus: ShipmentStatus,
    claimId: string | null,
  ): void {
    this.queue.update((items) =>
      items.map((i) =>
        i.orderId === orderId
          ? { ...i, shipmentStatus, claimId: claimId ?? i.claimId }
          : i,
      ),
    );
  }

  private setDispatching(orderId: string, value: boolean): void {
    this.dispatchingIds.update((set) => {
      const next = new Set(set);
      if (value) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  private errorCode(err: unknown): DeliveryActionError | null {
    if (err instanceof HttpErrorResponse) {
      const body = err.error as { error?: string } | null;
      return body?.error ?? null;
    }
    return null;
  }

  private dispatchErrorMessage(err: unknown): string {
    switch (this.errorCode(err)) {
      case 'order_not_ready':
        return 'Заказ ещё не готов — курьера можно вызвать только для готового заказа';
      case 'feature_disabled':
        return 'Курьерская доставка выключена';
      default:
        return 'Не удалось вызвать курьера';
    }
  }

  private cancelErrorMessage(err: unknown): string {
    switch (this.errorCode(err)) {
      case 'feature_disabled':
        return 'Курьерская доставка выключена';
      default:
        return 'Не удалось отменить доставку';
    }
  }
}
