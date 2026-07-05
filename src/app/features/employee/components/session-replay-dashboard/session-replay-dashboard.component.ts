import {
  Component, inject, signal, ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe, DatePipe, PercentPipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDialog } from '@angular/material/dialog';
import {
  ReplayApiService, ReplaySession, ReplayStats,
  FunnelStep, TopPage,
} from '../../services/replay-api.service';

@Component({
  selector: 'app-session-replay-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DecimalPipe, DatePipe, PercentPipe, SlicePipe,
    MatTableModule, MatPaginatorModule, MatButtonModule,
    MatButtonToggleModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatProgressSpinnerModule,
    MatTooltipModule, MatTabsModule,
  ],
  template: `
    <!-- Header -->
    <div class="replay-dashboard">
      <div class="dash-header">
        <div class="dash-title">
          <mat-icon class="title-icon">videocam</mat-icon>
          <h2>Session Replay</h2>
        </div>
        <div class="dash-actions">
          <button mat-icon-button matTooltip="Обновить" (click)="refreshAll()">
            <mat-icon>refresh</mat-icon>
          </button>
          <button mat-icon-button matTooltip="Экспорт CSV" (click)="exportCsv()"
                  [disabled]="sessions().length === 0">
            <mat-icon>download</mat-icon>
          </button>
          <mat-button-toggle-group [value]="period()" (change)="setPeriod($event.value)" hideSingleSelectionIndicator>
            <mat-button-toggle value="7">7 дн</mat-button-toggle>
            <mat-button-toggle value="30">30 дн</mat-button-toggle>
            <mat-button-toggle value="90">90 дн</mat-button-toggle>
          </mat-button-toggle-group>
        </div>
      </div>

      <!-- KPI Cards -->
      @if (statsLoading()) {
        <div class="spinner-row"><mat-spinner diameter="32" /></div>
      } @else if (statsError()) {
        <div class="error-state">
          <mat-icon>cloud_off</mat-icon>
          <p>{{ statsError() }}</p>
          <button mat-stroked-button (click)="loadStats()">
            <mat-icon>refresh</mat-icon> Повторить
          </button>
        </div>
      } @else {
        @let s = stats();
        @if (s) {
        <div class="kpi-row">
          <div class="kpi-card">
            <mat-icon class="kpi-icon">play_circle</mat-icon>
            <div class="kpi-value">{{ s.total_sessions | number }}</div>
            <div class="kpi-label">Всего сессий</div>
          </div>
          <div class="kpi-card">
            <mat-icon class="kpi-icon">schedule</mat-icon>
            <div class="kpi-value">{{ formatDuration(s.avg_duration) }}</div>
            <div class="kpi-label">Ср. длительность</div>
          </div>
          <div class="kpi-card" [class.kpi-warn]="errorRate(s) > 10">
            <mat-icon class="kpi-icon">error_outline</mat-icon>
            <div class="kpi-value">{{ errorRate(s) | number:'1.1-1' }}%</div>
            <div class="kpi-label">Ошибки</div>
          </div>
          <div class="kpi-card">
            <mat-icon class="kpi-icon">people</mat-icon>
            <div class="kpi-value">{{ s.unique_visitors | number }}</div>
            <div class="kpi-label">Уник. посетителей</div>
          </div>
        </div>

        <!-- Device Bar -->
        <div class="device-bar-wrapper">
          <div class="device-bar">
            @if (s.desktop_count > 0) {
              <div class="device-segment desktop"
                   [style.flex]="s.desktop_count"
                   [class.active]="filterDevice === 'desktop'"
                   (click)="toggleDeviceFilter('desktop')"
                   (keydown.enter)="toggleDeviceFilter('desktop')"
                   tabindex="0"
                   [matTooltip]="'Desktop: ' + s.desktop_count">
                <mat-icon>computer</mat-icon>
                <span>{{ devicePercent(s, 'desktop') | number:'1.0-0' }}%</span>
              </div>
            }
            @if (s.mobile_count > 0) {
              <div class="device-segment mobile"
                   [style.flex]="s.mobile_count"
                   [class.active]="filterDevice === 'mobile'"
                   (click)="toggleDeviceFilter('mobile')"
                   (keydown.enter)="toggleDeviceFilter('mobile')"
                   tabindex="0"
                   [matTooltip]="'Mobile: ' + s.mobile_count">
                <mat-icon>smartphone</mat-icon>
                <span>{{ devicePercent(s, 'mobile') | number:'1.0-0' }}%</span>
              </div>
            }
            @if (s.tablet_count > 0) {
              <div class="device-segment tablet"
                   [style.flex]="s.tablet_count"
                   [class.active]="filterDevice === 'tablet'"
                   (click)="toggleDeviceFilter('tablet')"
                   (keydown.enter)="toggleDeviceFilter('tablet')"
                   tabindex="0"
                   [matTooltip]="'Tablet: ' + s.tablet_count">
                <mat-icon>tablet</mat-icon>
                <span>{{ devicePercent(s, 'tablet') | number:'1.0-0' }}%</span>
              </div>
            }
          </div>
        </div>
        }
      }

      <!-- Filters -->
      <div class="filters-row">
        <mat-form-field appearance="outline" class="filter-field search-field">
          <mat-label>Поиск</mat-label>
          <input matInput [(ngModel)]="filterSearch" (keyup.enter)="applyFilters()"
                 placeholder="Телефон, visitor_id или user_id">
          <mat-icon matSuffix>search</mat-icon>
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Ошибки</mat-label>
          <mat-select [(ngModel)]="filterError" (selectionChange)="applyFilters()">
            <mat-option value="">Все</mat-option>
            <mat-option value="true">С ошибками</mat-option>
            <mat-option value="false">Без ошибок</mat-option>
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Мин. длительность (сек)</mat-label>
          <input matInput type="number" [(ngModel)]="filterMinDuration" (change)="applyFilters()" min="0">
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Сортировка</mat-label>
          <mat-select [(ngModel)]="filterSort" (selectionChange)="applyFilters()">
            <mat-option value="started_at">По дате</mat-option>
            <mat-option value="duration_seconds">По длительности</mat-option>
            <mat-option value="total_clicks">По кликам</mat-option>
          </mat-select>
        </mat-form-field>

        <button mat-icon-button class="sort-dir-btn"
                [matTooltip]="filterSortDir() === 'desc' ? 'По убыванию' : 'По возрастанию'"
                (click)="toggleSortDir()">
          <mat-icon>{{ filterSortDir() === 'desc' ? 'arrow_downward' : 'arrow_upward' }}</mat-icon>
        </button>
      </div>

      <!-- Table -->
      @if (sessionsLoading()) {
        <div class="spinner-row"><mat-spinner diameter="32" /></div>
      } @else if (sessionsError()) {
        <div class="error-state">
          <mat-icon>cloud_off</mat-icon>
          <p>{{ sessionsError() }}</p>
          <button mat-stroked-button (click)="loadSessions()">
            <mat-icon>refresh</mat-icon> Повторить
          </button>
        </div>
      } @else {
        <div class="table-wrapper">
          <table mat-table [dataSource]="sessions()">
            <ng-container matColumnDef="started_at">
              <th mat-header-cell *matHeaderCellDef>Время</th>
              <td mat-cell *matCellDef="let row">{{ row.started_at | date:'dd.MM HH:mm' }}</td>
            </ng-container>

            <ng-container matColumnDef="visitor">
              <th mat-header-cell *matHeaderCellDef>Посетитель</th>
              <td mat-cell *matCellDef="let row">
                @if (row.user_phone) {
                  <span class="visitor-phone">{{ row.user_phone }}</span>
                } @else if (row.user_name) {
                  <span>{{ row.user_name }}</span>
                } @else {
                  <span class="visitor-id" [matTooltip]="row.visitor_id">{{ row.visitor_id | slice:0:8 }}...</span>
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="device_type">
              <th mat-header-cell *matHeaderCellDef>Устройство</th>
              <td mat-cell *matCellDef="let row">
                <mat-icon class="device-icon" [matTooltip]="row.device_type">{{ deviceIcon(row.device_type) }}</mat-icon>
              </td>
            </ng-container>

            <ng-container matColumnDef="landing_page">
              <th mat-header-cell *matHeaderCellDef>Лендинг</th>
              <td mat-cell *matCellDef="let row">
                <span class="landing-cell" [matTooltip]="row.landing_page || ''">{{ shortenPath(row.landing_page) }}</span>
              </td>
            </ng-container>

            <ng-container matColumnDef="duration">
              <th mat-header-cell *matHeaderCellDef>Длительность</th>
              <td mat-cell *matCellDef="let row">{{ formatDuration(row.duration_seconds) }}</td>
            </ng-container>

            <ng-container matColumnDef="total_pages">
              <th mat-header-cell *matHeaderCellDef>Стр.</th>
              <td mat-cell *matCellDef="let row">{{ row.total_pages }}</td>
            </ng-container>

            <ng-container matColumnDef="total_clicks">
              <th mat-header-cell *matHeaderCellDef>Клики</th>
              <td mat-cell *matCellDef="let row">{{ row.total_clicks }}</td>
            </ng-container>

            <ng-container matColumnDef="has_error">
              <th mat-header-cell *matHeaderCellDef>Ошибки</th>
              <td mat-cell *matCellDef="let row">
                @if (row.has_error) {
                  <mat-icon class="error-flag" matTooltip="JS Error">warning</mat-icon>
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let row">
                <div class="action-buttons">
                  @if (row.chunk_count > 0) {
                    <button mat-icon-button matTooltip="Воспроизвести" (click)="openReplay(row); $event.stopPropagation()">
                      <mat-icon>play_arrow</mat-icon>
                    </button>
                  }
                  <button mat-icon-button matTooltip="Тепловая карта" (click)="openHeatmap(row); $event.stopPropagation()">
                    <mat-icon>local_fire_department</mat-icon>
                  </button>
                </div>
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="displayedColumns"></tr>
            <tr mat-row *matRowDef="let row; columns: displayedColumns;"
                class="session-row" (click)="row.chunk_count > 0 && openReplay(row)"></tr>
          </table>
        </div>

        @if (sessions().length === 0) {
          <div class="empty-state">
            <mat-icon>videocam_off</mat-icon>
            <p>Нет записанных сессий за выбранный период</p>
          </div>
        }

        <mat-paginator
          [length]="totalSessions()"
          [pageSize]="pageSize"
          [pageIndex]="pageIndex()"
          [pageSizeOptions]="[20, 50, 100]"
          (page)="onPageChange($event)"
          showFirstLastButtons />
      }

      <!-- Analytics Tabs -->
      <mat-tab-group class="analytics-tabs" (selectedIndexChange)="onTabChange($event)">
        <mat-tab label="Воронка">
          @if (funnelLoading()) {
            <div class="spinner-row"><mat-spinner diameter="28" /></div>
          } @else if (funnelError()) {
            <div class="error-state small">
              <mat-icon>cloud_off</mat-icon>
              <p>{{ funnelError() }}</p>
              <button mat-stroked-button (click)="loadFunnel()">
                <mat-icon>refresh</mat-icon> Повторить
              </button>
            </div>
          } @else {
            <div class="funnel-chart">
              @for (step of funnelData(); track step.step; let i = $index) {
                <div class="funnel-step">
                  <div class="funnel-bar"
                       [style.width.%]="funnelBarWidth(step, i)">
                    <span class="funnel-label">{{ step.step }}</span>
                    <span class="funnel-count">{{ step.visitors }}</span>
                  </div>
                  @if (i > 0 && funnelData()[i - 1].visitors > 0) {
                    <span class="funnel-drop">
                      {{ (step.visitors / funnelData()[i - 1].visitors) | percent:'1.0-0' }}
                    </span>
                  }
                </div>
              }
            </div>
          }
        </mat-tab>
        <mat-tab label="Топ страниц">
          @if (topPagesLoading()) {
            <div class="spinner-row"><mat-spinner diameter="28" /></div>
          } @else if (topPagesError()) {
            <div class="error-state small">
              <mat-icon>cloud_off</mat-icon>
              <p>{{ topPagesError() }}</p>
              <button mat-stroked-button (click)="loadTopPages()">
                <mat-icon>refresh</mat-icon> Повторить
              </button>
            </div>
          } @else {
            <div class="top-pages-list">
              @for (page of topPages(); track page.page_path; let i = $index) {
                <div class="top-page-row">
                  <span class="top-page-rank">{{ i + 1 }}</span>
                  <span class="top-page-path" [matTooltip]="page.page_path">{{ page.page_path }}</span>
                  <span class="top-page-visits">{{ page.visits }} визитов</span>
                  <span class="top-page-visitors">{{ page.unique_visitors }} уник.</span>
                  <span class="top-page-bounce">{{ page.bounce_rate }}% отказ</span>
                </div>
              }
              @if (topPages().length === 0) {
                <div class="empty-state small"><p>Нет данных</p></div>
              }
            </div>
          }
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .replay-dashboard {
      max-width: 1200px;
      margin: 0 auto;
      padding: 16px;
    }

    /* Header */
    .dash-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
      flex-wrap: wrap;
      gap: 12px;
    }

    .dash-title {
      display: flex;
      align-items: center;
      gap: 8px;

      h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--crm-text-primary);
      }
    }

    .dash-actions {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .title-icon {
      color: var(--crm-accent);
      font-size: 28px;
      width: 28px;
      height: 28px;
    }

    /* KPI Cards */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 16px;

      @media (min-width: 768px) { grid-template-columns: repeat(4, 1fr); }
    }

    .kpi-card {
      background: var(--crm-surface, #fff);
      border: 1px solid var(--crm-border, #e0e0e0);
      border-radius: 12px;
      padding: 16px;
      text-align: center;
      transition: box-shadow 0.2s;

      &:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
      &.kpi-warn .kpi-value { color: #e53935; }
    }

    .kpi-icon {
      color: var(--crm-accent);
      font-size: 24px;
      width: 24px;
      height: 24px;
      margin-bottom: 4px;
    }

    .kpi-value {
      font-size: 24px;
      font-weight: 700;
      color: var(--crm-text-primary);
      line-height: 1.2;
    }

    .kpi-label {
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin-top: 2px;
    }

    /* Device Bar */
    .device-bar-wrapper { margin-bottom: 16px; }

    .device-bar {
      display: flex;
      height: 36px;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--crm-border, #e0e0e0);
    }

    .device-segment {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      cursor: pointer;
      transition: filter 0.2s;
      color: #fff;
      font-size: 12px;
      font-weight: 500;
      min-width: 60px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &.desktop { background: #1976d2; }
      &.mobile  { background: #388e3c; }
      &.tablet  { background: #f57c00; }

      &:not(.active) { filter: brightness(0.7); opacity: 0.6; }
      &.active { filter: brightness(1.1); }
      &:hover  { filter: brightness(1.15); }
    }

    /* Filters */
    .filters-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
      align-items: flex-start;
    }

    .filter-field {
      width: 160px;
      font-size: 13px;

      &.search-field { width: 240px; }
    }

    .sort-dir-btn {
      margin-top: 8px;
    }

    /* Table */
    .table-wrapper {
      overflow-x: auto;
      border: 1px solid var(--crm-border, #e0e0e0);
      border-radius: 8px;
    }

    table { width: 100%; }

    .session-row {
      cursor: pointer;
      &:hover { background: var(--crm-surface-hover, rgba(0,0,0,0.02)); }
    }

    .visitor-phone {
      font-weight: 500;
      color: var(--crm-accent);
    }

    .visitor-id {
      font-family: monospace;
      font-size: 12px;
      color: var(--crm-text-secondary);
    }

    .device-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-secondary);
    }

    .landing-cell {
      max-width: 180px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: inline-block;
      font-size: 12px;
    }

    .error-flag {
      color: #e53935;
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .action-buttons {
      display: flex;
      gap: 0;
    }

    /* Error state */
    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      color: var(--crm-text-secondary);

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.5; }
      p { margin: 8px 0 12px; font-size: 13px; }

      button mat-icon { font-size: 18px; width: 18px; height: 18px; margin-right: 4px; }

      &.small { padding: 20px 12px; }
    }

    /* Empty state */
    .empty-state {
      text-align: center;
      padding: 40px 16px;
      color: var(--crm-text-secondary);

      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.3; }
      p { margin-top: 8px; }

      &.small { padding: 20px; }
    }

    .spinner-row {
      display: flex;
      justify-content: center;
      padding: 24px;
    }

    /* Analytics Tabs */
    .analytics-tabs {
      margin-top: 24px;
    }

    /* Funnel */
    .funnel-chart {
      padding: 16px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .funnel-step {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .funnel-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--crm-accent);
      color: #fff;
      border-radius: 6px;
      min-width: 100px;
      transition: width 0.3s;
    }

    .funnel-label { font-size: 13px; font-weight: 500; }
    .funnel-count { font-size: 13px; font-weight: 700; }

    .funnel-drop {
      font-size: 12px;
      color: var(--crm-text-secondary);
      white-space: nowrap;
    }

    /* Top Pages */
    .top-pages-list {
      padding: 12px 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .top-page-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;

      &:nth-child(odd) { background: var(--crm-surface-hover, rgba(0,0,0,0.02)); }
    }

    .top-page-rank {
      font-weight: 700;
      color: var(--crm-accent);
      min-width: 24px;
    }

    .top-page-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-primary);
    }

    .top-page-visits, .top-page-visitors, .top-page-bounce {
      white-space: nowrap;
      color: var(--crm-text-secondary);
      font-size: 12px;
    }
  `],
})
export class SessionReplayDashboardComponent {
  private readonly replayApi = inject(ReplayApiService);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);

  // State
  readonly period = signal<string>('30');
  readonly stats = signal<ReplayStats | null>(null);
  readonly statsLoading = signal(false);
  readonly statsError = signal<string | null>(null);
  readonly sessions = signal<ReplaySession[]>([]);
  readonly sessionsLoading = signal(false);
  readonly sessionsError = signal<string | null>(null);
  readonly totalSessions = signal(0);
  readonly pageIndex = signal(0);
  readonly pageSize = 20;

  // Analytics
  readonly funnelData = signal<FunnelStep[]>([]);
  readonly funnelLoading = signal(false);
  readonly funnelError = signal<string | null>(null);
  readonly topPages = signal<TopPage[]>([]);
  readonly topPagesLoading = signal(false);
  readonly topPagesError = signal<string | null>(null);

  // Track which period analytics were loaded for
  private funnelLoadedForPeriod: string | null = null;
  private topPagesLoadedForPeriod: string | null = null;
  private activeTabIndex = 0;

  // Filters
  filterSearch = '';
  filterDevice = '';
  filterError = '';
  filterMinDuration: number | null = null;
  filterSort: 'started_at' | 'duration_seconds' | 'total_clicks' = 'started_at';
  readonly filterSortDir = signal<'asc' | 'desc'>('desc');

  readonly displayedColumns = [
    'started_at', 'visitor', 'device_type', 'landing_page',
    'duration', 'total_pages', 'total_clicks', 'has_error', 'actions',
  ];

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadStats();
      this.loadSessions();
      this.loadFunnel();
    }
  }

  // ─── Period ─────────────────────────────────────────────────────────────────

  setPeriod(value: string): void {
    this.period.set(value);
    this.pageIndex.set(0);
    this.loadStats();
    this.loadSessions();
    // Always reload analytics on period change
    this.loadFunnel();
    if (this.activeTabIndex === 1) {
      this.loadTopPages();
    }
  }

  // ─── Filters ────────────────────────────────────────────────────────────────

  toggleDeviceFilter(device: string): void {
    this.filterDevice = this.filterDevice === device ? '' : device;
    this.applyFilters();
  }

  toggleSortDir(): void {
    this.filterSortDir.update(d => d === 'desc' ? 'asc' : 'desc');
    this.applyFilters();
  }

  applyFilters(): void {
    this.pageIndex.set(0);
    this.loadSessions();
  }

  // ─── Refresh all ─────────────────────────────────────────────────────────────

  refreshAll(): void {
    this.loadStats();
    this.loadSessions();
    this.loadFunnel();
    if (this.activeTabIndex === 1) {
      this.loadTopPages();
    }
  }

  // ─── CSV Export ──────────────────────────────────────────────────────────────

  exportCsv(): void {
    const rows = this.sessions();
    if (rows.length === 0) return;

    const headers = ['Дата', 'Посетитель', 'Телефон', 'Устройство', 'Лендинг', 'Длительность', 'Страниц', 'Кликов', 'Ошибки'];
    const csvRows = rows.map(r => [
      r.started_at ? new Date(r.started_at).toLocaleString('ru-RU') : '',
      r.user_name || r.visitor_id,
      r.user_phone || '',
      r.device_type,
      r.landing_page || '',
      r.duration_seconds != null ? String(r.duration_seconds) : '',
      String(r.total_pages),
      String(r.total_clicks),
      r.has_error ? 'Да' : 'Нет',
    ]);

    const bom = '\uFEFF';
    const csv = bom + [headers.join(';'), ...csvRows.map(r => r.map(v => `"${v}"`).join(';'))].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sessions_${this.period()}d_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Data loading ───────────────────────────────────────────────────────────

  protected loadStats(): void {
    this.statsLoading.set(true);
    this.statsError.set(null);
    this.replayApi.getStats(+this.period()).subscribe({
      next: data => {
        this.stats.set(data);
        this.statsLoading.set(false);
      },
      error: () => {
        this.statsError.set('Не удалось загрузить статистику');
        this.statsLoading.set(false);
      },
    });
  }

  protected loadSessions(): void {
    this.sessionsLoading.set(true);
    this.sessionsError.set(null);

    const searchOpts = this.parseSearch(this.filterSearch);

    this.replayApi.getSessions({
      days: +this.period(),
      page: this.pageIndex() + 1,
      limit: this.pageSize,
      device_type: this.filterDevice || undefined,
      has_error: this.filterError ? this.filterError === 'true' : undefined,
      min_duration: this.filterMinDuration && this.filterMinDuration > 0 ? this.filterMinDuration : undefined,
      sort: this.filterSort,
      sort_dir: this.filterSortDir(),
      ...searchOpts,
    }).subscribe({
      next: result => {
        this.sessions.set(result.data);
        this.totalSessions.set(result.pagination.total);
        this.sessionsLoading.set(false);
      },
      error: () => {
        this.sessionsError.set('Не удалось загрузить сессии');
        this.sessionsLoading.set(false);
      },
    });
  }

  protected loadFunnel(): void {
    this.funnelLoading.set(true);
    this.funnelError.set(null);
    const currentPeriod = this.period();
    this.replayApi.getFunnelData(+currentPeriod).subscribe({
      next: data => {
        this.funnelData.set(data);
        this.funnelLoadedForPeriod = currentPeriod;
        this.funnelLoading.set(false);
      },
      error: () => {
        this.funnelError.set('Не удалось загрузить воронку');
        this.funnelLoading.set(false);
      },
    });
  }

  protected loadTopPages(): void {
    this.topPagesLoading.set(true);
    this.topPagesError.set(null);
    const currentPeriod = this.period();
    this.replayApi.getTopPages(+currentPeriod).subscribe({
      next: data => {
        this.topPages.set(data);
        this.topPagesLoadedForPeriod = currentPeriod;
        this.topPagesLoading.set(false);
      },
      error: () => {
        this.topPagesError.set('Не удалось загрузить топ страниц');
        this.topPagesLoading.set(false);
      },
    });
  }

  // ─── Smart search parser ────────────────────────────────────────────────────

  private parseSearch(search: string): { phone?: string; visitor_id?: string; user_id?: string } {
    if (!search) return {};
    const trimmed = search.trim();

    // Starts with + or digit → phone search
    if (/^[+\d]/.test(trimmed)) return { phone: trimmed };

    // UUID format → user_id
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(trimmed)) return { user_id: trimmed };

    // Else → visitor_id
    return { visitor_id: trimmed };
  }

  // ─── Pagination ─────────────────────────────────────────────────────────────

  onPageChange(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.loadSessions();
  }

  // ─── Tab change ─────────────────────────────────────────────────────────────

  onTabChange(index: number): void {
    this.activeTabIndex = index;
    const currentPeriod = this.period();

    if (index === 0 && (this.funnelData().length === 0 || this.funnelLoadedForPeriod !== currentPeriod)) {
      this.loadFunnel();
    }
    if (index === 1 && (this.topPages().length === 0 || this.topPagesLoadedForPeriod !== currentPeriod)) {
      this.loadTopPages();
    }
  }

  // ─── Dialogs ────────────────────────────────────────────────────────────────

  openReplay(session: ReplaySession): void {
    import('../session-replay-viewer/session-replay-viewer.component').then(m => {
      this.dialog.open(m.SessionReplayViewerComponent, {
        width: '90vw',
        maxWidth: '1100px',
        height: '80vh',
        data: { session },
        panelClass: 'replay-dialog-panel',
      });
    });
  }

  openHeatmap(session: ReplaySession): void {
    import('../heatmap-viewer/heatmap-viewer.component').then(m => {
      this.dialog.open(m.HeatmapViewerComponent, {
        width: '90vw',
        maxWidth: '1100px',
        height: '80vh',
        data: { visitor_id: session.visitor_id },
        panelClass: 'replay-dialog-panel',
      });
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  formatDuration(seconds: number | null): string {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}м ${s}с` : `${s}с`;
  }

  errorRate(s: ReplayStats): number {
    return s.total_sessions > 0 ? (s.error_sessions / s.total_sessions) * 100 : 0;
  }

  devicePercent(s: ReplayStats, type: 'desktop' | 'mobile' | 'tablet'): number {
    const total = s.desktop_count + s.mobile_count + s.tablet_count;
    if (total === 0) return 0;
    const count = type === 'desktop' ? s.desktop_count : type === 'mobile' ? s.mobile_count : s.tablet_count;
    return (count / total) * 100;
  }

  deviceIcon(type: string): string {
    switch (type) {
      case 'mobile': return 'smartphone';
      case 'tablet': return 'tablet';
      default: return 'computer';
    }
  }

  shortenPath(path: string | null): string {
    if (!path) return '—';
    return path.length > 30 ? '...' + path.slice(-27) : path;
  }

  funnelBarWidth(step: FunnelStep, index: number): number {
    if (index === 0 || this.funnelData().length === 0) return 100;
    const max = this.funnelData()[0].visitors;
    return max > 0 ? Math.max((step.visitors / max) * 100, 10) : 10;
  }
}
