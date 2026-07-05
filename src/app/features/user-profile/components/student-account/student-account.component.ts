import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { firstValueFrom, startWith } from 'rxjs';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { AuthService } from '../../../../core/services/auth.service';
import {
  StudentVerificationService,
  type EducationRole,
  type StudentVerificationStatusPayload,
} from '../../../../core/services/student-verification.service';
import { CloudPaymentsService } from '../../../../core/services/cloud-payments.service';
import {
  SubscriptionService,
  type SubscriptionPlan,
  type MySubscription,
} from '../../../../core/services/subscription.service';
import {
  EduPrintEstimateService,
  type EduPrintColorMode,
} from '../../services/edu-print-estimate.service';
import {
  EDUCATION_ROLE_OPTIONS,
  EDUCATION_DOCUMENT_HINTS,
  MAX_DOCUMENT_FILE_SIZE,
  SUPPORTED_DOCUMENT_TYPES,
} from '../../../../core/constants/education-document';

type StudentStatusKind =
  | 'active'
  | 'approved'
  | 'pending'
  | 'rejected'
  | 'revoked'
  | 'expired'
  | 'none';

type StudentPrintCoverageVisual = 'text' | 'mixed' | 'heavy' | 'full';
type AccountDiscountKind = 'personal' | 'education' | 'business';

interface StudentPrintPricingRow {
  readonly range: string;
  readonly title: string;
  readonly description: string;
  readonly visual: StudentPrintCoverageVisual;
  readonly basePrice: string;
  readonly personalPrice: string;
  readonly educationPrice: string;
  readonly businessPrice: string;
}

interface StudentPhotoPricingRow {
  readonly format: string;
  readonly note: string;
  readonly basePrice: string;
  readonly personalPrice: string;
  readonly educationPrice: string;
  readonly businessPrice: string;
}

interface AccountDiscountCard {
  readonly type: AccountDiscountKind;
  readonly title: string;
  readonly icon: string;
  readonly payment: string;
  readonly documentDiscount: string;
  readonly photoDiscount: string;
  readonly serviceDiscount?: string;
  readonly documentExample: string;
  readonly photoExample: string;
  readonly activation: string;
  readonly useCases?: readonly string[];
  readonly route: string;
  readonly cta: string;
}

const EDUCATION_PLAN_SLUG = 'education-monthly-199';
// Калькулятор edu-печати: документы (PDF/Office) + изображения, до 50 МБ (см. контракт §5.1)
const MAX_ESTIMATE_FILE_SIZE = 50 * 1024 * 1024;
const ESTIMATE_FILE_ACCEPT =
  '.pdf,.docx,.xlsx,.pptx,.odt,.rtf,.txt,.csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.oasis.opendocument.text,application/rtf,text/plain,text/csv,image/*';
const ACCOUNT_DISCOUNT_CARDS: readonly AccountDiscountCard[] = [
  {
    type: 'personal',
    title: 'Личный',
    icon: 'person',
    payment: 'Персональная скидка',
    documentDiscount: 'Документы −20%',
    photoDiscount: 'Фото −10%',
    documentExample: 'А4 −20%',
    photoExample: '10×15 −10%',
    activation: 'Сначала выберите личный аккаунт, затем подключите доступ.',
    route: '/user-profile/account/edit',
    cta: 'Выбрать личный',
  },
  {
    type: 'business',
    title: 'Бизнес',
    icon: 'business_center',
    payment: 'B2B-аккаунт',
    documentDiscount: 'Документы −40%',
    photoDiscount: 'Фото −15%',
    serviceDiscount: 'Съёмки и выезд по B2B-условиям',
    documentExample: 'А4 10 ₽ → 6 ₽',
    photoExample: '10×15 20 ₽ → 17 ₽',
    activation: 'После подключения организации скидки действуют на печать, а съёмки и выезды считаются по B2B-условиям.',
    useCases: [
      'фото сотрудников для пропусков',
      'фото для медкнижек, анкет и личных дел',
      'счета, реестр печати и закрывающие документы',
      'фото для корпоративных баз',
    ],
    route: '/business',
    cta: 'Открыть бизнес',
  },
  {
    type: 'education',
    title: 'Образовательный',
    icon: 'school',
    payment: '199 ₽ в месяц, автопродление',
    documentDiscount: 'Документы −70%',
    photoDiscount: 'Премиум-фото −50%',
    documentExample: 'А4 10 ₽ → 3 ₽',
    photoExample: '10×15 20 ₽ → 10 ₽',
    activation: 'После проверки статуса и подключения ежемесячной автоподписки.',
    route: '/user-profile/education',
    cta: 'Проверить статус',
  },
] as const;
const STUDENT_PRINT_PRICING_ROWS: readonly StudentPrintPricingRow[] = [
  {
    range: 'До 15% заливки',
    title: 'Ч/б А4',
    description:
      'Текстовые документы без плотного фона и крупных изображений: заявления, договоры, отчёты, инструкции, конспекты, методички и другие страницы с обычным текстом.',
    visual: 'text',
    basePrice: '10 ₽',
    personalPrice: '8 ₽',
    educationPrice: '3 ₽',
    businessPrice: '6 ₽',
  },
  {
    range: 'До 15% заливки',
    title: 'Цветной А4',
    description:
      'Страницы с цветным текстом, таблицами, схемами, графиками, диаграммами, выделениями и небольшими цветными элементами.',
    visual: 'mixed',
    basePrice: '12 ₽',
    personalPrice: '10 ₽',
    educationPrice: '4 ₽',
    businessPrice: '7 ₽',
  },
  {
    range: 'До 50% заливки',
    title: 'Страница с графикой',
    description:
      'Крупные изображения, схемы, блоки, иллюстрации или заметная заливка на части страницы. Цветная и ч/б печать считаются по одной цене.',
    visual: 'mixed',
    basePrice: '25 ₽',
    personalPrice: '20 ₽',
    educationPrice: '8 ₽',
    businessPrice: '15 ₽',
  },
  {
    range: 'До 75% заливки',
    title: 'Плотная страница',
    description:
      'Много изображений, крупные блоки, частичный фон или высокая плотность печати. Цветная и ч/б печать считаются по одной цене.',
    visual: 'heavy',
    basePrice: '40 ₽',
    personalPrice: '32 ₽',
    educationPrice: '12 ₽',
    businessPrice: '24 ₽',
  },
  {
    range: 'До 100% заливки',
    title: 'Фото или полный фон',
    description:
      'Фотографии, афиши, презентации, тёмные макеты и страницы, которые почти полностью уходят в печать. Цветная и ч/б печать считаются по одной цене.',
    visual: 'full',
    basePrice: '60 ₽',
    personalPrice: '48 ₽',
    educationPrice: '18 ₽',
    businessPrice: '36 ₽',
  },
] as const;
const STUDENT_PHOTO_PRICING_ROWS: readonly StudentPhotoPricingRow[] = [
  {
    format: '10×15',
    note: 'Классический размер для альбомов и быстрых отпечатков.',
    basePrice: '20 ₽',
    personalPrice: '18 ₽',
    educationPrice: '10 ₽',
    businessPrice: '17 ₽',
  },
  {
    format: '15×20',
    note: 'Крупнее открытки, удобно для портретов и подарочных фото.',
    basePrice: '80 ₽',
    personalPrice: '72 ₽',
    educationPrice: '40 ₽',
    businessPrice: '68 ₽',
  },
  {
    format: '20×30 / А4',
    note: 'Большой отпечаток до формата А4.',
    basePrice: '150 ₽',
    personalPrice: '135 ₽',
    educationPrice: '75 ₽',
    businessPrice: '128 ₽',
  },
] as const;

@Component({
  selector: 'app-student-account',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DatePipe,
    DecimalPipe,
  ],
  template: `
    <div class="student-account">
      <header class="student-header">
        <div class="student-header__copy">
          <div class="student-header__eyebrow">Личный кабинет</div>
          <h1>Выгодно</h1>
          <p>Скидки на печать и фотопечать по вашему типу доступа.</p>
        </div>
        <a
          class="student-header__action"
          mat-stroked-button
          routerLink="/education"
        >
          <mat-icon>local_offer</mat-icon>
          <span>Все условия</span>
        </a>
      </header>

      @if (loading()) {
        <section class="student-workspace student-workspace--loading">
          <mat-spinner diameter="32" />
          <span>Загружаем аккаунты и скидки</span>
        </section>
      } @else {
        <section class="student-workspace">
          <aside class="student-overview">
            <div
              class="student-status-badge"
              [class.student-status-badge--active]="statusKind() === 'active'"
              [class.student-status-badge--approved]="
                statusKind() === 'approved'
              "
              [class.student-status-badge--pending]="statusKind() === 'pending'"
              [class.student-status-badge--blocked]="
                statusKind() === 'rejected' || statusKind() === 'revoked'
              "
            >
              {{ statusLabel() }}
            </div>
            <h2>{{ statusTitle() }}</h2>
            <p>{{ statusDescription() }}</p>

            @if (activeDiscount()) {
              <div class="student-metrics">
                <div class="student-metric">
                  <strong>{{ verifiedOnly() ? '50%' : '70%' }}</strong>
                  <span>документы А4</span>
                </div>
                <div class="student-metric">
                  <strong>{{ activeDiscount()!.print_sheet_price }} ₽</strong>
                  <span>ч/б А4, было 10 ₽</span>
                </div>
                <div class="student-metric">
                  <strong>{{ verifiedOnly() ? '14 ₽' : '10 ₽' }}</strong>
                  <span>фото 10×15, было 20 ₽</span>
                </div>
              </div>
              <div class="student-allowance">
                <div class="student-allowance__row">
                  <span>Документы: осталось {{ activeDiscount()!.print_sheets_remaining }} из {{ activeDiscount()!.print_sheets_limit }}</span>
                  <span>Фото: осталось {{ activeDiscount()!.photo_remaining }} из {{ activeDiscount()!.photo_limit }}</span>
                </div>
                @if (activeDiscount()!.allowance_period_end) {
                  <p class="student-allowance__hint">
                    Лимит обновится {{ activeDiscount()!.allowance_period_end | date: 'd MMMM' }}. Сверх лимита, обычная цена.
                  </p>
                }
              </div>
            } @else {
              <div class="student-metrics student-metrics--muted">
                <div class="student-metric">
                  <strong>199 ₽</strong>
                  <span>в месяц</span>
                </div>
                <div class="student-metric">
                  <strong>3 ₽</strong>
                  <span>ч/б А4, было 10 ₽</span>
                </div>
                <div class="student-metric">
                  <strong>14 ₽</strong>
                  <span>фото 10×15, было 20 ₽</span>
                </div>
              </div>
            }

            <div
              class="student-plan"
              [class.student-plan--locked]="
                statusKind() !== 'active' && statusKind() !== 'approved'
              "
              [class.student-plan--paid]="statusKind() === 'active'"
            >
              <div>
                <span>Образовательная подписка</span>
                <strong>{{ educationPlanPriceLabel() }}</strong>
                <p>{{ educationPlanDescription() }}</p>
              </div>
              @if (canPayEducationPlan()) {
                @if (educationPlans().length > 1) {
                  <div
                    class="student-plan__options"
                    role="group"
                    aria-label="Период подписки"
                  >
                    @for (option of educationPlans(); track option.id) {
                      <button
                        type="button"
                        class="student-plan__option"
                        [class.student-plan__option--active]="
                          option.id === selectedEducationPlanId()
                        "
                        (click)="selectEducationPlan(option.id)"
                      >
                        <span class="student-plan__option-price">{{
                          planPriceShort(option)
                        }}</span>
                        @if (
                          option.savings_label &&
                          option.billing_period === 'yearly'
                        ) {
                          <span class="student-plan__option-badge">{{
                            option.savings_label
                          }}</span>
                        }
                      </button>
                    }
                  </div>
                }
                <button
                  class="student-plan__button"
                  mat-flat-button
                  type="button"
                  (click)="payEducationPlan()"
                  [disabled]="payDisabled()"
                >
                  @if (paying()) {
                    <mat-spinner diameter="18" />
                  } @else {
                    <mat-icon>payments</mat-icon>
                  }
                  <span>{{ educationPlanButtonLabel() }}</span>
                </button>
              } @else if (activeDiscount()) {
                <span class="student-plan__hint"> Доступ активен </span>
                @if (educationSubscription(); as sub) {
                  <div class="student-plan__manage">
                    @if (sub.card_last_four) {
                      <div class="student-plan__card">
                        <mat-icon>credit_card</mat-icon>
                        <span>Карта •••• {{ sub.card_last_four }}</span>
                      </div>
                    }
                    <div class="student-plan__manage-actions">
                      <button
                        class="student-plan__change-card"
                        type="button"
                        (click)="changeEducationCard()"
                        [disabled]="changingCard() || cancelling()"
                      >
                        @if (changingCard()) {
                          <mat-spinner diameter="16" />
                        } @else {
                          <mat-icon>credit_card</mat-icon>
                        }
                        <span>Сменить карту</span>
                      </button>
                      <button
                        class="student-plan__cancel"
                        type="button"
                        (click)="cancelEducationSubscription()"
                        [disabled]="cancelling() || changingCard()"
                      >
                        @if (cancelling()) {
                          <mat-spinner diameter="16" />
                        }
                        <span>Отменить подписку</span>
                      </button>
                    </div>
                  </div>
                }
              } @else {
                <span class="student-plan__hint">
                  Доступно после проверки
                </span>
              }
            </div>
          </aside>

          <div class="student-application">
            <div class="student-application__head">
              <div>
                <span>Образовательный аккаунт</span>
                <h2>
                  {{
                    statusKind() === 'active' || statusKind() === 'approved'
                      ? 'Обновить документ'
                      : 'Отправить на проверку'
                  }}
                </h2>
              </div>
              @if (latestSubmittedAt()) {
                <span class="student-application__date">
                  Последняя заявка: {{ formatDate(latestSubmittedAt()) }}
                </span>
              }
            </div>

            <p class="student-application__intro">
              Читаемый снимок документа: ФИО, учебное заведение и срок действия.
              Паспорт не нужен.
            </p>

            @if (statusKind() !== 'none') {
              <section
                class="student-access-callout"
                [class.student-access-callout--active]="
                  statusKind() === 'active'
                "
                [class.student-access-callout--approved]="
                  statusKind() === 'approved'
                "
                [class.student-access-callout--pending]="
                  statusKind() === 'pending'
                "
                [class.student-access-callout--blocked]="
                  statusKind() === 'rejected' ||
                  statusKind() === 'revoked' ||
                  statusKind() === 'expired'
                "
              >
                <mat-icon>{{ applicationStatusIcon() }}</mat-icon>
                <div>
                  <span class="student-access-callout__label">
                    {{ statusLabel() }}
                  </span>
                  <h3>{{ applicationStatusTitle() }}</h3>
                  @if (applicationStatusDescription()) {
                    <p>{{ applicationStatusDescription() }}</p>
                  }
                </div>
                @if (canPayEducationPlan()) {
                  <button
                    class="student-access-callout__button"
                    mat-flat-button
                    type="button"
                    (click)="payEducationPlan()"
                    [disabled]="payDisabled()"
                  >
                    @if (paying()) {
                      <mat-spinner diameter="18" />
                    } @else {
                      <mat-icon>payments</mat-icon>
                    }
                    <span>{{ educationPlanButtonLabel() }}</span>
                  </button>
                } @else if (activeDiscount()) {
                  <strong class="student-access-callout__state">
                    <mat-icon>check_circle</mat-icon>
                    <span>Доступ активен</span>
                  </strong>
                }
              </section>
            }

            @if (errorMessage()) {
              <div class="student-message student-message--error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            @if (successMessage()) {
              <div class="student-message">
                <mat-icon>check_circle</mat-icon>
                <span>{{ successMessage() }}</span>
              </div>
            }

            <details class="student-collapse">
              <summary class="student-collapse__summary">
                <mat-icon>percent</mat-icon>
                <span>Три типа аккаунта и скидки</span>
                <mat-icon class="student-collapse__chevron">expand_more</mat-icon>
              </summary>
              <section
              class="student-account-types"
              aria-labelledby="student-account-types-title"
            >
              <div class="student-account-types__head">
                <mat-icon>percent</mat-icon>
                <div>
                  <h3 id="student-account-types-title">
                    Три типа аккаунта и скидки после подключения
                  </h3>
                  <p>
                    Скидки не являются фиксированными кредитами. После
                    подключения доступа заказ просто считается дешевле по вашему
                    типу аккаунта.
                  </p>
                </div>
              </div>

              <div class="student-account-types__grid">
                @for (plan of accountDiscountCards; track plan.type) {
                  <article
                    class="student-account-card"
                    [class.student-account-card--education]="
                      plan.type === 'education'
                    "
                  >
                    <div class="student-account-card__top">
                      <span class="student-account-card__icon">
                        <mat-icon>{{ plan.icon }}</mat-icon>
                      </span>
                      <div>
                        <strong>{{ plan.title }}</strong>
                        <small>{{ plan.payment }}</small>
                      </div>
                    </div>

                    <div class="student-account-card__discounts">
                      <span>{{ plan.documentDiscount }}</span>
                      <span>{{ plan.photoDiscount }}</span>
                      @if (plan.serviceDiscount) {
                        <span class="student-account-card__discounts-service">
                          {{ plan.serviceDiscount }}
                        </span>
                      }
                    </div>

                    <div class="student-account-card__examples">
                      <span>
                        <small>Документы</small>
                        <b>{{ plan.documentExample }}</b>
                      </span>
                      <span>
                        <small>Фотопечать</small>
                        <b>{{ plan.photoExample }}</b>
                      </span>
                    </div>

                    <p>{{ plan.activation }}</p>
                    @if (plan.useCases; as useCases) {
                      <ul class="student-account-card__usecases">
                        @for (useCase of useCases; track useCase) {
                          <li>{{ useCase }}</li>
                        }
                      </ul>
                    }
                    @if (plan.type === 'education') {
                      @if (canPayEducationPlan()) {
                        <button
                          class="student-account-card__action student-account-card__action--primary"
                          type="button"
                          (click)="payEducationPlan()"
                          [disabled]="payDisabled()"
                        >
                          @if (paying()) {
                            <mat-spinner diameter="18" />
                          } @else {
                            <mat-icon>payments</mat-icon>
                          }
                          <span>{{ educationPlanButtonLabel() }}</span>
                        </button>
                      } @else if (activeDiscount()) {
                        <span
                          class="student-account-card__action student-account-card__action--state student-account-card__action--success"
                        >
                          <mat-icon>check_circle</mat-icon>
                          <span>Доступ активен</span>
                        </span>
                      } @else if (statusKind() === 'pending') {
                        <span
                          class="student-account-card__action student-account-card__action--state"
                        >
                          <mat-icon>schedule</mat-icon>
                          <span>На проверке</span>
                        </span>
                      } @else {
                        <a
                          class="student-account-card__action"
                          [routerLink]="plan.route"
                        >
                          {{ educationAccountCardCta() }}
                          <mat-icon>chevron_right</mat-icon>
                        </a>
                      }
                    } @else {
                      <a
                        class="student-account-card__action"
                        [routerLink]="plan.route"
                      >
                        {{ plan.cta }}
                        <mat-icon>chevron_right</mat-icon>
                      </a>
                    }
                  </article>
                }
              </div>
            </section>
            </details>

            <details class="student-collapse">
              <summary class="student-collapse__summary">
                <mat-icon>receipt_long</mat-icon>
                <span>Печать документов А4 по заливке, тарифы</span>
                <mat-icon class="student-collapse__chevron">expand_more</mat-icon>
              </summary>
              <section
              class="student-pricing"
              aria-labelledby="student-print-pricing-title"
            >
              <div class="student-pricing__head">
                <mat-icon>receipt_long</mat-icon>
                <div>
                  <h3 id="student-print-pricing-title">
                    Печать документов А4 по заливке
                  </h3>
                  <p>
                    Цена зависит от заливки страницы. В таблице видно, сколько
                    стоит лист без доступа, с личным, образовательным и бизнес
                    аккаунтом после подключения доступа.
                  </p>
                </div>
              </div>

              <div class="student-pricing__rows">
                @for (row of printPricingRows; track row.title) {
                  <div class="student-pricing__row">
                    <strong>{{ row.range }}</strong>
                    <div
                      class="student-pricing__visual"
                      [class.student-pricing__visual--text]="
                        row.visual === 'text'
                      "
                      [class.student-pricing__visual--mixed]="
                        row.visual === 'mixed'
                      "
                      [class.student-pricing__visual--heavy]="
                        row.visual === 'heavy'
                      "
                      [class.student-pricing__visual--full]="
                        row.visual === 'full'
                      "
                      aria-hidden="true"
                    >
                      <span class="student-pricing__sheet">
                        <span
                          class="student-pricing__sheet-line student-pricing__sheet-line--1"
                        ></span>
                        <span
                          class="student-pricing__sheet-line student-pricing__sheet-line--2"
                        ></span>
                        <span
                          class="student-pricing__sheet-line student-pricing__sheet-line--3"
                        ></span>
                        <span
                          class="student-pricing__sheet-line student-pricing__sheet-line--4"
                        ></span>
                        <span
                          class="student-pricing__sheet-line student-pricing__sheet-line--5"
                        ></span>
                        <span
                          class="student-pricing__sheet-line student-pricing__sheet-line--6"
                        ></span>
                        <span class="student-pricing__sheet-image"></span>
                        <span class="student-pricing__sheet-bars">
                          <span></span>
                          <span></span>
                          <span></span>
                        </span>
                        <span class="student-pricing__sheet-fill"></span>
                      </span>
                    </div>
                    <div>
                      <span class="student-pricing__title">{{
                        row.title
                      }}</span>
                      <small class="student-pricing__description">{{
                        row.description
                      }}</small>
                    </div>
                    <div class="student-price-grid">
                      <span>
                        <small>Без доступа</small>
                        <b>{{ row.basePrice }}</b>
                      </span>
                      <span>
                        <small>Личный</small>
                        <b>{{ row.personalPrice }}</b>
                      </span>
                      <span class="student-price-grid__cell--education">
                        <small>Образовательный</small>
                        <b>{{ row.educationPrice }}</b>
                      </span>
                      <span>
                        <small>Бизнес</small>
                        <b>{{ row.businessPrice }}</b>
                      </span>
                    </div>
                  </div>
                }
              </div>

              <p class="student-pricing__foot">
                Коротко: личный аккаунт даёт −20% на документы, бизнес −40%,
                образовательный −70%. Скидка действует на все уровни заливки А4
                после подключения соответствующего доступа.
              </p>
            </section>
            </details>

            <section
              class="edu-estimate"
              aria-labelledby="edu-estimate-title"
            >
              <div class="edu-estimate__head">
                <mat-icon>calculate</mat-icon>
                <div>
                  <h3 id="edu-estimate-title">
                    Калькулятор стоимости печати
                  </h3>
                  <p>
                    Стоимость печати каждой страницы @if (activeDiscount()) {по
                    вашим ценам}@else {по каталогу}. Только оценка, без заказа.
                  </p>
                </div>
              </div>

              @if (!activeDiscount()) {
                <div class="edu-estimate__upsell">
                  <mat-icon>info</mat-icon>
                  <span>
                    Оформите образовательную подписку, печать документов от 3 ₽
                    за лист. Сейчас показана обычная каталожная цена.
                  </span>
                </div>
              }

              <label
                class="student-upload edu-estimate__upload"
                [class.student-upload--selected]="estimateFileName()"
              >
                <input
                  type="file"
                  [accept]="estimateAccept"
                  [disabled]="estimateBusy()"
                  (change)="onEstimateFileSelected($event)"
                />
                <mat-icon>upload_file</mat-icon>
                <span>{{
                  estimateFileName() || 'Выбрать документ для оценки'
                }}</span>
                <small>PDF, Word, Excel, PowerPoint или изображение до 50&nbsp;МБ</small>
              </label>

              @if (estimateState() === 'uploading') {
                <div class="edu-estimate__status">
                  <mat-spinner diameter="18" />
                  <span>Загружаем файл…</span>
                </div>
              } @else if (estimateState() === 'analyzing') {
                <div class="edu-estimate__status">
                  <mat-spinner diameter="18" />
                  <span>Анализируем заливку страниц…</span>
                </div>
              }

              @if (estimateError()) {
                <div class="edu-estimate__error" role="alert">
                  <mat-icon>error_outline</mat-icon>
                  <span>{{ estimateError() }}</span>
                </div>
              }

              @if (estimateResult(); as estimate) {
                <div class="edu-estimate__toggle" role="group" aria-label="Режим цвета">
                  <button
                    type="button"
                    class="edu-estimate__toggle-btn"
                    [class.edu-estimate__toggle-btn--active]="
                      estimateColorMode() === 'bw'
                    "
                    [disabled]="estimateBusy()"
                    (click)="setEstimateColorMode('bw')"
                  >
                    <mat-icon>contrast</mat-icon>
                    Ч/Б
                  </button>
                  <button
                    type="button"
                    class="edu-estimate__toggle-btn"
                    [class.edu-estimate__toggle-btn--active]="
                      estimateColorMode() === 'color'
                    "
                    [disabled]="estimateBusy()"
                    (click)="setEstimateColorMode('color')"
                  >
                    <mat-icon>palette</mat-icon>
                    Цвет
                  </button>
                  <button
                    type="button"
                    class="edu-estimate__toggle-btn"
                    [class.edu-estimate__toggle-btn--active]="
                      estimateColorMode() === 'auto'
                    "
                    [disabled]="estimateBusy()"
                    (click)="setEstimateColorMode('auto')"
                  >
                    <mat-icon>auto_awesome</mat-icon>
                    Авто
                  </button>
                </div>

                <div class="edu-estimate__pages" role="table">
                  <div class="edu-estimate__pages-head" role="row">
                    <span role="columnheader">Стр.</span>
                    <span role="columnheader">Заливка</span>
                    <span role="columnheader">Цвет</span>
                    <span role="columnheader">Цена</span>
                  </div>
                  @for (p of estimate.pages; track p.page) {
                    <div
                      class="edu-estimate__page-row"
                      [class.edu-estimate__page-row--over]="!p.withinLimit"
                      role="row"
                    >
                      <span role="cell">{{ p.page }}</span>
                      <span role="cell">{{ p.coveragePercent | number: '1.0-0' }}%</span>
                      <span role="cell">
                        @if (p.isColor) {
                          <mat-icon class="edu-estimate__ink edu-estimate__ink--color">palette</mat-icon>
                          Цвет
                        } @else {
                          <mat-icon class="edu-estimate__ink">contrast</mat-icon>
                          Ч/Б
                        }
                      </span>
                      <span role="cell" class="edu-estimate__page-price">
                        @if (p.eduPriceRub < p.catalogPriceRub) {
                          <s>{{ p.catalogPriceRub }}&nbsp;₽</s>
                        }
                        <b>{{ p.eduPriceRub }}&nbsp;₽</b>
                        @if (!p.withinLimit) {
                          <small class="edu-estimate__badge">сверх лимита</small>
                        }
                      </span>
                    </div>
                  }
                </div>

                <div class="edu-estimate__total">
                  <div class="edu-estimate__total-row">
                    <span>Итого за {{ estimate.pageCount }} стр.</span>
                    <strong>
                      @if (estimate.summary.savingsRub > 0) {
                        <s>{{ estimate.summary.catalogTotalRub }}&nbsp;₽</s>
                      }
                      {{ estimate.summary.eduTotalRub }}&nbsp;₽
                    </strong>
                  </div>
                  @if (estimate.summary.savingsRub > 0) {
                    <p class="edu-estimate__savings">
                      Экономия по льготе, {{ estimate.summary.savingsRub }}&nbsp;₽
                    </p>
                  }
                  @if (estimate.summary.documentsOverLimit > 0) {
                    <p class="edu-estimate__note edu-estimate__note--warn">
                      {{ estimate.summary.documentsOverLimit }} стр. сверх лимита
                      посчитаны по обычной цене.
                    </p>
                  }
                </div>

                @if (estimateAllowanceText(); as allowance) {
                  <p class="edu-estimate__note">{{ allowance }}</p>
                }
                @if (estimate.summary.belowMinimum) {
                  <p class="edu-estimate__note">
                    Минимальный чек на кассе, {{ estimate.summary.minimumCheckRub }}&nbsp;₽.
                  </p>
                }
                <p class="edu-estimate__note edu-estimate__note--muted">
                  Оценка по формату А4. Точная сумма считается на кассе.
                </p>
              }
            </section>

            <details class="student-collapse">
              <summary class="student-collapse__summary">
                <mat-icon>photo_library</mat-icon>
                <span>Фотопечать от 10×15 до А4, тарифы</span>
                <mat-icon class="student-collapse__chevron">expand_more</mat-icon>
              </summary>
              <section
              class="student-photo-pricing"
              aria-labelledby="student-photo-pricing-title"
            >
              <div class="student-photo-pricing__head">
                <mat-icon>photo_library</mat-icon>
                <div>
                  <h3 id="student-photo-pricing-title">
                    Фотопечать от 10×15 до А4
                  </h3>
                  <p>
                    Фотографии считаются отдельно от документов: личный аккаунт
                    даёт −10%, образовательный −50%, бизнес −15% после
                    подключения доступа. Образовательная скидка действует на
                    премиум-печать; супер-обработка идёт без скидки.
                  </p>
                </div>
              </div>

              <div class="student-photo-pricing__rows">
                @for (row of photoPricingRows; track row.format) {
                  <div class="student-photo-pricing__row">
                    <div class="student-photo-pricing__format">
                      <strong>{{ row.format }}</strong>
                      <small>{{ row.note }}</small>
                    </div>
                    <div class="student-price-grid">
                      <span>
                        <small>Без доступа</small>
                        <b>{{ row.basePrice }}</b>
                      </span>
                      <span>
                        <small>Личный</small>
                        <b>{{ row.personalPrice }}</b>
                      </span>
                      <span class="student-price-grid__cell--education">
                        <small>Образовательный</small>
                        <b>{{ row.educationPrice }}</b>
                      </span>
                      <span>
                        <small>Бизнес</small>
                        <b>{{ row.businessPrice }}</b>
                      </span>
                    </div>
                  </div>
                }
              </div>
            </section>
            </details>

            @if (missingAccountPhone()) {
              <div class="student-notice">
                <mat-icon>phone_iphone</mat-icon>
                <div>
                  <h3>Телефон не указан</h3>
                  <p>
                    Добавьте номер в профиле. Уже привязанный номер повторно
                    подтверждать не нужно.
                  </p>
                </div>
                <a
                  class="student-notice__action"
                  mat-flat-button
                  routerLink="/user-profile/account"
                >
                  <mat-icon>edit</mat-icon>
                  <span>Добавить</span>
                </a>
              </div>
            }

            @if (isSubmissionLocked()) {
              <div class="student-lock">
                <mat-icon>{{
                  statusKind() === 'pending' ? 'schedule' : 'lock'
                }}</mat-icon>
                <span>{{ submissionLockMessage() }}</span>
              </div>
            } @else {
              <form
                class="student-form"
                [formGroup]="form"
                (ngSubmit)="submit()"
              >
                <div class="student-form__grid">
                  <label class="student-field">
                    <span class="student-field__label">
                      Кто вы <span aria-hidden="true">*</span>
                    </span>
                    <select
                      class="student-field__control student-field__control--select"
                      formControlName="educationRole"
                    >
                      @for (role of educationRoleOptions; track role.value) {
                        <option [value]="role.value">{{ role.label }}</option>
                      }
                    </select>
                  </label>

                  <label
                    class="student-field"
                    [class.student-field--invalid]="institutionNameInvalid()"
                  >
                    <span class="student-field__label">
                      Образовательная организация
                      <span aria-hidden="true">*</span>
                    </span>
                    <input
                      class="student-field__control"
                      type="text"
                      formControlName="institutionName"
                      autocomplete="organization"
                      maxlength="200"
                      placeholder="Например, ЮФУ"
                      [attr.aria-invalid]="institutionNameInvalid()"
                      [attr.aria-describedby]="
                        institutionNameInvalid()
                          ? 'student-institution-error'
                          : null
                      "
                    />
                    @if (institutionNameInvalid()) {
                      <small
                        id="student-institution-error"
                        class="student-field__message"
                      >
                        {{ institutionNameError() }}
                      </small>
                    }
                  </label>

                  <label class="student-field">
                    <span class="student-field__label">
                      Дата окончания документа
                    </span>
                    <input
                      class="student-field__control student-field__control--date"
                      type="date"
                      formControlName="documentExpiresAt"
                    />
                  </label>
                </div>

                <label
                  class="student-upload"
                  [class.student-upload--selected]="selectedFile()"
                >
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    (change)="onFileSelected($event)"
                  />
                  <mat-icon>upload_file</mat-icon>
                  <span>{{ selectedFileName() }}</span>
                  <small>JPEG, PNG, WEBP или HEIC до 12&nbsp;МБ</small>
                </label>

                <p class="student-form__hint">{{ documentHint() }}</p>

                <div class="student-actions">
                  <button
                    class="student-actions__submit"
                    mat-flat-button
                    color="primary"
                    type="submit"
                    [disabled]="submitDisabled()"
                  >
                    @if (submitting()) {
                      <mat-spinner diameter="18" />
                    } @else {
                      <mat-icon>send</mat-icon>
                    }
                    <span>{{
                      submitting() ? 'Отправляем' : documentSubmitButtonLabel()
                    }}</span>
                  </button>
                </div>
              </form>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        min-height: 100%;
        background: var(--ed-background, #0a0a0a);
        color: var(--ed-on-surface, #f5f5f5);
      }

      .student-account {
        width: min(1160px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 56px;
      }

      .student-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 24px;
        margin-bottom: 22px;
      }

      .student-header__copy {
        max-width: 760px;
      }

      .student-header__eyebrow,
      .student-application__head > div > span {
        display: inline-flex;
        margin-bottom: 8px;
        color: var(--ed-accent, #f59e0b);
        font-size: 13px;
        font-weight: 800;
        letter-spacing: 0;
      }

      .student-header h1,
      .student-overview h2,
      .student-application h2,
      .student-notice h3,
      .student-access-callout h3,
      .student-account-types h3,
      .student-photo-pricing h3 {
        margin: 0;
        font-weight: 800;
        letter-spacing: 0;
      }

      .student-header h1 {
        font-size: 40px;
        line-height: 1.08;
      }

      .student-overview h2,
      .student-application h2 {
        font-size: 26px;
        line-height: 1.18;
      }

      .student-notice h3 {
        font-size: 16px;
        line-height: 1.3;
      }

      .student-header p,
      .student-overview p,
      .student-application__intro,
      .student-notice p,
      .student-access-callout p,
      .student-account-types__head p,
      .student-photo-pricing__head p {
        margin: 8px 0 0;
        color: var(--ed-on-surface-variant, #b3b3b3);
        line-height: 1.58;
      }

      .student-workspace {
        display: grid;
        grid-template-columns: minmax(260px, 360px) minmax(0, 1fr);
        overflow: hidden;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 8px;
        background: var(--ed-surface, #111);
      }

      .student-workspace--loading {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 28px;
        color: var(--ed-on-surface-variant, #b3b3b3);
      }

      .student-overview,
      .student-application {
        min-width: 0;
        padding: 28px;
      }

      .student-overview {
        background: rgba(255, 255, 255, 0.025);
      }

      .student-application {
        border-left: 1px solid var(--ed-outline-variant, #2a2a2a);
        container-type: inline-size;
      }

      .student-status-badge {
        display: inline-flex;
        align-items: center;
        min-height: 28px;
        padding: 5px 10px;
        margin-bottom: 14px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--ed-on-surface-variant, #b3b3b3);
        font-size: 12px;
        font-weight: 800;
      }

      .student-status-badge--active {
        background: rgba(34, 197, 94, 0.14);
        color: #86efac;
      }

      .student-status-badge--approved {
        background: rgba(245, 158, 11, 0.16);
        color: #fbbf24;
      }

      .student-status-badge--pending {
        background: rgba(245, 158, 11, 0.16);
        color: #fbbf24;
      }

      .student-status-badge--blocked {
        background: rgba(239, 68, 68, 0.14);
        color: #fca5a5;
      }

      .student-metrics {
        margin-top: 24px;
        border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      .student-metric {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 0;
        border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      .student-metric strong {
        flex-shrink: 0;
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 29px;
        font-weight: 900;
        line-height: 1;
        white-space: nowrap;
      }

      .student-metric span {
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 14px;
        line-height: 1.3;
        text-align: right;
      }

      .student-metrics--muted .student-metric strong {
        color: var(--ed-accent, #f59e0b);
      }

      .student-plan {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
        margin-top: 18px;
        padding: 16px;
        border: 1px solid rgba(34, 197, 94, 0.28);
        border-radius: 8px;
        background: rgba(34, 197, 94, 0.07);
      }

      .student-plan--locked {
        border-color: var(--ed-outline-variant, #2a2a2a);
        background: rgba(255, 255, 255, 0.025);
      }

      .student-plan--paid {
        border-color: rgba(34, 197, 94, 0.36);
        background: rgba(34, 197, 94, 0.09);
      }

      .student-plan > div {
        display: grid;
        gap: 5px;
      }

      .student-plan > div > span {
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .student-plan strong {
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 22px;
        font-weight: 900;
        line-height: 1.1;
      }

      .student-plan p {
        margin: 0;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 13px;
        line-height: 1.45;
      }

      .student-plan button,
      .student-access-callout button,
      .student-actions button,
      .student-notice a,
      .student-header__action {
        width: 100%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .student-header__action {
        width: auto;
        --mdc-outlined-button-label-text-color: var(--ed-on-surface, #f5f5f5);
        --mdc-outlined-button-outline-color: var(--ed-outline, #3a3a3a);
        color: var(--ed-on-surface, #f5f5f5);
        border-color: var(--ed-outline, #3a3a3a);
      }

      .student-notice__action {
        width: auto;
      }

      .student-plan__button,
      .student-access-callout__button,
      .student-actions__submit,
      .student-notice__action {
        --mdc-filled-button-container-color: var(--ed-accent, #f59e0b);
        --mdc-filled-button-label-text-color: #111318;
      }

      .student-plan__button span,
      .student-access-callout__button span {
        color: inherit;
        font-size: 13px;
        font-weight: 850;
        line-height: 1.15;
        overflow-wrap: anywhere;
        text-align: center;
        text-transform: none;
      }

      .student-plan__hint {
        display: inline-flex;
        min-height: 36px;
        align-items: center;
        color: var(--ed-on-surface-variant, #a3a3a3);
      }

      .student-plan__manage {
        display: grid;
        gap: 10px;
        margin-top: 4px;
      }

      .student-plan__card {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--ed-on-surface-variant, #6b7280);
        font-size: 13px;
        font-weight: 600;
      }

      .student-plan__card mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-on-surface-variant, #9ca3af);
      }

      .student-plan__manage-actions {
        display: grid;
        gap: 8px;
      }

      .student-plan__change-card {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border: 1px solid var(--ed-outline, #d8d8d8);
        border-radius: 10px;
        background: transparent;
        color: var(--ed-on-surface, #1a1a1a);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }

      .student-plan__change-card mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .student-plan__change-card:hover:not(:disabled) {
        background: rgba(245, 158, 11, 0.08);
        border-color: var(--ed-accent, #f59e0b);
      }

      .student-plan__change-card:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .student-plan__cancel {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        border: 1px solid #f0c6c6;
        border-radius: 10px;
        background: transparent;
        color: #b42318;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }

      .student-plan__cancel:hover:not(:disabled) {
        background: #fef3f2;
        border-color: #e0a3a3;
      }

      .student-plan__cancel:disabled {
        opacity: 0.6;
        cursor: default;
      }

      .student-plan__options {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 4px 0 12px;
      }

      .student-plan__option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 14px;
        border: 1.5px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 12px;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        transition: border-color 0.15s ease, background 0.15s ease;
      }

      .student-plan__option--active {
        border-color: var(--ed-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.08);
      }

      .student-plan__option-price {
        font-weight: 700;
      }

      .student-plan__option-badge {
        font-size: 12px;
        font-weight: 600;
        color: #15803d;
        background: rgba(22, 163, 74, 0.12);
        padding: 2px 8px;
        border-radius: 999px;
        white-space: nowrap;
      }

      .student-collapse {
        border: 1px solid #e7e9ee;
        border-radius: 18px;
        background: #fff;
        overflow: hidden;
      }

      .student-collapse .student-pricing__head,
      .student-collapse .student-photo-pricing__head,
      .student-collapse .student-account-types__head {
        display: none;
      }

      .student-collapse > section {
        border: 0;
        padding: 0 18px 16px;
      }

      .student-collapse__summary {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 18px;
        cursor: pointer;
        font-weight: 600;
        font-size: 15px;
        color: #202124;
        list-style: none;
        user-select: none;
      }

      .student-collapse__summary::-webkit-details-marker {
        display: none;
      }

      .student-collapse__summary > span {
        flex: 1;
      }

      .student-collapse__chevron {
        color: #98a2b3;
        transition: transform 0.2s ease;
      }

      .student-collapse[open] .student-collapse__chevron {
        transform: rotate(180deg);
      }

      .student-collapse[open] .student-collapse__summary {
        border-bottom: 1px solid #eef0f4;
        margin-bottom: 12px;
      }

      .student-allowance__row {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .student-account p,
      .student-account li,
      .student-collapse__summary > span {
        text-wrap: pretty;
      }

      .student-account h1,
      .student-account h2,
      .student-account h3 {
        text-wrap: balance;
      }

      .student-application__head {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 18px;
      }

      .student-application__date {
        flex-shrink: 0;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 13px;
        line-height: 1.4;
        text-align: right;
      }

      .student-application__intro {
        max-width: 760px;
        margin-bottom: 22px;
      }

      .student-access-callout {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        max-width: 760px;
        padding: 16px;
        margin-bottom: 24px;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.025);
      }

      .student-access-callout--active {
        border-color: rgba(34, 197, 94, 0.36);
        background: rgba(34, 197, 94, 0.08);
      }

      .student-access-callout--approved,
      .student-access-callout--pending {
        border-color: rgba(245, 158, 11, 0.38);
        background: rgba(245, 158, 11, 0.08);
      }

      .student-access-callout--blocked {
        border-color: rgba(239, 68, 68, 0.32);
        background: rgba(239, 68, 68, 0.07);
      }

      .student-access-callout > mat-icon {
        color: var(--ed-accent, #f59e0b);
      }

      .student-access-callout--active > mat-icon,
      .student-access-callout__state mat-icon {
        color: #22c55e;
      }

      .student-access-callout--blocked > mat-icon {
        color: #ef4444;
      }

      .student-access-callout__label {
        display: inline-flex;
        margin-bottom: 4px;
        color: var(--ed-accent, #f59e0b);
        font-size: 12px;
        font-weight: 850;
      }

      .student-access-callout h3 {
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 17px;
        line-height: 1.25;
      }

      .student-access-callout p {
        margin-top: 5px;
        font-size: 13px;
        line-height: 1.45;
      }

      .student-access-callout .student-access-callout__button {
        min-width: 190px;
        width: auto;
        min-height: 42px;
      }

      .student-access-callout__state {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        min-height: 38px;
        padding: 0 12px;
        border-radius: 8px;
        background: rgba(34, 197, 94, 0.12);
        color: #86efac;
        font-size: 13px;
        font-weight: 850;
        white-space: nowrap;
      }

      .student-access-callout__state mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      .student-account-types,
      .student-pricing,
      .student-photo-pricing {
        display: grid;
        gap: 14px;
        max-width: 760px;
        padding: 16px 0 18px;
        margin-bottom: 24px;
        border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      .student-account-types__head,
      .student-pricing__head,
      .student-photo-pricing__head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .student-account-types__head > mat-icon,
      .student-pricing__head > mat-icon {
        flex: 0 0 auto;
        color: var(--ed-accent, #f59e0b);
      }

      .student-photo-pricing__head > mat-icon {
        flex: 0 0 auto;
        color: var(--ed-accent, #f59e0b);
      }

      .student-account-types h3,
      .student-pricing h3,
      .student-photo-pricing h3 {
        margin: 0;
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 16px;
        font-weight: 800;
        letter-spacing: 0;
        line-height: 1.25;
      }

      .student-account-types__head p,
      .student-photo-pricing__head p,
      .student-pricing__head p,
      .student-pricing__foot {
        margin: 6px 0 0;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 13px;
        line-height: 1.45;
      }

      .student-account-types__grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(205px, 1fr));
        gap: 12px;
      }

      .student-account-card {
        display: grid;
        grid-template-rows: auto auto auto auto 1fr auto;
        gap: 12px;
        min-width: 0;
        padding: 14px;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.025);
      }

      .student-account-card--education {
        border-color: rgba(245, 158, 11, 0.42);
        background: rgba(245, 158, 11, 0.08);
      }

      .student-account-card__top {
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr);
        gap: 10px;
        align-items: center;
      }

      .student-account-card__icon {
        display: grid;
        width: 40px;
        height: 40px;
        place-items: center;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.08);
        color: var(--ed-on-surface, #f5f5f5);
      }

      .student-account-card__top div,
      .student-account-card__examples span {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .student-account-card__top strong {
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 16px;
        font-weight: 900;
        line-height: 1.2;
        overflow-wrap: anywhere;
      }

      .student-account-card__top small,
      .student-account-card p,
      .student-account-card__examples small {
        margin: 0;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 12px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }

      .student-account-card__discounts {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .student-account-card__discounts span {
        display: inline-flex;
        min-height: 24px;
        align-items: center;
        padding: 3px 8px;
        border-radius: 999px;
        background: rgba(245, 158, 11, 0.12);
        color: var(--ed-accent, #f59e0b);
        font-size: 11px;
        font-weight: 850;
        text-transform: uppercase;
        overflow-wrap: anywhere;
      }

      .student-account-card__discounts-service {
        flex-basis: 100%;
        max-width: 100%;
        text-transform: none !important;
      }

      .student-account-card__examples {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
      }

      .student-account-card__examples span {
        padding: 10px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
      }

      .student-account-card__examples b {
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 14px;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }

      .student-account-card__usecases {
        display: grid;
        gap: 5px;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .student-account-card__usecases li {
        position: relative;
        padding-left: 12px;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .student-account-card__usecases li::before {
        content: '';
        position: absolute;
        top: 0.6em;
        left: 0;
        width: 4px;
        height: 4px;
        border-radius: 999px;
        background: var(--ed-accent, #f59e0b);
      }

      .student-account-card__action {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        min-height: 38px;
        margin-top: auto;
        border: 1px solid var(--ed-outline, #3a3a3a);
        border-radius: 8px;
        color: var(--ed-on-surface, #f5f5f5);
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
        font-weight: 850;
        line-height: 1.2;
        text-decoration: none;
        text-align: center;
      }

      .student-account-card__action span {
        overflow-wrap: anywhere;
      }

      .student-account-card__action--primary {
        border-color: var(--ed-accent, #f59e0b);
        background: var(--ed-accent, #f59e0b);
        color: #111318;
      }

      .student-account-card__action--state {
        border-color: var(--ed-outline-variant, #2a2a2a);
        background: rgba(255, 255, 255, 0.035);
        color: var(--ed-on-surface-variant, #a3a3a3);
        cursor: default;
      }

      .student-account-card__action--success {
        border-color: rgba(34, 197, 94, 0.36);
        background: rgba(34, 197, 94, 0.1);
        color: #86efac;
      }

      .student-account-card__action[disabled] {
        cursor: not-allowed;
        opacity: 0.62;
      }

      .student-account-card__action mat-icon,
      .student-account-card__action mat-spinner {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }

      .student-photo-pricing__rows,
      .student-pricing__rows {
        overflow: hidden;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.025);
      }

      .student-pricing__row {
        display: grid;
        grid-template-columns:
          minmax(78px, 0.18fr) 46px minmax(145px, 1fr)
          minmax(230px, 0.78fr);
        align-items: start;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      .student-pricing__row:last-child {
        border-bottom: 0;
      }

      .student-pricing__row > strong {
        color: var(--ed-accent, #f59e0b);
        font-size: 14px;
        font-weight: 900;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .student-pricing__row > div {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .student-pricing__visual {
        display: flex;
        justify-content: center;
        min-width: 0;
      }

      .student-pricing__sheet {
        position: relative;
        display: block;
        overflow: hidden;
        width: 42px;
        aspect-ratio: 0.707;
        border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 3px;
        background: #f8fafc;
        box-shadow: 0 5px 12px rgba(0, 0, 0, 0.22);
      }

      .student-pricing__sheet-line,
      .student-pricing__sheet-image,
      .student-pricing__sheet-bars,
      .student-pricing__sheet-fill {
        position: absolute;
        display: none;
        border-radius: 999px;
        background: #111827;
      }

      .student-pricing__sheet-line {
        left: 6px;
        height: 2px;
        opacity: 0.62;
      }

      .student-pricing__sheet-line--1 {
        top: 8px;
        width: 25px;
      }

      .student-pricing__sheet-line--2 {
        top: 14px;
        width: 30px;
      }

      .student-pricing__sheet-line--3 {
        top: 20px;
        width: 22px;
      }

      .student-pricing__sheet-line--4 {
        top: 30px;
        width: 28px;
      }

      .student-pricing__sheet-line--5 {
        top: 36px;
        width: 18px;
      }

      .student-pricing__sheet-line--6 {
        top: 46px;
        width: 27px;
      }

      .student-pricing__visual--text .student-pricing__sheet-line {
        display: block;
      }

      .student-pricing__visual--mixed .student-pricing__sheet-line,
      .student-pricing__visual--mixed .student-pricing__sheet-image,
      .student-pricing__visual--mixed .student-pricing__sheet-bars {
        display: block;
      }

      .student-pricing__visual--mixed .student-pricing__sheet-line {
        left: 5px;
        width: 17px;
      }

      .student-pricing__sheet-image {
        top: 22px;
        right: 5px;
        width: 15px;
        height: 15px;
        border-radius: 2px;
        background: linear-gradient(135deg, #111827 0 52%, #9ca3af 52%);
      }

      .student-pricing__sheet-bars {
        right: 6px;
        bottom: 8px;
        width: 20px;
        height: 14px;
        background: transparent;
      }

      .student-pricing__sheet-bars span {
        position: absolute;
        bottom: 0;
        width: 4px;
        border-radius: 2px 2px 0 0;
        background: #111827;
      }

      .student-pricing__sheet-bars span:nth-child(1) {
        left: 0;
        height: 7px;
      }

      .student-pricing__sheet-bars span:nth-child(2) {
        left: 7px;
        height: 12px;
      }

      .student-pricing__sheet-bars span:nth-child(3) {
        left: 14px;
        height: 9px;
      }

      .student-pricing__visual--heavy .student-pricing__sheet-fill,
      .student-pricing__visual--full .student-pricing__sheet-fill {
        display: block;
        border-radius: 2px;
      }

      .student-pricing__visual--heavy .student-pricing__sheet-fill {
        inset: 6px 5px 15px;
        background:
          linear-gradient(rgba(17, 24, 39, 0.88), rgba(17, 24, 39, 0.88)) 0 0 /
            100% 66% no-repeat,
          linear-gradient(90deg, #111827 0 44%, transparent 44%) 0 100% / 100%
            24% no-repeat;
      }

      .student-pricing__visual--heavy .student-pricing__sheet-line--6 {
        display: block;
        top: auto;
        bottom: 7px;
        width: 27px;
      }

      .student-pricing__visual--full .student-pricing__sheet-fill {
        inset: 3px;
        background: linear-gradient(135deg, #111827, #374151 62%, #111827);
      }

      .student-pricing__visual--full .student-pricing__sheet-line--1,
      .student-pricing__visual--full .student-pricing__sheet-line--2,
      .student-pricing__visual--full .student-pricing__sheet-line--3 {
        display: block;
        z-index: 1;
        background: rgba(255, 255, 255, 0.78);
      }

      .student-pricing__title {
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 14px;
        font-weight: 800;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }

      .student-pricing__description {
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 12px;
        font-style: normal;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .student-price-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(64px, 1fr));
        gap: 6px;
        min-width: 0;
      }

      .student-price-grid span {
        display: grid;
        gap: 4px;
        min-width: 0;
        padding: 8px;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.035);
      }

      .student-price-grid small {
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 10px;
        font-weight: 800;
        line-height: 1.1;
        text-transform: uppercase;
        overflow-wrap: anywhere;
      }

      .student-price-grid b {
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 15px;
        font-weight: 900;
        line-height: 1.3;
        text-align: left;
        overflow-wrap: anywhere;
      }

      .student-price-grid__cell--education {
        border-color: rgba(245, 158, 11, 0.44) !important;
        background: rgba(245, 158, 11, 0.1) !important;
      }

      .student-price-grid__cell--education b,
      .student-price-grid__cell--education small {
        color: var(--ed-accent, #f59e0b);
      }

      .student-photo-pricing__row {
        display: grid;
        grid-template-columns: minmax(128px, 0.36fr) minmax(230px, 1fr);
        gap: 12px;
        align-items: start;
        padding: 12px 14px;
        border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      .student-photo-pricing__row:last-child {
        border-bottom: 0;
      }

      .student-photo-pricing__format {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      .student-photo-pricing__format strong {
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 15px;
        font-weight: 900;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }

      .student-photo-pricing__format small {
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 12px;
        line-height: 1.35;
        overflow-wrap: anywhere;
      }

      .student-notice {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: 14px;
        padding: 14px 0;
        margin-bottom: 20px;
        border-top: 1px solid rgba(245, 158, 11, 0.35);
        border-bottom: 1px solid rgba(245, 158, 11, 0.35);
      }

      .student-notice > mat-icon {
        color: var(--ed-accent, #f59e0b);
      }

      .student-form__grid {
        display: grid;
        grid-template-columns: 190px minmax(0, 1fr) 230px;
        gap: 14px;
      }

      .student-field {
        display: flex;
        flex-direction: column;
        gap: 7px;
        min-width: 0;
      }

      .student-field__label {
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 12px;
        font-weight: 700;
        line-height: 1.2;
      }

      .student-field__label span {
        color: var(--ed-error, #ef4444);
      }

      .student-field__control {
        width: 100%;
        min-height: 52px;
        padding: 0 14px;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 8px;
        outline: none;
        background: rgba(255, 255, 255, 0.035);
        color: var(--ed-on-surface, #f5f5f5);
        font: inherit;
        font-size: 15px;
        transition:
          border-color 160ms ease,
          background-color 160ms ease,
          box-shadow 160ms ease;
      }

      .student-field__control::placeholder {
        color: var(--ed-on-surface-muted, #666666);
      }

      .student-field__control:hover {
        border-color: var(--ed-outline, #3a3a3a);
        background: rgba(255, 255, 255, 0.05);
      }

      .student-field__control:focus {
        border-color: rgba(245, 158, 11, 0.68);
        background: rgba(255, 255, 255, 0.055);
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
      }

      .student-field__control--date,
      .student-field__control--select {
        color-scheme: dark;
      }

      .student-field__control--date::-webkit-calendar-picker-indicator {
        cursor: pointer;
        opacity: 0.75;
        filter: invert(70%) sepia(73%) saturate(1165%) hue-rotate(354deg)
          brightness(101%) contrast(92%);
      }

      .student-field__message {
        min-height: 15px;
        color: var(--ed-error, #ef4444);
        font-size: 12px;
        line-height: 1.25;
      }

      .student-form__hint {
        margin: 10px 0 0;
        color: var(--ed-muted, #64748b);
        font-size: 13px;
        line-height: 1.45;
      }

      .student-field--invalid .student-field__control {
        border-color: rgba(239, 68, 68, 0.82);
        box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
      }

      .student-upload {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 4px 12px;
        align-items: center;
        min-height: 82px;
        margin: 2px 0 20px;
        padding: 16px;
        border: 1px dashed var(--ed-outline, #3a3a3a);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.025);
        cursor: pointer;
      }

      .student-upload--selected {
        border-style: solid;
        border-color: rgba(34, 197, 94, 0.45);
        background: rgba(34, 197, 94, 0.08);
      }

      .student-upload input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }

      .student-upload mat-icon {
        grid-row: 1 / span 2;
        color: var(--ed-accent, #f59e0b);
      }

      .student-upload span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 700;
      }

      .student-upload small {
        color: var(--ed-on-surface-variant, #a3a3a3);
      }

      .edu-estimate {
        display: grid;
        gap: 14px;
        max-width: 760px;
        padding: 16px 0 18px;
        margin-bottom: 24px;
        border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      .edu-estimate__head {
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .edu-estimate__head > mat-icon {
        flex: 0 0 auto;
        color: var(--ed-accent, #f59e0b);
      }

      .edu-estimate__head h3 {
        margin: 0;
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 16px;
        font-weight: 800;
        line-height: 1.25;
      }

      .edu-estimate__head p {
        margin: 6px 0 0;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 13px;
        line-height: 1.45;
      }

      .edu-estimate__upsell {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.08);
        font-size: 13px;
        line-height: 1.4;
      }

      .edu-estimate__upsell mat-icon {
        flex: 0 0 auto;
        color: var(--ed-accent, #f59e0b);
      }

      .edu-estimate__upload {
        margin: 0;
      }

      .edu-estimate__upload input:disabled {
        cursor: progress;
      }

      .edu-estimate__status {
        display: flex;
        align-items: center;
        gap: 10px;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 14px;
      }

      .edu-estimate__error {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-radius: 8px;
        border: 1px solid rgba(239, 68, 68, 0.4);
        background: rgba(239, 68, 68, 0.08);
        color: var(--ed-error, #ef4444);
        font-size: 13px;
      }

      .edu-estimate__error mat-icon {
        flex: 0 0 auto;
      }

      .edu-estimate__toggle {
        display: inline-flex;
        gap: 6px;
        padding: 4px;
        border-radius: 10px;
        border: 1px solid var(--ed-outline, #3a3a3a);
        background: rgba(255, 255, 255, 0.025);
        width: fit-content;
      }

      .edu-estimate__toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px;
        border: none;
        border-radius: 7px;
        background: transparent;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }

      .edu-estimate__toggle-btn mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      .edu-estimate__toggle-btn:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }

      .edu-estimate__toggle-btn--active {
        background: var(--ed-accent, #f59e0b);
        color: #111318;
      }

      .edu-estimate__pages {
        display: grid;
        gap: 2px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
      }

      .edu-estimate__pages-head,
      .edu-estimate__page-row {
        display: grid;
        grid-template-columns: 56px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr);
        gap: 8px;
        align-items: center;
        padding: 10px 14px;
        font-size: 13px;
      }

      .edu-estimate__pages-head {
        background: rgba(255, 255, 255, 0.04);
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-weight: 700;
      }

      .edu-estimate__page-row {
        background: rgba(255, 255, 255, 0.015);
        color: var(--ed-on-surface, #f5f5f5);
      }

      .edu-estimate__page-row--over {
        background: rgba(239, 68, 68, 0.07);
      }

      .edu-estimate__page-row span {
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .edu-estimate__ink {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--ed-on-surface-variant, #a3a3a3);
      }

      .edu-estimate__ink--color {
        color: var(--ed-accent, #f59e0b);
      }

      .edu-estimate__page-price {
        flex-wrap: wrap;
      }

      .edu-estimate__page-price s {
        color: var(--ed-on-surface-muted, #666666);
      }

      .edu-estimate__page-price b {
        font-weight: 800;
      }

      .edu-estimate__badge {
        padding: 1px 7px;
        border-radius: 999px;
        background: rgba(239, 68, 68, 0.15);
        color: var(--ed-error, #ef4444);
        font-size: 11px;
        font-weight: 700;
      }

      .edu-estimate__total {
        display: grid;
        gap: 6px;
        padding: 14px 16px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.04);
      }

      .edu-estimate__total-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        font-size: 15px;
        font-weight: 700;
      }

      .edu-estimate__total-row strong {
        font-size: 20px;
        font-weight: 800;
      }

      .edu-estimate__total-row s {
        margin-right: 8px;
        font-size: 14px;
        font-weight: 600;
        color: var(--ed-on-surface-muted, #666666);
      }

      .edu-estimate__savings {
        margin: 0;
        color: #22c55e;
        font-size: 13px;
        font-weight: 700;
      }

      .edu-estimate__note {
        margin: 0;
        color: var(--ed-on-surface-variant, #a3a3a3);
        font-size: 12px;
        line-height: 1.45;
      }

      .edu-estimate__note--warn {
        color: var(--ed-error, #ef4444);
      }

      .edu-estimate__note--muted {
        color: var(--ed-on-surface-muted, #666666);
      }

      .student-actions {
        display: flex;
        justify-content: flex-end;
      }

      .student-actions button,
      .student-header a,
      .student-notice a {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .student-message,
      .student-lock {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px 0;
        margin-bottom: 16px;
        border-top: 1px solid rgba(34, 197, 94, 0.35);
        border-bottom: 1px solid rgba(34, 197, 94, 0.35);
        color: #bbf7d0;
      }

      .student-message--error,
      .student-lock {
        border-color: rgba(239, 68, 68, 0.35);
        color: #fecaca;
      }

      .student-lock {
        border-color: var(--ed-outline-variant, #2a2a2a);
        color: var(--ed-on-surface-variant, #b3b3b3);
        margin-bottom: 0;
      }

      @container (max-width: 760px) {
        .student-access-callout,
        .student-pricing__row,
        .student-photo-pricing__row {
          grid-template-columns: 1fr;
        }

        .student-access-callout .student-access-callout__button {
          width: 100%;
          min-width: 0;
        }

        .student-pricing__visual {
          justify-content: flex-start;
        }

        .student-price-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @container (max-width: 520px) {
        .student-account-types__grid,
        .student-price-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 960px) {
        .student-account {
          width: min(100% - 24px, 1160px);
          padding: 20px 0 36px;
        }

        .student-header,
        .student-workspace,
        .student-application__head,
        .student-form__grid,
        .student-access-callout,
        .student-notice {
          grid-template-columns: 1fr;
        }

        .student-header h1 {
          font-size: 31px;
        }

        .student-overview,
        .student-application {
          padding: 20px;
        }

        .student-application {
          border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
          border-left: 0;
        }

        .student-application__date {
          text-align: left;
        }

        .student-account-types__grid,
        .student-pricing__row,
        .student-photo-pricing__row {
          grid-template-columns: 1fr;
          gap: 6px;
        }

        .student-price-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .student-price-grid b {
          text-align: left;
        }

        .student-notice {
          align-items: start;
        }

        .student-actions {
          justify-content: stretch;
        }

        .student-actions button,
        .student-access-callout .student-access-callout__button,
        .student-header a,
        .student-notice a {
          width: 100%;
          min-width: 0;
          justify-content: center;
        }
      }
    `,
    `
      :host {
        background: #f3f4f6;
        color: #202124;
      }

      .student-account {
        width: min(1220px, calc(100% - 40px));
        padding: 32px 0 72px;
      }

      .student-header {
        align-items: center;
        padding: 32px;
        margin-bottom: 24px;
        border: 1px solid #e7e9ee;
        border-radius: 32px;
        background: #fff;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
      }

      .student-header__copy {
        max-width: 820px;
      }

      .student-header__eyebrow,
      .student-application__head > div > span {
        color: #ff9900;
      }

      .student-header h1 {
        color: #111318;
        font-size: clamp(34px, 4vw, 56px);
      }

      .student-overview h2,
      .student-application h2,
      .student-notice h3,
      .student-access-callout h3,
      .student-account-types h3,
      .student-pricing h3,
      .student-photo-pricing h3 {
        color: #111318;
      }

      .student-header p,
      .student-overview p,
      .student-application__intro,
      .student-notice p,
      .student-access-callout p,
      .student-account-types__head p,
      .student-pricing__head p,
      .student-photo-pricing__head p,
      .student-pricing__foot {
        color: #667085;
      }

      .student-workspace {
        grid-template-columns: minmax(280px, 370px) minmax(0, 1fr);
        border: 1px solid #e7e9ee;
        border-radius: 32px;
        background: #fff;
        box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08);
      }

      .student-workspace--loading {
        color: #667085;
      }

      .student-overview {
        background: #f7f8fb;
      }

      .student-application {
        border-left-color: #e7e9ee;
        background: #fff;
      }

      .student-status-badge {
        border-radius: 999px;
        background: #eef0f4;
        color: #667085;
      }

      .student-status-badge--active {
        background: #dcfce7;
        color: #15803d;
      }

      .student-status-badge--approved,
      .student-status-badge--pending {
        background: #fff3d6;
        color: #b45309;
      }

      .student-status-badge--blocked {
        background: #fee2e2;
        color: #b91c1c;
      }

      .student-metrics {
        border-top-color: #e7e9ee;
      }

      .student-metric {
        border-bottom-color: #e7e9ee;
      }

      .student-metric strong {
        color: #111318;
      }

      .student-metric span,
      .student-plan > div > span,
      .student-plan p,
      .student-plan__hint,
      .student-application__date,
      .student-field__label,
      .student-upload small {
        color: #667085;
      }

      .student-metrics--muted .student-metric strong {
        color: #ff9900;
      }

      .student-plan {
        border-color: #bbf7d0;
        border-radius: 22px;
        background: #ecfdf5;
      }

      .student-plan--locked {
        border-color: #e7e9ee;
        background: #f3f4f6;
      }

      .student-plan--paid {
        border-color: #86efac;
        background: #ecfdf5;
      }

      .student-plan strong {
        color: #111318;
      }

      .student-access-callout {
        max-width: none;
        border-color: #e7e9ee;
        border-radius: 22px;
        background: #f7f8fb;
      }

      .student-access-callout--active {
        border-color: #86efac;
        background: #ecfdf5;
      }

      .student-access-callout--approved,
      .student-access-callout--pending {
        border-color: #ffd28a;
        background: #fff8e7;
      }

      .student-access-callout--blocked {
        border-color: #fecaca;
        background: #fff1f2;
      }

      .student-access-callout > mat-icon,
      .student-access-callout__label {
        color: #b45309;
      }

      .student-access-callout--active > mat-icon,
      .student-access-callout__state mat-icon {
        color: #15803d;
      }

      .student-access-callout--blocked > mat-icon {
        color: #b91c1c;
      }

      .student-access-callout__state {
        border-radius: 14px;
        background: #dcfce7;
        color: #15803d;
      }

      .student-plan button,
      .student-access-callout button,
      .student-actions button,
      .student-notice__action {
        min-height: 48px;
        border-radius: 16px;
        --mdc-filled-button-container-color: #ff9900;
        --mdc-filled-button-label-text-color: #111318;
        background: #ff9900;
        color: #111318;
        font-weight: 800;
      }

      .student-plan .student-plan__cancel {
        align-self: flex-start;
        min-height: 0;
        margin-top: 4px;
        border-radius: 10px;
        background: transparent;
        color: #b42318;
        font-weight: 600;
        font-size: 13px;
      }

      .student-plan .student-plan__cancel:hover:not(:disabled) {
        background: #fef3f2;
      }

      .student-plan__button[disabled],
      .student-access-callout__button[disabled],
      .student-actions__submit[disabled] {
        --mdc-filled-button-disabled-container-color: #e7e9ee;
        --mdc-filled-button-disabled-label-text-color: #98a2b3;
        background: #e7e9ee;
        color: #98a2b3;
      }

      .student-header__action {
        min-height: 44px;
        --mdc-outlined-button-label-text-color: #111318;
        --mdc-outlined-button-outline-color: #111318;
        border-color: #111318;
        background: #fff;
        color: #111318;
        font-weight: 800;
      }

      .student-header a,
      .student-notice a {
        min-height: 44px;
        border-radius: 999px;
      }

      .student-account-types,
      .student-pricing,
      .student-photo-pricing {
        max-width: none;
        border-top-color: #e7e9ee;
        border-bottom-color: #e7e9ee;
      }

      .student-account-types__head > mat-icon,
      .student-pricing__head > mat-icon,
      .student-photo-pricing__head > mat-icon {
        color: #ff9900;
      }

      .student-account-card {
        border-color: #e7e9ee;
        background: #fff;
      }

      .student-account-card--education {
        border-color: #ffd28a;
        background: #fff8e7;
      }

      .student-account-card__icon {
        background: #eef0f4;
        color: #111318;
      }

      .student-account-card__discounts span {
        background: #fff3d6;
        color: #b45309;
      }

      .student-account-card__examples span,
      .student-price-grid span {
        border-color: #e7e9ee;
        background: #f7f8fb;
      }

      .student-account-card__action {
        border-color: #d9dee8;
        background: #fff;
        color: #111318;
      }

      .student-account-card__action--primary,
      .student-account-card--education .student-account-card__action:not(.student-account-card__action--state) {
        border-color: #ff9900;
        background: #ff9900;
        color: #111318;
      }

      .student-account-card__action--state {
        border-color: #e7e9ee;
        background: #f7f8fb;
        color: #667085;
      }

      .student-account-card__action--success {
        border-color: #bbf7d0;
        background: #ecfdf5;
        color: #15803d;
      }

      .student-photo-pricing__rows,
      .student-pricing__rows {
        border-color: #e7e9ee;
        border-radius: 22px;
        background: #fff;
      }

      .student-pricing__row,
      .student-photo-pricing__row {
        border-bottom-color: #e7e9ee;
      }

      .student-pricing__row > strong {
        color: #ff9900;
      }

      .student-account-card__top strong,
      .student-account-card__examples b,
      .student-pricing__title,
      .student-price-grid b,
      .student-photo-pricing__format strong,
      .student-upload span {
        color: #111318;
      }

      .student-account-card__top small,
      .student-account-card p,
      .student-account-card__examples small,
      .student-pricing__description,
      .student-price-grid small,
      .student-photo-pricing__format small {
        color: #667085;
      }

      .student-price-grid__cell--education {
        border-color: #ffcf7a !important;
        background: #fff8e7 !important;
      }

      .student-price-grid__cell--education b,
      .student-price-grid__cell--education small {
        color: #b45309;
      }

      .student-pricing__sheet {
        border-color: #d9dee8;
        box-shadow: 0 8px 18px rgba(15, 23, 42, 0.16);
      }

      .student-notice {
        padding: 18px;
        border: 0;
        border-radius: 22px;
        background: #fff8e7;
      }

      .student-notice > mat-icon,
      .student-upload mat-icon {
        color: #ff9900;
      }

      .student-field__control {
        border-color: #d9dee8;
        border-radius: 16px;
        background: #f7f8fb;
        color: #111318;
      }

      .student-field__control::placeholder {
        color: #98a2b3;
      }

      .student-field__control:hover,
      .student-field__control:focus {
        border-color: #b9c0cc;
        background: #fff;
      }

      .student-field__control:focus {
        box-shadow: 0 0 0 4px rgba(255, 153, 0, 0.14);
      }

      .student-field__control--date,
      .student-field__control--select {
        color-scheme: light;
      }

      .student-field__control--date::-webkit-calendar-picker-indicator {
        filter: none;
      }

      .student-upload {
        border-color: #d9dee8;
        border-radius: 22px;
        background: #f7f8fb;
      }

      .student-upload--selected {
        border-color: #86efac;
        background: #ecfdf5;
      }

      .student-message,
      .student-lock {
        padding: 14px 16px;
        border: 0;
        border-radius: 18px;
        background: #ecfdf5;
        color: #166534;
      }

      .student-message--error {
        background: #fee2e2;
        color: #991b1b;
      }

      .student-lock {
        background: #f3f4f6;
        color: #667085;
      }

      .edu-estimate {
        border-top-color: #e7e9ee;
        border-bottom-color: #e7e9ee;
      }

      .edu-estimate__head h3 {
        color: #111318;
      }

      .edu-estimate__head p,
      .edu-estimate__status,
      .edu-estimate__note {
        color: #667085;
      }

      .edu-estimate__note--muted {
        color: #98a2b3;
      }

      .edu-estimate__note--warn {
        color: #991b1b;
      }

      .edu-estimate__upsell {
        border-color: #ffcf7a;
        background: #fff8e7;
        color: #b45309;
      }

      .edu-estimate__upsell mat-icon {
        color: #d97706;
      }

      .edu-estimate__upload {
        border-color: #d9dee8;
        border-radius: 22px;
        background: #f7f8fb;
      }

      .edu-estimate__error {
        border-color: #fecaca;
        background: #fee2e2;
        color: #991b1b;
      }

      .edu-estimate__toggle {
        border-color: #d9dee8;
        background: #f7f8fb;
      }

      .edu-estimate__toggle-btn {
        color: #667085;
      }

      .edu-estimate__toggle-btn--active {
        background: #ff9900;
        color: #fff;
      }

      .edu-estimate__pages {
        border-color: #e7e9ee;
      }

      .edu-estimate__pages-head {
        background: #f3f4f6;
        color: #667085;
      }

      .edu-estimate__page-row {
        background: #fff;
        color: #202124;
      }

      .edu-estimate__page-row--over {
        background: #fef2f2;
      }

      .edu-estimate__ink {
        color: #98a2b3;
      }

      .edu-estimate__ink--color {
        color: #d97706;
      }

      .edu-estimate__page-price s,
      .edu-estimate__total-row s {
        color: #98a2b3;
      }

      .edu-estimate__badge {
        background: #fee2e2;
        color: #991b1b;
      }

      .edu-estimate__total {
        background: #f7f8fb;
      }

      .edu-estimate__savings {
        color: #15803d;
      }

      @media (max-width: 960px) {
        .student-account {
          width: min(100% - 24px, 1220px);
          padding: 20px 0 40px;
        }

        .student-header {
          padding: 24px;
          border-radius: 28px;
        }

        .student-workspace {
          grid-template-columns: 1fr;
          border-radius: 28px;
        }

        .student-application {
          border-top-color: #e7e9ee;
          border-top: 1px solid #e7e9ee;
          border-left: 0;
        }
      }
    `,
  ],
})
export class StudentAccountComponent implements OnInit, OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly studentVerificationService = inject(
    StudentVerificationService,
  );
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly cloudPaymentsService = inject(CloudPaymentsService);
  private readonly eduPrintEstimateService = inject(EduPrintEstimateService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly form = this.fb.group({
    educationRole: this.fb.control<EducationRole>('student', {
      validators: [Validators.required],
    }),
    institutionName: [
      '',
      [Validators.required, Validators.minLength(2), Validators.maxLength(200)],
    ],
    documentExpiresAt: [''],
  });

  /** Реактивная подсказка по документу: меняется при выборе роли (студент/абитуриент/педагог). */
  private readonly educationRoleValue = toSignal(
    this.form.controls.educationRole.valueChanges.pipe(
      startWith(this.form.controls.educationRole.value),
    ),
    { initialValue: this.form.controls.educationRole.value },
  );
  protected readonly documentHint = computed(
    () => EDUCATION_DOCUMENT_HINTS[this.educationRoleValue() ?? 'student'],
  );

  protected readonly loading = signal(true);
  protected readonly submitting = signal(false);
  protected readonly paying = signal(false);
  protected readonly selectedFile = signal<File | null>(null);
  protected readonly status = signal<StudentVerificationStatusPayload | null>(
    null,
  );
  protected readonly educationPlans = signal<SubscriptionPlan[]>([]);
  protected readonly selectedEducationPlanId = signal<string | null>(null);
  /** Выбранный для оплаты образовательный план (месячный/годовой). */
  protected readonly educationPlan = computed<SubscriptionPlan | null>(() => {
    const plans = this.educationPlans();
    const selectedId = this.selectedEducationPlanId();
    return (
      plans.find((p) => p.id === selectedId) ??
      plans.find((p) => p.slug === EDUCATION_PLAN_SLUG) ??
      plans[0] ??
      null
    );
  });
  protected readonly errorMessage = signal('');
  protected readonly successMessage = signal('');
  protected readonly cancelling = signal(false);
  protected readonly changingCard = signal(false);

  /** Активная образовательная подписка (для кнопки отмены). */
  protected readonly educationSubscription = computed<MySubscription | null>(
    () =>
      this.subscriptionService
        .subscriptions()
        .find(
          (s) =>
            s.plan_category === 'education' &&
            (s.status === 'active' || s.status === 'paused'),
        ) ?? null,
  );

  protected readonly hasAccountPhone = computed(() => {
    const profile = this.authService.currentUser();
    return !!profile?.phone?.trim();
  });
  protected readonly missingAccountPhone = computed(
    () => !this.authService.isLoading() && !this.hasAccountPhone(),
  );

  protected readonly discount = computed(
    () => this.status()?.discount ?? this.status()?.student_discount ?? null,
  );
  protected readonly activeDiscount = computed(() => {
    const discount = this.discount();
    return discount?.status === 'active' ? discount : null;
  });
  /**
   * Различаем два активных уровня: подтверждён без подписки (верификация) и
   * полная подписка. Подписка, дефолт: любой неизвестный/legacy токен считаем
   * подпиской. Верификация без подписки, только source_token === 'education_verified'.
   */
  protected readonly verifiedOnly = computed(
    () => this.activeDiscount()?.source_token === 'education_verified',
  );
  protected readonly latestSubmittedAt = computed(
    () => this.status()?.latest_verification?.submitted_at ?? null,
  );
  protected readonly selectedFileName = computed(
    () => this.selectedFile()?.name ?? 'Выбрать фото документа',
  );
  protected readonly accountDiscountCards = ACCOUNT_DISCOUNT_CARDS;
  protected readonly printPricingRows = STUDENT_PRINT_PRICING_ROWS;
  protected readonly photoPricingRows = STUDENT_PHOTO_PRICING_ROWS;
  protected readonly educationRoleOptions = EDUCATION_ROLE_OPTIONS;

  // Калькулятор edu-печати, состояние из EduPrintEstimateService (только чтение)
  protected readonly estimateAccept = ESTIMATE_FILE_ACCEPT;
  protected readonly estimateState = this.eduPrintEstimateService.state;
  protected readonly estimateResult = this.eduPrintEstimateService.result;
  protected readonly estimateError = this.eduPrintEstimateService.error;
  protected readonly estimateFileName = this.eduPrintEstimateService.fileName;
  protected readonly estimateColorMode = this.eduPrintEstimateService.colorMode;
  protected readonly estimateBusy = this.eduPrintEstimateService.isBusy;

  /** Текст остатка лимита: предпочитаем свежий allowance из ответа, иначе, activeDiscount(). */
  protected readonly estimateAllowanceText = computed<string | null>(() => {
    const allowance = this.estimateResult()?.allowance;
    if (allowance?.active) {
      return `Документы: осталось ${allowance.documentsRemaining} из ${allowance.documentsLimit}. Сверх лимита, обычная цена.`;
    }
    const discount = this.activeDiscount();
    if (discount) {
      return `Документы: осталось ${discount.print_sheets_remaining} из ${discount.print_sheets_limit}. Сверх лимита, обычная цена.`;
    }
    return null;
  });

  protected readonly statusKind = computed<StudentStatusKind>(() => {
    const current = this.status();
    if (current?.latest_verification?.status === 'pending') {
      return 'pending';
    }

    const accountStatus = current?.account?.status;
    if (accountStatus === 'verified') {
      return this.activeDiscount() ? 'active' : 'approved';
    }

    if (
      accountStatus === 'rejected' ||
      accountStatus === 'revoked' ||
      accountStatus === 'expired'
    ) {
      return accountStatus;
    }

    return 'none';
  });

  protected readonly statusLabel = computed(() => {
    switch (this.statusKind()) {
      case 'active':
        return 'Активен';
      case 'approved':
        return 'Одобрен, ждёт оплаты';
      case 'pending':
        return 'На проверке';
      case 'rejected':
        return 'Отклонён';
      case 'revoked':
        return 'Отозван';
      case 'expired':
        return 'Истёк';
      default:
        return 'Не подключён';
    }
  });

  protected readonly statusTitle = computed(() => {
    return 'Образовательный аккаунт';
  });

  protected readonly statusDescription = computed(() => {
    const current = this.status();
    const expiresAt = current?.account?.expires_at;

    switch (this.statusKind()) {
      case 'active': {
        const discountExpiresAt =
          this.activeDiscount()?.expires_at ?? expiresAt;
        return discountExpiresAt
          ? `Доступ оплачен до ${this.formatDate(discountExpiresAt)}. Скидки применяются автоматически.`
          : 'Скидки применяются автоматически.';
      }
      case 'approved':
        return expiresAt
          ? `Документ одобрен до ${this.formatDate(expiresAt)}. Подключите подписку (199 ₽/мес или 1999 ₽/год), чтобы документы А4 стоили от 3 ₽, а фотопечать, от 14 ₽.`
          : 'Документ одобрен. Подключите подписку (199 ₽/мес или 1999 ₽/год), чтобы документы А4 стоили от 3 ₽, а фотопечать, от 14 ₽.';
      case 'pending':
        return 'Документ отправлен. Мы проверим его вручную и обновим статус в личном кабинете.';
      case 'rejected':
        return (
          current?.latest_verification?.rejection_reason ??
          'Не получилось подтвердить документ. Проверьте читаемость фото и отправьте новый снимок.'
        );
      case 'revoked':
        return (
          current?.account?.revoke_reason ??
          'Доступ к образовательным условиям приостановлен. Напишите нам в чат, если это ошибка.'
        );
      case 'expired':
        return 'Срок действия документа закончился. Загрузите актуальный документ, чтобы снова пользоваться условиями.';
      default:
        return 'Загрузите документ. После проверки можно подключить подписку (199 ₽/мес или 1999 ₽/год): документы А4 дешевле на 70%, премиум-фотопечать от 10×15 до А4 на 50%.';
    }
  });

  protected readonly applicationStatusIcon = computed(() => {
    switch (this.statusKind()) {
      case 'active':
        return 'verified';
      case 'approved':
        return 'payments';
      case 'pending':
        return 'schedule';
      case 'rejected':
      case 'revoked':
      case 'expired':
        return 'error_outline';
      default:
        return 'school';
    }
  });

  protected readonly applicationStatusTitle = computed(() => {
    switch (this.statusKind()) {
      case 'active':
        return 'Образовательные цены включены';
      case 'approved':
        return 'Проверка одобрена';
      case 'pending':
        return 'Документ на проверке';
      case 'rejected':
        return 'Документ отклонён';
      case 'revoked':
        return 'Доступ приостановлен';
      case 'expired':
        return 'Срок документа истёк';
      default:
        return 'Статус проверки';
    }
  });

  protected readonly applicationStatusDescription = computed(() => {
    switch (this.statusKind()) {
      case 'approved':
        return `Чтобы включить образовательные цены, оплатите ${this.educationPlanPriceLabel()} с автопродлением.`;
      // Для активного доступа описание не дублируем: статус уже виден в карточке слева,
      // здесь достаточно бейджа «Доступ активен».
      case 'active':
        return '';
      case 'pending':
      case 'rejected':
      case 'revoked':
      case 'expired':
        return this.statusDescription();
      default:
        return 'Загрузите документ, чтобы отправить статус на проверку.';
    }
  });

  ngOnInit(): void {
    // EduPrintEstimateService, root-singleton: чистим возможный stale-результат
    // прошлого визита, чтобы калькулятор открывался в idle, а не с протухшим s3Key.
    this.eduPrintEstimateService.reset();
    void this.loadStatus();
    void this.loadEducationPlan();
    this.subscriptionService.ensureLoaded();
  }

  ngOnDestroy(): void {
    // Сброс при уходе со страницы: иначе на root-singleton останется старая оценка,
    // а reprice по истёкшему presigned-ключу вернул бы 410.
    this.eduPrintEstimateService.reset();
  }

  protected async loadStatus(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set('');

    try {
      const currentStatus = await firstValueFrom(
        this.studentVerificationService.loadMine(),
      );
      this.status.set(currentStatus);
      this.patchFormFromStatus(currentStatus);
    } catch (error: unknown) {
      this.errorMessage.set(
        this.readErrorMessage(
          error,
          'Не удалось загрузить данные образовательного доступа.',
        ),
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadEducationPlan(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.subscriptionService.loadPlans('education'),
      );
      const plans = (response.plans ?? []).filter(
        (plan) => plan.category === 'education',
      );
      this.educationPlans.set(plans);
      if (!this.selectedEducationPlanId()) {
        const monthly = plans.find((plan) => plan.slug === EDUCATION_PLAN_SLUG);
        this.selectedEducationPlanId.set((monthly ?? plans[0])?.id ?? null);
      }
    } catch {
      this.educationPlans.set([]);
    }
  }

  protected selectEducationPlan(planId: string): void {
    this.selectedEducationPlanId.set(planId);
  }

  /** Короткая цена плана для переключателя: «199 ₽ / мес» или «1999 ₽ / год». */
  protected planPriceShort(plan: SubscriptionPlan): string {
    const amount = this.readPlanAmount(plan.base_price ?? 0);
    const suffix =
      plan.billing_period === 'yearly'
        ? '/ год'
        : plan.billing_period === 'quarterly'
          ? '/ квартал'
          : '/ мес';
    return `${this.formatMoney(amount)} ₽ ${suffix}`;
  }

  protected onFileSelected(event: Event): void {
    const input =
      event.target instanceof HTMLInputElement ? event.target : null;
    const file = input?.files?.item(0) ?? null;
    this.errorMessage.set('');
    this.successMessage.set('');

    if (!file) {
      this.selectedFile.set(null);
      return;
    }

    if (!SUPPORTED_DOCUMENT_TYPES.has(file.type)) {
      this.selectedFile.set(null);
      this.errorMessage.set(
        'Загрузите фото в формате JPEG, PNG, WEBP или HEIC.',
      );
      return;
    }

    if (file.size > MAX_DOCUMENT_FILE_SIZE) {
      this.selectedFile.set(null);
      this.errorMessage.set('Файл должен быть не больше 12 МБ.');
      return;
    }

    this.selectedFile.set(file);
  }

  protected async onEstimateFileSelected(event: Event): Promise<void> {
    const input =
      event.target instanceof HTMLInputElement ? event.target : null;
    const file = input?.files?.item(0) ?? null;
    if (input) {
      // Сброс value, чтобы повторный выбор того же файла снова дал событие
      input.value = '';
    }
    if (!file) {
      return;
    }
    if (file.size > MAX_ESTIMATE_FILE_SIZE) {
      this.eduPrintEstimateService.fail('Файл должен быть не больше 50 МБ.');
      return;
    }
    await this.eduPrintEstimateService.upload(file);
  }

  protected setEstimateColorMode(mode: EduPrintColorMode): void {
    void this.eduPrintEstimateService.reprice(mode);
  }

  protected async submit(): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');

    if (!this.hasAccountPhone()) {
      this.errorMessage.set(
        'Укажите телефон в личном кабинете, чтобы отправить документ.',
      );
      return;
    }

    if (this.isSubmissionLocked()) {
      this.errorMessage.set(this.submissionLockMessage());
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      this.errorMessage.set('Выберите фото документа.');
      return;
    }

    const formValue = this.form.getRawValue();
    const educationRole = formValue.educationRole;
    const institutionName = formValue.institutionName.trim();
    const documentExpiresAt = formValue.documentExpiresAt.trim() || null;

    this.submitting.set(true);
    try {
      const upload = await firstValueFrom(
        this.studentVerificationService.presign(file),
      );
      await firstValueFrom(
        this.studentVerificationService.uploadFile(upload, file),
      );
      const updatedStatus = await firstValueFrom(
        this.studentVerificationService.completeUpload({
          upload,
          file,
          educationRole,
          institutionName,
          documentExpiresAt,
        }),
      );
      this.status.set(updatedStatus);
      this.patchFormFromStatus(updatedStatus);
      this.selectedFile.set(null);
      this.successMessage.set(
        'Документ отправлен. Мы обновим статус в личном кабинете после проверки.',
      );
    } catch (error: unknown) {
      this.errorMessage.set(
        this.readErrorMessage(error, 'Не удалось отправить документ.'),
      );
    } finally {
      this.submitting.set(false);
    }
  }

  protected submitDisabled(): boolean {
    return (
      this.submitting() ||
      this.authService.isLoading() ||
      !this.hasAccountPhone() ||
      this.isSubmissionLocked() ||
      this.form.invalid ||
      !this.selectedFile()
    );
  }

  protected institutionNameInvalid(): boolean {
    const control = this.form.controls.institutionName;
    return control.invalid && control.touched;
  }

  protected institutionNameError(): string {
    const control = this.form.controls.institutionName;
    if (control.hasError('required')) {
      return 'Укажите образовательную организацию';
    }
    if (control.hasError('minlength')) {
      return 'Введите минимум 2 символа';
    }
    if (control.hasError('maxlength')) {
      return 'Не больше 200 символов';
    }
    return 'Проверьте название образовательной организации';
  }

  protected educationPlanPriceLabel(): string {
    const plan = this.educationPlan();
    const amount = this.readPlanAmount(plan?.base_price ?? 199);
    const suffix =
      plan?.billing_period === 'yearly'
        ? ' / год'
        : plan?.billing_period === 'quarterly'
          ? ' / квартал'
          : ' / мес';
    return `${this.formatMoney(amount)} ₽${suffix}`;
  }

  protected educationPlanDescription(): string {
    if (this.activeDiscount()) {
      return '70% на документы А4 и 50% на премиум-фотопечать уже закреплены в профиле.';
    }
    if (this.statusKind() !== 'approved') {
      return 'Подтвердите статус, чтобы оформить подписку с автопродлением.';
    }
    const plan = this.educationPlan();
    const amount = this.formatMoney(this.readPlanAmount(plan?.base_price ?? 199));
    const next = plan?.billing_period === 'yearly' ? 'раз в год' : 'раз в месяц';
    return `Спишем ${amount} ₽ сейчас, далее автопродление ${next}. Скидки: документы А4 −70%, премиум-фото −50%.`;
  }

  protected canPayEducationPlan(): boolean {
    return this.statusKind() === 'approved' && !this.activeDiscount();
  }

  protected payDisabled(): boolean {
    return (
      this.paying() || !this.canPayEducationPlan() || !this.educationPlan()
    );
  }

  protected educationPlanButtonLabel(): string {
    if (this.paying()) {
      return 'Открываем оплату';
    }
    if (!this.educationPlan()) {
      return 'Тариф загружается';
    }
    return `Оплатить ${this.educationPlanPriceLabel()}`;
  }

  protected educationAccountCardCta(): string {
    switch (this.statusKind()) {
      case 'rejected':
      case 'expired':
        return 'Обновить документ';
      case 'revoked':
        return 'Доступ отозван';
      default:
        return 'Отправить документ';
    }
  }

  protected documentSubmitButtonLabel(): string {
    const kind = this.statusKind();
    return kind === 'active' || kind === 'approved'
      ? 'Отправить новый документ'
      : 'Отправить документ';
  }

  /** Отменить образовательную подписку (рекуррент CloudPayments гасится на бэкенде). */
  protected cancelEducationSubscription(): void {
    if (this.cancelling()) {
      return;
    }
    const sub = this.educationSubscription();
    if (!sub) {
      return;
    }

    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: 'Отменить образовательную подписку?',
        message:
          'Автопродление 199 ₽/мес будет остановлено. <strong>Образовательные цены сохранятся до конца оплаченного периода.</strong>',
        confirmButtonText: 'Отменить подписку',
        cancelButtonText: 'Оставить',
        type: 'danger',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.cancelling.set(true);
      this.subscriptionService
        .cancelSubscription(sub.id, 'Отменено клиентом из образовательного кабинета')
        .subscribe({
          next: () => {
            this.cancelling.set(false);
            this.subscriptionService.loadMySubscription();
            this.snackBar.open(
              'Подписка отменена. Образовательные цены действуют до конца оплаченного периода.',
              'OK',
              { duration: 6000 },
            );
          },
          error: () => {
            this.cancelling.set(false);
            this.snackBar.open('Не удалось отменить подписку. Попробуйте снова.', 'OK', {
              duration: 4000,
            });
          },
        });
    });
  }

  /** Сменить карту образовательной подписки (1₽-верификация CloudPayments). */
  protected changeEducationCard(): void {
    if (this.changingCard()) {
      return;
    }
    const sub = this.educationSubscription();
    if (!sub) {
      return;
    }

    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '420px',
      data: {
        title: 'Сменить карту списания',
        message:
          'Привяжем новую карту: спишем и вернём <strong>1 ₽</strong> для проверки. ' +
          'Списания за подписку сейчас не будет, следующее регулярное списание пройдёт с новой карты в обычную дату.',
        confirmButtonText: 'Привязать карту',
        cancelButtonText: 'Отмена',
        type: 'info',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      void this.runEducationCardChange(sub.id);
    });
  }

  private async runEducationCardChange(subscriptionId: string): Promise<void> {
    this.changingCard.set(true);

    try {
      const init = await firstValueFrom(
        this.subscriptionService.changeCardInit(subscriptionId),
      );

      const payment = await this.cloudPaymentsService.verifyCardForChange({
        subscriptionId,
        externalId: init.externalId,
        amount: init.verifyAmount,
        planName: init.planName,
        email: init.email || undefined,
        phone: init.phone || undefined,
      });

      if (!payment.success) {
        if (payment.error && payment.error !== 'Проверка карты отменена') {
          this.snackBar.open(payment.error, 'OK', { duration: 5000 });
        }
        return;
      }

      // Поллинг confirm: бэкенд ждёт вебхук /pay (токен новой карты), создаёт
      // новый рекуррент и переключает подписку. Интервал ~3с, до ~40с.
      const MAX_ATTEMPTS = 13;
      const INTERVAL_MS = 3000;
      let finalStatus = 'pending_payment';

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const confirm = await firstValueFrom(
          this.subscriptionService.changeCardConfirm(subscriptionId, init.changeId),
        );
        finalStatus = confirm.status;

        if (confirm.status === 'card_changed' || confirm.status === 'already_changed') {
          this.snackBar.open('Карта успешно изменена.', 'OK', { duration: 5000 });
          this.subscriptionService.loadMySubscription();
          return;
        }
        if (confirm.status === 'failed') {
          break;
        }
        // pending_payment | processing, ждём вебхук/завершение и повторяем
        if (attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, INTERVAL_MS));
        }
      }

      if (finalStatus === 'failed') {
        this.snackBar.open('Не удалось сменить карту. Попробуйте снова.', 'OK', { duration: 5000 });
      } else {
        this.snackBar.open(
          'Карта проверяется. Обновите страницу через минуту, чтобы увидеть новую карту.',
          'OK',
          { duration: 6000 },
        );
        this.subscriptionService.loadMySubscription();
      }
    } catch {
      this.snackBar.open('Ошибка смены карты. Попробуйте снова.', 'OK', { duration: 4000 });
    } finally {
      this.changingCard.set(false);
    }
  }

  protected async payEducationPlan(): Promise<void> {
    if (this.paying()) {
      return;
    }

    const plan = this.educationPlan();
    if (!plan) {
      this.errorMessage.set('Тариф образовательного доступа пока недоступен.');
      return;
    }
    if (!this.canPayEducationPlan()) {
      this.errorMessage.set('Сначала подтвердите образовательный статус.');
      return;
    }

    this.errorMessage.set('');
    this.successMessage.set('');
    this.paying.set(true);

    try {
      const purchase = await firstValueFrom(
        this.subscriptionService.purchase(plan.id),
      );
      const payment = await this.cloudPaymentsService.subscribe({
        subscriptionId: purchase.subscription_id,
        planName: purchase.plan_name,
        amount: purchase.amount,
        billingPeriod: purchase.billing_period,
        email: purchase.email ?? undefined,
        phone: purchase.phone ?? undefined,
        trialDays: purchase.trial_period_days,
      });

      if (!payment.success) {
        throw new Error(payment.error || 'Оплата отменена.');
      }

      this.successMessage.set('Оплата прошла. Подтверждаем образовательный доступ.');
      const confirmation = await this.cloudPaymentsService.confirmSubscriptionPayment(
        purchase.subscription_id,
        payment.transactionId,
      );
      this.subscriptionService.loadMySubscription();
      await this.loadStatus();

      if (
        confirmation.status === 'confirmed' ||
        this.activeDiscount()
      ) {
        this.successMessage.set(
          'Образовательный доступ подключен. Цены применяются автоматически.',
        );
        return;
      }

      this.successMessage.set(
        'Оплата прошла. Подключение доступа ещё подтверждается, статус обновится в течение пары минут.',
      );
    } catch (error: unknown) {
      this.errorMessage.set(
        this.readErrorMessage(
          error,
          'Не удалось оформить образовательный доступ.',
        ),
      );
    } finally {
      this.paying.set(false);
    }
  }

  protected isSubmissionLocked(): boolean {
    const kind = this.statusKind();
    return kind === 'pending' || kind === 'revoked';
  }

  protected submissionLockMessage(): string {
    if (this.statusKind() === 'pending') {
      return 'Новый документ можно будет отправить после решения по текущей проверке.';
    }
    return 'Доступ приостановлен. Для повторного подключения напишите нам в чат.';
  }

  protected formatDate(value: string | null | undefined): string {
    if (!value) {
      return '';
    }

    const dateOnly = this.formatDateOnly(value);
    if (dateOnly) {
      return dateOnly;
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return value.slice(0, 10);
    }

    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private formatDateOnly(value: string): string | null {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(value);
    if (!dateOnly) return null;
    return `${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`;
  }

  private patchFormFromStatus(
    currentStatus: StudentVerificationStatusPayload,
  ): void {
    const institutionName =
      currentStatus.account?.institution_name ??
      currentStatus.latest_verification?.institution_name ??
      '';
    const expiresAt =
      currentStatus.account?.expires_at ??
      currentStatus.latest_verification?.document_expires_at ??
      '';
    const educationRole =
      currentStatus.account?.education_role ??
      currentStatus.latest_verification?.education_role ??
      'student';

    this.form.patchValue({
      educationRole,
      institutionName,
      documentExpiresAt: expiresAt ? expiresAt.slice(0, 10) : '',
    });
  }

  private readPlanAmount(value: number): number {
    return Number.isFinite(value) ? value : 199;
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('ru-RU', {
      maximumFractionDigits: 2,
    }).format(value);
  }

  private readErrorMessage(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null) {
      return fallback;
    }

    const responseError = Reflect.get(error, 'error');
    if (typeof responseError === 'string') {
      return responseError;
    }

    if (typeof responseError === 'object' && responseError !== null) {
      const nestedError = Reflect.get(responseError, 'error');
      if (typeof nestedError === 'string') {
        return nestedError;
      }

      const nestedMessage = Reflect.get(responseError, 'message');
      if (typeof nestedMessage === 'string') {
        return nestedMessage;
      }
    }

    const message = Reflect.get(error, 'message');
    return typeof message === 'string' ? message : fallback;
  }
}
