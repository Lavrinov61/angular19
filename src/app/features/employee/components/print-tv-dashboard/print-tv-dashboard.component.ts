import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnDestroy,
  afterNextRender, Injector,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { PrintQueueStateService } from '../../services/print-queue-state.service';

@Component({
  selector: 'app-print-tv-dashboard',
  standalone: true,
  imports: [DatePipe, MatCardModule, MatIconModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
  styles: [`
    :host {
      display: block;
      height: 100vh;
      background: #0a0e17;
      color: #e0e6f0;
      font-family: 'Roboto', sans-serif;
      overflow: hidden;
      padding: 24px;
      box-sizing: border-box;
    }

    .tv-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .tv-header h1 {
      font-size: 28px;
      font-weight: 500;
      margin: 0;
      color: #e0e6f0;
    }

    .header-right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .clock {
      font-size: 28px;
      font-weight: 300;
      color: #8892a4;
    }

    .ws-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
    }

    .ws-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .ws-dot.online { background: #4caf50; box-shadow: 0 0 8px #4caf5080; }
    .ws-dot.offline { background: #f44336; box-shadow: 0 0 8px #f4433680; }

    .offline-banner {
      background: #f4433620;
      border: 1px solid #f4433660;
      border-radius: 8px;
      padding: 12px 20px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 16px;
    }

    .offline-banner mat-icon { color: #f44336; }

    .tv-grid {
      display: grid;
      grid-template-columns: 1fr 2fr;
      grid-template-rows: auto 1fr auto;
      gap: 16px;
      height: calc(100vh - 120px);
    }

    .section-title {
      font-size: 16px;
      font-weight: 500;
      color: #8892a4;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin: 0 0 12px 0;
    }

    /* Printer cards */
    .printers-section {
      grid-row: 1 / 3;
    }

    .printer-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .printer-card {
      background: #141b2d;
      border-radius: 12px;
      padding: 16px;
      border: 1px solid #1e2740;
    }

    .printer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }

    .printer-name {
      font-size: 18px;
      font-weight: 500;
    }

    .printer-status-badge {
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .printer-status-badge.online { background: #4caf5025; color: #4caf50; }
    .printer-status-badge.offline { background: #f4433625; color: #f44336; }
    .printer-status-badge.paused { background: #ff980025; color: #ff9800; }

    .printer-meta {
      display: flex;
      gap: 16px;
      font-size: 14px;
      color: #8892a4;
    }

    .printer-meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .printer-meta-item mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .supply-bar {
      margin-top: 10px;
    }

    .supply-bar-label {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #8892a4;
      margin-bottom: 4px;
    }

    .supply-bar mat-progress-bar { border-radius: 4px; }

    /* Active jobs table */
    .jobs-section {
      grid-row: 1 / 3;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .jobs-table {
      flex: 1;
      overflow: hidden;
    }

    .job-row {
      display: grid;
      grid-template-columns: 2fr 1.2fr 0.8fr 1fr 1.5fr;
      gap: 12px;
      align-items: center;
      padding: 10px 16px;
      background: #141b2d;
      border-radius: 8px;
      margin-bottom: 6px;
      font-size: 15px;
    }

    .job-row-header {
      background: transparent;
      font-size: 13px;
      color: #8892a4;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
    }

    .job-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .job-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .job-status.queued { background: #2196f325; color: #2196f3; }
    .job-status.printing { background: #4caf5025; color: #4caf50; }
    .job-status.sending { background: #00bcd425; color: #00bcd4; }
    .job-status.converting { background: #9c27b025; color: #9c27b0; }
    .job-status.failed { background: #f4433625; color: #f44336; }
    .job-status.cancelled { background: #9e9e9e25; color: #9e9e9e; }
    .job-status.paused { background: #ff980025; color: #ff9800; }
    .job-status.held { background: #ff572225; color: #ff5722; }
    .job-status.splitting { background: #3f51b525; color: #3f51b5; }
    .job-status.finishing { background: #8bc34a25; color: #8bc34a; }
    .job-status.scheduled { background: #60738025; color: #607380; }

    .job-progress {
      width: 100%;
    }

    .job-progress mat-progress-bar { border-radius: 4px; }

    /* KPI footer */
    .kpi-section {
      grid-column: 1 / -1;
      display: flex;
      gap: 16px;
    }

    .kpi-card {
      flex: 1;
      background: #141b2d;
      border-radius: 12px;
      padding: 16px 20px;
      text-align: center;
      border: 1px solid #1e2740;
    }

    .kpi-value {
      font-size: 36px;
      font-weight: 600;
      line-height: 1.2;
    }

    .kpi-value.success { color: #4caf50; }
    .kpi-value.danger { color: #f44336; }
    .kpi-value.info { color: #2196f3; }
    .kpi-value.neutral { color: #e0e6f0; }

    .kpi-label {
      font-size: 14px;
      color: #8892a4;
      margin-top: 4px;
    }

    .supply-alert-strip {
      grid-column: 1 / -1;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .supply-alert-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #ff980015;
      border: 1px solid #ff980040;
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 13px;
      color: #ff9800;
    }

    .supply-alert-chip mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 200px;
      color: #8892a4;
      font-size: 16px;
    }

    .empty-state mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.4; }

    @media (min-width: 3000px) {
      :host { padding: 40px; }
      .tv-header h1 { font-size: 40px; }
      .clock { font-size: 40px; }
      .printer-name { font-size: 24px; }
      .job-row { font-size: 20px; padding: 14px 20px; }
      .kpi-value { font-size: 52px; }
      .kpi-label { font-size: 18px; }
      .section-title { font-size: 20px; }
    }
  `],
  template: `
    <div class="tv-header">
      <h1>Печать — Копицентр</h1>
      <div class="header-right">
        <span class="clock">{{ currentTime() | date:'HH:mm' }}</span>
        <div class="ws-status">
          <span class="ws-dot" [class.online]="state.wsConnected()" [class.offline]="!state.wsConnected()"></span>
          <span>{{ state.wsConnected() ? 'Online' : 'Offline' }}</span>
        </div>
      </div>
    </div>

    @if (!state.wsConnected()) {
      <div class="offline-banner">
        <mat-icon>cloud_off</mat-icon>
        <span>Нет соединения с сервером. Данные могут быть неактуальны.</span>
      </div>
    }

    <div class="tv-grid">
      <!-- Printer Status -->
      <div class="printers-section">
        <p class="section-title">Принтеры</p>
        <div class="printer-grid">
          @for (pc of printerCards(); track pc.id) {
            <div class="printer-card">
              <div class="printer-header">
                <span class="printer-name">{{ pc.name }}</span>
                <span class="printer-status-badge" [class]="pc.statusClass">{{ pc.statusLabel }}</span>
              </div>
              <div class="printer-meta">
                <span class="printer-meta-item">
                  <mat-icon>print</mat-icon> {{ pc.jobsCount }} заданий
                </span>
                <span class="printer-meta-item">
                  <mat-icon>category</mat-icon> {{ pc.type }}
                </span>
              </div>
              @if (pc.supplyPercent !== null) {
                <div class="supply-bar">
                  <div class="supply-bar-label">
                    <span>Расходники</span>
                    <span>{{ pc.supplyPercent }}%</span>
                  </div>
                  <mat-progress-bar
                    [mode]="'determinate'"
                    [value]="pc.supplyPercent"
                    [color]="pc.supplyPercent > 30 ? 'primary' : 'warn'"
                  />
                </div>
              }
            </div>
          } @empty {
            <div class="empty-state">
              <mat-icon>print_disabled</mat-icon>
              <span>Нет принтеров</span>
            </div>
          }
        </div>
      </div>

      <!-- Active Jobs -->
      <div class="jobs-section">
        <p class="section-title">Активные задания</p>
        <div class="jobs-table">
          <div class="job-row job-row-header">
            <span>Файл</span>
            <span>Принтер</span>
            <span>Копии</span>
            <span>Статус</span>
            <span>Прогресс</span>
          </div>
          @for (job of displayJobs(); track job.id) {
            <div class="job-row">
              <span class="job-name">{{ job.file_name || job.id.slice(0, 8) }}</span>
              <span>{{ job.printer_name || '—' }}</span>
              <span>{{ job.copies }}x</span>
              <span class="job-status" [class]="job.status">{{ statusLabel(job.status) }}</span>
              <div class="job-progress">
                <mat-progress-bar
                  [mode]="job.status === 'printing' ? 'determinate' : job.status === 'converting' || job.status === 'sending' ? 'indeterminate' : 'determinate'"
                  [value]="job.progress_percent ?? 0"
                />
              </div>
            </div>
          } @empty {
            <div class="empty-state">
              <mat-icon>check_circle</mat-icon>
              <span>Очередь пуста</span>
            </div>
          }
        </div>
      </div>

      <!-- KPI Footer -->
      <div class="kpi-section">
        <div class="kpi-card">
          <div class="kpi-value success">{{ todaySummary().completed }}</div>
          <div class="kpi-label">Выполнено</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value danger">{{ todaySummary().failed }}</div>
          <div class="kpi-label">Ошибки</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value info">{{ todaySummary().avgTime }}</div>
          <div class="kpi-label">Среднее время</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value neutral">{{ todaySummary().sheets }}</div>
          <div class="kpi-label">Листов</div>
        </div>
      </div>

      <!-- Supply Alerts -->
      @if (activeSupplyAlerts().length) {
        <div class="supply-alert-strip">
          @for (alert of activeSupplyAlerts(); track alert.printer_id + alert.supply) {
            <div class="supply-alert-chip">
              <mat-icon>warning</mat-icon>
              {{ alert.supply }}: {{ alert.level }}%
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PrintTvDashboardComponent implements OnDestroy {
  readonly state = inject(PrintQueueStateService);
  private readonly injector = inject(Injector);
  private clockInterval?: ReturnType<typeof setInterval>;

  readonly currentTime = signal(new Date());

  readonly activePrinters = computed(() =>
    this.state.printers().filter(p => p.is_active)
  );

  readonly printerCards = computed(() => {
    const printers = this.activePrinters();
    const statuses = this.state.statuses();
    const jobs = this.state.allJobs();
    const telemetry = this.state.telemetry();

    return printers.map(p => {
      const status = statuses.find(s => s.printer_name === p.cups_printer_name);
      const online = status?.online ?? false;
      const paused = p.queue_paused ?? false;
      const jobsCount = jobs.filter(j => j.printer_id === p.id && !['completed', 'cancelled'].includes(j.status)).length;
      const tel = telemetry.find(t => t.printer_id === p.id);
      let supplyPercent: number | null = null;
      if (tel?.supplies) {
        const vals = Object.values(tel.supplies);
        if (vals.length) supplyPercent = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      }

      return {
        id: p.id,
        name: p.name,
        type: p.printer_type === 'photo' ? 'Фото' : p.printer_type === 'document' ? 'Документ' : 'МФУ',
        online,
        paused,
        jobsCount,
        supplyPercent,
        statusClass: paused ? 'paused' : online ? 'online' : 'offline',
        statusLabel: paused ? 'Пауза' : online ? 'Онлайн' : 'Оффлайн',
      };
    });
  });

  readonly displayJobs = computed(() =>
    this.state.activeJobs().slice(0, 8)
  );

  readonly todaySummary = computed(() => {
    const jobs = this.state.allJobs();
    const today = new Date().toDateString();
    const todayJobs = jobs.filter(j => new Date(j.created_at).toDateString() === today);
    const completed = todayJobs.filter(j => j.status === 'completed').length;
    const failed = todayJobs.filter(j => j.status === 'failed').length;
    const completedWithTime = todayJobs.filter(j => j.status === 'completed' && j.completed_at);
    const totalSeconds = completedWithTime.reduce((sum, j) => {
      const diff = new Date(j.completed_at!).getTime() - new Date(j.created_at).getTime();
      return sum + diff / 1000;
    }, 0);
    const avgSeconds = completedWithTime.length ? Math.round(totalSeconds / completedWithTime.length) : 0;
    const avgTime = avgSeconds > 0
      ? avgSeconds >= 60 ? `${Math.floor(avgSeconds / 60)}м ${avgSeconds % 60}с` : `${avgSeconds}с`
      : '—';
    const sheets = todayJobs
      .filter(j => j.status === 'completed')
      .reduce((sum, j) => sum + j.copies, 0);

    return { completed, failed, avgTime, sheets };
  });

  readonly activeSupplyAlerts = computed(() =>
    this.state.supplyAlerts().filter(a => a.level <= a.threshold)
  );

  constructor() {
    afterNextRender(() => {
      this.clockInterval = setInterval(() => this.currentTime.set(new Date()), 60_000);
    }, { injector: this.injector });
  }

  ngOnDestroy(): void {
    if (this.clockInterval) clearInterval(this.clockInterval);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'F11') {
      event.preventDefault();
      document.documentElement.requestFullscreen?.();
    } else if (event.key === 'Escape') {
      document.exitFullscreen?.();
    }
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      queued: 'В очереди',
      sending: 'Отправка',
      printing: 'Печать',
      completed: 'Готово',
      failed: 'Ошибка',
      cancelled: 'Отменено',
      converting: 'Конвертация',
      paused: 'Пауза',
      held: 'Удержано',
      scheduled: 'Запланировано',
      splitting: 'Разделение',
      finishing: 'Финишинг',
    };
    return labels[status] ?? status;
  }
}
