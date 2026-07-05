import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DashboardDataService } from '../../services/dashboard-data.service';

@Component({
  selector: 'app-dashboard-commission-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  template: `
    @if (commission(); as c) {
      <div class="commission-strip">
        <div class="commission-item accent">
          <mat-icon>payments</mat-icon>
          <div class="commission-data">
            <span class="commission-value">{{ c.todayCommission | number:'1.0-0' }} \u20BD</span>
            <span class="commission-label">Комиссия сегодня</span>
          </div>
        </div>
        <div class="commission-divider"></div>
        <div class="commission-item">
          <mat-icon>point_of_sale</mat-icon>
          <div class="commission-data">
            <span class="commission-value">{{ c.todayRevenue | number:'1.0-0' }} \u20BD</span>
            <span class="commission-label">Выручка сегодня</span>
          </div>
        </div>
        <div class="commission-divider"></div>
        <div class="commission-item">
          <mat-icon>receipt_long</mat-icon>
          <div class="commission-data">
            <span class="commission-value">{{ c.posCount }}</span>
            <span class="commission-label">Чеков (POS)</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .commission-strip {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
    }

    .commission-item {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      padding: 2px 8px;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--crm-text-muted);
        flex-shrink: 0;
      }

      &.accent mat-icon {
        color: var(--crm-status-success);
      }
    }

    .commission-data {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .commission-value {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 22px;
      font-weight: 500;
      line-height: 1;
      color: var(--crm-text-primary);
      letter-spacing: -0.02em;
    }

    .accent .commission-value {
      color: var(--crm-status-success);
    }

    .commission-label {
      font-family: var(--crm-font-sans);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: var(--crm-text-muted);
      margin-top: 2px;
    }

    .commission-divider {
      width: 1px;
      height: 32px;
      background: var(--crm-border);
      flex-shrink: 0;
    }

    @media (max-width: 480px) {
      .commission-value { font-size: 18px; }
      .commission-item { padding: 2px 4px; }
    }
  `],
})
export class DashboardCommissionCardComponent {
  private readonly dashData = inject(DashboardDataService);
  readonly commission = this.dashData.shiftCommission;
}
