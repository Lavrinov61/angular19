import { Component, ChangeDetectionStrategy, input, inject, computed } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DeliveryStatusStepperComponent } from './delivery-status-stepper.component';
import { DeliveryOperatorService, type DeliveryQueueItem } from '../../services/delivery-operator.service';
import { ToastService } from '../../../../core/services/toast.service';
import { printDeliveryLabel } from './delivery-label.util';

/**
 * Карточка заказа на доске доставки (дочерний компонент `delivery-board`).
 * Показывает №, клиента, адрес, зону/цену, степпер статуса курьера и действия:
 * «Вызвать курьера» (активна только при orderStatus==='ready', дизейбл при
 * выполняющемся запросе), «Отменить», трекинг, «Печать сопроводиловки».
 */
@Component({
  selector: 'app-delivery-order-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule,
    DeliveryStatusStepperComponent,
  ],
  template: `
    <mat-card class="delivery-card" [class.attention]="item().needsAttention">
      <div class="card-head">
        <span class="order-no">№ {{ item().orderNumber }}</span>
        @if (item().needsAttention) {
          <span class="attention-badge" matTooltip="Требует внимания">
            <mat-icon>warning</mat-icon>
          </span>
        }
        <span class="order-status" [class]="'os-' + item().orderStatus">
          {{ orderStatusLabel() }}
        </span>
      </div>

      <div class="customer">{{ item().customerName || '—' }}</div>

      <div class="address">
        <mat-icon>place</mat-icon>
        <span>{{ item().dropoffAddress || 'Адрес не указан' }}</span>
      </div>

      <div class="meta">
        @if (item().zone) {
          <span class="chip zone">{{ item().zone }}</span>
        }
        @if (item().priceRub !== null) {
          <span class="chip price">{{ item().priceRub }} ₽</span>
        }
      </div>

      @if (item().shipmentStatus && item().shipmentStatus !== 'pending') {
        <app-delivery-status-stepper class="stepper" [status]="item().shipmentStatus" />
      }

      @if (item().courierName || item().courierPhone) {
        <div class="courier">
          <mat-icon>local_shipping</mat-icon>
          <span>{{ item().courierName }}</span>
          @if (item().courierPhone) {
            <a class="courier-phone" [href]="'tel:' + item().courierPhone">{{ item().courierPhone }}</a>
          }
        </div>
      }

      <div class="actions">
        @if (canDispatch()) {
          <button
            mat-flat-button color="primary"
            [disabled]="!isReady() || dispatching()"
            [matTooltip]="isReady() ? '' : 'Заказ ещё не готов'"
            (click)="dispatch()">
            <mat-icon>local_shipping</mat-icon>
            Вызвать курьера
          </button>
        }
        @if (canCancel()) {
          <button
            mat-stroked-button color="warn"
            [disabled]="dispatching()"
            (click)="cancel()">
            <mat-icon>cancel</mat-icon>
            Отменить
          </button>
        }
        @if (item().trackingUrl) {
          <a mat-stroked-button [href]="item().trackingUrl" target="_blank" rel="noopener">
            <mat-icon>my_location</mat-icon>
            Трекинг
          </a>
        }
        @if (showLabel()) {
          <button mat-stroked-button (click)="printLabel()">
            <mat-icon>print</mat-icon>
            Сопроводиловка
          </button>
        }
      </div>
    </mat-card>
  `,
  styles: [`
    :host { display: block; }
    .delivery-card { padding: 12px 14px; border-left: 4px solid var(--mat-sys-outline-variant); }
    .delivery-card.attention { border-left-color: var(--mat-sys-error); }
    .card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .order-no { font-weight: 700; font-size: 14px; color: var(--mat-sys-on-surface); }
    .attention-badge { display: inline-flex; color: var(--mat-sys-error); }
    .attention-badge mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .order-status { margin-left: auto; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .order-status.os-ready { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); font-weight: 600; }
    .customer { font-size: 14px; font-weight: 600; color: var(--mat-sys-on-surface); margin-bottom: 4px; }
    .address { display: flex; align-items: flex-start; gap: 6px; font-size: 13px; color: var(--mat-sys-on-surface-variant); margin-bottom: 8px; }
    .address mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
    .meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .chip { font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .chip.zone { background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant); }
    .chip.price { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); font-weight: 600; }
    .stepper { display: block; margin: 10px 0; }
    .courier { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mat-sys-on-surface-variant); margin-bottom: 8px; }
    .courier mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .courier-phone { color: var(--mat-sys-primary); text-decoration: none; }
    .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .actions button, .actions a { font-size: 12px; }
    .actions mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class DeliveryOrderCardComponent {
  private readonly deliveryService = inject(DeliveryOperatorService);
  private readonly toast = inject(ToastService);

  readonly item = input.required<DeliveryQueueItem>();

  /** Курьер ещё не вызван — статус null или 'pending'. */
  private readonly notDispatched = computed(() => {
    const s = this.item().shipmentStatus;
    return s === null || s === 'pending';
  });

  /** Терминальный статус отправления — действий больше нет. */
  private readonly isTerminal = computed(() => {
    const s = this.item().shipmentStatus;
    return s === 'delivered' || s === 'cancelled' || s === 'failed';
  });

  readonly isReady = computed(() => this.item().orderStatus === 'ready');
  readonly dispatching = computed(() => this.deliveryService.isDispatching(this.item().orderId));

  /** Кнопка вызова показывается, пока курьер не вызван и заказ не терминальный. */
  readonly canDispatch = computed(() => this.notDispatched() && !this.isTerminal());
  /** Отмена доступна, когда отправление активно (вызвано, но ещё не доставлено/отменено). */
  readonly canCancel = computed(() => !this.notDispatched() && !this.isTerminal());
  /** Сопроводиловку печатаем, когда курьер уже вызван (есть что вести). */
  readonly showLabel = computed(() => !this.notDispatched() && !this.isTerminal());

  orderStatusLabel(): string {
    const labels: Record<string, string> = {
      new: 'Новый', paid: 'Оплачен', processing: 'В работе',
      ready: 'Готов', completed: 'Завершён', cancelled: 'Отменён',
    };
    return labels[this.item().orderStatus] ?? this.item().orderStatus;
  }

  dispatch(): void {
    this.deliveryService.dispatch(this.item().orderId).subscribe();
  }

  cancel(): void {
    this.deliveryService.cancel(this.item().orderId).subscribe();
  }

  async printLabel(): Promise<void> {
    const it = this.item();
    const ok = await printDeliveryLabel({
      orderNumber: it.orderNumber,
      customerName: it.customerName,
      dropoffAddress: it.dropoffAddress,
      zone: it.zone,
      trackingUrl: it.trackingUrl,
      claimId: it.claimId,
      courierName: it.courierName,
      courierPhone: it.courierPhone,
    });
    if (!ok) this.toast.error('Не удалось открыть окно печати, проверьте блокировщик попапов');
  }
}
