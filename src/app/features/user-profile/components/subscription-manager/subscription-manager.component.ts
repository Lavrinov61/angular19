import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe, SlicePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  SubscriptionService,
  type SubscriptionPlan,
  type SubscriptionPlanCoverageTier,
  type SubscriptionPlanItem,
  type SubscriptionPlanUsageFaq,
  type CreditHistoryEntry,
  type MySubscription,
} from '../../../../core/services/subscription.service';
import { CloudPaymentsService } from '../../../../core/services/cloud-payments.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  ProfileDashboardService,
  type CashbackCategoryKey,
  type CashbackState,
  type LoyaltyBenefitMonth,
  type LoyaltyBenefitSummary,
  type LoyaltyBenefitSummaryMode,
} from '../../../../core/services/profile-dashboard.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import {
  findActiveAccountAccessSubscription,
  findAccountAccessPlan,
  type AccountAccessKind,
  isAccountAccessPlan,
  isAccountAccessSubscription,
} from './account-access-plan.utils';

interface CategoryMeta {
  key: string;
  label: string;
  icon: string;
}

type AccountAccessStatusTone = 'ready' | 'review' | 'planned';

interface AccountAccessDetailItem {
  icon: string;
  title: string;
  text: string;
}

interface AccountAccessStep {
  text: string;
  cta?: string;
  route?: string;
}

interface AccountAccessFaq {
  question: string;
  answer: string;
}

interface AccountAccessOption {
  kind: AccountAccessKind;
  title: string;
  icon: string;
  payment: string;
  cardDescription: string;
  cardSubtitle: string;
  cardActionLabel: string;
  documentDiscount: string;
  photoDiscount: string;
  serviceDiscount?: string;
  documentPrice: string;
  photoPrice: string;
  note: string;
  useCases: readonly string[];
  route: string;
  cta: string;
  statusLabel: string;
  statusTone: AccountAccessStatusTone;
  detailBadge: string;
  detailTitle: string;
  detailDescription: string;
  detailIcon: string;
  detailActionLabel: string;
  detailCondition: string;
  detailFeatures: readonly AccountAccessDetailItem[];
  detailSteps: readonly AccountAccessStep[];
  detailFaq: readonly AccountAccessFaq[];
}

interface CashbackCategoryOption {
  key: CashbackCategoryKey;
  title: string;
  icon: string;
  colorClass: string;
  rate: string;
  description: string;
}

const PRINT_PACKAGE_TITLES_BY_SLUG: Record<string, string> = {
  'launch-photoprint-lite': '15 фото 10×15',
  'launch-photoprint-standard': '80 фото 10×15',
  'launch-photoprint-pro': '200 фото 10×15',
};

interface PrintPackageFeature {
  icon: string;
  title: string;
  text: string;
}

const FALLBACK_COVERAGE_TIERS: readonly SubscriptionPlanCoverageTier[] = [
  {
    min_percent: 0,
    max_percent: 15,
    credit_multiplier: 1,
    title: 'До 15%',
    description: 'Множитель заливки x1: ч/б лист списывает 1, цветной - 1.2 листа.',
  },
  {
    min_percent: 15.01,
    max_percent: 50,
    credit_multiplier: 2,
    title: '15-50%',
    description: 'Множитель заливки x2 применяется к базовому расходу листа.',
  },
  {
    min_percent: 50.01,
    max_percent: 75,
    credit_multiplier: 3,
    title: '50-75%',
    description: 'Множитель заливки x3 применяется к базовому расходу листа.',
  },
  {
    min_percent: 75.01,
    max_percent: 100,
    credit_multiplier: 4,
    title: '75-100%',
    description: 'Множитель заливки x4 применяется к базовому расходу листа.',
  },
];

const FALLBACK_DOC_PACKAGE_TERMS: readonly string[] = [
  'Пакет действует 1 месяц с момента оплаты.',
  'Номинальный объём указан для печати A4 при заливке страницы до 15%.',
  'Чёрно-белая A4 до 15% списывает x1, цветная A4 до 15% списывает x1.2.',
  'Если заливка выше 15%, списание идёт по множителю: до 50% - x2, до 75% - x3, до 100% - x4.',
  'Для цветной A4 итоговый расход считается как x1.2 × множитель заливки.',
  'Неиспользованный остаток после окончания месяца не переносится.',
];

const FALLBACK_DOC_PACKAGE_STEPS: readonly string[] = [
  'Купите пакет печати на 1 месяц.',
  'Загрузите документ или передайте файл сотруднику студии.',
  'Система считает заливку каждой страницы.',
  'До 15% ч/б списывается x1, цвет списывается x1.2; при большей заливке цветность умножается на множитель заливки.',
];

const FALLBACK_DOC_PACKAGE_FAQ: readonly SubscriptionPlanUsageFaq[] = [
  {
    question: 'Почему пакет может закончиться раньше?',
    answer: 'Объём пакета считается для чёрно-белой A4 при заливке до 15%. Цветная A4 списывается x1.2, а плотные страницы дополнительно умножаются по шкале заливки.',
  },
  {
    question: 'Как считается заливка?',
    answer: 'По проценту заполнения страницы: обычный текст обычно до 15%, плотные изображения и фон повышают процент.',
  },
  {
    question: 'Что будет после месяца?',
    answer: 'Остаток пакета прекращает действовать. Можно купить новый пакет печати.',
  },
];

const FALLBACK_PHOTO_PACKAGE_TERMS: readonly string[] = [
  'Пакет действует 1 месяц с момента оплаты.',
  'Объём указан для фотопечати 10×15.',
  'Одно фото 10×15 списывает 1 фото из пакета.',
  'Правило заливки применяется к документам A4, фотопечать списывается по количеству фотографий.',
  'Неиспользованный остаток после окончания месяца не переносится.',
];

const FALLBACK_PHOTO_PACKAGE_STEPS: readonly string[] = [
  'Купите пакет фотопечати на 1 месяц.',
  'Загрузите фотографии или оформите заказ в студии.',
  'Каждое фото 10×15 списывает 1 фото из пакета.',
  'После окончания месяца остаток пакета прекращает действовать.',
];

const FALLBACK_PHOTO_PACKAGE_FAQ: readonly SubscriptionPlanUsageFaq[] = [
  {
    question: 'Заливка влияет на фотопечать?',
    answer: 'Нет. Заливка применяется к печати документов A4, фотопечать списывается по количеству фотографий.',
  },
  {
    question: 'Что если нужен другой формат?',
    answer: 'Этот пакет рассчитан на фото 10×15. Другие форматы оформляются по действующему прайсу.',
  },
  {
    question: 'Что будет после месяца?',
    answer: 'Остаток пакета прекращает действовать. Можно купить новый пакет фотопечати.',
  },
];

const ACCOUNT_ACCESS_OPTIONS: readonly AccountAccessOption[] = [
  {
    kind: 'personal',
    title: 'Личная',
    icon: 'person',
    payment: 'A4 −20%, фото −10%',
    cardDescription: 'Своё Фото, подписка для одного пользователя',
    cardSubtitle: 'Для себя',
    cardActionLabel: 'Подключить личный доступ',
    documentDiscount: 'Документы −20%',
    photoDiscount: 'Фото −10%',
    serviceDiscount: 'Скидка аккаунта',
    documentPrice: 'A4 −20%',
    photoPrice: '10×15 −10%',
    note: 'Для личных заказов, файлов и домашней печати.',
    useCases: [],
    route: '/user-profile/account/edit',
    cta: 'Подключить',
    statusLabel: 'Доступно сейчас',
    statusTone: 'ready',
    detailBadge: 'ЛИЧНАЯ',
    detailTitle: 'Личная подписка',
    detailDescription: 'Постоянная скидка для домашних документов, фото и разовых заказов без подтверждения статуса.',
    detailIcon: 'person',
    detailActionLabel: 'Подключить личный доступ',
    detailCondition: 'Подключается сразу. Проверка статуса не нужна, отключение доступно в личном кабинете.',
    detailFeatures: [
      {
        icon: 'verified_user',
        title: 'Без проверки',
        text: 'Доступ можно подключить сразу из личного кабинета.',
      },
      {
        icon: 'local_offer',
        title: 'Постоянная скидка',
        text: 'Документы дешевле на 20%, фото дешевле на 10%.',
      },
      {
        icon: 'photo_library',
        title: 'Для личных заказов',
        text: 'Домашние файлы, копии, анкеты и семейные фотографии.',
      },
      {
        icon: 'inventory_2',
        title: 'Пакеты отдельно',
        text: 'Если нужен большой объём, подключите пакет печати отдельно.',
      },
    ],
    detailSteps: [
      {
        text: 'Подключите личный доступ',
        cta: 'Подключить личный доступ',
      },
      { text: 'Печатайте документы и фото по сниженной цене' },
      { text: 'Добавляйте пакеты печати отдельно, когда нужен большой объём' },
      { text: 'Отключайте доступ в личном кабинете при необходимости' },
    ],
    detailFaq: [
      {
        question: 'Нужно подтверждать личный доступ?',
        answer: 'Нет. Личная подписка доступна всем пользователям сразу.',
      },
      {
        question: 'Можно ли совмещать с пакетами печати?',
        answer: 'Да. Доступ задаёт постоянную цену, а пакеты печати подключаются отдельно под объём.',
      },
      {
        question: 'Для каких заказов подходит?',
        answer: 'Для домашних документов, личных файлов, копий, анкет и фотопечати.',
      },
    ],
  },
  {
    kind: 'education',
    title: 'Образовательная',
    icon: 'school',
    payment: '199 ₽/мес',
    cardDescription: 'Своё Фото, подписка для студентов и преподавателей',
    cardSubtitle: 'Для учёбы',
    cardActionLabel: 'Подтвердить за 199 ₽/мес',
    documentDiscount: 'Документы −70%',
    photoDiscount: 'Премиум-фото −50%',
    documentPrice: 'A4 10 ₽ → 3 ₽',
    photoPrice: '10x15 20 ₽ → 10 ₽',
    note: 'После проверки статуса студента, преподавателя или организации.',
    useCases: [],
    route: '/user-profile/education',
    cta: 'Подтвердить статус',
    statusLabel: 'Нужно подтверждение',
    statusTone: 'review',
    detailBadge: 'НУЖНО ПОДТВЕРЖДЕНИЕ',
    detailTitle: 'Образовательная подписка',
    detailDescription: 'Для студентов, преподавателей и образовательных организаций после проверки статуса.',
    detailIcon: 'school',
    detailActionLabel: 'Подтвердить за 199 ₽/мес',
    detailCondition: 'Цена включается только после проверки студента, преподавателя или образовательной организации.',
    detailFeatures: [
      {
        icon: 'school',
        title: 'Учебная цена',
        text: 'Документы дешевле на 70%, премиум-фото дешевле на 50%.',
      },
      {
        icon: 'badge',
        title: 'Проверка статуса',
        text: 'Подтверждаем студента, преподавателя или организацию.',
      },
      {
        icon: 'event_available',
        title: 'Ежемесячный доступ',
        text: '199 ₽ в месяц после успешной проверки.',
      },
      {
        icon: 'groups',
        title: 'Для учебных задач',
        text: 'Материалы, анкеты, методички, фото и документы для групп.',
      },
    ],
    detailSteps: [
      {
        text: 'Отправьте заявку на проверку статуса',
        cta: 'Подтвердить статус',
        route: '/user-profile/education',
      },
      { text: 'Мы проверим документ, учебный статус или данные организации' },
      { text: 'После подтверждения включим образовательную цену' },
      { text: 'Печатайте учебные материалы и фото по сниженной цене' },
    ],
    detailFaq: [
      {
        question: 'Кому доступна образовательная подписка?',
        answer: 'Студентам, преподавателям, школам, вузам, курсам и образовательным организациям после проверки.',
      },
      {
        question: 'Сколько занимает подтверждение?',
        answer: 'Заявка уходит на ручную проверку. Если данных недостаточно, менеджер уточнит детали.',
      },
      {
        question: 'Что будет после проверки?',
        answer: 'При успешном подтверждении в аккаунте появятся образовательные цены на документы и фото.',
      },
    ],
  },
  {
    kind: 'business',
    title: 'Бизнес',
    icon: 'business_center',
    payment: 'B2B-счёт',
    cardDescription: 'Своё Фото, бизнес-аккаунт для юрлиц, ИП и команд',
    cardSubtitle: 'Организация, сотрудники, счета',
    cardActionLabel: 'Открыть бизнес-аккаунт',
    documentDiscount: 'Документы −40%',
    photoDiscount: 'Фото −15%',
    serviceDiscount: 'Скидка на съёмки и индивидуальный выезд по B2B-условиям',
    documentPrice: 'A4 −40%',
    photoPrice: '10×15 −15%',
    note: 'Отдельный B2B-контур для корпоративных фото-задач, печати, счетов и сотрудников.',
    useCases: [
      'фото сотрудников для пропусков',
      'медкнижки, анкеты и личные дела',
      'регулярная печать рабочих документов',
      'фотосъёмки команды и выездные съёмки',
    ],
    route: '/business',
    cta: 'Открыть бизнес-аккаунт',
    statusLabel: 'B2B-контур',
    statusTone: 'review',
    detailBadge: 'B2B-АККАУНТ',
    detailTitle: 'Бизнес-аккаунт',
    detailDescription: 'Отдельный корпоративный аккаунт для юрлиц и ИП: организация, сотрудники, фото-задачи, счета, закрывающие документы и B2B-условия.',
    detailIcon: 'business_center',
    detailActionLabel: 'Открыть B2B-возможности',
    detailCondition: 'Подключение идёт через организацию: реквизиты, подтверждение через СберБизнес ID, банк или ручную проверку, оплата по счёту на расчётный счёт.',
    detailFeatures: [
      {
        icon: 'domain',
        title: 'Отдельная организация',
        text: 'ИНН, реквизиты, контакты бухгалтерии, сотрудники, отделы и корпоративные задачи не смешиваются с личным аккаунтом.',
      },
      {
        icon: 'verified_user',
        title: 'Банковский Business ID',
        text: 'Подтверждение через СберБизнес ID, Alfa ID, T-Business ID или ручную проверку компании.',
      },
      {
        icon: 'account_balance',
        title: 'Счёт и расчётный счёт',
        text: 'Оплата по счёту, сверка банковских операций, ledger и закрывающие документы для бухгалтерии.',
      },
      {
        icon: 'groups',
        title: 'Сотрудники и задачи',
        text: 'Пропуска, анкеты, личные дела, корпоративные базы, регулярная печать и выездные съёмки.',
      },
    ],
    detailSteps: [
      {
        text: 'Откройте страницу бизнес-аккаунта',
        cta: 'Посмотреть B2B-контур',
        route: '/business',
      },
      { text: 'Заполните ИНН, реквизиты и контакты бухгалтерии' },
      { text: 'Подтвердите компанию через СберБизнес ID, банк или ручную проверку' },
      { text: 'Работайте со счетами, участниками, реестром печати и B2B-условиями' },
    ],
    detailFaq: [
      {
        question: 'Почему это не личная подписка?',
        answer: 'Бизнес-аккаунт не является розничной подпиской. У компании есть организация, реквизиты, сотрудники, счета, лимиты и закрывающие документы.',
      },
      {
        question: 'Как подтверждается компания?',
        answer: 'Через СберБизнес ID, другой банковский Business ID, первый платёж, ЭДО, проверку реквизитов или ручную проверку менеджером.',
      },
      {
        question: 'Как проходит оплата?',
        answer: 'Базовый сценарий, счёт на оплату и безналичный перевод на расчётный счёт. Платёж сверяется с банковской операцией.',
      },
      {
        question: 'Какие возможности входят?',
        answer: 'Сотрудники, корпоративные фото-задачи, регулярная печать, счета, реестр услуг, закрывающие документы, съёмки и индивидуальные выезды по B2B-условиям.',
      },
    ],
  },
];

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

/** Normalize phone to 7XXXXXXXXXX (11 digits) */
function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('8') && digits.length === 11) digits = '7' + digits.slice(1);
  if (digits.length === 10) digits = '7' + digits;
  return digits;
}

function formatCashbackMonth(periodMonth: string | null): string {
  const date = periodMonth ? new Date(`${periodMonth}T00:00:00`) : new Date();
  return new Intl.DateTimeFormat('ru-RU', { month: 'long' }).format(date);
}

function getCashbackLockedMessage(monthName: string): string {
  return `Категория выбрана на ${monthName}. Новую можно выбрать в следующем месяце.`;
}

function getCashbackSelectionErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse && error.status === 409) {
    return 'Категория уже выбрана на этот месяц. Изменить её можно в следующем месяце.';
  }
  return 'Не удалось выбрать категорию кэшбэка';
}

const CATEGORIES: CategoryMeta[] = [
  { key: 'doc-print', label: 'Печать A4', icon: 'print' },
  { key: 'photo-print', label: 'Фотопечать', icon: 'photo_library' },
];

const DEFAULT_CASHBACK_CATEGORY: CashbackCategoryOption = {
  key: 'documents',
  title: 'Печать документов',
  icon: 'print',
  colorClass: 'documents',
  rate: '10%',
  description: 'A4, копии, сканы и рабочие файлы',
};

const CASHBACK_CATEGORY_OPTIONS: readonly CashbackCategoryOption[] = [
  DEFAULT_CASHBACK_CATEGORY,
  {
    key: 'photos',
    title: 'Фотографии',
    icon: 'photo_library',
    colorClass: 'photos',
    rate: '10%',
    description: 'Фотопечать и семейные подборки',
  },
  {
    key: 'id-photo',
    title: 'Фото на документы',
    icon: 'badge',
    colorClass: 'id-photo',
    rate: '10%',
    description: 'Паспорт, визы, анкеты и пропуска',
  },
  {
    key: 'restoration',
    title: 'Реставрация',
    icon: 'auto_fix_high',
    colorClass: 'restoration',
    rate: '10%',
    description: 'Восстановление старых снимков',
  },
  {
    key: 'photoshoot',
    title: 'Выездная фотосъёмка',
    icon: 'photo_camera',
    colorClass: 'photoshoot',
    rate: '10%',
    description: 'Съёмка вне студии и корпоративные задачи',
  },
  {
    key: 'albums',
    title: 'Фотоальбомы',
    icon: 'photo_album',
    colorClass: 'albums',
    rate: '10%',
    description: 'Альбомы, фотокниги и подарочные подборки',
  },
];

@Component({
  selector: 'app-subscription-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closeOverlayPanels()',
  },
  imports: [
    DecimalPipe,
    SlicePipe,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    RouterLink,
  ],
  template: `
    <div class="sub-manager">

      @if (subscriptionService.loading()) {
        <div class="loading-center">
          <mat-spinner diameter="40" />
        </div>
      } @else if (hasActivePrintPackage()) {

        <!-- ========================= SUBSCRIBER DASHBOARD ========================= -->
        @if (subscriptionService.currentSubscription(); as sub) {
          <div class="subscriber-view">
            @let accountAccessSub = isAccountAccessSubscription(sub);

            <!-- Hero plan card -->
            <div class="hero-card">
              <div class="hero-bg"></div>
              <div class="hero-content">
                <div class="hero-top">
                  <div class="hero-left">
                    <div class="hero-badge">
                      <mat-icon>{{ accountAccessSub ? 'verified_user' : 'inventory_2' }}</mat-icon>
                      {{ accountAccessSub ? 'Доступ аккаунта' : 'Пакет печати' }}
                    </div>
                    <h2 class="hero-plan-name">{{ activePrintPackageTitle(sub) }}</h2>
                    <div class="hero-price">
                      <span class="hero-price-amount">{{ sub.monthly_price | number:'1.0-0' }} ₽</span>
                      <span class="hero-price-period">пакет на 1 месяц</span>
                    </div>
                  </div>
                  <div class="hero-right">
                    <mat-icon class="hero-crown">workspace_premium</mat-icon>
                    <span class="status-badge" [class]="'status-' + sub.status">
                      {{ statusLabel(sub.status) }}
                    </span>
                  </div>
                </div>

                <div class="hero-discount">
                  <mat-icon>local_offer</mat-icon>
                  @if (sub.subscriber_discount_percent > 0) {
                    <span>
                      Скидка пакета
                      <strong class="amber">{{ sub.subscriber_discount_percent }}%</strong>
                      на выбранный объём печати
                    </span>
                  } @else {
                    <span>
                      <strong class="amber">Доступ аккаунта активен.</strong>
                      Пакеты печати подключаются отдельно под конкретный объём.
                    </span>
                  }
                </div>

                @if (periodSavings() > 0) {
                  <div class="hero-savings">
                    <mat-icon>savings</mat-icon>
                    Сэкономлено за период: <strong class="amber">{{ periodSavings() | number:'1.0-0' }} &#x20BD;</strong>
                  </div>
                }
              </div>
            </div>

            <!-- Credits -->
            @if (subscriptionService.credits().length > 0) {
              <mat-card class="credits-card" appearance="outlined">
                <mat-card-content>
                  <div class="section-title">
                    <mat-icon>token</mat-icon>
                    <h3>Остатки старой модели</h3>
                    <mat-icon class="hint-icon" matTooltip="Показываем только остатки по старой кредитной модели. Новые пакеты дают скидку на фактический объём.">help_outline</mat-icon>
                    <span class="total-remaining">Всего: {{ subscriptionService.totalRemainingCredits() }}</span>
                  </div>

                  @for (credit of subscriptionService.credits(); track credit.product_name) {
                    <div class="credit-item">
                      <div class="credit-header">
                        <span class="credit-name">{{ credit.product_name }}</span>
                        <span class="credit-counts">{{ credit.remaining }} / {{ credit.total_credits }}</span>
                      </div>
                      <mat-progress-bar
                        mode="determinate"
                        [value]="credit.total_credits > 0 ? (credit.remaining / credit.total_credits) * 100 : 0"
                        class="credit-bar"
                      />
                      <div class="credit-footer">
                        <span class="credit-used">Использовано: {{ credit.used_credits }}</span>
                        <span class="credit-expires">До {{ credit.expires_at | slice:0:10 }}</span>
                      </div>
                    </div>
                  }
                </mat-card-content>
              </mat-card>
            }

            <!-- Credit Usage History -->
            <mat-card class="history-card" appearance="outlined">
              <mat-card-content>
                <div class="section-title">
                  <mat-icon>history</mat-icon>
                  <h3>История старых списаний</h3>
                </div>
                @if (creditHistory().length > 0) {
                  <div class="history-list">
                    @for (entry of creditHistory(); track entry.id) {
                      <div class="history-entry">
                        <div class="history-date">{{ entry.created_at | slice:0:10 }}</div>
                        <div class="history-details">
                          <span class="history-product">{{ entry.product_name }}</span>
                          <span class="history-qty">&times; {{ entry.quantity }}</span>
                        </div>
                        <div class="history-credits">&minus;{{ entry.credits_consumed }}</div>
                      </div>
                    }
                  </div>
                  @if (hasMoreHistory()) {
                    <button mat-stroked-button class="load-more-btn" (click)="loadMoreHistory()">
                      Показать ещё
                    </button>
                  }
                } @else {
                  <div class="history-empty">Списаний пока нет</div>
                }
              </mat-card-content>
            </mat-card>

            <!-- Period & payment -->
            <mat-card class="period-card" appearance="outlined">
              <mat-card-content>
                <div class="section-title">
                  <mat-icon>event_note</mat-icon>
                  <h3>Период и платёж</h3>
                </div>
                <div class="period-rows">
                  <div class="period-row">
                    <span class="period-label">Текущий период</span>
                    <span class="period-value">{{ sub.current_period_start | slice:0:10 }}, {{ sub.current_period_end | slice:0:10 }}</span>
                  </div>
                  @if (sub.next_payment_date) {
                    <div class="period-row">
                      <span class="period-label">Следующее списание</span>
                      <span class="period-value amber">{{ sub.next_payment_date | slice:0:10 }}</span>
                    </div>
                  }
                  @if (sub.card_last_four) {
                    <div class="period-row">
                      <span class="period-label">Карта</span>
                      <span class="period-value">•••• {{ sub.card_last_four }}</span>
                    </div>
                  }
                </div>
              </mat-card-content>
            </mat-card>

            <!-- Management -->
            <mat-card class="mgmt-card" appearance="outlined">
              <mat-card-content>
                <div class="section-title">
                  <mat-icon>settings</mat-icon>
                  <h3>Управление</h3>
                </div>
                <div class="mgmt-actions">
                  @if (sub.status === 'active') {
                    <button mat-stroked-button class="mgmt-btn"
                      [disabled]="actionLoading()"
                      (click)="changeCard()">
                      @if (changingCard()) {
                        <mat-icon class="spin">sync</mat-icon>
                      } @else {
                        <mat-icon>credit_card</mat-icon>
                      }
                      Сменить карту
                    </button>
                    <button mat-stroked-button class="mgmt-btn"
                      [disabled]="actionLoading()"
                      (click)="pauseSubscription()">
                      @if (actionLoading()) {
                        <mat-icon class="spin">sync</mat-icon>
                      } @else {
                        <mat-icon>pause_circle</mat-icon>
                      }
                      Приостановить
                    </button>
                    <button mat-stroked-button class="mgmt-btn cancel-btn"
                      [disabled]="actionLoading()"
                      (click)="cancelSubscription()">
                      <mat-icon>cancel</mat-icon>
                      Отменить
                    </button>
                  }
                  @if (sub.status === 'paused') {
                    <button mat-flat-button class="mgmt-btn resume-btn"
                      [disabled]="actionLoading()"
                      (click)="resumeSubscription()">
                      @if (actionLoading()) {
                        <mat-icon class="spin">sync</mat-icon>
                      } @else {
                        <mat-icon>play_circle</mat-icon>
                      }
                      Возобновить
                    </button>
                  }
                </div>
              </mat-card-content>
            </mat-card>

          </div>
        }

      } @else {

        <!-- ========================= NON-SUBSCRIBER VIEW ========================= -->
        <div class="non-subscriber-view">

          <section class="benefits-hero" aria-labelledby="benefits-hub-title">
            <h1 id="benefits-hub-title">Выгодно</h1>

            <div class="benefits-hero__grid">
              <article class="benefits-wallet" aria-label="Бонусный баланс">
                <div class="benefits-wallet__balance">
                  <strong>{{ pointsBalance() | number:'1.0-0' }}</strong>
                  <span>СФ</span>
                </div>
                <p>1 бонус = 1 ₽. Можно оплатить услуги или собрать скидку на следующий заказ.</p>

                <div class="benefits-wallet__actions">
                  <a class="benefits-primary-action" routerLink="/services">Потратить бонусы</a>
                  <a class="benefits-neutral-action" routerLink="/user-profile/loyalty">История</a>
                </div>

                <a class="benefits-level-row" routerLink="/user-profile/loyalty">
                  <span class="benefits-level-row__icon">
                    <mat-icon>workspace_premium</mat-icon>
                  </span>
                  <span>
                    <strong>Уровень и возможности</strong>
                    <small>{{ levelName() }} · {{ levelHint() }}</small>
                  </span>
                  <mat-icon>chevron_right</mat-icon>
                </a>
              </article>

              <article class="benefits-panel benefits-panel--cashback">
                @let cashbackCategory = selectedCashbackCategory();
                <div class="benefits-panel__head">
                  <strong>Кэшбэк</strong>
                  <button type="button" class="benefits-panel__link"
                    [disabled]="cashbackCategoryLocked()"
                    (click)="openCashbackCategoryPicker()">
                    {{ cashbackCategoryLocked() ? 'Выбрана' : 'Выбрать' }}
                  </button>
                </div>
                <span class="benefits-panel__period">Категория на {{ cashbackMonthName() }}</span>
                <button type="button" class="benefits-cashback-choice"
                  [class.benefits-cashback-choice--locked]="cashbackCategoryLocked()"
                  [disabled]="cashbackCategoryLocked()"
                  (click)="openCashbackCategoryPicker()">
                  <span class="benefits-cashback-choice__icon" [attr.data-tone]="cashbackCategory.colorClass">
                    <mat-icon>{{ cashbackCategory.icon }}</mat-icon>
                  </span>
                  <span class="benefits-cashback-choice__text">
                    <strong>{{ hasSelectedCashbackCategory() ? cashbackCategory.rate + ' ' + cashbackCategory.title : 'Выберите категорию' }}</strong>
                    <small>{{ hasSelectedCashbackCategory() ? cashbackCategory.description : '10% бонусами после заказа в выбранном разделе' }}</small>
                  </span>
                  <mat-icon>{{ cashbackCategoryLocked() ? 'lock' : 'chevron_right' }}</mat-icon>
                </button>
                <p>{{ cashbackSelectionError() || cashbackSelectionHint() }}</p>
              </article>

              <article class="benefits-panel benefits-panel--chart benefits-panel--interactive"
                role="button"
                tabindex="0"
                aria-haspopup="dialog"
                (click)="openBenefitSummaryDrawer()"
                (keydown.enter)="openBenefitSummaryDrawer()"
                (keydown.space)="openBenefitSummaryDrawer(); $event.preventDefault()">
                <div class="benefits-panel__head">
                  <strong>Полученная выгода</strong>
                  <button type="button" class="benefits-panel__link" (click)="openBenefitSummaryDrawer($event)">
                    Подробнее
                  </button>
                </div>
                <span class="benefits-panel__period">Доступно сейчас</span>
                <div class="benefits-chart">
                  <strong>{{ benefitCardCurrentRubles() | number:'1.0-0' }} ₽</strong>
                  <div class="benefits-chart__bars" aria-hidden="true">
                    @if (benefitSummary(); as summary) {
                      @for (month of summary.months; track month.periodMonth; let last = $last) {
                        <span [class.is-active]="last" [style.height.px]="benefitCardBarHeight(month)"></span>
                      }
                    } @else {
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span></span>
                      <span class="is-active"></span>
                    }
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section class="benefits-quick-grid" aria-label="Быстрые предложения">
            <a class="benefits-quick-card benefits-quick-card--soft" href="#print-packages">
              <span>
                <strong>Пакеты печати</strong>
                <small>Отдельная скидка на регулярный объём</small>
              </span>
              <mat-icon>inventory_2</mat-icon>
            </a>
            <a class="benefits-quick-card" routerLink="/user-profile/loyalty">
              <span>
                <strong>Бонусы за заказы</strong>
                <small>Списывайте баллы как рубли</small>
              </span>
              <mat-icon>paid</mat-icon>
            </a>
            <a class="benefits-quick-card" routerLink="/user-profile/education">
              <span>
                <strong>Статус для скидки</strong>
                <small>Студентам, преподавателям и организациям</small>
              </span>
              <mat-icon>school</mat-icon>
            </a>
          </section>

          <nav class="benefits-tabs" aria-label="Разделы предложений">
            <a class="benefits-tab benefits-tab--active" routerLink="/user-profile/subscription">Все предложения</a>
            <a class="benefits-tab" routerLink="/user-profile/loyalty">Бонусы</a>
          </nav>

          <div class="benefits-filters" aria-label="Фильтры предложений">
            <button type="button" class="benefits-filter benefits-filter--icon" aria-label="Настройки фильтров">
              <mat-icon>tune</mat-icon>
            </button>
            <a class="benefits-filter" href="#popular-benefits-title">Потратить бонусы</a>
            <a class="benefits-filter" routerLink="/user-profile/loyalty">Получить бонусы</a>
            <a class="benefits-filter" href="#account-offers-title">Получить скидки</a>
          </div>

          <section class="benefits-section" aria-labelledby="popular-benefits-title">
            <div class="benefits-section__head">
              <h2 id="popular-benefits-title">Популярное</h2>
              <a routerLink="/services">Показать ещё</a>
            </div>

            <div class="benefit-product-grid">
              <article class="benefit-product-card benefit-product-card--yellow">
                <span class="benefit-product-card__logo"><mat-icon>print</mat-icon></span>
                <p>Печать документов, списывайте бонусы за A4 и копии</p>
                <span class="benefit-product-card__divider"></span>
                <strong>Кэшбэк</strong>
                <small>до 50% бонусами</small>
                <a routerLink="/pechat-dokumentov">Получить</a>
              </article>
              <article class="benefit-product-card benefit-product-card--blue">
                <span class="benefit-product-card__logo"><mat-icon>photo_library</mat-icon></span>
                <p>Фотопечать, выгоднее на регулярных семейных заказах</p>
                <span class="benefit-product-card__divider"></span>
                <strong>Скидка</strong>
                <small>до 30% по статусу</small>
                <a routerLink="/pechat-foto">Получить</a>
              </article>
              <article class="benefit-product-card benefit-product-card--red">
                <span class="benefit-product-card__logo"><mat-icon>school</mat-icon></span>
                <p>Образовательный доступ, для студентов и преподавателей</p>
                <span class="benefit-product-card__divider"></span>
                <strong>Бесплатно</strong>
                <small>проверка статуса</small>
                <a routerLink="/user-profile/education">Получить</a>
              </article>
            </div>
          </section>

          <section class="benefits-section" id="print-packages" aria-labelledby="print-offers-title">
            <div class="benefits-section__head">
              <h2 id="print-offers-title">Пакеты печати за рубли</h2>
              <div class="cat-tabs cat-tabs--benefits">
                @for (cat of categories; track cat.key; let i = $index) {
                  <button class="cat-tab" [class.cat-tab--active]="activeTab() === i"
                    (click)="activeTab.set(i)">
                    <mat-icon>{{ cat.icon }}</mat-icon>
                    {{ cat.label }} <span class="cat-count">({{ planCountByCategory(cat.key) }})</span>
                  </button>
                }
              </div>
            </div>

            @if (plansLoading()) {
              <div class="loading-center"><mat-spinner diameter="32" /></div>
            } @else if (filteredPlans().length > 0) {
              <div class="hub-print-grid">
                @for (plan of filteredPlans(); track plan.id; let i = $index) {
                  <article class="hub-print-card" [class.hub-print-card--featured]="plan.is_popular">
                    @if (plan.is_popular) {
                      <span class="hub-print-card__badge">Осталось 1</span>
                    }

                    @let retail = retailPrice(plan);

                    <span class="hub-print-card__logo"><mat-icon>{{ activeTab() === 0 ? 'print' : 'photo_library' }}</mat-icon></span>
                    <p>{{ packageCaption(plan) }}</p>
                    <span class="hub-print-card__divider"></span>
                    <strong>{{ packageQuantity(plan) }}</strong>
                    <small class="hub-print-card__term">действует 1 месяц</small>

                    <div class="hub-print-card__price">
                      @if (retail > plan.base_price) {
                        <span>{{ retail | number:'1.0-0' }} ₽</span>
                      }
                      <b>{{ plan.base_price | number:'1.0-0' }} ₽</b>
                      <small>разовая покупка</small>
                      @if (retail > plan.base_price) {
                        <em>-{{ savingsPercent(plan) }}%</em>
                      }
                    </div>

                    <button type="button" class="hub-print-card__cta"
                      [class.hub-print-card__cta--primary]="plan.is_popular"
                      [disabled]="purchasing()"
                      (click)="openPrintPackage(plan)">
                      @if (purchasing() && purchasingPlanId() === plan.id) {
                        <mat-icon class="spin">sync</mat-icon>
                      }
                      Купить за {{ plan.base_price | number:'1.0-0' }} ₽
                    </button>
                  </article>
                }
              </div>
            } @else {
              <div class="plans-empty">
                <mat-icon>{{ plansError() ? 'error_outline' : 'print_disabled' }}</mat-icon>
                <div class="plans-empty__text">
                  <strong>{{ plansError() || 'Пакеты печати не найдены' }}</strong>
                  <span>Проверьте миграцию пакетов и повторите загрузку.</span>
                </div>
                <button type="button" class="plans-empty__retry" (click)="loadPlans()">
                  Обновить
                </button>
              </div>
            }
          </section>

          <section class="benefits-donate" aria-label="Пожертвовать бонусы">
            <div>
              <h2>Поддержать добрые дела</h2>
              <p>Бонусы можно оставить на социальные фотопроекты и печать для школ.</p>
              <button type="button" class="benefits-neutral-action">Пожертвовать от 1 СФ</button>
            </div>
            <span class="benefits-donate__visual" aria-hidden="true">
              <mat-icon>volunteer_activism</mat-icon>
            </span>
          </section>

          <section class="benefits-section" aria-labelledby="account-offers-title">
            <div class="benefits-section__head">
              <div class="benefits-section__title">
                <h2 id="account-offers-title">Доступы и бизнес-аккаунт</h2>
                <span class="benefits-section__badge">3 ФОРМАТА</span>
                <span class="benefits-section__info" aria-label="Доступно 3 формата аккаунта">i</span>
              </div>
              <a routerLink="/user-profile/account/edit">Настроить профиль</a>
            </div>

            <div class="hub-account-grid">
              @for (option of accountAccessOptions; track option.title) {
                @let accessActive = isAccessOptionActive(option);
                <button type="button" class="hub-offer-card access-offer-card"
                  [class.access-offer-card--active]="accessActive"
                  [class.access-offer-card--ready]="option.statusTone === 'ready'"
                  [class.access-offer-card--review]="option.statusTone === 'review'"
                  [class.access-offer-card--planned]="option.statusTone === 'planned'"
                  (click)="openAccessOption(option)">
                  <span class="hub-offer-card__icon"><mat-icon>{{ option.icon }}</mat-icon></span>
                  <span class="access-offer-card__status">{{ accessOptionStatusLabel(option) }}</span>
                  <p>{{ option.cardDescription }}</p>
                  <span class="hub-offer-card__divider"></span>
                  <strong>{{ option.title }}</strong>
                  <small>{{ option.cardSubtitle }}</small>
                  <span class="hub-offer-card__action" [class.hub-offer-card__action--active]="accessActive">
                    @if (accessActive) {
                      <mat-icon>check_circle</mat-icon>
                    }
                    {{ accessOptionCardActionLabel(option) }}
                  </span>
                </button>
              }
            </div>
          </section>

          <section class="benefits-section" aria-labelledby="bonus-offers-title">
            <div class="benefits-section__head">
              <div class="benefits-section__title">
                <h2 id="bonus-offers-title">Наши предложения за бонусы</h2>
                <span class="benefits-section__badge">ОСТАЛОСЬ 1</span>
                <span class="benefits-section__info" aria-label="Доступно 1 наше предложение">i</span>
              </div>
              <a routerLink="/services">Показать ещё</a>
            </div>

            <div class="benefit-product-grid">
              <article class="benefit-product-card benefit-product-card--green">
                <span class="benefit-product-card__logo"><mat-icon>bolt</mat-icon></span>
                <p>Срочная печать, оплатите приоритетную подготовку бонусами</p>
                <span class="benefit-product-card__divider"></span>
                <strong>Бонусы</strong>
                <small>от 1 СФ</small>
                <a routerLink="/services">Получить</a>
              </article>
              <article class="benefit-product-card benefit-product-card--violet">
                <span class="benefit-product-card__logo"><mat-icon>collections</mat-icon></span>
                <p>Фотоархив, скидка на регулярную печать семейных подборок</p>
                <span class="benefit-product-card__divider"></span>
                <strong>Скидка</strong>
                <small>до 15%</small>
                <a routerLink="/pechat-foto">Получить</a>
              </article>
              <article class="benefit-product-card benefit-product-card--cyan">
                <span class="benefit-product-card__logo"><mat-icon>redeem</mat-icon></span>
                <p>Подарочный сертификат, печать фото и документов для близких</p>
                <span class="benefit-product-card__divider"></span>
                <strong>Сертификат</strong>
                <small>на услуги печати</small>
                <a routerLink="/services">Получить</a>
              </article>
            </div>
          </section>

          <!-- Phone prompt for purchase (shown when user has no phone) -->
          @if (showPhonePrompt()) {
            <mat-card class="phone-prompt-card" appearance="outlined">
              <mat-card-content>
                <div class="phone-prompt-header">
                  <mat-icon>phone</mat-icon>
                  <div>
                    <strong>Укажите телефон</strong>
                    <p>Для оформления доступа или пакета нужен номер, по нему вас найдут в студии</p>
                  </div>
                </div>
                <div class="phone-prompt-form">
                  <mat-form-field appearance="outline" class="phone-prompt-input">
                    <mat-label>Телефон</mat-label>
                    <input matInput [value]="maskedPurchasePhone()" type="tel" inputmode="numeric"
                           (input)="onPurchasePhoneInput($event)" (keydown)="onPurchasePhoneKeydown($event)">
                    <span matPrefix class="phone-prefix">+7&nbsp;</span>
                  </mat-form-field>
                  <div class="phone-prompt-actions">
                    <button mat-button (click)="showPhonePrompt.set(false); pendingPurchasePlan.set(null)">Отмена</button>
                    <button mat-flat-button class="phone-prompt-btn"
                      [disabled]="purchasePhoneDigits().length < 10 || purchasing()"
                      (click)="confirmPurchaseWithPhone()">
                      @if (purchasing()) {
                        <mat-icon class="spin">sync</mat-icon>
                      }
                      {{ pendingPurchaseActionLabel() }}
                    </button>
                  </div>
                </div>
              </mat-card-content>
            </mat-card>
          }

          <details class="benefits-service-tools">
            <summary>
              <span>Промокод или уже купленный пакет</span>
              <mat-icon>expand_more</mat-icon>
            </summary>

            <div class="benefits-service-tools__grid">
              <div class="promo-input-section">
                <label for="sm-promo-code">Есть промокод?</label>
                <div class="promo-input-row">
                  <input id="sm-promo-code" type="text" placeholder="SVV-XXXXX" [value]="promoCode()"
                    (input)="promoCode.set($any($event.target).value.toUpperCase())" maxlength="20" class="promo-input">
                  <button class="promo-apply-btn" (click)="validatePromo()" [disabled]="promoLoading() || !promoCode()">
                    @if (promoLoading()) {
                      <mat-icon class="spin">sync</mat-icon>
                    } @else {
                      Применить
                    }
                  </button>
                </div>
                @if (promoError()) {
                  <span class="promo-msg promo-msg--error">{{ promoError() }}</span>
                }
                @if (promoTrialDays() > 0) {
                  <span class="promo-msg promo-msg--success">
                    <mat-icon>card_giftcard</mat-icon>
                    Бесплатно {{ promoTrialDays() }} дней при оформлении любого пакета
                  </span>
                }
              </div>

              <mat-card class="link-card" appearance="outlined">
                <mat-card-content>
                  <div class="link-header">
                    <mat-icon>link</mat-icon>
                    <div>
                      <strong>Уже есть пакет печати?</strong>
                      <p>Привяжите к аккаунту по номеру телефона, указанному при оформлении</p>
                    </div>
                  </div>
                  <div class="link-form">
                    <mat-form-field appearance="outline" class="link-input">
                      <mat-label>Телефон оформления</mat-label>
                      <input matInput [value]="maskedLinkPhone()" type="tel" inputmode="numeric"
                             (input)="onLinkPhoneInput($event)" (keydown)="onLinkPhoneKeydown($event)">
                      <span matPrefix class="phone-prefix">+7&nbsp;</span>
                    </mat-form-field>
                    <button mat-flat-button class="link-btn"
                      [disabled]="linking() || linkPhoneDigits().length < 10"
                      (click)="linkSubscription()">
                      @if (linking()) {
                        <mat-icon class="spin">sync</mat-icon>
                      }
                      Привязать
                    </button>
                  </div>
                </mat-card-content>
              </mat-card>
            </div>

            <div class="trust-strip">
              <span class="trust-item"><mat-icon>event_available</mat-icon> Действует 1 месяц</span>
              <span class="trust-sep">·</span>
              <span class="trust-item"><mat-icon>local_offer</mat-icon> Пакетная цена</span>
              <span class="trust-sep">·</span>
              <span class="trust-item"><mat-icon>storefront</mat-icon> 2 точки в Ростове</span>
            </div>
          </details>

          @if (showFaq()) {
            <section class="hub-faq" aria-label="Как работают скидки">
              <div class="hub-faq__item">
                <strong>Бонусы</strong>
                <p>Начисляются за заказы и активность. Их можно списывать как рубли на доступные услуги.</p>
              </div>
              <div class="hub-faq__item">
                <strong>Доступ аккаунта</strong>
                <p>Даёт постоянную цену для личной, бизнес или образовательной печати после проверки статуса.</p>
              </div>
              <div class="hub-faq__item">
                <strong>Пакет печати</strong>
                <p>Покупается отдельно на 1 месяц под конкретный объём документов или фотографий.</p>
              </div>
            </section>
          }

          @if (selectedPrintPackagePlan(); as plan) {
            <div class="benefits-modal-backdrop" (click)="closePrintPackage()">
              <section class="benefits-modal benefits-modal--print" role="dialog" aria-modal="true" aria-labelledby="print-package-detail-title"
                (click)="$event.stopPropagation()">
                <button type="button" class="benefits-modal__close" aria-label="Закрыть" (click)="closePrintPackage()">
                  <mat-icon>close</mat-icon>
                </button>

                <div class="benefits-modal__hero" [class.benefits-modal__hero--photo]="isPhotoPrintPlan(plan)">
                  <div class="benefits-modal__copy">
                    <span class="benefits-modal__badge">ПАКЕТ НА 1 МЕСЯЦ</span>
                    <h2 id="print-package-detail-title">{{ packageQuantity(plan) }}</h2>
                    <p>{{ printPackageHeroText(plan) }}</p>
                    <div class="benefits-modal__actions">
                      <button type="button" class="benefits-modal__primary"
                        [disabled]="purchasing()"
                        (click)="continuePrintPackagePurchase(plan)">
                        @if (purchasing() && purchasingPlanId() === plan.id) {
                          <mat-icon class="spin">sync</mat-icon>
                        }
                        Купить за {{ plan.base_price | number:'1.0-0' }} ₽
                      </button>
                    </div>
                  </div>

                  <div class="benefits-modal__logo" aria-hidden="true">
                    <mat-icon>{{ isPhotoPrintPlan(plan) ? 'photo_library' : 'print' }}</mat-icon>
                  </div>
                </div>

                <div class="benefits-modal__features">
                  @for (feature of printPackageFeatures(plan); track feature.title) {
                    <article>
                      <span><mat-icon>{{ feature.icon }}</mat-icon></span>
                      <strong>{{ feature.title }}</strong>
                      <p>{{ feature.text }}</p>
                    </article>
                  }
                </div>

                <section class="benefits-modal__details" aria-labelledby="print-package-terms-title">
                  <h3 id="print-package-terms-title">Условия использования</h3>
                  <div class="benefits-modal__detail-grid">
                    <article>
                      <span>Объём</span>
                      <strong>{{ packageQuantity(plan) }}</strong>
                      <p>{{ printPackageBaseRule(plan) }}</p>
                    </article>
                    <article>
                      <span>Срок</span>
                      <strong>1 месяц</strong>
                      <p>Пакет действует с момента оплаты и не продлевается автоматически.</p>
                    </article>
                    <article>
                      <span>Оплата</span>
                      <strong>{{ plan.base_price | number:'1.0-0' }} ₽</strong>
                      <p>Разовая покупка пакета печати.</p>
                    </article>
                    <article class="benefits-modal__detail-card--wide">
                      <span>Важно</span>
                      <strong>{{ printPackageMultiplierRule(plan) }}</strong>
                      <ul>
                        @for (term of printPackageTerms(plan); track term) {
                          <li>{{ term }}</li>
                        }
                      </ul>
                    </article>
                  </div>

                  @if (hasCoveragePolicy(plan)) {
                    <div class="print-coverage-scale" aria-label="Множители списания по заливке">
                      @for (tier of coverageTiers(plan); track tier.title) {
                        <article class="print-coverage-tier">
                          <span>{{ tier.title }}</span>
                          <strong>x{{ tier.credit_multiplier }}</strong>
                          <p>{{ tier.description }}</p>
                        </article>
                      }
                    </div>
                    <p class="print-coverage-note">
                      Заливка считается на каждую страницу. Если в файле часть страниц лёгкая, а часть плотная, списание считается постранично.
                    </p>
                  }
                </section>

                <section class="benefits-modal__how" aria-labelledby="print-package-how-title">
                  <h3 id="print-package-how-title">Как это работает</h3>
                  <div class="benefits-modal__steps">
                    @for (step of printPackageSteps(plan); track step; let i = $index) {
                      <div class="benefits-modal__step">
                        <span>{{ i + 1 }}</span>
                        <p>{{ step }}</p>
                      </div>
                    }
                  </div>
                </section>

                <section class="benefits-modal__faq" aria-labelledby="print-package-faq-title">
                  <h3 id="print-package-faq-title">Частые вопросы</h3>
                  @for (item of printPackageFaq(plan); track item.question) {
                    <details>
                      <summary>
                        <span>{{ item.question }}</span>
                        <mat-icon>expand_more</mat-icon>
                      </summary>
                      <p>{{ item.answer }}</p>
                    </details>
                  }
                </section>
              </section>
            </div>
          }

          @if (selectedAccessOption(); as access) {
            @let accessActive = isAccessOptionActive(access);
            <div class="benefits-modal-backdrop" (click)="closeAccessOption()">
              <section class="benefits-modal" role="dialog" aria-modal="true" aria-labelledby="access-detail-title"
                (click)="$event.stopPropagation()">
                <button type="button" class="benefits-modal__close" aria-label="Закрыть" (click)="closeAccessOption()">
                  <mat-icon>close</mat-icon>
                </button>

                <div class="benefits-modal__hero"
                  [class.benefits-modal__hero--education]="access.kind === 'education'"
                  [class.benefits-modal__hero--business]="access.kind === 'business'">
                  <div class="benefits-modal__copy">
                    <span class="benefits-modal__badge">{{ accessDetailBadge(access) }}</span>
                    <h2 id="access-detail-title">{{ access.detailTitle }}</h2>
                    <p>{{ access.detailDescription }}</p>
                    <div class="benefits-modal__actions">
                      @if (accessActive) {
                        <a class="benefits-modal__primary benefits-modal__primary--active" [routerLink]="access.route" (click)="closeAccessOption()">
                          <mat-icon>check_circle</mat-icon>
                          {{ accessDetailActionLabel(access) }}
                        </a>
                      } @else if (access.kind === 'personal') {
                        <button type="button" class="benefits-modal__primary"
                          [disabled]="purchasing() || plansLoading()"
                          (click)="continueAccountAccessPurchase()">
                          @if (purchasing()) {
                            <mat-icon class="spin">sync</mat-icon>
                          }
                          {{ access.detailActionLabel }}
                        </button>
                      } @else {
                        <a class="benefits-modal__primary" [routerLink]="access.route" (click)="closeAccessOption()">
                          {{ access.detailActionLabel }}
                        </a>
                      }
                      <button type="button" class="benefits-modal__favorite"
                        [class.benefits-modal__favorite--active]="isAccessFavorite(access.kind)"
                        [attr.aria-label]="isAccessFavorite(access.kind) ? 'Убрать из избранного' : 'Добавить в избранное'"
                        (click)="toggleAccessFavorite(access, $event)">
                        <mat-icon>{{ isAccessFavorite(access.kind) ? 'favorite' : 'favorite_border' }}</mat-icon>
                      </button>
                    </div>
                  </div>

                  <div class="benefits-modal__logo" aria-hidden="true">
                    <mat-icon>{{ access.detailIcon }}</mat-icon>
                  </div>
                </div>

                <div class="benefits-modal__features">
                  @for (feature of access.detailFeatures; track feature.title) {
                    <article>
                      <span><mat-icon>{{ feature.icon }}</mat-icon></span>
                      <strong>{{ feature.title }}</strong>
                      <p>{{ feature.text }}</p>
                    </article>
                  }
                </div>

                <section class="benefits-modal__details" aria-labelledby="access-benefits-title">
                  <h3 id="access-benefits-title">
                    {{ access.kind === 'business' ? 'Возможности бизнес-аккаунта' : 'Преимущества подписки' }}
                  </h3>
                  <div class="benefits-modal__detail-grid">
                    <article>
                      <span>Документы</span>
                      <strong>{{ access.documentPrice }}</strong>
                      <p>{{ access.documentDiscount }} на A4, копии и рабочие файлы.</p>
                    </article>
                    <article>
                      <span>Фото</span>
                      <strong>{{ access.photoPrice }}</strong>
                      <p>{{ access.photoDiscount }} на базовую фотопечать и регулярные подборки.</p>
                    </article>
                    <article>
                      <span>Условия</span>
                      <strong>{{ access.payment }}</strong>
                      <p>{{ accessDetailCondition(access) }}</p>
                    </article>
                    <article class="benefits-modal__detail-card--wide">
                      <span>Что входит</span>
                      <strong>{{ access.serviceDiscount || 'Постоянная цена аккаунта' }}</strong>
                      @if (access.useCases.length) {
                        <ul>
                          @for (useCase of access.useCases; track useCase) {
                            <li>{{ useCase }}</li>
                          }
                        </ul>
                      } @else {
                        <p>Скидки применяются к документам и фото. Пакеты печати можно подключать отдельно под объём.</p>
                      }
                    </article>
                  </div>
                </section>

                <section class="benefits-modal__how" aria-labelledby="access-how-title">
                  <h3 id="access-how-title">Как это работает</h3>
                  <div class="benefits-modal__steps">
                    @for (step of access.detailSteps; track step.text; let i = $index) {
                      <div class="benefits-modal__step">
                        <span>{{ i + 1 }}</span>
                        <p>{{ step.text }}</p>
                        @if (step.cta && step.route) {
                          <a [routerLink]="step.route" (click)="closeAccessOption()">{{ step.cta }}</a>
                        }
                      </div>
                    }
                  </div>
                </section>

                <section class="benefits-modal__faq" aria-labelledby="access-faq-title">
                  <h3 id="access-faq-title">Частые вопросы</h3>
                  @for (item of access.detailFaq; track item.question) {
                    <details>
                      <summary>
                        <span>{{ item.question }}</span>
                        <mat-icon>expand_more</mat-icon>
                      </summary>
                      <p>{{ item.answer }}</p>
                    </details>
                  }
                </section>
              </section>
            </div>
          }

          @if (cashbackCategoryPickerOpen()) {
            <div class="cashback-drawer-backdrop" (click)="closeCashbackCategoryPicker()">
              <aside class="cashback-drawer" role="dialog" aria-modal="true" aria-labelledby="cashback-categories-title"
                (click)="$event.stopPropagation()">
                <button type="button" class="cashback-drawer__close" aria-label="Закрыть" (click)="closeCashbackCategoryPicker()">
                  <mat-icon>close</mat-icon>
                </button>

                <h2 id="cashback-categories-title">Категории кэшбэка на {{ cashbackMonthName() }}</h2>
                <p>Выберите одну категорию. После выбора она будет закреплена до конца месяца.</p>
                @if (cashbackSelectionError()) {
                  <p class="cashback-drawer__error">{{ cashbackSelectionError() }}</p>
                }

                <div class="cashback-category-list">
                  @for (category of cashbackCategoryOptions; track category.key) {
                    <button type="button" class="cashback-category-option"
                      [class.cashback-category-option--selected]="selectedCashbackCategoryKey() === category.key"
                      [class.cashback-category-option--locked]="cashbackCategoryLocked()"
                      [disabled]="cashbackSelectionSaving() || cashbackCategoryLocked()"
                      (click)="selectCashbackCategory(category)">
                      <span class="cashback-category-option__icon" [attr.data-tone]="category.colorClass">
                        <mat-icon>{{ category.icon }}</mat-icon>
                      </span>
                      <span class="cashback-category-option__text">
                        <strong>{{ category.rate }} {{ category.title }}</strong>
                        <small>{{ category.description }}</small>
                      </span>
                      @if (selectedCashbackCategoryKey() === category.key) {
                        <mat-icon class="cashback-category-option__state">check_circle</mat-icon>
                      } @else {
                        <mat-icon class="cashback-category-option__state">info</mat-icon>
                      }
                    </button>
                  }
                </div>
              </aside>
            </div>
          }

          @if (benefitSummaryDrawerOpen()) {
            <div class="cashback-drawer-backdrop benefit-summary-drawer-backdrop" (click)="closeBenefitSummaryDrawer()">
              <aside class="benefit-summary-drawer" role="dialog" aria-modal="true" aria-labelledby="benefit-summary-title"
                (click)="$event.stopPropagation()">
                <button type="button" class="cashback-drawer__close" aria-label="Закрыть" (click)="closeBenefitSummaryDrawer()">
                  <mat-icon>close</mat-icon>
                </button>

                <h2 id="benefit-summary-title">Полученная выгода</h2>

                <div class="benefit-summary-segment" role="tablist" aria-label="Тип выгоды">
                  <button type="button" role="tab"
                    [attr.aria-selected]="benefitSummaryMode() === 'earned'"
                    [class.is-active]="benefitSummaryMode() === 'earned'"
                    (click)="setBenefitSummaryMode('earned')">
                    Заработано
                  </button>
                  <button type="button" role="tab"
                    [attr.aria-selected]="benefitSummaryMode() === 'spent'"
                    [class.is-active]="benefitSummaryMode() === 'spent'"
                    (click)="setBenefitSummaryMode('spent')">
                    Потрачено
                  </button>
                </div>

                @if (benefitSummaryLoading()) {
                  <div class="benefit-summary-state">
                    <mat-spinner diameter="32"></mat-spinner>
                    <span>Загружаем выгоду</span>
                  </div>
                } @else if (benefitSummaryError()) {
                  <div class="benefit-summary-state benefit-summary-state--error">
                    <mat-icon>error_outline</mat-icon>
                    <span>{{ benefitSummaryError() }}</span>
                    <button type="button" class="benefit-summary-history" (click)="loadBenefitSummary(true)">
                      Повторить
                    </button>
                  </div>
                } @else if (benefitSummary(); as summary) {
                  <div class="benefit-summary-total">
                    <span>За {{ summary.currentMonth.label }}</span>
                    <strong>{{ benefitSummaryCurrentTotal() | number:'1.0-0' }} ₽</strong>
                  </div>

                  <div class="benefit-summary-breakdown">
                    @for (item of benefitSummaryBreakdown(); track item.key) {
                      <div class="benefit-summary-row">
                        <span class="benefit-summary-row__dot" [style.background]="item.color"></span>
                        <span>{{ item.label }}</span>
                        <strong>{{ item.amount | number:'1.0-0' }} ₽</strong>
                      </div>
                    }
                  </div>

                  <div class="benefit-summary-chart" aria-label="Выгода по месяцам">
                    @for (month of summary.months; track month.periodMonth; let last = $last) {
                      <div class="benefit-summary-chart__item">
                        <span>{{ benefitMonthValue(month) | number:'1.0-0' }}</span>
                        <i [class.is-active]="last" [style.height.px]="benefitSummaryBarHeight(month)"></i>
                        <small>{{ month.label }}</small>
                      </div>
                    }
                  </div>

                  <a class="benefit-summary-history" routerLink="/user-profile/loyalty" (click)="closeBenefitSummaryDrawer()">
                    Посмотреть историю
                  </a>
                } @else {
                  <div class="benefit-summary-state">
                    <mat-icon>receipt_long</mat-icon>
                    <span>Истории выгоды пока нет</span>
                  </div>
                }
              </aside>
            </div>
          }

        </div>
      }

    </div>
  `,
  styles: [`
    :host {
      display: block;
      --amber: #ef3124;
      --amber-dim: rgba(239,49,36,0.12);
      --surface-card: #ffffff;
      --border: #dfe3e8;
      --text: #20242a;
      --text-primary: #20242a;
      --text-muted: #6f7782;
      --accent: #ef3124;
    }

    .sub-manager {
      color: var(--text);
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 28px 48px;
    }

    .loading-center {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 48px;
    }

    /* ── SUBSCRIBER DASHBOARD ── */
    .subscriber-view {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Hero card */
    .hero-card {
      position: relative;
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(245,158,11,0.35);
    }

    .hero-bg {
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, #fff7e8 0%, #ffffff 58%, #f2f4f7 100%);

      &::after {
        content: '';
        position: absolute;
        top: -40%;
        right: -20%;
        width: 60%;
        height: 120%;
        background: radial-gradient(ellipse, rgba(245,158,11,0.14) 0%, transparent 70%);
        pointer-events: none;
      }
    }

    .hero-content {
      position: relative;
      padding: 20px;
    }

    .hero-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }

    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: var(--amber-dim);
      color: var(--amber);
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0;
      margin-bottom: 10px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .hero-plan-name {
      margin: 0 0 8px;
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--text);
      line-height: 1.1;
    }

    .hero-price {
      display: flex;
      align-items: baseline;
      gap: 2px;
    }

    .hero-price-amount {
      font-size: 2.2rem;
      font-weight: 900;
      color: var(--amber);
    }

    .hero-price-period { color: var(--text-muted); font-size: 0.9rem; }

    .hero-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
    }

    .hero-crown {
      font-size: 56px;
      width: 56px;
      height: 56px;
      color: rgba(245,158,11,0.2);
    }

    .status-badge {
      padding: 3px 12px;
      border-radius: 20px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .status-active { background: rgba(34,197,94,0.2); color: #22c55e; }
    .status-paused { background: rgba(245,158,11,0.2); color: var(--amber); }
    .status-cancelled { background: rgba(239,68,68,0.2); color: #ef4444; }

    .hero-discount {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--text-muted);
      padding-top: 14px;
      border-top: 1px solid rgba(245,158,11,0.15);

      mat-icon { font-size: 18px; color: var(--amber); }
    }

    .hero-savings {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-top: 8px;

      mat-icon { font-size: 18px; color: var(--amber); }
    }

    .amber { color: var(--amber); }

    /* Credits */
    .credits-card, .period-card, .mgmt-card {
      background: var(--surface-card) !important;
      border: 1px solid var(--border) !important;
      border-radius: 16px !important;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08) !important;
    }

    .credits-card {
      border-color: rgba(245,158,11,0.2) !important;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;

      mat-icon { color: var(--amber); }
      h3 { margin: 0; font-size: 1rem; font-weight: 600; }
    }

    .hint-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: help;
      vertical-align: middle;
    }

    .total-remaining {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--amber);
      background: var(--amber-dim);
      padding: 2px 10px;
      border-radius: 12px;
    }

    .section-hint {
      margin-left: auto;
      font-size: 0.78rem;
      color: var(--text-muted);
    }

    .credit-item {
      margin-bottom: 16px;
      &:last-child { margin-bottom: 0; }
    }

    .credit-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .credit-name { font-size: 0.9rem; color: var(--text); }
    .credit-counts { font-size: 0.9rem; color: var(--amber); font-weight: 600; }

    .credit-bar {
      ::ng-deep .mdc-linear-progress__bar-inner { border-color: var(--amber); }
      ::ng-deep .mdc-linear-progress__buffer-bar { background-color: rgba(245,158,11,0.1); }
      ::ng-deep .mdc-linear-progress__bar-inner {
        background: linear-gradient(90deg, #f59e0b, #fbbf24);
        border-radius: 4px;
      }
    }

    .credit-footer {
      display: flex;
      justify-content: space-between;
      margin-top: 4px;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    /* History */
    .history-card {
      background: var(--surface-card) !important;
      border: 1px solid var(--border) !important;
      border-radius: 16px !important;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08) !important;
    }

    .history-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .history-entry {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 0;
      border-bottom: 1px solid #edf0f3;
      font-size: 0.85rem;

      &:last-child { border-bottom: none; }
    }

    .history-date {
      color: var(--text-muted);
      font-size: 0.78rem;
      min-width: 72px;
      flex-shrink: 0;
    }

    .history-details {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .history-product {
      color: var(--text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .history-qty {
      color: var(--text-muted);
      font-size: 0.78rem;
      flex-shrink: 0;
    }

    .history-credits {
      color: var(--amber);
      font-weight: 700;
      font-size: 0.9rem;
      flex-shrink: 0;
    }

    .history-empty {
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
      padding: 16px 0;
    }

    .load-more-btn {
      display: block;
      margin: 12px auto 0;
      font-size: 0.82rem;
      border-color: var(--border) !important;
      color: var(--text-muted) !important;

      &:hover {
        border-color: var(--amber) !important;
        color: var(--amber) !important;
      }
    }

    /* Period */
    .period-rows { display: flex; flex-direction: column; gap: 8px; }

    .period-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.875rem;
    }

    .period-label { color: var(--text-muted); }
    .period-value { color: var(--text); font-weight: 500; }

    /* Management */
    .mgmt-actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .mgmt-btn {
      font-size: 0.875rem;
      mat-icon { font-size: 18px; margin-right: 4px; }
    }

    .resume-btn {
      background: var(--amber) !important;
      color: #111 !important;
      font-weight: 700;
    }

    .cancel-btn {
      border-color: rgba(239,68,68,0.4) !important;
      color: #ef4444 !important;

      &:hover {
        border-color: #ef4444 !important;
        background: rgba(239,68,68,0.08) !important;
      }
    }

    .spin { animation: spin 1s linear infinite; }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* ── NON-SUBSCRIBER VIEW ── */
    .non-subscriber-view {
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .hub-hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 280px;
      gap: 18px;
      align-items: stretch;
      padding: 28px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 16px 38px rgba(31, 41, 55, 0.07);
    }

    .hub-hero__copy {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }

    .hub-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      min-height: 24px;
      margin-bottom: 14px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #f1f5f9;
      color: #475569;
      font-size: 0.76rem;
      font-weight: 800;
      text-transform: uppercase;

      mat-icon {
        width: 16px;
        height: 16px;
        font-size: 16px;
        color: var(--amber);
      }
    }

    .hub-hero h1 {
      margin: 0;
      color: var(--text);
      font-size: 3rem;
      line-height: 1.04;
      font-weight: 900;
      letter-spacing: 0;
    }

    .hub-hero p {
      max-width: 720px;
      margin: 14px 0 0;
      color: var(--text-muted);
      font-size: 0.98rem;
      line-height: 1.55;
    }

    .hub-hero__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 22px;
    }

    .hub-primary-action,
    .hub-secondary-action,
    .hub-offer-card__action,
    .hub-print-card__cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 44px;
      border-radius: 8px;
      font: inherit;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
      transition:
        background-color 0.16s ease,
        border-color 0.16s ease,
        color 0.16s ease,
        box-shadow 0.16s ease;

      mat-icon {
        width: 19px;
        height: 19px;
        font-size: 19px;
      }
    }

    .hub-primary-action {
      padding: 0 18px;
      border: 1px solid var(--amber);
      background: var(--amber);
      color: #111827;
      box-shadow: 0 10px 22px rgba(245, 158, 11, 0.24);
    }

    .hub-primary-action:hover,
    .hub-primary-action:focus-visible {
      background: #e59006;
      border-color: #e59006;
      outline: none;
    }

    .hub-secondary-action {
      padding: 0 16px;
      border: 1px solid var(--border);
      background: #ffffff;
      color: var(--text);
    }

    .hub-secondary-action:hover,
    .hub-secondary-action:focus-visible {
      border-color: #cbd5e1;
      background: #f8fafc;
      outline: none;
    }

    .hub-balance-card {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
      min-width: 0;
      padding: 20px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #f8fafc;

      span {
        color: var(--text-muted);
        font-size: 0.84rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      strong {
        color: var(--text);
        font-size: 2.35rem;
        line-height: 1;
        font-weight: 900;
      }

      small {
        color: var(--text-muted);
        font-size: 0.82rem;
      }

      a {
        width: fit-content;
        color: #2563eb;
        font-size: 0.86rem;
        font-weight: 800;
        text-decoration: none;
      }

      a:hover,
      a:focus-visible {
        text-decoration: underline;
        outline: none;
      }
    }

    .hub-summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .hub-summary-card {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr);
      column-gap: 12px;
      row-gap: 2px;
      align-items: center;
      min-width: 0;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 10px 24px rgba(31, 41, 55, 0.05);

      mat-icon {
        grid-row: 1 / 4;
        display: grid;
        width: 42px;
        height: 42px;
        place-items: center;
        border-radius: 8px;
        background: #111827;
        color: var(--amber);
        font-size: 22px;
      }

      span {
        color: var(--text-muted);
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      strong {
        overflow: hidden;
        color: var(--text);
        font-size: 1rem;
        font-weight: 900;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      small {
        overflow: hidden;
        color: var(--text-muted);
        font-size: 0.8rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .hub-offers-section {
      padding: 20px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.06);
    }

    .hub-section-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      margin-bottom: 18px;

      span {
        display: block;
        margin-bottom: 5px;
        color: var(--text-muted);
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      h2 {
        margin: 0;
        color: var(--text);
        font-size: 1.34rem;
        line-height: 1.2;
        font-weight: 900;
      }

      > a {
        color: #2563eb;
        font-size: 0.86rem;
        font-weight: 800;
        text-decoration: none;
        white-space: nowrap;
      }

      > a:hover,
      > a:focus-visible {
        text-decoration: underline;
        outline: none;
      }
    }

    .hub-account-grid,
    .hub-print-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .hub-offer-card,
    .hub-print-card {
      position: relative;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 100%;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #f8fafc;
    }

    .hub-offer-card__top {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;

      strong {
        display: block;
        overflow: hidden;
        color: var(--text);
        font-size: 1rem;
        font-weight: 900;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      small {
        color: var(--text-muted);
        font-size: 0.8rem;
      }
    }

    .hub-offer-card__icon {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border-radius: 8px;
      background: #111827;
      color: var(--amber);
      flex: 0 0 auto;

      mat-icon {
        width: 22px;
        height: 22px;
        font-size: 22px;
      }
    }

    .hub-offer-card__discounts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 14px;

      span {
        min-height: 24px;
        padding: 4px 8px;
        border-radius: 999px;
        background: #fff7ed;
        color: #9a5b00;
        font-size: 0.74rem;
        font-weight: 900;
      }
    }

    .hub-offer-card__prices {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-top: 12px;

      span {
        min-width: 0;
        padding: 10px;
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        background: #ffffff;
      }

      small {
        display: block;
        margin-bottom: 3px;
        color: var(--text-muted);
        font-size: 0.72rem;
      }

      b {
        display: block;
        overflow: hidden;
        color: var(--text);
        font-size: 0.88rem;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }

    .hub-offer-card p {
      min-height: 42px;
      margin: 14px 0 18px;
      color: var(--text-muted);
      font-size: 0.82rem;
      line-height: 1.45;
    }

    .hub-offer-card__action {
      margin-top: auto;
      padding: 0 14px;
      border: 1px solid rgba(245, 158, 11, 0.45);
      background: #ffffff;
      color: var(--text);
    }

    .hub-offer-card__action:hover,
    .hub-offer-card__action:focus-visible {
      border-color: var(--amber);
      background: #fff7ed;
      outline: none;
    }

    .cat-tabs--hub {
      justify-content: flex-end;
      max-width: 520px;
    }

    .hub-print-card {
      background: #ffffff;
    }

    .hub-print-card--featured {
      border-color: var(--amber);
      box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.2);
    }

    .hub-print-card__badge {
      position: absolute;
      top: -10px;
      left: 16px;
      min-height: 20px;
      padding: 2px 10px;
      border-radius: 999px;
      background: var(--amber);
      color: #111827;
      font-size: 0.7rem;
      font-weight: 900;
    }

    .hub-print-card__head {
      display: grid;
      gap: 3px;

      span {
        color: var(--text-muted);
        font-size: 0.76rem;
        font-weight: 900;
        text-transform: uppercase;
      }

      strong {
        color: var(--text);
        font-size: 1.1rem;
        font-weight: 900;
      }

      small {
        color: var(--text-muted);
        font-size: 0.82rem;
        line-height: 1.35;
      }
    }

    .hub-print-card__price {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 6px;
      margin: 16px 0 12px;

      span {
        color: var(--text-muted);
        font-size: 0.9rem;
        text-decoration: line-through;
      }

      strong {
        color: var(--amber);
        font-size: 1.85rem;
        line-height: 1;
        font-weight: 900;
      }

      small {
        color: var(--text-muted);
        font-size: 0.84rem;
      }

      em {
        min-height: 22px;
        padding: 2px 8px;
        border-radius: 999px;
        background: #dcfce7;
        color: #15803d;
        font-size: 0.72rem;
        font-style: normal;
        font-weight: 900;
      }
    }

    .hub-print-card ul {
      display: grid;
      gap: 7px;
      min-height: 58px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;

      li {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        color: var(--text-muted);
        font-size: 0.82rem;
        line-height: 1.35;
      }

      mat-icon {
        width: 16px;
        height: 16px;
        margin-top: 1px;
        color: var(--amber);
        font-size: 16px;
        flex: 0 0 auto;
      }
    }

    .hub-print-card__cta {
      width: 100%;
      margin-top: auto;
      padding: 0 14px;
      border: 1px solid var(--border);
      background: #f8fafc;
      color: var(--text);
    }

    .hub-print-card__cta--primary {
      border-color: var(--amber);
      background: var(--amber);
      color: #111827;
    }

    .hub-print-card__cta:hover:not(:disabled),
    .hub-print-card__cta:focus-visible:not(:disabled) {
      border-color: var(--amber);
      outline: none;
    }

    .hub-print-card__cta:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .hub-faq {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 10px 24px rgba(31, 41, 55, 0.05);
    }

    .hub-faq__item {
      min-width: 0;
      padding: 14px;
      border-radius: 8px;
      background: #f8fafc;

      strong {
        display: block;
        margin-bottom: 6px;
        color: var(--text);
        font-size: 0.92rem;
        font-weight: 900;
      }

      p {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.84rem;
        line-height: 1.45;
      }
    }

    /* Promo */
    .promo-header {
      text-align: left;
      padding: 36px 40px;
      background: linear-gradient(135deg, #fff7e8 0%, #ffffff 58%, #f2f4f7 100%);
      border-radius: 24px;
      border: 1px solid var(--border);
      box-shadow: 0 14px 36px rgba(31, 41, 55, 0.08);
    }

    .promo-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--amber-dim);
      color: var(--amber);
      padding: 4px 14px;
      border-radius: 20px;
      font-size: 0.78rem;
      font-weight: 700;
      margin-bottom: 12px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .promo-title {
      margin: 0 0 8px;
      font-size: 1.5rem;
      font-weight: 800;
    }

    .promo-sub {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.875rem;
    }

    /* Account access */
    .account-access-panel {
      padding: 22px;
      border: 1px solid rgba(245,158,11,0.3);
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.07);
    }

    .account-access-head {
      margin-bottom: 16px;

      h3 {
        margin: 6px 0 6px;
        font-size: 1.15rem;
        line-height: 1.2;
        font-weight: 800;
      }

      p {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.86rem;
        line-height: 1.5;
      }
    }

    .account-access-eyebrow {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 3px 10px;
      border-radius: 999px;
      background: rgba(245,158,11,0.12);
      color: var(--amber);
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .account-access-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }

    .account-access-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 14px;
      background: #f8fafc;

      p {
        margin: 0;
        color: var(--text-muted);
        font-size: 0.8rem;
        line-height: 1.45;
        min-height: 34px;
      }
    }

    .account-access-card__top {
      display: flex;
      align-items: center;
      gap: 10px;

      h4 {
        margin: 0 0 2px;
        font-size: 0.98rem;
        font-weight: 800;
      }

      > div > span {
        color: var(--text-muted);
        font-size: 0.78rem;
      }
    }

    .account-access-card__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: #111827;
      color: var(--amber);
      flex-shrink: 0;

      mat-icon {
        font-size: 21px;
        width: 21px;
        height: 21px;
      }
    }

    .account-access-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;

      span {
        min-height: 24px;
        padding: 4px 8px;
        border-radius: 999px;
        background: rgba(245,158,11,0.13);
        color: #a15c00;
        font-size: 0.74rem;
        font-weight: 800;
      }
    }

    .account-access-prices {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;

      div {
        padding: 10px;
        border-radius: 10px;
        background: #ffffff;
        border: 1px solid #edf0f3;
      }

      small {
        display: block;
        color: var(--text-muted);
        font-size: 0.72rem;
        margin-bottom: 3px;
      }

      strong {
        display: block;
        color: var(--text);
        font-size: 0.88rem;
      }
    }

    .account-access-service {
      display: inline-flex;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 10px;
      border-radius: 10px;
      background: #fff7e6;
      color: #7c4a03;
      font-size: 0.78rem;
      font-weight: 800;
      line-height: 1.35;

      mat-icon {
        width: 17px;
        height: 17px;
        font-size: 17px;
        color: #f59e0b;
      }
    }

    .account-access-usecases {
      display: grid;
      gap: 5px;
      margin: 0;
      padding: 0;
      list-style: none;

      li {
        position: relative;
        padding-left: 12px;
        color: var(--text-muted);
        font-size: 0.76rem;
        line-height: 1.35;

        &::before {
          content: '';
          position: absolute;
          top: 0.62em;
          left: 0;
          width: 4px;
          height: 4px;
          border-radius: 999px;
          background: #f59e0b;
        }
      }
    }

    .account-access-card__cta {
      justify-content: center;
      margin-top: auto;
      border-color: rgba(245,158,11,0.45) !important;
      color: #111 !important;
      font-weight: 800;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        margin-left: 4px;
      }
    }

    /* Benefits */
    .benefits-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .benefit-card {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 14px;
      background: var(--surface-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 10px 24px rgba(31, 41, 55, 0.06);

      mat-icon { color: var(--amber); font-size: 22px; flex-shrink: 0; margin-top: 1px; }
    }

    .benefit-text {
      display: flex;
      flex-direction: column;
      gap: 2px;

      strong { font-size: 0.82rem; color: var(--text); }
      span { font-size: 0.75rem; color: var(--text-muted); line-height: 1.3; }
    }

    /* FAQ */
    .subscription-faq {
      margin: 16px 0;
    }
    .faq-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      background: none;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 16px;
      color: var(--text-muted);
      font-size: 0.9rem;
      cursor: pointer;
      width: 100%;
      transition: all 0.2s;
    }
    .faq-toggle:hover {
      background: #f7f8fa;
      color: var(--text);
    }
    .faq-content {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 0 8px;
    }
    .faq-item strong {
      display: block;
      margin-bottom: 4px;
      color: var(--text);
      font-size: 0.9rem;
    }
    .faq-item p {
      margin: 0;
      font-size: 0.85rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    /* Category tabs */
    .cat-tabs {
      display: flex;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cat-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      border: 1px solid var(--border);
      border-radius: 100px;
      background: transparent;
      color: var(--text-muted);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover { border-color: var(--amber); color: var(--text); }
    }

    .cat-tab--active {
      background: var(--amber) !important;
      border-color: var(--amber) !important;
      color: #111 !important;
    }

    .cat-count {
      font-size: 0.78rem;
      font-weight: 400;
      opacity: 0.7;
    }

    /* Plans grid */
    .plans-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }

    .plans-empty {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 20px;
      background: var(--surface-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      color: var(--text);

      mat-icon {
        color: var(--amber);
        flex-shrink: 0;
      }
    }

    .plans-empty__text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;

      strong { font-size: 0.9rem; }
      span { color: var(--text-muted); font-size: 0.8rem; }
    }

    .plans-empty__retry {
      border: 1px solid rgba(245,158,11,0.35);
      background: rgba(245,158,11,0.12);
      color: var(--amber);
      border-radius: 8px;
      padding: 8px 12px;
      font-weight: 700;
      cursor: pointer;
      flex-shrink: 0;

      &:hover { border-color: var(--amber); }
    }

    .plan-card {
      position: relative;
      border-radius: 16px;
      border: 1px solid var(--border);
      background: var(--surface-card);
      padding: 20px 16px 16px;
      display: flex;
      flex-direction: column;
      transition: all 0.3s ease;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.07);

      &:hover {
        border-color: rgba(245,158,11,0.5);
        transform: translateY(-4px);
        box-shadow: 0 18px 38px rgba(31, 41, 55, 0.12);
      }
    }

    .plan-card--featured {
      border-color: var(--amber);
      background: linear-gradient(160deg, #ffffff 0%, #fff7e8 100%);
    }

    .popular-badge {
      position: absolute;
      top: -11px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--amber);
      color: #111;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 3px 14px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .plan-card__head { margin-bottom: 12px; }

    .plan-card__name {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0;
      margin-bottom: 4px;
    }

    .plan-card__headline {
      font-size: 1.15rem;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 2px;
    }

    .plan-card__subtitle {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .plan-card__pricing {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-bottom: 14px;
      flex-wrap: wrap;
    }

    .plan-card__retail {
      font-size: 0.9rem;
      color: var(--text-muted);
      text-decoration: line-through;
    }

    .plan-card__price {
      font-size: 1.6rem;
      font-weight: 800;
      color: var(--amber);
    }

    .plan-card__period {
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .plan-card__savings {
      display: inline-block;
      background: rgba(34,197,94,0.15);
      color: #22c55e;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 10px;
    }

    .plan-card__features {
      list-style: none;
      padding: 0;
      margin: 0 0 16px;
      flex: 1;

      li {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 0.82rem;
        color: var(--text-muted);
        margin-bottom: 6px;
        line-height: 1.4;
      }
    }

    .feat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--amber); flex-shrink: 0; margin-top: 2px; }

    .plan-card__cta {
      width: 100%;
      font-size: 0.85rem;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      padding: 10px 0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 600;

      &:hover { border-color: var(--amber); color: var(--text); }

      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .plan-card__cta--primary {
      background: var(--amber) !important;
      color: #111 !important;
      border-color: var(--amber) !important;
      font-weight: 700;

      &:hover { filter: brightness(1.1); }
    }

    /* Promo input */
    .promo-input-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 0;

      label {
        font-size: 0.85rem;
        color: var(--text-muted);
        font-weight: 500;
      }
    }

    .promo-input-row {
      display: flex;
      gap: 8px;
    }

    .promo-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #ffffff;
      color: var(--text-primary);
      font-size: 0.95rem;
      letter-spacing: 0;
      text-transform: uppercase;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;

      &:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(245,158,11,0.16);
      }
      &::placeholder { text-transform: none; letter-spacing: 0; opacity: 0.4; }
    }

    .promo-apply-btn {
      padding: 10px 16px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #f7f8fa;
      color: var(--text-primary);
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;

      &:hover:not(:disabled) { background: #eef1f5; }
      &:disabled { opacity: 0.4; cursor: not-allowed; }
    }

    .promo-msg {
      font-size: 0.82rem;
      display: flex;
      align-items: center;
      gap: 6px;

      &--error { color: #ef4444; }
      &--success {
        color: #4ade80;
        padding: 8px 12px;
        background: rgba(34,197,94,0.08);
        border: 1px solid rgba(34,197,94,0.2);
        border-radius: 10px;

        mat-icon { font-size: 16px; width: 16px; height: 16px; }
      }
    }

    /* Trust strip */
    .trust-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 16px;
      background: #f7f8fa;
      border-radius: 10px;
      flex-wrap: wrap;
    }

    .trust-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.78rem;
      color: var(--text-muted);

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--amber); }
    }

    .trust-sep { color: #cfd5dd; font-size: 0.7rem; }

    /* Link */
    .link-card {
      background: var(--surface-card) !important;
      border: 1px solid var(--border) !important;
      border-radius: 16px !important;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08) !important;
    }

    .link-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;

      mat-icon { color: var(--amber); font-size: 24px; flex-shrink: 0; margin-top: 2px; }

      strong { font-size: 0.95rem; display: block; margin-bottom: 4px; }
      p { margin: 0; font-size: 0.82rem; color: var(--text-muted); line-height: 1.4; }
    }

    .phone-prefix {
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
    }

    .link-form { display: flex; gap: 12px; align-items: flex-start; }
    .link-input { flex: 1; }
    .link-btn {
      background: var(--amber) !important;
      color: #111 !important;
      font-weight: 700;
      height: 56px;
      flex-shrink: 0;
    }

    /* Phone prompt card */
    .phone-prompt-card {
      background: var(--surface-card) !important;
      border: 1px solid rgba(245,158,11,0.3) !important;
      border-radius: 16px !important;
      box-shadow: 0 12px 30px rgba(31, 41, 55, 0.08) !important;
    }
    .phone-prompt-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;

      mat-icon { color: var(--amber); font-size: 24px; flex-shrink: 0; margin-top: 2px; }
      strong { font-size: 0.95rem; display: block; margin-bottom: 4px; }
      p { margin: 0; font-size: 0.82rem; color: var(--text-muted); line-height: 1.4; }
    }
    .phone-prompt-form { display: flex; flex-direction: column; gap: 12px; }
    .phone-prompt-input { width: 100%; }
    .phone-prompt-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .phone-prompt-btn {
      background: var(--amber) !important;
      color: #111 !important;
      font-weight: 700;
    }

    @media (max-width: 1100px) {
      .hub-hero {
        grid-template-columns: 1fr;
      }

      .hub-balance-card {
        max-width: 360px;
      }

      .hub-section-head {
        flex-direction: column;
      }

      .cat-tabs--hub {
        justify-content: flex-start;
        max-width: none;
      }

      .hub-account-grid,
      .hub-print-grid,
      .hub-faq {
        grid-template-columns: 1fr;
      }
    }

    /* ── DESKTOP (≥ 900px) ── */
    @media (min-width: 900px) {

      /* Subscriber view: 2-column grid */
      .subscriber-view {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
      }

      .hero-card { grid-column: 1 / -1; }

      .hero-content { padding: 28px 32px; }

      .hero-plan-name { font-size: 1.6rem; }

      .hero-price-amount { font-size: 2.6rem; }

      .hero-crown { font-size: 72px; width: 72px; height: 72px; }

      .credits-card { grid-column: 1; }

      .history-card { grid-column: 1 / -1; }

      .period-card { grid-column: 1; }

      .mgmt-card { grid-column: 2; }

      /* Non-subscriber view */
      .promo-header {
        text-align: left;
        padding: 36px 40px;
      }

      .promo-title {
        font-size: 1.75rem;
      }

      .benefits-grid { grid-template-columns: repeat(4, 1fr); }

      .plans-grid { grid-template-columns: repeat(3, 1fr); }

      .account-access-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    }

    /* ── MOBILE (≤ 600px) ── */
    @media (max-width: 600px) {
      .sub-manager {
        padding: 18px 12px 104px;
      }

      .plans-grid {
        grid-template-columns: 1fr !important;
        gap: 16px;
      }
      .plan-card {
        padding: 20px 16px;
      }
      .benefits-grid {
        grid-template-columns: 1fr !important;
      }
      .hub-hero,
      .hub-offers-section,
      .hub-faq {
        padding: 16px;
        border-radius: 8px;
      }
      .hub-hero h1 {
        font-size: 2rem;
      }
      .hub-hero__actions {
        flex-direction: column;
      }
      .hub-primary-action,
      .hub-secondary-action {
        width: 100%;
      }
      .hub-balance-card {
        max-width: none;
        padding: 16px;
      }
      .hub-summary-grid {
        grid-template-columns: 1fr;
      }
      .hub-summary-card {
        padding: 14px;
      }
      .hub-offer-card__prices {
        grid-template-columns: 1fr;
      }
      .account-access-panel {
        padding: 16px;
      }
      .account-access-prices {
        grid-template-columns: 1fr;
      }
      .plans-empty {
        align-items: flex-start;
        flex-direction: column;
      }
      .plans-empty__retry {
        width: 100%;
      }
    }

    /* ── BENEFITS PAGE REDESIGN ── */
    .sub-manager {
      max-width: 1248px;
      padding: 36px 28px 72px;
    }

    .non-subscriber-view {
      display: flex;
      flex-direction: column;
      gap: 24px;
      letter-spacing: 0;
    }

    .benefits-hero h1 {
      margin: 0 0 30px;
      color: var(--text);
      font-size: clamp(2rem, 4vw, 3.6rem);
      line-height: 1;
      font-weight: 900;
      letter-spacing: 0;
    }

    .benefits-hero__grid {
      display: grid;
      grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.82fr) minmax(260px, 0.82fr);
      gap: 24px;
      align-items: stretch;
    }

    .benefits-wallet,
    .benefits-panel,
    .benefits-quick-card,
    .benefit-product-card,
    .hub-print-card,
    .hub-offer-card,
    .benefits-donate,
    .link-card,
    .phone-prompt-card,
    .hub-faq__item {
      border: 0 !important;
      border-radius: 16px !important;
      background: #ffffff !important;
      box-shadow: none !important;
    }

    .benefits-wallet {
      display: flex;
      flex-direction: column;
      min-height: 306px;
      padding: 24px 24px 0;
      overflow: hidden;
    }

    .benefits-wallet__balance {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .benefits-wallet__balance strong {
      color: var(--text);
      font-size: 3.2rem;
      line-height: 1;
      font-weight: 900;
    }

    .benefits-wallet__balance span {
      display: grid;
      width: 36px;
      height: 36px;
      place-items: center;
      border-radius: 50%;
      background: #8b70ff;
      color: #ffffff;
      font-size: 0.9rem;
      font-weight: 900;
    }

    .benefits-wallet p {
      margin: 12px 0 0;
      color: var(--text);
      font-size: 1rem;
      line-height: 1.45;
    }

    .benefits-wallet__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 30px;
    }

    .benefits-primary-action,
    .benefits-neutral-action,
    .benefits-filter,
    .benefit-product-card a,
    .hub-print-card__cta,
    .hub-offer-card__action,
    .plans-empty__retry,
    .promo-apply-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      border: 0;
      border-radius: 10px;
      font: inherit;
      font-weight: 800;
      text-decoration: none;
      cursor: pointer;
      transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
    }

    .benefits-primary-action {
      padding: 0 20px;
      background: var(--accent);
      color: #ffffff;
    }

    .benefits-primary-action:hover,
    .benefits-primary-action:focus-visible {
      background: #d92c21;
      outline: none;
    }

    .benefits-neutral-action {
      padding: 0 18px;
      background: #e3e5e9;
      color: #20242a;
    }

    .benefits-neutral-action:hover,
    .benefits-neutral-action:focus-visible {
      background: #d8dbe1;
      outline: none;
    }

    .benefits-level-row {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) 24px;
      gap: 14px;
      align-items: center;
      margin: 24px -24px 0;
      padding: 22px 24px;
      background: #e7e9ee;
      color: var(--text);
      text-decoration: none;
    }

    .benefits-level-row__icon {
      display: grid;
      width: 44px;
      height: 44px;
      place-items: center;
      border-radius: 50%;
      background: #d6f2ed;
      color: #0b8f7a;
    }

    .benefits-level-row strong {
      display: block;
      font-size: 1.02rem;
      font-weight: 900;
    }

    .benefits-level-row small {
      display: block;
      overflow: hidden;
      margin-top: 4px;
      color: var(--text-muted);
      font-size: 0.9rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .benefits-level-row > mat-icon:last-child {
      justify-self: end;
      color: #737985;
    }

    .benefits-panel {
      display: flex;
      flex-direction: column;
      min-height: 306px;
      padding: 22px 24px;
    }

    .benefits-panel--interactive {
      cursor: pointer;
      transition: box-shadow 0.16s ease, transform 0.16s ease;
    }

    .benefits-panel--interactive:hover,
    .benefits-panel--interactive:focus-visible {
      outline: none;
      box-shadow: 0 18px 46px rgba(19, 24, 32, 0.12);
      transform: translateY(-1px);
    }

    .benefits-panel__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .benefits-panel__head strong {
      font-size: 1.08rem;
      font-weight: 900;
    }

    .benefits-panel__head a,
    .benefits-section__head a {
      color: #2563eb;
      font-size: 0.86rem;
      font-weight: 800;
      text-decoration: none;
      border-bottom: 1px dashed currentColor;
    }

    .benefits-panel__link {
      padding: 0;
      border: 0;
      border-bottom: 1px dashed currentColor;
      background: transparent;
      color: #2563eb;
      font: inherit;
      font-size: 0.86rem;
      font-weight: 800;
      cursor: pointer;
    }

    .benefits-panel__link:hover,
    .benefits-panel__link:focus-visible {
      color: #174fc5;
      outline: none;
    }

    .benefits-panel__link:disabled {
      border-bottom-color: transparent;
      color: var(--text-muted);
      cursor: default;
    }

    .benefits-panel__period {
      margin-top: 18px;
      color: var(--text-muted);
      font-size: 1rem;
    }

    .benefits-icon-stack {
      display: flex;
      min-height: 52px;
      margin-top: 14px;
    }

    .benefits-icon-stack span {
      display: grid;
      width: 38px;
      height: 38px;
      place-items: center;
      margin-right: -6px;
      border: 2px solid #ffffff;
      border-radius: 12px;
      background: #e0f4ff;
      color: var(--accent);
    }

    .benefits-icon-stack span:nth-child(2) { background: #d8f7e9; color: #0aa66a; }
    .benefits-icon-stack span:nth-child(3) { background: #ffe0e5; color: #ef3124; }
    .benefits-icon-stack span:nth-child(4) { background: #ffe9c7; color: #bb6b00; }
    .benefits-icon-stack span:nth-child(5) { background: #ded7ff; color: #6b5cff; }

    .benefits-panel p {
      margin: auto 0 0;
      padding-top: 28px;
      border-top: 1px dashed #cfd3da;
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1.5;
      text-align: center;
    }

    .benefits-cashback-choice {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr) 24px;
      gap: 14px;
      align-items: center;
      width: 100%;
      min-height: 84px;
      margin-top: 18px;
      padding: 12px;
      border: 0;
      border-radius: 14px;
      background: #f5f6f8;
      color: var(--text);
      text-align: left;
      cursor: pointer;
      transition: background-color 0.16s ease, box-shadow 0.16s ease;
    }

    .benefits-cashback-choice:hover,
    .benefits-cashback-choice:focus-visible {
      background: #eef0f4;
      outline: none;
      box-shadow: inset 0 0 0 2px rgba(239,49,36,0.12);
    }

    .benefits-cashback-choice:disabled {
      cursor: default;
      opacity: 1;
    }

    .benefits-cashback-choice:disabled:hover,
    .benefits-cashback-choice:disabled:focus-visible {
      background: #f5f6f8;
      box-shadow: none;
    }

    .benefits-cashback-choice__icon,
    .cashback-category-option__icon {
      display: grid;
      width: 52px;
      height: 52px;
      place-items: center;
      border-radius: 15px;
      background: #d9f7e6;
      color: #087443;
      flex: 0 0 auto;
    }

    .benefits-cashback-choice__icon[data-tone="photos"],
    .cashback-category-option__icon[data-tone="photos"] {
      background: #d9f4ff;
      color: #107ea7;
    }

    .benefits-cashback-choice__icon[data-tone="id-photo"],
    .cashback-category-option__icon[data-tone="id-photo"] {
      background: #ffe0e5;
      color: #ef3124;
    }

    .benefits-cashback-choice__icon[data-tone="restoration"],
    .cashback-category-option__icon[data-tone="restoration"] {
      background: #fff1bd;
      color: #9a6400;
    }

    .benefits-cashback-choice__icon[data-tone="photoshoot"],
    .cashback-category-option__icon[data-tone="photoshoot"] {
      background: #e8e2ff;
      color: #6b5cff;
    }

    .benefits-cashback-choice__icon[data-tone="albums"],
    .cashback-category-option__icon[data-tone="albums"] {
      background: #d8eaff;
      color: #2563eb;
    }

    .benefits-cashback-choice mat-icon,
    .cashback-category-option__icon mat-icon {
      width: 28px;
      height: 28px;
      font-size: 28px;
    }

    .benefits-cashback-choice > mat-icon:last-child {
      justify-self: end;
      color: #8c939e;
    }

    .benefits-cashback-choice--locked > mat-icon:last-child {
      color: #8b70ff;
    }

    .benefits-cashback-choice__text,
    .cashback-category-option__text {
      display: block;
      min-width: 0;
    }

    .benefits-cashback-choice__text strong,
    .cashback-category-option__text strong {
      display: block;
      color: var(--text);
      font-size: 1rem;
      line-height: 1.25;
      font-weight: 900;
    }

    .benefits-cashback-choice__text small,
    .cashback-category-option__text small {
      display: block;
      margin-top: 5px;
      color: var(--text-muted);
      font-size: 0.86rem;
      line-height: 1.35;
    }

    .benefits-chart {
      display: flex;
      flex: 1;
      flex-direction: column;
      justify-content: flex-end;
      gap: 24px;
    }

    .benefits-chart strong {
      font-size: 1.2rem;
      font-weight: 900;
    }

    .benefits-chart__bars {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      align-items: end;
      gap: 16px;
      min-height: 110px;
    }

    .benefits-chart__bars span {
      display: block;
      height: 4px;
      border-radius: 999px;
      background: #d7daf1;
    }

    .benefits-chart__bars span:nth-child(2) { height: 7px; }
    .benefits-chart__bars span:nth-child(3) { height: 11px; }
    .benefits-chart__bars span:nth-child(4) { height: 7px; }
    .benefits-chart__bars span:nth-child(5) { height: 12px; }
    .benefits-chart__bars .is-active { height: 84px; background: #8b70ff; }

    .benefits-quick-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }

    .benefits-quick-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      min-height: 116px;
      padding: 24px;
      color: var(--text);
      text-decoration: none;
    }

    .benefits-quick-card--soft {
      background: #e7e9ff !important;
    }

    .benefits-quick-card strong {
      display: block;
      font-size: 1.05rem;
      font-weight: 900;
    }

    .benefits-quick-card small {
      display: block;
      max-width: 260px;
      margin-top: 6px;
      color: var(--text-muted);
      font-size: 0.92rem;
      line-height: 1.35;
    }

    .benefits-quick-card mat-icon {
      display: grid;
      width: 52px;
      height: 52px;
      place-items: center;
      border-radius: 50%;
      background: #f0f1f3;
      color: #ef3124;
      font-size: 28px;
      flex: 0 0 auto;
    }

    .benefits-tabs {
      display: flex;
      align-items: flex-end;
      gap: 28px;
      margin-top: 12px;
      border-bottom: 1px solid #d7dae0;
    }

    .benefits-tab {
      position: relative;
      padding: 0 0 14px;
      color: var(--text-muted);
      font-size: 1.1rem;
      font-weight: 700;
      text-decoration: none;
    }

    .benefits-tab--active {
      color: var(--text);
    }

    .benefits-tab--active::after {
      content: '';
      position: absolute;
      right: 0;
      bottom: -1px;
      left: 0;
      height: 3px;
      border-radius: 999px;
      background: var(--accent);
    }

    .benefits-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: -4px;
    }

    .benefits-filter {
      min-height: 40px;
      padding: 0 18px;
      background: #dfe2e8;
      color: var(--text);
      font-size: 0.9rem;
    }

    .benefits-filter--icon {
      width: 42px;
      padding: 0;
    }

    .benefits-filter:hover,
    .benefits-filter:focus-visible {
      background: #d4d8df;
      outline: none;
    }

    .benefits-section {
      padding: 0;
      background: transparent;
      box-shadow: none;
    }

    .benefits-section__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }

    .benefits-section__head h2 {
      margin: 0;
      color: var(--text);
      font-size: 1.45rem;
      line-height: 1.2;
      font-weight: 700;
    }

    .benefits-section__title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .benefits-section__badge {
      display: inline-flex;
      align-items: center;
      min-height: 20px;
      padding: 0 8px;
      border-radius: 999px;
      background: #8b70ff;
      color: #ffffff;
      font-size: 0.68rem;
      font-weight: 700;
      line-height: 1;
    }

    .benefits-section__info {
      display: inline-grid;
      width: 20px;
      height: 20px;
      place-items: center;
      border-radius: 50%;
      background: #8d939e;
      color: #ffffff;
      font-size: 0.78rem;
      font-weight: 700;
      line-height: 1;
    }

    .benefit-product-grid,
    .hub-print-grid,
    .hub-account-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 24px;
    }

    .benefit-product-card,
    .hub-print-card,
    .hub-offer-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-width: 0;
      min-height: 344px;
      padding: 20px;
      text-align: center;
    }

    .benefit-product-card__logo,
    .hub-print-card__logo,
    .hub-offer-card__icon {
      display: grid;
      width: 64px;
      height: 64px;
      place-items: center;
      margin: 0 auto 18px;
      border-radius: 18px;
      background: #f0f1f3;
      color: #ef3124;
    }

    .benefit-product-card__logo mat-icon,
    .hub-print-card__logo mat-icon,
    .hub-offer-card__icon mat-icon {
      width: 34px;
      height: 34px;
      font-size: 34px;
    }

    .benefit-product-card--yellow .benefit-product-card__logo { background: #fff1bd; color: #284cff; }
    .benefit-product-card--blue .benefit-product-card__logo { background: #e6e8ff; color: #111a44; }
    .benefit-product-card--red .benefit-product-card__logo { background: #ffe0e5; color: #ef3124; }
    .benefit-product-card--green .benefit-product-card__logo { background: #d8f7e9; color: #0b8f7a; }
    .benefit-product-card--violet .benefit-product-card__logo { background: #ded7ff; color: #6b5cff; }
    .benefit-product-card--cyan .benefit-product-card__logo { background: #d9f4ff; color: #107ea7; }

    .benefit-product-card p,
    .hub-print-card p,
    .hub-offer-card p {
      min-height: 44px;
      margin: 0;
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1.35;
    }

    .hub-print-card > strong {
      display: block;
      min-height: 50px;
      color: var(--text);
      font-size: 1.35rem;
      line-height: 1.15;
      font-weight: 700;
    }

    .hub-print-card__term {
      display: block;
      margin-top: 6px;
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1.35;
    }

    .benefit-product-card__divider,
    .hub-print-card__divider,
    .hub-offer-card__divider {
      width: 100%;
      margin: 24px 0 20px;
      border-top: 1px dashed #cfd3da;
    }

    .benefit-product-card strong,
    .hub-print-card__head strong,
    .hub-offer-card__top strong,
    .hub-offer-card > strong {
      color: var(--text);
      font-size: 1.35rem;
      line-height: 1.15;
      font-weight: 700;
    }

    .benefit-product-card small {
      margin-top: 8px;
      color: var(--text);
      font-size: 0.95rem;
    }

    .benefit-product-card a,
    .hub-print-card__cta,
    .hub-offer-card__action {
      width: 100%;
      margin-top: auto;
      border-radius: 8px;
      background: #e3e5e9;
      color: var(--text);
      font-weight: 500;
    }

    .benefit-product-card a:hover,
    .hub-print-card__cta:hover:not(:disabled),
    .hub-offer-card__action:hover {
      background: #d9dde4;
      outline: none;
    }

    .hub-offer-card__action--active {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: #d9f7e6;
      color: #075e3b;
    }

    .hub-offer-card__action--active:hover {
      background: #c8f0da;
    }

    .hub-offer-card__action--active mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    .hub-print-card--featured {
      box-shadow: inset 0 0 0 2px rgba(239,49,36,0.24) !important;
    }

    .hub-print-card__badge {
      position: absolute;
      top: -10px;
      left: 20px;
      min-height: 22px;
      padding: 3px 10px;
      border-radius: 999px;
      background: #8b70ff;
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 900;
    }

    .hub-print-card__head {
      display: grid;
      justify-items: center;
      gap: 6px;
      min-height: 98px;
    }

    .hub-print-card__head span {
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .hub-print-card__head small {
      color: var(--text-muted);
      font-size: 0.86rem;
      line-height: 1.35;
    }

    .hub-print-card__price {
      display: grid;
      justify-items: center;
      gap: 7px;
      margin: 12px 0 18px;
    }

    .hub-print-card__price span {
      color: var(--text-muted);
      text-decoration: line-through;
      font-size: 0.9rem;
    }

    .hub-print-card__price strong {
      color: var(--accent);
      font-size: 1.65rem;
      line-height: 1;
      font-weight: 900;
    }

    .hub-print-card__price b {
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 900;
    }

    .hub-print-card__price small {
      color: var(--text-muted);
      font-size: 0.84rem;
    }

    .hub-print-card__price em {
      padding: 2px 8px;
      border-radius: 999px;
      background: #dcfce7;
      color: #15803d;
      font-size: 0.75rem;
      font-style: normal;
      font-weight: 900;
    }

    .hub-print-card ul {
      display: grid;
      gap: 7px;
      width: 100%;
      min-height: 58px;
      margin: 0 0 16px;
      padding: 0;
      list-style: none;
      text-align: left;
    }

    .hub-print-card li {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      color: var(--text-muted);
      font-size: 0.82rem;
      line-height: 1.35;
    }

    .hub-print-card li mat-icon {
      width: 16px;
      height: 16px;
      margin-top: 1px;
      color: var(--accent);
      font-size: 16px;
      flex: 0 0 auto;
    }

    .hub-print-card__cta--primary {
      background: var(--accent);
      color: #ffffff;
    }

    .hub-print-card__cta:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .cat-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .cat-tabs--benefits {
      justify-content: flex-end;
    }

    .cat-tab {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 40px;
      padding: 0 16px;
      border: 0;
      border-radius: 10px;
      background: #dfe2e8;
      color: var(--text);
      font: inherit;
      font-size: 0.9rem;
      font-weight: 800;
      cursor: pointer;
    }

    .cat-tab mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    .cat-tab--active {
      background: var(--accent) !important;
      color: #ffffff !important;
    }

    .cat-count {
      color: inherit;
      opacity: 0.72;
    }

    .benefits-donate {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 260px;
      align-items: center;
      min-height: 196px;
      padding: 28px 24px;
      background: #d8eaff !important;
      overflow: hidden;
    }

    .benefits-donate h2 {
      margin: 0 0 8px;
      font-size: 1.35rem;
      font-weight: 900;
    }

    .benefits-donate p {
      margin: 0 0 36px;
      color: var(--text);
      font-size: 0.95rem;
    }

    .benefits-donate__visual {
      display: grid;
      width: 154px;
      height: 154px;
      place-items: center;
      justify-self: end;
      border-radius: 50%;
      background: #fff1bd;
      color: #0ba67f;
      transform: rotate(-8deg);
    }

    .benefits-donate__visual mat-icon {
      width: 86px;
      height: 86px;
      font-size: 86px;
    }

    .hub-offer-card {
      align-items: center;
      text-align: center;
    }

    .access-offer-card {
      width: 100%;
      min-height: 316px;
      border: 0;
      background: #ffffff;
      font: inherit;
      cursor: pointer;
      box-shadow: 0 10px 28px rgba(31, 41, 55, 0.04);
      transition: background-color 0.16s ease, box-shadow 0.16s ease, transform 0.16s ease;
    }

    .access-offer-card:focus-visible {
      outline: 3px solid rgba(239,49,36,0.22);
      outline-offset: 3px;
    }

    .access-offer-card:hover {
      background: #ffffff;
      box-shadow: 0 16px 38px rgba(31, 41, 55, 0.1);
      transform: translateY(-2px);
    }

    .access-offer-card--review .hub-offer-card__icon {
      background: #ffe0e5;
      color: #ef3124;
    }

    .access-offer-card--planned .hub-offer-card__icon {
      background: #e8e2ff;
      color: #6b5cff;
    }

    .access-offer-card__status {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      margin: -8px 0 14px;
      padding: 3px 10px;
      border-radius: 999px;
      background: #d9f7e6;
      color: #087443;
      font-size: 0.74rem;
      font-weight: 900;
    }

    .access-offer-card--review .access-offer-card__status {
      background: #fff1bd;
      color: #8a5600;
    }

    .access-offer-card--planned .access-offer-card__status {
      background: #e8e2ff;
      color: #5741d9;
    }

    .access-offer-card--active {
      box-shadow: inset 0 0 0 2px rgba(8, 116, 67, 0.22), 0 14px 34px rgba(8, 116, 67, 0.08);
    }

    .access-offer-card--active .hub-offer-card__icon,
    .access-offer-card--active.access-offer-card--review .hub-offer-card__icon,
    .access-offer-card--active.access-offer-card--planned .hub-offer-card__icon {
      background: #d9f7e6;
      color: #087443;
    }

    .access-offer-card--active .access-offer-card__status,
    .access-offer-card--active.access-offer-card--review .access-offer-card__status,
    .access-offer-card--active.access-offer-card--planned .access-offer-card__status {
      background: #d9f7e6;
      color: #075e3b;
    }

    .hub-offer-card__icon {
      margin: 0 auto 18px;
    }

    .hub-offer-card__top {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }

    .hub-offer-card__top small {
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .hub-offer-card > small {
      display: block;
      min-height: 26px;
      margin-top: 8px;
      color: var(--text-muted);
      font-size: 0.95rem;
      line-height: 1.35;
    }

    .hub-offer-card > em {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      margin-top: 12px;
      padding: 3px 9px;
      border-radius: 999px;
      background: #f0f1f3;
      color: var(--text-muted);
      font-size: 0.78rem;
      font-style: normal;
      font-weight: 900;
    }

    .hub-offer-card__discounts {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: flex-start;
      margin: 14px 0 0;
    }

    .hub-offer-card__discounts span {
      padding: 5px 8px;
      border-radius: 999px;
      background: #ffe9c7;
      color: #7c4a03;
      font-size: 0.76rem;
      font-weight: 900;
    }

    .hub-offer-card__prices {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin: 12px 0 18px;
    }

    .hub-offer-card__prices span {
      min-width: 0;
      padding: 10px;
      border: 0;
      border-radius: 10px;
      background: #f5f6f8;
    }

    .hub-offer-card__prices small {
      display: block;
      margin-bottom: 3px;
      color: var(--text-muted);
      font-size: 0.72rem;
    }

    .hub-offer-card__prices b {
      display: block;
      overflow: hidden;
      color: var(--text);
      font-size: 0.88rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .benefits-modal-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: start center;
      padding: 40px 24px;
      overflow-y: auto;
      background: rgba(17, 17, 17, 0.66);
    }

    .benefits-modal {
      position: relative;
      width: min(1140px, 100%);
      overflow: hidden;
      border-radius: 18px;
      background: #ffffff;
      color: var(--text);
      box-shadow: 0 26px 90px rgba(0, 0, 0, 0.34);
    }

    .benefits-modal__close {
      position: absolute;
      top: 30px;
      right: 30px;
      z-index: 2;
      display: grid;
      width: 44px;
      height: 44px;
      place-items: center;
      border: 0;
      border-radius: 12px;
      background: transparent;
      color: #20242a;
      cursor: pointer;
    }

    .benefits-modal__close:hover,
    .benefits-modal__close:focus-visible {
      background: rgba(0, 0, 0, 0.06);
      outline: none;
    }

    .benefits-modal__hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 420px);
      gap: 48px;
      align-items: center;
      min-height: 360px;
      padding: 68px 48px 58px;
      background: #ffdada;
    }

    .benefits-modal__hero--education {
      background: #dde9ff;
    }

    .benefits-modal__hero--business {
      background: #ede7ff;
    }

    .benefits-modal--print .benefits-modal__hero {
      background: #ffdada;
    }

    .benefits-modal__hero--photo {
      background: #dff3ff;
    }

    .benefits-modal__hero--photo .benefits-modal__badge {
      background: #0284c7;
    }

    .benefits-modal__hero--photo .benefits-modal__logo {
      background: #0284c7;
      box-shadow: 0 18px 45px rgba(2, 132, 199, 0.22);
    }

    .benefits-modal__copy {
      max-width: 520px;
    }

    .benefits-modal__badge {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      margin-bottom: 18px;
      padding: 4px 12px;
      border-radius: 999px;
      background: #11b957;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 900;
    }

    .benefits-modal__hero--education .benefits-modal__badge {
      background: #2563eb;
    }

    .benefits-modal__hero--business .benefits-modal__badge {
      background: #6b5cff;
    }

    .benefits-modal__copy h2 {
      margin: 0 0 20px;
      color: var(--text);
      font-size: 2.4rem;
      line-height: 1.12;
      font-weight: 900;
    }

    .benefits-modal__copy p {
      max-width: 480px;
      margin: 0;
      color: #2c3036;
      font-size: 1.04rem;
      line-height: 1.55;
    }

    .benefits-modal__actions {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
      margin-top: 32px;
    }

    .benefits-modal__primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 56px;
      padding: 0 28px;
      border: 0;
      border-radius: 9px;
      background: #ef3124;
      color: #ffffff;
      font-size: 0.95rem;
      font-weight: 900;
      font-family: inherit;
      text-decoration: none;
      cursor: pointer;
    }

    .benefits-modal__primary:hover,
    .benefits-modal__primary:focus-visible {
      background: #d9271c;
      outline: none;
    }

    .benefits-modal__primary--active {
      background: #087443;
    }

    .benefits-modal__primary--active:hover,
    .benefits-modal__primary--active:focus-visible {
      background: #065f37;
    }

    .benefits-modal__primary:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .benefits-modal__favorite {
      display: grid;
      width: 56px;
      height: 56px;
      place-items: center;
      border: 0;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.42);
      color: #20242a;
      cursor: pointer;
      transition: background-color 0.16s ease, color 0.16s ease;
    }

    .benefits-modal__favorite:hover,
    .benefits-modal__favorite:focus-visible {
      background: rgba(255, 255, 255, 0.64);
      outline: none;
    }

    .benefits-modal__favorite mat-icon {
      width: 28px;
      height: 28px;
      font-size: 28px;
    }

    .benefits-modal__favorite--active {
      color: #ef3124;
    }

    .benefits-modal__logo {
      display: grid;
      width: min(280px, 80%);
      aspect-ratio: 1;
      place-items: center;
      justify-self: center;
      border-radius: 32%;
      background: #ef3124;
      color: #ffffff;
      box-shadow: 0 18px 45px rgba(239, 49, 36, 0.22);
    }

    .benefits-modal__hero--education .benefits-modal__logo {
      background: #2563eb;
      box-shadow: 0 18px 45px rgba(37, 99, 235, 0.22);
    }

    .benefits-modal__hero--business .benefits-modal__logo {
      background: #6b5cff;
      box-shadow: 0 18px 45px rgba(107, 92, 255, 0.22);
    }

    .benefits-modal__logo mat-icon {
      width: 128px;
      height: 128px;
      font-size: 128px;
    }

    .benefits-modal__features {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 28px;
      padding: 64px 40px 58px;
      background: #ffffff;
    }

    .benefits-modal__features article {
      min-width: 0;
    }

    .benefits-modal__features span {
      display: grid;
      width: 64px;
      height: 64px;
      place-items: center;
      margin-bottom: 22px;
      border-radius: 18px;
      background: #f0f1f3;
      color: #20242a;
    }

    .benefits-modal__features mat-icon {
      width: 34px;
      height: 34px;
      font-size: 34px;
    }

    .benefits-modal__features strong {
      display: block;
      margin-bottom: 10px;
      color: var(--text);
      font-size: 1.05rem;
      line-height: 1.25;
      font-weight: 900;
    }

    .benefits-modal__features p {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.96rem;
      line-height: 1.45;
    }

    .benefits-modal__details {
      padding: 0 40px 64px;
      background: #ffffff;
    }

    .benefits-modal__details h3 {
      margin: 0 0 22px;
      color: var(--text);
      font-size: 1.85rem;
      line-height: 1.2;
      font-weight: 900;
    }

    .benefits-modal__detail-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
    }

    .benefits-modal__detail-grid article {
      min-width: 0;
      padding: 18px;
      border-radius: 14px;
      background: #f5f6f8;
    }

    .benefits-modal__detail-grid span {
      display: block;
      margin-bottom: 10px;
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .benefits-modal__detail-grid strong {
      display: block;
      color: var(--text);
      font-size: 1.02rem;
      line-height: 1.3;
      font-weight: 900;
    }

    .benefits-modal__detail-grid p,
    .benefits-modal__detail-grid li {
      color: var(--text-muted);
      font-size: 0.92rem;
      line-height: 1.45;
    }

    .benefits-modal__detail-grid p {
      margin: 10px 0 0;
    }

    .benefits-modal__detail-grid ul {
      display: grid;
      gap: 7px;
      margin: 12px 0 0;
      padding: 0;
      list-style: none;
    }

    .benefits-modal__detail-grid li {
      position: relative;
      padding-left: 14px;
    }

    .benefits-modal__detail-grid li::before {
      content: '';
      position: absolute;
      top: 0.68em;
      left: 0;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #ef3124;
    }

    .benefits-modal__detail-card--wide {
      grid-column: span 1;
    }

    .print-coverage-scale {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-top: 18px;
    }

    .print-coverage-tier {
      min-width: 0;
      padding: 16px;
      border: 1px solid rgba(239, 49, 36, 0.16);
      border-radius: 12px;
      background: #fff7f6;
    }

    .print-coverage-tier span {
      display: block;
      margin-bottom: 8px;
      color: var(--text-muted);
      font-size: 0.78rem;
      font-weight: 900;
      text-transform: uppercase;
    }

    .print-coverage-tier strong {
      display: block;
      color: #ef3124;
      font-size: 1.55rem;
      font-weight: 900;
      line-height: 1;
    }

    .print-coverage-tier p {
      margin: 8px 0 0;
      color: var(--text-muted);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .print-coverage-note {
      margin: 14px 0 0;
      color: var(--text-muted);
      font-size: 0.94rem;
      line-height: 1.5;
    }

    .benefits-modal__how {
      display: grid;
      grid-template-columns: minmax(220px, 0.9fr) minmax(0, 1fr);
      gap: 42px;
      padding: 64px 40px;
      background: #f0f1f3;
    }

    .benefits-modal__how h3,
    .benefits-modal__faq h3 {
      margin: 0;
      color: var(--text);
      font-size: 1.85rem;
      line-height: 1.2;
      font-weight: 900;
    }

    .benefits-modal__steps {
      display: grid;
      gap: 0;
    }

    .benefits-modal__step {
      position: relative;
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      column-gap: 12px;
      row-gap: 10px;
      padding-bottom: 20px;
    }

    .benefits-modal__step:not(:last-child)::before {
      content: '';
      position: absolute;
      top: 28px;
      bottom: 0;
      left: 13px;
      width: 2px;
      background: #d6d9df;
    }

    .benefits-modal__step > span {
      z-index: 1;
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border-radius: 50%;
      background: #dfe2e8;
      color: var(--text);
      font-size: 0.84rem;
      font-weight: 900;
    }

    .benefits-modal__step p {
      margin: 3px 0 0;
      color: var(--text);
      font-size: 1rem;
      line-height: 1.45;
    }

    .benefits-modal__step a {
      grid-column: 2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: fit-content;
      min-height: 40px;
      padding: 0 18px;
      border-radius: 8px;
      background: #ef3124;
      color: #ffffff;
      font-size: 0.88rem;
      font-weight: 900;
      text-decoration: none;
    }

    .benefits-modal__faq {
      display: grid;
      gap: 0;
      padding: 64px 40px;
      background: #ffffff;
    }

    .benefits-modal__faq h3 {
      margin-bottom: 20px;
    }

    .benefits-modal__faq details {
      border-bottom: 1px solid #dfe3e8;
    }

    .benefits-modal__faq summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      min-height: 72px;
      color: var(--text);
      font-size: 1.05rem;
      font-weight: 700;
      cursor: pointer;
      list-style: none;
    }

    .benefits-modal__faq summary::-webkit-details-marker {
      display: none;
    }

    .benefits-modal__faq details[open] summary mat-icon {
      transform: rotate(180deg);
    }

    .benefits-modal__faq p {
      max-width: 820px;
      margin: -4px 0 22px;
      color: var(--text-muted);
      font-size: 0.98rem;
      line-height: 1.5;
    }

    .cashback-drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      justify-content: flex-end;
      background: rgba(17, 17, 17, 0.66);
    }

    .cashback-drawer {
      position: relative;
      width: min(600px, 100%);
      min-height: 100%;
      padding: 26px 32px 40px;
      overflow-y: auto;
      border-radius: 22px 0 0 22px;
      background: #ffffff;
      color: var(--text);
      box-shadow: -24px 0 70px rgba(0, 0, 0, 0.24);
    }

    .cashback-drawer__close {
      position: absolute;
      top: 24px;
      right: 24px;
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: #20242a;
      cursor: pointer;
    }

    .cashback-drawer__close:hover,
    .cashback-drawer__close:focus-visible {
      background: #f0f1f3;
      outline: none;
    }

    .cashback-drawer h2 {
      max-width: 420px;
      margin: 0 54px 26px 0;
      color: var(--text);
      font-size: 1.9rem;
      line-height: 1.12;
      font-weight: 900;
    }

    .cashback-drawer p {
      max-width: 420px;
      margin: 0;
      color: var(--text-muted);
      font-size: 0.98rem;
      line-height: 1.5;
    }

    .cashback-drawer__error {
      margin-top: 14px !important;
      color: #d92d20 !important;
      font-weight: 700;
    }

    .benefit-summary-drawer {
      position: relative;
      width: min(520px, 100%);
      min-height: 100%;
      padding: 32px 40px 38px;
      overflow-y: auto;
      border-radius: 22px 0 0 22px;
      background: #ffffff;
      color: var(--text);
      box-shadow: -24px 0 70px rgba(0, 0, 0, 0.24);
    }

    .benefit-summary-drawer h2 {
      margin: 0 54px 28px 0;
      color: var(--text);
      font-size: 1.75rem;
      line-height: 1.12;
      font-weight: 900;
    }

    .benefit-summary-segment {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 4px;
      min-height: 36px;
      padding: 4px;
      border-radius: 10px;
      background: #e9ebef;
    }

    .benefit-summary-segment button {
      min-width: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #4f5661;
      font: inherit;
      font-size: 0.86rem;
      font-weight: 800;
      cursor: pointer;
      transition: background-color 0.16s ease, box-shadow 0.16s ease, color 0.16s ease;
    }

    .benefit-summary-segment button.is-active {
      background: #ffffff;
      color: var(--text);
      box-shadow: 0 5px 14px rgba(19, 24, 32, 0.12);
    }

    .benefit-summary-segment button:focus-visible {
      outline: 2px solid rgba(37, 99, 235, 0.28);
      outline-offset: 2px;
    }

    .benefit-summary-total {
      margin-top: 30px;
    }

    .benefit-summary-total span {
      display: block;
      color: #4f5661;
      font-size: 0.94rem;
    }

    .benefit-summary-total strong {
      display: block;
      margin-top: 4px;
      color: var(--text);
      font-size: 1.55rem;
      line-height: 1.1;
      font-weight: 900;
    }

    .benefit-summary-breakdown {
      display: grid;
      gap: 18px;
      margin-top: 30px;
    }

    .benefit-summary-row {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      color: #4f5661;
      font-size: 0.98rem;
    }

    .benefit-summary-row__dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .benefit-summary-row strong {
      color: var(--text);
      font-weight: 900;
      white-space: nowrap;
    }

    .benefit-summary-chart {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      align-items: end;
      gap: 14px;
      min-height: 318px;
      margin-top: 36px;
    }

    .benefit-summary-chart__item {
      display: grid;
      grid-template-rows: 26px 220px 22px;
      align-items: end;
      justify-items: center;
      min-width: 0;
      color: #4f5661;
      font-size: 0.82rem;
    }

    .benefit-summary-chart__item span {
      color: #4f5661;
      font-size: 0.78rem;
      white-space: nowrap;
    }

    .benefit-summary-chart__item i {
      display: block;
      width: 100%;
      max-width: 44px;
      min-height: 4px;
      border-radius: 10px;
      background: #dfe3ff;
      transition: height 0.18s ease;
    }

    .benefit-summary-chart__item i.is-active {
      background: #ff9f2e;
    }

    .benefit-summary-chart__item small {
      color: #8a909a;
      font-size: 0.78rem;
    }

    .benefit-summary-history {
      display: grid;
      width: 100%;
      min-height: 48px;
      place-items: center;
      margin-top: 28px;
      border: 0;
      border-radius: 10px;
      background: #e6e8ec;
      color: var(--text);
      font: inherit;
      font-size: 0.95rem;
      font-weight: 900;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
    }

    .benefit-summary-history:hover,
    .benefit-summary-history:focus-visible {
      background: #dfe2e7;
      outline: none;
    }

    .benefit-summary-state {
      display: grid;
      min-height: 360px;
      place-items: center;
      gap: 14px;
      color: var(--text-muted);
      text-align: center;
    }

    .benefit-summary-state mat-icon {
      color: #8b70ff;
    }

    .benefit-summary-state--error mat-icon {
      color: #ef3124;
    }

    .cashback-category-list {
      display: grid;
      gap: 8px;
      margin-top: 30px;
    }

    .cashback-category-option {
      display: grid;
      grid-template-columns: 52px minmax(0, 1fr) 28px;
      gap: 16px;
      align-items: center;
      width: 100%;
      min-height: 76px;
      padding: 10px 12px;
      border: 0;
      border-radius: 14px;
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
      transition: background-color 0.16s ease, box-shadow 0.16s ease;
    }

    .cashback-category-option:hover,
    .cashback-category-option:focus-visible {
      background: #f5f6f8;
      outline: none;
    }

    .cashback-category-option:disabled {
      cursor: wait;
      opacity: 0.72;
    }

    .cashback-category-option--locked:disabled {
      cursor: default;
      opacity: 1;
    }

    .cashback-category-option--selected {
      background: #f5f6f8;
      box-shadow: inset 0 0 0 2px rgba(239,49,36,0.14);
    }

    .cashback-category-option__state {
      justify-self: end;
      width: 22px;
      height: 22px;
      color: #8c939e;
      font-size: 22px;
    }

    .cashback-category-option--selected .cashback-category-option__state {
      color: #11b957;
    }

    .benefits-service-tools {
      border: 0;
      border-radius: 16px;
      background: #ffffff;
    }

    .benefits-service-tools summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 64px;
      padding: 0 20px;
      color: var(--text);
      font-weight: 900;
      cursor: pointer;
      list-style: none;
    }

    .benefits-service-tools summary::-webkit-details-marker {
      display: none;
    }

    .benefits-service-tools summary mat-icon {
      color: var(--text-muted);
      transition: transform 0.16s ease;
    }

    .benefits-service-tools[open] summary mat-icon {
      transform: rotate(180deg);
    }

    .benefits-service-tools__grid {
      display: grid;
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: 16px;
      padding: 0 20px 20px;
    }

    .benefits-service-tools .promo-input-section,
    .benefits-service-tools .link-card {
      min-width: 0;
      padding: 16px !important;
      border-radius: 14px !important;
      background: #f5f6f8 !important;
    }

    .benefits-service-tools .link-card mat-card-content {
      padding: 0 !important;
    }

    .plans-empty {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 20px;
      border: 0;
      border-radius: 14px;
      background: #ffffff;
      color: var(--text);
    }

    .plans-empty mat-icon {
      color: var(--accent);
      flex-shrink: 0;
    }

    .plans-empty__text {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      gap: 3px;
    }

    .plans-empty__text strong {
      font-size: 0.9rem;
    }

    .plans-empty__text span {
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .plans-empty__retry {
      padding: 0 14px;
      background: #e3e5e9;
      color: var(--text);
    }

    .promo-input-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 0;
    }

    .promo-input-section label {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-weight: 700;
    }

    .promo-input-row {
      display: flex;
      gap: 8px;
    }

    .promo-input {
      flex: 1;
      min-width: 0;
      padding: 10px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: #ffffff;
      color: var(--text-primary);
      font-size: 0.95rem;
      letter-spacing: 0;
      text-transform: uppercase;
      outline: none;
    }

    .promo-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(239,49,36,0.12);
    }

    .promo-input::placeholder {
      text-transform: none;
      letter-spacing: 0;
      opacity: 0.45;
    }

    .promo-apply-btn {
      padding: 0 16px;
      background: #e3e5e9;
      color: var(--text-primary);
      white-space: nowrap;
    }

    .promo-apply-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .promo-msg {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.82rem;
    }

    .promo-msg--error {
      color: #ef4444;
    }

    .promo-msg--success {
      padding: 8px 12px;
      border-radius: 10px;
      background: #dcfce7;
      color: #15803d;
    }

    .promo-msg mat-icon {
      width: 16px;
      height: 16px;
      font-size: 16px;
    }

    .trust-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 16px;
      border-radius: 12px;
      background: #ffffff;
      flex-wrap: wrap;
    }

    .trust-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--text-muted);
      font-size: 0.78rem;
    }

    .trust-item mat-icon {
      width: 14px;
      height: 14px;
      color: var(--accent);
      font-size: 14px;
    }

    .trust-sep {
      color: #cfd5dd;
      font-size: 0.7rem;
    }

    .link-header,
    .phone-prompt-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 16px;
    }

    .link-header mat-icon,
    .phone-prompt-header mat-icon {
      color: var(--accent);
      font-size: 24px;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .link-header strong,
    .phone-prompt-header strong {
      display: block;
      margin-bottom: 4px;
      font-size: 0.95rem;
    }

    .link-header p,
    .phone-prompt-header p {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.82rem;
      line-height: 1.4;
    }

    .phone-prefix {
      color: var(--text);
      font-size: 0.9rem;
      font-weight: 700;
      white-space: nowrap;
    }

    .link-form {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .link-input {
      flex: 1;
    }

    .link-btn,
    .phone-prompt-btn {
      background: var(--accent) !important;
      color: #ffffff !important;
      font-weight: 800;
    }

    .link-btn {
      height: 56px;
      flex-shrink: 0;
    }

    .phone-prompt-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .phone-prompt-input {
      width: 100%;
    }

    .phone-prompt-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .hub-faq {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      padding: 0;
      border: 0;
      background: transparent;
      box-shadow: none;
    }

    .hub-faq__item {
      min-width: 0;
      padding: 18px;
    }

    .hub-faq__item strong {
      display: block;
      margin-bottom: 6px;
      color: var(--text);
      font-size: 0.95rem;
      font-weight: 900;
    }

    .hub-faq__item p {
      margin: 0;
      color: var(--text-muted);
      font-size: 0.84rem;
      line-height: 1.45;
    }

    @media (max-width: 1200px) {
      .benefits-hero__grid {
        grid-template-columns: 1fr 1fr;
      }

      .benefits-wallet {
        grid-column: 1 / -1;
      }

      .benefit-product-grid,
      .hub-print-grid,
      .hub-account-grid,
      .benefits-modal__features,
      .benefits-modal__detail-grid,
      .print-coverage-scale {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .benefits-modal__hero,
      .benefits-modal__how {
        grid-template-columns: 1fr;
      }

      .benefits-modal__logo {
        width: 220px;
      }
    }

    @media (max-width: 760px) {
      .sub-manager {
        padding: 18px 12px 104px;
      }

      .benefits-hero h1 {
        margin-bottom: 20px;
        font-size: 2.15rem;
      }

      .benefits-hero__grid,
      .benefits-quick-grid,
      .benefit-product-grid,
      .hub-print-grid,
      .hub-account-grid,
      .benefits-modal__features,
      .benefits-modal__detail-grid,
      .print-coverage-scale,
      .hub-faq,
      .benefits-donate {
        grid-template-columns: 1fr;
      }

      .benefits-wallet,
      .benefits-panel,
      .benefits-quick-card,
      .benefit-product-card,
      .hub-print-card,
      .hub-offer-card,
      .benefits-donate {
        border-radius: 14px !important;
      }

      .benefits-wallet {
        min-height: 0;
        padding: 18px 18px 0;
      }

      .benefits-wallet__balance strong {
        font-size: 2.5rem;
      }

      .benefits-wallet__actions {
        margin-top: 20px;
      }

      .benefits-primary-action,
      .benefits-neutral-action {
        width: 100%;
      }

      .benefits-level-row {
        margin: 20px -18px 0;
        padding: 18px;
      }

      .benefits-panel {
        min-height: 0;
      }

      .benefits-cashback-choice {
        grid-template-columns: 52px minmax(0, 1fr) 22px;
      }

      .benefits-quick-card {
        min-height: 104px;
        padding: 18px;
      }

      .benefits-section__head {
        align-items: flex-start;
        flex-direction: column;
      }

      .cat-tabs--benefits {
        justify-content: flex-start;
      }

      .hub-offer-card__prices {
        grid-template-columns: 1fr;
      }

      .benefits-modal-backdrop {
        padding: 0;
      }

      .benefits-modal {
        width: 100%;
        min-height: 100%;
        border-radius: 0;
      }

      .benefits-modal__close {
        top: 14px;
        right: 14px;
        background: rgba(255, 255, 255, 0.38);
      }

      .benefits-modal__hero {
        gap: 28px;
        min-height: 0;
        padding: 74px 24px 38px;
      }

      .benefits-modal__copy h2 {
        font-size: 2rem;
      }

      .benefits-modal__actions {
        align-items: stretch;
        flex-direction: column;
      }

      .benefits-modal__primary,
      .benefits-modal__favorite {
        width: 100%;
      }

      .benefits-modal__logo {
        width: 168px;
      }

      .benefits-modal__logo mat-icon {
        width: 88px;
        height: 88px;
        font-size: 88px;
      }

      .benefits-modal__features,
      .benefits-modal__details,
      .benefits-modal__how,
      .benefits-modal__faq {
        padding: 40px 24px;
      }

      .cashback-drawer {
        width: 100%;
        border-radius: 0;
        padding: 72px 22px 32px;
      }

      .cashback-drawer__close {
        top: 16px;
        right: 16px;
      }

      .cashback-drawer h2 {
        margin-right: 0;
        font-size: 1.75rem;
      }

      .benefit-summary-drawer {
        width: 100%;
        border-radius: 0;
        padding: 72px 22px 32px;
      }

      .benefit-summary-drawer h2 {
        margin-right: 0;
      }

      .benefit-summary-chart {
        gap: 10px;
        min-height: 276px;
      }

      .benefit-summary-chart__item {
        grid-template-rows: 24px 180px 22px;
      }

      .cashback-category-option {
        grid-template-columns: 48px minmax(0, 1fr) 24px;
        gap: 12px;
        padding: 10px;
      }

      .cashback-category-option__icon {
        width: 48px;
        height: 48px;
      }

      .benefits-donate {
        min-height: 0;
      }

      .benefits-donate__visual {
        width: 118px;
        height: 118px;
        justify-self: center;
      }

      .benefits-donate__visual mat-icon {
        width: 64px;
        height: 64px;
        font-size: 64px;
      }

      .benefits-service-tools__grid {
        grid-template-columns: 1fr;
        padding: 0 12px 12px;
      }

      .benefits-service-tools summary {
        padding: 0 14px;
      }

      .promo-input-row,
      .link-form {
        flex-direction: column;
      }

      .promo-apply-btn,
      .link-btn,
      .plans-empty__retry {
        width: 100%;
      }

      .plans-empty {
        align-items: flex-start;
        flex-direction: column;
      }
    }
  `],
})
export class SubscriptionManagerComponent implements OnInit {
  protected readonly subscriptionService = inject(SubscriptionService);
  private readonly cloudPayments = inject(CloudPaymentsService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly dashboardService = inject(ProfileDashboardService);

  readonly categories = CATEGORIES;
  readonly accountAccessOptions = ACCOUNT_ACCESS_OPTIONS;
  readonly cashbackCategoryOptions = CASHBACK_CATEGORY_OPTIONS;
  readonly selectedAccessOption = signal<AccountAccessOption | null>(null);
  readonly selectedPrintPackagePlan = signal<SubscriptionPlan | null>(null);
  readonly favoriteAccessKinds = signal<readonly AccountAccessKind[]>([]);
  readonly selectedCashbackCategoryKey = signal<CashbackCategoryKey | null>(null);
  readonly cashbackPeriodMonth = signal<string | null>(null);
  readonly cashbackSelectionSaving = signal(false);
  readonly cashbackSelectionError = signal('');
  readonly cashbackCategoryPickerOpen = signal(false);
  readonly benefitSummaryDrawerOpen = signal(false);
  readonly benefitSummary = signal<LoyaltyBenefitSummary | null>(null);
  readonly benefitSummaryLoading = signal(false);
  readonly benefitSummaryError = signal('');
  readonly benefitSummaryMode = signal<LoyaltyBenefitSummaryMode>('earned');
  readonly activeTab = signal(0);
  readonly showFaq = signal(false);
  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly plansLoading = signal(false);
  readonly plansError = signal('');
  readonly actionLoading = signal(false);
  readonly changingCard = signal(false);
  readonly linking = signal(false);
  readonly purchasing = signal(false);
  readonly purchasingPlanId = signal('');

  // Credit history
  readonly creditHistory = signal<CreditHistoryEntry[]>([]);
  readonly historyPage = signal(1);
  readonly historyTotal = signal(0);
  readonly hasMoreHistory = computed(() => this.creditHistory().length < this.historyTotal());
  readonly loyaltySummary = this.dashboardService.loyaltySummary;
  readonly pointsBalance = computed(() => this.loyaltySummary()?.points ?? 0);
  readonly pointsAsRubles = computed(() => this.loyaltySummary()?.pointsAsRubles ?? 0);
  readonly benefitCardCurrentRubles = computed(() => this.benefitSummary()?.currentBalanceRubles ?? this.pointsAsRubles());
  readonly levelName = computed(() => this.loyaltySummary()?.levelName ?? 'Новичок');
  readonly levelHint = computed(() => {
    const summary = this.loyaltySummary();
    if (!summary) return 'бонусы и история заказов';
    if (summary.level >= 5) return 'максимальный уровень';
    return `${summary.currentXp} / ${summary.nextLevelXp} бонусов`;
  });

  readonly cashbackMonthName = computed(() => formatCashbackMonth(this.cashbackPeriodMonth()));
  readonly cashbackCategoryLocked = computed(() => this.selectedCashbackCategoryKey() !== null);
  readonly hasSelectedCashbackCategory = this.cashbackCategoryLocked;
  readonly cashbackSelectionHint = computed(() => (
    this.cashbackCategoryLocked()
      ? getCashbackLockedMessage(this.cashbackMonthName())
      : 'Выберите одну категорию на месяц. После выбора изменить её нельзя.'
  ));
  readonly selectedCashbackCategory = computed(() => {
    const key = this.selectedCashbackCategoryKey();
    if (!key) return DEFAULT_CASHBACK_CATEGORY;
    return this.cashbackCategoryOptions.find(category => category.key === key) ?? DEFAULT_CASHBACK_CATEGORY;
  });
  readonly benefitSummaryBreakdown = computed(() => {
    const summary = this.benefitSummary();
    if (!summary) return [];
    return this.benefitSummaryMode() === 'earned'
      ? summary.earnedBreakdown
      : summary.spentBreakdown;
  });
  readonly benefitSummaryCurrentTotal = computed(() => {
    const summary = this.benefitSummary();
    if (!summary) return 0;
    return this.benefitSummaryMode() === 'earned'
      ? summary.currentMonth.earned
      : summary.currentMonth.spent;
  });
  readonly benefitSummaryChartMax = computed(() => {
    const summary = this.benefitSummary();
    if (!summary) return 1;
    const mode = this.benefitSummaryMode();
    const values = summary.months.map(month => mode === 'earned' ? month.earned : month.spent);
    return Math.max(1, ...values);
  });
  readonly benefitCardChartMax = computed(() => {
    const summary = this.benefitSummary();
    if (!summary) return 1;
    return Math.max(1, ...summary.months.map(month => month.earned));
  });

  readonly periodSavings = computed(() => {
    // Legacy credit history remains visible for subscriptions sold before volume discounts.
    return this.creditHistory().reduce((sum, e) => sum + e.credits_consumed, 0);
  });

  readonly hasActivePrintPackage = computed(() => {
    const subscription = this.subscriptionService.currentSubscription();
    return Boolean(
      subscription &&
      (subscription.status === 'active' || subscription.status === 'paused'),
    );
  });

  // Phone mask signals, link subscription
  readonly linkPhoneDigits = signal('');
  readonly maskedLinkPhone = computed(() => applyPhoneMask(this.linkPhoneDigits()));

  // Phone mask signals, purchase flow (when no phone in profile)
  readonly purchasePhoneDigits = signal('');
  readonly maskedPurchasePhone = computed(() => applyPhoneMask(this.purchasePhoneDigits()));
  readonly showPhonePrompt = signal(false);
  readonly pendingPurchasePlan = signal<SubscriptionPlan | null>(null);
  readonly pendingPurchaseActionLabel = computed(() => {
    const plan = this.pendingPurchasePlan();
    return plan && isAccountAccessPlan(plan)
      ? 'Подключить доступ'
      : 'Купить пакет';
  });

  // Promo code signals
  readonly promoCode = signal('');
  readonly promoTrialDays = signal(0);
  readonly promoLoading = signal(false);
  readonly promoError = signal('');

  /** @deprecated, kept only for backward compat, use linkPhoneDigits */
  linkPhone = '';

  readonly printPlans = computed(() => this.plans().filter(plan => !isAccountAccessPlan(plan)));

  readonly filteredPlans = computed(() => {
    const cat = CATEGORIES[this.activeTab()]?.key;
    if (!cat) return this.printPlans();
    return this.printPlans()
      .filter(p => p.category === cat)
      .sort((a, b) => a.base_price - b.base_price);
  });

  protected isAccountAccessSubscription(subscription: MySubscription): boolean {
    return isAccountAccessSubscription(subscription);
  }

  private activeAccessSubscription(option: Pick<AccountAccessOption, 'kind'>): MySubscription | null {
    return findActiveAccountAccessSubscription(this.subscriptionService.subscriptions(), option.kind);
  }

  protected isAccessOptionActive(option: AccountAccessOption): boolean {
    return this.activeAccessSubscription(option) !== null;
  }

  protected accessOptionStatusLabel(option: AccountAccessOption): string {
    const subscription = this.activeAccessSubscription(option);
    if (!subscription) return option.statusLabel;
    if (subscription.status === 'paused') return 'Приостановлена';

    const endDate = this.formatAccessPeriodEnd(subscription.current_period_end);
    return endDate ? `Активна до ${endDate}` : 'Активна';
  }

  protected accessOptionCardActionLabel(option: AccountAccessOption): string {
    const subscription = this.activeAccessSubscription(option);
    if (!subscription) return option.cardActionLabel;

    switch (option.kind) {
      case 'personal':
        return 'Личный доступ активен';
      case 'education':
        return 'Образовательный доступ активен';
      case 'business':
        return 'Бизнес-доступ активен';
    }
  }

  protected accessDetailBadge(access: AccountAccessOption): string {
    const subscription = this.activeAccessSubscription(access);
    if (!subscription) return access.detailBadge;
    if (subscription.status === 'paused') return 'ПРИОСТАНОВЛЕНА';

    const endDate = this.formatAccessPeriodEnd(subscription.current_period_end);
    return endDate ? `АКТИВНА ДО ${endDate}` : 'АКТИВНА';
  }

  protected accessDetailActionLabel(access: AccountAccessOption): string {
    const subscription = this.activeAccessSubscription(access);
    if (!subscription) return access.detailActionLabel;

    switch (access.kind) {
      case 'personal':
        return 'Открыть профиль';
      case 'education':
        return 'Открыть образовательный профиль';
      case 'business':
        return 'Открыть бизнес-аккаунт';
    }
  }

  protected accessDetailCondition(access: AccountAccessOption): string {
    const subscription = this.activeAccessSubscription(access);
    if (!subscription) return access.detailCondition;
    if (subscription.status === 'paused') {
      return 'Доступ приостановлен. Управление доступно в личном кабинете.';
    }

    const endDate = this.formatAccessPeriodEnd(subscription.current_period_end);
    const activeUntil = endDate ? ` до ${endDate}` : '';

    switch (access.kind) {
      case 'personal':
        return `Личный доступ активен${activeUntil}. Управление доступно в личном кабинете.`;
      case 'education':
        return `Образовательная цена активна${activeUntil}. Проверка и срок действия доступны в образовательном профиле.`;
      case 'business':
        return `Бизнес-доступ активен${activeUntil}. Управление доступно в бизнес-профиле.`;
    }
  }

  private formatAccessPeriodEnd(value: string | null | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  openAccessOption(option: AccountAccessOption): void {
    this.selectedAccessOption.set(option);
  }

  closeAccessOption(): void {
    this.selectedAccessOption.set(null);
  }

  openPrintPackage(plan: SubscriptionPlan): void {
    this.selectedPrintPackagePlan.set(plan);
  }

  closePrintPackage(): void {
    this.selectedPrintPackagePlan.set(null);
  }

  continuePrintPackagePurchase(plan: SubscriptionPlan): void {
    this.closePrintPackage();
    this.purchasePlan(plan);
  }

  continueAccountAccessPurchase(): void {
    const plan = findAccountAccessPlan(this.plans());
    if (!plan) {
      const message = this.plansLoading()
        ? 'Тариф доступа загружается. Попробуйте через секунду.'
        : 'Не удалось найти тариф личного доступа. Обновите страницу.';
      this.snackBar.open(message, 'OK', { duration: 4000 });
      if (!this.plansLoading()) this.loadPlans();
      return;
    }

    this.closeAccessOption();
    this.purchasePlan(plan);
  }

  openCashbackCategoryPicker(): void {
    if (this.cashbackCategoryLocked()) {
      this.cashbackSelectionError.set('');
      this.snackBar.open(getCashbackLockedMessage(this.cashbackMonthName()), 'OK', { duration: 3000 });
      return;
    }

    this.cashbackCategoryPickerOpen.set(true);
  }

  closeCashbackCategoryPicker(): void {
    this.cashbackCategoryPickerOpen.set(false);
  }

  openBenefitSummaryDrawer(event?: Event): void {
    event?.stopPropagation();
    this.benefitSummaryDrawerOpen.set(true);
    this.loadBenefitSummary();
  }

  closeBenefitSummaryDrawer(): void {
    this.benefitSummaryDrawerOpen.set(false);
  }

  setBenefitSummaryMode(mode: LoyaltyBenefitSummaryMode): void {
    this.benefitSummaryMode.set(mode);
  }

  loadBenefitSummary(force = false): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.benefitSummaryLoading()) return;
    if (!force && this.benefitSummary()) return;

    this.benefitSummaryLoading.set(true);
    this.benefitSummaryError.set('');
    this.dashboardService.getBenefitSummary(6).subscribe({
      next: (summary) => {
        this.benefitSummary.set(summary);
        this.benefitSummaryLoading.set(false);
      },
      error: () => {
        this.benefitSummaryLoading.set(false);
        this.benefitSummaryError.set('Не удалось загрузить полученную выгоду');
      },
    });
  }

  benefitMonthValue(month: LoyaltyBenefitMonth): number {
    return this.benefitSummaryMode() === 'earned' ? month.earned : month.spent;
  }

  benefitSummaryBarHeight(month: LoyaltyBenefitMonth): number {
    const value = this.benefitMonthValue(month);
    if (value <= 0) return 4;
    return Math.max(8, Math.round((value / this.benefitSummaryChartMax()) * 220));
  }

  benefitCardBarHeight(month: LoyaltyBenefitMonth): number {
    if (month.earned <= 0) return 4;
    return Math.max(6, Math.round((month.earned / this.benefitCardChartMax()) * 84));
  }

  selectCashbackCategory(category: CashbackCategoryOption): void {
    if (this.cashbackSelectionSaving()) return;
    if (this.cashbackCategoryLocked()) {
      const message = getCashbackLockedMessage(this.cashbackMonthName());
      this.cashbackSelectionError.set(message);
      this.snackBar.open(message, 'OK', { duration: 3000 });
      return;
    }

    this.cashbackSelectionSaving.set(true);
    this.cashbackSelectionError.set('');
    this.dashboardService.selectCashbackCategory(category.key).subscribe({
      next: (state) => {
        this.applyCashbackState(state);
        this.cashbackSelectionSaving.set(false);
        this.closeCashbackCategoryPicker();
        this.snackBar.open('Категория кэшбэка выбрана', 'OK', { duration: 2500 });
      },
      error: (error: unknown) => {
        const message = getCashbackSelectionErrorMessage(error);
        this.cashbackSelectionSaving.set(false);
        this.cashbackSelectionError.set(message);
        this.snackBar.open(message, 'OK', { duration: 3000 });
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.closeCashbackCategoryPicker();
          this.loadCashbackState();
        }
      },
    });
  }

  closeOverlayPanels(): void {
    this.closeAccessOption();
    this.closePrintPackage();
    this.closeCashbackCategoryPicker();
    this.closeBenefitSummaryDrawer();
  }

  isAccessFavorite(kind: AccountAccessKind): boolean {
    return this.favoriteAccessKinds().includes(kind);
  }

  toggleAccessFavorite(option: AccountAccessOption, event: Event): void {
    event.stopPropagation();
    const kind = option.kind;
    this.favoriteAccessKinds.update((current) =>
      current.includes(kind)
        ? current.filter(item => item !== kind)
        : [...current, kind],
    );
  }

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.subscriptionService.ensureLoaded();
    this.dashboardService.loadDashboard();
    this.loadCashbackState();
    this.loadBenefitSummary();
    this.loadPlans();
    this.loadCreditHistory();
  }

  private loadCashbackState(): void {
    this.cashbackSelectionError.set('');
    this.dashboardService.getCashbackState().subscribe({
      next: (state) => this.applyCashbackState(state),
      error: () => {
        this.cashbackSelectionError.set('Не удалось загрузить категорию кэшбэка');
      },
    });
  }

  private applyCashbackState(state: CashbackState): void {
    this.cashbackPeriodMonth.set(state.periodMonth);
    this.selectedCashbackCategoryKey.set(state.selection?.categoryKey ?? null);
  }

  loadPlans(): void {
    this.plansLoading.set(true);
    this.plansError.set('');
    this.subscriptionService.loadPlans().subscribe({
      next: (res) => {
        this.plans.set(res.plans || []);
        this.plansLoading.set(false);
      },
      error: () => {
        this.plans.set([]);
        this.plansError.set('Не удалось загрузить пакеты печати');
        this.plansLoading.set(false);
      },
    });
  }

  private loadCreditHistory(): void {
    this.subscriptionService.loadCreditHistory(1, 10).subscribe({
      next: (res) => {
        this.creditHistory.set(res.items || []);
        this.historyTotal.set(res.total || 0);
        this.historyPage.set(1);
      },
      error: () => { /* silent, history is non-critical */ },
    });
  }

  loadMoreHistory(): void {
    const nextPage = this.historyPage() + 1;
    this.subscriptionService.loadCreditHistory(nextPage, 10).subscribe({
      next: (res) => {
        this.creditHistory.update(prev => [...prev, ...(res.items || [])]);
        this.historyTotal.set(res.total || 0);
        this.historyPage.set(nextPage);
      },
      error: () => { /* silent */ },
    });
  }

  packageCaption(plan: SubscriptionPlan): string {
    return this.isPhotoPrintPlan(plan)
      ? 'Пакет фотопечати'
      : 'Пакет печати документов';
  }

  packagePaymentName(plan: SubscriptionPlan): string {
    return `${this.packageCaption(plan)}: ${this.packageQuantity(plan)}`;
  }

  packageQuantity(plan: SubscriptionPlan): string {
    const knownTitle = PRINT_PACKAGE_TITLES_BY_SLUG[plan.slug];
    if (knownTitle) return knownTitle;

    const item = this.primaryPackageItem(plan);
    if (!item) {
      return this.firstQuantityFeature(plan) ?? (this.isPhotoPrintPlan(plan) ? 'Фото 10×15' : 'Листы A4');
    }

    const quantity = Number(item.included_quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return this.firstQuantityFeature(plan) ?? (this.isPhotoPrintPlan(plan) ? 'Фото 10×15' : 'Листы A4');
    }

    if (this.isPhotoPrintPlan(plan)) {
      return `${quantity} фото ${this.photoFormat(item.product_name)}`;
    }

    return `до ${quantity} ${this.pluralizeRu(quantity, 'лист', 'листа', 'листов')} ${this.printFormat(item.product_name)}`;
  }

  printPackageHeroText(plan: SubscriptionPlan): string {
    if (this.isPhotoPrintPlan(plan)) {
      return 'Разовая покупка пакета фотопечати на 1 месяц. Фото списываются по количеству, без автопродления.';
    }

    return 'Разовая покупка пакета печати документов на 1 месяц. Объём рассчитан для A4 при заливке до 15%.';
  }

  printPackageFeatures(plan: SubscriptionPlan): readonly PrintPackageFeature[] {
    if (this.isPhotoPrintPlan(plan)) {
      return [
        {
          icon: 'photo_library',
          title: 'Формат 10×15',
          text: 'Одна фотография 10×15 списывает 1 фото из пакета.',
        },
        {
          icon: 'event_available',
          title: 'Срок 1 месяц',
          text: 'Пакет действует с момента оплаты и не продлевается автоматически.',
        },
        {
          icon: 'storefront',
          title: 'В студии и онлайн',
          text: 'Используйте пакет при оформлении фотопечати в доступных каналах.',
        },
        {
          icon: 'receipt_long',
          title: 'Прозрачное списание',
          text: 'Остаток видно в личном кабинете после оплаты.',
        },
      ];
    }

    return [
      {
        icon: 'print',
        title: 'Печать A4',
        text: 'Ч/б до 15% списывается x1, цветная A4 до 15% списывается x1.2.',
      },
      {
        icon: 'opacity',
        title: 'Заливка влияет',
        text: 'Плотные страницы списываются с множителем x2, x3 или x4.',
      },
      {
        icon: 'event_available',
        title: 'Срок 1 месяц',
        text: 'Пакет действует с момента оплаты и не продлевается автоматически.',
      },
      {
        icon: 'receipt_long',
        title: 'Постраничный расчёт',
        text: 'Множитель считается отдельно для каждой страницы документа.',
      },
    ];
  }

  hasCoveragePolicy(plan: SubscriptionPlan): boolean {
    return plan.usage_policy?.kind === 'coverage_print_package' || !this.isPhotoPrintPlan(plan);
  }

  coverageTiers(plan: SubscriptionPlan): readonly SubscriptionPlanCoverageTier[] {
    const tiers = plan.usage_policy?.coverage_tiers;
    return tiers?.length ? tiers : FALLBACK_COVERAGE_TIERS;
  }

  printPackageTerms(plan: SubscriptionPlan): readonly string[] {
    const terms = plan.usage_policy?.terms;
    if (terms?.length) return terms;
    return this.isPhotoPrintPlan(plan) ? FALLBACK_PHOTO_PACKAGE_TERMS : FALLBACK_DOC_PACKAGE_TERMS;
  }

  printPackageSteps(plan: SubscriptionPlan): readonly string[] {
    const steps = plan.usage_policy?.steps;
    if (steps?.length) return steps;
    return this.isPhotoPrintPlan(plan) ? FALLBACK_PHOTO_PACKAGE_STEPS : FALLBACK_DOC_PACKAGE_STEPS;
  }

  printPackageFaq(plan: SubscriptionPlan): readonly SubscriptionPlanUsageFaq[] {
    const faq = plan.usage_policy?.faq;
    if (faq?.length) return faq;
    return this.isPhotoPrintPlan(plan) ? FALLBACK_PHOTO_PACKAGE_FAQ : FALLBACK_DOC_PACKAGE_FAQ;
  }

  printPackageBaseRule(plan: SubscriptionPlan): string {
    if (this.isPhotoPrintPlan(plan)) {
      return 'Одно фото 10×15 списывает 1 фото из пакета.';
    }

    return 'Номинальный объём рассчитан на A4: ч/б до 15% = x1, цвет до 15% = x1.2.';
  }

  printPackageMultiplierRule(plan: SubscriptionPlan): string {
    if (this.isPhotoPrintPlan(plan)) {
      return 'Списывается по количеству фотографий';
    }

    const maxCoverageMultiplier = this.maxCoverageMultiplier(plan);
    const maxColorMultiplier = this.formatPrintMultiplier(maxCoverageMultiplier * 1.2);
    return `До 15% - ч/б x1, цвет x1.2; цветная плотная A4 до x${maxColorMultiplier}.`;
  }

  private maxCoverageMultiplier(plan: SubscriptionPlan): number {
    return Math.max(
      1,
      ...this.coverageTiers(plan).map((tier) => {
        const value = Number(tier.credit_multiplier);
        return Number.isFinite(value) ? value : 1;
      }),
    );
  }

  private formatPrintMultiplier(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  isPhotoPrintPlan(plan: SubscriptionPlan): boolean {
    return plan.category === 'photo-print' || plan.slug.includes('photoprint');
  }

  private primaryPackageItem(plan: SubscriptionPlan): SubscriptionPlanItem | null {
    const items = (plan.items ?? []).filter(item => Number(item.included_quantity) > 0);
    if (items.length === 0) return null;

    if (this.isPhotoPrintPlan(plan)) {
      return items.find(item => /10\s*[xх×]\s*15|фото|фотобумага/i.test(item.product_name)) ?? items[0];
    }

    return items.find(item => /a4|а4/i.test(item.product_name) && !/цвет|color/i.test(item.product_name))
      ?? items.find(item => /a4|а4/i.test(item.product_name))
      ?? items[0];
  }

  private firstQuantityFeature(plan: SubscriptionPlan): string | null {
    const feature = plan.features?.find(value => /\d/.test(value));
    if (!feature) return null;
    return feature
      .replace(/\s+в месяц/gi, '')
      .replace(/\s+Premium/gi, '')
      .trim();
  }

  private photoFormat(productName: string): string {
    const match = productName.match(/\d+\s*[xх×]\s*\d+/i);
    if (!match) return '10×15';
    return match[0].replace(/\s/g, '').replace(/[xх]/gi, '×');
  }

  private printFormat(productName: string): string {
    if (/a4|а4/i.test(productName)) return 'A4';
    return 'печати';
  }

  private pluralizeRu(value: number, one: string, few: string, many: string): string {
    const integer = Math.abs(Math.trunc(value));
    const mod10 = integer % 10;
    const mod100 = integer % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  retailPrice(plan: SubscriptionPlan): number {
    if (!plan.items?.length) return 0;
    return plan.items.reduce((sum, item) => sum + (item.product_price * item.included_quantity), 0);
  }

  savingsPercent(plan: SubscriptionPlan): number {
    const retail = this.retailPrice(plan);
    if (retail <= plan.base_price) return 0;
    return Math.round(((retail - plan.base_price) / retail) * 100);
  }

  planCountByCategory(category: string): number {
    return this.printPlans().filter(p => p.category === category).length;
  }

  activePrintPackageTitle(subscription: MySubscription): string {
    if (!subscription.plan_slug) return subscription.plan_name;
    return PRINT_PACKAGE_TITLES_BY_SLUG[subscription.plan_slug] ?? subscription.plan_name;
  }

  statusLabel(status: string): string {
    const map: Record<string, string> = {
      active: 'Активна',
      paused: 'Приостановлена',
      cancelled: 'Отменена',
      expired: 'Истекла',
    };
    return map[status] ?? status;
  }

  pauseSubscription(): void {
    const sub = this.subscriptionService.currentSubscription();
    if (!sub) return;

    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '380px',
      data: {
        title: 'Приостановить пакет печати',
        message: 'Пакет будет приостановлен. Пакетная цена не будет применяться до возобновления.',
        confirmButtonText: 'Приостановить',
        cancelButtonText: 'Отмена',
        type: 'warning',
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.actionLoading.set(true);
      this.subscriptionService.pauseSubscription(sub.id).subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.subscriptionService.currentSubscription.set({ ...sub, status: 'paused' });
          this.snackBar.open('Пакет печати приостановлен', 'OK', { duration: 3000 });
        },
        error: () => {
          this.actionLoading.set(false);
          this.snackBar.open('Ошибка. Попробуйте снова.', 'OK', { duration: 3000 });
        },
      });
    });
  }

  resumeSubscription(): void {
    const sub = this.subscriptionService.currentSubscription();
    if (!sub) return;

    this.actionLoading.set(true);
    this.subscriptionService.resumeSubscription(sub.id).subscribe({
      next: () => {
        this.actionLoading.set(false);
        this.subscriptionService.currentSubscription.set({ ...sub, status: 'active' });
        this.snackBar.open('Пакет печати возобновлён', 'OK', { duration: 3000 });
      },
      error: () => {
        this.actionLoading.set(false);
        this.snackBar.open('Ошибка. Попробуйте снова.', 'OK', { duration: 3000 });
      },
    });
  }

  cancelSubscription(): void {
    const sub = this.subscriptionService.currentSubscription();
    if (!sub) return;

    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '400px',
      data: {
        title: 'Отменить пакет печати',
        message: 'Пакет будет отменён. <strong>Пакетная цена сохранится до конца оплаченного периода.</strong>',
        confirmButtonText: 'Отменить пакет',
        cancelButtonText: 'Оставить',
        type: 'danger',
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.actionLoading.set(true);
      this.subscriptionService.cancelSubscription(sub.id).subscribe({
        next: () => {
          this.actionLoading.set(false);
          this.subscriptionService.currentSubscription.set({ ...sub, status: 'cancelled' });
          this.snackBar.open('Пакет отменён. Пакетная цена действует до конца периода.', 'OK', { duration: 5000 });
        },
        error: () => {
          this.actionLoading.set(false);
          this.snackBar.open('Ошибка. Попробуйте снова.', 'OK', { duration: 3000 });
        },
      });
    });
  }

  changeCard(): void {
    if (this.changingCard()) return;
    const sub = this.subscriptionService.currentSubscription();
    if (!sub) return;

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
      if (!confirmed) return;
      void this.runCardChange(sub.id);
    });
  }

  private async runCardChange(subscriptionId: string): Promise<void> {
    this.changingCard.set(true);
    this.actionLoading.set(true);

    try {
      const init = await firstValueFrom(
        this.subscriptionService.changeCardInit(subscriptionId),
      );

      const payment = await this.cloudPayments.verifyCardForChange({
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
      this.actionLoading.set(false);
    }
  }

  purchasePlan(plan: SubscriptionPlan): void {
    if (this.purchasing()) return;

    const user = this.authService.currentUser();
    if (!user?.phone) {
      // No phone in profile, show inline phone prompt
      this.pendingPurchasePlan.set(plan);
      this.purchasePhoneDigits.set('');
      this.showPhonePrompt.set(true);
      return;
    }

    this.executePurchase(plan);
  }

  confirmPurchaseWithPhone(): void {
    const plan = this.pendingPurchasePlan();
    if (!plan) return;

    const phone = normalizePhone(this.purchasePhoneDigits());
    if (phone.length < 11) {
      this.snackBar.open('Введите корректный телефон', 'OK', { duration: 3000 });
      return;
    }

    // Save phone to user profile first
    this.subscriptionService.savePhoneToProfile(phone).subscribe({
      next: () => {
        this.showPhonePrompt.set(false);
        this.executePurchase(plan);
      },
      error: () => {
        this.snackBar.open('Не удалось сохранить телефон', 'OK', { duration: 3000 });
      },
    });
  }

  private executePurchase(plan: SubscriptionPlan): void {
    const accountAccessPurchase = isAccountAccessPlan(plan);
    this.purchasing.set(true);
    this.purchasingPlanId.set(plan.id);

    const promo = this.promoCode().trim() && this.promoTrialDays() > 0 ? this.promoCode().trim() : undefined;
    this.subscriptionService.purchase(plan.id, promo).subscribe({
      next: async (result) => {
        if (!result.success) {
          this.purchasing.set(false);
          this.purchasingPlanId.set('');
          this.snackBar.open(
            accountAccessPurchase ? 'Ошибка создания подписки' : 'Ошибка создания пакета печати',
            'OK',
            { duration: 3000 },
          );
          return;
        }

        const paymentResult = await this.cloudPayments.subscribe({
          subscriptionId: result.subscription_id,
          planName: accountAccessPurchase ? 'Личный доступ' : this.packagePaymentName(plan),
          amount: result.amount,
          billingPeriod: result.billing_period,
          email: result.email || undefined,
          phone: result.phone || undefined,
          trialDays: result.trial_period_days || undefined,
          oneTime: !accountAccessPurchase,
        });

        this.purchasing.set(false);
        this.purchasingPlanId.set('');

        if (paymentResult.success) {
          const msg = result.trial_end
            ? accountAccessPurchase
              ? `Личный доступ активен. Бесплатный период до ${new Date(result.trial_end).toLocaleDateString('ru-RU')}.`
              : `Пакет печати активен. Бесплатный период до ${new Date(result.trial_end).toLocaleDateString('ru-RU')}.`
            : accountAccessPurchase ? 'Личный доступ оформлен.' : 'Пакет печати оформлен.';
          this.snackBar.open(msg, 'OK', { duration: 5000 });
          this.subscriptionService.loadMySubscription();
        } else if (paymentResult.error && paymentResult.error !== 'Оплата отменена') {
          this.snackBar.open(paymentResult.error, 'OK', { duration: 5000 });
        }
      },
      error: (err) => {
        this.purchasing.set(false);
        this.purchasingPlanId.set('');
        const msg = err.error?.error
          || (accountAccessPurchase ? 'Не удалось оформить подписку' : 'Не удалось оформить пакет печати');
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      },
    });
  }

  async validatePromo(): Promise<void> {
    const code = this.promoCode().trim();
    if (!code) return;
    this.promoLoading.set(true);
    this.promoError.set('');
    this.promoTrialDays.set(0);
    try {
      const res = await fetch(`/api/subscriptions/trial-info/${encodeURIComponent(code)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        this.promoError.set(err?.error || 'Промокод не найден');
        return;
      }
      const data = await res.json();
      this.promoTrialDays.set(data.trial_days || 0);
      if (!data.trial_days) this.promoError.set('Промокод не предоставляет пробный период');
    } catch {
      this.promoError.set('Не удалось проверить промокод');
    } finally {
      this.promoLoading.set(false);
    }
  }

  linkSubscription(): void {
    const phone = normalizePhone(this.linkPhoneDigits());
    if (phone.length < 11) {
      this.snackBar.open('Введите корректный телефон', 'OK', { duration: 3000 });
      return;
    }

    this.linking.set(true);
    this.subscriptionService.linkByPhone(phone).subscribe({
      next: (res) => {
        this.linking.set(false);
        const subscriptions = res.subscriptions || [];
        this.subscriptionService.subscriptions.set(subscriptions);
        const active = subscriptions.find(s =>
          this.subscriptionService.isManagedPrintSubscription(s) &&
          (s.status === 'active' || s.status === 'paused')
        );
        if (active) {
          this.subscriptionService.currentSubscription.set(active);
          this.snackBar.open('Пакет печати привязан к аккаунту', 'OK', { duration: 3000 });
        } else {
          this.subscriptionService.currentSubscription.set(null);
          this.subscriptionService.credits.set([]);
          this.snackBar.open('Пакет печати не найден по этому номеру', 'OK', { duration: 3000 });
        }
      },
      error: (err) => {
        this.linking.set(false);
        this.snackBar.open(err.error?.error || 'Пакет печати не найден', 'OK', { duration: 3000 });
      },
    });
  }

  // ── Phone mask handlers: Link subscription ──

  onLinkPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selStart = input.selectionStart ?? input.value.length;
    let digits = input.value.replace(/\D/g, '');
    if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    this.linkPhoneDigits.set(digits);

    const rawBefore = input.value.slice(0, selStart).replace(/\D/g, '');
    let digitsBeforeCursor = rawBefore.length;
    if (rawBefore.startsWith('7') || rawBefore.startsWith('8')) digitsBeforeCursor--;
    digitsBeforeCursor = Math.min(Math.max(digitsBeforeCursor, 0), digits.length);

    requestAnimationFrame(() => {
      const masked = this.maskedLinkPhone();
      input.value = masked;
      const pos = phoneCursorPos(masked, digitsBeforeCursor);
      input.setSelectionRange(pos, pos);
    });
  }

  onLinkPhoneKeydown(event: KeyboardEvent): void {
    this.handlePhoneBackspace(event, this.linkPhoneDigits, () => this.maskedLinkPhone());
  }

  // ── Phone mask handlers: Purchase phone prompt ──

  onPurchasePhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selStart = input.selectionStart ?? input.value.length;
    let digits = input.value.replace(/\D/g, '');
    if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    this.purchasePhoneDigits.set(digits);

    const rawBefore = input.value.slice(0, selStart).replace(/\D/g, '');
    let digitsBeforeCursor = rawBefore.length;
    if (rawBefore.startsWith('7') || rawBefore.startsWith('8')) digitsBeforeCursor--;
    digitsBeforeCursor = Math.min(Math.max(digitsBeforeCursor, 0), digits.length);

    requestAnimationFrame(() => {
      const masked = this.maskedPurchasePhone();
      input.value = masked;
      const pos = phoneCursorPos(masked, digitsBeforeCursor);
      input.setSelectionRange(pos, pos);
    });
  }

  onPurchasePhoneKeydown(event: KeyboardEvent): void {
    this.handlePhoneBackspace(event, this.purchasePhoneDigits, () => this.maskedPurchasePhone());
  }

  // ── Shared backspace handler for phone mask ──

  private handlePhoneBackspace(
    event: KeyboardEvent,
    digitsSignal: ReturnType<typeof signal<string>>,
    getMasked: () => string,
  ): void {
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
        const digits = digitsSignal();
        let digitIndex = 0;
        for (let i = 0; i < newPos; i++) {
          if (/\d/.test(input.value[i])) digitIndex++;
        }
        digitsSignal.set(digits.slice(0, digitIndex - 1) + digits.slice(digitIndex));
        requestAnimationFrame(() => {
          const masked = getMasked();
          input.value = masked;
          const p = phoneCursorPos(masked, Math.max(0, digitIndex - 1));
          input.setSelectionRange(p, p);
        });
      }
    }
  }
}
