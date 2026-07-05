import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AdminEmployeeEarnings } from '../../services/shifts-api.service';

@Component({
  selector: 'app-admin-commission-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  template: `
    <div class="acs-strip">
      <div class="acs-card">
        <mat-icon>trending_up</mat-icon>
        <div class="acs-data">
          <span class="acs-value">{{ totals().revenue | number:'1.0-0' }} \u20BD</span>
          <span class="acs-label">Общая выручка</span>
        </div>
      </div>
      <div class="acs-card accent">
        <mat-icon>payments</mat-icon>
        <div class="acs-data">
          <span class="acs-value">{{ totals().commission | number:'1.0-0' }} \u20BD</span>
          <span class="acs-label">Общая комиссия</span>
        </div>
      </div>
      <div class="acs-card">
        <mat-icon>receipt</mat-icon>
        <div class="acs-data">
          <span class="acs-value">{{ totals().avgCheck | number:'1.0-0' }} \u20BD</span>
          <span class="acs-label">Средний чек</span>
        </div>
      </div>
      <div class="acs-card">
        <mat-icon>groups</mat-icon>
        <div class="acs-data">
          <span class="acs-value">{{ earnings().length }}</span>
          <span class="acs-label">Сотрудников</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .acs-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }

    .acs-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: var(--crm-radius-lg, 12px);
      backdrop-filter: blur(12px);

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
        color: var(--crm-text-muted, #999);
        flex-shrink: 0;
      }

      &.accent {
        border-color: rgba(52, 211, 153, 0.2);
        background: rgba(52, 211, 153, 0.04);

        mat-icon { color: var(--crm-status-success); }
        .acs-value { color: var(--crm-status-success); }
      }
    }

    .acs-data {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .acs-value {
      font-size: 18px;
      font-weight: 700;
      color: var(--crm-text-primary, #fff);
      line-height: 1;
      white-space: nowrap;
    }

    .acs-label {
      font-size: 11px;
      color: var(--crm-text-secondary, #999);
      margin-top: 3px;
    }

    @media (max-width: 768px) {
      .acs-strip { grid-template-columns: repeat(2, 1fr); }
    }
  `],
})
export class AdminCommissionSummaryComponent {
  readonly earnings = input.required<AdminEmployeeEarnings[]>();

  readonly totals = computed(() => {
    const list = this.earnings();
    let revenue = 0;
    let commission = 0;
    for (const e of list) {
      revenue += e.revenue;
      commission += e.commission;
    }
    const avgCheck = list.length > 0
      ? Math.round(revenue / Math.max(1, list.reduce((sum, e) => sum + e.orders_count, 0)))
      : 0;
    return { revenue, commission, avgCheck };
  });
}
