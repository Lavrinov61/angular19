import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
  PLATFORM_ID, OnInit,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
// MatTabsModule removed, using custom pill tabs
import { MatExpansionModule } from '@angular/material/expansion';
import { SeoService } from '../../../core/services/seo.service';
import { CloudPaymentsService } from '../../../core/services/cloud-payments.service';
import { AuthService } from '../../../core/services/auth.service';
import { ScrollRevealDirective } from '../../../shared/directives/scroll-reveal.directive';

interface PlanProduct {
  product_id: string;
  product_name: string;
  product_price: number;
  credit_price: number;
  unit: string;
  is_required: boolean;
  included_quantity: number;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  base_price: number;
  is_customizable: boolean;
  billing_period: string;
  subscriber_discount_percent: number;
  credits_rollover_months: number;
  features: string[];
  items: PlanProduct[];
  category: string;
  icon: string;
  savings_label: string | null;
  is_popular: boolean;
}

interface CategoryMeta {
  key: string;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  highlight: string;
  hidePrice: boolean;
}

interface PlanDisplayInfo {
  headline: string;
  subtitle: string;
  items: string[];
}

interface TrialInfoResponse {
  success: boolean;
  trialDays: number;
  redeemMode?: string;
  planId?: string;
  planName?: string;
  expiresAt?: string | null;
  error?: string;
}

interface SubscriptionInitResponse {
  subscriptionId: string;
  monthlyPrice: number;
  trialPeriodDays: number;
  trialEnd?: string | null;
}

const PLAN_DISPLAY: Record<string, PlanDisplayInfo> = {
  'doc-print-student': {
    headline: 'Документы −20% / фото −10%',
    subtitle: 'Личная подписка',
    items: ['Скидка на печать документов, 20%', 'Скидка на печать фотографий, 10%'],
  },
  'doc-print-business': {
    headline: 'Скидка 20%',
    subtitle: 'Для малого бизнеса',
    items: ['Печать A4 ч/б дешевле по подписке', 'Скидка 20% на объёмную печать', 'Без фиксированных кредитов'],
  },
  'doc-print-office': {
    headline: 'Скидка 30%',
    subtitle: 'Для офиса',
    items: ['Печать A4 ч/б дешевле по подписке', 'Скидка 30% на объёмную печать', 'Без фиксированных кредитов'],
  },
  'photoprint-fan': {
    headline: 'Скидка 10%',
    subtitle: 'Для регулярных фото',
    items: ['Фотопечать дешевле по подписке', 'Скидка 10% на форматы плана', 'Без фиксированных кредитов'],
  },
  'photoprint-family': {
    headline: 'Скидка 15%',
    subtitle: 'Для семейного архива',
    items: ['Фотопечать дешевле на объёме', 'Скидка 15% на форматы плана', 'Оплата фактически напечатанных снимков'],
  },
  'photoprint-photographer': {
    headline: 'Скидка 20%',
    subtitle: 'Для частой фотопечати',
    items: ['Максимальная скидка на фотопечать', 'Скидка 20% на форматы плана', 'Без сгорающих пакетов фото'],
  },
  'launch-photoprint-lite': {
    headline: 'Скидка 5%',
    subtitle: 'Стартовая фотопечать',
    items: ['Фотопечать дешевле по подписке', 'Скидка 5% на форматы плана', 'Без фиксированных кредитов'],
  },
  'launch-photoprint-standard': {
    headline: 'Скидка 10%',
    subtitle: 'Регулярная фотопечать',
    items: ['Цена ниже на регулярном объёме', 'Скидка 10% на форматы плана', 'Оплата фактического количества фото'],
  },
  'launch-photoprint-pro': {
    headline: 'Скидка 15%',
    subtitle: 'Для больших заказов',
    items: ['Максимальная скидка на фотопечать', 'Скидка 15% на форматы плана', 'Без фиксированных кредитов'],
  },
};

// Phone mask: +7 (XXX) XXX-XX-XX
const PHONE_MASK = '(___) ___-__-__';
function applyPhoneMask(digits: string): string {
  let result = '';
  const d = digits.slice(0, 10);
  let di = 0;
  for (let i = 0; i < PHONE_MASK.length; i++) {
    if (PHONE_MASK[i] === '_') {
      result += di < d.length ? d[di++] : '_';
    } else {
      if (i === 0 && d.length === 0) break;
      if (i === 5 && d.length < 3) break;
      if (i === 5 && d.length === 3) { result += ')'; break; }
      if (i === 9 && d.length < 6) break;
      if (i === 12 && d.length < 8) break;
      result += PHONE_MASK[i];
    }
  }
  return result;
}
function phoneCursorPos(masked: string, digitCount: number): number {
  if (digitCount === 0) return 0;
  let count = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i])) {
      count++;
      if (count === digitCount) return i + 1;
    }
  }
  return masked.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  return value === null ? null : readString(value);
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return readString(value['error']);
}

function parseTrialInfoResponse(value: unknown): TrialInfoResponse {
  if (!isRecord(value)) {
    return { success: false, trialDays: 0 };
  }

  return {
    success: value['success'] === true,
    trialDays: readNumber(value['trial_days']),
    redeemMode: readString(value['redeem_mode']),
    planId: readString(value['plan_id']),
    planName: readString(value['plan_name']),
    expiresAt: readNullableString(value['ends_at']),
    error: readString(value['error']),
  };
}

function parseSubscriptionInitResponse(value: unknown): SubscriptionInitResponse {
  if (!isRecord(value)) {
    return { subscriptionId: '', monthlyPrice: 0, trialPeriodDays: 0 };
  }

  return {
    subscriptionId: readString(value['subscription_id']) || '',
    monthlyPrice: readNumber(value['monthly_price']),
    trialPeriodDays: readNumber(value['trial_period_days']),
    trialEnd: readNullableString(value['trial_end']),
  };
}

const CATEGORIES: CategoryMeta[] = [
  { key: 'doc-print', label: 'Печать документов A4', shortLabel: 'Печать A4', icon: 'print', description: 'Подключённый доступ активирует скидки аккаунта: документы A4 и фотопечать считаются дешевле по выбранному типу.', highlight: 'личный, А4 −20%, фото 10×15 −10%; бизнес, по реквизитам', hidePrice: false },
  { key: 'photo-print', label: 'Печать фотографий', shortLabel: 'Фотопечать', icon: 'photo_library', description: 'Семейные фото, архивы и заказы фотографов, ниже цена на объёме', highlight: 'скидка на фактически напечатанные снимки', hidePrice: false },
];

@Component({
  selector: 'app-subscription-plans',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatDividerModule,
    MatProgressSpinnerModule, MatSnackBarModule,
    MatExpansionModule, DecimalPipe, ScrollRevealDirective,
  ],
  template: `
    <div class="sub-page">

      <!-- ═══ Hero ═══ -->
      <section class="hero" appScrollReveal>
        <div class="hero-inner">
          <h1 class="hero-title">
            <span class="hero-line">Печатай</span>
            <span class="hero-line hero-line--accent">дешевле.</span>
            <span class="hero-line">Каждый месяц.</span>
          </h1>
          <div class="hero-price-anchor">от 199 \u20bd/мес</div>
          <p class="hero-subtitle">
            Подписка на печать документов и фотографий.<br>
            Оплачивайте фактический объём по цене подписчика.
          </p>
          <button class="hero-cta" (click)="scrollToPlans()">
            <mat-icon>arrow_downward</mat-icon>
            Выбрать подписку
          </button>
        </div>
        <div class="hero-glow"></div>
      </section>

      <!-- ═══ USP strip ═══ -->
      <section class="usp-strip" appScrollReveal [delay]="150">
        <div class="usp-item">
          <mat-icon>verified</mat-icon>
          <span>Подписка на печать документов и фотографий в Ростове</span>
        </div>
        <div class="usp-divider"></div>
        <div class="usp-item">
          <mat-icon>autorenew</mat-icon>
          <span>Без фиксированных кредитов и лимитов</span>
        </div>
        <div class="usp-divider"></div>
        <div class="usp-item">
          <mat-icon>block</mat-icon>
          <span>Отмена в любой момент без штрафов</span>
        </div>
      </section>

      @if (loading()) {
        <div class="loading-center">
          <mat-spinner diameter="40" />
        </div>
      } @else {

        <!-- ═══ Category selector + Plans ═══ -->
        <section class="plans-section" id="plans">
          <!-- Custom pill tabs -->
          <div class="cat-tabs">
            @for (cat of activeCategories(); track cat.key; let i = $index) {
              <button
                class="cat-tab"
                [class.cat-tab--active]="activeTabIndex() === i"
                (click)="activeTabIndex.set(i)"
              >
                <mat-icon>{{ cat.icon }}</mat-icon>
                <span class="cat-tab-label-full">{{ cat.label }}</span>
                <span class="cat-tab-label-short">{{ cat.shortLabel }}</span>
              </button>
            }
          </div>

          <!-- Active category content -->
          @if (activeCategory(); as cat) {
            <div class="category-body">
              <p class="category-desc">{{ cat.description }}</p>
              <div class="category-highlight">{{ cat.highlight }}</div>

              <div class="plans-grid">
                @for (plan of plansForCategory(cat.key); track plan.id; let i = $index) {
                  <div
                    class="plan-card"
                    [class.plan-card--entry]="plan.base_price <= 199"
                    appScrollReveal [delay]="i * 120"
                  >
                    <!-- Savings badge -->
                    @if (savingsPercent(plan) > 0) {
                      <div class="savings-badge">-{{ savingsPercent(plan) }}%</div>
                    }

                    <!-- Popular tag -->
                    @if (plan.is_popular) {
                      <div class="popular-tag">Выгодно</div>
                    }

                    <!-- Header -->
                    <div class="plan-header">
                      <div class="plan-headline">{{ displayInfo(plan).headline }}</div>
                      <div class="plan-subtitle">{{ displayInfo(plan).subtitle }}</div>
                    </div>

                    <!-- Price block -->
                    <div class="plan-price-block">
                      @if (retailPrice(plan) > plan.base_price) {
                        <span class="plan-retail">{{ retailPrice(plan) | number:'1.0-0' }} \u20bd</span>
                      }
                      <div class="plan-price">
                        <span class="plan-price-value">{{ plan.base_price | number:'1.0-0' }}</span>
                        <span class="plan-price-suffix">\u20bd/мес</span>
                      </div>
                    </div>

                    <!-- Savings callout -->
                    @if (savingsAmount(plan) > 0) {
                      <div class="plan-savings-callout">
                        <mat-icon>trending_down</mat-icon>
                        Экономия {{ savingsAmount(plan) | number:'1.0-0' }} \u20bd на выбранном объёме
                      </div>
                    }

                    <div class="plan-divider"></div>

                    <!-- Features -->
                    <div class="plan-features">
                      @for (feature of displayInfo(plan).items; track feature) {
                        <div class="plan-feature">
                          <mat-icon>check_circle</mat-icon>
                          <span>{{ feature }}</span>
                        </div>
                      }
                    </div>

                    <!-- CTA -->
                    <button class="plan-cta" [class.plan-cta--entry]="plan.base_price <= 199" (click)="selectPlan(plan)">
                      @if (plan.base_price <= 199) {
                        Попробовать за {{ plan.base_price | number:'1.0-0' }} \u20bd
                      } @else {
                        Начать экономить
                      }
                    </button>
                  </div>
                }
              </div>
            </div>
          }
        </section>

        <!-- ═══ Dynamic Comparison ═══ -->
        @if (comparisonData(); as comp) {
          <section class="compare-section" appScrollReveal>
            <h2>Подписка vs Разовые покупки</h2>
            <p class="compare-subtitle">Наглядный пример экономии для тарифа \u00ab{{ comp.planName }}\u00bb</p>
            <div class="compare-grid">
              <div class="compare-card compare-card--regular">
                <div class="compare-label">Без подписки</div>
                <div class="compare-scenario">{{ comp.scenario }}</div>
                <div class="compare-price">{{ comp.retailTotal | number:'1.0-0' }} \u20bd</div>
                <div class="compare-note">{{ comp.retailNote }}</div>
              </div>
              <div class="compare-arrow">
                <mat-icon>arrow_forward</mat-icon>
              </div>
              <div class="compare-card compare-card--subscription">
                <div class="compare-label">С подпиской</div>
                <div class="compare-scenario">{{ comp.scenario }}</div>
                <div class="compare-price">{{ comp.subPrice | number:'1.0-0' }} \u20bd/мес</div>
                <div class="compare-savings-pill">
                  Экономия {{ comp.savingsPercent }}%
                </div>
              </div>
            </div>
          </section>
        }

        <!-- ═══ How it works ═══ -->
        <section class="how-section">
          <h2>Как это работает</h2>
          <div class="steps-grid">
            @for (step of steps; track step.num; let i = $index) {
              <div class="step-card" appScrollReveal [delay]="i * 100">
                <div class="step-num">{{ step.num }}</div>
                <mat-icon>{{ step.icon }}</mat-icon>
                <h3>{{ step.title }}</h3>
                <p>{{ step.desc }}</p>
              </div>
            }
          </div>
        </section>

        <!-- ═══ Trust signals ═══ -->
        <section class="trust-section" appScrollReveal>
          <div class="trust-grid">
            <div class="trust-item">
              <mat-icon>timer_off</mat-icon>
              <span>Отмена за 30 секунд, без штрафов</span>
            </div>
            <div class="trust-item">
              <mat-icon>local_offer</mat-icon>
              <span>Цена ниже на каждый оплаченный объём</span>
            </div>
            <div class="trust-item">
              <mat-icon>money_off</mat-icon>
              <span>Нет скрытых платежей</span>
            </div>
            <div class="trust-item">
              <mat-icon>storefront</mat-icon>
              <span>Работает в обеих точках Ростова</span>
            </div>
          </div>
        </section>

        <!-- ═══ FAQ ═══ -->
        <section class="faq-section" appScrollReveal>
          <h2>Частые вопросы</h2>
          <mat-accordion class="faq-accordion">
            @for (faq of faqs; track faq.q) {
              <mat-expansion-panel>
                <mat-expansion-panel-header>
                  <mat-panel-title>{{ faq.q }}</mat-panel-title>
                </mat-expansion-panel-header>
                <p class="faq-answer">{{ faq.a }}</p>
              </mat-expansion-panel>
            }
          </mat-accordion>
        </section>

        <!-- ═══ Bottom CTA ═══ -->
        <section class="bottom-cta" appScrollReveal>
          <p class="bottom-cta-title">Не знаете, что выбрать?</p>
          <p class="bottom-cta-sub">Напишите, подберём подписку за 2 минуты</p>
          <div class="cta-buttons">
            <a class="cta-messenger cta-messenger--tg" href="https://t.me/magnus_photo" target="_blank" rel="noopener">
              <span class="cta-messenger__icon"><mat-icon svgIcon="channel-telegram" /></span>
              <span>Telegram</span>
            </a>
            <a class="cta-messenger cta-messenger--vk" href="https://vk.me/svoefoto_rnd" target="_blank" rel="noopener">
              <span class="cta-messenger__icon"><mat-icon svgIcon="channel-vk" /></span>
              <span>VK</span>
            </a>
            <a class="cta-messenger cta-messenger--max" href="https://max.ru/svoefoto" target="_blank" rel="noopener">
              <span class="cta-messenger__icon"><mat-icon svgIcon="channel-max" /></span>
              <span>МАКС</span>
            </a>
          </div>
        </section>

      }

      <!-- ═══ Checkout dialog ═══ -->
      @if (showCheckout()) {
        <div class="dialog-overlay" (click)="showCheckout.set(false)" (keydown.escape)="showCheckout.set(false)" tabindex="0">
          <mat-card appearance="outlined" class="dialog-card" (click)="$event.stopPropagation()">
            <mat-card-content>
              <h3>Оформление подписки</h3>

              @if (selectedPlan(); as plan) {
                <div class="checkout-plan">
                  <div class="checkout-plan-name">{{ displayInfo(plan).headline }}</div>
                  <div class="checkout-plan-price">
                    @if (retailPrice(plan) > plan.base_price) {
                      <span class="checkout-retail">{{ retailPrice(plan) | number:'1.0-0' }} \u20bd</span>
                    }
                    <strong>{{ plan.base_price | number:'1.0-0' }} \u20bd/мес</strong>
                  </div>
                </div>

                @if (savingsAmount(plan) > 0) {
                  <div class="checkout-savings">
                    Вы экономите {{ savingsAmount(plan) | number:'1.0-0' }} \u20bd на выбранном объёме
                  </div>
                }
              }

              @if (isLoggedIn()) {
                <!-- Авторизованный пользователь, данные уже есть -->
                <div class="checkout-user-info">
                  <mat-icon>person</mat-icon>
                  <span>{{ authService.currentUser()?.display_name || authService.currentUser()?.email }}</span>
                </div>

                @if (!authService.currentUser()?.phone) {
                  <mat-form-field appearance="outline" class="full-width">
                    <mat-label>Телефон для использования в студии</mat-label>
                    <input matInput [value]="maskedPhone()" type="tel" inputmode="numeric"
                           (input)="onPhoneInput($event)" (keydown)="onPhoneKeydown($event)">
                    <span matPrefix class="phone-prefix">+7</span>
                  </mat-form-field>
                }
              } @else {
                <!-- Гость, собираем данные -->
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Телефон</mat-label>
                  <input matInput [value]="maskedPhone()" type="tel" inputmode="numeric"
                         (input)="onPhoneInput($event)" (keydown)="onPhoneKeydown($event)">
                  <span matPrefix class="phone-prefix">+7</span>
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Email для чеков</mat-label>
                  <input matInput [(ngModel)]="checkoutEmail" type="email"
                         placeholder="email@example.com">
                  <mat-icon matPrefix>email</mat-icon>
                </mat-form-field>

                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Ваше имя</mat-label>
                  <input matInput [(ngModel)]="checkoutName">
                  <mat-icon matPrefix>person</mat-icon>
                </mat-form-field>
              }

              <!-- Промокод -->
              <div class="checkout-promo">
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Промокод</mat-label>
                  <input #promoInput matInput
                         [value]="promoCode()"
                         (input)="onPromoInput(promoInput.value)"
                         maxlength="20"
                         placeholder="SVV-XXXXX"
                         style="text-transform: uppercase; letter-spacing: 1px">
                  <mat-icon matPrefix>card_giftcard</mat-icon>
                  @if (promoLoading()) {
                    <mat-icon matSuffix class="spin">sync</mat-icon>
                  }
                </mat-form-field>
                @if (promoError()) {
                  <p class="promo-error">{{ promoError() }}</p>
                }
                @if (trialDays() > 0) {
                  <div class="promo-success">
                    <mat-icon>card_giftcard</mat-icon>
                    <span>{{ trialDays() }} дн. бесплатно, потом {{ selectedPlan()?.base_price | number:'1.0-0' }}\u2009\u20bd/мес</span>
                  </div>
                }
              </div>

              <p class="checkout-note">
                @if (trialDays() > 0) {
                  Бесплатный пробный период {{ trialDays() }} дн. Первое списание через {{ trialDays() }} дн. Отменить, в личном кабинете.
                } @else {
                  Автоматическое списание раз в месяц. Отменить, в личном кабинете.
                }
              </p>

              <div class="dialog-actions">
                <button mat-button (click)="showCheckout.set(false)">Отмена</button>
                <button mat-flat-button
                        [disabled]="subscribing() || (!isLoggedIn() && !checkoutPhone.trim())"
                        (click)="confirmSubscription()">
                  @if (subscribing()) {
                    <mat-icon class="spin">sync</mat-icon>
                  }
                  @if (trialDays() > 0) {
                    Начать бесплатно на {{ trialDays() }} дн.
                  } @else {
                    Подключить за {{ selectedPlan()?.base_price | number:'1.0-0' }} \u20bd/мес
                  }
                </button>
              </div>
            </mat-card-content>
          </mat-card>
        </div>
      }

    </div>
  `,
  styles: [`
    /* ── Host-level Material overrides for editorial dark theme ── */
    :host {
      --mat-button-filled-container-color: var(--ed-accent, #f59e0b);
      --mat-button-filled-label-text-color: var(--ed-on-accent, #0a0a0a);
      --mat-filled-button-hover-state-layer-opacity: 0.12;
      --mat-button-outlined-outline-color: var(--ed-outline, #3a3a3a);
      --mat-button-outlined-label-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-text-button-state-layer-color: var(--ed-accent, #f59e0b);
      --mat-button-text-label-text-color: var(--ed-accent, #f59e0b);

      --mdc-outlined-text-field-outline-color: var(--ed-outline, #3a3a3a);
      --mdc-outlined-text-field-hover-outline-color: var(--ed-on-surface-variant, #a0a0a0);
      --mdc-outlined-text-field-focus-outline-color: var(--ed-accent, #f59e0b);
      --mdc-outlined-text-field-label-text-color: var(--ed-on-surface-variant, #a0a0a0);
      --mdc-outlined-text-field-focus-label-text-color: var(--ed-accent, #f59e0b);
      --mdc-outlined-text-field-input-text-color: var(--ed-on-surface, #f5f5f5);
      --mdc-outlined-text-field-caret-color: var(--ed-accent, #f59e0b);
      --mat-form-field-container-text-color: var(--ed-on-surface, #f5f5f5);

      --mat-card-outlined-container-color: var(--ed-surface-container, #1a1a1a);
      --mat-card-outlined-outline-color: var(--ed-outline-variant, #2a2a2a);

      --mdc-circular-progress-active-indicator-color: var(--ed-accent, #f59e0b);

      --mat-icon-button-state-layer-color: var(--ed-accent, #f59e0b);
      --mat-icon-button-icon-color: var(--ed-on-surface, #f5f5f5);

      --mat-divider-color: var(--ed-outline-variant, #2a2a2a);

      /* mat-tab overrides kept for expansion panel compat */

      --mat-expansion-container-background-color: var(--ed-surface-container, #1a1a1a);
      --mat-expansion-container-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-expansion-header-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-expansion-header-indicator-color: var(--ed-on-surface-variant, #a0a0a0);
      --mat-expansion-header-hover-state-layer-color: rgba(245, 158, 11, 0.04);
    }

    /* ── Page shell ── */
    .sub-page {
      max-width: var(--ed-max-width, 1200px);
      margin: 0 auto;
      padding: 0 16px 80px;
      background: var(--ed-surface, #0a0a0a);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
    }

    /* ══════════════════════════════════════════
       HERO, editorial statement with glow
    ══════════════════════════════════════════ */
    .hero {
      position: relative;
      text-align: center;
      padding: 56px 0 40px;
      overflow: hidden;
    }
    .hero-inner { position: relative; z-index: 1; }
    .hero-glow {
      position: absolute;
      top: 20%;
      left: 50%;
      width: 400px;
      height: 400px;
      background: radial-gradient(circle, rgba(245, 158, 11, 0.08) 0%, transparent 70%);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .hero-title {
      margin: 0 0 16px;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: clamp(32px, 7vw, 52px);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      line-height: 1.05;
    }
    .hero-line { display: block; }
    .hero-line--accent { color: var(--ed-accent, #f59e0b); }
    .hero-price-anchor {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: clamp(22px, 5vw, 36px);
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
      margin-bottom: 12px;
      letter-spacing: 0.02em;
    }
    .hero-subtitle {
      font-size: clamp(15px, 2.5vw, 18px);
      color: var(--ed-on-surface-variant, #a0a0a0);
      max-width: 480px;
      margin: 0 auto 24px;
      line-height: 1.6;
    }
    .hero-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 32px;
      border: 2px solid var(--ed-accent, #f59e0b);
      border-radius: 100px;
      background: transparent;
      color: var(--ed-accent, #f59e0b);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.25s ease;
      animation: ed-accent-pulse 3s ease-in-out infinite;
      mat-icon { font-size: 20px; width: 20px; height: 20px; transition: transform 0.25s; }
      &:hover {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
        mat-icon { transform: translateY(3px); }
      }
    }

    /* ══════════════════════════════════════════
       USP strip, horizontal trust bar
    ══════════════════════════════════════════ */
    .usp-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
      max-width: 800px;
      margin: 0 auto 48px;
      padding: 16px 20px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 12px;
    }
    .usp-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
      mat-icon {
        font-size: 18px; width: 18px; height: 18px;
        color: var(--ed-accent, #f59e0b);
        flex-shrink: 0;
      }
    }
    .usp-divider {
      width: 1px; height: 20px;
      background: var(--ed-outline-variant, #2a2a2a);
      flex-shrink: 0;
    }
    @media (max-width: 599px) {
      .usp-strip { flex-direction: column; gap: 10px; }
      .usp-divider { width: 60px; height: 1px; }
    }

    .loading-center { display: flex; justify-content: center; padding: 60px; }

    /* ══════════════════════════════════════════
       Category pill tabs
    ══════════════════════════════════════════ */
    .plans-section { margin-bottom: 16px; }
    .cat-tabs {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .cat-tab {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 100px;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &:hover {
        border-color: var(--ed-outline, #3a3a3a);
        color: var(--ed-on-surface, #f5f5f5);
      }
    }
    .cat-tab--active {
      background: var(--ed-accent, #f59e0b);
      border-color: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      &:hover {
        background: var(--ed-accent-hover, #fbbf24);
        border-color: var(--ed-accent-hover, #fbbf24);
        color: var(--ed-on-accent, #0a0a0a);
      }
    }
    @media (max-width: 599px) {
      .cat-tab-label { display: none; }
      .cat-tab { padding: 10px 14px; }
    }

    .category-body { padding: 24px 0 16px; }
    .category-desc {
      text-align: center;
      font-size: 15px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 6px;
    }
    .category-highlight {
      text-align: center;
      font-size: 14px;
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
      margin: 0 0 28px;
    }

    /* ══════════════════════════════════════════
       Plan cards, magazine-style pricing
    ══════════════════════════════════════════ */
    .plans-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 20px;
    }
    @media (min-width: 640px) {
      .plans-grid { grid-template-columns: repeat(3, 1fr); }
    }

    .plan-card {
      position: relative;
      display: flex;
      flex-direction: column;
      padding: 28px 24px 24px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 16px;
      transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
      &:hover {
        transform: translateY(-3px);
        border-color: var(--ed-outline, #3a3a3a);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      }
    }
    .plan-card--entry {
      border-color: var(--ed-accent, #f59e0b);
      box-shadow: 0 0 0 1px var(--ed-accent, #f59e0b);
      animation: ed-accent-pulse 4s ease-in-out infinite;
      &:hover {
        border-color: var(--ed-accent-hover, #fbbf24);
        box-shadow: 0 8px 32px rgba(245, 158, 11, 0.15);
      }
    }

    .savings-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      padding: 4px 10px;
      border-radius: 100px;
      background: rgba(34, 197, 94, 0.15);
      color: var(--ed-success, #22c55e);
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.01em;
    }

    .popular-tag {
      position: absolute;
      top: -1px;
      left: 20px;
      padding: 3px 14px;
      border-radius: 0 0 8px 8px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .plan-header { margin-bottom: 16px; }
    .plan-headline {
      font-size: 20px;
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 4px;
    }
    .plan-subtitle {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-weight: 500;
    }

    .plan-price-block { margin-bottom: 12px; }
    .plan-retail {
      font-size: 14px;
      color: var(--ed-on-surface-muted, #666666);
      text-decoration: line-through;
      margin-right: 8px;
    }
    .plan-price { display: flex; align-items: baseline; gap: 4px; }
    .plan-price-value {
      font-size: 36px;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
      line-height: 1;
    }
    .plan-price-suffix {
      font-size: 15px;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .plan-savings-callout {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      margin-bottom: 12px;
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.15);
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      color: var(--ed-success, #22c55e);
      mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
    }

    .plan-divider {
      height: 1px;
      background: var(--ed-outline-variant, #2a2a2a);
      margin-bottom: 16px;
    }

    .plan-features {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 20px;
      flex-grow: 1;
    }
    .plan-feature {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 14px;
      line-height: 1.4;
      mat-icon {
        font-size: 18px; width: 18px; height: 18px;
        color: var(--ed-success, #22c55e);
        flex-shrink: 0;
        margin-top: 1px;
      }
    }

    .plan-cta {
      width: 100%;
      padding: 14px;
      border: 2px solid var(--ed-accent, #f59e0b);
      border-radius: 100px;
      background: transparent;
      color: var(--ed-accent, #f59e0b);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      &:hover {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
      }
    }
    .plan-cta--entry {
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      &:hover {
        background: var(--ed-accent-hover, #fbbf24);
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.3);
      }
    }

    /* ══════════════════════════════════════════
       Comparison
    ══════════════════════════════════════════ */
    .compare-section {
      margin: 56px 0 48px;
      text-align: center;
    }
    h2 {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: clamp(22px, 4vw, 28px);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      margin: 0 0 8px;
      text-align: center;
    }
    .compare-subtitle {
      font-size: 15px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 4px 0 28px;
    }
    .compare-grid {
      display: flex;
      align-items: stretch;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .compare-card {
      flex: 0 1 280px;
      padding: 28px 24px;
      border-radius: 16px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .compare-card--regular {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }
    .compare-card--subscription {
      background: var(--ed-accent-container, #451a03);
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .compare-label {
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }
    .compare-card--subscription .compare-label {
      color: var(--ed-accent, #f59e0b);
    }
    .compare-scenario {
      font-size: 14px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }
    .compare-price {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 32px;
      font-weight: 700;
    }
    .compare-card--regular .compare-price {
      color: var(--ed-on-surface-muted, #666666);
      text-decoration: line-through;
    }
    .compare-card--subscription .compare-price {
      color: var(--ed-accent, #f59e0b);
    }
    .compare-note {
      font-size: 13px;
      color: var(--ed-on-surface-muted, #666666);
    }
    .compare-savings-pill {
      display: inline-block;
      padding: 5px 16px;
      border-radius: 100px;
      background: rgba(34, 197, 94, 0.15);
      color: var(--ed-success, #22c55e);
      font-size: 14px;
      font-weight: 700;
    }
    .compare-arrow {
      display: flex; align-items: center;
      mat-icon {
        font-size: 28px; width: 28px; height: 28px;
        color: var(--ed-accent, #f59e0b);
      }
    }
    @media (max-width: 599px) {
      .compare-grid { flex-direction: column; }
      .compare-card { flex: 1 1 auto; }
      .compare-arrow mat-icon { transform: rotate(90deg); }
    }

    /* ══════════════════════════════════════════
       How it works
    ══════════════════════════════════════════ */
    .how-section { margin: 48px 0; }
    .steps-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px;
      margin-top: 24px;
    }
    @media (min-width: 840px) {
      .steps-grid { grid-template-columns: repeat(4, 1fr); }
    }
    .step-card {
      text-align: center;
      padding: 24px 16px;
      border-radius: 16px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      position: relative;
      transition: border-color 0.2s;
      &:hover { border-color: var(--ed-accent, #f59e0b); }
      mat-icon {
        font-size: 28px; width: 28px; height: 28px;
        color: var(--ed-accent, #f59e0b);
        margin-bottom: 10px;
      }
      h3 {
        margin: 0 0 6px;
        font-size: 15px;
        font-weight: 700;
      }
      p {
        margin: 0;
        font-size: 13px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        line-height: 1.5;
      }
    }
    .step-num {
      position: absolute;
      top: 10px; left: 10px;
      width: 24px; height: 24px;
      border-radius: 50%;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 800;
    }

    /* ══════════════════════════════════════════
       Trust signals
    ══════════════════════════════════════════ */
    .trust-section { margin: 0 0 48px; }
    .trust-grid {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 20px 32px;
    }
    .trust-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
      mat-icon {
        font-size: 20px; width: 20px; height: 20px;
        color: var(--ed-success, #22c55e);
      }
    }
    @media (max-width: 599px) {
      .trust-grid {
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }
    }

    /* ══════════════════════════════════════════
       FAQ
    ══════════════════════════════════════════ */
    .faq-section { margin-bottom: 48px; }
    .faq-accordion {
      max-width: 700px;
      margin: 20px auto 0;
    }
    .faq-answer {
      margin: 0;
      font-size: 14px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.7;
    }

    /* ══════════════════════════════════════════
       Bottom CTA
    ══════════════════════════════════════════ */
    .bottom-cta {
      text-align: center;
      padding: 36px 24px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 16px;
    }
    .bottom-cta-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 22px;
      font-weight: 700;
      text-transform: uppercase;
      margin: 0 0 6px;
    }
    .bottom-cta-sub {
      font-size: 15px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 20px;
    }
    .cta-buttons {
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .cta-messenger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 12px 22px;
      border-radius: 100px;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      transition: all 0.2s;
      mat-icon { width: 16px; height: 16px; }
    }
    .cta-messenger__icon {
      display: inline-grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 7px;
      background: #fff;
    }
    .cta-messenger--tg {
      background: #26a5e4;
      color: #fff;
      &:hover { background: #1e8cc8; box-shadow: 0 4px 12px rgba(38, 165, 228, 0.3); }
    }
    .cta-messenger--vk {
      background: #0077ff;
      color: #fff;
      &:hover { background: #0066dd; box-shadow: 0 4px 12px rgba(0, 119, 255, 0.3); }
    }
    .cta-messenger--max {
      background: var(--ed-surface-container-high, #222222);
      color: var(--ed-on-surface, #f5f5f5);
      border: 1px solid var(--ed-outline, #3a3a3a);
      &:hover { background: var(--ed-outline, #3a3a3a); }
    }

    /* ══════════════════════════════════════════
       Checkout dialog
    ══════════════════════════════════════════ */
    .dialog-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.65);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .dialog-card {
      width: 100%;
      max-width: 440px;
      margin: 16px;
      border-radius: 16px;
      h3 {
        margin: 0 0 16px;
        font-family: var(--ed-font-display, 'Oswald', sans-serif);
        font-size: 22px;
        font-weight: 700;
        text-transform: uppercase;
      }
    }
    .full-width { width: 100%; }
    .checkout-plan {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: var(--ed-surface, #0a0a0a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 10px;
      margin-bottom: 10px;
    }
    .checkout-plan-name {
      font-size: 15px;
      font-weight: 700;
    }
    .checkout-plan-price {
      font-size: 14px;
      strong { color: var(--ed-accent, #f59e0b); }
    }
    .checkout-retail {
      font-size: 13px;
      color: var(--ed-on-surface-muted, #666666);
      text-decoration: line-through;
      margin-right: 6px;
    }
    .phone-prefix {
      font-size: 16px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin-right: 4px;
      user-select: none;
    }
    .checkout-user-info {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      background: var(--ed-surface, #0a0a0a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 10px;
      margin-bottom: 12px;
      font-size: 14px;
      font-weight: 600;
      mat-icon {
        font-size: 20px; width: 20px; height: 20px;
        color: var(--ed-accent, #f59e0b);
      }
    }
    .checkout-savings {
      padding: 8px 14px;
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.15);
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 13px;
      font-weight: 700;
      color: var(--ed-success, #22c55e);
      text-align: center;
    }
    .checkout-promo {
      margin-bottom: 8px;
    }
    .promo-error {
      font-size: 12px;
      color: #ef4444;
      margin: -8px 0 8px;
    }
    .promo-success {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: rgba(34, 197, 94, 0.08);
      border: 1px solid rgba(34, 197, 94, 0.2);
      border-radius: 10px;
      font-size: 13px;
      color: #4ade80;
      font-weight: 600;
      margin-bottom: 8px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: #4ade80;
      }
    }
    .checkout-note {
      font-size: 12px;
      color: var(--ed-on-surface-muted, #666666);
      line-height: 1.5;
      margin: 8px 0;
    }
    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 16px;
    }

    .spin { animation: spin 1s linear infinite; }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Desktop: show full labels, hide short */
    .cat-tab-label-short { display: none; }

    /* ══════════════════════════════════════════════════
       MOBILE (max-width: 599px)
    ══════════════════════════════════════════════════ */
    @media (max-width: 599px) {
      /* ── Page: remove side padding, let scroll areas bleed ── */
      .sub-page { padding: 0 0 80px; }
      .hero,
      .compare-section,
      .how-section,
      .trust-section,
      .faq-section,
      .bottom-cta { padding-left: 16px; padding-right: 16px; }

      /* ── Hero: compact ── */
      .hero { padding: 12px 16px 8px; }
      .hero-glow { display: none; }
      .hero-title {
        font-size: 26px;
        margin: 0 0 4px;
        .hero-line { display: inline; }
        .hero-line--accent { display: inline; }
      }
      .hero-price-anchor {
        font-size: 18px;
        margin-bottom: 0;
      }
      .hero-subtitle {
        font-size: 13px;
        margin: 0 auto 8px;
        br { display: none; }
      }
      .hero-cta {
        padding: 10px 24px;
        font-size: 14px;
        animation: none;
      }

      /* ── USP strip: hide on mobile ── */
      .usp-strip { display: none; }

      /* ── Category tabs: horizontal scroll with text ── */
      .cat-tabs {
        justify-content: flex-start;
        overflow-x: auto;
        flex-wrap: nowrap;
        gap: 6px;
        padding: 0 16px;
        margin-bottom: 4px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }
      }
      .cat-tab {
        flex-shrink: 0;
        padding: 8px 14px;
        font-size: 13px;
        white-space: nowrap;
      }
      .cat-tab-label-full { display: none; }
      .cat-tab-label-short { display: inline; }

      /* ── Category body ── */
      .category-body { padding: 12px 0 8px; }
      .category-desc { display: none; }
      .category-highlight {
        font-size: 13px;
        margin: 0 0 12px;
      }

      /* ── Plan cards: horizontal snap-scroll ── */
      .plans-grid {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        overflow-y: hidden;
        scroll-snap-type: x mandatory;
        scroll-padding-left: 16px;
        padding: 0 16px;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }
        /* trailing spacer for last card */
        &::after {
          content: '';
          flex-shrink: 0;
          width: 16px;
        }
      }
      .plan-card {
        flex-shrink: 0;
        width: 80vw;
        scroll-snap-align: start;
        padding: 20px 16px;
      }
      .plan-price-value { font-size: 28px; }
      .plan-savings-callout {
        padding: 6px 10px;
        font-size: 12px;
        mat-icon { display: none; }
      }
      .plan-header { margin-bottom: 10px; }

      /* ── Comparison: tighter ── */
      .compare-section { margin: 32px 0; }
      .compare-card { padding: 20px 16px; }

      /* ── How-it-works: horizontal scroll ── */
      .steps-grid {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        scroll-padding-left: 16px;
        padding: 0 16px;
        grid-template-columns: unset;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        &::-webkit-scrollbar { display: none; }
        &::after {
          content: '';
          flex-shrink: 0;
          width: 16px;
        }
      }
      .step-card {
        flex-shrink: 0;
        width: 72vw;
        scroll-snap-align: start;
      }

      /* ── Trust signals: column ── */
      .trust-grid {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        padding: 0 16px;
      }

      /* ── Bottom CTA: tighter ── */
      .bottom-cta { padding: 24px 16px; }

      /* ── Checkout dialog: safe area ── */
      .dialog-card {
        max-height: 90dvh;
        overflow-y: auto;
        margin: auto 8px;
        padding-bottom: env(safe-area-inset-bottom, 16px);
      }
    }
  `],
})
export class SubscriptionPlansComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snackBar = inject(MatSnackBar);
  private readonly seo = inject(SeoService);
  private readonly cloudPayments = inject(CloudPaymentsService);
  protected readonly authService = inject(AuthService);
  readonly isLoggedIn = computed(() => this.authService.isAuthenticated());

  readonly loading = signal(true);
  readonly subscribing = signal(false);
  readonly showCheckout = signal(false);
  readonly selectedPlan = signal<SubscriptionPlan | null>(null);
  readonly activeTabIndex = signal(0);

  readonly allPlans = signal<SubscriptionPlan[]>([]);

  private readonly categories = CATEGORIES;

  readonly activeCategories = computed(() => {
    const plans = this.allPlans();
    if (plans.length === 0) return this.categories;
    return this.categories.filter(cat => plans.some(p => p.category === cat.key));
  });

  readonly activeCategory = computed(() => {
    const cats = this.activeCategories();
    return cats[this.activeTabIndex()] ?? cats[0] ?? null;
  });

  /** Dynamic comparison data based on active tab's cheapest plan */
  readonly comparisonData = computed(() => {
    const cats = this.activeCategories();
    const idx = this.activeTabIndex();
    if (!cats[idx]) return null;
    const plans = this.plansForCategory(cats[idx].key);
    if (plans.length === 0) return null;
    const cheapest = plans[0]; // already sorted by price
    const retail = this.retailPrice(cheapest);
    if (retail <= cheapest.base_price) return null;
    const display = this.displayInfo(cheapest);
    const pct = Math.round(((retail - cheapest.base_price) / retail) * 100);
    const item = cheapest.items[0];
    const unitPrice = item ? item.product_price : 0;
    return {
      planName: cheapest.name,
      scenario: display.headline + ' по подписке',
      retailTotal: retail,
      retailNote: unitPrice > 0 ? `по ${unitPrice} \u20bd за единицу` : '',
      subPrice: cheapest.base_price,
      savingsPercent: pct,
    };
  });

  readonly phoneDigits = signal('');
  readonly maskedPhone = computed(() => applyPhoneMask(this.phoneDigits()));
  checkoutPhone = '';
  checkoutName = '';
  checkoutEmail = '';

  readonly promoCode = signal('');
  readonly promoLoading = signal(false);
  readonly promoError = signal('');
  readonly trialDays = signal(0);
  private promoDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  readonly steps = [
    { num: 1, icon: 'workspace_premium', title: 'Выберите подписку', desc: 'Определите тариф под свой объём печати' },
    { num: 2, icon: 'credit_card', title: 'Оплатите онлайн', desc: 'Безопасная оплата картой. Списание раз в месяц' },
    { num: 3, icon: 'phone_iphone', title: 'Назовите телефон', desc: 'В студии скажите номер, касса применит цену подписчика' },
    { num: 4, icon: 'savings', title: 'Экономьте', desc: 'Платите за фактический объём дешевле' },
  ];

  readonly faqs: { q: string; a: string }[] = [
    {
      q: 'Что будет, если я ничего не печатаю в этом месяце?',
      a: 'Ничего не списывается за печать. Подписка даёт право на более низкую цену, а вы оплачиваете только фактический объём.',
    },
    {
      q: 'Как отменить подписку?',
      a: 'В личном кабинете, кнопка «Отменить». Без звонков, без объяснений, без штрафов. Цена подписчика действует до конца оплаченного периода.',
    },
    {
      q: 'Как пользоваться подпиской в студии?',
      a: 'Назовите номер телефона на кассе. Кассир найдёт подписку и применит цену подписчика. Ничего скачивать или показывать не нужно.',
    },
    {
      q: 'Можно ли послать кого-то вместо себя?',
      a: 'Да. Подписка привязана к номеру телефона. Скажите номер тому, кто придёт, он получит цену подписчика.',
    },
    {
      q: 'Есть ли включённые страницы?',
      a: 'Нет. Подписка не выдаёт фиксированные кредиты, а снижает цену на объёмную печать по проценту выбранного тарифа.',
    },
    {
      q: 'Есть ли подписка на фотопечать?',
      a: 'Да. Она работает так же: подписка снижает цену на фактически напечатанные фотографии, без фиксированного пакета снимков.',
    },
    {
      q: '199 \u20bd, это точно без подвоха?',
      a: 'Точно. 199 \u20bd списывается раз в месяц. За эти деньги вы получаете цену подписчика. Если подписка не нужна, отменяете, и списания прекращаются.',
    },
  ];

  ngOnInit(): void {
    this.seo.updateTitle('Подписка на печать документов и фото в Ростове | Своё Фото');
    this.seo.updateDescription(
      'Подписка на печать документов и фотографий. ' +
      'Цена подписчика на фактический объём. Отмена без штрафов. 2 точки в Ростове-на-Дону.',
    );

    if (!isPlatformBrowser(this.platformId)) {
      this.loading.set(false);
      return;
    }

    this.loadPlans();
  }

  plansForCategory(categoryKey: string): SubscriptionPlan[] {
    return this.allPlans()
      .filter(p => p.category === categoryKey)
      .sort((a, b) => a.base_price - b.base_price);
  }

  private focusPlanCategory(plan: SubscriptionPlan): void {
    const categoryIndex = this.activeCategories().findIndex(cat => cat.key === plan.category);
    if (categoryIndex >= 0) {
      this.activeTabIndex.set(categoryIndex);
    }
  }

  displayInfo(plan: SubscriptionPlan): PlanDisplayInfo {
    return PLAN_DISPLAY[plan.slug] ?? {
      headline: plan.name,
      subtitle: '',
      items: plan.features.length > 0 ? plan.features : plan.items.map(i => `${i.product_name} дешевле по подписке`),
    };
  }

  retailPrice(plan: SubscriptionPlan): number {
    return plan.items.reduce((sum, i) => sum + (i.product_price || 0) * (+i.included_quantity || 0), 0);
  }

  savingsAmount(plan: SubscriptionPlan): number {
    return Math.max(0, this.retailPrice(plan) - plan.base_price);
  }

  savingsPercent(plan: SubscriptionPlan): number {
    const retail = this.retailPrice(plan);
    if (retail <= 0) return 0;
    return Math.round(((retail - plan.base_price) / retail) * 100);
  }

  selectPlan(plan: SubscriptionPlan): void {
    this.selectedPlan.set(plan);
    if (this.trialDays() === 0) {
      this.promoCode.set('');
      this.promoError.set('');
    }
    this.showCheckout.set(true);
  }

  onPromoInput(value: string): void {
    const code = value.toUpperCase().trim();
    this.promoCode.set(code);
    this.promoError.set('');
    this.trialDays.set(0);

    if (this.promoDebounceTimer) clearTimeout(this.promoDebounceTimer);

    if (!code) return;

    this.promoDebounceTimer = setTimeout(() => this.validatePromo(code), 500);
  }

  private async validatePromo(code: string): Promise<void> {
    this.promoLoading.set(true);
    this.promoError.set('');

    try {
      const res = await fetch(`/api/subscriptions/trial-info/${encodeURIComponent(code)}`);
      if (!res.ok) {
        const err: unknown = await res.json().catch(() => null);
        this.showPromoError(parseErrorMessage(err) || 'Промокод не найден');
        return;
      }

      const raw: unknown = await res.json();
      const data = parseTrialInfoResponse(raw);
      if (data.redeemMode === 'gift_subscription') {
        // Подарочная подписка идёт через account-first активацию
        // (GiftActivationComponent), а не через старый checkout-диалог.
        const planName = data.planName
          || this.allPlans().find(p => p.id === data.planId)?.name;
        this.router.navigate(['/subscriptions/activate'], {
          queryParams: { promo: code, ...(planName ? { plan: planName } : {}) },
        });
      } else if (data.trialDays > 0) {
        this.trialDays.set(data.trialDays);
      } else {
        this.showPromoError('Промокод не предоставляет пробный период');
      }
    } catch {
      this.showPromoError('Не удалось проверить промокод');
    } finally {
      this.promoLoading.set(false);
    }
  }

  private showPromoError(message: string): void {
    this.promoError.set(message);
    if (!this.showCheckout()) {
      this.snackBar.open(message, 'OK', { duration: 5000 });
    }
  }

  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selStart = input.selectionStart ?? input.value.length;
    let digits = input.value.replace(/\D/g, '');
    if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    this.phoneDigits.set(digits);
    this.checkoutPhone = '+7' + digits;

    const rawBefore = input.value.slice(0, selStart).replace(/\D/g, '');
    let digitsBeforeCursor = rawBefore.length;
    if (rawBefore.startsWith('7') || rawBefore.startsWith('8')) digitsBeforeCursor--;
    digitsBeforeCursor = Math.min(Math.max(digitsBeforeCursor, 0), digits.length);

    requestAnimationFrame(() => {
      const masked = this.maskedPhone();
      input.value = masked;
      const pos = phoneCursorPos(masked, digitsBeforeCursor);
      input.setSelectionRange(pos, pos);
    });
  }

  onPhoneKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Backspace') return;
    const input = event.target as HTMLInputElement;
    const pos = input.selectionStart ?? 0;
    if (pos === 0 || input.selectionStart !== input.selectionEnd) return;
    const charBefore = input.value[pos - 1];
    if (charBefore && /\D/.test(charBefore)) {
      event.preventDefault();
      let newPos = pos - 1;
      while (newPos > 0 && /\D/.test(input.value[newPos - 1])) newPos--;
      if (newPos > 0) {
        const digits = this.phoneDigits();
        let digitIndex = 0;
        for (let i = 0; i < newPos; i++) {
          if (/\d/.test(input.value[i])) digitIndex++;
        }
        this.phoneDigits.set(digits.slice(0, digitIndex - 1) + digits.slice(digitIndex));
        this.checkoutPhone = '+7' + this.phoneDigits();
        requestAnimationFrame(() => {
          const masked = this.maskedPhone();
          input.value = masked;
          const p = phoneCursorPos(masked, Math.max(0, digitIndex - 1));
          input.setSelectionRange(p, p);
        });
      }
    }
  }

  scrollToPlans(): void {
    document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async confirmSubscription(): Promise<void> {
    const user = this.authService.currentUser();
    const rawPhone = user?.phone || (this.phoneDigits() ? '7' + this.phoneDigits() : this.checkoutPhone);
    const phone = rawPhone.replace(/\D/g, '');
    if (phone.length < 10) {
      this.snackBar.open('Введите корректный телефон', 'OK', { duration: 3000 });
      return;
    }

    this.subscribing.set(true);

    const plan = this.selectedPlan();
    const body: Record<string, unknown> = {
      phone,
      customer_name: this.checkoutName.trim() || user?.display_name || undefined,
      email: this.checkoutEmail.trim() || user?.email || undefined,
    };

    if (plan) {
      body['plan_id'] = plan.id;
    }

    if (this.promoCode().trim() && this.trialDays() > 0) {
      body['promo_code'] = this.promoCode().trim();
    }

    try {
      const initRes = await fetch('/api/subscriptions/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!initRes.ok) {
        const err: unknown = await initRes.json().catch(() => null);
        throw new Error(parseErrorMessage(err) || 'Не удалось создать подписку');
      }

      const initData = parseSubscriptionInitResponse(await initRes.json());
      if (!initData.subscriptionId) {
        throw new Error('Не удалось создать подписку');
      }

      const planName = plan?.name || 'Подписка';
      const result = await this.cloudPayments.subscribe({
        subscriptionId: initData.subscriptionId,
        planName,
        amount: initData.monthlyPrice,
        billingPeriod: plan?.billing_period || 'monthly',
        email: this.checkoutEmail.trim() || undefined,
        phone,
        trialDays: initData.trialPeriodDays || undefined,
      });

      this.subscribing.set(false);

      if (result.success) {
        this.showCheckout.set(false);
        const msg = initData.trialEnd
          ? `Подписка активна! Бесплатный период до ${new Date(initData.trialEnd).toLocaleDateString('ru-RU')}.`
          : 'Подписка оформлена! Цена подписчика применится после подтверждения оплаты.';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
        this.router.navigate(['/profile'], { fragment: 'subscription' });
      } else if (result.error && result.error !== 'Оплата отменена') {
        this.snackBar.open(`Ошибка: ${result.error}`, 'OK', { duration: 5000 });
      } else {
        this.subscribing.set(false);
      }
    } catch (err) {
      this.subscribing.set(false);
      const message = err instanceof Error ? err.message : 'Не удалось оформить подписку';
      this.snackBar.open(`Ошибка: ${message}`, 'OK', { duration: 5000 });
    }
  }

  private loadPlans(): void {
    this.http.get<{ success: boolean; plans: SubscriptionPlan[] }>('/api/subscriptions/plans').subscribe({
      next: (res) => {
        this.allPlans.set(res.plans || []);
        this.loading.set(false);
        this.applyQueryParams();
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Не удалось загрузить планы', 'OK', { duration: 5000 });
      },
    });
  }

  /** Auto-select plan and promo from query params (?plan=slug&promo=CODE) */
  private applyQueryParams(): void {
    const params = this.route.snapshot.queryParams;
    const planSlug = params['plan'];
    const promo = params['promo'];

    if (planSlug) {
      const plan = this.allPlans().find(p => p.slug === planSlug);
      if (plan) {
        this.selectedPlan.set(plan);
        this.focusPlanCategory(plan);
        this.showCheckout.set(true);
      }
    }

    if (promo) {
      this.promoCode.set(promo.toUpperCase().trim());
      this.validatePromo(this.promoCode());
    }
  }
}
