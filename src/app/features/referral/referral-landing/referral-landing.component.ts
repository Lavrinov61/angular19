import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { of, switchMap } from 'rxjs';

import { AuthChatService } from '../../../core/services/auth-chat.service';
import { AuthService, type PhoneAuthProfileInput } from '../../../core/services/auth.service';
import { SeoService } from '../../../core/services/seo.service';

type ReferralAudience = 'new' | 'client';
type ReferralInfoTab = 'faq' | 'terms';
type ReferralRegistrationStep = 'details' | 'code' | 'done';

interface ReferralStep {
  number: string;
  title: string;
  description: string;
  cta?: string;
  link?: string;
}

interface ReferralProductCard {
  title: string;
  description: string;
  icon: string;
  link: string;
  reward: string;
  activation: string;
  tone: 'red' | 'sky' | 'mint' | 'violet' | 'peach' | 'blue';
}

interface ReferralReview {
  name: string;
  text: string;
  date: string;
  tag: string;
}

interface ReferralFaqItem {
  question: string;
  answer: string;
}

interface ReferralTermItem {
  icon: string;
  title: string;
  description: string;
}

function normalizeRussianPhone(value: string): string {
  let digits = value.replace(/\D/g, '');

  if (digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `7${digits}`;
  }

  return digits.slice(0, 11);
}

function isValidRussianPhone(value: string): boolean {
  return /^7\d{10}$/.test(value);
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function readErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') {
    return error;
  }

  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const record = error as Record<string, unknown>;
  const errorField = record['error'];
  const messageField = record['message'];

  if (typeof errorField === 'string') {
    return errorField;
  }

  if (errorField && typeof errorField === 'object') {
    const nested = errorField as Record<string, unknown>;
    if (typeof nested['message'] === 'string') {
      return nested['message'];
    }
    if (typeof nested['error'] === 'string') {
      return nested['error'];
    }
  }

  if (typeof messageField === 'string') {
    return messageField;
  }

  return fallback;
}

@Component({
  selector: 'app-referral-landing',
  imports: [RouterLink, ReactiveFormsModule, MatIconModule],
  templateUrl: './referral-landing.component.html',
  styleUrl: './referral-landing.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferralLandingComponent implements OnInit {
  private readonly authChatService = inject(AuthChatService);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);

  protected readonly audience = signal<ReferralAudience>('new');
  protected readonly infoTab = signal<ReferralInfoTab>('faq');
  protected readonly activeFaqIndex = signal<number | null>(0);
  protected readonly registrationStep = signal<ReferralRegistrationStep>('details');
  protected readonly registrationLoading = signal(false);
  protected readonly registrationError = signal<string | null>(null);
  protected readonly registrationPhone = signal('');
  protected readonly minBirthDate = '1900-01-01';
  protected readonly maxBirthDate = formatDateInputValue(new Date());

  protected readonly registrationForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    dateOfBirth: ['', [Validators.required, Validators.pattern(/^\d{4}-\d{2}-\d{2}$/)]],
    phone: ['', [Validators.required]],
    consent: [false, [Validators.requiredTrue]],
  });

  protected readonly codeForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(4)]],
  });

  protected readonly steps: readonly ReferralStep[] = [
    {
      number: '1',
      title: 'Оформите профиль',
      description: 'Введите данные и телефон, подтвердите кодом звонка и получите личную ссылку в разделе бонусов.',
      cta: 'Рекомендовать',
      link: '#registration',
    },
    {
      number: '2',
      title: 'Отправьте ссылку',
      description: 'Поделитесь ею с другом в мессенджере, соцсетях или прямо в чате.',
    },
    {
      number: '3',
      title: 'Получите до 5 000 ₽',
      description: 'После активации подписки начислим бонусы на счёт: 1 бонус = 1 ₽, списывать можно до 15% суммы заказа.',
    },
  ];

  protected readonly productCards: readonly ReferralProductCard[] = [
    {
      title: 'Личная подписка',
      description: 'Для документов, печати фото и регулярных личных заказов',
      icon: 'person',
      link: '/personal',
      reward: 'до 5 000 ₽',
      activation: 'подписка',
      tone: 'red',
    },
    {
      title: 'Образовательная подписка',
      description: 'Для школьников, студентов, преподавателей и учебных сотрудников',
      icon: 'school',
      link: '/education',
      reward: 'до 5 000 ₽',
      activation: 'подписка',
      tone: 'mint',
    },
    {
      title: 'Бизнес-аккаунт',
      description: 'Для команд, ИП и организаций с реквизитами, счетами и регулярной печатью',
      icon: 'business_center',
      link: '/business',
      reward: 'до 5 000 ₽',
      activation: 'B2B-доступ',
      tone: 'blue',
    },
  ];

  protected readonly reviews: readonly ReferralReview[] = [
    {
      name: 'Марина',
      text: 'Отправила ссылку сестре, она активировала личную подписку для документов и фото. На счёт пришли 5 000 бонусов без переписок с поддержкой.',
      date: '12 мая',
      tag: 'Личная подписка',
    },
    {
      name: 'Алексей',
      text: 'Рекомендовал Своё Фото знакомому преподавателю. Он оформил образовательную подписку, начисление пришло после активации, теперь списываю бонусы на заказы.',
      date: '7 мая',
      tag: 'Образовательная подписка',
    },
  ];

  protected readonly faqItems: readonly ReferralFaqItem[] = [
    {
      question: 'Где взять индивидуальную ссылку?',
      answer: 'Войдите в профиль и откройте раздел «Бонусы». Там есть ваша ссылка, кнопка копирования и быстрые варианты отправки.',
    },
    {
      question: 'Что должен сделать друг?',
      answer: 'Друг переходит по ссылке, создаёт профиль и активирует личный, образовательный или бизнес-доступ.',
    },
    {
      question: 'Когда мне начислят до 5 000 ₽?',
      answer: 'Начисление появляется после того, как приглашённый друг активирует личный, образовательный или бизнес-доступ. Историю бонусов можно посмотреть в профиле.',
    },
    {
      question: 'Как можно потратить бонусы?',
      answer: 'Бонусами можно оплатить до 15% суммы заказа. Курс простой: 1 бонус = 1 ₽.',
    },
    {
      question: 'Сколько друзей можно пригласить?',
      answer: 'Жёсткого лимита на приглашения нет. Для каждого друга условие одно: новый аккаунт должен активировать одну из подписок.',
    },
    {
      question: 'Может ли друг потом тоже приглашать?',
      answer: 'Да. После создания профиля у друга появится собственная ссылка, и он сможет рекомендовать Своё Фото дальше.',
    },
  ];

  protected readonly termItems: readonly ReferralTermItem[] = [
    {
      icon: 'verified',
      title: 'Бонусы на счёте',
      description: 'Начисляем до 5 000 бонусов за друга. 1 бонус = 1 ₽, история видна в профиле.',
    },
    {
      icon: 'receipt_long',
      title: 'После активации доступа',
      description: 'Вознаграждение начисляется, когда приглашённый клиент активировал личный, образовательный или бизнес-доступ.',
    },
    {
      icon: 'percent',
      title: 'Списание до 15%',
      description: 'Бонусами можно оплатить часть будущих заказов: до 15% от суммы каждого заказа.',
    },
  ];

  ngOnInit(): void {
    this.setupSeo();
  }

  protected setAudience(nextAudience: ReferralAudience): void {
    this.audience.set(nextAudience);
  }

  protected setInfoTab(nextTab: ReferralInfoTab): void {
    this.infoTab.set(nextTab);
  }

  protected toggleFaq(index: number): void {
    this.activeFaqIndex.update((current) => current === index ? null : index);
  }

  protected submitRegistrationForm(): void {
    if (this.registrationLoading()) {
      return;
    }

    if (this.registrationForm.invalid) {
      this.registrationForm.markAllAsTouched();
      return;
    }

    const raw = this.registrationForm.getRawValue();
    const phone = normalizeRussianPhone(raw.phone);

    if (!isValidRussianPhone(phone)) {
      this.registrationForm.controls.phone.setErrors({ phone: true });
      this.registrationForm.controls.phone.markAsTouched();
      this.registrationError.set('Введите российский номер телефона в формате +7.');
      return;
    }

    this.registrationError.set(null);
    this.registrationLoading.set(true);
    this.registrationPhone.set(phone);

    this.authService.requestPhoneCode(phone).subscribe({
      next: () => {
        this.registrationLoading.set(false);
        this.registrationStep.set('code');
        this.codeForm.reset();
      },
      error: (error: unknown) => {
        this.registrationLoading.set(false);
        this.registrationError.set(readErrorMessage(error, 'Не удалось отправить код. Попробуйте ещё раз.'));
      },
    });
  }

  protected submitRegistrationCode(): void {
    if (this.registrationLoading()) {
      return;
    }

    if (this.codeForm.invalid) {
      this.codeForm.markAllAsTouched();
      return;
    }

    const phone = this.registrationPhone() || normalizeRussianPhone(this.registrationForm.controls.phone.value);
    if (!isValidRussianPhone(phone)) {
      this.registrationStep.set('details');
      this.registrationError.set('Проверьте номер телефона и запросите код ещё раз.');
      return;
    }

    const code = this.codeForm.controls.code.value;
    const firstName = this.registrationForm.controls.displayName.value.trim();
    const lastName = this.registrationForm.controls.lastName.value.trim();
    const profile: PhoneAuthProfileInput = {
      displayName: `${firstName} ${lastName}`.trim(),
      firstName,
      lastName,
      dateOfBirth: this.registrationForm.controls.dateOfBirth.value,
    };

    this.registrationError.set(null);
    this.registrationLoading.set(true);

    this.authService.verifyPhoneCode(phone, code).pipe(
      switchMap((result) => {
        if (result.requiresProfile) {
          return this.authService.verifyPhoneCode(phone, code, false, profile);
        }
        return of(result);
      }),
    ).subscribe({
      next: (result) => {
        this.registrationLoading.set(false);

        if (result.requiresProfile) {
          this.registrationError.set('Введите имя, фамилию и дату рождения, чтобы завершить регистрацию.');
          this.registrationStep.set('details');
          return;
        }

        this.registrationStep.set('done');
        void this.authChatService.linkUserAfterAuth();
        void this.router.navigateByUrl('/user-profile/loyalty');
      },
      error: (error: unknown) => {
        this.registrationLoading.set(false);
        this.registrationError.set(readErrorMessage(error, 'Неверный код. Попробуйте ещё раз.'));
      },
    });
  }

  protected editRegistrationPhone(): void {
    if (this.registrationLoading()) {
      return;
    }

    this.registrationStep.set('details');
    this.registrationError.set(null);
  }

  protected onRegistrationCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = digits;
    this.codeForm.controls.code.setValue(digits, { emitEvent: false });
    this.registrationError.set(null);
  }

  private setupSeo(): void {
    const title = 'Платим до 5 000 ₽ за друзей, пригласить друга | Своё Фото';
    const description = 'Приглашайте друзей в Своё Фото: после активации личного, образовательного или бизнес-доступа начисляем до 5 000 ₽ бонусами. 1 бонус = 1 ₽, списание до 15% заказа.';

    this.seo.clearJsonLd();
    this.seo.setAllMetaData(
      title,
      description,
      undefined,
      '/priglasi-druga',
      'Своё Фото, пригласить друга, реферальная ссылка, бонусы за рекомендации',
    );
    this.seo.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url: 'https://svoefoto.ru/priglasi-druga',
      mainEntity: this.faqItems.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
    this.seo.setBreadcrumbJsonLd([
      { name: 'Главная', url: 'https://svoefoto.ru/' },
      { name: 'Пригласить друга', url: 'https://svoefoto.ru/priglasi-druga' },
    ]);
  }
}
