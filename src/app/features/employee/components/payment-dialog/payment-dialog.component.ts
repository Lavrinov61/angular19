import {
  Component,
  ChangeDetectionStrategy,
  computed,
  inject,
  signal,
  effect,
  OnInit,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { PosService } from '../../services/pos.service';
import { PosApiService, type PosReceipt, type PosReceiptItem, type PosReceiptPayment, type PosShift } from '../../services/pos-api.service';
import { OrdersApiService } from '../../services/orders-api.service';
import { PaymentsService, type UpdatePaymentLinkBody } from '../../services/payments.service';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CloudPaymentsService } from '../../../../core/services/cloud-payments.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { PosCardProgressComponent, type CardPaymentStatus } from '../pos/dialogs/pos-card-progress.component';
import type { CartItem } from '../../../chat-page/services/cart.service';

import { PaymentDialogStateService } from './services/payment-dialog-state.service';
import { FuzzySearchService } from './services/fuzzy-search.service';
import { RecentServicesService } from './services/recent-services.service';
import type {
  PaymentDialogData,
  PaymentDialogResult,
  ApiCategoriesResponse,
  ApiCategory,
  UiCategory,
  UiOptionGroup,
  UiServiceOption,
  ApiServiceOption,
  QuickPreset,
  PaymentCartDetails,
} from './models/payment-dialog.models';

import { ServiceSearchComponent } from './components/service-search.component';
import { CatalogTileGridComponent, type CatalogCategory } from '../shared-pos/components/catalog-tile-grid.component';
import { PosPromoInputComponent, type PromoAppliedEvent } from '../pos/components/pos-promo-input.component';
import { PosSubscriptionCoverageComponent } from '../pos/components/pos-subscription-coverage.component';
import type { SubscriptionCoverage } from '../pos/models/pos.models';
import { QuickPresetsComponent } from './components/quick-presets.component';
import { ServiceGridComponent } from './components/service-grid.component';
import { SelectionSummaryComponent } from './components/selection-summary.component';
import { ManualAmountComponent } from './components/manual-amount.component';
import { PaymentFooterComponent } from './components/payment-footer.component';
import { SubscriptionPickerComponent } from './components/subscription-picker.component';
import { employeeApiErrorMessage } from '../../utils/api-error-message';
import {
  DEFAULT_BRIDGE_PAYMENT_TIMEOUT_MS,
  waitForBridgeTransaction,
} from '../../utils/pos-bridge-payment.util';
import {
  DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS,
  approvedCardFiscalRetryMessage,
  cardFiscalProblemMessage,
  receiptFiscalInitialStatus,
  waitForReceiptFiscalization,
} from '../../utils/pos-receipt-fiscalization.util';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../shared/confirm-dialog.component';
import {
  receiptFiscalShiftId,
  receiptFiscalShiftPreparation,
  type CashFiscalMode,
  type ReceiptFiscalShiftRef,
} from './utils/cash-fiscal-mode';
import {
  buildReceiptItemsFromCartDetails,
  singlePricingCategorySlug,
} from './utils/pricing-receipt.util';
import {
  formatRussianPhoneInput,
  normalizeRussianPhoneDigits,
} from '../../utils/phone-mask';

const TRANSFER_PAYMENT_PHONE = '89185236634';
const TRANSFER_PAYMENT_BANK = 'Тбанк';
const TRANSFER_PAYMENT_RECIPIENT = 'Елена';
type ReceiptPaymentMethod = 'cash' | 'card' | 'transfer' | 'sbp';
type LoyaltyLookupStatus = 'idle' | 'loading' | 'found' | 'not-found' | 'invalid' | 'error';

interface ReceiptPaymentOptions {
  readonly fiscalMode?: CashFiscalMode;
}

type FiscalReceiptPaymentMethod = 'cash' | 'card' | 'sbp';
type FiscalShiftPromptStatus = 'idle' | 'opening' | 'waiting' | 'error';
type FiscalShiftPreparationPromptStatus = 'open-existing-shift' | 'open-new-shift';

interface FiscalShiftPromptState {
  readonly method: FiscalReceiptPaymentMethod;
  readonly preparationStatus: FiscalShiftPreparationPromptStatus;
  readonly title: string;
  readonly message: string;
  readonly primaryLabel: string;
}

interface PendingFiscalShiftPayment {
  readonly method: FiscalReceiptPaymentMethod;
  readonly continueAfterOpen: () => void;
}

interface PendingCardApprovedPayment {
  readonly mode: 'order' | 'receipt';
  readonly transactionId?: string;
}

interface PendingCardFiscalPayment extends PendingCardApprovedPayment {
  readonly receipt: PosReceipt;
  readonly fiscalMode: CashFiscalMode;
  readonly runId: number;
}

interface ManualChatPaymentRequest {
  readonly sessionId: string;
  readonly amount: number;
  readonly method: ReceiptPaymentMethod;
  readonly fiscalMode?: CashFiscalMode;
  readonly receiptId: string;
  readonly receiptNumber: string;
  readonly phone?: string;
  readonly clientName?: string;
  readonly cartDetails?: PaymentCartDetails;
}

@Component({
  selector: 'app-payment-dialog',
  imports: [
    DecimalPipe,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ServiceSearchComponent,
    CatalogTileGridComponent,
    PosPromoInputComponent,
    PosSubscriptionCoverageComponent,
    QuickPresetsComponent,
    ServiceGridComponent,
    SelectionSummaryComponent,
    ManualAmountComponent,
    PaymentFooterComponent,
    SubscriptionPickerComponent,
    PosCardProgressComponent,
  ],
  providers: [PaymentDialogStateService, FuzzySearchService, RecentServicesService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="pd-root">
      <!-- Header -->
      <div class="pd-header">
        <div class="pd-header-left">
          <div class="pd-header-icon"><mat-icon>credit_card</mat-icon></div>
          <div>
            <div class="pd-title">{{ data.editPaymentLink ? 'ОПЛАТА · РЕДАКТИРОВАНИЕ' : 'ОПЛАТА' }}</div>
            <div class="pd-subtitle">
              @if (data.editPaymentLink) {
                {{ data.editPaymentLink.orderRef }} &middot; {{ data.clientName || data.phone }}
              } @else if (data.mode === 'order' && data.orderId) {
                {{ data.orderId }} &middot; {{ data.clientName || data.phone }}
              } @else {
                {{ data.clientName || data.phone }}
              }
            </div>
          </div>
        </div>
        <div class="pd-header-badges">
          @if (customerName()) {
            <div class="pd-customer-badge">
              <mat-icon>person</mat-icon>
              <span>{{ customerName() }}</span>
            </div>
          }
          @if (subscriptionInfo()) {
            <div class="pd-subscription-badge" matTooltip="Подписка: {{ subscriptionInfo()!.planName }}">
              <mat-icon>card_membership</mat-icon>
              <span>{{ subscriptionInfo()!.planName }}</span>
            </div>
          }
          @if (loyaltyPoints() > 0) {
            <div class="pd-loyalty-badge" matTooltip="{{ loyaltyLevel() }}">
              <mat-icon>stars</mat-icon>
              <span>{{ loyaltyPoints() }} бонусов</span>
              <span class="pd-loyalty-rub">&asymp; {{ loyaltyPointsAsRubles() | number:'1.0-0' }}₽</span>
            </div>
          }
        </div>
        <button class="pd-close-btn" mat-dialog-close aria-label="Закрыть">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div class="pd-body">
        @if (state.loading()) {
          <div class="pd-loading">
            <mat-spinner diameter="32" />
            <span>Загрузка услуг...</span>
          </div>
        } @else {
          @if (state.cartPrefillDetails(); as cartDetails) {
            <div class="pd-section pd-cart-prefill">
              <div class="pd-cart-prefill-label">Корзина клиента</div>
              <div class="pd-cart-prefill-list">
                @for (line of cartDetails.lines; track line.name + '-' + $index) {
                  <div class="pd-cart-prefill-row">
                    <div class="pd-cart-prefill-main">
                      <span class="pd-cart-prefill-name">{{ line.name }}</span>
                      @if (line.priceNote) {
                        <span class="pd-cart-prefill-note">{{ line.priceNote }}</span>
                      }
                    </div>
                    <div class="pd-cart-prefill-meta">
                      <span>{{ line.quantity }} × {{ line.unitPrice | number:'1.0-0' }}&#8239;&#8381;</span>
                      <strong>{{ line.total | number:'1.0-0' }}&#8239;&#8381;</strong>
                    </div>
                  </div>
                }
              </div>
              @if (cartDetails.savings > 0) {
                <div class="pd-cart-prefill-savings">
                  <mat-icon>savings</mat-icon>
                  <span>Скидка: &minus;{{ cartDetails.savings | number:'1.0-0' }}&#8239;&#8381;</span>
                </div>
              }
            </div>
          }

          @if (state.cartPrefillDetails()) {
            <div class="pd-cart-addons-heading">
              <mat-icon>add_shopping_cart</mat-icon>
              <span>Добавить в чек</span>
            </div>
          }

          <!-- Quick presets -->
          @if (!search.isSearching() && !selectedCategorySlug() && state.quickPresets().length > 0) {
            <div class="pd-section pd-presets">
              <app-pd-quick-presets
                [presets]="state.quickPresets()"
                (presetSelected)="onPresetSelected($event)"
              />
            </div>
          }

          <!-- Search -->
          <app-service-search [(query)]="search.query" />

          @if (search.isSearching()) {
            <!-- Search results -->
            <div class="pd-grid-area">
              <app-pd-service-grid
                mode="search"
                [sections]="state.visibleSections()"
                [searchResults]="search.results()"
                [selectedIds]="state.selectedIds()"
                (serviceToggled)="onServiceToggled($event)"
              />
            </div>
          } @else if (!selectedCategorySlug()) {
            <!-- Category tile grid -->
            <div class="pd-grid-area pd-tiles-area">
              <app-catalog-tile-grid
                [categories]="catalogTiles()"
                (categorySelected)="selectedCategorySlug.set($event)"
              />
            </div>
          } @else {
            <!-- Back button + services for selected category -->
            <div class="pd-section pd-back-row">
              <button class="pd-back-btn" (click)="selectedCategorySlug.set(null)">
                <mat-icon>arrow_back</mat-icon>
                <span>{{ selectedCategoryName() }}</span>
              </button>
            </div>
            <div class="pd-grid-area">
              <app-pd-service-grid
                mode="browse"
                [sections]="filteredByCategory()"
                [searchResults]="[]"
                [selectedIds]="state.selectedIds()"
                (serviceToggled)="onServiceToggled($event)"
              />
            </div>
          }

          <!-- Subscription coverage -->
          @if (subscriptionCoverage().length > 0) {
            <app-pos-subscription-coverage
              [coverage]="subscriptionCoverage()"
              [savings]="subscriptionSavings()"
            />
          }

          <!-- Selection summary -->
          @if (state.selectedItems().length > 0) {
            <div class="pd-section">
              <app-pd-selection-summary
                [items]="state.selectedItems()"
                [breakdown]="state.breakdown()"
                (quantityChanged)="state.changeQuantity($event.serviceId, $event.delta)"
                (quantitySet)="state.setQuantity($event.serviceId, $event.quantity)"
                (peopleCountChanged)="state.changePeopleCount($event.serviceId, $event.delta)"
                (peopleCountSet)="state.setPeopleCount($event.serviceId, $event.peopleCount)"
                (itemRemoved)="state.removeService($event)"
              />
              @if (state.apiSavings() > 0) {
                <div class="pd-savings">
                  <mat-icon>savings</mat-icon>
                  <span>Экономия: {{ state.apiSavings() | number:'1.0-0' }}&#8239;&#8381;</span>
                </div>
              }
              @if (state.subscriberDiscount(); as sub) {
                <div class="pd-subscriber-discount">
                  <mat-icon>loyalty</mat-icon>
                  <span>Скидка подписчика {{ sub.percent }}%: &minus;{{ sub.amount | number:'1.0-0' }}&#8239;&#8381;</span>
                </div>
              }
              @if (state.accountDiscount(); as account) {
                <div class="pd-account-discount">
                  <mat-icon>badge</mat-icon>
                  <span>{{ account.description || account.label + ' ' + account.percent + '%' }}: &minus;{{ account.amount | number:'1.0-0' }}&#8239;&#8381;</span>
                </div>
              }
              <button class="pd-save-template" (click)="saveAsTemplate()">
                <mat-icon>bookmark_add</mat-icon> Сохранить как шаблон
              </button>
            </div>

            <!-- Promo code -->
            <app-pos-promo-input
              (promoApplied)="onPromoApplied($event)"
              (promoRemoved)="onPromoRemoved()"
            />
          }

          <!-- Customer phone (attach for loyalty / education discount) -->
          @if (showCustomerPhoneBlock()) {
            <div class="pd-section pd-customer-phone">
              <div class="pd-phone-label">
                <span>Клиент для скидок</span>
                <small>Телефон проверит бонусы, подписку и образовательную цену</small>
              </div>
              @if (showCustomerPhoneField()) {
                <div class="pd-phone-field">
                  <div class="pd-phone-input-wrap">
                    <mat-icon>phone</mat-icon>
                    <input
                      class="pd-phone-input"
                      type="tel"
                      inputmode="tel"
                      autocomplete="tel"
                      maxlength="18"
                      placeholder="+7 (___) ___-__-__"
                      [value]="customerPhoneInput()"
                      (input)="onCustomerPhoneInput($any($event.target).value)"
                      (blur)="applyCustomerPhone()"
                      (keydown.enter)="applyCustomerPhone()"
                    />
                    <button
                      type="button"
                      class="pd-phone-apply"
                      [disabled]="!phoneLookupKeyPublic(customerPhoneInput())"
                      (click)="applyCustomerPhone()">
                      Применить
                    </button>
                  </div>
                  <div class="pd-phone-hint">
                    <mat-icon>school</mat-icon>
                    <span>Укажите телефон клиента — возможна образовательная или бонусная скидка</span>
                  </div>
                </div>
              } @else if (customerPhoneBound()) {
                <div class="pd-phone-bound">
                  <mat-icon>phone</mat-icon>
                  <span class="pd-phone-bound-value">{{ customerName() || 'Клиент' }} · …{{ state.customerPhone()!.slice(-4) }}</span>
                  <button type="button" class="pd-phone-change" (click)="startEditCustomerPhone()">Изменить</button>
                </div>
              } @else if (customerIdentityBound()) {
                <div class="pd-phone-bound">
                  <mat-icon>verified_user</mat-icon>
                  <span class="pd-phone-bound-value">{{ customerName() || 'Клиент' }} из чата привязан</span>
                  <button type="button" class="pd-phone-change" (click)="startEditCustomerPhone()">Изменить</button>
                </div>
              }
            </div>
          }

          <!-- Loyalty spend -->
          @if (showLoyaltyLookup()) {
            <div class="pd-section pd-loyalty" [class.pd-loyalty--muted]="loyaltyPoints() <= 0">
              <div class="pd-loyalty-row">
                <div class="pd-loyalty-info">
                  @if (loyaltyLookupStatus() === 'loading') {
                    <mat-spinner diameter="16" />
                  } @else {
                    <mat-icon>stars</mat-icon>
                  }
                  <div class="pd-loyalty-copy">
                    <span class="pd-loyalty-title">{{ loyaltyStatusTitle() }}</span>
                    <span class="pd-loyalty-hint">{{ loyaltyStatusHint() }}</span>
                  </div>
                </div>
                @if (loyaltyPoints() > 0) {
                  <div class="pd-loyalty-input">
                    <button (click)="toggleLoyalty()" class="pd-loyalty-toggle"
                      [class.active]="state.loyaltyPointsToUse() > 0"
                      [disabled]="state.loyaltyPointsToUse() <= 0 && state.loyaltyMaxPointsToUse() <= 0">
                      @if (state.loyaltyPointsToUse() > 0) {
                        Списать {{ state.loyaltyPointsUsed() }} бонусов (-{{ state.loyaltyDiscount() }}₽)
                      } @else {
                        Использовать бонусы
                      }
                    </button>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Manual amount -->
          <div class="pd-section">
            <app-pd-manual-amount
              [amount]="state.manualAmount()"
              [description]="state.description()"
              (amountChanged)="state.setManualAmount($event)"
              (descriptionChanged)="state.description.set($event)"
            />
          </div>
        }
      </div>

      <!-- Subscription picker (shown when no active subscription) -->
      @if (showSubscriptionPicker()) {
        <div class="pd-section">
          <app-subscription-picker
            [phone]="data.phone"
            [sessionId]="data.sessionId ?? ''"
            [clientName]="data.clientName ?? ''"
            (closed)="showSubscriptionPicker.set(false)"
            (subscriptionSent)="onSubscriptionOfferSent($event)"
          />
        </div>
      }

      <!-- Footer -->
      <div class="pd-footer-area">
        <app-pd-payment-footer
          [mode]="data.mode"
          [finalAmount]="state.finalAmount()"
          [onlineAmount]="state.finalAmount()"
          [itemCount]="state.selectedItems().length"
          [cartItemCount]="state.cartPrefillItemCount()"
          [cartAmount]="state.cartPrefillAmount()"
          [generating]="state.generating()"
          [generatingPos]="state.generatingPos()"
          [hasActiveShift]="hasActiveShift()"
          [workdayPaymentsAvailable]="workdayPaymentsAvailable()"
          [workdayPaymentsUnavailableReason]="workdayPaymentsUnavailableReason()"
          [receiptPaymentsAvailable]="receiptPaymentsAvailable()"
          [receiptPaymentsUnavailableReason]="receiptPaymentsUnavailableReason()"
          [canSubmit]="state.canSubmit()"
          [breakdown]="state.breakdown()"
          [manualAmount]="state.manualAmount()"
          [editMode]="!!data.editPaymentLink"
          [orderId]="data.orderId"
          [processing]="orderProcessing()"
          [processingMethod]="orderProcessingMethod()"
          [hasSubscription]="!!subscriptionInfo()"
          [subscriptionPlanName]="subscriptionInfo()?.planName ?? null"
          [volumeDiscountActive]="state.volumeDiscountRequested()"
          [showVolumeToggle]="state.showVolumeToggle()"
          (volumeDiscountToggle)="state.toggleVolumeDiscount()"
          (generateOnline)="onGenerateOnline()"
          (generatePos)="generatePosReceipt()"
          (copyLink)="generate(false)"
          (payCash)="onPayCash()"
          (payCashNoFiscal)="onPayCashNoFiscal()"
          (payTransfer)="onPayTransfer()"
          (payCard)="onPayCard()"
          (paySbp)="onPaySbp()"
          (paySubscription)="onPaySubscription()"
          (cancelled)="dialogRef.close({ type: 'cancelled' })"
        />
      </div>

      @if (fiscalShiftPrompt(); as prompt) {
        <div class="pd-card-overlay">
          <div class="pd-fiscal-shift-panel">
            <div class="pd-fiscal-shift-icon">
              <mat-icon>receipt_long</mat-icon>
            </div>
            <div class="pd-fiscal-shift-title">{{ prompt.title }}</div>
            <div class="pd-fiscal-shift-message">{{ prompt.message }}</div>

            @if (fiscalShiftOpenStatus() === 'opening' || fiscalShiftOpenStatus() === 'waiting') {
              <div class="pd-fiscal-shift-status">
                <mat-progress-spinner diameter="18" mode="indeterminate" />
                <span>
                  {{ fiscalShiftOpenStatus() === 'opening' ? 'Отправляем команду на АТОЛ' : 'Ждём подтверждение от АТОЛ27Ф' }}
                </span>
              </div>
            }

            @if (fiscalShiftOpenStatus() === 'error' && fiscalShiftOpenError()) {
              <div class="pd-fiscal-shift-error">{{ fiscalShiftOpenError() }}</div>
            }

            <div class="pd-fiscal-shift-actions">
              <button
                type="button"
                class="pd-fiscal-shift-button pd-fiscal-shift-button-secondary"
                [disabled]="fiscalShiftOpenStatus() === 'opening' || fiscalShiftOpenStatus() === 'waiting'"
                (click)="onFiscalShiftPromptCancel()">
                Отмена
              </button>
              <button
                type="button"
                class="pd-fiscal-shift-button pd-fiscal-shift-button-primary"
                [disabled]="fiscalShiftOpenStatus() === 'opening' || fiscalShiftOpenStatus() === 'waiting'"
                (click)="onFiscalShiftPromptConfirm()">
                {{ prompt.primaryLabel }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (cardPaymentActive()) {
        <div class="pd-card-overlay">
          <app-pos-card-progress
            [amount]="cardPaymentAmount()"
            [status]="cardPaymentStatus()"
            [errorMessage]="cardPaymentError()"
            (cancelRequested)="onCardCancel()"
            (retryRequested)="onCardRetry()" />
        </div>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .pd-root {
      position: relative;
      background: var(--mat-dialog-container-color, #1e1d1a);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      height: 100%;
      max-height: none;
    }

    .pd-card-overlay {
      position: absolute;
      inset: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.85);
      border-radius: inherit;
      backdrop-filter: blur(4px);
    }

    .pd-fiscal-shift-panel {
      width: min(420px, calc(100vw - 40px));
      border: 1px solid rgba(245, 158, 11, 0.32);
      border-radius: 8px;
      background: #1f1e1b;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
      padding: 24px;
      color: #f5f5f4;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 14px;
    }

    .pd-fiscal-shift-icon {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: rgba(16, 185, 129, 0.12);
      color: #34d399;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pd-fiscal-shift-title {
      font-size: 18px;
      line-height: 1.25;
      font-weight: 700;
    }

    .pd-fiscal-shift-message {
      color: rgba(245, 245, 244, 0.72);
      font-size: 14px;
      line-height: 1.5;
    }

    .pd-fiscal-shift-status {
      min-height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      color: #fbbf24;
      font-size: 13px;
      font-weight: 600;
    }

    .pd-fiscal-shift-error {
      width: 100%;
      border-radius: 6px;
      background: rgba(239, 68, 68, 0.12);
      color: #fca5a5;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.4;
    }

    .pd-fiscal-shift-actions {
      width: 100%;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 4px;
    }

    .pd-fiscal-shift-button {
      height: 40px;
      border-radius: 6px;
      border: 1px solid transparent;
      font: inherit;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 140ms ease, border-color 140ms ease, background 140ms ease;
    }

    .pd-fiscal-shift-button:disabled {
      cursor: default;
      opacity: 0.55;
    }

    .pd-fiscal-shift-button-secondary {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.12);
      color: #e7e5e4;
    }

    .pd-fiscal-shift-button-primary {
      background: #16a34a;
      color: #052e16;
    }

    /* ── Header ── */
    .pd-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 24px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      flex-shrink: 0;
    }

    .pd-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .pd-header-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #f59e0b;
      flex-shrink: 0;
    }

    .pd-title {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 18px;
      font-weight: 600;
      letter-spacing: 0.05em;
      color: #ececec;
      line-height: 1.2;
    }

    .pd-subtitle {
      font-size: 12px;
      color: var(--crm-text-secondary, #a0a0a0);
      margin-top: 1px;
    }

    .pd-header-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .pd-customer-badge,
    .pd-subscription-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .pd-customer-badge {
      background: rgba(59, 130, 246, 0.10);
      border: 1px solid rgba(59, 130, 246, 0.20);
      color: #60a5fa;

      mat-icon { color: #3b82f6; }
    }

    .pd-subscription-badge {
      background: rgba(139, 92, 246, 0.10);
      border: 1px solid rgba(139, 92, 246, 0.20);
      color: #a78bfa;

      mat-icon { color: #8b5cf6; }
    }

    .pd-loyalty-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 20px;
      background: rgba(245, 158, 11, 0.10);
      border: 1px solid rgba(245, 158, 11, 0.20);
      color: #fbbf24;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: #f59e0b; }
    }

    .pd-loyalty-rub {
      font-size: 10px;
      color: #7a7a7a;
      font-weight: 400;
    }

    .pd-close-btn {
      background: none;
      border: none;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #7a7a7a;
      transition: background 150ms ease, color 150ms ease;

      &:hover {
        background: rgba(255, 255, 255, 0.05);
        color: #ececec;
      }

      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }

    /* ── Body ── */
    .pd-body {
      display: flex;
      flex-direction: column;
      overflow: hidden;
      flex: 1;
      padding: 0 20px;
    }

    .pd-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 40px 0;
      color: #7a7a7a;
      font-size: 13px;
    }

    .pd-section {
      flex-shrink: 0;
      padding-top: 12px;
    }

    .pd-presets {
      padding-top: 14px;
    }

    .pd-tiles-area {
      max-height: none;
    }

    .pd-back-row {
      padding-top: 8px;
    }

    .pd-back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.03);
      color: #ececec;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease;

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: #f59e0b; }

      &:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(245, 158, 11, 0.30);
      }
    }

    .pd-grid-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      padding: 12px 0;
      min-height: 80px;
      max-height: none;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
    }

    .pd-cart-prefill {
      padding-top: 20px;
    }

    .pd-cart-prefill-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #7a7a7a;
      margin-bottom: 8px;
    }

    .pd-cart-prefill-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .pd-cart-prefill-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 42px;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid rgba(245, 158, 11, 0.18);
      background: rgba(245, 158, 11, 0.06);
    }

    .pd-cart-prefill-main {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 2px;
    }

    .pd-cart-prefill-name {
      font-size: 13px;
      font-weight: 600;
      color: #ececec;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pd-cart-prefill-note {
      font-size: 11px;
      color: #8a8a8a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pd-cart-prefill-meta {
      display: flex;
      align-items: baseline;
      gap: 12px;
      flex-shrink: 0;
      color: #8a8a8a;
      font-size: 12px;
      white-space: nowrap;

      strong {
        color: #fbbf24;
        font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
        font-size: 13px;
      }
    }

    .pd-cart-prefill-savings {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      color: #34d399;
      font-size: 11px;
      font-weight: 600;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .pd-cart-addons-heading {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid rgba(52, 211, 153, 0.22);
      background: rgba(52, 211, 153, 0.06);
      color: #a7f3d0;
      font-size: 12px;
      font-weight: 700;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
        color: #34d399;
      }
    }

    /* ── Savings & discounts ── */
    .pd-savings,
    .pd-subscriber-discount,
    .pd-account-discount {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
      font-size: 11px;
      font-weight: 600;
      color: #34d399;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .pd-subscriber-discount {
      color: #a78bfa;
      margin-left: 12px;
    }

    .pd-account-discount {
      color: #60a5fa;
      margin-left: 12px;
    }

    /* ── Save template button ── */
    .pd-save-template {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      padding: 0;
      background: none;
      border: none;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      color: #7a7a7a;
      transition: color 150ms ease;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &:hover { color: #f59e0b; }
    }

    /* ── Customer phone ── */
    .pd-customer-phone {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 14px;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid rgba(59, 130, 246, 0.30);
      background: rgba(59, 130, 246, 0.09);
    }

    .pd-phone-label {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;

      span {
        color: #dbeafe;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      small {
        color: #93c5fd;
        font-size: 11px;
        line-height: 1.3;
        text-align: right;
      }
    }

    .pd-phone-field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .pd-phone-input-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid rgba(147, 197, 253, 0.38);
      background: rgba(15, 23, 42, 0.34);

      > mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #60a5fa;
        flex-shrink: 0;
      }
    }

    .pd-phone-input {
      flex: 1;
      min-width: 0;
      background: none;
      border: none;
      outline: none;
      color: #ececec;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;

      &::placeholder { color: #93a4b8; }
    }

    .pd-phone-apply {
      flex-shrink: 0;
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid rgba(59, 130, 246, 0.35);
      background: rgba(59, 130, 246, 0.12);
      color: #93c5fd;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 150ms ease, border-color 150ms ease, opacity 150ms ease;

      &:hover:not(:disabled) {
        background: rgba(59, 130, 246, 0.20);
        border-color: #3b82f6;
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
      }
    }

    .pd-phone-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #8a8a8a;
      font-size: 11px;
      line-height: 1.35;

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: #60a5fa; flex-shrink: 0; }
    }

    .pd-phone-bound {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #a0a0a0;

      > mat-icon { font-size: 16px; width: 16px; height: 16px; color: #60a5fa; }
    }

    .pd-phone-bound-value {
      color: #ececec;
      font-weight: 600;
    }

    .pd-phone-change {
      margin-left: auto;
      padding: 0;
      background: none;
      border: none;
      cursor: pointer;
      font-family: inherit;
      font-size: 11px;
      color: #60a5fa;
      transition: color 150ms ease;

      &:hover { color: #93c5fd; }
    }

    @media (max-width: 640px) {
      .pd-phone-label {
        align-items: flex-start;
        flex-direction: column;
        gap: 4px;

        small {
          text-align: left;
        }
      }

      .pd-phone-input-wrap {
        align-items: stretch;
        flex-wrap: wrap;
      }

      .pd-phone-input {
        flex-basis: calc(100% - 26px);
      }

      .pd-phone-apply {
        margin-left: 26px;
      }
    }

    /* ── Loyalty spend ── */
    .pd-loyalty {
      border-top: 1px solid rgba(245, 158, 11, 0.12);
      padding-top: 14px;
    }

    .pd-loyalty--muted {
      border-top-color: rgba(120, 113, 108, 0.16);
    }

    .pd-loyalty-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .pd-loyalty-info {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #fbbf24;
      font-size: 13px;
      font-weight: 500;

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: #f59e0b; }
    }

    .pd-loyalty-copy {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .pd-loyalty-title {
      color: #fbbf24;
      font-size: 13px;
      font-weight: 600;
    }

    .pd-loyalty-hint {
      font-size: 11px;
      color: #7a7a7a;
      font-weight: 400;
    }

    .pd-loyalty-toggle {
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid rgba(245, 158, 11, 0.25);
      background: rgba(245, 158, 11, 0.06);
      color: #fbbf24;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 150ms ease, border-color 150ms ease, color 150ms ease;

      &:hover {
        background: rgba(245, 158, 11, 0.12);
        border-color: rgba(245, 158, 11, 0.40);
      }

      &.active {
        background: rgba(245, 158, 11, 0.15);
        border-color: #f59e0b;
        color: #f59e0b;
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.45;
        background: rgba(120, 113, 108, 0.10);
        border-color: rgba(120, 113, 108, 0.25);
        color: #8a8a8a;
      }
    }

    /* ── Footer ── */
    .pd-footer-area {
      flex-shrink: 0;
      padding: 0 20px 16px;
    }
  `],
})
export class PaymentDialogComponent implements OnInit, OnDestroy {
  readonly data = inject<PaymentDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<PaymentDialogComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly posService = inject(PosService);
  private readonly posApi = inject(PosApiService);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly paymentsService = inject(PaymentsService);
  private readonly dashboardData = inject(DashboardDataService);
  private readonly authService = inject(AuthService);
  private readonly cloudPayments = inject(CloudPaymentsService);
  private readonly wsService = inject(WebSocketService);

  readonly state = inject(PaymentDialogStateService);
  readonly search = inject(FuzzySearchService);
  private readonly recentServices = inject(RecentServicesService);

  private readonly searchComp = viewChild(ServiceSearchComponent);

  private readonly activeWorkdayShift = computed(() => {
    const shift = this.dashboardData.workday()?.shift;
    return shift?.status === 'active' ? shift : null;
  });
  readonly receiptStudioId = computed(() =>
    this.data.studioId ?? this.posService.studioId() ?? this.activeWorkdayShift()?.studio_id ?? null,
  );
  readonly hasActiveShift = computed(() =>
    this.data.mode === 'pos'
      ? !!this.receiptStudioId() || !!this.posService.shiftId()
      : !!this.posService.shiftId() || !!this.activeWorkdayShift(),
  );
  readonly workdayPaymentsAvailable = computed(() =>
    this.data.mode === 'pos' ? !!this.receiptStudioId() : !!this.activeWorkdayShift(),
  );
  readonly workdayPaymentsUnavailableReason = computed(() =>
    this.workdayPaymentsAvailable()
      ? ''
      : this.data.mode === 'pos'
        ? 'Выберите студию для создания чека.'
        : 'Начните рабочий день, чтобы принимать оплату.',
  );
  readonly receiptPaymentsAvailable = computed(() =>
    this.workdayPaymentsAvailable() && !!this.receiptStudioId(),
  );
  readonly receiptPaymentsUnavailableReason = computed(() =>
    this.receiptPaymentsAvailable()
      ? ''
      : this.data.mode === 'pos'
        ? 'Выберите студию для создания чека.'
        : 'Нет активной точки. Начните рабочий день.',
  );

  /** Order mode: processing state */
  readonly orderProcessing = signal(false);
  readonly orderProcessingMethod = signal<'cash' | 'card' | 'sbp' | 'online' | 'subscription' | 'transfer' | null>(null);
  private readonly currentReceiptShift = signal<PosShift | null>(null);
  private readonly fiscalShiftLoading = signal(false);
  private readonly fiscalShiftChecked = signal(false);
  readonly fiscalShiftPrompt = signal<FiscalShiftPromptState | null>(null);
  readonly fiscalShiftOpenStatus = signal<FiscalShiftPromptStatus>('idle');
  readonly fiscalShiftOpenError = signal<string | null>(null);
  private pendingFiscalShiftPayment: PendingFiscalShiftPayment | null = null;
  private pendingFiscalShift: PosShift | null = null;
  private fiscalShiftPollTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private fiscalShiftWaitStartedAt = 0;
  private fiscalShiftWaitingTransactionId: string | null = null;

  /** Card terminal payment state */
  readonly cardPaymentActive = signal(false);
  readonly cardPaymentStatus = signal<CardPaymentStatus>('waiting');
  readonly cardPaymentAmount = signal(0);
  readonly cardPaymentError = signal<string | null>(null);
  private readonly cardBankApproved = signal(false);
  private cardTransactionId: string | null = null;
  private cardTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private cardPaymentRunId = 0;
  private pendingCardApprovedPayment: PendingCardApprovedPayment | null = null;
  private pendingCardFiscalPayment: PendingCardFiscalPayment | null = null;

  /** Loyalty state */
  readonly loyaltyPoints = signal(0);
  readonly loyaltyLevel = signal('');
  readonly loyaltyProfileId = signal<string | null>(null);
  readonly loyaltyLookupStatus = signal<LoyaltyLookupStatus>('idle');
  readonly loyaltyLookupPhone = signal<string | null>(null);
  readonly loyaltyPointsAsRubles = computed(() =>
    Math.floor(this.loyaltyPoints() * this.state.conversionRate()),
  );
  readonly showLoyaltyLookup = computed(() =>
    !this.data.editPaymentLink && this.loyaltyLookupStatus() !== 'idle',
  );
  readonly loyaltyLookupPhoneLabel = computed(() => {
    const phone = this.loyaltyLookupPhone();
    return phone ? `...${phone.slice(-4)}` : '';
  });
  readonly loyaltyStatusTitle = computed(() => {
    const status = this.loyaltyLookupStatus();
    if (status === 'loading') return 'Проверяем бонусы';
    if (status === 'invalid') return 'Бонусы недоступны';
    if (status === 'not-found') return 'Бонусы не найдены';
    if (status === 'error') return 'Не удалось проверить бонусы';
    if (this.loyaltyPoints() <= 0) return 'Бонусы: 0 бонусов';
    return `Бонусы: ${this.loyaltyPoints()} бонусов`;
  });
  readonly loyaltyStatusHint = computed(() => {
    const phoneLabel = this.loyaltyLookupPhoneLabel();
    const phoneText = phoneLabel ? ` по номеру ${phoneLabel}` : '';
    const status = this.loyaltyLookupStatus();

    if (status === 'loading') return `Ищем профиль лояльности${phoneText}`;
    if (status === 'invalid') return 'Для списания нужен телефон клиента';
    if (status === 'not-found') return `Профиль лояльности не найден${phoneText}`;
    if (status === 'error') return 'Повторите открытие оплаты или проверьте телефон клиента';
    if (this.loyaltyPoints() <= 0) return `На счёте нет бонусов${phoneText}`;

    const unavailableReason = this.state.loyaltyUnavailableReason();
    if (unavailableReason) return unavailableReason;

    return `1 бонус = 1₽ · до ${this.state.loyaltyMaxPointsToUse()}₽`;
  });

  /**
   * Editable customer phone. Lets the cashier attach a known student's phone even when
   * the client came from a chat without a phone (visitor_phone NULL) — otherwise the
   * education/loyalty discount is never looked up and the receipt is charged at catalog
   * price. Bound to the input; a valid phone triggers loyalty/subscription/pricing reload.
   */
  readonly customerPhoneInput = signal<string>('');

  /** Whether the cashier is editing an already-attached phone (manual "change" toggle). */
  readonly customerPhoneEditing = signal(false);

  /** A valid 10+ digit phone is currently attached to the pricing request. */
  readonly customerPhoneBound = computed(() => !!this.state.customerPhone());
  readonly customerIdentityBound = computed(() => !!this.state.customerIdentity());
  readonly customerPricingBound = computed(() => this.customerPhoneBound() || this.customerIdentityBound());

  /**
   * Телефон, который реально должен попасть в платёжные запросы. Источник истины —
   * state.customerPhone() (он же драйвит пересчёт/скидку в превью); фолбэк — data.phone.
   * Маску не отправляем: для employee backend сам резолвит телефон по client identity.
   */
  private effectiveCustomerPhone(): string {
    const phone = this.state.customerPhone() ?? this.data.phone ?? '';
    return this.isMaskedPhone(phone) ? '' : phone;
  }

  /**
   * Show the phone field when no valid phone is attached yet, or when the cashier
   * explicitly chose to edit it. Never in payment-link editing mode (phone is fixed there).
   */
  readonly showCustomerPhoneField = computed(() =>
    !this.data.editPaymentLink && (!this.customerPricingBound() || this.customerPhoneEditing()),
  );

  /**
   * The phone block only makes sense once there is something to price (selected items
   * or a prefilled cart) — that's when a discount could actually apply. Hidden on the
   * empty catalog screen to stay unobtrusive.
   */
  readonly showCustomerPhoneBlock = computed(() =>
    !this.data.editPaymentLink
    && (this.state.selectedItems().length > 0 || !!this.state.cartPrefillDetails()),
  );

  /** Category tile grid navigation */
  readonly selectedCategorySlug = signal<string | null>(null);

  /** Map UiCategory[] → CatalogCategory[] for tile grid */
  readonly catalogTiles = computed<CatalogCategory[]>(() =>
    this.state.categories().map(cat => ({
      slug: cat.slug,
      name: cat.name,
      icon: cat.icon,
      itemCount: cat.allOptions.length,
    })),
  );

  /** Filtered categories for selected slug */
  readonly filteredByCategory = computed<readonly UiCategory[]>(() => {
    const slug = this.selectedCategorySlug();
    if (!slug) return this.state.categories();
    return this.state.categories().filter(c => c.slug === slug);
  });

  /** Selected category display name */
  readonly selectedCategoryName = computed(() => {
    const slug = this.selectedCategorySlug();
    if (!slug) return '';
    return this.state.categories().find(c => c.slug === slug)?.name ?? '';
  });

  /** Promo code state */
  readonly appliedPromo = signal<PromoAppliedEvent | null>(null);

  /** Customer name (from lookup or dialog data) */
  readonly customerName = signal<string | null>(null);

  /** Subscription info */
  readonly subscriptionInfo = signal<{ id: string; planName: string; status: string } | null>(null);
  readonly showSubscriptionPicker = signal(false);
  readonly subscriptionCoverage = signal<SubscriptionCoverage[]>([]);
  readonly subscriptionSavings = signal(0);

  constructor() {
    // Watch WebSocket pos:transaction-update for card terminal results
    effect(() => {
      const update = this.wsService.posTransactionUpdate();
      if (!update) return;
      if (!this.cardTransactionId || update.transaction_id !== this.cardTransactionId) return;

      if (update.status === 'completed') {
        this.onTerminalPaymentSuccess();
      } else if (update.status === 'failed' || update.status === 'cancelled' || update.status === 'timeout') {
        this.failTerminalPayment(update.error_message || 'Оплата на терминале не прошла');
      }
    });

    effect(() => {
      const current = this.state.loyaltyPointsToUse();
      const max = this.state.loyaltyMaxPointsToUse();
      if (current > max) {
        this.state.setLoyaltyPointsToUse(max);
      }
    });

    effect((onCleanup) => {
      const subscriptionId = this.subscriptionInfo()?.id;
      const items = this.buildSubscriptionCoverageItems();

      if (!subscriptionId || items.length === 0) {
        this.subscriptionCoverage.set([]);
        this.subscriptionSavings.set(0);
        return;
      }

      this.subscriptionCoverage.set([]);
      this.subscriptionSavings.set(0);
      const sub = this.posApi.calculateSubscriptionCoverage({
        subscription_id: subscriptionId,
        items,
      }).subscribe({
        next: (coverage) => {
          this.subscriptionCoverage.set(
            coverage.items.map(item => ({
              productId: item.product_id,
              productName: item.product_name,
              quantity: item.quantity,
              creditsConsumed: item.credits_consumed,
              creditMultiplier: item.credit_multiplier,
              coverageMultiplier: item.coverage_multiplier,
              coveragePercent: item.coverage_percent,
              coveredQty: item.covered_quantity,
              remainingQty: item.remaining_quantity,
              savedAmount: item.covered_amount,
            })),
          );
          this.subscriptionSavings.set(
            Math.round(coverage.total_covered_amount * 100) / 100,
          );
        },
        error: () => {
          this.subscriptionCoverage.set([]);
          this.subscriptionSavings.set(0);
        },
      });

      onCleanup(() => sub.unsubscribe());
    });
  }

  ngOnDestroy(): void {
    if (this.cardTimeoutId) {
      clearTimeout(this.cardTimeoutId);
      this.cardTimeoutId = null;
    }
    this.cardPaymentRunId += 1;
    this.clearFiscalShiftPolling();
  }

  ngOnInit(): void {
    this.state.pricingChannel.set(this.data.mode === 'pos' ? 'pos' : 'crm');
    this.loadCategories();
    this.loadTemplates();
    if (!this.dashboardData.workdayLoaded()) {
      this.dashboardData.loadWorkday();
    }
    this.refreshCurrentFiscalShift();
    // Телефон из чата для не-админов МАСКИРУЕТСЯ. Реальный номер в браузер не тянем:
    // для образовательной скидки backend сам резолвит его по user_id/contact_id.
    const phoneUsable = !!this.data.phone && !this.isMaskedPhone(this.data.phone);
    const hasIdentity = !!this.data.clientUserId || !!this.data.clientContactId;
    if (phoneUsable) {
      const normalizedPhone = normalizeRussianPhoneDigits(this.data.phone);
      this.customerPhoneInput.set(formatRussianPhoneInput(normalizedPhone));
      this.loadLoyalty(normalizedPhone);
      this.loadSubscription(normalizedPhone);
      this.state.setCustomerPhone(normalizedPhone);
    } else if (hasIdentity) {
      this.customerPhoneInput.set(this.data.phone ?? '');
      this.state.setCustomerIdentity({
        clientUserId: this.data.clientUserId,
        clientContactId: this.data.clientContactId,
      });
    } else if (this.data.phone) {
      this.customerPhoneInput.set(this.data.phone);
      this.loyaltyLookupStatus.set('invalid');
    } else if (this.data.mode === 'chat' || this.data.mode === 'order') {
      this.loyaltyLookupStatus.set('invalid');
    }
    if (this.data.clientName) {
      this.customerName.set(this.data.clientName);
    }

    // Pre-fill manual amount from a known total before the catalog finishes loading.
    if (
      !this.data.editPaymentLink
      && !this.data.prefillSlugs?.length
      && !this.data.prefillServices?.length
      && !this.data.prefillCartDetails
      && this.data.totalPrice
    ) {
      this.state.setManualAmount(String(this.data.totalPrice));
      this.state.description.set(this.data.mode === 'order'
        ? `Заказ ${this.data.orderId ?? ''}`.trim()
        : `Оплата ${this.data.clientName || this.data.phone || ''}`.trim());
    }
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === 'k') {
      event.preventDefault();
      this.searchComp()?.focus();
      return;
    }

    if (event.ctrlKey && event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return; // prevent key-repeat auto-fire
      this.generatePosReceipt();
      return;
    }

    if (event.ctrlKey && event.key === 'Enter') {
      event.preventDefault();
      if (event.repeat) return; // prevent key-repeat auto-fire
      if (this.data.mode === 'pos') return;
      this.generate(true);
      return;
    }
  }

  onPresetSelected(preset: QuickPreset): void {
    this.state.addPreset(preset);
    // Track usage if DB template
    if (preset.id && !preset.id.startsWith('fallback-')) {
      this.http.post(`/api/pricing/templates/${preset.id}/use`, {}).subscribe();
    }
  }

  saveAsTemplate(): void {
    const items = this.state.selectedItems();
    if (items.length === 0) return;

    const slugs = items.map(i => i.service.slug);
    const name = this.state.autoDescription() || 'Новый шаблон';

    this.http.post<{ success: boolean; template: { id: string } }>(
      '/api/pricing/templates',
      { name, option_slugs: slugs, scope: 'personal' },
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.snackBar.open('Шаблон сохранён', '', { duration: 2500 });
          this.loadTemplates();
        }
      },
      error: () => this.snackBar.open('Не удалось сохранить шаблон', '', { duration: 3000 }),
    });
  }

  toggleLoyalty(): void {
    if (this.state.loyaltyPointsToUse() > 0) {
      this.state.setLoyaltyPointsToUse(0);
    } else {
      const maxPoints = this.state.loyaltyMaxPointsToUse();
      if (maxPoints <= 0) {
        this.snackBar.open(this.state.loyaltyUnavailableReason() ?? 'Бонусы сейчас недоступны', '', { duration: 3000 });
        return;
      }
      this.state.setLoyaltyPointsToUse(maxPoints);
    }
  }

  onServiceToggled(event: { service: UiServiceOption; categoryName: string }): void {
    this.state.selectService(event.service, event.categoryName);
  }

  onPromoApplied(event: PromoAppliedEvent): void {
    this.appliedPromo.set(event);
  }

  onPromoRemoved(): void {
    this.appliedPromo.set(null);
  }

  // ── API loading ──

  private loadCategories(): void {
    this.state.loading.set(true);
    this.http.get<ApiCategoriesResponse>('/api/pricing/categories').subscribe({
      next: (res) => {
        if (res.success && Array.isArray(res.categories)) {
          const mapped = res.categories.map(c => this.mapCategory(c));
          this.state.categories.set(mapped);
          this.search.buildIndex(mapped);
          if (this.data.editPaymentLink) {
            this.state.applyPaymentLinkPrefill(
              this.data.editPaymentLink.services ?? [],
              this.data.editPaymentLink.amount,
              this.data.editPaymentLink.description ?? '',
            );
          } else if (this.data.prefillServices?.length || this.data.prefillCartDetails) {
            this.state.applyCartPrefill(
              this.data.prefillServices ?? [],
              this.data.totalPrice ?? this.data.prefillCartDetails?.subtotal ?? 0,
              this.cartPrefillDescription(),
              this.data.prefillCartDetails ?? null,
            );
          } else if (this.data.prefillSlugs?.length) {
            // F58: apply prefill slugs after categories loaded
            this.state.applyPrefill(this.data.prefillSlugs);
          }
        }
        this.state.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Не удалось загрузить услуги', '', { duration: 3000 });
        this.state.loading.set(false);
      },
    });
  }

  private cartPrefillDescription(): string {
    const lineNames = this.data.prefillCartDetails?.lines
      .map(line => line.name.trim())
      .filter(name => name.length > 0) ?? [];
    if (lineNames.length > 0) return lineNames.join(', ');
    return `Оплата ${this.data.clientName || this.data.phone || ''}`.trim();
  }

  private phoneLookupKey(phone: string): string | null {
    const digits = normalizeRussianPhoneDigits(phone);
    return digits.length >= 10 ? digits.slice(-10) : null;
  }

  /** Телефон замаскирован (maskPhone в чате) или неполный — для расчёта непригоден. */
  private isMaskedPhone(phone: string): boolean {
    return phone.includes('*') || phone.replace(/\D/g, '').length < 10;
  }

  /** Template-facing validity check for the customer phone input. */
  phoneLookupKeyPublic(phone: string): string | null {
    return this.phoneLookupKey(phone);
  }

  private loadTemplates(): void {
    this.http.get<{
      success: boolean;
      templates: readonly { id: string; name: string; icon: string; option_slugs: string[] }[];
    }>('/api/pricing/templates').subscribe({
      next: (res) => {
        if (res.success && Array.isArray(res.templates)) {
          const presets: QuickPreset[] = res.templates.map(t => ({
            id: t.id,
            label: t.name,
            icon: t.icon || 'bookmark',
            optionSlugs: t.option_slugs,
          }));
          this.state.dbTemplates.set(presets);
        }
      },
    });
  }

  private loadSubscription(phone: string): void {
    const lookupPhone = this.phoneLookupKey(phone);
    if (!lookupPhone) {
      this.subscriptionInfo.set(null);
      this.subscriptionCoverage.set([]);
      this.subscriptionSavings.set(0);
      return;
    }
    this.http.get<{
      success: boolean;
      subscription: { id: string; plan_name: string; status: string } | null;
      credits?: { product_id: string; product_name: string; total: number; used: number; remaining: number }[];
    }>(`/api/subscriptions/check/${lookupPhone}`).subscribe({
      next: (res) => {
        if (res.subscription) {
          this.subscriptionInfo.set({
            id: res.subscription.id,
            planName: res.subscription.plan_name,
            status: res.subscription.status,
          });
        } else {
          this.subscriptionInfo.set(null);
          this.subscriptionCoverage.set([]);
          this.subscriptionSavings.set(0);
        }
      },
    });
  }

  private buildSubscriptionCoverageItems(): PosReceiptItem[] {
    const breakdown = this.state.breakdown();
    const paymentServices = this.state.buildPaymentServices();

    return this.state.selectedItems()
      .map((item, index): PosReceiptItem | null => {
        if (!item.service.productId) return null;

        const line = breakdown[index];
        const serviceMeta = paymentServices[index];
        const quantity = item.quantity;
        const unitPrice = line?.unitPrice ?? item.service.price;
        const total = line?.total ?? unitPrice * quantity;

        return {
          product_id: item.service.productId,
          product_name: serviceMeta?.name ?? item.service.name,
          quantity,
          unit_price: unitPrice,
          discount_amount: line?.discountAmount ?? 0,
          discount_percent: 0,
          points_used: 0,
          subscription_credits_used: 0,
          print_fill_percent: serviceMeta?.printFillPercent ?? null,
          total,
        };
      })
      .filter((item): item is PosReceiptItem => item !== null);
  }

  private loadLoyalty(phone: string): void {
    const lookupPhone = this.phoneLookupKey(phone);
    this.loyaltyLookupPhone.set(lookupPhone);

    if (!lookupPhone) {
      this.resetLoyalty();
      this.loyaltyLookupStatus.set('invalid');
      return;
    }

    this.loyaltyLookupStatus.set('loading');

    this.posApi.lookupCustomer(lookupPhone).subscribe({
      next: (res) => {
        if (this.loyaltyLookupPhone() !== lookupPhone) return;
        if (res.customer_name && !this.customerName()) {
          this.customerName.set(res.customer_name);
        }
        if (res.loyalty) {
          this.loyaltyPoints.set(res.loyalty.points);
          this.loyaltyLevel.set(res.loyalty.levelName);
          this.loyaltyProfileId.set(res.loyalty.id);
          this.state.setLoyaltyProfile({
            id: res.loyalty.id,
            points: res.loyalty.points,
            conversionRate: res.loyalty.conversionRate,
          });
          this.loyaltyLookupStatus.set('found');
        } else {
          this.resetLoyalty();
          this.loyaltyLookupStatus.set('not-found');
        }
      },
      error: () => {
        if (this.loyaltyLookupPhone() !== lookupPhone) return;
        this.resetLoyalty();
        this.loyaltyLookupStatus.set('error');
      },
    });
  }

  private resetLoyalty(): void {
    this.loyaltyPoints.set(0);
    this.loyaltyLevel.set('');
    this.loyaltyProfileId.set(null);
    this.state.setLoyaltyProfile({ id: null, points: 0, conversionRate: 1 });
  }

  /** Two-way binding handler for the editable customer phone input. */
  onCustomerPhoneInput(value: string): void {
    this.customerPhoneInput.set(formatRussianPhoneInput(value));
  }

  /**
   * Attach the typed phone to the receipt: when it has 10+ digits, reload loyalty,
   * subscription and pricing (which surfaces the education/account discount and bonuses).
   * An incomplete number just clears the previously attached phone without erroring.
   */
  applyCustomerPhone(): void {
    const raw = this.customerPhoneInput().trim();
    const normalizedPhone = normalizeRussianPhoneDigits(raw);
    const lookupPhone = this.phoneLookupKey(normalizedPhone);

    if (!lookupPhone) {
      this.state.setCustomerPhone(null);
      this.resetLoyalty();
      this.loyaltyLookupStatus.set(raw ? 'invalid' : 'idle');
      this.customerPhoneEditing.set(false);
      return;
    }

    this.customerPhoneInput.set(formatRussianPhoneInput(normalizedPhone));
    this.loadLoyalty(normalizedPhone);
    this.loadSubscription(normalizedPhone);
    this.state.setCustomerPhone(normalizedPhone);
    this.customerPhoneEditing.set(false);
  }

  /** Reveal the phone input to change an already-attached number. */
  startEditCustomerPhone(): void {
    const currentPhone = this.state.customerPhone() ?? this.data.phone ?? '';
    this.customerPhoneInput.set(this.isMaskedPhone(currentPhone) ? currentPhone : formatRussianPhoneInput(currentPhone));
    this.customerPhoneEditing.set(true);
  }

  private mapCategory(cat: ApiCategory): UiCategory {
    const groups: UiOptionGroup[] = cat.optionGroups
      .filter(g => g.options.length > 0)
      .map(g => ({
        name: g.name,
        slug: g.slug,
        options: g.options.map(o => this.mapOption(o, cat.slug, g.slug)),
      }));

    const allOptions = groups.flatMap(g => g.options);

    return {
      slug: cat.slug,
      name: cat.name,
      icon: cat.icon || 'category',
      groups,
      allOptions,
    };
  }

  private mapOption(o: ApiServiceOption, categorySlug: string, groupSlug: string): UiServiceOption {
    return {
      id: o.id,
      slug: o.slug,
      name: o.name,
      categorySlug,
      groupSlug,
      description: o.description || '',
      price: o.price_studio ?? o.base_price,
      priceMax: o.price_max,
      icon: o.icon || 'sell',
      popular: o.popular,
      originalPrice: o.original_price,
      features: o.features || [],
      productId: o.product_id ?? null,
    };
  }

  // ── Unified online handler ──

  onGenerateOnline(): void {
    if (this.data.mode === 'pos') {
      this.snackBar.open('Онлайн-оплата недоступна без чата', '', { duration: 3000 });
      return;
    }
    if (this.data.mode === 'order') {
      // Order mode: create link + copy to clipboard (no chat auto-send)
      this.generate(false);
    } else {
      // Chat mode: auto-send to chat
      this.generate(true);
    }
  }

  // ── Payment link generation ──

  generate(autoSend: boolean): void {
    if (this.data.mode === 'pos') {
      this.snackBar.open('Онлайн-оплата недоступна без чата', '', { duration: 3000 });
      return;
    }
    // Prevent multi-click: if already generating, ignore
    if (this.state.generating() || this.orderProcessing()) return;

    const finalAmt = this.state.finalAmount();
    if (this.state.amountBeforeLoyalty() < 1) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;
    if (!this.ensureWorkdayPaymentsAvailable()) return;

    if (this.data.mode === 'order') {
      this.orderProcessing.set(true);
      this.orderProcessingMethod.set('online');
    } else {
      this.state.generating.set(true);
    }

    const selectedServices = this.state.buildPaymentServices();
    const cartDetails = this.state.buildCartDetails();
    const promo = this.appliedPromo();

    const body: UpdatePaymentLinkBody & {
      readonly sessionId?: string;
      readonly orderId?: string;
    } = {
      amount: this.state.finalAmount(),
      description: this.state.description() || `Оплата ${finalAmt}₽`,
      phone: this.effectiveCustomerPhone() || undefined,
      clientName: this.data.clientName,
      clientUserId: this.data.clientUserId,
      clientContactId: this.data.clientContactId,
      sessionId: this.data.sessionId,
      orderId: this.data.orderId,
      services: selectedServices,
      autoSend,
      ...(cartDetails.lines.length > 0 ? { cartDetails } : {}),
      ...(promo ? { promo_code: promo.code } : {}),
    };

    const editLink = this.data.editPaymentLink;
    const request$ = editLink
      ? this.paymentsService.updateLink(editLink.id, body)
      : this.http.post<{ success: boolean; data?: { paymentUrl: string; orderId?: string; amount?: number } }>(
          '/api/payments/create-link',
          body,
        );

    request$.subscribe({
      next: (res) => {
        if (res.success && res.data?.paymentUrl) {
          this.trackRecentServices();

          if (autoSend) {
            const result: PaymentDialogResult = {
              type: editLink ? 'updated' : 'sent',
              orderId: res.data.orderId ?? editLink?.orderRef,
              amount: res.data.amount,
            };
            this.dialogRef.close(result);
          } else {
            navigator.clipboard.writeText(res.data.paymentUrl).then(() => {
              this.snackBar.open(
                editLink ? 'Ссылка обновлена и скопирована' : 'Ссылка скопирована в буфер обмена',
                '',
                { duration: 2500 },
              );
              const result: PaymentDialogResult = editLink
                ? { type: 'updated', orderId: res.data?.orderId ?? editLink.orderRef, amount: res.data?.amount }
                : { type: 'copied' };
              this.dialogRef.close(result);
            });
          }
        } else {
          this.snackBar.open(editLink ? 'Не удалось обновить ссылку' : 'Не удалось создать ссылку', '', { duration: 3000 });
        }
        this.resetGenerating();
      },
      error: (err: unknown) => {
        const message = employeeApiErrorMessage(
          err,
          editLink ? 'Ошибка при обновлении ссылки' : 'Ошибка при создании ссылки',
        );
        this.snackBar.open(message, '', { duration: 4000 });
        this.resetGenerating();
      },
    });
  }

  // ── Order mode: direct payment methods ──

  payOrderCash(): void {
    const orderId = this.data.orderId;
    if (!orderId) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('cash');

    this.ordersApi.recordPayment(orderId, { payment_method: 'cash' }).subscribe({
      next: () => {
        this.trackRecentServices();
        this.snackBar.open('Оплата наличными принята', '', { duration: 2500 });
        this.dialogRef.close({ type: 'cash' } satisfies PaymentDialogResult);
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message ?? 'Ошибка записи оплаты', '', { duration: 3000 });
        this.orderProcessing.set(false);
        this.orderProcessingMethod.set(null);
      },
    });
  }

  payOrderTransfer(): void {
    const orderId = this.data.orderId;
    if (!orderId) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('transfer');

    this.ordersApi.recordPayment(orderId, { payment_method: 'transfer' }).subscribe({
      next: () => {
        this.trackRecentServices();
        this.snackBar.open('Оплата переводом принята', '', { duration: 2500 });
        this.dialogRef.close({ type: 'transfer' } satisfies PaymentDialogResult);
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message ?? 'Ошибка записи оплаты', '', { duration: 3000 });
        this.orderProcessing.set(false);
        this.orderProcessingMethod.set(null);
      },
    });
  }

  payOrderCard(): void {
    const orderId = this.data.orderId;
    if (!orderId) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;
    if (!this.receiptStudioId()) {
      this.snackBar.open(this.receiptPaymentsUnavailableReason(), '', { duration: 3000 });
      return;
    }
    this.prepareFiscalReceiptShift('card', 'fiscal', () => {
      this.orderProcessing.set(true);
      this.orderProcessingMethod.set('card');
      this.startTerminalPayment(this.state.finalAmount(), orderId.toString());
    });
  }

  async payOrderSbp(): Promise<void> {
    const orderId = this.data.orderId;
    if (!orderId) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('sbp');

    const cartItems = this.buildCartItems();
    const result = await this.cloudPayments.paySbp(
      orderId,
      cartItems,
      undefined,
      this.effectiveCustomerPhone() || undefined,
    );

    if (result.success) {
      this.ordersApi.recordPayment(orderId, {
        payment_method: 'sbp',
        transaction_id: result.transactionId?.toString(),
      }).subscribe({
        next: () => {
          this.trackRecentServices();
          this.snackBar.open('Оплата СБП принята', '', { duration: 2500 });
          this.dialogRef.close({
            type: 'sbp',
            transactionId: result.transactionId?.toString(),
          } satisfies PaymentDialogResult);
        },
        error: (err) => {
          this.snackBar.open(err?.error?.message ?? 'Ошибка записи оплаты', '', { duration: 3000 });
          this.orderProcessing.set(false);
          this.orderProcessingMethod.set(null);
        },
      });
    } else {
      this.snackBar.open(result.error || 'СБП не завершён', '', { duration: 3000 });
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);
    }
  }

  // ── Subscription payment ──

  private payOrderSubscription(): void {
    const orderId = this.data.orderId;
    const sub = this.subscriptionInfo();
    if (!orderId || !sub) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;

    const amount = this.state.finalAmount();
    const subscriptionAmount = this.subscriptionSavings();
    if (subscriptionAmount <= 0) {
      this.snackBar.open('Подписка не покрывает выбранные услуги', '', { duration: 3000 });
      return;
    }
    if (Math.abs(subscriptionAmount - amount) > 0.01) {
      this.snackBar.open(`Подписка покрывает ${subscriptionAmount}₽ из ${amount}₽`, '', { duration: 4000 });
      return;
    }

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('subscription');

    this.ordersApi.recordPayment(orderId, {
      payment_method: 'subscription',
      subscription_id: sub.id,
    }).subscribe({
      next: () => {
        this.trackRecentServices();
        this.snackBar.open('Оплачено по подписке', '', { duration: 2500 });
        this.dialogRef.close({
          type: 'subscription',
          subscriptionId: sub.id,
          creditUsed: subscriptionAmount,
        } satisfies PaymentDialogResult);
      },
      error: (err) => {
        this.snackBar.open(err?.error?.message ?? 'Ошибка оплаты по подписке', '', { duration: 3000 });
        this.orderProcessing.set(false);
        this.orderProcessingMethod.set(null);
      },
    });
  }

  private payChatSubscription(): void {
    const sub = this.subscriptionInfo();
    if (!sub) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;

    const amount = this.state.finalAmount();
    if (this.state.amountBeforeLoyalty() < 1) return;

    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) return;

    if (!this.receiptPaymentsAvailable()) {
      this.snackBar.open(this.receiptPaymentsUnavailableReason(), '', { duration: 3000 });
      return;
    }

    const studioId = this.receiptStudioId();
    if (!studioId) {
      this.snackBar.open('Нет активной точки для создания чека', '', { duration: 3000 });
      return;
    }

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('subscription');

    const items = this.state.selectedItems();
    const subscriptionAmount = this.subscriptionSavings();
    if (subscriptionAmount <= 0) {
      this.snackBar.open('Подписка не покрывает выбранные услуги', '', { duration: 3000 });
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);
      return;
    }
    if (Math.abs(subscriptionAmount - amount) > 0.01) {
      this.snackBar.open(`Подписка покрывает ${subscriptionAmount}₽ из ${amount}₽`, '', { duration: 4000 });
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);
      return;
    }

    const payments: PosReceiptPayment[] = [{ payment_type: 'subscription', amount: subscriptionAmount }];

    if (items.length > 0) {
      const selectedOptions = this.state.buildSelectedOptions();

      const firstItem = items[0];
      const cat = this.state.categories().find(c =>
        c.allOptions.some(o => o.id === firstItem.service.id),
      );
      const categorySlug = cat?.slug ?? 'photography';

      this.posApi.createFromPricing({
        category_slug: categorySlug,
        selected_options: selectedOptions,
        delivery_method: 'pickup',
        shift_id: this.posService.shiftId() ?? undefined,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        client_user_id: this.data.clientUserId,
        client_contact_id: this.data.clientContactId,
        customer_name: this.data.clientName || undefined,
        print_order_id: this.data.printOrderId,
        payments,
        subscription_id: sub.id,
        manual_amount: this.state.manualAmount() || undefined,
        manual_description: this.state.description() || undefined,
        apply_volume_discount: this.state.volumeDiscountRequested() || undefined,
        retouch_config: this.data.retouchConfig,
      }).subscribe({
        next: (receipt) => {
          this.trackRecentServices();
          this.snackBar.open(`Оплачено по подписке: ${receipt.receipt_number}`, '', { duration: 3000 });
          this.dialogRef.close({
            type: 'subscription',
            subscriptionId: sub.id,
            creditUsed: subscriptionAmount,
            receiptNumber: receipt.receipt_number,
            amount: receipt.total,
          } satisfies PaymentDialogResult);
          this.orderProcessing.set(false);
          this.orderProcessingMethod.set(null);
        },
        error: () => {
          this.snackBar.open('Ошибка при создании чека', '', { duration: 3000 });
          this.orderProcessing.set(false);
          this.orderProcessingMethod.set(null);
        },
      });
    } else {
      this.snackBar.open('Подписка не применяется к ручной сумме', '', { duration: 3000 });
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);
    }
  }

  // ── Dispatch pay methods (order or chat mode) ──

  onPayCash(): void {
    if (!this.ensureWorkdayPaymentsAvailable()) return;
    if (this.data.mode === 'order') {
      this.payOrderCash();
      return;
    }
    this.prepareFiscalReceiptShift('cash', 'fiscal', () => {
      this.payReceiptDirect('cash', undefined, { fiscalMode: 'fiscal' });
    });
  }

  onPayCashNoFiscal(): void {
    if (!this.ensureWorkdayPaymentsAvailable()) return;
    if (this.data.mode === 'order') {
      this.payOrderCash();
      return;
    }
    this.payReceiptDirect('cash', undefined, { fiscalMode: 'skip' });
  }

  async onPayTransfer(): Promise<void> {
    if (!this.ensureWorkdayPaymentsAvailable()) return;
    if (this.data.mode === 'order') {
      this.payOrderTransfer();
    } else if (this.data.mode === 'pos') {
      const transferReceived = await this.confirmTransferReceived(this.state.finalAmount());
      if (!transferReceived) return;
      this.payReceiptDirect('transfer');
    } else {
      await this.sendChatTransferInstructions();
    }
  }

  onPayCard(): void {
    if (!this.ensureWorkdayPaymentsAvailable()) return;
    if (this.data.mode === 'order') {
      this.payOrderCard();
    } else {
      if (!this.receiptStudioId()) {
        this.snackBar.open(this.receiptPaymentsUnavailableReason(), '', { duration: 3000 });
        return;
      }
      this.prepareFiscalReceiptShift('card', 'fiscal', () => {
        this.orderProcessing.set(true);
        this.orderProcessingMethod.set('card');
        this.startTerminalPayment(this.state.finalAmount());
      });
    }
  }

  onPaySbp(): void {
    if (!this.ensureWorkdayPaymentsAvailable()) return;
    if (this.data.mode === 'order') {
      this.payOrderSbp();
    } else if (this.data.mode === 'pos') {
      this.payPosSbp();
    } else {
      this.payChatSbp();
    }
  }

  onSubscriptionOfferSent(event: { planName: string }): void {
    this.showSubscriptionPicker.set(false);
    this.snackBar.open(`Предложение подписки «${event.planName}» отправлено клиенту`, '', { duration: 3000 });
  }

  onPaySubscription(): void {
    if (!this.ensureWorkdayPaymentsAvailable()) return;
    if (!this.subscriptionInfo()) {
      if (this.data.mode === 'pos') {
        this.snackBar.open('Нет активной подписки для клиента', '', { duration: 3000 });
        return;
      }
      this.showSubscriptionPicker.set(true);
      return;
    }
    if (this.data.mode === 'order') {
      this.payOrderSubscription();
    } else {
      this.payChatSubscription();
    }
  }

  private ensureWorkdayPaymentsAvailable(): boolean {
    if (this.workdayPaymentsAvailable()) return true;
    this.snackBar.open(this.workdayPaymentsUnavailableReason(), '', { duration: 3000 });
    return false;
  }

  private refreshCurrentFiscalShift(): void {
    this.loadCurrentReceiptShift();
  }

  private loadCurrentReceiptShift(onLoaded?: (shift: PosShift | null) => void): void {
    if (this.data.mode === 'order' || this.fiscalShiftLoading()) return;

    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) {
      onLoaded?.(this.currentReceiptShift());
      return;
    }

    this.fiscalShiftLoading.set(true);
    this.posApi.getCurrentShift(employeeId).subscribe({
      next: (shift) => {
        this.setCurrentReceiptShift(shift, employeeId);
        this.fiscalShiftChecked.set(true);
        this.fiscalShiftLoading.set(false);
        onLoaded?.(shift);
      },
      error: () => {
        this.setCurrentReceiptShift(null, employeeId);
        this.fiscalShiftChecked.set(true);
        this.fiscalShiftLoading.set(false);
        onLoaded?.(null);
      },
    });
  }

  private setCurrentReceiptShift(shift: PosShift | null, employeeId = this.authService.currentUser()?.id): void {
    this.currentReceiptShift.set(shift);
    if (!shift || !employeeId) return;
    this.posService.shiftId.set(shift.id);
    this.posService.studioId.set(shift.studio_id);
    this.posService.employeeId.set(employeeId);
  }

  private prepareFiscalReceiptShift(
    method: FiscalReceiptPaymentMethod,
    fiscalMode: CashFiscalMode,
    continueAfterOpen: () => void,
  ): void {
    if (!this.receiptPaymentsAvailable()) {
      this.snackBar.open(this.receiptPaymentsUnavailableReason(), '', { duration: 3000 });
      return;
    }

    if (this.fiscalShiftLoading()) {
      this.snackBar.open('Проверяем смену ФР, повторите через секунду', '', { duration: 2500 });
      return;
    }

    const continueOrPrompt = () => {
      const preparation = receiptFiscalShiftPreparation(
        method,
        fiscalMode,
        this.receiptShiftRef(),
        !!this.receiptStudioId(),
      );

      if (preparation.status === 'ready') {
        continueAfterOpen();
        return;
      }

      if (preparation.status === 'unavailable') {
        const message = method === 'cash'
          ? 'Нет активной точки для открытия смены ФР'
          : 'Нет активной точки для карты или СБП с фискализацией';
        this.snackBar.open(message, '', { duration: 4000 });
        return;
      }

      this.pendingFiscalShiftPayment = { method, continueAfterOpen };
      this.fiscalShiftPrompt.set(this.buildFiscalShiftPrompt(method, preparation.status));
      this.fiscalShiftOpenStatus.set('idle');
      this.fiscalShiftOpenError.set(null);
    };

    if (!this.fiscalShiftChecked()) {
      this.loadCurrentReceiptShift(() => continueOrPrompt());
      return;
    }

    continueOrPrompt();
  }

  private buildFiscalShiftPrompt(
    method: FiscalReceiptPaymentMethod,
    preparationStatus: FiscalShiftPreparationPromptStatus,
  ): FiscalShiftPromptState {
    const methodName = method === 'cash' ? 'наличные' : method === 'card' ? 'оплату картой' : 'оплату СБП';
    if (preparationStatus === 'open-existing-shift') {
      return {
        method,
        preparationStatus,
        title: 'Открыть смену ФР',
        message: `Текущая POS-смена открыта без фискального регистратора. Откроем ФР на АТОЛ27Ф и продолжим ${methodName} только после подтверждения.`,
        primaryLabel: 'Открыть ФР',
      };
    }

    return {
      method,
      preparationStatus,
      title: 'Открыть POS-смену и ФР',
      message: `Сначала откроем POS-смену с остатком наличных 0 ₽ и смену ФР на АТОЛ27Ф. После подтверждения продолжим ${methodName}.`,
      primaryLabel: 'Открыть POS + ФР',
    };
  }

  onFiscalShiftPromptCancel(): void {
    if (this.fiscalShiftOpenStatus() === 'opening' || this.fiscalShiftOpenStatus() === 'waiting') return;
    this.clearFiscalShiftPrompt();
  }

  onFiscalShiftPromptConfirm(): void {
    const prompt = this.fiscalShiftPrompt();
    const pending = this.pendingFiscalShiftPayment;
    if (!prompt || !pending) return;
    if (this.fiscalShiftOpenStatus() === 'opening' || this.fiscalShiftOpenStatus() === 'waiting') return;

    this.fiscalShiftOpenStatus.set('opening');
    this.fiscalShiftOpenError.set(null);

    if (prompt.preparationStatus === 'open-existing-shift') {
      const shiftId = this.currentReceiptShift()?.id ?? this.posService.shiftId();
      if (!shiftId) {
        this.failFiscalShiftOpen('Не найдена текущая POS-смена для открытия ФР');
        return;
      }

      this.posApi.openShiftFiscalWithCommand(shiftId).subscribe({
        next: (response) => {
          this.handleFiscalShiftOpenResponse(
            response.shift,
            response.fiscalTransactionId ?? null,
            !response.fiscalCommandEnqueued,
          );
        },
        error: (error: unknown) => {
          this.failFiscalShiftOpen(employeeApiErrorMessage(error, 'Не удалось открыть смену ФР'));
        },
      });
      return;
    }

    const employeeId = this.authService.currentUser()?.id;
    const studioId = this.receiptStudioId();
    if (!employeeId || !studioId) {
      this.failFiscalShiftOpen('Нет активной точки для открытия POS-смены и ФР');
      return;
    }

    this.posApi.openShiftWithFiscalCommand({
      employee_id: employeeId,
      studio_id: studioId,
      cash_at_open: 0,
      fiscal_enabled: true,
    }).subscribe({
      next: (response) => {
        this.handleFiscalShiftOpenResponse(response.shift, response.fiscalTransactionId ?? null, false);
      },
      error: (error: unknown) => {
        this.failFiscalShiftOpen(employeeApiErrorMessage(error, 'Не удалось открыть POS-смену и ФР'));
      },
    });
  }

  private handleFiscalShiftOpenResponse(
    shift: PosShift,
    fiscalTransactionId: string | null,
    alreadyReady: boolean,
  ): void {
    this.pendingFiscalShift = null;
    this.setCurrentReceiptShift(alreadyReady ? shift : { ...shift, fiscal_enabled: false });
    this.fiscalShiftChecked.set(true);

    if (alreadyReady) {
      this.finishFiscalShiftOpenAndContinue();
      return;
    }

    if (!fiscalTransactionId) {
      this.failFiscalShiftOpen('Команда открытия ФР не создана. Оплату не продолжаем без подтверждения АТОЛ.');
      return;
    }

    this.pendingFiscalShift = { ...shift, fiscal_enabled: true };
    this.fiscalShiftOpenStatus.set('waiting');
    this.waitForFiscalShiftTransaction(fiscalTransactionId);
  }

  private waitForFiscalShiftTransaction(transactionId: string): void {
    this.clearFiscalShiftPolling();
    this.fiscalShiftWaitingTransactionId = transactionId;
    this.fiscalShiftWaitStartedAt = Date.now();
    this.scheduleFiscalShiftPoll(800);
  }

  private scheduleFiscalShiftPoll(delayMs = 1200): void {
    if (this.fiscalShiftPollTimeoutId) clearTimeout(this.fiscalShiftPollTimeoutId);
    this.fiscalShiftPollTimeoutId = setTimeout(() => this.pollFiscalShiftTransaction(), delayMs);
  }

  private pollFiscalShiftTransaction(): void {
    const transactionId = this.fiscalShiftWaitingTransactionId;
    if (!transactionId) return;

    this.posApi.getBridgeTransaction(transactionId).subscribe({
      next: (transaction) => {
        if (this.fiscalShiftWaitingTransactionId !== transactionId) return;

        if (transaction.status === 'completed') {
          this.finishFiscalShiftOpenAndContinue();
          return;
        }

        if (transaction.status === 'failed' || transaction.status === 'cancelled' || transaction.status === 'timeout') {
          this.failFiscalShiftOpen(transaction.error_message || 'АТОЛ27Ф не открыл смену ФР');
          return;
        }

        if (Date.now() - this.fiscalShiftWaitStartedAt > 60_000) {
          this.failFiscalShiftOpen('АТОЛ27Ф не подтвердил открытие смены ФР за 60 секунд');
          return;
        }

        this.scheduleFiscalShiftPoll();
      },
      error: () => {
        if (Date.now() - this.fiscalShiftWaitStartedAt > 60_000) {
          this.failFiscalShiftOpen('Не удалось получить подтверждение открытия смены ФР от АТОЛ27Ф');
          return;
        }
        this.scheduleFiscalShiftPoll();
      },
    });
  }

  private finishFiscalShiftOpenAndContinue(): void {
    const confirmedShift = this.pendingFiscalShift ?? this.currentReceiptShift();
    if (confirmedShift) {
      this.setCurrentReceiptShift({ ...confirmedShift, fiscal_enabled: true });
    }
    const pending = this.pendingFiscalShiftPayment;
    this.clearFiscalShiftPrompt();
    if (!pending) return;
    pending.continueAfterOpen();
  }

  private failFiscalShiftOpen(message: string): void {
    this.clearFiscalShiftPolling();
    this.fiscalShiftOpenStatus.set('error');
    this.fiscalShiftOpenError.set(message);
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
  }

  private clearFiscalShiftPrompt(): void {
    this.clearFiscalShiftPolling();
    this.fiscalShiftPrompt.set(null);
    this.fiscalShiftOpenStatus.set('idle');
    this.fiscalShiftOpenError.set(null);
    this.pendingFiscalShiftPayment = null;
    this.pendingFiscalShift = null;
  }

  private clearFiscalShiftPolling(): void {
    if (this.fiscalShiftPollTimeoutId) {
      clearTimeout(this.fiscalShiftPollTimeoutId);
      this.fiscalShiftPollTimeoutId = null;
    }
    this.fiscalShiftWaitingTransactionId = null;
    this.fiscalShiftWaitStartedAt = 0;
  }

  private receiptShiftRef(): ReceiptFiscalShiftRef | null {
    const shift = this.currentReceiptShift();
    if (shift) {
      return { id: shift.id, fiscal_enabled: shift.fiscal_enabled };
    }

    if (this.fiscalShiftChecked()) return null;

    const shiftId = this.posService.shiftId();
    return shiftId ? { id: shiftId, fiscal_enabled: false } : null;
  }

  private canCreateReceiptWithShift(
    method: ReceiptPaymentMethod,
    fiscalMode: CashFiscalMode,
    receiptShiftId: string | undefined,
  ): boolean {
    const requiresFiscalShift = method === 'card'
      || method === 'sbp'
      || (method === 'cash' && fiscalMode === 'fiscal');
    if (!requiresFiscalShift || receiptShiftId) return true;

    const message = method === 'cash'
      ? 'Откройте смену ФР, чтобы принять наличные с фискализацией'
      : 'Не удалось создать чек без смены ФР: карта и СБП всегда с фискализацией';
    this.snackBar.open(message, '', { duration: 4000 });
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
    return false;
  }

  private receiptRequiresFiscal(method: ReceiptPaymentMethod, fiscalMode: CashFiscalMode): boolean {
    return method === 'card'
      || method === 'sbp'
      || (method === 'cash' && fiscalMode === 'fiscal');
  }

  private async payChatSbp(): Promise<void> {
    const amount = this.state.finalAmount();
    if (this.state.amountBeforeLoyalty() < 1) return;
    if (!this.ensureNoLoyaltyForNonReceiptPayment()) return;

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('sbp');

    const cartItems = this.buildCartItems();
    const orderId = await this.createOrderForSbp(cartItems, amount);
    if (!orderId) {
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);
      return;
    }

    const result = await this.cloudPayments.paySbp(
      orderId,
      cartItems,
      undefined,
      this.effectiveCustomerPhone() || undefined,
    );

    if (result.success) {
      this.trackRecentServices();
      this.snackBar.open('Оплата СБП принята', '', { duration: 2500 });
      this.dialogRef.close({
        type: 'sbp',
        transactionId: result.transactionId?.toString(),
      } satisfies PaymentDialogResult);
    } else {
      this.snackBar.open(result.error || 'СБП не завершён', '', { duration: 3000 });
    }

    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
  }

  private async payPosSbp(): Promise<void> {
    if (this.state.amountBeforeLoyalty() < 1) return;

    if (!this.receiptPaymentsAvailable()) {
      this.snackBar.open(this.receiptPaymentsUnavailableReason(), '', { duration: 3000 });
      return;
    }
    if (!this.authService.currentUser()?.id) return;

    this.prepareFiscalReceiptShift('sbp', 'fiscal', () => {
      void this.startPosSbpPayment();
    });
  }

  private async startPosSbpPayment(): Promise<void> {
    if (this.state.amountBeforeLoyalty() < 1) return;

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('sbp');

    try {
      const result = await this.cloudPayments.paySbp(
        `POS-SVC-${Date.now()}`,
        this.buildCartItems(),
        undefined,
        this.effectiveCustomerPhone() || undefined,
      );

      if (result.success) {
        this.payReceiptDirect('sbp', result.transactionId?.toString());
      } else {
        this.snackBar.open(result.error || 'СБП не завершён', '', { duration: 3000 });
        this.orderProcessing.set(false);
        this.orderProcessingMethod.set(null);
      }
    } catch {
      this.snackBar.open('СБП не завершён', '', { duration: 3000 });
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);
    }
  }

  private async sendChatTransferInstructions(): Promise<void> {
    const amount = this.state.finalAmount();
    if (this.state.amountBeforeLoyalty() < 1) return;

    const sessionId = this.data.sessionId;
    if (!sessionId) {
      this.snackBar.open('Нет активного чата для отправки реквизитов', '', { duration: 3000 });
      return;
    }

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set('transfer');

    try {
      const res = await firstValueFrom(this.http.post<{ success: boolean }>(
        `/api/visitor-chat/admin/sessions/${encodeURIComponent(sessionId)}/reply`,
        { content: this.buildTransferInstructions(amount) },
      ));

      if (!res.success) {
        this.snackBar.open('Не удалось отправить реквизиты', '', { duration: 3000 });
        this.orderProcessing.set(false);
        this.orderProcessingMethod.set(null);
        return;
      }

      this.trackRecentServices();
      this.snackBar.open('Реквизиты для перевода отправлены в чат', '', { duration: 2500 });
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);

      const transferReceived = await this.confirmTransferReceived(amount);
      if (transferReceived) {
        this.payReceiptDirect('transfer');
        return;
      }

      this.dialogRef.close({ type: 'transferInstructions', amount } satisfies PaymentDialogResult);
    } catch (err: unknown) {
      this.snackBar.open(employeeApiErrorMessage(err, 'Не удалось отправить реквизиты'), '', { duration: 4000 });
      this.orderProcessing.set(false);
      this.orderProcessingMethod.set(null);
    }
  }

  private async confirmTransferReceived(amount: number): Promise<boolean> {
    const data: ConfirmDialogData = {
      title: 'Перевод получен?',
      message: `Подтвердите, что перевод на ${amount.toLocaleString('ru-RU')}₽ поступил. Чек будет создан без фискализации.`,
      confirmLabel: 'Перевод получен',
      cancelLabel: 'Нет',
      icon: 'account_balance',
    };

    const confirmed = await firstValueFrom(
      this.dialog.open<ConfirmDialogComponent, ConfirmDialogData, boolean>(ConfirmDialogComponent, {
        width: '420px',
        maxWidth: 'calc(100vw - 24px)',
        data,
      }).afterClosed(),
    );

    return confirmed === true;
  }

  private buildTransferInstructions(amount: number): string {
    const cartDetails = this.state.buildCartDetails();
    const itemLines = cartDetails.lines.length
      ? cartDetails.lines.map(line => this.formatTransferLine(line)).join('\n')
      : `- ${this.state.description() || `Оплата ${amount}₽`} — ${amount}₽`;

    return [
      `К оплате переводом: ${amount}₽`,
      '',
      itemLines,
      '',
      `Телефон: ${TRANSFER_PAYMENT_PHONE}`,
      `Банк: ${TRANSFER_PAYMENT_BANK}`,
      `Получатель: ${TRANSFER_PAYMENT_RECIPIENT}`,
      '',
      'Пожалуйста, пришлите чек оплаты в этот чат.',
    ].join('\n');
  }

  private formatTransferLine(line: { readonly name: string; readonly quantity: number; readonly total: number }): string {
    const quantity = line.quantity > 1 ? ` x${line.quantity}` : '';
    return `- ${line.name}${quantity} — ${line.total}₽`;
  }

  private recordOrderCardPaymentWithReceipt(transactionId?: string): void {
    const orderId = this.data.orderId;
    if (!orderId) {
      this.resetOrderProcessingState();
      return;
    }

    this.createOrderCardReceipt(transactionId, (receipt) => {
      this.waitForCardReceiptFiscalization({
        mode: 'order',
        receipt,
        transactionId,
        fiscalMode: 'fiscal',
        runId: this.cardPaymentRunId,
      });
    });
  }

  private finalizeOrderCardPaymentWithReceipt(receipt: PosReceipt, transactionId?: string): void {
    const orderId = this.data.orderId;
    if (!orderId) {
      this.resetOrderProcessingState();
      return;
    }

    this.ordersApi.recordPayment(orderId, {
      payment_method: 'card',
      pos_receipt_id: receipt.id,
      ...(transactionId ? { transaction_id: transactionId } : {}),
    }).subscribe({
      next: () => {
        this.trackRecentServices();
        this.snackBar.open(`Оплата картой принята, чек фискализирован: ${receipt.receipt_number}`, '', { duration: 3000 });
        this.resetOrderProcessingState();
        this.dialogRef.close({
          type: 'card',
          transactionId,
          receiptNumber: receipt.receipt_number,
          amount: receipt.total,
        } satisfies PaymentDialogResult);
      },
      error: (err: unknown) => {
        this.snackBar.open(
          employeeApiErrorMessage(err, 'Чек фискализирован, но заказ не отмечен оплаченным. Не принимайте карту повторно.'),
          '',
          { duration: 8000 },
        );
        this.resetOrderProcessingState();
      },
    });
  }

  private createOrderCardReceipt(transactionId: string | undefined, onReceiptCreated: (receipt: PosReceipt) => void): void {
    const amount = this.state.finalAmount();
    const amountBeforeLoyalty = this.state.amountBeforeLoyalty();
    if (amountBeforeLoyalty < 1) {
      this.failApprovedCardReceiptCreation('POS-чек не создан: сумма меньше 1 ₽');
      return;
    }

    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) {
      this.failApprovedCardReceiptCreation('Не найден сотрудник для создания чека');
      return;
    }

    if (!this.receiptPaymentsAvailable()) {
      this.failApprovedCardReceiptCreation(this.receiptPaymentsUnavailableReason());
      return;
    }

    const studioId = this.receiptStudioId();
    if (!studioId) {
      this.failApprovedCardReceiptCreation('Нет активной точки для создания чека');
      return;
    }

    const receiptShiftId = receiptFiscalShiftId('card', 'fiscal', this.receiptShiftRef());
    if (!this.canCreateReceiptWithShift('card', 'fiscal', receiptShiftId)) {
      this.failApprovedCardReceiptCreation('Нет открытой фискальной смены для создания чека');
      return;
    }

    const items = this.state.selectedItems();
    const hasExternalCart = !!this.state.cartPrefillDetails();
    const loyaltyReceiptFields = this.loyaltyReceiptFields();
    const payments: PosReceiptPayment[] = [{
      payment_type: 'card',
      amount,
      ...(transactionId ? { transaction_id: transactionId } : {}),
    }];
    const handleReceiptError = (err: unknown): void => {
      this.failApprovedCardReceiptCreation(
        employeeApiErrorMessage(err, 'POS-чек не создан'),
      );
    };

    const createExplicitReceipt = (details: PaymentCartDetails): void => {
      this.posApi.createReceipt({
        shift_id: receiptShiftId,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        customer_name: this.data.clientName || undefined,
        items: buildReceiptItemsFromCartDetails(details),
        payments,
        subtotal: amountBeforeLoyalty,
        ...loyaltyReceiptFields,
        total: amount,
        print_order_id: this.data.printOrderId,
        fiscal_required: true,
      }).subscribe({
        next: onReceiptCreated,
        error: handleReceiptError,
      });
    };

    if (hasExternalCart) {
      createExplicitReceipt(this.state.buildCartDetails());
    } else if (items.length > 0) {
      const selectedOptions = this.state.buildSelectedOptions();
      const categorySlug = singlePricingCategorySlug(items);

      if (!categorySlug) {
        createExplicitReceipt(this.state.buildCartDetails());
        return;
      }

      this.posApi.createFromPricing({
        category_slug: categorySlug,
        selected_options: selectedOptions,
        delivery_method: 'pickup',
        shift_id: receiptShiftId,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        client_user_id: this.data.clientUserId,
        client_contact_id: this.data.clientContactId,
        customer_name: this.data.clientName || undefined,
        ...this.loyaltyPricingFields(),
        payments,
        manual_amount: this.state.manualAmount() || undefined,
        manual_description: this.state.description() || undefined,
        apply_volume_discount: this.state.volumeDiscountRequested() || undefined,
        print_order_id: this.data.printOrderId,
        fiscal_required: true,
        retouch_config: this.data.retouchConfig,
      }).subscribe({
        next: onReceiptCreated,
        error: handleReceiptError,
      });
    } else {
      this.posApi.createReceipt({
        shift_id: receiptShiftId,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        customer_name: this.data.clientName || undefined,
        items: [{
          product_id: null,
          product_name: this.state.description() || `Заказ ${this.data.orderId ?? amountBeforeLoyalty}`,
          quantity: 1,
          unit_price: amountBeforeLoyalty,
          discount_amount: 0,
          discount_percent: 0,
          points_used: 0,
          subscription_credits_used: 0,
          total: amountBeforeLoyalty,
        }],
        payments,
        subtotal: amountBeforeLoyalty,
        ...loyaltyReceiptFields,
        total: amount,
        print_order_id: this.data.printOrderId,
        fiscal_required: true,
      }).subscribe({
        next: onReceiptCreated,
        error: handleReceiptError,
      });
    }
  }

  private resetOrderProcessingState(): void {
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
  }

  private payReceiptDirect(
    method: ReceiptPaymentMethod,
    transactionId?: string,
    options: ReceiptPaymentOptions = {},
  ): void {
    const amount = this.state.finalAmount();
    const amountBeforeLoyalty = this.state.amountBeforeLoyalty();
    if (amountBeforeLoyalty < 1) {
      this.handleReceiptCreationError(method, 'POS-чек не создан: сумма меньше 1 ₽');
      return;
    }

    const employeeId = this.authService.currentUser()?.id;
    if (!employeeId) {
      this.handleReceiptCreationError(method, 'Не найден сотрудник для создания чека');
      return;
    }

    if (!this.receiptPaymentsAvailable()) {
      this.handleReceiptCreationError(method, this.receiptPaymentsUnavailableReason());
      return;
    }

    const studioId = this.receiptStudioId();
    if (!studioId) {
      this.handleReceiptCreationError(method, 'Нет активной точки для создания чека');
      return;
    }

    const fiscalMode = method === 'cash' ? options.fiscalMode ?? 'fiscal' : 'fiscal';
    const receiptShiftId = receiptFiscalShiftId(
      method,
      fiscalMode,
      this.receiptShiftRef(),
    );
    if (!this.canCreateReceiptWithShift(method, fiscalMode, receiptShiftId)) {
      this.handleReceiptCreationError(method, 'Нет открытой фискальной смены для создания чека');
      return;
    }

    this.orderProcessing.set(true);
    this.orderProcessingMethod.set(method);
    const items = this.state.selectedItems();
    const hasExternalCart = !!this.state.cartPrefillDetails();
    const loyaltyReceiptFields = this.loyaltyReceiptFields();
    const payments: PosReceiptPayment[] = [{
      payment_type: method,
      amount,
      ...(transactionId ? { transaction_id: transactionId } : {}),
    }];
    const fiscalRequired = this.receiptRequiresFiscal(method, fiscalMode);

    const createExplicitReceipt = (details: PaymentCartDetails): void => {
      this.posApi.createReceipt({
        shift_id: receiptShiftId,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        customer_name: this.data.clientName || undefined,
        items: buildReceiptItemsFromCartDetails(details),
        payments,
        subtotal: amountBeforeLoyalty,
        ...loyaltyReceiptFields,
        total: amount,
        print_order_id: this.data.printOrderId,
        fiscal_required: fiscalRequired,
      }).subscribe({
        next: (receipt) => {
          this.handleReceiptCreatedForPayment(method, receipt, transactionId, fiscalMode, fiscalRequired);
        },
        error: (err: unknown) => {
          this.handleReceiptCreationError(method, employeeApiErrorMessage(err, 'Ошибка при создании чека'));
        },
      });
    };

    if (hasExternalCart) {
      createExplicitReceipt(this.state.buildCartDetails());
    } else if (items.length > 0) {
      const selectedOptions = this.state.buildSelectedOptions();
      const categorySlug = singlePricingCategorySlug(items);

      if (!categorySlug) {
        createExplicitReceipt(this.state.buildCartDetails());
        return;
      }

      this.posApi.createFromPricing({
        category_slug: categorySlug,
        selected_options: selectedOptions,
        delivery_method: 'pickup',
        shift_id: receiptShiftId,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        client_user_id: this.data.clientUserId,
        client_contact_id: this.data.clientContactId,
        customer_name: this.data.clientName || undefined,
        ...this.loyaltyPricingFields(),
        payments,
        manual_amount: this.state.manualAmount() || undefined,
        manual_description: this.state.description() || undefined,
        apply_volume_discount: this.state.volumeDiscountRequested() || undefined,
        print_order_id: this.data.printOrderId,
        fiscal_required: fiscalRequired,
        retouch_config: this.data.retouchConfig,
      }).subscribe({
        next: (receipt) => {
          this.handleReceiptCreatedForPayment(method, receipt, transactionId, fiscalMode, fiscalRequired);
        },
        error: (err) => {
          this.handleReceiptCreationError(method, employeeApiErrorMessage(err, 'Ошибка при создании чека'));
        },
      });
    } else {
      this.posApi.createReceipt({
        shift_id: receiptShiftId,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        customer_name: this.data.clientName || undefined,
        items: [{
          product_id: null,
          product_name: this.state.description() || `Оплата ${amountBeforeLoyalty}₽`,
          quantity: 1,
          unit_price: amountBeforeLoyalty,
          discount_amount: 0,
          discount_percent: 0,
          points_used: 0,
          subscription_credits_used: 0,
          total: amountBeforeLoyalty,
        }],
        payments,
        subtotal: amountBeforeLoyalty,
        ...loyaltyReceiptFields,
        total: amount,
        print_order_id: this.data.printOrderId,
        fiscal_required: fiscalRequired,
      }).subscribe({
        next: (receipt) => {
          this.handleReceiptCreatedForPayment(method, receipt, transactionId, fiscalMode, fiscalRequired);
        },
        error: (err: unknown) => {
          this.handleReceiptCreationError(method, employeeApiErrorMessage(err, 'Ошибка при создании чека'));
        },
      });
    }
  }

  private handleReceiptCreatedForPayment(
    method: ReceiptPaymentMethod,
    receipt: PosReceipt,
    transactionId: string | undefined,
    fiscalMode: CashFiscalMode,
    fiscalRequired: boolean,
  ): void {
    if (method === 'card' && fiscalRequired && this.cardBankApproved()) {
      this.waitForCardReceiptFiscalization({
        mode: 'receipt',
        receipt,
        transactionId,
        fiscalMode,
        runId: this.cardPaymentRunId,
      });
      return;
    }

    this.completeReceiptPayment(method, receipt, transactionId, fiscalMode);
  }

  private handleReceiptCreationError(method: ReceiptPaymentMethod, message: string): void {
    if (method === 'card' && this.cardBankApproved()) {
      this.failApprovedCardReceiptCreation(message);
      return;
    }

    this.snackBar.open(message, '', { duration: 3000 });
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
  }

  private completeReceiptPayment(
    method: ReceiptPaymentMethod,
    receipt: PosReceipt,
    transactionId?: string,
    fiscalMode?: CashFiscalMode,
  ): void {
    this.notifyManualChatPayment(method, receipt, fiscalMode).subscribe({
      next: (notified) => {
        this.trackRecentServices();
        const suffix = notified ? '' : ', но сообщение в чат не отправлено';
        this.snackBar.open(`Чек создан: ${receipt.receipt_number}${suffix}`, '', { duration: 3000 });
        this.dialogRef.close(this.buildReceiptPaymentResult(method, receipt, transactionId));
        this.orderProcessing.set(false);
        this.orderProcessingMethod.set(null);
      },
    });
  }

  private notifyManualChatPayment(
    method: ReceiptPaymentMethod,
    receipt: PosReceipt,
    fiscalMode?: CashFiscalMode,
  ): Observable<boolean> {
    if (this.data.mode !== 'chat' || !this.data.sessionId) {
      return of(true);
    }

    const cartDetails = this.state.buildCartDetails();
    const customerPhone = this.effectiveCustomerPhone();
    const body: ManualChatPaymentRequest = {
      sessionId: this.data.sessionId,
      amount: receipt.total,
      method,
      ...(method === 'cash' && fiscalMode ? { fiscalMode } : {}),
      receiptId: receipt.id,
      receiptNumber: receipt.receipt_number,
      ...(customerPhone ? { phone: customerPhone } : {}),
      ...(this.data.clientName ? { clientName: this.data.clientName } : {}),
      ...(cartDetails.lines.length > 0 ? { cartDetails } : {}),
    };

    return this.http.post<{ success: boolean }>('/api/payments/manual-chat-payment', body).pipe(
      map(response => response.success === true),
      catchError(() => of(false)),
    );
  }

  private buildReceiptPaymentResult(
    method: ReceiptPaymentMethod,
    receipt: PosReceipt,
    transactionId?: string,
  ): PaymentDialogResult {
    const common = {
      receiptNumber: receipt.receipt_number,
      amount: receipt.total,
    };

    switch (method) {
      case 'cash':
        return { type: 'cash', ...common };
      case 'transfer':
        return { type: 'transfer', ...common };
      case 'card':
        return { type: 'card', transactionId, ...common };
      case 'sbp':
        return { type: 'sbp', transactionId, ...common };
    }
    const exhaustive: never = method;
    return exhaustive;
  }

  // ── SBP helpers ──

  private buildCartItems(): CartItem[] {
    const cartDetails = this.state.buildCartDetails();
    if (this.state.cartPrefillDetails() && cartDetails.lines.length > 0) {
      return cartDetails.lines.map((line, index) => {
        const quantity = Math.max(1, Math.trunc(line.quantity));
        const priceParts = this.cartLinePriceParts(line.total, quantity, line.unitPrice);
        return {
          service: {
            id: `cart-item-${index}`,
            name: line.name,
            description: line.priceNote ?? '',
            price: priceParts.price,
            ...(priceParts.nextPrice !== null ? { nextPrice: priceParts.nextPrice } : {}),
            icon: '',
          },
          quantity,
        };
      });
    }

    const items = this.state.selectedItems();
    if (items.length > 0) {
      return items.map(i => ({
        service: {
          id: i.service.id,
          name: i.service.name,
          description: i.service.description,
          price: i.service.price,
          icon: i.service.icon,
        },
        quantity: i.quantity,
      }));
    }

    const amount = this.state.finalAmount();
    return [{
      service: {
        id: 'manual',
        name: this.state.description() || `Оплата ${amount}\u20BD`,
        description: '',
        price: amount,
        icon: '',
      },
      quantity: 1,
    }];
  }

  private async createOrderForSbp(cartItems: CartItem[], total: number): Promise<string | null> {
    try {
      const orderItems = cartItems.map(i => ({
        service: i.service.name,
        price: i.service.price,
        quantity: i.quantity,
        subtotal: i.service.price * i.quantity,
      }));

      const res = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: orderItems,
          total,
          phone: this.effectiveCustomerPhone() || undefined,
          clientUserId: this.data.clientUserId,
          clientContactId: this.data.clientContactId,
          chatSessionId: this.data.sessionId,
        }),
      });
      const data = await res.json();

      if (!data.success || !data.orderId) {
        this.snackBar.open(data.error || 'Не удалось создать заказ', '', { duration: 3000 });
        return null;
      }

      return data.orderId;
    } catch {
      this.snackBar.open('Ошибка создания заказа', '', { duration: 3000 });
      return null;
    }
  }

  private cartLinePriceParts(
    total: number,
    quantity: number,
    fallbackUnitPrice: number,
  ): { price: number; nextPrice: number | null } {
    const roundedTotal = this.roundPaymentAmount(total);
    if (quantity <= 1) return { price: roundedTotal, nextPrice: null };

    const roundedFallbackUnit = this.roundPaymentAmount(fallbackUnitPrice);
    if (roundedFallbackUnit > 0 && this.roundPaymentAmount(roundedFallbackUnit * quantity) === roundedTotal) {
      return { price: roundedFallbackUnit, nextPrice: null };
    }

    const nextPrice = this.roundPaymentAmount(roundedTotal / quantity);
    const firstPrice = this.roundPaymentAmount(roundedTotal - nextPrice * (quantity - 1));
    if (firstPrice > 0 && firstPrice !== nextPrice) {
      return { price: firstPrice, nextPrice };
    }

    return { price: nextPrice, nextPrice: null };
  }

  private roundPaymentAmount(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  // ── Card terminal payment ──

  private startTerminalPayment(amount: number, orderId?: string): void {
    const studioId = this.receiptStudioId();
    if (!studioId) {
      this.cardPaymentStatus.set('error');
      this.snackBar.open('Нет активной точки для терминала', 'OK', { duration: 4000 });
      return;
    }

    const terminalOrderId = orderId?.trim() || `POS-${Date.now()}`;
    const runId = this.nextCardPaymentRun();

    this.cardPaymentActive.set(true);
    this.cardPaymentStatus.set('waiting');
    this.cardPaymentAmount.set(amount);
    this.cardPaymentError.set(null);
    this.cardBankApproved.set(false);
    this.cardTransactionId = null;
    this.pendingCardApprovedPayment = null;
    this.pendingCardFiscalPayment = null;

    setTimeout(() => {
      if (runId !== this.cardPaymentRunId) return;
      this.cardPaymentStatus.set('processing');

      this.posApi.bridgePay({ amount, orderId: terminalOrderId, studioId }).subscribe({
        next: (res: { success?: boolean; transactionId?: string }) => {
          if (runId !== this.cardPaymentRunId) return;
          if (res.success && res.transactionId) {
            this.cardTransactionId = res.transactionId;
            void this.waitForTerminalPaymentResult(res.transactionId, runId);
          } else {
            this.failTerminalPayment('Терминал не принял команду оплаты', runId);
          }
        },
        error: (error: unknown) => {
          this.failTerminalPayment(employeeApiErrorMessage(error, 'Ошибка связи с терминалом'), runId);
        },
      });
    }, 500);
  }

  onCardCancel(): void {
    if (this.cardBankApproved()) {
      this.snackBar.open(
        'Банк уже одобрил оплату. Сначала пробейте чек или проверьте отмену в Т-Бизнесе.',
        'OK',
        { duration: 7000 },
      );
      return;
    }

    this.cardPaymentRunId += 1;
    this.clearCardTimeout();
    this.cardPaymentActive.set(false);
    this.cardPaymentStatus.set('waiting');
    this.cardPaymentError.set(null);
    this.cardBankApproved.set(false);
    this.cardTransactionId = null;
    this.pendingCardApprovedPayment = null;
    this.pendingCardFiscalPayment = null;
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
  }

  onCardRetry(): void {
    this.clearCardTimeout();
    if (this.pendingCardFiscalPayment) {
      this.retryPendingCardFiscalization();
      return;
    }

    if (this.cardBankApproved()) {
      const pendingApprovedPayment = this.pendingCardApprovedPayment;
      if (pendingApprovedPayment) {
        this.cardPaymentStatus.set('fiscalizing');
        this.cardPaymentError.set(null);
        this.createApprovedCardReceipt(pendingApprovedPayment);
        return;
      }

      this.snackBar.open(
        'Банк уже одобрил оплату. Не запускайте оплату повторно; проверьте чек и операцию в Т-Бизнесе.',
        'OK',
        { duration: 7000 },
      );
      return;
    }

    this.startTerminalPayment(
      this.cardPaymentAmount(),
      this.data.orderId?.toString(),
    );
  }

  private onTerminalPaymentSuccess(): void {
    if (this.cardBankApproved() || this.cardPaymentStatus() === 'success') return;

    const transactionId = this.cardTransactionId ?? undefined;
    this.cardBankApproved.set(true);
    this.cardPaymentStatus.set('fiscalizing');
    this.cardPaymentError.set(null);
    this.clearCardTimeout();
    const pendingApprovedPayment: PendingCardApprovedPayment = {
      mode: this.data.mode === 'order' && this.data.orderId ? 'order' : 'receipt',
      transactionId,
    };
    this.pendingCardApprovedPayment = pendingApprovedPayment;
    this.createApprovedCardReceipt(pendingApprovedPayment);
  }

  private createApprovedCardReceipt(payment: PendingCardApprovedPayment): void {
    if (payment.mode === 'order') {
      this.recordOrderCardPaymentWithReceipt(payment.transactionId);
      return;
    }

    this.payReceiptDirect('card', payment.transactionId);
  }

  private waitForCardReceiptFiscalization(context: PendingCardFiscalPayment, useInitialStatus = true): void {
    this.pendingCardApprovedPayment = null;
    this.pendingCardFiscalPayment = context;
    this.cardPaymentActive.set(true);
    this.cardPaymentStatus.set('fiscalizing');
    this.cardPaymentError.set(null);

    void this.waitForPendingCardFiscalization(context, useInitialStatus);
  }

  private async waitForPendingCardFiscalization(
    context: PendingCardFiscalPayment,
    useInitialStatus: boolean,
  ): Promise<void> {
    try {
      await waitForReceiptFiscalization(this.posApi, context.receipt.id, {
        timeoutMs: DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS,
        initialStatus: useInitialStatus ? receiptFiscalInitialStatus(context.receipt) : null,
      });
      if (!this.isActiveCardPaymentRun(context.runId, context.transactionId)) return;
      this.completeCardFiscalizedPayment(context);
    } catch (error) {
      if (!this.isActiveCardPaymentRun(context.runId, context.transactionId)) return;
      this.failCardFiscalization(employeeApiErrorMessage(error, 'Чек не фискализирован'), context);
    }
  }

  private retryPendingCardFiscalization(): void {
    const context = this.pendingCardFiscalPayment;
    if (!context) return;

    this.cardPaymentStatus.set('fiscalizing');
    this.cardPaymentError.set(null);
    this.posApi.retryFiscal(context.receipt.id).subscribe({
      next: () => {
        this.waitForCardReceiptFiscalization(context, false);
      },
      error: (err: unknown) => {
        this.snackBar.open(
          employeeApiErrorMessage(err, 'Не удалось отправить повтор фискализации, проверяем статус чека'),
          'OK',
          { duration: 5000 },
        );
        this.waitForCardReceiptFiscalization(context, false);
      },
    });
  }

  private completeCardFiscalizedPayment(context: PendingCardFiscalPayment): void {
    this.pendingCardApprovedPayment = null;
    this.pendingCardFiscalPayment = null;
    this.cardBankApproved.set(false);
    this.cardPaymentStatus.set('success');
    this.cardPaymentError.set(null);

    setTimeout(() => {
      if (!this.cardPaymentActive()) return;
      this.cardPaymentActive.set(false);
      this.cardTransactionId = null;

      if (context.mode === 'order') {
        this.finalizeOrderCardPaymentWithReceipt(context.receipt, context.transactionId);
        return;
      }

      this.completeReceiptPayment('card', context.receipt, context.transactionId, context.fiscalMode);
    }, 700);
  }

  private failCardFiscalization(reason: string, context: PendingCardFiscalPayment): void {
    this.pendingCardFiscalPayment = context;
    const message = approvedCardFiscalRetryMessage(reason);
    this.cardPaymentActive.set(true);
    this.cardPaymentStatus.set('fiscal_error');
    this.cardPaymentError.set(message);
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
    this.snackBar.open(message, 'OK', { duration: 10000, panelClass: 'snackbar-error' });
  }

  private failApprovedCardReceiptCreation(reason: string): void {
    const pendingApprovedPayment: PendingCardApprovedPayment = this.pendingCardApprovedPayment ?? {
      mode: this.data.mode === 'order' && this.data.orderId ? 'order' : 'receipt',
      transactionId: this.cardTransactionId ?? undefined,
    };
    const message = cardFiscalProblemMessage(
      `${reason}. Не принимайте карту повторно; проверьте операцию в Т-Бизнесе или попробуйте создать чек ещё раз.`,
    );
    this.pendingCardApprovedPayment = pendingApprovedPayment;
    this.cardPaymentActive.set(true);
    this.cardPaymentStatus.set('error');
    this.cardPaymentError.set(message);
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
    this.snackBar.open(message, 'OK', { duration: 10000, panelClass: 'snackbar-error' });
  }

  private async waitForTerminalPaymentResult(transactionId: string, runId: number): Promise<void> {
    try {
      await waitForBridgeTransaction(this.posApi, transactionId, {
        timeoutMs: DEFAULT_BRIDGE_PAYMENT_TIMEOUT_MS,
      });
      if (!this.isActiveCardPaymentRun(runId, transactionId)) return;
      this.onTerminalPaymentSuccess();
    } catch (error) {
      this.failTerminalPayment(error instanceof Error ? error.message : 'Оплата на терминале не прошла', runId, transactionId);
    }
  }

  private failTerminalPayment(message: string, runId?: number, transactionId?: string): void {
    if (runId !== undefined && !this.isActiveCardPaymentRun(runId, transactionId)) return;
    if (this.cardBankApproved()) return;
    this.cardPaymentRunId += 1;
    this.clearCardTimeout();
    this.cardPaymentStatus.set('error');
    this.cardPaymentError.set(message);
    this.cardBankApproved.set(false);
    this.pendingCardApprovedPayment = null;
    this.pendingCardFiscalPayment = null;
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
    this.snackBar.open(message, 'OK', { duration: 5000 });
  }

  private isActiveCardPaymentRun(runId: number, transactionId?: string): boolean {
    return this.cardPaymentRunId === runId
      && this.cardPaymentActive()
      && (!transactionId || this.cardTransactionId === transactionId);
  }

  private nextCardPaymentRun(): number {
    this.cardPaymentRunId += 1;
    this.clearCardTimeout();
    return this.cardPaymentRunId;
  }

  private clearCardTimeout(): void {
    if (this.cardTimeoutId) {
      clearTimeout(this.cardTimeoutId);
      this.cardTimeoutId = null;
    }
  }

  // ── Helpers ──

  private loyaltyReceiptFields(): {
    loyalty_profile_id?: string;
    loyalty_points_to_use?: number;
    points_discount?: number;
  } {
    const profileId = this.loyaltyProfileId();
    const points = this.state.loyaltyPointsUsed();
    const discount = this.state.loyaltyDiscount();
    if (!profileId || points <= 0 || discount <= 0) return {};
    return {
      loyalty_profile_id: profileId,
      loyalty_points_to_use: points,
      points_discount: discount,
    };
  }

  private loyaltyPricingFields(): {
    loyalty_profile_id?: string;
    loyalty_points_to_use?: number;
  } {
    const profileId = this.loyaltyProfileId();
    const points = this.state.loyaltyPointsUsed();
    if (!profileId || points <= 0 || this.state.loyaltyDiscount() <= 0) return {};
    return {
      loyalty_profile_id: profileId,
      loyalty_points_to_use: points,
    };
  }

  private ensureNoLoyaltyForNonReceiptPayment(): boolean {
    if (this.state.loyaltyPointsUsed() <= 0) return true;
    this.snackBar.open('Бонусы можно списать только при оплате с созданием чека', '', { duration: 3500 });
    return false;
  }

  private trackRecentServices(): void {
    for (const item of this.state.selectedItems()) {
      this.recentServices.track(item.service, item.categoryName);
    }
  }

  private resetGenerating(): void {
    this.state.generating.set(false);
    this.orderProcessing.set(false);
    this.orderProcessingMethod.set(null);
  }

  private completeGeneratedPosReceipt(receipt: PosReceipt): void {
    this.notifyManualChatPayment('cash', receipt).subscribe({
      next: (notified) => {
        const suffix = notified ? '' : ', но сообщение в чат не отправлено';
        this.snackBar.open(`Чек создан: ${receipt.receipt_number}${suffix}`, '', { duration: 3000 });
        const result: PaymentDialogResult = {
          type: 'posReceipt',
          receiptNumber: receipt.receipt_number,
          amount: receipt.total,
        };
        this.dialogRef.close(result);
        this.state.generatingPos.set(false);
      },
    });
  }

  // ── POS receipt generation ──

  generatePosReceipt(): void {
    const amount = this.state.finalAmount();
    const amountBeforeLoyalty = this.state.amountBeforeLoyalty();
    if (amountBeforeLoyalty < 1) return;
    if (!this.ensureWorkdayPaymentsAvailable()) return;

    const shiftId = this.posService.shiftId();
    const studioId = this.receiptStudioId();
    const employeeId = this.authService.currentUser()?.id;

    if (!studioId || !employeeId) {
      this.snackBar.open('Нет активной точки для создания чека', '', { duration: 3000 });
      return;
    }

    this.state.generatingPos.set(true);

    const items = this.state.selectedItems();
    const hasExternalCart = !!this.state.cartPrefillDetails();
    const loyaltyReceiptFields = this.loyaltyReceiptFields();
    const payments: PosReceiptPayment[] = [{ payment_type: 'cash', amount }];

    const createExplicitPosReceipt = (details: PaymentCartDetails): void => {
      this.posApi.createReceipt({
        shift_id: shiftId ?? undefined,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        customer_name: this.data.clientName || undefined,
        items: buildReceiptItemsFromCartDetails(details),
        payments,
        subtotal: amountBeforeLoyalty,
        ...loyaltyReceiptFields,
        total: amount,
        print_order_id: this.data.printOrderId,
      }).subscribe({
        next: (receipt) => {
          this.completeGeneratedPosReceipt(receipt);
        },
        error: () => {
          this.snackBar.open('Ошибка при создании чека', '', { duration: 3000 });
          this.state.generatingPos.set(false);
        },
      });
    };

    if (hasExternalCart) {
      createExplicitPosReceipt(this.state.buildCartDetails());
    } else if (items.length > 0) {
      const selectedOptions = this.state.buildSelectedOptions();
      const categorySlug = singlePricingCategorySlug(items);

      if (!categorySlug) {
        createExplicitPosReceipt(this.state.buildCartDetails());
        return;
      }

      this.posApi.createFromPricing({
        category_slug: categorySlug,
        selected_options: selectedOptions,
        delivery_method: 'pickup',
        shift_id: shiftId ?? undefined,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        client_user_id: this.data.clientUserId,
        client_contact_id: this.data.clientContactId,
        customer_name: this.data.clientName || undefined,
        ...this.loyaltyPricingFields(),
        payments,
        apply_volume_discount: this.state.volumeDiscountRequested() || undefined,
        print_order_id: this.data.printOrderId,
        retouch_config: this.data.retouchConfig,
      }).subscribe({
        next: (receipt) => {
          this.completeGeneratedPosReceipt(receipt);
        },
        error: () => {
          this.snackBar.open('Ошибка при создании чека', '', { duration: 3000 });
          this.state.generatingPos.set(false);
        },
      });
    } else {
      this.posApi.createReceipt({
        shift_id: shiftId ?? undefined,
        employee_id: employeeId,
        studio_id: studioId,
        customer_phone: this.effectiveCustomerPhone() || undefined,
        customer_name: this.data.clientName || undefined,
        items: [{
          product_id: null,
          product_name: this.state.description() || `Оплата ${amountBeforeLoyalty}₽`,
          quantity: 1,
          unit_price: amountBeforeLoyalty,
          discount_amount: 0,
          discount_percent: 0,
          points_used: 0,
          subscription_credits_used: 0,
          total: amountBeforeLoyalty,
        }],
        payments,
        subtotal: amountBeforeLoyalty,
        ...loyaltyReceiptFields,
        total: amount,
        print_order_id: this.data.printOrderId,
      }).subscribe({
        next: (receipt) => {
          this.completeGeneratedPosReceipt(receipt);
        },
        error: () => {
          this.snackBar.open('Ошибка при создании чека', '', { duration: 3000 });
          this.state.generatingPos.set(false);
        },
      });
    }
  }
}
