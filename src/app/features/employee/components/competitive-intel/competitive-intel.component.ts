import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  CompetitiveIntelApiService,
  CompetitorPrice,
  CompetitorSummary,
  PriceAlert,
  ScrapeLog,
} from '../../services/competitive-intel-api.service';

const SERVICE_CATEGORIES = [
  { key: 'photo_documents', label: 'Фото на документы' },
  { key: 'portrait', label: 'Портрет' },
  { key: 'photo_children', label: 'Детская съёмка' },
  { key: 'photosession', label: 'Фотосессия' },
  { key: 'retouch', label: 'Ретушь' },
  { key: 'restoration', label: 'Реставрация' },
  { key: 'print', label: 'Печать' },
  { key: 'copy', label: 'Копирование' },
  { key: 'polygraphy', label: 'Полиграфия' },
  { key: 'print_large', label: 'Широкоформат' },
  { key: 'souvenirs', label: 'Сувениры' },
  { key: 'other', label: 'Другое' },
] as const;

interface PriceRow {
  service: string;
  category: string;
  competitors: Record<string, { price: number | null; text: string; verified: boolean; scraped_at: string }>;
}

@Component({
  selector: 'app-competitive-intel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule, DatePipe, MatTabsModule, MatCardModule, MatButtonModule,
    MatIconModule, MatChipsModule, MatBadgeModule, MatProgressSpinnerModule,
    MatButtonToggleModule, MatTooltipModule,
  ],
  template: `
    <div class="ci-page">
      <div class="ci-header">
        <h2>Competitive Intelligence</h2>
        <div class="ci-actions">
          @if (scraping()) {
            <mat-spinner diameter="20" />
          }
          <button mat-stroked-button (click)="onImportMarkdown()" [disabled]="scraping()">
            <mat-icon>upload_file</mat-icon> Импорт MD
          </button>
          <button mat-flat-button color="primary" (click)="onScrapeAll()" [disabled]="scraping()">
            <mat-icon>refresh</mat-icon> Обновить все
          </button>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="summary-grid">
        @for (s of summaries(); track s.competitor_slug) {
          <mat-card class="summary-card" appearance="outlined">
            <div class="summary-name">{{ s.competitor_name }}</div>
            <div class="summary-count">{{ s.total_prices }} услуг</div>
            <div class="summary-meta">
              @if (s.last_scraped) {
                Обновлено {{ s.last_scraped | date:'dd.MM HH:mm' }}
              } @else {
                <span class="no-data">Нет данных</span>
              }
            </div>
            <button mat-icon-button class="scrape-btn"
                    [matTooltip]="'Парсить ' + s.competitor_name"
                    (click)="onScrapeOne('web-' + s.competitor_slug.replace('competitor-', ''))">
              <mat-icon>sync</mat-icon>
            </button>
          </mat-card>
        }
      </div>

      <mat-tab-group animationDuration="200ms">
        <!-- Tab 1: Prices -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">table_chart</mat-icon> Цены
          </ng-template>

          <div class="tab-content">
            <!-- Category filter -->
            <mat-button-toggle-group [value]="selectedCategory()" (change)="selectedCategory.set($event.value)" class="category-filter">
              <mat-button-toggle value="">Все</mat-button-toggle>
              @for (cat of categories; track cat.key) {
                <mat-button-toggle [value]="cat.key">{{ cat.label }}</mat-button-toggle>
              }
            </mat-button-toggle-group>

            @if (loadingPrices()) {
              <div class="loading-state"><mat-spinner diameter="40" /><p>Загрузка цен...</p></div>
            } @else if (priceRows().length === 0) {
              <div class="empty-state">
                <mat-icon>price_check</mat-icon>
                <p>Нет данных о ценах. Нажмите «Обновить все» или «Импорт MD».</p>
              </div>
            } @else {
              <div class="price-table-wrap">
                <table class="price-table">
                  <thead>
                    <tr>
                      <th class="col-service">Услуга</th>
                      <th class="col-category">Категория</th>
                      @for (name of competitorNames(); track name) {
                        <th class="col-price">{{ name }}</th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of priceRows(); track row.service) {
                      <tr>
                        <td class="col-service">{{ row.service }}</td>
                        <td class="col-category">
                          <span class="cat-chip">{{ categoryLabel(row.category) }}</span>
                        </td>
                        @for (name of competitorNames(); track name) {
                          <td class="col-price" [class.verified]="row.competitors[name]?.verified">
                            @if (row.competitors[name]; as c) {
                              <span class="price-value" [matTooltip]="c.text">
                                {{ c.price !== null ? (c.price + ' ₽') : c.text }}
                              </span>
                              @if (c.verified) {
                                <mat-icon class="verified-icon" matTooltip="Проверено">verified</mat-icon>
                              }
                            } @else {
                              <span class="no-data">—</span>
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </mat-tab>

        <!-- Tab 2: Alerts -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">notifications</mat-icon> Оповещения
            @if (unreadCount() > 0) {
              <span class="alert-badge">{{ unreadCount() }}</span>
            }
          </ng-template>

          <div class="tab-content">
            <div class="alerts-header">
              <mat-button-toggle-group [value]="alertFilter()" (change)="alertFilter.set($event.value)">
                <mat-button-toggle value="">Все</mat-button-toggle>
                <mat-button-toggle value="critical">Критические</mat-button-toggle>
                <mat-button-toggle value="warning">Важные</mat-button-toggle>
                <mat-button-toggle value="info">Инфо</mat-button-toggle>
              </mat-button-toggle-group>
              @if (alerts().length > 0) {
                <button mat-stroked-button (click)="onMarkAllRead()">
                  <mat-icon>done_all</mat-icon> Прочитать все
                </button>
              }
            </div>

            @if (alerts().length === 0) {
              <div class="empty-state">
                <mat-icon>check_circle</mat-icon>
                <p>Нет оповещений</p>
              </div>
            } @else {
              <div class="alerts-list">
                @for (alert of filteredAlerts(); track alert.id) {
                  <div class="alert-item" [class]="'severity-' + alert.severity" [class.unread]="!alert.is_read">
                    <div class="alert-icon">
                      <mat-icon>{{ alertIcon(alert) }}</mat-icon>
                    </div>
                    <div class="alert-body">
                      <div class="alert-title">{{ alert.title }}</div>
                      @if (alert.description) {
                        <div class="alert-desc">{{ alert.description }}</div>
                      }
                      <div class="alert-meta">
                        <span class="severity-label">{{ alert.severity }}</span>
                        · {{ alert.competitor_name }}
                        · {{ alert.created_at | date:'dd.MM.yy HH:mm' }}
                      </div>
                    </div>
                    @if (!alert.is_read) {
                      <button mat-icon-button (click)="onMarkRead(alert.id)" matTooltip="Прочитано">
                        <mat-icon>check</mat-icon>
                      </button>
                    }
                  </div>
                }
              </div>
            }
          </div>
        </mat-tab>

        <!-- Tab 3: Logs -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon class="tab-icon">history</mat-icon> Логи
          </ng-template>

          <div class="tab-content">
            @if (scrapeLogs().length === 0) {
              <div class="empty-state">
                <mat-icon>search_off</mat-icon>
                <p>Нет логов скрейпинга</p>
              </div>
            } @else {
              <div class="logs-list">
                @for (log of scrapeLogs(); track log.id) {
                  <div class="log-item" [class]="'log-' + log.status">
                    <div class="log-status">
                      <mat-icon>{{ log.status === 'success' ? 'check_circle' : log.status === 'partial' ? 'warning' : 'error' }}</mat-icon>
                    </div>
                    <div class="log-body">
                      <div class="log-source">{{ log.source_slug }}</div>
                      <div class="log-stats">
                        {{ log.pages_scraped }} стр · {{ log.items_found }} элементов · {{ log.prices_saved }} цен
                        @if (log.duration_ms) { · {{ log.duration_ms }}ms }
                      </div>
                      <div class="log-meta">
                        {{ log.created_at | date:'dd.MM.yy HH:mm' }}
                        @if (log.chrome_used) { · Chrome }
                        @if (log.reqwest_used) { · HTTP }
                      </div>
                    </div>
                  </div>
                }
              </div>
            }
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .ci-page { max-width: 1200px; margin: 0 auto; padding: 16px; }

    .ci-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 16px; flex-wrap: wrap; gap: 12px;

      h2 { font-size: 20px; font-weight: 600; margin: 0; color: var(--crm-text-primary); }
    }

    .ci-actions { display: flex; align-items: center; gap: 8px; }

    /* Summary cards */
    .summary-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px; margin-bottom: 20px;
    }

    .summary-card {
      padding: 16px; position: relative;

      .summary-name { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }
      .summary-count { font-size: 24px; font-weight: 700; margin: 4px 0; color: var(--crm-accent); }
      .summary-meta { font-size: 12px; color: var(--crm-text-secondary); }
      .scrape-btn { position: absolute; top: 8px; right: 8px; }
    }

    .tab-icon { margin-right: 6px; font-size: 18px; width: 18px; height: 18px; }

    .tab-content { padding: 16px 0; }

    /* Category filter */
    .category-filter {
      margin-bottom: 16px; flex-wrap: wrap;

      ::ng-deep .mat-button-toggle-label-content { font-size: 12px; padding: 0 10px; }
    }

    /* Price table */
    .price-table-wrap { overflow-x: auto; }

    .price-table {
      width: 100%; border-collapse: collapse; font-size: 13px;

      th {
        text-align: left; padding: 8px 10px; font-weight: 600; font-size: 12px;
        border-bottom: 2px solid var(--crm-border); white-space: nowrap;
        color: var(--crm-text-secondary);
      }

      td {
        padding: 8px 10px; border-bottom: 1px solid var(--crm-border);
        vertical-align: middle;
      }

      tr:hover { background: var(--crm-hover); }

      .col-service { min-width: 180px; font-weight: 500; color: var(--crm-text-primary); }
      .col-category { min-width: 100px; }
      .col-price { min-width: 90px; text-align: right; }

      .price-value { font-weight: 500; }
      .verified-icon { font-size: 14px; width: 14px; height: 14px; color: #2e7d32; vertical-align: middle; margin-left: 2px; }

      .cat-chip {
        font-size: 11px; padding: 2px 8px; border-radius: 10px;
        background: var(--crm-hover); color: var(--crm-text-secondary);
      }
    }

    .no-data { color: var(--crm-text-secondary); font-style: italic; }

    /* Alerts */
    .alerts-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }

    .alert-badge {
      background: #c62828; color: white; border-radius: 10px;
      font-size: 11px; padding: 1px 6px; margin-left: 6px; font-weight: 600;
    }

    .alerts-list { display: flex; flex-direction: column; gap: 8px; }

    .alert-item {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px; border-radius: 8px; border: 1px solid var(--crm-border);
      transition: background 0.15s;

      &.unread { background: rgba(33, 150, 243, 0.04); border-color: var(--crm-accent); }
      &:hover { background: var(--crm-hover); }

      .alert-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
      &.severity-critical .alert-icon { color: #c62828; }
      &.severity-warning .alert-icon { color: #f57c00; }
      &.severity-info .alert-icon { color: #1976d2; }

      .alert-body { flex: 1; min-width: 0; }
      .alert-title { font-size: 14px; font-weight: 500; color: var(--crm-text-primary); }
      .alert-desc { font-size: 13px; color: var(--crm-text-secondary); margin-top: 2px; }
      .alert-meta { font-size: 12px; color: var(--crm-text-secondary); margin-top: 4px; }

      .severity-label { font-weight: 600; text-transform: uppercase; font-size: 11px; }
    }

    /* Logs */
    .logs-list { display: flex; flex-direction: column; gap: 6px; }

    .log-item {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 10px; border-radius: 6px; border: 1px solid var(--crm-border);

      .log-status mat-icon { font-size: 20px; width: 20px; height: 20px; }
      &.log-success .log-status { color: #2e7d32; }
      &.log-partial .log-status { color: #f57c00; }
      &.log-failed .log-status { color: #c62828; }

      .log-body { flex: 1; }
      .log-source { font-size: 14px; font-weight: 500; color: var(--crm-text-primary); }
      .log-stats { font-size: 13px; color: var(--crm-text-secondary); margin-top: 2px; }
      .log-meta { font-size: 12px; color: var(--crm-text-secondary); margin-top: 2px; }
    }

    /* Loading / empty */
    .loading-state, .empty-state {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
      p { font-size: 16px; margin: 12px 0 0; }
    }
  `],
})
export class CompetitiveIntelComponent implements OnInit {
  private readonly api = inject(CompetitiveIntelApiService);

  readonly categories = SERVICE_CATEGORIES;
  readonly selectedCategory = signal('');
  readonly alertFilter = signal('');

  readonly loadingPrices = signal(false);
  readonly scraping = signal(false);

  readonly prices = signal<CompetitorPrice[]>([]);
  readonly summaries = signal<CompetitorSummary[]>([]);
  readonly alerts = signal<PriceAlert[]>([]);
  readonly scrapeLogs = signal<ScrapeLog[]>([]);
  readonly unreadCount = signal(0);

  readonly competitorNames = computed(() => {
    const names = new Set<string>();
    for (const p of this.prices()) {
      names.add(p.competitor_name);
    }
    return [...names].sort();
  });

  readonly priceRows = computed(() => {
    const cat = this.selectedCategory();
    const filtered = cat
      ? this.prices().filter(p => p.service_category === cat)
      : this.prices();

    const rowMap = new Map<string, PriceRow>();
    for (const p of filtered) {
      let row = rowMap.get(p.service_name);
      if (!row) {
        row = { service: p.service_name, category: p.service_category, competitors: {} };
        rowMap.set(p.service_name, row);
      }
      row.competitors[p.competitor_name] = {
        price: p.price_min,
        text: p.price_text,
        verified: p.verified,
        scraped_at: p.scraped_at,
      };
    }

    return [...rowMap.values()].sort((a, b) => a.category.localeCompare(b.category) || a.service.localeCompare(b.service));
  });

  readonly filteredAlerts = computed(() => {
    const f = this.alertFilter();
    return f ? this.alerts().filter(a => a.severity === f) : this.alerts();
  });

  ngOnInit(): void {
    this.loadAll();
  }

  loadAll(): void {
    this.loadPrices();
    this.loadSummary();
    this.loadAlerts();
    this.loadLogs();
    this.loadUnreadCount();
  }

  private loadPrices(): void {
    this.loadingPrices.set(true);
    this.api.getAllPrices().subscribe({
      next: data => { this.prices.set(data); this.loadingPrices.set(false); },
      error: () => this.loadingPrices.set(false),
    });
  }

  private loadSummary(): void {
    this.api.getSummary().subscribe(data => this.summaries.set(data));
  }

  private loadAlerts(): void {
    this.api.getAlerts().subscribe(data => this.alerts.set(data));
  }

  private loadLogs(): void {
    this.api.getScrapeLogs().subscribe(data => this.scrapeLogs.set(data));
  }

  private loadUnreadCount(): void {
    this.api.getUnreadAlertCount().subscribe(data => this.unreadCount.set(data.count));
  }

  categoryLabel(key: string): string {
    return SERVICE_CATEGORIES.find(c => c.key === key)?.label ?? key;
  }

  alertIcon(alert: PriceAlert): string {
    switch (alert.alert_type) {
      case 'price_increase': return 'trending_up';
      case 'price_decrease': return 'trending_down';
      case 'new_service': return 'add_circle';
      case 'removed_service': return 'remove_circle';
      default: return 'info';
    }
  }

  onScrapeAll(): void {
    this.scraping.set(true);
    this.api.triggerScrapeAll().subscribe({
      next: () => {
        // Scrape runs async on backend; poll after 30s for results
        setTimeout(() => { this.loadAll(); this.scraping.set(false); }, 30000);
      },
      error: () => this.scraping.set(false),
    });
  }

  onScrapeOne(sourceSlug: string): void {
    this.scraping.set(true);
    this.api.triggerScrape(sourceSlug).subscribe({
      next: () => { this.loadAll(); this.scraping.set(false); },
      error: () => this.scraping.set(false),
    });
  }

  onImportMarkdown(): void {
    this.scraping.set(true);
    this.api.importMarkdown().subscribe({
      next: () => { this.loadAll(); this.scraping.set(false); },
      error: () => this.scraping.set(false),
    });
  }

  onMarkRead(id: string): void {
    this.api.markAlertRead(id).subscribe(() => {
      this.alerts.update(all => all.map(a => a.id === id ? { ...a, is_read: true } : a));
      this.unreadCount.update(c => Math.max(0, c - 1));
    });
  }

  onMarkAllRead(): void {
    this.api.markAllAlertsRead().subscribe(() => {
      this.alerts.update(all => all.map(a => ({ ...a, is_read: true })));
      this.unreadCount.set(0);
    });
  }
}
