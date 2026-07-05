import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe, JsonPipe, DecimalPipe } from '@angular/common';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatMenuModule } from '@angular/material/menu';
import { InfraApiService, Agent, SystemTelemetry, UpdateCommand } from '../../services/infra-api.service';
import { InfraRealtimeService } from '../../services/infra-realtime.service';

@Component({
  selector: 'app-infra-agent-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatIconModule, MatButtonModule, MatChipsModule,
    MatTabsModule, MatTableModule, MatSnackBarModule, MatTooltipModule,
    MatProgressBarModule, MatMenuModule,
    DatePipe, JsonPipe, DecimalPipe, RouterLink,
  ],
  template: `
    <div class="agent-detail">
      <div class="detail-header">
        <a mat-icon-button routerLink="/employee/infrastructure">
          <mat-icon>arrow_back</mat-icon>
        </a>
        @if (agent(); as a) {
          <div class="header-info">
            <h1>{{ a.name }}</h1>
            <div class="header-meta">
              <mat-chip>{{ a.agent_type }}</mat-chip>
              @if (a.health_status) {
                <mat-chip [class]="'health-' + a.health_status">
                  {{ a.health_status === 'healthy' ? 'Норма' : a.health_status === 'degraded' ? 'Деградация' : 'Проблема' }}
                </mat-chip>
              }
              <mat-icon [class.online]="a.is_online" [class.offline]="!a.is_online">
                {{ a.is_online ? 'cloud_done' : 'cloud_off' }}
              </mat-icon>
              <span>{{ a.studio_name }}</span>
            </div>
          </div>
          <div class="header-actions">
            <button mat-stroked-button (click)="restart()" [disabled]="!a.is_online">
              <mat-icon>restart_alt</mat-icon> Перезапустить
            </button>
            <button mat-stroked-button (click)="refreshData()">
              <mat-icon>refresh</mat-icon>
            </button>
          </div>
        }
      </div>

      @if (agent(); as a) {
        <div class="info-grid">
          <mat-card class="info-card">
            <h3>Общая информация</h3>
            <div class="info-row"><span>ID:</span> <code>{{ a.id }}</code></div>
            <div class="info-row"><span>Hostname:</span> {{ a.hostname ?? '—' }}</div>
            <div class="info-row"><span>Версия:</span> {{ a.current_version ?? '—' }}</div>
            @if (a.target_version && a.target_version !== a.current_version) {
              <div class="info-row"><span>Target:</span> <strong class="pending">{{ a.target_version }}</strong></div>
            }
            <div class="info-row"><span>ОС:</span> {{ a.os_version ?? '—' }} ({{ a.os_arch ?? '?' }})</div>
            <div class="info-row"><span>Uptime:</span> {{ formatUptime(a.uptime_seconds) }}</div>
            <div class="info-row"><span>Heartbeat:</span> {{ a.last_heartbeat_at ? (a.last_heartbeat_at | date:'dd.MM.yy HH:mm:ss') : '—' }}</div>
            <div class="info-row"><span>MQTT:</span> <code>{{ a.mqtt_username }}</code></div>
          </mat-card>

          <mat-card class="info-card">
            <h3>Конфигурация (v{{ a.config_version }})</h3>
            @if (configDiff()) {
              <div class="config-warning">
                <mat-icon>warning</mat-icon> desired != applied
              </div>
            }
            <pre class="config-json">{{ a.applied_config | json }}</pre>
          </mat-card>
        </div>

        @if (a.circuit_breakers) {
          <div class="circuit-breakers">
            <h3>Circuit Breakers</h3>
            <div class="cb-chips">
              @for (svc of objectKeys(a.circuit_breakers); track svc) {
                <mat-chip [class]="'cb-' + a.circuit_breakers![svc]">
                  {{ svc }}: {{ a.circuit_breakers![svc] === 'closed' ? 'OK' : a.circuit_breakers![svc] === 'open' ? 'Разомкнут' : 'Полуоткрыт' }}
                </mat-chip>
              }
            </div>
          </div>
        }

        <mat-tab-group animationDuration="200ms">
          <!-- System Telemetry -->
          <mat-tab label="Телеметрия">
            <div class="tab-content">
              @if (telemetry(); as t) {
                <div class="telemetry-grid">
                  <mat-card>
                    <span class="metric-label">CPU</span>
                    <span class="metric-value">{{ t.cpu_percent | number:'1.0-1' }}%</span>
                  </mat-card>
                  <mat-card>
                    <span class="metric-label">RAM</span>
                    <span class="metric-value">{{ t.memory_used_mb }} / {{ t.memory_total_mb }} MB</span>
                  </mat-card>
                  <mat-card>
                    <span class="metric-label">Disk</span>
                    <span class="metric-value">{{ t.disk_used_gb | number:'1.1-1' }} / {{ t.disk_total_gb | number:'1.1-1' }} GB</span>
                    @if (t.disk_smart_status) {
                      <span class="smart-badge" [class]="'smart-' + t.disk_smart_status">SMART: {{ t.disk_smart_status }}</span>
                    }
                  </mat-card>
                  <mat-card>
                    <span class="metric-label">Disk I/O</span>
                    @if (t.disk_iops_read !== null && t.disk_iops_read !== undefined) {
                      <div class="metric-row"><span class="metric-sub">Read:</span><span>{{ t.disk_iops_read }} IOPS</span></div>
                      <div class="metric-row"><span class="metric-sub">Write:</span><span>{{ t.disk_iops_write }} IOPS</span></div>
                      <div class="metric-row"><span class="metric-sub">Latency:</span><span>{{ t.disk_latency_ms | number:'1.1-1' }} ms</span></div>
                      <div class="metric-row"><span class="metric-sub">Queue:</span><span>{{ t.disk_queue_depth }}</span></div>
                    } @else {
                      <span class="no-data">нет данных</span>
                    }
                  </mat-card>
                  <mat-card>
                    <span class="metric-label">Network</span>
                    <span class="metric-value">{{ formatBytes(t.network_rx_bytes_sec) }}/s rx</span>
                  </mat-card>
                  <mat-card>
                    <span class="metric-label">Latency</span>
                    @if (t.network_latency_gateway_ms !== null && t.network_latency_gateway_ms !== undefined) {
                      <div class="metric-row"><span class="metric-sub">Gateway:</span><span [class.latency-warn]="(t.network_latency_gateway_ms ?? 0) > 50">{{ t.network_latency_gateway_ms | number:'1.0-0' }} ms</span></div>
                      <div class="metric-row"><span class="metric-sub">DNS:</span><span [class.latency-warn]="(t.network_latency_dns_ms ?? 0) > 100">{{ t.network_latency_dns_ms | number:'1.0-0' }} ms</span></div>
                      <div class="metric-row"><span class="metric-sub">MQTT:</span><span [class.latency-warn]="(t.network_latency_mqtt_ms ?? 0) > 200">{{ t.network_latency_mqtt_ms | number:'1.0-0' }} ms</span></div>
                      <div class="metric-row"><span class="metric-sub">Internet:</span><span [class.latency-warn]="(t.network_latency_internet_ms ?? 0) > 150">{{ t.network_latency_internet_ms | number:'1.0-0' }} ms</span></div>
                    } @else {
                      <span class="no-data">нет данных</span>
                    }
                  </mat-card>
                </div>
                <p class="telemetry-ts">Собрано: {{ t.collected_at | date:'dd.MM HH:mm:ss' }}</p>
              } @else {
                <div class="empty-state">Нет данных телеметрии</div>
              }
            </div>
          </mat-tab>

          <!-- Update History -->
          <mat-tab label="Обновления">
            <div class="tab-content">
              <table mat-table [dataSource]="updates()" class="updates-table">
                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>Статус</th>
                  <td mat-cell *matCellDef="let u">
                    <mat-chip [class]="'update-' + u.status">{{ u.status }}</mat-chip>
                  </td>
                </ng-container>
                <ng-container matColumnDef="version">
                  <th mat-header-cell *matHeaderCellDef>Версия</th>
                  <td mat-cell *matCellDef="let u">{{ u.previous_version ?? '?' }} &rarr; ?</td>
                </ng-container>
                <ng-container matColumnDef="progress">
                  <th mat-header-cell *matHeaderCellDef>Прогресс</th>
                  <td mat-cell *matCellDef="let u">
                    @if (u.status === 'downloading' || u.status === 'installing') {
                      <mat-progress-bar mode="determinate" [value]="u.progress_percent ?? 0"></mat-progress-bar>
                      <span style="font-size:11px">{{ u.progress_percent ?? 0 }}%</span>
                    } @else if (u.status === 'completed') {
                      <mat-icon style="color:#4caf50;font-size:18px">check_circle</mat-icon>
                    } @else if (u.status === 'failed') {
                      <mat-icon style="color:#f44336;font-size:18px">error</mat-icon>
                    }
                  </td>
                </ng-container>
                <ng-container matColumnDef="initiated_at">
                  <th mat-header-cell *matHeaderCellDef>Дата</th>
                  <td mat-cell *matCellDef="let u">{{ u.initiated_at | date:'dd.MM HH:mm' }}</td>
                </ng-container>
                <ng-container matColumnDef="error">
                  <th mat-header-cell *matHeaderCellDef>Ошибка</th>
                  <td mat-cell *matCellDef="let u" style="font-size:12px;color:#c62828;max-width:200px;overflow:hidden;text-overflow:ellipsis">{{ u.error_message ?? '' }}</td>
                </ng-container>
                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let u">
                    @if (u.status === 'completed' || u.status === 'failed') {
                      <button mat-icon-button (click)="rollbackUpdate(u)" matTooltip="Откатить">
                        <mat-icon>undo</mat-icon>
                      </button>
                    }
                  </td>
                </ng-container>
                <tr mat-header-row *matHeaderRowDef="updateColumns"></tr>
                <tr mat-row *matRowDef="let row; columns: updateColumns"></tr>
              </table>
              @if (updates().length === 0) {
                <div class="empty-state">Нет истории обновлений</div>
              }
            </div>
          </mat-tab>
        </mat-tab-group>
      } @else {
        <div class="loading">Загрузка...</div>
      }
    </div>
  `,
  styles: [`
    .agent-detail { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .detail-header {
      display: flex; align-items: center; gap: 12px; margin-bottom: 24px;
    }
    .header-info { flex: 1; }
    .header-info h1 { margin: 0; font-size: 22px; font-weight: 600; }
    .header-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .header-actions { display: flex; gap: 8px; }

    .info-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px;
    }
    .info-card { padding: 16px; }
    .info-card h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
    .info-row { display: flex; gap: 8px; margin-bottom: 6px; font-size: 13px; }
    .info-row span:first-child { color: var(--mat-sys-outline); min-width: 80px; }
    .info-row code { font-family: monospace; font-size: 12px; background: rgba(0,0,0,.04); padding: 2px 4px; border-radius: 3px; }
    .pending { color: #ff9800; }

    .config-json { font-size: 12px; background: rgba(0,0,0,.03); padding: 12px; border-radius: 6px; overflow-x: auto; max-height: 200px; }
    .config-warning { display: flex; align-items: center; gap: 6px; color: #ff9800; font-size: 13px; margin-bottom: 8px; }

    .tab-content { padding: 16px 0; }
    .telemetry-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;
    }
    .telemetry-grid mat-card { padding: 16px; text-align: center; }
    .metric-label { display: block; font-size: 12px; color: var(--mat-sys-outline); margin-bottom: 4px; }
    .metric-value { font-size: 18px; font-weight: 600; }
    .telemetry-ts { font-size: 12px; color: var(--mat-sys-outline); margin-top: 8px; }

    .updates-table { width: 100%; }
    .online { color: #4caf50; }
    .offline { color: #9e9e9e; }
    .health-healthy { --mdc-chip-elevated-container-color: #e8f5e9; color: #2e7d32; }
    .health-degraded { --mdc-chip-elevated-container-color: #fff3e0; color: #e65100; }
    .health-unhealthy { --mdc-chip-elevated-container-color: #ffebee; color: #c62828; }
    .metric-row { display: flex; justify-content: space-between; margin: 2px 0; }
    .metric-sub { font-size: 11px; color: var(--mat-sys-outline); }
    .no-data { color: var(--mat-sys-outline); font-style: italic; font-size: 12px; }
    .latency-warn { color: #ff9800; font-weight: 600; }
    .smart-badge { display: block; font-size: 11px; margin-top: 4px; padding: 2px 8px; border-radius: 8px; text-align: center; }
    .smart-healthy { background: #e8f5e9; color: #2e7d32; }
    .smart-warning { background: #fff3e0; color: #e65100; }
    .smart-critical { background: #ffebee; color: #c62828; }
    .circuit-breakers { margin-bottom: 24px; }
    .circuit-breakers h3 { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
    .cb-chips { display: flex; flex-wrap: wrap; gap: 8px; }
    .cb-closed { --mdc-chip-elevated-container-color: #e8f5e9; color: #2e7d32; }
    .cb-open { --mdc-chip-elevated-container-color: #ffebee; color: #c62828; }
    .cb-half_open { --mdc-chip-elevated-container-color: #fff3e0; color: #e65100; }

    .empty-state { text-align: center; padding: 40px; color: var(--mat-sys-outline); }
    .loading { text-align: center; padding: 60px; }

    @media (max-width: 768px) {
      .info-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class InfraAgentDetailComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(InfraApiService);
  private readonly realtime = inject(InfraRealtimeService);
  private readonly snack = inject(MatSnackBar);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  readonly agent = signal<Agent | null>(null);
  readonly telemetry = signal<SystemTelemetry | null>(null);
  readonly updates = signal<UpdateCommand[]>([]);

  readonly configDiff = computed(() => {
    const a = this.agent();
    if (!a) return false;
    return JSON.stringify(a.desired_config) !== JSON.stringify(a.applied_config);
  });

  readonly updateColumns = ['status', 'version', 'progress', 'initiated_at', 'error', 'actions'];

  // Real-time update progress
  private readonly updateProgressEffect = effect(() => {
    const progress = this.realtime.updateProgress();
    if (!progress || progress.type !== 'agent_update' || !progress.command_id) return;
    this.updates.update(list =>
      list.map(u =>
        u.id === progress.command_id
          ? { ...u, status: (progress.status ?? u.status) as UpdateCommand['status'], progress_percent: progress.progress_percent ?? u.progress_percent }
          : u
      )
    );
  });

  ngOnInit(): void {
    const id = this.route.snapshot.params['id'];
    if (id) {
      this.loadAgent(id);
      this.refreshTimer = setInterval(() => this.loadAgent(id), 30_000);
    }

    // Subscribe to real-time telemetry — auto-update when Device Monitor pushes metrics
    this.realtime.subscribe();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.realtime.unsubscribe();
  }

  refreshData(): void {
    const id = this.agent()?.id;
    if (id) this.loadAgent(id);
  }

  private loadAgent(id: string): void {
    this.api.getAgent(id).subscribe(agent => {
      this.agent.set(agent);
      if (agent.agent_type === 'monitor') {
        this.api.getSystemTelemetry(id).subscribe(t => this.telemetry.set(t));
      }
    });
    this.api.getUpdates().subscribe(updates => {
      this.updates.set(updates.filter(u => u.agent_id === id));
    });
  }

  restart(): void {
    const id = this.agent()?.id;
    if (!id) return;
    this.api.restartAgent(id).subscribe({
      next: r => this.snack.open(r.message, '', { duration: 3000 }),
      error: () => this.snack.open('Ошибка', '', { duration: 3000 }),
    });
  }

  formatUptime(seconds: number | null): string {
    if (!seconds) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}д ${h}ч`;
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
  }

  rollbackUpdate(update: UpdateCommand): void {
    this.api.rollbackUpdate(update.id).subscribe({
      next: result => {
        this.snack.open('Откат запущен', '', { duration: 3000 });
        this.updates.update(list => {
          const updated = list.map(u => u.id === update.id ? { ...u, status: 'rolled_back' as const } : u);
          return [result.rollback_command, ...updated];
        });
      },
      error: (e: { error?: { message?: string } }) => this.snack.open(e?.error?.message ?? 'Ошибка отката', '', { duration: 4000 }),
    });
  }

  objectKeys(obj: Record<string, unknown>): string[] { return Object.keys(obj); }

  formatBytes(bytes: number | null): string {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
}
