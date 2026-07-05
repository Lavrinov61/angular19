import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface CheckoutSummaryData {
  shift: { shift_date: string; studio_name: string; start_time: string; end_time: string };
  hours_worked: number;
  pos_sales: { count: number; total: number };
  online_sales: { count: number; total: number; commission: number };
  total_commission: number;
  total_revenue: number;
}

@Component({
  selector: 'app-checkout-summary-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="cs-dialog">
      <div class="cs-header">
        <mat-icon class="cs-check-icon">check_circle</mat-icon>
        <h2 class="cs-title">Смена завершена</h2>
        @if (data.shift.studio_name) {
          <span class="cs-studio">{{ data.shift.studio_name }}</span>
        }
      </div>

      <div class="cs-hours">
        {{ formatHours(data.hours_worked) }}
      </div>

      <div class="cs-stats-grid">
        <div class="cs-stat-card">
          <mat-icon>point_of_sale</mat-icon>
          <div class="cs-stat-body">
            <span class="cs-stat-label">POS продажи</span>
            <span class="cs-stat-value">{{ data.pos_sales.count }} чеков</span>
            <span class="cs-stat-amount">{{ data.pos_sales.total | number:'1.0-0' }} \u20BD</span>
          </div>
        </div>

        <div class="cs-stat-card">
          <mat-icon>language</mat-icon>
          <div class="cs-stat-body">
            <span class="cs-stat-label">Онлайн-заказы</span>
            <span class="cs-stat-value">{{ data.online_sales.count }} заказов</span>
            <span class="cs-stat-amount">{{ data.online_sales.total | number:'1.0-0' }} \u20BD</span>
          </div>
        </div>

        <div class="cs-stat-card cs-stat-card--commission">
          <mat-icon>payments</mat-icon>
          <div class="cs-stat-body">
            <span class="cs-stat-label">Комиссия</span>
            <span class="cs-stat-amount cs-stat-amount--green">{{ data.total_commission | number:'1.0-0' }} \u20BD</span>
          </div>
        </div>

        <div class="cs-stat-card">
          <mat-icon>trending_up</mat-icon>
          <div class="cs-stat-body">
            <span class="cs-stat-label">Итого выручка</span>
            <span class="cs-stat-amount cs-stat-amount--bold">{{ data.total_revenue | number:'1.0-0' }} \u20BD</span>
          </div>
        </div>
      </div>

      <div class="cs-actions">
        <button mat-flat-button color="primary" (click)="dialogRef.close()">Закрыть</button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .cs-dialog {
      padding: 24px;
      min-width: 340px;
      max-width: 480px;
    }

    .cs-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      margin-bottom: 20px;
    }

    .cs-check-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: var(--crm-status-success, #22c55e);
    }

    .cs-title {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 22px;
      font-weight: 600;
      color: var(--crm-text-primary, #f0f0f0);
      margin: 0;
      text-align: center;
    }

    .cs-studio {
      font-size: 13px;
      color: var(--crm-text-muted, #707070);
    }

    .cs-hours {
      text-align: center;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 28px;
      font-weight: 500;
      color: var(--crm-text-primary, #f0f0f0);
      margin-bottom: 20px;
    }

    .cs-stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-bottom: 24px;
    }

    .cs-stat-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px;
      background: var(--crm-gradient-card, rgba(30, 30, 36, 0.85));
      backdrop-filter: blur(var(--crm-glass-blur, 16px));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur, 16px));
      border-radius: var(--crm-radius-md, 8px);
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.06));

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--crm-text-muted, #707070);
        flex-shrink: 0;
        margin-top: 2px;
      }
    }

    .cs-stat-card--commission mat-icon {
      color: var(--crm-status-success, #22c55e);
    }

    .cs-stat-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .cs-stat-label {
      font-size: 11px;
      font-weight: 500;
      color: var(--crm-text-muted, #707070);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .cs-stat-value {
      font-size: 12px;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    .cs-stat-amount {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 16px;
      font-weight: 500;
      color: var(--crm-text-primary, #f0f0f0);
    }

    .cs-stat-amount--green {
      color: var(--crm-status-success, #22c55e);
    }

    .cs-stat-amount--bold {
      font-size: 18px;
      font-weight: 600;
    }

    .cs-actions {
      display: flex;
      justify-content: center;

      button {
        min-width: 120px;
      }
    }
  `],
})
export class CheckoutSummaryDialogComponent {
  readonly data = inject<CheckoutSummaryData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<CheckoutSummaryDialogComponent>);

  formatHours(hours: number): string {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m > 0 ? `${h}\u0447 ${m}\u043C` : `${h}\u0447`;
  }
}
