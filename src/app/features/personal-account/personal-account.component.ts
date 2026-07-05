import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { SiteMobileMenuComponent } from '../../core/components/site-mobile-menu/site-mobile-menu.component';
import { AuthService } from '../../core/services/auth.service';
import { SeoService } from '../../core/services/seo.service';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

type PersonalFeatureLayout = 'grid' | 'wide' | 'mixed';
type PersonalIconTone = 'red' | 'sky' | 'mint' | 'peach' | 'pink' | 'green' | 'violet' | 'dark';

interface PersonalPromoItem {
  readonly icon: string;
  readonly tone: PersonalIconTone;
  readonly title: string;
  readonly description: string;
}

interface PersonalFeatureCard {
  readonly icon: string;
  readonly tone: PersonalIconTone;
  readonly title: string;
  readonly description: string;
  readonly metric?: string;
  readonly note?: string;
  readonly accent?: boolean;
  readonly wide?: boolean;
}

interface PersonalFeatureGroup {
  readonly title: string;
  readonly description?: string;
  readonly layout: PersonalFeatureLayout;
  readonly cards: readonly PersonalFeatureCard[];
}

interface PersonalTariffBullet {
  readonly icon: string;
  readonly text: string;
}

interface PersonalStep {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface PersonalFaq {
  readonly question: string;
  readonly answer: string;
}

const PERSONAL_START_QUERY_PARAMS = {
  audience: 'personal',
} as const;

const PERSONAL_LOGIN_QUERY_PARAMS = {
  returnUrl: '/user-profile',
} as const;

const PROMO_ASSET_PATH = '/assets/static/promo';

const PROMO_ITEMS: readonly PersonalPromoItem[] = [
  {
    icon: 'receipt_long',
    tone: 'sky',
    title: 'Личные заказы остаются в профиле',
    description:
      'Фото, документы, статусы, записи, согласования и история заказов доступны в одном кабинете.',
  },
  {
    icon: 'workspace_premium',
    tone: 'red',
    title: 'Подписка снижает цену печати',
    description:
      'Для личного аккаунта доступна персональная скидка: документы А4 дешевле на 20%, фотопечать до А4, на 10%.',
  },
] as const;

const FEATURE_GROUPS: readonly PersonalFeatureGroup[] = [
  {
    title: 'Главные сценарии',
    description:
      'Личная страница собирает самые частые задачи без перехода через общий каталог.',
    layout: 'grid',
    cards: [
      {
        icon: 'badge',
        tone: 'red',
        title: 'Фото на документы',
        description:
          'Паспорт, загранпаспорт, виза, права, анкеты, справки и ведомственные форматы онлайн или в студии.',
        metric: 'от 700 ₽',
        note: 'онлайн',
        accent: true,
      },
      {
        icon: 'photo_library',
        tone: 'sky',
        title: 'Печать фотографий',
        description:
          'Снимки для альбома, семейного архива, рамки, портфолио или подарка.',
        metric: '10x15',
        note: 'и до А4',
      },
      {
        icon: 'print',
        tone: 'mint',
        title: 'Печать документов',
        description:
          'Файлы А4, копии, сканы, ламинирование и рабочие документы для личных дел.',
        metric: 'А4',
        note: 'в студии',
      },
      {
        icon: 'redeem',
        tone: 'pink',
        title: 'Подарки с фото',
        description:
          'Кружки, футболки, холсты, сувениры и печать снимков к событию.',
        metric: 'фото',
        note: 'на подарок',
        accent: true,
      },
    ],
  },
  {
    title: 'Работает в кабинете',
    layout: 'wide',
    cards: [
      {
        icon: 'receipt_long',
        tone: 'dark',
        title: 'История заказов и статусы',
        description:
          'В профиле видно, что уже оформлено, что ждёт оплаты, что в работе и что можно забрать.',
        wide: true,
      },
      {
        icon: 'fact_check',
        tone: 'peach',
        title: 'Мои фото и согласования',
        description:
          'После фотосессий и заказов удобно возвращаться к выбранным снимкам, согласованиям и материалам.',
        wide: true,
      },
      {
        icon: 'stars',
        tone: 'green',
        title: 'Подписка и бонусы',
        description:
          'Личный кабинет показывает активную подписку, бонусный уровень и условия для будущих заказов.',
        wide: true,
      },
    ],
  },
  {
    title: 'Онлайн и студия',
    description: 'Можно начать дома, а закончить в точке Своё Фото.',
    layout: 'grid',
    cards: [
      {
        icon: 'upload_file',
        tone: 'mint',
        title: 'Загрузка файлов',
        description:
          'Передайте документы, макеты или фото заранее, чтобы сотрудник видел задачу до визита.',
      },
      {
        icon: 'calendar_month',
        tone: 'sky',
        title: 'Запись онлайн',
        description:
          'Подберите услугу, время и отделение без звонка, если нужна съёмка или консультация.',
      },
      {
        icon: 'support_agent',
        tone: 'red',
        title: 'Чат с менеджером',
        description:
          'Уточните требования к фото, файлам, срокам, печати или обработке перед оплатой.',
        accent: true,
      },
      {
        icon: 'notifications',
        tone: 'violet',
        title: 'Уведомления',
        description:
          'Статусы заказов и важные действия остаются привязанными к профилю.',
      },
    ],
  },
  {
    title: 'Фотоархив и образ',
    description: 'Для снимков, которые важно сохранить или аккуратно подготовить.',
    layout: 'grid',
    cards: [
      {
        icon: 'brush',
        tone: 'green',
        title: 'Ретушь',
        description:
          'Аккуратная обработка портретов, документов, архивных снимков и фото для публикации.',
      },
      {
        icon: 'auto_fix_high',
        tone: 'violet',
        title: 'Реставрация фото',
        description:
          'Восстанавливаем старые, повреждённые или выцветшие фотографии для печати и архива.',
        accent: true,
      },
      {
        icon: 'photo_camera',
        tone: 'peach',
        title: 'Портретная съёмка',
        description:
          'Личный портрет для документов, резюме, соцсетей, семьи или памятного события.',
      },
      {
        icon: 'auto_awesome',
        tone: 'pink',
        title: 'Нейрофотосессия',
        description:
          'Подготовка образов по вашим фото, когда нужна серия вариантов без классической съёмки.',
      },
    ],
  },
] as const;

const TARIFF_BULLETS: readonly PersonalTariffBullet[] = [
  {
    icon: 'card_membership',
    text: 'Подписка личного аккаунта применяет персональную скидку к личной печати после подключения.',
  },
  {
    icon: 'print',
    text: 'Документы А4 дешевле на 20%, фотопечать от 10x15 до А4 дешевле на 10%.',
  },
  {
    icon: 'account_circle',
    text: 'Заказы, статусы, фото, бонусы и подписка остаются в одном клиентском профиле.',
  },
] as const;

const CONNECTION_STEPS: readonly PersonalStep[] = [
  {
    icon: 'person_add',
    title: 'Создайте профиль',
    description:
      'Нужны имя, телефон и подтверждение входа кодом. После этого откроется личный кабинет.',
  },
  {
    icon: 'apps',
    title: 'Выберите услугу',
    description:
      'Фото на документы, печать, подарки, ретушь, реставрация или запись в студию.',
  },
  {
    icon: 'task_alt',
    title: 'Следите за статусом',
    description:
      'В кабинете видно, где заказ, что нужно оплатить, согласовать или забрать.',
  },
] as const;

const FAQ_ITEMS: readonly PersonalFaq[] = [
  {
    question: 'Личный аккаунт обязателен для заказа?',
    answer:
      'Нет. Многие услуги можно заказать и без полного знакомства с кабинетом. Аккаунт нужен, чтобы хранить историю, статусы, фото, подписку и бонусы.',
  },
  {
    question: 'Чем личный аккаунт отличается от образовательного доступа?',
    answer:
      'Образовательный доступ даёт специальные учебные цены после проверки статуса. Личный аккаунт подходит всем клиентам и собирает обычные заказы, подписку, бонусы и историю.',
  },
  {
    question: 'Какая подписка у личного аккаунта?',
    answer:
      'Личная подписка включает персональную скидку: документы А4 дешевле на 20%, фотопечать до А4 дешевле на 10%.',
  },
  {
    question: 'Можно ли начать онлайн, а забрать в студии?',
    answer:
      'Да. Для печати, документов и части фотоуслуг можно заранее передать материалы, а потом забрать результат в выбранной точке.',
  },
  {
    question: 'Что сохраняется в профиле?',
    answer:
      'Заказы, записи, статусы, согласования фотографий, бонусы, подписка и основные настройки аккаунта.',
  },
  {
    question: 'Если я уже клиент, нужно регистрироваться заново?',
    answer:
      'Нет. Войдите по телефону, который уже привязан к профилю, и продолжайте работу с существующим кабинетом.',
  },
] as const;

@Component({
  selector: 'app-personal-account',
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    RouterLink,
    SiteMobileMenuComponent,
    ScrollRevealDirective,
  ],
  templateUrl: './personal-account.component.html',
  styleUrl: './personal-account.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'personal-account-host',
    'attr.data-section': 'public',
  },
})
export class PersonalAccountComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly seo = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly startClientQueryParams = PERSONAL_START_QUERY_PARAMS;
  protected readonly loginQueryParams = PERSONAL_LOGIN_QUERY_PARAMS;
  protected readonly promoItems = PROMO_ITEMS;
  protected readonly featureGroups = FEATURE_GROUPS;
  protected readonly tariffBullets = TARIFF_BULLETS;
  protected readonly connectionSteps = CONNECTION_STEPS;
  protected readonly faqs = FAQ_ITEMS;
  protected readonly isLoggedIn = computed(() => this.authService.isAuthenticated());
  protected readonly mobileMenuOpen = signal(false);
  protected readonly stickyCtaVisible = signal(false);

  constructor() {
    afterNextRender(() => this.setupStickyCtaVisibility());
  }

  ngOnInit(): void {
    this.setupSeo();
  }

  protected toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  protected closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
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
      'Личный аккаунт для фото, документов и печати | Своё Фото';
    const description =
      'Личный аккаунт Своё Фото: фото на документы, печать фотографий и А4, ретушь, реставрация, заказы, статусы, бонусы и подписка в одном профиле.';

    this.seo.clearJsonLd();
    this.seo.updateCanonicalUrl('/personal');
    this.seo.updateTitle(title);
    this.seo.updateDescription(description);
    this.seo.setOpenGraph(
      title,
      description,
      `${PROMO_ASSET_PATH}/pechat-foto.webp`,
      'website',
      'https://svoefoto.ru/personal',
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
