import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CurrencyPipe } from '@angular/common';
import { DashboardDataService } from '../../services/dashboard-data.service';

@Component({
  selector: 'app-dashboard-metrics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatProgressSpinnerModule, CurrencyPipe],
  template: `
    @if (loading()) {
      <div class="metrics-loading"><mat-spinner diameter="24" /></div>
    } @else if (metrics()) {
      <div class="metrics-grid">
        <!-- Orders today -->
        <div class="metric-card amber">
          <div class="metric-icon"><mat-icon>shopping_cart</mat-icon></div>
          <div class="metric-body">
            <span class="metric-value">{{ metrics()!.today.orders }}</span>
            <span class="metric-label">Заказов сегодня</span>
            <span class="metric-sub">{{ metrics()!.today.revenue | currency:'RUB':'symbol-narrow':'1.0-0':'ru' }}</span>
          </div>
          <div class="metric-week">
            <span class="week-value">{{ metrics()!.week.orders }}</span>
            <span class="week-label">за 7 дн</span>
          </div>
        </div>

        <!-- POS receipts -->
        <div class="metric-card green">
          <div class="metric-icon"><mat-icon>point_of_sale</mat-icon></div>
          <div class="metric-body">
            <span class="metric-value">{{ metrics()!.today.posReceipts }}</span>
            <span class="metric-label">POS чеков</span>
            <span class="metric-sub">{{ metrics()!.today.posRevenue | currency:'RUB':'symbol-narrow':'1.0-0':'ru' }}</span>
          </div>
          <div class="metric-week">
            <span class="week-value">{{ metrics()!.week.posReceipts }}</span>
            <span class="week-label">за 7 дн</span>
          </div>
        </div>

        <!-- Chats today -->
        <div class="metric-card blue">
          <div class="metric-icon"><mat-icon>forum</mat-icon></div>
          <div class="metric-body">
            <span class="metric-value">{{ metrics()!.today.chatSessions ?? 0 }}</span>
            <span class="metric-label">Чатов сегодня</span>
            <span class="metric-sub">{{ metrics()!.today.chatMessages ?? 0 }} сообщ.</span>
          </div>
        </div>

        <!-- Avg check -->
        <div class="metric-card teal">
          <div class="metric-icon"><mat-icon>receipt_long</mat-icon></div>
          <div class="metric-body">
            <span class="metric-value">{{ metrics()!.today.avgCheck | currency:'RUB':'symbol-narrow':'1.0-0':'ru' }}</span>
            <span class="metric-label">Ср. чек</span>
            <span class="metric-sub">{{ metrics()!.week.avgCheck | currency:'RUB':'symbol-narrow':'1.0-0':'ru' }} / нед</span>
          </div>
        </div>

        <!-- Conversion -->
        <div class="metric-card purple">
          <div class="metric-icon"><mat-icon>trending_up</mat-icon></div>
          <div class="metric-body">
            <span class="metric-value">{{ conversionDisplay() }}%</span>
            <span class="metric-label">Конверсия</span>
            <span class="metric-sub">заказы / визиты</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .metrics-loading {
      display: flex;
      justify-content: center;
      padding: 12px;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
    }

    .metric-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: var(--crm-radius-lg, 12px);
      background: var(--crm-gradient-card, rgba(255,255,255,0.04));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      backdrop-filter: blur(var(--crm-glass-blur, 12px));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur, 12px));
      transition: border-color 0.2s;

      &:hover { border-color: rgba(255,255,255,0.15); }
    }

    .metric-icon {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: inherit;
      }
    }

    .amber .metric-icon  { background: rgba(255, 179, 0, 0.15); color: #ffb300; }
    .green .metric-icon  { background: rgba(76, 175, 80, 0.15); color: #4caf50; }
    .blue .metric-icon   { background: rgba(33, 150, 243, 0.15); color: #2196f3; }
    .teal .metric-icon   { background: rgba(0, 150, 136, 0.15); color: #009688; }
    .purple .metric-icon { background: rgba(156, 39, 176, 0.15); color: #9c27b0; }

    .metric-body {
      display: flex;
      flex-direction: column;
      min-width: 0;
      flex: 1;
    }

    .metric-value {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 22px;
      font-weight: 500;
      line-height: 1.1;
      color: var(--crm-text-primary);
      letter-spacing: -0.02em;
    }

    .metric-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--crm-text-muted);
      letter-spacing: 0.01em;
      line-height: 1.3;
    }

    .metric-sub {
      font-size: 11px;
      color: var(--crm-text-secondary, rgba(255,255,255,0.5));
      line-height: 1.2;
    }

    .metric-week {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex-shrink: 0;
      padding: 4px 8px;
      border-radius: 6px;
      background: rgba(255,255,255,0.04);
    }

    .week-value {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 16px;
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .week-label {
      font-size: 9px;
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    @media (max-width: 640px) {
      .metrics-grid { grid-template-columns: repeat(2, 1fr); }
      .metric-card { padding: 10px 12px; }
      .metric-value { font-size: 18px; }
    }

    @media (max-width: 380px) {
      .metrics-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class DashboardMetricsComponent {
  private readonly dashData = inject(DashboardDataService);

  readonly metrics = this.dashData.dashboardMetrics;
  readonly loading = this.dashData.loadingMetrics;

  readonly conversionDisplay = computed(() => {
    const m = this.metrics();
    return m ? m.conversionRate.toFixed(1) : '0.0';
  });
}
