/**
 * PricingConfiguratorComponent, интерактивный конфигуратор опций.
 *
 * Загружает категорию из PricingApiService, показывает группы опций,
 * считает цену на лету (client-side), сервер подтверждает при оформлении.
 *
 * Inputs:
 *   categorySlug, slug категории в pricing engine (обязательный)
 *   deliveryMethod, 'electronic' | 'pickup' | 'postal' (по умолчанию 'electronic')
 *   isNewCustomer, применять promo_first_price (по умолчанию false)
 *   showHeader, показывать заголовок категории (по умолчанию false)
 *
 * Outputs:
 *   orderSelected, OrderSelectedEvent при нажатии "Заказать"
 *
 * Phase 3: Frontend Price Unification
 */

import {
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  PricingApiService,
  PricingOptionGroup,
  PricingServiceOption,
  DeliveryMethod,
  SelectedOption,
  PromoValidationResult,
} from '../../../core/services/pricing-api.service';
import { ReferralTrackingService } from '../../../core/services/referral-tracking.service';
import {
  RetouchChecklistApiService,
  RetouchChecklistGroup,
  RetouchGender,
} from '../../../features/employee/services/retouch-checklist-api.service';

// ── Публичный тип события ─────────────────────────────────────────────────

/** Снимок выбора оператора в конфигураторе «Супер обработки» (необязательный). */
export interface RetouchConfigEvent {
  gender: RetouchGender;
  /** group_slug → [item_slug] */
  groups: Record<string, string[]>;
  notes?: string;
}

export interface OrderSelectedEvent {
  categorySlug: string;
  categoryName: string;
  selectedOptions: SelectedOption[];
  deliveryMethod: DeliveryMethod;
  total: number;
  /** Применённый промокод (если есть) */
  promoCode?: string;
  /** Человекочитаемое название для чат-бота / корзины */
  displayName: string;
  /** Конфигуратор «Супер обработки», только когда выбран processing-super (необязательно) */
  retouchConfig?: RetouchConfigEvent;
}

// ── Константы конфигуратора «Супер обработки» ──────────────────────────────

const SUPER_RETOUCH_CATEGORY = 'photo-docs';
const SUPER_RETOUCH_GROUP = 'processing-level';
const SUPER_RETOUCH_OPTION = 'processing-super';

// ── Компонент ─────────────────────────────────────────────────────────────

@Component({
  selector: 'app-pricing-configurator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule, MatButtonModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    @if (pricing.loading()) {
      <div class="pc-loading">
        <mat-spinner diameter="40" />
        <span>Загружаем актуальные цены…</span>
      </div>
    } @else if (pricing.error()) {
      <div class="pc-error">
        <mat-icon>error_outline</mat-icon>
        <span>{{ pricing.error() }}</span>
        <button mat-stroked-button (click)="pricing.loadCategories()">Повторить</button>
      </div>
    } @else if (!category()) {
      <div class="pc-loading">
        <mat-spinner diameter="40" />
      </div>
    } @else {
      <div class="pc-root">
        @if (showHeader()) {
          <div class="pc-header">
            @if (category()!.icon) {
              <mat-icon>{{ category()!.icon }}</mat-icon>
            }
            <h2>{{ category()!.name }}</h2>
          </div>
        }

        <!-- Группы опций, авто-layout -->
        @for (group of category()!.optionGroups; track group.id) {
          <div class="pc-group">
            <div class="pc-group-title">
              <span>{{ group.name }}</span>
              @if (!group.is_required) {
                <span class="pc-optional">опционально</span>
              }
            </div>

            <!-- ═══ CARDS: single-select, 3+ опций ═══ -->
            @if (getGroupLayout(group) === 'cards') {
              <div class="pc-cards">
                @for (opt of group.options; track opt.id) {
                  <div
                    class="pc-card"
                    [class.pc-card--selected]="isSelected(group.slug, opt.slug)"
                    [class.pc-card--popular]="opt.popular"
                    [class.pc-card--disabled]="disabledOptions().has(opt.slug)"
                    [matTooltip]="disabledReasons().get(opt.slug) || ''"
                    [matTooltipDisabled]="!disabledOptions().has(opt.slug)"
                    (click)="toggle(group, opt)"
                    (keydown.enter)="toggle(group, opt)"
                    tabindex="0"
                    role="button"
                    [attr.aria-pressed]="isSelected(group.slug, opt.slug)"
                    [attr.aria-disabled]="disabledOptions().has(opt.slug)"
                  >
                    @if (opt.popular) {
                      <div class="pc-popular">Популярный</div>
                    }
                    <div class="pc-radio"
                         [class.pc-radio--on]="isSelected(group.slug, opt.slug)">
                    </div>
                    <div class="pc-card-top">
                      <div class="pc-card-name">{{ opt.name }}</div>
                      @if (!isGroupFree(group)) {
                        <div class="pc-card-price">
                          @if (resolvedPrice(opt) === 0) {
                            <span class="pc-price pc-price--free">Включено</span>
                          } @else {
                            @if (!isFirstRequired(group)) {
                              <span class="pc-price-prefix">+</span>
                            }
                            <span class="pc-price">{{ resolvedPrice(opt) | number }}</span>
                            <span class="pc-price-cur">₽</span>
                          }
                          @if (opt.original_price && opt.original_price > resolvedPrice(opt)) {
                            <span class="pc-price-orig">{{ opt.original_price | number }}₽</span>
                          }
                        </div>
                      }
                    </div>
                    @if (opt.features.length > 0) {
                      <div class="pc-card-features">
                        @for (f of opt.features; track f) {
                          <span class="pc-chip">{{ f }}</span>
                        }
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- ═══ CHIPS: single-select, 3+ бесплатных опций (тип документа) ═══ -->
            @if (getGroupLayout(group) === 'chips') {
              <div class="pc-chips-wrap">
                @for (opt of group.options; track opt.id) {
                  <button
                    type="button"
                    class="pc-chip-btn"
                    [class.pc-chip-btn--active]="isSelected(group.slug, opt.slug)"
                    [class.pc-chip-btn--disabled]="disabledOptions().has(opt.slug)"
                    (click)="toggle(group, opt)"
                    [attr.aria-pressed]="isSelected(group.slug, opt.slug)"
                  >{{ opt.name }}</button>
                }
              </div>
              @if (selectedChipFeatures(group).length > 0) {
                <div class="pc-chip-details">
                  @for (f of selectedChipFeatures(group); track f) {
                    <span class="pc-chip-detail">{{ f }}</span>
                  }
                </div>
              }
            }

            <!-- ═══ SEGMENT: single-select, 2 опции ═══ -->
            @if (getGroupLayout(group) === 'segment') {
              <div class="pc-segment">
                @for (opt of group.options; track opt.id) {
                  <button
                    type="button"
                    class="pc-seg-btn"
                    [class.pc-seg-btn--active]="isSelected(group.slug, opt.slug)"
                    [class.pc-seg-btn--disabled]="disabledOptions().has(opt.slug)"
                    [matTooltip]="disabledReasons().get(opt.slug) || ''"
                    [matTooltipDisabled]="!disabledOptions().has(opt.slug)"
                    (click)="toggle(group, opt)"
                    [attr.aria-pressed]="isSelected(group.slug, opt.slug)"
                    [attr.aria-disabled]="disabledOptions().has(opt.slug)"
                  >
                    <span class="pc-seg-name">{{ opt.name }}</span>
                    @if (!isGroupFree(group)) {
                      @if (resolvedPrice(opt) > 0) {
                        <span class="pc-seg-price">+{{ resolvedPrice(opt) | number }} ₽</span>
                      } @else {
                        <span class="pc-seg-price pc-seg-price--free">Включено</span>
                      }
                    }
                  </button>
                }
              </div>
            }

            <!-- ═══ ROWS: multi-select / quantity ═══ -->
            @if (getGroupLayout(group) === 'rows') {
              <div class="pc-rows">
                @for (opt of group.options; track opt.id) {
                  <div
                    class="pc-row"
                    [class.pc-row--selected]="isSelected(group.slug, opt.slug)"
                    [class.pc-row--disabled]="disabledOptions().has(opt.slug)"
                    [matTooltip]="disabledReasons().get(opt.slug) || ''"
                    [matTooltipDisabled]="!disabledOptions().has(opt.slug)"
                    (click)="toggle(group, opt)"
                    (keydown.enter)="toggle(group, opt)"
                    tabindex="0"
                    role="button"
                    [attr.aria-pressed]="isSelected(group.slug, opt.slug)"
                    [attr.aria-disabled]="disabledOptions().has(opt.slug)"
                  >
                    <div class="pc-checkbox"
                         [class.pc-checkbox--on]="isSelected(group.slug, opt.slug)">
                      @if (isSelected(group.slug, opt.slug)) {
                        <mat-icon>check</mat-icon>
                      }
                    </div>
                    <div class="pc-row-body">
                      <span class="pc-row-name">{{ opt.name }}</span>
                      @if (opt.description) {
                        <span class="pc-row-desc">{{ opt.description }}</span>
                      }
                    </div>
                    @if (!isGroupFree(group)) {
                      <div class="pc-row-price">
                        @if (resolvedPrice(opt) === 0) {
                          <span class="pc-price pc-price--free">Включено</span>
                        } @else {
                          <span class="pc-price-prefix">+</span>
                          <span class="pc-price">{{ resolvedPrice(opt) | number }}</span>
                          <span class="pc-price-cur">₽</span>
                        }
                      </div>
                    }
                    @if (group.selection_type === 'quantity' && isSelected(group.slug, opt.slug)) {
                      <div class="pc-stepper" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
                        <button class="pc-stepper-btn" (click)="decrementQty(opt.slug)" [disabled]="getQty(opt.slug) <= 1">−</button>
                        <span class="pc-stepper-val">{{ getQty(opt.slug) }}</span>
                        <button class="pc-stepper-btn" (click)="incrementQty(opt.slug)">+</button>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- ═══ КОНФИГУРАТОР «СУПЕР ОБРАБОТКИ» (под карточкой processing-super) ═══ -->
            @if (group.slug === 'processing-level' && isSuperRetouchActive()) {
              <div class="rc-block">
                <div class="rc-head">
                  <div class="rc-head-title">
                    <mat-icon>auto_fix_high</mat-icon>
                    <span>Лист-задание ретушёру</span>
                  </div>
                  <div class="rc-gender" role="group" aria-label="Пол клиента">
                    <button type="button" class="rc-gender-btn"
                            [class.rc-gender-btn--active]="_retouchGender() === 'female'"
                            (click)="setRetouchGender('female')">Ж</button>
                    <button type="button" class="rc-gender-btn"
                            [class.rc-gender-btn--active]="_retouchGender() === 'male'"
                            (click)="setRetouchGender('male')">М</button>
                    <button type="button" class="rc-gender-btn"
                            [class.rc-gender-btn--active]="_retouchGender() === 'any'"
                            (click)="setRetouchGender('any')">Любой</button>
                  </div>
                </div>

                @if (retouchLoading()) {
                  <div class="rc-loading">
                    <mat-spinner diameter="28" />
                    <span>Загружаем чек-лист…</span>
                  </div>
                } @else {
                  @for (rcGroup of visibleRetouchGroups(); track rcGroup.group_slug) {
                    <div class="rc-section">
                      <button type="button" class="rc-section-head"
                              (click)="toggleRetouchSection(rcGroup.group_slug)"
                              [attr.aria-expanded]="!isRetouchSectionCollapsed(rcGroup.group_slug)">
                        <mat-icon class="rc-section-chevron"
                                  [class.rc-section-chevron--collapsed]="isRetouchSectionCollapsed(rcGroup.group_slug)">
                          expand_more
                        </mat-icon>
                        <span class="rc-section-name">{{ rcGroup.group_name }}</span>
                        @if (retouchGroupSelectedCount(rcGroup.group_slug) > 0) {
                          <span class="rc-section-badge">{{ retouchGroupSelectedCount(rcGroup.group_slug) }}</span>
                        }
                      </button>

                      @if (!isRetouchSectionCollapsed(rcGroup.group_slug)) {
                        <!-- notes-группа → textarea (НЕ чекбоксы) -->
                        @if (rcGroup.selection_type === 'notes') {
                          <textarea
                            class="rc-notes"
                            rows="3"
                            maxlength="2000"
                            placeholder="Дополнительные пожелания ретушёру…"
                            [value]="_retouchNotes()"
                            (input)="onRetouchNotesInput($any($event.target).value)"
                          ></textarea>
                        } @else {
                          <div class="rc-items">
                            @for (item of rcGroup.items; track item.slug) {
                              <div
                                class="rc-item"
                                [class.rc-item--selected]="isRetouchItemSelected(rcGroup.group_slug, item.slug)"
                                [class.rc-item--radio]="rcGroup.selection_type === 'single'"
                                (click)="toggleRetouchItem(rcGroup, item.slug)"
                                (keydown.enter)="toggleRetouchItem(rcGroup, item.slug)"
                                tabindex="0"
                                role="button"
                                [attr.aria-pressed]="isRetouchItemSelected(rcGroup.group_slug, item.slug)"
                              >
                                <div class="pc-checkbox rc-checkbox"
                                     [class.rc-checkbox--radio]="rcGroup.selection_type === 'single'"
                                     [class.pc-checkbox--on]="isRetouchItemSelected(rcGroup.group_slug, item.slug)">
                                  @if (isRetouchItemSelected(rcGroup.group_slug, item.slug)) {
                                    <mat-icon>check</mat-icon>
                                  }
                                </div>
                                <div class="rc-item-body">
                                  <span class="rc-item-name">{{ item.name }}</span>
                                  @if (item.hint) {
                                    <span class="rc-item-hint">{{ item.hint }}</span>
                                  }
                                </div>
                                @if (item.addon_price > 0) {
                                  <span class="rc-item-addon">+{{ item.addon_price | number }} ₽</span>
                                }
                              </div>
                            }
                          </div>
                        }
                      }
                    </div>
                  }
                }
              </div>
            }
          </div>
        }

        <!-- Промокод -->
        <div class="pc-promo">
          <div class="pc-promo-row">
            <input
              class="pc-promo-input"
              type="text"
              placeholder="Промокод или реферальный код"
              [value]="promoCodeInput()"
              (input)="promoCodeInput.set($any($event.target).value)"
              (keydown.enter)="applyPromo()"
              [disabled]="promoLoading()"
            />
            <button
              class="pc-promo-btn"
              [disabled]="!promoCodeInput().trim() || promoLoading()"
              (click)="applyPromo()"
            >
              @if (promoLoading()) {
                <mat-spinner diameter="16" />
              } @else {
                Применить
              }
            </button>
            @if (promoValidation()?.valid) {
              <button class="pc-promo-clear" (click)="clearPromo()" matTooltip="Убрать промокод">
                <mat-icon>close</mat-icon>
              </button>
            }
          </div>
          @if (promoValidation(); as pv) {
            @if (pv.valid) {
              <div class="pc-promo-msg pc-promo-msg--ok">
                <mat-icon>check_circle</mat-icon>
                {{ pv.title ?? 'Промокод применён' }}
                @if (pv.discount_percent) {
, скидка {{ pv.discount_percent }}%
                }
              </div>
            } @else {
              <div class="pc-promo-msg pc-promo-msg--err">
                <mat-icon>error_outline</mat-icon>
                {{ pv.error ?? 'Промокод не действует' }}
              </div>
            }
          }
        </div>

        <!-- Итоговая панель (sticky) -->
        <div class="pc-footer" [class.pc-footer--ready]="isValid()">
          <div class="pc-total">
            <span class="pc-total-label">Итого</span>
            @if (promoDiscountAmount() > 0) {
              <span class="pc-total-orig">{{ total() | number }} ₽</span>
              <span class="pc-total-amount pc-total-amount--promo">{{ totalWithPromo() | number }} ₽</span>
            } @else {
              <span class="pc-total-amount">{{ total() | number }} ₽</span>
            }
          </div>

          <button
            class="pc-cta"
            [disabled]="!isValid()"
            (click)="order()"
          >
            <mat-icon>arrow_forward</mat-icon>
            Заказать
          </button>
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    /* ── Состояния загрузки / ошибки ─────────────────────────── */

    .pc-loading,
    .pc-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 48px 24px;
      text-align: center;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.95rem;
    }

    .pc-error mat-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      color: var(--ed-error, #cf6679);
    }

    /* ── Root ────────────────────────────────────────────────── */

    .pc-root {
      display: flex;
      flex-direction: column;
      gap: 20px;
      padding-bottom: 80px;
    }

    .pc-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);

      mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: var(--ed-accent, #f59e0b);
      }

      h2 {
        margin: 0;
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
      }
    }

    /* ── Группа ──────────────────────────────────────────────── */

    .pc-group-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 14px;
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .pc-optional {
      padding: 2px 10px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #a0a0a0);
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      text-transform: none;
      letter-spacing: 0;
    }

    /* ── CARDS layout (single-select, 3+ опций) ──────────────── */

    .pc-cards {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;

      @media (min-width: 480px) { grid-template-columns: repeat(2, 1fr); }
    }

    .pc-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px 14px;
      padding-right: 40px;
      border-radius: 12px;
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
      user-select: none;

      &:hover {
        border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 50%, transparent);
        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      }

      &--popular {
        border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 60%, transparent);
        padding-top: 18px;
      }

      &--selected {
        border-color: var(--ed-accent, #f59e0b);
        background: color-mix(in srgb, var(--ed-accent, #f59e0b) 8%, var(--ed-surface, #0a0a0a));
        box-shadow: 0 2px 12px color-mix(in srgb, var(--ed-accent, #f59e0b) 20%, transparent);
      }

      &--disabled {
        opacity: 0.45;
        cursor: not-allowed;
        pointer-events: auto;
        &:hover { border-color: var(--ed-outline-variant, #2a2a2a); box-shadow: none; }
      }

      .pc-radio {
        position: absolute;
        top: 12px;
        right: 12px;
      }
    }

    .pc-card-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .pc-card-name {
      font-size: 0.95rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      line-height: 1.2;
    }

    .pc-card-price {
      display: flex;
      align-items: baseline;
      gap: 2px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .pc-card-features {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }

    .pc-chip {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--ed-accent, #f59e0b);
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 10%, transparent);
      white-space: nowrap;
    }

    .pc-popular {
      position: absolute;
      top: -9px;
      left: 50%;
      transform: translateX(-50%);
      padding: 1px 10px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 0.75rem;
      font-weight: 800;
      border-radius: 100px;
      white-space: nowrap;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }

    /* ── CHIPS layout (single-select, 3+ бесплатных, тип документа) ── */

    .pc-chips-wrap {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .pc-chip-btn {
      display: inline-flex;
      align-items: center;
      padding: 6px 14px;
      border-radius: 24px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        color: var(--ed-on-surface, #f5f5f5);
      }

      &--active {
        border-color: var(--ed-accent, #f59e0b);
        background: color-mix(in srgb, var(--ed-accent, #f59e0b) 12%, var(--ed-surface, #0a0a0a));
        color: var(--ed-accent, #f59e0b);
        font-weight: 600;
      }

      &--disabled {
        opacity: 0.4;
        cursor: not-allowed;
        &:hover { border-color: var(--ed-outline-variant, #2a2a2a); color: var(--ed-on-surface-variant, #a0a0a0); }
      }
    }

    .pc-chip-details {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .pc-chip-detail {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 100px;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--ed-accent, #f59e0b);
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 10%, transparent);
    }

    /* ── SEGMENT layout (single-select, 2 опции) ──────────────── */

    .pc-segment {
      display: flex;
      border-radius: 12px;
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
      overflow: hidden;
    }

    .pc-seg-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 16px;
      border: none;
      background: transparent;
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
      font-family: inherit;

      &:not(:last-child) {
        border-right: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      &--active {
        background: var(--ed-accent, #f59e0b);
        .pc-seg-name { color: var(--ed-on-accent, #0a0a0a); }
        .pc-seg-price { color: var(--ed-on-accent, #0a0a0a); opacity: 0.8; }
      }

      &:not(.pc-seg-btn--active):hover {
        background: color-mix(in srgb, var(--ed-accent, #f59e0b) 8%, transparent);
      }

      &--disabled {
        opacity: 0.45;
        cursor: not-allowed;
        &:hover { background: transparent; }
      }
    }

    .pc-seg-name {
      font-size: 0.9rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .pc-seg-price {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--ed-accent, #f59e0b);

      &--free {
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    /* ── ROWS layout (multi-select / quantity) ─────────────────── */

    .pc-rows {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .pc-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      user-select: none;

      &:hover {
        border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 40%, transparent);
      }

      &--selected {
        border-color: var(--ed-accent, #f59e0b);
        background: color-mix(in srgb, var(--ed-accent, #f59e0b) 6%, var(--ed-surface, #0a0a0a));
      }

      &--disabled {
        opacity: 0.45;
        cursor: not-allowed;
        pointer-events: auto;
        &:hover { border-color: var(--ed-outline-variant, #2a2a2a); }
      }
    }

    .pc-row-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .pc-row-name {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .pc-row-desc {
      font-size: 0.78rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.3;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      @media (min-width: 600px) {
        white-space: normal;
      }
    }

    .pc-row-price {
      display: flex;
      align-items: baseline;
      gap: 2px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Общие стили индикаторов и цен ─────────────────────────── */

    .pc-radio,
    .pc-checkbox {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      transition: border-color 0.2s, background 0.2s;
      flex-shrink: 0;

      &--on {
        border-color: var(--ed-accent, #f59e0b);
        background: var(--ed-accent, #f59e0b);

        &::after {
          content: '';
          display: block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--ed-on-accent, #0a0a0a);
          margin: 4px auto 0;
        }
      }
    }

    .pc-checkbox {
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;

      &--on {
        border-color: var(--ed-accent, #f59e0b);
        background: var(--ed-accent, #f59e0b);

        &::after { content: none; }

        mat-icon {
          font-size: 14px;
          width: 14px;
          height: 14px;
          color: var(--ed-on-accent, #0a0a0a);
        }
      }
    }

    .pc-price-prefix {
      font-size: 0.9rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .pc-price {
      font-size: 1.15rem;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
      letter-spacing: -0.5px;

      &--free {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .pc-price-cur {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--ed-accent, #f59e0b);
    }

    .pc-price-orig {
      margin-left: 6px;
      font-size: 0.78rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-decoration: line-through;
    }

    /* ── Итоговая панель ─────────────────────────────────────── */

    .pc-footer {
      position: sticky;
      bottom: 16px;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 20px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 20px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.25);
      transition: border-color 0.3s;

      &--ready {
        border-color: var(--ed-accent, #f59e0b);
        box-shadow: 0 8px 32px color-mix(in srgb, var(--ed-accent, #f59e0b) 15%, transparent);
      }
    }

    .pc-total {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .pc-total-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .pc-total-orig {
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-decoration: line-through;
    }

    .pc-total-amount {
      font-size: 1.5rem;
      font-weight: 800;
      color: var(--ed-on-surface, #f5f5f5);
      letter-spacing: -0.5px;

      &--promo {
        color: var(--ed-accent, #f59e0b);
      }
    }

    /* ── Промокод ────────────────────────────────────────────── */

    .pc-promo {
      margin-bottom: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .pc-promo-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .pc-promo-input {
      flex: 1;
      min-width: 0;
      padding: 10px 14px;
      border-radius: 12px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.9rem;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;

      &:focus {
        border-color: var(--ed-accent, #f59e0b);
      }

      &::placeholder {
        color: var(--ed-on-surface-variant, #a0a0a0);
      }

      &:disabled {
        opacity: 0.5;
      }
    }

    .pc-promo-btn {
      white-space: nowrap;
      flex-shrink: 0;
      padding: 10px 16px;
      border-radius: 12px;
      border: 1.5px solid var(--ed-accent, #f59e0b);
      background: transparent;
      color: var(--ed-accent, #f59e0b);
      font-size: 0.85rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s, color 0.2s;
      display: flex;
      align-items: center;
      gap: 4px;

      &:hover:not([disabled]) {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
      }

      &[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    .pc-promo-clear {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;

      &:hover {
        background: var(--ed-error, #ef4444);
        color: #fff;
      }

      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .pc-promo-msg {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      padding: 6px 10px;
      border-radius: 8px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &--ok {
        background: color-mix(in srgb, #22c55e 12%, transparent);
        color: #22c55e;
      }

      &--err {
        background: color-mix(in srgb, #ef4444 12%, transparent);
        color: #ef4444;
      }
    }

    /* ── Итоговая панель ─────────────────────────────────────── */

    .pc-cta {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 28px;
      border: none;
      border-radius: 14px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 1rem;
      font-weight: 800;
      cursor: pointer;
      transition: filter 0.2s, transform 0.15s, box-shadow 0.2s;
      white-space: nowrap;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover:not([disabled]) {
        filter: brightness(1.08);
        box-shadow: 0 6px 20px color-mix(in srgb, var(--ed-accent, #f59e0b) 30%, transparent);
        transform: translateY(-1px);
      }

      &:active:not([disabled]) { transform: scale(0.97); }

      &[disabled] {
        background: var(--ed-outline-variant, #2a2a2a);
        color: var(--ed-on-surface-variant, #a0a0a0);
        cursor: not-allowed;
      }
    }

    @media (max-width: 599px) {
      .pc-footer {
        bottom: 96px;
      }
    }

    @media (max-width: 440px) {
      .pc-footer {
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        padding: 14px 16px;
      }
      .pc-total { flex-direction: row; align-items: baseline; gap: 8px; }
      .pc-cta { justify-content: center; }
    }

    /* ── Quantity stepper ────────────────────────────────────────── */

    .pc-stepper {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }

    .pc-stepper-btn {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      padding: 0;

      &:hover:not([disabled]) {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
        border-color: var(--ed-accent, #f59e0b);
      }

      &[disabled] {
        opacity: 0.4;
        cursor: not-allowed;
      }
    }

    .pc-stepper-val {
      min-width: 24px;
      text-align: center;
      font-size: 1rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    /* ── Конфигуратор «Супер обработки» ────────────────────────────── */

    .rc-block {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 16px;
      border-radius: 14px;
      border: 2px solid color-mix(in srgb, var(--ed-accent, #f59e0b) 35%, transparent);
      background: color-mix(in srgb, var(--ed-accent, #f59e0b) 5%, var(--ed-surface, #0a0a0a));
    }

    .rc-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .rc-head-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
      font-weight: 800;
      color: var(--ed-on-surface, #f5f5f5);

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
        color: var(--ed-accent, #f59e0b);
      }
    }

    .rc-gender {
      display: flex;
      border-radius: 10px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      overflow: hidden;
    }

    .rc-gender-btn {
      padding: 6px 14px;
      border: none;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.85rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;

      &:not(:last-child) { border-right: 1px solid var(--ed-outline-variant, #2a2a2a); }

      &--active {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
      }

      &:not(.rc-gender-btn--active):hover {
        color: var(--ed-on-surface, #f5f5f5);
      }
    }

    .rc-loading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 4px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.9rem;
    }

    .rc-section {
      border-radius: 10px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
      overflow: hidden;
    }

    .rc-section-head {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 12px 14px;
      border: none;
      background: transparent;
      color: var(--ed-on-surface, #f5f5f5);
      font-family: inherit;
      font-size: 0.92rem;
      font-weight: 700;
      cursor: pointer;
      text-align: left;

      &:hover { background: color-mix(in srgb, var(--ed-accent, #f59e0b) 6%, transparent); }
    }

    .rc-section-chevron {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition: transform 0.2s;

      &--collapsed { transform: rotate(-90deg); }
    }

    .rc-section-name { flex: 1; }

    .rc-section-badge {
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 100px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 0.78rem;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .rc-items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 12px 14px;
    }

    .rc-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface, #0a0a0a);
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
      user-select: none;

      &:hover { border-color: color-mix(in srgb, var(--ed-accent, #f59e0b) 45%, transparent); }

      &--selected {
        border-color: var(--ed-accent, #f59e0b);
        background: color-mix(in srgb, var(--ed-accent, #f59e0b) 8%, var(--ed-surface, #0a0a0a));
      }
    }

    /* Крупный чекбокс конфигуратора, заметно больше базового .pc-checkbox */
    .rc-checkbox {
      width: 28px;
      height: 28px;

      &--radio { border-radius: 50%; }

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .rc-item-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .rc-item-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .rc-item-hint {
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.3;
    }

    .rc-item-addon {
      flex-shrink: 0;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
    }

    .rc-notes {
      width: 100%;
      box-sizing: border-box;
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: inherit;
      font-size: 0.9rem;
      resize: vertical;
      outline: none;
      transition: border-color 0.2s;

      &:focus { border-color: var(--ed-accent, #f59e0b); }
      &::placeholder { color: var(--ed-on-surface-variant, #a0a0a0); }
    }
  `],
})
export class PricingConfiguratorComponent implements OnInit {
  protected readonly pricing = inject(PricingApiService);
  private readonly referralTracking = inject(ReferralTrackingService);

  // ── Inputs ────────────────────────────────────────────────────────────────

  readonly categorySlug = input.required<string>();
  readonly deliveryMethod = input<DeliveryMethod>('electronic');
  readonly isNewCustomer = input(false);
  readonly showHeader = input(false);

  // ── Output ────────────────────────────────────────────────────────────────

  readonly orderSelected = output<OrderSelectedEvent>();

  // ── State ─────────────────────────────────────────────────────────────────

  /** group_slug → [selected_option_slugs] */
  private readonly _selections = signal<Record<string, string[]>>({});

  /** option_slug → quantity (для selection_type === 'quantity') */
  private readonly _quantities = signal<Record<string, number>>({});

  /** Slug категории, для которой инициализированы selections (fix 1.3) */
  private readonly _initializedForSlug = signal<string | null>(null);

  /** Текущий ввод промокода */
  protected readonly promoCodeInput = signal('');

  /** Результат валидации промокода */
  protected readonly promoValidation = signal<PromoValidationResult | null>(null);

  /** Идёт запрос валидации промокода */
  protected readonly promoLoading = signal(false);

  // ── Конфигуратор «Супер обработки» ──────────────────────────────────────────

  private readonly retouchChecklistApi = inject(RetouchChecklistApiService);

  /** Каталог чек-листа (lazy-load при первом раскрытии блока) */
  protected readonly retouchChecklist = signal<RetouchChecklistGroup[]>([]);
  protected readonly retouchLoading = signal(false);
  protected readonly retouchLoaded = signal(false);

  /** group_slug → [item_slug], выбор оператора */
  protected readonly _retouchSelections = signal<Record<string, string[]>>({});
  /** Выбранный пол клиента (фильтр опций) */
  protected readonly _retouchGender = signal<RetouchGender>('any');
  /** Свободные заметки ретушёру */
  protected readonly _retouchNotes = signal('');
  /** Свёрнутые секции (group_slug, развёрнутые по умолчанию) */
  protected readonly _retouchCollapsed = signal<Record<string, boolean>>({});
  /** Дефолты предзаполнены (флаг разовости, P0-2) */
  private readonly _retouchDefaultsApplied = signal(false);

  // ── Computed ──────────────────────────────────────────────────────────────

  readonly category = computed(() => this.pricing.getCategoryBySlug(this.categorySlug()));

  /** Сумма скидки по промокоду от текущего итога */
  readonly promoDiscountAmount = computed(() => {
    const pv = this.promoValidation();
    const t = this.total();
    if (!pv?.valid) return 0;
    if (pv.discount_percent) return Math.round(t * pv.discount_percent / 100);
    if (pv.discount_amount) return Math.min(pv.discount_amount, t);
    return 0;
  });

  /** Итого с учётом скидки по промокоду */
  readonly totalWithPromo = computed(() => Math.max(0, this.total() - this.promoDiscountAmount()));

  /** Опции, заблокированные правилами excludes (fix 1.2) */
  readonly disabledOptions = computed((): Set<string> => {
    const cat = this.category();
    if (!cat) return new Set();
    const selectedSlugs = this._getSelectedSlugsSet();
    const disabled = new Set<string>();
    for (const rule of cat.rules) {
      if (rule.rule_type !== 'excludes') continue;
      if (!selectedSlugs.has(rule.source_option_slug)) continue;
      disabled.add(rule.target_option_slug);
    }
    return disabled;
  });

  /** Причины блокировки: option_slug → tooltip text (fix 1.2) */
  readonly disabledReasons = computed((): Map<string, string> => {
    const cat = this.category();
    if (!cat) return new Map();
    const selectedSlugs = this._getSelectedSlugsSet();
    const reasons = new Map<string, string>();
    for (const rule of cat.rules) {
      if (rule.rule_type !== 'excludes') continue;
      if (!selectedSlugs.has(rule.source_option_slug)) continue;
      const sourceName = this._findOptionName(cat.optionGroups, rule.source_option_slug);
      reasons.set(rule.target_option_slug, rule.description || `Несовместимо с "${sourceName}"`);
    }
    return reasons;
  });

  /** Суммарная цена выбранных опций (client-side) */
  readonly total = computed(() => {
    const cat = this.category();
    if (!cat) return 0;
    const sel = this._selections();
    const qtys = this._quantities();
    const dm = this.deliveryMethod();
    const isNew = this.isNewCustomer();
    let sum = 0;
    for (const group of cat.optionGroups) {
      for (const slug of (sel[group.slug] ?? [])) {
        const opt = group.options.find(o => o.slug === slug);
        if (opt) {
          const qty = group.selection_type === 'quantity' ? (qtys[slug] ?? 1) : 1;
          sum += this.pricing.resolveOptionTotal(opt, qty, dm, isNew);
        }
      }
    }
    return sum;
  });

  /** Конфигурация валидна, все required группы заполнены */
  readonly isValid = computed(() => {
    const cat = this.category();
    if (!cat) return false;
    const sel = this._selections();
    for (const group of cat.optionGroups) {
      if (group.is_required && (sel[group.slug] ?? []).length === 0) return false;
    }
    return true;
  });

  /** Активен ли блок «Супер обработки»: категория photo-docs И выбран processing-super */
  readonly isSuperRetouchActive = computed(() => {
    if (this.categorySlug() !== SUPER_RETOUCH_CATEGORY) return false;
    return (this._selections()[SUPER_RETOUCH_GROUP] ?? []).includes(SUPER_RETOUCH_OPTION);
  });

  /**
   * Каталог, отфильтрованный по выбранному полу. «Любой» (any) показывает ВСЕ опции
   * (нейтральные + женские + мужские); «Ж»/«М» — нейтральные + опции своего пола.
   */
  readonly visibleRetouchGroups = computed((): RetouchChecklistGroup[] => {
    const gender = this._retouchGender();
    return this.retouchChecklist()
      .map(group => {
        if (group.selection_type === 'notes') return group;
        const items = gender === 'any'
          ? group.items
          : group.items.filter(i => i.gender === 'any' || i.gender === gender);
        return { ...group, items };
      })
      .filter(group => group.selection_type === 'notes' || group.items.length > 0);
  });

  // ── Private helpers ────────────────────────────────────────────────────────

  private _getSelectedSlugsSet(): Set<string> {
    const sel = this._selections();
    const set = new Set<string>();
    for (const slugs of Object.values(sel)) {
      for (const s of slugs) set.add(s);
    }
    return set;
  }

  private _findOptionName(groups: PricingOptionGroup[], slug: string): string {
    for (const g of groups) {
      const opt = g.options.find(o => o.slug === slug);
      if (opt) return opt.name;
    }
    return slug;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  constructor() {
    // Когда категория изменяется (смена categorySlug), сбросить и реинициализировать (fix 1.3)
    effect(() => {
      const cat = this.category();
      const slug = this.categorySlug();
      if (!cat) return;
      untracked(() => {
        // Инициализировать только если slug изменился
        if (this._initializedForSlug() === slug) return;
        const init: Record<string, string[]> = {};
        for (const group of cat.optionGroups) {
          if (group.selection_type === 'single' && group.is_required) {
            const popular = group.options.find(o => o.popular);
            const def = popular ?? group.options[0];
            init[group.slug] = def ? [def.slug] : [];
          } else {
            init[group.slug] = [];
          }
        }
        this._selections.set(init);
        this._quantities.set({});
        this._initializedForSlug.set(slug);
        // Сброс конфигуратора «Супер обработки» при смене категории
        this._retouchSelections.set({});
        this._retouchNotes.set('');
        this._retouchDefaultsApplied.set(false);
        this._retouchCollapsed.set({});
      });
    });

    // Lazy-load каталога «Супер обработки» при первом раскрытии блока (P0-2: дефолты сразу)
    effect(() => {
      const active = this.isSuperRetouchActive();
      if (!active) return;
      untracked(() => {
        if (this.retouchLoaded()) {
          // Каталог уже загружен (например, повторный заход), применить дефолты сразу
          this.applyRetouchDefaults();
        } else if (!this.retouchLoading()) {
          // Первая загрузка, дефолты применятся в колбэке после получения каталога
          this.loadRetouchChecklist();
        }
      });
    });
  }

  // ── Конфигуратор «Супер обработки»: загрузка / выбор / пол ──────────────────

  private loadRetouchChecklist(): void {
    this.retouchLoading.set(true);
    this.retouchChecklistApi.getRetouchChecklist().subscribe({
      next: groups => {
        this.retouchChecklist.set(groups);
        this.retouchLoaded.set(true);
        this.retouchLoading.set(false);
        this.applyRetouchDefaults();
      },
      error: () => {
        this.retouchLoading.set(false);
      },
    });
  }

  /** Предзаполнить дефолты (is_default) при первом построении блока, P0-2 */
  private applyRetouchDefaults(): void {
    if (this._retouchDefaultsApplied()) return;
    const gender = this._retouchGender();
    const init: Record<string, string[]> = {};
    for (const group of this.retouchChecklist()) {
      if (group.selection_type === 'notes') continue;
      const defaults = group.items
        .filter(i => i.is_default && (gender === 'any' || i.gender === 'any' || i.gender === gender))
        .map(i => i.slug);
      // single-группа: максимум 1 дефолт
      init[group.group_slug] = group.selection_type === 'single' ? defaults.slice(0, 1) : defaults;
    }
    this._retouchSelections.set(init);
    this._retouchDefaultsApplied.set(true);
  }

  isRetouchItemSelected(groupSlug: string, itemSlug: string): boolean {
    return (this._retouchSelections()[groupSlug] ?? []).includes(itemSlug);
  }

  toggleRetouchItem(group: RetouchChecklistGroup, itemSlug: string): void {
    if (group.selection_type === 'notes') return;
    const sel = { ...this._retouchSelections() };
    const current = sel[group.group_slug] ?? [];
    if (group.selection_type === 'single') {
      // Радио-поведение: максимум 1 в группе; повторный клик снимает
      sel[group.group_slug] = current.includes(itemSlug) ? [] : [itemSlug];
    } else {
      sel[group.group_slug] = current.includes(itemSlug)
        ? current.filter(s => s !== itemSlug)
        : [...current, itemSlug];
    }
    this._retouchSelections.set(sel);
  }

  /** Сменить пол: вычистить из выбора варианты противоположного пола, P1-5 («Любой» ничего не вычищает) */
  setRetouchGender(gender: RetouchGender): void {
    if (this._retouchGender() === gender) return;
    this._retouchGender.set(gender);
    // Построить множество допустимых slug при новом поле («Любой» допускает все)
    const allowed = new Set<string>();
    for (const g of this.retouchChecklist()) {
      for (const item of g.items) {
        if (gender === 'any' || item.gender === 'any' || item.gender === gender) allowed.add(item.slug);
      }
    }
    const sel = this._retouchSelections();
    const cleaned: Record<string, string[]> = {};
    for (const [groupSlug, slugs] of Object.entries(sel)) {
      cleaned[groupSlug] = slugs.filter(s => allowed.has(s));
    }
    this._retouchSelections.set(cleaned);
  }

  isRetouchSectionCollapsed(groupSlug: string): boolean {
    return this._retouchCollapsed()[groupSlug] === true;
  }

  toggleRetouchSection(groupSlug: string): void {
    this._retouchCollapsed.update(c => ({ ...c, [groupSlug]: !c[groupSlug] }));
  }

  /** Кол-во выбранных в группе (для бейджа на свёрнутой секции) */
  retouchGroupSelectedCount(groupSlug: string): number {
    return (this._retouchSelections()[groupSlug] ?? []).length;
  }

  onRetouchNotesInput(value: string): void {
    this._retouchNotes.set(value);
  }

  ngOnInit(): void {
    this.pricing.loadCategories();
    // Auto-fill promo code from URL (?promo=) or localStorage
    const savedPromo = this.referralTracking.getPromoCode();
    if (savedPromo) {
      this.promoCodeInput.set(savedPromo);
      this.applyPromo();
    }
  }

  // ── Promo code ────────────────────────────────────────────────────────────

  async applyPromo(): Promise<void> {
    const code = this.promoCodeInput().trim().toUpperCase();
    if (!code) return;
    this.promoLoading.set(true);
    this.promoValidation.set(null);
    try {
      const result = await this.pricing.validatePromoCode(code);
      this.promoValidation.set(result);
    } catch {
      this.promoValidation.set({ valid: false, error: 'Не удалось проверить промокод' });
    } finally {
      this.promoLoading.set(false);
    }
  }

  clearPromo(): void {
    this.promoCodeInput.set('');
    this.promoValidation.set(null);
    this.referralTracking.clearPromo();
  }

  // ── Template helpers ──────────────────────────────────────────────────────

  /** Авто-определение layout: chips для бесплатных single-select (тип документа), cards для primary, segment для бинарных, rows для multi */
  getGroupLayout(group: PricingOptionGroup): 'cards' | 'segment' | 'rows' | 'chips' {
    if (group.selection_type === 'single' && group.options.length <= 2) return 'segment';
    if (group.selection_type !== 'single') return 'rows';
    if (group.selection_type === 'single' && group.options.length >= 3 && this.isGroupFree(group)) return 'chips';
    return 'cards';
  }

  /** Фичи выбранного чипа для показа под кнопками */
  selectedChipFeatures(group: PricingOptionGroup): string[] {
    const sel = this._selections()[group.slug] ?? [];
    if (sel.length === 0) return [];
    const opt = group.options.find(o => o.slug === sel[0]);
    return opt?.features ?? [];
  }

  isSelected(groupSlug: string, optSlug: string): boolean {
    return (this._selections()[groupSlug] ?? []).includes(optSlug);
  }

  /** true если это обязательная группа, цена первой опции показывается без "+" */
  isFirstRequired(group: PricingOptionGroup): boolean {
    return group.is_required;
  }

  /** true если ВСЕ опции в группе бесплатные, скрывает ценник целиком (напр. тип документа) */
  isGroupFree(group: PricingOptionGroup): boolean {
    return group.options.every(o => this.resolvedPrice(o) === 0);
  }


  resolvedPrice(opt: PricingServiceOption): number {
    return this.pricing.resolveOptionPrice(opt, this.deliveryMethod(), this.isNewCustomer());
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  toggle(group: PricingOptionGroup, opt: PricingServiceOption): void {
    // Нельзя выбрать заблокированную опцию (fix 1.2)
    if (this.disabledOptions().has(opt.slug)) return;

    const sel = { ...this._selections() };
    const current = sel[group.slug] ?? [];
    const isSelecting = !current.includes(opt.slug);

    if (group.selection_type === 'single') {
      // Одиночный выбор: клик на выбранный в обязательной группе, ничего не делаем
      if (current.includes(opt.slug)) {
        sel[group.slug] = group.is_required ? [opt.slug] : [];
      } else {
        sel[group.slug] = [opt.slug];
      }
    } else {
      // Множественный / quantity: переключить
      sel[group.slug] = current.includes(opt.slug)
        ? current.filter(s => s !== opt.slug)
        : [...current, opt.slug];
    }

    // Авто-снятие исключаемых опций (fix 1.2: excludes)
    const cat = this.category();
    if (cat && isSelecting) {
      for (const rule of cat.rules) {
        if (rule.rule_type !== 'excludes' || rule.source_option_slug !== opt.slug) continue;
        for (const g of cat.optionGroups) {
          if ((sel[g.slug] ?? []).includes(rule.target_option_slug)) {
            sel[g.slug] = sel[g.slug].filter(s => s !== rule.target_option_slug);
          }
        }
      }
    }

    this._selections.set(sel);
  }

  // ── Quantity helpers (fix 2.5) ────────────────────────────────────────────

  getQty(optSlug: string): number {
    return this._quantities()[optSlug] ?? 1;
  }

  incrementQty(optSlug: string): void {
    this._quantities.update(q => ({ ...q, [optSlug]: (q[optSlug] ?? 1) + 1 }));
  }

  decrementQty(optSlug: string): void {
    this._quantities.update(q => ({ ...q, [optSlug]: Math.max(1, (q[optSlug] ?? 1) - 1) }));
  }

  order(): void {
    if (!this.isValid()) return;
    const cat = this.category()!;
    const sel = this._selections();
    const qtys = this._quantities();

    const selectedOptions: SelectedOption[] = [];
    const names: string[] = [];

    for (const group of cat.optionGroups) {
      for (const slug of (sel[group.slug] ?? [])) {
        const opt = group.options.find(o => o.slug === slug);
        if (opt) {
          const qty = group.selection_type === 'quantity' ? (qtys[slug] ?? 1) : 1;
          // Пропускаем нулевые опции (normal-speed) в displayName
          if (this.pricing.resolveOptionPrice(opt, this.deliveryMethod(), this.isNewCustomer()) > 0
              || group.is_required) {
            names.push(qty > 1 ? `${opt.name} ×${qty}` : opt.name);
          }
          selectedOptions.push({ option_slug: slug, quantity: qty });
        }
      }
    }

    // Конфигуратор «Супер обработки», собираем только когда блок активен
    let retouchConfig: RetouchConfigEvent | undefined;
    if (this.isSuperRetouchActive()) {
      const groups: Record<string, string[]> = {};
      for (const [groupSlug, slugs] of Object.entries(this._retouchSelections())) {
        if (slugs.length > 0) groups[groupSlug] = slugs;
      }
      const notes = this._retouchNotes().trim();
      retouchConfig = {
        gender: this._retouchGender(),
        groups,
        notes: notes || undefined,
      };
    }

    this.orderSelected.emit({
      categorySlug: this.categorySlug(),
      categoryName: cat.name,
      selectedOptions,
      deliveryMethod: this.deliveryMethod(),
      total: this.totalWithPromo(),
      promoCode: this.promoValidation()?.valid ? this.promoCodeInput().trim().toUpperCase() : undefined,
      displayName: `${cat.name}: ${names.join(', ')}, ${this.totalWithPromo()}₽`,
      retouchConfig,
    });

    if (this.promoValidation()?.valid) {
      this.referralTracking.clearPromo();
    }
  }
}
