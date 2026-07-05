import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthChatService } from '../../core/services/auth-chat.service';
import { AuthService, type PhoneAuthProfileInput } from '../../core/services/auth.service';
import {
  PricingApiService,
  type DeliveryMethod,
  type PricingServiceOption,
} from '../../core/services/pricing-api.service';
import { SeoService } from '../../core/services/seo.service';
import { SubscriptionService, type SubscriptionPlan } from '../../core/services/subscription.service';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

type StartClientAudienceId = 'personal' | 'study' | 'business';
type StartClientMode = 'existing' | 'new';
type StartClientAuthStep = 'form' | 'code';
type StartClientVisual =
  | 'photo-docs'
  | 'print-stack'
  | 'portrait'
  | 'education'
  | 'student-docs'
  | 'study-materials'
  | 'business-docs'
  | 'marketplace'
  | 'bulk-print';

interface StartClientOfferHighlight {
  readonly label: string;
  readonly value: string;
}

interface StartClientOffer {
  readonly title: string;
  readonly subtitle: string;
  readonly visual: StartClientVisual;
  readonly badge: string;
  readonly route: string;
  readonly actionLabel: string;
  readonly highlights: readonly StartClientOfferHighlight[];
}

interface StartClientAudience {
  readonly id: StartClientAudienceId;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly returnUrl: string;
  readonly connectTitle: string;
  readonly connectDescription: string;
  readonly offers: readonly StartClientOffer[];
}

interface StartClientTariffPrice {
  readonly audienceId: StartClientAudienceId;
  readonly value: string;
}

interface StartClientTariffRow {
  readonly service: string;
  readonly note?: string;
  readonly prices: readonly StartClientTariffPrice[];
}

interface StartClientTariffGroup {
  readonly title: string;
  readonly icon: string;
  readonly rows: readonly StartClientTariffRow[];
}

const START_CLIENT_OTP_LENGTH = 4;
const START_CLIENT_PHONE_MASK = '(___) ___-__-__';
const START_CLIENT_OG_IMAGE = '/assets/static/promo/pechat-foto.webp';
const START_CLIENT_EDUCATION_PLAN_PRICE_FALLBACK = 199;

const START_CLIENT_DOCUMENT_PRINT_DISCOUNTS: Readonly<Record<StartClientAudienceId, number>> = {
  personal: 20,
  study: 70,
  business: 40,
};

const START_CLIENT_PHOTO_PRINT_DISCOUNTS: Readonly<Record<StartClientAudienceId, number>> = {
  personal: 10,
  study: 30,
  business: 15,
} as const;

function maskStartClientPhone(digits: string): string {
  const sliced = digits.slice(0, 10);
  let result = '';
  let digitIndex = 0;

  for (let i = 0; i < START_CLIENT_PHONE_MASK.length; i += 1) {
    if (START_CLIENT_PHONE_MASK[i] === '_') {
      result += digitIndex < sliced.length ? sliced[digitIndex] : '_';
      digitIndex += 1;
      continue;
    }

    if (i === 0 && sliced.length === 0) {
      break;
    }
    if (i === 5 && sliced.length < 3) {
      break;
    }
    if (i === 5 && sliced.length === 3) {
      result += ')';
      break;
    }
    if (i === 9 && sliced.length < 6) {
      break;
    }
    if (i === 12 && sliced.length < 8) {
      break;
    }

    result += START_CLIENT_PHONE_MASK[i];
  }

  return result;
}

function cursorAfterStartClientPhoneDigits(masked: string, digitCount: number): number {
  if (digitCount === 0) {
    return 0;
  }

  let count = 0;
  for (let i = 0; i < masked.length; i += 1) {
    if (/\d/.test(masked[i])) {
      count += 1;
      if (count === digitCount) {
        return i + 1;
      }
    }
  }

  return masked.length;
}

function extractStartClientPhoneDigits(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('7') || digits.startsWith('8')) {
    digits = digits.slice(1);
  }

  return digits.slice(0, 10);
}

function readObjectStringProperty(value: object, property: string): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(value, property);
  const candidate = descriptor?.value;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

function readStartClientAuthError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    return (
      readObjectStringProperty(error, 'error') ??
      readObjectStringProperty(error, 'message') ??
      fallback
    );
  }

  return fallback;
}

function parseStartClientAudience(value: string | null): StartClientAudienceId | null {
  if (value === 'personal' || value === 'study' || value === 'business') {
    return value;
  }

  return null;
}

const START_CLIENT_AUDIENCES: readonly StartClientAudience[] = [
  {
    id: 'personal',
    label: 'Для себя',
    title: 'Фото, документы и печать для себя',
    description:
      'Соберите личный профиль: с подпиской документы А4 дешевле на 20%, а фотопечать до А4 дешевле на 10%.',
    icon: 'person',
    returnUrl: '/user-profile',
    connectTitle: 'Создайте профиль для личных заказов',
    connectDescription:
      'После звонка с кодом откроем кабинет, где сохраняются ваши заказы, фото, документы и история обращений.',
    offers: [
      {
        title: 'Фото и документы',
        subtitle: 'Паспорт, анкеты, визы, справки и ведомственные форматы онлайн или в студии.',
        visual: 'photo-docs',
        badge: 'от 700 ₽ онлайн',
        route: '/foto-na-document',
        actionLabel: 'Выбрать',
        highlights: [
          { label: 'Онлайн', value: 'от 700 ₽' },
          { label: 'В студии', value: 'от 700 ₽' },
          { label: 'Печать', value: 'комплектом' },
        ],
      },
      {
        title: 'Печать фото и документов',
        subtitle: 'С подпиской личного аккаунта: фото 10x15 от 18 ₽, документы А4 от 8 ₽.',
        visual: 'print-stack',
        badge: 'фото от 18 ₽',
        route: '/pechat-foto',
        actionLabel: 'Смотреть',
        highlights: [
          { label: 'Фото 10x15', value: 'от 18 ₽' },
          { label: 'А4 текст', value: 'от 8 ₽' },
          { label: 'Скан', value: 'от 50 ₽' },
        ],
      },
      {
        title: 'Портрет, ретушь и реставрация',
        subtitle: 'Аккуратный портрет, обработка свежих снимков и восстановление старых фотографий.',
        visual: 'portrait',
        badge: 'портрет от 900 ₽',
        route: '/retush',
        actionLabel: 'Открыть',
        highlights: [
          { label: 'Подготовка', value: 'от 700 ₽' },
          { label: 'Реставрация', value: 'от 900 ₽' },
          { label: 'Портрет', value: 'от 900 ₽' },
        ],
      },
    ],
  },
  {
    id: 'study',
    label: 'Для учёбы',
    title: 'Самые дешёвые условия для учёбы',
    description:
      'Для студентов, преподавателей и сотрудников учебных организаций: после проверки и подписки 199 ₽/мес документы А4 дешевле на 70%, фотопечать до А4 дешевле на 50%. Без подписки, только по подтверждённому статусу: документы на 50%, фото на 30%.',
    icon: 'school',
    returnUrl: '/user-profile/education',
    connectTitle: 'Заполните данные для образовательного доступа',
    connectDescription:
      'Создадим профиль, затем в кабинете можно загрузить документ для проверки статуса и получить учебные цены.',
    offers: [
      {
        title: 'Образовательный доступ',
        subtitle: 'После проверки и подписки 199 ₽/мес: А4 от 3 ₽ вместо 10 ₽, цветной текст от 4 ₽ и такая же скидка на плотную заливку страниц.',
        visual: 'education',
        badge: 'А4 от 3 ₽',
        route: '/education',
        actionLabel: 'Подробнее',
        highlights: [
          { label: 'Ч/б до 15%', value: '3 ₽' },
          { label: 'Цвет до 15%', value: '4 ₽' },
          { label: 'Доступ', value: '12 мес.' },
        ],
      },
      {
        title: 'Поступление и документы',
        subtitle: 'Фото на студенческий, зачётку, пропуск, справки и анкеты под требования организации.',
        visual: 'student-docs',
        badge: 'студенческие цены',
        route: '/foto-na-studencheskiy',
        actionLabel: 'Открыть',
        highlights: [
          { label: 'Фото онлайн', value: 'от 700 ₽' },
          { label: 'В студии', value: 'от 700 ₽' },
          { label: 'А4', value: 'все заливки' },
        ],
      },
      {
        title: 'Материалы и обработка',
        subtitle: 'Методички, конспекты, презентации и фотопечать до А4 по учебной сетке.',
        visual: 'study-materials',
        badge: 'дешевле после проверки',
        route: '/pechat-dokumentov',
        actionLabel: 'Смотреть',
        highlights: [
          { label: 'До 50%', value: '8 ₽' },
          { label: 'До 75%', value: '12 ₽' },
          { label: 'До 100%', value: '18 ₽' },
        ],
      },
    ],
  },
  {
    id: 'business',
    label: 'Для бизнеса',
    title: 'Фото сотрудников, печать и B2B-съёмки',
    description:
      'Бизнес-аккаунт отделяет компанию от личного профиля: реквизиты, подтверждение через банк или менеджера, счета, печать, фото сотрудников, корпоративные базы, съёмки и выезд по B2B-условиям.',
    icon: 'business_center',
    returnUrl: '/user-profile',
    connectTitle: 'Создайте бизнес-аккаунт для рабочих заказов',
    connectDescription:
      'После регистрации можно завести организацию, указать реквизиты, подтвердить компанию и согласовать корпоративные фото-задачи с менеджером.',
    offers: [
      {
        title: 'Фото сотрудников и документы',
        subtitle: 'Пропуска, медкнижки, анкеты, личные дела и корпоративные базы. Печать: А4 от 6 ₽, фото 10x15 от 17 ₽ после подключения B2B-аккаунта.',
        visual: 'business-docs',
        badge: 'для HR и офиса',
        route: '/portretnaya-sjomka',
        actionLabel: 'Выбрать',
        highlights: [
          { label: 'А4 текст', value: 'от 6 ₽' },
          { label: 'Пропуска', value: 'единый формат' },
          { label: 'Базы', value: 'для команды' },
        ],
      },
      {
        title: 'Съёмки и индивидуальный выезд',
        subtitle: 'Фотосъёмки сотрудников, выезд к одному человеку или команде, единый стиль кадров для внутренних систем.',
        visual: 'marketplace',
        badge: 'B2B-условия',
        route: '/booking',
        actionLabel: 'Записаться',
        highlights: [
          { label: 'Сотрудники', value: 'съёмка' },
          { label: 'Выезд', value: 'индивидуально' },
          { label: 'Формат', value: 'для баз' },
        ],
      },
      {
        title: 'Регулярная печать',
        subtitle: 'Документы, инструкции, фото до А4 и материалы команды по понятной сетке для задач бизнеса.',
        visual: 'bulk-print',
        badge: 'А4 -40%',
        route: '/pechat-dokumentov',
        actionLabel: 'Открыть',
        highlights: [
          { label: 'Фото 10x15', value: 'от 17 ₽' },
          { label: 'Печать А4', value: '-40%' },
          { label: 'А4 заливка', value: 'все уровни' },
        ],
      },
    ],
  },
] as const;

@Component({
  selector: 'app-start-client',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
    ScrollRevealDirective,
  ],
  templateUrl: './start-client.component.html',
  styleUrl: './start-client.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'start-client-host',
    'attr.data-section': 'public',
  },
})
export class StartClientComponent implements OnInit {
  private readonly clientLastNameInputRef =
    viewChild<ElementRef<HTMLInputElement>>('clientLastNameInput');
  private readonly clientPhoneInputRef =
    viewChild<ElementRef<HTMLInputElement>>('clientPhoneInput');
  private readonly clientCodeInputRef =
    viewChild<ElementRef<HTMLInputElement>>('clientCodeInput');

  private readonly authService = inject(AuthService);
  private readonly authChatService = inject(AuthChatService);
  private readonly pricingApi = inject(PricingApiService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly seo = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private authCountdownTimer: ReturnType<typeof setInterval> | null = null;

  protected readonly audiences = START_CLIENT_AUDIENCES;
  protected readonly educationPlans = signal<readonly SubscriptionPlan[]>([]);
  protected readonly selectedAudienceId = signal<StartClientAudienceId>('personal');
  protected readonly selectedAudience = computed(() =>
    this.audiences.find((audience) => audience.id === this.selectedAudienceId()) ?? this.audiences[0],
  );
  protected readonly educationPlanMonthlyPrice = computed(() => {
    const educationPlan = this.educationPlans().find((plan) => plan.billing_period === 'monthly')
      ?? this.educationPlans()[0];
    const price = Number(educationPlan?.base_price);
    return Number.isFinite(price) && price > 0
      ? price
      : START_CLIENT_EDUCATION_PLAN_PRICE_FALLBACK;
  });
  protected readonly tariffGroups = computed(() => this.buildTariffGroups());
  protected readonly authLoading = this.authService.isLoading;
  protected readonly selectedClientMode = signal<StartClientMode>('new');
  protected readonly authStep = signal<StartClientAuthStep>('form');
  protected readonly lastName = signal('');
  protected readonly firstName = signal('');
  protected readonly birthDate = signal('');
  protected readonly phoneDigits = signal('');
  protected readonly code = signal('');
  protected readonly authError = signal<string | null>(null);
  protected readonly authRequesting = signal(false);
  protected readonly authCountdown = signal(0);
  protected readonly maxBirthDate = new Date().toISOString().slice(0, 10);
  protected readonly maskedPhone = computed(() =>
    maskStartClientPhone(this.phoneDigits()),
  );
  protected readonly formattedPhone = computed(() => {
    const masked = this.maskedPhone();
    return masked ? `+7 ${masked}` : '+7';
  });
  protected readonly phoneValid = computed(() =>
    this.phoneDigits().length === 10,
  );
  protected readonly codeValid = computed(() =>
    this.code().length === START_CLIENT_OTP_LENGTH,
  );
  protected readonly clientDataValid = computed(() =>
    this.lastName().trim().length >= 2 &&
    this.firstName().trim().length >= 2 &&
    this.birthDateValid(),
  );
  protected readonly formValid = computed(() => {
    if (!this.phoneValid()) {
      return false;
    }

    return this.selectedClientMode() === 'existing' || this.clientDataValid();
  });
  protected readonly canResendCode = computed(() =>
    this.authCountdown() <= 0 && !this.authRequesting(),
  );

  constructor() {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const audience = parseStartClientAudience(params.get('audience'));
        if (audience) {
          this.selectedAudienceId.set(audience);
        }
      });

    this.destroyRef.onDestroy(() => this.stopAuthCountdown());
  }

  ngOnInit(): void {
    this.loadClientPricing();
    this.setupSeo();
  }

  protected selectAudience(id: StartClientAudienceId): void {
    this.selectedAudienceId.set(id);
  }

  protected startClient(id?: StartClientAudienceId): void {
    if (id) {
      this.selectAudience(id);
    }
    this.selectClientMode('new');
    this.scrollToAccess();
  }

  protected offerVisualIcon(visual: StartClientVisual): string {
    switch (visual) {
      case 'photo-docs':
      case 'student-docs':
        return 'badge';
      case 'print-stack':
      case 'study-materials':
      case 'bulk-print':
        return 'print';
      case 'portrait':
      case 'business-docs':
        return 'portrait';
      case 'education':
        return 'school';
      case 'marketplace':
        return 'sell';
    }
  }

  protected selectClientMode(mode: StartClientMode): void {
    if (this.selectedClientMode() === mode) {
      return;
    }

    this.selectedClientMode.set(mode);
    this.authStep.set('form');
    this.code.set('');
    this.authError.set(null);
    this.stopAuthCountdown();
    this.focusCurrentFormInput();
  }

  protected onLastNameInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.lastName.set(input.value);
    this.authError.set(null);
  }

  protected onFirstNameInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.firstName.set(input.value);
    this.authError.set(null);
  }

  protected onBirthDateInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.birthDate.set(input.value);
    this.authError.set(null);
  }

  protected onPhoneInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const digits = extractStartClientPhoneDigits(input.value);
    this.phoneDigits.set(digits);
    this.authError.set(null);
    this.scheduleBrowserFrame(() => {
      const masked = this.maskedPhone();
      input.value = masked;
      const position = cursorAfterStartClientPhoneDigits(masked, digits.length);
      input.setSelectionRange(position, position);
    });
  }

  protected onPhonePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const input = event.target;
    const digits = extractStartClientPhoneDigits(event.clipboardData?.getData('text') ?? '');
    this.phoneDigits.set(digits);
    this.authError.set(null);

    if (input instanceof HTMLInputElement) {
      this.scheduleBrowserFrame(() => {
        const masked = this.maskedPhone();
        input.value = masked;
        const position = cursorAfterStartClientPhoneDigits(masked, digits.length);
        input.setSelectionRange(position, position);
      });
    }
  }

  protected onPhoneKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    this.requestPhoneCode();
  }

  protected clearPhone(): void {
    this.phoneDigits.set('');
    this.authError.set(null);
    this.focusPhoneInput();
  }

  protected onCodeInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const digits = input.value.replace(/\D/g, '').slice(0, START_CLIENT_OTP_LENGTH);
    input.value = digits;
    this.code.set(digits);
    this.authError.set(null);
  }

  protected requestPhoneCode(): void {
    if (this.authRequesting()) {
      return;
    }

    if (!this.formValid()) {
      const clientMode = this.selectedClientMode();

      if (
        clientMode === 'new' &&
        !this.phoneValid() &&
        !this.clientDataValid()
      ) {
        this.authError.set('Заполните данные и номер телефона.');
        this.focusCurrentFormInput();
        return;
      }

      if (!this.phoneValid()) {
        this.authError.set('Введите номер телефона.');
        this.focusPhoneInput();
        return;
      }

      this.authError.set('Заполните фамилию, имя и дату рождения.');
      this.focusLastNameInput();
      return;
    }

    this.authError.set(null);
    this.authRequesting.set(true);

    this.authService.requestPhoneCode(this.fullPhone()).subscribe({
      next: (response) => {
        this.authRequesting.set(false);
        this.code.set('');
        this.authStep.set('code');
        this.startAuthCountdown(response.expiresIn);
        this.focusCodeInput();
      },
      error: (error: unknown) => {
        this.authRequesting.set(false);
        this.authError.set(
          readStartClientAuthError(error, 'Не удалось запустить звонок. Попробуйте позже.'),
        );
      },
    });
  }

  protected verifyPhoneCode(): void {
    if (!this.codeValid() || this.authLoading()) {
      return;
    }

    this.authError.set(null);

    const profile = this.selectedClientMode() === 'new'
      ? this.buildPhoneProfile()
      : undefined;

    this.authService.verifyPhoneCode(
      this.fullPhone(),
      this.code(),
      false,
      profile,
    ).subscribe({
      next: (response) => {
        if (response.requiresProfile) {
          this.selectedClientMode.set('new');
          this.authStep.set('form');
          this.code.set('');
          this.stopAuthCountdown();
          this.authError.set(
            response.isNewUser
              ? 'Мы не нашли клиента с этим телефоном. Заполните данные, чтобы стать клиентом.'
              : 'В профиле не хватает данных. Заполните фамилию, имя и дату рождения.',
          );
          this.focusLastNameInput();
          return;
        }

        this.redirectAfterAuth();
      },
      error: (error: unknown) => {
        this.authError.set(
          readStartClientAuthError(error, 'Неверный код. Попробуйте ещё раз.'),
        );
      },
    });
  }

  protected backToForm(): void {
    this.authStep.set('form');
    this.code.set('');
    this.authError.set(null);
    this.stopAuthCountdown();
    this.focusCurrentFormInput();
  }

  protected resendCode(): void {
    if (!this.canResendCode()) {
      return;
    }

    this.requestPhoneCode();
  }

  private loadClientPricing(): void {
    this.pricingApi.loadCategories();

    this.subscriptionService
      .loadPlans('education')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.educationPlans.set(response.plans ?? []),
        error: () => this.educationPlans.set([]),
      });
  }

  private buildTariffGroups(): readonly StartClientTariffGroup[] {
    const bw15 = this.printOptionPrice('km-а4-печать-документа', 10);
    const color15 = this.printOptionPrice('km-а4-печать-до-15-цвет', 12);
    const color50 = this.printOptionPrice('km-а4-печать-документа-цветная', 25);
    const color75 = this.printOptionPrice('km-а4-печать-до-75', 40);
    const color100 = this.printOptionPrice('km-а4-фото-документ', 60);
    const binding = this.printOptionPrice('binding-spring-a4', 100);
    const photo10x15 = this.optionPrice('photo-print-format', 'km-фото-10x15-премиум', 20, 'pickup');
    const photo15x20 = this.optionPrice('photo-print-format', 'km-фото-15x20-премиум', 80, 'pickup');
    const photo20x30 = this.optionPrice('photo-print-format', 'km-фото-20x30-премиум', 150, 'pickup');
    const photoDocsOnline = this.optionPrice('photo-docs', 'processing-basic', 700, 'electronic');
    const photoDocsStudio = this.optionPrice('photo-docs', 'processing-basic', 700, 'pickup');
    const photoDocsExtended = this.optionPrice('photo-docs', 'processing-extended', 950, 'electronic');

    return [
      {
        title: 'Печать документов А4',
        icon: 'description',
        rows: [
          this.printTariffRow(
            'Заливка до 15%, ч/б',
            'Текстовые страницы, заявления, договоры, конспекты и методички без плотной графики.',
            bw15,
          ),
          this.printTariffRow(
            'Заливка до 15%, цвет',
            'Цветной текст, таблицы, схемы, диаграммы и небольшие цветные элементы.',
            color15,
          ),
          this.printTariffRow(
            'Заливка до 50%',
            'Презентации, страницы с иллюстрациями, плотными блоками и частичной графикой.',
            color50,
          ),
          this.printTariffRow(
            'Заливка до 75%',
            'Постеры, инструкции, страницы с крупными изображениями и фоном.',
            color75,
          ),
          this.printTariffRow(
            'Заливка до 100%',
            'Полная цветная заливка, фото на листе, афиши и насыщенные макеты.',
            color100,
          ),
          {
            service: 'Переплёт пружиной А4',
            note: 'Для рефератов, методичек, коммерческих предложений и внутренних инструкций.',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(binding) },
              { audienceId: 'study', value: this.formatFromPrice(binding) },
              { audienceId: 'business', value: this.formatFromPrice(binding) },
            ],
          },
          {
            service: 'Образовательный доступ',
            note: 'Для студентов, преподавателей и сотрудников учебных организаций: проверка статуса плюс подписка.',
            prices: [
              { audienceId: 'personal', value: '-' },
              { audienceId: 'study', value: `${this.formatCurrency(this.educationPlanMonthlyPrice())}/мес` },
              { audienceId: 'business', value: '-' },
            ],
          },
          {
            service: 'Минимальная цена аккаунта',
            note: 'Скидка действует после подключения доступа: личный, по подписке, образовательный, после проверки, бизнес, после подтверждения организации и счёта.',
            prices: [
              {
                audienceId: 'personal',
                value: `А4 от ${this.formatCurrency(this.documentPrintPrice(bw15, 'personal'))}, фото от ${this.formatCurrency(this.photoPrintPrice(photo10x15, 'personal'))}`,
              },
              {
                audienceId: 'study',
                value: `А4 от ${this.formatCurrency(this.documentPrintPrice(bw15, 'study'))}, фото от ${this.formatCurrency(this.photoPrintPrice(photo10x15, 'study'))}`,
              },
              {
                audienceId: 'business',
                value: `А4 от ${this.formatCurrency(this.documentPrintPrice(bw15, 'business'))}, фото от ${this.formatCurrency(this.photoPrintPrice(photo10x15, 'business'))}`,
              },
            ],
          },
        ],
      },
      {
        title: 'Фотографии, документы и портрет',
        icon: 'photo_camera',
        rows: [
          {
            service: 'Печать фото 10x15',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(this.photoPrintPrice(photo10x15, 'personal')) },
              { audienceId: 'study', value: this.formatFromPrice(this.photoPrintPrice(photo10x15, 'study')) },
              { audienceId: 'business', value: this.formatFromPrice(this.photoPrintPrice(photo10x15, 'business')) },
            ],
          },
          {
            service: 'Печать фото 15x20',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(this.photoPrintPrice(photo15x20, 'personal')) },
              { audienceId: 'study', value: this.formatFromPrice(this.photoPrintPrice(photo15x20, 'study')) },
              { audienceId: 'business', value: this.formatFromPrice(this.photoPrintPrice(photo15x20, 'business')) },
            ],
          },
          {
            service: 'Печать фото 20x30 / А4',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(this.photoPrintPrice(photo20x30, 'personal')) },
              { audienceId: 'study', value: this.formatFromPrice(this.photoPrintPrice(photo20x30, 'study')) },
              { audienceId: 'business', value: this.formatFromPrice(this.photoPrintPrice(photo20x30, 'business')) },
            ],
          },
          {
            service: 'Фото на документы онлайн',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(photoDocsOnline) },
              { audienceId: 'study', value: this.formatFromPrice(photoDocsOnline) },
              { audienceId: 'business', value: this.formatFromPrice(photoDocsOnline) },
            ],
          },
          {
            service: 'Фото на документы в студии',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(photoDocsStudio) },
              { audienceId: 'study', value: this.formatFromPrice(photoDocsStudio) },
              { audienceId: 'business', value: this.formatFromPrice(photoDocsStudio) },
            ],
          },
          {
            service: 'Фото сотрудников для B2B',
            note: 'Пропуска, медкнижки, анкеты, личные дела, школы, вузы, курсы и корпоративные базы.',
            prices: [
              { audienceId: 'personal', value: '-' },
              { audienceId: 'study', value: '-' },
              { audienceId: 'business', value: 'B2B-условия' },
            ],
          },
          {
            service: 'Портретная съёмка',
            prices: [
              { audienceId: 'personal', value: 'от 900 ₽' },
              { audienceId: 'study', value: 'от 900 ₽' },
              { audienceId: 'business', value: 'B2B-условия' },
            ],
          },
          {
            service: 'Индивидуальная выездная фотосъёмка',
            note: 'Выезд к сотруднику или команде, единые требования и передача готовых файлов для базы.',
            prices: [
              { audienceId: 'personal', value: 'по заявке' },
              { audienceId: 'study', value: 'по заявке' },
              { audienceId: 'business', value: 'B2B-условия' },
            ],
          },
        ],
      },
      {
        title: 'Ретушь, реставрация и подготовка фото',
        icon: 'auto_fix_high',
        rows: [
          {
            service: 'Подготовка фото к документам онлайн',
            note: 'Базовая обработка по текущей кассе: фон, формат, лицо, плечи и причёска.',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(photoDocsOnline) },
              { audienceId: 'study', value: this.formatFromPrice(photoDocsOnline) },
              { audienceId: 'business', value: this.formatFromPrice(photoDocsOnline) },
            ],
          },
          {
            service: 'Усиленная обработка фото к документам',
            note: 'Базовая подготовка плюс сложные правки, очки и блики.',
            prices: [
              { audienceId: 'personal', value: this.formatFromPrice(photoDocsExtended) },
              { audienceId: 'study', value: this.formatFromPrice(photoDocsExtended) },
              { audienceId: 'business', value: this.formatFromPrice(photoDocsExtended) },
            ],
          },
          {
            service: 'Реставрация фото',
            prices: [
              { audienceId: 'personal', value: 'от 900 ₽' },
              { audienceId: 'study', value: 'от 900 ₽' },
              { audienceId: 'business', value: 'от 900 ₽' },
            ],
          },
          {
            service: 'Подготовка фото к печати',
            prices: [
              { audienceId: 'personal', value: 'от 250 ₽' },
              { audienceId: 'study', value: 'от 250 ₽' },
              { audienceId: 'business', value: 'от 230 ₽' },
            ],
          },
        ],
      },
    ];
  }

  private printTariffRow(
    service: string,
    note: string,
    price: number,
  ): StartClientTariffRow {
    return {
      service,
      note,
      prices: [
        { audienceId: 'personal', value: this.formatPerSheet(this.documentPrintPrice(price, 'personal')) },
        { audienceId: 'study', value: this.formatPerSheet(this.documentPrintPrice(price, 'study')) },
        { audienceId: 'business', value: this.formatPerSheet(this.documentPrintPrice(price, 'business')) },
      ],
    };
  }

  private printOptionPrice(optionSlug: string, fallback: number): number {
    return this.optionPrice('copy-print', optionSlug, fallback, 'pickup');
  }

  private optionPrice(
    categorySlug: string,
    optionSlug: string,
    fallback: number,
    deliveryMethod: DeliveryMethod,
  ): number {
    const option = this.findOption(categorySlug, optionSlug);
    if (!option) {
      return fallback;
    }

    const price = this.pricingApi.resolveOptionPrice(option, deliveryMethod);
    return Number.isFinite(price) && price > 0 ? price : fallback;
  }

  private findOption(categorySlug: string, optionSlug: string): PricingServiceOption | null {
    const category = this.pricingApi.getCategoryBySlug(categorySlug);
    if (!category) {
      return null;
    }

    for (const group of category.optionGroups) {
      const option = group.options.find((candidate) => candidate.slug === optionSlug);
      if (option) {
        return option;
      }
    }

    return null;
  }

  private documentPrintPrice(price: number, audienceId: StartClientAudienceId): number {
    return this.discountedPrice(price, START_CLIENT_DOCUMENT_PRINT_DISCOUNTS[audienceId]);
  }

  private photoPrintPrice(price: number, audienceId: StartClientAudienceId): number {
    return this.discountedPrice(price, START_CLIENT_PHOTO_PRINT_DISCOUNTS[audienceId]);
  }

  private discountedPrice(price: number, discountPercent: number): number {
    const discountMultiplier = 1 - discountPercent / 100;
    return Math.max(1, Math.round(price * discountMultiplier));
  }

  private formatPerSheet(price: number): string {
    return `${this.formatCurrency(price)}/лист`;
  }

  private formatFromPrice(price: number): string {
    return `от ${this.formatCurrency(price)}`;
  }

  private formatCurrency(price: number): string {
    return `${Math.round(price).toLocaleString('ru-RU')} ₽`;
  }

  private fullPhone(): string {
    return `7${this.phoneDigits()}`;
  }

  private buildPhoneProfile(): PhoneAuthProfileInput {
    const firstName = this.firstName().trim();
    const lastName = this.lastName().trim();

    return {
      displayName: `${lastName} ${firstName}`.trim(),
      firstName,
      lastName,
      dateOfBirth: this.birthDate(),
    };
  }

  private birthDateValid(): boolean {
    const date = this.birthDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return false;
    }

    return date >= '1900-01-01' && date <= this.maxBirthDate;
  }

  private redirectAfterAuth(): void {
    void this.authChatService.linkUserAfterAuth();
    void this.router.navigateByUrl(
      this.authService.getPostAuthRedirectUrl(this.selectedAudience().returnUrl),
    );
  }

  private startAuthCountdown(seconds: number): void {
    this.stopAuthCountdown();
    this.authCountdown.set(Math.max(0, seconds || 60));
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.authCountdownTimer = setInterval(() => {
      const next = Math.max(0, this.authCountdown() - 1);
      this.authCountdown.set(next);
      if (next === 0) {
        this.stopAuthCountdown();
      }
    }, 1000);
  }

  private stopAuthCountdown(): void {
    if (this.authCountdownTimer) {
      clearInterval(this.authCountdownTimer);
      this.authCountdownTimer = null;
    }
  }

  private focusCurrentFormInput(): void {
    if (this.selectedClientMode() === 'existing') {
      this.focusPhoneInput();
      return;
    }

    this.focusLastNameInput();
  }

  private focusLastNameInput(): void {
    this.scheduleBrowserFrame(() => {
      this.clientLastNameInputRef()?.nativeElement.focus();
    });
  }

  private focusPhoneInput(): void {
    this.scheduleBrowserFrame(() => {
      this.clientPhoneInputRef()?.nativeElement.focus();
    });
  }

  private focusCodeInput(): void {
    this.scheduleBrowserFrame(() => {
      this.clientCodeInputRef()?.nativeElement.focus();
    });
  }

  private scrollToAccess(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.scheduleBrowserFrame(() => {
      this.document.getElementById('start-client-access')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  private scheduleBrowserFrame(callback: () => void): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    requestAnimationFrame(callback);
  }

  private setupSeo(): void {
    const title = 'Стать клиентом Своё Фото | Тарифы для себя, учёбы и бизнеса';
    const description =
      'Выберите предложения Своё Фото для себя, учёбы или бизнеса: печать документов А4 по заливке, печать фотографий, фото на документы, портрет, ретушь и реставрация.';

    this.seo.clearJsonLd();
    this.seo.updateCanonicalUrl('/start-client');
    this.seo.updateTitle(title);
    this.seo.updateDescription(description);
    this.seo.setOpenGraph(
      title,
      description,
      START_CLIENT_OG_IMAGE,
      'website',
      'https://svoefoto.ru/start-client',
    );
    this.seo.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Тарифы Своё Фото для клиентов',
      itemListElement: this.tariffGroups().map((group, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: group.title,
      })),
    });
  }
}
