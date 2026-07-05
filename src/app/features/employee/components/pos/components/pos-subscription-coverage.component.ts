import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { SubscriptionCoverage } from '../models/pos.models';

@Component({
  selector: 'app-pos-subscription-coverage',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'pos-subscription-coverage' },
  template: `
    <div class="sub-coverage-header">
      <mat-icon>card_membership</mat-icon>
      <span>Покрытие по подписке</span>
    </div>
    @for (cov of coverage(); track cov.productId) {
      <div class="sub-coverage-row">
        <span class="cov-name">{{ cov.productName }}</span>
        <span class="cov-qty">{{ cov.coveredQty }} из {{ cov.quantity }}</span>
        @if ((cov.creditMultiplier ?? 1) > 1) {
          <span class="cov-multiplier">x{{ cov.creditMultiplier }}</span>
        }
        <span class="cov-saved">-{{ cov.savedAmount }}\u20BD</span>
      </div>
    }
    <div class="sub-coverage-total">
      <span>Экономия по подписке:</span>
      <strong>-{{ savings() }}\u20BD</strong>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      padding: 8px 12px;
      margin: 0 12px 4px;
      background: color-mix(in srgb, var(--mat-sys-tertiary-container) 30%, var(--mat-sys-surface));
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .sub-coverage-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--mat-sys-tertiary);
      margin-bottom: 6px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .sub-coverage-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      padding: 2px 0;
    }
    .cov-name { flex: 1; }
    .cov-qty {
      color: var(--mat-sys-on-surface-variant);
      margin-right: 8px;
    }
    .cov-multiplier {
      margin-right: 8px;
      padding: 1px 5px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--mat-sys-error) 12%, var(--mat-sys-surface));
      color: var(--mat-sys-error);
      font-size: 11px;
      font-weight: 700;
    }
    .cov-saved {
      font-weight: 600;
      color: var(--crm-status-info);
    }
    .sub-coverage-total {
      display: flex;
      justify-content: space-between;
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px solid var(--mat-sys-outline-variant);
      font-size: 13px;
      strong { color: var(--crm-status-info); }
    }
  `],
})
export class PosSubscriptionCoverageComponent {
  readonly coverage = input.required<SubscriptionCoverage[]>();
  readonly savings = input.required<number>();
}
