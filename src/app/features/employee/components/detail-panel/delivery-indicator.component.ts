import { Component, ChangeDetectionStrategy, input, inject, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DeliveryOperatorService } from '../../services/delivery-operator.service';

/**
 * Мелкий индикатор курьерской доставки в карточке заказа (order-detail-panel).
 * Показывается только при `delivery_method==='courier'`. Даёт ссылку на доску
 * `/employee/delivery` и кнопку «Вызвать курьера», активную когда заказ `ready`
 * (реюз `DeliveryOperatorService` — тот же путь, что и доска).
 */
@Component({
  selector: 'app-delivery-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    <div class="delivery-indicator">
      <div class="di-head">
        <mat-icon>local_shipping</mat-icon>
        <span class="di-label">Курьерская доставка</span>
        <a routerLink="/employee/delivery" class="di-link" matTooltip="Открыть доску доставки">
          на доску
          <mat-icon>open_in_new</mat-icon>
        </a>
      </div>
      <div class="di-action">
        <button
          mat-stroked-button color="primary"
          [disabled]="!isReady() || dispatching()"
          [matTooltip]="isReady() ? 'Вызвать курьера Яндекс' : 'Кнопка активна, когда заказ готов'"
          (click)="dispatch()">
          <mat-icon>local_shipping</mat-icon>
          Вызвать курьера
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .delivery-indicator {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low, rgba(0,0,0,0.04));
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .di-head { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--mat-sys-on-surface-variant); }
    .di-head > mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-primary); }
    .di-label { font-weight: 600; color: var(--mat-sys-on-surface); }
    .di-link { display: inline-flex; align-items: center; gap: 2px; font-size: 12px; color: var(--mat-sys-primary); text-decoration: none; margin-left: 4px; }
    .di-link mat-icon { font-size: 14px; width: 14px; height: 14px; }
    .di-action button { font-size: 12px; }
    .di-action mat-icon { font-size: 16px; width: 16px; height: 16px; }
  `],
})
export class DeliveryIndicatorComponent {
  private readonly delivery = inject(DeliveryOperatorService);

  /** Человекочитаемый order_id (не UUID): backend dispatch/cancel роутят по order_id. */
  readonly orderId = input.required<string>();
  /** Статус заказа (photo_print_orders): кнопка активна только при 'ready'. */
  readonly orderStatus = input.required<string>();

  readonly isReady = computed(() => this.orderStatus() === 'ready');
  readonly dispatching = computed(() => this.delivery.isDispatching(this.orderId()));

  dispatch(): void {
    this.delivery.dispatch(this.orderId()).subscribe();
  }
}
