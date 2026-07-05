import { Component, inject, signal, ChangeDetectionStrategy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DecimalPipe, DatePipe } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { forkJoin } from 'rxjs';
import {
  PaymentAnalyticsApiService,
  PaymentSummary,
  PaymentMethodBreakdown,
  DailyRevenue,
  TopService,
} from '../../services/payment-analytics-api.service';

@Component({
  selector: 'app-payment-analytics-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe, DatePipe,
    MatButtonToggleModule, MatCardModule, MatIconModule,
    MatTableModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="pa-dash">
      <div class="pa-header">
        <h2>
          <mat-icon>analytics</mat-icon>
          Аналитика платежей
        </h2>
        <mat-button-toggle-group [value]="period()" (change)="changePeriod($event.value)">
          <mat-button-toggle value="7d">7 дней</mat-button-toggle>
          <mat-button-toggle value="30d">30 дней</mat-button-toggle>
          <mat-button-toggle value="90d">90 дней</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      }

      @if (summary()) {
        <!-- KPI Row 1 -->
        <div class="kpi-row">
          <mat-card appearance="outlined" class="kpi-card revenue">
            <mat-icon>account_balance_wallet</mat-icon>
            <span class="kpi-value">{{ summary()!.totalRevenue | number:'1.0-0' }} ₽</span>
            <span class="kpi-label">Выручка</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>shopping_cart</mat-icon>
            <span class="kpi-value">{{ summary()!.orderCount }}</span>
            <span class="kpi-label">Заказов</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>payments</mat-icon>
            <span class="kpi-value">{{ summary()!.avgCheck | number:'1.0-0' }} ₽</span>
            <span class="kpi-label">Средний чек</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card">
            <mat-icon>trending_up</mat-icon>
            <span class="kpi-value conv-rate">{{ summary()!.conversionRate }}%</span>
            <span class="kpi-label">Конверсия</span>
          </mat-card>
        </div>

        <!-- KPI Row 2 -->
        <div class="kpi-row kpi-row-small">
          <mat-card appearance="outlined" class="kpi-card mini paid">
            <mat-icon>check_circle</mat-icon>
            <span class="kpi-value">{{ summary()!.paidCount }}</span>
            <span class="kpi-label">Оплачено</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card mini pending">
            <mat-icon>schedule</mat-icon>
            <span class="kpi-value">{{ summary()!.pendingCount }}</span>
            <span class="kpi-label">Ожидают</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card mini failed">
            <mat-icon>error</mat-icon>
            <span class="kpi-value">{{ summary()!.failedCount }}</span>
            <span class="kpi-label">Ошибки</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card mini expired-card">
            <mat-icon>timer_off</mat-icon>
            <span class="kpi-value">{{ summary()!.expiredCount }}</span>
            <span class="kpi-label">Истекло</span>
          </mat-card>
          <mat-card appearance="outlined" class="kpi-card mini refund">
            <mat-icon>currency_exchange</mat-icon>
            <span class="kpi-value">{{ summary()!.refundCount }}</span>
            <span class="kpi-label">Возвраты</span>
          </mat-card>
        </div>

        <!-- Payment Methods -->
        @if (methods().length) {
          <h3 class="section-title">Способы оплаты</h3>
          <div class="methods-row">
            @for (m of methods(); track m.method) {
              <mat-card appearance="outlined" class="method-card">
                <mat-icon>{{ methodIcon(m.method) }}</mat-icon>
                <div class="method-info">
                  <span class="method-name">{{ methodLabel(m.method) }}</span>
                  <span class="method-stats">{{ m.count }} платежей · {{ m.amount | number:'1.0-0' }} ₽</span>
                  <div class="method-bar">
                    <div class="method-bar-fill" [style.width.%]="methodPercent(m)"></div>
                  </div>
                </div>
              </mat-card>
            }
          </div>
        }

        <!-- Top Services -->
        @if (services().length) {
          <h3 class="section-title">Популярные услуги</h3>
          <div class="services-list">
            @for (s of services(); track s.service; let i = $index) {
              <div class="service-row">
                <span class="service-rank">{{ i + 1 }}</span>
                <span class="service-name">{{ s.service }}</span>
                <span class="service-count">{{ s.count }} заказов</span>
                <span class="service-revenue">{{ s.revenue | number:'1.0-0' }} ₽</span>
              </div>
            }
          </div>
        }

        <!-- Daily Table -->
        @if (daily().length) {
          <h3 class="section-title">По дням</h3>
          <table mat-table [dataSource]="daily()" class="daily-table">
            <ng-container matColumnDef="date">
              <th mat-header-cell *matHeaderCellDef>Дата</th>
              <td mat-cell *matCellDef="let row">{{ row.date | date:'dd.MM.yyyy':'':'ru' }}</td>
            </ng-container>
            <ng-container matColumnDef="count">
              <th mat-header-cell *matHeaderCellDef>Заказов</th>
              <td mat-cell *matCellDef="let row">{{ row.count }}</td>
            </ng-container>
            <ng-container matColumnDef="revenue">
              <th mat-header-cell *matHeaderCellDef>Выручка</th>
              <td mat-cell *matCellDef="let row">{{ row.revenue | number:'1.0-0' }} ₽</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="dailyColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: dailyColumns;"></tr>
          </table>
        }
      }
    </div>
  `,
  styles: `
    :host { display: block; }

    .pa-dash {
      padding: 0 0 32px;
      max-width: 1000px;
      margin: 0 auto;
    }

    .pa-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .pa-header h2 {
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .pa-header h2 mat-icon {
      color: #f59e0b;
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 60px;
    }

    /* KPI */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .kpi-row-small {
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    }

    .kpi-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 16px;
      gap: 6px;
      background: var(--ed-surface-variant, #1e1e1e) !important;
      border-color: var(--ed-outline, #333) !important;
    }

    .kpi-card mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--ed-on-surface-variant, #999);
    }

    .kpi-card.mini { padding: 12px 8px; }
    .kpi-card.mini mat-icon { font-size: 20px; width: 20px; height: 20px; }

    .kpi-card.revenue mat-icon { color: #22c55e; }
    .kpi-card.paid mat-icon { color: #22c55e; }
    .kpi-card.pending mat-icon { color: #f59e0b; }
    .kpi-card.failed mat-icon { color: #ef4444; }
    .kpi-card.expired-card mat-icon { color: #9ca3af; }
    .kpi-card.refund mat-icon { color: #a855f7; }

    .kpi-value {
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .kpi-card.mini .kpi-value { font-size: 1.1rem; }

    .conv-rate { color: #22c55e; }

    .kpi-label {
      font-size: 0.75rem;
      color: var(--ed-on-surface-variant, #999);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Section */
    .section-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 24px 0 12px;
    }

    /* Methods */
    .methods-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .method-card {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 16px !important;
      background: var(--ed-surface-variant, #1e1e1e) !important;
      border-color: var(--ed-outline, #333) !important;
    }

    .method-card mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: #f59e0b;
    }

    .method-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .method-name {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .method-stats {
      font-size: 0.78rem;
      color: var(--ed-on-surface-variant, #999);
    }

    .method-bar {
      height: 4px;
      background: var(--ed-outline, #333);
      border-radius: 2px;
      margin-top: 4px;
    }

    .method-bar-fill {
      height: 100%;
      background: #f59e0b;
      border-radius: 2px;
      transition: width 0.3s;
    }

    /* Services */
    .services-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .service-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: var(--ed-surface-variant, #1e1e1e);
      border: 1px solid var(--ed-outline, #333);
      border-radius: 8px;
    }

    .service-rank {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(245, 158, 11, 0.15);
      color: #f59e0b;
      font-size: 0.75rem;
      font-weight: 700;
      flex-shrink: 0;
    }

    .service-name {
      flex: 1;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .service-count {
      font-size: 0.78rem;
      color: var(--ed-on-surface-variant, #999);
    }

    .service-revenue {
      font-size: 0.85rem;
      font-weight: 600;
      color: #22c55e;
    }

    /* Table */
    .daily-table {
      width: 100%;
      background: transparent !important;
    }

    .daily-table th {
      color: var(--ed-on-surface-variant, #999) !important;
      font-size: 0.78rem;
      font-weight: 600;
      text-transform: uppercase;
      border-bottom-color: var(--ed-outline, #333) !important;
    }

    .daily-table td {
      color: var(--ed-on-surface, #f5f5f5) !important;
      font-size: 0.85rem;
      border-bottom-color: var(--ed-outline, #333) !important;
    }

    @media (max-width: 600px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .kpi-row-small { grid-template-columns: repeat(3, 1fr); }
    }
  `,
})
export class PaymentAnalyticsDashboardComponent implements OnInit {
  private readonly api = inject(PaymentAnalyticsApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly period = signal('30d');
  readonly loading = signal(false);
  readonly summary = signal<PaymentSummary | null>(null);
  readonly methods = signal<PaymentMethodBreakdown[]>([]);
  readonly daily = signal<DailyRevenue[]>([]);
  readonly services = signal<TopService[]>([]);
  readonly dailyColumns = ['date', 'count', 'revenue'];

  private maxMethodAmount = 0;

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadData();
    }
  }

  changePeriod(p: string): void {
    this.period.set(p);
    this.loadData();
  }

  private loadData(): void {
    const p = this.period();
    this.loading.set(true);

    forkJoin({
      summary: this.api.getSummary(p),
      methods: this.api.getByMethod(p),
      daily: this.api.getDaily(p),
      services: this.api.getTopServices(p),
    }).subscribe({
      next: (data) => {
        this.summary.set(data.summary);
        this.methods.set(data.methods);
        this.daily.set(data.daily);
        this.services.set(data.services);
        this.maxMethodAmount = Math.max(...data.methods.map(m => Number(m.amount)), 1);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  methodIcon(method: string): string {
    const map: Record<string, string> = { card: 'credit_card', sbp: 'qr_code_2', other: 'payments' };
    return map[method] ?? 'payments';
  }

  methodLabel(method: string): string {
    const map: Record<string, string> = { card: 'Банковские карты', sbp: 'СБП', other: 'Другое' };
    return map[method] ?? method;
  }

  methodPercent(m: PaymentMethodBreakdown): number {
    return this.maxMethodAmount > 0 ? (Number(m.amount) / this.maxMethodAmount) * 100 : 0;
  }
}
