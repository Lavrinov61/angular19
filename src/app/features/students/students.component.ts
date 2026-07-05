import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router, RouterLink } from '@angular/router';
import { firstValueFrom, timeout } from 'rxjs';
import { AuthChatService } from '../../core/services/auth-chat.service';
import { AuthService, type PhoneAuthProfileInput } from '../../core/services/auth.service';
import {
  DOCUMENT_ACCEPT,
  EDUCATION_DOCUMENT_HINTS,
  EDUCATION_ROLE_OPTIONS,
  validateEducationDocumentFile,
} from '../../core/constants/education-document';
import {
  StudentVerificationService,
  type EducationRole,
  type StudentVerificationStatusPayload,
} from '../../core/services/student-verification.service';
import { SiteMobileMenuComponent } from '../../core/components/site-mobile-menu/site-mobile-menu.component';
import { SeoService } from '../../core/services/seo.service';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

type EducationClientMode = 'existing' | 'new';
type EducationAuthStep = 'form' | 'code' | 'document' | 'done';
type DocStatusKind = 'form' | 'pending' | 'verified' | 'revoked';

/** Строка таблицы сравнения тарифов: одна возможность в двух колонках. */
interface EducationCompareRow {
  readonly icon: string;
  readonly label: string;
  /** Значение для тарифа «Без подписки» (только подтверждённый статус). */
  readonly free: string;
  /** Значение для тарифа «С подпиской» (199 ₽/мес). */
  readonly sub: string;
}

interface EducationFaq {
  readonly question: string;
  readonly answer: string;
}

const ASSET_PATH = '/assets/static/education-smart';
const EDUCATION_RETURN_URL = '/user-profile/education';
const EDUCATION_PHONE_MASK = '(___) ___-__-__';
const EDUCATION_OTP_LENGTH = 4;

function maskEducationPhone(digits: string): string {
  const sliced = digits.slice(0, 10);
  let result = '';
  let digitIndex = 0;

  for (let i = 0; i < EDUCATION_PHONE_MASK.length; i += 1) {
    if (EDUCATION_PHONE_MASK[i] === '_') {
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

    result += EDUCATION_PHONE_MASK[i];
  }

  return result;
}

function cursorAfterEducationPhoneDigits(masked: string, digitCount: number): number {
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

function extractEducationPhoneDigits(value: string): string {
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

function readEducationAuthError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    return (
      readObjectStringProperty(error, 'error') ??
      readObjectStringProperty(error, 'message') ??
      fallback
    );
  }

  return fallback;
}

const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;

function readHttpStatus(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'status');
    const candidate = descriptor?.value;
    return typeof candidate === 'number' ? candidate : null;
  }

  return null;
}

// Цены: ч/б А4 база 10 ₽ → −70 % (с подпиской) = 3 ₽, −50 % (без подписки) = 5 ₽.
// Цветной А4: −70 % = 4 ₽, −50 % ≈ 7 ₽. Премиум-фото и переплёт берём как на текущей странице.
// Лимиты одинаковые на обоих тарифах: 100 документов + 100 фото / 30 дней.
const COMPARE_ROWS: readonly EducationCompareRow[] = [
  {
    icon: 'description',
    label: 'Ч/б документ А4',
    free: '5 ₽',
    sub: '3 ₽',
  },
  {
    icon: 'palette',
    label: 'Цветной документ А4',
    free: '7 ₽',
    sub: '4 ₽',
  },
  {
    icon: 'photo_camera',
    label: 'Премиум-фото до А4',
    free: 'от 14 ₽',
    sub: 'от 10 ₽',
  },
  {
    icon: 'menu_book',
    label: 'Переплёт А4 на пружину',
    free: '10 ₽',
    sub: '10 ₽',
  },
  {
    icon: 'badge',
    label: 'Фото на студенческий, 4 комплекта по 6 штук',
    free: 'один раз',
    sub: 'каждый месяц',
  },
] as const;

const FAQ_ITEMS: readonly EducationFaq[] = [
  {
    question: 'Кому подходит образовательный доступ?',
    answer:
      'Студентам, абитуриентам, учителям, преподавателям и сотрудникам учебных заведений. Подходит всем, кто может подтвердить статус документом.',
  },
  {
    question: 'Какими документами можно подтвердить статус?',
    answer:
      'Студентам: студенческим билетом, зачётной книжкой или справкой об обучении. Абитуриентам: справкой или приказом о зачислении, распиской приёмной комиссии, скриншотом заявления «Поступление в вуз онлайн» на Госуслугах, аттестатом или справкой из школы. Педагогам: удостоверением или справкой с работы. Главное, чтобы было видно ФИО.',
  },
  {
    question: 'Что такое «Фото на студенческий, 4 комплекта по 6 штук»?',
    answer:
      'После подтверждения образовательного статуса доступен пакет «Фото на студенческий»: 4 комплекта, в каждом по 6 фотографий. Один комплект стоит 200 ₽, все четыре вместе 800 ₽. Без подписки пакет даётся один раз, с подпиской обновляется каждый месяц. Оплатить можно на кассе или по ссылке, которую пришлёт студия.',
  },
  {
    question: 'Нужен ли паспорт?',
    answer:
      'Нет, паспорт не нужен. На фото оставьте только ФИО, учебное заведение и срок действия, остальное можно скрыть.',
  },
  {
    question: 'Обязательно ли оформлять подписку?',
    answer:
      'Нет. После подтверждения статуса печать уже дешевле и без подписки: ч/б документ А4 за 5 ₽, цветной за 7 ₽. Подписка за 199 ₽ в месяц (или 1999 ₽ за год, экономия 389 ₽) опускает цены ещё ниже: ч/б за 3 ₽, цветной за 4 ₽, премиум-фото от 10 ₽. Первый платёж проходит только после проверки, отменить можно в кабинете.',
  },
  {
    question: 'Почему так дёшево?',
    answer:
      'Это специальная цена для студентов и преподавателей, самая низкая в стране. Таких цен больше нигде нет. Ч/б документ А4 стоит 5 ₽ после подтверждения статуса и 3 ₽ с подпиской.',
  },
  {
    question: 'Зачем нужна подписка?',
    answer:
      'Подписка помогает нам закупать бумагу заранее под объём студентов.',
  },
  {
    question: 'Есть ли лимиты на печать?',
    answer:
      'Да, лимит есть, но его хватает с запасом даже для самой требовательной учёбы: 100 страниц А4 и 100 фотографий за 30 дней.',
  },
  {
    question: 'Почему вы просите документ о статусе?',
    answer:
      'Образовательная цена доступна только учащимся, абитуриентам и преподавателям, поэтому мы просим документ, который подтверждает статус. Подойдёт студенческий, справка об обучении, удостоверение педагога, а для абитуриента, справка о зачислении, расписка приёмной комиссии, скрин Госуслуг или аттестат.',
  },
] as const;

@Component({
  selector: 'app-students',
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
    SiteMobileMenuComponent,
    ScrollRevealDirective,
  ],
  templateUrl: './students.component.html',
  styleUrl: './students.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'students-page',
    'attr.data-section': 'public',
  },
})
export class StudentsComponent implements OnInit {
  private readonly educationLastNameInputRef =
    viewChild<ElementRef<HTMLInputElement>>('educationLastNameInput');
  private readonly educationPhoneInputRef =
    viewChild<ElementRef<HTMLInputElement>>('educationPhoneInput');
  private readonly educationCodeInputRef =
    viewChild<ElementRef<HTMLInputElement>>('educationCodeInput');
  private readonly educationDocInstitutionInputRef =
    viewChild<ElementRef<HTMLInputElement>>('educationDocInstitutionInput');

  private readonly authService = inject(AuthService);
  private readonly authChatService = inject(AuthChatService);
  private readonly studentVerification = inject(StudentVerificationService);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private educationAuthCountdownTimer: ReturnType<typeof setInterval> | null = null;
  private chatLinked = false;

  protected readonly loginQueryParams = {
    returnUrl: EDUCATION_RETURN_URL,
  } as const;

  protected readonly educationAuthLoading = this.authService.isLoading;
  protected readonly compareRows = COMPARE_ROWS;
  protected readonly faqs = FAQ_ITEMS;
  protected readonly selectedEducationClientMode =
    signal<EducationClientMode>('existing');
  protected readonly educationAuthStep = signal<EducationAuthStep>('form');
  protected readonly educationLastName = signal('');
  protected readonly educationFirstName = signal('');
  protected readonly educationBirthDate = signal('');
  protected readonly educationPhoneDigits = signal('');
  protected readonly educationCode = signal('');
  protected readonly educationAuthError = signal<string | null>(null);
  protected readonly educationAuthRequesting = signal(false);
  protected readonly educationAuthCountdown = signal(0);
  protected readonly mobileMenuOpen = signal(false);
  protected readonly stickyCtaVisible = signal(false);
  protected readonly educationMaskedPhone = computed(() =>
    maskEducationPhone(this.educationPhoneDigits()),
  );
  protected readonly educationFormattedPhone = computed(() => {
    const masked = this.educationMaskedPhone();
    return masked ? `+7 ${masked}` : '+7';
  });
  protected readonly educationPhoneValid = computed(() =>
    this.educationPhoneDigits().length === 10,
  );
  protected readonly educationCodeValid = computed(() =>
    this.educationCode().length === EDUCATION_OTP_LENGTH,
  );
  protected readonly educationClientDataValid = computed(() =>
    this.educationLastName().trim().length >= 2 &&
    this.educationFirstName().trim().length >= 2 &&
    this.educationBirthDateValid(),
  );
  protected readonly educationFormValid = computed(() => {
    if (!this.educationPhoneValid()) {
      return false;
    }

    return (
      this.selectedEducationClientMode() === 'existing' ||
      this.educationClientDataValid()
    );
  });
  protected readonly canResendEducationCode = computed(() =>
    this.educationAuthCountdown() <= 0 && !this.educationAuthRequesting(),
  );

  protected readonly educationDocRoleOptions = EDUCATION_ROLE_OPTIONS;
  protected readonly educationDocAccept = DOCUMENT_ACCEPT;
  protected readonly educationDocRole = signal<EducationRole>('student');
  protected readonly educationDocInstitution = signal('');
  protected readonly educationDocFile = signal<File | null>(null);
  protected readonly educationDocSubmitting = signal(false);
  protected readonly educationDocError = signal<string | null>(null);
  protected readonly educationDocStatusKind = signal<DocStatusKind>('form');
  protected readonly educationDocLoadingStatus = signal(false);
  protected readonly educationDocHint = computed(
    () => EDUCATION_DOCUMENT_HINTS[this.educationDocRole()],
  );
  protected readonly educationDocFileName = computed(
    () => this.educationDocFile()?.name ?? 'Выбрать фото документа',
  );
  protected readonly educationDocFormValid = computed(
    () => this.educationDocInstitution().trim().length >= 2 && !!this.educationDocFile(),
  );

  constructor() {
    afterNextRender(() => this.setupStickyCtaVisibility());
    this.destroyRef.onDestroy(() => this.stopEducationAuthCountdown());
  }

  ngOnInit(): void {
    this.setupSeo();
  }

  protected selectEducationClientMode(mode: EducationClientMode): void {
    if (this.selectedEducationClientMode() === mode) {
      return;
    }

    this.selectedEducationClientMode.set(mode);
    this.educationAuthStep.set('form');
    this.educationCode.set('');
    this.educationAuthError.set(null);
    this.stopEducationAuthCountdown();
    this.focusCurrentEducationFormInput();
  }

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  protected scrollToConnect(event: Event): void {
    event.preventDefault();
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.document
      .getElementById('education-access-connect')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected onEducationLastNameInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.educationLastName.set(input.value);
    this.educationAuthError.set(null);
  }

  protected onEducationFirstNameInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.educationFirstName.set(input.value);
    this.educationAuthError.set(null);
  }

  protected onEducationBirthDateInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.educationBirthDate.set(input.value);
    this.educationAuthError.set(null);
  }

  protected onEducationPhoneInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const digits = extractEducationPhoneDigits(input.value);
    this.educationPhoneDigits.set(digits);
    this.educationAuthError.set(null);
    this.scheduleBrowserFrame(() => {
      const masked = this.educationMaskedPhone();
      input.value = masked;
      const position = cursorAfterEducationPhoneDigits(masked, digits.length);
      input.setSelectionRange(position, position);
    });
  }

  protected onEducationPhonePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const input = event.target;
    const digits = extractEducationPhoneDigits(event.clipboardData?.getData('text') ?? '');
    this.educationPhoneDigits.set(digits);
    this.educationAuthError.set(null);

    if (input instanceof HTMLInputElement) {
      this.scheduleBrowserFrame(() => {
        const masked = this.educationMaskedPhone();
        input.value = masked;
        const position = cursorAfterEducationPhoneDigits(masked, digits.length);
        input.setSelectionRange(position, position);
      });
    }
  }

  protected onEducationPhoneKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();
    this.requestEducationPhoneCode();
  }

  protected clearEducationPhone(): void {
    this.educationPhoneDigits.set('');
    this.educationAuthError.set(null);
    this.focusEducationPhoneInput();
  }

  protected onEducationCodeInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const digits = input.value.replace(/\D/g, '').slice(0, EDUCATION_OTP_LENGTH);
    input.value = digits;
    this.educationCode.set(digits);
    this.educationAuthError.set(null);
  }

  protected requestEducationPhoneCode(): void {
    if (this.educationAuthRequesting()) {
      return;
    }

    if (!this.educationFormValid()) {
      const clientMode = this.selectedEducationClientMode();

      if (
        clientMode === 'new' &&
        !this.educationPhoneValid() &&
        !this.educationClientDataValid()
      ) {
        this.educationAuthError.set('Заполните данные и номер телефона.');
        this.focusCurrentEducationFormInput();
        return;
      }

      if (!this.educationPhoneValid()) {
        this.educationAuthError.set('Введите номер телефона.');
        this.focusEducationPhoneInput();
        return;
      }

      this.educationAuthError.set('Заполните фамилию, имя и дату рождения.');
      this.focusEducationLastNameInput();
      return;
    }

    this.educationAuthError.set(null);
    this.educationAuthRequesting.set(true);

    this.authService.requestPhoneCode(this.educationFullPhone()).subscribe({
      next: (response) => {
        this.educationAuthRequesting.set(false);
        this.educationCode.set('');
        this.educationAuthStep.set('code');
        this.startEducationAuthCountdown(response.expiresIn);
        this.focusEducationCodeInput();
      },
      error: (error: unknown) => {
        this.educationAuthRequesting.set(false);
        this.educationAuthError.set(
          readEducationAuthError(error, 'Не удалось запустить звонок. Попробуйте позже.'),
        );
      },
    });
  }

  protected verifyEducationPhoneCode(): void {
    if (!this.educationCodeValid() || this.educationAuthLoading()) {
      return;
    }

    this.educationAuthError.set(null);

    const profile = this.selectedEducationClientMode() === 'new'
      ? this.buildEducationPhoneProfile()
      : undefined;

    this.authService.verifyPhoneCode(
      this.educationFullPhone(),
      this.educationCode(),
      false,
      profile,
    ).subscribe({
      next: (response) => {
        if (response.requiresProfile) {
          this.selectedEducationClientMode.set('new');
          this.educationAuthStep.set('form');
          this.educationCode.set('');
          this.stopEducationAuthCountdown();
          this.educationAuthError.set(
            response.isNewUser
              ? 'Мы не нашли клиента с этим телефоном. Заполните данные, чтобы стать клиентом.'
              : 'В профиле не хватает данных. Заполните фамилию, имя и дату рождения.',
          );
          this.focusEducationLastNameInput();
          return;
        }

        this.enterDocumentStep();
      },
      error: (error: unknown) => {
        this.educationAuthError.set(
          readEducationAuthError(error, 'Неверный код. Попробуйте ещё раз.'),
        );
      },
    });
  }

  protected backToEducationForm(): void {
    this.educationAuthStep.set('form');
    this.educationCode.set('');
    this.educationAuthError.set(null);
    this.stopEducationAuthCountdown();
    this.focusCurrentEducationFormInput();
  }

  protected resendEducationCode(): void {
    if (!this.canResendEducationCode()) {
      return;
    }

    this.requestEducationPhoneCode();
  }

  private educationFullPhone(): string {
    return `7${this.educationPhoneDigits()}`;
  }

  private buildEducationPhoneProfile(): PhoneAuthProfileInput {
    const firstName = this.educationFirstName().trim();
    const lastName = this.educationLastName().trim();

    return {
      displayName: `${lastName} ${firstName}`.trim(),
      firstName,
      lastName,
      dateOfBirth: this.educationBirthDate(),
    };
  }

  private educationBirthDateValid(): boolean {
    const date = this.educationBirthDate();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return false;
    }

    const year = Number(date.slice(0, 4));
    const currentYear = new Date().getFullYear();
    return year >= 1900 && year <= currentYear;
  }

  protected goToCabinet(): void {
    this.redirectAfterEducationAuth();
  }

  protected onEducationDocRoleChange(event: Event): void {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement)) {
      return;
    }

    this.educationDocRole.set(select.value as EducationRole);
    this.educationDocError.set(null);
  }

  protected onEducationDocInstitutionInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.educationDocInstitution.set(input.value);
    this.educationDocError.set(null);
  }

  protected onEducationDocFileSelected(event: Event): void {
    const input = event.target;
    this.educationDocError.set(null);

    const file = input instanceof HTMLInputElement ? input.files?.[0] ?? null : null;
    if (!file) {
      this.educationDocFile.set(null);
      return;
    }

    const result = validateEducationDocumentFile(file);
    if (!result.ok) {
      this.educationDocFile.set(null);
      this.educationDocError.set(result.message);
      return;
    }

    this.educationDocFile.set(result.file);
  }

  private ensureChatLinked(): void {
    if (this.chatLinked) {
      return;
    }

    void this.authChatService.linkUserAfterAuth();
    this.chatLinked = true;
  }

  private redirectAfterEducationAuth(): void {
    this.ensureChatLinked();
    void this.router.navigateByUrl(
      this.authService.getPostAuthRedirectUrl(EDUCATION_RETURN_URL),
    );
  }

  protected async submitDocumentUpload(): Promise<void> {
    if (!this.educationDocFormValid() || this.educationDocSubmitting()) {
      return;
    }

    this.educationDocError.set(null);
    this.educationDocSubmitting.set(true);

    const file = this.educationDocFile();
    if (!file) {
      this.educationDocSubmitting.set(false);
      return;
    }

    try {
      const upload = await firstValueFrom(this.studentVerification.presign(file));
      await firstValueFrom(this.studentVerification.uploadFile(upload, file));
      await firstValueFrom(
        this.studentVerification.completeUpload({
          upload,
          file,
          educationRole: this.educationDocRole(),
          institutionName: this.educationDocInstitution().trim(),
          documentExpiresAt: null,
        }),
      );
      this.educationAuthStep.set('done');
    } catch (error: unknown) {
      this.educationDocError.set(this.readDocUploadError(error));
    } finally {
      this.educationDocSubmitting.set(false);
    }
  }

  private enterDocumentStep(): void {
    this.educationAuthStep.set('document');
    this.ensureChatLinked();
    this.stopEducationAuthCountdown();
    this.educationDocError.set(null);

    if (!isPlatformBrowser(this.platformId)) {
      this.educationDocStatusKind.set('form');
      return;
    }

    this.educationDocLoadingStatus.set(true);
    this.studentVerification
      .loadMine()
      .pipe(timeout(4000), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (payload) => {
          const kind = this.resolveDocStatusKind(payload);
          this.educationDocStatusKind.set(kind);
          this.educationDocLoadingStatus.set(false);
          if (kind === 'form') {
            this.focusEducationDocInstitutionInput();
          }
        },
        error: () => {
          // fail-open: при таймауте или ошибке статуса показываем форму и не блокируем воронку.
          this.educationDocStatusKind.set('form');
          this.educationDocLoadingStatus.set(false);
          this.focusEducationDocInstitutionInput();
        },
      });
  }

  private resolveDocStatusKind(payload: StudentVerificationStatusPayload): DocStatusKind {
    if (payload.account?.status === 'verified') {
      return 'verified';
    }
    if (payload.account?.status === 'revoked') {
      return 'revoked';
    }
    if (
      payload.account?.status === 'pending' ||
      payload.latest_verification?.status === 'pending'
    ) {
      return 'pending';
    }

    // rejected или expired: даём подать документ заново.
    return 'form';
  }

  private readDocUploadError(error: unknown): string {
    const status = readHttpStatus(error);
    if (status === HTTP_CONFLICT) {
      return 'Заявка уже на проверке. Дождитесь ответа в личном кабинете.';
    }
    if (status === HTTP_FORBIDDEN) {
      return 'Образовательный статус отозван. Обратитесь к сотруднику.';
    }

    return readEducationAuthError(error, 'Не удалось отправить документ. Попробуйте ещё раз.');
  }

  private startEducationAuthCountdown(seconds: number): void {
    this.stopEducationAuthCountdown();
    this.educationAuthCountdown.set(Math.max(0, seconds || 60));
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.educationAuthCountdownTimer = setInterval(() => {
      const next = Math.max(0, this.educationAuthCountdown() - 1);
      this.educationAuthCountdown.set(next);
      if (next === 0) {
        this.stopEducationAuthCountdown();
      }
    }, 1000);
  }

  private stopEducationAuthCountdown(): void {
    if (this.educationAuthCountdownTimer) {
      clearInterval(this.educationAuthCountdownTimer);
      this.educationAuthCountdownTimer = null;
    }
  }

  private focusCurrentEducationFormInput(): void {
    if (this.selectedEducationClientMode() === 'existing') {
      this.focusEducationPhoneInput();
      return;
    }

    this.focusEducationLastNameInput();
  }

  private focusEducationLastNameInput(): void {
    this.scheduleBrowserFrame(() => {
      this.educationLastNameInputRef()?.nativeElement.focus();
    });
  }

  private focusEducationPhoneInput(): void {
    this.scheduleBrowserFrame(() => {
      this.educationPhoneInputRef()?.nativeElement.focus();
    });
  }

  private focusEducationCodeInput(): void {
    this.scheduleBrowserFrame(() => {
      this.educationCodeInputRef()?.nativeElement.focus();
    });
  }

  private focusEducationDocInstitutionInput(): void {
    this.scheduleBrowserFrame(() => {
      this.educationDocInstitutionInputRef()?.nativeElement.focus();
    });
  }

  private scheduleBrowserFrame(callback: () => void): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    requestAnimationFrame(callback);
  }

  private setupStickyCtaVisibility(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const scrollContainerElement = this.document.querySelector(
      '.mat-drawer-content',
    );
    const scrollContainer = scrollContainerElement instanceof HTMLElement
      ? scrollContainerElement
      : null;
    const scrollTarget: HTMLElement | Window = scrollContainer ?? window;

    const updateVisibility = () => {
      const viewportHeight = scrollContainer?.clientHeight ?? window.innerHeight;
      const scrollTop = scrollContainer?.scrollTop ?? window.scrollY;
      this.stickyCtaVisible.set(scrollTop > Math.max(420, viewportHeight * 0.72));
    };

    scrollTarget.addEventListener('scroll', updateVisibility, { passive: true });
    window.addEventListener('resize', updateVisibility, { passive: true });
    updateVisibility();

    this.destroyRef.onDestroy(() => {
      scrollTarget.removeEventListener('scroll', updateVisibility);
      window.removeEventListener('resize', updateVisibility);
    });
  }

  private setupSeo(): void {
    const title =
      'Печать А4 за 3 ₽ и доступ за 199 ₽/мес | Образовательный доступ «Своё Фото»';
    const description =
      'Образовательный доступ для студентов и преподавателей: документы А4 за 3 ₽, переплёт за 10 ₽ и премиум-фотопечать вдвое дешевле. Доступ 199 ₽/мес.';

    this.seo.clearJsonLd();
    this.seo.updateCanonicalUrl('/education');
    this.seo.updateTitle(title);
    this.seo.updateDescription(description);
    this.seo.setOpenGraph(
      title,
      description,
      `${ASSET_PATH}/education-hero.webp`,
      'website',
      'https://svoefoto.ru/education',
    );
    this.seo.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: faq.answer,
        },
      })),
    });
  }
}
