/**
 * OrderConfirmationComponent, shared inline confirmation card
 * that replaces a quick-order form in-place after order creation.
 *
 * States:
 *   1. Order created, success icon, price, "Оплатить" CTA
 *   2. Payment loading, spinner on CTA
 *   3. Payment success, "Оплата прошла!" + timeline + countdown redirect
 *
 * Used on: /voennaya-retush, /foto-na-documenty-online, future landing pages.
 */

import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

// ── Public types ────────────────────────────────────────────────────────────

export interface OrderConfirmationData {
  orderId: string;
  total: number;
  description: string;
  photoCount: number;
}

// ── Component ───────────────────────────────────────────────────────────────

@Component({
  selector: 'app-order-confirmation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <section class="oconf">
      <div class="oconf-ambient"></div>
      <div class="oconf-inner">

        @if (paymentSuccess()) {
          <!-- ── Payment Success + Timeline ── -->
          <div class="oconf-icon oconf-icon--paid">
            <mat-icon>payments</mat-icon>
          </div>
          <h2 class="oconf-title">Оплата прошла!</h2>
          <p class="oconf-desc">Мы уже начинаем работу над вашим заказом</p>

          <!-- What's next timeline -->
          <div class="oconf-timeline">
            <div class="oconf-timeline-step oconf-timeline-step--active">
              <div class="oconf-timeline-dot">
                <mat-icon>hourglass_top</mat-icon>
              </div>
              <div class="oconf-timeline-info">
                <strong>Обработка</strong>
                <span>Мастер приступит к работе</span>
              </div>
            </div>
            <div class="oconf-timeline-connector"></div>
            <div class="oconf-timeline-step">
              <div class="oconf-timeline-dot">
                <mat-icon>rate_review</mat-icon>
              </div>
              <div class="oconf-timeline-info">
                <strong>Согласование</strong>
                <span>Покажем результат в чате</span>
              </div>
            </div>
            <div class="oconf-timeline-connector"></div>
            <div class="oconf-timeline-step">
              <div class="oconf-timeline-dot">
                <mat-icon>check_circle</mat-icon>
              </div>
              <div class="oconf-timeline-info">
                <strong>Готово</strong>
                <span>Отправим файл в высоком качестве</span>
              </div>
            </div>
          </div>

          <div class="oconf-redirect">
            <mat-icon>chat</mat-icon>
            <span>Переходим в чат через {{ redirectCountdown() }} сек...</span>
          </div>
          <button
            type="button"
            class="oconf-cta"
            (click)="goToChat.emit()"
          >
            <mat-icon>arrow_forward</mat-icon>
            Перейти в чат сейчас
          </button>
        } @else {
          <!-- ── Order Created + Pay ── -->
          <div class="oconf-icon">
            <mat-icon>check_circle</mat-icon>
          </div>
          <h2 class="oconf-title">Заказ создан</h2>
          <p class="oconf-desc">{{ orderDescription() }}</p>
          <p class="oconf-total">{{ order().total }} &#8381;</p>

          <button
            type="button"
            class="oconf-cta"
            [class.oconf-cta--loading]="paymentLoading()"
            [disabled]="paymentLoading()"
            (click)="payClicked.emit()"
          >
            @if (paymentLoading()) {
              <mat-icon class="oconf-spinner">sync</mat-icon>
              Обработка...
            } @else {
              <mat-icon>lock</mat-icon>
              Оплатить {{ order().total }} &#8381;
            }
          </button>

          <button
            type="button"
            class="oconf-secondary"
            (click)="goToChat.emit()"
          >
            Оплатить позже, перейти в чат
          </button>

          @if (submitError(); as err) {
            <div class="oconf-error" role="alert">{{ err }}</div>
          }
        }

        <!-- Trust micro-strip -->
        <div class="oconf-trust">
          <span><mat-icon>verified</mat-icon> Гарантия возврата</span>
          <span><mat-icon>edit</mat-icon> Бесплатные правки</span>
          <span><mat-icon>schedule</mat-icon> Готово за 1-2 дня</span>
        </div>

      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }

    .oconf {
      position: relative;
      padding: 48px 16px 56px;
      background: var(--ed-surface-dim, #111111);
      overflow: hidden;
      animation: oconf-fadeIn 400ms cubic-bezier(0.16, 1, 0.3, 1) both;

      @media (min-width: 600px) { padding: 64px 24px 72px; }
      @media (min-width: 1024px) { padding: 80px 40px 88px; }
    }

    .oconf-ambient {
      position: absolute;
      inset: 0;
      background:
        radial-gradient(ellipse 70% 50% at 50% 0%, rgba(74, 222, 128, 0.06) 0%, transparent 70%),
        radial-gradient(ellipse 40% 40% at 80% 80%, rgba(245, 158, 11, 0.03) 0%, transparent 60%);
      pointer-events: none;
    }

    .oconf-inner {
      position: relative;
      max-width: 680px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 0;
    }

    /* ── Icon ── */

    .oconf-icon {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(74, 222, 128, 0.12);
      border: 2px solid rgba(74, 222, 128, 0.3);
      margin-bottom: 20px;
      animation: oconf-iconPop 500ms cubic-bezier(0.34, 1.56, 0.64, 1) 200ms both;

      mat-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        color: #4ade80;
      }

      &--paid {
        background: rgba(245, 158, 11, 0.12);
        border-color: rgba(245, 158, 11, 0.3);

        mat-icon {
          color: var(--ed-accent, #f59e0b);
        }
      }
    }

    /* ── Title ── */

    .oconf-title {
      margin: 0 0 8px;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: -0.02em;
      font-size: clamp(1.5rem, 5vw, 2.25rem);
      line-height: 1;
      color: var(--ed-on-surface, #f5f5f5);
      animation: oconf-slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1) 100ms both;
    }

    /* ── Description ── */

    .oconf-desc {
      margin: 0 0 16px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.95rem;
      line-height: 1.5;
      animation: oconf-slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1) 150ms both;
    }

    /* ── Total ── */

    .oconf-total {
      margin: 0 0 28px;
      font-size: 2.5rem;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
      line-height: 1;
      animation: oconf-slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1) 200ms both;

      @media (min-width: 600px) { font-size: 3rem; }
    }

    /* ── CTA ── */

    .oconf-cta {
      width: 100%;
      max-width: 400px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 16px 28px;
      border: none;
      border-radius: 16px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font: inherit;
      font-size: 1.1rem;
      font-weight: 800;
      cursor: pointer;
      transition: box-shadow 200ms ease, transform 150ms ease, opacity 200ms ease;
      animation: oconf-slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1) 250ms both;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover:not([disabled]) {
        box-shadow: 0 6px 24px color-mix(in srgb, var(--ed-accent, #f59e0b) 30%, transparent);
        transform: translateY(-1px);
      }

      &:active:not([disabled]) { transform: scale(0.97); }

      &[disabled] {
        cursor: not-allowed;
        opacity: 0.7;
      }

      &--loading {
        background: var(--ed-outline-variant, #2a2a2a);
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .oconf-spinner {
      animation: oconf-spin 1s linear infinite;
    }

    /* ── Secondary ── */

    .oconf-secondary {
      margin-top: 12px;
      padding: 10px 16px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font: inherit;
      font-size: 0.9rem;
      cursor: pointer;
      transition: color 160ms ease;
      animation: oconf-slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1) 300ms both;

      &:hover {
        color: var(--ed-accent, #f59e0b);
      }
    }

    /* ── Timeline ── */

    .oconf-timeline {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0;
      width: 100%;
      max-width: 360px;
      margin: 4px 0 24px;
      text-align: left;
      animation: oconf-slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1) 200ms both;
    }

    .oconf-timeline-step {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 8px 0;
      opacity: 0.5;

      &--active {
        opacity: 1;

        .oconf-timeline-dot {
          background: rgba(245, 158, 11, 0.15);
          border-color: var(--ed-accent, #f59e0b);

          mat-icon { color: var(--ed-accent, #f59e0b); }
        }
      }
    }

    .oconf-timeline-dot {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.04);
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      transition: background 200ms, border-color 200ms;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .oconf-timeline-info {
      display: flex;
      flex-direction: column;
      gap: 2px;

      strong {
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
      }

      span {
        font-size: 0.78rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .oconf-timeline-connector {
      width: 1.5px;
      height: 16px;
      margin-left: 19px;
      background: var(--ed-outline, #3a3a3a);
    }

    /* ── Redirect ── */

    .oconf-redirect {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 20px;
      padding: 10px 20px;
      border-radius: 24px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.15);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-accent, #f59e0b);
      }

      span {
        font-size: 0.85rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    /* ── Error ── */

    .oconf-error {
      margin-top: 16px;
      padding: 10px 14px;
      background: rgba(220, 38, 38, 0.12);
      border: 1px solid rgba(220, 38, 38, 0.4);
      border-radius: 8px;
      color: #fca5a5;
      font-size: 0.85rem;
      line-height: 1.4;
      max-width: 400px;
    }

    /* ── Trust ── */

    .oconf-trust {
      display: flex;
      gap: 16px;
      justify-content: center;
      flex-wrap: wrap;
      margin-top: 28px;
      animation: oconf-slideUp 400ms cubic-bezier(0.16, 1, 0.3, 1) 350ms both;

      span {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 0.78rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        white-space: nowrap;

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
          color: var(--ed-accent, #f59e0b);
        }
      }
    }

    /* ── Animations ── */

    @keyframes oconf-fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes oconf-slideUp {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes oconf-iconPop {
      from { opacity: 0; transform: scale(0.5); }
      to { opacity: 1; transform: scale(1); }
    }

    @keyframes oconf-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class OrderConfirmationComponent {
  readonly order = input.required<OrderConfirmationData>();
  readonly paymentLoading = input(false);
  readonly paymentSuccess = input(false);
  readonly redirectCountdown = input(5);
  readonly submitError = input<string | null>(null);

  readonly payClicked = output<void>();
  readonly goToChat = output<void>();

  readonly orderDescription = computed(() => {
    const o = this.order();
    return `${o.description} · ${o.photoCount} фото`;
  });
}
