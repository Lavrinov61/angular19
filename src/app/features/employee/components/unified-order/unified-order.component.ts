import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  effect,
  untracked,
  input,
  output,
  PLATFORM_ID,
  DestroyRef,
  type OnInit,
  viewChild,
  ElementRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatRippleModule } from '@angular/material/core';
import { MatDialogRef } from '@angular/material/dialog';
import { debounceTime, distinctUntilChanged, firstValueFrom, Subject } from 'rxjs';

import { OrdersApiService } from '../../services/orders-api.service';
import { PosApiService } from '../../services/pos-api.service';
import { PosService } from '../../services/pos.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { PaymentsService, PaymentLinkService } from '../../services/payments.service';
import { PriceFormatPipe } from '../payment-dialog/pipes/price-format.pipe';
import { PricingApiService } from '../../../../core/services/pricing-api.service';
import { FileDropzoneComponent } from '../order-wizard/shared/file-dropzone.component';
import type { UploadFile } from '../order-wizard/order-wizard.types';
import type {
  UiCategory,
  UiOptionGroup,
  UiServiceOption,
  ApiCategoriesResponse,
  ApiCategory,
  ApiServiceOption,
} from '../payment-dialog/models/payment-dialog.models';
import { employeeApiErrorMessage } from '../../utils/api-error-message';

// ── Types ────────────────────────────────────────────────────────────────────

type PaymentMethod = 'cash' | 'card' | 'sbp' | 'online' | 'later';

interface CartItem {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly icon: string;
  readonly isManual: boolean;
  readonly optionSlugs: readonly string[];
  readonly categorySlug: string;
  readonly serviceId: string | null;
  quantity: number;
  /** F122: Volume threshold hint text (e.g. "ещё 3 шт и скидка 10%!") */
  volumeHint?: string;
}

interface QuickPreset {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly price: number;
  readonly popular: boolean;
  readonly optionSlugs: readonly string[];
  readonly categorySlug: string;
  readonly categoryName: string;
  readonly serviceId: string;
}

type OrderMode = 'page' | 'dialog' | 'embedded';

// ── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-unified-order',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(keydown)': 'onKeydown($event)',
  },
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatRippleModule,
    PriceFormatPipe,
    FileDropzoneComponent,
  ],
  template: `
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <!-- UNIFIED ORDER — HEADER                                                -->
    <!-- ═══════════════════════════════════════════════════════════════════════ -->
    <div class="uo-shell" [class.uo-dialog-mode]="mode() === 'dialog'" [class.uo-embedded]="mode() === 'embedded'">
      <header class="uo-header">
        <div class="uo-header-left">
          @if (mode() === 'page') {
            <button class="uo-back-btn" (click)="onBack()" matTooltip="Назад">
              <mat-icon>arrow_back</mat-icon>
            </button>
          }
          @if (mode() === 'dialog') {
            <button class="uo-back-btn" (click)="onClose()" matTooltip="Закрыть">
              <mat-icon>close</mat-icon>
            </button>
          }
          <div class="uo-header-title-group">
            <h1 class="uo-title">
              @if (mode() === 'dialog') { Оплата } @else { Новый заказ }
            </h1>
            @if (dialogClientName()) {
              <span class="uo-subtitle">{{ dialogClientName() }}</span>
            }
          </div>
        </div>
        <div class="uo-header-right">
          <button
            class="uo-search-toggle"
            (click)="toggleSearch()"
            matTooltip="Поиск (Ctrl+K)"
          >
            <mat-icon>search</mat-icon>
          </button>
        </div>
      </header>

      <!-- Search overlay -->
      @if (searchOpen()) {
        <div class="uo-search-bar">
          <mat-icon class="uo-search-icon">search</mat-icon>
          <input
            #searchInput
            class="uo-search-input"
            type="text"
            placeholder="Поиск услуги..."
            autocomplete="off"
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            (keydown.escape)="closeSearch()"
          />
          <span class="uo-search-hint">Esc</span>
          @if (searchQuery()) {
            <button class="uo-search-clear" (click)="searchQuery.set(''); focusSearch()">
              <mat-icon>close</mat-icon>
            </button>
          }
        </div>
      }

      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <!-- MAIN CONTENT — TWO COLUMNS                                        -->
      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <div class="uo-content">

        <!-- ── LEFT PANEL: Catalog (скрыт в prepaid flow: корзина зафиксирована ссылкой) ─────────────────────────────────────── -->
        <main class="uo-left" [class.uo-hidden-mobile]="mobileTab() === 'cart'" [hidden]="isPrepaidMode()">

          @if (loading()) {
            <div class="uo-loading">
              <mat-spinner diameter="28" />
              <span>Загрузка каталога...</span>
            </div>
          } @else {

            <!-- Quick Presets -->
            @if (!isSearching() && quickPresets().length > 0) {
              <section class="uo-section">
                <h2 class="uo-section-title">Быстрый выбор</h2>
                <div class="uo-presets-grid">
                  @for (preset of quickPresets(); track preset.id) {
                    <button
                      class="uo-preset-card"
                      matRipple
                      (click)="addPresetToCart(preset)"
                    >
                      <mat-icon class="uo-preset-icon">{{ preset.icon }}</mat-icon>
                      <span class="uo-preset-name">{{ preset.label }}</span>
                      <span class="uo-preset-cat">{{ preset.categoryName }}</span>
                      <span class="uo-preset-price">{{ preset.price | priceFormat }}</span>
                    </button>
                  }
                </div>
              </section>
            }

            <!-- Category Tabs -->
            @if (!isSearching()) {
              <div class="uo-category-tabs">
                <button
                  class="uo-cat-tab"
                  [class.active]="activeCategory() === null"
                  (click)="activeCategory.set(null)"
                >
                  <span class="uo-cat-label">Все</span>
                  <span class="uo-cat-count">{{ totalServiceCount() }}</span>
                </button>
                @for (cat of categories(); track cat.slug) {
                  <button
                    class="uo-cat-tab"
                    [class.active]="activeCategory() === cat.slug"
                    (click)="activeCategory.set(cat.slug)"
                  >
                    <mat-icon class="uo-cat-icon">{{ cat.icon }}</mat-icon>
                    <span class="uo-cat-label">{{ cat.name }}</span>
                    <span class="uo-cat-count">{{ cat.allOptions.length }}</span>
                  </button>
                }
              </div>
            }

            <!-- Service Grid -->
            <div class="uo-services-scroll">
              @if (isSearching()) {
                @if (filteredServices().length === 0) {
                  <div class="uo-empty-search">
                    <mat-icon>search_off</mat-icon>
                    <span>Ничего не найдено</span>
                  </div>
                } @else {
                  <div class="uo-services-grid">
                    @for (svc of filteredServices(); track svc.id) {
                      <button
                        class="uo-service-card"
                        [class.selected]="isInCart(svc.id)"
                        matRipple
                        (click)="toggleService(svc)"
                      >
                        @if (svc.popular) {
                          <span class="uo-popular-badge">HIT</span>
                        }
                        @if (isInCart(svc.id)) {
                          <span class="uo-selected-check">
                            <mat-icon>check</mat-icon>
                          </span>
                        }
                        <div class="uo-svc-header">
                          <mat-icon class="uo-svc-icon">{{ svc.icon }}</mat-icon>
                        </div>
                        <div class="uo-svc-name">{{ svc.name }}</div>
                        @if (svc.features.length > 0) {
                          <div class="uo-svc-features">
                            @for (feat of svc.features.slice(0, 3); track feat) {
                              <span class="uo-feature-chip">{{ feat }}</span>
                            }
                          </div>
                        }
                        <div class="uo-svc-price-row">
                          @if (svc.originalPrice && svc.originalPrice > svc.price) {
                            <span class="uo-old-price">{{ svc.originalPrice | priceFormat }}</span>
                          }
                          <span class="uo-svc-price">{{ svc.price | priceFormat }}</span>
                          @if (svc.priceMax && svc.priceMax > svc.price) {
                            <span class="uo-price-range">&ndash; {{ svc.priceMax | priceFormat }}</span>
                          }
                        </div>
                      </button>
                    }
                  </div>
                }
              } @else {
                @for (section of visibleCategories(); track section.slug) {
                  <div class="uo-catalog-section">
                    <h3 class="uo-catalog-section-title">
                      <mat-icon>{{ section.icon }}</mat-icon>
                      {{ section.name }}
                    </h3>
                    @for (group of section.groups; track group.slug) {
                      @if (section.groups.length > 1) {
                        <h4 class="uo-group-label">{{ group.name }}</h4>
                      }
                      <div class="uo-services-grid">
                        @for (svc of group.options; track svc.id) {
                          <button
                            class="uo-service-card"
                            [class.selected]="isInCart(svc.id)"
                            matRipple
                            (click)="toggleService(svc)"
                          >
                            @if (svc.popular) {
                              <span class="uo-popular-badge">HIT</span>
                            }
                            @if (isInCart(svc.id)) {
                              <span class="uo-selected-check">
                                <mat-icon>check</mat-icon>
                              </span>
                            }
                            <div class="uo-svc-header">
                              <mat-icon class="uo-svc-icon">{{ svc.icon }}</mat-icon>
                            </div>
                            <div class="uo-svc-name">{{ svc.name }}</div>
                            @if (svc.features.length > 0) {
                              <div class="uo-svc-features">
                                @for (feat of svc.features.slice(0, 3); track feat) {
                                  <span class="uo-feature-chip">{{ feat }}</span>
                                }
                              </div>
                            }
                            <div class="uo-svc-price-row">
                              @if (svc.originalPrice && svc.originalPrice > svc.price) {
                                <span class="uo-old-price">{{ svc.originalPrice | priceFormat }}</span>
                              }
                              <span class="uo-svc-price">{{ svc.price | priceFormat }}</span>
                              @if (svc.priceMax && svc.priceMax > svc.price) {
                                <span class="uo-price-range">&ndash; {{ svc.priceMax | priceFormat }}</span>
                              }
                            </div>
                          </button>
                        }
                      </div>
                    }
                  </div>
                }
              }
            </div>
          }
        </main>

        <!-- ── RIGHT PANEL: Cart + Client + Payment ────────────────────── -->
        <aside class="uo-right" [class.uo-hidden-mobile]="mobileTab() === 'catalog'">

          <!-- Client section (optional) -->
          @if (mode() !== 'dialog') {
            <section class="uo-card">
              <button class="uo-card-toggle" (click)="showClient.set(!showClient())">
                <mat-icon>{{ showClient() ? 'expand_less' : 'person_add' }}</mat-icon>
                <span>{{ showClient() ? 'Клиент' : 'Добавить клиента' }}</span>
                @if (!showClient() && clientPhone()) {
                  <span class="uo-client-preview">{{ clientPhone() }}</span>
                }
              </button>
              @if (showClient()) {
                <div class="uo-client-fields">
                  <mat-form-field appearance="outline" class="uo-field-full">
                    <mat-label>Телефон</mat-label>
                    <input matInput type="tel" [ngModel]="clientPhone()"
                           (ngModelChange)="clientPhone.set($event); onPhoneInput($event)"
                           placeholder="+7 (999) 999-99-99" />
                    @if (lookingUpPhone()) { <mat-spinner matSuffix diameter="16" /> }
                    @if (foundClientName()) {
                      <mat-hint>{{ foundClientName() }}</mat-hint>
                    }
                  </mat-form-field>
                  <mat-form-field appearance="outline" class="uo-field-full">
                    <mat-label>Имя</mat-label>
                    <input matInput [ngModel]="clientName()" (ngModelChange)="clientName.set($event)" />
                  </mat-form-field>
                </div>
              }
            </section>
          }

          <!-- Cart -->
          <section class="uo-card uo-cart-card">
            <div class="uo-cart-header">
              <h2 class="uo-cart-title">Корзина</h2>
              @if (cartItems().length > 0) {
                <span class="uo-cart-badge">{{ cartItems().length }}</span>
              }
            </div>

            @if (cartItems().length === 0) {
              <div class="uo-cart-empty">
                <mat-icon>shopping_cart</mat-icon>
                <span>Выберите услугу</span>
              </div>
            } @else {
              <div class="uo-cart-list">
                @for (item of cartItems(); track item.id) {
                  <div class="uo-cart-item" [class.uo-manual-item]="item.isManual">
                    <div class="uo-cart-item-info">
                      <span class="uo-cart-item-name">{{ item.name }}</span>
                    </div>
                    <div class="uo-cart-item-controls">
                      <div class="uo-qty-control">
                        <button class="uo-qty-btn" (click)="decrementQty(item)" matTooltip="Уменьшить">
                          <mat-icon>remove</mat-icon>
                        </button>
                        <span class="uo-qty-value">{{ item.quantity }}</span>
                        <button class="uo-qty-btn" (click)="incrementQty(item)" matTooltip="Увеличить">
                          <mat-icon>add</mat-icon>
                        </button>
                      </div>
                      <span class="uo-cart-item-price">{{ item.price * item.quantity | priceFormat }}</span>
                      <button class="uo-cart-remove" (click)="removeFromCart(item.id)" matTooltip="Удалить">
                        <mat-icon>close</mat-icon>
                      </button>
                    </div>
                    @if (item.volumeHint) {
                      <div class="uo-volume-hint">{{ item.volumeHint }}</div>
                    }
                  </div>
                }
              </div>

              <div class="uo-cart-subtotal">
                <span>Подытог</span>
                <span class="uo-subtotal-amount">{{ cartTotal() | priceFormat }}</span>
              </div>
            }
          </section>

          <!-- Support team -->
          @if (cartItems().length > 0 && !isPrepaidMode()) {
            <section class="uo-card uo-support-card">
              <div
                class="uo-support-row"
                tabindex="0"
                role="checkbox"
                [attr.aria-checked]="supportTeam()"
                (click)="supportTeam.set(!supportTeam())"
                (keydown.space)="$event.preventDefault(); supportTeam.set(!supportTeam())"
              >
                <mat-checkbox
                  [ngModel]="supportTeam()"
                  (ngModelChange)="supportTeam.set($event)"
                  (click)="$event.stopPropagation()"
                />
                <div class="uo-support-info">
                  <span class="uo-support-title">
                    <mat-icon>favorite</mat-icon>
                    Поддержать команду «Своё Фото»
                  </span>
                </div>
                <span class="uo-support-price">{{ SUPPORT_TEAM_AMOUNT | priceFormat }}</span>
              </div>
            </section>
          }

          <!-- Promo code -->
          <section class="uo-card uo-promo-card" [hidden]="isPrepaidMode()">
            <div class="uo-promo-row">
              <input
                class="uo-promo-input"
                type="text"
                placeholder="Промокод"
                [ngModel]="promoCode()"
                (ngModelChange)="promoCode.set($event)"
                [disabled]="promoApplied()"
              />
              @if (promoApplied()) {
                <span class="uo-promo-applied">
                  <mat-icon>check_circle</mat-icon>
                  {{ promoCode() }}
                </span>
              } @else {
                <button
                  class="uo-promo-apply"
                  [disabled]="!promoCode().trim()"
                  (click)="applyPromo()"
                >
                  Применить
                </button>
              }
            </div>
          </section>

          <!-- Comment -->
          <section class="uo-card">
            <mat-form-field appearance="outline" class="uo-field-full">
              <mat-label>Комментарий</mat-label>
              <textarea matInput rows="2" [ngModel]="comment()" (ngModelChange)="comment.set($event)"
                        maxlength="500" placeholder="Особые пожелания"></textarea>
            </mat-form-field>
          </section>

          <!-- Подстановка формы -->
          <section class="uo-card">
            <div
              class="uo-support-row"
              tabindex="0"
              role="checkbox"
              [attr.aria-checked]="hasUniformOverlay()"
              (click)="hasUniformOverlay.set(!hasUniformOverlay())"
              (keydown.space)="$event.preventDefault(); hasUniformOverlay.set(!hasUniformOverlay())"
            >
              <mat-checkbox
                [ngModel]="hasUniformOverlay()"
                (ngModelChange)="hasUniformOverlay.set($event)"
                (click)="$event.stopPropagation()"
              />
              <div class="uo-support-info">
                <span class="uo-support-title">
                  <mat-icon>checkroom</mat-icon>
                  Подстановка формы
                </span>
                <span class="uo-card-hint">обработка до 1 часа</span>
              </div>
            </div>
            @if (hasUniformOverlay()) {
              <div class="uo-uniform-detail">
                <mat-form-field appearance="outline" class="uo-field-full">
                  <mat-label>Описание формы</mat-label>
                  <textarea matInput rows="2" maxlength="500"
                    placeholder="Например: парадная ВМФ, полиция МВД, МЧС"
                    [ngModel]="uniformDescription()"
                    (ngModelChange)="uniformDescription.set($event)"></textarea>
                </mat-form-field>
                <div class="uo-uniform-files-label">Образец формы от клиента</div>
                <app-file-dropzone
                  [files]="uniformFiles()"
                  accept="image/*,.pdf"
                  (filesAdded)="addUniformFiles($event)"
                  (fileRemoved)="removeUniformFile($event)" />
              </div>
            }
          </section>

          <!-- Manual entry (collapsible) -->
          <section class="uo-card" [hidden]="isPrepaidMode()">
            <button class="uo-card-toggle" (click)="showManual.set(!showManual())">
              <mat-icon>{{ showManual() ? 'expand_less' : 'edit' }}</mat-icon>
              <span>Ручной ввод</span>
            </button>
            @if (showManual()) {
              <div class="uo-manual-form">
                <mat-form-field appearance="outline" class="uo-manual-price-field">
                  <mat-label>Сумма</mat-label>
                  <input matInput type="number" min="0" [ngModel]="manualAmount()"
                         (ngModelChange)="manualAmount.set(+$event)"
                         (keyup.enter)="addManualItem()" />
                  <span matSuffix class="uo-ruble-suffix">&#8381;</span>
                </mat-form-field>
                <mat-form-field appearance="outline" class="uo-manual-desc-field">
                  <mat-label>Описание</mat-label>
                  <input matInput [ngModel]="manualDesc()" (ngModelChange)="manualDesc.set($event)"
                         placeholder="Напр.: Ламинирование" (keyup.enter)="addManualItem()" />
                </mat-form-field>
                <button
                  mat-flat-button class="uo-manual-add"
                  [disabled]="manualAmount() <= 0"
                  (click)="addManualItem()"
                >
                  <mat-icon>add</mat-icon>
                </button>
              </div>
            }
          </section>

          <!-- Total display (sticky in right panel) -->
          <div class="uo-total-block">
            @if (bestVolumeHint(); as hint) {
              <div class="uo-volume-hint-badge">
                <mat-icon>trending_up</mat-icon>
                <span>{{ hint }}</span>
              </div>
            }
            <div class="uo-total-row">
              <span class="uo-total-label">ИТОГО</span>
              <span class="uo-total-amount">{{ grandTotal() | priceFormat }}</span>
            </div>
          </div>

        </aside>
      </div>

      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <!-- FOOTER — Glass morphism, payment buttons                          -->
      <!-- ═══════════════════════════════════════════════════════════════════ -->
      <footer class="uo-footer">
        <!-- Mobile tab switcher -->
        <div class="uo-mobile-tabs">
          <button
            class="uo-mob-tab"
            [class.active]="mobileTab() === 'catalog'"
            (click)="mobileTab.set('catalog')"
          >
            <mat-icon>storefront</mat-icon>
            Каталог
          </button>
          <button
            class="uo-mob-tab"
            [class.active]="mobileTab() === 'cart'"
            (click)="mobileTab.set('cart')"
          >
            <mat-icon>shopping_cart</mat-icon>
            Корзина
            @if (cartItems().length > 0) {
              <span class="uo-mob-badge">{{ cartItems().length }}</span>
            }
          </button>
        </div>

        <div class="uo-footer-inner">
          <div class="uo-footer-total">
            <span class="uo-footer-total-label">ИТОГО</span>
            <span class="uo-footer-total-amount">{{ grandTotal() | priceFormat }}</span>
          </div>
          <div class="uo-payment-buttons">
            @if (isPrepaidMode()) {
              <button
                class="uo-pay-btn uo-pay-cash"
                [disabled]="submitting() || cartItems().length === 0"
                matRipple
                (click)="submitPrepaidOrder()"
              >
                @if (submitting()) {
                  <mat-spinner diameter="18" />
                } @else {
                  <mat-icon>check_circle</mat-icon>
                }
                <span class="uo-pay-label">Создать заказ</span>
              </button>
            } @else {
              @if (mode() !== 'dialog') {
                <button
                  class="uo-pay-btn uo-pay-cash"
                  [disabled]="!canSubmit()"
                  matRipple
                  (click)="submitPayment('cash')"
                >
                  <mat-icon>payments</mat-icon>
                  <span class="uo-pay-label">Наличные</span>
                </button>
                <button
                  class="uo-pay-btn uo-pay-card"
                  [disabled]="!canSubmit()"
                  matRipple
                  (click)="submitPayment('card')"
                >
                  <mat-icon>credit_card</mat-icon>
                  <span class="uo-pay-label">Карта</span>
                </button>
                <button
                  class="uo-pay-btn uo-pay-sbp"
                  [disabled]="!canSubmit()"
                  matRipple
                  (click)="submitPayment('sbp')"
                >
                  <mat-icon>qr_code_2</mat-icon>
                  <span class="uo-pay-label">СБП</span>
                </button>
              }
              <button
                class="uo-pay-btn uo-pay-online"
                [disabled]="!canSubmit() || generatingOnline()"
                matRipple
                (click)="submitPayment('online')"
              >
                @if (generatingOnline()) {
                  <mat-spinner diameter="18" />
                } @else {
                  <mat-icon>send</mat-icon>
                }
                <span class="uo-pay-label">Онлайн</span>
              </button>
              <button
                class="uo-pay-btn uo-pay-later"
                [disabled]="!canSubmit()"
                matRipple
                (click)="submitPayment('later')"
              >
                <mat-icon>schedule</mat-icon>
                <span class="uo-pay-label">Позже</span>
              </button>
            }
          </div>
        </div>
      </footer>

      <!-- Success overlay -->
      @if (submitted()) {
        <div class="uo-success-overlay">
          <div class="uo-success-card">
            <div class="uo-success-icon-wrap">
              <mat-icon>check_circle</mat-icon>
            </div>
            <h2 class="uo-success-title">Заказ создан!</h2>
            @if (createdOrderId()) {
              <p class="uo-success-order-id">{{ createdOrderId() }}</p>
            }
            @if (createdReceiptNumber()) {
              <p class="uo-success-receipt">Чек: {{ createdReceiptNumber() }}</p>
            }
            <div class="uo-success-actions">
              <button mat-flat-button class="uo-success-btn-new" (click)="resetOrder()">
                <mat-icon>add</mat-icon> Новый заказ
              </button>
              <button mat-stroked-button class="uo-success-btn-back" (click)="onBack()">
                <mat-icon>list</mat-icon> К заказам
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    /* ══════════════════════════════════════════════════════════════════════════
       UNIFIED ORDER — Premium CRM Interface
       Inspired by: Apple Store, Stripe Checkout, Toast POS
       Typography: Oswald (display), Plus Jakarta Sans (body), JetBrains Mono (prices)
       ══════════════════════════════════════════════════════════════════════════ */

    :host {
      display: block;
      height: 100%;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      color: var(--crm-text-primary, #ececec);
      --uo-left-ratio: 63%;
      --uo-right-ratio: 37%;
    }

    /* ── Shell ── */
    .uo-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--crm-surface, #131210);
      overflow: hidden;
    }

    .uo-shell.uo-dialog-mode {
      max-height: 90vh;
      border-radius: var(--crm-radius-lg, 12px);
    }

    .uo-shell.uo-embedded {
      border-radius: 0;
    }

    /* ── Header ── */
    .uo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1.25rem;
      border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      flex-shrink: 0;
      background: var(--crm-surface, #131210);
      z-index: 10;
    }

    .uo-header-left {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .uo-header-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .uo-back-btn {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-glass-bg, rgba(255, 255, 255, 0.03));
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
      color: var(--crm-text-secondary, #a0a0a0);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--crm-transition-fast, 120ms ease);

      &:hover {
        background: var(--crm-glass-bg-hover, rgba(255, 255, 255, 0.05));
        color: var(--crm-text-primary, #ececec);
      }

      mat-icon { font-size: 1.125rem; width: 1.125rem; height: 1.125rem; }
    }

    .uo-header-title-group {
      display: flex;
      flex-direction: column;
    }

    .uo-title {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 1.125rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin: 0;
      line-height: 1.2;
    }

    .uo-subtitle {
      font-size: 0.6875rem;
      color: var(--crm-text-muted, #7a7a7a);
      margin-top: 0.0625rem;
    }

    .uo-search-toggle {
      width: 2.25rem;
      height: 2.25rem;
      border-radius: var(--crm-radius-md, 8px);
      background: var(--crm-glass-bg, rgba(255, 255, 255, 0.03));
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
      color: var(--crm-text-secondary, #a0a0a0);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--crm-transition-fast, 120ms ease);

      &:hover {
        background: rgba(245, 158, 11, 0.08);
        color: var(--crm-accent, #f59e0b);
        border-color: rgba(245, 158, 11, 0.3);
      }

      mat-icon { font-size: 1.125rem; width: 1.125rem; height: 1.125rem; }
    }

    /* ── Search bar ── */
    .uo-search-bar {
      display: flex;
      align-items: center;
      padding: 0.5rem 1.25rem;
      border-bottom: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      background: var(--crm-surface-raised, #1b1a17);
      position: relative;
      flex-shrink: 0;
    }

    .uo-search-icon {
      position: absolute;
      left: 1.75rem;
      font-size: 1.125rem;
      width: 1.125rem;
      height: 1.125rem;
      color: var(--crm-accent, #f59e0b);
      pointer-events: none;
    }

    .uo-search-input {
      width: 100%;
      height: 2.375rem;
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: var(--crm-radius-md, 8px);
      background: rgba(245, 158, 11, 0.04);
      color: var(--crm-text-primary, #ececec);
      font-size: 0.8125rem;
      font-family: inherit;
      padding: 0 4.5rem 0 2.5rem;
      outline: none;
      box-sizing: border-box;
      transition: border-color 150ms ease;

      &::placeholder { color: var(--crm-text-muted, #7a7a7a); }
      &:focus { border-color: rgba(245, 158, 11, 0.5); }
    }

    .uo-search-hint {
      position: absolute;
      right: 3.5rem;
      font-size: 0.625rem;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: var(--crm-text-muted, #7a7a7a);
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
      border-radius: 0.25rem;
      padding: 0.125rem 0.375rem;
      pointer-events: none;
    }

    .uo-search-clear {
      position: absolute;
      right: 1.5rem;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--crm-text-muted, #7a7a7a);
      display: flex;
      align-items: center;
      padding: 0.25rem;
      border-radius: 0.25rem;
      transition: color 100ms ease;

      mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
      &:hover { color: var(--crm-text-primary, #ececec); }
    }

    /* ── Content grid ── */
    .uo-content {
      display: grid;
      grid-template-columns: var(--uo-left-ratio) var(--uo-right-ratio);
      flex: 1;
      overflow: hidden;
      min-height: 0;
    }

    /* ── Left panel ── */
    .uo-left {
      overflow-y: auto;
      padding: 1rem 1.25rem;
      border-right: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
    }

    .uo-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 3rem 0;
      color: var(--crm-text-muted, #7a7a7a);
      font-size: 0.8125rem;
    }

    /* ── Section ── */
    .uo-section {
      margin-bottom: 1.25rem;
    }

    .uo-section-title {
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--crm-text-muted, #7a7a7a);
      margin: 0 0 0.625rem;
    }

    /* ── Quick Presets Grid ── */
    .uo-presets-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
      gap: 0.5rem;
    }

    .uo-preset-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.75rem 0.5rem;
      border: 1.5px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      background: var(--crm-gradient-card, linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%));
      border-radius: var(--crm-radius-lg, 12px);
      cursor: pointer;
      color: var(--crm-text-primary, #ececec);
      outline: none;
      position: relative;
      overflow: hidden;
      font-family: inherit;
      transition: all var(--crm-transition-normal, 200ms ease);
      min-height: 5rem;

      &:hover {
        border-color: rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.06);
        transform: var(--crm-hover-lift, translateY(-2px));
        box-shadow: var(--crm-shadow-card-hover);
      }

      &:active {
        transform: var(--crm-active-press, scale(0.97));
      }

      &:focus-visible {
        outline: 2px solid var(--crm-border-focus, rgba(245, 158, 11, 0.5));
        outline-offset: 2px;
      }
    }

    .uo-preset-icon {
      font-size: 1.375rem;
      width: 1.375rem;
      height: 1.375rem;
      color: var(--crm-accent, #f59e0b);
      opacity: 0.85;
    }

    .uo-preset-name {
      font-size: 0.6875rem;
      font-weight: 600;
      text-align: center;
      line-height: 1.3;
    }

    .uo-preset-price {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 0.8125rem;
      font-weight: 700;
      color: var(--crm-accent-hover, #fbbf24);
    }

    .uo-preset-cat {
      font-size: 0.5625rem;
      color: var(--crm-text-muted, #7a7a7a);
      line-height: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }

    .uo-popular-badge {
      position: absolute;
      top: 0.25rem;
      right: 0.375rem;
      font-size: 0.5625rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      color: var(--crm-accent, #f59e0b);
      line-height: 1;
    }

    /* ── Category Tabs ── */
    .uo-category-tabs {
      display: flex;
      gap: 0.125rem;
      overflow-x: auto;
      scrollbar-width: none;
      padding: 0 0 0.75rem;
      margin-bottom: 0.5rem;
      border-bottom: 1px solid var(--crm-border-subtle, rgba(255, 255, 255, 0.04));
      mask-image: linear-gradient(to right, black calc(100% - 2rem), transparent 100%);
      -webkit-mask-image: linear-gradient(to right, black calc(100% - 2rem), transparent 100%);

      &::-webkit-scrollbar { display: none; }
    }

    .uo-cat-tab {
      display: inline-flex;
      align-items: center;
      gap: 0.3125rem;
      padding: 0.4375rem 0.75rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 0.6875rem;
      font-family: inherit;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 150ms ease;

      &:hover {
        color: var(--crm-text-primary, #ececec);
        background: var(--crm-surface-hover, rgba(255, 255, 255, 0.035));
      }

      &.active {
        color: var(--crm-accent, #f59e0b);
        border-bottom-color: var(--crm-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.06);
      }
    }

    .uo-cat-icon {
      font-size: 0.875rem;
      width: 0.875rem;
      height: 0.875rem;

      .uo-cat-tab.active & { color: var(--crm-accent, #f59e0b); }
    }

    .uo-cat-count {
      font-size: 0.5625rem;
      font-weight: 700;
      color: var(--crm-text-muted, #7a7a7a);
      background: rgba(255, 255, 255, 0.05);
      border-radius: 0.5rem;
      padding: 0.125rem 0.3125rem;
      min-width: 0.875rem;
      text-align: center;

      .uo-cat-tab.active & {
        color: var(--crm-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.12);
      }
    }

    /* ── Services scroll / grid ── */
    .uo-services-scroll {
      flex: 1;
    }

    .uo-services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }

    .uo-empty-search {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 2.5rem 0;
      color: var(--crm-text-muted, #7a7a7a);

      mat-icon { font-size: 2rem; width: 2rem; height: 2rem; }
      span { font-size: 0.8125rem; }
    }

    /* ── Service Card ── */
    .uo-service-card {
      display: flex;
      flex-direction: column;
      padding: 0.625rem 0.75rem;
      background: var(--crm-glass-bg, rgba(255, 255, 255, 0.03));
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
      border-radius: var(--crm-radius-lg, 12px);
      cursor: pointer;
      position: relative;
      font-family: inherit;
      color: var(--crm-text-primary, #ececec);
      text-align: left;
      outline: none;
      min-height: 5.25rem;
      transition: all var(--crm-transition-normal, 200ms ease);
      overflow: hidden;

      &:hover {
        background: rgba(255, 255, 255, 0.05);
        border-color: rgba(255, 255, 255, 0.12);
        transform: translateY(-1px);
        box-shadow: var(--crm-shadow-card-hover);
      }

      &:active {
        transform: var(--crm-active-press, scale(0.97));
      }

      &:focus-visible {
        outline: 2px solid var(--crm-border-focus, rgba(245, 158, 11, 0.5));
        outline-offset: 2px;
      }

      &.selected {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.4);
        box-shadow: var(--crm-shadow-accent-glow);
      }
    }

    .uo-selected-check {
      position: absolute;
      top: 0.375rem;
      right: 0.375rem;
      width: 1.125rem;
      height: 1.125rem;
      border-radius: 50%;
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon { font-size: 0.75rem; width: 0.75rem; height: 0.75rem; font-weight: 700; }
    }

    .uo-svc-header {
      display: flex;
      align-items: center;
      margin-bottom: 0.25rem;
    }

    .uo-svc-icon {
      font-size: 1rem;
      width: 1rem;
      height: 1rem;
      color: var(--crm-accent, #f59e0b);
      opacity: 0.8;
    }

    .uo-svc-name {
      font-size: 0.75rem;
      font-weight: 600;
      line-height: 1.3;
      margin-bottom: 0.1875rem;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .uo-svc-features {
      display: flex;
      flex-wrap: wrap;
      gap: 0.1875rem;
      margin-bottom: 0.25rem;
    }

    .uo-feature-chip {
      font-size: 0.5625rem;
      font-weight: 500;
      color: var(--crm-text-muted, #7a7a7a);
      background: rgba(255, 255, 255, 0.05);
      border-radius: 0.25rem;
      padding: 0.0625rem 0.3125rem;
      line-height: 1.3;
    }

    .uo-svc-price-row {
      display: flex;
      align-items: baseline;
      gap: 0.3125rem;
      margin-top: auto;
    }

    .uo-old-price {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 0.625rem;
      color: var(--crm-text-muted, #7a7a7a);
      text-decoration: line-through;
    }

    .uo-svc-price {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--crm-accent-hover, #fbbf24);
    }

    .uo-price-range {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 0.625rem;
      color: var(--crm-text-muted, #7a7a7a);
      font-weight: 400;
    }

    /* ── Catalog sections ── */
    .uo-catalog-section {
      margin-bottom: 1rem;
    }

    .uo-catalog-section-title {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--crm-text-muted, #7a7a7a);
      margin: 0 0 0.5rem;

      &:not(:first-child) { margin-top: 0.875rem; }

      mat-icon {
        font-size: 0.8125rem;
        width: 0.8125rem;
        height: 0.8125rem;
        color: var(--crm-accent, #f59e0b);
      }
    }

    .uo-group-label {
      font-size: 0.625rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: rgba(255, 255, 255, 0.35);
      margin: 0.5rem 0 0.375rem;
      padding-left: 0.125rem;
    }

    /* ── Right panel ── */
    .uo-right {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
    }

    /* ── Card ── */
    .uo-card {
      border: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-lg, 12px);
      padding: 0.625rem 0.75rem;
      background: var(--crm-surface-raised, #1b1a17);
    }

    .uo-card-toggle {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      width: 100%;
      padding: 0.375rem 0;
      border: none;
      background: transparent;
      cursor: pointer;
      color: var(--crm-text-secondary, #a0a0a0);
      font-size: 0.6875rem;
      font-family: inherit;
      font-weight: 600;
      transition: color 150ms ease;

      &:hover { color: var(--crm-accent, #f59e0b); }

      mat-icon { font-size: 1.125rem; width: 1.125rem; height: 1.125rem; }
    }

    .uo-client-preview {
      margin-left: auto;
      font-weight: 500;
      color: var(--crm-text-primary, #ececec);
      font-size: 0.6875rem;
    }

    .uo-client-fields {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.5rem;
    }

    .uo-field-full { width: 100%; }

    /* ── Cart ── */
    .uo-cart-card {
      flex-shrink: 0;
    }

    .uo-cart-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .uo-cart-title {
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--crm-text-muted, #7a7a7a);
      margin: 0;
    }

    .uo-cart-badge {
      font-size: 0.5625rem;
      font-weight: 700;
      color: var(--crm-on-accent, #0a0a0a);
      background: var(--crm-accent, #f59e0b);
      border-radius: 50%;
      width: 1.125rem;
      height: 1.125rem;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    .uo-cart-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      padding: 1rem;
      border: 1px dashed var(--crm-border, rgba(255, 255, 255, 0.06));
      border-radius: var(--crm-radius-md, 8px);
      color: var(--crm-text-muted, #7a7a7a);
      font-size: 0.75rem;

      mat-icon { font-size: 1.125rem; width: 1.125rem; height: 1.125rem; }
    }

    .uo-cart-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .uo-cart-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.375rem 0.5rem;
      border-radius: var(--crm-radius-md, 8px);
      background: rgba(245, 158, 11, 0.04);
      border: 1px solid rgba(245, 158, 11, 0.1);
      transition: all 150ms ease;

      &.uo-manual-item {
        background: rgba(96, 165, 250, 0.04);
        border-color: rgba(96, 165, 250, 0.1);
      }
    }

    .uo-cart-item-info {
      display: flex;
      align-items: center;
    }

    .uo-cart-item-name {
      font-size: 0.75rem;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    .uo-cart-item-controls {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .uo-qty-control {
      display: inline-flex;
      align-items: center;
      gap: 0.125rem;
    }

    .uo-qty-btn {
      width: 1.5rem;
      height: 1.5rem;
      background: rgba(255, 255, 255, 0.06);
      border: none;
      border-radius: 0.375rem;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--crm-text-secondary, #a0a0a0);
      transition: all 100ms ease;

      mat-icon { font-size: 0.875rem; width: 0.875rem; height: 0.875rem; }

      &:hover {
        background: rgba(255, 255, 255, 0.12);
        color: var(--crm-text-primary, #ececec);
      }
    }

    .uo-qty-value {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 0.75rem;
      font-weight: 700;
      min-width: 1.125rem;
      text-align: center;
    }

    .uo-cart-item-price {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--crm-accent-hover, #fbbf24);
      white-space: nowrap;
      margin-left: auto;
    }

    .uo-volume-hint {
      font-size: 0.65rem;
      color: var(--mat-sys-primary);
      font-weight: 500;
      padding: 1px 4px;
      margin-top: 2px;
    }

    .uo-cart-remove {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
      color: rgba(245, 158, 11, 0.4);
      flex-shrink: 0;

      mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
      &:hover { color: var(--crm-status-error, #f87171); }
    }

    .uo-cart-subtotal {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--crm-border-subtle, rgba(255, 255, 255, 0.04));
      font-size: 0.6875rem;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    .uo-subtotal-amount {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-weight: 700;
      color: var(--crm-text-primary, #ececec);
    }

    /* ── Support team ── */
    .uo-support-card {
      background: linear-gradient(135deg, rgba(244, 63, 94, 0.06) 0%, rgba(251, 146, 60, 0.04) 100%);
      border-color: rgba(244, 63, 94, 0.15);
      padding: 0.5rem 0.75rem;
    }

    .uo-support-row {
      display: flex;
      align-items: center;
      gap: 0.625rem;
      cursor: pointer;
    }

    .uo-support-info {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      flex: 1;
      min-width: 0;
    }

    .uo-support-title {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--crm-text-primary, #ececec);

      mat-icon {
        font-size: 0.875rem;
        width: 0.875rem;
        height: 0.875rem;
        color: #f43f5e;
      }
    }

    .uo-support-desc {
      font-size: 0.625rem;
      color: var(--crm-text-muted, #7a7a7a);
    }

    .uo-support-price {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 0.8125rem;
      font-weight: 700;
      color: #fb923c;
      white-space: nowrap;
    }

    /* ── Promo card ── */
    .uo-promo-card {
      padding: 0.5rem 0.75rem;
    }

    .uo-promo-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .uo-promo-input {
      flex: 1;
      height: 2rem;
      border-radius: var(--crm-radius-sm, 6px);
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));
      background: var(--crm-glass-bg, rgba(255, 255, 255, 0.03));
      color: var(--crm-text-primary, #ececec);
      font-size: 0.75rem;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      padding: 0 0.625rem;
      outline: none;
      box-sizing: border-box;
      text-transform: uppercase;
      letter-spacing: 0.05em;

      &::placeholder {
        color: var(--crm-text-muted, #7a7a7a);
        text-transform: none;
        letter-spacing: normal;
      }

      &:focus { border-color: rgba(245, 158, 11, 0.3); }
      &:disabled { opacity: 0.5; }
    }

    .uo-promo-apply {
      height: 2rem;
      padding: 0 0.75rem;
      border: 1px solid rgba(52, 211, 153, 0.3);
      border-radius: var(--crm-radius-sm, 6px);
      background: rgba(52, 211, 153, 0.08);
      color: var(--crm-status-success, #34d399);
      font-size: 0.6875rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      transition: all 150ms ease;

      &:hover:not(:disabled) {
        background: rgba(52, 211, 153, 0.15);
      }

      &:disabled { opacity: 0.38; cursor: not-allowed; }
    }

    .uo-promo-applied {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.6875rem;
      font-weight: 600;
      color: var(--crm-status-success, #34d399);
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);

      mat-icon { font-size: 0.875rem; width: 0.875rem; height: 0.875rem; }
    }

    /* ── Manual entry ── */
    .uo-manual-form {
      display: flex;
      gap: 0.5rem;
      align-items: flex-start;
      margin-top: 0.5rem;
    }

    .uo-manual-price-field { width: 6.25rem; flex-shrink: 0; }
    .uo-manual-desc-field { flex: 1; }

    .uo-ruble-suffix {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: var(--crm-text-muted, #7a7a7a);
    }

    .uo-manual-add {
      margin-top: 0.5rem;
      min-width: 2.5rem;
      height: 2.5rem;
    }

    /* ── Total block ── */
    .uo-total-block {
      padding: 0.75rem;
      border-radius: var(--crm-radius-lg, 12px);
      background: var(--crm-surface-overlay, #272520);
      border: 1px solid rgba(245, 158, 11, 0.15);
      margin-top: auto;
    }

    .uo-volume-hint-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      margin-bottom: 6px;
      border-radius: 6px;
      background: rgba(96, 165, 250, 0.12);
      color: #60a5fa;
      font-size: 0.7rem;
      font-weight: 500;
      mat-icon { font-size: 13px; width: 13px; height: 13px; }
    }

    .uo-total-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
    }

    .uo-total-label {
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--crm-text-muted, #7a7a7a);
    }

    .uo-total-amount {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 1.75rem;
      font-weight: 600;
      color: var(--crm-accent-hover, #fbbf24);
      letter-spacing: 0.01em;
      line-height: 1;
    }

    /* ── Footer ── */
    .uo-footer {
      flex-shrink: 0;
      background: rgba(19, 18, 16, 0.85);
      backdrop-filter: blur(var(--crm-glass-blur, 12px));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur, 12px));
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.06));
      padding: 0.75rem 1.25rem;
    }

    .uo-mobile-tabs {
      display: none;
    }

    .uo-footer-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .uo-footer-total {
      display: flex;
      align-items: baseline;
      gap: 0.625rem;
      flex-shrink: 0;
    }

    .uo-footer-total-label {
      font-size: 0.625rem;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--crm-text-muted, #7a7a7a);
    }

    .uo-footer-total-amount {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--crm-accent-hover, #fbbf24);
      line-height: 1;
    }

    .uo-payment-buttons {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .uo-pay-btn {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0 0.875rem;
      height: 2.375rem;
      border-radius: var(--crm-radius-md, 8px);
      font-size: 0.8125rem;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      border: none;
      white-space: nowrap;
      transition: all var(--crm-transition-normal, 200ms ease);
      position: relative;
      overflow: hidden;

      mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
      mat-spinner { margin: 0; }

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
        transform: none !important;
      }
    }

    .uo-pay-cash {
      background: rgba(52, 211, 153, 0.12);
      color: var(--crm-status-success, #34d399);
      border: 1px solid rgba(52, 211, 153, 0.25);

      &:hover:not(:disabled) {
        background: rgba(52, 211, 153, 0.2);
        transform: translateY(-1px);
        box-shadow: var(--crm-shadow-success-glow);
      }
    }

    .uo-pay-card {
      background: rgba(96, 165, 250, 0.12);
      color: var(--crm-status-info, #60a5fa);
      border: 1px solid rgba(96, 165, 250, 0.25);

      &:hover:not(:disabled) {
        background: rgba(96, 165, 250, 0.2);
        transform: translateY(-1px);
        box-shadow: var(--crm-shadow-info-glow);
      }
    }

    .uo-pay-sbp {
      background: rgba(167, 139, 250, 0.12);
      color: #a78bfa;
      border: 1px solid rgba(167, 139, 250, 0.25);

      &:hover:not(:disabled) {
        background: rgba(167, 139, 250, 0.2);
        transform: translateY(-1px);
        box-shadow: 0 0 16px rgba(167, 139, 250, 0.12);
      }
    }

    .uo-pay-online {
      background: var(--crm-accent, #f59e0b);
      color: var(--crm-on-accent, #0a0a0a);

      &:hover:not(:disabled) {
        background: var(--crm-accent-hover, #fbbf24);
        transform: translateY(-1px);
        box-shadow: var(--crm-shadow-accent-glow);
      }
    }

    .uo-pay-later {
      background: var(--crm-glass-bg, rgba(255, 255, 255, 0.03));
      color: var(--crm-text-secondary, #a0a0a0);
      border: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.08));

      &:hover:not(:disabled) {
        background: var(--crm-glass-bg-hover, rgba(255, 255, 255, 0.05));
        color: var(--crm-text-primary, #ececec);
      }
    }

    .uo-pay-label {
      line-height: 1;
    }

    /* ── Success overlay ── */
    .uo-success-overlay {
      position: absolute;
      inset: 0;
      z-index: 50;
      background: rgba(12, 11, 9, 0.92);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: uo-fade-in 250ms ease;
    }

    @keyframes uo-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .uo-success-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      padding: 2.5rem;
      text-align: center;
    }

    .uo-success-icon-wrap {
      width: 4.5rem;
      height: 4.5rem;
      border-radius: 50%;
      background: rgba(52, 211, 153, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: uo-scale-in 400ms cubic-bezier(0.34, 1.56, 0.64, 1);

      mat-icon {
        font-size: 2.5rem;
        width: 2.5rem;
        height: 2.5rem;
        color: var(--crm-status-success, #34d399);
      }
    }

    @keyframes uo-scale-in {
      from { transform: scale(0); }
      to { transform: scale(1); }
    }

    .uo-success-title {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 1.5rem;
      font-weight: 600;
      margin: 0;
    }

    .uo-success-order-id {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 1.125rem;
      font-weight: 600;
      color: var(--crm-accent, #f59e0b);
      margin: 0;
      padding: 0.5rem 1.25rem;
      background: var(--crm-accent-muted, rgba(245, 158, 11, 0.12));
      border-radius: var(--crm-radius-md, 8px);
    }

    .uo-success-receipt {
      font-size: 0.8125rem;
      color: var(--crm-text-muted, #7a7a7a);
      margin: 0;
    }

    .uo-success-actions {
      display: flex;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }

    .uo-success-btn-new {
      background: var(--crm-accent, #f59e0b) !important;
      color: var(--crm-on-accent, #0a0a0a) !important;
    }

    /* ── Uniform overlay (Подстановка формы) ── */
    .uo-uniform-detail {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 0.75rem;
    }

    .uo-uniform-files-label {
      font-size: 0.75rem;
      color: var(--crm-text-secondary, #a0a0a0);
      margin-bottom: 0.25rem;
    }

    .uo-card-hint {
      font-size: 0.6875rem;
      color: var(--crm-text-muted, #7a7a7a);
    }

    /* ── Mobile responsive ── */
    @media (max-width: 52.5rem) {
      .uo-content {
        grid-template-columns: 1fr;
        grid-template-rows: 1fr;
      }

      .uo-left {
        border-right: none;
      }

      .uo-hidden-mobile {
        display: none !important;
      }

      .uo-mobile-tabs {
        display: flex;
        gap: 0;
        margin-bottom: 0.5rem;
      }

      .uo-mob-tab {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.375rem;
        padding: 0.5rem;
        background: none;
        border: none;
        border-bottom: 2px solid transparent;
        color: var(--crm-text-muted, #7a7a7a);
        font-size: 0.75rem;
        font-family: inherit;
        font-weight: 600;
        cursor: pointer;
        position: relative;

        mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }

        &.active {
          color: var(--crm-accent, #f59e0b);
          border-bottom-color: var(--crm-accent, #f59e0b);
        }
      }

      .uo-mob-badge {
        font-size: 0.5625rem;
        font-weight: 700;
        color: var(--crm-on-accent, #0a0a0a);
        background: var(--crm-accent, #f59e0b);
        border-radius: 50%;
        width: 1rem;
        height: 1rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .uo-services-grid {
        grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
      }

      .uo-footer-inner {
        flex-direction: column;
        gap: 0.5rem;
        align-items: stretch;
      }

      .uo-footer-total {
        justify-content: center;
      }

      .uo-payment-buttons {
        justify-content: center;
      }
    }
  `],
})
export class UnifiedOrderComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly posApi = inject(PosApiService);
  private readonly posService = inject(PosService);
  private readonly toast = inject(ToastService);
  private readonly authService = inject(AuthService);
  private readonly dashData = inject(DashboardDataService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogRef = inject(MatDialogRef, { optional: true });
  private readonly pricingApi = inject(PricingApiService);
  private readonly paymentsService = inject(PaymentsService);

  private readonly searchInputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // ── Inputs ──────────────────────────────────────────────────────────────────
  /** Mode determines layout variant and available actions */
  readonly mode = input<OrderMode>('page');
  /** Client name (pre-filled in dialog mode) */
  readonly dialogClientName = input<string>('');
  /** Phone (pre-filled in dialog mode) */
  readonly dialogPhone = input<string>('');
  /** Session ID for online payment (dialog mode) */
  readonly dialogSessionId = input<string>('');
  /** Prepaid flow: payment_links.id (если задан — создание заказа из оплаченной ссылки) */
  readonly presetPaymentLinkId = input<string | null>(null);
  /** Prepaid flow: корзина из payment_links.services (предзаполнение UI) */
  readonly presetCartItems = input<readonly PaymentLinkService[] | null>(null);
  /** Prepaid flow: сумма заблокирована (= amount ссылки) */
  readonly lockAmount = input<number | null>(null);

  // ── Outputs ─────────────────────────────────────────────────────────────────
  readonly orderCreated = output<{ orderId: string; receiptNumber?: string }>();
  readonly closed = output<void>();

  // ── State ───────────────────────────────────────────────────────────────────
  readonly loading = signal(true);
  readonly categories = signal<readonly UiCategory[]>([]);
  readonly activeCategory = signal<string | null>(null);
  readonly searchOpen = signal(false);
  readonly searchQuery = signal('');
  readonly mobileTab = signal<'catalog' | 'cart'>('catalog');

  // Cart
  readonly cartItems = signal<CartItem[]>([]);
  readonly comment = signal('');
  readonly promoCode = signal('');
  readonly promoApplied = signal(false);

  // Client
  readonly showClient = signal(false);
  readonly clientName = signal('');
  readonly clientPhone = signal('');
  readonly lookingUpPhone = signal(false);
  readonly foundClientName = signal<string | null>(null);

  // Manual entry
  readonly showManual = signal(false);
  readonly manualAmount = signal(0);
  readonly manualDesc = signal('');

  // Support team tip
  readonly supportTeam = signal(true);
  readonly SUPPORT_TEAM_AMOUNT = 39;

  // Uniform overlay (Подстановка формы)
  readonly hasUniformOverlay = signal(false);
  readonly uniformDescription = signal('');
  readonly uniformFiles = signal<UploadFile[]>([]);
  readonly uniformUploading = signal(false);

  // Payment
  readonly generatingOnline = signal(false);
  readonly submitting = signal(false);
  readonly submitted = signal(false);
  readonly createdOrderId = signal('');
  readonly createdReceiptNumber = signal<string | null>(null);

  // Phone lookup
  private readonly phoneSubject = new Subject<string>();

  // ── Computed ────────────────────────────────────────────────────────────────

  readonly totalServiceCount = computed(() =>
    this.categories().reduce((sum, c) => sum + c.allOptions.length, 0),
  );

  readonly visibleCategories = computed(() => {
    const active = this.activeCategory();
    const all = this.categories();
    return active !== null ? all.filter(c => c.slug === active) : all;
  });

  readonly isSearching = computed(() => this.searchQuery().trim().length > 0);

  readonly filteredServices = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    if (!q) return [] as UiServiceOption[];
    const all = this.categories().flatMap(c => c.allOptions);
    return all.filter(svc =>
      svc.name.toLowerCase().includes(q) ||
      svc.slug.toLowerCase().includes(q) ||
      svc.description.toLowerCase().includes(q) ||
      svc.features.some(f => f.toLowerCase().includes(q)),
    );
  });

  readonly cartTotal = computed(() =>
    this.cartItems().reduce((sum, i) => sum + i.price * i.quantity, 0),
  );

  readonly grandTotal = computed(() =>
    this.cartTotal() + (this.supportTeam() && this.cartItems().length > 0 ? this.SUPPORT_TEAM_AMOUNT : 0),
  );

  /** Prepaid flow активен, если задан presetPaymentLinkId. UI скрывает add-service/promo/support-team, кнопка одна — "Создать заказ". */
  readonly isPrepaidMode = computed(() => !!this.presetPaymentLinkId());

  /** Лучшая подсказка volume-скидки — ближайший порог, если до него <= 30% от текущего кол-ва */
  readonly bestVolumeHint = computed<string | null>(() => {
    const items = this.cartItems();
    let best: { hint: string; remaining: number } | null = null;
    for (const item of items) {
      if (!item.volumeHint) continue;
      // Парсим "ещё N шт и скидка X%!" → извлекаем N
      const match = item.volumeHint.match(/ещё\s+(\d+)/);
      if (!match) continue;
      const remaining = parseInt(match[1], 10);
      // Показываем только если до порога <= 30% от текущего кол-ва
      if (item.quantity > 0 && remaining > item.quantity * 0.3) continue;
      if (!best || remaining < best.remaining) {
        best = { hint: item.volumeHint.replace(/!$/, ''), remaining };
      }
    }
    return best?.hint ?? null;
  });

  readonly canSubmit = computed(() =>
    this.grandTotal() >= 1 && !this.submitting() && !this.generatingOnline(),
  );

  readonly quickPresets = computed<readonly QuickPreset[]>(() => {
    const cats = this.categories();
    if (cats.length === 0) return [];
    // Collect ONLY popular services across ALL categories
    const presets: QuickPreset[] = [];
    for (const cat of cats) {
      for (const svc of cat.allOptions) {
        if (svc.popular) {
          presets.push({
            id: svc.id,
            label: svc.name,
            icon: svc.icon,
            price: svc.price,
            popular: true,
            optionSlugs: [svc.slug],
            categorySlug: cat.slug,
            categoryName: cat.name,
            serviceId: svc.id,
          });
        }
      }
    }
    // Sort by price ascending — cheapest everyday services first
    return presets.sort((a, b) => a.price - b.price).slice(0, 10);
  });

  private readonly cartServiceIds = computed(() =>
    new Set(this.cartItems().filter(i => i.serviceId).map(i => i.serviceId)),
  );

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.phoneSubject.pipe(
        debounceTime(600),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe(phone => this.lookupPhone(phone));
    }

    // Prepaid flow: заполнить корзину из preset'а, когда категории загрузятся.
    effect(() => {
      const preset = this.presetCartItems();
      const cats = this.categories();
      if (!preset?.length || cats.length === 0) return;
      untracked(() => {
        if (this.cartItems().length === 0) this.applyPresetCartItems(preset);
      });
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.dashData.init();
    }

    this.loadCategories();

    // Pre-fill from dialog inputs
    if (this.dialogPhone()) {
      this.clientPhone.set(this.dialogPhone());
      this.showClient.set(true);
    }
    if (this.dialogClientName()) {
      this.clientName.set(this.dialogClientName());
    }
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey && event.key === 'k') {
      event.preventDefault();
      this.toggleSearch();
    }
  }

  // ── Search ──────────────────────────────────────────────────────────────────

  toggleSearch(): void {
    const open = !this.searchOpen();
    this.searchOpen.set(open);
    if (open) {
      setTimeout(() => this.focusSearch(), 50);
    } else {
      this.searchQuery.set('');
    }
  }

  closeSearch(): void {
    this.searchOpen.set(false);
    this.searchQuery.set('');
  }

  focusSearch(): void {
    this.searchInputRef()?.nativeElement.focus();
  }

  // ── Cart operations ─────────────────────────────────────────────────────────

  isInCart(serviceId: string): boolean {
    return this.cartServiceIds().has(serviceId);
  }

  toggleService(svc: UiServiceOption): void {
    if (this.isInCart(svc.id)) {
      this.cartItems.update(items => items.filter(i => i.serviceId !== svc.id));
    } else {
      const itemId = crypto.randomUUID();
      this.cartItems.update(items => [...items, {
        id: itemId,
        name: svc.name,
        price: svc.price,
        icon: svc.icon,
        isManual: false,
        optionSlugs: [svc.slug],
        categorySlug: this.findCategorySlug(svc.id),
        serviceId: svc.id,
        quantity: 1,
      }]);
      void this.refreshVolumeHint(itemId, svc.id, 1);
    }
  }

  addPresetToCart(preset: QuickPreset): void {
    const existing = this.cartItems().find(i => i.serviceId === preset.serviceId);
    if (existing) {
      const newQty = existing.quantity + 1;
      this.cartItems.update(items => items.map(i =>
        i.id === existing.id ? { ...i, quantity: newQty } : i,
      ));
      void this.refreshVolumeHint(existing.id, preset.serviceId, newQty);
    } else {
      const itemId = crypto.randomUUID();
      this.cartItems.update(items => [...items, {
        id: itemId,
        name: preset.label,
        price: preset.price,
        icon: preset.icon,
        isManual: false,
        optionSlugs: preset.optionSlugs,
        categorySlug: preset.categorySlug,
        serviceId: preset.serviceId,
        quantity: 1,
      }]);
      void this.refreshVolumeHint(itemId, preset.serviceId, 1);
    }
  }

  addManualItem(): void {
    if (this.manualAmount() <= 0) return;
    this.cartItems.update(items => [...items, {
      id: crypto.randomUUID(),
      name: this.manualDesc().trim() || `Ручной ввод`,
      price: this.manualAmount(),
      icon: 'edit',
      isManual: true,
      optionSlugs: [],
      categorySlug: '',
      serviceId: null,
      quantity: 1,
    }]);
    this.manualAmount.set(0);
    this.manualDesc.set('');
  }

  incrementQty(item: CartItem): void {
    const newQty = item.quantity + 1;
    this.cartItems.update(items => items.map(i =>
      i.id === item.id ? { ...i, quantity: newQty } : i,
    ));
    void this.refreshVolumeHint(item.id, item.serviceId, newQty);
  }

  decrementQty(item: CartItem): void {
    if (item.quantity <= 1) {
      this.removeFromCart(item.id);
      return;
    }
    const newQty = item.quantity - 1;
    this.cartItems.update(items => items.map(i =>
      i.id === item.id ? { ...i, quantity: newQty } : i,
    ));
    void this.refreshVolumeHint(item.id, item.serviceId, newQty);
  }

  /** F122: Load volume threshold hint for a cart item */
  private async refreshVolumeHint(itemId: string, serviceId: string | null, qty: number): Promise<void> {
    if (!serviceId) return;
    // Resolve product_id → serviceOptionId via pricing categories
    const cats = this.pricingApi.categories();
    let optionId: string | null = null;
    for (const cat of cats) {
      for (const group of cat.optionGroups) {
        const opt = group.options.find(o => o.product_id === serviceId);
        if (opt) { optionId = opt.id; break; }
      }
      if (optionId) break;
    }
    if (!optionId) return;

    try {
      const hint = await this.pricingApi.getVolumeHint({
        serviceOptionId: optionId,
        currentQty: qty,
      });
      this.cartItems.update(items => items.map(i =>
        i.id === itemId ? { ...i, volumeHint: hint?.label ?? undefined } : i,
      ));
    } catch {
      // Hint — non-critical, silently ignore
    }
  }

  removeFromCart(id: string): void {
    this.cartItems.update(items => items.filter(i => i.id !== id));
  }

  // ── Client lookup ───────────────────────────────────────────────────────────

  onPhoneInput(phone: string): void {
    this.foundClientName.set(null);
    const digits = phone.replace(/\D/g, '');
    if (digits.length >= 10) this.phoneSubject.next(phone);
  }

  private lookupPhone(phone: string): void {
    this.lookingUpPhone.set(true);
    this.posApi.lookupCustomer(phone).subscribe({
      next: data => {
        this.lookingUpPhone.set(false);
        if (data.customer_name) {
          this.foundClientName.set(data.customer_name);
          if (!this.clientName().trim()) this.clientName.set(data.customer_name);
        }
      },
      error: () => this.lookingUpPhone.set(false),
    });
  }

  // ── Promo ───────────────────────────────────────────────────────────────────

  applyPromo(): void {
    // Placeholder — future integration with promo API
    this.toast.success(`Промокод "${this.promoCode()}" пока не поддерживается`);
  }

  // ── Uniform overlay (Подстановка формы) ─────────────────────────────────────

  addUniformFiles(files: File[]): void {
    const additions: UploadFile[] = files.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      name: f.name,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      isImage: f.type.startsWith('image/'),
    }));
    this.uniformFiles.update(existing => [...existing, ...additions]);
  }

  removeUniformFile(id: string): void {
    const file = this.uniformFiles().find(f => f.id === id);
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
    this.uniformFiles.update(files => files.filter(f => f.id !== id));
  }

  private async uploadUniformFiles(
    files: readonly UploadFile[],
  ): Promise<{ s3Key: string; fileName: string; contentType: string; fileSize: number }[]> {
    const filesMeta = files.map(f => ({
      fileName: f.name,
      contentType: f.file.type || 'application/octet-stream',
      fileSize: f.file.size,
    }));
    const presignRes = await firstValueFrom(
      this.http.post<{ success: boolean; data: { uploads: { s3Key: string; uploadUrl: string }[] } }>(
        '/api/orders/photo-print/attachments/presign',
        { files: filesMeta },
      ),
    );
    if (!presignRes?.success) throw new Error('Presign failed');
    const results: { s3Key: string; fileName: string; contentType: string; fileSize: number }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const { s3Key, uploadUrl } = presignRes.data.uploads[i];
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.file.type || 'application/octet-stream');
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload ' + xhr.status));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file.file);
      });
      results.push({
        s3Key,
        fileName: file.name,
        contentType: file.file.type || 'application/octet-stream',
        fileSize: file.file.size,
      });
    }
    return results;
  }

  // ── Payment submission ──────────────────────────────────────────────────────

  submitPayment(method: PaymentMethod): void {
    if (this.isPrepaidMode()) {
      void this.submitPrepaidOrder();
      return;
    }
    if (!this.canSubmit()) return;

    if (method === 'online') {
      this.generateOnlinePayment();
      return;
    }

    void this.createOfflineOrder(method);
  }

  private applyPresetCartItems(services: readonly PaymentLinkService[]): void {
    const categories = this.categories();
    const items: CartItem[] = services.map(svc => {
      const cat = categories.find(c => c.slug === svc.slug);
      const icon = cat?.icon || cat?.allOptions[0]?.icon || 'shopping_cart';
      return {
        id: crypto.randomUUID(),
        name: svc.name,
        price: svc.price,
        quantity: svc.quantity || 1,
        icon,
        isManual: !svc.id,
        optionSlugs: svc.optionSlugs ?? [],
        categorySlug: svc.slug ?? '',
        serviceId: svc.id ?? null,
      } satisfies CartItem;
    });
    this.cartItems.set(items);
  }

  async submitPrepaidOrder(): Promise<void> {
    const linkId = this.presetPaymentLinkId();
    if (!linkId || this.submitting()) return;
    this.submitting.set(true);

    // Uniform upload — как в createOfflineOrder
    const uniformFilesSnapshot = this.uniformFiles();
    let uploadedUniformFiles: { s3Key: string; fileName: string; contentType: string; fileSize: number }[] = [];
    if (this.hasUniformOverlay() && uniformFilesSnapshot.length > 0) {
      this.uniformUploading.set(true);
      try {
        uploadedUniformFiles = await this.uploadUniformFiles(uniformFilesSnapshot);
      } catch {
        this.uniformUploading.set(false);
        this.submitting.set(false);
        this.toast.error('Не удалось загрузить образцы формы');
        return;
      }
      this.uniformUploading.set(false);
    }

    const uniformDesc = this.hasUniformOverlay() ? this.uniformDescription().trim() : '';

    this.paymentsService.createOrderFromLink(linkId, {
      comment: this.comment().trim() || undefined,
      uniform_description: uniformDesc || undefined,
    }).subscribe({
      next: res => {
        this.submitting.set(false);
        if (uploadedUniformFiles.length > 0) {
          firstValueFrom(this.http.post(
            '/api/orders/photo-print/attachments/complete',
            {
              orderId: res.orderId,
              attachment_type: 'form_sample',
              files: uploadedUniformFiles,
            },
          )).catch(() => this.toast.error('Заказ создан, но не удалось привязать образцы формы'));
        }
        this.createdOrderId.set(res.orderId);
        this.submitted.set(true);
        this.orderCreated.emit({ orderId: res.orderId });
        this.toast.success(
          res.idempotent ? `Заказ ${res.orderId} уже был создан` : `Заказ ${res.orderId} создан`,
        );
        this.dashData.init();
        this.dashData.loadOrderQueue();
        this.dialogRef?.close({ type: 'created', orderId: res.orderId });
      },
      error: err => {
        this.submitting.set(false);
        const code = err?.error?.error;
        const msg =
          code === 'PAYMENT_LINK_NOT_PAID' ? 'Ссылка ещё не оплачена' :
          code === 'PAYMENT_LINK_NOT_FOUND' ? 'Платёжная ссылка не найдена' :
          err?.error?.message || 'Ошибка при создании заказа';
        this.toast.error(msg);
      },
    });
  }

  private async createOfflineOrder(method: PaymentMethod): Promise<void> {
    this.submitting.set(true);

    // Upload uniform sample files BEFORE creating order
    const uniformFilesSnapshot = this.uniformFiles();
    let uploadedUniformFiles: { s3Key: string; fileName: string; contentType: string; fileSize: number }[] = [];
    if (this.hasUniformOverlay() && uniformFilesSnapshot.length > 0) {
      this.uniformUploading.set(true);
      try {
        uploadedUniformFiles = await this.uploadUniformFiles(uniformFilesSnapshot);
      } catch {
        this.uniformUploading.set(false);
        this.submitting.set(false);
        this.toast.error('Не удалось загрузить образцы формы');
        return;
      }
      this.uniformUploading.set(false);
    }

    const uniformDesc = this.hasUniformOverlay() ? this.uniformDescription().trim() : '';

    const items = this.cartItems().map(i => ({
      name: i.name,
      slug: i.categorySlug || undefined,
      service_option_id: i.serviceId || undefined,
      uploadedUrl: undefined,
      quantity: i.quantity,
      price: i.price,
      options: i.optionSlugs.map(s => s).filter(Boolean),
    }));

    if (this.supportTeam()) {
      items.push({
        name: 'Поддержать команду «Своё Фото»',
        slug: 'support-team',
        service_option_id: undefined,
        uploadedUrl: undefined,
        quantity: 1,
        price: this.SUPPORT_TEAM_AMOUNT,
        options: [],
      });
    }

    this.ordersApi.createWalkInOrder({
      items,
      client_name: this.clientName().trim() || undefined,
      client_phone: this.clientPhone().trim() || undefined,
      total_price: this.grandTotal(),
      payment_method: method === 'later' ? undefined : (method as 'cash' | 'card' | 'sbp'),
      comment: this.comment().trim() || undefined,
      uniform_description: uniformDesc || undefined,
    }).subscribe({
      next: res => {
        this.submitting.set(false);
        if (res.success && res.data) {
          if (uploadedUniformFiles.length > 0) {
            firstValueFrom(this.http.post(
              '/api/orders/photo-print/attachments/complete',
              {
                orderId: res.data.orderId,
                attachment_type: 'form_sample',
                files: uploadedUniformFiles,
              },
            )).catch(() => this.toast.error('Заказ создан, но не удалось привязать образцы формы'));
          }
          this.createdOrderId.set(res.data.orderId);
          this.createdReceiptNumber.set(res.data.receiptNumber);
          this.submitted.set(true);
          this.orderCreated.emit({
            orderId: res.data.orderId,
            receiptNumber: res.data.receiptNumber ?? undefined,
          });
          this.toast.success(`Заказ ${res.data.orderId} создан`);
          this.dashData.init();
          this.dashData.loadOrderQueue();
        } else {
          this.toast.error('Не удалось создать заказ');
        }
      },
      error: err => {
        this.submitting.set(false);
        this.toast.error(err?.error?.error || 'Ошибка при создании заказа');
      },
    });
  }

  private generateOnlinePayment(): void {
    this.generatingOnline.set(true);

    const selectedServices = this.cartItems()
      .filter(i => !i.isManual)
      .map(i => ({
        id: i.serviceId,
        name: i.name,
        price: i.price,
        quantity: i.quantity,
      }));

    const body = {
      amount: this.grandTotal(),
      description: this.comment() || `Оплата ${this.grandTotal()}\u202F₽`,
      phone: this.clientPhone().trim() || this.dialogPhone(),
      clientName: this.clientName().trim() || this.dialogClientName(),
      sessionId: this.dialogSessionId() || undefined,
      services: selectedServices,
      autoSend: true,
    };

    this.http.post<{ success: boolean; data: { paymentUrl: string; orderId?: string; amount?: number } }>(
      '/api/payments/create-link', body,
    ).subscribe({
      next: res => {
        this.generatingOnline.set(false);
        if (res.success && res.data?.paymentUrl) {
          this.toast.success('Ссылка на оплату отправлена');
          if (this.dialogRef) {
            this.dialogRef.close({ type: 'sent', orderId: res.data.orderId, amount: res.data.amount });
          } else {
            this.createdOrderId.set(res.data.orderId ?? '');
            this.submitted.set(true);
          }
        } else {
          this.toast.error('Не удалось создать ссылку');
        }
      },
      error: (err: unknown) => {
        this.generatingOnline.set(false);
        this.toast.error(employeeApiErrorMessage(err, 'Ошибка при создании ссылки'));
      },
    });
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  onBack(): void {
    if (this.dialogRef) {
      this.dialogRef.close({ type: 'cancelled' });
    } else {
      this.closed.emit();
      this.router.navigate(['/employee']);
    }
  }

  onClose(): void {
    if (this.dialogRef) {
      this.dialogRef.close({ type: 'cancelled' });
    }
    this.closed.emit();
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  resetOrder(): void {
    this.cartItems.set([]);
    this.comment.set('');
    this.promoCode.set('');
    this.promoApplied.set(false);
    this.clientName.set(this.dialogClientName() || '');
    this.clientPhone.set(this.dialogPhone() || '');
    this.manualAmount.set(0);
    this.manualDesc.set('');
    this.submitted.set(false);
    this.createdOrderId.set('');
    this.createdReceiptNumber.set(null);
    this.supportTeam.set(true);
    this.searchQuery.set('');
    this.searchOpen.set(false);
    this.activeCategory.set(null);
    // Uniform overlay cleanup
    this.hasUniformOverlay.set(false);
    this.uniformDescription.set('');
    for (const f of this.uniformFiles()) { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }
    this.uniformFiles.set([]);
    this.uniformUploading.set(false);
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  private loadCategories(): void {
    this.loading.set(true);
    this.http.get<ApiCategoriesResponse>('/api/pricing/categories').subscribe({
      next: res => {
        if (res.success && Array.isArray(res.categories)) {
          this.categories.set(res.categories.map(c => this.mapCategory(c)));
        }
        this.loading.set(false);
      },
      error: () => {
        this.toast.error('Не удалось загрузить каталог');
        this.loading.set(false);
      },
    });
  }

  private mapCategory(cat: ApiCategory): UiCategory {
    const groups: UiOptionGroup[] = cat.optionGroups
      .filter(g => g.options.length > 0)
      .map(g => ({
        name: g.name,
        slug: g.slug,
        options: g.options.map(o => this.mapOption(o, cat.slug, g.slug)),
      }));

    return {
      slug: cat.slug,
      name: cat.name,
      icon: cat.icon || 'category',
      groups,
      allOptions: groups.flatMap(g => g.options),
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

  private findCategorySlug(serviceId: string): string {
    for (const cat of this.categories()) {
      if (cat.allOptions.some(o => o.id === serviceId)) {
        return cat.slug;
      }
    }
    return '';
  }
}
