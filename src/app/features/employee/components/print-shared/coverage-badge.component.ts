import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CoverageResult } from '../../services/coverage-analysis.service';

@Component({
  selector: 'app-coverage-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, MatTooltipModule, MatProgressSpinnerModule],
  host: {
    '[class.coverage-badge-host]': 'true',
    '[class.hidden]': '!result() && !loading()',
  },
  template: `
    @if (loading()) {
      <div class="coverage-badge loading">
        <mat-spinner diameter="14"></mat-spinner>
        <span class="badge-text">Анализ...</span>
      </div>
    } @else if (result()) {
      <div class="coverage-badge" [class]="tierClass()"
           [matTooltip]="tooltipText()">
        <mat-icon class="badge-icon">{{ tierIcon() }}</mat-icon>
        <span class="badge-percent">{{ result()!.coverage_percent | number: '1.0-0' }}%</span>
        <span class="badge-price">{{ result()!.recommended_name }} · {{ result()!.recommended_price }} &#8381;</span>
        @if (overridden()) {
          <span class="badge-overridden">изменено</span>
        }
      </div>
    }
  `,
  styles: [`
    :host.hidden { display: none; }

    .coverage-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      white-space: nowrap;
    }

    .coverage-badge.loading {
      background: rgba(0, 0, 0, 0.06);
      color: var(--crm-text-secondary, #666);
    }

    .badge-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .badge-percent {
      font-weight: 600;
    }

    .badge-price {
      opacity: 0.8;
    }

    .badge-overridden {
      font-size: 10px;
      opacity: 0.6;
      font-style: italic;
    }

    .tier-low {
      background: rgba(76, 175, 80, 0.12);
      color: #2e7d32;
    }
    .tier-low .badge-icon { color: #4caf50; }

    .tier-medium {
      background: rgba(255, 152, 0, 0.12);
      color: #e65100;
    }
    .tier-medium .badge-icon { color: #ff9800; }

    .tier-high {
      background: rgba(244, 67, 54, 0.12);
      color: #c62828;
    }
    .tier-high .badge-icon { color: #f44336; }

    .badge-text {
      color: var(--crm-text-secondary, #666);
    }
  `],
})
export class CoverageBadgeComponent {
  readonly result = input<CoverageResult | null>(null);
  readonly loading = input(false);
  readonly overridden = input(false);

  readonly tierClass = computed(() => {
    const r = this.result();
    if (!r) return '';
    if (r.coverage_percent < 15) return 'tier-low';
    if (r.coverage_percent <= 50) return 'tier-medium';
    return 'tier-high';
  });

  readonly tierIcon = computed(() => {
    const r = this.result();
    if (!r) return 'palette';
    if (r.coverage_percent < 15) return 'eco';
    if (r.coverage_percent <= 50) return 'palette';
    return 'local_fire_department';
  });

  readonly tooltipText = computed(() => {
    const r = this.result();
    if (!r) return '';
    const cmyk = r.coverage_cmyk;
    return `Заливка: ${r.coverage_percent.toFixed(1)}% (${r.tier})\n` +
      `C: ${cmyk.c.toFixed(1)}% | M: ${cmyk.m.toFixed(1)}% | Y: ${cmyk.y.toFixed(1)}% | K: ${cmyk.k.toFixed(1)}%\n` +
      `Рекомендация: ${r.recommended_name} (${r.recommended_price} ₽)`;
  });
}
