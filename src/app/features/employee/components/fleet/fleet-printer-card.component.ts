import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FleetStatusBadgeComponent } from './fleet-status-badge.component';
import { FleetAlertChipComponent } from './fleet-alert-chip.component';
import { PrinterListItem, SupplySummary } from './models/fleet.models';

@Component({
  selector: 'app-fleet-printer-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, FleetStatusBadgeComponent, FleetAlertChipComponent],
  template: `
    <a class="card" [routerLink]="['/employee/fleet', printer().id, 'telemetry']">
      <header class="card-head">
        <div class="card-title">
          <h3 class="name">{{ printer().name }}</h3>
          <span class="type">{{ typeLabel() }}</span>
        </div>
        <app-fleet-status-badge
          [isOnline]="onlineValue()"
          [collectedAt]="collectedAt()" />
      </header>

      @if (alertCounts().critical + alertCounts().warn + alertCounts().info > 0) {
        <div class="card-alerts">
          <app-fleet-alert-chip severity="critical" [count]="alertCounts().critical" />
          <app-fleet-alert-chip severity="warn" [count]="alertCounts().warn" />
          <app-fleet-alert-chip severity="info" [count]="alertCounts().info" />
        </div>
      }

      @if (supplies().length > 0) {
        <div class="card-supplies">
          @for (s of supplies(); track s.index ?? s.colorant ?? $index) {
            <div class="supply" [class.supply--low]="isLow(s.level_pct)" [class.supply--crit]="isCritical(s.level_pct)">
              <span class="supply-label">{{ supplyLabel(s) }}</span>
              <div class="supply-bar">
                <div class="supply-fill" [style.width.%]="s.level_pct ?? 0"></div>
              </div>
              <span class="supply-pct">{{ s.level_pct !== null ? s.level_pct + '%' : '—' }}</span>
            </div>
          }
        </div>
      } @else {
        <div class="card-empty">Нет данных о расходниках</div>
      }

      <footer class="card-foot">
        @if (collectedAt()) {
          <span class="foot-time">Опрос {{ collectedAt() | date:'HH:mm, dd MMM' }}</span>
        } @else {
          <span class="foot-time foot-time--muted">Нет телеметрии</span>
        }
      </footer>
    </a>
  `,
  styles: [`
    :host { display: block; }
    .card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      background: var(--bg-elevated, #ffffff);
      border: 1px solid var(--border, rgba(0, 0, 0, 0.08));
      border-radius: 12px;
      text-decoration: none;
      color: inherit;
      transition: border-color 0.15s ease, transform 0.15s ease, box-shadow 0.15s ease;
    }
    .card:hover {
      border-color: rgba(0, 0, 0, 0.16);
      transform: translateY(-1px);
      box-shadow: 0 6px 14px rgba(0, 0, 0, 0.06);
    }
    .card-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .card-title { min-width: 0; }
    .name {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
      line-height: 1.2;
    }
    .type {
      display: block;
      font-size: 11px;
      color: #6b7280;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .card-alerts { display: flex; flex-wrap: wrap; gap: 6px; }
    .card-supplies {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .supply {
      display: grid;
      grid-template-columns: 60px 1fr 42px;
      gap: 8px;
      align-items: center;
      font-size: 12px;
    }
    .supply-label { color: #4b5563; text-transform: capitalize; font-weight: 500; }
    .supply-bar {
      height: 6px;
      background: rgba(0, 0, 0, 0.06);
      border-radius: 3px;
      overflow: hidden;
    }
    .supply-fill {
      height: 100%;
      background: linear-gradient(90deg, #22c55e, #10b981);
      transition: width 0.2s ease;
    }
    .supply--low .supply-fill { background: linear-gradient(90deg, #f59e0b, #ea580c); }
    .supply--crit .supply-fill { background: linear-gradient(90deg, #ef4444, #dc2626); }
    .supply-pct { text-align: right; color: #111827; font-weight: 700; font-size: 11px; }
    .supply--low .supply-pct { color: #b45309; }
    .supply--crit .supply-pct { color: #b91c1c; }
    .card-empty {
      font-size: 12px;
      color: #9ca3af;
      font-style: italic;
      padding: 4px 0;
    }
    .card-foot {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #6b7280;
      border-top: 1px solid rgba(0, 0, 0, 0.04);
      padding-top: 10px;
      margin-top: auto;
    }
    .foot-time--muted { color: #9ca3af; font-style: italic; }
  `]
})
export class FleetPrinterCardComponent {
  readonly printer = input.required<PrinterListItem>();

  readonly onlineValue = computed(() => this.printer().last_telemetry?.is_online ?? null);
  readonly collectedAt = computed(() => this.printer().last_telemetry?.collected_at ?? null);

  readonly alertCounts = computed(() => {
    const sev = this.printer().active_alerts_by_severity;
    return {
      critical: sev?.critical ?? 0,
      warn: sev?.warn ?? 0,
      info: sev?.info ?? 0,
    };
  });

  readonly supplies = computed<SupplySummary[]>(() => {
    const list = this.printer().last_telemetry?.supplies_summary ?? [];
    return list.filter(s => s.type === 'toner' || s.type === 'ink' || s.level_pct !== null).slice(0, 4);
  });

  readonly typeLabel = computed(() => {
    const t = this.printer().printer_type;
    switch (t) {
      case 'laser_bw':    return 'Лазерный Ч/Б';
      case 'laser_color': return 'Лазерный цветной';
      case 'mfp':         return 'МФУ';
      case 'inkjet':      return 'Струйный';
      case 'thermal':     return 'Термо';
      default:            return t;
    }
  });

  supplyLabel(s: SupplySummary): string {
    if (s.colorant) return s.colorant;
    if (s.description) return s.description;
    return s.type ?? '—';
  }
  isLow(pct: number | null): boolean { return pct !== null && pct > 15 && pct <= 30; }
  isCritical(pct: number | null): boolean { return pct !== null && pct <= 15; }
}
