import { Component, inject, output, computed, signal, ChangeDetectionStrategy, PLATFORM_ID, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { AuthService } from '../../../../core/services/auth.service';
import { StudentVerificationService } from '../../../../core/services/student-verification.service';
import { DashboardShiftBlockComponent } from './dashboard-shift-block.component';
import { DashboardCommissionCardComponent } from './dashboard-commission-card.component';
import { DashboardMetricsComponent } from './dashboard-metrics.component';
import { DashboardOrderQueueComponent } from './dashboard-order-queue.component';
import { DashboardQuickActionsComponent } from './dashboard-quick-actions.component';
import { DashboardMyTasksComponent } from './dashboard-my-tasks.component';
import { DashboardGamificationComponent } from './dashboard-gamification.component';
import { DashboardQuickDialerComponent } from './dashboard-quick-dialer.component';
import { DashboardCallHistoryComponent } from './dashboard-call-history.component';

interface AttentionTile {
  label: string;
  value: number;
  icon: string;
  tone: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
}

@Component({
  selector: 'app-dashboard-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatTooltipModule,
    DashboardShiftBlockComponent,
    DashboardCommissionCardComponent,
    DashboardMetricsComponent,
    DashboardOrderQueueComponent,
    DashboardQuickActionsComponent,
    DashboardMyTasksComponent,
    DashboardGamificationComponent,
    DashboardQuickDialerComponent,
    DashboardCallHistoryComponent,
  ],
  template: `
    <div class="dashboard-scroll">
      <div class="dashboard-content">
        <header class="dashboard-topbar">
          <div class="dashboard-title">
            <span class="eyebrow">ФотоПульт</span>
            <h1>Сегодня</h1>
          </div>

          <div class="dashboard-actions">
            <button class="refresh-btn" type="button" (click)="refresh()" matTooltip="Обновить данные">
              <mat-icon>refresh</mat-icon>
            </button>
            <app-dashboard-quick-actions
              [canReviewStudents]="canReviewStudents()"
              [studentPendingCount]="studentPending()"
              (createTask)="createTask.emit()"
              (openDialer)="openDialer.emit()"
              (openPos)="openPos.emit()"
              (openStudentVerification)="openStudentVerification.emit()" />
          </div>
        </header>

        <div class="dash-full">
          <app-dashboard-shift-block />
        </div>

        <section class="attention-grid" aria-label="Сводка">
          @for (tile of attentionTiles(); track tile.label) {
            <article class="attention-tile" [class]="'tone-' + tile.tone">
              <mat-icon>{{ tile.icon }}</mat-icon>
              <span class="tile-value">{{ tile.value }}</span>
              <span class="tile-label">{{ tile.label }}</span>
            </article>
          }
          @if (canReviewStudents()) {
            <button
              type="button"
              class="attention-tile attention-tile--action"
              [class]="'attention-tile attention-tile--action tone-' + (studentPending() ? 'warning' : 'success')"
              (click)="openStudentVerification.emit()"
              matTooltip="Открыть фото-верификацию студентов"
            >
              <mat-icon>school</mat-icon>
              <span class="tile-value">{{ studentPending() }}</span>
              <span class="tile-label">Студенты на проверке</span>
            </button>
          }
        </section>

        <div class="dash-full">
          <app-dashboard-commission-card />
        </div>

        @if (isAdmin()) {
          <div class="dash-full">
            <app-dashboard-metrics />
          </div>
        }

        <div class="dashboard-grid">
          <div class="dashboard-main">
            <app-dashboard-order-queue
              (selectItem)="selectItem.emit($event)"
              (createOrder)="createOrder.emit()" />
          </div>

          <aside class="dashboard-side">
            <app-dashboard-quick-dialer />
            <app-dashboard-call-history />
            <app-dashboard-my-tasks (selectItem)="selectItem.emit($event)" />
            <app-dashboard-gamification />
          </aside>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .dashboard-scroll {
      height: 100%;
      overflow-y: auto;
      overflow-x: hidden;
      -webkit-overflow-scrolling: touch;
    }

    .dashboard-content {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      max-width: 1320px;
      margin: 0 auto;
    }

    .dash-full { width: 100%; }

    .dashboard-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-height: 44px;
    }

    .dashboard-title {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .eyebrow {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--crm-accent);
    }

    h1 {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 24px;
      font-weight: 500;
      line-height: 1.1;
      color: var(--crm-text-primary);
    }

    .dashboard-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      min-width: 0;
    }

    .refresh-btn {
      width: 34px;
      height: 34px;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      color: var(--crm-text-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition:
        color var(--crm-transition-fast),
        border-color var(--crm-transition-fast),
        background var(--crm-transition-fast);

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover {
        color: var(--crm-accent);
        border-color: color-mix(in srgb, var(--crm-accent) 45%, var(--crm-border));
        background: var(--crm-accent-muted);
      }
    }

    .attention-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .attention-tile {
      min-width: 0;
      min-height: 76px;
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      grid-template-rows: 1fr auto;
      column-gap: 10px;
      row-gap: 4px;
      align-items: center;
      padding: 12px;
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-lg);
      background: var(--crm-gradient-card);
      box-shadow: var(--crm-shadow-card);
      color: var(--crm-text-primary);
      text-align: left;

      mat-icon {
        grid-row: 1 / span 2;
        width: 32px;
        height: 32px;
        font-size: 20px;
        border-radius: var(--crm-radius-md);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--tile-color, var(--crm-text-secondary));
        background: color-mix(in srgb, var(--tile-color, var(--crm-text-secondary)) 13%, transparent);
      }
    }

    .tile-value {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 25px;
      font-weight: 500;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      color: var(--tile-color, var(--crm-text-primary));
    }

    .tile-label {
      min-width: 0;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.25;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: normal;
    }

    .attention-tile--action {
      width: 100%;
      font: inherit;
      cursor: pointer;
      appearance: none;
      transition:
        border-color var(--crm-transition-fast),
        transform var(--crm-transition-fast),
        background var(--crm-transition-fast);
    }

    .attention-tile--action:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--tile-color, var(--crm-accent)) 50%, var(--crm-glass-border));
    }

    .attention-tile--action:active { transform: scale(0.99); }

    .tone-neutral { --tile-color: var(--crm-text-secondary); }
    .tone-info { --tile-color: var(--crm-status-info); }
    .tone-warning { --tile-color: var(--crm-status-warning); }
    .tone-danger { --tile-color: var(--crm-status-error); }
    .tone-success { --tile-color: var(--crm-status-success); }

    .dashboard-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
      gap: 14px;
      align-items: start;
    }

    .dashboard-main,
    .dashboard-side {
      min-width: 0;
    }

    .dashboard-side {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    @media (max-width: 1120px) {
      .dashboard-grid { grid-template-columns: 1fr; }
      .dashboard-side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 840px) {
      .dashboard-content { padding: 12px; gap: 12px; }
      .dashboard-topbar { align-items: stretch; flex-direction: column; }
      .dashboard-actions { justify-content: space-between; }
      .dashboard-side { grid-template-columns: 1fr; }
    }

    @media (max-width: 520px) {
      .dashboard-actions {
        align-items: stretch;
        flex-direction: column;
      }

      .refresh-btn {
        align-self: flex-end;
      }

      .attention-grid { grid-template-columns: 1fr; }
      .attention-tile { min-height: 62px; }
    }
  `],
})
export class DashboardViewComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dashData = inject(DashboardDataService);
  private readonly auth = inject(AuthService);
  private readonly studentVerifications = inject(StudentVerificationService);

  selectItem = output<{ type: string; id: string }>();
  createOrder = output<void>();
  createTask = output<void>();
  openDialer = output<void>();
  openPos = output<void>();
  openStudentVerification = output<void>();

  readonly studentPending = signal(0);

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role;
    return role === 'admin' || role === 'manager';
  });

  readonly canReviewStudents = computed(() => this.auth.hasPermission('students:verify'));

  readonly attentionTiles = computed<AttentionTile[]>(() => {
    const counts = this.dashData.counts();
    const workday = this.dashData.workday();
    const queue = this.dashData.orderQueue();
    const activeQueue = queue.filter(order => !['completed', 'cancelled', 'refunded'].includes(order.status));
    const overdueOrders = activeQueue.filter(order => {
      const deadline = order.deadline ?? order.sla_deadline;
      return deadline ? new Date(deadline).getTime() < Date.now() : Boolean(order.is_overdue);
    }).length;

    return [
      {
        label: 'Входящие',
        value: counts.total,
        icon: 'inbox',
        tone: counts.urgent || counts.unread ? 'warning' : 'neutral',
      },
      {
        label: 'Срочные',
        value: (workday?.summary.urgent ?? 0) + counts.urgent,
        icon: 'priority_high',
        tone: counts.urgent || workday?.summary.urgent ? 'danger' : 'success',
      },
      {
        label: 'Просрочено',
        value: (workday?.summary.overdue ?? 0) + overdueOrders,
        icon: 'report',
        tone: (workday?.summary.overdue ?? 0) + overdueOrders > 0 ? 'danger' : 'success',
      },
      {
        label: 'Заказы',
        value: activeQueue.length,
        icon: 'receipt_long',
        tone: activeQueue.length ? 'info' : 'neutral',
      },
      {
        label: 'Не оплачено',
        value: counts.unpaid,
        icon: 'payments',
        tone: counts.unpaid ? 'warning' : 'success',
      },
    ];
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.dashData.init();
      this.loadStudentPending();
    }
  }

  refresh(): void {
    this.dashData.refresh();
    this.loadStudentPending();
  }

  private loadStudentPending(): void {
    if (!this.canReviewStudents()) {
      return;
    }
    this.studentVerifications.listAdmin('pending', 100)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: items => this.studentPending.set(items.length),
        error: () => { /* бейдж не критичен — молча игнорируем */ },
      });
  }
}
