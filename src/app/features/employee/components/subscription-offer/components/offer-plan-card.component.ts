import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { SubscriptionPlan } from '../models/subscription-offer.models';
import {
  buildSubscriptionBenefitLines,
  getAccountSubscriptionDisplay,
  isPersonalAccountGift,
  type SubscriptionOfferDisplayMode,
} from '../subscription-offer-display.util';

@Component({
  selector: 'app-offer-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  template: `
    @let p = plan();
    <div
      class="plan-card"
      [class.plan-card--popular]="p.is_popular"
      [class.plan-card--selected]="selected()"
      tabindex="0"
      role="button"
      (click)="planSelected.emit(p)"
      (keydown.enter)="planSelected.emit(p)"
      (keydown.space)="planSelected.emit(p)"
    >
      @if (p.is_popular) {
        <div class="plan-badge">Популярный</div>
      }

      <h4 class="plan-name">{{ displayName() }}</h4>

      <div class="plan-price">
        @if (accountDisplay(); as account) {
          <span class="plan-amount">{{ account.amount }}</span>
          <span class="plan-period">{{ account.period }}</span>
        } @else {
          <span class="plan-amount">{{ p.base_price | number:'1.0-0' }}\u20BD</span>
          <span class="plan-period">/ мес</span>
        }
      </div>

      @if (p.savings_label) {
        <div class="plan-savings">{{ p.savings_label }}</div>
      }

      @if (benefitLines().length > 0) {
        <ul class="plan-items">
          @for (line of benefitLines(); track line) {
            <li>
              <mat-icon class="item-check">check_circle</mat-icon>
              <span>{{ line }}</span>
            </li>
          }
        </ul>
      }

      @if (!accountDisplay() && p.subscriber_discount_percent > 0) {
        <div class="plan-discount">
          \u2212{{ p.subscriber_discount_percent }}% на объём
        </div>
      }
    </div>
  `,
  styles: [`
    .plan-card {
      position: relative;
      padding: 16px 14px;
      background: var(--ed-surface-container, #1e1e2e);
      border: 2px solid var(--ed-outline-variant, #3a3a4a);
      border-radius: 14px;
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .plan-card:hover {
      border-color: var(--ed-on-surface-variant, #a0a0b0);
    }
    .plan-card--popular {
      border-color: var(--ed-accent, #f59e0b);
      box-shadow: 0 2px 16px rgba(245, 158, 11, 0.15);
    }
    .plan-card--selected {
      border-color: var(--ed-accent, #f59e0b);
      background: var(--ed-accent-container, rgba(245,158,11,0.08));
    }

    .plan-badge {
      position: absolute;
      top: -11px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--ed-accent, #f59e0b);
      color: #1a1a2e;
      font-size: 10px;
      font-weight: 700;
      padding: 2px 12px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .plan-name {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: var(--ed-on-surface, #e0e0e0);
    }
    .plan-card--popular .plan-name { margin-top: 4px; }

    .plan-price {
      display: flex;
      align-items: baseline;
      gap: 3px;
    }
    .plan-amount {
      font-size: 22px;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
    }
    .plan-period {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0b0);
    }

    .plan-savings {
      display: inline-block;
      padding: 2px 8px;
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
      font-size: 11px;
      font-weight: 600;
      border-radius: 8px;
      align-self: flex-start;
    }

    .plan-items {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 4px;
      flex: 1;
    }
    .plan-items li {
      display: flex;
      align-items: flex-start;
      gap: 5px;
      font-size: 12px;
      color: var(--ed-on-surface, #e0e0e0);
      line-height: 1.4;
    }
    .item-check {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #22c55e;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .plan-discount {
      font-size: 11px;
      color: var(--ed-accent, #f59e0b);
      font-weight: 500;
    }
  `],
})
export class OfferPlanCardComponent {
  readonly plan = input.required<SubscriptionPlan>();
  readonly selected = input(false);
  readonly mode = input<SubscriptionOfferDisplayMode>('offer');
  readonly planSelected = output<SubscriptionPlan>();

  readonly isPersonalGift = computed(() => isPersonalAccountGift(this.plan(), this.mode()));
  readonly accountDisplay = computed(() => getAccountSubscriptionDisplay(this.plan()));
  readonly displayName = computed(() => this.accountDisplay()?.name ?? (this.isPersonalGift() ? 'Личная подписка' : this.plan().name));
  readonly benefitLines = computed(() => buildSubscriptionBenefitLines(this.plan(), 4));
}
