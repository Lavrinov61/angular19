import { Component, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe, SlicePipe, JsonPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface LogStats {
  errors_1h: number;
  errors_24h: number;
  warnings_24h: number;
  unique_errors_24h: number;
  topServices: { service: string; count: number }[];
}

interface LogEntry {
  fingerprint: string;
  level: string;
  service: string | null;
  message: string;
  url: string | null;
  http_status: number | null;
  http_url: string | null;
  context: Record<string, unknown>;
  stack_trace: string | null;
  occurrence_count: number;
  first_seen: string;
  last_seen: string;
}

@Component({
  selector: 'app-error-log-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, SlicePipe, JsonPipe, MatCardModule, MatIconModule, MatButtonModule,
    MatButtonToggleModule, MatSelectModule, MatProgressSpinnerModule,
  ],
  template: `
    <div class="error-log-page">
      <div class="page-header">
        <h2>Error Logs</h2>
        <button mat-icon-button (click)="loadAll()" [disabled]="loading()">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      <!-- Stats cards -->
      <div class="stats-row">
        <mat-card class="stat-card stat-error">
          <div class="stat-value">{{ stats()?.errors_1h ?? '—' }}</div>
          <div class="stat-label">Ошибки / час</div>
        </mat-card>
        <mat-card class="stat-card stat-error-24">
          <div class="stat-value">{{ stats()?.errors_24h ?? '—' }}</div>
          <div class="stat-label">Ошибки / 24ч</div>
        </mat-card>
        <mat-card class="stat-card stat-warn">
          <div class="stat-value">{{ stats()?.warnings_24h ?? '—' }}</div>
          <div class="stat-label">Warnings / 24ч</div>
        </mat-card>
        <mat-card class="stat-card stat-unique">
          <div class="stat-value">{{ stats()?.unique_errors_24h ?? '—' }}</div>
          <div class="stat-label">Уникальных</div>
        </mat-card>
      </div>

      <!-- Top services -->
      @if (stats()?.topServices?.length) {
        <div class="top-services">
          <span class="ts-label">Top сервисы:</span>
          @for (svc of stats()!.topServices; track svc.service) {
            <span class="ts-chip" (click)="serviceFilter.set(svc.service)" (keydown.enter)="serviceFilter.set(svc.service)" tabindex="0">
              {{ svc.service }} ({{ svc.count }})
            </span>
          }
        </div>
      }

      <!-- Filters -->
      <div class="filters">
        <mat-button-toggle-group [value]="levelFilter()" (change)="levelFilter.set($event.value); loadLogs()">
          <mat-button-toggle value="">Все</mat-button-toggle>
          <mat-button-toggle value="error">Errors</mat-button-toggle>
          <mat-button-toggle value="warn">Warnings</mat-button-toggle>
        </mat-button-toggle-group>

        <mat-button-toggle-group [value]="timeRange()" (change)="timeRange.set($event.value); loadLogs()">
          <mat-button-toggle value="1h">1ч</mat-button-toggle>
          <mat-button-toggle value="24h">24ч</mat-button-toggle>
          <mat-button-toggle value="7d">7д</mat-button-toggle>
        </mat-button-toggle-group>

        @if (serviceFilter()) {
          <button mat-stroked-button (click)="serviceFilter.set(''); loadLogs()">
            {{ serviceFilter() }} ✕
          </button>
        }
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="loading-center">
          <mat-spinner diameter="32" />
        </div>
      }

      <!-- Log entries -->
      @if (!loading()) {
        @if (logs().length === 0) {
          <div class="empty-state">
            <mat-icon>check_circle</mat-icon>
            <p>Нет ошибок за выбранный период</p>
          </div>
        }

        @for (log of logs(); track log.fingerprint || $index) {
          <mat-card class="log-entry" [class.log-error]="log.level === 'error'" [class.log-warn]="log.level === 'warn'"
                    (click)="toggleExpand(log.fingerprint)">
            <div class="log-header">
              <span class="log-level" [class.level-error]="log.level === 'error'" [class.level-warn]="log.level === 'warn'">
                {{ log.level === 'error' ? '🔴' : '🟡' }}
              </span>
              <span class="log-service" (click)="$event.stopPropagation(); serviceFilter.set(log.service || ''); loadLogs()" (keydown.enter)="$event.stopPropagation(); serviceFilter.set(log.service || ''); loadLogs()" tabindex="0">
                {{ log.service || '—' }}
              </span>
              <span class="log-message">{{ log.message | slice:0:120 }}</span>
              <span class="log-count" [class.count-high]="log.occurrence_count > 5">×{{ log.occurrence_count }}</span>
              <span class="log-time">{{ log.last_seen | date:'HH:mm:ss' }}</span>
            </div>

            @if (expandedFingerprint() === log.fingerprint) {
              <div class="log-detail">
                @if (log.http_status) {
                  <div class="detail-row">
                    <span class="detail-label">HTTP:</span>
                    <code>{{ log.http_status }} {{ log.http_url }}</code>
                  </div>
                }
                @if (log.url) {
                  <div class="detail-row">
                    <span class="detail-label">Page:</span>
                    <code>{{ log.url }}</code>
                  </div>
                }
                <div class="detail-row">
                  <span class="detail-label">First:</span>
                  {{ log.first_seen | date:'dd.MM HH:mm:ss' }}
                  <span class="detail-label" style="margin-left: 16px">Last:</span>
                  {{ log.last_seen | date:'dd.MM HH:mm:ss' }}
                </div>
                @if (log.context && objectKeys(log.context).length > 0) {
                  <div class="detail-row">
                    <span class="detail-label">Context:</span>
                    <pre class="context-json">{{ log.context | json }}</pre>
                  </div>
                }
                @if (log.stack_trace) {
                  <div class="detail-row">
                    <span class="detail-label">Stack:</span>
                    <pre class="stack-trace">{{ log.stack_trace }}</pre>
                  </div>
                }
              </div>
            }
          </mat-card>
        }
      }
    </div>
  `,
  styles: [`
    .error-log-page { max-width: 960px; margin: 0 auto; padding: 16px; }

    .page-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px;
      h2 { margin: 0; font-size: 20px; font-weight: 600; color: var(--crm-text-primary); }
    }

    .stats-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;
      @media (max-width: 600px) { grid-template-columns: repeat(2, 1fr); }
    }

    .stat-card {
      padding: 16px; text-align: center;
      .stat-value { font-size: 28px; font-weight: 700; }
      .stat-label { font-size: 12px; color: var(--crm-text-secondary); margin-top: 4px; }
    }
    .stat-error .stat-value { color: #e53935; }
    .stat-error-24 .stat-value { color: #ff7043; }
    .stat-warn .stat-value { color: #ffa000; }
    .stat-unique .stat-value { color: var(--crm-accent); }

    .top-services {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;
      .ts-label { font-size: 13px; color: var(--crm-text-secondary); }
      .ts-chip {
        font-size: 12px; padding: 2px 8px; border-radius: 12px;
        background: var(--crm-surface-variant, #f5f5f5); cursor: pointer;
        &:hover { background: var(--crm-accent-light, #e3f2fd); }
      }
    }

    .filters {
      display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px;
    }

    .loading-center { display: flex; justify-content: center; padding: 40px; }

    .empty-state {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; color: #4caf50; }
      p { margin-top: 12px; font-size: 15px; }
    }

    .log-entry {
      margin-bottom: 8px; padding: 12px 16px; cursor: pointer;
      transition: box-shadow 0.15s;
      &:hover { box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    }
    .log-error { border-left: 3px solid #e53935; }
    .log-warn { border-left: 3px solid #ffa000; }

    .log-header {
      display: flex; align-items: center; gap: 8px; font-size: 13px;
    }
    .log-service {
      font-weight: 600; color: var(--crm-accent); cursor: pointer; white-space: nowrap;
      &:hover { text-decoration: underline; }
    }
    .log-message {
      flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--crm-text-primary);
    }
    .log-count {
      font-size: 12px; font-weight: 600; padding: 1px 6px; border-radius: 8px;
      background: var(--crm-surface-variant, #f5f5f5);
    }
    .count-high { background: #ffebee; color: #c62828; }
    .log-time { font-size: 12px; color: var(--crm-text-secondary); white-space: nowrap; }

    .log-detail {
      margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--crm-divider, #eee);
      font-size: 13px;
    }
    .detail-row { margin-bottom: 8px; }
    .detail-label { font-weight: 600; margin-right: 8px; color: var(--crm-text-secondary); }
    .context-json, .stack-trace {
      font-size: 12px; background: var(--crm-surface-variant, #f8f8f8);
      padding: 8px; border-radius: 4px; overflow-x: auto; max-height: 200px;
      white-space: pre-wrap; word-break: break-all; margin-top: 4px;
    }
  `],
})
export class ErrorLogViewerComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);

  readonly stats = signal<LogStats | null>(null);
  readonly logs = signal<LogEntry[]>([]);
  readonly loading = signal(false);
  readonly levelFilter = signal('');
  readonly serviceFilter = signal('');
  readonly timeRange = signal('24h');
  readonly expandedFingerprint = signal<string | null>(null);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  readonly objectKeys = Object.keys;

  ngOnInit(): void {
    this.loadAll();
    this.refreshTimer = setInterval(() => this.loadAll(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  loadAll(): void {
    this.loadStats();
    this.loadLogs();
  }

  loadStats(): void {
    this.http.get<{ success: boolean; data: LogStats }>('/api/app-logs/stats').subscribe({
      next: (res) => { if (res.success) this.stats.set(res.data); },
    });
  }

  loadLogs(): void {
    this.loading.set(true);

    const params: Record<string, string> = {
      grouped: 'true',
      limit: '100',
    };

    const level = this.levelFilter();
    if (level) params['level'] = level;

    const service = this.serviceFilter();
    if (service) params['service'] = service;

    const range = this.timeRange();
    const since = new Date();
    if (range === '1h') since.setHours(since.getHours() - 1);
    else if (range === '24h') since.setDate(since.getDate() - 1);
    else if (range === '7d') since.setDate(since.getDate() - 7);
    params['since'] = since.toISOString();

    this.http.get<{ success: boolean; data: LogEntry[] }>('/api/app-logs/recent', { params }).subscribe({
      next: (res) => {
        if (res.success) this.logs.set(res.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  toggleExpand(fingerprint: string): void {
    this.expandedFingerprint.set(
      this.expandedFingerprint() === fingerprint ? null : fingerprint
    );
  }
}
