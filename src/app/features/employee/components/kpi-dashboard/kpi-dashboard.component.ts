import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import {
  KpiApiService, KpiMetric, CompositeScore, TeamEmployee, KpiAlert,
} from '../../services/kpi-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { KpiTargetConfigComponent } from './kpi-target-config.component';

type Period = 'today' | 'week' | 'month';

const CATEGORY_LABELS: Record<string, string> = {
  productivity: 'Продуктивность',
  quality: 'Качество',
  speed: 'Скорость',
  revenue: 'Выручка',
  satisfaction: 'Удовлетворённость',
  attendance: 'Посещаемость',
};

const CATEGORY_ICONS: Record<string, string> = {
  productivity: 'trending_up',
  quality: 'verified',
  speed: 'speed',
  revenue: 'payments',
  satisfaction: 'sentiment_satisfied',
  attendance: 'schedule',
};

const RATING_LABELS: Record<string, string> = {
  exceptional: 'Отлично',
  good: 'Хорошо',
  meeting: 'Норма',
  below: 'Ниже нормы',
  critical: 'Критично',
};

@Component({
  selector: 'app-kpi-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, MatTabsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatProgressBarModule, MatButtonToggleModule, MatTableModule,
    MatBadgeModule, MatTooltipModule, MatSelectModule, KpiTargetConfigComponent,
  ],
  template: `
    <div class="kpi-dashboard">
      <div class="kpi-header">
        <h2>KPI Dashboard</h2>
        <mat-button-toggle-group [value]="period()" (change)="onPeriodChange($event.value)">
          <mat-button-toggle value="today">Сегодня</mat-button-toggle>
          <mat-button-toggle value="week">Неделя</mat-button-toggle>
          <mat-button-toggle value="month">Месяц</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <mat-tab-group animationDuration="200ms">
        <!-- TAB 1: My KPI -->
        <mat-tab label="Мои показатели">
          @if (loading()) {
            <div class="loading-state">Загрузка...</div>
          } @else {
            <!-- Composite Score Gauge -->
            <div class="composite-section">
              <div class="gauge-container">
                <div class="gauge" [attr.data-rating]="composite()?.rating">
                  <svg viewBox="0 0 120 120" class="gauge-svg">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="var(--crm-border)" stroke-width="8"/>
                    <circle cx="60" cy="60" r="50" fill="none"
                            [attr.stroke]="getRatingColor(composite()?.rating || 'meeting')"
                            stroke-width="8"
                            stroke-linecap="round"
                            [style.stroke-dasharray]="getGaugeDash(composite()?.compositeScore || 0)"
                            stroke-dashoffset="0"
                            transform="rotate(-90 60 60)"/>
                  </svg>
                  <div class="gauge-value">
                    <span class="gauge-number">{{ composite()?.compositeScore | number:'1.0-0' }}</span>
                    <span class="gauge-label">{{ getRatingLabel(composite()?.rating || 'meeting') }}</span>
                  </div>
                </div>
              </div>

              <!-- Category Breakdown -->
              <div class="categories">
                @for (cat of categories(); track cat.key) {
                  <div class="category-row">
                    <mat-icon class="cat-icon">{{ getCategoryIcon(cat.key) }}</mat-icon>
                    <span class="cat-label">{{ getCategoryLabel(cat.key) }}</span>
                    <mat-progress-bar mode="determinate" [value]="cat.score" [color]="cat.score >= 75 ? 'primary' : cat.score >= 50 ? 'accent' : 'warn'"/>
                    <span class="cat-score">{{ cat.score | number:'1.0-0' }}</span>
                  </div>
                }
              </div>
            </div>

            <!-- Metrics Grid -->
            <div class="metrics-grid">
              @for (metric of metrics(); track metric.code) {
                <mat-card class="metric-card" appearance="outlined">
                  <div class="metric-header">
                    <span class="metric-name">{{ metric.nameRu }}</span>
                    @if (metric.trend === 'up') {
                      <mat-icon class="trend-icon trend-up" [class.bad]="metric.direction === 'lower_better'">trending_up</mat-icon>
                    } @else if (metric.trend === 'down') {
                      <mat-icon class="trend-icon trend-down" [class.bad]="metric.direction === 'higher_better'">trending_down</mat-icon>
                    } @else {
                      <mat-icon class="trend-icon trend-flat">trending_flat</mat-icon>
                    }
                  </div>
                  <div class="metric-value">{{ formatMetricValue(metric) }}</div>
                  @if (metric.target !== null) {
                    <mat-progress-bar mode="determinate"
                      [value]="metric.targetPct"
                      [color]="metric.targetPct >= 80 ? 'primary' : metric.targetPct >= 50 ? 'accent' : 'warn'"/>
                    <div class="metric-target">Цель: {{ formatTarget(metric) }}</div>
                  }
                  <mat-chip class="category-chip" [highlighted]="false">{{ getCategoryLabel(metric.category) }}</mat-chip>
                </mat-card>
              }
            </div>
          }
        </mat-tab>

        <!-- TAB 2: Team -->
        <mat-tab label="Команда">
          @if (teamLoading()) {
            <div class="loading-state">Загрузка...</div>
          } @else {
            <div class="team-header">
              <div class="team-avg">
                <span class="team-avg-label">Средний балл команды</span>
                <span class="team-avg-value">{{ teamAverage() | number:'1.0-0' }}</span>
              </div>
            </div>

            <table mat-table [dataSource]="teamEmployees()" class="team-table">
              <ng-container matColumnDef="rank">
                <th mat-header-cell *matHeaderCellDef>#</th>
                <td mat-cell *matCellDef="let row; let i = index">{{ i + 1 }}</td>
              </ng-container>
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Сотрудник</th>
                <td mat-cell *matCellDef="let row">
                  <div class="employee-cell">
                    @if (row.photoUrl) {
                      <img [src]="row.photoUrl" class="avatar" alt="">
                    } @else {
                      <div class="avatar-placeholder">{{ row.displayName.charAt(0) }}</div>
                    }
                    <span>{{ row.displayName }}</span>
                  </div>
                </td>
              </ng-container>
              <ng-container matColumnDef="score">
                <th mat-header-cell *matHeaderCellDef>Балл</th>
                <td mat-cell *matCellDef="let row">
                  <span class="score-badge" [attr.data-rating]="row.rating">{{ row.compositeScore | number:'1.0-0' }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="rating">
                <th mat-header-cell *matHeaderCellDef>Рейтинг</th>
                <td mat-cell *matCellDef="let row">
                  <span class="rating-label" [attr.data-rating]="row.rating">{{ getRatingLabel(row.rating) }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="alerts">
                <th mat-header-cell *matHeaderCellDef>Алерты</th>
                <td mat-cell *matCellDef="let row">
                  @if (row.alertCount > 0) {
                    <mat-icon [matBadge]="row.alertCount" matBadgeColor="warn" matBadgeSize="small">notifications</mat-icon>
                  }
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="teamColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: teamColumns;" (click)="onEmployeeClick(row)"></tr>
            </table>
          }
        </mat-tab>

        <!-- TAB 3: Alerts -->
        <mat-tab>
          <ng-template mat-tab-label>
            Алерты
            @if (unacknowledgedCount() > 0) {
              <mat-icon [matBadge]="unacknowledgedCount()" matBadgeColor="warn" matBadgeSize="small" class="tab-badge-icon">notifications</mat-icon>
            }
          </ng-template>
          @if (alertsLoading()) {
            <div class="loading-state">Загрузка...</div>
          } @else if (alerts().length === 0) {
            <div class="empty-state">Нет активных алертов</div>
          } @else {
            <div class="alerts-list">
              @for (alert of alerts(); track alert.id) {
                <mat-card class="alert-card" [attr.data-severity]="alert.severity" appearance="outlined">
                  <div class="alert-content">
                    <mat-icon class="alert-icon" [class]="'severity-' + alert.severity">
                      {{ alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warning' : 'info' }}
                    </mat-icon>
                    <div class="alert-body">
                      <div class="alert-message">{{ alert.message }}</div>
                      <div class="alert-meta">
                        {{ alert.employeeName }} &middot; {{ alert.periodStart }}
                        @if (alert.alertType === 'excellence') {
                          &middot; <span class="alert-excellence">Отличный результат</span>
                        }
                      </div>
                    </div>
                    @if (!alert.acknowledged) {
                      <button mat-icon-button (click)="acknowledgeAlert(alert)" matTooltip="Подтвердить">
                        <mat-icon>check_circle</mat-icon>
                      </button>
                    } @else {
                      <mat-icon class="ack-icon">done</mat-icon>
                    }
                  </div>
                </mat-card>
              }
            </div>
          }
        </mat-tab>

        <!-- TAB 4: Admin Settings (targets & weight profiles) -->
        @if (isAdmin()) {
          <mat-tab label="Настройки">
            <app-kpi-target-config/>
          </mat-tab>
        }
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .kpi-dashboard {
      padding: 24px;
      max-width: 1200px;
      margin: 0 auto;
    }

    .kpi-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }
    .kpi-header h2 { margin: 0; font-size: 20px; font-weight: 600; }

    .loading-state, .empty-state {
      text-align: center;
      padding: 48px;
      color: var(--crm-text-secondary, #666);
      font-size: 14px;
    }

    /* ── Composite Score ── */
    .composite-section {
      display: flex;
      gap: 32px;
      align-items: center;
      margin: 24px 0;
      padding: 24px;
      background: var(--crm-surface, #f8f9fa);
      border-radius: 16px;
    }

    .gauge-container { flex-shrink: 0; }
    .gauge {
      position: relative;
      width: 140px;
      height: 140px;
    }
    .gauge-svg { width: 100%; height: 100%; }
    .gauge-value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    .gauge-number {
      display: block;
      font-size: 32px;
      font-weight: 700;
      line-height: 1;
    }
    .gauge-label {
      display: block;
      font-size: 11px;
      color: var(--crm-text-secondary, #666);
      margin-top: 4px;
    }

    .categories { flex: 1; display: flex; flex-direction: column; gap: 12px; }
    .category-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-text-secondary); }
    .cat-label { width: 140px; font-size: 13px; }
    .category-row mat-progress-bar { flex: 1; }
    .cat-score { width: 32px; text-align: right; font-weight: 600; font-size: 13px; }

    /* ── Metrics Grid ── */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 16px;
      margin-top: 24px;
    }

    .metric-card {
      padding: 16px;
    }
    .metric-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .metric-name { font-size: 13px; color: var(--crm-text-secondary, #666); }
    .metric-value { font-size: 28px; font-weight: 700; margin: 8px 0; }
    .metric-target { font-size: 11px; color: var(--crm-text-secondary); margin-top: 4px; }
    .category-chip { margin-top: 8px; font-size: 11px; }

    .trend-icon { font-size: 20px; width: 20px; height: 20px; }
    .trend-up { color: #2e7d32; }
    .trend-up.bad { color: #c62828; }
    .trend-down { color: #c62828; }
    .trend-down.bad { color: #2e7d32; }
    .trend-flat { color: #9e9e9e; }

    /* ── Team Table ── */
    .team-header { margin: 24px 0 16px; }
    .team-avg { display: flex; align-items: center; gap: 12px; }
    .team-avg-label { font-size: 14px; color: var(--crm-text-secondary); }
    .team-avg-value { font-size: 28px; font-weight: 700; }

    .team-table { width: 100%; }
    .employee-cell { display: flex; align-items: center; gap: 8px; }
    .avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; }
    .avatar-placeholder {
      width: 32px; height: 32px; border-radius: 50%;
      background: var(--crm-primary, #1976d2); color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 600;
    }

    .score-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 13px;
    }
    .score-badge[data-rating="exceptional"] { background: #e8f5e9; color: #2e7d32; }
    .score-badge[data-rating="good"] { background: #e3f2fd; color: #1565c0; }
    .score-badge[data-rating="meeting"] { background: #fff3e0; color: #e65100; }
    .score-badge[data-rating="below"] { background: #fce4ec; color: #c62828; }
    .score-badge[data-rating="critical"] { background: #ffebee; color: #b71c1c; }

    .rating-label { font-size: 13px; }
    .rating-label[data-rating="exceptional"] { color: #2e7d32; }
    .rating-label[data-rating="good"] { color: #1565c0; }
    .rating-label[data-rating="meeting"] { color: #e65100; }
    .rating-label[data-rating="below"] { color: #c62828; }
    .rating-label[data-rating="critical"] { color: #b71c1c; }

    tr.mat-mdc-row:hover { background: var(--crm-hover, #f5f5f5); cursor: pointer; }

    /* ── Alerts ── */
    .alerts-list { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
    .alert-card { padding: 12px 16px; }
    .alert-card[data-severity="critical"] { border-left: 3px solid #c62828; }
    .alert-card[data-severity="warning"] { border-left: 3px solid #f57c00; }
    .alert-card[data-severity="info"] { border-left: 3px solid #1565c0; }
    .alert-content { display: flex; align-items: center; gap: 12px; }
    .alert-icon { flex-shrink: 0; }
    .severity-critical { color: #c62828; }
    .severity-warning { color: #f57c00; }
    .severity-info { color: #1565c0; }
    .alert-body { flex: 1; }
    .alert-message { font-size: 14px; }
    .alert-meta { font-size: 12px; color: var(--crm-text-secondary); margin-top: 2px; }
    .alert-excellence { color: #2e7d32; font-weight: 500; }
    .ack-icon { color: #9e9e9e; }
    .tab-badge-icon { margin-left: 4px; }

    @media (max-width: 768px) {
      .kpi-dashboard { padding: 16px; }
      .composite-section { flex-direction: column; padding: 16px; }
      .metrics-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class KpiDashboardComponent implements OnInit, OnDestroy {
  private readonly api = inject(KpiApiService);
  private readonly authService = inject(AuthService);

  readonly isAdmin = computed(() => {
    const role = this.authService.userRole();
    return role === 'admin' || role === 'manager';
  });

  readonly period = signal<Period>('today');
  readonly loading = signal(false);
  readonly metrics = signal<KpiMetric[]>([]);
  readonly composite = signal<CompositeScore | null>(null);

  readonly teamLoading = signal(false);
  readonly teamEmployees = signal<TeamEmployee[]>([]);
  readonly teamAverage = signal(0);

  readonly alertsLoading = signal(false);
  readonly alerts = signal<KpiAlert[]>([]);
  readonly unacknowledgedCount = computed(() => this.alerts().filter(a => !a.acknowledged).length);

  readonly categories = computed(() => {
    const scores = this.composite()?.categoryScores || {};
    return Object.entries(scores).map(([key, score]) => ({ key, score }));
  });

  readonly teamColumns = ['rank', 'name', 'score', 'rating', 'alerts'];

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.loadMyDashboard();
    this.loadTeamOverview();
    this.loadAlerts();
    this.refreshInterval = setInterval(() => this.loadMyDashboard(), 5 * 60 * 1000);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  onPeriodChange(p: string): void {
    this.period.set(p as Period);
    this.loadMyDashboard();
    this.loadTeamOverview();
  }

  loadMyDashboard(): void {
    this.loading.set(true);
    this.api.getMyDashboard(this.period()).subscribe({
      next: (res) => {
        this.metrics.set(res.metrics);
        this.composite.set(res.compositeScore);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadTeamOverview(): void {
    this.teamLoading.set(true);
    this.api.getTeamOverview(this.period() === 'today' ? 'week' : this.period()).subscribe({
      next: (res) => {
        this.teamEmployees.set(res.employees);
        this.teamAverage.set(res.teamAverage);
        this.teamLoading.set(false);
      },
      error: () => this.teamLoading.set(false),
    });
  }

  loadAlerts(): void {
    this.alertsLoading.set(true);
    this.api.getAlerts({ limit: 50 }).subscribe({
      next: (res) => {
        this.alerts.set(res.alerts);
        this.alertsLoading.set(false);
      },
      error: () => this.alertsLoading.set(false),
    });
  }

  acknowledgeAlert(alert: KpiAlert): void {
    this.api.acknowledgeAlert(alert.id).subscribe({
      next: () => {
        this.alerts.update(list => list.map(a => a.id === alert.id ? { ...a, acknowledged: true } : a));
      },
    });
  }

  onEmployeeClick(_row: TeamEmployee): void {
    // TODO: navigate to /employee/kpi/detail/:id
  }

  // ─── Display Helpers ────────────────────────────────────────────

  getRatingColor(rating: string): string {
    switch (rating) {
      case 'exceptional': return '#2e7d32';
      case 'good': return '#1565c0';
      case 'meeting': return '#f57c00';
      case 'below': return '#c62828';
      case 'critical': return '#b71c1c';
      default: return '#9e9e9e';
    }
  }

  getRatingLabel(rating: string): string {
    return RATING_LABELS[rating] || rating;
  }

  getGaugeDash(score: number): string {
    const circumference = 2 * Math.PI * 50;
    const filled = (score / 100) * circumference;
    return `${filled} ${circumference}`;
  }

  getCategoryLabel(key: string): string {
    return CATEGORY_LABELS[key] || key;
  }

  getCategoryIcon(key: string): string {
    return CATEGORY_ICONS[key] || 'analytics';
  }

  formatMetricValue(m: KpiMetric): string {
    switch (m.unit) {
      case 'percent': return `${Math.round(m.value)}%`;
      case 'seconds': {
        if (m.value < 60) return `${Math.round(m.value)} сек`;
        if (m.value < 3600) return `${Math.round(m.value / 60)} мин`;
        return `${(m.value / 3600).toFixed(1)} ч`;
      }
      case 'rubles': return `${Math.round(m.value).toLocaleString('ru-RU')} ₽`;
      case 'hours': return `${m.value.toFixed(1)} ч`;
      default: return `${Math.round(m.value * 100) / 100}`;
    }
  }

  formatTarget(m: KpiMetric): string {
    if (m.target === null) return '';
    return this.formatMetricValue({ ...m, value: m.target });
  }
}
