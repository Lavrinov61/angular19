import {
  Component, inject, signal, computed, OnInit, ChangeDetectionStrategy, DestroyRef,
  Input, effect,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import {
  ProductionApiService, ProductionOrder, ProductionOrderStatus, PrintingHouse,
} from '../../../services/production-api.service';
import { WebSocketService } from '../../../../../core/services/websocket.service';
import { CreateProductionOrderComponent } from '../create-production-order/create-production-order.component';
import { ProductionOrderDetailComponent } from './production-order-detail.component';
import {
  PRODUCTION_STATUS_CONFIG, getNextStatuses, formatProductionCost, isOrderOverdue,
} from '../production.constants';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';
import { PromptDialogComponent, PromptDialogData } from '../../shared/prompt-dialog.component';

const STATUS_CONFIG = PRODUCTION_STATUS_CONFIG;

@Component({
  selector: 'app-production-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatChipsModule,
    MatProgressSpinnerModule, MatSelectModule, MatFormFieldModule, MatInputModule,
    MatCheckboxModule, MatMenuModule, MatTooltipModule, MatPaginatorModule,
    MatSnackBarModule, FormsModule, DatePipe,
  ],
  template: `
    <div class="orders-page">
      <!-- Filters -->
      <div class="filters-bar">
        <div class="status-chips">
          <button mat-button
            [class.active]="filterStatus() === ''"
            (click)="setStatus('')">
            Все
          </button>
          @for (s of statusList; track s) {
            <button mat-button
              [class.active]="filterStatus() === s"
              (click)="setStatus(s)"
              [style.color]="filterStatus() === s ? '#fff' : STATUS[s].color"
              [style.background]="filterStatus() === s ? STATUS[s].color : STATUS[s].color + '1a'"
              [style.border]="'1px solid ' + STATUS[s].color + '55'">
              {{ STATUS[s].label }}
            </button>
          }
        </div>

        <mat-form-field class="search-field" subscriptSizing="dynamic">
          <mat-label>Поиск</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input matInput [ngModel]="searchQuery()"
                 (ngModelChange)="onSearchChange($event)"
                 placeholder="Номер заказа или клиент" />
        </mat-form-field>

        <mat-form-field class="house-filter" subscriptSizing="dynamic">
          <mat-label>Типография</mat-label>
          <mat-select [(ngModel)]="selectedHouseId" (ngModelChange)="resetAndLoad()">
            <mat-option value="">Все</mat-option>
            @for (h of houses(); track h.id) {
              <mat-option [value]="h.id">{{ h.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <!-- Batch actions -->
      @if (selected().size > 0) {
        <div class="batch-bar">
          <mat-checkbox
            [checked]="allSelected()"
            [indeterminate]="someSelected()"
            (change)="toggleSelectAll()"
          />
          <span>Выбрано: {{ selected().size }}</span>
          <button mat-stroked-button (click)="batchStatus('sent')">
            <mat-icon>send</mat-icon> Отправить
          </button>
          <button mat-stroked-button (click)="batchStatus('confirmed')">
            <mat-icon>check</mat-icon> Подтвердить
          </button>
          <button mat-stroked-button color="warn" (click)="batchCancel()">
            <mat-icon>cancel</mat-icon> Отменить
          </button>
          <button mat-icon-button (click)="clearSelected()">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      <!-- Select-all trigger when nothing selected -->
      @if (orders().length > 0 && selected().size === 0) {
        <div class="select-all-hint">
          <mat-checkbox (change)="toggleSelectAll()">Выбрать все {{ orders().length }}</mat-checkbox>
        </div>
      }

      <!-- Orders list -->
      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="40" />
        </div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button (click)="load()">Повторить</button>
        </div>
      } @else if (orders().length === 0) {
        <div class="empty-state">
          <mat-icon>inbox</mat-icon>
          <p>{{ searchQuery() ? 'Ничего не найдено' : 'Заказов пока нет' }}</p>
          @if (!searchQuery()) {
            <button mat-flat-button color="primary" (click)="openCreate()">
              Создать первый заказ
            </button>
          }
        </div>
      } @else {
        <div class="orders-list">
          @for (order of orders(); track order.id) {
            <mat-card class="order-card" appearance="outlined" (click)="openDetail(order)">
              <div class="order-row">
                <mat-checkbox
                  [checked]="selected().has(order.id)"
                  (change)="toggleSelect(order.id)"
                  (click)="$event.stopPropagation()"
                />
                <div class="order-main">
                  <div class="order-header">
                    <span class="order-number">{{ order.order_number }}</span>
                    <span class="status-chip" [style.background]="STATUS[order.status].color + '22'"
                          [style.color]="STATUS[order.status].color">
                      {{ STATUS[order.status].label }}
                    </span>
                    @if (order.photo_print_order_number) {
                      <span class="linked-badge" matTooltip="Привязан к клиентскому заказу">
                        <mat-icon>link</mat-icon>
                        {{ order.photo_print_order_number }}
                      </span>
                    }
                  </div>

                  <div class="order-meta">
                    <span class="meta-item">
                      <mat-icon>business</mat-icon>
                      {{ order.printing_house_name }}
                    </span>
                    @if (order.customer_name) {
                      <span class="meta-item">
                        <mat-icon>person</mat-icon>
                        {{ order.customer_name }}
                      </span>
                    }
                    @if (order.deadline_at) {
                      <span class="meta-item" [class.overdue]="isOverdue(order)">
                        <mat-icon>schedule</mat-icon>
                        {{ order.deadline_at | date:'d MMM' }}
                      </span>
                    }
                  </div>

                  <div class="order-items">
                    @for (item of order.items.slice(0, 2); track item.product_id) {
                      <span class="item-tag">{{ item.product_name }} × {{ item.quantity }}</span>
                    }
                    @if (order.items.length > 2) {
                      <span class="item-tag more">+{{ order.items.length - 2 }}</span>
                    }
                  </div>
                </div>

                <div class="order-cost">
                  {{ formatCost(order.total_cost) }}
                </div>

                <button mat-icon-button [matMenuTriggerFor]="menu" (click)="$event.stopPropagation()"
                        aria-label="Действия">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #menu>
                  @for (s of nextStatuses(order.status); track s) {
                    <button mat-menu-item (click)="changeStatus(order, s)">
                      <mat-icon>{{ statusIcon(s) }}</mat-icon>
                      {{ STATUS[s].label }}
                    </button>
                  }
                  <button mat-menu-item (click)="openDetail(order)">
                    <mat-icon>open_in_new</mat-icon> Открыть
                  </button>
                  @if (order.status !== 'cancelled' && order.status !== 'completed') {
                    <button mat-menu-item (click)="cancelOrder(order)">
                      <mat-icon>cancel</mat-icon> Отменить
                    </button>
                  }
                </mat-menu>
              </div>
            </mat-card>
          }
        </div>

        <mat-paginator
          [length]="total()"
          [pageSize]="pageSize()"
          [pageIndex]="page()"
          [pageSizeOptions]="[20, 50, 100]"
          (page)="onPageChange($event)"
          showFirstLastButtons
        />
      }

      <!-- FAB -->
      <button mat-fab class="fab-create" color="primary" (click)="openCreate()"
              aria-label="Создать заказ в типографию" matTooltip="Новый заказ в типографию">
        <mat-icon>add</mat-icon>
      </button>
    </div>
  `,
  styles: `
    .orders-page {
      padding: 16px;
      max-width: 1000px;
      margin: 0 auto;
      position: relative;
      min-height: 200px;
    }

    .filters-bar {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }

    .status-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      flex: 1;

      button {
        font-size: 13px;
        min-width: unset;
        padding: 0 10px;
        height: 30px;
        border-radius: 16px;
        transition: background 0.15s, color 0.15s;
        line-height: 28px;

        /* "Все" — использует accent */
        &:first-child.active {
          background: var(--crm-accent);
          color: #fff;
        }
      }
    }

    .search-field { width: 220px; }
    .house-filter { width: 180px; }

    .batch-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: var(--crm-surface-hover);
      border-radius: 8px;
      margin-bottom: 12px;
      flex-wrap: wrap;

      span { font-size: 13px; font-weight: 500; }
    }

    .select-all-hint {
      margin-bottom: 8px;
      padding: 0 4px;
      font-size: 13px;
    }

    .orders-list { display: flex; flex-direction: column; gap: 8px; }

    .order-card {
      cursor: pointer;
      transition: box-shadow 0.15s;

      &:hover { box-shadow: 0 2px 8px rgba(0,0,0,.15); }
    }

    .order-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
    }

    .order-main { flex: 1; min-width: 0; }

    .order-header {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }

    .order-number {
      font-weight: 600;
      font-size: 14px;
      color: var(--crm-text-primary);
      font-family: monospace;
    }

    .status-chip {
      font-size: 12px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .linked-badge {
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 12px;
      color: var(--crm-accent);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .order-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 6px;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 12px;
      color: var(--crm-text-secondary);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.overdue { color: #f87171; }
    }

    .order-items {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .item-tag {
      font-size: 11px;
      padding: 2px 8px;
      background: var(--crm-surface-hover);
      border-radius: 10px;
      color: var(--crm-text-secondary);

      &.more { color: var(--crm-accent); }
    }

    .order-cost {
      font-size: 15px;
      font-weight: 600;
      color: var(--crm-text-primary);
      white-space: nowrap;
      padding-top: 2px;
    }

    .loading-state, .empty-state, .error-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--crm-text-secondary);

      mat-icon { font-size: 48px; width: 48px; height: 48px; }
      p { margin: 12px 0 16px; font-size: 16px; }
    }
    .error-state mat-icon { color: var(--crm-danger, #f87171); }

    .fab-create {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 100;
    }
  `,
})
export class ProductionOrdersComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly wsService = inject(WebSocketService);

  @Input() set deepLinkOrderId(orderId: string | null) {
    if (orderId) {
      // Открыть detail dialog как только список загрузится
      this._pendingDeepLink = orderId;
    }
  }
  private _pendingDeepLink: string | null = null;

  readonly STATUS = STATUS_CONFIG;
  readonly statusList = Object.keys(STATUS_CONFIG) as ProductionOrderStatus[];

  readonly orders = signal<ProductionOrder[]>([]);
  readonly houses = signal<PrintingHouse[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly filterStatus = signal<string>('');
  readonly searchQuery = signal('');
  readonly selected = signal(new Set<string>());
  readonly page = signal(0);
  readonly pageSize = signal(50);
  readonly total = signal(0);

  selectedHouseId = '';

  private readonly searchSubject = new Subject<string>();

  private readonly _wsEffect = effect(() => {
    const evt = this.wsService.productionEvent();
    if (evt) {
      this.load();
    }
  });

  readonly allSelected = computed(() => {
    const ids = this.orders();
    return ids.length > 0 && ids.every(o => this.selected().has(o.id));
  });

  readonly someSelected = computed(() => {
    const ids = this.orders();
    return ids.some(o => this.selected().has(o.id)) && !this.allSelected();
  });

  ngOnInit() {
    this.load();
    this.api.getHouses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: h => this.houses.set(h),
      error: () => undefined,
    });
    this.searchSubject.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(() => this.resetAndLoad());

  }

  onSearchChange(value: string) {
    this.searchQuery.set(value);
    this.searchSubject.next(value);
  }

  setStatus(status: string) {
    this.filterStatus.set(status);
    this.resetAndLoad();
  }

  resetAndLoad() {
    this.page.set(0);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    const params: {
      status?: string; printing_house_id?: string;
      search?: string; limit?: number; offset?: number;
    } = {
      limit: this.pageSize(),
      offset: this.page() * this.pageSize(),
    };
    if (this.filterStatus()) params['status'] = this.filterStatus();
    if (this.selectedHouseId) params['printing_house_id'] = this.selectedHouseId;
    if (this.searchQuery()) params['search'] = this.searchQuery();

    this.api.getOrders(params).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: r => {
        this.orders.set(r.data);
        this.total.set(r.total);
        this.loading.set(false);
        // Deep-link: открыть dialog после первой загрузки
        if (this._pendingDeepLink) {
          const id = this._pendingDeepLink;
          this._pendingDeepLink = null;
          this.dialog.open(ProductionOrderDetailComponent, {
            width: '640px', maxWidth: '98vw', data: { orderId: id },
          }).afterClosed().subscribe(changed => { if (changed) this.load(); });
        }
      },
      error: () => {
        this.error.set('Не удалось загрузить заказы');
        this.loading.set(false);
      },
    });
  }

  onPageChange(event: PageEvent) {
    this.page.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.load();
  }

  toggleSelect(id: string) {
    const s = new Set(this.selected());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.selected.set(s);
  }

  toggleSelectAll() {
    if (this.allSelected()) {
      this.selected.set(new Set());
    } else {
      this.selected.set(new Set(this.orders().map(o => o.id)));
    }
  }

  clearSelected() { this.selected.set(new Set()); }

  batchStatus(status: ProductionOrderStatus) {
    const ids = [...this.selected()];
    this.api.batchUpdateStatus(ids, status).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => { this.clearSelected(); this.load(); },
      error: () => this.snackBar.open('Ошибка при обновлении статусов', 'OK', { duration: 4000 }),
    });
  }

  batchCancel() {
    const count = this.selected().size;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Отменить заказы',
        message: `Отменить выбранные заказы (${count} шт.)?`,
        icon: 'cancel',
        warn: true,
        confirmLabel: 'Отменить',
      } as ConfirmDialogData,
    });
    ref.afterClosed().subscribe(ok => { if (ok) this.batchStatus('cancelled'); });
  }

  changeStatus(order: ProductionOrder, status: ProductionOrderStatus) {
    this.api.updateOrderStatus(order.id, status).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        const label = PRODUCTION_STATUS_CONFIG[status]?.label ?? status;
        this.snackBar.open(`Статус изменён: ${label}`, 'OK', { duration: 3000 });
        this.load();
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Недопустимый переход статуса';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }

  cancelOrder(order: ProductionOrder) {
    const ref = this.dialog.open(PromptDialogComponent, {
      width: '420px',
      data: {
        title: 'Отменить заказ',
        message: `Заказ ${order.order_number} будет отменён.`,
        label: 'Причина отмены',
        placeholder: 'Укажите причину (необязательно)',
        confirmLabel: 'Отменить заказ',
      } as PromptDialogData,
    });
    ref.afterClosed().subscribe((reason: string | null) => {
      if (reason === null) return; // Пользователь нажал «Отмена»
      this.api.cancelOrder(order.id, reason || undefined).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.snackBar.open('Заказ отменён', 'OK', { duration: 3000 });
          this.load();
        },
        error: () => this.snackBar.open('Не удалось отменить заказ', 'OK', { duration: 4000 }),
      });
    });
  }

  openDetail(order: ProductionOrder) {
    this.dialog.open(ProductionOrderDetailComponent, {
      width: '640px',
      maxWidth: '98vw',
      data: { orderId: order.id },
    }).afterClosed().subscribe(changed => { if (changed) this.load(); });
  }

  openCreate() {
    this.dialog.open(CreateProductionOrderComponent, {
      width: '720px',
      maxWidth: '98vw',
    }).afterClosed().subscribe(created => { if (created) this.load(); });
  }

  isOverdue = isOrderOverdue;
  formatCost = formatProductionCost;
  nextStatuses = getNextStatuses;

  statusIcon(s: ProductionOrderStatus): string {
    const icons: Partial<Record<ProductionOrderStatus, string>> = {
      sent: 'send', confirmed: 'check_circle', in_production: 'precision_manufacturing',
      quality_check: 'verified', shipped: 'local_shipping', delivered: 'done_all',
      completed: 'task_alt', cancelled: 'cancel', returned: 'undo',
    };
    return icons[s] ?? 'arrow_forward';
  }
}
