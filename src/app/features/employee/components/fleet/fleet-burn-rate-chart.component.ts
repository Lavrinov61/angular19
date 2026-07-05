import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { BurnRateResponse, BurnRateSupplyEstimate } from './models/fleet.models';
import { colorantToHex } from './utils/supply-color.util';

interface PlottedPoint {
  id: string;
  cx: number;
  cy: number;
  color: string;
  label: string;
  days: number;
}

const VIEWBOX_W = 440;
const VIEWBOX_H = 180;
const MARGIN_LEFT = 36;
const MARGIN_RIGHT = 20;
const MARGIN_TOP = 28;
const MARGIN_BOTTOM = 28;
const DAYS_MAX = 30;

@Component({
  selector: 'app-fleet-burn-rate-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="skeleton" aria-hidden="true"></div>
    } @else if (isEmpty()) {
      <div class="empty">Нет данных за 7 дней</div>
    } @else {
      <div class="stats">
        <div class="stat">
          <span class="stat-value">{{ data()!.pages_printed_7d }}</span>
          <span class="stat-label">страниц за 7 дней</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ data()!.pages_per_day_avg }}</span>
          <span class="stat-label">в среднем в день</span>
        </div>
      </div>
      <svg
        [attr.viewBox]="viewBox"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        focusable="false"
        [attr.aria-label]="ariaLabel()">

        <line
          [attr.x1]="axisX1" [attr.y1]="axisYBottom"
          [attr.x2]="axisX2" [attr.y2]="axisYBottom"
          stroke="#d1d5db" stroke-width="1" />
        <line
          [attr.x1]="axisX1" [attr.y1]="axisYTop"
          [attr.x2]="axisX1" [attr.y2]="axisYBottom"
          stroke="#d1d5db" stroke-width="1" />

        @for (tick of xTicks; track tick.days) {
          <g>
            <line
              [attr.x1]="tick.x" [attr.y1]="axisYBottom"
              [attr.x2]="tick.x" [attr.y2]="axisYBottom + 4"
              stroke="#d1d5db" stroke-width="1" />
            <text
              [attr.x]="tick.x" [attr.y]="axisYBottom + 16"
              text-anchor="middle" class="tick-label">{{ tick.days }}д</text>
          </g>
        }
        <text
          [attr.x]="(axisX1 + axisX2) / 2" [attr.y]="viewBoxH - 4"
          text-anchor="middle" class="axis-title">Дней до исчерпания</text>

        @if (points().length === 0) {
          <text
            [attr.x]="(axisX1 + axisX2) / 2" [attr.y]="(axisYTop + axisYBottom) / 2"
            text-anchor="middle" class="no-critical">Все расходники выше 30 дней</text>
        } @else {
          @for (p of points(); track p.id) {
            <g>
              <circle
                [attr.cx]="p.cx" [attr.cy]="p.cy" r="6"
                [attr.fill]="p.color" stroke="#fff" stroke-width="1.5" />
              <text
                [attr.x]="p.cx + 10" [attr.y]="p.cy + 4"
                class="point-label">{{ p.label }}: {{ p.days }}д</text>
            </g>
          }
        }
      </svg>
    }
  `,
  styles: [`
    :host {
      display: block;
    }
    .stats {
      display: flex;
      gap: 24px;
      margin-bottom: 8px;
    }
    .stat {
      display: flex;
      flex-direction: column;
    }
    .stat-value {
      font-size: 20px;
      font-weight: 800;
      line-height: 1;
      color: #111827;
    }
    .stat-label {
      font-size: 11px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-top: 4px;
    }
    svg {
      width: 100%;
      height: auto;
      display: block;
    }
    .tick-label {
      font-size: 10px;
      fill: #6b7280;
      font-family: var(--crm-font-mono, monospace);
    }
    .axis-title {
      font-size: 10px;
      fill: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .point-label {
      font-size: 11px;
      font-weight: 600;
      fill: #111827;
    }
    .no-critical {
      font-size: 12px;
      fill: #9ca3af;
      font-style: italic;
    }
    .skeleton {
      height: 180px;
      border-radius: 8px;
      background: linear-gradient(90deg, rgba(0,0,0,0.04) 25%, rgba(0,0,0,0.08) 50%, rgba(0,0,0,0.04) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.4s ease-in-out infinite;
    }
    @keyframes shimmer { to { background-position: -200% 0; } }
    .empty {
      padding: 32px 16px;
      text-align: center;
      font-size: 13px;
      color: #9ca3af;
      background: #fafafa;
      border: 1px dashed rgba(0,0,0,0.08);
      border-radius: 8px;
    }
  `]
})
export class FleetBurnRateChartComponent {
  readonly data = input<BurnRateResponse | null>(null);
  readonly loading = input<boolean>(false);

  readonly viewBoxW = VIEWBOX_W;
  readonly viewBoxH = VIEWBOX_H;
  readonly viewBox = `0 0 ${VIEWBOX_W} ${VIEWBOX_H}`;

  readonly axisX1 = MARGIN_LEFT;
  readonly axisX2 = VIEWBOX_W - MARGIN_RIGHT;
  readonly axisYTop = MARGIN_TOP;
  readonly axisYBottom = VIEWBOX_H - MARGIN_BOTTOM;

  readonly xTicks = [0, 7, 14, 21, 30].map(days => ({
    days,
    x: MARGIN_LEFT + ((VIEWBOX_W - MARGIN_LEFT - MARGIN_RIGHT) * days) / DAYS_MAX,
  }));

  readonly isEmpty = computed(() => {
    const d = this.data();
    if (!d) return true;
    return d.pages_per_day_avg === 0 && d.pages_printed_7d === 0;
  });

  readonly points = computed<PlottedPoint[]>(() => {
    const d = this.data();
    if (!d) return [];
    const critical: BurnRateSupplyEstimate[] = d.estimated_days_remaining_by_supply
      .filter(s => typeof s.days_left === 'number' && s.days_left !== null && s.days_left <= DAYS_MAX);

    if (critical.length === 0) return [];

    const plotW = VIEWBOX_W - MARGIN_LEFT - MARGIN_RIGHT;
    const plotH = this.axisYBottom - this.axisYTop - 20;
    const stepY = critical.length > 1 ? plotH / (critical.length - 1) : 0;

    return critical.map((s, i) => {
      const days = Math.max(0, Math.min(DAYS_MAX, s.days_left ?? 0));
      const cx = MARGIN_LEFT + (plotW * days) / DAYS_MAX;
      const cy = this.axisYTop + 10 + stepY * i;
      return {
        id: `${s.supply_type}-${s.colorant ?? 'x'}-${i}`,
        cx,
        cy,
        color: colorantToHex(s.colorant),
        label: (s.colorant ?? s.supply_type).toUpperCase(),
        days,
      };
    });
  });

  readonly ariaLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    return `График расхода расходников, среднее ${d.pages_per_day_avg} страниц в день`;
  });
}
