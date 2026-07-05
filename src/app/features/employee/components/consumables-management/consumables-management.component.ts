import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  PrintApiService,
  ConsumableStock,
  ConsumableAlert,
  ConsumableTransaction,
} from '../../services/print-api.service';

interface Studio { id: string; name: string; }

interface ForecastEntry {
  printer_id: string;
  printer_name: string;
  supplies: {
    name: string;
    color: string;
    current_level: number;
    daily_usage: number;
    days_remaining: number | null;
    estimated_empty_date: string | null;
    status: 'ok' | 'warning' | 'critical';
  }[];
}

@Component({
  selector: 'app-consumables-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DatePipe, DecimalPipe,
    MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressBarModule, MatProgressSpinnerModule,
    MatTooltipModule, MatDividerModule,
  ],
  template: `
    <div class="cm-page">
      <!-- Header -->
      <div class="cm-header">
        <div>
          <h2 class="cm-title">Расходные материалы</h2>
          <p class="cm-subtitle">Мониторинг и пополнение расходников</p>
        </div>
        <mat-form-field appearance="outline" class="studio-filter">
          <mat-label>Студия</mat-label>
          <mat-select [(value)]="selectedStudioId" (selectionChange)="reload()">
            <mat-option value="">Все студии</mat-option>
            @for (s of studios(); track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>

      <!-- KPI Cards -->
      <div class="cm-kpi">
        <mat-card class="kpi-card">
          <mat-icon class="kpi-icon">inventory_2</mat-icon>
          <div class="kpi-value">{{ stocks().length }}</div>
          <div class="kpi-label">Позиций</div>
        </mat-card>
        <mat-card class="kpi-card kpi-card--warning">
          <mat-icon class="kpi-icon">warning</mat-icon>
          <div class="kpi-value">{{ lowCount() }}</div>
          <div class="kpi-label">Низкий уровень</div>
        </mat-card>
        <mat-card class="kpi-card kpi-card--critical">
          <mat-icon class="kpi-icon">error</mat-icon>
          <div class="kpi-value">{{ criticalCount() }}</div>
          <div class="kpi-label">Критический</div>
        </mat-card>
        <mat-card class="kpi-card kpi-card--forecast">
          <mat-icon class="kpi-icon">schedule</mat-icon>
          <div class="kpi-value">{{ forecastCriticalDays() }}</div>
          <div class="kpi-label">Дней до замены</div>
        </mat-card>
      </div>

      @if (loading()) {
        <div class="cm-loading"><mat-spinner diameter="32" /></div>
      } @else {
        <!-- Stock Table -->
        <mat-card class="cm-section">
          <div class="section-header">
            <h3 class="section-title">Расходники</h3>
          </div>

          @if (stocks().length === 0) {
            <div class="cm-empty">
              <mat-icon>inbox</mat-icon>
              <span>Расходники не найдены</span>
            </div>
          } @else {
            <div class="cm-table-wrap">
              <table class="cm-table">
                <thead>
                  <tr>
                    <th>Название</th>
                    <th>Тип</th>
                    <th>Студия</th>
                    <th>Уровень</th>
                    <th>Статус</th>
                    <th>Посл. пополнение</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of stocks(); track item.id) {
                    <tr>
                      <td class="cell-name">{{ item.consumable_type }}</td>
                      <td>
                        <span class="type-badge" [class]="'type-badge--' + consumableCategory(item.consumable_type)">
                          {{ consumableCategoryLabel(item.consumable_type) }}
                        </span>
                      </td>
                      <td class="cell-studio">{{ item.station_name || '—' }}</td>
                      <td class="cell-level">
                        <div class="level-bar-wrap">
                          <mat-progress-bar
                            mode="determinate"
                            [value]="levelPercent(item)"
                            [class]="'level-bar level-bar--' + levelStatus(item)"
                          />
                          <span class="level-text">{{ levelPercent(item) | number:'1.0-0' }}%</span>
                        </div>
                        <span class="level-detail">{{ item.current_amount }} / {{ item.max_capacity ?? '?' }} {{ item.unit }}</span>
                      </td>
                      <td>
                        <span class="status-chip" [class]="'status-chip--' + levelStatus(item)">
                          {{ levelStatusLabel(item) }}
                        </span>
                      </td>
                      <td class="cell-date">
                        {{ item.last_refilled_at ? (item.last_refilled_at | date:'dd.MM.yy HH:mm') : '—' }}
                      </td>
                      <td class="cell-actions">
                        @if (refillId() === item.id) {
                          <div class="refill-inline">
                            <mat-form-field appearance="outline" class="refill-field">
                              <input matInput type="number" min="1" [(ngModel)]="refillAmount"
                                     placeholder="Кол-во" />
                            </mat-form-field>
                            <button mat-flat-button class="refill-btn" [disabled]="refillSaving() || !refillAmount"
                                    (click)="submitRefill(item.id)">
                              @if (refillSaving()) { <mat-spinner diameter="14" /> }
                              @else { OK }
                            </button>
                            <button mat-icon-button (click)="refillId.set(null)" matTooltip="Отмена">
                              <mat-icon>close</mat-icon>
                            </button>
                          </div>
                        } @else {
                          <button mat-stroked-button class="action-refill" (click)="startRefill(item.id)">
                            <mat-icon>add_circle</mat-icon> Пополнить
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </mat-card>

        <!-- Alerts -->
        @if (alerts().length > 0) {
          <mat-card class="cm-section">
            <div class="section-header">
              <h3 class="section-title">
                <mat-icon class="section-icon section-icon--alert">notifications_active</mat-icon>
                Алерты
              </h3>
            </div>
            <div class="alerts-list">
              @for (a of alerts(); track a.id) {
                <div class="alert-item" [class]="'alert-item--' + (a.percent_remaining !== null && a.percent_remaining < 20 ? 'critical' : 'warning')">
                  <mat-icon class="alert-icon">
                    {{ a.percent_remaining !== null && a.percent_remaining < 20 ? 'error' : 'warning' }}
                  </mat-icon>
                  <div class="alert-body">
                    <span class="alert-type">{{ a.consumable_type }}</span>
                    <span class="alert-studio">{{ a.station_name }}</span>
                  </div>
                  <div class="alert-level">
                    {{ a.current_amount }} / {{ a.low_threshold }} {{ a.unit }}
                    @if (a.percent_remaining !== null) {
                      <span class="alert-pct">({{ a.percent_remaining | number:'1.0-0' }}%)</span>
                    }
                  </div>
                </div>
              }
            </div>
          </mat-card>
        }

        <!-- Forecast -->
        @if (forecasts().length > 0) {
          <mat-card class="cm-section">
            <div class="section-header">
              <h3 class="section-title">
                <mat-icon class="section-icon">trending_down</mat-icon>
                Прогноз расхода
              </h3>
            </div>
            <div class="forecast-grid">
              @for (f of forecasts(); track f.printer_id) {
                <div class="forecast-card">
                  <div class="forecast-printer">{{ f.printer_name }}</div>
                  @for (s of f.supplies; track s.name) {
                    <div class="forecast-row">
                      <span class="forecast-supply-name">
                        @if (s.color !== 'none') {
                          <span class="color-dot" [style.background]="mapColor(s.color)"></span>
                        }
                        {{ s.name }}
                      </span>
                      <span class="forecast-level">{{ s.current_level }}%</span>
                      <span class="forecast-days" [class]="'forecast-days--' + s.status">
                        @if (s.days_remaining !== null) {
                          {{ s.days_remaining }} дн.
                        } @else {
                          —
                        }
                      </span>
                    </div>
                  }
                </div>
              }
            </div>
          </mat-card>
        }

        <!-- Transactions -->
        <mat-card class="cm-section">
          <div class="section-header">
            <h3 class="section-title">
              <mat-icon class="section-icon">history</mat-icon>
              История операций
            </h3>
          </div>
          @if (transactions().length === 0) {
            <div class="cm-empty cm-empty--small">
              <span>Нет записей</span>
            </div>
          } @else {
            <div class="tx-list">
              @for (tx of transactions(); track tx.id) {
                <div class="tx-item">
                  <mat-icon class="tx-icon" [class]="'tx-icon--' + tx.transaction_type">
                    {{ tx.transaction_type === 'refill' ? 'add_circle' : 'remove_circle' }}
                  </mat-icon>
                  <div class="tx-body">
                    <span class="tx-type">{{ tx.transaction_type === 'refill' ? 'Пополнение' : 'Расход' }}</span>
                    @if (tx.notes) {
                      <span class="tx-notes">{{ tx.notes }}</span>
                    }
                  </div>
                  <span class="tx-amount" [class]="'tx-amount--' + tx.transaction_type">
                    {{ tx.transaction_type === 'refill' ? '+' : '-' }}{{ tx.amount }}
                  </span>
                  <span class="tx-date">{{ tx.created_at | date:'dd.MM.yy HH:mm' }}</span>
                </div>
              }
            </div>
          }
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .cm-page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px 24px;
    }

    .cm-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 20px;
      gap: 16px;
    }

    .cm-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin: 0 0 2px;
    }

    .cm-subtitle {
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin: 0;
    }

    .studio-filter {
      width: 200px;
      font-size: 13px;
    }

    /* ── KPI ── */

    .cm-kpi {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }

    .kpi-card {
      background: var(--crm-surface-2);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }

    .kpi-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--crm-accent);
    }

    .kpi-card--warning .kpi-icon { color: var(--crm-supply-low, #f59e0b); }
    .kpi-card--critical .kpi-icon { color: var(--crm-supply-critical, #ef4444); }
    .kpi-card--forecast .kpi-icon { color: var(--crm-status-info, #60a5fa); }

    .kpi-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--crm-text-primary);
    }

    .kpi-label {
      font-size: 11px;
      color: var(--crm-text-secondary);
    }

    /* ── SECTIONS ── */

    .cm-section {
      background: var(--crm-surface-2);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 16px 20px;
      margin-bottom: 16px;
    }

    .section-header {
      margin-bottom: 12px;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .section-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-secondary);
    }

    .section-icon--alert { color: var(--crm-supply-low, #f59e0b); }

    /* ── TABLE ── */

    .cm-table-wrap {
      overflow-x: auto;
    }

    .cm-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .cm-table th {
      text-align: left;
      font-size: 11px;
      font-weight: 600;
      color: var(--crm-text-secondary);
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      white-space: nowrap;
    }

    .cm-table td {
      padding: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
      color: var(--crm-text-primary);
      vertical-align: middle;
    }

    .cm-table tr:hover td {
      background: rgba(139,92,246,0.04);
    }

    .cell-name {
      font-weight: 500;
    }

    .cell-studio {
      color: var(--crm-text-secondary);
      font-size: 12px;
    }

    .cell-date {
      font-size: 12px;
      color: var(--crm-text-secondary);
      white-space: nowrap;
    }

    .cell-actions {
      white-space: nowrap;
    }

    /* ── TYPE BADGE ── */

    .type-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      letter-spacing: 0.03em;
    }

    .type-badge--ink {
      background: rgba(96,165,250,0.15);
      color: #60a5fa;
    }

    .type-badge--toner {
      background: rgba(139,92,246,0.15);
      color: #a78bfa;
    }

    .type-badge--paper {
      background: rgba(52,211,153,0.15);
      color: #34d399;
    }

    .type-badge--other {
      background: rgba(156,163,175,0.12);
      color: #9ca3af;
    }

    /* ── LEVEL BAR ── */

    .cell-level {
      min-width: 140px;
    }

    .level-bar-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .level-bar {
      flex: 1;
      height: 6px;
      border-radius: 3px;
    }

    .level-bar--ok ::ng-deep .mdc-linear-progress__bar-inner {
      border-color: var(--crm-supply-ok, #22c55e);
    }

    .level-bar--low ::ng-deep .mdc-linear-progress__bar-inner {
      border-color: var(--crm-supply-low, #f59e0b);
    }

    .level-bar--critical ::ng-deep .mdc-linear-progress__bar-inner {
      border-color: var(--crm-supply-critical, #ef4444);
    }

    .level-text {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-primary);
      min-width: 36px;
    }

    .level-detail {
      font-size: 10px;
      color: var(--crm-text-secondary);
    }

    /* ── STATUS CHIP ── */

    .status-chip {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .status-chip--ok {
      background: rgba(34,197,94,0.12);
      color: var(--crm-supply-ok, #22c55e);
    }

    .status-chip--low {
      background: rgba(245,158,11,0.12);
      color: var(--crm-supply-low, #f59e0b);
    }

    .status-chip--critical {
      background: rgba(239,68,68,0.12);
      color: var(--crm-supply-critical, #ef4444);
    }

    /* ── REFILL INLINE ── */

    .refill-inline {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .refill-field {
      width: 80px;
      font-size: 12px;
    }

    .refill-field ::ng-deep .mat-mdc-form-field-infix {
      padding-top: 6px !important;
      padding-bottom: 6px !important;
      min-height: unset;
    }

    .refill-btn {
      background: var(--crm-accent);
      color: #fff;
      font-size: 12px;
      height: 30px;
      min-width: 40px;
      padding: 0 10px;
    }

    .action-refill {
      font-size: 12px;
      height: 30px;
      border-color: var(--crm-border, rgba(255,255,255,0.1));
      color: var(--crm-accent);

      mat-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 4px; }
    }

    /* ── ALERTS ── */

    .alerts-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .alert-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      font-size: 13px;
    }

    .alert-item--warning {
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.15);
    }

    .alert-item--critical {
      background: rgba(239,68,68,0.08);
      border: 1px solid rgba(239,68,68,0.15);
    }

    .alert-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .alert-item--warning .alert-icon { color: var(--crm-supply-low, #f59e0b); }
    .alert-item--critical .alert-icon { color: var(--crm-supply-critical, #ef4444); }

    .alert-body {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .alert-type {
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .alert-studio {
      font-size: 11px;
      color: var(--crm-text-secondary);
    }

    .alert-level {
      font-size: 12px;
      color: var(--crm-text-secondary);
      white-space: nowrap;
    }

    .alert-pct {
      font-weight: 600;
    }

    /* ── FORECAST ── */

    .forecast-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }

    .forecast-card {
      background: var(--crm-surface-3, #1a1a1a);
      border-radius: 6px;
      padding: 12px 14px;
    }

    .forecast-printer {
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin-bottom: 8px;
    }

    .forecast-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 3px 0;
      font-size: 12px;
    }

    .forecast-supply-name {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 5px;
      color: var(--crm-text-secondary);
    }

    .color-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .forecast-level {
      font-weight: 500;
      color: var(--crm-text-primary);
      min-width: 36px;
      text-align: right;
    }

    .forecast-days {
      min-width: 50px;
      text-align: right;
      font-weight: 500;
    }

    .forecast-days--ok { color: var(--crm-supply-ok, #22c55e); }
    .forecast-days--warning { color: var(--crm-supply-low, #f59e0b); }
    .forecast-days--critical { color: var(--crm-supply-critical, #ef4444); }

    /* ── TRANSACTIONS ── */

    .tx-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .tx-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 4px;
      font-size: 13px;
      border-bottom: 1px solid rgba(255,255,255,0.03);
    }

    .tx-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .tx-icon--refill { color: var(--crm-supply-ok, #22c55e); }
    .tx-icon--usage { color: var(--crm-text-secondary); }

    .tx-body {
      flex: 1;
      display: flex;
      flex-direction: column;
    }

    .tx-type {
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .tx-notes {
      font-size: 11px;
      color: var(--crm-text-secondary);
    }

    .tx-amount {
      font-weight: 600;
      font-size: 13px;
    }

    .tx-amount--refill { color: var(--crm-supply-ok, #22c55e); }
    .tx-amount--usage { color: var(--crm-text-secondary); }

    .tx-date {
      font-size: 11px;
      color: var(--crm-text-secondary);
      white-space: nowrap;
    }

    /* ── EMPTY / LOADING ── */

    .cm-loading, .cm-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 48px;
      color: var(--crm-text-secondary);
      font-size: 14px;

      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    }

    .cm-empty--small {
      padding: 24px;
      font-size: 13px;
    }
  `],
})
export class ConsumablesManagementComponent implements OnInit {
  private readonly api = inject(PrintApiService);
  private readonly http = inject(HttpClient);

  readonly stocks = signal<ConsumableStock[]>([]);
  readonly alerts = signal<ConsumableAlert[]>([]);
  readonly transactions = signal<ConsumableTransaction[]>([]);
  readonly forecasts = signal<ForecastEntry[]>([]);
  readonly studios = signal<Studio[]>([]);
  readonly loading = signal(true);

  readonly refillId = signal<string | null>(null);
  readonly refillSaving = signal(false);
  refillAmount: number | null = null;
  selectedStudioId = '';

  readonly lowCount = computed(() =>
    this.stocks().filter(s => {
      const pct = this.levelPercent(s);
      return pct >= 20 && pct <= 50;
    }).length
  );

  readonly criticalCount = computed(() =>
    this.stocks().filter(s => this.levelPercent(s) < 20).length
  );

  readonly forecastCriticalDays = computed(() => {
    const allDays = this.forecasts()
      .flatMap(f => f.supplies)
      .filter(s => s.days_remaining != null && s.status !== 'ok')
      .map(s => s.days_remaining!);
    return allDays.length > 0 ? Math.min(...allDays) : '—';
  });

  ngOnInit(): void {
    this.loadStudios();
    this.reload();
  }

  reload(): void {
    this.loading.set(true);
    const studioId = this.selectedStudioId || undefined;

    this.api.getConsumableStock().subscribe({
      next: stocks => {
        this.stocks.set(studioId ? stocks.filter(s => s.station_id === studioId) : stocks);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });

    this.api.getConsumableAlerts().subscribe({
      next: alerts => this.alerts.set(alerts),
    });

    this.api.getConsumableTransactions(undefined, 20).subscribe({
      next: txs => this.transactions.set(txs),
    });

    this.api.getConsumableForecast(studioId).subscribe({
      next: fc => this.forecasts.set(fc),
    });
  }

  private loadStudios(): void {
    this.http.get<{ studios?: Studio[]; data?: Studio[] }>('/api/studios').subscribe({
      next: res => this.studios.set(res.studios ?? res.data ?? []),
    });
  }

  levelPercent(item: ConsumableStock): number {
    if (!item.max_capacity || item.max_capacity <= 0) return 100;
    return Math.round((item.current_amount / item.max_capacity) * 100);
  }

  levelStatus(item: ConsumableStock): 'ok' | 'low' | 'critical' {
    const pct = this.levelPercent(item);
    if (pct < 20) return 'critical';
    if (pct <= 50) return 'low';
    return 'ok';
  }

  levelStatusLabel(item: ConsumableStock): string {
    const status = this.levelStatus(item);
    if (status === 'critical') return 'Критический';
    if (status === 'low') return 'Низкий';
    return 'Норма';
  }

  consumableCategory(type: string): string {
    const lower = type.toLowerCase();
    if (lower.includes('ink') || lower.includes('чернил')) return 'ink';
    if (lower.includes('toner') || lower.includes('тонер')) return 'toner';
    if (lower.includes('paper') || lower.includes('бумаг') || lower.includes('фотобумаг')) return 'paper';
    return 'other';
  }

  consumableCategoryLabel(type: string): string {
    const cat = this.consumableCategory(type);
    if (cat === 'ink') return 'Чернила';
    if (cat === 'toner') return 'Тонер';
    if (cat === 'paper') return 'Бумага';
    return 'Прочее';
  }

  mapColor(color: string): string {
    const map: Record<string, string> = {
      cyan: '#06b6d4', magenta: '#ec4899', yellow: '#eab308', black: '#374151',
      red: '#ef4444', blue: '#3b82f6', green: '#22c55e', none: 'transparent',
    };
    return map[color.toLowerCase()] ?? '#9ca3af';
  }

  startRefill(id: string): void {
    this.refillId.set(id);
    this.refillAmount = null;
  }

  submitRefill(id: string): void {
    if (!this.refillAmount || this.refillAmount <= 0) return;
    this.refillSaving.set(true);

    this.api.refillConsumable(id, { amount: this.refillAmount }).subscribe({
      next: updated => {
        this.stocks.update(list => list.map(s => s.id === id ? updated : s));
        this.refillId.set(null);
        this.refillAmount = null;
        this.refillSaving.set(false);
        // Refresh alerts and transactions
        this.api.getConsumableAlerts().subscribe({ next: a => this.alerts.set(a) });
        this.api.getConsumableTransactions(undefined, 20).subscribe({ next: t => this.transactions.set(t) });
      },
      error: () => this.refillSaving.set(false),
    });
  }
}
