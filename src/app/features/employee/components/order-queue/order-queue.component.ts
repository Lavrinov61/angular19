import {
  Component, ChangeDetectionStrategy, OnDestroy,
  inject, signal, afterNextRender, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
  OrderAssignmentsApiService,
  OrderAssignment,
} from '../../services/order-assignments-api.service';
import { PrintDialogComponent } from '../print-dialog/print-dialog.component';
import { printDialogConfig } from '../../utils/print-dialog-config';
import { DeadlineTimerService } from '../../services/deadline-timer.service';
import { DeadlineTimerPipe } from '../../pipes/deadline-timer.pipe';

@Component({
  selector: 'app-order-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule,
    MatBadgeModule, MatChipsModule,
    MatFormFieldModule, MatInputModule,
    MatDialogModule,
    DeadlineTimerPipe,
  ],
  template: `
    <div class="order-queue">
      <div class="queue-header">
        <h2>
          <mat-icon>assignment_turned_in</mat-icon>
          Очередь заказов
        </h2>
        <button mat-stroked-button (click)="loadAll()">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      <!-- Мои активные заказы -->
      @if (myOrders().length) {
        <section class="my-orders">
          <h3 class="section-title">
            <mat-icon>person</mat-icon>
            Мои заказы в работе
          </h3>
          @for (order of myOrders(); track order.id) {
            <mat-card [class.help-needed]="order.status === 'help_needed'" class="order-card">
              <mat-card-header>
                <mat-card-title>
                  <mat-icon>{{ orderTypeIcon(order.order_type) }}</mat-icon>
                  {{ orderTypeLabel(order.order_type) }}
                  @if (order.status === 'help_needed') {
                    <span class="help-badge">Нужна помощь</span>
                  }
                </mat-card-title>
                <mat-card-subtitle>{{ order.order_summary || order.order_id }}</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <div class="order-meta">
                  @if (order.deadline_at) {
                    <span class="deadline" [class]="timer.deadlineClass(order.deadline_at)">
                      <mat-icon>schedule</mat-icon>
                      {{ order.deadline_at | deadlineTimer:'human' }}
                    </span>
                  }
                  @if (order.estimated_minutes) {
                    <span class="estimated">~{{ order.estimated_minutes }} мин</span>
                  }
                  <span class="source-badge">{{ sourceLabel(order.source) }}</span>
                </div>

                <!-- Inline форма запроса помощи -->
                @if (helpOrder()?.id === order.id) {
                  <div class="help-form">
                    <mat-form-field appearance="outline" class="help-input">
                      <mat-label>Опишите, какая нужна помощь</mat-label>
                      <textarea matInput rows="2" #helpTextarea
                        [value]="helpMessage()"
                        (input)="helpMessage.set(helpTextarea.value)">
                      </textarea>
                    </mat-form-field>
                    <div class="help-form-actions">
                      <button mat-flat-button color="warn"
                        [disabled]="!helpMessage().trim()"
                        (click)="submitHelp(order)">
                        Отправить
                      </button>
                      <button mat-stroked-button (click)="cancelHelp()">Отмена</button>
                    </div>
                  </div>
                }
              </mat-card-content>
              <mat-card-actions>
                <button mat-flat-button color="primary" (click)="completeOrder(order)">
                  <mat-icon>check_circle</mat-icon>
                  Завершить
                </button>
                @if (order.status !== 'help_needed' && helpOrder()?.id !== order.id) {
                  <button mat-stroked-button (click)="askHelp(order)">
                    <mat-icon>help</mat-icon>
                    Нужна помощь
                  </button>
                }
                @if (needsPrinting(order)) {
                  <button mat-stroked-button (click)="openPrintDialog(order)">
                    <mat-icon>print</mat-icon>
                    Печать
                  </button>
                }
              </mat-card-actions>
            </mat-card>
          }
        </section>
      }

      <!-- Ожидающие заказы -->
      <section class="pending-orders">
        <h3 class="section-title">
          <mat-icon>hourglass_empty</mat-icon>
          Ожидают выполнения
          @if (pendingOrders().length) {
            <span class="count-badge">{{ pendingOrders().length }}</span>
          }
        </h3>

        @if (loading()) {
          <div class="loading">Загрузка...</div>
        } @else if (!pendingOrders().length) {
          <div class="empty-state">
            <mat-icon>check_circle_outline</mat-icon>
            <p>Все заказы выполнены</p>
          </div>
        } @else {
          @for (order of pendingOrders(); track order.id) {
            <mat-card class="order-card"
              [class.urgent]="order.priority >= 2"
              [class.high-priority]="order.priority === 1">
              <mat-card-header>
                <mat-card-title>
                  <mat-icon>{{ orderTypeIcon(order.order_type) }}</mat-icon>
                  {{ orderTypeLabel(order.order_type) }}
                  @if (order.priority >= 2) {
                    <mat-icon class="urgent-icon" color="warn">priority_high</mat-icon>
                  }
                  @if (order.status === 'help_needed') {
                    <span class="help-badge">Нужна помощь</span>
                  }
                </mat-card-title>
                <mat-card-subtitle>{{ order.order_summary || order.order_id }}</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <div class="order-meta">
                  @if (order.deadline_at) {
                    <span class="deadline" [class]="timer.deadlineClass(order.deadline_at)">
                      <mat-icon>schedule</mat-icon>
                      {{ order.deadline_at | deadlineTimer:'human' }}
                    </span>
                  }
                  @if (order.estimated_minutes) {
                    <span class="estimated">~{{ order.estimated_minutes }} мин</span>
                  }
                  <span class="source-badge">{{ sourceLabel(order.source) }}</span>
                  @if (order.studio_name) {
                    <span class="studio-badge">{{ order.studio_name }}</span>
                  }
                </div>
                @if (order.help_request) {
                  <div class="help-message">
                    <mat-icon>warning</mat-icon>
                    {{ order.help_request }}
                  </div>
                }
              </mat-card-content>
              <mat-card-actions>
                @if (order.status === 'pending') {
                  <button mat-flat-button color="accent" (click)="takeOrder(order)">
                    <mat-icon>play_arrow</mat-icon>
                    Взять в работу
                  </button>
                }
                @if (order.status === 'help_needed') {
                  <button mat-flat-button color="warn" (click)="joinOrder(order)">
                    <mat-icon>group_add</mat-icon>
                    Помочь
                  </button>
                }
              </mat-card-actions>
            </mat-card>
          }
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .order-queue { padding: 16px; max-width: 800px; margin: 0 auto; }
    .queue-header { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin-bottom: 20px; }
    .queue-header h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 20px; color: var(--mat-sys-on-surface); }
    .section-title { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--mat-sys-on-surface-variant); margin: 16px 0 8px; }
    .count-badge { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); border-radius: 12px; padding: 2px 8px; font-size: 12px; }
    .order-card { margin-bottom: 12px; border-left: 4px solid var(--mat-sys-outline-variant); }
    .order-card.help-needed { border-left-color: var(--mat-sys-tertiary); }
    .order-card.urgent { border-left-color: var(--mat-sys-error); }
    .order-card.high-priority { border-left-color: var(--mat-sys-tertiary); }
    .order-meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
    .deadline { display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--mat-sys-on-surface-variant); }
    .deadline.overdue { color: var(--mat-sys-error); font-weight: 500; }
    .deadline mat-icon { font-size: 16px; height: 16px; width: 16px; }
    .estimated { font-size: 12px; color: var(--mat-sys-on-surface-variant); background: var(--mat-sys-surface-variant); padding: 2px 8px; border-radius: 4px; }
    .source-badge { font-size: 12px; background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); padding: 2px 8px; border-radius: 4px; }
    .studio-badge { font-size: 12px; background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); padding: 2px 8px; border-radius: 4px; }
    .help-badge { font-size: 11px; background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); padding: 2px 8px; border-radius: 4px; margin-left: 8px; }
    .help-message { display: flex; align-items: center; gap: 8px; margin-top: 8px; padding: 8px; background: var(--mat-sys-error-container); border-radius: 4px; font-size: 13px; color: var(--mat-sys-on-error-container); }
    .urgent-icon { font-size: 18px; height: 18px; width: 18px; margin-left: 4px; }
    .loading { padding: 32px; text-align: center; color: var(--mat-sys-on-surface-variant); }
    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 48px; color: var(--mat-sys-outline); gap: 8px; }
    .empty-state mat-icon { font-size: 48px; height: 48px; width: 48px; }
    .my-orders { margin-bottom: 24px; }
    mat-card-title { display: flex; align-items: center; gap: 8px; }
    mat-card-title mat-icon { font-size: 20px; height: 20px; width: 20px; }
    .help-form { margin-top: 12px; }
    .help-input { width: 100%; }
    .help-form-actions { display: flex; gap: 8px; margin-top: 4px; }
  `],
})
export class OrderQueueComponent implements OnDestroy {
  private readonly api = inject(OrderAssignmentsApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  readonly timer = inject(DeadlineTimerService);

  pendingOrders = signal<OrderAssignment[]>([]);
  myOrders = signal<OrderAssignment[]>([]);
  loading = signal(false);
  helpOrder = signal<OrderAssignment | null>(null);
  helpMessage = signal('');

  private refreshInterval?: ReturnType<typeof setInterval>;

  constructor() {
    // afterNextRender: выполняется только в браузере, SSR-совместимо
    afterNextRender(() => {
      this.loadAll();
      this.refreshInterval = setInterval(() => this.loadAll(), 30000);
    });
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  loadAll(): void {
    this.loading.set(true);
    this.api.getPending()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: orders => { this.pendingOrders.set(orders); this.loading.set(false); },
        error: () => this.loading.set(false),
      });
    this.api.getMy()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: orders => this.myOrders.set(orders),
      });
  }

  takeOrder(order: OrderAssignment): void {
    this.api.take(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.loadAll() });
  }

  completeOrder(order: OrderAssignment): void {
    this.api.complete(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.loadAll() });
  }

  joinOrder(order: OrderAssignment): void {
    this.api.join(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: () => this.loadAll() });
  }

  askHelp(order: OrderAssignment): void {
    // Inline форма вместо нативного prompt()
    this.helpOrder.set(order);
    this.helpMessage.set('');
  }

  cancelHelp(): void {
    this.helpOrder.set(null);
    this.helpMessage.set('');
  }

  submitHelp(order: OrderAssignment): void {
    const message = this.helpMessage().trim();
    if (!message) return;
    this.api.requestHelp(order.id, message)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.cancelHelp();
          this.loadAll();
        },
      });
  }

  orderTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      print: 'print', retouch: 'brush', photo: 'photo_camera',
      marketplace: 'storefront', scan: 'scanner', design: 'design_services', other: 'more_horiz',
    };
    return icons[type] ?? 'assignment';
  }

  orderTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      print: 'Печать', retouch: 'Ретушь', photo: 'Съёмка',
      marketplace: 'Маркетплейс', scan: 'Сканирование', design: 'Дизайн', other: 'Другое',
    };
    return labels[type] ?? type;
  }

  sourceLabel(source: string): string {
    const labels: Record<string, string> = {
      online: 'Онлайн', pos: 'POS', chat: 'Чат', phone: 'Телефон', walk_in: 'Walk-in',
    };
    return labels[source] ?? source;
  }

  needsPrinting(order: OrderAssignment): boolean {
    const meta = order.metadata as Record<string, unknown>;
    return Boolean(meta?.['needs_printing']) || order.order_type === 'print';
  }

  openPrintDialog(order: OrderAssignment): void {
    const meta = order.metadata as Record<string, unknown>;
    const fileUrl = typeof meta?.['file_url'] === 'string' ? meta['file_url'] : undefined;
    if (!fileUrl) return;

    const printerType =
      order.order_type === 'print' || order.order_type === 'photo' ? 'photo' : 'mfp';

    this.dialog.open(
      PrintDialogComponent,
      printDialogConfig({
        file_url: fileUrl,
        file_name: typeof meta?.['file_name'] === 'string' ? meta['file_name'] : undefined,
        order_id: order.order_id,
        order_type: order.order_type,
        preferred_printer_type: printerType,
      }),
    );
  }

}
