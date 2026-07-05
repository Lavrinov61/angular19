import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, SlicePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';

interface RetouchJob {
  id: string;
  status: string;
  operations: { type: string; params?: Record<string, unknown> }[];
  total_operations: number;
  cost_estimate_usd: number;
  actual_cost_usd: number;
  error: string | null;
  error_operation: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  source_photo_url: string;
  result_url: string | null;
  result_thumbnail_url: string | null;
  user_name: string;
  user_email: string;
  session_title: string;
  client_name: string;
}

interface Stats {
  summary: {
    total_jobs: string;
    completed: string;
    failed: string;
    cancelled: string;
    total_cost_usd: string;
    avg_duration_sec: string;
  };
  perUser: { user_name: string; email: string; jobs: string; completed: string; cost_usd: string }[];
  perOperation: { operation_type: string; count: string }[];
}

const OP_LABELS: Record<string, string> = {
  remove_background: 'Удаление фона',
  replace_background: 'Замена фона',
  enhance_face: 'Улучшение лица',
  upscale: 'Апскейл',
  remove_beard: 'Удаление бороды',
  uniform_overlay: 'Форма',
  custom_edit: 'Свободное ред.',
  flux_fill: 'Flux Pro',
};

@Component({
  selector: 'app-ai-retouch-logs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, SlicePipe,
    MatButtonModule, MatIconModule, MatChipsModule,
    MatProgressSpinnerModule, MatTooltipModule,
    MatSelectModule, MatFormFieldModule,
  ],
  template: `
    <div class="ai-logs-page">
      <div class="page-header">
        <div class="header-title">
          <mat-icon>auto_fix_high</mat-icon>
          <h2>AI Ретушь — Логи</h2>
        </div>
        <button mat-icon-button (click)="load()" matTooltip="Обновить">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      <!-- Stats Cards -->
      @if (stats()) {
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-value">{{ stats()!.summary.total_jobs }}</span>
            <span class="stat-label">Всего задач</span>
          </div>
          <div class="stat-card completed">
            <span class="stat-value">{{ stats()!.summary.completed }}</span>
            <span class="stat-label">Выполнено</span>
          </div>
          <div class="stat-card failed">
            <span class="stat-value">{{ stats()!.summary.failed }}</span>
            <span class="stat-label">Ошибок</span>
          </div>
          <div class="stat-card cost">
            <span class="stat-value">{{'$' + (+stats()!.summary.total_cost_usd).toFixed(2) }}</span>
            <span class="stat-label">Потрачено</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{{ (+stats()!.summary.avg_duration_sec).toFixed(0) }}с</span>
            <span class="stat-label">Среднее время</span>
          </div>
        </div>

        <!-- Per User -->
        @if (stats()!.perUser.length) {
          <div class="section">
            <h3>По сотрудникам</h3>
            <div class="user-table">
              @for (u of stats()!.perUser; track u.email) {
                <div class="user-row">
                  <span class="user-name">{{ u.user_name || u.email }}</span>
                  <span class="user-stat">{{ u.completed }}/{{ u.jobs }} задач</span>
                  <span class="user-cost">{{'$' + (+u.cost_usd).toFixed(3) }}</span>
                </div>
              }
            </div>
          </div>
        }

        <!-- Per Operation -->
        @if (stats()!.perOperation.length) {
          <div class="section">
            <h3>По операциям</h3>
            <div class="op-chips">
              @for (op of stats()!.perOperation; track op.operation_type) {
                <mat-chip>{{ opLabel(op.operation_type) }}: {{ op.count }}</mat-chip>
              }
            </div>
          </div>
        }
      }

      <!-- Filter -->
      <div class="filter-row">
        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Статус</mat-label>
          <mat-select [value]="statusFilter()" (selectionChange)="statusFilter.set($event.value); load()">
            <mat-option value="">Все</mat-option>
            <mat-option value="completed">Выполнено</mat-option>
            <mat-option value="failed">Ошибка</mat-option>
            <mat-option value="processing">В процессе</mat-option>
            <mat-option value="cancelled">Отменено</mat-option>
          </mat-select>
        </mat-form-field>
        <span class="total-badge">{{ total() }} записей</span>
      </div>

      <!-- Logs List -->
      @if (loading()) {
        <div class="center-state"><mat-spinner diameter="32" /></div>
      } @else {
        <div class="logs-list">
          @for (job of jobs(); track job.id) {
            <div class="log-card" [class]="'status-' + job.status">
              <div class="log-header">
                <span class="log-status" [class]="job.status">{{ statusLabel(job.status) }}</span>
                <span class="log-user">{{ job.user_name || 'Unknown' }}</span>
                <span class="log-date">{{ job.created_at | date:'dd.MM HH:mm' }}</span>
              </div>
              <div class="log-meta">
                <span class="log-session">{{ job.session_title || 'Без названия' }}</span>
                @if (job.client_name) {
                  <span class="log-client">{{ job.client_name }}</span>
                }
              </div>
              <div class="log-ops">
                @for (op of job.operations; track $index) {
                  <span class="op-tag">{{ opLabel(op.type) }}</span>
                }
              </div>
              <div class="log-footer">
                @if (job.actual_cost_usd > 0) {
                  <span class="log-cost">{{'$' + job.actual_cost_usd.toFixed(4) }}</span>
                } @else {
                  <span class="log-cost estimate">{{'~$' + job.cost_estimate_usd.toFixed(4) }}</span>
                }
                @if (job.completed_at && job.started_at) {
                  <span class="log-duration">
                    {{ durationSec(job.started_at, job.completed_at) }}с
                  </span>
                }
                @if (job.error) {
                  <span class="log-error" [matTooltip]="job.error">{{ job.error | slice:0:80 }}</span>
                }
              </div>
              @if (job.result_thumbnail_url) {
                <img [src]="job.result_thumbnail_url" class="log-thumb" loading="lazy" alt="Результат ретуши" />
              }
            </div>
          }
        </div>

        @if (hasMore()) {
          <button mat-stroked-button class="load-more" (click)="loadMore()">
            Загрузить ещё
          </button>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }

    .ai-logs-page {
      padding: 16px 20px;
      max-width: 900px;
      color: var(--crm-text-primary);
    }

    .page-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px;
    }

    .header-title {
      display: flex; align-items: center; gap: 8px;
      mat-icon { color: #a855f7; }
      h2 { margin: 0; font-size: 18px; font-weight: 600; }
    }

    .stats-grid {
      display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px;
    }

    .stat-card {
      flex: 1; min-width: 100px;
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      padding: 12px;
      text-align: center;
    }

    .stat-value {
      display: block; font-size: 20px; font-weight: 700;
      color: var(--crm-text-primary);
    }

    .stat-label {
      font-size: 11px; color: var(--crm-text-muted);
      text-transform: uppercase; letter-spacing: 0.3px;
    }

    .stat-card.completed .stat-value { color: #22c55e; }
    .stat-card.failed .stat-value { color: #ef4444; }
    .stat-card.cost .stat-value { color: #a855f7; }

    .section {
      margin-bottom: 16px;
      h3 { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
    }

    .user-table {
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      overflow: hidden;
    }

    .user-row {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--crm-border);
      font-size: 13px;
      &:last-child { border-bottom: none; }
    }

    .user-name { flex: 1; font-weight: 500; }
    .user-stat { color: var(--crm-text-muted); }
    .user-cost { font-weight: 600; color: #a855f7; min-width: 60px; text-align: right; }

    .op-chips {
      display: flex; gap: 6px; flex-wrap: wrap;
      mat-chip { font-size: 12px; }
    }

    .filter-row {
      display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
    }

    .filter-field {
      width: 160px;
      ::ng-deep .mat-mdc-form-field-infix { min-height: 36px; padding: 4px 0 !important; }
      font-size: 13px;
    }

    .total-badge {
      font-size: 12px; color: var(--crm-text-muted);
    }

    .center-state { display: flex; justify-content: center; padding: 40px; }

    .logs-list {
      display: flex; flex-direction: column; gap: 8px;
    }

    .log-card {
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      padding: 10px 14px;
      position: relative;
      &.status-failed { border-left: 3px solid #ef4444; }
      &.status-completed { border-left: 3px solid #22c55e; }
      &.status-processing { border-left: 3px solid #f59e0b; }
      &.status-cancelled { border-left: 3px solid var(--crm-text-muted); }
    }

    .log-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
    }

    .log-status {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      padding: 2px 8px; border-radius: 10px;
      &.completed { background: rgba(34,197,94,0.15); color: #22c55e; }
      &.failed { background: rgba(239,68,68,0.15); color: #ef4444; }
      &.processing { background: rgba(245,158,11,0.15); color: #f59e0b; }
      &.cancelled { background: rgba(156,163,175,0.15); color: var(--crm-text-muted); }
      &.pending { background: rgba(156,163,175,0.15); color: var(--crm-text-muted); }
    }

    .log-user { font-size: 13px; font-weight: 500; }
    .log-date { font-size: 12px; color: var(--crm-text-muted); margin-left: auto; }

    .log-meta {
      display: flex; gap: 8px; font-size: 12px; color: var(--crm-text-secondary);
      margin-bottom: 6px;
    }

    .log-client { color: var(--crm-text-muted); }

    .log-ops {
      display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px;
    }

    .op-tag {
      font-size: 10px; font-weight: 500;
      background: rgba(168,85,247,0.1); color: #a855f7;
      padding: 2px 8px; border-radius: 10px;
    }

    .log-footer {
      display: flex; align-items: center; gap: 10px; font-size: 12px;
    }

    .log-cost { font-weight: 600; color: #a855f7; }
    .log-cost.estimate { color: var(--crm-text-muted); }
    .log-duration { color: var(--crm-text-muted); }
    .log-error {
      color: #ef4444; font-size: 11px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      max-width: 300px;
    }

    .log-thumb {
      position: absolute; top: 10px; right: 14px;
      width: 48px; height: 48px; object-fit: cover;
      border-radius: var(--crm-radius-sm);
      border: 1px solid var(--crm-border);
    }

    .load-more {
      width: 100%; margin-top: 8px;
      font-size: 13px;
    }
  `],
})
export class AiRetouchLogsComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly loading = signal(false);
  readonly jobs = signal<RetouchJob[]>([]);
  readonly stats = signal<Stats | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly statusFilter = signal('');

  readonly hasMore = computed(() => this.jobs().length < this.total());

  ngOnInit(): void {
    this.load();
    this.loadStats();
  }

  load(): void {
    this.loading.set(true);
    this.page.set(1);
    const status = this.statusFilter();
    const params: Record<string, string> = { page: '1', limit: '50' };
    if (status) params['status'] = status;

    this.http.get<{ success: boolean; data: RetouchJob[]; total: number }>('/api/photo-retouch/admin/logs', { params }).subscribe({
      next: (res) => {
        this.jobs.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadMore(): void {
    const nextPage = this.page() + 1;
    this.page.set(nextPage);
    const status = this.statusFilter();
    const params: Record<string, string> = { page: String(nextPage), limit: '50' };
    if (status) params['status'] = status;

    this.http.get<{ success: boolean; data: RetouchJob[] }>('/api/photo-retouch/admin/logs', { params }).subscribe({
      next: (res) => {
        this.jobs.update(list => [...list, ...res.data]);
      },
    });
  }

  private loadStats(): void {
    this.http.get<{ success: boolean; data: Stats }>('/api/photo-retouch/admin/stats').subscribe({
      next: (res) => this.stats.set(res.data),
    });
  }

  opLabel(type: string): string {
    return OP_LABELS[type] || type;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      completed: 'Готово', failed: 'Ошибка', processing: 'В работе',
      cancelled: 'Отменено', pending: 'В очереди',
    };
    return labels[status] || status;
  }

  durationSec(start: string, end: string): number {
    return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  }
}
