import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import {
  AnalyticsApiService,
  FunnelData, CohortData, RetentionData, ChannelData,
} from '../../services/analytics-api.service';

type ActiveTab = 'funnel' | 'cohorts' | 'retention' | 'channels';
type FunnelType = 'online' | 'studio';
type GroupBy = 'week' | 'month';

const CHANNEL_LABELS: Record<string, string> = {
  web:      'Сайт',
  telegram: 'Telegram',
  max:      'VK МАКС',
  online:   'Онлайн',
  studio:   'Студия',
  unknown:  'Другое',
};

const CHANNEL_ICONS: Record<string, string> = {
  web:      'language',
  telegram: 'send',
  max:      'chat',
  online:   'devices',
  studio:   'photo_camera',
  unknown:  'help_outline',
};

const RATE_COLOR = (rate: number): string => {
  if (rate >= 60) return 'var(--crm-success, #22c55e)';
  if (rate >= 30) return 'var(--crm-warning, #f59e0b)';
  return 'var(--crm-error, #ef4444)';
};

@Component({
  selector: 'app-analytics-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    MatButtonToggleModule,
    MatProgressSpinnerModule,
    MatIconModule,
  ],
  template: `
<div class="adash">
  <!-- Header -->
  <div class="adash-header">
    <div class="adash-title">
      <mat-icon>waterfall_chart</mat-icon>
      <h2>Расширенная аналитика</h2>
    </div>
    <mat-button-toggle-group [value]="globalPeriod()" (change)="globalPeriod.set($event.value)" class="period-toggle">
      <mat-button-toggle value="7d">7 дней</mat-button-toggle>
      <mat-button-toggle value="30d">30 дней</mat-button-toggle>
      <mat-button-toggle value="90d">90 дней</mat-button-toggle>
    </mat-button-toggle-group>
  </div>

  <!-- Tabs -->
  <div class="adash-tabs">
    @for (tab of tabs; track tab.id) {
      <button class="tab-btn" [class.active]="activeTab() === tab.id" (click)="setTab(tab.id)">
        <mat-icon>{{ tab.icon }}</mat-icon>
        {{ tab.label }}
      </button>
    }
  </div>

  <!-- ═══ ВОРОНКИ ════════════════════════════════════════════ -->
  @if (activeTab() === 'funnel') {
    <div class="section">
      <div class="section-controls">
        <mat-button-toggle-group [value]="funnelType()" (change)="funnelType.set($event.value)">
          <mat-button-toggle value="online">
            <mat-icon>devices</mat-icon> Онлайн
          </mat-button-toggle>
          <mat-button-toggle value="studio">
            <mat-icon>photo_camera</mat-icon> Студия
          </mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      @if (funnelLoading()) {
        <div class="spinner-wrap"><mat-spinner diameter="36" /></div>
      } @else if (funnelData()) {
        <div class="funnel-wrap">
          <!-- SVG Funnel Chart -->
          <svg class="funnel-svg" [attr.viewBox]="'0 0 440 ' + funnelSvgHeight()" xmlns="http://www.w3.org/2000/svg">
            @for (step of funnelSteps(); track step.step.id; let i = $index) {
              <!-- Трапеция -->
              <polygon
                [attr.points]="step.points"
                [attr.fill]="step.color"
                [attr.opacity]="step.opacity"
              />
              <!-- Разделитель -->
              @if (i < funnelSteps().length - 1) {
                <line
                  [attr.x1]="step.rightX" [attr.y1]="step.bottomY"
                  [attr.x2]="step.leftX"  [attr.y2]="step.bottomY"
                  stroke="var(--crm-border)" stroke-width="1"
                />
              }
              <!-- Метка: номер + название -->
              <text
                [attr.x]="220"
                [attr.y]="step.labelY"
                text-anchor="middle"
                font-size="13"
                font-weight="500"
                fill="var(--crm-text-primary)"
              >{{ step.step.label }}</text>
              <!-- Значение -->
              <text
                [attr.x]="220"
                [attr.y]="step.labelY + 18"
                text-anchor="middle"
                font-size="12"
                fill="var(--crm-text-secondary)"
              >{{ step.step.value | number }}</text>
              <!-- Конверсия (со 2-го шага) -->
              @if (i > 0) {
                <text
                  [attr.x]="step.rateX"
                  [attr.y]="step.rateY"
                  text-anchor="start"
                  font-size="11"
                  [attr.fill]="rateColor(step.rate)"
                >↓ {{ step.rate }}%</text>
              }
            }
          </svg>

          <!-- Сводная таблица шагов -->
          <div class="funnel-table">
            @for (step of funnelSteps(); track step.step.id; let i = $index) {
              <div class="funnel-row">
                <span class="step-dot" [style.background]="step.color"></span>
                <span class="step-label">{{ step.step.label }}</span>
                <span class="step-val">{{ step.step.value | number }}</span>
                @if (i > 0) {
                  <span class="step-rate" [style.color]="rateColor(step.rate)">{{ step.rate }}%</span>
                } @else {
                  <span class="step-rate">—</span>
                }
              </div>
            }
          </div>
        </div>

        <!-- Итоговая конверсия -->
        <div class="summary-row">
          <div class="summary-card">
            <span class="s-label">Общая конверсия</span>
            <span class="s-value" [style.color]="rateColor(totalConversion())">
              {{ totalConversion() }}%
            </span>
          </div>
          <div class="summary-card">
            <span class="s-label">Всего на входе</span>
            <span class="s-value">{{ funnelData()!.steps[0].value | number }}</span>
          </div>
          <div class="summary-card">
            <span class="s-label">Конверт. клиентов</span>
            <span class="s-value">{{ funnelData()!.steps[funnelData()!.steps.length - 1].value | number }}</span>
          </div>
        </div>
      } @else {
        <div class="empty-state">
          <mat-icon>waterfall_chart</mat-icon>
          <p>Нет данных для воронки за выбранный период</p>
        </div>
      }
    </div>
  }

  <!-- ═══ КОГОРТЫ ════════════════════════════════════════════ -->
  @if (activeTab() === 'cohorts') {
    <div class="section">
      <div class="section-controls">
        <mat-button-toggle-group [value]="cohortGroupBy()" (change)="cohortGroupBy.set($event.value)">
          <mat-button-toggle value="month">По месяцу</mat-button-toggle>
          <mat-button-toggle value="week">По неделе</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      @if (cohortLoading()) {
        <div class="spinner-wrap"><mat-spinner diameter="36" /></div>
      } @else if (cohortData() && cohortData()!.cohorts.length > 0) {
        <div class="cohort-wrap">
          <p class="cohort-hint">
            Показывает, сколько клиентов из каждой когорты вернулись повторно. % от размера когорты.
          </p>
          <div class="cohort-table-scroll">
            <table class="cohort-table">
              <thead>
                <tr>
                  <th>Когорта</th>
                  <th>Клиентов</th>
                  @for (p of maxOffsets(); track p) {
                    <th>{{ cohortGroupBy() === 'month' ? 'Мес. +' + p : 'Нед. +' + p }}</th>
                  }
                </tr>
              </thead>
              <tbody>
                @for (row of cohortData()!.cohorts; track row.cohort) {
                  <tr>
                    <td class="cohort-label">{{ formatCohortLabel(row.cohort) }}</td>
                    <td class="cohort-size">{{ row.cohortSize }}</td>
                    @for (offset of maxOffsets(); track offset) {
                      <td>
                        @let period = getPeriodByOffset(row, offset);
                        @if (period) {
                          <span
                            class="cohort-cell"
                            [style.background]="cohortCellBg(period.rate)"
                            [style.color]="period.rate > 40 ? '#fff' : 'var(--crm-text-primary)'"
                          >{{ period.rate }}%</span>
                        } @else if (offset === 0) {
                          <span class="cohort-cell cohort-base">100%</span>
                        } @else {
                          <span class="cohort-cell cohort-na">—</span>
                        }
                      </td>
                    }
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      } @else {
        <div class="empty-state">
          <mat-icon>grid_view</mat-icon>
          <p>Нет данных когортного анализа.<br>Нужно больше повторных заказов.</p>
        </div>
      }
    </div>
  }

  <!-- ═══ УДЕРЖАНИЕ ══════════════════════════════════════════ -->
  @if (activeTab() === 'retention') {
    <div class="section">
      @if (retentionLoading()) {
        <div class="spinner-wrap"><mat-spinner diameter="36" /></div>
      } @else if (retentionData()) {
        <div class="retention-wrap">
          <!-- KPI cards -->
          <div class="kpi-row">
            <div class="kpi-card">
              <mat-icon>people</mat-icon>
              <span class="kpi-val">{{ retentionData()!.totalCustomers }}</span>
              <span class="kpi-lbl">Уникальных покупателей</span>
            </div>
            <div class="kpi-card">
              <mat-icon>forum</mat-icon>
              <span class="kpi-val" [style.color]="rateColor(retentionData()!.chatToOrderRate)">
                {{ retentionData()!.chatToOrderRate }}%
              </span>
              <span class="kpi-lbl">Чат → Заказ</span>
            </div>
          </div>

          <!-- Retention bars -->
          <h3 class="section-h3">Повторные обращения</h3>
          @if (retentionData()!.totalCustomers > 0) {
            <div class="retention-bars">
              @for (bucket of retentionData()!.retention; track bucket.period) {
                <div class="ret-bar-wrap">
                  <div class="ret-bar-label">{{ bucket.period }}</div>
                  <div class="ret-bar-track">
                    <div
                      class="ret-bar-fill"
                      [style.width.%]="bucket.rate"
                      [style.background]="rateColor(bucket.rate)"
                    ></div>
                  </div>
                  <div class="ret-bar-meta">
                    <span class="ret-val">{{ bucket.returned }} чел.</span>
                    <span class="ret-rate" [style.color]="rateColor(bucket.rate)">{{ bucket.rate }}%</span>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="empty-state small">
              <p>Недостаточно данных для анализа retention.<br>Нужны повторные покупатели.</p>
            </div>
          }
        </div>
      } @else {
        <div class="empty-state">
          <mat-icon>loop</mat-icon>
          <p>Нет данных об удержании за выбранный период</p>
        </div>
      }
    </div>
  }

  <!-- ═══ КАНАЛЫ ════════════════════════════════════════════ -->
  @if (activeTab() === 'channels') {
    <div class="section">
      @if (channelsLoading()) {
        <div class="spinner-wrap"><mat-spinner diameter="36" /></div>
      } @else if (channelData()) {
        <div class="channels-wrap">
          <!-- POS итого -->
          @if (channelData()!.posTotal.receipts > 0) {
            <div class="pos-summary">
              <mat-icon>point_of_sale</mat-icon>
              <span>POS (офлайн): {{ channelData()!.posTotal.receipts }} чеков ·
                {{ channelData()!.posTotal.revenue | number:'1.0-0' }} ₽</span>
            </div>
          }

          <!-- Онлайн каналы -->
          <h3 class="section-h3">Онлайн-каналы</h3>
          @if (channelData()!.onlineChannels.length > 0) {
            <div class="channel-grid">
              @for (ch of channelData()!.onlineChannels; track ch.channel) {
                <div class="ch-card">
                  <div class="ch-icon-wrap">
                    <mat-icon>{{ channelIcon(ch.channel) }}</mat-icon>
                  </div>
                  <div class="ch-info">
                    <div class="ch-name">{{ channelLabel(ch.channel) }}</div>
                    <div class="ch-stats">
                      <span>{{ ch.sessions }} сессий</span>
                      @if (ch.orders > 0) {
                        <span>· {{ ch.orders }} заказов</span>
                      }
                    </div>
                  </div>
                  <div class="ch-right">
                    @if (ch.revenue > 0) {
                      <div class="ch-revenue">{{ ch.revenue | number:'1.0-0' }} ₽</div>
                    }
                    <div class="ch-conv" [style.color]="rateColor(ch.conversionRate)">
                      {{ ch.conversionRate }}% конв.
                    </div>
                    @if (ch.avgCsat !== null) {
                      <div class="ch-csat">CSAT {{ ch.avgCsat }}/5</div>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Мини-бар чарт по выручке -->
            @if (totalOnlineRevenue() > 0) {
              <h3 class="section-h3" style="margin-top:24px">Распределение выручки</h3>
              <div class="revenue-bars">
                @for (ch of channelData()!.onlineChannels; track ch.channel) {
                  @if (ch.revenue > 0) {
                    <div class="rev-bar-row">
                      <span class="rev-ch-label">{{ channelLabel(ch.channel) }}</span>
                      <div class="rev-bar-track">
                        <div
                          class="rev-bar-fill"
                          [style.width.%]="(ch.revenue / totalOnlineRevenue()) * 100"
                        ></div>
                      </div>
                      <span class="rev-amount">{{ ch.revenue | number:'1.0-0' }} ₽</span>
                    </div>
                  }
                }
              </div>
            }
          } @else {
            <div class="empty-state small">
              <p>Нет данных по онлайн-каналам за период</p>
            </div>
          }
        </div>
      } @else {
        <div class="empty-state">
          <mat-icon>bar_chart</mat-icon>
          <p>Нет данных по каналам за выбранный период</p>
        </div>
      }
    </div>
  }
</div>
  `,
  styles: [`
    .adash {
      padding: 16px;
      min-height: 100vh;
      background: var(--crm-bg);
      color: var(--crm-text-primary);
      font-family: var(--crm-font-sans, Inter, sans-serif);
    }

    .adash-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }

    .adash-title {
      display: flex;
      align-items: center;
      gap: 8px;
      mat-icon { color: var(--crm-accent); font-size: 22px; }
      h2 { margin: 0; font-size: 18px; font-weight: 600; color: var(--crm-text-primary); }
    }

    /* Tabs */
    .adash-tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--crm-border);
      margin-bottom: 20px;
      overflow-x: auto;
    }

    .tab-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--crm-text-secondary);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      transition: color 0.15s, border-color 0.15s;
      mat-icon { font-size: 16px; height: 16px; width: 16px; }
    }

    .tab-btn.active {
      color: var(--crm-accent);
      border-bottom-color: var(--crm-accent);
    }

    .tab-btn:hover:not(.active) { color: var(--crm-text-primary); }

    /* Section */
    .section { }
    .section-controls { margin-bottom: 20px; }

    .spinner-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 200px;
    }

    /* ── Funnel ── */
    .funnel-wrap {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 24px;
      align-items: start;
      margin-bottom: 20px;
    }

    @media (max-width: 600px) {
      .funnel-wrap { grid-template-columns: 1fr; }
    }

    .funnel-svg {
      width: 100%;
      max-width: 440px;
    }

    .funnel-table {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .funnel-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      background: var(--crm-surface);
      border-radius: 6px;
      border: 1px solid var(--crm-border);
    }

    .step-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .step-label {
      flex: 1;
      font-size: 13px;
      color: var(--crm-text-primary);
    }

    .step-val {
      font-size: 15px;
      font-weight: 600;
      color: var(--crm-text-primary);
      min-width: 40px;
      text-align: right;
    }

    .step-rate {
      font-size: 12px;
      font-weight: 500;
      min-width: 40px;
      text-align: right;
    }

    /* Summary cards */
    .summary-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .summary-card {
      flex: 1;
      min-width: 120px;
      padding: 16px;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .s-label {
      font-size: 11px;
      color: var(--crm-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .s-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--crm-text-primary);
    }

    /* ── Cohorts ── */
    .cohort-hint {
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin: 0 0 12px;
    }

    .cohort-table-scroll { overflow-x: auto; }

    .cohort-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    .cohort-table th {
      padding: 8px 10px;
      text-align: center;
      font-weight: 500;
      color: var(--crm-text-secondary);
      border-bottom: 1px solid var(--crm-border);
      white-space: nowrap;
    }

    .cohort-table td {
      padding: 6px 8px;
      text-align: center;
      border-bottom: 1px solid color-mix(in srgb, var(--crm-border) 50%, transparent);
    }

    .cohort-label {
      text-align: left !important;
      font-weight: 500;
      color: var(--crm-text-primary);
      white-space: nowrap;
    }

    .cohort-size {
      font-weight: 600;
      color: var(--crm-accent);
    }

    .cohort-cell {
      display: inline-block;
      padding: 3px 7px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }

    .cohort-base { background: var(--crm-accent); color: #fff !important; }
    .cohort-na   { color: var(--crm-text-secondary); }

    /* ── Retention ── */
    .kpi-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 24px;
    }

    .kpi-card {
      flex: 1;
      min-width: 130px;
      padding: 16px;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      mat-icon { color: var(--crm-accent); font-size: 28px; height: 28px; width: 28px; }
    }

    .kpi-val {
      font-size: 26px;
      font-weight: 700;
      color: var(--crm-text-primary);
    }

    .kpi-lbl {
      font-size: 11px;
      color: var(--crm-text-secondary);
      text-align: center;
    }

    .section-h3 {
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-secondary);
      margin: 0 0 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .retention-bars {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .ret-bar-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .ret-bar-label {
      font-size: 13px;
      color: var(--crm-text-secondary);
      min-width: 100px;
    }

    .ret-bar-track {
      flex: 1;
      height: 10px;
      background: color-mix(in srgb, var(--crm-border) 60%, transparent);
      border-radius: 5px;
      overflow: hidden;
    }

    .ret-bar-fill {
      height: 100%;
      border-radius: 5px;
      transition: width 0.4s ease;
    }

    .ret-bar-meta {
      display: flex;
      gap: 8px;
      min-width: 110px;
      justify-content: flex-end;
    }

    .ret-val { font-size: 13px; color: var(--crm-text-secondary); }
    .ret-rate { font-size: 13px; font-weight: 600; }

    /* ── Channels ── */
    .pos-summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: color-mix(in srgb, var(--crm-accent) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--crm-accent) 30%, transparent);
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 14px;
      color: var(--crm-text-primary);
      mat-icon { color: var(--crm-accent); font-size: 18px; }
    }

    .channel-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ch-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: var(--crm-surface);
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      transition: border-color 0.15s;
    }

    .ch-card:hover { border-color: var(--crm-accent); }

    .ch-icon-wrap {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      mat-icon { color: var(--crm-accent); font-size: 18px; }
    }

    .ch-info { flex: 1; }
    .ch-name { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }
    .ch-stats { font-size: 12px; color: var(--crm-text-secondary); margin-top: 2px; }

    .ch-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }

    .ch-revenue { font-size: 16px; font-weight: 700; color: var(--crm-text-primary); }
    .ch-conv    { font-size: 12px; font-weight: 500; }
    .ch-csat    { font-size: 11px; color: var(--crm-text-secondary); }

    .revenue-bars { display: flex; flex-direction: column; gap: 10px; }

    .rev-bar-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .rev-ch-label { font-size: 13px; color: var(--crm-text-secondary); min-width: 80px; }

    .rev-bar-track {
      flex: 1;
      height: 8px;
      background: color-mix(in srgb, var(--crm-border) 60%, transparent);
      border-radius: 4px;
      overflow: hidden;
    }

    .rev-bar-fill {
      height: 100%;
      border-radius: 4px;
      background: var(--crm-accent);
      transition: width 0.4s ease;
    }

    .rev-amount {
      font-size: 13px;
      font-weight: 500;
      color: var(--crm-text-primary);
      min-width: 70px;
      text-align: right;
    }

    /* Empty state */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 60px 20px;
      color: var(--crm-text-secondary);
      text-align: center;
      mat-icon { font-size: 48px; height: 48px; width: 48px; opacity: 0.4; }
      p { margin: 0; font-size: 14px; line-height: 1.5; }
    }

    .empty-state.small { padding: 24px; }

    /* Period toggle */
    .period-toggle { --mdc-outlined-text-field-outline-color: var(--crm-border); }
  `],
})
export class AnalyticsDashboardComponent implements OnInit {
  private analytics = inject(AnalyticsApiService);

  tabs = [
    { id: 'funnel'    as ActiveTab, label: 'Воронки',   icon: 'waterfall_chart' },
    { id: 'cohorts'   as ActiveTab, label: 'Когорты',   icon: 'grid_view'       },
    { id: 'retention' as ActiveTab, label: 'Удержание', icon: 'loop'            },
    { id: 'channels'  as ActiveTab, label: 'Каналы',    icon: 'bar_chart'       },
  ];

  activeTab   = signal<ActiveTab>('funnel');
  globalPeriod = signal('30d');
  funnelType  = signal<FunnelType>('online');
  cohortGroupBy = signal<GroupBy>('month');

  funnelData    = signal<FunnelData    | null>(null);
  cohortData    = signal<CohortData    | null>(null);
  retentionData = signal<RetentionData | null>(null);
  channelData   = signal<ChannelData   | null>(null);

  funnelLoading    = signal(false);
  cohortLoading    = signal(false);
  retentionLoading = signal(false);
  channelsLoading  = signal(false);

  // ── Computed: funnel SVG ─────────────────────────────────

  funnelSteps = computed(() => {
    const data = this.funnelData();
    if (!data || !data.steps.length) return [];

    const maxVal  = data.steps[0].value || 1;
    const stepH   = 90;
    const minW    = 60;
    const maxW    = 380;
    const colors  = ['#6366f1', '#7c3aed', '#a855f7', '#c084fc'];

    return data.steps.map((step, i) => {
      const ratio     = maxVal > 0 ? step.value / maxVal : 0;
      const topW      = i === 0 ? maxW : maxW * (data.steps[i - 1].value / maxVal || 0);
      const botW      = maxW * ratio;

      const topLeft   = 220 - topW / 2;
      const topRight  = 220 + topW / 2;
      const botLeft   = Math.max(220 - Math.max(botW, minW) / 2, 0);
      const botRight  = Math.min(220 + Math.max(botW, minW) / 2, 440);

      const topY      = i * stepH;
      const botY      = topY + stepH;
      const labelY    = topY + stepH / 2 - 6;
      const prevVal   = i > 0 ? data.steps[i - 1].value : 0;
      const rate      = i > 0 && prevVal > 0
        ? Math.round((step.value / prevVal) * 100)
        : 100;

      return {
        step,
        points: `${topLeft},${topY} ${topRight},${topY} ${botRight},${botY} ${botLeft},${botY}`,
        color:   colors[i] || '#6366f1',
        opacity: 0.8 - i * 0.08,
        leftX:   botLeft,
        rightX:  botRight,
        bottomY: botY,
        labelY,
        rateX:   botRight + 8,
        rateY:   topY + stepH / 2,
        rate,
      };
    });
  });

  funnelSvgHeight = computed(() => {
    const n = this.funnelData()?.steps.length || 4;
    return n * 90;
  });

  totalConversion = computed(() => {
    const steps = this.funnelData()?.steps;
    if (!steps || steps.length < 2) return 0;
    const first = steps[0].value;
    const last  = steps[steps.length - 1].value;
    return first > 0 ? Math.round((last / first) * 100) : 0;
  });

  totalOnlineRevenue = computed(() => {
    return this.channelData()?.onlineChannels.reduce((s, c) => s + c.revenue, 0) || 0;
  });

  maxOffsets = computed((): number[] => {
    const cohorts = this.cohortData()?.cohorts;
    if (!cohorts?.length) return [];
    const max = Math.max(...cohorts.flatMap(c => c.periods.map(p => p.offset)));
    return Array.from({ length: max + 1 }, (_, i) => i);
  });

  ngOnInit(): void {
    this.loadFunnel();
    // Загружаем остальные данные отложенно при переключении вкладок
  }

  setTab(tab: ActiveTab): void {
    this.activeTab.set(tab);
    if (tab === 'funnel'    && !this.funnelData())    this.loadFunnel();
    if (tab === 'cohorts'   && !this.cohortData())    this.loadCohorts();
    if (tab === 'retention' && !this.retentionData()) this.loadRetention();
    if (tab === 'channels'  && !this.channelData())   this.loadChannels();
  }

  // Переключение периода → сбросить кэш
  private periodWatcher = (() => {
    let prev = this.globalPeriod();
    setInterval(() => {
      const cur = this.globalPeriod();
      if (cur !== prev) {
        prev = cur;
        this.funnelData.set(null);
        this.cohortData.set(null);
        this.retentionData.set(null);
        this.channelData.set(null);
        this.loadByTab(this.activeTab());
      }
    }, 100);
  })();

  private loadByTab(tab: ActiveTab): void {
    if (tab === 'funnel')    this.loadFunnel();
    if (tab === 'cohorts')   this.loadCohorts();
    if (tab === 'retention') this.loadRetention();
    if (tab === 'channels')  this.loadChannels();
  }

  private loadFunnel(): void {
    this.funnelLoading.set(true);
    this.analytics.getFunnel(this.funnelType(), this.globalPeriod()).subscribe({
      next:  d => { this.funnelData.set(d); this.funnelLoading.set(false); },
      error: () => this.funnelLoading.set(false),
    });

    // Перезагрузить при смене типа воронки
    const prevType = this.funnelType();
    const check = setInterval(() => {
      if (this.funnelType() !== prevType) {
        clearInterval(check);
        this.funnelData.set(null);
        this.loadFunnel();
      }
    }, 100);
  }

  private loadCohorts(): void {
    this.cohortLoading.set(true);
    this.analytics.getCohorts(this.cohortGroupBy(), this.globalPeriod() === '7d' ? '90d' : this.globalPeriod()).subscribe({
      next:  d => { this.cohortData.set(d); this.cohortLoading.set(false); },
      error: () => this.cohortLoading.set(false),
    });
  }

  private loadRetention(): void {
    this.retentionLoading.set(true);
    this.analytics.getRetention(this.globalPeriod() === '7d' ? '30d' : this.globalPeriod()).subscribe({
      next:  d => { this.retentionData.set(d); this.retentionLoading.set(false); },
      error: () => this.retentionLoading.set(false),
    });
  }

  private loadChannels(): void {
    this.channelsLoading.set(true);
    this.analytics.getChannels(this.globalPeriod()).subscribe({
      next:  d => { this.channelData.set(d); this.channelsLoading.set(false); },
      error: () => this.channelsLoading.set(false),
    });
  }

  // ── Helpers ──────────────────────────────────────────────

  rateColor(rate: number): string { return RATE_COLOR(rate); }
  channelLabel(ch: string):  string { return CHANNEL_LABELS[ch] ?? ch; }
  channelIcon(ch: string):   string { return CHANNEL_ICONS[ch] ?? 'language'; }

  formatCohortLabel(cohort: string): string {
    const d = new Date(cohort);
    return d.toLocaleDateString('ru-RU', { month: 'short', year: '2-digit' });
  }

  getPeriodByOffset(row: { periods: { offset: number; retained: number; rate: number }[] }, offset: number) {
    return row.periods.find(p => p.offset === offset) ?? null;
  }

  cohortCellBg(rate: number): string {
    if (rate === 0) return 'transparent';
    const alpha = Math.min(rate / 100, 1);
    return `rgba(99, 102, 241, ${alpha * 0.7})`;
  }
}
