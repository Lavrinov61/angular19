import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

import { RegistrationSummary } from '../../services/registrations-api.service';

@Component({
  selector: 'app-reg-kpi-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatCardModule, MatIconModule],
  template: `
    <div class="kpi-row">
      <mat-card appearance="outlined" class="kpi-card">
        <mat-icon>people</mat-icon>
        <span class="kpi-value">{{ summary().totalUsers | number }}</span>
        <span class="kpi-label">Всего пользователей</span>
      </mat-card>

      <mat-card appearance="outlined" class="kpi-card">
        <mat-icon class="accent">person_add</mat-icon>
        <span class="kpi-value accent">{{ summary().newInPeriod | number }}</span>
        <span class="kpi-label">Новых за период</span>
        @if (deltaInfo(); as d) {
          <span class="delta" [class.up]="d.up" [class.down]="!d.up && d.value !== 0">
            <mat-icon class="delta-icon">{{ d.up ? 'trending_up' : (d.value === 0 ? 'trending_flat' : 'trending_down') }}</mat-icon>
            {{ d.label }}
          </span>
        }
      </mat-card>

      <mat-card appearance="outlined" class="kpi-card">
        <mat-icon>verified</mat-icon>
        <span class="kpi-value">{{ summary().emailVerified | number }}</span>
        <span class="kpi-label">Email подтверждён</span>
      </mat-card>

      <mat-card appearance="outlined" class="kpi-card">
        <mat-icon class="success">shopping_bag</mat-icon>
        <span class="kpi-value">{{ summary().conversionPct }}%</span>
        <span class="kpi-label">Конверсия в заказ</span>
        @if (avgDaysLabel(); as a) {
          <span class="kpi-sub">~{{ a }}</span>
        }
      </mat-card>
    </div>
  `,
  styles: [`
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    @media (min-width: 720px) {
      .kpi-row { grid-template-columns: repeat(4, 1fr); }
    }
    .kpi-card {
      padding: 16px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .kpi-card mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--mat-sys-primary);
    }
    .kpi-card mat-icon.accent { color: var(--mat-sys-secondary); }
    .kpi-card mat-icon.success { color: #10B981; }

    .kpi-value {
      display: block;
      font-size: 26px;
      font-weight: 700;
      line-height: 1.15;
      color: var(--mat-sys-on-surface);
    }
    .kpi-value.accent { color: var(--mat-sys-secondary); }
    .kpi-label {
      display: block;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
    }
    .kpi-sub {
      display: block;
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      opacity: 0.8;
      margin-top: 2px;
    }

    .delta {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      font-size: 11px;
      font-weight: 600;
      margin-top: 2px;
      padding: 2px 6px;
      border-radius: 10px;
      line-height: 1;
    }
    .delta.up    { background: rgba(16, 185, 129, 0.12); color: #10B981; }
    .delta.down  { background: rgba(239, 68, 68, 0.12);  color: #EF4444; }
    .delta:not(.up):not(.down) {
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    .delta-icon {
      font-size: 12px !important;
      width: 12px !important;
      height: 12px !important;
      color: inherit !important;
    }
  `],
})
export class KpiRowComponent {
  readonly summary = input.required<RegistrationSummary>();

  readonly deltaInfo = computed<{ up: boolean; value: number; label: string } | null>(() => {
    const s = this.summary();
    const prev = s.previousPeriodNew;
    const curr = s.newInPeriod;
    if (prev === 0 && curr === 0) return null;
    if (prev === 0) {
      return { up: true, value: 100, label: 'new' };
    }
    const diff = ((curr - prev) / prev) * 100;
    const rounded = Math.round(diff);
    const sign = rounded > 0 ? '+' : '';
    return {
      up: rounded > 0,
      value: rounded,
      label: `${sign}${rounded}%`,
    };
  });

  readonly avgDaysLabel = computed<string | null>(() => {
    const d = this.summary().avgDaysToConversion;
    if (d === null || d === undefined) return null;
    if (d < 1) return 'меньше дня';
    return `${Math.round(d)} дн`;
  });
}
