import { Component, ChangeDetectionStrategy, inject, signal, effect, PLATFORM_ID, OnInit, computed, input } from '@angular/core';
import { isPlatformBrowser, DatePipe } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet, ActivatedRoute, Router } from '@angular/router';
import { FleetApiService } from './services/fleet-api.service';
import { FleetDetailStateService } from './services/fleet-detail-state.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { FleetStatusBadgeComponent } from './fleet-status-badge.component';

/**
 * Shell-контейнер для детальной страницы принтера. 3 табa (telemetry / alerts / jobs),
 * каждый — child-route. Заголовок, статус-бейдж и действия (обновить, заменить расходник)
 * — общие для всех табов.
 */
@Component({
  selector: 'app-fleet-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, DatePipe, FleetStatusBadgeComponent],
  providers: [
    // Предоставляем detail через providedIn в роуте — но проще inject в tabs через контекст.
  ],
  template: `
    <div class="fleet-detail">
      <nav class="bread">
        <a routerLink="/employee/fleet" class="bread-back">← Все принтеры</a>
      </nav>

      @if (detail(); as d) {
        <header class="detail-head">
          <div class="detail-title">
            <h1>{{ d.printer.name }}</h1>
            <div class="detail-meta">
              @if (d.telemetry?.manufacturer) {
                <span>{{ d.telemetry!.manufacturer }}</span>
              }
              @if (d.telemetry?.model) {
                <span>· {{ d.telemetry!.model }}</span>
              }
              @if (d.telemetry?.serial_number) {
                <span>· SN {{ d.telemetry!.serial_number }}</span>
              }
              @if (d.telemetry?.firmware_version) {
                <span>· FW {{ d.telemetry!.firmware_version }}</span>
              }
            </div>
          </div>
          <div class="detail-status">
            <app-fleet-status-badge
              [isOnline]="d.telemetry?.is_online ?? null"
              [collectedAt]="d.telemetry?.collected_at ?? null" />
            @if (d.telemetry?.collected_at) {
              <span class="detail-time">Опрос: {{ d.telemetry!.collected_at | date:'HH:mm:ss, dd MMM' }}</span>
            }
          </div>
        </header>

        <nav class="tabs" role="tablist">
          <a class="tab" routerLink="telemetry" routerLinkActive="tab--active" role="tab">Телеметрия</a>
          <a class="tab" routerLink="alerts"    routerLinkActive="tab--active" role="tab">
            Алерты
            @if (d.active_alerts.length > 0) {
              <span class="tab-badge">{{ d.active_alerts.length }}</span>
            }
          </a>
          <a class="tab" routerLink="jobs"      routerLinkActive="tab--active" role="tab">Задания</a>
        </nav>

        <router-outlet />
      } @else if (error()) {
        <div class="alert-error" role="alert">
          <strong>Не удалось загрузить принтер.</strong> {{ error() }}
          <button type="button" (click)="refresh()">Повторить</button>
        </div>
      } @else {
        <div class="skeleton-head"></div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .fleet-detail {
      max-width: 1120px;
      margin: 0 auto;
      padding: 20px 24px 48px;
    }
    .bread { margin-bottom: 16px; }
    .bread-back {
      font-size: 13px;
      color: #4b5563;
      text-decoration: none;
      font-weight: 500;
    }
    .bread-back:hover { color: #111827; }

    .detail-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }
    .detail-title h1 {
      margin: 0;
      font-size: clamp(20px, 3vw, 26px);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .detail-meta {
      margin-top: 6px;
      font-size: 12px;
      color: #6b7280;
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .detail-status {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }
    .detail-time {
      font-size: 11px;
      color: #9ca3af;
    }

    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      margin-bottom: 20px;
    }
    .tab {
      padding: 10px 16px;
      text-decoration: none;
      color: #4b5563;
      font-size: 14px;
      font-weight: 600;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .tab:hover { color: #111827; }
    .tab--active {
      color: #111827;
      border-bottom-color: #111827;
    }
    .tab-badge {
      background: #ef4444;
      color: #fff;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      min-width: 18px;
      text-align: center;
      line-height: 1.4;
    }

    .skeleton-head {
      height: 80px;
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(0, 0, 0, 0.04) 25%, rgba(0, 0, 0, 0.08) 50%, rgba(0, 0, 0, 0.04) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }

    .alert-error {
      padding: 12px 16px;
      background: rgba(239, 68, 68, 0.08);
      border: 1px solid rgba(239, 68, 68, 0.22);
      border-radius: 10px;
      color: #b91c1c;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .alert-error button {
      background: #dc2626;
      color: #fff;
      border: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
    }
  `]
})
export class FleetDetailComponent implements OnInit {
  readonly id = input.required<string>();

  private readonly api = inject(FleetApiService);
  private readonly ws = inject(WebSocketService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly state = inject(FleetDetailStateService);

  readonly detail = this.state.detail;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly printerId = computed(() => this.id());

  constructor() {
    // Partial telemetry update (только для текущего принтера).
    effect(() => {
      const ev = this.ws.printerTelemetryUpdated();
      const id = this.printerId();
      if (!ev || ev.printerId !== id) return;
      const cur = this.detail();
      if (!cur) return;
      this.state.detail.set({
        ...cur,
        telemetry: cur.telemetry
          ? {
              ...cur.telemetry,
              is_online: ev.isOnline,
              state: ev.state,
              collected_at: ev.collectedAt,
            }
          : cur.telemetry,
      });
    });

    // Alert raised/resolved для текущего принтера — refetch.
    effect(() => {
      const raised = this.ws.printerAlertRaised();
      const resolved = this.ws.printerAlertResolved();
      const id = this.printerId();
      if ((raised && raised.printerId === id) || (resolved && resolved.printerId === id)) {
        this.refresh();
      }
    });
  }

  ngOnInit(): void {
    this.state.printerId.set(this.id());
    if (!isPlatformBrowser(this.platformId)) return;
    this.refresh();
  }

  refresh(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.loading.set(true);
    this.error.set(null);
    this.api.getPrinter(this.id()).subscribe({
      next: (d) => {
        this.state.detail.set(d);
        this.loading.set(false);
      },
      error: (err) => {
        if (err?.status === 404) {
          this.router.navigate(['/employee/fleet']);
          return;
        }
        this.error.set(err?.error?.message ?? err?.message ?? 'Ошибка.');
        this.loading.set(false);
      },
    });
  }
}
