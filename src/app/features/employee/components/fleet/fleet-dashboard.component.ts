import { Component, ChangeDetectionStrategy, inject, signal, computed, effect, PLATFORM_ID, OnInit } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FleetApiService } from './services/fleet-api.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { FleetPrinterCardComponent } from './fleet-printer-card.component';
import { FleetStudioFilterComponent, StudioFilterOption } from './fleet-studio-filter.component';
import { PrinterListItem } from './models/fleet.models';

@Component({
  selector: 'app-fleet-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FleetPrinterCardComponent, FleetStudioFilterComponent],
  template: `
    <div class="fleet-dashboard">
      <header class="dash-head">
        <div class="dash-head-titles">
          <h1 class="dash-title">Мониторинг парка принтеров</h1>
          <p class="dash-sub">Телеметрия SNMP, задания печати, расходники и алерты в реальном времени.</p>
        </div>
        <div class="dash-stats">
          <div class="stat">
            <span class="stat-value">{{ summary().online }}/{{ summary().total }}</span>
            <span class="stat-label">В сети</span>
          </div>
          <div class="stat stat--critical" [class.stat--hidden]="summary().critical === 0">
            <span class="stat-value">{{ summary().critical }}</span>
            <span class="stat-label">Критич.</span>
          </div>
          <div class="stat stat--warn" [class.stat--hidden]="summary().warn === 0">
            <span class="stat-value">{{ summary().warn }}</span>
            <span class="stat-label">Внимание</span>
          </div>
          <button class="refresh" (click)="refresh()" [disabled]="loading()" type="button">
            @if (loading()) { <span class="spinner" aria-hidden="true"></span> }
            Обновить
          </button>
        </div>
      </header>

      @if (error()) {
        <div class="alert-error" role="alert">
          <strong>Не удалось загрузить данные.</strong> {{ error() }}
          <button type="button" class="alert-retry" (click)="refresh()">Повторить</button>
        </div>
      }

      @if (studioList().length > 1) {
        <app-fleet-studio-filter
          [studios]="studioList()"
          [totalCount]="printers().length"
          [(selected)]="studioFilter" />
      }

      @if (loading() && printers().length === 0) {
        <div class="grid">
          @for (_ of skeletonSlots; track $index) {
            <div class="skeleton-card" aria-hidden="true"></div>
          }
        </div>
      } @else if (filteredPrinters().length === 0) {
        <div class="empty">
          @if (printers().length === 0) {
            Активных принтеров нет.
          } @else {
            В выбранной студии нет принтеров.
          }
        </div>
      } @else {
        <div class="grid">
          @for (p of filteredPrinters(); track p.id) {
            <app-fleet-printer-card [printer]="p" />
          }
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fleet-dashboard {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 24px 48px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .dash-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 24px;
      flex-wrap: wrap;
    }
    .dash-title {
      margin: 0;
      font-size: clamp(22px, 3vw, 28px);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .dash-sub {
      margin: 4px 0 0;
      font-size: 13px;
      color: #6b7280;
      max-width: 560px;
      line-height: 1.5;
    }
    .dash-stats { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .stat {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      padding: 8px 14px;
      background: var(--bg-elevated, #fff);
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 10px;
      min-width: 74px;
    }
    .stat--hidden { display: none; }
    .stat-value { font-size: 18px; font-weight: 800; line-height: 1; }
    .stat-label {
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
      margin-top: 4px;
    }
    .stat--critical .stat-value { color: #b91c1c; }
    .stat--warn .stat-value     { color: #a16207; }
    .refresh {
      background: transparent;
      border: 1px solid rgba(0, 0, 0, 0.12);
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      color: #111827;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .refresh:hover:not(:disabled) { background: rgba(0, 0, 0, 0.04); }
    .refresh:disabled { opacity: 0.6; cursor: wait; }
    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(0, 0, 0, 0.15);
      border-top-color: #111827;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }
    .skeleton-card {
      min-height: 182px;
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(0, 0, 0, 0.04) 25%, rgba(0, 0, 0, 0.08) 50%, rgba(0, 0, 0, 0.04) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }

    .empty {
      padding: 48px 16px;
      text-align: center;
      font-size: 14px;
      color: #6b7280;
      background: var(--bg-elevated, #fff);
      border: 1px dashed rgba(0, 0, 0, 0.08);
      border-radius: 12px;
    }
    .alert-error {
      padding: 12px 16px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.22);
      border-radius: 10px;
      color: #b91c1c;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .alert-retry {
      margin-left: auto;
      background: #dc2626;
      color: #fff;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
  `]
})
export class FleetDashboardComponent implements OnInit {
  private readonly api = inject(FleetApiService);
  private readonly ws = inject(WebSocketService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly printers = signal<PrinterListItem[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly skeletonSlots = Array.from({ length: 6 });

  readonly studioFilter = signal<string | null>(null);

  readonly studioList = computed<StudioFilterOption[]>(() => {
    const map = new Map<string, StudioFilterOption>();
    for (const p of this.printers()) {
      const id = p.studio_id ?? '__none__';
      const name = p.studio_id ?? 'Без студии';
      const existing = map.get(id);
      if (existing) {
        existing.count++;
      } else {
        map.set(id, { id, name, count: 1 });
      }
    }
    return [...map.values()].sort((a, b) => {
      if (a.id === '__none__') return 1;
      if (b.id === '__none__') return -1;
      return a.name.localeCompare(b.name, 'ru');
    });
  });

  readonly filteredPrinters = computed(() => {
    const f = this.studioFilter();
    const list = this.printers();
    if (f === null) return list;
    return list.filter(p => (p.studio_id ?? '__none__') === f);
  });

  readonly summary = computed(() => {
    const list = this.filteredPrinters();
    let online = 0, critical = 0, warn = 0;
    for (const p of list) {
      if (p.last_telemetry?.is_online) online++;
      critical += p.active_alerts_by_severity?.critical ?? 0;
      warn += p.active_alerts_by_severity?.warn ?? 0;
    }
    return { total: list.length, online, critical, warn };
  });

  constructor() {
    // Частичное обновление телеметрии в конкретной карточке (без refetch).
    effect(() => {
      const ev = this.ws.printerTelemetryUpdated();
      if (!ev) return;
      this.printers.update(list => list.map(p => p.id === ev.printerId
        ? {
            ...p,
            last_telemetry: {
              is_online: ev.isOnline,
              state: ev.state,
              collected_at: ev.collectedAt,
              supplies_summary: p.last_telemetry?.supplies_summary ?? [],
              trays_summary: p.last_telemetry?.trays_summary ?? [],
            }
          }
        : p));
    });

    // Alert raised — инкрементим счётчик на соответствующей карточке.
    effect(() => {
      const ev = this.ws.printerAlertRaised();
      if (!ev) return;
      this.printers.update(list => list.map(p => {
        if (p.id !== ev.printerId) return p;
        const sev = { ...p.active_alerts_by_severity };
        sev[ev.severity] = (sev[ev.severity] ?? 0) + 1;
        return { ...p, active_alerts_count: p.active_alerts_count + 1, active_alerts_by_severity: sev };
      }));
    });

    // Alert resolved — полный refetch, чтобы не гадать о severity.
    effect(() => {
      const ev = this.ws.printerAlertResolved();
      if (!ev) return;
      this.refresh();
    });

    // Reconnect — могли пропустить события, полный refetch.
    effect(() => {
      const state = this.ws.connectionState();
      if (state.connected) this.refresh();
    });
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.refresh();
  }

  refresh(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.listPrinters().subscribe({
      next: (list) => {
        this.printers.set(list.filter(p => p.is_active));
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? err?.message ?? 'Не удалось загрузить данные.');
        this.loading.set(false);
      },
    });
  }
}
