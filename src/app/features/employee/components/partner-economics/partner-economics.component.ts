import {
  Component, inject, signal, computed, effect, ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DecimalPipe, CurrencyPipe } from '@angular/common';
import { PricingApiService, PricingCategory } from '../../../../core/services/pricing-api.service';

// ============================================================================
// Типы
// ============================================================================

export interface CategoryInput {
  slug: string;
  name: string;
  avgPrice: number;
  costPercent: number;
  monthlySales: number;
  enabled: boolean;
}

interface PerSaleBreakdown {
  revenue: number;
  commission: number;
  cogs: number;
  grossProfit: number;
  margin: number;
}

interface CommissionRow {
  rate: number;
  grossProfit: number;
  margin: number;
  breakEven: number;
  monthlyProfit1: number;
  monthlyProfit5: number;
  monthlyProfit10: number;
}

interface ScalingRow {
  partners: number;
  monthlySales: number;
  revenue: number;
  commission: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
  roi: number;
  marginPct: number;
}

// Дефолтная себестоимость по категориям (% от цены)
const DEFAULT_COST_PERCENTS: Record<string, number> = {
  'photo-docs':    15,
  'neuro-photo':   25,
  'photo-restore': 20,
  'photo-print':   50,
  'scan-copy':     30,
  'souvenirs':     55,
  'design':        15,
};

// Дефолтный объём продаж по категориям / мес
const DEFAULT_MONTHLY_SALES: Record<string, number> = {
  'photo-docs':    80,
  'neuro-photo':   15,
  'photo-restore': 10,
  'photo-print':   20,
  'scan-copy':     30,
  'souvenirs':     8,
  'design':        5,
};

type ScenarioTab = 'commission' | 'scaling' | 'comparison';

// ============================================================================
// Компонент
// ============================================================================

@Component({
  selector: 'app-partner-economics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, MatIconModule, DecimalPipe, CurrencyPipe],
  template: `
<div class="pe-page">

  <!-- Header -->
  <div class="pe-header">
    <div class="pe-header-left">
      <a routerLink="/employee/partners" class="btn-icon" title="Назад к партнёрам">
        <mat-icon>arrow_back</mat-icon>
      </a>
      <div>
        <h2 class="pe-title">Экономика партнёрской программы</h2>
        <p class="pe-subtitle">Калькулятор маржи и точки безубыточности</p>
      </div>
    </div>
    <button class="btn-print" (click)="print()">
      <mat-icon>print</mat-icon> Печать
    </button>
  </div>

  <!-- KPI Cards -->
  <div class="kpi-row">
    <div class="kpi-card" [class.kpi-card--positive]="kpi().netProfit > 0" [class.kpi-card--negative]="kpi().netProfit <= 0">
      <div class="kpi-val">{{ kpi().netProfit | currency:'RUB':'symbol-narrow':'1.0-0' }}</div>
      <div class="kpi-label">Чистая прибыль / мес</div>
      <div class="kpi-sub">(1 партнёр)</div>
    </div>
    <div class="kpi-card" [class.kpi-card--positive]="kpi().margin > 15">
      <div class="kpi-val">{{ kpi().margin | number:'1.1-1' }}%</div>
      <div class="kpi-label">Маржа</div>
      <div class="kpi-sub">после комиссии и COGS</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-val">{{ kpi().breakEven }}</div>
      <div class="kpi-label">Break-even</div>
      <div class="kpi-sub">продаж / мес</div>
    </div>
    <div class="kpi-card" [class.kpi-card--positive]="kpi().roi > 50">
      <div class="kpi-val">{{ kpi().roi | number:'1.0-0' }}%</div>
      <div class="kpi-label">ROI</div>
      <div class="kpi-sub">при 1 партнёре</div>
    </div>
  </div>

  <!-- Параметры модели -->
  <div class="pe-section no-print">
    <h3 class="section-title">
      <mat-icon>tune</mat-icon> Параметры модели
    </h3>
    <div class="params-grid">
      <div class="param-row">
        <span class="param-label" aria-label="Комиссия партнёрам">Комиссия партнёрам</span>
        <div class="param-slider-row">
          <input type="range" min="5" max="50" step="1"
            [value]="commissionRate()"
            (input)="commissionRate.set(+$any($event.target).value)"
            class="slider" />
          <span class="param-val accent">{{ commissionRate() }}%</span>
        </div>
      </div>
      <div class="param-row">
        <span class="param-label" aria-label="Фикс. затраты">Фикс. затраты (аренда, ЗП)</span>
        <div class="param-input-row">
          <input type="number" min="0" step="1000"
            [value]="monthlyFixedCosts()"
            (input)="monthlyFixedCosts.set(+$any($event.target).value)"
            class="param-input" />
          <span class="param-suffix">₽/мес</span>
        </div>
      </div>
      <div class="param-row">
        <span class="param-label" aria-label="Продаж на 1 партнёра в месяц">Продаж на 1 партнёра / мес</span>
        <div class="param-input-row">
          <input type="number" min="1" step="1"
            [value]="salesPerPartner()"
            (input)="salesPerPartner.set(+$any($event.target).value)"
            class="param-input" />
          <span class="param-suffix">продаж</span>
        </div>
      </div>
      <div class="param-row">
        <span class="param-label" aria-label="Маркетинг (прямые продажи)">Маркетинг (прямые продажи)</span>
        <div class="param-input-row">
          <input type="number" min="0" step="1000"
            [value]="directMarketingBudget()"
            (input)="directMarketingBudget.set(+$any($event.target).value)"
            class="param-input" />
          <span class="param-suffix">₽/мес</span>
        </div>
      </div>
      <div class="param-row">
        <span class="param-label" aria-label="Прямые продажи в месяц">Прямые продажи / мес</span>
        <div class="param-input-row">
          <input type="number" min="1" step="1"
            [value]="directMonthlySales()"
            (input)="directMonthlySales.set(+$any($event.target).value)"
            class="param-input" />
          <span class="param-suffix">шт</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Категории услуг -->
  <div class="pe-section">
    <h3 class="section-title">
      <mat-icon>category</mat-icon> Категории услуг
      @if (pricingApi.loading()) {
        <span class="loading-badge">загрузка…</span>
      }
    </h3>
    @if (categoryInputs().length > 0) {
      <div class="cat-table-wrap">
        <table class="cat-table">
          <thead>
            <tr>
              <th>Категория</th>
              <th>Ср. цена</th>
              <th>Себест. %</th>
              <th>Продаж/мес</th>
              <th>Выручка/мес</th>
              <th class="no-print">Включить</th>
            </tr>
          </thead>
          <tbody>
            @for (cat of categoryInputs(); track cat.slug) {
              <tr [class.cat-row--disabled]="!cat.enabled">
                <td class="cat-name">{{ cat.name }}</td>
                <td>
                  <input type="number" min="0" step="10"
                    [value]="cat.avgPrice"
                    (input)="updateCategory(cat.slug, 'avgPrice', +$any($event.target).value)"
                    class="cat-input" />
                  <span class="cat-suffix">₽</span>
                </td>
                <td>
                  <input type="number" min="0" max="100" step="1"
                    [value]="cat.costPercent"
                    (input)="updateCategory(cat.slug, 'costPercent', +$any($event.target).value)"
                    class="cat-input cat-input--sm" />
                  <span class="cat-suffix">%</span>
                </td>
                <td>
                  <input type="number" min="0" step="1"
                    [value]="cat.monthlySales"
                    (input)="updateCategory(cat.slug, 'monthlySales', +$any($event.target).value)"
                    class="cat-input cat-input--sm" />
                  <span class="cat-suffix">шт</span>
                </td>
                <td class="cat-revenue">
                  {{ cat.avgPrice * cat.monthlySales | currency:'RUB':'symbol-narrow':'1.0-0' }}
                </td>
                <td class="no-print">
                  <label class="toggle-wrap">
                    <input type="checkbox" [checked]="cat.enabled"
                      (change)="updateCategory(cat.slug, 'enabled', $any($event.target).checked)"
                      class="toggle-input" />
                    <span class="toggle-slider"></span>
                  </label>
                </td>
              </tr>
            }
          </tbody>
          <tfoot>
            <tr class="cat-total">
              <td><strong>Итого</strong></td>
              <td>{{ weightedAvgPrice() | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
              <td>{{ weightedCostPct() | number:'1.0-0' }}%</td>
              <td>{{ totalMonthlySales() }} шт</td>
              <td>{{ totalMonthlyRevenue() | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
              <td class="no-print"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    } @else if (!pricingApi.loading()) {
      <div class="cat-empty">
        <mat-icon>category</mat-icon>
        <p>Нет данных о категориях. Проверьте соединение с API.</p>
      </div>
    }
  </div>

  <!-- На 1 продажу -->
  <div class="pe-section">
    <h3 class="section-title">
      <mat-icon>receipt_long</mat-icon> Разбивка на 1 среднюю продажу
    </h3>
    <div class="breakdown-row">
      <div class="bkd-item">
        <div class="bkd-val">{{ perSale().revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</div>
        <div class="bkd-label">Выручка</div>
      </div>
      <div class="bkd-sep">−</div>
      <div class="bkd-item bkd-item--minus">
        <div class="bkd-val">{{ perSale().commission | currency:'RUB':'symbol-narrow':'1.0-0' }}</div>
        <div class="bkd-label">Комиссия ({{ commissionRate() }}%)</div>
      </div>
      <div class="bkd-sep">−</div>
      <div class="bkd-item bkd-item--minus">
        <div class="bkd-val">{{ perSale().cogs | currency:'RUB':'symbol-narrow':'1.0-0' }}</div>
        <div class="bkd-label">Себест. ({{ weightedCostPct() | number:'1.0-0' }}%)</div>
      </div>
      <div class="bkd-sep">=</div>
      <div class="bkd-item" [class.bkd-item--positive]="perSale().grossProfit > 0" [class.bkd-item--negative]="perSale().grossProfit <= 0">
        <div class="bkd-val">{{ perSale().grossProfit | currency:'RUB':'symbol-narrow':'1.0-0' }}</div>
        <div class="bkd-label">Валовая прибыль ({{ perSale().margin | number:'1.1-1' }}%)</div>
      </div>
    </div>
  </div>

  <!-- Сценарии -->
  <div class="scenario-tabs no-print">
    <button class="tab-btn" [class.tab-btn--active]="activeTab() === 'commission'" (click)="activeTab.set('commission')">
      <mat-icon>percent</mat-icon> Сравнение комиссий
    </button>
    <button class="tab-btn" [class.tab-btn--active]="activeTab() === 'scaling'" (click)="activeTab.set('scaling')">
      <mat-icon>trending_up</mat-icon> Масштабирование
    </button>
    <button class="tab-btn" [class.tab-btn--active]="activeTab() === 'comparison'" (click)="activeTab.set('comparison')">
      <mat-icon>compare_arrows</mat-icon> Прямые vs Партнёры
    </button>
  </div>

  <!-- Сравнение комиссий -->
  @if (activeTab() === 'commission') {
    <div class="pe-section print-section">
      <h3 class="section-title">
        <mat-icon>percent</mat-icon> Сравнение ставок комиссии
      </h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Ставка</th>
              <th>Вал. прибыль / сделка</th>
              <th>Маржа %</th>
              <th>Break-even</th>
              <th>Прибыль (1 партнёр)</th>
              <th>Прибыль (5 партнёров)</th>
              <th>Прибыль (10 партнёров)</th>
            </tr>
          </thead>
          <tbody>
            @for (row of commissionComparison(); track row.rate) {
              <tr [class.row--current]="row.rate === commissionRate()">
                <td class="cell-rate">
                  {{ row.rate }}%
                  @if (row.rate === commissionRate()) {
                    <span class="current-badge">текущая</span>
                  }
                </td>
                <td>{{ row.grossProfit | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
                <td [class.cell-pos]="row.margin > 15" [class.cell-neg]="row.margin <= 0">
                  {{ row.margin | number:'1.1-1' }}%
                </td>
                <td>{{ row.breakEven }} шт</td>
                <td [class.cell-pos]="row.monthlyProfit1 > 0" [class.cell-neg]="row.monthlyProfit1 <= 0">
                  {{ row.monthlyProfit1 | currency:'RUB':'symbol-narrow':'1.0-0' }}
                </td>
                <td [class.cell-pos]="row.monthlyProfit5 > 0" [class.cell-neg]="row.monthlyProfit5 <= 0">
                  {{ row.monthlyProfit5 | currency:'RUB':'symbol-narrow':'1.0-0' }}
                </td>
                <td [class.cell-pos]="row.monthlyProfit10 > 0" [class.cell-neg]="row.monthlyProfit10 <= 0">
                  {{ row.monthlyProfit10 | currency:'RUB':'symbol-narrow':'1.0-0' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="table-note">
        Расчёт на базе {{ totalMonthlySales() }} продаж/мес по включённым категориям.
        Фикс. затраты: {{ monthlyFixedCosts() | currency:'RUB':'symbol-narrow':'1.0-0' }}/мес.
      </p>
    </div>
  }

  <!-- Масштабирование -->
  @if (activeTab() === 'scaling') {
    <div class="pe-section print-section">
      <h3 class="section-title">
        <mat-icon>trending_up</mat-icon> Прогноз масштабирования
      </h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Партнёров</th>
              <th>Продаж/мес</th>
              <th>Выручка</th>
              <th>Комиссия</th>
              <th>COGS</th>
              <th>Вал. прибыль</th>
              <th>Чистая прибыль</th>
              <th>Маржа</th>
              <th>ROI</th>
            </tr>
          </thead>
          <tbody>
            @for (row of scalingProjection(); track row.partners) {
              <tr [class.row--current]="row.partners === 1">
                <td class="cell-partners">{{ row.partners }}</td>
                <td>{{ row.monthlySales }}</td>
                <td>{{ row.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
                <td>{{ row.commission | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
                <td>{{ row.cogs | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
                <td>{{ row.grossProfit | currency:'RUB':'symbol-narrow':'1.0-0' }}</td>
                <td [class.cell-pos]="row.netProfit > 0" [class.cell-neg]="row.netProfit <= 0">
                  {{ row.netProfit | currency:'RUB':'symbol-narrow':'1.0-0' }}
                </td>
                <td [class.cell-pos]="row.marginPct > 15" [class.cell-neg]="row.marginPct <= 0">
                  {{ row.marginPct | number:'1.1-1' }}%
                </td>
                <td [class.cell-pos]="row.roi > 50" [class.cell-neg]="row.roi <= 0">
                  {{ row.roi | number:'1.0-0' }}%
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="table-note">
        {{ salesPerPartner() }} продаж/партнёр/мес. Комиссия {{ commissionRate() }}%.
        Фикс. затраты фиксированы (не зависят от числа партнёров).
      </p>
    </div>
  }

  <!-- Прямые vs Партнёры -->
  @if (activeTab() === 'comparison') {
    <div class="pe-section print-section">
      <h3 class="section-title">
        <mat-icon>compare_arrows</mat-icon> Прямые продажи vs Партнёрский канал
      </h3>
      <div class="comparison-grid">
        <div class="cmp-card">
          <div class="cmp-header">
            <mat-icon>store</mat-icon>
            <span>Прямые продажи</span>
          </div>
          <div class="cmp-rows">
            <div class="cmp-row">
              <span class="cmp-key">Продаж / мес</span>
              <span class="cmp-val">{{ channelComparison().direct.sales }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Выручка</span>
              <span class="cmp-val">{{ channelComparison().direct.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">COGS</span>
              <span class="cmp-val minus">{{ channelComparison().direct.cogs | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Маркетинг</span>
              <span class="cmp-val minus">{{ channelComparison().direct.marketing | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Фикс. затраты</span>
              <span class="cmp-val minus">{{ channelComparison().direct.fixed | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row cmp-row--total">
              <span class="cmp-key">Чистая прибыль</span>
              <span class="cmp-val" [class.pos]="channelComparison().direct.netProfit > 0" [class.neg]="channelComparison().direct.netProfit <= 0">
                {{ channelComparison().direct.netProfit | currency:'RUB':'symbol-narrow':'1.0-0' }}
              </span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">CAC</span>
              <span class="cmp-val">{{ channelComparison().direct.cac | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Маржа</span>
              <span class="cmp-val" [class.pos]="channelComparison().direct.margin > 15">
                {{ channelComparison().direct.margin | number:'1.1-1' }}%
              </span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">ROI</span>
              <span class="cmp-val" [class.pos]="channelComparison().direct.roi > 50">
                {{ channelComparison().direct.roi | number:'1.0-0' }}%
              </span>
            </div>
          </div>
        </div>

        <div class="cmp-vs">vs</div>

        <div class="cmp-card cmp-card--accent">
          <div class="cmp-header">
            <mat-icon>handshake</mat-icon>
            <span>Партнёрский канал</span>
          </div>
          <div class="cmp-rows">
            <div class="cmp-row">
              <span class="cmp-key">Партнёров</span>
              <span class="cmp-val">{{ channelComparison().partner.partners }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Продаж / мес</span>
              <span class="cmp-val">{{ channelComparison().partner.sales }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Выручка</span>
              <span class="cmp-val">{{ channelComparison().partner.revenue | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">COGS</span>
              <span class="cmp-val minus">{{ channelComparison().partner.cogs | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Комиссия партнёрам</span>
              <span class="cmp-val minus">{{ channelComparison().partner.commission | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Фикс. затраты</span>
              <span class="cmp-val minus">{{ channelComparison().partner.fixed | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row cmp-row--total">
              <span class="cmp-key">Чистая прибыль</span>
              <span class="cmp-val" [class.pos]="channelComparison().partner.netProfit > 0" [class.neg]="channelComparison().partner.netProfit <= 0">
                {{ channelComparison().partner.netProfit | currency:'RUB':'symbol-narrow':'1.0-0' }}
              </span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">CAC</span>
              <span class="cmp-val pos">{{ channelComparison().partner.cac | currency:'RUB':'symbol-narrow':'1.0-0' }}</span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">Маржа</span>
              <span class="cmp-val" [class.pos]="channelComparison().partner.margin > 15">
                {{ channelComparison().partner.margin | number:'1.1-1' }}%
              </span>
            </div>
            <div class="cmp-row">
              <span class="cmp-key">ROI</span>
              <span class="cmp-val" [class.pos]="channelComparison().partner.roi > 50">
                {{ channelComparison().partner.roi | number:'1.0-0' }}%
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Вывод -->
      <div class="conclusion-box">
        <mat-icon>lightbulb</mat-icon>
        <div>
          @if (channelComparison().partner.netProfit > channelComparison().direct.netProfit) {
            <strong>Партнёрский канал выгоднее</strong> на
            {{ channelComparison().partner.netProfit - channelComparison().direct.netProfit | currency:'RUB':'symbol-narrow':'1.0-0' }} / мес.
            CAC = 0₽ (партнёр берёт маркетинг на себя).
          } @else {
            <strong>Прямые продажи выгоднее</strong> на
            {{ channelComparison().direct.netProfit - channelComparison().partner.netProfit | currency:'RUB':'symbol-narrow':'1.0-0' }} / мес.
            Рассмотрите снижение ставки комиссии или увеличение числа партнёров.
          }
        </div>
      </div>
    </div>
  }

</div>
  `,
  styles: [`
    .pe-page { max-width: 1040px; margin: 0 auto; padding: 16px; }

    /* Header */
    .pe-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px; gap: 12px; flex-wrap: wrap;
    }
    .pe-header-left { display: flex; align-items: center; gap: 12px; }
    .pe-title { font-size: 20px; font-weight: 700; color: var(--crm-text-primary); margin: 0; }
    .pe-subtitle { font-size: 13px; color: var(--crm-text-secondary); margin: 2px 0 0; }
    .btn-icon {
      display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-surface); color: var(--crm-text-secondary);
      text-decoration: none; cursor: pointer; flex-shrink: 0;
      &:hover { background: var(--crm-surface-hover); }
    }
    .btn-print {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-surface); color: var(--crm-text-secondary);
      cursor: pointer; font-size: 14px;
      &:hover { background: var(--crm-surface-hover); }
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    /* KPI Cards */
    .kpi-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
    .kpi-card {
      padding: 16px; border-radius: 10px; border: 1px solid var(--crm-border);
      background: var(--crm-surface); text-align: center;
    }
    .kpi-card--positive { border-color: rgba(16,185,129,0.4); background: rgba(16,185,129,0.04); }
    .kpi-card--negative { border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.04); }
    .kpi-val { font-size: 22px; font-weight: 700; color: var(--crm-text-primary); margin-bottom: 4px; }
    .kpi-label { font-size: 13px; color: var(--crm-text-secondary); margin-bottom: 2px; }
    .kpi-sub { font-size: 11px; color: var(--crm-text-muted, #9ca3af); }

    /* Section */
    .pe-section {
      border: 1px solid var(--crm-border); border-radius: 10px; padding: 16px;
      background: var(--crm-surface); margin-bottom: 16px;
    }
    .section-title {
      display: flex; align-items: center; gap: 8px;
      font-size: 15px; font-weight: 600; color: var(--crm-text-primary);
      margin: 0 0 14px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent); }
    }
    .loading-badge {
      font-size: 12px; font-weight: 400; color: var(--crm-accent);
      background: rgba(139,92,246,0.1); padding: 2px 8px; border-radius: 99px;
    }

    /* Params grid */
    .params-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
    .param-row { display: flex; flex-direction: column; gap: 6px; }
    .param-label { font-size: 13px; color: var(--crm-text-secondary); font-weight: 500; }
    .param-slider-row { display: flex; align-items: center; gap: 10px; }
    .param-input-row { display: flex; align-items: center; gap: 8px; }
    .slider {
      flex: 1; appearance: none; height: 4px; border-radius: 2px;
      background: var(--crm-border); outline: none; cursor: pointer;
      &::-webkit-slider-thumb {
        appearance: none; width: 16px; height: 16px; border-radius: 50%;
        background: var(--crm-accent); cursor: pointer;
      }
      &::-moz-range-thumb {
        width: 16px; height: 16px; border-radius: 50%;
        background: var(--crm-accent); cursor: pointer; border: none;
      }
    }
    .param-val { font-size: 16px; font-weight: 700; min-width: 44px; text-align: right; }
    .accent { color: var(--crm-accent); }
    .param-input {
      width: 100px; padding: 7px 10px; border-radius: 6px; border: 1px solid var(--crm-border);
      background: var(--crm-bg); color: var(--crm-text-primary); font-size: 14px; outline: none;
      &:focus { border-color: var(--crm-accent); }
    }
    .param-suffix { font-size: 13px; color: var(--crm-text-secondary); }

    /* Categories table */
    .cat-table-wrap { overflow-x: auto; }
    .cat-table {
      width: 100%; border-collapse: collapse; font-size: 14px;
      th {
        text-align: left; padding: 8px 10px; font-size: 12px; font-weight: 600;
        color: var(--crm-text-secondary); border-bottom: 1px solid var(--crm-border);
        white-space: nowrap;
      }
      td { padding: 8px 10px; border-bottom: 1px solid var(--crm-border); vertical-align: middle; }
      tbody tr:last-child td { border-bottom: none; }
      tfoot td { border-top: 2px solid var(--crm-border); font-weight: 600; padding: 10px; }
    }
    .cat-row--disabled { opacity: 0.4; }
    .cat-name { font-weight: 500; color: var(--crm-text-primary); }
    .cat-revenue { font-weight: 600; color: var(--crm-text-primary); white-space: nowrap; }
    .cat-total td { background: var(--crm-surface-hover); }
    .cat-input {
      width: 72px; padding: 5px 7px; border-radius: 5px; border: 1px solid var(--crm-border);
      background: var(--crm-bg); color: var(--crm-text-primary); font-size: 13px; outline: none;
      &:focus { border-color: var(--crm-accent); }
    }
    .cat-input--sm { width: 52px; }
    .cat-suffix { font-size: 12px; color: var(--crm-text-secondary); margin-left: 3px; }
    .cat-empty {
      text-align: center; padding: 40px; color: var(--crm-text-secondary);
      mat-icon { font-size: 40px; width: 40px; height: 40px; display: block; margin: 0 auto 12px; }
    }

    /* Toggle */
    .toggle-wrap { display: inline-flex; align-items: center; cursor: pointer; }
    .toggle-input { display: none; }
    .toggle-slider {
      width: 36px; height: 20px; border-radius: 10px; background: var(--crm-border);
      position: relative; transition: background 0.2s;
      &::after {
        content: ''; position: absolute; top: 3px; left: 3px;
        width: 14px; height: 14px; border-radius: 50%; background: #fff;
        transition: transform 0.2s;
      }
    }
    .toggle-input:checked + .toggle-slider { background: var(--crm-accent); }
    .toggle-input:checked + .toggle-slider::after { transform: translateX(16px); }

    /* Breakdown */
    .breakdown-row {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 12px 0;
    }
    .bkd-item { text-align: center; min-width: 120px; }
    .bkd-val { font-size: 20px; font-weight: 700; color: var(--crm-text-primary); }
    .bkd-label { font-size: 12px; color: var(--crm-text-secondary); margin-top: 3px; }
    .bkd-item--minus .bkd-val { color: #ef4444; }
    .bkd-item--positive .bkd-val { color: #10b981; }
    .bkd-item--negative .bkd-val { color: #ef4444; }
    .bkd-sep { font-size: 24px; color: var(--crm-text-secondary); font-weight: 300; }

    /* Scenario tabs */
    .scenario-tabs {
      display: flex; gap: 0; border-bottom: 1px solid var(--crm-border);
      margin-bottom: 16px; flex-wrap: wrap;
    }
    .tab-btn {
      display: flex; align-items: center; gap: 6px;
      padding: 10px 18px; border: none; background: transparent;
      color: var(--crm-text-secondary); cursor: pointer; font-size: 14px;
      border-bottom: 2px solid transparent; margin-bottom: -1px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &:hover { color: var(--crm-text-primary); }
    }
    .tab-btn--active { color: var(--crm-accent); border-bottom-color: var(--crm-accent); font-weight: 600; }

    /* Data tables */
    .table-wrap { overflow-x: auto; }
    .data-table {
      width: 100%; border-collapse: collapse; font-size: 13px;
      th {
        text-align: left; padding: 8px 10px; font-size: 12px; font-weight: 600;
        color: var(--crm-text-secondary); border-bottom: 1px solid var(--crm-border);
        white-space: nowrap; background: var(--crm-surface-hover);
      }
      td { padding: 8px 10px; border-bottom: 1px solid var(--crm-border); white-space: nowrap; }
      tbody tr:last-child td { border-bottom: none; }
      tbody tr:hover { background: var(--crm-surface-hover); }
    }
    .row--current { background: rgba(139,92,246,0.05) !important; }
    .cell-rate { font-weight: 600; }
    .cell-partners { font-weight: 700; font-size: 15px; }
    .current-badge {
      font-size: 10px; background: var(--crm-accent); color: #fff;
      padding: 1px 5px; border-radius: 99px; margin-left: 5px; vertical-align: middle;
    }
    .cell-pos { color: #10b981; font-weight: 600; }
    .cell-neg { color: #ef4444; font-weight: 600; }
    .table-note { font-size: 12px; color: var(--crm-text-secondary); margin: 10px 0 0; }

    /* Comparison */
    .comparison-grid {
      display: grid; grid-template-columns: 1fr auto 1fr; gap: 16px; align-items: start;
      margin-bottom: 16px;
    }
    .cmp-vs {
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: var(--crm-text-secondary);
      padding-top: 40px;
    }
    .cmp-card {
      border: 1px solid var(--crm-border); border-radius: 10px; overflow: hidden;
    }
    .cmp-card--accent { border-color: rgba(139,92,246,0.4); }
    .cmp-header {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 16px; background: var(--crm-surface-hover);
      font-size: 15px; font-weight: 600; color: var(--crm-text-primary);
      mat-icon { color: var(--crm-accent); }
    }
    .cmp-rows { padding: 4px 0; }
    .cmp-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px; border-bottom: 1px solid var(--crm-border);
      &:last-child { border-bottom: none; }
    }
    .cmp-row--total { background: var(--crm-surface-hover); }
    .cmp-key { font-size: 13px; color: var(--crm-text-secondary); }
    .cmp-val { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }
    .minus { color: #ef4444; }
    .pos { color: #10b981; }
    .neg { color: #ef4444; }

    .conclusion-box {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 14px 16px; border-radius: 8px;
      background: rgba(139,92,246,0.06); border: 1px solid rgba(139,92,246,0.2);
      font-size: 14px; color: var(--crm-text-primary); line-height: 1.5;
      mat-icon { color: var(--crm-accent); flex-shrink: 0; margin-top: 1px; }
    }

    /* Print */
    @media print {
      .no-print { display: none !important; }
      .pe-page { padding: 0; max-width: 100%; }
      .pe-section { border: 1px solid #e5e7eb; break-inside: avoid; }
      .kpi-val { font-size: 18px; }
      .comparison-grid { grid-template-columns: 1fr 30px 1fr; }
    }

    /* Responsive */
    @media (max-width: 768px) {
      .kpi-row { grid-template-columns: repeat(2, 1fr); }
      .comparison-grid { grid-template-columns: 1fr; }
      .cmp-vs { padding-top: 0; }
      .breakdown-row { justify-content: center; }
    }
    @media (max-width: 480px) {
      .kpi-row { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class PartnerEconomicsComponent {
  readonly pricingApi = inject(PricingApiService);

  // ── Входные параметры ──────────────────────────────────────────────────────
  readonly commissionRate = signal(20);
  readonly monthlyFixedCosts = signal(15000);
  readonly salesPerPartner = signal(8);
  readonly directMarketingBudget = signal(30000);
  readonly directMonthlySales = signal(50);
  readonly categoryInputs = signal<CategoryInput[]>([]);
  readonly activeTab = signal<ScenarioTab>('commission');

  constructor() {
    this.pricingApi.loadCategories();

    // Маппинг категорий из API → модель калькулятора
    effect(() => {
      const cats = this.pricingApi.categories();
      if (cats.length === 0) return;

      const inputs = cats.map((c: PricingCategory) => {
        const avgPrice = this._resolveAvgPrice(c);
        return {
          slug: c.slug,
          name: c.name,
          avgPrice,
          costPercent: DEFAULT_COST_PERCENTS[c.slug] ?? 30,
          monthlySales: DEFAULT_MONTHLY_SALES[c.slug] ?? 10,
          enabled: true,
        } satisfies CategoryInput;
      });
      this.categoryInputs.set(inputs);
    });
  }

  // ── Вспомогательные ───────────────────────────────────────────────────────

  private _resolveAvgPrice(cat: PricingCategory): number {
    const prices: number[] = [];
    for (const group of cat.optionGroups) {
      for (const opt of group.options) {
        const p = opt.price_studio ?? opt.base_price;
        if (p > 0) prices.push(p);
      }
    }
    if (prices.length === 0) return 500;
    return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  }

  updateCategory(slug: string, field: keyof CategoryInput, value: unknown): void {
    this.categoryInputs.update(cats =>
      cats.map(c => c.slug === slug ? { ...c, [field]: value } : c)
    );
  }

  print(): void {
    window.print();
  }

  // ── Computed: базовые агрегаты ─────────────────────────────────────────────

  readonly enabledCategories = computed(() =>
    this.categoryInputs().filter(c => c.enabled)
  );

  readonly totalMonthlySales = computed(() =>
    this.enabledCategories().reduce((s, c) => s + c.monthlySales, 0)
  );

  readonly totalMonthlyRevenue = computed(() =>
    this.enabledCategories().reduce((s, c) => s + c.avgPrice * c.monthlySales, 0)
  );

  readonly weightedAvgPrice = computed(() => {
    const cats = this.enabledCategories();
    const total = this.totalMonthlySales();
    if (total === 0) return 0;
    return Math.round(cats.reduce((s, c) => s + c.avgPrice * c.monthlySales, 0) / total);
  });

  readonly weightedCostPct = computed(() => {
    const cats = this.enabledCategories();
    const totalRev = this.totalMonthlyRevenue();
    if (totalRev === 0) return 30;
    return cats.reduce((s, c) => s + c.costPercent * c.avgPrice * c.monthlySales, 0) / totalRev;
  });

  // ── Computed: на 1 продажу ─────────────────────────────────────────────────

  readonly perSale = computed((): PerSaleBreakdown => {
    const revenue = this.weightedAvgPrice();
    const commission = revenue * this.commissionRate() / 100;
    const cogs = revenue * this.weightedCostPct() / 100;
    const grossProfit = revenue - commission - cogs;
    const margin = revenue > 0 ? grossProfit / revenue * 100 : 0;
    return { revenue, commission, cogs, grossProfit, margin };
  });

  // ── Computed: KPI ──────────────────────────────────────────────────────────

  readonly kpi = computed(() => {
    const { grossProfit } = this.perSale();
    const sales = this.salesPerPartner();
    const fixed = this.monthlyFixedCosts();
    const monthlyGross = grossProfit * sales;
    const netProfit = monthlyGross - fixed;
    const totalRevenue = this.weightedAvgPrice() * sales;
    const margin = totalRevenue > 0 ? netProfit / totalRevenue * 100 : 0;
    const totalCosts = this.perSale().commission * sales + this.perSale().cogs * sales + fixed;
    const roi = totalCosts > 0 ? netProfit / totalCosts * 100 : 0;
    const breakEven = grossProfit > 0 ? Math.ceil(fixed / grossProfit) : 9999;
    return { netProfit, margin, breakEven, roi };
  });

  // ── Computed: Сравнение комиссий ──────────────────────────────────────────

  readonly commissionComparison = computed((): CommissionRow[] => {
    const avgPrice = this.weightedAvgPrice();
    const costPct = this.weightedCostPct();
    const sales = this.salesPerPartner();
    const fixed = this.monthlyFixedCosts();
    const rates = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50];

    return rates.map(rate => {
      const commission = avgPrice * rate / 100;
      const cogs = avgPrice * costPct / 100;
      const grossProfit = avgPrice - commission - cogs;
      const margin = avgPrice > 0 ? grossProfit / avgPrice * 100 : 0;
      const breakEven = grossProfit > 0 ? Math.ceil(fixed / grossProfit) : 9999;
      const calcProfit = (partners: number) =>
        grossProfit * sales * partners - fixed;
      return {
        rate,
        grossProfit: Math.round(grossProfit),
        margin,
        breakEven,
        monthlyProfit1: Math.round(calcProfit(1)),
        monthlyProfit5: Math.round(calcProfit(5)),
        monthlyProfit10: Math.round(calcProfit(10)),
      };
    });
  });

  // ── Computed: Масштабирование ─────────────────────────────────────────────

  readonly scalingProjection = computed((): ScalingRow[] => {
    const avgPrice = this.weightedAvgPrice();
    const costPct = this.weightedCostPct();
    const commPct = this.commissionRate();
    const sales = this.salesPerPartner();
    const fixed = this.monthlyFixedCosts();
    const partnerCounts = [1, 2, 5, 10, 25, 50];

    return partnerCounts.map(partners => {
      const monthlySales = partners * sales;
      const revenue = avgPrice * monthlySales;
      const commission = revenue * commPct / 100;
      const cogs = revenue * costPct / 100;
      const grossProfit = revenue - commission - cogs;
      const netProfit = grossProfit - fixed;
      const totalCosts = commission + cogs + fixed;
      const roi = totalCosts > 0 ? netProfit / totalCosts * 100 : 0;
      const marginPct = revenue > 0 ? netProfit / revenue * 100 : 0;
      return {
        partners, monthlySales, revenue: Math.round(revenue),
        commission: Math.round(commission), cogs: Math.round(cogs),
        grossProfit: Math.round(grossProfit), netProfit: Math.round(netProfit),
        roi, marginPct,
      };
    });
  });

  // ── Computed: Сравнение каналов ───────────────────────────────────────────

  readonly channelComparison = computed(() => {
    const avgPrice = this.weightedAvgPrice();
    const costPct = this.weightedCostPct();

    // Прямые продажи
    const dSales = this.directMonthlySales();
    const dRevenue = avgPrice * dSales;
    const dCogs = dRevenue * costPct / 100;
    const dMarketing = this.directMarketingBudget();
    const dFixed = this.monthlyFixedCosts();
    const dNetProfit = dRevenue - dCogs - dMarketing - dFixed;
    const dTotalCosts = dCogs + dMarketing + dFixed;
    const dROI = dTotalCosts > 0 ? dNetProfit / dTotalCosts * 100 : 0;
    const dMargin = dRevenue > 0 ? dNetProfit / dRevenue * 100 : 0;
    const dCAC = dSales > 0 ? dMarketing / dSales : 0;

    // Партнёрский канал (те же продажи через 1 партнёра)
    const pPartners = Math.ceil(dSales / Math.max(this.salesPerPartner(), 1));
    const pSales = pPartners * this.salesPerPartner();
    const pRevenue = avgPrice * pSales;
    const pCommission = pRevenue * this.commissionRate() / 100;
    const pCogs = pRevenue * costPct / 100;
    const pFixed = this.monthlyFixedCosts();
    const pNetProfit = pRevenue - pCommission - pCogs - pFixed;
    const pTotalCosts = pCommission + pCogs + pFixed;
    const pROI = pTotalCosts > 0 ? pNetProfit / pTotalCosts * 100 : 0;
    const pMargin = pRevenue > 0 ? pNetProfit / pRevenue * 100 : 0;

    return {
      direct: {
        sales: dSales, revenue: Math.round(dRevenue), cogs: Math.round(dCogs),
        marketing: Math.round(dMarketing), fixed: Math.round(dFixed),
        netProfit: Math.round(dNetProfit), roi: dROI, margin: dMargin, cac: Math.round(dCAC),
      },
      partner: {
        partners: pPartners, sales: pSales, revenue: Math.round(pRevenue),
        commission: Math.round(pCommission), cogs: Math.round(pCogs),
        fixed: Math.round(pFixed), netProfit: Math.round(pNetProfit),
        roi: pROI, margin: pMargin, cac: 0,
      },
    };
  });
}
