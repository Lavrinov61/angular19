import {
  ChangeDetectionStrategy, Component, computed, effect, inject,
  input, signal, OnInit, OnDestroy,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  InfraApiService,
  Agent, InfraAlert, InfraLocation, SystemTelemetry,
} from '../../services/infra-api.service';
import { InfraRealtimeService } from '../../services/infra-realtime.service';
import {
  PrintApiService, BridgePrinterStatus, Printer, PrintJob,
} from '../../services/print-api.service';

// ─── Local helper types ──────────────────────────────────

interface PcCard {
  agent: Agent;
  telemetry: SystemTelemetry | null;
  childAgents: Agent[];
}

interface PrinterCard {
  printer: Printer;
  bridgeStatus: BridgePrinterStatus | null;
  lastJob: PrintJob | null;
  queueCount: number;
}

interface SecuritySummary {
  defenderRealtime: boolean | null;
  defenderDefinitionsDate: string | null;
  lastScanDate: string | null;
  threatsFound: number;
  cdrBaselineDate: string | null;
  cdrChanges: number;
  alerts: InfraAlert[];
}

@Component({
  selector: 'app-studio-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule, MatButtonModule, MatSnackBarModule, MatTooltipModule, MatMenuModule,
    DatePipe, DecimalPipe, RouterLink,
  ],
  template: `
    <div class="page">

      <!-- Breadcrumb -->
      <nav class="breadcrumb">
        <a routerLink="/employee/infrastructure">Инфраструктура</a>
        <span class="sep">/</span>
        <span>Точки</span>
        <span class="sep">/</span>
        @if (location(); as loc) {
          <span class="current">{{ loc.name }}</span>
        }
      </nav>

      <!-- Studio Header -->
      @if (location(); as loc) {
        <header class="studio-header">
          <div class="studio-info">
            <h1>{{ loc.name }}</h1>
            <div class="address">{{ loc.address ?? '' }}</div>
          </div>
          <div class="header-right">
            <div class="studio-stats">
              <div class="stat-pill online">
                <span class="dot"></span>
                {{ onlineCount() }} online
              </div>
              @if (offlineCount() > 0) {
                <div class="stat-pill offline">
                  <span class="dot"></span>
                  {{ offlineCount() }} offline
                </div>
              }
            </div>
            @if (lastHeartbeatTime(); as hb) {
              <div class="last-heartbeat">heartbeat {{ hb | date:'HH:mm:ss' }}</div>
            }
            <button class="btn" (click)="refresh()">
              <mat-icon>refresh</mat-icon> Обновить
            </button>
          </div>
        </header>
      }

      @if (loading()) {
        <div class="loading-state">
          <mat-icon>hourglass_empty</mat-icon>
          Загрузка данных студии...
        </div>
      } @else {

        <!-- Dashboard Grid -->
        <div class="dashboard-grid">

          <!-- ══ PC Cards ══ -->
          @for (pc of pcCards(); track pc.agent.id) {
            <div class="card" [class.card-offline]="!pc.agent.is_online">
              <div class="card-header">
                <h3>
                  <mat-icon class="section-icon">desktop_windows</mat-icon>
                  {{ pc.agent.hostname ?? pc.agent.name }}
                  <span class="os-label">{{ pc.agent.os_version ?? '' }}</span>
                </h3>
                <div class="card-header-right">
                  <span class="status-dot" [class.online]="pc.agent.is_online" [class.offline]="!pc.agent.is_online"></span>
                  <button class="btn-icon" [matMenuTriggerFor]="pcMenu">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                  <mat-menu #pcMenu="matMenu">
                    <a mat-menu-item [routerLink]="['/employee/infrastructure/agents', pc.agent.id]">
                      <mat-icon>info</mat-icon> Подробности
                    </a>
                    <button mat-menu-item (click)="restartAgent(pc.agent)" [disabled]="!pc.agent.is_online">
                      <mat-icon>restart_alt</mat-icon> Перезапустить
                    </button>
                  </mat-menu>
                </div>
              </div>
              <div class="card-body">
                @if (pc.telemetry; as t) {
                  <div class="pc-stats">
                    <div class="metric">
                      <span class="metric-label">CPU</span>
                      <span class="metric-value">{{ t.cpu_percent ?? 0 | number:'1.0-0' }}<span class="unit">%</span></span>
                      <div class="progress-track">
                        <div class="progress-fill"
                             [class.ok]="(t.cpu_percent ?? 0) <= 60"
                             [class.warn]="(t.cpu_percent ?? 0) > 60 && (t.cpu_percent ?? 0) <= 80"
                             [class.crit]="(t.cpu_percent ?? 0) > 80"
                             [style.width.%]="t.cpu_percent ?? 0"></div>
                      </div>
                    </div>
                    <div class="metric">
                      <span class="metric-label">RAM</span>
                      <span class="metric-value">
                        {{ (t.memory_used_mb ?? 0) / 1024 | number:'1.1-1' }}<span class="unit">/ {{ (t.memory_total_mb ?? 0) / 1024 | number:'1.0-0' }} GB</span>
                      </span>
                      <div class="progress-track">
                        <div class="progress-fill"
                             [class.ok]="ramPercent(t) <= 70"
                             [class.warn]="ramPercent(t) > 70 && ramPercent(t) <= 85"
                             [class.crit]="ramPercent(t) > 85"
                             [style.width.%]="ramPercent(t)"></div>
                      </div>
                    </div>
                    <div class="metric">
                      <span class="metric-label">Disk</span>
                      <span class="metric-value">
                        {{ diskFree(t) | number:'1.0-0' }}<span class="unit">GB free</span>
                      </span>
                      <div class="progress-track">
                        <div class="progress-fill"
                             [class.ok]="diskPercent(t) <= 70"
                             [class.warn]="diskPercent(t) > 70 && diskPercent(t) <= 90"
                             [class.crit]="diskPercent(t) > 90"
                             [style.width.%]="diskPercent(t)"></div>
                      </div>
                    </div>
                  </div>
                } @else {
                  <div class="no-data">Нет телеметрии</div>
                }

                <div class="uptime-row">
                  <span class="metric-label">Uptime: {{ formatUptime(pc.agent.uptime_seconds) }}</span>
                </div>

                <div class="agent-badges">
                  @for (child of pc.childAgents; track child.id) {
                    <div class="agent-badge" [class.active]="child.is_online" [class.inactive]="!child.is_online"
                         [matTooltip]="child.name + (child.current_version ? ' v' + child.current_version : '')">
                      <span class="badge-dot"></span>
                      {{ agentTypeLabel(child.agent_type) }}
                      @if (child.current_version) {
                        <span class="ver">{{ child.current_version }}</span>
                      }
                    </div>
                  }
                </div>
              </div>
            </div>
          }

          <!-- ══ Printers ══ -->
          @if (printerCards().length > 0) {
            <div class="card">
              <div class="card-header">
                <h3>
                  <mat-icon class="section-icon">print</mat-icon>
                  Принтеры
                </h3>
                <span class="card-count">{{ printerCards().length }} устр.</span>
              </div>
              <div class="card-body">
                <div class="printer-list">
                  @for (p of printerCards(); track p.printer.id) {
                    <div class="printer-item" [class.is-printing]="p.bridgeStatus?.state === 'printing'">
                      <div class="printer-icon" [class.photo]="p.printer.printer_type === 'photo'" [class.laser]="p.printer.printer_type !== 'photo'">
                        <mat-icon>{{ p.printer.printer_type === 'photo' ? 'photo_camera' : 'print' }}</mat-icon>
                      </div>
                      <div class="printer-details">
                        <div class="printer-name">
                          {{ p.printer.name }}
                          <span class="printer-type-tag" [class.photo]="p.printer.printer_type === 'photo'" [class.laser]="p.printer.printer_type !== 'photo'">
                            {{ printerTypeLabel(p.printer.printer_type) }}
                          </span>
                        </div>
                        <div class="printer-status-row">
                          <span class="status-dot"
                                [class.online]="p.bridgeStatus?.state === 'idle'"
                                [class.printing]="p.bridgeStatus?.state === 'printing'"
                                [class.error]="p.bridgeStatus?.state === 'error'"
                                [class.offline]="!p.bridgeStatus?.online"></span>
                          <span class="printer-status-text"
                                [class.idle]="p.bridgeStatus?.state === 'idle'"
                                [class.printing]="p.bridgeStatus?.state === 'printing'"
                                [class.error]="p.bridgeStatus?.state === 'error'">
                            {{ printerStateLabel(p.bridgeStatus?.state) }}
                          </span>
                          <span class="queue-badge">{{ p.queueCount }} в очереди</span>
                        </div>
                        @if (p.lastJob) {
                          <div class="printer-last-job">
                            Последнее: {{ p.lastJob.file_name ?? 'файл' }} &mdash; {{ p.lastJob.created_at | date:'dd.MM HH:mm' }}
                          </div>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
          }

          <!-- ══ POS ══ -->
          @if (posAgent(); as pos) {
            <div class="card" [class.card-offline]="!pos.is_online">
              <div class="card-header">
                <h3>
                  <mat-icon class="section-icon">point_of_sale</mat-icon>
                  POS-терминал
                </h3>
                <span class="status-dot" [class.online]="pos.is_online" [class.offline]="!pos.is_online"></span>
              </div>
              <div class="card-body">
                <div class="pos-grid">
                  <div class="pos-item">
                    <span class="pos-item-name">Статус</span>
                    <div class="pos-item-value" [style.color]="pos.is_online ? 'var(--c-online)' : 'var(--c-error)'">
                      {{ pos.is_online ? 'Online' : 'Offline' }}
                    </div>
                    <div class="pos-item-sub">{{ pos.name }}</div>
                  </div>
                  <div class="pos-item">
                    <span class="pos-item-name">Версия</span>
                    <div class="pos-item-value">{{ pos.current_version ?? '—' }}</div>
                    <div class="pos-item-sub">{{ pos.hostname ?? '—' }}</div>
                  </div>
                  <div class="pos-item">
                    <span class="pos-item-name">Heartbeat</span>
                    <div class="pos-item-value">
                      {{ pos.last_heartbeat_at ? (pos.last_heartbeat_at | date:'HH:mm:ss') : '—' }}
                    </div>
                    <div class="pos-item-sub">{{ pos.last_heartbeat_at ? (pos.last_heartbeat_at | date:'dd.MM.yy') : '' }}</div>
                  </div>
                  <div class="pos-item">
                    <span class="pos-item-name">Uptime</span>
                    <div class="pos-item-value">{{ formatUptime(pos.uptime_seconds) }}</div>
                  </div>
                </div>
              </div>
            </div>
          }

          <!-- ══ Security ══ -->
          @if (guardAgent(); as guard) {
            <div class="card" [class.card-offline]="!guard.is_online">
              <div class="card-header">
                <h3>
                  <mat-icon class="section-icon">security</mat-icon>
                  Безопасность
                </h3>
                <span class="status-dot" [class.online]="guard.is_online" [class.offline]="!guard.is_online"></span>
              </div>
              <div class="card-body">
                @if (securitySummary(); as sec) {
                  <div class="security-grid">
                    <div class="sec-metric">
                      <div class="sec-metric-icon" [style.color]="sec.defenderRealtime === true ? 'var(--c-online)' : sec.defenderRealtime === false ? 'var(--c-error)' : 'var(--c-muted)'">
                        <mat-icon>{{ sec.defenderRealtime === true ? 'verified_user' : sec.defenderRealtime === false ? 'gpp_bad' : 'help_outline' }}</mat-icon>
                      </div>
                      <div class="sec-metric-value" [style.color]="sec.defenderRealtime === true ? 'var(--c-online)' : sec.defenderRealtime === false ? 'var(--c-error)' : ''">
                        {{ sec.defenderRealtime === true ? 'ON' : sec.defenderRealtime === false ? 'OFF' : '—' }}
                      </div>
                      <div class="sec-metric-label">Real-time</div>
                    </div>
                    <div class="sec-metric">
                      <div class="sec-metric-icon"><mat-icon>event</mat-icon></div>
                      <div class="sec-metric-value">{{ sec.defenderDefinitionsDate ? (sec.defenderDefinitionsDate | date:'dd.MM') : '—' }}</div>
                      <div class="sec-metric-label">Definitions</div>
                    </div>
                    <div class="sec-metric">
                      <div class="sec-metric-icon"><mat-icon>search</mat-icon></div>
                      <div class="sec-metric-value">{{ sec.lastScanDate ? (sec.lastScanDate | date:'dd.MM') : '—' }}</div>
                      <div class="sec-metric-label">Last scan</div>
                    </div>
                    <div class="sec-metric">
                      <div class="sec-metric-icon" [style.color]="sec.threatsFound === 0 ? 'var(--c-online)' : 'var(--c-error)'">
                        <mat-icon>{{ sec.threatsFound === 0 ? 'check_circle' : 'warning' }}</mat-icon>
                      </div>
                      <div class="sec-metric-value" [style.color]="sec.threatsFound === 0 ? 'var(--c-online)' : 'var(--c-error)'">
                        {{ sec.threatsFound === 0 ? 'Clean' : sec.threatsFound }}
                      </div>
                      <div class="sec-metric-label">Threats</div>
                    </div>
                  </div>

                  <div class="cdr-row">
                    <span class="metric-label">
                      CDR: {{ sec.cdrChanges }} изменений
                      @if (sec.cdrBaselineDate) {
                        &middot; baseline {{ sec.cdrBaselineDate | date:'dd.MM' }}
                      }
                    </span>
                  </div>

                  <div class="sec-actions">
                    <button class="btn" disabled matTooltip="Требуется MQTT команда">
                      <mat-icon>bolt</mat-icon> Quick Scan
                    </button>
                    <button class="btn" disabled matTooltip="Требуется MQTT команда">
                      <mat-icon>update</mat-icon> Update Defs
                    </button>
                  </div>

                  @if (sec.alerts.length > 0) {
                    <div class="sec-alerts">
                      @for (a of sec.alerts; track a.id) {
                        <div class="alert-item" [class]="a.severity">
                          <mat-icon>{{ a.severity === 'critical' ? 'error' : a.severity === 'warning' ? 'warning' : 'info' }}</mat-icon>
                          <span class="alert-text">{{ a.title }}</span>
                          <span class="alert-time">{{ a.created_at | date:'dd.MM HH:mm' }}</span>
                        </div>
                      }
                    </div>
                  }
                } @else {
                  <div class="no-data">Нет данных безопасности</div>
                }
              </div>
            </div>
          }

          <!-- ══ Alerts ══ -->
          @if (studioAlerts().length > 0) {
            <div class="card full-width">
              <div class="card-header">
                <h3>
                  <mat-icon class="section-icon">notification_important</mat-icon>
                  Алерты студии
                </h3>
                <span class="card-count">{{ unresolvedAlertCount() }} активных</span>
              </div>
              <div class="card-body">
                <div class="alert-list">
                  @for (alert of studioAlerts(); track alert.id) {
                    <div class="alert-item" [class]="alert.severity" [class.resolved]="!!alert.resolved_at">
                      <span class="status-dot"
                            [class.error]="alert.severity === 'critical'"
                            [class.warning]="alert.severity === 'warning'"
                            [class.info-dot]="alert.severity === 'info'"></span>
                      <span class="alert-time">{{ alert.created_at | date:'HH:mm' }}</span>
                      <span class="alert-text">{{ alert.title }}</span>
                      @if (alert.agent_name) {
                        <span class="alert-source">{{ alert.agent_name }}</span>
                      }
                      @if (!alert.resolved_at) {
                        <button class="btn btn-sm" (click)="resolveAlert(alert.id)">Закрыть</button>
                      }
                    </div>
                  }
                </div>
              </div>
            </div>
          }

        </div>

        <!-- ══ Print Queue ══ -->
        @if (printJobs().length > 0) {
          <section class="print-queue-section">
            <h2 class="section-title">
              <mat-icon>queue</mat-icon>
              Очередь печати
            </h2>
            <table class="queue-table">
              <thead>
                <tr>
                  <th>Файл</th>
                  <th>Принтер</th>
                  <th>Бумага</th>
                  <th>Копии</th>
                  <th>Статус</th>
                  <th>Прогресс</th>
                  <th>Время</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (job of printJobs(); track job.id) {
                  <tr>
                    <td>
                      <div class="job-file">
                        <div class="job-thumb">
                          <mat-icon>{{ job.color_mode === 'color' ? 'photo' : 'description' }}</mat-icon>
                        </div>
                        <span class="job-filename">{{ job.file_name ?? 'file' }}</span>
                      </div>
                    </td>
                    <td>{{ job.printer_name ?? '—' }}</td>
                    <td class="mono">{{ job.paper_size }}</td>
                    <td class="mono">{{ job.copies }}</td>
                    <td>
                      <span class="job-status" [class]="job.status">
                        <span class="status-dot" style="width:6px;height:6px"
                              [class.online]="job.status === 'completed'"
                              [class.printing]="job.status === 'printing' || job.status === 'sending'"
                              [class.error]="job.status === 'failed'"></span>
                        {{ jobStatusLabel(job.status) }}
                      </span>
                    </td>
                    <td>
                      <div class="job-progress">
                        <div class="job-progress-fill"
                             [class.complete]="job.status === 'completed'"
                             [class.err]="job.status === 'failed'"
                             [style.width.%]="jobProgress(job)"></div>
                      </div>
                    </td>
                    <td class="mono muted">{{ job.created_at | date:'HH:mm' }}</td>
                    <td>
                      @if (job.status === 'queued' || job.status === 'sending') {
                        <button class="btn-icon" matTooltip="Отменить" (click)="cancelJob(job.id)">
                          <mat-icon>close</mat-icon>
                        </button>
                      }
                      @if (job.status === 'failed') {
                        <button class="btn-icon" matTooltip="Повторить" (click)="retryJob(job.id)">
                          <mat-icon>replay</mat-icon>
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </section>
        }

      }
    </div>
  `,
  styles: [`
    /* ═══════════════════════════════════════════
       SVOEFOTO COMMAND CENTER — Angular Component
       Dark ops-monitoring theme
       ═══════════════════════════════════════════ */

    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: var(--bg-root);
      color: var(--c-primary);
      font-family: var(--f-display);
      font-weight: 400;
      line-height: 1.5;
      min-height: 100%;

      /* ── Design tokens ── */
      --bg-root: #0c0e14;
      --bg-surface: #13161e;
      --bg-card: #181c26;
      --bg-card-hover: #1d2230;
      --bg-elevated: #222838;
      --border-subtle: rgba(255,255,255,0.06);
      --border-active: rgba(255,255,255,0.12);

      --c-primary: #e8eaf0;
      --c-secondary: #8b90a0;
      --c-muted: #555b6e;

      --c-online: #2dd4a0;
      --c-online-bg: rgba(45,212,160,0.08);
      --c-online-glow: rgba(45,212,160,0.3);
      --c-warning: #f0a040;
      --c-warning-bg: rgba(240,160,64,0.08);
      --c-error: #ef4466;
      --c-error-bg: rgba(239,68,102,0.08);
      --c-offline: #444b5e;
      --c-printing: #5ba8f5;
      --c-printing-bg: rgba(91,168,245,0.08);

      --accent: #3ea8d8;
      --accent-bg: rgba(62,168,216,0.08);

      --f-display: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --f-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;

      --gap: 16px;
      --radius: 10px;
      --radius-sm: 6px;
    }

    /* Grid texture background */
    :host::before {
      content: '';
      position: absolute;
      inset: 0;
      background-image:
        linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px);
      background-size: 48px 48px;
      pointer-events: none;
      z-index: 0;
    }

    .page {
      position: relative;
      z-index: 1;
      max-width: 1440px;
      margin: 0 auto;
      padding: 24px 32px;
    }

    /* ── Breadcrumb ── */
    .breadcrumb {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--c-muted);
      margin-bottom: 20px;
      font-family: var(--f-mono);
      font-weight: 300;
      letter-spacing: 0.02em;
    }
    .breadcrumb a { color: var(--c-secondary); text-decoration: none; transition: color 0.2s; }
    .breadcrumb a:hover { color: var(--accent); }
    .breadcrumb .sep { opacity: 0.3; }
    .breadcrumb .current { color: var(--c-primary); }

    /* ── Studio Header ── */
    .studio-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 28px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border-subtle);
      flex-wrap: wrap;
      gap: 16px;
    }
    .studio-info h1 {
      font-size: 26px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0 0 4px;
    }
    .studio-info .address {
      font-size: 14px;
      color: var(--c-secondary);
      font-weight: 300;
    }
    .header-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }
    .studio-stats { display: flex; gap: 12px; align-items: center; }
    .stat-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 100px;
      font-size: 13px;
      font-family: var(--f-mono);
      font-weight: 500;
    }
    .stat-pill.online {
      background: var(--c-online-bg);
      color: var(--c-online);
      border: 1px solid rgba(45,212,160,0.15);
    }
    .stat-pill.offline {
      background: var(--c-error-bg);
      color: var(--c-error);
      border: 1px solid rgba(239,68,102,0.12);
    }
    .stat-pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
    }
    .stat-pill.online .dot { animation: pulse-green 2s ease-in-out infinite; }
    .last-heartbeat {
      font-size: 12px;
      color: var(--c-muted);
      font-family: var(--f-mono);
      font-weight: 300;
    }

    .loading-state {
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: center;
      padding: 80px 0;
      color: var(--c-muted);
      font-size: 15px;
    }

    /* ── Dashboard Grid ── */
    .dashboard-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--gap);
    }
    .full-width { grid-column: 1 / -1; }

    /* ── Card ── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius);
      overflow: hidden;
      transition: border-color 0.3s, box-shadow 0.3s;
      animation: fade-up 0.4s ease backwards;
    }
    .card:nth-child(1) { animation-delay: 0.05s; }
    .card:nth-child(2) { animation-delay: 0.1s; }
    .card:nth-child(3) { animation-delay: 0.15s; }
    .card:nth-child(4) { animation-delay: 0.2s; }
    .card:nth-child(5) { animation-delay: 0.25s; }
    .card:hover {
      border-color: var(--border-active);
      box-shadow: 0 4px 24px rgba(0,0,0,0.2);
    }
    .card.card-offline { opacity: 0.6; }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .card-header h3 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--c-secondary);
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
    }
    .card-header h3 .section-icon { font-size: 18px; opacity: 0.6; }
    .card-header h3 .os-label { font-weight: 300; opacity: 0.5; text-transform: none; }
    .card-header-right { display: flex; align-items: center; gap: 8px; }
    .card-count {
      font-size: 12px;
      color: var(--c-muted);
      font-family: var(--f-mono);
    }

    .card-body { padding: 20px; }

    /* ── Buttons ── */
    .btn {
      padding: 8px 16px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-family: var(--f-mono);
      font-weight: 500;
      border: 1px solid var(--border-subtle);
      background: var(--bg-elevated);
      color: var(--c-secondary);
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: var(--accent-bg); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.btn-sm { padding: 4px 10px; font-size: 11px; }
    .btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .btn-icon {
      background: none;
      border: none;
      color: var(--c-muted);
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: inline-flex;
      transition: color 0.2s;
    }
    .btn-icon:hover { color: var(--c-primary); }
    .btn-icon mat-icon { font-size: 20px; width: 20px; height: 20px; }

    /* ── Status dot ── */
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .status-dot.online { background: var(--c-online); box-shadow: 0 0 8px var(--c-online-glow); }
    .status-dot.warning { background: var(--c-warning); }
    .status-dot.error { background: var(--c-error); animation: blink-red 1s ease-in-out infinite; }
    .status-dot.offline { background: var(--c-offline); }
    .status-dot.printing { background: var(--c-printing); animation: pulse-blue 1.5s ease-in-out infinite; }
    .status-dot.info-dot { background: var(--accent); }

    /* ── PC Card: Metrics ── */
    .pc-stats {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .metric { display: flex; flex-direction: column; gap: 6px; }
    .metric-label {
      font-size: 11px;
      color: var(--c-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-family: var(--f-mono);
      font-weight: 300;
    }
    .metric-value {
      font-size: 24px;
      font-weight: 600;
      font-family: var(--f-mono);
      letter-spacing: -0.02em;
    }
    .metric-value .unit {
      font-size: 12px;
      font-weight: 300;
      color: var(--c-secondary);
      margin-left: 2px;
    }
    .progress-track {
      width: 100%;
      height: 4px;
      background: rgba(255,255,255,0.06);
      border-radius: 2px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      border-radius: 2px;
      transition: width 0.8s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .progress-fill.ok { background: var(--c-online); }
    .progress-fill.warn { background: var(--c-warning); }
    .progress-fill.crit { background: var(--c-error); }

    .uptime-row {
      margin-bottom: 12px;
    }

    .no-data {
      font-size: 13px;
      color: var(--c-muted);
      padding: 16px 0;
    }

    /* ── Agent Badges ── */
    .agent-badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .agent-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--radius-sm);
      font-size: 12px;
      font-family: var(--f-mono);
      font-weight: 400;
      background: var(--bg-elevated);
      border: 1px solid var(--border-subtle);
      color: var(--c-secondary);
    }
    .agent-badge .badge-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .agent-badge.active { color: var(--c-online); border-color: rgba(45,212,160,0.15); }
    .agent-badge.active .badge-dot { background: var(--c-online); }
    .agent-badge.inactive .badge-dot { background: var(--c-offline); }
    .agent-badge .ver {
      font-size: 10px;
      color: var(--c-muted);
      font-weight: 300;
    }

    /* ── Printer Card ── */
    .printer-list { display: flex; flex-direction: column; gap: 16px; }
    .printer-item {
      display: flex;
      gap: 16px;
      padding: 16px;
      background: var(--bg-elevated);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-subtle);
      transition: border-color 0.2s;
    }
    .printer-item:hover { border-color: var(--border-active); }
    .printer-icon {
      width: 48px;
      height: 48px;
      border-radius: var(--radius-sm);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .printer-icon.photo { background: rgba(91,168,245,0.1); color: var(--c-printing); }
    .printer-icon.laser { background: rgba(140,120,200,0.1); color: #a090d0; }
    .printer-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .printer-details { flex: 1; min-width: 0; }
    .printer-name {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 2px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .printer-type-tag {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 3px;
      font-family: var(--f-mono);
      font-weight: 400;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .printer-type-tag.photo { background: rgba(91,168,245,0.12); color: var(--c-printing); }
    .printer-type-tag.laser { background: rgba(140,120,200,0.12); color: #a090d0; }
    .printer-status-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 8px 0;
      font-size: 13px;
    }
    .printer-status-text { color: var(--c-secondary); }
    .printer-status-text.idle { color: var(--c-online); }
    .printer-status-text.printing { color: var(--c-printing); }
    .printer-status-text.error { color: var(--c-error); }
    .queue-badge {
      padding: 2px 8px;
      border-radius: 100px;
      font-size: 11px;
      font-family: var(--f-mono);
      font-weight: 500;
      background: var(--accent-bg);
      color: var(--accent);
      border: 1px solid rgba(62,168,216,0.15);
    }
    .printer-last-job {
      font-size: 12px;
      color: var(--c-muted);
      font-family: var(--f-mono);
      font-weight: 300;
    }

    /* Active printing animation */
    .printer-item.is-printing .printer-icon { animation: print-scan 1s ease-in-out infinite; }

    /* ── POS Card ── */
    .pos-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .pos-item {
      padding: 14px;
      background: var(--bg-elevated);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-subtle);
    }
    .pos-item-name {
      font-size: 12px;
      font-weight: 500;
      color: var(--c-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .pos-item-value {
      font-size: 18px;
      font-weight: 600;
      font-family: var(--f-mono);
    }
    .pos-item-sub {
      font-size: 11px;
      color: var(--c-muted);
      margin-top: 4px;
      font-family: var(--f-mono);
      font-weight: 300;
    }

    /* ── Security Card ── */
    .security-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .sec-metric {
      padding: 14px;
      background: var(--bg-elevated);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-subtle);
      text-align: center;
    }
    .sec-metric-icon { margin-bottom: 6px; }
    .sec-metric-icon mat-icon { font-size: 20px; width: 20px; height: 20px; }
    .sec-metric-value {
      font-size: 18px;
      font-weight: 600;
      font-family: var(--f-mono);
    }
    .sec-metric-label {
      font-size: 10px;
      color: var(--c-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-family: var(--f-mono);
      margin-top: 2px;
    }
    .cdr-row { margin-bottom: 12px; }
    .sec-actions { display: flex; gap: 8px; margin-bottom: 16px; }
    .sec-alerts { margin-top: 16px; display: flex; flex-direction: column; gap: 6px; }

    /* ── Alerts ── */
    .alert-list { display: flex; flex-direction: column; gap: 8px; }
    .alert-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-radius: var(--radius-sm);
      font-size: 13px;
      border: 1px solid var(--border-subtle);
    }
    .alert-item.critical {
      background: var(--c-error-bg);
      border-color: rgba(239,68,102,0.15);
    }
    .alert-item.warning {
      background: var(--c-warning-bg);
      border-color: rgba(240,160,64,0.12);
    }
    .alert-item.info {
      background: var(--accent-bg);
      border-color: rgba(62,168,216,0.1);
    }
    .alert-item.resolved { opacity: 0.4; }
    .alert-item mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
    .alert-item.critical mat-icon { color: var(--c-error); }
    .alert-item.warning mat-icon { color: var(--c-warning); }
    .alert-item.info mat-icon { color: var(--accent); }
    .alert-time {
      font-size: 11px;
      font-family: var(--f-mono);
      font-weight: 300;
      color: var(--c-muted);
      white-space: nowrap;
    }
    .alert-text { flex: 1; color: var(--c-primary); }
    .alert-source {
      font-size: 11px;
      font-family: var(--f-mono);
      color: var(--c-muted);
      padding: 2px 8px;
      background: var(--bg-elevated);
      border-radius: 3px;
    }

    /* ── Print Queue ── */
    .print-queue-section {
      margin-top: 32px;
      padding-top: 28px;
      border-top: 1px solid var(--border-subtle);
      animation: fade-up 0.4s ease 0.3s backwards;
    }
    .section-title {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-title mat-icon { color: var(--c-secondary); }

    .queue-table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }
    .queue-table th {
      font-size: 11px;
      font-weight: 500;
      color: var(--c-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-family: var(--f-mono);
      padding: 10px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border-subtle);
    }
    .queue-table td {
      padding: 14px 16px;
      font-size: 13px;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: middle;
    }
    .queue-table tr:hover td { background: rgba(255,255,255,0.02); }

    .job-file { display: flex; align-items: center; gap: 8px; }
    .job-thumb {
      width: 32px;
      height: 32px;
      border-radius: 4px;
      background: var(--bg-elevated);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--c-muted);
    }
    .job-thumb mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .job-filename {
      font-family: var(--f-mono);
      font-size: 12px;
      font-weight: 400;
    }

    .job-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 100px;
      font-size: 11px;
      font-family: var(--f-mono);
      font-weight: 500;
    }
    .job-status.queued { background: rgba(255,255,255,0.06); color: var(--c-secondary); }
    .job-status.sending { background: var(--c-printing-bg); color: var(--c-printing); }
    .job-status.printing { background: var(--c-warning-bg); color: var(--c-warning); }
    .job-status.completed { background: var(--c-online-bg); color: var(--c-online); }
    .job-status.failed { background: var(--c-error-bg); color: var(--c-error); }
    .job-status.cancelled { background: rgba(255,255,255,0.04); color: var(--c-muted); }

    .job-progress {
      width: 100px;
      height: 6px;
      background: rgba(255,255,255,0.06);
      border-radius: 3px;
      overflow: hidden;
    }
    .job-progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.5s ease;
      background: var(--accent);
    }
    .job-progress-fill.complete { background: var(--c-online); }
    .job-progress-fill.err { background: var(--c-error); }

    /* ── Utility ── */
    .mono { font-family: var(--f-mono); font-size: 12px; }
    .muted { color: var(--c-muted); }

    /* ── Animations ── */
    @keyframes fade-up {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes pulse-green {
      0%, 100% { box-shadow: 0 0 0 0 rgba(45,212,160,0.4); }
      50% { box-shadow: 0 0 0 6px rgba(45,212,160,0); }
    }
    @keyframes pulse-blue {
      0%, 100% { box-shadow: 0 0 0 0 rgba(91,168,245,0.4); }
      50% { box-shadow: 0 0 0 6px rgba(91,168,245,0); }
    }
    @keyframes blink-red {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    @keyframes print-scan {
      0% { transform: translateY(0); }
      50% { transform: translateY(-2px); }
      100% { transform: translateY(0); }
    }
    .studio-header { animation: fade-up 0.4s ease; }
  `],
})
export class StudioDashboardComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly infraApi = inject(InfraApiService);
  private readonly printApi = inject(PrintApiService);
  private readonly realtime = inject(InfraRealtimeService);
  private readonly snack = inject(MatSnackBar);

  readonly locationId = input<string>('');

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  // ── Data signals ──
  readonly loading = signal(true);
  readonly location = signal<InfraLocation | null>(null);
  readonly agents = signal<Agent[]>([]);
  readonly studioAlerts = signal<InfraAlert[]>([]);
  readonly telemetryMap = signal<Record<string, SystemTelemetry>>({});
  readonly bridgeStatuses = signal<BridgePrinterStatus[]>([]);
  readonly printers = signal<Printer[]>([]);
  readonly printJobs = signal<PrintJob[]>([]);

  // ── Computed ──

  readonly onlineCount = computed(() => this.agents().filter(a => a.is_online).length);
  readonly offlineCount = computed(() => this.agents().filter(a => !a.is_online).length);

  readonly lastHeartbeatTime = computed(() => {
    const times = this.agents()
      .map(a => a.last_heartbeat_at)
      .filter((t): t is string => !!t)
      .sort()
      .reverse();
    return times[0] ?? null;
  });

  readonly unresolvedAlertCount = computed(() =>
    this.studioAlerts().filter(a => !a.resolved_at).length
  );

  /** Monitor agents represent PCs — group other agents by hostname */
  readonly pcCards = computed<PcCard[]>(() => {
    const all = this.agents();
    const tMap = this.telemetryMap();
    const monitors = all.filter(a => a.agent_type === 'monitor');
    if (monitors.length === 0) {
      const byHost = new Map<string, Agent[]>();
      for (const a of all) {
        const key = a.hostname ?? a.id;
        const arr = byHost.get(key) ?? [];
        arr.push(a);
        byHost.set(key, arr);
      }
      return [...byHost.values()].map(group => ({
        agent: group[0],
        telemetry: tMap[group[0].id] ?? null,
        childAgents: group,
      }));
    }
    return monitors.map(m => ({
      agent: m,
      telemetry: tMap[m.id] ?? null,
      childAgents: all.filter(a =>
        a.id !== m.id && a.hostname === m.hostname && a.agent_type !== 'monitor'
      ),
    }));
  });

  readonly posAgent = computed(() => this.agents().find(a => a.agent_type === 'pos') ?? null);

  readonly guardAgent = computed(() =>
    this.agents().find(a => (a.agent_type as string) === 'guard') ?? null
  );

  readonly printerCards = computed<PrinterCard[]>(() => {
    const studioPrinters = this.printers();
    const statuses = this.bridgeStatuses();
    const jobs = this.printJobs();
    return studioPrinters.map(p => {
      const bs = statuses.find(s => s.printer_name === p.cups_printer_name) ?? null;
      const printerJobs = jobs.filter(j => j.printer_id === p.id);
      const queueCount = printerJobs.filter(j =>
        j.status === 'queued' || j.status === 'sending' || j.status === 'printing'
      ).length;
      const lastJob = printerJobs.length > 0 ? printerJobs[0] : null;
      return { printer: p, bridgeStatus: bs, lastJob, queueCount };
    });
  });

  /** Extract security summary from guard agent config / alerts */
  readonly securitySummary = computed<SecuritySummary | null>(() => {
    const guard = this.guardAgent();
    if (!guard) return null;
    const config = guard.applied_config ?? {};
    const alerts = this.studioAlerts().filter(a =>
      a.agent_id === guard.id ||
      a.alert_type?.startsWith('security') ||
      a.alert_type?.startsWith('cdr') ||
      a.alert_type?.startsWith('defender')
    );
    return {
      defenderRealtime: (config['defender_realtime'] as boolean) ?? null,
      defenderDefinitionsDate: (config['defender_definitions_date'] as string) ?? null,
      lastScanDate: (config['last_scan_date'] as string) ?? null,
      threatsFound: (config['threats_found'] as number) ?? 0,
      cdrBaselineDate: (config['cdr_baseline_date'] as string) ?? null,
      cdrChanges: (config['cdr_changes'] as number) ?? 0,
      alerts,
    };
  });

  // ── Real-time effects ──

  private readonly heartbeatEffect = effect(() => {
    const hb = this.realtime.lastHeartbeat();
    if (!hb) return;
    this.agents.update(list =>
      list.map(a => a.id === hb.agent_id ? { ...a, is_online: hb.is_online } : a)
    );
  });

  private readonly telemetryEffect = effect(() => {
    const t = this.realtime.lastTelemetry();
    if (!t) return;
    const agentId = (t as Record<string, unknown>)['agent_id'] as string | undefined;
    if (!agentId) return;
    this.telemetryMap.update(map => ({ ...map, [agentId]: t as unknown as SystemTelemetry }));
  });

  private readonly alertEffect = effect(() => {
    const alert = this.realtime.lastAlert();
    if (!alert) return;
    const locId = this.resolvedLocationId();
    if (alert.studio_id !== locId) return;
    const newAlert: InfraAlert = {
      id: Date.now(),
      studio_id: alert.studio_id,
      agent_id: null,
      alert_type: alert.alert_type,
      severity: alert.severity as InfraAlert['severity'],
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
    this.studioAlerts.update(list => [newAlert, ...list]);
  });

  // ── Lifecycle ──

  ngOnInit(): void {
    this.refresh();
    this.refreshTimer = setInterval(() => this.refresh(), 30_000);
    this.realtime.subscribe();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.realtime.unsubscribe();
  }

  // ── Data loading ──

  private resolvedLocationId(): string {
    return this.locationId() || this.route.snapshot.paramMap.get('id') || '';
  }

  refresh(): void {
    const locId = this.resolvedLocationId();
    if (!locId) return;

    this.infraApi.getLocation(locId).subscribe({
      next: detail => {
        this.location.set(detail.location);
        this.agents.set(detail.agents);
        this.studioAlerts.set(detail.alerts);
        this.loading.set(false);

        // Fetch telemetry for monitor agents
        const monitors = detail.agents.filter(a => a.agent_type === 'monitor');
        for (const m of monitors) {
          this.infraApi.getSystemTelemetry(m.id).subscribe(t => {
            if (t) {
              this.telemetryMap.update(map => ({ ...map, [m.id]: t }));
            }
          });
        }
      },
      error: () => {
        this.loading.set(false);
        this.snack.open('Ошибка загрузки данных студии', '', { duration: 3000 });
      },
    });

    // Printers for this studio
    this.printApi.getPrinters(locId).subscribe(p => this.printers.set(p));
    this.printApi.getPrinterStatuses().subscribe(r => this.bridgeStatuses.set(r.printers));
    this.printApi.getQueue({ studio_id: locId, limit: 50 }).subscribe(r => this.printJobs.set(r.jobs));
  }

  // ── Actions ──

  restartAgent(agent: Agent): void {
    this.infraApi.restartAgent(agent.id).subscribe({
      next: r => this.snack.open(r.message, '', { duration: 3000 }),
      error: () => this.snack.open('Ошибка перезапуска', '', { duration: 3000 }),
    });
  }

  resolveAlert(id: number): void {
    this.infraApi.resolveAlert(id).subscribe(() => {
      this.studioAlerts.update(list =>
        list.map(a => a.id === id ? { ...a, resolved_at: new Date().toISOString() } : a)
      );
    });
  }

  cancelJob(jobId: string): void {
    this.printApi.cancelJob(jobId).subscribe({
      next: () => {
        this.printJobs.update(list =>
          list.map(j => j.id === jobId ? { ...j, status: 'cancelled' as const } : j)
        );
        this.snack.open('Задание отменено', '', { duration: 3000 });
      },
      error: () => this.snack.open('Ошибка отмены', '', { duration: 3000 }),
    });
  }

  retryJob(jobId: string): void {
    this.printApi.retryJob(jobId).subscribe({
      next: () => {
        this.printJobs.update(list =>
          list.map(j => j.id === jobId ? { ...j, status: 'queued' as const } : j)
        );
        this.snack.open('Задание повторяется', '', { duration: 3000 });
      },
      error: () => this.snack.open('Ошибка повтора', '', { duration: 3000 }),
    });
  }

  // ── Helpers ──

  formatUptime(seconds: number | null): string {
    if (!seconds) return '---';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 24) {
      const d = Math.floor(h / 24);
      return `${d}d ${h % 24}h`;
    }
    return `${h}h ${m}m`;
  }

  ramPercent(t: SystemTelemetry): number {
    if (!t.memory_total_mb || !t.memory_used_mb) return 0;
    return (t.memory_used_mb / t.memory_total_mb) * 100;
  }

  diskPercent(t: SystemTelemetry): number {
    if (!t.disk_total_gb) return 0;
    const used = t.disk_used_gb ?? 0;
    return (used / t.disk_total_gb) * 100;
  }

  diskFree(t: SystemTelemetry): number {
    return (t.disk_total_gb ?? 0) - (t.disk_used_gb ?? 0);
  }

  agentTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      print: 'Print', pos: 'POS', monitor: 'Monitor', guard: 'Guard', vision: 'Vision',
    };
    return labels[type] ?? type;
  }

  printerTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      photo: 'inkjet photo', document: 'laser', mfp: 'laser mfp',
    };
    return labels[type] ?? type;
  }

  printerStateLabel(state: string | undefined): string {
    const labels: Record<string, string> = {
      idle: 'Готов', printing: 'Печатает', error: 'Ошибка',
    };
    return labels[state ?? ''] ?? 'Неизвестно';
  }

  jobStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      queued: 'В очереди', sending: 'Загрузка', printing: 'Печать',
      completed: 'Готово', failed: 'Ошибка', cancelled: 'Отменено',
    };
    return labels[status] ?? status;
  }

  jobProgress(job: PrintJob): number {
    switch (job.status) {
      case 'queued': return 0;
      case 'sending': return 15;
      case 'printing': return 50;
      case 'completed': return 100;
      case 'failed': return 100;
      case 'cancelled': return 0;
      default: return 0;
    }
  }
}
