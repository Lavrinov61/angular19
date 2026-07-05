import { Component, inject, signal, computed, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { AuthService } from '../../../../core/services/auth.service';
import {
  CashReconciliationReport,
  CashReconciliationRow,
  CashReconciliationStatus,
  CrmReportsApiService,
  DailySummary,
  RevenueRow,
  TopProduct,
} from '../../services/crm-reports-api.service';

type Period = 'week' | 'month' | 'quarter';
type GroupBy = 'day' | 'week' | 'month';
type PaymentMethodTone = 'cash' | 'card' | 'sbp' | 'online' | 'subscription' | 'transfer';

interface PaymentMethodRow {
  key: string;
  label: string;
  detail?: string;
  icon: string;
  value: number;
  percent: number;
  tone: PaymentMethodTone;
}

interface CashControlGroup {
  key: string;
  studioName: string;
  rows: CashReconciliationRow[];
  expectedTotal: number;
  factTotal: number;
  differenceTotal: number;
  issues: number;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatMoney(v: number): string {
  if (v >= 1000) return Math.round(v / 1000) + 'к';
  return v.toString();
}

@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatNativeDateModule,
    DecimalPipe,
  ],
  template: `
    <div class="reports-page">
      <div class="reports-header">
        <h2>Отчёты</h2>
        <mat-button-toggle-group [value]="activePeriod()" (change)="onPeriodChange($event.value)" hideSingleSelectionIndicator>
          <mat-button-toggle value="week">Неделя</mat-button-toggle>
          <mat-button-toggle value="month">Месяц</mat-button-toggle>
          <mat-button-toggle value="quarter">Квартал</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <!-- Daily Summary Cards -->
      @if (summary()) {
        <div class="summary-cards">
          <mat-card class="summary-card revenue-card">
            <div class="card-value">{{ summary()!.today.net | number:'1.0-0' }} ₽</div>
            <div class="card-label">Выручка сегодня</div>
            <div class="card-compare" [class.positive]="revenueVsYesterday() > 0" [class.negative]="revenueVsYesterday() < 0">
              @if (revenueVsYesterday() !== 0) {
                <mat-icon>{{ revenueVsYesterday() > 0 ? 'trending_up' : 'trending_down' }}</mat-icon>
                {{ revenueVsYesterday() > 0 ? '+' : '' }}{{ revenueVsYesterday() | number:'1.0-0' }} ₽ vs вчера
              } @else {
                — как вчера
              }
            </div>
          </mat-card>

          <mat-card class="summary-card">
            <div class="card-value">{{ summary()!.today.receipts }}</div>
            <div class="card-label">Чеков</div>
            <div class="card-compare">
              вчера: {{ summary()!.yesterday.receipts }}
            </div>
          </mat-card>

          <mat-card class="summary-card">
            <div class="card-value">{{ summary()!.today.avg_check | number:'1.0-0' }} ₽</div>
            <div class="card-label">Средний чек</div>
            <div class="card-compare">
              за неделю: {{ summary()!.last_week_avg.revenue | number:'1.0-0' }} ₽/день
            </div>
          </mat-card>

          <mat-card class="summary-card">
            <div class="card-value">{{ summary()!.today.orders + summary()!.today.receipts }}</div>
            <div class="card-label">Заказов всего</div>
            <div class="card-compare">
              @if (summary()!.pending_orders > 0) {
                <mat-icon class="pending-icon">schedule</mat-icon>
                {{ summary()!.pending_orders }} в работе
              } @else {
                Нет активных
              }
            </div>
          </mat-card>
        </div>

        <!-- Payment Breakdown -->
        <mat-card class="payment-card">
          <h3>Способы оплаты (сегодня)</h3>
          <div class="payment-bars">
            @for (pm of paymentMethods(); track pm.key) {
              <div class="pm-row">
                <div class="pm-label">
                  <mat-icon>{{ pm.icon }}</mat-icon>
                  <span class="pm-label-text">
                    <span>{{ pm.label }}</span>
                    @if (pm.detail) {
                      <span class="pm-detail">{{ pm.detail }}</span>
                    }
                  </span>
                </div>
                <div class="pm-bar-wrapper">
                  <div class="pm-bar"
                       [style.width.%]="pm.percent"
                       [class.pm-cash]="pm.tone === 'cash'"
                       [class.pm-card]="pm.tone === 'card'"
                       [class.pm-sbp]="pm.tone === 'sbp'"
                       [class.pm-online]="pm.tone === 'online'"
                       [class.pm-subscription]="pm.tone === 'subscription'"
                       [class.pm-transfer]="pm.tone === 'transfer'"></div>
                </div>
                <div class="pm-value">{{ pm.value | number:'1.0-0' }} ₽</div>
              </div>
            }
          </div>
        </mat-card>
      } @else if (loadingSummary()) {
        <div class="loading-center">
          <mat-spinner diameter="32" />
        </div>
      }

      @if (canViewCashControl()) {
        <mat-card id="cash-control" class="cash-control-card">
          <div class="cash-control-head">
            <div>
              <h3>Контроль налички</h3>
              <div class="cash-subtitle">Рабочие смены сотрудников: факт на старте и закрытии</div>
            </div>
            @if (cashControl(); as cash) {
              <div class="cash-summary">
                <span class="cash-pill cash-pill-ok">
                  <mat-icon>check_circle</mat-icon>
                  {{ cash.summary.balanced }} верно
                </span>
                <span class="cash-pill cash-pill-tip">
                  <mat-icon>volunteer_activism</mat-icon>
                  {{ cash.summary.possible_tip }} чаевые
                </span>
                <span class="cash-pill cash-pill-issue">
                  <mat-icon>error</mat-icon>
                  {{ cash.summary.issues }} проблем
                </span>
              </div>
            }
          </div>

          @if (loadingCashControl()) {
            <div class="loading-center compact">
              <mat-spinner diameter="28" />
            </div>
          } @else if (cashControlGroups().length) {
            <div class="cash-groups">
              @for (group of cashControlGroups(); track group.key) {
                <section class="cash-group">
                  <div class="cash-group-head">
                    <div class="cash-group-title">
                      <mat-icon>storefront</mat-icon>
                      <span>{{ group.studioName }}</span>
                    </div>
                    <div class="cash-group-stats">
                      <span>смен: {{ group.rows.length }}</span>
                      <span>ожидалось: {{ formatCash(group.expectedTotal) }}</span>
                      <span>факт: {{ formatCash(group.factTotal) }}</span>
                      <span [class.cash-diff-positive]="group.differenceTotal > 0"
                            [class.cash-diff-negative]="group.differenceTotal < 0">
                        {{ formatSignedCash(group.differenceTotal) }}
                      </span>
                      @if (group.issues > 0) {
                        <span class="cash-group-issues">{{ group.issues }} проблем</span>
                      }
                    </div>
                  </div>

                  <div class="cash-table-wrap">
                    <div class="cash-table">
                      <div class="cash-row cash-header">
                        <span>Дата</span>
                        <span>Сотрудник</span>
                        <span>Старт</span>
                        <span>Наличные</span>
                        <span>Изъятия</span>
                        <span>Ожидалось</span>
                        <span>Факт</span>
                        <span>Разница</span>
                        <span>Статус</span>
                      </div>
                      @for (row of group.rows; track row.shift_id) {
                        <div class="cash-row">
                          <span>{{ formatPeriodLabel(row.shift_date) }}</span>
                          <span class="cash-main">{{ row.employee_name }}</span>
                          <span>{{ formatCash(row.cash_at_open) }}</span>
                          <span class="cash-stack">
                            <span class="cash-main">{{ formatCash(row.cash_payments) }}</span>
                            @if (row.cash_payments > 0) {
                              <span class="cash-breakdown">
                                ФР {{ formatCash(cashFiscalPayments(row)) }}
                                · без ФР {{ formatCash(cashNonFiscalPayments(row)) }}
                                · чат {{ formatCash(cashChatPayments(row)) }}
                              </span>
                            }
                          </span>
                          <span>{{ formatCash(row.cash_withdrawals) }}</span>
                          <span class="cash-main">{{ formatCash(row.expected_cash) }}</span>
                          <span class="cash-main">{{ formatCash(row.cash_at_close) }}</span>
                          <span [class.cash-diff-positive]="(row.difference ?? 0) > 0"
                                [class.cash-diff-negative]="(row.difference ?? 0) < 0">
                            {{ formatSignedCash(row.difference) }}
                          </span>
                          <span class="cash-status"
                                [class.cash-status--balanced]="row.status === 'balanced'"
                                [class.cash-status--tip]="row.status === 'possible_tip'"
                                [class.cash-status--issue]="row.status === 'shortage' || row.status === 'surplus' || row.status === 'missing_open' || row.status === 'missing_close'"
                                [class.cash-status--open]="row.status === 'open'">
                            <mat-icon>{{ cashStatusIcon(row.status) }}</mat-icon>
                            {{ row.status_label }}
                          </span>
                        </div>
                      }
                    </div>
                  </div>
                </section>
              }
            </div>
          } @else {
            <div class="empty-state">Нет рабочих смен за выбранный период.</div>
          }
        </mat-card>
      }

      <!-- Revenue Chart (text-based bar chart) -->
      @if (revenueData().length) {
        <mat-card class="chart-card">
          <h3>Выручка по дням</h3>
          <div class="bar-chart">
            @for (row of revenueData(); track row.period) {
              <div class="bar-row">
                <div class="bar-date">{{ formatPeriodLabel(row.period) }}</div>
                <div class="bar-wrapper">
                  <div class="bar pos-bar" [style.width.%]="barWidth(row.pos_revenue - row.pos_refunds)"
                       [attr.title]="'POS: ' + (row.pos_revenue - row.pos_refunds) + ' ₽'"></div>
                  <div class="bar online-bar" [style.width.%]="barWidth(row.online_revenue)"
                       [attr.title]="'Онлайн: ' + row.online_revenue + ' ₽'"></div>
                  <div class="bar print-bar" [style.width.%]="barWidth(row.print_revenue)"
                       [attr.title]="'Печать: ' + row.print_revenue + ' ₽'"></div>
                  <div class="bar booking-bar" [style.width.%]="barWidth(row.booking_revenue)"
                       [attr.title]="'Записи: ' + row.booking_revenue + ' ₽'"></div>
                </div>
                <div class="bar-value">{{ formatMoney(row.total) }}</div>
              </div>
            }
          </div>
          <div class="chart-legend">
            <span class="legend-item"><span class="dot pos-dot"></span> Касса</span>
            <span class="legend-item"><span class="dot online-dot"></span> Онлайн</span>
            <span class="legend-item"><span class="dot print-dot"></span> Печать</span>
            <span class="legend-item"><span class="dot booking-dot"></span> Записи</span>
          </div>
        </mat-card>
      }

      <!-- Top Products -->
      @if (topProducts().length) {
        <mat-card class="products-card">
          <h3>Популярные товары</h3>
          <div class="products-table">
            <div class="pt-header">
              <span class="pt-name">Товар</span>
              <span class="pt-qty">Кол-во</span>
              <span class="pt-rev">Выручка</span>
            </div>
            @for (p of topProducts(); track p.product_name; let i = $index) {
              <div class="pt-row">
                <span class="pt-rank">{{ i + 1 }}</span>
                <span class="pt-name">{{ p.product_name }}</span>
                <span class="pt-qty">{{ p.quantity }}</span>
                <span class="pt-rev">{{ p.revenue | number:'1.0-0' }} ₽</span>
              </div>
            }
          </div>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .reports-page { max-width: 1120px; margin: 0 auto; padding: 16px; }

    .reports-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;

      h2 { margin: 0; font-size: 20px; font-weight: 600; color: var(--mat-sys-on-surface); }
    }

    .loading-center { display: flex; justify-content: center; padding: 32px; }

    /* Summary Cards */
    .summary-cards {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 16px;

      @media (min-width: 600px) { grid-template-columns: repeat(4, 1fr); }
    }

    .summary-card {
      padding: 16px;
      text-align: center;
    }

    .card-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
      line-height: 1.2;
    }

    .card-label {
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 4px;
    }

    .card-compare {
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 2px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.positive { color: var(--crm-status-success); }
      &.negative { color: var(--crm-status-error); }
    }

    .pending-icon { color: var(--crm-status-warning); }

    .revenue-card .card-value { color: var(--mat-sys-primary); }

    /* Payment Breakdown */
    .payment-card {
      padding: 16px;
      margin-bottom: 16px;

      h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
    }

    .pm-row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 30px;
      margin-bottom: 8px;
    }

    .pm-label {
      width: 170px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--mat-sys-on-surface);
      flex-shrink: 0;

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--mat-sys-on-surface-variant); }
    }

    .pm-label-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      line-height: 1.15;
      min-width: 0;
    }

    .pm-detail {
      color: var(--mat-sys-on-surface-variant);
      font-size: 11px;
      font-weight: 500;
    }

    .pm-bar-wrapper {
      flex: 1;
      height: 20px;
      background: var(--mat-sys-surface-container);
      border-radius: 4px;
      overflow: hidden;
    }

    .pm-bar {
      height: 100%;
      border-radius: 4px;
      min-width: 2px;
      transition: width 0.3s ease;
    }

    .pm-cash { background: var(--crm-status-success); }
    .pm-card { background: var(--crm-status-info); }
    .pm-sbp { background: var(--crm-accent); }
    .pm-online { background: var(--crm-status-warning); }
    .pm-subscription { background: var(--crm-status-error); }
    .pm-transfer { background: var(--crm-status-info); }

    .pm-value {
      width: 80px;
      text-align: right;
      font-size: 13px;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
      flex-shrink: 0;
    }

    /* Cash Control */
    .cash-control-card {
      padding: 16px;
      margin-bottom: 16px;
      overflow: hidden;
    }

    .cash-control-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;

      h3 { margin: 0; font-size: 14px; font-weight: 600; }
    }

    .cash-subtitle {
      margin-top: 3px;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .cash-summary {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .cash-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 26px;
      padding: 0 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);

      mat-icon { font-size: 15px; width: 15px; height: 15px; }
    }

    .cash-pill-ok { color: var(--crm-status-success); }
    .cash-pill-tip { color: var(--crm-status-info); }
    .cash-pill-issue { color: var(--crm-status-error); }

    .cash-groups {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .cash-group {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 6px;
      overflow: hidden;
      background: var(--mat-sys-surface);
    }

    .cash-group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      background: var(--mat-sys-surface-container-low);
      flex-wrap: wrap;
    }

    .cash-group-title {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      color: var(--mat-sys-on-surface);
      font-weight: 700;
      font-size: 13px;

      mat-icon { font-size: 17px; width: 17px; height: 17px; color: var(--mat-sys-on-surface-variant); }
    }

    .cash-group-stats {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
      font-weight: 600;
    }

    .cash-group-issues {
      color: var(--crm-status-error);
    }

    .cash-table-wrap {
      overflow-x: auto;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    .cash-table {
      min-width: 1040px;
      display: flex;
      flex-direction: column;
    }

    .cash-row {
      display: grid;
      grid-template-columns: 70px minmax(140px, 1.2fr) 90px minmax(175px, 1.5fr) 85px 105px 95px 90px 142px;
      align-items: center;
      min-height: 46px;
      gap: 8px;
      padding: 8px 10px;
      border-top: 1px solid var(--mat-sys-surface-container);
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }

    .cash-header {
      min-height: 34px;
      border-top: 0;
      background: var(--mat-sys-surface-container-low);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .cash-main {
      color: var(--mat-sys-on-surface);
      font-weight: 600;
    }

    .cash-stack {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .cash-breakdown {
      color: var(--mat-sys-on-surface-variant);
      font-size: 10px;
      line-height: 1.2;
      white-space: normal;
    }

    .cash-diff-positive {
      color: var(--crm-status-info);
      font-weight: 700;
    }

    .cash-diff-negative {
      color: var(--crm-status-error);
      font-weight: 700;
    }

    .cash-status {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 26px;
      padding: 3px 8px;
      border-radius: 999px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface-variant);
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;

      mat-icon { font-size: 15px; width: 15px; height: 15px; }
    }

    .cash-status--balanced { color: var(--crm-status-success); }
    .cash-status--tip { color: var(--crm-status-info); }
    .cash-status--issue { color: var(--crm-status-error); }
    .cash-status--open { color: var(--crm-status-warning); }

    .empty-state {
      padding: 24px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: 6px;
      font-size: 13px;
    }

    .loading-center.compact { padding: 20px; }

    /* Bar Chart */
    .chart-card {
      padding: 16px;
      margin-bottom: 16px;

      h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
    }

    .bar-chart { display: flex; flex-direction: column; gap: 4px; }

    .bar-row {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 24px;
    }

    .bar-date {
      width: 44px;
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      text-align: right;
      flex-shrink: 0;
    }

    .bar-wrapper {
      flex: 1;
      display: flex;
      height: 18px;
      background: var(--mat-sys-surface-container);
      border-radius: 3px;
      overflow: hidden;
    }

    .bar {
      height: 100%;
      transition: width 0.3s ease;
    }

    .pos-bar { background: var(--crm-status-info); }
    .online-bar { background: var(--crm-status-warning); }
    .print-bar { background: var(--crm-status-success); }
    .booking-bar { background: var(--crm-accent); }

    .bar-value {
      width: 40px;
      font-size: 12px;
      font-weight: 500;
      color: var(--mat-sys-on-surface);
      text-align: right;
      flex-shrink: 0;
    }

    .chart-legend {
      display: flex;
      gap: 16px;
      margin-top: 12px;
      justify-content: center;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .pos-dot { background: var(--crm-status-info); }
    .online-dot { background: var(--crm-status-warning); }
    .print-dot { background: var(--crm-status-success); }
    .booking-dot { background: var(--crm-accent); }

    /* Top Products */
    .products-card {
      padding: 16px;

      h3 { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
    }

    .pt-header {
      display: flex;
      gap: 8px;
      padding: 6px 0;
      font-size: 11px;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-transform: uppercase;
    }

    .pt-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      border-bottom: 1px solid var(--mat-sys-surface-container);
    }

    .pt-rank {
      width: 20px;
      font-size: 12px;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
      text-align: center;
      flex-shrink: 0;
    }

    .pt-name { flex: 1; font-size: 13px; color: var(--mat-sys-on-surface); }
    .pt-qty { width: 50px; text-align: center; font-size: 13px; color: var(--mat-sys-on-surface-variant); }
    .pt-rev { width: 80px; text-align: right; font-size: 13px; font-weight: 500; color: var(--mat-sys-on-surface); }
  `],
})
export class ReportsComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly api = inject(CrmReportsApiService);
  private readonly auth = inject(AuthService);

  activePeriod = signal<Period>('week');
  loadingSummary = signal(true);
  loadingCashControl = signal(false);
  summary = signal<DailySummary | null>(null);
  revenueData = signal<RevenueRow[]>([]);
  topProducts = signal<TopProduct[]>([]);
  cashControl = signal<CashReconciliationReport | null>(null);

  private maxRevenue = 0;

  canViewCashControl = computed(() => this.auth.hasPermission('users:manage'));
  cashControlRows = computed(() => this.cashControl()?.rows ?? []);
  cashControlGroups = computed<CashControlGroup[]>(() => {
    const rows = [...this.cashControlRows()].sort((left, right) => {
      const studioCompare = left.studio_name.localeCompare(right.studio_name, 'ru');
      if (studioCompare !== 0) return studioCompare;

      const dateCompare = right.shift_date.localeCompare(left.shift_date);
      if (dateCompare !== 0) return dateCompare;

      return left.employee_name.localeCompare(right.employee_name, 'ru');
    });
    const groups: CashControlGroup[] = [];

    for (const row of rows) {
      const key = row.studio_id ?? `studio:${row.studio_name}`;
      let group = groups.find(item => item.key === key);

      if (!group) {
        group = {
          key,
          studioName: row.studio_name,
          rows: [],
          expectedTotal: 0,
          factTotal: 0,
          differenceTotal: 0,
          issues: 0,
        };
        groups.push(group);
      }

      group.rows.push(row);
      group.expectedTotal += row.expected_cash ?? 0;
      group.factTotal += row.cash_at_close ?? 0;
      group.differenceTotal += row.difference ?? 0;

      if (this.isIssueStatus(row.status)) {
        group.issues += 1;
      }
    }

    return groups;
  });

  revenueVsYesterday = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    return s.today.net - s.yesterday.revenue;
  });

  paymentMethods = computed<PaymentMethodRow[]>(() => {
    const s = this.summary();
    if (!s) return [];
    const p = s.today.payments;
    const cashPosFiscal = p.cash_pos_fiscal ?? 0;
    const cashPosNonFiscal = p.cash_pos_non_fiscal ?? 0;
    const cashChatFiscal = p.cash_chat_fiscal ?? 0;
    const cashChatNonFiscal = p.cash_chat_non_fiscal ?? 0;
    const splitCash = cashPosFiscal + cashPosNonFiscal + cashChatFiscal + cashChatNonFiscal;
    const cashUnclassified = Math.max(0, p.cash - splitCash);
    const total = splitCash + cashUnclassified + p.card + p.sbp + p.online + p.subscription + p.transfer;
    const pct = (v: number) => total > 0 ? (v / total) * 100 : 0;
    const methods: PaymentMethodRow[] = [
      {
        key: 'cash_pos_fiscal',
        label: 'Наличные ФР',
        detail: 'Касса',
        icon: 'receipt_long',
        value: cashPosFiscal,
        percent: pct(cashPosFiscal),
        tone: 'cash',
      },
      {
        key: 'cash_pos_non_fiscal',
        label: 'Наличные без ФР',
        detail: 'Касса',
        icon: 'money_off',
        value: cashPosNonFiscal,
        percent: pct(cashPosNonFiscal),
        tone: 'cash',
      },
      {
        key: 'cash_chat_fiscal',
        label: 'Чат наличные ФР',
        detail: 'Из чата',
        icon: 'forum',
        value: cashChatFiscal,
        percent: pct(cashChatFiscal),
        tone: 'cash',
      },
      {
        key: 'cash_chat_non_fiscal',
        label: 'Чат наличные без ФР',
        detail: 'Из чата',
        icon: 'speaker_notes_off',
        value: cashChatNonFiscal,
        percent: pct(cashChatNonFiscal),
        tone: 'cash',
      },
      {
        key: 'cash_unclassified',
        label: 'Наличные',
        detail: 'Без детализации',
        icon: 'payments',
        value: cashUnclassified,
        percent: pct(cashUnclassified),
        tone: 'cash',
      },
      { key: 'card', label: 'Карта', icon: 'credit_card', value: p.card, percent: pct(p.card), tone: 'card' },
      { key: 'sbp', label: 'СБП', icon: 'qr_code_2', value: p.sbp, percent: pct(p.sbp), tone: 'sbp' },
      { key: 'transfer', label: 'Перевод', icon: 'account_balance', value: p.transfer, percent: pct(p.transfer), tone: 'transfer' },
      { key: 'online', label: 'Онлайн', icon: 'language', value: p.online, percent: pct(p.online), tone: 'online' },
      {
        key: 'subscription',
        label: 'Подписка',
        icon: 'card_membership',
        value: p.subscription,
        percent: pct(p.subscription),
        tone: 'subscription',
      },
    ];

    return methods.filter(m => m.value > 0);
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadSummary();
      this.loadRevenueData();
      this.loadCashControl();
    }
  }

  onPeriodChange(period: Period): void {
    this.activePeriod.set(period);
    this.loadRevenueData();
    this.loadCashControl();
  }

  private loadSummary(): void {
    this.loadingSummary.set(true);
    this.api.getDailySummary().subscribe({
      next: (data) => {
        this.summary.set(data);
        this.loadingSummary.set(false);
      },
      error: () => this.loadingSummary.set(false),
    });
  }

  private loadRevenueData(): void {
    const { from, to, groupBy } = this.getDateRange();
    this.api.getRevenue(from, to, groupBy).subscribe({
      next: (data) => {
        this.maxRevenue = Math.max(...data.map(r => r.total), 1);
        this.revenueData.set(data);
      },
    });

    this.api.getTopProducts(from, to).subscribe({
      next: (data) => this.topProducts.set(data),
    });
  }

  private loadCashControl(): void {
    if (!this.canViewCashControl()) {
      this.cashControl.set(null);
      return;
    }

    const { from, to } = this.getDateRange();
    this.loadingCashControl.set(true);
    this.api.getCashControl(from, to).subscribe({
      next: (data) => {
        this.cashControl.set(data);
        this.loadingCashControl.set(false);
      },
      error: () => {
        this.cashControl.set(null);
        this.loadingCashControl.set(false);
      },
    });
  }

  private getDateRange(): { from: string; to: string; groupBy: GroupBy } {
    const now = new Date();
    const to = formatDate(now);
    let from: string;
    let groupBy: GroupBy = 'day';

    switch (this.activePeriod()) {
      case 'week':
        from = formatDate(new Date(now.getTime() - 6 * 86400000));
        groupBy = 'day';
        break;
      case 'month':
        from = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
        groupBy = 'day';
        break;
      case 'quarter':
        from = formatDate(new Date(now.getTime() - 89 * 86400000));
        groupBy = 'week';
        break;
    }

    return { from, to, groupBy };
  }

  barWidth(value: number): number {
    return this.maxRevenue > 0 ? (value / this.maxRevenue) * 100 : 0;
  }

  formatPeriodLabel(period: string): string {
    const d = new Date(period + 'T00:00:00');
    const day = d.getDate();
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${day} ${months[d.getMonth()]}`;
  }

  formatMoney(v: number): string {
    return formatMoney(v);
  }

  formatCash(value: number | null): string {
    if (value == null) return '—';
    return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
  }

  formatSignedCash(value: number | null): string {
    if (value == null) return '—';
    if (value === 0) return '0 ₽';
    const sign = value > 0 ? '+' : '-';
    return `${sign}${Math.abs(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
  }

  cashFiscalPayments(row: CashReconciliationRow): number {
    return row.cash_pos_fiscal_payments + row.cash_chat_fiscal_payments;
  }

  cashNonFiscalPayments(row: CashReconciliationRow): number {
    return row.cash_pos_non_fiscal_payments + row.cash_chat_non_fiscal_payments;
  }

  cashChatPayments(row: CashReconciliationRow): number {
    return row.cash_chat_fiscal_payments + row.cash_chat_non_fiscal_payments;
  }

  cashStatusIcon(status: CashReconciliationStatus): string {
    switch (status) {
      case 'balanced':
        return 'check_circle';
      case 'possible_tip':
        return 'volunteer_activism';
      case 'open':
        return 'schedule';
      case 'shortage':
        return 'remove_circle';
      case 'surplus':
        return 'add_circle';
      case 'missing_open':
      case 'missing_close':
        return 'help';
    }
  }

  private isIssueStatus(status: CashReconciliationStatus): boolean {
    return status !== 'balanced' && status !== 'possible_tip' && status !== 'open';
  }
}
