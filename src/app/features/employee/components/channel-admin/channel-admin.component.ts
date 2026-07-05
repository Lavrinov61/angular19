import { Component, inject, signal, effect, ChangeDetectionStrategy, OnInit, OnDestroy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, SlicePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { ChannelAdminApiService, ChannelStatus, DeadLetterMessage, HealthLevel } from '../../services/channel-admin-api.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { ToastService } from '../../../../core/services/toast.service';
import { channelIcon, channelLabel, channelColor } from '../../utils/crm-helpers';
import { ChannelHealthDetailComponent } from './channel-health-detail.component';

@Component({
  selector: 'app-channel-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatIconModule, MatButtonModule, MatSlideToggleModule,
    MatTabsModule, MatTableModule, MatPaginatorModule, MatTooltipModule,
    MatProgressSpinnerModule, MatSelectModule, MatChipsModule, SlicePipe,
    ChannelHealthDetailComponent,
  ],
  template: `
    <div class="channel-admin" [class.detail-open]="selectedChannel()">
      <div class="main-panel">
        <div class="page-header">
          <h2>Каналы связи</h2>
          <button mat-stroked-button (click)="loadChannels()">
            <mat-icon>refresh</mat-icon> Обновить
          </button>
        </div>

        <mat-tab-group>
          <!-- Channels Tab -->
          <mat-tab label="Каналы">
            @if (loading()) {
              <div class="loading-state">
                <mat-spinner diameter="32" />
              </div>
            } @else {
              <div class="channel-grid">
                @for (ch of channels(); track ch.channel) {
                  <mat-card class="channel-card"
                    [class]="'health-border-' + ch.health"
                    [class.selected]="selectedChannel() === ch.channel"
                    (click)="selectChannel(ch.channel)">
                    <div class="ch-header">
                      <mat-icon [style.color]="getColor(ch.channel)">{{ getIcon(ch.channel) }}</mat-icon>
                      <span class="ch-name">{{ getLabel(ch.channel) }}</span>
                      <span class="health-badge" [class]="'health-' + ch.health">
                        {{ healthLabel(ch.health) }}
                      </span>
                      <mat-slide-toggle
                        [checked]="!ch.disabled && ch.connectorEnabled"
                        [disabled]="!ch.connectorEnabled"
                        (click)="$event.stopPropagation()"
                        (change)="toggleChannel(ch.channel, $event.checked)"
                        [matTooltip]="ch.connectorEnabled ? (ch.disabled ? 'Выключен (админ)' : 'Включён') : 'Коннектор не настроен'" />
                    </div>

                    <div class="ch-summary">{{ ch.summary || 'Нет данных' }}</div>

                    @if (ch.telegram) {
                      <div class="signal-row">
                        <span class="signal-chip" [class.warning]="telegramModeMismatch(ch)" [class.ok]="ch.telegram.getMeOk === true">
                          {{ telegramModeLabel(ch) }}
                        </span>
                        <span class="signal-chip" [class.ok]="ch.telegram.getMeOk === true" [class.error]="ch.telegram.getMeOk === false">
                          Bot API {{ ch.telegram.getMeOk === true ? 'OK' : ch.telegram.getMeOk === false ? 'ERR' : '—' }}
                        </span>
                        <span class="signal-chip" [class.warning]="(ch.telegram.pendingUpdateCount || 0) > 0">
                          upd {{ ch.telegram.pendingUpdateCount ?? '—' }}
                        </span>
                      </div>
                    }

                    <div class="ch-metrics">
                      <div class="metric">
                        <span class="metric-value">{{ ch.metrics24h.sent }}</span>
                        <span class="metric-label">Отпр.</span>
                      </div>
                      <div class="metric">
                        <span class="metric-value">{{ ch.metrics24h.received }}</span>
                        <span class="metric-label">Получ.</span>
                      </div>
                      <div class="metric">
                        <span class="metric-value">{{ ch.metrics24h.delivered }}</span>
                        <span class="metric-label">Доставл.</span>
                      </div>
                      <div class="metric">
                        <span class="metric-value fail">{{ ch.metrics24h.failed }}</span>
                        <span class="metric-label">Ошибки</span>
                      </div>
                    </div>

                    @if (ch.inbound) {
                      <div class="inbound-strip">
                        <span>
                          <mat-icon>call_received</mat-icon>
                          {{ inboundAgeLabel(ch) }}
                        </span>
                        <span>{{ ch.inbound.processedMessages24h }} msg/24ч</span>
                        @if (ch.inbound.failed24h > 0) {
                          <span class="fail">{{ ch.inbound.failed24h }} failed</span>
                        }
                      </div>
                    }

                    @if (ch.metrics24h.sent > 0) {
                      <div class="delivery-rate">
                        {{ deliveryRate(ch) }}% доставлено
                        @if (ch.metrics24h.avgDeliveryMs > 0) {
                          · {{ ch.metrics24h.avgDeliveryMs }}ms
                        }
                      </div>
                    }

                    @if (ch.queueDepth > 0) {
                      <div class="queue-info">
                        <mat-icon>hourglass_empty</mat-icon> {{ ch.queueDepth }} в очереди
                      </div>
                    }

                    @if (hasPipelineAlert(ch)) {
                      <div class="queue-info warn">
                        <mat-icon>warning</mat-icon> {{ pipelineAlertLabel(ch) }}
                      </div>
                    }

                    @if (hasMediaAlert(ch)) {
                      <div class="queue-info warn">
                        <mat-icon>perm_media</mat-icon> {{ mediaAlertLabel(ch) }}
                      </div>
                    }
                  </mat-card>
                }
              </div>
            }
          </mat-tab>

          <!-- Dead Letters Tab -->
          <mat-tab>
            <ng-template mat-tab-label>
              Dead Letters
              @if (dlTotal() > 0) {
                <span class="dl-badge">{{ dlTotal() }}</span>
              }
            </ng-template>

            <div class="dl-toolbar">
              <mat-select placeholder="Канал" (selectionChange)="dlChannelFilter.set($event.value); loadDeadLetters()">
                <mat-option [value]="''">Все</mat-option>
                <mat-option value="telegram">Telegram</mat-option>
                <mat-option value="vk">VK</mat-option>
                <mat-option value="max">МАКС</mat-option>
                <mat-option value="whatsapp">WhatsApp</mat-option>
                <mat-option value="instagram">Instagram</mat-option>
              </mat-select>
              <button mat-stroked-button color="warn" (click)="retryAllDeadLetters()"
                      [disabled]="dlTotal() === 0">
                <mat-icon>replay</mat-icon> Повторить все
              </button>
            </div>

            <table mat-table [dataSource]="deadLetters()" class="dl-table">
              <ng-container matColumnDef="channel">
                <th mat-header-cell *matHeaderCellDef>Канал</th>
                <td mat-cell *matCellDef="let row">
                  <mat-icon [style.color]="getColor(row.channel)" style="font-size:16px;width:16px;height:16px">
                    {{ getIcon(row.channel) }}
                  </mat-icon>
                </td>
              </ng-container>
              <ng-container matColumnDef="content">
                <th mat-header-cell *matHeaderCellDef>Содержимое</th>
                <td mat-cell *matCellDef="let row">{{ row.content | slice:0:80 }}</td>
              </ng-container>
              <ng-container matColumnDef="last_error">
                <th mat-header-cell *matHeaderCellDef>Ошибка</th>
                <td mat-cell *matCellDef="let row" class="error-cell">{{ row.last_error | slice:0:60 }}</td>
              </ng-container>
              <ng-container matColumnDef="attempts">
                <th mat-header-cell *matHeaderCellDef>Попытки</th>
                <td mat-cell *matCellDef="let row">{{ row.attempts }}</td>
              </ng-container>
              <ng-container matColumnDef="created_at">
                <th mat-header-cell *matHeaderCellDef>Дата</th>
                <td mat-cell *matCellDef="let row">{{ formatDate(row.created_at) }}</td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let row">
                  <button mat-icon-button matTooltip="Повторить" (click)="retryOne(row.id)">
                    <mat-icon>replay</mat-icon>
                  </button>
                </td>
              </ng-container>

              <tr mat-header-row *matHeaderRowDef="dlColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: dlColumns"></tr>
            </table>

            <mat-paginator [length]="dlTotal()" [pageSize]="20" [pageSizeOptions]="[10, 20, 50]"
                           (page)="onDlPage($event)" />
          </mat-tab>
        </mat-tab-group>
      </div>

      <!-- Detail Panel (slide-in) -->
      @if (selectedChannel()) {
        <div class="detail-panel">
          <div class="detail-panel-header">
            <button mat-icon-button (click)="selectedChannel.set(null)">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <app-channel-health-detail [channel]="selectedChannel()!" />
        </div>
      }
    </div>
  `,
  styles: [`
    .channel-admin {
      max-width: 1000px;
      margin: 0 auto;
      padding: 16px;
      display: flex;
      gap: 16px;
      transition: max-width 0.2s;

      &.detail-open {
        max-width: 1400px;
      }
    }

    .main-panel { flex: 1; min-width: 0; }

    .detail-panel {
      width: 400px;
      flex-shrink: 0;
      border-left: 1px solid var(--crm-border, rgba(255,255,255,0.1));
      overflow-y: auto;
      max-height: calc(100vh - 120px);
    }

    .detail-panel-header {
      display: flex;
      justify-content: flex-end;
      padding: 4px;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;

      h2 { margin: 0; font-size: 20px; font-weight: 600; color: var(--crm-text-primary); }
    }

    .loading-state { display: flex; justify-content: center; padding: 48px; }

    .channel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
      padding: 16px 0;
    }

    .channel-card {
      border-top: 3px solid;
      padding: 16px;
      cursor: pointer;
      transition: box-shadow 0.15s, border-color 0.15s;

      &:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
      &.selected { box-shadow: 0 0 0 2px var(--crm-accent, #f59e0b); }

      &.health-border-healthy { border-top-color: #34d399; }
      &.health-border-degraded { border-top-color: #fbbf24; }
      &.health-border-down { border-top-color: #f87171; }
      &.health-border-idle { border-top-color: #6b7280; }
    }

    .ch-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;

      mat-icon { font-size: 24px; width: 24px; height: 24px; }
      .ch-name { flex: 1; font-size: 16px; font-weight: 600; color: var(--crm-text-primary); }
    }

    .health-badge {
      display: inline-flex;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;

      &.health-healthy { background: rgba(52, 211, 153, 0.15); color: #34d399; }
      &.health-degraded { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
      &.health-down { background: rgba(248, 113, 113, 0.15); color: #f87171; }
      &.health-idle { background: rgba(107, 114, 128, 0.15); color: #9ca3af; }
    }

    .ch-summary {
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin-bottom: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .signal-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
    }

    .signal-chip {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 2px 7px;
      border-radius: 10px;
      background: rgba(107, 114, 128, 0.14);
      color: var(--crm-text-secondary);
      font-size: 11px;
      font-weight: 600;
      line-height: 1;

      &.ok { background: rgba(52, 211, 153, 0.15); color: #34d399; }
      &.warning { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
      &.error { background: rgba(248, 113, 113, 0.15); color: #f87171; }
    }

    .ch-metrics {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 4px;
      margin-bottom: 8px;
    }

    .metric {
      text-align: center;
      .metric-value { display: block; font-size: 18px; font-weight: 600; color: var(--crm-text-primary); font-variant-numeric: tabular-nums; }
      .metric-value.fail { color: #f87171; }
      .metric-label { font-size: 10px; color: var(--crm-text-muted); text-transform: uppercase; }
    }

    .inbound-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 2px 0 8px;
      font-size: 11px;
      color: var(--crm-text-secondary);

      span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-width: 0;
      }

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
      .fail { color: #f87171; font-weight: 600; }
    }

    .delivery-rate {
      font-size: 12px;
      color: var(--crm-text-secondary);
      text-align: center;
    }

    .queue-info {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      font-size: 11px;
      color: var(--crm-accent, #f59e0b);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.warn { color: #fbbf24; }
    }

    .dl-toolbar {
      display: flex;
      gap: 12px;
      padding: 16px 0;
      align-items: center;

      mat-select { width: 160px; }
    }

    .dl-table { width: 100%; }
    .error-cell { color: #f87171; font-size: 12px; }

    .dl-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: #f87171;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      margin-left: 6px;
    }
  `],
})
export class ChannelAdminComponent implements OnInit, OnDestroy {
  private readonly api = inject(ChannelAdminApiService);
  private readonly ws = inject(WebSocketService);
  private readonly toast = inject(ToastService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly channels = signal<ChannelStatus[]>([]);
  readonly loading = signal(false);
  readonly deadLetters = signal<DeadLetterMessage[]>([]);
  readonly dlTotal = signal(0);
  readonly dlPage = signal(1);
  readonly dlChannelFilter = signal('');
  readonly selectedChannel = signal<string | null>(null);

  readonly dlColumns = ['channel', 'content', 'last_error', 'attempts', 'created_at', 'actions'];

  readonly getIcon = channelIcon;
  readonly getLabel = channelLabel;
  readonly getColor = channelColor;

  constructor() {
    // React to CB state changes from WebSocket
    effect(() => {
      const cbEvent = this.ws.channelCircuitBreaker();
      if (!cbEvent) return;
      this.channels.update(list =>
        list.map(ch =>
          ch.channel === cbEvent.channel
            ? {
                ...ch,
                circuitBreaker: {
                  state: cbEvent.state,
                  failures: cbEvent.failures,
                  lastError: cbEvent.lastError,
                  lastSuccessAt: cbEvent.lastSuccessAt,
                  lastFailureAt: cbEvent.lastFailureAt,
                },
              }
            : ch,
        ),
      );
    });

    // React to channel toggle events from WebSocket
    effect(() => {
      const statusEvent = this.ws.channelStatusChanged();
      if (!statusEvent) return;
      this.channels.update(list =>
        list.map(ch =>
          ch.channel === statusEvent.channel
            ? { ...ch, disabled: statusEvent.disabled }
            : ch,
        ),
      );
    });

    // React to health changes from WebSocket
    effect(() => {
      const healthEvent = this.ws.channelHealthChanged();
      if (!healthEvent) return;
      this.channels.update(list =>
        list.map(ch =>
          ch.channel === healthEvent.channel
            ? { ...ch, health: healthEvent.health as HealthLevel, summary: healthEvent.summary }
            : ch,
        ),
      );
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.ws.joinChannelAdmin();
      this.loadChannels();
      this.loadDeadLetters();
    }
  }

  ngOnDestroy(): void {
    this.ws.leaveChannelAdmin();
  }

  loadChannels(): void {
    this.loading.set(true);
    this.api.getChannels().subscribe({
      next: (res) => {
        if (res.success) this.channels.set(res.data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadDeadLetters(): void {
    this.api.getDeadLetters({
      page: this.dlPage(),
      limit: 20,
      channel: this.dlChannelFilter() || undefined,
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.deadLetters.set(res.data);
          this.dlTotal.set(res.pagination.total);
        }
      },
    });
  }

  selectChannel(channel: string): void {
    this.selectedChannel.set(this.selectedChannel() === channel ? null : channel);
  }

  toggleChannel(channel: string, enabled: boolean): void {
    this.api.toggleChannel(channel, enabled).subscribe({
      next: () => {
        this.toast.success(`${channelLabel(channel)} ${enabled ? 'включён' : 'выключен'}`);
        this.loadChannels();
      },
      error: () => this.toast.error('Не удалось переключить канал'),
    });
  }

  retryOne(id: string): void {
    this.api.retryDeadLetter(id).subscribe({
      next: () => {
        this.toast.success('Сообщение отправлено в очередь');
        this.loadDeadLetters();
      },
      error: () => this.toast.error('Ошибка при повторной отправке'),
    });
  }

  retryAllDeadLetters(): void {
    this.api.retryDeadLettersBatch({
      channel: this.dlChannelFilter() || undefined,
      limit: 50,
    }).subscribe({
      next: (res) => {
        if (res.success) {
          this.toast.success(`${res.data.retried} сообщений отправлено в очередь`);
          this.loadDeadLetters();
        }
      },
      error: () => this.toast.error('Ошибка при массовой повторной отправке'),
    });
  }

  deliveryRate(ch: ChannelStatus): number {
    const total = ch.metrics24h.sent;
    if (total === 0) return 0;
    return Math.round((ch.metrics24h.delivered / total) * 100);
  }

  telegramModeLabel(ch: ChannelStatus): string {
    const mode = ch.telegram?.mode;
    return mode === 'polling' ? 'Polling' : mode === 'webhook' ? 'Webhook' : 'Telegram';
  }

  telegramModeMismatch(ch: ChannelStatus): boolean {
    const tg = ch.telegram;
    if (!tg) return false;
    return (tg.mode === 'polling' && tg.webhookUrlSet) || (tg.mode === 'webhook' && !tg.webhookUrlSet);
  }

  inboundAgeLabel(ch: ChannelStatus): string {
    const last = ch.inbound?.lastReceivedAt || ch.inbound?.lastMessageAt;
    if (!last) return 'нет входящих';
    return this.timeAgo(last);
  }

  hasPipelineAlert(ch: ChannelStatus): boolean {
    const q = ch.queues;
    if (!q) return false;
    return q.inbound.waiting > 0 || q.inbound.failed > 0 || q.media.failed > 0 || q.mediaDlq.waiting > 0 || q.avScan.failed > 0;
  }

  pipelineAlertLabel(ch: ChannelStatus): string {
    const q = ch.queues;
    if (!q) return '';
    const parts: string[] = [];
    if (q.inbound.waiting > 0 || q.inbound.failed > 0) parts.push(`inbound ${q.inbound.waiting}/${q.inbound.failed}`);
    if (q.media.failed > 0 || q.mediaDlq.waiting > 0) parts.push(`media ${q.media.failed + q.mediaDlq.waiting}`);
    if (q.avScan.failed > 0) parts.push(`AV ${q.avScan.failed}`);
    return parts.join(' · ');
  }

  hasMediaAlert(ch: ChannelStatus): boolean {
    const media = ch.media;
    if (!media) return false;
    return media.failed24h > 0 || media.avError24h > 0 || media.avInfected24h > 0 || (!media.clamAv.available && (media.total24h > 0 || media.avPendingCount > 0));
  }

  mediaAlertLabel(ch: ChannelStatus): string {
    const media = ch.media;
    if (!media) return '';
    const parts: string[] = [];
    if (media.failed24h > 0) parts.push(`media failed ${media.failed24h}`);
    if (media.avError24h > 0) parts.push(`AV error ${media.avError24h}`);
    if (media.avInfected24h > 0) parts.push(`infected ${media.avInfected24h}`);
    if (!media.clamAv.available && (media.total24h > 0 || media.avPendingCount > 0)) parts.push('ClamAV недоступен');
    return parts.join(' · ');
  }

  healthLabel(level: HealthLevel): string {
    const labels: Record<string, string> = {
      healthy: 'OK',
      degraded: 'Деградация',
      down: 'Недоступен',
      idle: 'Нет активности',
    };
    return labels[level] || level;
  }

  timeAgo(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return '< 1 мин';
    if (ms < 3600_000) return `${Math.round(ms / 60_000)} мин`;
    if (ms < 86400_000) return `${Math.round(ms / 3600_000)} ч`;
    return `${Math.round(ms / 86400_000)} дн`;
  }

  onDlPage(event: PageEvent): void {
    this.dlPage.set(event.pageIndex + 1);
    this.loadDeadLetters();
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }
}
