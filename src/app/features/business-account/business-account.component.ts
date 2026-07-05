import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { SiteMobileMenuComponent } from '../../core/components/site-mobile-menu/site-mobile-menu.component';
import { SeoService } from '../../core/services/seo.service';
import { ScrollRevealDirective } from '../../shared/directives/scroll-reveal.directive';

type BusinessCapabilityLayout = 'grid' | 'wide' | 'mixed';

interface BusinessPromoItem {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface BusinessCapabilityCard {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly metric?: string;
  readonly note?: string;
  readonly accent?: boolean;
  readonly wide?: boolean;
}

interface BusinessCapabilityGroup {
  readonly title: string;
  readonly description?: string;
  readonly layout: BusinessCapabilityLayout;
  readonly cards: readonly BusinessCapabilityCard[];
}

interface BusinessBillingBullet {
  readonly icon: string;
  readonly text: string;
}

interface BusinessStep {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface BusinessFaq {
  readonly question: string;
  readonly answer: string;
}

const BUSINESS_CHAT_QUERY_PARAMS = {
  support: 'manager',
  topic: 'business',
} as const;

const BUSINESS_ASSET_PATH = '/assets/static/services';

const PROMO_ITEMS: readonly BusinessPromoItem[] = [
  {
    icon: 'badge',
    title: 'Фото сотрудников становится частью процесса',
    description:
      'Пропуска, медкнижки, анкеты, личные дела, школы, вузы, курсы и корпоративные базы ведём в едином B2B-сценарии.',
  },
  {
    icon: 'print',
    title: 'Печать и съёмки идут по B2B-условиям',
    description:
      'Бизнес-аккаунт даёт скидку на печать, а фотосъёмки команды и индивидуальные выезды согласуются как корпоративная услуга.',
  },
] as const;

const CAPABILITY_GROUPS: readonly BusinessCapabilityGroup[] = [
  {
    title: 'Организация, команда и фото сотрудников',
    description: 'Бизнес-аккаунт отделяет рабочие фото-задачи, съёмки и печать от личных заказов.',
    layout: 'grid',
    cards: [
      {
        icon: 'domain',
        title: 'Юрлицо или ИП',
        description:
          'Карточка организации хранит реквизиты, контакт бухгалтера и настройки документооборота.',
        metric: 'ИНН',
        note: 'в основе',
        accent: true,
      },
      {
        icon: 'badge',
        title: 'Фото сотрудников',
        description:
          'Единый формат для пропусков, медкнижек, анкет, личных дел и внутренних корпоративных баз.',
        metric: 'единый',
        note: 'формат',
      },
      {
        icon: 'school',
        title: 'Школы, вузы и курсы',
        description:
          'Фото для учебных организаций, групп, сотрудников, преподавателей и регулярных наборов документов.',
        metric: 'группы',
        note: 'и базы',
      },
      {
        icon: 'print',
        title: 'Печать для команды',
        description:
          'Документы А4 дешевле на 40%, фотопечать до А4 дешевле на 15% после подключения B2B-аккаунта.',
        metric: '-40%',
        note: 'A4',
        accent: true,
      },
    ],
  },
  {
    title: 'Фотосъёмки и выезд',
    description:
      'B2B-скидка распространяется не только на печать: корпоративные съёмки и индивидуальные выезды согласуются отдельно.',
    layout: 'grid',
    cards: [
      {
        icon: 'groups',
        title: 'Фотосъёмка команды',
        description:
          'Снимаем сотрудников под единые требования компании, чтобы файлы сразу подходили для пропусков, HR-систем и баз.',
        metric: 'B2B',
        note: 'условия',
        accent: true,
      },
      {
        icon: 'camera_alt',
        title: 'Индивидуальный выезд',
        description:
          'Выезд к одному сотруднику или небольшой группе, когда важно не вести людей в студию и сохранить общий стандарт.',
        metric: 'выезд',
        note: 'по заявке',
      },
      {
        icon: 'storage',
        title: 'Файлы для баз',
        description:
          'Передаём готовые изображения в понятном формате для корпоративных систем, учебных баз и внутренних реестров.',
        metric: 'файлы',
        note: 'для базы',
      },
      {
        icon: 'local_printshop',
        title: 'Печать после съёмки',
        description:
          'Если нужны отпечатки, карточки или документы, печать считается по скидке после подключения B2B-аккаунта.',
        metric: '-15%',
        note: 'фото',
      },
    ],
  },
  {
    title: 'Финансы и сверка',
    description:
      'Источник истины по оплате - банковская операция, а баланс считается из неизменяемых проводок.',
    layout: 'grid',
    cards: [
      {
        icon: 'receipt_long',
        title: 'Счёт на оплату',
        description:
          'Компания получает счёт с номером, суммой и назначением платежа.',
        metric: 'безнал',
        note: 'из любого банка',
      },
      {
        icon: 'account_balance',
        title: 'Выписка банка',
        description:
          'Sber Statement Connector будет забирать операции по нашему расчётному счёту.',
        metric: 'Sber',
        note: 'API',
        accent: true,
      },
      {
        icon: 'account_tree',
        title: 'Ledger',
        description:
          'Пополнения, списания, возвраты и корректировки пишутся как неизменяемые события.',
        metric: 'audit',
        note: 'trail',
      },
      {
        icon: 'rule',
        title: 'Ручная сверка',
        description:
          'Спорные и неоднозначные платежи попадают оператору, а не портят баланс автоматически.',
        metric: 'очередь',
        note: 'исключений',
      },
    ],
  },
  {
    title: 'Документы и ЭДО',
    description: 'Закрытие периода проектируется сразу как часть продукта.',
    layout: 'grid',
    cards: [
      {
        icon: 'description',
        title: 'Акт или УПД',
        description:
          'Документы формируются за период или по счёту после согласования бухгалтерских правил.',
        metric: 'PDF',
        note: 'и XML',
      },
      {
        icon: 'format_list_bulleted',
        title: 'Реестр печати',
        description:
          'В реестр попадают задания, сотрудники, отделы, параметры печати, суммы и НДС.',
        metric: '100%',
        note: 'детализация',
        accent: true,
      },
      {
        icon: 'verified',
        title: 'ЭДО-статусы',
        description:
          'Покажем отправку, доставку, подпись, отказ, корректировку и повторную отправку.',
        metric: 'ЭДО',
        note: 'статусы',
      },
      {
        icon: 'history',
        title: 'Версии документов',
        description:
          'Исправления не перезаписывают старые файлы, а создают новую версию или корректировку.',
        metric: 'v2',
        note: 'без потерь',
      },
    ],
  },
  {
    title: 'Подтверждение компании',
    layout: 'mixed',
    cards: [
      {
        icon: 'verified_user',
        title: 'Банковский Business ID',
        description:
          'Планируем СберБизнес ID, Alfa ID и T-Business ID как быстрый путь подтверждения юрлица или ИП.',
        wide: true,
        metric: '3',
        note: 'банка',
        accent: true,
      },
      {
        icon: 'fact_check',
        title: 'Fallback-проверка',
        description:
          'Если банка нет в списке, остаются ЭДО, первый платёж, проверка реквизитов или ручная проверка.',
      },
      {
        icon: 'support_agent',
        title: 'Пилот по заявке',
        description:
          'Пока автоматизация в разработке, подключаем бизнес-сценарии через менеджера и согласование условий.',
      },
    ],
  },
] as const;

const BILLING_BULLETS: readonly BusinessBillingBullet[] = [
  {
    icon: 'account_balance',
    text: 'Оплата идёт на расчётный счёт обычным банковским переводом из любого банка.',
  },
  {
    icon: 'receipt_long',
    text: 'Счета, закрывающие документы и реестр услуг проектируются как единый production-контур.',
  },
  {
    icon: 'verified_user',
    text: 'B2B не смешивается с розничными оплатами, POS и фискализацией физических лиц.',
  },
] as const;

const CONNECTION_STEPS: readonly BusinessStep[] = [
  {
    icon: 'domain_add',
    title: 'Расскажите о компании',
    description:
      'ИНН, реквизиты, объём печати, фото-задачи, сотрудники, отделы и ожидаемый способ закрывающих документов.',
  },
  {
    icon: 'rule',
    title: 'Согласуем правила',
    description:
      'Определим скидки, объём печати, условия фотосъёмок, индивидуальные выезды, документы, ЭДО и роли сотрудников.',
  },
  {
    icon: 'rocket_launch',
    title: 'Запустим пилот',
    description:
      'Подключим менеджера, настроим рабочий процесс и будем переносить ручные шаги в автоматизацию.',
  },
] as const;

const FAQ_ITEMS: readonly BusinessFaq[] = [
  {
    question: 'Бизнес-аккаунт уже можно подключить?',
    answer:
      'Полный автоматизированный B2B-контур ещё в разработке. Заявки принимаем через менеджера: можно обсудить организацию, реквизиты, регулярную печать, фото сотрудников, съёмки и выездные условия.',
  },
  {
    question: 'Для кого эта страница?',
    answer:
      'Для юрлиц и ИП, которым нужны фото сотрудников для пропусков, медкнижек, анкет, личных дел, школ, вузов, курсов, корпоративных баз, а также регулярная печать и документы.',
  },
  {
    question: 'Можно ли платить из любого банка?',
    answer:
      'Да. Базовый сценарий строится вокруг обычного безналичного перевода на наш расчётный счёт. Кнопки банковских сценариев будут только ускорять отдельные шаги.',
  },
  {
    question: 'Зачем нужен банковский Business ID?',
    answer:
      'Он ускоряет подтверждение организации, если представитель уже работает в поддерживаемом бизнес-банке. Это не единственный способ проверки.',
  },
  {
    question: 'Что будет в реестре печати?',
    answer:
      'Дата задания, пользователь или отдел, точка печати, тип услуги, страницы, цветность, формат, тариф, сумма и внутренний id задания. Для фото-задач отдельно фиксируем согласованный формат и состав заказа.',
  },
  {
    question: 'Будет ли ЭДО?',
    answer:
      'Да, ЭДО заложен в production-план. Первого провайдера выберем после проверки API, договоров, стоимости и требований бухгалтерии.',
  },
  {
    question: 'Чем это отличается от текущего бизнес-типа аккаунта?',
    answer:
      'Это не розничная подписка. B2B-контур добавляет организацию, сотрудников, фото-задачи, выездные съёмки, счета, ledger, реестр и закрывающие документы.',
  },
  {
    question: 'Можно ли начать с простого корпоративного заказа?',
    answer:
      'Да. Через чат можно описать задачу: фото сотрудников, пропуска, медкнижки, анкеты, корпоративная база, регулярная печать, фотопечать или выездная съёмка.',
  },
] as const;

@Component({
  selector: 'app-business-account',
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    RouterLink,
    SiteMobileMenuComponent,
    ScrollRevealDirective,
  ],
  templateUrl: './business-account.component.html',
  styleUrl: './business-account.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'business-account-host',
    'attr.data-section': 'public',
  },
})
export class BusinessAccountComponent implements OnInit {
  private readonly seo = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly businessChatQueryParams = BUSINESS_CHAT_QUERY_PARAMS;
  protected readonly promoItems = PROMO_ITEMS;
  protected readonly capabilityGroups = CAPABILITY_GROUPS;
  protected readonly billingBullets = BILLING_BULLETS;
  protected readonly connectionSteps = CONNECTION_STEPS;
  protected readonly faqs = FAQ_ITEMS;
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
      'Бизнес-аккаунт для фото сотрудников, печати и B2B-съёмок | Своё Фото';
    const description =
      'Бизнес-аккаунт Своё Фото для юрлиц и ИП: фото сотрудников для пропусков, медкнижек, анкет, личных дел, корпоративных баз, регулярная печать, выездные съёмки, счета и закрывающие документы.';

    this.seo.clearJsonLd();
    this.seo.updateCanonicalUrl('/business');
    this.seo.updateTitle(title);
    this.seo.updateDescription(description);
    this.seo.setOpenGraph(
      title,
      description,
      `${BUSINESS_ASSET_PATH}/document-print.webp`,
      'website',
      'https://svoefoto.ru/business',
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
