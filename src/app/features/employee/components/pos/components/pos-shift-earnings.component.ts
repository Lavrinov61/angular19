import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { ShiftReport } from '../../../services/pos-api.service';

@Component({
  selector: 'app-pos-shift-earnings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  template: `
    <div class="earnings-strip">
      <div class="earnings-item">
        <mat-icon>receipt_long</mat-icon>
        <div class="earnings-data">
          <span class="earnings-value">{{ shiftReport().receipts_count }}</span>
          <span class="earnings-label">Чеков за смену</span>
        </div>
      </div>
      <div class="earnings-divider"></div>
      <div class="earnings-item">
        <mat-icon>point_of_sale</mat-icon>
        <div class="earnings-data">
          <span class="earnings-value">{{ shiftReport().net_sales | number:'1.0-0' }} \u20BD</span>
          <span class="earnings-label">Нетто-продажи</span>
        </div>
      </div>
      @if (commissionSummary(); as comm) {
        <div class="earnings-divider"></div>
        <div class="earnings-item accent">
          <mat-icon>payments</mat-icon>
          <div class="earnings-data">
            <span class="earnings-value">{{ comm.total_commission | number:'1.0-0' }} \u20BD</span>
            <span class="earnings-label">Комиссия</span>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .earnings-strip {
      display: flex;
      align-items: center;
      padding: 12px 16px;
      background: var(--mat-sys-surface-container-low);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      margin: 12px 0;
    }

    .earnings-item {
      display: flex;
      align-items: center;
      gap: 8px;
      flex: 1;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--mat-sys-on-surface-variant);
        flex-shrink: 0;
      }

      &.accent mat-icon {
        color: var(--crm-status-success);
      }
    }

    .earnings-data {
      display: flex;
      flex-direction: column;
    }

    .earnings-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
      line-height: 1;
    }

    .accent .earnings-value {
      color: var(--crm-status-success);
    }

    .earnings-label {
      font-size: 10px;
      color: var(--mat-sys-on-surface-variant);
      margin-top: 2px;
    }

    .earnings-divider {
      width: 1px;
      height: 28px;
      background: var(--mat-sys-outline-variant);
      flex-shrink: 0;
      margin: 0 8px;
    }
  `],
})
export class PosShiftEarningsComponent {
  readonly shiftReport = input.required<ShiftReport>();
  readonly commissionSummary = input<{ total_sales: number; total_commission: number; receipts_count: number } | null>(null);
}
