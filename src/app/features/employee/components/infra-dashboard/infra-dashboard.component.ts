import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { MatTabsModule } from '@angular/material/tabs';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTableModule } from '@angular/material/table';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  InfraApiService,
  Agent, InfraAlert, FleetOverview, FleetHealth,
  AgentType, AlertSeverity, AlertRule,
} from '../../services/infra-api.service';
import { InfraRealtimeService } from '../../services/infra-realtime.service';

const AGENT_TYPE_LABELS: Record<string, string> = {
  print: 'Принтер',
  pos: 'Касса',
  monitor: 'Монитор',
  guard: 'Защита',
};

const OPERATOR_LABELS: Record<string, string> = {
  '=': '=',
  '>': '>',
  '<': '<',
  '>=': '≥',
  '<=': '≤',
  '!=': '≠',
};

@Component({
  selector: 'app-infra-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatTabsModule, MatCardModule, MatIconModule, MatButtonModule,
    MatChipsModule, MatBadgeModule, MatTableModule, MatMenuModule,
    MatSnackBarModule, MatTooltipModule, MatSelectModule, MatSlideToggleModule,
    FormsModule, DatePipe, RouterLink,
  ],
  template: `
    <div class="infra-dashboard">
      <div class="dashboard-header">
        <h1>Инфраструктура</h1>
        <div class="header-actions">
          <a mat-stroked-button routerLink="/employee/infrastructure/releases">
            <mat-icon>system_update</mat-icon> Releases
          </a>
          <button mat-stroked-button (click)="refresh()">
            <mat-icon>refresh</mat-icon> Обновить
          </button>
        </div>
      </div>

      <!-- Summary -->
      <div class="health-cards">
        <mat-card class="health-card" [class.healthy]="healthStatus() === 'healthy'"
                  [class.degraded]="healthStatus() === 'degraded'"
                  [class.critical]="healthStatus() === 'critical'">
          <mat-icon>{{ healthStatus() === 'healthy' ? 'check_circle' : healthStatus() === 'degraded' ? 'warning' : 'error' }}</mat-icon>
          <div class="card-content">
            <span class="card-value">{{ healthLabel() }}</span>
            <span class="card-label">Статус</span>
          </div>
        </mat-card>
        <mat-card class="health-card">
          <mat-icon>devices</mat-icon>
          <div class="card-content">
            <span class="card-value">{{ overview()?.totals?.online_agents ?? 0 }} / {{ overview()?.totals?.total_agents ?? 0 }}</span>
            <span class="card-label">Агентов онлайн</span>
          </div>
        </mat-card>
        <mat-card class="health-card" [class.has-alerts]="(health()?.critical_alerts ?? 0) > 0">
          <mat-icon>notification_important</mat-icon>
          <div class="card-content">
            <span class="card-value">{{ health()?.critical_alerts ?? 0 }}</span>
            <span class="card-label">Критических алертов</span>
          </div>
        </mat-card>
      </div>

      <mat-tab-group [(selectedIndex)]="activeTab" animationDuration="200ms">
        <!-- TAB: Agents -->
        <mat-tab label="Агенты">
          <div class="tab-content">
            <div class="tab-toolbar">
              <mat-select placeholder="Тип" (selectionChange)="filterType.set($event.value)" [value]="filterType()">
                <mat-option [value]="null">Все</mat-option>
                <mat-option value="print">Принтер</mat-option>
                <mat-option value="pos">Касса</mat-option>
                <mat-option value="monitor">Монитор</mat-option>
                <mat-option value="guard">Защита</mat-option>
              </mat-select>
              <mat-select placeholder="Статус" (selectionChange)="filterOnline.set($event.value)" [value]="filterOnline()">
                <mat-option [value]="null">Все</mat-option>
                <mat-option [value]="true">Онлайн</mat-option>
                <mat-option [value]="false">Офлайн</mat-option>
              </mat-select>
            </div>
            <table mat-table [dataSource]="filteredAgents()" class="agents-table">
              <ng-container matColumnDef="status">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let a">
                  <div class="status-dot" [class.online]="a.is_online" [class.offline]="!a.is_online"
                       [matTooltip]="a.is_online ? 'Онлайн' : 'Офлайн'"></div>
                </td>
              </ng-container>
              <ng-container matColumnDef="name">
                <th mat-header-cell *matHeaderCellDef>Агент</th>
                <td mat-cell *matCellDef="let a">
                  <div class="agent-name">{{ a.name }}</div>
                  <div class="agent-studio">{{ a.studio_name }}</div>
                </td>
              </ng-container>
              <ng-container matColumnDef="type">
                <th mat-header-cell *matHeaderCellDef>Тип</th>
                <td mat-cell *matCellDef="let a">
                  <span class="type-badge" [attr.data-type]="a.agent_type">{{ agentTypeLabel(a.agent_type) }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="health">
                <th mat-header-cell *matHeaderCellDef>Здоровье</th>
                <td mat-cell *matCellDef="let a">
                  @if (a.health_status) {
                    <span class="health-badge" [attr.data-health]="a.health_status">
                      {{ a.health_status === 'healthy' ? 'OK' : a.health_status === 'degraded' ? 'Дегр.' : 'Сбой' }}
                    </span>
                  } @else {
                    —
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="version">
                <th mat-header-cell *matHeaderCellDef>Версия</th>
                <td mat-cell *matCellDef="let a">
                  {{ a.current_version ?? '—' }}
                </td>
              </ng-container>
              <ng-container matColumnDef="heartbeat">
                <th mat-header-cell *matHeaderCellDef>Heartbeat</th>
                <td mat-cell *matCellDef="let a">
                  @if (a.last_heartbeat_at) {
                    <span [class.stale]="isStale(a.last_heartbeat_at)"
                          [matTooltip]="a.last_heartbeat_at | date:'dd.MM.yyyy HH:mm:ss'">
                      {{ relativeTime(a.last_heartbeat_at) }}
                    </span>
                  } @else {
                    <span class="no-data">—</span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="actions">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let a">
                  <button mat-icon-button [matMenuTriggerFor]="agentMenu">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #agentMenu="matMenu">
                    <a mat-menu-item [routerLink]="['/employee/infrastructure/agents', a.id]">
                      <mat-icon>info</mat-icon> Подробности
                    </a>
                    <button mat-menu-item (click)="restartAgent(a)" [disabled]="!a.is_online">
                      <mat-icon>restart_alt</mat-icon> Перезапустить
                    </button>
                  </mat-menu>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="agentColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: agentColumns"
                  [class.agent-offline]="!row.is_online"></tr>
            </table>
            @if (filteredAgents().length === 0) {
              <div class="empty-state">Нет агентов</div>
            }
          </div>
        </mat-tab>

        <!-- TAB: Alerts -->
        <mat-tab>
          <ng-template mat-tab-label>
            Алерты
            @if (unresolvedAlertCount() > 0) {
              <mat-badge [matBadge]="unresolvedAlertCount()" matBadgeColor="warn" matBadgeSize="small"></mat-badge>
            }
          </ng-template>
          <div class="tab-content">
            <div class="tab-toolbar">
              <mat-select placeholder="Severity" (selectionChange)="alertSeverityFilter.set($event.value)" [value]="alertSeverityFilter()">
                <mat-option [value]="null">Все</mat-option>
                <mat-option value="critical">Критические</mat-option>
                <mat-option value="warning">Предупреждения</mat-option>
                <mat-option value="info">Информационные</mat-option>
              </mat-select>
              <mat-slide-toggle [ngModel]="showResolved()" (ngModelChange)="showResolved.set($event)">
                Показать закрытые
              </mat-slide-toggle>
            </div>
            @for (alert of filteredAlerts(); track alert.id) {
              <div class="alert-card" [class]="'severity-' + alert.severity"
                   [class.resolved]="!!alert.resolved_at">
                <mat-icon class="alert-icon">{{ alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warning' : 'info' }}</mat-icon>
                <div class="alert-body">
                  <div class="alert-title">{{ alert.title }}</div>
                  <div class="alert-meta">
                    {{ alert.studio_name }}
                    @if (alert.agent_name) { / {{ alert.agent_name }} }
                    — {{ alert.created_at | date:'dd.MM HH:mm' }}
                    @if (alert.resolved_at) {
                      <span class="resolved-badge">закрыт</span>
                    }
                  </div>
                </div>
                <div class="alert-actions">
                  @if (!alert.is_acknowledged && !alert.resolved_at) {
                    <button mat-stroked-button (click)="acknowledgeAlertItem(alert.id)">Принять</button>
                  }
                  @if (!alert.resolved_at) {
                    <button mat-flat-button color="primary" (click)="resolveAlertItem(alert.id)">Закрыть</button>
                  }
                </div>
              </div>
            } @empty {
              <div class="empty-state">
                <mat-icon>check_circle</mat-icon>
                <p>Нет активных алертов</p>
              </div>
            }
          </div>
        </mat-tab>

        <!-- TAB: Alert Rules -->
        <mat-tab label="Правила">
          <div class="tab-content">
            <table mat-table [dataSource]="alertRules()" class="rules-table">
              <ng-container matColumnDef="alert_type">
                <th mat-header-cell *matHeaderCellDef>Правило</th>
                <td mat-cell *matCellDef="let r">
                  <div class="rule-name">{{ ruleTypeLabel(r.alert_type) }}</div>
                  <div class="rule-target">{{ r.agent_type ? agentTypeLabel(r.agent_type) : 'Все агенты' }}</div>
                </td>
              </ng-container>
              <ng-container matColumnDef="severity">
                <th mat-header-cell *matHeaderCellDef>Уровень</th>
                <td mat-cell *matCellDef="let r">
                  <span class="severity-badge" [attr.data-severity]="r.severity">{{ severityLabel(r.severity) }}</span>
                </td>
              </ng-container>
              <ng-container matColumnDef="condition">
                <th mat-header-cell *matHeaderCellDef>Условие</th>
                <td mat-cell *matCellDef="let r">{{ formatCondition(r.condition_config) }}</td>
              </ng-container>
              <ng-container matColumnDef="channels">
                <th mat-header-cell *matHeaderCellDef>Каналы</th>
                <td mat-cell *matCellDef="let r">
                  @for (ch of getChannels(r.notification_channels); track ch) {
                    <span class="channel-tag">{{ channelLabel(ch) }}</span>
                  }
                </td>
              </ng-container>
              <ng-container matColumnDef="cooldown">
                <th mat-header-cell *matHeaderCellDef>Пауза</th>
                <td mat-cell *matCellDef="let r">{{ r.cooldown_minutes ?? 30 }} мин</td>
              </ng-container>
              <ng-container matColumnDef="active">
                <th mat-header-cell *matHeaderCellDef></th>
                <td mat-cell *matCellDef="let r">
                  <mat-slide-toggle [ngModel]="r.is_active" (ngModelChange)="toggleRule(r, $event)"></mat-slide-toggle>
                </td>
              </ng-container>
              <tr mat-header-row *matHeaderRowDef="ruleColumns"></tr>
              <tr mat-row *matRowDef="let row; columns: ruleColumns"></tr>
            </table>
          </div>
        </mat-tab>
      </mat-tab-group>
    </div>
  `,
  styles: [`
    .infra-dashboard { padding: 24px; max-width: 1200px; margin: 0 auto; }

    .dashboard-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 20px;
    }
    .dashboard-header h1 { font-size: 22px; font-weight: 600; margin: 0; }
    .header-actions { display: flex; gap: 8px; }

    /* ── Summary cards ── */
    .health-cards {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 16px; margin-bottom: 24px;
    }
    .health-card {
      display: flex; align-items: center; gap: 12px; padding: 16px;
    }
    .health-card mat-icon { font-size: 32px; width: 32px; height: 32px; color: var(--mat-sys-outline); }
    .health-card.healthy mat-icon { color: #4caf50; }
    .health-card.degraded mat-icon { color: #ff9800; }
    .health-card.critical mat-icon, .health-card.has-alerts mat-icon { color: #f44336; }
    .card-content { display: flex; flex-direction: column; }
    .card-value { font-size: 20px; font-weight: 600; }
    .card-label { font-size: 12px; color: var(--mat-sys-outline); }

    /* ── Tabs ── */
    .tab-content { padding: 16px 0; }
    .tab-toolbar {
      display: flex; gap: 12px; margin-bottom: 16px; align-items: center;
    }
    .tab-toolbar mat-select { width: 150px; }

    /* ── Agents table ── */
    .agents-table { width: 100%; }
    .status-dot {
      width: 10px; height: 10px; border-radius: 50%;
    }
    .status-dot.online { background: #4caf50; box-shadow: 0 0 6px rgba(76, 175, 80, 0.5); }
    .status-dot.offline { background: #616161; }
    .agent-name { font-weight: 500; }
    .agent-studio { font-size: 12px; color: var(--mat-sys-outline); }
    .agent-offline { opacity: 0.55; }

    .type-badge {
      display: inline-block; padding: 2px 10px; border-radius: 12px;
      font-size: 12px; font-weight: 500;
      background: var(--mat-sys-surface-variant); color: var(--mat-sys-on-surface-variant);
    }
    .type-badge[data-type="print"] { background: #e3f2fd; color: #1565c0; }
    .type-badge[data-type="pos"] { background: #e8f5e9; color: #2e7d32; }
    .type-badge[data-type="monitor"] { background: #fff3e0; color: #e65100; }
    .type-badge[data-type="guard"] { background: #fce4ec; color: #c62828; }

    .stale { color: #ff9800; }
    .no-data { color: var(--mat-sys-outline); }

    /* ── Alerts ── */
    .alert-card {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 12px 16px; margin-bottom: 8px;
      border-left: 4px solid; border-radius: 4px;
      background: var(--mat-sys-surface-container);
    }
    .alert-card.severity-critical { border-left-color: #f44336; }
    .alert-card.severity-warning { border-left-color: #ff9800; }
    .alert-card.severity-info { border-left-color: #2196f3; }
    .alert-card.resolved { opacity: 0.45; }
    .alert-icon { flex-shrink: 0; margin-top: 2px; }
    .alert-card.severity-critical .alert-icon { color: #f44336; }
    .alert-card.severity-warning .alert-icon { color: #ff9800; }
    .alert-card.severity-info .alert-icon { color: #2196f3; }
    .alert-body { flex: 1; min-width: 0; }
    .alert-title { font-weight: 500; }
    .alert-meta { font-size: 12px; color: var(--mat-sys-outline); margin-top: 2px; }
    .resolved-badge {
      display: inline-block; padding: 1px 6px; border-radius: 8px;
      background: #4caf50; color: #fff; font-size: 10px; margin-left: 6px;
    }
    .alert-actions { display: flex; gap: 8px; flex-shrink: 0; }

    /* ── Rules table ── */
    .rules-table { width: 100%; }
    .rule-name { font-weight: 500; }
    .rule-target { font-size: 12px; color: var(--mat-sys-outline); }

    .severity-badge {
      display: inline-block; padding: 2px 10px; border-radius: 12px;
      font-size: 12px; font-weight: 500;
    }
    .severity-badge[data-severity="critical"] { background: #ffebee; color: #c62828; }
    .severity-badge[data-severity="warning"] { background: #fff3e0; color: #e65100; }
    .severity-badge[data-severity="info"] { background: #e3f2fd; color: #1565c0; }

    .channel-tag {
      display: inline-block; padding: 2px 8px; border-radius: 8px;
      font-size: 11px; background: var(--mat-sys-surface-variant); margin-right: 4px;
    }

    .health-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
    .health-badge[data-health="healthy"] { background: #e8f5e9; color: #2e7d32; }
    .health-badge[data-health="degraded"] { background: #fff3e0; color: #e65100; }
    .health-badge[data-health="unhealthy"] { background: #ffebee; color: #c62828; }

    .empty-state {
      text-align: center; padding: 48px 16px; color: var(--mat-sys-outline);
    }
    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }
    .empty-state p { margin: 8px 0 0; }
  `],
})
export class InfraDashboardComponent implements OnInit, OnDestroy {
  private readonly api = inject(InfraApiService);
  private readonly realtime = inject(InfraRealtimeService);
  private readonly snack = inject(MatSnackBar);

  activeTab = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  // Data
  readonly agents = signal<Agent[]>([]);
  readonly alerts = signal<InfraAlert[]>([]);
  readonly alertRules = signal<AlertRule[]>([]);
  readonly overview = signal<FleetOverview | null>(null);
  readonly health = signal<FleetHealth | null>(null);

  // Filters — agents
  readonly filterType = signal<AgentType | null>(null);
  readonly filterOnline = signal<boolean | null>(null);

  // Filters — alerts
  readonly alertSeverityFilter = signal<AlertSeverity | null>(null);
  readonly showResolved = signal(false);

  // Computed
  readonly healthStatus = computed(() => this.health()?.status ?? 'healthy');
  readonly healthLabel = computed(() => {
    const s = this.healthStatus();
    return s === 'healthy' ? 'Норма' : s === 'degraded' ? 'Деградация' : 'Критично';
  });
  readonly unresolvedAlertCount = computed(() => this.alerts().filter(a => !a.resolved_at).length);

  readonly filteredAgents = computed(() => {
    let list = this.agents();
    const t = this.filterType();
    const o = this.filterOnline();
    if (t) list = list.filter(a => a.agent_type === t);
    if (o !== null) list = list.filter(a => a.is_online === o);
    return list;
  });

  readonly filteredAlerts = computed(() => {
    let list = this.alerts();
    const sev = this.alertSeverityFilter();
    const resolved = this.showResolved();
    if (sev) list = list.filter(a => a.severity === sev);
    if (!resolved) list = list.filter(a => !a.resolved_at);
    return list;
  });

  readonly agentColumns = ['status', 'name', 'type', 'health', 'version', 'heartbeat', 'actions'];
  readonly ruleColumns = ['alert_type', 'severity', 'condition', 'channels', 'cooldown', 'active'];

  // Real-time: alert push
  private readonly alertPushEffect = effect(() => {
    const alert = this.realtime.lastAlert();
    if (!alert) return;

    if ((alert as Record<string, unknown>)['action'] === 'auto_resolved') {
      const agentId = (alert as Record<string, unknown>)['agent_id'] as string;
      this.alerts.update(list =>
        list.map(a =>
          a.agent_id === agentId && a.alert_type === 'heartbeat_timeout' && !a.resolved_at
            ? { ...a, resolved_at: new Date().toISOString() }
            : a
        )
      );
      return;
    }

    if (alert.title) {
      const newAlert: InfraAlert = {
        id: (alert as Record<string, unknown>)['id'] as number ?? Date.now(),
        studio_id: alert.studio_id,
        agent_id: (alert as Record<string, unknown>)['agent_id'] as string ?? null,
        alert_type: alert.alert_type,
        severity: alert.severity as AlertSeverity,
        title: alert.title,
        details: {},
        is_acknowledged: false,
        acknowledged_by: null,
        acknowledged_at: null,
        resolved_at: null,
        created_at: new Date().toISOString(),
        studio_name: null,
        agent_name: null,
      };
      this.alerts.update(list => [newAlert, ...list]);
      this.snack.open(`Алерт: ${alert.title}`, '', { duration: 5000 });
    }
  });

  // Real-time: heartbeat → update agent online status
  private readonly heartbeatEffect = effect(() => {
    const hb = this.realtime.lastHeartbeat();
    if (!hb) return;
    this.agents.update(list =>
      list.map(a =>
        a.id === hb.agent_id ? { ...a, is_online: hb.is_online } : a
      )
    );
  });

  ngOnInit(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), 30_000);
    this.realtime.subscribe();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.realtime.unsubscribe();
  }

  refresh(): void {
    this.api.getAgents().subscribe(agents => this.agents.set(agents));
    this.api.getAlerts({ limit: 100 }).subscribe(alerts => this.alerts.set(alerts));
    this.api.getFleetOverview().subscribe(o => this.overview.set(o));
    this.api.getFleetHealth().subscribe(h => this.health.set(h));
    this.api.getAlertRules().subscribe(r => this.alertRules.set(r));
  }

  restartAgent(agent: Agent): void {
    this.api.restartAgent(agent.id).subscribe({
      next: r => this.snack.open(r.message, '', { duration: 3000 }),
      error: () => this.snack.open('Ошибка перезапуска', '', { duration: 3000 }),
    });
  }

  acknowledgeAlertItem(id: number): void {
    this.api.acknowledgeAlert(id).subscribe(() => {
      this.alerts.update(list => list.map(a => a.id === id ? { ...a, is_acknowledged: true } : a));
    });
  }

  resolveAlertItem(id: number): void {
    this.api.resolveAlert(id).subscribe(() => {
      this.alerts.update(list => list.map(a => a.id === id ? { ...a, resolved_at: new Date().toISOString() } : a));
    });
  }

  toggleRule(rule: AlertRule, active: boolean): void {
    this.api.updateAlertRule(rule.id, { is_active: active }).subscribe({
      next: updated => {
        this.alertRules.update(list => list.map(r => r.id === rule.id ? updated : r));
        this.snack.open(`Правило ${active ? 'включено' : 'выключено'}`, '', { duration: 2000 });
      },
      error: () => this.snack.open('Ошибка обновления правила', '', { duration: 3000 }),
    });
  }

  agentTypeLabel(type: string): string {
    return AGENT_TYPE_LABELS[type] ?? type;
  }

  ruleTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      heartbeat_timeout: 'Нет heartbeat',
      defender_realtime_off: 'Антивирус выключен',
      quarantine_spike: 'Всплеск карантина',
      threat_detected: 'Обнаружена угроза',
      disk_space_critical: 'Диск заполнен',
      disk_space_low: 'Мало места на диске',
      memory_high: 'Высокое потребление RAM',
      transaction_failure: 'Ошибка транзакции',
      print_error_rate: 'Ошибки печати',
      camera_offline: 'Камера недоступна',
      ssh_tunnel_down: 'SSH-туннель недоступен',
    };
    return labels[type] ?? type.replace(/_/g, ' ');
  }

  severityLabel(sev: string): string {
    return sev === 'critical' ? 'Крит.' : sev === 'warning' ? 'Внимание' : 'Инфо';
  }

  channelLabel(ch: string): string {
    const labels: Record<string, string> = { telegram: 'Telegram', crm: 'CRM', email: 'Email', slack: 'Slack' };
    return labels[ch] ?? ch;
  }

  formatCondition(config: Record<string, unknown>): string {
    const parts: string[] = [];

    // metric + operator + threshold format (from alert_rules)
    if (config['metric'] != null) {
      const metric = this.metricLabel(config['metric'] as string);
      const op = OPERATOR_LABELS[config['operator'] as string] ?? config['operator'] ?? '';
      const threshold = config['threshold'];
      parts.push(`${metric} ${op} ${threshold}`);
    }

    if (config['threshold_seconds'] != null) parts.push(`таймаут: ${config['threshold_seconds']}с`);
    if (config['threshold_percent'] != null) parts.push(`порог: ${config['threshold_percent']}%`);
    if (config['consecutive_failures'] != null) parts.push(`ошибок подряд: ${config['consecutive_failures']}`);
    if (config['window_minutes'] != null) parts.push(`окно: ${config['window_minutes']} мин`);
    if (config['timeout'] != null) parts.push(`таймаут: ${config['timeout']}с`);

    return parts.join(', ') || '—';
  }

  relativeTime(isoDate: string): string {
    const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
    if (diff < 60) return `${diff}с назад`;
    if (diff < 3600) return `${Math.floor(diff / 60)}м назад`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}ч назад`;
    return `${Math.floor(diff / 86400)}д назад`;
  }

  isStale(isoDate: string): boolean {
    return Date.now() - new Date(isoDate).getTime() > 180_000; // 3 min
  }

  getChannels(channels: string[]): string[] {
    return Array.isArray(channels) ? channels : [];
  }

  private metricLabel(metric: string): string {
    const labels: Record<string, string> = {
      defender_realtime: 'Защита реального времени',
      files_quarantined: 'Файлов в карантине',
      threat_count: 'Угрозы',
      disk_usage_percent: 'Диск %',
      memory_usage_percent: 'RAM %',
      error_rate: 'Процент ошибок',
    };
    return labels[metric] ?? metric;
  }
}
