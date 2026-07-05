import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  input,
  output,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { SubscriptionPlan } from '../../data/services.data';
import { CloudPaymentsService } from '../../../../core/services/cloud-payments.service';

@Component({
  selector: 'app-subscription-checkout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, MatButtonModule, MatSnackBarModule],
  template: `
    @if (plan(); as p) {
      <!-- Оверлей -->
      <div class="overlay" (click)="closed.emit()" (keydown.enter)="closed.emit()" tabindex="0"></div>

      <!-- Панель -->
      <div class="checkout-panel">
        <!-- Шапка -->
        <div class="panel-header">
          <h3>Оформление подписки</h3>
          <button class="close-btn" (click)="closed.emit()">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Карточка плана -->
        <div class="plan-card" [class.popular]="p.is_popular">
          <div class="plan-icon">
            <mat-icon>{{ p.icon }}</mat-icon>
          </div>
          <div class="plan-info">
            <h4>{{ p.name }}</h4>
            <p>{{ p.description }}</p>
          </div>
        </div>

        <!-- Детали -->
        <div class="plan-details">
          <div class="detail-row">
            <span>Стоимость</span>
            <strong>{{ p.base_price | number }}₽ / мес</strong>
          </div>
          <div class="detail-row">
            <span>Списание</span>
            <strong>Каждый месяц</strong>
          </div>
          <div class="detail-row">
            <span>Срок</span>
            <strong>Бессрочно</strong>
          </div>
          @if (p.savings_label) {
            <div class="detail-row savings">
              <span>Экономия</span>
              <strong>{{ p.savings_label }}</strong>
            </div>
          }
        </div>

        <!-- Что дешевле -->
        <div class="plan-features">
          <h5>Что дешевле по подписке:</h5>
          <ul>
            @for (item of p.items; track item.product_id) {
              <li>
                <mat-icon>check_circle</mat-icon>
                {{ item.product_name }}
              </li>
            }
            @if (+p.subscriber_discount_percent > 0) {
              <li>
                <mat-icon>loyalty</mat-icon>
                Скидка {{ +p.subscriber_discount_percent }}% на объёмную печать
              </li>
            }
          </ul>
        </div>

        <!-- Промокод -->
        <div class="promo-section">
          <label for="sub-promo">Промокод</label>
          <div class="promo-row">
            <input
              id="sub-promo"
              type="text"
              placeholder="SVV-XXXXX"
              [value]="promoCode()"
              (input)="promoCode.set($any($event.target).value.toUpperCase())"
              maxlength="20"
            />
            <button class="promo-btn" (click)="validatePromo()" [disabled]="promoLoading() || !promoCode()">
              @if (promoLoading()) {
                <mat-icon class="spin">autorenew</mat-icon>
              } @else {
                Применить
              }
            </button>
          </div>
          @if (promoError()) {
            <span class="promo-error">{{ promoError() }}</span>
          }
          @if (trialDays() > 0) {
            <div class="promo-success">
              <mat-icon>card_giftcard</mat-icon>
              <span>{{ trialDays() }} дн. бесплатно, потом {{ p.base_price | number }}₽/мес</span>
            </div>
          }
        </div>

        <!-- Email -->
        <div class="email-section">
          <label for="sub-email">Email для чеков и уведомлений</label>
          <input
            id="sub-email"
            type="email"
            placeholder="email@example.com"
            [value]="email()"
            (input)="email.set($any($event.target).value)"
          />
          <label for="sub-phone" class="phone-label">Телефон (необязательно)</label>
          <input
            id="sub-phone"
            type="tel"
            placeholder="+7 (___) ___-__-__"
            [value]="phone()"
            (input)="phone.set($any($event.target).value)"
          />
        </div>

        <!-- Условия -->
        <div class="terms">
          <mat-icon>info</mat-icon>
          @if (trialDays() > 0) {
            <p>
              Бесплатный пробный период {{ trialDays() }} дн.
              Первое списание {{ p.base_price | number }}₽ через {{ trialDays() }} дн.
              Подписку можно отменить в любой момент.
            </p>
          } @else {
            <p>
              Нажимая «Подписаться», вы соглашаетесь на автоматическое списание
              {{ p.base_price | number }}₽ каждый месяц.
              Подписку можно отменить в любой момент.
            </p>
          }
        </div>

        <!-- Кнопки -->
        <div class="actions">
          <button
            class="subscribe-action"
            (click)="subscribe()"
            [disabled]="isLoading()"
          >
            @if (isLoading()) {
              <mat-icon class="spin">autorenew</mat-icon>
              Обработка...
            } @else if (trialDays() > 0) {
              <mat-icon>card_giftcard</mat-icon>
              Начать бесплатно на {{ trialDays() }} дн.
            } @else {
              <mat-icon>credit_card</mat-icon>
              Подписаться за {{ p.base_price | number }}₽/мес
            }
          </button>
          <button class="cancel-action" (click)="closed.emit()">
            Отмена
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000;
      backdrop-filter: blur(4px);
    }

    .checkout-panel {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: min(480px, calc(100vw - 32px));
      max-height: calc(100vh - 48px);
      overflow-y: auto;
      background: var(--ed-surface, #0a0a0a);
      border-radius: 24px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
      z-index: 1001;
      padding: 0;
      display: flex;
      flex-direction: column;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);

      h3 {
        margin: 0;
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
      }

      .close-btn {
        width: 40px;
        height: 40px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--ed-on-surface-variant, #a0a0a0);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;

        &:hover {
          background: var(--ed-surface-container, #1a1a1a);
        }
      }
    }

    .plan-card {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 20px 24px;
      background: var(--ed-surface-container, #1a1a1a);

      &.popular {
        background: linear-gradient(
          135deg,
          color-mix(in srgb, var(--ed-accent, #f59e0b) 10%, var(--ed-surface, #0a0a0a)) 0%,
          color-mix(in srgb, var(--ed-accent, #f59e0b) 5%, var(--ed-surface, #0a0a0a)) 100%
        );
      }

      .plan-icon {
        width: 56px;
        height: 56px;
        border-radius: 16px;
        background: var(--ed-accent, #f59e0b);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;

        mat-icon {
          font-size: 28px;
          width: 28px;
          height: 28px;
          color: var(--ed-on-accent, #0a0a0a);
        }
      }

      .plan-info {
        flex: 1;

        h4 {
          margin: 0;
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--ed-on-surface, #f5f5f5);
        }

        p {
          margin: 4px 0 0;
          font-size: 0.88rem;
          color: var(--ed-on-surface-variant, #a0a0a0);
          line-height: 1.4;
        }
      }
    }

    .plan-details {
      padding: 16px 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;

      .detail-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.95rem;

        span {
          color: var(--ed-on-surface-variant, #a0a0a0);
        }

        strong {
          color: var(--ed-on-surface, #f5f5f5);
          font-weight: 600;
        }

        &.savings strong {
          color: var(--ed-accent, #f59e0b);
        }
      }
    }

    .plan-features {
      padding: 0 24px 16px;

      h5 {
        margin: 0 0 10px;
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }

      ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;

        li {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 0.88rem;
          color: var(--ed-on-surface, #f5f5f5);
          background: var(--ed-surface-container, #1a1a1a);
          padding: 6px 14px;
          border-radius: 100px;

          mat-icon {
            font-size: 16px;
            width: 16px;
            height: 16px;
            color: var(--ed-accent, #f59e0b);
          }
        }
      }
    }

    .promo-section {
      padding: 0 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;

      label {
        font-size: 0.85rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        font-weight: 500;
      }

      .promo-row {
        display: flex;
        gap: 8px;

        input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid var(--ed-outline-variant, #2a2a2a);
          border-radius: 12px;
          background: var(--ed-surface-container, #1a1a1a);
          color: var(--ed-on-surface, #f5f5f5);
          font-size: 0.95rem;
          outline: none;
          letter-spacing: 1px;
          text-transform: uppercase;
          transition: border-color 0.2s;

          &:focus { border-color: var(--ed-accent, #f59e0b); }
          &::placeholder { color: var(--ed-on-surface-variant, #a0a0a0); opacity: 0.5; text-transform: none; letter-spacing: normal; }
        }

        .promo-btn {
          padding: 10px 16px;
          border: 1px solid var(--ed-outline-variant, #2a2a2a);
          border-radius: 12px;
          background: var(--ed-surface-container, #1a1a1a);
          color: var(--ed-on-surface, #f5f5f5);
          font-size: 0.88rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;

          &:hover:not(:disabled) { background: var(--ed-surface-container-high, #2a2a2a); }
          &:disabled { opacity: 0.5; cursor: not-allowed; }
        }
      }

      .promo-error {
        font-size: 0.82rem;
        color: #ef4444;
      }

      .promo-success {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: color-mix(in srgb, #22c55e 10%, var(--ed-surface, #0a0a0a));
        border: 1px solid color-mix(in srgb, #22c55e 30%, transparent);
        border-radius: 12px;
        font-size: 0.88rem;
        color: #4ade80;
        font-weight: 500;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #4ade80;
        }
      }
    }

    .email-section {
      padding: 0 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;

      label {
        font-size: 0.85rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        font-weight: 500;
      }

      .phone-label {
        margin-top: 8px;
      }

      input {
        padding: 12px 16px;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 12px;
        background: var(--ed-surface-container, #1a1a1a);
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 1rem;
        outline: none;
        transition: border-color 0.2s;

        &:focus {
          border-color: var(--ed-accent, #f59e0b);
        }

        &::placeholder {
          color: var(--ed-on-surface-variant, #a0a0a0);
          opacity: 0.5;
        }
      }
    }

    .terms {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 0 24px 16px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        flex-shrink: 0;
        margin-top: 2px;
      }

      p {
        margin: 0;
        font-size: 0.82rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        line-height: 1.5;
      }
    }

    .actions {
      padding: 16px 24px 24px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .subscribe-action {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 14px;
      border: none;
      border-radius: 16px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
      }

      &:hover:not(:disabled) {
        filter: brightness(1.1);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      }

      &:active:not(:disabled) {
        transform: scale(0.98);
      }

      &:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }
    }

    .cancel-action {
      padding: 12px;
      border: none;
      border-radius: 12px;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;

      &:hover {
        background: var(--ed-surface-container, #1a1a1a);
      }
    }

    .spin {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class SubscriptionCheckoutComponent {
  private readonly paymentService = inject(CloudPaymentsService);
  private readonly snackBar = inject(MatSnackBar);

  plan = input<SubscriptionPlan | null>(null);
  closed = output<void>();
  success = output<string>(); // subscription ID

  email = signal('');
  phone = signal('');
  promoCode = signal('');
  trialDays = signal(0);
  promoLoading = signal(false);
  promoError = signal('');
  isLoading = signal(false);

  async validatePromo(): Promise<void> {
    const code = this.promoCode().trim();
    if (!code) return;

    this.promoLoading.set(true);
    this.promoError.set('');
    this.trialDays.set(0);

    try {
      const res = await fetch(`/api/subscriptions/trial-info/${encodeURIComponent(code)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        this.promoError.set(err?.error || 'Промокод не найден');
        return;
      }
      const data = await res.json();
      this.trialDays.set(data.trial_days || 0);
      if (!data.trial_days) {
        this.promoError.set('Промокод не предоставляет пробный период');
      }
    } catch {
      this.promoError.set('Не удалось проверить промокод');
    } finally {
      this.promoLoading.set(false);
    }
  }

  async subscribe(): Promise<void> {
    const p = this.plan();
    if (!p) return;

    if (!this.email()) {
      this.snackBar.open('Укажите email для чеков и уведомлений', 'OK', { duration: 3000 });
      return;
    }

    this.isLoading.set(true);

    try {
      // Step 1: Create pending subscription in DB
      const initBody: Record<string, unknown> = {
        phone: this.phone() || undefined,
        email: this.email(),
        plan_id: p.id,
      };
      if (this.promoCode().trim() && this.trialDays() > 0) {
        initBody['promo_code'] = this.promoCode().trim();
      }

      const initRes = await fetch('/api/subscriptions/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(initBody),
      });

      if (!initRes.ok) {
        const err = await initRes.json().catch(() => null);
        throw new Error(err?.error || 'Не удалось создать подписку');
      }

      const { subscription_id, monthly_price, trial_period_days, trial_end } = await initRes.json();

      // Step 2: Open CloudPayments Widget
      const result = await this.paymentService.subscribe({
        subscriptionId: subscription_id,
        planName: p.name,
        amount: monthly_price,
        billingPeriod: p.billing_period || 'monthly',
        email: this.email(),
        phone: this.phone() || undefined,
        trialDays: trial_period_days || undefined,
      });

      this.isLoading.set(false);

      if (result.success) {
        const msg = trial_end
          ? `Подписка активна! Бесплатный период до ${new Date(trial_end).toLocaleDateString('ru-RU')}.`
          : 'Подписка оформлена! Проверьте email.';
        this.snackBar.open(msg, '', { duration: 5000 });
        this.success.emit(subscription_id);
        this.closed.emit();
      } else if (result.error && result.error !== 'Оплата отменена') {
        this.snackBar.open(`Ошибка: ${result.error}`, 'OK', { duration: 5000 });
      }
    } catch (err) {
      this.isLoading.set(false);
      const message = err instanceof Error ? err.message : 'Не удалось оформить подписку';
      this.snackBar.open(`Ошибка: ${message}`, 'OK', { duration: 5000 });
    }
  }
}
