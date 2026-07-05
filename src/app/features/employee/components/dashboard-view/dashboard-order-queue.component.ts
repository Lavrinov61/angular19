import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, inject, signal, computed, effect, output, ChangeDetectionStrategy } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { DashboardDataService, OrderQueueItem } from '../../services/dashboard-data.service';
import { OrdersApiService, PhotoPrintOrderItem } from '../../services/orders-api.service';
import { DeadlineTimerService } from '../../services/deadline-timer.service';
import { DeadlineTimerPipe } from '../../pipes/deadline-timer.pipe';
import { formatRelativeTime } from '../../utils/crm-helpers';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { batchPrintDialogConfig } from '../../utils/print-dialog-config';
import type { BatchPrintDialogData } from '../batch-print-dialog/batch-print-dialog.component';
import type { OrderApprovalDialogData, OrderApprovalDialogResult } from '../order-approval-dialog/order-approval-dialog.component';
import { decodeFileName } from '../../../../shared/utils/file-helpers';

type QueueMode = 'active' | 'stale' | 'archive';
type OrderQuickStatus = 'processing' | 'completed' | 'cancelled';
type OrderWorkflowAction = 'print' | 'download';

interface ApiErrorPayload {
  code?: unknown;
  error?: unknown;
}

@Component({
  selector: 'app-dashboard-order-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule, MatMenuModule, DeadlineTimerPipe],
  template: `
    <div class="section-card">
      <div class="section-header">
        <div class="header-left">
          <span class="header-accent-bar"></span>
          <h4 class="editorial-title">ОЧЕРЕДЬ ЗАКАЗОВ</h4>
          <span class="section-count">{{ visibleCount() }}</span>
          <button class="add-order-btn" (click)="createOrder.emit(); $event.stopPropagation()" matTooltip="Создать заказ">
            <mat-icon>add</mat-icon>
          </button>
        </div>
        @if (queueMode() === 'active') {
          <div class="sort-chips">
            <button class="sort-chip" [class.active]="sortMode() === 'deadline'" (click)="sortMode.set('deadline')">
              <mat-icon>timer</mat-icon> Дедлайн
            </button>
            <button class="sort-chip" [class.active]="sortMode() === 'new'" (click)="sortMode.set('new')">
              Новые
            </button>
            <button class="sort-chip" [class.active]="sortMode() === 'price'" (click)="sortMode.set('price')">
              По цене
            </button>
          </div>
        }
      </div>

      <div class="queue-mode-tabs" role="tablist" aria-label="Режим очереди заказов"
           [class.has-stale]="dashData.staleOrderQueueTotal() > 0">
        <button type="button" role="tab" [class.active]="queueMode() === 'active'" (click)="setQueueMode('active')">
          <mat-icon>receipt_long</mat-icon>
          <span>Активные</span>
          <b>{{ dashData.orderQueue().length }}</b>
        </button>
        @if (dashData.staleOrderQueueTotal() > 0) {
          <button type="button" role="tab" class="tab-stale" [class.active]="queueMode() === 'stale'"
                  (click)="setQueueMode('stale')"
                  matTooltip="Неоплаченные заказы старше недели — скрыты из активной очереди">
            <mat-icon>hourglass_disabled</mat-icon>
            <span>Зависшие</span>
            <b>{{ dashData.staleOrderQueueTotal() }}</b>
          </button>
        }
        <button type="button" role="tab" [class.active]="queueMode() === 'archive'" (click)="setQueueMode('archive')">
          <mat-icon>archive</mat-icon>
          <span>Архив</span>
          <b>{{ dashData.archivedOrderQueueTotal() }}</b>
        </button>
      </div>

      @if (queueMode() === 'stale' && dashData.staleOrderQueueTotal() > visibleOrders().length) {
        <div class="stale-trunc">
          Показано {{ visibleOrders().length }} из {{ dashData.staleOrderQueueTotal() }} — закройте или оплатите часть, чтобы увидеть остальные
        </div>
      }

      @if (visibleOrders().length) {
        <div class="queue-grid">
          @for (o of visibleOrders(); track o.id) {
            <div class="qcard"
                 [class]="cardStateClass(o)"
                 [class.urgent]="queueMode() === 'active' && o.priority === 'urgent'"
                 [class.revision]="queueMode() === 'active' && o.revision_requested">

              <!-- Шапка карточки -->
              <div class="qcard-head">
                @if (o.photo_url) {
                  <img [src]="o.photo_url!" class="qthumb" alt="" (error)="onImageError($event)" />
                }
                <div class="qhead-info">
                  <span class="qname">
                    <span class="qnum">{{ extractNum(o.order_id) }}</span>
                    {{ cleanName(o) }}
                  </span>
                  <span class="qmeta">{{ orderPrice(o) }} · {{ itemSummary(o) }}</span>
                </div>
                <button class="qmore" mat-icon-button [matMenuTriggerFor]="moreMenu"
                        (click)="$event.stopPropagation()" matTooltip="Ещё">
                  <mat-icon>more_vert</mat-icon>
                </button>
                <mat-menu #moreMenu="matMenu">
                  @if (o.resolved_phone || o.contact_phone) {
                    <a mat-menu-item [href]="'tel:' + (o.resolved_phone || o.contact_phone)">
                      <mat-icon>phone</mat-icon><span>Позвонить</span>
                    </a>
                  }
                  @if (queueMode() !== 'archive' && hasFiles(o) && o.status === 'processing') {
                    <button mat-menu-item [disabled]="startingWorkflowActionId() === o.id" (click)="printUploadedFiles(o, $event)">
                      <mat-icon>print</mat-icon><span>Пакетная печать</span>
                    </button>
                    <button mat-menu-item [disabled]="downloadingArchiveId() === o.id" (click)="downloadUploadedFiles(o, $event)">
                      <mat-icon>download</mat-icon><span>Скачать всё</span>
                    </button>
                  }
                  @if (queueMode() !== 'archive' && !['completed', 'cancelled'].includes(o.status)) {
                    <button mat-menu-item class="menu-danger" (click)="confirmCancel(o, $event)">
                      <mat-icon>cancel</mat-icon><span>Отменить заказ</span>
                    </button>
                  }
                </mat-menu>
              </div>

              <!-- Обратный отсчёт -->
              @if (queueMode() === 'active') {
                <div class="qtimer" [class]="timer.deadlineClass(o.deadline)" [class.rev]="o.revision_requested">
                  <mat-icon>{{ timer.isOverdue(o.deadline) ? 'warning' : 'timer' }}</mat-icon>
                  <span class="qtime">{{ o.deadline | deadlineTimer:'compact' }}</span>
                  <span class="qtimer-cap">{{ timerCaption(o) }}</span>
                </div>
              } @else if (queueMode() === 'stale') {
                <div class="qtimer stale-timer">
                  <mat-icon>hourglass_disabled</mat-icon>
                  <span class="qtime">{{ staleAgeLabel(o) }}</span>
                  <span class="qtimer-cap">не оплачен</span>
                </div>
              } @else {
                <div class="qtimer archive-timer">
                  <mat-icon>history</mat-icon>
                  <span class="qtime">{{ archiveDate(o) }}</span>
                </div>
              }

              <!-- Статусы / бейджи -->
              <div class="qbadges">
                <span class="qstatus" [class]="'s-' + o.status">{{ statusLabel(o.status) }}</span>
                @if (queueMode() === 'active' && o.revision_requested) {
                  <span class="qbadge rev" matTooltip="Клиент запросил доработку">
                    <mat-icon>autorenew</mat-icon> Доработка
                  </span>
                } @else if (queueMode() === 'active' && isAwaitingApproval(o)) {
                  <span class="qbadge wait" matTooltip="Отправлено клиенту на согласование">
                    <mat-icon>hourglass_top</mat-icon> У клиента
                  </span>
                }
                @if (queueMode() === 'active' && o.escalation_level && o.escalation_level >= 2) {
                  <mat-icon class="qesc" [class.pulse]="o.escalation_level >= 3"
                            [matTooltip]="o.escalation_level >= 3 ? 'Критично просрочен' : 'Просрочен'">priority_high</mat-icon>
                }
              </div>

              <!-- Действия: Подробнее (самое частое) + одно контекстное действие -->
              <div class="qactions">
                <button mat-stroked-button class="act act-details" (click)="openOrder(o); $event.stopPropagation()">
                  <mat-icon>open_in_new</mat-icon> Подробнее
                </button>
                @if (queueMode() !== 'archive') {
                  @if (canAccept(o)) {
                    <button mat-flat-button class="act act-primary act-accept" (click)="acceptOrder(o, $event)">
                      <mat-icon>play_arrow</mat-icon> Принять
                    </button>
                  } @else if (canSendForApproval(o)) {
                    <button mat-flat-button class="act act-primary act-approve" (click)="openApproval(o, $event)">
                      <mat-icon>send</mat-icon> Согласовать
                    </button>
                  } @else if (canFinish(o)) {
                    <button mat-flat-button class="act act-primary act-finish" (click)="quickStatus(o, 'completed', $event)">
                      <mat-icon>check</mat-icon> Завершить
                    </button>
                  }
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="empty-state">
          <mat-icon>inventory_2</mat-icon>
          <span>{{ emptyText() }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .section-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
      overflow: hidden;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 12px 14px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      flex-wrap: wrap;
    }

    .header-left { display: flex; align-items: center; gap: 8px; }

    .header-accent-bar {
      width: 3px; height: 14px; border-radius: 2px;
      background: var(--crm-accent); flex-shrink: 0;
    }

    .editorial-title {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 12px; font-weight: 400; letter-spacing: 0.1em;
      color: var(--crm-text-secondary);
    }

    .section-count {
      font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
      background: var(--crm-accent-muted); color: var(--crm-accent);
    }

    .add-order-btn {
      width: 24px; height: 24px; border: 1px solid var(--crm-accent); border-radius: 50%;
      background: transparent; color: var(--crm-accent); cursor: pointer;
      display: flex; align-items: center; justify-content: center; padding: 0;
      transition: background var(--crm-transition-fast), color var(--crm-transition-fast);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { background: var(--crm-accent); color: var(--crm-on-accent); }
    }

    .sort-chips { display: flex; gap: 4px; }
    .sort-chip {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 11px; font-weight: 500; padding: 4px 10px;
      border-radius: var(--crm-radius-md); border: 1px solid var(--crm-glass-border);
      background: var(--crm-glass-bg); color: var(--crm-text-muted); cursor: pointer;
      transition: all var(--crm-transition-fast);
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
      &:hover { background: var(--crm-glass-bg-hover); color: var(--crm-text-primary); }
      &.active {
        background: var(--crm-accent-muted); color: var(--crm-accent);
        border-color: rgba(245, 158, 11, 0.2); box-shadow: 0 0 12px rgba(245, 158, 11, 0.1);
      }
    }

    .queue-mode-tabs {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 8px 10px 4px;
      &.has-stale { grid-template-columns: 1fr 1fr 1fr; }
      .tab-stale {
        b { background: var(--crm-status-warning-muted); color: var(--crm-status-warning);
          padding: 0 5px; border-radius: 8px; }
        &.active { color: var(--crm-status-warning); border-color: var(--crm-status-warning);
          background: var(--crm-status-warning-muted); }
      }
      button {
        display: inline-flex; align-items: center; justify-content: center; gap: 5px;
        min-width: 0; height: 28px; border: 1px solid var(--crm-glass-border);
        border-radius: var(--crm-radius-sm); background: var(--crm-surface);
        color: var(--crm-text-muted); font-size: 11px; font-weight: 600; cursor: pointer;
        transition: background var(--crm-transition-fast), color var(--crm-transition-fast), border-color var(--crm-transition-fast);
        mat-icon { font-size: 15px; width: 15px; height: 15px; }
        b { color: inherit; font-size: 10px; }
        &.active { color: var(--crm-accent); border-color: var(--crm-accent); background: var(--crm-accent-muted); }
      }
    }

    /* ── Грид карточек-квадратиков ── */
    .queue-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(208px, 1fr));
      gap: 8px;
      padding: 8px;
      max-height: 560px;
      overflow-y: auto;
    }

    .qcard {
      display: flex; flex-direction: column; gap: 8px;
      padding: 10px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface);
      border: 1px solid var(--crm-glass-border);
      border-top: 3px solid var(--crm-status-success);
      transition: transform var(--crm-transition-spring), box-shadow var(--crm-transition-smooth), border-color var(--crm-transition-fast);
      &:hover { transform: translateY(-2px); box-shadow: var(--crm-shadow-card-hover); }
      &.warning { border-top-color: var(--crm-status-warning); }
      &.overdue {
        border-top-color: var(--crm-status-error);
        background: color-mix(in srgb, var(--crm-status-error) 6%, var(--crm-surface));
      }
      &.urgent { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--crm-status-error) 35%, transparent); }
      &.revision {
        border-top-color: var(--crm-status-info);
        background: color-mix(in srgb, var(--crm-status-info) 7%, var(--crm-surface));
      }
      &.archive { border-top-color: rgba(148, 163, 184, 0.35); }
      &.stale { border-top-color: var(--crm-status-warning); opacity: 0.92; }
    }

    .qcard-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .qthumb {
      width: 40px; height: 40px; border-radius: var(--crm-radius-sm);
      object-fit: cover; flex-shrink: 0; border: 1px solid var(--crm-border);
    }
    .qhead-info { display: flex; flex-direction: column; flex: 1; min-width: 0; }
    .qname { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qnum { color: var(--crm-accent); margin-right: 3px; }
    .qmeta { font-size: 10.5px; color: var(--crm-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qmore {
      width: 28px; height: 28px; line-height: 28px; flex-shrink: 0; color: var(--crm-text-muted);
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    /* Обратный отсчёт — доминирующий элемент */
    .qtimer {
      display: flex; align-items: baseline; gap: 6px;
      padding: 6px 10px; border-radius: var(--crm-radius-sm);
      background: color-mix(in srgb, var(--crm-status-success) 10%, transparent);
      color: var(--crm-status-success);
      font-variant-numeric: tabular-nums;
      mat-icon { font-size: 16px; width: 16px; height: 16px; align-self: center; }
      &.warning { background: color-mix(in srgb, var(--crm-status-warning) 12%, transparent); color: var(--crm-status-warning); }
      &.overdue { background: color-mix(in srgb, var(--crm-status-error) 14%, transparent); color: var(--crm-status-error); }
      &.rev { background: color-mix(in srgb, var(--crm-status-info) 14%, transparent); color: var(--crm-status-info); }
    }
    .qtime { font-size: 19px; font-weight: 700; line-height: 1; }
    .qtimer-cap { font-size: 10px; opacity: 0.85; margin-left: auto; align-self: center; text-transform: lowercase; }
    .archive-timer { background: rgba(148,163,184,0.1); color: var(--crm-text-muted);
      .qtime { font-size: 13px; font-weight: 600; } }
    .stale-timer { background: color-mix(in srgb, var(--crm-status-warning) 10%, transparent);
      color: var(--crm-status-warning);
      .qtime { font-size: 15px; font-weight: 700; } }

    .qbadges { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-height: 18px; }
    .qstatus {
      font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 10px;
      &.s-new { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
      &.s-paid { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
      &.s-processing { background: var(--crm-status-info-muted); color: var(--crm-status-info); }
      &.s-ready { background: var(--crm-accent-muted); color: var(--crm-accent); }
      &.s-pending { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
      &.s-pending_payment { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
      &.s-completed { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
      &.s-cancelled { background: rgba(148, 163, 184, 0.14); color: var(--crm-text-muted); }
    }
    .qbadge {
      display: inline-flex; align-items: center; gap: 3px;
      font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px;
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
      &.rev { background: color-mix(in srgb, var(--crm-status-info) 18%, transparent); color: var(--crm-status-info); }
      &.wait { background: var(--crm-accent-muted); color: var(--crm-accent); }
    }
    .qesc { color: var(--crm-status-error); font-size: 16px; width: 16px; height: 16px; margin-left: auto; }
    .pulse { animation: qpulse 1.5s infinite; }
    @keyframes qpulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

    /* Кнопки действий: «Подробнее» (самое частое) + одно контекстное действие.
       Делят ширину поровну; короткие подписи влезают без переноса. */
    .qactions { display: flex; flex-direction: row; gap: 6px; margin-top: auto; }
    .act {
      height: 30px; line-height: 30px; padding: 0 8px; font-size: 11.5px; font-weight: 600;
      min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      mat-icon { font-size: 15px; width: 15px; height: 15px; margin-right: 2px; }
    }
    .act-details, .act-primary { flex: 1 1 0; }
    .act-accept, .act-approve { background: var(--crm-accent) !important; color: var(--crm-on-accent) !important; }
    .act-finish { background: var(--crm-status-success) !important; color: #07210f !important; }
    .menu-danger { color: var(--crm-status-error); }

    .stale-trunc {
      margin: 0 10px 4px; padding: 6px 10px; border-radius: var(--crm-radius-sm);
      font-size: 11px; color: var(--crm-status-warning);
      background: var(--crm-status-warning-muted);
    }

    .empty-state {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      padding: 28px 16px; color: var(--crm-text-muted);
      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.3; }
      span { font-size: 12px; }
    }
  `],
})
export class DashboardOrderQueueComponent {
  readonly dashData = inject(DashboardDataService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly dialog = inject(MatDialog);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly timer = inject(DeadlineTimerService);

  selectItem = output<{ type: string; id: string }>();
  createOrder = output<void>();

  sortMode = signal<'deadline' | 'new' | 'price'>('deadline');
  queueMode = signal<QueueMode>('active');
  downloadingArchiveId = signal<string | null>(null);
  startingWorkflowActionId = signal<string | null>(null);
  executionStartedOverrides = signal(new Map<string, string>());

  sortedQueue = computed(() => {
    const items = [...this.dashData.orderQueue()];
    switch (this.sortMode()) {
      case 'deadline':
        return items.sort((a, b) =>
          new Date(a['deadline'] || a.created_at).getTime() -
          new Date(b['deadline'] || b.created_at).getTime()
        );
      case 'price':
        return items.sort((a, b) => +b.total_price - +a.total_price);
      default:
        return items; // уже DESC по дате с бэкенда
    }
  });

  visibleOrders = computed(() => {
    switch (this.queueMode()) {
      case 'archive': return this.dashData.archivedOrderQueue();
      case 'stale': return this.dashData.staleOrderQueue();
      default: return this.sortedQueue();
    }
  });

  visibleCount = computed(() => {
    switch (this.queueMode()) {
      case 'archive': return this.dashData.archivedOrderQueueTotal();
      case 'stale': return this.dashData.staleOrderQueueTotal();
      default: return this.visibleOrders().length;
    }
  });

  // Если стоим на вкладке «Зависшие» и она опустела (последний заказ закрыт/оплачен) —
  // вкладка скрывается, поэтому возвращаемся на «Активные», чтобы не залипнуть в пустоте.
  private readonly _staleTabFallback = effect(() => {
    if (this.queueMode() === 'stale' && this.dashData.staleOrderQueueTotal() === 0) {
      this.queueMode.set('active');
    }
  });

  setQueueMode(mode: QueueMode): void {
    this.queueMode.set(mode);
    if (mode === 'archive' && this.dashData.archivedOrderQueue().length === 0 && !this.dashData.loadingOrderArchive()) {
      this.dashData.loadOrderArchive();
    }
    if (mode === 'stale' && !this.dashData.loadingStaleOrderQueue()) {
      this.dashData.loadStaleOrderQueue();
    }
  }

  /** Класс-состояние карточки: красный отсчёт только в активной очереди. */
  cardStateClass(o: OrderQueueItem): string {
    switch (this.queueMode()) {
      case 'archive': return 'archive';
      case 'stale': return 'stale';
      default: return this.timer.deadlineClass(o.deadline);
    }
  }

  /** «12 дн» — сколько заказ висит неоплаченным (для вкладки «Зависшие»). */
  staleAgeLabel(o: OrderQueueItem): string {
    const created = new Date(o.created_at).getTime();
    if (!Number.isFinite(created)) return '—';
    const days = Math.max(0, Math.floor((this.timer.now() - created) / 86_400_000));
    const mod10 = days % 10;
    const mod100 = days % 100;
    const word = mod10 === 1 && mod100 !== 11
      ? 'день'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'дня'
        : 'дней';
    return `${days} ${word}`;
  }

  openOrder(order: OrderQueueItem): void {
    this.selectItem.emit({ type: 'order', id: order.order_id });
  }

  quickStatus(o: OrderQueueItem, status: OrderQuickStatus, event: Event): void {
    event.stopPropagation();
    this.updateStatus(o, status);
  }

  acceptOrder(o: OrderQueueItem, event: Event): void {
    event.stopPropagation();
    const shift = this.dashData.workday()?.shift ?? null;
    if (!shift || shift.status !== 'active') {
      this.toast.warning('Сначала начните рабочий день');
      return;
    }

    if (this.requiresStudioOverride(o)) {
      this.confirmStudioOverride(o, () => this.updateStatus(o, 'processing', {
        overrideLocation: true,
      }));
      return;
    }

    this.updateStatus(o, 'processing');
  }

  confirmCancel(o: OrderQueueItem, event: Event): void {
    event.stopPropagation();
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Отменить заказ?',
        message: `Заказ ${o.order_id} будет зафиксирован как отменённый и уйдёт из активной очереди. Это не возврат средств: оплата и подписочные скидки не пересчитываются автоматически.`,
        confirmLabel: 'Отменить заказ',
        cancelLabel: 'Не отменять',
        icon: 'cancel',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) this.updateStatus(o, 'cancelled');
    });
  }

  private updateStatus(
    o: OrderQueueItem,
    status: OrderQuickStatus,
    options: { overrideLocation?: boolean } = {},
  ): void {
    this.ordersApi.updateStatus(o.order_id, status, {
      override_location: options.overrideLocation,
    }).subscribe({
      next: () => {
        this.dashData.loadOrderQueue();
        this.dashData.refreshOrderArchive();
        if (this.queueMode() === 'stale') this.dashData.loadStaleOrderQueue();
        if (status === 'cancelled') this.toast.success('Заказ отменён');
        if (status === 'processing') this.toast.success('Заказ принят в работу');
        if (status === 'completed') this.toast.success('Заказ выполнен');
      },
      error: error => {
        if (status === 'processing' && this.handleAcceptError(o, error)) {
          return;
        }
        this.toast.error(status === 'cancelled'
          ? 'Не удалось отменить заказ'
          : 'Не удалось обновить статус заказа');
      },
    });
  }

  private handleAcceptError(o: OrderQueueItem, error: unknown): boolean {
    const payload = this.apiErrorPayload(error);
    const code = typeof payload?.code === 'string' ? payload.code : null;
    if (code === 'WORKDAY_REQUIRED') {
      this.toast.warning('Сначала начните рабочий день в нужной точке');
      return true;
    }
    if (code === 'ORDER_STUDIO_MISMATCH') {
      this.confirmStudioOverride(o, () => this.updateStatus(o, 'processing', {
        overrideLocation: true,
      }));
      return true;
    }
    return false;
  }

  private apiErrorPayload(error: unknown): ApiErrorPayload | null {
    if (!(error instanceof HttpErrorResponse)) return null;
    return typeof error.error === 'object' && error.error !== null
      ? error.error as ApiErrorPayload
      : null;
  }

  private confirmStudioOverride(o: OrderQueueItem, onConfirm: () => void): void {
    const orderStudio = this.orderStudioLabel(o) || 'другой адрес';
    const currentStudio = this.currentStudioLabel() || 'текущая точка';
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Заказ на другой адрес',
        message: `Заказ адресован: ${orderStudio}. Сейчас вы работаете: ${currentStudio}. Принять всё равно?`,
        confirmLabel: 'Принять всё равно',
        cancelLabel: 'Отмена',
        icon: 'warning',
        warn: true,
      },
    }).afterClosed().subscribe(confirmed => {
      if (confirmed) onConfirm();
    });
  }

  // ─── Согласование прямо с карточки ──────────────────────────────────────────

  /**
   * Можно ли отправить заказ на согласование. Достаточно связанной задачи ретуши
   * в рабочем статусе: сессию согласования бэкенд создаёт лениво при отправке,
   * поэтому её наличие заранее не требуется.
   */
  canSendForApproval(o: OrderQueueItem): boolean {
    return this.queueMode() !== 'archive'
      && !!o.retouch_task_id
      && ['open', 'assigned', 'in_progress'].includes(o.retouch_status ?? '');
  }

  isAwaitingApproval(o: OrderQueueItem): boolean {
    return !!o.retouch_task_id && o.retouch_status === 'waiting';
  }

  async openApproval(o: OrderQueueItem, event: Event): Promise<void> {
    event.stopPropagation();
    if (!o.retouch_task_id) return;
    const { OrderApprovalDialogComponent } = await import('../order-approval-dialog/order-approval-dialog.component');
    this.dialog.open(OrderApprovalDialogComponent, {
      width: '760px',
      maxWidth: '94vw',
      data: {
        retouchTaskId: o.retouch_task_id,
        orderLabel: this.extractNum(o.order_id),
        clientName: this.cleanName(o),
      } satisfies OrderApprovalDialogData,
    }).afterClosed().subscribe((result?: OrderApprovalDialogResult) => {
      if (result?.sent) {
        this.dashData.loadOrderQueue();
      }
    });
  }

  canAccept(o: OrderQueueItem): boolean {
    return this.queueMode() !== 'archive' && ['new', 'paid'].includes(o.status);
  }

  canFinish(o: OrderQueueItem): boolean {
    return this.queueMode() !== 'archive' && ['processing', 'ready'].includes(o.status);
  }

  hasFiles(o: OrderQueueItem): boolean {
    return this.uploadedItems(o).length > 0;
  }

  timerCaption(o: OrderQueueItem): string {
    if (o.revision_requested) return 'доработка';
    if (this.timer.isOverdue(o.deadline)) return 'просрочено';
    if (this.timer.isWarning(o.deadline)) return 'скоро';
    return 'до сдачи';
  }

  orderStudioLabel(o: OrderQueueItem): string | null {
    return o.order_studio_name || o.order_studio_address || o.order_location_code || null;
  }

  private currentStudioLabel(): string | null {
    const shift = this.dashData.workday()?.shift ?? null;
    return shift?.studio_name || shift?.studio_address || shift?.location_code || null;
  }

  private requiresStudioOverride(o: OrderQueueItem): boolean {
    const shift = this.dashData.workday()?.shift ?? null;
    return !!shift?.studio_id
      && !!o.order_studio_id
      && shift.studio_id !== o.order_studio_id;
  }

  extractNum(orderId: string): string {
    const last = orderId.split('-').pop() || '';
    return /^\d+$/.test(last) ? `#${last}` : `#${orderId.slice(-4)}`;
  }

  cleanName(o: OrderQueueItem): string {
    const name = o.contact_name || '';
    const cleaned = name.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\s]+/u, '').trim();
    if (!cleaned || /^(Гость|Обращение)\s*#/.test(cleaned)) {
      return o.resolved_phone || 'Онлайн-клиент';
    }
    return cleaned;
  }

  itemSummary(o: OrderQueueItem): string {
    const files = this.uploadedItems(o);
    if (files.length > 0) {
      const printCount = files.reduce((sum, item) => sum + this.itemQuantity(item), 0);
      return `Печать фото · ${this.printCountLabel(printCount)}`;
    }
    const item = o.items?.[0];
    if (!item) return '';
    return item.document || item.tariff || item.service || '';
  }

  uploadedItems(o: OrderQueueItem): PhotoPrintOrderItem[] {
    return (o.items ?? []).filter(item => typeof item.uploadedUrl === 'string' && item.uploadedUrl.trim().length > 0);
  }

  printCountLabel(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    const word = mod10 === 1 && mod100 !== 11
      ? 'отпечаток'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'отпечатка'
        : 'отпечатков';
    return `${count} ${word}`;
  }

  orderPrice(o: OrderQueueItem): string {
    const price = Number(o.total_price);
    return Number.isFinite(price)
      ? `${price.toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₽`
      : `${o.total_price} ₽`;
  }

  async printUploadedFiles(o: OrderQueueItem, event: Event): Promise<void> {
    event.stopPropagation();
    const items = this.uploadedItems(o);
    if (!items.length) {
      this.toast.warning('В заказе нет загруженных файлов');
      return;
    }

    this.startWorkflowAction(o, 'print', async () => {
      const { BatchPrintDialogComponent } = await import('../batch-print-dialog/batch-print-dialog.component');
      const files = items.map((item, index) => ({
        msgId: `${o.id}-${index}`,
        url: item.uploadedUrl!,
        name: this.printFileName(item, index),
        type: 'image' as const,
      }));
      this.dialog.open(BatchPrintDialogComponent, batchPrintDialogConfig({
        files,
        sessionId: o.order_id,
        action: 'print',
        orderType: 'photo-order',
      } satisfies BatchPrintDialogData));
    });
  }

  downloadUploadedFiles(o: OrderQueueItem, event: Event): void {
    event.stopPropagation();
    const items = this.uploadedItems(o);
    if (!items.length) {
      this.toast.warning('В заказе нет загруженных файлов');
      return;
    }

    this.startWorkflowAction(o, 'download', () => this.downloadArchive(o));
  }

  private startWorkflowAction(
    o: OrderQueueItem,
    action: OrderWorkflowAction,
    afterStarted: () => void | Promise<void>,
  ): void {
    if (o.status !== 'processing') {
      this.toast.warning('Сначала примите заказ в работу');
      return;
    }
    this.startingWorkflowActionId.set(o.id);
    this.ordersApi.recordWorkflowAction(o.order_id, action).subscribe({
      next: response => {
        const startedAt = response.data?.processing_started_at ?? new Date().toISOString();
        this.executionStartedOverrides.update(current => {
          const next = new Map(current);
          next.set(o.order_id, startedAt);
          return next;
        });
        this.dashData.loadOrderQueue();
        void Promise.resolve(afterStarted()).catch(() => {
          this.toast.error(action === 'print'
            ? 'Не удалось открыть пакетную печать'
            : 'Не удалось скачать архив');
        });
      },
      error: () => {
        this.startingWorkflowActionId.set(null);
        this.toast.error(action === 'print'
          ? 'Не удалось начать печать заказа'
          : 'Не удалось начать скачивание заказа');
      },
      complete: () => this.startingWorkflowActionId.set(null),
    });
  }

  private downloadArchive(o: OrderQueueItem): void {
    this.downloadingArchiveId.set(o.id);
    this.ordersApi.downloadPrintPhotosArchive(o.order_id).subscribe({
      next: response => {
        this.downloadingArchiveId.set(null);
        const blob = response.body;
        if (!blob || blob.size === 0) {
          this.toast.error('Архив пустой');
          return;
        }
        this.saveArchiveBlob(
          blob,
          response.headers.get('Content-Disposition'),
          `${o.order_id}-photos.zip`,
        );
      },
      error: () => {
        this.downloadingArchiveId.set(null);
        this.toast.error('Не удалось скачать архив');
      },
    });
  }

  private itemQuantity(item: PhotoPrintOrderItem): number {
    const quantity = Number(item.quantity ?? 1);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  private printFileName(item: PhotoPrintOrderItem, index: number): string {
    return item.format || item.name || `Фото ${index + 1}`;
  }

  private saveArchiveBlob(blob: Blob, contentDisposition: string | null, fallbackName: string): void {
    const view = this.document.defaultView;
    const body = this.document.body;
    if (!view || !body) return;

    const url = view.URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = this.filenameFromContentDisposition(contentDisposition, fallbackName);
    body.appendChild(link);
    link.click();
    body.removeChild(link);
    view.setTimeout(() => view.URL.revokeObjectURL(url), 1000);
  }

  private filenameFromContentDisposition(contentDisposition: string | null, fallbackName: string): string {
    if (!contentDisposition) return fallbackName;

    const encoded = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      return decodeFileName(encoded.replace(/^"|"$/g, ''));
    }

    const plain = contentDisposition.match(/filename="([^"]+)"/i)?.[1]
      ?? contentDisposition.match(/filename=([^;]+)/i)?.[1];
    return plain ? decodeFileName(plain.trim()) : fallbackName;
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      new: 'Новый',
      paid: 'Оплачен',
      processing: 'Принят',
      ready: 'Готов',
      pending: 'Ожидает',
      pending_payment: 'Ждёт оплату',
      completed: 'Завершён',
      cancelled: 'Отменён',
    };
    return map[status] || status;
  }

  archiveDate(order: OrderQueueItem): string {
    return formatRelativeTime(order.completed_at || order.updated_at || order.created_at);
  }

  emptyText(): string {
    if (this.queueMode() === 'archive') {
      return this.dashData.loadingOrderArchive() ? 'Загрузка архива...' : 'Архив заказов пуст';
    }
    if (this.queueMode() === 'stale') {
      return this.dashData.loadingStaleOrderQueue() ? 'Загрузка...' : 'Зависших заказов нет';
    }
    return 'Нет заказов в очереди';
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.style.display = 'none';
  }
}
