import {
  Component, ChangeDetectionStrategy, OnDestroy,
  inject, computed, effect, afterNextRender,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { DeliveryOrderCardComponent } from './delivery-order-card.component';
import { DeliveryOperatorService } from '../../services/delivery-operator.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { buildDeliveryBoardColumns, type BoardColumn } from './delivery-board.columns';

/**
 * Операторская доска курьерской доставки (`/employee/delivery`).
 * Канбан-колонки по статусу отправления + «Внимание»:
 * ⚠ Внимание / Готов к отправке / Курьер вызван / В пути / Доставлено (свёрнуто).
 * Единый источник данных — `DeliveryOperatorService`; WS `order:delivery-status`
 * точечно перечитывает очередь. Эталон доски: order-queue.component.ts.
 */
@Component({
  selector: 'app-delivery-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    DeliveryOrderCardComponent,
  ],
  template: `
    <div class="delivery-board">
      <div class="board-header">
        <h2>
          <mat-icon>local_shipping</mat-icon>
          Доставка
          @if (delivery.badgeCount() > 0) {
            <span class="header-count">{{ delivery.badgeCount() }}</span>
          }
        </h2>
        <button mat-stroked-button (click)="reload()" [disabled]="delivery.loading()">
          <mat-icon>refresh</mat-icon>
          Обновить
        </button>
      </div>

      @if (delivery.loading() && !delivery.queue().length) {
        <div class="loading">
          <mat-spinner diameter="32" />
        </div>
      } @else if (!delivery.queue().length) {
        <div class="empty-state">
          <mat-icon>local_shipping</mat-icon>
          <p>Нет заказов с курьерской доставкой</p>
        </div>
      } @else {
        <div class="board-columns">
          @for (col of columns(); track col.key) {
            <section class="column" [class.collapsed]="col.collapsed">
              <header class="column-header">
                <mat-icon>{{ col.icon }}</mat-icon>
                <span class="col-title">{{ col.title }}</span>
                <span class="col-count">{{ col.items.length }}</span>
              </header>
              <div class="column-body">
                @for (item of col.items; track item.orderId) {
                  <app-delivery-order-card [item]="item" />
                } @empty {
                  <div class="column-empty">—</div>
                }
              </div>
            </section>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .delivery-board { padding: 16px; height: 100%; display: flex; flex-direction: column; }
    .board-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .board-header h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 20px; color: var(--mat-sys-on-surface); }
    .header-count { background: var(--mat-sys-error); color: var(--mat-sys-on-error); border-radius: 12px; padding: 2px 10px; font-size: 13px; font-weight: 600; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .empty-state { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 64px; color: var(--mat-sys-outline); }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; }
    .board-columns { display: flex; gap: 12px; overflow-x: auto; flex: 1; align-items: flex-start; padding-bottom: 8px; }
    .column { flex: 1 0 280px; min-width: 280px; max-width: 360px; background: var(--mat-sys-surface-container-low); border-radius: 12px; padding: 10px; display: flex; flex-direction: column; }
    .column.collapsed { flex: 0 0 240px; min-width: 240px; opacity: 0.85; }
    .column-header { display: flex; align-items: center; gap: 8px; padding: 4px 6px 10px; border-bottom: 1px solid var(--mat-sys-outline-variant); margin-bottom: 8px; }
    .column-header mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-on-surface-variant); }
    .col-title { font-size: 13px; font-weight: 600; color: var(--mat-sys-on-surface); flex: 1; }
    .col-count { font-size: 12px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); border-radius: 10px; padding: 1px 8px; }
    .column-body { display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
    .column-empty { text-align: center; color: var(--mat-sys-outline); padding: 16px; font-size: 13px; }
  `],
})
export class DeliveryBoardComponent implements OnDestroy {
  readonly delivery = inject(DeliveryOperatorService);
  private readonly ws = inject(WebSocketService);

  private refreshInterval?: ReturnType<typeof setInterval>;

  /** Канбан-раскладка очереди по колонкам (чистая функция, см. delivery-board.columns.ts). */
  readonly columns = computed<BoardColumn[]>(() =>
    buildDeliveryBoardColumns(this.delivery.queue()),
  );

  constructor() {
    // afterNextRender — SSR-safe (как в order-queue.component.ts)
    afterNextRender(() => {
      this.delivery.loadQueue();
      this.refreshInterval = setInterval(() => this.delivery.loadQueue(), 30000);
    });

    // WS-обновление статуса отправления → точечный рефреш очереди по orderId.
    effect(() => {
      const evt = this.ws.deliveryStatusEvent();
      if (!evt) return;
      const orderId = typeof evt.data?.['orderId'] === 'string' ? (evt.data['orderId'] as string) : null;
      if (orderId) this.delivery.applyWsUpdate(orderId);
    });
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  reload(): void {
    this.delivery.loadQueue();
  }
}
