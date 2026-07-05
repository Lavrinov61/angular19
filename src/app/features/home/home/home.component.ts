import {
  Component,
  inject,
  PLATFORM_ID,
  OnInit,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';

import { SeoService } from '../../../core/services/seo.service';
import { RouteService } from '../../../core/services/route.service';
import {
  ADDRESSES,
  StudioAddress,
  STUDIO_PHONE,
  STUDIO_PHONE_AVAILABLE,
  STUDIO_PHONE_HREF,
  STUDIO_PHONE_UNAVAILABLE_LABEL,
} from '../../../core/data/address.data';
import { REVIEWS, type ReviewDoc } from '../../../core/data/reviews.data';

import { AddressSelectDialogComponent } from '../../../shared/components/address-select-dialog/address-select-dialog.component';
import { ScrollRevealDirective } from '../../../shared/directives/scroll-reveal.directive';

type HomeAudienceId = 'all' | 'study' | 'business';
type HomeCalculatorId = 'documents' | 'print' | 'study' | 'business' | 'retouch';
type HomeAboutTabId = 'studios' | 'reviews';
type HomeServiceAction = 'route' | 'chat' | 'phone';
type HomeTone = 'red' | 'violet' | 'sky' | 'mint' | 'peach' | 'green' | 'dark' | 'pink';

interface HomeAudienceTab {
  id: HomeAudienceId;
  label: string;
}

interface HomeAboutTab {
  id: HomeAboutTabId;
  label: string;
}

interface HomeReviewStat {
  value: string;
  label: string;
  icon: string;
}

interface HomeProductCard {
  title: string;
  subtitle: string;
  icon: string;
  link: string;
  audience: readonly HomeAudienceId[];
  tone: HomeTone;
}

interface HomeCalculatorOffer {
  id: HomeCalculatorId;
  label: string;
  inputLabel: string;
  amount: string;
  helper: string;
  terms: readonly string[];
  selectedTerm: string;
  options: readonly { label: string; enabled: boolean }[];
  offerTitle: string;
  offerNote: string;
  columns: readonly [string, string];
  rows: readonly { label: string; values: readonly [string, string] }[];
  secondaryCta: string;
  secondaryLink: string;
  cta: string;
  link: string;
}

interface HomePromoCard {
  title: string;
  description: string;
  icon: string;
  tone: HomeTone;
  link: string;
  badge?: string;
}

interface HomeAccountCard {
  title: string;
  badge: string;
  highlight: string;
  description: string;
  icon: string;
  tone: HomeTone;
  benefits: readonly string[];
  cta: string;
  queryParams: Readonly<Record<string, string>>;
}

interface HomeSubscriptionHighlight {
  label: string;
  value: string;
}

interface HomeServiceCard {
  title: string;
  description: string;
  icon: string;
  action?: HomeServiceAction;
  link?: string;
  dark?: boolean;
}

interface HomeStoryCard {
  title: string;
  description: string;
  meta: string;
  icon: string;
  link: string;
}

const SUBSCRIPTION_PRICE_COLUMNS = ['Без подписки', 'С подпиской'] as const;
const SUBSCRIPTION_PRICE_ROWS = [
  { label: 'A4', values: ['10 ₽', 'от 3 ₽'] },
  { label: 'Фото 10×15', values: ['20 ₽', 'от 14 ₽'] },
] as const;

const SUBSCRIPTION_PRICE_NOTE = 'Подписка снижает цену на каждый отпечаток.';
const SUBSCRIPTION_PRICE_SECONDARY_CTA = 'Смотреть все цены';
const SUBSCRIPTION_PRICE_SECONDARY_LINK = '/services';
const SUBSCRIPTION_PRICE_PRIMARY_CTA = 'Оформить подписку';
const SUBSCRIPTION_PRICE_PRIMARY_LINK = '/subscriptions';

@Component({
  selector: 'app-home',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
    RouterLink,
    ScrollRevealDirective,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  private seoService = inject(SeoService);
  private routeService = inject(RouteService);
  private snackBar = inject(MatSnackBar);
  private platformId = inject(PLATFORM_ID);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  // Data
  readonly addresses = ADDRESSES;
  readonly studioPhone = STUDIO_PHONE;
  readonly studioPhoneHref = STUDIO_PHONE_HREF;
  readonly studioPhoneAvailable = STUDIO_PHONE_AVAILABLE;
  readonly studioPhoneUnavailableLabel = STUDIO_PHONE_UNAVAILABLE_LABEL;
  readonly yearsOfWork = new Date().getFullYear() - 1999;
  readonly activeAudienceId = signal<HomeAudienceId>('all');
  readonly activeCalculatorId = signal<HomeCalculatorId>('documents');
  readonly activeAboutTabId = signal<HomeAboutTabId>('studios');

  readonly audienceTabs: readonly HomeAudienceTab[] = [
    { id: 'all', label: 'Для себя' },
    { id: 'study', label: 'Для учёбы' },
    { id: 'business', label: 'Для бизнеса' },
  ];

  readonly aboutTabs: readonly HomeAboutTab[] = [
    { id: 'studios', label: 'Студии' },
    { id: 'reviews', label: 'Отзывы' },
  ];

  readonly productCards: readonly HomeProductCard[] = [
    {
      title: 'Фото на документы',
      subtitle: 'Паспорт, виза, права и анкеты',
      icon: 'badge',
      link: '/foto-na-document',
      audience: ['all', 'study', 'business'],
      tone: 'red',
    },
    {
      title: 'Печать фотографий',
      subtitle: 'Глянцевая и матовая печать до А4',
      icon: 'photo_library',
      link: '/pechat-foto',
      audience: ['all', 'study', 'business'],
      tone: 'sky',
    },
    {
      title: 'Документы и копии',
      subtitle: 'PDF, сканы, ксерокопия и ламинация',
      icon: 'print',
      link: '/pechat-dokumentov',
      audience: ['all', 'study', 'business'],
      tone: 'mint',
    },
    {
      title: 'Реставрация фото',
      subtitle: 'Восстановим старые снимки онлайн',
      icon: 'auto_fix_high',
      link: '/restavratsiya-foto',
      audience: ['all'],
      tone: 'violet',
    },
    {
      title: 'Портретная съемка',
      subtitle: 'Деловой и личный портрет',
      icon: 'photo_camera',
      link: '/portretnaya-sjomka',
      audience: ['all', 'business'],
      tone: 'peach',
    },
    {
      title: 'Печать на подарках',
      subtitle: 'Кружки, футболки и сувениры',
      icon: 'redeem',
      link: '/pechat-na-podarki',
      audience: ['all', 'study', 'business'],
      tone: 'pink',
    },
    {
      title: 'Ретушь онлайн',
      subtitle: 'Аккуратно поправим кадр',
      icon: 'brush',
      link: '/retush',
      audience: ['all', 'business'],
      tone: 'green',
    },
    {
      title: 'Холст и интерьер',
      subtitle: 'Печать фото для дома и офиса',
      icon: 'image',
      link: '/pechat-foto-na-holste',
      audience: ['all', 'business'],
      tone: 'dark',
    },
  ];

  readonly visibleProductCards = computed(() => {
    const activeAudience = this.activeAudienceId();
    return this.productCards.filter((card) => activeAudience === 'all' || card.audience.includes(activeAudience));
  });

  readonly calculatorOffers: Record<HomeCalculatorId, HomeCalculatorOffer> = {
    documents: {
      id: 'documents',
      label: 'Документы',
      inputLabel: 'Комплект',
      amount: '4 фото + файл',
      helper: 'проверим требования и подготовим к печати',
      terms: ['Паспорт РФ', 'Загран', 'Виза', 'Права', 'Онлайн'],
      selectedTerm: 'Паспорт РФ',
      options: [
        { label: 'Проверка размера и фона', enabled: true },
        { label: 'Файл для повторного заказа', enabled: true },
      ],
      offerTitle: 'Печатайте дешевле с подпиской',
      offerNote: SUBSCRIPTION_PRICE_NOTE,
      columns: SUBSCRIPTION_PRICE_COLUMNS,
      rows: SUBSCRIPTION_PRICE_ROWS,
      secondaryCta: SUBSCRIPTION_PRICE_SECONDARY_CTA,
      secondaryLink: SUBSCRIPTION_PRICE_SECONDARY_LINK,
      cta: SUBSCRIPTION_PRICE_PRIMARY_CTA,
      link: SUBSCRIPTION_PRICE_PRIMARY_LINK,
    },
    print: {
      id: 'print',
      label: 'Печать',
      inputLabel: 'Что печатаем',
      amount: 'фото, A4, холст',
      helper: 'подберем формат, бумагу и студию',
      terms: ['Фото 10x15', 'A4 документы', 'Холст', 'Постер', 'Подарок'],
      selectedTerm: 'Фото 10x15',
      options: [
        { label: 'Загрузка с телефона или PDF', enabled: true },
        { label: 'Самовывоз из студии', enabled: true },
      ],
      offerTitle: 'Печатайте дешевле с подпиской',
      offerNote: SUBSCRIPTION_PRICE_NOTE,
      columns: SUBSCRIPTION_PRICE_COLUMNS,
      rows: SUBSCRIPTION_PRICE_ROWS,
      secondaryCta: SUBSCRIPTION_PRICE_SECONDARY_CTA,
      secondaryLink: SUBSCRIPTION_PRICE_SECONDARY_LINK,
      cta: SUBSCRIPTION_PRICE_PRIMARY_CTA,
      link: SUBSCRIPTION_PRICE_PRIMARY_LINK,
    },
    study: {
      id: 'study',
      label: 'Учёба',
      inputLabel: 'Доступ',
      amount: 'A4 от 3 ₽',
      helper: 'после проверки статуса и подписки 199 ₽/мес',
      terms: ['Конспекты', 'Методички', 'Студенческий', 'Фото 10x15', 'PDF'],
      selectedTerm: 'Конспекты',
      options: [
        { label: 'Проверка студенческого статуса', enabled: true },
        { label: 'Подписка 199 ₽/мес', enabled: true },
      ],
      offerTitle: 'Печатайте дешевле с подпиской',
      offerNote: SUBSCRIPTION_PRICE_NOTE,
      columns: SUBSCRIPTION_PRICE_COLUMNS,
      rows: SUBSCRIPTION_PRICE_ROWS,
      secondaryCta: SUBSCRIPTION_PRICE_SECONDARY_CTA,
      secondaryLink: SUBSCRIPTION_PRICE_SECONDARY_LINK,
      cta: SUBSCRIPTION_PRICE_PRIMARY_CTA,
      link: SUBSCRIPTION_PRICE_PRIMARY_LINK,
    },
    business: {
      id: 'business',
      label: 'Бизнес',
      inputLabel: 'Команда',
      amount: 'печать + фото сотрудников',
      helper: 'для пропусков, анкет, баз и регулярной печати',
      terms: ['Сотрудники', 'Пропуска', 'Анкеты', 'A4 документы', 'Выезд'],
      selectedTerm: 'Сотрудники',
      options: [
        { label: 'B2B-аккаунт со счётом', enabled: true },
        { label: 'Единый стиль фото команды', enabled: true },
      ],
      offerTitle: 'Печатайте дешевле с подпиской',
      offerNote: SUBSCRIPTION_PRICE_NOTE,
      columns: SUBSCRIPTION_PRICE_COLUMNS,
      rows: SUBSCRIPTION_PRICE_ROWS,
      secondaryCta: SUBSCRIPTION_PRICE_SECONDARY_CTA,
      secondaryLink: SUBSCRIPTION_PRICE_SECONDARY_LINK,
      cta: SUBSCRIPTION_PRICE_PRIMARY_CTA,
      link: SUBSCRIPTION_PRICE_PRIMARY_LINK,
    },
    retouch: {
      id: 'retouch',
      label: 'Ретушь',
      inputLabel: 'Задача',
      amount: 'портрет, архив, памятник',
      helper: 'оценим сложность и согласуем правки',
      terms: ['Портрет', 'Архив', 'Цвет', 'Памятник', 'Военная ретушь'],
      selectedTerm: 'Архив',
      options: [
        { label: 'Предпросмотр до оплаты', enabled: true },
        { label: 'Файл для печати или сайта', enabled: true },
      ],
      offerTitle: 'Печатайте дешевле с подпиской',
      offerNote: SUBSCRIPTION_PRICE_NOTE,
      columns: SUBSCRIPTION_PRICE_COLUMNS,
      rows: SUBSCRIPTION_PRICE_ROWS,
      secondaryCta: SUBSCRIPTION_PRICE_SECONDARY_CTA,
      secondaryLink: SUBSCRIPTION_PRICE_SECONDARY_LINK,
      cta: SUBSCRIPTION_PRICE_PRIMARY_CTA,
      link: SUBSCRIPTION_PRICE_PRIMARY_LINK,
    },
  };

  readonly calculatorTabs = Object.values(this.calculatorOffers);
  readonly activeCalculator = computed(() => this.calculatorOffers[this.activeCalculatorId()]);

  readonly accountCards: readonly HomeAccountCard[] = [
    {
      title: 'A4 документы',
      badge: 'частая печать',
      highlight: '10 ₽ → от 3 ₽',
      description: 'Для конспектов, анкет, договоров и других документов, которые печатают регулярно.',
      icon: 'description',
      tone: 'sky',
      benefits: ['обычная цена 10 ₽', 'с подпиской от 3 ₽', 'без фиксированных пакетов'],
      cta: 'Оформить подписку',
      queryParams: { format: 'a4' },
    },
    {
      title: 'Фото 10×15',
      badge: 'семейные фото',
      highlight: '20 ₽ → от 14 ₽',
      description: 'Для альбомов, архивов и серийной печати снимков с телефона или облака.',
      icon: 'photo_library',
      tone: 'green',
      benefits: ['обычная цена 20 ₽', 'с подпиской от 14 ₽', 'та же бумага и печать'],
      cta: 'Оформить подписку',
      queryParams: { format: 'photo-10x15' },
    },
    {
      title: 'Регулярная печать',
      badge: 'для частых заказов',
      highlight: 'дешевле каждый раз',
      description: 'Подходит, когда документы или фотографии нужны не один раз, а постоянно.',
      icon: 'workspace_premium',
      tone: 'peach',
      benefits: ['цена ниже на каждый отпечаток', 'история заказов в кабинете', 'можно подключить онлайн'],
      cta: 'Оформить подписку',
      queryParams: { format: 'regular' },
    },
  ];

  readonly subscriptionHighlights: readonly HomeSubscriptionHighlight[] = [
    {
      label: 'Экономия',
      value: 'на каждом заказе',
    },
    {
      label: 'Пакеты',
      value: 'не нужны',
    },
    {
      label: 'Оплата',
      value: 'по факту печати',
    },
  ];

  readonly benefitCards: readonly HomePromoCard[] = [
    {
      title: 'Бонусы за заказы',
      description: 'Копите баллы в личном кабинете и оплачивайте ими печать.',
      icon: 'stars',
      tone: 'peach',
      link: '/user-profile/loyalty',
      badge: 'бонусы',
    },
    {
      title: 'Единый кабинет',
      description: 'Заказы, записи, согласование фото и подписка в одном месте.',
      icon: 'dashboard_customize',
      tone: 'dark',
      link: '/user-profile',
      badge: 'новое',
    },
  ];

  readonly serviceCards: readonly HomeServiceCard[] = [
    {
      title: 'Студии рядом',
      description: 'Построим маршрут до ближайшей точки в Ростове-на-Дону.',
      icon: 'location_on',
      action: 'route',
    },
    {
      title: 'Поддержка',
      description: 'Выберите тему: заказ, печать, документы, ретушь или бизнес.',
      icon: 'support_agent',
      action: 'chat',
    },
    {
      title: 'Позвонить в студию',
      description: this.studioPhone,
      icon: 'call',
      action: 'phone',
    },
    {
      title: 'Записаться на съемку',
      description: 'Подберите дату для портрета, семьи или документа.',
      icon: 'calendar_month',
      link: '/booking',
    },
    {
      title: 'Фото на документы онлайн',
      description: 'Загрузите снимок, мы подготовим его под требования.',
      icon: 'badge',
      link: '/foto-na-documenty-online',
    },
    {
      title: 'Печать для бизнеса',
      description: 'Документы, фото сотрудников, пропуска, анкеты, корпоративные базы и выездные съёмки.',
      icon: 'business_center',
      link: '/services',
      dark: true,
    },
  ];

  readonly storyCards: readonly HomeStoryCard[] = [
    {
      title: 'Как подготовиться к фото на паспорт',
      description: 'Одежда, прическа, фон и частые причины отказа.',
      meta: 'Гид - 5 минут',
      icon: 'assignment_ind',
      link: '/foto-na-pasport',
    },
    {
      title: 'Что лучше: глянец или матовая бумага',
      description: 'Где важна плотность, цвет и защита отпечатка.',
      meta: 'Печать - 3 минуты',
      icon: 'photo_library',
      link: '/pechat-foto',
    },
    {
      title: 'Как восстановить старый семейный снимок',
      description: 'Процесс реставрации от скана до печати.',
      meta: 'Ретушь - 4 минуты',
      icon: 'auto_fix_high',
      link: '/restavratsiya-foto',
    },
  ];

  readonly statsCards = [
    { value: `${this.yearsOfWork}+`, label: 'лет печатаем фото' },
    { value: '2', label: 'студии в Ростове' },
    { value: '10 мин', label: 'средняя готовность документов' },
  ] as const;

  readonly reviewCards: readonly ReviewDoc[] = REVIEWS.slice(0, 3);

  readonly reviewStats: readonly HomeReviewStat[] = [
    { value: `${this.reviewCards.length}`, label: 'отзыва в подборке', icon: 'rate_review' },
    {
      value: `${new Set(this.reviewCards.map((review) => review.sourceName)).size}`,
      label: 'площадки с источниками',
      icon: 'verified',
    },
    { value: '5/5', label: 'оценки в этих отзывах', icon: 'star' },
  ];

  selectAudience(id: HomeAudienceId): void {
    this.activeAudienceId.set(id);
  }

  selectCalculator(id: HomeCalculatorId): void {
    this.activeCalculatorId.set(id);
  }

  selectAboutTab(id: HomeAboutTabId): void {
    this.activeAboutTabId.set(id);
  }

  ngOnInit(): void {
    this.initSeo();
  }

  openStudioChat(): void {
    void this.router.navigate(['/chat'], {
      queryParams: {
        support: 'manager',
        topic: 'general',
      },
    });
  }

  handleRouteClick(): void {
    if (this.addresses.length > 1) {
      const dialogRef = this.dialog.open(AddressSelectDialogComponent, {
        width: '600px',
        maxWidth: '90vw',
        data: { addresses: this.addresses },
      });
      dialogRef.afterClosed().subscribe((selected: StudioAddress | undefined) => {
        if (selected) this.openRouteToAddress(selected);
      });
    } else if (this.addresses.length === 1) {
      this.openRouteToAddress(this.addresses[0]);
    }
  }

  handleServiceCard(card: HomeServiceCard): void {
    if (card.action === 'chat') {
      this.openStudioChat();
      return;
    }

    if (card.action === 'route') {
      this.handleRouteClick();
      return;
    }

    if (card.action === 'phone') {
      if (isPlatformBrowser(this.platformId)) {
        window.location.href = this.studioPhoneHref;
      }
      return;
    }

    if (card.link) {
      void this.router.navigateByUrl(card.link);
    }
  }

  private openRouteToAddress(address: StudioAddress): void {
    this.routeService.openRoute(address.address).subscribe({
      next: (result) => {
        this.snackBar.open(
          result.hasUserLocation ? 'Маршрут построен' : 'Маршрут открыт в Google Maps',
          'OK',
          { duration: 3000 },
        );
      },
      error: () => {
        this.snackBar.open('Не удалось построить маршрут', 'OK', { duration: 3000 });
      },
    });
  }

  private initSeo(): void {
    this.seoService.setAllMetaData(
      'Своё Фото - фото на документы, печать и онлайн-услуги',
      'Фото на документы, печать фотографий и документов, реставрация, портретная съемка и онлайн-заказы в Ростове-на-Дону.',
      'https://svoefoto.ru/assets/static/hero/hero-image.webp',
    );
    this.seoService.setHomePageJsonLd();
  }

}
