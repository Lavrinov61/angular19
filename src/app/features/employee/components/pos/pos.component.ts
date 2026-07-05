import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit, effect, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser, DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { A11yModule } from '@angular/cdk/a11y';
import { Router } from '@angular/router';
import { EMPTY, firstValueFrom, of, Subject, timer } from 'rxjs';
import { catchError, debounceTime, finalize, switchMap, take, takeWhile } from 'rxjs/operators';
import { PosService } from '../../services/pos.service';
import {
  PosApiService,
  PosReceipt,
  PosReceiptPayment,
  ConsumablePreviewLine,
  EmployeeFavorite,
  PosShift,
  PosInDoubtPayment,
  PosOrphanPayment,
} from '../../services/pos-api.service';
import { PosShiftService } from '../../services/pos-shift.service';
import { StudioService } from '../../services/studio.service';
import { PosCustomerService } from '../../services/pos-customer.service';
import { CatalogApiService, Product, ProductCategory } from '../../services/catalog-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CloudPaymentsService } from '../../../../core/services/cloud-payments.service';
import type { CartItem } from '../../../chat-page/services/cart.service';
import {
  PricingApiService,
  type PricingCategory,
  type WaterfallItem,
  type WaterfallV2Response,
} from '../../../../core/services/pricing-api.service';
import { OfflineQueueService } from '../../../../core/services/offline-queue.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { OrderSelectedEvent } from '../../../../shared/components/pricing-configurator/pricing-configurator.component';
import { PaymentMethod, PosView, SubscriptionCoverage } from './models/pos.models';
import { channelIcon, channelLabel, channelColor } from '../../utils/crm-helpers';

import { PosShiftEarningsComponent } from './components/pos-shift-earnings.component';
import { PosShiftBarComponent } from './components/pos-shift-bar.component';
import { PosSearchBarComponent } from './components/pos-search-bar.component';
import { PosCategoryTabsComponent } from './components/pos-category-tabs.component';
import { PosProductGridComponent } from './components/pos-product-grid.component';
import { PosCartComponent } from './components/pos-cart.component';
import { PosCustomerLookupComponent } from './components/pos-customer-lookup.component';
import { PosTotalsComponent } from './components/pos-totals.component';
import { PosSubscriptionCoverageComponent } from './components/pos-subscription-coverage.component';
import { PosPaymentBarComponent, SplitPaymentEvent } from './components/pos-payment-bar.component';
import { PosStatusBarComponent } from './components/pos-status-bar.component';
import { PosProductionPromptComponent } from './components/pos-production-prompt.component';
import { printDialogConfig } from '../../utils/print-dialog-config';
import { PosPrintPromptComponent, PrintableItem } from './components/pos-print-prompt.component';
import { PosPromoInputComponent, PromoAppliedEvent } from './components/pos-promo-input.component';
import { PosLoyaltySpendComponent } from './components/pos-loyalty-spend.component';
import { CatalogTileGridComponent, CatalogCategory } from '../shared-pos/components/catalog-tile-grid.component';
import { ServiceCardComponent } from '../payment-dialog/components/service-card.component';
import type {
  PaymentDialogData,
  PaymentDialogResult,
  PaymentCartDetails,
  UiServiceOption,
} from '../payment-dialog/models/payment-dialog.models';
import type { CashFiscalMode } from '../payment-dialog/utils/cash-fiscal-mode';
import { PosSoundService } from '../../services/pos-sound.service';
import { PosSalesApiService } from '../../services/pos-sales-api.service';
import {
  DEFAULT_BRIDGE_PAYMENT_TIMEOUT_MS,
  IN_DOUBT_PAYMENT_MESSAGE,
  isInDoubtPaymentError,
  startAndWaitForBridgePayment,
  waitForBridgeTransaction,
} from '../../utils/pos-bridge-payment.util';
import {
  DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS,
  approvedCardFiscalRetryMessage,
  cardFiscalProblemMessage,
  receiptFiscalInitialStatus,
  waitForReceiptFiscalization,
} from '../../utils/pos-receipt-fiscalization.util';
import { employeeApiErrorMessage } from '../../utils/api-error-message';
import { PosFiscalSettingsDialogComponent } from './dialogs/pos-fiscal-settings-dialog.component';
import { PosFiscalShiftRequiredDialogComponent } from './dialogs/pos-fiscal-shift-required-dialog.component';
import { ConfirmDialogComponent, type ConfirmDialogData } from '../shared/confirm-dialog.component';
import {
  createdReceiptMessage,
  fiscalFailureEmployeeMessage,
  isFinalFiscalStatus,
  receiptPaymentsRequireFiscal as paymentsRequireFiscal,
} from './utils/pos-fiscal-feedback.util';

type PosReceiptCreateRequest = Parameters<PosApiService['createReceipt']>[0];
type PosReceiptRequestFactory = () => ReturnType<PosApiService['createReceipt']>;
type ReceiptChatPaymentMethod = 'cash' | 'card' | 'transfer' | 'sbp';

interface ApprovedCardPaymentContext {
  readonly transactionId: string;
  readonly studioId: string;
}

interface PosChatSearchResult {
  readonly id: string;
  readonly clientName: string;
  readonly clientPhone: string;
  readonly channel: string;
  readonly preview: string;
  readonly sortTime?: string;
}

interface ManualChatPaymentRequest {
  readonly sessionId: string;
  readonly amount: number;
  readonly method: ReceiptChatPaymentMethod;
  readonly fiscalMode?: CashFiscalMode;
  readonly receiptId: string;
  readonly receiptNumber: string;
  readonly phone?: string;
  readonly clientName?: string;
  readonly cartDetails?: PaymentCartDetails;
}

@Component({
  selector: 'app-pos',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule, MatBadgeModule,
    MatDividerModule, MatProgressSpinnerModule, MatSnackBarModule,
    MatProgressBarModule, MatCheckboxModule, MatDialogModule, A11yModule, DatePipe,
    PosShiftEarningsComponent, PosShiftBarComponent, PosSearchBarComponent, PosCategoryTabsComponent,
    PosProductGridComponent, PosCartComponent, PosCustomerLookupComponent,
    PosTotalsComponent, PosSubscriptionCoverageComponent, PosPaymentBarComponent,
    PosStatusBarComponent, PosProductionPromptComponent, PosPrintPromptComponent, PosPromoInputComponent,
    PosLoyaltySpendComponent, CatalogTileGridComponent, ServiceCardComponent,
  ],
  host: {
    '(document:keydown)': 'handleKeyDown($event)',
  },
  template: `
    <!-- ============ ОТКРЫТИЕ СМЕНЫ ============ -->
    @if (!shiftService.shift() && !shiftService.skipShift()) {
      <div class="shift-overlay">
        <mat-card appearance="outlined" class="shift-card">
          <mat-card-content>
            <div class="shift-card-header">
              <mat-icon class="shift-icon">point_of_sale</mat-icon>
              <h2>Открытие кассовой смены</h2>
            </div>

            @if (shiftService.shiftLoading()) {
              <div class="shift-loading">
                <mat-spinner diameter="40" />
                <span>Проверка смены...</span>
              </div>
            } @else {
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Студия</mat-label>
                <mat-select [(value)]="selectedStudioId">
                  @for (s of studioService.studios(); track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
                <mat-icon matPrefix>store</mat-icon>
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Наличные в кассе, \u20BD</mat-label>
                <input matInput [(ngModel)]="cashAtOpen" type="number" min="0" step="100" required>
                <mat-icon matPrefix>payments</mat-icon>
              </mat-form-field>

              <mat-checkbox
                class="fiscal-checkbox"
                [checked]="fiscalEnabled()"
                (change)="fiscalEnabled.set($event.checked)"
              >
                Фискальный регистратор
              </mat-checkbox>

              <button mat-flat-button class="full-width open-shift-btn"
                      [disabled]="!selectedStudioId || cashAtOpen === null || cashAtOpen < 0 || shiftService.shiftOpening()"
                      (click)="shiftService.openShift(selectedStudioId, cashAtOpen, fiscalEnabled())">
                @if (shiftService.shiftOpening()) {
                  <ng-container><mat-icon class="spin">sync</mat-icon> Открываю...</ng-container>
                } @else {
                  <ng-container><mat-icon>login</mat-icon> Открыть смену</ng-container>
                }
              </button>
              <button mat-stroked-button class="full-width skip-shift-btn"
                      (click)="shiftService.skipShift.set(true)">
                <mat-icon>visibility</mat-icon>
                Продолжить без открытия смены
              </button>
            }
          </mat-card-content>
        </mat-card>
      </div>
    }

    <!-- ============ ОСНОВНОЙ POS ============ -->
    @if (shiftService.shift() || shiftService.skipShift()) {
      @if (shiftService.skipShift() && !shiftService.shift()) {
        <div class="no-shift-banner">
          <mat-icon>info</mat-icon>
          Смена не открыта. Откройте смену для учёта выручки.
          <button mat-stroked-button (click)="shiftService.skipShift.set(false)">
            Открыть смену
          </button>
        </div>
      }

      <!-- Мобильный переключатель вида -->
      <div class="mobile-tabs">
        <button mat-button [class.active]="mobileView() === 'catalog'" (click)="mobileView.set('catalog')">
          <mat-icon>grid_view</mat-icon> Каталог
        </button>
        <button mat-button [class.active]="mobileView() === 'cart'" (click)="mobileView.set('cart')"
                [matBadge]="posService.itemCount()" [matBadgeHidden]="posService.isEmpty()">
          <mat-icon>receipt</mat-icon> Чек
        </button>
      </div>

      <div class="pos-layout">
        <!-- ======= ЛЕВАЯ ЧАСТЬ: КАТАЛОГ ======= -->
        <section class="catalog-panel" [class.hidden-mobile]="mobileView() === 'cart'">
          @if (shiftService.shift(); as shift) {
            <app-pos-shift-bar
              [shift]="shift"
              [studioName]="shiftService.studioName()"
              [commission]="todayCommission()"
              [fiscalOpening]="shiftService.fiscalShiftOpening()"
              [fiscalClosing]="shiftService.fiscalShiftClosing()"
              (journalRequested)="openReceiptJournal()"
              (reportRequested)="shiftService.loadShiftReport()"
              (cashWithdrawalRequested)="openCashHandover()"
              (fiscalOpenRequested)="shiftService.openFiscalShift()"
              (fiscalCloseRequested)="shiftService.closeFiscalShift()"
              (fiscalSettingsRequested)="openFiscalSettings(shift)"
              (closeRequested)="closeShiftDialog()"
            />
          }

          @if (inDoubtPayments().length > 0 && !inDoubtBannerDismissed()) {
            <div class="in-doubt-banner" role="alert">
              <mat-icon class="in-doubt-banner-icon">help_outline</mat-icon>
              <div class="in-doubt-banner-text">
                <strong>{{ inDoubtPayments().length }} {{ inDoubtPaymentsWord() }} с неизвестным статусом</strong>
                <span>Деньги могли списаться. Проверьте операции в Т-Бизнесе, не запускайте оплату повторно.</span>
              </div>
              <div class="in-doubt-banner-actions">
                <button mat-button (click)="openReceiptJournal('in_doubt')">Разобрать</button>
                <button mat-icon-button aria-label="Скрыть" (click)="dismissInDoubtBanner()">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>
          }

          @if (orphanPayments().length > 0 && !orphanBannerDismissed()) {
            <div class="in-doubt-banner" role="alert">
              <mat-icon class="in-doubt-banner-icon">receipt_long</mat-icon>
              <div class="in-doubt-banner-text">
                <strong>{{ orphanPayments().length }} {{ orphanPaymentsWord() }} без чека</strong>
                <span>Деньги по карте списались, но чек не пробит. Оформите чек — без повторного списания.</span>
              </div>
              <div class="in-doubt-banner-actions">
                <button mat-button (click)="openReceiptJournal('orphan')">Оформить</button>
                <button mat-icon-button aria-label="Скрыть" (click)="dismissOrphanBanner()">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>
          }

          <app-pos-search-bar
            (searchChanged)="onSearch($event)"
            (barcodeScanned)="onBarcode($event)"
          />

          <app-pos-category-tabs
            [categories]="categories()"
            [selectedId]="selectedCategory()"
            [pricingMode]="pricingMode()"
            (categorySelected)="selectCategory($event)"
            (pricingToggled)="togglePricingMode()"
          />

          @if (pricingMode() && !selectedPricingCategory()) {
            <app-catalog-tile-grid
              [categories]="catalogTileCategories()"
              [loading]="pricingApi.loading()"
              (categorySelected)="onTileCategorySelected($event)"
            />
          } @else if (pricingMode() && selectedPricingCategory()) {
            <div class="pricing-category-view">
              <div class="pricing-category-header">
                <button mat-icon-button (click)="selectedPricingCategory.set(null)">
                  <mat-icon>arrow_back</mat-icon>
                </button>
                <span class="pricing-category-title">{{ selectedPricingCategoryName() }}</span>
              </div>
              <div class="pricing-services-grid">
                @for (svc of selectedPricingCategoryServices(); track svc.id) {
                  <app-service-card
                    [service]="svc"
                    (toggled)="onServiceCardSelected(svc)"
                  />
                }
                @if (selectedPricingCategoryServices().length === 0) {
                  <div class="empty-services">
                    <mat-icon>design_services</mat-icon>
                    <span>Нет услуг в этой категории</span>
                  </div>
                }
              </div>
            </div>
          } @else {
            <app-pos-product-grid
              [products]="filteredProducts()"
              [loading]="productsLoading()"
              [pricingMode]="false"
              [pricingCategories]="[]"
              [selectedPricingSlug]="null"
              [employeeFavorites]="employeeFavorites()"
              [favoriteOptionIds]="favoriteOptionIds()"
              [showFavorites]="selectedCategory() === 'favorites'"
              (productAdded)="addProduct($event)"
              (pricingOrderSelected)="onPricingOrderSelected($event)"
              (pricingSlugChanged)="selectedPricingSlug.set($event)"
              (favoriteToggled)="toggleFavorite($event)"
            />
          }
        </section>

        <!-- ======= ПРАВАЯ ЧАСТЬ: ЧЕК ======= -->
        <section class="receipt-panel" [class.hidden-mobile]="mobileView() === 'catalog'">
          <app-pos-customer-lookup />
          <mat-divider />

          <app-pos-cart
            [items]="posService.items()"
            [waterfallLabels]="waterfallItemLabels()"
            (itemRemoved)="posService.removeItem($event)"
            (quantityChanged)="posService.updateQuantity($event.productId, $event.quantity)"
            (discountApplied)="posService.applyDiscount($event.productId, $event.percent)"
          />

          @if (!posService.isEmpty()) {
            <app-pos-totals
              [subtotal]="posService.subtotal()"
              [discountTotal]="posService.discountTotal()"
              [pointsTotal]="posService.pointsTotal()"
              [subscriptionTotal]="posService.subscriptionTotal()"
              [total]="posService.total()"
              [minimumCheckSurcharge]="posService.minimumCheckSurcharge()"
              [waterfallResult]="posService.waterfallResult()"
              [waterfallLoading]="posService.waterfallLoading()"
              [volumeDiscountActive]="posService.volumeDiscountRequested()"
              (volumeDiscountToggle)="toggleVolumeDiscount()"
            />

            @if (subscriptionCoverage().length > 0) {
              <app-pos-subscription-coverage
                [coverage]="subscriptionCoverage()"
                [savings]="subscriptionSavings()"
              />
            }

            @if (loyaltyPoints() > 0) {
              <app-pos-loyalty-spend
                [points]="loyaltyPoints()"
                [pointsToUse]="loyaltyPointsToUse()"
                [discount]="loyaltyDiscount()"
                [maxPointsToUse]="loyaltyMaxPointsToUse()"
                [disabledReason]="loyaltyUnavailableReason()"
                (toggleRequested)="toggleLoyalty()"
              />
            }

            <app-pos-promo-input
              (promoApplied)="onPromoApplied($event)"
              (promoRemoved)="onPromoRemoved()"
            />

            @if (shouldShowChatPrompt()) {
              <section class="pos-chat-prompt" aria-label="Привязка чата клиента">
                <div class="pos-chat-prompt-text">
                  <mat-icon>forum</mat-icon>
                  <div>
                    <span class="pos-chat-prompt-title">Чат клиента</span>
                    <span class="pos-chat-prompt-subtitle">
                      Перед оплатой привяжите диалог или отметьте, что его нет.
                    </span>
                  </div>
                </div>
                <div class="pos-chat-prompt-actions">
                  <button type="button" mat-flat-button class="pos-chat-bind-btn" (click)="openChatPicker()">
                    <mat-icon>link</mat-icon>
                    Привязать чат
                  </button>
                  <button type="button" mat-button class="pos-chat-no-chat-btn" (click)="confirmNoChat()">
                    С клиентом нет чата
                  </button>
                </div>
              </section>
            } @else if (linkedChatSessionId()) {
              <section class="pos-chat-linked" aria-label="Привязанный чат клиента">
                <div class="pos-chat-linked-info">
                  <mat-icon>mark_chat_read</mat-icon>
                  <span>{{ linkedChatLabel() }}</span>
                </div>
                <button type="button" mat-icon-button aria-label="Отвязать чат" (click)="unlinkChat()">
                  <mat-icon>link_off</mat-icon>
                </button>
              </section>
            } @else if (noChatConfirmed()) {
              <section class="pos-chat-linked pos-chat-linked-muted" aria-label="Чек без чата клиента">
                <div class="pos-chat-linked-info">
                  <mat-icon>chat_bubble_outline</mat-icon>
                  <span>С клиентом нет чата</span>
                </div>
                <button type="button" mat-button class="pos-chat-change-btn" (click)="openChatPicker()">
                  Привязать
                </button>
              </section>
            }

            <app-pos-payment-bar
              [canPaySubscription]="canPayBySubscription()"
              [hasSplitPayment]="remainderAfterSubscription() > 0 && canPayBySubscription()"
              [disabled]="paymentProcessing() || posService.waterfallLoading() || shouldShowChatPrompt()"
              [cashDisabled]="cashDisabledByFiscal()"
              [processing]="paymentProcessing()"
              [splitHint]="splitHint()"
              [terminalOnline]="terminalOnline()"
              (paymentRequested)="processPayment($event)"
              (splitPaymentRequested)="processSplitPayment($event)"
              (clearRequested)="clearReceipt()"
            />
          }

          <app-pos-status-bar
            [shift]="shiftService.shift()"
            [isOnline]="isOnline()"
            [commission]="todayCommission()"
          />

          @if (shiftService.shift()) {
            <div class="hotkeys-hint">
              F8 Наличные &middot; F9 Карта &middot; F10 СБП &middot; Del Удалить &middot; Esc Отмена
            </div>
          }
        </section>
      </div>

      <!-- Мобильная кнопка "К чеку" -->
      @if (mobileView() === 'catalog' && !posService.isEmpty()) {
        <button mat-fab class="mobile-cart-fab" (click)="mobileView.set('cart')"
                [matBadge]="posService.itemCount()">
          <mat-icon>receipt</mat-icon>
        </button>
      }
    }

    <!-- ============ PRODUCTION PROMPT ============ -->
    @if (showProductionPrompt(); as prompt) {
      <app-pos-production-prompt
        [receiptItems]="prompt.receiptItems"
        (sendRequested)="openSendToProduction()"
        (dismissed)="dismissProductionPrompt()"
      />
    }

    <!-- ============ PRINT PROMPT ============ -->
    @if (showPrintPrompt(); as prompt) {
      <app-pos-print-prompt
        [printableItems]="prompt.items"
        (openPrint)="openPrintFromReceipt()"
        (dismissed)="showPrintPrompt.set(null)"
      />
    }

    <!-- ============ CHAT PICKER ============ -->
    @if (showChatPickerPopup()) {
      <div class="dialog-overlay" (click)="closeChatPicker()" (keydown.enter)="closeChatPicker()" tabindex="0">
        <mat-card appearance="outlined" class="dialog-card pos-chat-picker-card"
                  role="dialog" aria-modal="true" aria-labelledby="pos-chat-picker-title"
                  cdkTrapFocus cdkTrapFocusAutoCapture
                  (click)="$event.stopPropagation()">
          <mat-card-content>
            <div class="pos-chat-picker-header">
              <h3 id="pos-chat-picker-title">Привязать чат</h3>
              <button type="button" mat-icon-button aria-label="Закрыть" (click)="closeChatPicker()">
                <mat-icon>close</mat-icon>
              </button>
            </div>

            <mat-form-field appearance="outline" class="full-width pos-chat-search-field">
              <mat-label>Поиск по имени или телефону</mat-label>
              <mat-icon matPrefix>search</mat-icon>
              <input
                matInput
                cdkFocusInitial
                [ngModel]="chatSearchQuery()"
                (ngModelChange)="searchChats($event)"
              >
            </mat-form-field>

            <div class="pos-chat-search-list">
              @if (chatSearchLoading()) {
                <div class="pos-chat-search-state">
                  <mat-spinner diameter="22" />
                  <span>Ищу чаты...</span>
                </div>
              }

              @for (chat of chatSearchResults(); track chat.id) {
                <button type="button" class="pos-chat-search-item" (click)="selectChatFromSearch(chat)">
                  <div class="pos-chat-search-top">
                    <mat-icon class="pos-chat-search-icon"
                              [style.color]="channelColor(chat.channel)">{{ channelIcon(chat.channel) }}</mat-icon>
                    <span class="pos-chat-search-main">{{ chat.clientName || chat.clientPhone || 'Без имени' }}</span>
                    @if (chat.sortTime) {
                      <span class="pos-chat-search-time">{{ chat.sortTime | date:'dd.MM HH:mm' }}</span>
                    }
                  </div>
                  <div class="pos-chat-search-sub">
                    @if (chat.channel) {
                      <span class="pos-chat-search-badge"
                            [style.color]="channelColor(chat.channel)"
                            [style.border-color]="channelColor(chat.channel)">{{ channelLabel(chat.channel) }}</span>
                    }
                    @if (chat.clientPhone) {
                      <span class="pos-chat-search-meta">{{ chat.clientPhone }}</span>
                    }
                  </div>
                  @if (chat.preview) {
                    <span class="pos-chat-search-preview">{{ chat.preview }}</span>
                  }
                </button>
              }

              @if (!chatSearchLoading() && chatSearchResults().length === 0) {
                <div class="pos-chat-search-empty">Чаты не найдены</div>
              }
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    }

    <!-- ============ ДИАЛОГ ЗАКРЫТИЯ СМЕНЫ ============ -->
    @if (shiftService.showCloseShift()) {
      <div class="dialog-overlay" (click)="shiftService.showCloseShift.set(false)"
           (keydown.enter)="shiftService.showCloseShift.set(false)" tabindex="0">
        <mat-card appearance="outlined" class="dialog-card"
                  role="dialog" aria-modal="true" aria-labelledby="close-shift-title"
                  cdkTrapFocus cdkTrapFocusAutoCapture
                  (click)="$event.stopPropagation()">
          <mat-card-content>
            <h3 id="close-shift-title">Закрытие смены #{{ shiftService.shift()!.shift_number }}</h3>
            <div class="close-shift-info">
              <div class="info-row">
                <span>Чеков:</span><strong>{{ shiftService.shift()!.receipt_count }}</strong>
              </div>
              <div class="info-row">
                <span>Продажи:</span><strong>{{ shiftService.shift()!.total_sales }}\u20BD</strong>
              </div>
              <div class="info-row">
                <span>Возвраты:</span><strong>{{ shiftService.shift()!.total_refunds }}\u20BD</strong>
              </div>
              @if (todayCommission() !== null && todayCommission()! > 0) {
                <div class="info-row commission-row">
                  <span>Комиссия:</span><strong>{{ todayCommission() }}\u20BD</strong>
                </div>
              }
            </div>
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Наличные в кассе, \u20BD</mat-label>
              <input matInput [(ngModel)]="cashAtClose" type="number" min="0">
              <mat-icon matPrefix>payments</mat-icon>
            </mat-form-field>
            <div class="dialog-actions">
              <button mat-button (click)="shiftService.showCloseShift.set(false)">Отмена</button>
              <button mat-flat-button color="warn" (click)="shiftService.closeShift(cashAtClose)"
                      [disabled]="shiftService.shiftClosing()">
                @if (shiftService.shiftClosing()) {
                  <mat-icon class="spin">sync</mat-icon>
                } @else {
                  <mat-icon>logout</mat-icon>
                }
                Закрыть смену
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    }

    <!-- ============ ДИАЛОГ ОПЛАТЫ УСЛУГИ ============ -->
    @if (pendingPricingOrder()) {
      <div class="dialog-overlay" (click)="cancelPricingOrder()" (keydown.enter)="cancelPricingOrder()" tabindex="0">
        <mat-card appearance="outlined" class="dialog-card"
                  role="dialog" aria-modal="true" aria-labelledby="pricing-order-title"
                  cdkTrapFocus cdkTrapFocusAutoCapture
                  (click)="$event.stopPropagation()">
          <mat-card-content>
            <h3 id="pricing-order-title">Оплата услуги</h3>
            <div class="pricing-order-summary">
              <div class="info-row">
                <span>Услуга:</span>
                <strong>{{ pendingPricingOrder()!.categoryName }}</strong>
              </div>
              @if (pendingPricingWaterfall(); as wf) {
                <div class="info-row pricing-muted-row">
                  <span>Подытог:</span>
                  <span>{{ wf.subtotal }}\u20BD</span>
                </div>
                @if (wf.discounts.student; as student) {
                  <div class="info-row pricing-discount-row pricing-student-row">
                    <span>Студенческая скидка</span>
                    <span>-{{ student.amount }}\u20BD</span>
                  </div>
                }
                @if (wf.discounts.subscriber; as sub) {
                  <div class="info-row pricing-discount-row">
                    <span>Скидка подписчика ({{ sub.percent }}%)</span>
                    <span>-{{ sub.amount }}\u20BD</span>
                  </div>
                }
                @if (wf.discounts.account; as account) {
                  <div class="info-row pricing-discount-row">
                    <span>{{ account.description || account.label + ' (' + account.percent + '%)' }}</span>
                    <span>-{{ account.amount }}\u20BD</span>
                  </div>
                }
                @if (wf.discounts.promo; as promo) {
                  <div class="info-row pricing-discount-row">
                    <span>{{ promo.title }}</span>
                    <span>-{{ promo.amount }}\u20BD</span>
                  </div>
                }
              }
              @if (pendingPricingLoading()) {
                <div class="pricing-loading">
                  <mat-spinner diameter="16" />
                  <span>Пересчёт цены...</span>
                </div>
              } @else if (pendingPricingError()) {
                <div class="pricing-error">{{ pendingPricingError() }}</div>
              }
              <div class="info-row">
                <span>Итого:</span>
                <strong class="pricing-total">{{ pendingPricingTotal() }}\u20BD</strong>
              </div>
            </div>

            @if (consumablePreviewLoading()) {
              <div class="consumable-loading">
                <mat-spinner diameter="16" />
                <span>Расходники...</span>
              </div>
            } @else if (consumablePreview().length > 0) {
              <div class="consumable-preview">
                @for (line of consumablePreview(); track line.rule_id) {
                  <div class="consumable-line">
                    <mat-icon class="consumable-icon">inventory_2</mat-icon>
                    <span class="consumable-name">{{ line.product_name }}</span>
                    <span class="consumable-deduction">&times;{{ line.deduction }}{{ line.unit_label ? ' ' + line.unit_label : '' }}</span>
                    <span class="consumable-stock" [class.stock-ok]="line.stock_after > line.current_stock * 0.3"
                          [class.stock-warn]="line.stock_after <= line.current_stock * 0.3 && line.stock_after > 0"
                          [class.stock-critical]="line.stock_after <= 0">
                      (ост. {{ line.stock_after >= 0 ? line.stock_after : 0 }})
                    </span>
                  </div>
                }
              </div>
            }

            @if (pricingPaymentProcessing()) {
              <mat-progress-bar mode="indeterminate" />
            } @else {
              <div class="pricing-pay-buttons">
                <button mat-flat-button class="pay-btn pay-cash"
                        [disabled]="pendingPricingLoading() || !!pendingPricingError()"
                        (click)="processPricingPayment('cash')">
                  <mat-icon>payments</mat-icon> Наличные
                </button>
                <button mat-flat-button class="pay-btn pay-card"
                        [disabled]="pendingPricingLoading() || !!pendingPricingError()"
                        (click)="processPricingPayment('card')">
                  <mat-icon>credit_card</mat-icon> Карта
                </button>
                <button mat-flat-button class="pay-btn pay-sbp"
                        [disabled]="pendingPricingLoading() || !!pendingPricingError()"
                        (click)="processPricingPayment('sbp')">
                  <mat-icon>qr_code_2</mat-icon> СБП
                </button>
                <button mat-flat-button class="pay-btn pay-transfer"
                        [disabled]="pendingPricingLoading() || !!pendingPricingError()"
                        (click)="processPricingPayment('transfer')">
                  <mat-icon>account_balance</mat-icon> Перевод
                </button>
              </div>
            }

            <div class="dialog-actions">
              <button mat-button (click)="cancelPricingOrder()" [disabled]="pricingPaymentProcessing()">
                Отмена
              </button>
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    }

    <!-- ============ X-ОТЧЁТ ============ -->
    @if (shiftService.showReport()) {
      <div class="dialog-overlay" (click)="shiftService.showReport.set(false)"
           (keydown.enter)="shiftService.showReport.set(false)" tabindex="0">
        <mat-card appearance="outlined" class="dialog-card report-card"
                  role="dialog" aria-modal="true" aria-labelledby="shift-report-title"
                  cdkTrapFocus cdkTrapFocusAutoCapture
                  (click)="$event.stopPropagation()">
          <mat-card-content>
            <h3 id="shift-report-title">X-отчёт · Смена #{{ shiftService.shift()!.shift_number }}</h3>
            @if (shiftService.reportLoading()) {
              <div class="shift-loading">
                <mat-spinner diameter="32" />
              </div>
            } @else if (shiftService.shiftReport()) {
              <div class="report-grid">
                <div class="report-item">
                  <span class="report-label">Чеков</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.receipts_count }}</span>
                </div>
                <div class="report-item">
                  <span class="report-label">Возвратов</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.refunds_count }}</span>
                </div>
                <div class="report-item">
                  <span class="report-label">Продажи</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.total_sales }}\u20BD</span>
                </div>
                <div class="report-item">
                  <span class="report-label">Возвраты</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.total_refunds }}\u20BD</span>
                </div>
                <div class="report-item highlight">
                  <span class="report-label">Нетто</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.net_sales }}\u20BD</span>
                </div>
                <div class="report-item">
                  <span class="report-label">Наличные</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.cash_payments }}\u20BD</span>
                </div>
                <div class="report-item">
                  <span class="report-label">Карты</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.card_payments }}\u20BD</span>
                </div>
                <div class="report-item">
                  <span class="report-label">СБП</span>
                  <span class="report-value">{{ shiftService.shiftReport()!.sbp_payments }}\u20BD</span>
                </div>
              </div>
              <app-pos-shift-earnings
                [shiftReport]="shiftService.shiftReport()!"
                [commissionSummary]="todayCommission() !== null ? { total_sales: shiftService.shiftReport()!.net_sales, total_commission: todayCommission()!, receipts_count: shiftService.shiftReport()!.receipts_count } : null" />
            }
            <div class="dialog-actions">
              <button mat-flat-button (click)="shiftService.showReport.set(false)">Закрыть</button>
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      position: relative;
    }
    .full-width { width: 100%; }

    /* ===== ОТКРЫТИЕ СМЕНЫ ===== */
    .shift-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--mat-sys-surface);
      z-index: 10;
    }
    .shift-card {
      width: 100%;
      max-width: 400px;
      margin: 16px;
    }
    .shift-card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      h2 { margin: 0; font-size: 20px; font-weight: 500; }
    }
    .shift-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--mat-sys-primary);
    }
    .shift-loading {
      display: flex;
      align-items: center;
      gap: 12px;
      justify-content: center;
      padding: 24px;
    }
    .fiscal-checkbox {
      display: block;
      margin: 4px 0 8px;
      font-size: 14px;
    }
    .open-shift-btn {
      height: 48px;
      font-size: 16px;
      margin-top: 8px;
    }
    .skip-shift-btn {
      margin-top: 8px;
      color: var(--mat-sys-on-surface-variant);
    }
    .no-shift-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
      font-size: 13px;
      border-radius: 8px;
      margin: 8px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      button { margin-left: auto; font-size: 12px; }
    }

    .in-doubt-banner {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      margin: 8px;
      border-radius: 8px;
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .in-doubt-banner-icon { flex-shrink: 0; }
    .in-doubt-banner-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 13px;
      strong { font-size: 14px; }
    }
    .in-doubt-banner-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
      flex-shrink: 0;
    }

    /* ===== МОБИЛЬНЫЕ ТАБЫ ===== */
    .mobile-tabs {
      display: flex;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      button {
        flex: 1;
        border-radius: 0;
        height: 48px;
        &.active {
          color: var(--mat-sys-primary);
          border-bottom: 2px solid var(--mat-sys-primary);
        }
      }
    }
    @media (min-width: 840px) {
      .mobile-tabs { display: none; }
    }

    /* ===== ОСНОВНОЙ LAYOUT ===== */
    .pos-layout {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 112px);
      overflow: hidden;
    }
    @media (min-width: 840px) {
      .pos-layout {
        flex-direction: row;
        height: calc(100vh - 64px);
      }
    }
    .hidden-mobile { display: none !important; }
    @media (min-width: 840px) {
      .hidden-mobile { display: flex !important; }
    }

    /* ===== КАТАЛОГ ===== */
    .catalog-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-right: none;
    }
    @media (min-width: 840px) {
      .catalog-panel {
        flex: 7;
        border-right: 1px solid var(--mat-sys-outline-variant);
      }
    }

    /* ===== ЧЕК ===== */
    .receipt-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background: var(--mat-sys-surface);
    }
    @media (min-width: 840px) {
      .receipt-panel { flex: 3; }
    }

    .pos-chat-prompt,
    .pos-chat-linked {
      flex-shrink: 0;
      margin: 8px 12px 10px;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-low);
    }
    .pos-chat-prompt {
      padding: 10px;
      border-color: color-mix(in srgb, var(--crm-status-success) 45%, var(--mat-sys-outline-variant));
      background: color-mix(in srgb, var(--crm-status-success) 10%, var(--mat-sys-surface));
    }
    .pos-chat-prompt-text,
    .pos-chat-linked-info {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .pos-chat-prompt-text {
      align-items: flex-start;
    }
    .pos-chat-prompt-text mat-icon {
      color: var(--crm-status-success);
      flex: 0 0 auto;
    }
    .pos-chat-prompt-title {
      display: block;
      font-size: 13px;
      font-weight: 700;
      line-height: 1.2;
    }
    .pos-chat-prompt-subtitle {
      display: block;
      margin-top: 2px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 11px;
      line-height: 1.25;
    }
    .pos-chat-prompt-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 10px;
    }
    .pos-chat-bind-btn {
      flex: 1 1 auto;
      min-height: 36px;
      border-radius: 8px;
      background: var(--crm-status-success) !important;
      color: #fff !important;
      font-weight: 700;
    }
    .pos-chat-no-chat-btn,
    .pos-chat-change-btn {
      min-width: 0;
      padding: 0 6px;
      color: var(--mat-sys-on-surface-variant) !important;
      font-size: 12px;
    }
    .pos-chat-linked {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      color: var(--mat-sys-on-surface);
    }
    .pos-chat-linked-info span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
    }
    .pos-chat-linked-info mat-icon {
      color: var(--crm-status-success);
      flex: 0 0 auto;
    }
    .pos-chat-linked-muted {
      color: var(--mat-sys-on-surface-variant);
      background: transparent;
    }
    .pos-chat-linked-muted .pos-chat-linked-info span {
      font-weight: 500;
    }
    .pos-chat-linked-muted .pos-chat-linked-info mat-icon {
      color: var(--mat-sys-on-surface-variant);
    }
    .pos-chat-picker-card {
      max-width: 460px;
    }
    .pos-chat-picker-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .pos-chat-picker-header h3 {
      margin: 0;
    }
    .pos-chat-search-field {
      margin-bottom: 4px;
    }
    .pos-chat-search-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: min(52vh, 420px);
      overflow: auto;
    }
    .pos-chat-search-item {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 3px;
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
      background: var(--mat-sys-surface-container-lowest);
      color: var(--mat-sys-on-surface);
      text-align: left;
      cursor: pointer;
    }
    .pos-chat-search-item:hover {
      border-color: var(--crm-status-success);
      background: color-mix(in srgb, var(--crm-status-success) 8%, var(--mat-sys-surface));
    }
    .pos-chat-search-top {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .pos-chat-search-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .pos-chat-search-main {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 14px;
      font-weight: 700;
    }
    .pos-chat-search-time {
      flex-shrink: 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 11px;
    }
    .pos-chat-search-sub {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pos-chat-search-badge {
      font-size: 10px;
      font-weight: 600;
      line-height: 1;
      padding: 2px 6px;
      border: 1px solid;
      border-radius: 4px;
      opacity: 0.9;
      white-space: nowrap;
    }
    .pos-chat-search-meta,
    .pos-chat-search-preview,
    .pos-chat-search-empty,
    .pos-chat-search-state {
      color: var(--mat-sys-on-surface-variant);
      font-size: 12px;
    }
    .pos-chat-search-preview {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pos-chat-search-empty,
    .pos-chat-search-state {
      padding: 12px;
      text-align: center;
    }
    .pos-chat-search-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    @media (max-width: 480px) {
      .pos-chat-prompt-actions {
        align-items: stretch;
        flex-direction: column;
      }
      .pos-chat-no-chat-btn {
        align-self: flex-start;
      }
    }

    /* FAB мобильный */
    .mobile-cart-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 5;
    }
    @media (min-width: 840px) {
      .mobile-cart-fab { display: none; }
    }

    /* ===== ДИАЛОГИ ===== */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .dialog-card {
      width: 100%;
      max-width: 420px;
      margin: 16px;
      h3 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
    }
    .close-shift-info {
      margin-bottom: 16px;
      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 14px;
      }
      .commission-row {
        color: var(--crm-status-success);
        font-weight: 600;
        border-top: 1px solid var(--mat-sys-outline-variant);
        margin-top: 4px;
        padding-top: 8px;
      }
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }
    .report-card { max-width: 500px; }
    .report-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }
    .report-item {
      padding: 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
      text-align: center;
      &.highlight {
        background: var(--mat-sys-primary-container);
        color: var(--mat-sys-on-primary-container);
      }
    }
    .report-label {
      display: block;
      font-size: 12px;
      color: var(--mat-sys-on-surface-variant);
      margin-bottom: 4px;
    }
    .report-value {
      font-size: 20px;
      font-weight: 700;
    }

    /* ===== PRICING ORDER DIALOG ===== */
    .pricing-order-summary {
      margin-bottom: 20px;
      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 15px;
      }
    }
    .pricing-muted-row {
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px !important;
    }
    .pricing-discount-row {
      color: var(--crm-status-success);
      font-size: 13px !important;
    }
    .pricing-student-row { color: var(--mat-sys-primary); }
    .pricing-loading,
    .pricing-error {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 12px;
    }
    .pricing-loading { color: var(--mat-sys-on-surface-variant); }
    .pricing-error { color: var(--mat-sys-error); }
    .pricing-total {
      font-size: 20px;
      color: var(--mat-sys-primary);
    }
    .pricing-pay-buttons {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .pay-btn {
      height: 52px;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      mat-icon { font-size: 20px; }
    }
    .pay-cash {
      background: var(--crm-status-success) !important;
      color: #fff !important;
    }
    .pay-card {
      background: var(--mat-sys-primary) !important;
      color: var(--mat-sys-on-primary) !important;
    }
    .pay-sbp {
      background: var(--crm-accent-dim) !important;
      color: #fff !important;
    }
    .pay-transfer {
      background: #2563eb !important;
      color: #fff !important;
    }

    /* ===== CONSUMABLE PREVIEW ===== */
    .consumable-loading {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      font-size: 11px;
      color: #7a7a7a;
    }
    .consumable-preview {
      padding: 8px 0;
      border-top: 1px dashed var(--mat-sys-outline-variant);
      margin-bottom: 8px;
    }
    .consumable-line {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      font-size: 11px;
      color: #7a7a7a;
    }
    .consumable-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #7a7a7a;
    }
    .consumable-name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .consumable-deduction {
      font-weight: 600;
      white-space: nowrap;
    }
    .consumable-stock {
      white-space: nowrap;
      font-size: 10px;
    }
    .stock-ok { color: #4caf50; }
    .stock-warn { color: #ff9800; }
    .stock-critical { color: #f44336; font-weight: 600; }

    /* ===== PRICING CATEGORY VIEW ===== */
    .pricing-category-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pricing-category-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px 8px;
    }
    .pricing-category-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }
    .pricing-services-grid {
      flex: 1;
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
      padding: 0 12px 80px;
      overflow-y: auto;
      align-content: start;
    }
    @media (min-width: 600px) {
      .pricing-services-grid { grid-template-columns: repeat(3, 1fr); }
    }
    @media (min-width: 1100px) {
      .pricing-services-grid { grid-template-columns: repeat(4, 1fr); }
    }
    .empty-services {
      grid-column: 1 / -1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 40px;
      color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.4; }
    }

    /* ===== HOTKEYS HINT ===== */
    .hotkeys-hint {
      text-align: center;
      font-size: 11px;
      color: var(--mat-sys-on-surface-variant);
      opacity: 0.6;
      padding: 4px 0;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }

    /* Утилиты */
    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class PosComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly posApi = inject(PosApiService);
  private readonly catalogApi = inject(CatalogApiService);
  private readonly authService = inject(AuthService);
  private readonly cloudPayments = inject(CloudPaymentsService);
  protected readonly pricingApi = inject(PricingApiService);
  private readonly offlineQueue = inject(OfflineQueueService);
  private readonly dialog = inject(MatDialog);
  private readonly wsService = inject(WebSocketService);

  readonly posService = inject(PosService);
  readonly shiftService = inject(PosShiftService);
  readonly studioService = inject(StudioService);
  private readonly customerService = inject(PosCustomerService);
  private readonly soundService = inject(PosSoundService);
  private readonly salesApi = inject(PosSalesApiService);
  private readonly fiscalStatusWatchIds = new Set<string>();
  private readonly fiscalNotificationKeys = new Set<string>();
  private readonly chatSearchRefresh$ = new Subject<void>();

  // Production prompt
  readonly showProductionPrompt = signal<{
    receiptId: string;
    receiptItems: { product_name: string; quantity: number; unit_price: number; total: number }[];
  } | null>(null);

  // Print prompt
  readonly showPrintPrompt = signal<{ receiptId: string; items: PrintableItem[] } | null>(null);

  // Каталог
  readonly categories = signal<ProductCategory[]>([]);
  readonly allProducts = signal<Product[]>([]);
  readonly selectedCategory = signal<string | null>(null);
  readonly productsLoading = signal(false);
  private readonly searchQuery = signal('');

  // F62: Employee favorites
  readonly employeeFavorites = signal<EmployeeFavorite[]>([]);
  readonly favoriteOptionIds = computed(() =>
    new Set(this.employeeFavorites().map(f => f.service_option_id)),
  );

  readonly filteredProducts = computed(() => {
    let items = this.allProducts();
    const cat = this.selectedCategory();
    const q = this.searchQuery()?.toLowerCase().trim();

    if (cat === 'favorites') {
      items = items.filter(p => p.is_favorite);
    } else if (cat) {
      items = items.filter(p => p.category_id === cat);
    }
    if (q) {
      items = items.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.barcode?.includes(q) ||
        p.code?.toLowerCase().includes(q),
      );
    }
    return items;
  });

  // Оплата
  private _splitRemainderMethod: 'cash' | 'card' | 'sbp' | 'transfer' | null = null;
  readonly paymentProcessing = signal(false);
  readonly linkedChatSessionId = signal<string | null>(null);
  readonly linkedChatSessionName = signal<string | null>(null);
  readonly noChatConfirmed = signal(false);
  readonly showChatPickerPopup = signal(false);
  readonly chatSearchQuery = signal('');
  readonly chatSearchResults = signal<PosChatSearchResult[]>([]);
  readonly chatSearchLoading = signal(false);
  readonly channelIcon = channelIcon;
  readonly channelLabel = channelLabel;
  readonly channelColor = channelColor;
  readonly linkedChatLabel = computed(() =>
    this.linkedChatSessionName() ?? this.linkedChatSessionId() ?? 'Чат клиента',
  );
  readonly shouldShowChatPrompt = computed(() =>
    !this.posService.isEmpty() && !this.linkedChatSessionId() && !this.noChatConfirmed(),
  );
  selectedStudioId = '';
  cashAtOpen: number | null = null;
  cashAtClose = 0;
  readonly fiscalEnabled = signal(true);

  readonly cashDisabledByFiscal = computed(() => false);

  // Мобильный вид
  readonly mobileView = signal<PosView>('catalog');

  // Keyboard shortcuts
  readonly selectedCartIndex = signal<number | null>(null);

  // Pricing Configurator
  readonly pricingMode = signal(true);
  readonly selectedPricingSlug = signal<string | null>(null);
  readonly selectedPricingCategory = signal<string | null>(null);
  readonly pendingPricingOrder = signal<OrderSelectedEvent | null>(null);
  readonly pendingPricingWaterfall = signal<WaterfallV2Response | null>(null);
  readonly pendingPricingLoading = signal(false);
  readonly pendingPricingError = signal<string | null>(null);
  readonly pricingPaymentProcessing = signal(false);
  readonly pricingCategories = computed(() => this.pricingApi.categories());
  readonly pendingPricingTotal = computed(() =>
    this.pendingPricingWaterfall()?.total ?? this.pendingPricingOrder()?.total ?? 0,
  );

  /** Map pricing categories to CatalogCategory[] for tile grid */
  readonly catalogTileCategories = computed<CatalogCategory[]>(() =>
    this.pricingCategories().map(cat => ({
      slug: cat.slug,
      name: cat.name,
      icon: cat.icon ?? 'design_services',
      itemCount: cat.optionGroups.reduce((sum, g) => sum + g.options.length, 0),
    })),
  );

  /** Name of currently selected pricing category */
  readonly selectedPricingCategoryName = computed(() => {
    const slug = this.selectedPricingCategory();
    if (!slug) return '';
    return this.pricingCategories().find(c => c.slug === slug)?.name ?? '';
  });

  /** Service options for the selected pricing category, mapped to UiServiceOption */
  readonly selectedPricingCategoryServices = computed<UiServiceOption[]>(() => {
    const slug = this.selectedPricingCategory();
    if (!slug) return [];
    const cat = this.pricingCategories().find(c => c.slug === slug);
    if (!cat) return [];
    return cat.optionGroups.flatMap(g =>
      g.options.map(opt => ({
        id: opt.id,
        slug: opt.slug,
        name: opt.name,
        categorySlug: cat.slug,
        groupSlug: g.slug,
        description: opt.description ?? '',
        price: opt.price_studio ?? opt.base_price,
        priceMax: opt.price_max ?? null,
        icon: opt.icon ?? 'design_services',
        popular: opt.popular,
        originalPrice: opt.original_price ?? null,
        features: opt.features ?? [],
        productId: opt.product_id ?? null,
      })),
    );
  });

  // Waterfall V2 debounce
  private waterfallDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPricingDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPricingRequestId = 0;

  toggleVolumeDiscount(): void {
    this.posService.volumeDiscountRequested.update(v => !v);
    // Effect автоматически пересчитает waterfall
  }

  /** Per-item waterfall discount labels + volume hints, keyed by product_id */
  readonly waterfallItemLabels = computed<Map<string, string>>(() => {
    const wf = this.posService.waterfallResult();
    if (!wf) return new Map();
    const labels = new Map<string, string>();
    for (const wi of wf.items) {
      // Map serviceOptionId back to product_id
      const productId = this.resolveServiceOptionToProductId(wi.serviceOptionId);
      if (!productId) continue;
      // Combine discount label and volume hint
      const parts: string[] = [];
      if (wi.priceAdjustmentLabel) parts.push(wi.priceAdjustmentLabel);
      if (wi.discountLabel) parts.push(wi.discountLabel);
      if (wi.volumeHint) parts.push(wi.volumeHint);
      if (parts.length > 0) labels.set(productId, parts.join(' | '));
    }
    return labels;
  });

  // Consumable preview
  readonly consumablePreview = signal<ConsumablePreviewLine[]>([]);
  readonly consumablePreviewLoading = signal(false);
  private consumableDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Online status
  readonly isOnline = signal(true);

  // Статус терминала по телеметрии (true/false свежий снимок, null — нет данных/устарел).
  // Блокируем приём карты ТОЛЬКО при явном свежем false (мягкая деградация при null).
  readonly terminalOnline = signal<boolean | null>(null);

  // Зависшие оплаты (in_doubt + старые pending) для индикации — контур детекта.
  readonly inDoubtPayments = signal<PosInDoubtPayment[]>([]);
  readonly inDoubtBannerDismissed = signal(false);
  readonly inDoubtPaymentsWord = computed(() => this.paymentsWord(this.inDoubtPayments().length));

  // Осиротевшие оплаты (списание прошло, чека нет) — контур детекта без чека.
  readonly orphanPayments = signal<PosOrphanPayment[]>([]);
  readonly orphanBannerDismissed = signal(false);
  readonly orphanPaymentsWord = computed(() => this.paymentsWord(this.orphanPayments().length));

  // Commission
  readonly todayCommission = signal<number | null>(null);

  // Promo code
  readonly promoCode = signal<string | null>(null);

  // Loyalty
  readonly loyaltyPointsToUse = signal(0);
  private readonly loyaltyMaxDiscountRatio = 0.15;
  readonly loyaltyDiscount = computed(() =>
    Math.min(this.loyaltyPointsToUse(), this.loyaltyMaxPointsToUse()),
  );
  readonly loyaltyPoints = computed(() =>
    this.posService.customer()?.loyalty?.points ?? 0,
  );
  readonly loyaltyAccountDiscountBlocked = computed(() =>
    (this.posService.waterfallResult()?.discounts.account?.amount ?? 0) > 0,
  );
  readonly loyaltyEligibleSubtotal = computed(() => {
    const wf = this.posService.waterfallResult();
    if (wf) {
      return Math.round(wf.items.reduce((sum, item) =>
        sum + (this.isA3PhotoPrintWaterfallItem(item) ? 0 : Math.max(0, item.finalPrice)),
      0) * 100) / 100;
    }

    return Math.round(this.posService.items().reduce((sum, item) =>
      sum + (this.isA3PhotoPrintProduct(item.product) ? 0 : Math.max(0, item.total)),
    0) * 100) / 100;
  });
  readonly loyaltyMaxDiscount = computed(() => {
    if (this.loyaltyAccountDiscountBlocked()) return 0;
    return Math.floor(this.loyaltyEligibleSubtotal() * this.loyaltyMaxDiscountRatio);
  });
  readonly loyaltyMaxPointsToUse = computed(() =>
    Math.min(this.loyaltyPoints(), this.loyaltyMaxDiscount()),
  );
  readonly loyaltyUnavailableReason = computed(() => {
    if (this.loyaltyPoints() <= 0) return null;
    if (this.loyaltyAccountDiscountBlocked()) return 'Скидка аккаунта уже применена';
    if (this.loyaltyEligibleSubtotal() <= 0) return 'Бонусы недоступны для этих позиций';
    if (this.loyaltyMaxPointsToUse() <= 0) return 'Минимальная сумма для списания бонусов не набрана';
    return null;
  });

  // Subscription coverage
  readonly subscriptionCoverage = signal<SubscriptionCoverage[]>([]);
  readonly subscriptionCoverageLoading = signal(false);

  readonly subscriptionSavings = computed(() =>
    Math.round(this.subscriptionCoverage().reduce((sum, c) => sum + c.savedAmount, 0) * 100) / 100,
  );

  readonly canPayBySubscription = computed(() => this.subscriptionCoverage().length > 0);

  readonly remainderAfterSubscription = computed(() =>
    Math.max(0, Math.round((this.posService.total() - this.subscriptionSavings()) * 100) / 100),
  );

  readonly splitHint = computed(() => {
    if (this.remainderAfterSubscription() > 0 && this.canPayBySubscription()) {
      return `${this.subscriptionSavings()}\u20BD спишется по подписке, ${this.remainderAfterSubscription()}\u20BD доплата`;
    }
    return null;
  });

  constructor() {
    effect(() => {
      const current = this.loyaltyPointsToUse();
      const max = this.loyaltyMaxPointsToUse();
      if (current > max) {
        this.loyaltyPointsToUse.set(max);
      }
    });

    effect(() => {
      if (this.posService.isEmpty()) {
        this.resetChatBindingPrompt();
      }
    });

    this.chatSearchRefresh$.pipe(
      debounceTime(250),
      switchMap(() => {
        const query = this.chatSearchQuery().trim();
        const params: Record<string, string> = { types: 'chat', limit: '20' };
        if (query.length >= 2) params['search'] = query;

        this.chatSearchLoading.set(true);
        return this.http.get<{ success: boolean; data: PosChatSearchResult[] }>('/api/crm/inbox', { params }).pipe(
          catchError(() => of({ success: false, data: [] as PosChatSearchResult[] })),
          finalize(() => this.chatSearchLoading.set(false)),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(response => {
      if (this.showChatPickerPopup()) {
        this.chatSearchResults.set(response.data ?? []);
      }
    });

    // Waterfall V2: debounced recalculation on cart/promo/loyalty/volume-discount changes
    effect(() => {
      const items = this.posService.items();
      const promo = this.promoCode();
      const loyaltyPts = this.loyaltyPointsToUse();
      const customer = this.posService.customer();
      const _volumeDiscount = this.posService.volumeDiscountRequested();

      if (this.waterfallDebounceTimer) clearTimeout(this.waterfallDebounceTimer);

      if (items.length === 0) {
        this.posService.waterfallResult.set(null);
        return;
      }

      this.waterfallDebounceTimer = setTimeout(() => {
        this.posService.recalculateWaterfall(
          this.pricingCategories(),
          promo,
          customer?.phone,
          loyaltyPts,
          customer?.loyalty?.id,
        );
      }, 300);
    });

    effect((onCleanup) => {
      const subscriptionId = this.posService.customer()?.subscription?.id;
      const items = this.posService.getReceiptItems();

      if (!subscriptionId || items.length === 0) {
        this.subscriptionCoverage.set([]);
        this.subscriptionCoverageLoading.set(false);
        return;
      }

      this.subscriptionCoverage.set([]);
      this.subscriptionCoverageLoading.set(true);
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
          this.subscriptionCoverageLoading.set(false);
        },
        error: () => {
          this.subscriptionCoverage.set([]);
          this.subscriptionCoverageLoading.set(false);
        },
      });

      onCleanup(() => sub.unsubscribe());
    });

    effect(() => {
      const order = this.pendingPricingOrder();
      if (!order) {
        this.consumablePreview.set([]);
        return;
      }
      this.loadConsumablePreview(order.selectedOptions);
    });

    effect(() => {
      const order = this.pendingPricingOrder();
      const categories = this.pricingCategories();
      const customerPhone = this.posService.customer()?.phone ?? null;
      const promo = this.promoCode();
      const _volumeDiscount = this.posService.volumeDiscountRequested();

      if (this.pendingPricingDebounceTimer) clearTimeout(this.pendingPricingDebounceTimer);

      if (!order) {
        this.pendingPricingWaterfall.set(null);
        this.pendingPricingLoading.set(false);
        this.pendingPricingError.set(null);
        return;
      }

      this.pendingPricingLoading.set(true);
      this.pendingPricingError.set(null);
      this.pendingPricingDebounceTimer = setTimeout(() => {
        this.recalculatePendingPricing(order, categories, customerPhone, promo);
      }, 250);
    });

    // Join POS studio room when shift is loaded
    effect(() => {
      const shift = this.shiftService.shift();
      if (shift) {
        this.wsService.joinPosStudio(shift.studio_id);
      }
    });

    // Подгрузка зависших и осиротевших оплат при появлении/смене смены
    effect(() => {
      const shift = this.shiftService.shift();
      const studioId = shift?.studio_id ?? null;
      if (!studioId) {
        this.inDoubtPayments.set([]);
        this.orphanPayments.set([]);
        return;
      }
      this.loadInDoubtPayments(studioId);
      this.loadOrphanPayments(studioId);
    });

    // Auto-select first studio for shift-less mode
    effect(() => {
      const studios = this.studioService.studios();
      if (studios.length > 0 && !this.selectedStudioId) {
        this.selectedStudioId = studios[0].id;
      }
    });

    // Real-time stock updates via WebSocket
    effect(() => {
      const update = this.wsService.posStockUpdate();
      if (!update) return;
      this.allProducts.update(products =>
        products.map(p => {
          const change = update.changes.find(c => c.product_id === p.id);
          return change
            ? { ...p, stock_quantity: change.new_quantity }
            : p;
        }),
      );
    });

    // Fiscal failure alerts via WebSocket
    effect(() => {
      const failure = this.wsService.fiscalFailure();
      if (!failure) return;
      this.showFiscalFailureSnack(failure.receipt_id, failure.receipt_number, failure.error_message);
    });

    // Fiscal success alerts via WebSocket
    effect(() => {
      const success = this.wsService.fiscalSuccess();
      if (!success) return;
      this.showFiscalSuccessSnack(
        success.receipt_id,
        success.fiscal_receipt_number || success.receipt_number,
      );
    });

    // Осиротевшая оплата без чека (детектор кассы) — перезагружаем список для баннера
    effect(() => {
      const orphan = this.wsService.posOrphanPayment();
      if (!orphan) return;
      const studioId = this.shiftService.shift()?.studio_id ?? null;
      if (!studioId || orphan.studio_id !== studioId) return;
      this.loadOrphanPayments(studioId);
    });
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.studioService.load();

    const user = this.authService.currentUser();
    if (user?.id) {
      this.posService.employeeId.set(user.id);
      this.shiftService.checkCurrentShift(user.id);
    }

    this.loadCatalog();
    this.loadFavorites();
    this.pricingApi.loadCategories();
    this.loadCommission();

    if (typeof window !== 'undefined') {
      this.isOnline.set(navigator.onLine);
      window.addEventListener('online', () => this.isOnline.set(true));
      window.addEventListener('offline', () => this.isOnline.set(false));
    }

    // Опрос статуса терминала каждые 30с для блокировки приёма карты при офлайне
    timer(0, 30_000).pipe(
      switchMap(() => this.posApi.bridgeStatus().pipe(
        catchError(() => of(null)),
      )),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(status => {
      // null от ошибки запроса не меняет статус (мягкая деградация). При успехе берём terminalOnline.
      if (status) this.terminalOnline.set(status.terminalOnline ?? null);
    });
  }

  private loadInDoubtPayments(studioId: string): void {
    this.posApi.getInDoubtPayments(studioId).pipe(
      catchError(() => of([] as PosInDoubtPayment[])),
      take(1),
    ).subscribe(items => {
      this.inDoubtPayments.set(items);
      if (items.length > 0) this.inDoubtBannerDismissed.set(false);
    });
  }

  dismissInDoubtBanner(): void {
    this.inDoubtBannerDismissed.set(true);
  }

  private loadOrphanPayments(studioId: string): void {
    this.posApi.getOrphanPayments(studioId).pipe(
      catchError(() => of([] as PosOrphanPayment[])),
      take(1),
    ).subscribe(items => {
      this.orphanPayments.set(items);
      if (items.length > 0) this.orphanBannerDismissed.set(false);
    });
  }

  dismissOrphanBanner(): void {
    this.orphanBannerDismissed.set(true);
  }

  /** Склонение слова «оплата» по числу (1 оплата / 2 оплаты / 5 оплат). */
  private paymentsWord(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return 'оплата';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'оплаты';
    return 'оплат';
  }

  // ===== КАТАЛОГ =====

  private loadCatalog(): void {
    this.catalogApi.getCategories().subscribe({
      next: (cats) => this.categories.set(cats),
      error: () => undefined,
    });

    this.productsLoading.set(true);
    this.catalogApi.getProducts({ limit: 500 }).subscribe({
      next: (res) => {
        this.allProducts.set(res.items);
        this.productsLoading.set(false);
      },
      error: () => this.productsLoading.set(false),
    });
  }

  private loadFavorites(): void {
    this.posApi.getFavorites().subscribe({
      next: (items) => this.employeeFavorites.set(items),
      error: () => undefined,
    });
  }

  toggleFavorite(optionId: string): void {
    const isFav = this.favoriteOptionIds().has(optionId);
    if (isFav) {
      this.posApi.removeFavorite(optionId).subscribe({
        next: () => this.employeeFavorites.update(
          favs => favs.filter(f => f.service_option_id !== optionId),
        ),
        error: () => undefined,
      });
    } else {
      this.posApi.addFavorite(optionId).subscribe({
        next: () => this.loadFavorites(),
        error: () => undefined,
      });
    }
  }

  selectCategory(catId: string | null): void {
    this.selectedCategory.set(catId);
    if (catId !== null) {
      this.pricingMode.set(false);
      this.selectedPricingCategory.set(null);
    }
  }

  onSearch(query: string): void {
    this.searchQuery.set(query);
  }

  onBarcode(barcode: string): void {
    this.soundService.play('scan_beep');
    this.catalogApi.getProductByBarcode(barcode).subscribe({
      next: (product) => {
        if (product) {
          this.posService.addItem(product);
          this.snackBar.open(`${product.name} добавлен`, 'OK', { duration: 2000 });
        }
      },
      error: () => undefined,
    });
  }

  addProduct(product: Product): void {
    this.posService.addItem(product);
  }

  // ===== SHIFT =====

  openCashHandover(): void {
    this.router.navigate(['/employee/cash-handover']);
  }

  closeShiftDialog(): void {
    this.openCashHandover();
  }

  openFiscalSettings(shift: PosShift): void {
    this.dialog.open(PosFiscalSettingsDialogComponent, {
      width: '780px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100vh - 24px)',
      data: {
        studioId: shift.studio_id,
        studioName: this.shiftService.studioName() || this.studioService.studioName(shift.studio_id),
        fiscalStatus: shift.fiscal_status ?? null,
      },
    });
  }

  // ===== KEYBOARD SHORTCUTS =====

  handleKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.closest('[contenteditable]')) return;
    if (this.paymentProcessing()) return;

    switch (event.key) {
      case 'Escape':
        this.onEscapeKey();
        event.preventDefault();
        break;
      case 'F8':
        if (!this.posService.isEmpty()) this.processPayment('cash');
        event.preventDefault();
        break;
      case 'F9':
        if (!this.posService.isEmpty()) this.processPayment('card');
        event.preventDefault();
        break;
      case 'F10':
        if (!this.posService.isEmpty()) this.processPayment('sbp');
        event.preventDefault();
        break;
      case 'Delete':
      case 'Backspace': {
        const idx = this.selectedCartIndex();
        if (idx !== null) {
          const item = this.posService.items()[idx];
          if (item) {
            this.posService.removeItem(item.product.id);
          }
          this.selectedCartIndex.set(null);
        }
        event.preventDefault();
        break;
      }
    }
  }

  onEscapeKey(): void {
    if (this.showChatPickerPopup()) {
      this.closeChatPicker();
    } else if (this.shiftService.showCloseShift()) {
      this.shiftService.showCloseShift.set(false);
    } else if (this.shiftService.showReport()) {
      this.shiftService.showReport.set(false);
    } else if (this.pendingPricingOrder() && !this.pricingPaymentProcessing()) {
      this.pendingPricingOrder.set(null);
    } else if (this.selectedPricingCategory()) {
      this.selectedPricingCategory.set(null);
    }
  }

  openChatPicker(): void {
    this.showChatPickerPopup.set(true);
    this.chatSearchQuery.set('');
    this.chatSearchResults.set([]);
    this.chatSearchRefresh$.next();
  }

  closeChatPicker(): void {
    this.showChatPickerPopup.set(false);
    this.chatSearchQuery.set('');
    this.chatSearchResults.set([]);
    this.chatSearchLoading.set(false);
  }

  searchChats(query: string): void {
    this.chatSearchQuery.set(query);
    this.chatSearchRefresh$.next();
  }

  selectChatFromSearch(chat: PosChatSearchResult): void {
    const label = chat.clientName || chat.clientPhone || chat.channel || 'Чат клиента';
    this.linkChat(chat.id, label);
    this.applyChatCustomer(chat);
  }

  confirmNoChat(): void {
    this.linkedChatSessionId.set(null);
    this.linkedChatSessionName.set(null);
    this.noChatConfirmed.set(true);
    this.closeChatPicker();
  }

  unlinkChat(): void {
    this.linkedChatSessionId.set(null);
    this.linkedChatSessionName.set(null);
    this.noChatConfirmed.set(false);
  }

  private linkChat(sessionId: string, label: string): void {
    this.linkedChatSessionId.set(sessionId);
    this.linkedChatSessionName.set(label);
    this.noChatConfirmed.set(false);
    this.closeChatPicker();
  }

  private resetChatBindingPrompt(): void {
    this.linkedChatSessionId.set(null);
    this.linkedChatSessionName.set(null);
    this.noChatConfirmed.set(false);
    this.showChatPickerPopup.set(false);
    this.chatSearchQuery.set('');
    this.chatSearchResults.set([]);
    this.chatSearchLoading.set(false);
  }

  private restoreChatBindingState(
    sessionId: string | null,
    sessionName: string | null,
    noChatConfirmed: boolean,
  ): void {
    if (sessionId) {
      this.linkChat(sessionId, sessionName ?? 'Чат клиента');
      return;
    }

    this.linkedChatSessionId.set(null);
    this.linkedChatSessionName.set(null);
    this.noChatConfirmed.set(noChatConfirmed);
  }

  private applyChatCustomer(chat: PosChatSearchResult): void {
    const phone = this.normalizePhone(chat.clientPhone);
    const customer = this.posService.customer();
    const name = chat.clientName || customer?.name;

    if (phone) {
      this.customerService.customerPhone.set(phone);
      this.posService.setCustomer({
        ...customer,
        phone,
        name: name || undefined,
      });
      return;
    }

    if (customer && name) {
      this.posService.setCustomer({ ...customer, name });
    }
  }

  private normalizePhone(value: string | null | undefined): string {
    return (value ?? '').replace(/\D/g, '');
  }

  private ensureChatDecisionBeforePayment(): boolean {
    if (!this.shouldShowChatPrompt()) return true;
    this.snackBar.open(
      'Перед оплатой привяжите чат или отметьте, что у клиента нет чата',
      'OK',
      { duration: 4000 },
    );
    return false;
  }

  // ===== RECEIPT =====

  clearReceipt(): void {
    const snapshot = this.posService.items().slice();
    const savedPhone = this.customerService.customerPhone();
    const savedCustomer = this.posService.customer();
    const savedChatSessionId = this.linkedChatSessionId();
    const savedChatSessionName = this.linkedChatSessionName();
    const savedNoChatConfirmed = this.noChatConfirmed();

    this.posService.clear();
    this.customerService.clear();
    this.loyaltyPointsToUse.set(0);
    this.resetChatBindingPrompt();

    const ref = this.snackBar.open('Чек очищен', 'Отменить', { duration: 5000 });
    ref.onAction().subscribe(() => {
      snapshot.forEach(item => {
        this.posService.addItem(item.product, item.quantity);
        if (item.discount_percent > 0) {
          this.posService.applyDiscount(item.product.id, item.discount_percent);
        }
      });
      if (savedCustomer) {
        this.posService.setCustomer(savedCustomer);
        this.customerService.customerPhone.set(savedPhone);
      }
      this.restoreChatBindingState(savedChatSessionId, savedChatSessionName, savedNoChatConfirmed);
    });
  }

  // ===== PRICING =====

  togglePricingMode(): void {
    const next = !this.pricingMode();
    this.pricingMode.set(next);
    this.selectedCategory.set(null);
    this.selectedPricingCategory.set(null);
    if (next && this.pricingCategories().length > 0) {
      this.selectedPricingSlug.set(this.pricingCategories()[0].slug);
    }
  }

  onTileCategorySelected(slug: string): void {
    this.selectedPricingCategory.set(slug);
    this.selectedPricingSlug.set(slug);
  }

  onServiceCardSelected(svc: UiServiceOption): void {
    const slug = this.selectedPricingCategory();
    if (!slug) return;
    const cat = this.pricingCategories().find(c => c.slug === slug);
    if (!cat) return;
    this.onPricingOrderSelected({
      categorySlug: slug,
      categoryName: cat.name,
      selectedOptions: [{ option_slug: svc.slug, quantity: 1 }],
      deliveryMethod: 'pickup',
      total: svc.price,
      displayName: svc.name,
    });
  }

  onPricingOrderSelected(event: OrderSelectedEvent): void {
    this.openPricingPaymentDialog(event);
  }

  cancelPricingOrder(): void {
    if (!this.pricingPaymentProcessing()) {
      this.pendingPricingOrder.set(null);
    }
  }

  private openPricingPaymentDialog(event: OrderSelectedEvent): void {
    const studioId = this.shiftService.shift()?.studio_id ?? this.selectedStudioId;
    if (!studioId) {
      this.snackBar.open('Выберите студию для создания чека', '', { duration: 3000 });
      return;
    }

    const customer = this.posService.customer();
    const data: PaymentDialogData = {
      mode: 'pos',
      phone: customer?.phone ?? '',
      clientName: customer?.name ?? '',
      studioId,
      prefillSlugs: event.selectedOptions.map(option => ({
        slug: option.option_slug,
        quantity: option.quantity,
      })),
      retouchConfig: event.retouchConfig,
    };

    import('../payment-dialog/payment-dialog.component').then(m => {
      this.dialog.open(m.PaymentDialogComponent, {
        width: 'calc(100vw - 24px)',
        maxWidth: '100vw',
        height: 'calc(100vh - 24px)',
        maxHeight: '100vh',
        panelClass: 'payment-dialog-panel',
        data,
      }).afterClosed().subscribe((result: PaymentDialogResult | undefined) => {
        this.handlePricingPaymentDialogResult(result);
      });
    });
  }

  private handlePricingPaymentDialogResult(result: PaymentDialogResult | undefined): void {
    if (!result || !this.isReceiptPaymentDialogResult(result)) return;

    if (typeof result.amount === 'number' && result.amount > 0) {
      this.shiftService.updateShiftAfterReceipt(result.amount);
    } else {
      const employeeId = this.authService.currentUser()?.id;
      if (employeeId) this.shiftService.checkCurrentShift(employeeId);
    }

    this.soundService.play('receipt_success');
    this.loadCommission();
    this.mobileView.set('catalog');
  }

  private isReceiptPaymentDialogResult(
    result: PaymentDialogResult,
  ): result is Extract<PaymentDialogResult, { readonly type: 'posReceipt' | 'cash' | 'transfer' | 'card' | 'sbp' | 'subscription' }> {
    return (
      result.type === 'posReceipt'
      || result.type === 'cash'
      || result.type === 'transfer'
      || result.type === 'card'
      || result.type === 'sbp'
      || result.type === 'subscription'
    );
  }

  private loadConsumablePreview(selectedOptions: { option_slug: string; quantity: number }[]): void {
    if (this.consumableDebounceTimer) clearTimeout(this.consumableDebounceTimer);

    this.consumableDebounceTimer = setTimeout(() => {
      const items = selectedOptions
        .map(so => {
          const id = this.resolveOptionSlugToId(so.option_slug);
          return id ? { option_id: id, quantity: so.quantity } : null;
        })
        .filter((i): i is { option_id: string; quantity: number } => i !== null);

      if (items.length === 0) {
        this.consumablePreview.set([]);
        return;
      }

      this.consumablePreviewLoading.set(true);
      this.posApi.previewConsumables(items).subscribe({
        next: (lines) => {
          this.consumablePreview.set(lines);
          this.consumablePreviewLoading.set(false);
        },
        error: () => {
          this.consumablePreview.set([]);
          this.consumablePreviewLoading.set(false);
        },
      });
    }, 300);
  }

  private resolveOptionSlugToId(slug: string): string | null {
    for (const cat of this.pricingCategories()) {
      for (const group of cat.optionGroups) {
        const opt = group.options.find(o => o.slug === slug);
        if (opt) return opt.id;
      }
    }
    return null;
  }

  private resolvePricingOrderItems(
    order: OrderSelectedEvent,
    categories: PricingCategory[],
  ): { serviceOptionId: string; quantity: number }[] {
    const category = categories.find(cat => cat.slug === order.categorySlug);
    if (!category) return [];

    return order.selectedOptions
      .map(selected => {
        const option = category.optionGroups
          .flatMap(group => group.options)
          .find(opt => opt.slug === selected.option_slug);
        return option ? { serviceOptionId: option.id, quantity: selected.quantity } : null;
      })
      .filter((item): item is { serviceOptionId: string; quantity: number } => item !== null);
  }

  private recalculatePendingPricing(
    order: OrderSelectedEvent,
    categories: PricingCategory[],
    customerPhone: string | null,
    promo: string | null,
  ): void {
    const items = this.resolvePricingOrderItems(order, categories);
    if (items.length === 0) {
      this.pendingPricingWaterfall.set(null);
      this.pendingPricingLoading.set(false);
      this.pendingPricingError.set('Не удалось сопоставить услугу с прайсом');
      return;
    }

    const requestId = ++this.pendingPricingRequestId;
    this.pricingApi.calculateV2({
      items,
      channel: 'pos',
      customerPhone: customerPhone ?? undefined,
      promoCode: promo ?? undefined,
      applyVolumeDiscount: this.posService.volumeDiscountRequested() || undefined,
    }).then(response => {
      if (requestId !== this.pendingPricingRequestId) return;
      this.pendingPricingWaterfall.set(response.success ? response : null);
      this.pendingPricingError.set(response.success ? null : 'Не удалось пересчитать цену');
      this.pendingPricingLoading.set(false);
    }).catch(() => {
      if (requestId !== this.pendingPricingRequestId) return;
      this.pendingPricingWaterfall.set(null);
      this.pendingPricingError.set('Не удалось пересчитать цену');
      this.pendingPricingLoading.set(false);
    });
  }

  /** Reverse lookup: serviceOptionId → product_id */
  private resolveServiceOptionToProductId(serviceOptionId: string): string | null {
    for (const cat of this.pricingCategories()) {
      for (const group of cat.optionGroups) {
        const opt = group.options.find(o => o.id === serviceOptionId);
        if (opt?.product_id) return opt.product_id;
      }
    }
    return null;
  }

  async processPricingPayment(method: 'cash' | 'card' | 'sbp' | 'transfer'): Promise<void> {
    if (method === 'sbp') {
      await this.processPricingSbp();
      return;
    }

    const order = this.pendingPricingOrder();
    const initialShift = this.shiftService.shift();
    const user = this.authService.currentUser();
    if (!order || !user?.id) return;

    const studioId = initialShift?.studio_id ?? this.selectedStudioId;
    if (!studioId) {
      this.snackBar.open('Выберите студию для создания чека', '', { duration: 3000 });
      return;
    }

    if (this.pendingPricingLoading() || this.pendingPricingError()) return;

    const paymentTotal = this.pendingPricingTotal();
    if (method === 'transfer') {
      const transferReceived = await this.confirmTransferReceived(paymentTotal);
      if (!transferReceived) return;
    }

    if (method === 'cash' || method === 'card') {
      const ready = await this.ensureFiscalShiftReadyForPayment(method, studioId);
      if (!ready) return;
    }

    const s = this.shiftService.shift();
    const receiptStudioId = s?.studio_id ?? studioId;
    this.pricingPaymentProcessing.set(true);

    const payments: PosReceiptPayment[] = [
      { payment_type: method, amount: paymentTotal },
    ];

    const customer = this.posService.customer();

    const createPricingReceiptRequest = () => this.posApi.createFromPricing({
      category_slug: order.categorySlug,
      selected_options: order.selectedOptions,
      delivery_method: order.deliveryMethod,
      shift_id: s?.id,
      employee_id: user.id,
      studio_id: receiptStudioId,
      customer_phone: customer?.phone,
      customer_name: customer?.name,
      loyalty_profile_id: customer?.loyalty?.id,
      payments,
      promo_code: this.promoCode() ?? undefined,
      apply_volume_discount: this.posService.volumeDiscountRequested() || undefined,
      fiscal_required: this.receiptPaymentsRequireFiscal(payments),
      retouch_config: order.retouchConfig,
    });

    if (method === 'card') {
      try {
        const bridgeResult = await startAndWaitForBridgePayment(this.posApi, {
          amount: paymentTotal,
          orderId: `POS-SVC-${Date.now()}`,
          studioId: receiptStudioId,
          // Прайс-параметры для order-first: бэк сам считает состав через
          // buildPricingReceiptItems и персистит snapshot до списания. Те же
          // данные, что уйдут в createFromPricing на материализации чека.
          pricing: {
            category_slug: order.categorySlug,
            selected_options: order.selectedOptions,
            delivery_method: order.deliveryMethod,
            promo_code: this.promoCode() ?? undefined,
            customer_phone: customer?.phone,
            loyalty_profile_id: customer?.loyalty?.id,
            apply_volume_discount: this.posService.volumeDiscountRequested() || undefined,
          },
        });
        payments[0] = {
          ...payments[0],
          transaction_id: bridgeResult.transactionId,
          card_info: bridgeResult.cardInfo,
        };
        this.createApprovedCardReceipt(
          createPricingReceiptRequest,
          { transactionId: bridgeResult.transactionId, studioId: receiptStudioId },
          value => this.pricingPaymentProcessing.set(value),
          receipt => this.completePricingReceipt(receipt, payments),
        );
      } catch (err) {
        this.pricingPaymentProcessing.set(false);
        this.handleCardPaymentFailure(err, receiptStudioId);
      }
    } else {
      createPricingReceiptRequest().subscribe({
        next: receipt => this.completePricingReceipt(receipt, payments),
        error: error => this.handlePricingReceiptError(error),
      });
    }
  }

  private completePricingReceipt(receipt: PosReceipt, payments: readonly PosReceiptPayment[]): void {
    this.pricingPaymentProcessing.set(false);
    this.pendingPricingOrder.set(null);
    this.shiftService.updateShiftAfterReceipt(receipt.total);
    this.loadCommission();
    this.handleReceiptCreatedFeedback(receipt, this.receiptPaymentsRequireFiscal(payments));
    this.mobileView.set('catalog');
  }

  private handlePricingReceiptError(error: unknown): void {
    this.pricingPaymentProcessing.set(false);
    this.soundService.play('receipt_error');
    this.snackBar.open(
      `Ошибка: ${employeeApiErrorMessage(error, 'Не удалось создать чек')}`,
      'OK',
      { duration: 5000 },
    );
  }

  /**
   * Обработка провала оплаты картой до создания чека. Различаем:
   * - in_doubt (таймаут/обрыв op1): чек НЕ помечаем failed, заказ остаётся в работе,
   *   деньги могли списаться → предупреждаем и обновляем список зависших оплат;
   * - явный отказ терминала: обычная ошибка.
   */
  private handleCardPaymentFailure(error: unknown, studioId: string): void {
    if (isInDoubtPaymentError(error)) {
      this.soundService.play('receipt_error');
      this.snackBar.open(
        IN_DOUBT_PAYMENT_MESSAGE,
        'OK',
        { duration: 15000, panelClass: 'snackbar-warning' },
      );
      this.loadInDoubtPayments(studioId);
      return;
    }

    this.snackBar.open(
      `Ошибка терминала: ${error instanceof Error ? error.message : 'Нет связи'}`,
      'OK',
      { duration: 5000 },
    );
  }

  private async processPricingSbp(): Promise<void> {
    const order = this.pendingPricingOrder();
    const initialShift = this.shiftService.shift();
    const user = this.authService.currentUser();
    if (!order || !user?.id) return;

    const studioId = initialShift?.studio_id ?? this.selectedStudioId;
    if (!studioId) {
      this.snackBar.open('Выберите студию для создания чека', '', { duration: 3000 });
      return;
    }

    if (this.pendingPricingLoading() || this.pendingPricingError()) return;

    const ready = await this.ensureFiscalShiftReadyForPayment('sbp', studioId);
    if (!ready) return;

    const s = this.shiftService.shift();
    const receiptStudioId = s?.studio_id ?? studioId;
    this.pricingPaymentProcessing.set(true);
    const paymentTotal = this.pendingPricingTotal();

    const sbpCartItems: CartItem[] = [{
      service: {
        id: `pos-svc-${Date.now()}`,
        name: order.categorySlug,
        description: '',
        price: paymentTotal,
        icon: '',
      },
      quantity: 1,
    }];

    const orderId = `POS-SVC-${Date.now()}`;

    try {
      const result = await this.cloudPayments.paySbp(
        orderId,
        sbpCartItems,
        undefined,
        this.posService.customer()?.phone || undefined,
      );

      if (!result.success) {
        this.pricingPaymentProcessing.set(false);
        this.snackBar.open(result.error || 'СБП не завершён', 'OK', { duration: 5000 });
        return;
      }

      const customer = this.posService.customer();
      const payments: PosReceiptPayment[] = [
        { payment_type: 'sbp', amount: paymentTotal, transaction_id: result.transactionId?.toString() },
      ];

      this.posApi.createFromPricing({
        category_slug: order.categorySlug,
        selected_options: order.selectedOptions,
        delivery_method: order.deliveryMethod,
        shift_id: s?.id,
        employee_id: user.id,
        studio_id: receiptStudioId,
        customer_phone: customer?.phone,
        customer_name: customer?.name,
        loyalty_profile_id: customer?.loyalty?.id,
        payments,
        promo_code: this.promoCode() ?? undefined,
        apply_volume_discount: this.posService.volumeDiscountRequested() || undefined,
        fiscal_required: true,
        retouch_config: order.retouchConfig,
      }).subscribe({
        next: (receipt) => {
          this.pricingPaymentProcessing.set(false);
          this.pendingPricingOrder.set(null);
          this.shiftService.updateShiftAfterReceipt(receipt.total);
          this.loadCommission();
          this.handleReceiptCreatedFeedback(receipt, true);
          this.mobileView.set('catalog');
        },
        error: (err: { error?: { error?: string } }) => {
          this.pricingPaymentProcessing.set(false);
          this.soundService.play('receipt_error');
          this.snackBar.open(
            `Ошибка: ${err.error?.error || 'Не удалось создать чек'}`,
            'OK',
            { duration: 5000 },
          );
        },
      });
    } catch {
      this.pricingPaymentProcessing.set(false);
      this.snackBar.open('СБП не завершён', 'OK', { duration: 5000 });
    }
  }

  // ===== ОПЛАТА =====

  private receiptDiscountTotal(): number {
    const wf = this.posService.waterfallResult();
    if (!wf) return this.posService.discountTotal();

    const itemDiscounts = wf.items.reduce((sum, item) => sum + item.discountAmount, 0);
    const globalDiscounts = (wf.discounts.subscriber?.amount ?? 0)
      + (wf.discounts.account?.amount ?? 0)
      + (wf.discounts.promo?.amount ?? 0)
      + (wf.discounts.partner?.amount ?? 0);

    return Math.round((this.posService.discountTotal() + itemDiscounts + globalDiscounts) * 100) / 100;
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

  private fiscalPaymentMethod(method: PaymentMethod): 'cash' | 'card' | 'sbp' | null {
    if (method === 'cash' || method === 'card' || method === 'sbp') return method;
    if (method !== 'subscription' || this.remainderAfterSubscription() <= 0) return null;
    const remainderMethod = this._splitRemainderMethod ?? 'cash';
    return remainderMethod === 'cash' || remainderMethod === 'card' || remainderMethod === 'sbp'
      ? remainderMethod
      : null;
  }

  private receiptPaymentsRequireFiscal(payments: readonly PosReceiptPayment[]): boolean {
    return paymentsRequireFiscal(payments);
  }

  private handleReceiptCreatedFeedback(receipt: PosReceipt, fiscalRequired: boolean): void {
    if (!fiscalRequired) {
      this.soundService.play('receipt_success');
      this.snackBar.open(createdReceiptMessage({
        receiptNumber: receipt.receipt_number,
        total: receipt.total,
        fiscalRequired: false,
      }), 'OK', { duration: 4000 });
      return;
    }

    if (receipt.fiscal_status === 'success') {
      this.showFiscalSuccessSnack(receipt.id, receipt.receipt_number);
      return;
    }
    if (receipt.fiscal_status === 'failed') {
      this.showFiscalFailureSnack(receipt.id, receipt.receipt_number, receipt.fiscal_last_error ?? null);
      return;
    }

    this.snackBar.open(createdReceiptMessage({
      receiptNumber: receipt.receipt_number,
      total: receipt.total,
      fiscalRequired: true,
    }), 'OK', { duration: 7000, panelClass: 'snackbar-warning' });

    this.watchFiscalStatus(receipt.id, receipt.receipt_number);
  }

  private watchFiscalStatus(receiptId: string, receiptNumber: string): void {
    if (this.fiscalStatusWatchIds.has(receiptId)) return;
    this.fiscalStatusWatchIds.add(receiptId);

    timer(1200, 1500).pipe(
      switchMap(() => this.posApi.getFiscalStatus(receiptId).pipe(
        catchError(() => EMPTY),
      )),
      take(16),
      takeWhile(status => !isFinalFiscalStatus(status.fiscal_status), true),
      finalize(() => this.fiscalStatusWatchIds.delete(receiptId)),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(status => {
      if (status.fiscal_status === 'success') {
        this.showFiscalSuccessSnack(receiptId, receiptNumber);
        return;
      }

      if (status.fiscal_status === 'failed') {
        this.showFiscalFailureSnack(receiptId, receiptNumber, status.fiscal_last_error);
      }
    });
  }

  private showFiscalSuccessSnack(receiptId: string, receiptNumber: string): void {
    if (!this.rememberFiscalNotification(`${receiptId}:success`)) return;
    this.soundService.play('receipt_success');
    this.snackBar.open(
      `Чек №${receiptNumber} фискализирован`,
      'OK',
      { duration: 5000, panelClass: 'snackbar-success' },
    );
  }

  private showFiscalFailureSnack(receiptId: string, receiptNumber: string, errorMessage: string | null): void {
    const message = fiscalFailureEmployeeMessage(errorMessage);
    const notificationKey = `${receiptId}:failed:${message}`;
    if (!this.rememberFiscalNotification(notificationKey)) return;

    this.soundService.play('receipt_error');
    const ref = this.snackBar.open(
      `Чек ${receiptNumber}: ${message}`,
      'Повторить',
      { duration: 15000, panelClass: 'snackbar-error' },
    );
    ref.onAction().subscribe(() => {
      this.fiscalNotificationKeys.delete(notificationKey);
      this.posApi.retryFiscal(receiptId).subscribe({
        next: () => {
          this.snackBar.open(
            `Повтор фискализации отправлен: чек ${receiptNumber}`,
            'OK',
            { duration: 4000 },
          );
          this.watchFiscalStatus(receiptId, receiptNumber);
        },
        error: () => {
          this.snackBar.open(
            `Не удалось отправить повтор фискализации: чек ${receiptNumber}`,
            'OK',
            { duration: 5000, panelClass: 'snackbar-error' },
          );
        },
      });
    });
  }

  private rememberFiscalNotification(key: string): boolean {
    if (this.fiscalNotificationKeys.has(key)) return false;
    this.fiscalNotificationKeys.add(key);
    setTimeout(() => this.fiscalNotificationKeys.delete(key), 60000);
    return true;
  }

  private async ensureFiscalShiftReadyForPayment(method: 'cash' | 'card' | 'sbp', studioId: string): Promise<boolean> {
    const shift = this.shiftService.shift();
    if (shift?.fiscal_status?.ready === true) return true;
    if (shift && shift.fiscal_status?.available !== true) {
      const message = method === 'cash'
        ? 'Наличные с фискализацией требуют настроенный фискальный регистратор на этой точке'
        : 'Карта и СБП требуют настроенный фискальный регистратор на этой точке';
      this.snackBar.open(message, 'OK', {
        duration: 6000,
      });
      return false;
    }

    const studioName = shift
      ? this.shiftService.studioName()
      : this.studioService.studioName(studioId);
    const confirmed = await firstValueFrom(this.dialog.open(PosFiscalShiftRequiredDialogComponent, {
      width: '440px',
      maxWidth: 'calc(100vw - 24px)',
      data: {
        mode: shift ? 'open-fiscal' : 'open-pos-and-fiscal',
        paymentLabel: method === 'cash'
          ? 'наличными с фискализацией'
          : method === 'card'
            ? 'картой'
            : 'по СБП',
        studioName: studioName || 'выбранная точка',
      },
    }).afterClosed());

    if (confirmed !== true) return false;
    return shift
      ? await this.shiftService.openFiscalShiftForPayment()
      : await this.shiftService.openShiftWithFiscalForPayment(studioId);
  }

  async processPayment(method: PaymentMethod): Promise<void> {
    const user = this.authService.currentUser();
    if (!user?.id || this.posService.isEmpty()) return;

    // Studio: from shift or from selectedStudioId (shift-less mode)
    const initialShift = this.shiftService.shift();
    const studioId = initialShift?.studio_id ?? this.selectedStudioId;
    if (!studioId) {
      this.snackBar.open('Выберите студию для создания чека', '', { duration: 3000 });
      return;
    }

    if (!this.ensureChatDecisionBeforePayment()) {
      if (method === 'subscription') this._splitRemainderMethod = null;
      return;
    }

    const customer = this.posService.customer();
    const savings = this.subscriptionSavings();
    const remainder = this.remainderAfterSubscription();
    const isSubscriptionPayment = method === 'subscription' && savings > 0;
    const wf = this.posService.waterfallResult();
    const loyaltyDisc = wf?.discounts.loyalty?.amount ?? this.loyaltyDiscount();
    const loyaltyPointsUsed = wf?.discounts.loyalty?.points_used ?? this.loyaltyDiscount();
    const wfTotal = wf?.total;
    // waterfall total уже включает loyalty — не вычитать повторно
    const effectiveTotal = Math.max(0, wfTotal ?? (this.posService.total() - loyaltyDisc));
    const transferConfirmationAmount = method === 'transfer'
      ? effectiveTotal
      : isSubscriptionPayment && remainder > 0 && (this._splitRemainderMethod ?? 'cash') === 'transfer'
        ? remainder
        : 0;

    if (transferConfirmationAmount > 0) {
      const transferReceived = await this.confirmTransferReceived(transferConfirmationAmount);
      if (!transferReceived) {
        if (method === 'subscription') this._splitRemainderMethod = null;
        return;
      }
    }

    const fiscalMethod = this.fiscalPaymentMethod(method);
    if (fiscalMethod) {
      const ready = await this.ensureFiscalShiftReadyForPayment(fiscalMethod, studioId);
      if (!ready) {
        if (method === 'subscription') this._splitRemainderMethod = null;
        return;
      }
    }

    const s = this.shiftService.shift();
    const receiptStudioId = s?.studio_id ?? studioId;
    this.paymentProcessing.set(true);

    const items = this.posService.getReceiptItems().map(item => {
      if (isSubscriptionPayment) {
        const cov = this.subscriptionCoverage().find(c => c.productId === item.product_id);
        if (cov) {
          return { ...item, subscription_credits_used: cov.savedAmount };
        }
      }
      return item;
    });

    const payments: PosReceiptPayment[] = [];
    if (isSubscriptionPayment && savings > 0) {
      payments.push({ payment_type: 'subscription', amount: savings });
      if (remainder > 0) {
        const remainderMethod = this._splitRemainderMethod ?? 'cash';
        payments.push({ payment_type: remainderMethod, amount: remainder });
        this._splitRemainderMethod = null;
      }
    } else {
      payments.push({ payment_type: method as PosReceiptPayment['payment_type'], amount: effectiveTotal });
    }

    const receiptData = {
      shift_id: s?.id,
      employee_id: user.id,
      studio_id: receiptStudioId,
      customer_phone: customer?.phone,
      customer_name: customer?.name,
      loyalty_profile_id: customer?.loyalty?.id,
      subscription_id: customer?.subscription?.id,
      items,
      payments,
      subtotal: this.posService.subtotal(),
      discount_total: this.receiptDiscountTotal(),
      points_discount: this.posService.pointsTotal() + loyaltyDisc,
      subscription_credit_used: isSubscriptionPayment ? savings : 0,
      total: effectiveTotal,
      promo_code: this.promoCode() ?? undefined,
      loyalty_points_to_use: loyaltyPointsUsed,
      fiscal_required: this.receiptPaymentsRequireFiscal(payments),
    };

    const cardPaymentIndex = payments.findIndex(payment => payment.payment_type === 'card');
    const sbpPaymentIndex = payments.findIndex(payment => payment.payment_type === 'sbp');

    if (cardPaymentIndex >= 0) {
      const cardPayment = payments[cardPaymentIndex];
      if (!cardPayment) {
        this.paymentProcessing.set(false);
        this.snackBar.open('Не удалось подготовить оплату картой', 'OK', { duration: 5000 });
        return;
      }
      const cardAmount = cardPayment.amount;
      try {
        const bridgeResult = await startAndWaitForBridgePayment(this.posApi, {
          amount: cardAmount,
          orderId: `POS-${Date.now()}`,
          studioId: receiptStudioId,
          // Снимок корзины: при зависшей оплате (in_doubt) чек допробивается без
          // потери позиций и без повторного списания. studioId/source нужны бэку,
          // чтобы канонизировать и персистить состав до списания (order-first).
          snapshot: {
            items,
            subtotal: receiptData.subtotal,
            discount_total: receiptData.discount_total,
            total: receiptData.total,
            shiftId: receiptData.shift_id,
            studioId: receiptStudioId,
            customerPhone: receiptData.customer_phone,
            customerName: receiptData.customer_name,
            loyaltyProfileId: receiptData.loyalty_profile_id,
            source: 'cart',
          },
        });
        payments[cardPaymentIndex] = {
          ...cardPayment,
          transaction_id: bridgeResult.transactionId,
          card_info: bridgeResult.cardInfo,
        };
        this.createApprovedCardReceipt(
          () => this.posApi.createReceipt(receiptData),
          { transactionId: bridgeResult.transactionId, studioId: receiptStudioId },
          value => this.paymentProcessing.set(value),
          receipt => this.completePosReceipt(receipt, receiptData),
        );
      } catch (err) {
        this.paymentProcessing.set(false);
        this.handleCardPaymentFailure(err, receiptStudioId);
      }
    } else if (sbpPaymentIndex >= 0) {
      const sbpPayment = payments[sbpPaymentIndex];
      if (!sbpPayment) {
        this.paymentProcessing.set(false);
        this.snackBar.open('Не удалось подготовить оплату СБП', 'OK', { duration: 5000 });
        return;
      }
      const sbpAmount = sbpPayment.amount;
      const sbpCartItems: CartItem[] = [{
        service: {
          id: `pos-${Date.now()}`,
          name: items.map(i => i.product_name).join(', ').substring(0, 100) || 'POS оплата',
          description: '',
          price: sbpAmount,
          icon: '',
        },
        quantity: 1,
      }];
      const orderId = `POS-${Date.now()}`;

      this.cloudPayments.paySbp(
        orderId,
        sbpCartItems,
        undefined,
        customer?.phone || undefined,
      ).then(result => {
        if (result.success) {
          payments[sbpPaymentIndex] = {
            ...sbpPayment,
            transaction_id: result.transactionId?.toString(),
          };
          this.createReceipt(receiptData);
        } else {
          this.paymentProcessing.set(false);
          this.snackBar.open(result.error || 'СБП не завершён', 'OK', { duration: 5000 });
        }
      }).catch(() => {
        this.paymentProcessing.set(false);
        this.snackBar.open('СБП не завершён', 'OK', { duration: 5000 });
      });
    } else {
      this.createReceipt(receiptData);
    }
  }

  processSplitPayment(event: SplitPaymentEvent): void {
    this._splitRemainderMethod = event.remainderMethod;
    this.processPayment('subscription');
  }

  private notifyLinkedChatAboutReceipt(
    receipt: PosReceipt,
    data: PosReceiptCreateRequest,
    linkedSessionId: string,
    linkedSessionName: string | null,
  ): void {
    const method = this.primaryReceiptChatPaymentMethod(data.payments ?? []);
    if (!method) return;

    const cartDetails = this.buildManualChatCartDetails(data);
    const body: ManualChatPaymentRequest = {
      sessionId: linkedSessionId,
      amount: receipt.total,
      method,
      ...(method === 'cash' ? { fiscalMode: data.fiscal_required === true ? 'fiscal' : 'skip' } : {}),
      receiptId: receipt.id,
      receiptNumber: receipt.receipt_number,
      ...(data.customer_phone ? { phone: data.customer_phone } : {}),
      ...(data.customer_name || linkedSessionName ? { clientName: data.customer_name ?? linkedSessionName ?? undefined } : {}),
      ...(cartDetails ? { cartDetails } : {}),
    };

    this.http.post<{ success: boolean }>('/api/payments/manual-chat-payment', body).pipe(
      catchError(() => of({ success: false })),
      take(1),
    ).subscribe(response => {
      if (response.success !== true) {
        this.snackBar.open('Чек создан, но сообщение в чат не отправилось', 'OK', { duration: 5000 });
      }
    });
  }

  private buildManualChatCartDetails(data: PosReceiptCreateRequest): PaymentCartDetails | undefined {
    const lines = (data.items ?? []).map(item => {
      const discountAmount = Math.max(
        0,
        item.discount_amount + item.points_used + item.subscription_credits_used,
      );

      return {
        name: item.product_name,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        total: item.total,
        priceNote: null,
        discountLabel: item.discount_label ?? (item.discount_percent > 0 ? `Скидка ${item.discount_percent}%` : null),
        discountAmount,
      };
    });

    if (lines.length === 0) return undefined;

    return {
      lines,
      subtotal: data.subtotal,
      savings: lines.reduce((sum, line) => sum + line.discountAmount, 0),
    };
  }

  private primaryReceiptChatPaymentMethod(payments: readonly PosReceiptPayment[]): ReceiptChatPaymentMethod | null {
    for (const payment of payments) {
      if (this.isReceiptChatPaymentMethod(payment.payment_type)) {
        return payment.payment_type;
      }
    }
    return null;
  }

  private isReceiptChatPaymentMethod(
    method: PosReceiptPayment['payment_type'],
  ): method is ReceiptChatPaymentMethod {
    return method === 'cash' || method === 'card' || method === 'transfer' || method === 'sbp';
  }

  private createReceipt(data: PosReceiptCreateRequest): void {
    this.posApi.createReceipt(data).subscribe({
      next: receipt => this.completePosReceipt(receipt, data),
      error: error => this.handlePosReceiptCreateError(error, data),
    });
  }

  private completePosReceipt(receipt: PosReceipt, data: PosReceiptCreateRequest): void {
    const linkedSessionId = this.linkedChatSessionId();
    const linkedSessionName = this.linkedChatSessionName();

    this.paymentProcessing.set(false);
    this.posService.clear();
    this.customerService.clear();
    this.loyaltyPointsToUse.set(0);
    this.resetChatBindingPrompt();

    this.shiftService.updateShiftAfterReceipt(receipt.total);
    this.loadCommission();

    this.handleReceiptCreatedFeedback(receipt, data.fiscal_required === true);
    if (linkedSessionId) {
      this.notifyLinkedChatAboutReceipt(receipt, data, linkedSessionId, linkedSessionName);
    }

    const prodItems = (data.items || []).filter((i: { product_name: string }) => this.isProductionItem(i.product_name));
    if (prodItems.length > 0) {
      this.showProductionPrompt.set({
        receiptId: receipt.id,
        receiptItems: prodItems.map((i: { product_name: string; quantity: number; unit_price: number; total: number }) => ({
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.total,
        })),
      });
    }

    const printItems = (data.items || [])
      .filter((i: { product_name: string }) => this.isPrintItem(i.product_name))
      .map((i: { product_name: string; quantity: number }) => ({
        product_name: i.product_name,
        quantity: i.quantity || 1,
      }));
    if (printItems.length > 0) {
      this.showPrintPrompt.set({ receiptId: receipt.id, items: printItems });
    }

    this.mobileView.set('catalog');
  }

  private handlePosReceiptCreateError(error: unknown, data: PosReceiptCreateRequest): void {
    this.paymentProcessing.set(false);
    this.soundService.play('receipt_error');

    const isNetworkError = !navigator.onLine || this.httpStatus(error) === 0;
    if (isNetworkError) {
      const token = this.authService.token() ?? '';
      const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
      const label = `${data.total}\u20BD \u00B7 ${time}`;
      this.offlineQueue.enqueuePosReceipt(data, token, label).then(() => {
        this.posService.clear();
        this.customerService.clear();
        this.resetChatBindingPrompt();
        const s = this.shiftService.shift();
        if (s) {
          this.shiftService.updateShiftAfterReceipt(0);
          // Increment count only without sales amount for offline
          this.shiftService.shift.set({ ...s, receipt_count: s.receipt_count + 1 });
        }
        this.snackBar.open(
          `Офлайн-чек сохранён \u00B7 ${data.total}\u20BD — синхронизируется при подключении`,
          'OK',
          { duration: 7000 },
        );
        this.mobileView.set('catalog');
      });
      return;
    }

    this.snackBar.open(`Ошибка: ${employeeApiErrorMessage(error, 'Не удалось создать чек')}`, 'OK', { duration: 5000 });
  }

  private createApprovedCardReceipt(
    createReceiptRequest: PosReceiptRequestFactory,
    context: ApprovedCardPaymentContext,
    setProcessing: (value: boolean) => void,
    completeReceipt: (receipt: PosReceipt) => void,
  ): void {
    void this.createApprovedCardReceiptAsync(
      createReceiptRequest,
      context,
      setProcessing,
      completeReceipt,
    );
  }

  private async createApprovedCardReceiptAsync(
    createReceiptRequest: PosReceiptRequestFactory,
    context: ApprovedCardPaymentContext,
    setProcessing: (value: boolean) => void,
    completeReceipt: (receipt: PosReceipt) => void,
  ): Promise<void> {
    setProcessing(true);
    let createdReceipt: PosReceipt | null = null;

    try {
      createdReceipt = await firstValueFrom(createReceiptRequest());
      this.snackBar.open(
        `Оплата одобрена. Пробиваем чек ${createdReceipt.receipt_number} на ККТ.`,
        '',
        { duration: 4000, panelClass: 'snackbar-warning' },
      );

      const fiscalStatus = await waitForReceiptFiscalization(this.posApi, createdReceipt.id, {
        timeoutMs: DEFAULT_RECEIPT_FISCAL_TIMEOUT_MS,
        initialStatus: receiptFiscalInitialStatus(createdReceipt),
      });

      completeReceipt({
        ...createdReceipt,
        fiscal_status: this.toKnownReceiptFiscalStatus(fiscalStatus.fiscal_status) ?? createdReceipt.fiscal_status,
        fiscal_attempts: fiscalStatus.fiscal_attempts,
        fiscal_last_error: fiscalStatus.fiscal_last_error,
      });
    } catch (error) {
      const reason = employeeApiErrorMessage(error, 'Чек не фискализирован');
      if (createdReceipt) {
        this.handleApprovedCardFiscalizationFailure(
          createdReceipt,
          reason,
          setProcessing,
          completeReceipt,
        );
        return;
      }

      await this.attemptApprovedCardPaymentReversal(
        context,
        cardFiscalProblemMessage(reason),
        setProcessing,
      );
    }
  }

  private handleApprovedCardFiscalizationFailure(
    receipt: PosReceipt,
    reason: string,
    setProcessing: (value: boolean) => void,
    completeReceipt: (receipt: PosReceipt) => void,
  ): void {
    setProcessing(false);
    completeReceipt({
      ...receipt,
      fiscal_status: 'failed',
      fiscal_last_error: approvedCardFiscalRetryMessage(reason),
    });
  }

  private async attemptApprovedCardPaymentReversal(
    context: ApprovedCardPaymentContext,
    reasonMessage: string,
    setProcessing: (value: boolean) => void,
  ): Promise<void> {
    setProcessing(true);
    this.soundService.play('receipt_error');
    this.snackBar.open(
      `${reasonMessage} Отправляем отмену оплаты на терминал.`,
      'OK',
      { duration: 10000, panelClass: 'snackbar-error' },
    );

    try {
      const refund = await firstValueFrom(this.posApi.bridgeRefund({
        studioId: context.studioId,
        transactionId: context.transactionId,
      }));
      if (!refund.success || !refund.transactionId) {
        throw new Error('терминал не принял команду отмены');
      }

      await waitForBridgeTransaction(this.posApi, refund.transactionId, {
        timeoutMs: DEFAULT_BRIDGE_PAYMENT_TIMEOUT_MS,
      });

      setProcessing(false);
      this.snackBar.open(
        'Оплата отменена терминалом. Устраните причину и примите карту заново.',
        'OK',
        { duration: 10000, panelClass: 'snackbar-warning' },
      );
    } catch (error) {
      setProcessing(false);
      this.snackBar.open(
        `${reasonMessage} Автоматическая отмена оплаты не подтверждена: ${employeeApiErrorMessage(error, 'терминал не подтвердил отмену оплаты')}. Не запускайте оплату повторно; вставьте бумагу и проверьте операцию в Т-Бизнесе.`,
        'OK',
        { duration: 15000, panelClass: 'snackbar-error' },
      );
    }
  }

  private toKnownReceiptFiscalStatus(status: string): PosReceipt['fiscal_status'] {
    switch (status) {
      case 'pending':
      case 'queued':
      case 'processing':
      case 'success':
      case 'failed':
      case 'skipped':
        return status;
      default:
        return undefined;
    }
  }

  private httpStatus(error: unknown): number | null {
    if (typeof error !== 'object' || error === null || !('status' in error)) return null;
    const status = error.status;
    return typeof status === 'number' ? status : null;
  }

  private readonly PRINT_KEYWORDS = [
    'фото', 'печать', 'print', 'копи', 'скан', 'документ', 'a4', 'a3', '10x15', '13x18',
  ];

  private isPrintItem(name: string): boolean {
    const lower = name.toLowerCase();
    return this.PRINT_KEYWORDS.some(kw => lower.includes(kw));
  }

  private readonly PRODUCTION_KEYWORDS = [
    'холст', 'canvas', 'натяж', 'подрамник', 'фотокниг', 'книг', 'альбом',
    'календар', 'плакат', 'poster', 'баннер', 'широкоформат',
    'кружк', 'магнит', 'пазл', 'подушк', 'визитк', 'листовк', 'буклет',
  ];

  private isProductionItem(name: string): boolean {
    const lower = name.toLowerCase();
    return this.PRODUCTION_KEYWORDS.some(kw => lower.includes(kw));
  }

  openSendToProduction(): void {
    const prompt = this.showProductionPrompt();
    if (!prompt) return;

    import('./send-to-production-dialog-lazy').then(m => {
      this.dialog.open(m.SendToProductionDialogComponent, {
        width: '700px',
        data: {
          source: 'pos' as const,
          receiptId: prompt.receiptId,
          receiptItems: prompt.receiptItems,
        },
      });
      this.showProductionPrompt.set(null);
    });
  }

  dismissProductionPrompt(): void {
    this.showProductionPrompt.set(null);
  }

  async openPrintFromReceipt(): Promise<void> {
    const prompt = this.showPrintPrompt();
    if (!prompt) return;
    this.showPrintPrompt.set(null);

    const { PrintDialogComponent } = await import(
      '../print-dialog/print-dialog.component'
    );

    this.dialog.open(
      PrintDialogComponent,
      printDialogConfig({
        file_url: '',
        file_name: prompt.items.map(i => i.product_name).join(', '),
        receipt_id: prompt.receiptId,
        preferred_printer_type: 'photo' as const,
        default_priority: 9,
      }),
    );
  }

  // ===== RECEIPT JOURNAL =====

  openReceiptJournal(initialFilter?: 'all' | 'sales' | 'refunds' | 'failed' | 'in_doubt' | 'orphan'): void {
    const s = this.shiftService.shift();
    if (!s) return;

    import('./dialogs/pos-receipt-journal-dialog.component').then(m => {
      const ref = this.dialog.open(m.PosReceiptJournalDialogComponent, {
        width: '1080px',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 24px)',
        data: { shiftId: s.id, studioId: s.studio_id, initialFilter },
      });
      // После разбора зависших/осиротевших оплат в журнале обновляем баннеры.
      ref.afterClosed().subscribe(() => {
        this.loadInDoubtPayments(s.studio_id);
        this.loadOrphanPayments(s.studio_id);
      });
    });
  }

  // ===== COMMISSION =====

  private loadCommission(): void {
    this.salesApi.getDashboard().subscribe({
      next: (d) => this.todayCommission.set(d.total_commission),
      error: () => this.todayCommission.set(null),
    });
  }

  // ===== PROMO =====

  onPromoApplied(event: PromoAppliedEvent): void {
    this.promoCode.set(event.code);
  }

  onPromoRemoved(): void {
    this.promoCode.set(null);
  }

  // ===== LOYALTY =====

  toggleLoyalty(): void {
    if (this.loyaltyPointsToUse() > 0) {
      this.loyaltyPointsToUse.set(0);
    } else {
      const maxPoints = this.loyaltyMaxPointsToUse();
      if (maxPoints <= 0) {
        this.snackBar.open(this.loyaltyUnavailableReason() ?? 'Бонусы недоступны', 'OK', { duration: 3000 });
        return;
      }
      this.loyaltyPointsToUse.set(maxPoints);
    }
  }

  private isA3PhotoPrintProduct(product: Product): boolean {
    return this.isA3PhotoPrintText([
      product.name,
      product.code ?? '',
      product.category_name ?? '',
    ].join(' '));
  }

  private isA3PhotoPrintWaterfallItem(item: WaterfallItem): boolean {
    return this.isA3PhotoPrintText(`${item.slug} ${item.name}`);
  }

  private isA3PhotoPrintText(value: string): boolean {
    const text = value.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
    const isPhoto = text.includes('фото') || text.includes('photo');
    const hasA3 = /(^|[^a-zа-я0-9])(a3|а3)([^a-zа-я0-9]|$)/i.test(text)
      || /(^|[^0-9])(29[,.]?7|30)\s*[xх]\s*(42|40)([^0-9]|$)/i.test(text);
    return isPhoto && hasA3;
  }
}
