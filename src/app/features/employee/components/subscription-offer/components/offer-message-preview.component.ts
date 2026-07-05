import { Component, ChangeDetectionStrategy, input, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import type { SubscriptionPlan } from '../models/subscription-offer.models';
import {
  buildSubscriptionBenefitLines,
  getAccountSubscriptionDisplay,
  getSubscriptionGiftHeader,
  getSubscriptionGiftPrimaryText,
  isAccountSubscriptionInfoOnly,
} from '../subscription-offer-display.util';

@Component({
  selector: 'app-offer-message-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  template: `
    <div class="preview-root">
      <div class="preview-label">
        <mat-icon>visibility</mat-icon>
        Клиент увидит в чате:
      </div>
      <div class="chat-bubble">
        <div class="bubble-header">
          <mat-icon class="bubble-icon">{{ accountDisplay()?.icon ?? (isGift() ? 'redeem' : 'workspace_premium') }}</mat-icon>
          <strong>{{ headerText() }}</strong>
        </div>
        <div class="bubble-price">
          @if (accountDisplay(); as account) {
            {{ account.amount }}
          } @else if (isGift()) {
            {{ giftPrimaryText() }}
          } @else {
            {{ plan().base_price | number:'1.0-0' }} \u20BD/мес
          }
        </div>
        @if (planItems().length > 0) {
          <ul class="bubble-items">
            @for (item of planItems(); track item) {
              <li>\u2713 {{ item }}</li>
            }
          </ul>
        }
        @if (!accountDisplay() && plan().subscriber_discount_percent > 0) {
          <div class="bubble-discount">
            + скидка {{ plan().subscriber_discount_percent }}% на объёмную печать
          </div>
        }
        <div class="bubble-cta">
          {{ ctaText() }}
        </div>
      </div>
      @if (noteText()) {
        <div class="preview-note">
          {{ noteText() }}
        </div>
      }
    </div>
  `,
  styles: [`
    .preview-root {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .preview-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #a0a0b0);
    }
    .preview-label mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .chat-bubble {
      background: var(--ed-surface-container-high, #252535);
      border: 1px solid var(--ed-outline-variant, #3a3a4a);
      border-radius: 4px 16px 16px 16px;
      padding: 14px 16px;
      max-width: 420px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bubble-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: var(--ed-on-surface, #e0e0e0);
    }
    .bubble-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--ed-accent, #f59e0b);
    }
    .bubble-price {
      font-size: 20px;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
    }
    .bubble-items {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 13px;
      color: var(--ed-on-surface, #e0e0e0);
    }
    .bubble-items li {
      line-height: 1.4;
    }
    .bubble-discount {
      font-size: 12px;
      color: #22c55e;
      font-weight: 500;
    }
    .bubble-cta {
      margin-top: 4px;
      font-size: 13px;
      font-weight: 600;
      color: var(--ed-accent, #f59e0b);
    }

    .preview-note {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0b0);
      font-style: italic;
    }
  `],
})
export class OfferMessagePreviewComponent {
  readonly plan = input.required<SubscriptionPlan>();
  readonly clientName = input('');
  readonly mode = input<'offer' | 'gift'>('offer');

  readonly isGift = computed(() => this.mode() === 'gift');
  readonly accountDisplay = computed(() => getAccountSubscriptionDisplay(this.plan()));
  readonly isInfoOnlyAccount = computed(() => isAccountSubscriptionInfoOnly(this.plan()));
  readonly headerText = computed(() => {
    const accountDisplay = this.accountDisplay();
    if (accountDisplay) {
      return this.isGift() ? accountDisplay.giftHeader : accountDisplay.offerHeader;
    }

    if (this.isGift()) {
      return getSubscriptionGiftHeader(this.plan());
    }

    const prefix = this.isGift() ? 'Подарок' : 'Подписка';
    return `${prefix} "${this.plan().name}"`;
  });
  readonly giftPrimaryText = computed(() => getSubscriptionGiftPrimaryText(this.plan()));
  readonly ctaText = computed(() => {
    const accountDisplay = this.accountDisplay();
    if (accountDisplay) {
      return this.isInfoOnlyAccount() ? '\u2192 Получить условия подключения' : accountDisplay.ctaText;
    }

    return this.isGift()
      ? '\u2192 Активировать по промокоду'
      : '\u2192 Перейти и оформить подписку';
  });
  readonly noteText = computed(() => {
    const name = this.clientName();
    const action = this.isGift() && !this.isInfoOnlyAccount() ? 'Подарочный код отправится' : 'Сообщение отправится';
    return name ? `${action} ${name} в текущий чат` : '';
  });

  readonly planItems = computed(() => {
    return buildSubscriptionBenefitLines(this.plan());
  });
}
