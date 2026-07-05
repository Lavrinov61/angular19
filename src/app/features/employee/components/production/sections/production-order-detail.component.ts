import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import {
  ProductionApiService, ProductionOrder, ProductionOrderEvent, ProductionOrderStatus,
} from '../../../services/production-api.service';
import {
  PRODUCTION_STATUS_CONFIG, getNextStatuses, formatProductionCost, isOrderOverdue, deliveryLabel,
} from '../production.constants';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

const STATUS_CONFIG = PRODUCTION_STATUS_CONFIG;

@Component({
  selector: 'app-production-order-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatChipsModule, MatCheckboxModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatSnackBarModule, FormsModule, DatePipe,
  ],
  template: `
    <div mat-dialog-title>
      @if (order(); as o) {
        <div class="dialog-title">
          <span>{{ o.order_number }}</span>
          <span class="status-chip" [style.background]="STATUS[o.status].color + '22'" [style.color]="STATUS[o.status].color">
            {{ STATUS[o.status].label }}
          </span>
        </div>
      } @else {
        <span>Загрузка...</span>
      }
    </div>

    <mat-dialog-content>
      @if (loading()) {
        <div class="loading-state"><mat-spinner diameter="36" /></div>
      } @else if (loadError()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ loadError() }}</p>
          <button mat-flat-button (click)="reloadOrder()">Повторить</button>
        </div>
      } @else {
        @let o = order();
        @if (o) {
        <!-- Main info -->
        <div class="info-grid">
          <div class="info-item">
            <span class="label">Типография</span>
            <span class="value">{{ o.printing_house_name }}</span>
          </div>
          @if (o.customer_name) {
            <div class="info-item">
              <span class="label">Клиент</span>
              <span class="value">{{ o.customer_name }}</span>
            </div>
          }
          @if (o.photo_print_order_number) {
            <div class="info-item">
              <span class="label">Клиентский заказ</span>
              <button class="value link-value link-btn"
                      (click)="openLinkedOrder(o.photo_print_order_id)">
                <mat-icon>open_in_new</mat-icon>
                {{ o.photo_print_order_number }}
              </button>
            </div>
          }
          <div class="info-item">
            <span class="label">Доставка</span>
            <span class="value">{{ deliveryLabel(o.delivery_method) }}</span>
          </div>
          @if (o.deadline_at) {
            <div class="info-item">
              <span class="label">Дедлайн</span>
              <span class="value" [class.overdue]="isOverdue(o)">{{ o.deadline_at | date:'d MMM yyyy' }}</span>
            </div>
          }
          @if (o.tracking_number) {
            <div class="info-item">
              <span class="label">Трек-номер</span>
              <span class="value mono">{{ o.tracking_number }}</span>
            </div>
          }
        </div>

        <!-- Items -->
        <h3 class="section-title">Состав заказа</h3>
        <div class="items-table">
          <div class="items-header">
            <span>Продукт</span>
            <span>Кол-во</span>
            <span>Цена</span>
            <span>Итого</span>
          </div>
          @for (item of o.items; track item.product_id) {
            <div class="items-row">
              <div>
                <div class="item-name">{{ item.product_name }}</div>
                @if (item.specs && objectKeys(item.specs).length) {
                  <div class="item-specs">
                    @for (key of objectKeys(item.specs); track key) {
                      <span>{{ key }}: {{ item.specs[key] }}</span>
                    }
                  </div>
                }
              </div>
              <span>{{ item.quantity }}</span>
              <span>{{ item.unit_price }}₽</span>
              <span class="item-total">{{ item.total_price }}₽</span>
            </div>
          }
          <div class="items-footer">
            <span>Итого</span>
            <span class="total-cost">{{ o.total_cost }}₽</span>
          </div>
        </div>

        <!-- Status change -->
        @if (nextStatuses(o.status).length > 0) {
          <h3 class="section-title">Сменить статус</h3>
          <div class="status-actions">
            @for (s of nextStatuses(o.status); track s) {
              <button mat-stroked-button (click)="changeStatus(o, s)" [disabled]="saving()">
                {{ STATUS[s].label }}
              </button>
            }
          </div>
        }

        <!-- Send to printing house -->
        @if (o.status === 'draft' || o.status === 'pending') {
          <h3 class="section-title">Отправить в типографию</h3>
          <button mat-flat-button color="primary" (click)="openSendDialog(o)">
            <mat-icon>email</mat-icon> Отправить ТЗ по email
          </button>
        }
        @if (o.status === 'sent') {
          <div class="send-actions">
            <button mat-stroked-button (click)="openSendDialog(o)">
              <mat-icon>forward_to_inbox</mat-icon> Переотправить
            </button>
          </div>
        }

        <!-- Quality rating (for delivered/completed) -->
        @if (o.status === 'delivered' || o.status === 'completed') {
          <h3 class="section-title">Оценка качества</h3>
          <div class="quality-section">
            <div class="stars">
              @for (star of [1,2,3,4,5]; track star) {
                <button mat-icon-button (click)="qualityRating.set(star)"
                        [attr.aria-label]="'Оценить ' + star + ' из 5'">
                  <mat-icon [class.filled]="star <= qualityRating()">
                    {{ star <= qualityRating() ? 'star' : 'star_border' }}
                  </mat-icon>
                </button>
              }
            </div>
            <mat-form-field class="full-width" subscriptSizing="dynamic">
              <mat-label>Комментарий</mat-label>
              <textarea matInput [(ngModel)]="qualityNotes" rows="2"></textarea>
            </mat-form-field>
            <mat-checkbox [(ngModel)]="hasDefects">Есть брак</mat-checkbox>
            <button mat-flat-button color="primary" [disabled]="!qualityRating() || saving()"
                    (click)="submitQuality(o.id)">
              Сохранить оценку
            </button>
          </div>
        }

        <!-- Internal notes -->
        @if (o.internal_notes) {
          <h3 class="section-title">Внутренние заметки</h3>
          <p class="notes-text">{{ o.internal_notes }}</p>
        }

        <!-- Timeline -->
        <h3 class="section-title">История</h3>
        @if (timeline().length === 0) {
          <p class="empty-timeline">Нет событий</p>
        } @else {
          <div class="timeline">
            @for (event of timeline(); track event.id) {
              <div class="timeline-item">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-header">
                    <span class="event-type">{{ eventLabel(event.event_type) }}</span>
                    <span class="event-time">{{ event.created_at | date:'d MMM, HH:mm' }}</span>
                  </div>
                  @if (event.old_value || event.new_value) {
                    <div class="event-change">
                      @if (event.old_value) { <span class="old">{{ event.old_value }}</span> }
                      <mat-icon>arrow_forward</mat-icon>
                      @if (event.new_value) { <span class="new">{{ event.new_value }}</span> }
                    </div>
                  }
                  @if (event.comment) {
                    <p class="event-comment">{{ event.comment }}</p>
                  }
                  @if (event.created_by_name) {
                    <span class="event-author">{{ event.created_by_name }}</span>
                  }
                </div>
              </div>
            }
          </div>
        }
        }
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="changed">Закрыть</button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-title { display: flex; align-items: center; gap: 10px; }
    .status-chip {
      font-size: 12px; font-weight: 500; padding: 2px 8px; border-radius: 10px;
    }

    .loading-state { display: flex; justify-content: center; padding: 40px; }

    .info-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px; margin-bottom: 20px;
    }
    .info-item { display: flex; flex-direction: column; gap: 2px; }
    .label { font-size: 11px; color: var(--crm-text-secondary); text-transform: uppercase; letter-spacing: .5px; }
    .value { font-size: 14px; font-weight: 500; color: var(--crm-text-primary); }
    .link-btn {
      display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 500;
      color: var(--crm-accent); background: none; border: none; cursor: pointer; padding: 0;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
      &:hover { text-decoration: underline; }
    }
    .value.link-value { display: flex; align-items: center; gap: 4px; color: var(--crm-accent);
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .error-state {
      text-align: center; padding: 40px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; color: var(--crm-danger, #f87171); }
      p { margin: 12px 0 16px; font-size: 16px; }
    }
    .value.overdue { color: #f87171; }
    .value.mono { font-family: monospace; }

    .section-title {
      font-size: 14px; font-weight: 600; color: var(--crm-text-primary);
      margin: 20px 0 8px; border-bottom: 1px solid var(--crm-border); padding-bottom: 4px;
    }

    .items-table { border-radius: 8px; overflow: hidden; border: 1px solid var(--crm-border); }
    .items-header {
      display: grid; grid-template-columns: 1fr 60px 80px 80px;
      padding: 8px 12px; background: var(--crm-surface-hover);
      font-size: 12px; font-weight: 600; color: var(--crm-text-secondary);
    }
    .items-row {
      display: grid; grid-template-columns: 1fr 60px 80px 80px;
      padding: 10px 12px; border-top: 1px solid var(--crm-border);
      font-size: 13px; align-items: start;
    }
    .item-name { font-weight: 500; }
    .item-specs { font-size: 11px; color: var(--crm-text-secondary); margin-top: 2px; }
    .item-specs span::after { content: ', '; }
    .item-specs span:last-child::after { content: ''; }
    .item-total { font-weight: 600; }
    .items-footer {
      display: flex; justify-content: space-between; padding: 10px 12px;
      border-top: 2px solid var(--crm-border); background: var(--crm-surface-hover);
      font-weight: 600;
    }
    .total-cost { color: var(--crm-accent); font-size: 16px; }

    .status-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .send-actions { margin: 8px 0; }

    .quality-section { display: flex; flex-direction: column; gap: 10px; }
    .stars { display: flex; gap: 0; }
    .stars button mat-icon { color: #d1d5db; }
    .stars button mat-icon.filled { color: #fbbf24; }
    .full-width { width: 100%; }

    .notes-text { font-size: 14px; color: var(--crm-text-secondary); white-space: pre-wrap; }

    .empty-timeline { font-size: 13px; color: var(--crm-text-secondary); padding: 8px 0; }

    .timeline { display: flex; flex-direction: column; gap: 0; }
    .timeline-item { display: flex; gap: 12px; padding-bottom: 16px; position: relative; }
    .timeline-item::before {
      content: ''; position: absolute; left: 7px; top: 16px; bottom: 0;
      width: 2px; background: var(--crm-border);
    }
    .timeline-item:last-child::before { display: none; }
    .timeline-dot {
      width: 16px; height: 16px; border-radius: 50%;
      background: var(--crm-accent); flex-shrink: 0; margin-top: 2px;
    }
    .timeline-content { flex: 1; min-width: 0; }
    .timeline-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
    .event-type { font-size: 13px; font-weight: 600; }
    .event-time { font-size: 12px; color: var(--crm-text-secondary); }
    .event-change { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-bottom: 4px;
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-text-secondary); }
    }
    .old { color: #f87171; text-decoration: line-through; }
    .new { color: #34d399; }
    .event-comment { font-size: 13px; color: var(--crm-text-secondary); margin: 4px 0 0; }
    .event-author { font-size: 11px; color: var(--crm-text-secondary); }
  `,
})
export class ProductionOrderDetailComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialogRef = inject(MatDialogRef<ProductionOrderDetailComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly data = inject<{ orderId: string }>(MAT_DIALOG_DATA);
  private readonly router = inject(Router);

  readonly STATUS = STATUS_CONFIG;

  readonly order = signal<ProductionOrder | null>(null);
  readonly timeline = signal<ProductionOrderEvent[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);

  qualityRating = signal(0);
  qualityNotes = '';
  hasDefects = false;
  changed = false;

  ngOnInit() {
    this.reloadOrder();
  }

  reloadOrder() {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.getOrder(this.data.orderId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: o => {
        this.order.set(o);
        this.qualityRating.set(o.quality_rating ?? 0);
        this.qualityNotes = o.quality_notes ?? '';
        this.hasDefects = o.has_defects;
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('Не удалось загрузить заказ');
        this.loading.set(false);
      },
    });
    this.api.getTimeline(this.data.orderId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: t => this.timeline.set(t),
      error: () => undefined,
    });
  }

  openLinkedOrder(photoOrderId: string | null) {
    if (!photoOrderId) return;
    this.dialogRef.close(false);
    void this.router.navigate(['/employee/order-queue'], { queryParams: { orderId: photoOrderId } });
  }

  changeStatus(order: ProductionOrder, status: ProductionOrderStatus) {
    const doChange = () => {
      this.saving.set(true);
      this.api.updateOrderStatus(order.id, status).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: updated => {
          this.order.set(updated);
          this.saving.set(false);
          const label = PRODUCTION_STATUS_CONFIG[status]?.label ?? status;
          this.changed = true;
          this.snackBar.open(`Статус изменён: ${label}`, 'OK', { duration: 3000 });
          this.api.getTimeline(order.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(t => this.timeline.set(t));
        },
        error: err => {
          this.saving.set(false);
          this.snackBar.open(err?.error?.message ?? 'Не удалось изменить статус', 'OK', { duration: 4000 });
        },
      });
    };

    if (status === 'cancelled') {
      const ref = this.dialog.open(ConfirmDialogComponent, {
        data: {
          title: 'Отменить заказ',
          message: `Заказ ${order.order_number} будет отменён. Продолжить?`,
          icon: 'cancel',
          warn: true,
          confirmLabel: 'Отменить заказ',
        } as ConfirmDialogData,
      });
      ref.afterClosed().subscribe(ok => { if (ok) doChange(); });
    } else {
      doChange();
    }
  }

  submitQuality(id: string) {
    this.saving.set(true);
    this.api.rateQuality(id, this.qualityRating(), this.qualityNotes, this.hasDefects)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: updated => {
          this.order.set(updated);
          this.saving.set(false);
          this.snackBar.open('Оценка качества сохранена', 'OK', { duration: 3000 });
        },
        error: err => {
          this.saving.set(false);
          this.snackBar.open(err?.error?.message ?? 'Ошибка при сохранении оценки', 'OK', { duration: 4000 });
        },
      });
  }

  nextStatuses = getNextStatuses;
  isOverdue = isOrderOverdue;
  formatCost = formatProductionCost;
  deliveryLabel = deliveryLabel;

  eventLabel(type: string): string {
    const map: Record<string, string> = {
      created: 'Создание заказа',
      status_change: 'Смена статуса',
      note_added: 'Заметка',
      quality_review: 'Оценка качества',
      deadline_changed: 'Изменён дедлайн',
    };
    return map[type] ?? type;
  }

  objectKeys(obj: Record<string, unknown>): string[] {
    return Object.keys(obj);
  }

  openSendDialog(order: ProductionOrder): void {
    import('../send-to-production-dialog.component').then(m => {
      const ref = this.dialog.open(m.SendToProductionDialogComponent, {
        width: '700px',
        data: { source: 'production_order' as const, orderId: order.id },
      });
      ref.afterClosed().subscribe(sent => {
        if (sent) {
          this.changed = true;
          this.reloadOrder();
        }
      });
    });
  }
}
