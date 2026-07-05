import {
  Component, inject, signal, computed,
  ChangeDetectionStrategy, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { rxResource } from '@angular/core/rxjs-interop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSidenavModule } from '@angular/material/sidenav';

import {
  RegistrationsApiService,
  RegistrationStatsData,
  RegistrationSummary,
  RecentRegistration,
  RecentRegistrationsData,
  FunnelData,
  RegFilters,
} from '../../services/registrations-api.service';

import { KpiRowComponent } from './kpi-row.component';
import { FilterStripComponent } from './filter-strip.component';
import { UserTableComponent } from './user-table.component';
import { UserDrawerComponent } from './user-drawer.component';
import { formatShortDate } from './reg-helpers';

const EMPTY_FILTERS: RegFilters = {
  role: null,
  provider: null,
  search: null,
  verified: null,
  hasOrder: null,
};

@Component({
  selector: 'app-registrations-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonToggleModule, MatCardModule, MatIconModule,
    MatProgressSpinnerModule, MatSidenavModule,
    KpiRowComponent, FilterStripComponent, UserTableComponent, UserDrawerComponent,
  ],
  template: `
    <mat-sidenav-container class="reg-shell" [hasBackdrop]="true">
      <mat-sidenav
        #drawer
        mode="over"
        position="end"
        [opened]="!!selectedUser()"
        (closedStart)="selectedUser.set(null)"
        class="reg-drawer"
      >
        @if (selectedUser(); as u) {
          <app-reg-user-drawer [user]="u" (closed)="selectedUser.set(null)" />
        }
      </mat-sidenav>

      <mat-sidenav-content>
        <div class="reg-dash">
          <header class="reg-header">
            <div class="reg-title">
              <mat-icon>person_add</mat-icon>
              <h2>Регистрации пользователей</h2>
            </div>
            <mat-button-toggle-group
              [value]="period()"
              (change)="changePeriod($event.value)"
              aria-label="Период"
            >
              <mat-button-toggle value="7d">7 дней</mat-button-toggle>
              <mat-button-toggle value="30d">30 дней</mat-button-toggle>
              <mat-button-toggle value="90d">90 дней</mat-button-toggle>
            </mat-button-toggle-group>
          </header>

          @if (stats(); as s) {
            <app-reg-kpi-row [summary]="s.summary" />

            <div class="grid-cards">
              @if (funnel(); as f) {
                <mat-card appearance="outlined" class="card funnel-card">
                  <h3 class="section-title">Воронка конверсии</h3>
                  @if (f.stages.length === 0) {
                    <p class="empty">Данных пока нет.</p>
                  } @else {
                    <div class="stages">
                      @for (stage of f.stages; track stage.key) {
                        <div class="stage">
                          <span class="stage-label">{{ stage.label }}</span>
                          <div class="stage-bar-wrap">
                            <div class="stage-bar" [style.width.%]="stage.pct"></div>
                          </div>
                          <span class="stage-count">{{ stage.count }} ({{ stage.pct }}%)</span>
                        </div>
                      }
                    </div>
                  }
                </mat-card>
              }

              <mat-card appearance="outlined" class="card providers-card">
                <h3 class="section-title">По способу входа</h3>
                <div class="phone-metric">
                  <mat-icon>phone</mat-icon>
                  <span class="pm-label">С номером телефона</span>
                  <div class="pr-bar-wrap">
                    <div class="pr-bar pr-bar-phone" [style.width.%]="phonePct()"></div>
                  </div>
                  <span class="pm-count">{{ s.summary.hasPhone }} ({{ phonePct() }}%)</span>
                </div>

                <div class="provider-rows">
                  @for (prov of providerRows(); track prov.key) {
                    <div class="provider-row">
                      <mat-icon>{{ prov.icon }}</mat-icon>
                      <span class="pr-label">{{ prov.label }}</span>
                      <div class="pr-bar-wrap">
                        <div class="pr-bar {{ prov.barClass }}" [style.width.%]="providerPct(prov.count)"></div>
                      </div>
                      <span class="pr-count">{{ prov.count }}</span>
                    </div>
                  }
                </div>
              </mat-card>
            </div>

            @if (chartDays().length) {
              <mat-card appearance="outlined" class="card chart-card">
                <h3 class="section-title">Регистрации по дням</h3>
                <div class="bar-chart">
                  @for (day of chartDays(); track day.day) {
                    <div class="bar-col">
                      <span class="bar-count">{{ day.count || '' }}</span>
                      <div class="bar-wrap">
                        <div
                          class="bar"
                          [style.height.%]="barHeight(day.count)"
                          [class.bar-empty]="day.count === 0"
                        ></div>
                      </div>
                      <span class="bar-label">{{ shortDate(day.day) }}</span>
                    </div>
                  }
                </div>
              </mat-card>
            }

            <app-reg-filter-strip
              [filters]="filters()"
              [totalCount]="recentTotal()"
              (filtersChange)="onFiltersChange($event)"
            />

            <app-reg-user-table
              [rows]="recentRows()"
              [loading]="recentLoading()"
              [page]="page()"
              [pageSize]="pageSize()"
              [total]="recentTotal()"
              (rowClick)="selectedUser.set($event)"
              (pageChange)="page.set($event)"
              (pageSizeChange)="onPageSizeChange($event)"
            />
          } @else if (statsLoading()) {
            <div class="loading"><mat-spinner diameter="32" /></div>
          } @else if (statsError()) {
            <div class="error-state">
              <mat-icon>error_outline</mat-icon>
              <p>Не удалось загрузить статистику. Попробуйте обновить страницу.</p>
            </div>
          }
        </div>
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    :host { display: block; }

    .reg-shell {
      background: transparent;
      min-height: 100%;
    }
    .reg-drawer {
      width: 420px;
      max-width: 90vw;
      border-left: 1px solid var(--mat-sys-outline-variant);
    }

    .reg-dash {
      max-width: 960px;
      margin: 0 auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Header */
    .reg-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .reg-title {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .reg-title mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--mat-sys-primary);
    }
    .reg-title h2 {
      font-size: 20px;
      font-weight: 600;
      margin: 0;
      color: var(--mat-sys-on-surface);
    }

    .loading {
      display: flex;
      justify-content: center;
      padding: 48px;
    }
    .error-state {
      text-align: center;
      padding: 48px 16px;
      color: var(--mat-sys-on-surface-variant);
    }
    .error-state mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: var(--mat-sys-error, #EF4444);
    }

    /* Cards grid: funnel + providers */
    .grid-cards {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }
    @media (min-width: 720px) {
      .grid-cards { grid-template-columns: 1fr 1fr; }
    }
    .card {
      padding: 16px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin: 0 0 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .empty {
      margin: 0;
      font-size: 13px;
      color: var(--mat-sys-on-surface-variant);
    }

    /* Funnel */
    .stages {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .stage {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .stage-label {
      font-size: 13px;
      color: var(--mat-sys-on-surface);
      flex-shrink: 0;
      min-width: 130px;
    }
    .stage-bar-wrap {
      flex: 1;
      height: 8px;
      background: var(--mat-sys-surface-variant);
      border-radius: 4px;
      overflow: hidden;
    }
    .stage-bar {
      height: 100%;
      background: var(--mat-sys-primary);
      border-radius: 4px;
      min-width: 2px;
      transition: width 0.3s ease;
    }
    .stage-count {
      font-size: 12px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
      flex-shrink: 0;
      min-width: 86px;
      text-align: right;
    }

    /* Providers */
    .phone-metric {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 12px;
      margin-bottom: 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .phone-metric mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--mat-sys-primary);
      flex-shrink: 0;
    }
    .pm-label {
      font-size: 13px;
      color: var(--mat-sys-on-surface);
      width: 150px;
      flex-shrink: 0;
      font-weight: 500;
    }
    .pm-count {
      font-size: 12px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
      flex-shrink: 0;
    }
    .pr-bar-phone { background: var(--mat-sys-secondary); }

    .provider-rows {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .provider-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .provider-row mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--mat-sys-primary);
      flex-shrink: 0;
    }
    .pr-label {
      font-size: 13px;
      color: var(--mat-sys-on-surface);
      width: 100px;
      flex-shrink: 0;
    }
    .pr-bar-wrap {
      flex: 1;
      height: 8px;
      background: var(--mat-sys-surface-variant);
      border-radius: 4px;
      overflow: hidden;
    }
    .pr-bar {
      height: 100%;
      background: var(--mat-sys-primary);
      border-radius: 4px;
      transition: width 0.3s ease;
      min-width: 2px;
    }
    .pr-bar-tg     { background: #2AABEE; }
    .pr-bar-google { background: #4285F4; }
    .pr-bar-apple  { background: #555555; }
    .pr-bar-vk     { background: #0077FF; }
    .pr-bar-sber   { background: #21A038; }
    .pr-bar-mts    { background: #E30611; }
    .pr-bar-phone-auth { background: #10B981; }
    .pr-bar-email  { background: var(--mat-sys-tertiary, #6750A4); }
    .pr-bar-email-unverified { background: #9E9E9E; }
    .pr-count {
      font-size: 12px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
      width: 28px;
      text-align: right;
      flex-shrink: 0;
    }

    /* Bar chart */
    .bar-chart {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      height: 120px;
      padding-bottom: 28px;
      overflow-x: auto;
      position: relative;
    }
    .bar-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      min-width: 24px;
      height: 100%;
      position: relative;
    }
    .bar-count {
      font-size: 10px;
      color: var(--mat-sys-on-surface-variant);
      height: 14px;
      line-height: 14px;
    }
    .bar-wrap {
      flex: 1;
      width: 100%;
      display: flex;
      align-items: flex-end;
    }
    .bar {
      width: 100%;
      background: var(--mat-sys-primary);
      border-radius: 3px 3px 0 0;
      min-height: 2px;
      transition: height 0.3s ease;
    }
    .bar.bar-empty {
      background: var(--mat-sys-outline-variant);
      opacity: 0.4;
      min-height: 2px;
      height: 2px !important;
    }
    .bar-label {
      position: absolute;
      bottom: -24px;
      font-size: 9px;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
  `],
})
export class RegistrationsDashboardComponent {
  private readonly api = inject(RegistrationsApiService);
  private readonly platformId = inject(PLATFORM_ID);

  // --- state signals
  readonly period = signal<string>('30d');
  readonly filters = signal<RegFilters>({ ...EMPTY_FILTERS });
  readonly page = signal<number>(1);
  readonly pageSize = signal<number>(50);
  readonly selectedUser = signal<RecentRegistration | null>(null);

  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // --- resources
  private readonly statsResource = rxResource<RegistrationStatsData, { period: string }>({
    params: () => ({ period: this.period() }),
    stream: ({ params }) => this.api.getStats(params.period),
  });

  private readonly recentResource = rxResource<RecentRegistrationsData, {
    period: string;
    page: number;
    limit: number;
    filters: RegFilters;
  }>({
    params: () => ({
      period: this.period(),
      page: this.page(),
      limit: this.pageSize(),
      filters: this.filters(),
    }),
    stream: ({ params }) =>
      this.api.getRecent(params.period, params.page, params.limit, params.filters),
  });

  private readonly funnelResource = rxResource<FunnelData, { period: string }>({
    params: () => ({ period: this.period() }),
    stream: ({ params }) => this.api.getFunnel(params.period),
  });

  // --- stats selectors
  readonly stats = computed<RegistrationStatsData | null>(
    () => this.statsResource.value() ?? null,
  );
  readonly statsLoading = computed(() => this.statsResource.isLoading());
  readonly statsError = computed(() => this.statsResource.error());

  // --- recent selectors
  readonly recentData = computed<RecentRegistrationsData | null>(
    () => this.recentResource.value() ?? null,
  );
  readonly recentRows = computed<RecentRegistration[]>(
    () => this.recentData()?.data ?? [],
  );
  readonly recentTotal = computed<number>(() => this.recentData()?.total ?? 0);
  readonly recentLoading = computed(() => this.recentResource.isLoading());

  // --- funnel
  readonly funnel = computed<FunnelData | null>(
    () => this.funnelResource.value() ?? null,
  );

  // --- providers summary rows
  private readonly providerConfig: readonly {
    key: string;
    field: keyof RegistrationSummary;
    icon: string;
    label: string;
    barClass: string;
  }[] = [
    { key: 'yandex',   field: 'viaYandex',   icon: 'account_circle',  label: 'Яндекс ID', barClass: '' },
    { key: 'telegram', field: 'viaTelegram', icon: 'send',            label: 'Telegram',  barClass: 'pr-bar-tg' },
    { key: 'google',   field: 'viaGoogle',   icon: 'public',          label: 'Google',    barClass: 'pr-bar-google' },
    { key: 'apple',    field: 'viaApple',    icon: 'phone_iphone',    label: 'Apple',     barClass: 'pr-bar-apple' },
    { key: 'vk',       field: 'viaVk',       icon: 'group',           label: 'VK',        barClass: 'pr-bar-vk' },
    { key: 'sber',     field: 'viaSber',     icon: 'account_balance', label: 'Сбер',      barClass: 'pr-bar-sber' },
    { key: 'mts',      field: 'viaMts',      icon: 'sim_card',        label: 'МТС',       barClass: 'pr-bar-mts' },
    { key: 'phone',    field: 'viaPhone',    icon: 'phone',           label: 'Телефон',   barClass: 'pr-bar-phone-auth' },
    { key: 'email',    field: 'viaEmail',    icon: 'verified',        label: 'Email',     barClass: 'pr-bar-email' },
    { key: 'email-unverified', field: 'viaEmailUnverified', icon: 'mark_email_unread', label: 'Email (не подтв.)', barClass: 'pr-bar-email-unverified' },
  ];

  readonly providerRows = computed(() => {
    const s = this.stats();
    if (!s) return [];
    return this.providerConfig
      .map(cfg => ({ ...cfg, count: s.summary[cfg.field] as number }))
      .filter(row => typeof row.count === 'number' && row.count > 0);
  });

  // Chart: aggregate by week for 90d periods (>= 35 daily points)
  readonly chartDays = computed(() => {
    const s = this.stats();
    if (!s) return [];
    const daily = s.daily;
    if (this.period() !== '90d' || daily.length <= 35) return daily;
    const weeks: { day: string; count: number }[] = [];
    for (let i = 0; i < daily.length; i += 7) {
      const chunk = daily.slice(i, i + 7);
      if (chunk.length === 0) continue;
      weeks.push({
        day: chunk[0].day,
        count: chunk.reduce((acc, d) => acc + d.count, 0),
      });
    }
    return weeks;
  });

  readonly maxDaily = computed(() => {
    const days = this.chartDays();
    return days.length ? Math.max(...days.map(d => d.count), 1) : 1;
  });

  constructor() {
    if (!this.isBrowser) {
      // no-op: rxResource requests emit during hydration regardless;
      // the HTTP layer itself is SSR-safe (absolute/relative URL via proxy).
    }
  }

  // --- actions
  changePeriod(p: string): void {
    if (p === this.period()) return;
    this.period.set(p);
    this.page.set(1);
  }

  onFiltersChange(next: RegFilters): void {
    this.filters.set(next);
    this.page.set(1);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.page.set(1);
  }

  // --- helpers
  barHeight(count: number): number {
    const max = this.maxDaily();
    return max > 0 ? Math.round((count / max) * 100) : 0;
  }

  providerPct(count: number): number {
    const total = this.stats()?.summary.totalUsers ?? 0;
    return total > 0 ? Math.round((count / total) * 100) : 0;
  }

  phonePct(): number {
    const s = this.stats()?.summary;
    if (!s || !s.totalUsers) return 0;
    return Math.round((s.hasPhone / s.totalUsers) * 100);
  }

  shortDate(iso: string): string {
    return formatShortDate(iso);
  }
}
