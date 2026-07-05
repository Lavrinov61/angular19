import { Component, inject, input, signal, effect, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ChannelAdminApiService, ChannelHealthDetail, ChannelDetailedStats, QueueCountsSignal } from '../../services/channel-admin-api.service';
import { channelLabel, channelColor, channelIcon } from '../../utils/crm-helpers';
import { forkJoin } from 'rxjs';

@Component({
  selector: 'app-channel-health-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    MatCardModule, MatIconModule, MatButtonModule,
    MatProgressSpinnerModule, MatDividerModule, MatTooltipModule,
  ],
  template: `
    @if (loading()) {
      <div class="loading-state"><mat-spinner diameter="28" /></div>
    } @else if (detail()) {
      <div class="health-detail">
        <div class="detail-header">
          <mat-icon [style.color]="color()">{{ icon() }}</mat-icon>
          <h3>{{ label() }}</h3>
          <span class="health-pill" [class]="'health-' + detail()!.health">
            {{ healthLabel(detail()!.health) }}
          </span>
          <button mat-icon-button (click)="refresh()" matTooltip="Обновить">
            <mat-icon>refresh</mat-icon>
          </button>
        </div>

        <p class="summary-line">{{ detail()!.summary }}</p>

        <mat-divider />

        @if (detail()!.telegram) {
          <!-- Telegram Bot API -->
          <section class="detail-section">
            <h4><mat-icon>smart_toy</mat-icon> Telegram Bot API</h4>
            <div class="kv-grid">
              <span class="kv-label">Режим</span>
              <span [class.warning-text]="telegramModeMismatch()">
                {{ detail()!.telegram!.mode === 'polling' ? 'Polling' : 'Webhook' }}
              </span>

              <span class="kv-label">getMe</span>
              <span [class.ok-text]="detail()!.telegram!.getMeOk === true" [class.error-text]="detail()!.telegram!.getMeOk === false">
                {{ detail()!.telegram!.getMeOk === true ? 'OK' : detail()!.telegram!.getMeOk === false ? 'Ошибка' : '—' }}
                @if (detail()!.telegram!.botUsername) {
                  · &#64;{{ detail()!.telegram!.botUsername }}
                }
              </span>

              <span class="kv-label">Pending updates</span>
              <span [class.warning-text]="(detail()!.telegram!.pendingUpdateCount || 0) > 0">
                {{ detail()!.telegram!.pendingUpdateCount ?? '—' }}
              </span>

              <span class="kv-label">Webhook URL</span>
              <span class="truncate" [matTooltip]="detail()!.telegram!.webhookUrl || 'Не установлен'">
                {{ detail()!.telegram!.webhookUrl || 'Не установлен' }}
              </span>

              <span class="kv-label">Ожидаемый URL</span>
              <span class="truncate" [matTooltip]="detail()!.telegram!.expectedWebhookUrl || '—'">
                {{ detail()!.telegram!.expectedWebhookUrl || '—' }}
              </span>

              @if (detail()!.telegram!.lastError) {
                <span class="kv-label">Последняя ошибка</span>
                <span class="error-text truncate" [matTooltip]="detail()!.telegram!.lastError!">
                  {{ detail()!.telegram!.lastError }}
                </span>
              }
            </div>
          </section>

          <mat-divider />
        }

        <!-- Connection -->
        <section class="detail-section">
          <h4><mat-icon>power</mat-icon> Подключение</h4>
          <div class="kv-grid">
            <span class="kv-label">Circuit Breaker</span>
            <span class="cb-badge" [class]="'cb-' + detail()!.circuitBreaker.state.toLowerCase()">
              {{ detail()!.circuitBreaker.state }}
            </span>

            <span class="kv-label">Ошибки подряд</span>
            <span>{{ detail()!.circuitBreaker.failures }}</span>

            <span class="kv-label">Последний успех</span>
            <span>{{ detail()!.circuitBreaker.lastSuccessAt ? (detail()!.circuitBreaker.lastSuccessAt! | date:'short') : '—' }}</span>

            <span class="kv-label">Последний сбой</span>
            <span class="error-text">{{ detail()!.circuitBreaker.lastFailureAt ? (detail()!.circuitBreaker.lastFailureAt! | date:'short') : '—' }}</span>

            @if (detail()!.circuitBreaker.lastError) {
              <span class="kv-label">Ошибка</span>
              <span class="error-text truncate" [matTooltip]="detail()!.circuitBreaker.lastError!">
                {{ detail()!.circuitBreaker.lastError }}
              </span>
            }
          </div>
        </section>

        <mat-divider />

        <!-- Inbound -->
        <section class="detail-section">
          <h4><mat-icon>call_received</mat-icon> Inbound</h4>
          <div class="kv-grid">
            <span class="kv-label">Последний update</span>
            <span>{{ detail()!.inbound.lastReceivedAt ? timeAgo(detail()!.inbound.lastReceivedAt!) : 'Нет данных' }}</span>

            <span class="kv-label">Последнее сообщение</span>
            <span>{{ detail()!.inbound.lastMessageAt ? timeAgo(detail()!.inbound.lastMessageAt!) : 'Нет данных' }}</span>

            <span class="kv-label">Updates за 24ч</span>
            <span>{{ detail()!.inbound.received24h }}</span>

            <span class="kv-label">Processed за 24ч</span>
            <span>{{ detail()!.inbound.processed24h }} events · {{ detail()!.inbound.processedMessages24h }} msg</span>

            <span class="kv-label">Failed / skipped</span>
            <span>
              <span [class.error-text]="detail()!.inbound.failed24h > 0">{{ detail()!.inbound.failed24h }}</span>
              /
              <span [class.warning-text]="detail()!.inbound.skipped24h > 20">{{ detail()!.inbound.skipped24h }}</span>
            </span>

            <span class="kv-label">% ошибок</span>
            <span [class.error-text]="detail()!.inbound.errorRate > 10">
              {{ detail()!.inbound.errorRate }}%
              @if (detail()!.inbound.received24h > 0) {
                <span class="error-bar-bg">
                  <span class="error-bar-fill" [style.width.%]="detail()!.inbound.errorRate"></span>
                </span>
              }
            </span>

            @if (detail()!.inbound.lastError) {
              <span class="kv-label">Последняя ошибка</span>
              <span class="error-text truncate" [matTooltip]="detail()!.inbound.lastError!">
                {{ detail()!.inbound.lastError }}
              </span>
            }
          </div>
        </section>

        <mat-divider />

        <!-- Queue -->
        <section class="detail-section">
          <h4><mat-icon>queue</mat-icon> Очередь</h4>
          <div class="kv-grid">
            <span class="kv-label">Pending</span>
            <span>{{ detail()!.queue.pendingCount }}</span>

            <span class="kv-label">Failed</span>
            <span class="error-text">{{ detail()!.queue.failedCount }}</span>

            <span class="kv-label">Dead Letters</span>
            <span [class.error-text]="detail()!.queue.deadLetterCount > 0">{{ detail()!.queue.deadLetterCount }}</span>

            <span class="kv-label">Возраст oldest pending</span>
            <span [class.warning-text]="detail()!.queue.oldestPendingAgeSeconds !== null && detail()!.queue.oldestPendingAgeSeconds! > 300">
              {{ formatSeconds(detail()!.queue.oldestPendingAgeSeconds) }}
            </span>
          </div>
        </section>

        <mat-divider />

        <!-- Pipeline Queues -->
        <section class="detail-section">
          <h4><mat-icon>account_tree</mat-icon> Pipeline</h4>
          <div class="kv-grid">
            <span class="kv-label">omni-inbound</span>
            <span [class.warning-text]="queueHasPressure(detail()!.queues.inbound)">
              {{ queueCountsLabel(detail()!.queues.inbound) }}
            </span>

            <span class="kv-label">omni-status</span>
            <span [class.warning-text]="queueHasPressure(detail()!.queues.status)">
              {{ queueCountsLabel(detail()!.queues.status) }}
            </span>

            <span class="kv-label">omni-outbound</span>
            <span [class.warning-text]="queueHasPressure(detail()!.queues.outbound)">
              {{ queueCountsLabel(detail()!.queues.outbound) }}
            </span>

            <span class="kv-label">omni-media</span>
            <span [class.error-text]="detail()!.queues.media.failed > 0" [class.warning-text]="detail()!.queues.media.waiting > 0">
              {{ queueCountsLabel(detail()!.queues.media) }}
            </span>

            <span class="kv-label">media DLQ</span>
            <span [class.error-text]="detail()!.queues.mediaDlq.waiting > 0 || detail()!.queues.mediaDlq.failed > 0">
              {{ queueCountsLabel(detail()!.queues.mediaDlq) }}
            </span>

            <span class="kv-label">av-scan</span>
            <span [class.error-text]="detail()!.queues.avScan.failed > 0" [class.warning-text]="detail()!.queues.avScan.waiting > 0">
              {{ queueCountsLabel(detail()!.queues.avScan) }}
            </span>
          </div>
        </section>

        <mat-divider />

        <!-- Media / AV -->
        <section class="detail-section">
          <h4><mat-icon>perm_media</mat-icon> Media / AV</h4>
          <div class="kv-grid">
            <span class="kv-label">Media за 24ч</span>
            <span>{{ detail()!.media.total24h }}</span>

            <span class="kv-label">Media failed</span>
            <span [class.error-text]="detail()!.media.failed24h > 0">{{ detail()!.media.failed24h }}</span>

            <span class="kv-label">AV pending</span>
            <span [class.warning-text]="detail()!.media.avPendingCount > 20">{{ detail()!.media.avPendingCount }}</span>

            <span class="kv-label">AV error</span>
            <span [class.error-text]="detail()!.media.avError24h > 0">{{ detail()!.media.avError24h }}</span>

            <span class="kv-label">AV infected</span>
            <span [class.error-text]="detail()!.media.avInfected24h > 0">{{ detail()!.media.avInfected24h }}</span>

            <span class="kv-label">ClamAV</span>
            <span [class.ok-text]="detail()!.media.clamAv.available" [class.error-text]="!detail()!.media.clamAv.available">
              {{ clamAvLabel() }}
            </span>

            @if (detail()!.media.clamAv.error) {
              <span class="kv-label">ClamAV error</span>
              <span class="error-text truncate" [matTooltip]="detail()!.media.clamAv.error!">
                {{ detail()!.media.clamAv.error }}
              </span>
            }
          </div>
        </section>

        @if (detail()!.token) {
          <mat-divider />

          <!-- Token -->
          <section class="detail-section">
            <h4><mat-icon>vpn_key</mat-icon> Токен</h4>
            <div class="kv-grid">
              <span class="kv-label">Аккаунт</span>
              <span>{{ detail()!.token!.accountName }}</span>

              <span class="kv-label">Истекает</span>
              <span [class.warning-text]="detail()!.token!.daysUntilExpiry !== null && detail()!.token!.daysUntilExpiry! < 7">
                {{ detail()!.token!.tokenExpiresAt ? (detail()!.token!.tokenExpiresAt! | date:'mediumDate') : 'Бессрочный' }}
              </span>

              <span class="kv-label">Осталось дней</span>
              <span [class.warning-text]="detail()!.token!.daysUntilExpiry !== null && detail()!.token!.daysUntilExpiry! < 7">
                {{ detail()!.token!.daysUntilExpiry !== null ? detail()!.token!.daysUntilExpiry : '∞' }}
              </span>

              <span class="kv-label">Последнее обновление</span>
              <span>{{ detail()!.token!.tokenRefreshedAt ? (detail()!.token!.tokenRefreshedAt! | date:'short') : '—' }}</span>

              <span class="kv-label">Health probe</span>
              <span [class.ok-text]="detail()!.token!.healthCheckOk === true" [class.error-text]="detail()!.token!.healthCheckOk === false">
                {{ detail()!.token!.healthCheckOk === true ? 'OK' : detail()!.token!.healthCheckOk === false ? 'Ошибка' : '—' }}
              </span>

              <span class="kv-label">Probe time</span>
              <span>{{ detail()!.token!.lastHealthCheckAt ? (detail()!.token!.lastHealthCheckAt! | date:'short') : '—' }}</span>

              @if (detail()!.token!.healthCheckError) {
                <span class="kv-label">Probe error</span>
                <span class="error-text truncate" [matTooltip]="detail()!.token!.healthCheckError!">
                  {{ detail()!.token!.healthCheckError }}
                </span>
              }
            </div>
          </section>
        }

        @if (stats()) {
          <mat-divider />

          <!-- 7-Day Metrics Chart -->
          <section class="detail-section">
            <h4><mat-icon>show_chart</mat-icon> Метрики за 7 дней</h4>
            <div class="chart-grid">
              @for (day of stats()!.days; track day.date) {
                <div class="chart-day">
                  <div class="chart-bars">
                    <div class="chart-bar delivered" [style.height.px]="barHeight(day.metrics.delivered, maxMetric())" matTooltip="Доставлено: {{ day.metrics.delivered }}"></div>
                    <div class="chart-bar failed" [style.height.px]="barHeight(day.metrics.failed, maxMetric())" matTooltip="Ошибки: {{ day.metrics.failed }}"></div>
                  </div>
                  <span class="chart-label">{{ day.date.slice(5) }}</span>
                </div>
              }
            </div>
          </section>

          @if (stats()!.recentErrors.length > 0) {
            <mat-divider />

            <!-- Recent Errors -->
            <section class="detail-section">
              <h4><mat-icon>error_outline</mat-icon> Последние ошибки</h4>
              <div class="error-list">
                @for (err of stats()!.recentErrors; track err.id) {
                  <div class="error-row">
                    <span class="error-time">{{ err.created_at | date:'short' }}</span>
                    <span class="error-msg" [matTooltip]="err.last_error">{{ err.last_error }}</span>
                    <span class="error-attempts">×{{ err.attempts }}</span>
                  </div>
                }
              </div>
            </section>
          }
        }
      </div>
    }
  `,
  styles: [`
    .loading-state { display: flex; justify-content: center; padding: 32px; }

    .health-detail { padding: 16px; }

    .detail-header {
      display: flex; align-items: center; gap: 8px; margin-bottom: 8px;
      h3 { margin: 0; font-size: 18px; font-weight: 600; flex: 1; color: var(--crm-text-primary); }
      mat-icon { font-size: 24px; width: 24px; height: 24px; }
    }

    .summary-line { margin: 0 0 12px; font-size: 13px; color: var(--crm-text-secondary); }

    .health-pill {
      padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: uppercase;
      &.health-healthy { background: rgba(52, 211, 153, 0.15); color: #34d399; }
      &.health-degraded { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
      &.health-down { background: rgba(248, 113, 113, 0.15); color: #f87171; }
      &.health-idle { background: rgba(107, 114, 128, 0.15); color: #9ca3af; }
    }

    .detail-section {
      padding: 12px 0;
      h4 {
        display: flex; align-items: center; gap: 6px;
        margin: 0 0 8px; font-size: 13px; font-weight: 600;
        color: var(--crm-text-secondary); text-transform: uppercase;
        mat-icon { font-size: 16px; width: 16px; height: 16px; }
      }
    }

    .kv-grid {
      display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; font-size: 13px;
      .kv-label { color: var(--crm-text-muted); }
    }

    .cb-badge {
      display: inline-flex; padding: 1px 6px; border-radius: 8px;
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      &.cb-closed { background: rgba(52, 211, 153, 0.15); color: #34d399; }
      &.cb-open { background: rgba(248, 113, 113, 0.15); color: #f87171; }
      &.cb-half_open { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
    }

    .ok-text { color: #34d399; }
    .error-text { color: #f87171; }
    .warning-text { color: #fbbf24; }
    .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; display: inline-block; }

    .error-bar-bg {
      display: inline-block; width: 60px; height: 6px; background: var(--crm-border, #333);
      border-radius: 3px; vertical-align: middle; margin-left: 6px;
    }
    .error-bar-fill { display: block; height: 100%; background: #f87171; border-radius: 3px; }

    .chart-grid {
      display: flex; gap: 4px; align-items: flex-end; height: 80px;
    }
    .chart-day { display: flex; flex-direction: column; align-items: center; flex: 1; }
    .chart-bars { display: flex; gap: 1px; align-items: flex-end; height: 60px; }
    .chart-bar {
      width: 8px; border-radius: 2px 2px 0 0; min-height: 1px;
      &.delivered { background: #34d399; }
      &.failed { background: #f87171; }
    }
    .chart-label { font-size: 9px; color: var(--crm-text-muted); margin-top: 2px; }

    .error-list { display: flex; flex-direction: column; gap: 4px; }
    .error-row {
      display: flex; gap: 8px; font-size: 12px; align-items: center;
      .error-time { color: var(--crm-text-muted); flex-shrink: 0; width: 80px; }
      .error-msg { color: #f87171; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; cursor: help; }
      .error-attempts { color: var(--crm-text-muted); flex-shrink: 0; }
    }
  `],
})
export class ChannelHealthDetailComponent implements OnInit {
  private readonly api = inject(ChannelAdminApiService);

  readonly channel = input.required<string>();
  readonly detail = signal<ChannelHealthDetail | null>(null);
  readonly stats = signal<ChannelDetailedStats | null>(null);
  readonly loading = signal(false);

  readonly label = signal('');
  readonly color = signal('');
  readonly icon = signal('');

  constructor() {
    effect(() => {
      const ch = this.channel();
      this.label.set(channelLabel(ch));
      this.color.set(channelColor(ch));
      this.icon.set(channelIcon(ch));
    });
  }

  ngOnInit(): void {
    this.loadData();
  }

  refresh(): void {
    this.loadData();
  }

  private loadData(): void {
    const ch = this.channel();
    this.loading.set(true);

    forkJoin([
      this.api.getChannelHealth(ch),
      this.api.getChannelStats(ch),
    ]).subscribe({
      next: ([healthRes, statsRes]) => {
        if (healthRes.success) this.detail.set(healthRes.data);
        if (statsRes.success) this.stats.set(statsRes.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  healthLabel(level: string): string {
    const labels: Record<string, string> = {
      healthy: 'Работает',
      degraded: 'Деградация',
      down: 'Недоступен',
      idle: 'Нет активности',
    };
    return labels[level] || level;
  }

  timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return '< 1 мин назад';
    if (ms < 3600_000) return `${Math.round(ms / 60_000)} мин назад`;
    if (ms < 86400_000) return `${Math.round(ms / 3600_000)} ч назад`;
    return `${Math.round(ms / 86400_000)} дн. назад`;
  }

  telegramModeMismatch(): boolean {
    const tg = this.detail()?.telegram;
    if (!tg) return false;
    return (tg.mode === 'polling' && tg.webhookUrlSet) || (tg.mode === 'webhook' && !tg.webhookUrlSet);
  }

  queueHasPressure(q: QueueCountsSignal): boolean {
    return q.waiting > 0 || q.active > 0 || q.delayed > 0 || q.failed > 0;
  }

  queueCountsLabel(q: QueueCountsSignal): string {
    return `w:${q.waiting} a:${q.active} d:${q.delayed} f:${q.failed}`;
  }

  clamAvLabel(): string {
    const clamAv = this.detail()?.media.clamAv;
    if (!clamAv) return '—';
    if (!clamAv.available) return 'Недоступен';
    return clamAv.mode === 'clamdscan' ? 'active (clamdscan)' : 'available (clamscan)';
  }

  formatSeconds(seconds: number | null): string {
    if (seconds === null) return '—';
    if (seconds < 60) return `${seconds} сек`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} мин`;
    return `${Math.round(seconds / 3600)} ч`;
  }

  maxMetric(): number {
    const days = this.stats()?.days;
    if (!days) return 1;
    return Math.max(1, ...days.map(d => d.metrics.delivered + d.metrics.failed));
  }

  barHeight(value: number, max: number): number {
    if (max === 0) return 1;
    return Math.max(1, Math.round((value / max) * 56));
  }
}
