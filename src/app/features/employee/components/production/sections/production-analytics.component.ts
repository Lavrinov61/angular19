import {
  Component, inject, signal, computed, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { ProductionApiService, ProductionAnalytics } from '../../../services/production-api.service';
import { catLabel, formatProductionCost, PRODUCTION_STATUS_CONFIG } from '../production.constants';

const MONTH_LABELS = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];

@Component({
  selector: 'app-production-analytics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatSelectModule, MatFormFieldModule, FormsModule, DecimalPipe,
  ],
  template: `
    <div class="analytics-page">
      <div class="page-toolbar">
        <h2>Аналитика производства</h2>
        <div class="toolbar-actions">
          <mat-form-field subscriptSizing="dynamic" style="width:140px">
            <mat-label>Период</mat-label>
            <mat-select [(ngModel)]="period" (ngModelChange)="load()">
              <mat-option value="30d">30 дней</mat-option>
              <mat-option value="90d">3 месяца</mat-option>
              <mat-option value="1y">Год</mat-option>
              <mat-option value="all">Всё время</mat-option>
            </mat-select>
          </mat-form-field>
          <button mat-icon-button (click)="load()" [disabled]="loading()" aria-label="Обновить">
            <mat-icon>refresh</mat-icon>
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-state"><mat-spinner diameter="40" /></div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button (click)="load()">Повторить</button>
        </div>
      } @else {
        @let a = data();
        @if (a) {
        <!-- KPI Cards -->
        <div class="kpi-grid">
          <mat-card class="kpi-card" appearance="outlined">
            <mat-icon>assignment</mat-icon>
            <div class="kpi-value">{{ a.delivery_performance.total_orders }}</div>
            <div class="kpi-label">Заказов</div>
          </mat-card>
          <mat-card class="kpi-card" appearance="outlined">
            <mat-icon>payments</mat-icon>
            <div class="kpi-value">{{ formatCost(totalCost()) }}</div>
            <div class="kpi-label">Затраты</div>
          </mat-card>
          <mat-card class="kpi-card" appearance="outlined">
            <mat-icon>price_change</mat-icon>
            <div class="kpi-value">{{ formatCost(avgCost()) }}</div>
            <div class="kpi-label">Средний чек</div>
          </mat-card>
          <mat-card class="kpi-card" appearance="outlined" [class.good]="a.delivery_performance.on_time_pct >= 90">
            <mat-icon>schedule</mat-icon>
            <div class="kpi-value">{{ a.delivery_performance.on_time_pct | number:'1.0-0' }}%</div>
            <div class="kpi-label">В срок</div>
          </mat-card>
          <mat-card class="kpi-card" appearance="outlined" [class.warn]="a.quality_metrics.defect_rate > 5">
            <mat-icon>warning</mat-icon>
            <div class="kpi-value">{{ a.quality_metrics.defect_rate | number:'1.1-1' }}%</div>
            <div class="kpi-label">Брак</div>
          </mat-card>
          <mat-card class="kpi-card" appearance="outlined">
            <mat-icon>star</mat-icon>
            <div class="kpi-value">{{ a.quality_metrics.avg_rating | number:'1.1-1' }}</div>
            <div class="kpi-label">Рейтинг кач.</div>
          </mat-card>
        </div>

        <!-- Расходы по типографиям -->
        @if (a.spending_by_house.length > 0) {
          <mat-card class="chart-card" appearance="outlined">
            <div class="chart-title">
              <mat-icon>business</mat-icon>
              Расходы по типографиям
            </div>
            <div class="bar-chart">
              @for (row of a.spending_by_house; track row.house_id) {
                <div class="bar-row">
                  <span class="bar-label">{{ row.house_name }}</span>
                  <div class="bar-track">
                    <div class="bar-fill" [style.width]="barPct(row.total, maxHouseCost()) + '%'"></div>
                  </div>
                  <span class="bar-value">{{ formatCost(row.total) }}</span>
                  <span class="bar-meta">{{ row.order_count }} зак.</span>
                </div>
              }
            </div>
          </mat-card>
        }

        <!-- Расходы по категориям -->
        @if (a.spending_by_category.length > 0) {
          <mat-card class="chart-card" appearance="outlined">
            <div class="chart-title">
              <mat-icon>category</mat-icon>
              Расходы по категориям
            </div>
            <div class="bar-chart">
              @for (row of a.spending_by_category; track row.category) {
                <div class="bar-row">
                  <span class="bar-label">{{ catLabel(row.category) }}</span>
                  <div class="bar-track">
                    <div class="bar-fill accent" [style.width]="barPct(row.total, maxCatCost()) + '%'"></div>
                  </div>
                  <span class="bar-value">{{ formatCost(row.total) }}</span>
                  <span class="bar-meta">{{ row.order_count }} зак.</span>
                </div>
              }
            </div>
          </mat-card>
        }

        <!-- По статусам -->
        @if (a.status_distribution.length > 0) {
          <mat-card class="chart-card" appearance="outlined">
            <div class="chart-title">
              <mat-icon>pie_chart</mat-icon>
              Заказы по статусам
            </div>
            <div class="status-chips-row">
              @for (row of a.status_distribution; track row.status) {
                <div class="status-count-chip">
                  <span class="sc-count">{{ row.count }}</span>
                  <span class="sc-label">{{ statusLabel(row.status) }}</span>
                </div>
              }
            </div>
          </mat-card>
        }

        <!-- Месячные тренды -->
        @if (a.monthly_trends.length > 0) {
          <mat-card class="chart-card" appearance="outlined">
            <div class="chart-title">
              <mat-icon>show_chart</mat-icon>
              Ежемесячная динамика
            </div>
            <div class="monthly-bars">
              @for (row of a.monthly_trends; track row.month) {
                <div class="month-col">
                  <div class="month-cost">{{ formatCost(row.total_cost) }}</div>
                  <div class="month-bar-track">
                    <div class="month-bar" [style.height]="barPct(row.total_cost, maxMonthlyCost()) + '%'"></div>
                  </div>
                  <div class="month-label">{{ monthLabel(row.month) }}</div>
                  <div class="month-orders">{{ row.order_count }}</div>
                </div>
              }
            </div>
          </mat-card>
        }
      } @else {
        <div class="empty-state">
          <mat-icon>bar_chart</mat-icon>
          <p>Нет данных за выбранный период</p>
        </div>
        }
      }
    </div>
  `,
  styles: `
    .analytics-page { padding: 16px; max-width: 1000px; margin: 0 auto; }

    .page-toolbar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
      h2 { margin: 0; flex: 1; font-size: 18px; font-weight: 600; color: var(--crm-text-primary); }
    }
    .toolbar-actions { display: flex; align-items: center; gap: 8px; }

    .kpi-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 12px; margin-bottom: 16px;
    }
    .kpi-card {
      text-align: center; padding: 16px 12px;
      mat-icon { color: var(--crm-accent); font-size: 28px; width: 28px; height: 28px; }
      .kpi-value { font-size: 22px; font-weight: 700; margin: 6px 0 2px; color: var(--crm-text-primary); }
      .kpi-label { font-size: 12px; color: var(--crm-text-secondary); }

      &.good .kpi-value { color: var(--crm-success, #22c55e); }
      &.warn .kpi-value { color: var(--crm-danger, #f87171); }
    }

    .chart-card { padding: 16px; margin-bottom: 16px; }
    .chart-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 15px; font-weight: 600; color: var(--crm-text-primary); margin-bottom: 16px;
      mat-icon { color: var(--crm-accent); font-size: 20px; width: 20px; height: 20px; }
    }

    .bar-chart { display: flex; flex-direction: column; gap: 10px; }
    .bar-row { display: flex; align-items: center; gap: 10px; }
    .bar-label { width: 140px; font-size: 13px; text-align: right; color: var(--crm-text-primary); flex-shrink: 0; }
    .bar-track { flex: 1; height: 20px; background: var(--crm-surface-hover); border-radius: 4px; overflow: hidden; }
    .bar-fill {
      height: 100%; background: var(--crm-accent); border-radius: 4px;
      transition: width 0.5s ease;
      &.accent { background: #818cf8; }
    }
    .bar-value { width: 70px; font-size: 13px; font-weight: 600; color: var(--crm-text-primary); flex-shrink: 0; }
    .bar-meta { width: 60px; font-size: 11px; color: var(--crm-text-secondary); flex-shrink: 0; }

    .status-chips-row { display: flex; flex-wrap: wrap; gap: 12px; }
    .status-count-chip {
      display: flex; flex-direction: column; align-items: center;
      background: var(--crm-surface-hover); border-radius: 8px; padding: 10px 16px;
      .sc-count { font-size: 24px; font-weight: 700; color: var(--crm-accent); }
      .sc-label { font-size: 12px; color: var(--crm-text-secondary); margin-top: 2px; }
    }

    .monthly-bars {
      display: flex; gap: 4px; align-items: flex-end; height: 120px;
      padding-bottom: 24px; position: relative;
    }
    .month-col {
      flex: 1; display: flex; flex-direction: column; align-items: center;
      position: relative;
    }
    .month-cost { font-size: 10px; color: var(--crm-text-secondary); margin-bottom: 2px; }
    .month-bar-track { flex: 1; width: 100%; display: flex; align-items: flex-end; }
    .month-bar {
      width: 100%; background: var(--crm-accent); border-radius: 3px 3px 0 0;
      min-height: 4px; transition: height 0.5s ease;
    }
    .month-label { font-size: 11px; color: var(--crm-text-secondary); margin-top: 4px; }
    .month-orders { font-size: 10px; color: var(--crm-text-secondary); }

    .loading-state, .empty-state, .error-state {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
      p { margin: 12px 0; font-size: 16px; }
    }
    .error-state mat-icon { color: var(--crm-danger, #f87171); }
  `,
})
export class ProductionAnalyticsComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly data = signal<ProductionAnalytics | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  period = '90d';

  // Pre-computed maxima — вычисляются один раз, не в @for
  readonly maxHouseCost = computed(() => {
    const a = this.data();
    if (!a || !a.spending_by_house.length) return 1;
    return Math.max(...a.spending_by_house.map(h => h.total));
  });

  readonly maxCatCost = computed(() => {
    const a = this.data();
    if (!a || !a.spending_by_category.length) return 1;
    return Math.max(...a.spending_by_category.map(c => c.total));
  });

  readonly maxMonthlyCost = computed(() => {
    const a = this.data();
    if (!a || !a.monthly_trends.length) return 1;
    return Math.max(...a.monthly_trends.map(m => m.total_cost));
  });

  readonly totalCost = computed(() => {
    const a = this.data();
    if (!a) return 0;
    return a.spending_by_house.reduce((sum, h) => sum + h.total, 0);
  });

  readonly avgCost = computed(() => {
    const a = this.data();
    if (!a || !a.delivery_performance.total_orders) return 0;
    return this.totalCost() / a.delivery_performance.total_orders;
  });

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(null);
    const { from, to } = this.periodToDates(this.period);
    this.api.getAnalytics({ from, to }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: a => { this.data.set(a); this.loading.set(false); },
      error: () => {
        this.error.set('Не удалось загрузить данные аналитики');
        this.loading.set(false);
      },
    });
  }

  private periodToDates(period: string): { from: string; to: string } {
    const to = new Date();
    const from = new Date();
    switch (period) {
      case '30d': from.setDate(from.getDate() - 30); break;
      case '90d': from.setDate(from.getDate() - 90); break;
      case '1y': from.setFullYear(from.getFullYear() - 1); break;
      case 'all': from.setFullYear(2020); break;
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }

  barPct(value: number, max: number): number {
    if (!max) return 0;
    return Math.round((value / max) * 100);
  }

  readonly formatCost = formatProductionCost;
  readonly catLabel = catLabel;

  statusLabel(s: string): string {
    return PRODUCTION_STATUS_CONFIG[s as keyof typeof PRODUCTION_STATUS_CONFIG]?.label ?? s;
  }

  monthLabel(iso: string): string {
    const d = new Date(iso);
    return MONTH_LABELS[d.getMonth()];
  }
}
