import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { AiCrmApiService, CRMInsights } from '../../services/ai-crm-api.service';

@Component({
  selector: 'app-ai-insights',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatChipsModule, MatProgressSpinnerModule, MatDividerModule],
  template: `
    <div class="insights-page">
      <div class="page-header">
        <h1><mat-icon>insights</mat-icon> AI Аналитика</h1>
        <button mat-flat-button (click)="loadInsights()" [disabled]="loading()">
          @if (loading()) {
            <mat-spinner diameter="18" />
          } @else {
            <mat-icon>refresh</mat-icon>
          }
          Обновить
        </button>
      </div>

      @if (insights(); as data) {
        <!-- Trends -->
        <section class="section">
          <h2>Тренды (7 дней)</h2>
          <div class="trends-grid">
            @for (trend of data.trends; track trend.metric) {
              <mat-card class="trend-card" appearance="outlined">
                <mat-card-content>
                  <div class="trend-header">
                    <span class="metric-name">{{ trend.metric }}</span>
                    <mat-icon [class]="'trend-' + trend.direction">{{ trendIcon(trend.direction) }}</mat-icon>
                  </div>
                  <div class="trend-change" [class]="'change-' + trend.direction">
                    {{ trend.change > 0 ? '+' : '' }}{{ trend.change }}%
                  </div>
                </mat-card-content>
              </mat-card>
            }
          </div>
        </section>

        <!-- Recommendations -->
        @if (data.recommendations.length) {
          <section class="section">
            <h2><mat-icon class="section-icon">lightbulb</mat-icon> Рекомендации AI</h2>
            <div class="recommendations">
              @for (rec of data.recommendations; track rec) {
                <mat-card class="rec-card" appearance="outlined">
                  <mat-card-content>
                    <mat-icon class="rec-icon">auto_fix_high</mat-icon>
                    <p>{{ rec }}</p>
                  </mat-card-content>
                </mat-card>
              }
            </div>
          </section>
        }

        <mat-divider />

        <!-- Forecast -->
        <section class="section">
          <h2>Прогноз на 7 дней</h2>
          <div class="forecast-grid">
            @for (day of data.forecast; track day.date) {
              <mat-card class="forecast-card" appearance="outlined"
                        [class.today]="isToday(day.date)"
                        [class.weekend]="isWeekend(day.date)">
                <mat-card-content>
                  <div class="forecast-date">{{ formatDate(day.date) }}</div>
                  <div class="forecast-dow">{{ dayOfWeek(day.date) }}</div>
                  <div class="forecast-metric">
                    <span class="metric-value">{{ day.expectedOrders }}</span>
                    <span class="metric-label">заказов</span>
                  </div>
                  <div class="forecast-metric">
                    <span class="metric-value">{{ formatRevenue(day.expectedRevenue) }}</span>
                    <span class="metric-label">выручка</span>
                  </div>
                </mat-card-content>
              </mat-card>
            }
          </div>
        </section>
      } @else if (!loading()) {
        <div class="empty-state">
          <mat-icon>analytics</mat-icon>
          <p>Нажмите «Обновить» для загрузки аналитики</p>
        </div>
      } @else {
        <div class="loading-state">
          <mat-spinner diameter="40" />
          <p>AI анализирует данные...</p>
        </div>
      }
    </div>
  `,
  styles: `
    .insights-page { max-width: 900px; margin: 0 auto; padding: 16px; }
    .page-header {
      display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
      h1 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 22px; flex: 1; }
    }
    .section { margin-bottom: 24px; }
    .section h2 {
      font-size: 16px; font-weight: 600; margin: 0 0 12px;
      display: flex; align-items: center; gap: 6px;
    }
    .section-icon { font-size: 20px; width: 20px; height: 20px; }

    .trends-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .trend-card { text-align: center; }
    .trend-header { display: flex; align-items: center; justify-content: center; gap: 8px; }
    .metric-name { font-size: 14px; color: var(--mat-sys-on-surface-variant); }
    .trend-change { font-size: 24px; font-weight: 700; margin-top: 4px; }
    .change-up { color: var(--crm-status-success); }
    .change-down { color: var(--crm-status-error); }
    .change-stable { color: var(--mat-sys-on-surface-variant); }
    .trend-up { color: var(--crm-status-success); }
    .trend-down { color: var(--crm-status-error); }
    .trend-stable { color: var(--mat-sys-on-surface-variant); }

    .recommendations { display: flex; flex-direction: column; gap: 8px; }
    .rec-card {
      border-left: 4px solid var(--mat-sys-tertiary);
      mat-card-content { display: flex; align-items: flex-start; gap: 8px; }
      .rec-icon { color: var(--mat-sys-tertiary); flex-shrink: 0; margin-top: 2px; }
      p { margin: 0; font-size: 14px; line-height: 1.5; }
    }

    .forecast-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px;
    }
    .forecast-card { text-align: center; padding: 4px; }
    .forecast-card.weekend { background: var(--mat-sys-surface-container); }
    .forecast-card.today { border: 2px solid var(--mat-sys-primary); }
    .forecast-date { font-size: 14px; font-weight: 600; }
    .forecast-dow { font-size: 12px; color: var(--mat-sys-on-surface-variant); margin-bottom: 8px; }
    .forecast-metric { margin-top: 4px; }
    .metric-value { font-size: 18px; font-weight: 700; display: block; }
    .metric-label { font-size: 11px; color: var(--mat-sys-on-surface-variant); }

    .empty-state, .loading-state {
      text-align: center; padding: 60px 20px;
      color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
      p { font-size: 16px; margin: 12px 0 0; }
    }
  `,
})
export class AiInsightsComponent implements OnInit {
  private readonly aiCrm = inject(AiCrmApiService);

  insights = signal<CRMInsights | null>(null);
  loading = signal(false);

  ngOnInit() {
    this.loadInsights();
  }

  loadInsights() {
    this.loading.set(true);
    this.aiCrm.getInsights().subscribe({
      next: (data) => {
        this.insights.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  trendIcon(direction: string): string {
    switch (direction) {
      case 'up': return 'trending_up';
      case 'down': return 'trending_down';
      default: return 'trending_flat';
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  dayOfWeek(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { weekday: 'short' });
  }

  isToday(iso: string): boolean {
    return new Date(iso).toDateString() === new Date().toDateString();
  }

  isWeekend(iso: string): boolean {
    const dow = new Date(iso).getDay();
    return dow === 0 || dow === 6;
  }

  formatRevenue(amount: number): string {
    if (amount >= 1000) return Math.round(amount / 1000) + 'к₽';
    return amount + '₽';
  }
}
