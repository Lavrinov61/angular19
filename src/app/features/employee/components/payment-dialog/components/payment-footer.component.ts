import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  computed,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PriceFormatPipe } from '../pipes/price-format.pipe';
import type { BreakdownItem, PaymentDialogMode } from '../models/payment-dialog.models';

@Component({
  selector: 'app-pd-payment-footer',
  imports: [MatIconModule, MatProgressSpinnerModule, MatTooltipModule, PriceFormatPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    @if (finalAmount() < 1) {
      <div class="pf-hint">
        @if (mode() === 'order') {
          Сумма заказа не указана
        } @else {
          Выберите услуги или введите сумму
        }
      </div>
    } @else {
      <div class="pf-root">
        <!-- Left: summary info -->
        <div class="pf-left">
          @if (mode() === 'order' && orderId()) {
            <div class="pf-order-badge">
              <mat-icon>receipt_long</mat-icon>
              <span>Заказ {{ orderId() }}</span>
            </div>
          }
          @if (itemCount() > 0) {
            <div class="pf-summary-line">
              {{ itemCount() }} {{ servicesWord() }} &middot; {{ servicesSum() | priceFormat }}
            </div>
          } @else if (cartItemCount() > 0) {
            <div class="pf-summary-line">
              Корзина &middot; {{ cartItemCount() }} {{ cartItemsWord() }} &middot; {{ cartAmount() | priceFormat }}
            </div>
          }
          @if (manualAmount() > 0) {
            <div class="pf-summary-line">Вручную &middot; {{ manualAmount() | priceFormat }}</div>
          }
        </div>

        <!-- Right: total + actions -->
        <div class="pf-right">
          @if (showVolumeToggle()) {
            <button
              class="pf-volume-btn"
              [class.active]="volumeDiscountActive()"
              (click)="volumeDiscountToggle.emit()">
              <mat-icon>{{ volumeDiscountActive() ? 'discount' : 'percent' }}</mat-icon>
              {{ volumeDiscountActive() ? 'Скидка за объём' : 'Запросить скидку' }}
            </button>
          }
          <div class="pf-total-row">
            <span class="pf-total-label">ИТОГО</span>
            <span class="pf-total-amount">{{ finalAmount() | priceFormat }}</span>
          </div>
          <div class="pf-actions">
            <button class="pf-btn pf-btn-ghost" (click)="cancelled.emit()">
              Закрыть
            </button>

            @if (editMode()) {
              <button
                class="pf-btn pf-btn-online"
                [disabled]="!canSubmit() || generating() || processing() || !workdayPaymentsAvailable()"
                [matTooltip]="workdayPaymentsTooltip() || 'Ctrl+Enter'"
                [attr.title]="workdayPaymentsTooltip() || null"
                (click)="generateOnline.emit()"
              >
                @if (generating() || processingMethod() === 'online') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>edit</mat-icon>
                }
                Обновить {{ finalAmount() | priceFormat }}
              </button>
            } @else if (mode() === 'order') {
              <!-- Order mode: Subscription / Cash / Card / SBP / Online -->
              <button
                class="pf-btn pf-btn-subscription"
                [disabled]="!canSubmit() || processing() || !workdayPaymentsAvailable()"
                (click)="paySubscription.emit()"
                [matTooltip]="orderSubscriptionTooltip()"
                [attr.title]="workdayPaymentsTooltip() || null"
              >
                @if (processingMethod() === 'subscription') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>card_membership</mat-icon>
                }
                Подписка
              </button>

              <button
                class="pf-btn pf-btn-cash"
                [disabled]="!canSubmit() || processing() || !workdayPaymentsAvailable()"
                [matTooltip]="workdayPaymentsTooltip()"
                [attr.title]="workdayPaymentsTooltip() || null"
                (click)="payCash.emit()"
              >
                @if (processingMethod() === 'cash') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>payments</mat-icon>
                }
                Наличные
              </button>

              <button
                class="pf-btn pf-btn-transfer"
                [disabled]="!canSubmit() || processing() || !workdayPaymentsAvailable()"
                [matTooltip]="workdayPaymentsTooltip()"
                [attr.title]="workdayPaymentsTooltip() || null"
                (click)="payTransfer.emit()"
              >
                @if (processingMethod() === 'transfer') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>account_balance</mat-icon>
                }
                Перевод
              </button>

              <button
                class="pf-btn pf-btn-card"
                [disabled]="!canSubmit() || processing() || !workdayPaymentsAvailable()"
                [matTooltip]="workdayPaymentsTooltip()"
                [attr.title]="workdayPaymentsTooltip() || null"
                (click)="payCard.emit()"
              >
                @if (processingMethod() === 'card') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>credit_card</mat-icon>
                }
                Карта
              </button>

              <button
                class="pf-btn pf-btn-sbp"
                [disabled]="!canSubmit() || processing() || !workdayPaymentsAvailable()"
                [matTooltip]="workdayPaymentsTooltip()"
                [attr.title]="workdayPaymentsTooltip() || null"
                (click)="paySbp.emit()"
              >
                @if (processingMethod() === 'sbp') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>qr_code_2</mat-icon>
                }
                СБП
              </button>

              <button
                class="pf-btn pf-btn-online pf-btn-shimmer"
                [disabled]="!canSubmit() || processing() || !workdayPaymentsAvailable()"
                (click)="generateOnline.emit()"
                [matTooltip]="workdayPaymentsTooltip() || 'Ctrl+Enter'"
                [attr.title]="workdayPaymentsTooltip() || null"
              >
                @if (processingMethod() === 'online') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>link</mat-icon>
                }
                Ссылка {{ finalAmount() | priceFormat }}
              </button>
            } @else if (mode() === 'pos') {
              <!-- POS mode: local receipt payments only, no online link -->
              <button
                class="pf-btn pf-btn-subscription"
                [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable() || !hasSubscription()"
                (click)="paySubscription.emit()"
                [matTooltip]="posSubscriptionTooltip()"
                [attr.title]="posSubscriptionTooltip() || null"
              >
                @if (processingMethod() === 'subscription') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>card_membership</mat-icon>
                }
                Подписка
              </button>

              <div class="pf-cash-choice">
                <button
                  class="pf-btn pf-btn-cash"
                  [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                  [matTooltip]="receiptPaymentsTooltip()"
                  [attr.title]="receiptPaymentsTooltip() || null"
                  aria-haspopup="menu"
                  [attr.aria-expanded]="cashChoicesOpen()"
                  (click)="toggleCashChoices()"
                >
                  @if (processingMethod() === 'cash') {
                    <mat-spinner diameter="16" />
                  } @else {
                    <mat-icon>payments</mat-icon>
                  }
                  Наличные
                </button>

                @if (cashChoicesOpen()) {
                  <div class="pf-cash-menu" role="menu">
                    <button class="pf-cash-menu-item" type="button" role="menuitem" (click)="selectFiscalCash()">
                      <mat-icon>receipt_long</mat-icon>
                      <span>С фискализацией</span>
                    </button>
                    <button class="pf-cash-menu-item pf-cash-menu-item-muted" type="button" role="menuitem" (click)="selectNonFiscalCash()">
                      <mat-icon>money_off</mat-icon>
                      <span>Без фискализации</span>
                    </button>
                  </div>
                }
              </div>

              <button
                class="pf-btn pf-btn-transfer"
                [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                [matTooltip]="receiptPaymentsTooltip()"
                [attr.title]="receiptPaymentsTooltip() || null"
                (click)="payTransfer.emit()"
              >
                @if (processingMethod() === 'transfer') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>account_balance</mat-icon>
                }
                Перевод
              </button>

              <button
                class="pf-btn pf-btn-card"
                [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                [matTooltip]="receiptPaymentsTooltip()"
                [attr.title]="receiptPaymentsTooltip() || null"
                (click)="payCard.emit()"
              >
                @if (processingMethod() === 'card') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>credit_card</mat-icon>
                }
                Карта
              </button>

              <button
                class="pf-btn pf-btn-sbp"
                [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                [matTooltip]="receiptPaymentsTooltip()"
                [attr.title]="receiptPaymentsTooltip() || null"
                (click)="paySbp.emit()"
              >
                @if (processingMethod() === 'sbp') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>qr_code_2</mat-icon>
                }
                СБП
              </button>
            } @else {
              <!-- Chat mode: Subscription / Cash / Card / SBP / Online -->
              <button
                class="pf-btn pf-btn-subscription"
                [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                (click)="paySubscription.emit()"
                [matTooltip]="chatSubscriptionTooltip()"
                [attr.title]="chatSubscriptionTooltip() || null"
              >
                @if (processingMethod() === 'subscription') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>card_membership</mat-icon>
                }
                Подписка
              </button>

              <div class="pf-cash-choice">
                <button
                  class="pf-btn pf-btn-cash"
                  [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                  [matTooltip]="receiptPaymentsTooltip()"
                  [attr.title]="receiptPaymentsTooltip() || null"
                  aria-haspopup="menu"
                  [attr.aria-expanded]="cashChoicesOpen()"
                  (click)="toggleCashChoices()"
                >
                  @if (processingMethod() === 'cash') {
                    <mat-spinner diameter="16" />
                  } @else {
                    <mat-icon>payments</mat-icon>
                  }
                  Наличные
                </button>

                @if (cashChoicesOpen()) {
                  <div class="pf-cash-menu" role="menu">
                    <button class="pf-cash-menu-item" type="button" role="menuitem" (click)="selectFiscalCash()">
                      <mat-icon>receipt_long</mat-icon>
                      <span>С фискализацией</span>
                    </button>
                    <button class="pf-cash-menu-item pf-cash-menu-item-muted" type="button" role="menuitem" (click)="selectNonFiscalCash()">
                      <mat-icon>money_off</mat-icon>
                      <span>Без фискализации</span>
                    </button>
                  </div>
                }
              </div>

              <button
                class="pf-btn pf-btn-transfer"
                [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                [matTooltip]="receiptPaymentsTooltip()"
                [attr.title]="receiptPaymentsTooltip() || null"
                (click)="payTransfer.emit()"
              >
                @if (processingMethod() === 'transfer') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>account_balance</mat-icon>
                }
                Перевод
              </button>

              <button
                class="pf-btn pf-btn-card"
                [disabled]="!canSubmit() || processing() || !receiptPaymentsAvailable()"
                [matTooltip]="receiptPaymentsTooltip()"
                [attr.title]="receiptPaymentsTooltip() || null"
                (click)="payCard.emit()"
              >
                @if (processingMethod() === 'card') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>credit_card</mat-icon>
                }
                Карта
              </button>

              <button
                class="pf-btn pf-btn-sbp"
                [disabled]="!canSubmit() || processing() || !workdayPaymentsAvailable()"
                [matTooltip]="workdayPaymentsTooltip()"
                [attr.title]="workdayPaymentsTooltip() || null"
                (click)="paySbp.emit()"
              >
                @if (processingMethod() === 'sbp') {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>qr_code_2</mat-icon>
                }
                СБП
              </button>

              <button
                class="pf-btn pf-btn-online pf-btn-shimmer"
                [disabled]="!canSubmit() || generating() || !workdayPaymentsAvailable()"
                [matTooltip]="workdayPaymentsTooltip() || 'Ctrl+Enter'"
                [attr.title]="workdayPaymentsTooltip() || null"
                (click)="generateOnline.emit()"
              >
                @if (generating()) {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>send</mat-icon>
                }
                Онлайн {{ finalAmount() | priceFormat }}
              </button>
            }
          </div>

          @if (mode() !== 'pos') {
            <!-- Copy link — chat/order only -->
            <button
              class="pf-copy-link"
              [disabled]="!canSubmit() || generating() || processing() || !workdayPaymentsAvailable()"
              [matTooltip]="workdayPaymentsTooltip()"
              [attr.title]="workdayPaymentsTooltip() || null"
              (click)="copyLink.emit()"
            >
              {{ editMode() ? 'Обновить и скопировать ссылку' : 'Скопировать ссылку' }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .pf-hint {
      text-align: center;
      padding: 14px 20px;
      font-size: 12px;
      color: #5c5c5c;
      font-style: italic;
    }

    .pf-root {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 0 2px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .pf-left {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .pf-order-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.10);
      border: 1px solid rgba(245, 158, 11, 0.20);
      color: #f59e0b;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
      width: fit-content;

      mat-icon {
        font-size: 13px;
        width: 13px;
        height: 13px;
      }
    }

    .pf-summary-line {
      font-size: 11px;
      color: #7a7a7a;
      white-space: nowrap;
    }

    .pf-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      flex-shrink: 0;
    }

    .pf-total-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }

    .pf-total-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7a7a7a;
    }

    .pf-total-amount {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 24px;
      font-weight: 600;
      color: #fbbf24;
      letter-spacing: 0.01em;
      line-height: 1;
    }

    .pf-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    /* ── Base button ── */
    .pf-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 14px;
      height: 36px;
      border-radius: 9px;
      font-size: 12px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 150ms ease;
      white-space: nowrap;
      position: relative;
      overflow: hidden;

      mat-icon { font-size: 15px; width: 15px; height: 15px; }
      mat-spinner { margin: 0; }

      &:disabled {
        opacity: 1;
        cursor: not-allowed;
        background: rgba(255, 255, 255, 0.055) !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        color: #707070 !important;
        box-shadow: none;
        transform: none;
      }

      &:disabled mat-icon {
        color: #707070 !important;
      }
    }

    .pf-btn-ghost {
      background: rgba(255, 255, 255, 0.04);
      color: #a0a0a0;
      border: 1px solid rgba(255, 255, 255, 0.07);

      &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.07);
        color: #ececec;
      }
    }

    /* ── Chat mode: POS ── */
    .pf-btn-pos {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);

      &:hover:not(:disabled) {
        background: rgba(59, 130, 246, 0.25);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(59, 130, 246, 0.2);
      }
    }

    /* ── Subscription ── */
    .pf-btn-subscription {
      background: rgba(251, 191, 36, 0.14);
      color: #fbbf24;
      border: 1px solid rgba(251, 191, 36, 0.30);

      &:hover:not(:disabled) {
        background: rgba(251, 191, 36, 0.24);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(251, 191, 36, 0.18);
      }
    }

    /* ── Order mode: Cash ── */
    .pf-btn-cash {
      background: rgba(52, 211, 153, 0.12);
      color: #34d399;
      border: 1px solid rgba(52, 211, 153, 0.25);

      &:hover:not(:disabled) {
        background: rgba(52, 211, 153, 0.22);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(52, 211, 153, 0.15);
      }
    }

    .pf-cash-choice {
      position: relative;
      display: inline-flex;
    }

    .pf-cash-menu {
      position: absolute;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 8;
      display: grid;
      gap: 4px;
      min-width: 184px;
      padding: 6px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: #24231f;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.35);
    }

    .pf-cash-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      height: 34px;
      padding: 0 9px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: #e5e7eb;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      text-align: left;
      cursor: pointer;

      mat-icon {
        width: 15px;
        height: 15px;
        font-size: 15px;
        color: #34d399;
      }

      &:hover {
        background: rgba(255, 255, 255, 0.07);
      }
    }

    .pf-cash-menu-item-muted {
      color: #c7c7c7;

      mat-icon {
        color: #f59e0b;
      }
    }

    /* ── Order mode: Transfer ── */
    .pf-btn-transfer {
      background: rgba(59, 130, 246, 0.12);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.25);

      &:hover:not(:disabled) {
        background: rgba(59, 130, 246, 0.22);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(59, 130, 246, 0.15);
      }
    }

    /* ── Order mode: Card ── */
    .pf-btn-card {
      background: rgba(139, 92, 246, 0.12);
      color: #a78bfa;
      border: 1px solid rgba(139, 92, 246, 0.25);

      &:hover:not(:disabled) {
        background: rgba(139, 92, 246, 0.22);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(139, 92, 246, 0.15);
      }
    }

    /* ── Order mode: SBP ── */
    .pf-btn-sbp {
      background: rgba(59, 130, 246, 0.12);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.25);

      &:hover:not(:disabled) {
        background: rgba(59, 130, 246, 0.22);
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(59, 130, 246, 0.15);
      }
    }

    /* ── Primary CTA: Online ── */
    .pf-btn-online {
      background: #22c55e;
      color: #fff;

      &:hover:not(:disabled) {
        background: #16a34a;
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(34, 197, 94, 0.3);
      }
    }

    /* ── Shimmer animation on primary CTA ── */
    .pf-btn-shimmer::after {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 60%;
      height: 100%;
      background: linear-gradient(
        90deg,
        transparent,
        rgba(255, 255, 255, 0.15),
        transparent
      );
      animation: pf-shimmer 3s ease-in-out infinite;
      pointer-events: none;
    }

    .pf-btn-shimmer:disabled::after {
      animation: none;
      display: none;
    }

    @keyframes pf-shimmer {
      0%, 100% { left: -100%; }
      50% { left: 100%; }
    }

    /* ── Volume discount toggle ── */
    .pf-volume-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 12px;
      height: 30px;
      border-radius: 8px;
      font-size: 11px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: rgba(255, 255, 255, 0.05);
      color: #a0a0a0;
      transition: all 150ms ease;
      white-space: nowrap;
      align-self: flex-end;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &:hover { background: rgba(255, 255, 255, 0.09); color: #d0d0d0; }
      &.active {
        background: rgba(34, 197, 94, 0.14);
        color: #34d399;
        border-color: rgba(34, 197, 94, 0.35);
      }
    }

    /* ── Copy link ── */
    .pf-copy-link {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 11px;
      color: #7a7a7a;
      font-family: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
      padding: 0;
      transition: color 150ms ease;

      &:hover:not(:disabled) { color: #a0a0a0; }
      &:disabled { opacity: 0.38; cursor: not-allowed; }
    }
  `],
})
export class PaymentFooterComponent {
  // ── Inputs (shared) ──
  readonly mode = input<PaymentDialogMode>('chat');
  readonly finalAmount = input.required<number>();
  readonly onlineAmount = input<number>(0);
  readonly itemCount = input(0);
  readonly cartItemCount = input(0);
  readonly cartAmount = input(0);
  readonly canSubmit = input(false);
  readonly breakdown = input<readonly BreakdownItem[]>([]);
  readonly manualAmount = input(0);
  readonly editMode = input(false);

  // ── Inputs (chat mode) ──
  readonly generating = input(false);
  readonly generatingPos = input(false);
  readonly hasActiveShift = input(false);
  readonly workdayPaymentsAvailable = input(true);
  readonly workdayPaymentsUnavailableReason = input('');
  readonly receiptPaymentsAvailable = input(true);
  readonly receiptPaymentsUnavailableReason = input('');

  // ── Inputs (order mode) ──
  readonly orderId = input<string | undefined>(undefined);
  readonly processing = input(false);
  readonly processingMethod = input<'cash' | 'card' | 'sbp' | 'online' | 'subscription' | 'transfer' | null>(null);

  // ── Inputs (subscription) ──
  readonly hasSubscription = input(false);
  readonly subscriptionPlanName = input<string | null>(null);

  // ── Inputs (volume discount) ──
  readonly volumeDiscountActive = input(false);
  readonly showVolumeToggle = input(false);

  // ── Outputs (shared) ──
  readonly generateOnline = output<void>();
  readonly copyLink = output<void>();
  readonly cancelled = output<void>();
  readonly payCash = output<void>();
  readonly payCashNoFiscal = output<void>();
  readonly payTransfer = output<void>();
  readonly payCard = output<void>();
  readonly paySbp = output<void>();
  readonly paySubscription = output<void>();

  // ── Outputs (chat mode) ──
  readonly generatePos = output<void>();
  readonly volumeDiscountToggle = output<void>();

  protected readonly cashChoicesOpen = signal(false);

  /** Sum from services only (breakdown total) */
  protected readonly servicesSum = computed(() =>
    this.breakdown().reduce((sum, b) => sum + b.total, 0),
  );

  /** Correct Russian plural for "услуга" */
  protected readonly servicesWord = computed(() => {
    const n = this.itemCount();
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'услуга';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'услуги';
    return 'услуг';
  });

  protected readonly cartItemsWord = computed(() => {
    const n = this.cartItemCount();
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'позиция';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'позиции';
    return 'позиций';
  });

  protected readonly receiptPaymentsTooltip = computed(() =>
    this.receiptPaymentsAvailable() ? '' : this.receiptPaymentsUnavailableReason(),
  );

  protected readonly workdayPaymentsTooltip = computed(() =>
    this.workdayPaymentsAvailable() ? '' : this.workdayPaymentsUnavailableReason(),
  );

  protected readonly orderSubscriptionTooltip = computed(() => {
    const unavailableReason = this.workdayPaymentsTooltip();
    if (unavailableReason) return unavailableReason;
    return this.hasSubscription() ? (this.subscriptionPlanName() ?? 'Подписка') : 'Оплата по подписке';
  });

  protected readonly chatSubscriptionTooltip = computed(() => {
    const unavailableReason = this.receiptPaymentsTooltip();
    if (unavailableReason) return unavailableReason;
    return this.hasSubscription() ? (this.subscriptionPlanName() ?? 'Подписка') : 'Оплата по подписке';
  });

  protected readonly posSubscriptionTooltip = computed(() => {
    const unavailableReason = this.receiptPaymentsTooltip();
    if (unavailableReason) return unavailableReason;
    return this.hasSubscription() ? (this.subscriptionPlanName() ?? 'Подписка') : 'Нет активной подписки';
  });

  protected toggleCashChoices(): void {
    this.cashChoicesOpen.update(open => !open);
  }

  protected selectFiscalCash(): void {
    this.cashChoicesOpen.set(false);
    this.payCash.emit();
  }

  protected selectNonFiscalCash(): void {
    this.cashChoicesOpen.set(false);
    this.payCashNoFiscal.emit();
  }
}
