import { Component, ChangeDetectionStrategy, inject, computed, signal, effect, PLATFORM_ID } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { MatDialog } from '@angular/material/dialog';
import { FleetDetailStateService } from './services/fleet-detail-state.service';
import { FleetApiService } from './services/fleet-api.service';
import { FleetSupplyGaugeComponent } from './fleet-supply-gauge.component';
import { FleetBurnRateChartComponent } from './fleet-burn-rate-chart.component';
import { SuppliesReplaceDialogComponent, SuppliesReplaceDialogData, SuppliesReplaceDialogResult } from './supplies-replace-dialog.component';
import { BurnRateResponse } from './models/fleet.models';

@Component({
  selector: 'app-fleet-detail-telemetry-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, FleetSupplyGaugeComponent, FleetBurnRateChartComponent],
  template: `
    @if (telemetry(); as t) {
      <div class="t-grid">
        <section class="t-card">
          <h3>Состояние</h3>
          <dl class="kv">
            <dt>Статус</dt>
            <dd>{{ t.state ?? '—' }}</dd>
            @if (t.state_reasons && t.state_reasons.length > 0) {
              <dt>Причины</dt>
              <dd>{{ t.state_reasons.join(', ') }}</dd>
            }
            <dt>Счётчик</dt>
            <dd>
              @if (t.counters?.lifetime !== null && t.counters?.lifetime !== undefined) {
                {{ t.counters!.lifetime }} страниц
              } @else { — }
            </dd>
          </dl>
        </section>

        <section class="t-card">
          <h3>Последние замены</h3>
          @if (replacements().length === 0) {
            <p class="empty">Замен не было.</p>
          } @else {
            <ul class="repl-list">
              @for (r of replacements(); track r.id) {
                <li>
                  <span class="repl-type">{{ r.supply_type }}</span>
                  @if (r.replaced_by_name) {
                    <span class="repl-by">· {{ r.replaced_by_name }}</span>
                  }
                  <span class="repl-when">{{ r.replaced_at | date:'dd MMM HH:mm' }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <section class="t-card t-card--wide">
          <div class="section-head">
            <h3>Расход и прогноз</h3>
          </div>
          <app-fleet-burn-rate-chart
            [data]="burnRate()"
            [loading]="burnRateLoading()" />
        </section>

        @if (supplies().length > 0) {
          <section class="t-card t-card--wide">
            <div class="section-head">
              <h3>Расходники</h3>
              <button type="button" class="btn-primary" (click)="openReplaceDialog()">Заменить расходник</button>
            </div>
            <div class="gauges">
              @for (s of supplies(); track s.index ?? s.colorant ?? $index) {
                <app-fleet-supply-gauge
                  [percentage]="s.level_pct ?? null"
                  [label]="(s.colorant ?? s.description ?? s.type) ?? ''"
                  [colorant]="s.colorant ?? null" />
              }
            </div>
          </section>
        } @else {
          <section class="t-card t-card--wide">
            <div class="section-head">
              <h3>Расходники</h3>
              <button type="button" class="btn-primary" (click)="openReplaceDialog()">Заменить расходник</button>
            </div>
            <p class="empty">Нет данных по расходникам.</p>
          </section>
        }

        @if (trays().length > 0) {
          <section class="t-card t-card--wide">
            <h3>Лотки</h3>
            <ul class="trays">
              @for (tr of trays(); track tr.index ?? $index) {
                <li>
                  <span class="tray-name">{{ tr.name ?? 'Лоток ' + (tr.index ?? '?') }}</span>
                  @if (tr.current_level !== null && tr.current_level !== undefined && tr.max_capacity) {
                    <span class="tray-level">{{ tr.current_level }} / {{ tr.max_capacity }}</span>
                  } @else {
                    <span class="tray-level">—</span>
                  }
                  @if (tr.media_name) {
                    <span class="tray-media">{{ tr.media_name }}</span>
                  }
                </li>
              }
            </ul>
          </section>
        }
      </div>
    } @else {
      <div class="empty">Нет данных телеметрии.</div>
    }
  `,
  styles: [`
    :host { display: block; }
    .t-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
    }
    @media (max-width: 720px) { .t-grid { grid-template-columns: 1fr; } }
    .t-card {
      background: #fff;
      border: 1px solid rgba(0, 0, 0, 0.08);
      border-radius: 12px;
      padding: 16px 20px;
    }
    .t-card--wide { grid-column: 1 / -1; }
    .t-card h3 {
      margin: 0 0 12px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      font-weight: 700;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    .section-head h3 { margin: 0; }
    .btn-primary {
      background: #111827;
      color: #fff;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-primary:hover { background: #1f2937; }

    .kv { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; margin: 0; font-size: 13px; }
    .kv dt { color: #6b7280; }
    .kv dd { margin: 0; color: #111827; font-weight: 500; }

    .repl-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    .repl-list li { font-size: 13px; display: flex; gap: 6px; align-items: baseline; }
    .repl-type { font-weight: 700; }
    .repl-by { color: #6b7280; font-size: 12px; }
    .repl-when { margin-left: auto; font-size: 11px; color: #9ca3af; }

    .gauges {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      gap: 16px;
      justify-items: center;
    }

    .trays { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
    .trays li { display: flex; gap: 12px; align-items: baseline; }
    .tray-name { font-weight: 600; }
    .tray-level { color: #4b5563; }
    .tray-media { color: #9ca3af; font-size: 12px; margin-left: auto; }

    .empty { padding: 24px; text-align: center; color: #9ca3af; font-style: italic; }
  `]
})
export class FleetDetailTelemetryTabComponent {
  private readonly state = inject(FleetDetailStateService);
  private readonly api = inject(FleetApiService);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);

  readonly telemetry = computed(() => this.state.detail()?.telemetry ?? null);
  readonly replacements = computed(() => this.state.detail()?.recent_replacements ?? []);
  readonly supplies = computed(() => this.telemetry()?.supplies ?? []);
  readonly trays = computed(() => this.telemetry()?.trays ?? []);

  readonly burnRate = signal<BurnRateResponse | null>(null);
  readonly burnRateLoading = signal(false);

  private lastFetchedPrinterId: string | null = null;

  constructor() {
    effect(() => {
      const d = this.state.detail();
      if (!d) return;
      const pid = d.printer.id;
      if (pid === this.lastFetchedPrinterId) return;
      this.lastFetchedPrinterId = pid;
      this.fetchBurnRate(pid);
    });
  }

  private fetchBurnRate(printerId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.burnRateLoading.set(true);
    this.api.getBurnRate(printerId).subscribe({
      next: (r) => {
        this.burnRate.set(r);
        this.burnRateLoading.set(false);
      },
      error: () => {
        this.burnRate.set(null);
        this.burnRateLoading.set(false);
      },
    });
  }

  openReplaceDialog(): void {
    const d = this.state.detail();
    if (!d) return;
    const data: SuppliesReplaceDialogData = {
      printerId: d.printer.id,
      printerName: d.printer.name,
    };
    const ref = this.dialog.open<SuppliesReplaceDialogComponent, SuppliesReplaceDialogData, SuppliesReplaceDialogResult | null>(
      SuppliesReplaceDialogComponent,
      { data, width: '520px', autoFocus: true, restoreFocus: true },
    );
    ref.afterClosed().subscribe(res => {
      if (!res) return;
      const pid = this.state.detail()?.printer.id;
      if (!pid) return;
      this.api.getPrinter(pid).subscribe({
        next: (fresh) => this.state.detail.set(fresh),
        error: () => { /* родительский ws effect всё равно дёрнет refresh через alert-resolved */ },
      });
      this.fetchBurnRate(pid);
    });
  }
}
