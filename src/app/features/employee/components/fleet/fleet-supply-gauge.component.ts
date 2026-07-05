import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { supplyLevelColor } from './utils/supply-color.util';

/**
 * Radial SVG gauge 80×80 для уровня расходника. Pure presentational.
 */
@Component({
  selector: 'app-fleet-supply-gauge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gauge" [attr.aria-label]="ariaLabel()">
      <svg width="80" height="80" viewBox="0 0 80 80" role="img" focusable="false">
        <g transform="rotate(-90 40 40)">
          <circle cx="40" cy="40" r="34" fill="none" stroke="#e5e7eb" stroke-width="8" />
          @if (hasValue()) {
            <circle
              cx="40" cy="40" r="34" fill="none"
              [attr.stroke]="strokeColor()"
              stroke-width="8"
              stroke-linecap="round"
              [attr.stroke-dasharray]="circumference"
              [attr.stroke-dashoffset]="dashOffset()"
            />
          }
        </g>
        <text
          x="40" y="40"
          text-anchor="middle" dominant-baseline="middle"
          class="gauge-pct">{{ valueLabel() }}</text>
      </svg>
      @if (label()) {
        <span class="gauge-label" [style.color]="labelColor()">{{ label() }}</span>
      }
    </div>
  `,
  styles: [`
    :host { display: inline-flex; }
    .gauge {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    svg { display: block; }
    .gauge-pct {
      font-size: 15px;
      font-weight: 700;
      fill: #111827;
      font-family: var(--crm-font-sans, system-ui);
    }
    .gauge-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
  `]
})
export class FleetSupplyGaugeComponent {
  readonly percentage = input<number | null | undefined>(null);
  readonly label = input<string>('');
  readonly colorant = input<string | null>(null);

  readonly circumference = 2 * Math.PI * 34;

  readonly hasValue = computed(() => {
    const p = this.percentage();
    return typeof p === 'number' && !Number.isNaN(p);
  });

  readonly dashOffset = computed(() => {
    const p = this.percentage();
    if (typeof p !== 'number') return this.circumference;
    const clamped = Math.max(0, Math.min(100, p));
    return this.circumference * (1 - clamped / 100);
  });

  readonly strokeColor = computed(() => supplyLevelColor(this.percentage()));

  readonly labelColor = computed(() => {
    const c = this.colorant();
    if (!c) return '#6b7280';
    const key = c.trim().toLowerCase();
    if (key === 'k') return '#111';
    if (key === 'c') return '#00BCD4';
    if (key === 'm') return '#E91E63';
    if (key === 'y') return '#FFC107';
    return '#6b7280';
  });

  readonly valueLabel = computed(() => {
    const p = this.percentage();
    return typeof p === 'number' ? `${Math.round(p)}%` : '—%';
  });

  readonly ariaLabel = computed(() => {
    const p = this.percentage();
    const val = typeof p === 'number' ? `${Math.round(p)}%` : '—';
    return `${this.label()}: ${val}`;
  });
}
