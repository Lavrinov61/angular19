import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { SERVICES, ServiceDoc } from '../../../core/data/services.data';
import { SeoService } from '../../../core/services/seo.service';
import { AuthChatService } from '../../../core/services/auth-chat.service';
import { LandingPricesService } from '../../../core/services/landing-prices.service';

type ServicesAudienceId = 'personal' | 'study' | 'business';
type ServicesTone = 'red' | 'sky' | 'blue' | 'mint' | 'peach' | 'violet' | 'dark';

interface AudienceTab {
  id: ServicesAudienceId;
  label: string;
}

interface HeroTile {
  title: string;
  description: string;
  icon: string;
  route: string;
  tone: ServicesTone;
}

interface HeroVisual {
  icon: string;
  tone: Extract<ServicesTone, 'sky' | 'blue' | 'peach'>;
}

interface ScenarioOffer {
  title: string;
  description: string;
  icon: string;
  route: string;
  badge: string;
  metric: string;
  tone: ServicesTone;
}

interface FeaturedService {
  title: string;
  description: string;
  icon: string;
  route: string;
  badge: string;
  result: string;
  price?: number;
  tone: ServicesTone;
}

interface ProcessStep {
  title: string;
  description: string;
  icon: string;
}

/** Секция каталога, группа услуг по потребности */
interface ServiceSection {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  services: ServiceDoc[];
}

interface FaqItem {
  question: string;
  answer: string;
}

@Component({
  selector: 'app-uslugi-services',
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    RouterLink,
    DecimalPipe,
  ],
  templateUrl: './uslugi-services.component.html',
  styleUrl: './uslugi-services.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UslugiServicesComponent implements OnInit {
  private readonly seoService = inject(SeoService);
  private readonly chatService = inject(AuthChatService);
  private readonly landingPrices = inject(LandingPricesService);

  readonly searchQuery = signal('');
  readonly activeAudienceId = signal<ServicesAudienceId>('personal');

  readonly audienceTabs: readonly AudienceTab[] = [
    { id: 'personal', label: 'Для себя' },
    { id: 'study', label: 'Для учёбы' },
    { id: 'business', label: 'Для бизнеса' },
  ];

  readonly heroTiles: readonly HeroTile[] = [
    {
      title: 'Фото на документы',
      description: 'Проверим требования и подготовим комплект',
      icon: 'badge',
      route: '/foto-na-document',
      tone: 'sky',
    },
    {
      title: 'Ретушь онлайн',
      description: 'Отправьте файл, мастер вернёт готовый результат',
      icon: 'auto_fix_high',
      route: '/retush',
      tone: 'blue',
    },
    {
      title: 'Регулярная печать A4',
      description: 'Для учебы, офиса и повторяющихся задач',
      icon: 'description',
      route: '/user-profile/subscription',
      tone: 'peach',
    },
  ];

  readonly heroVisuals: readonly HeroVisual[] = [
    { icon: 'badge', tone: 'sky' },
    { icon: 'print', tone: 'peach' },
    { icon: 'auto_fix_high', tone: 'blue' },
  ];

  readonly scenarioOffers: Record<ServicesAudienceId, readonly ScenarioOffer[]> = {
    personal: [
      {
        title: 'Нужен документ сегодня',
        description: 'Паспорт, виза, анкета, пропуск или Госуслуги без самостоятельного подбора формата.',
        icon: 'assignment_ind',
        route: '/foto-na-document',
        badge: 'в студии',
        metric: 'от 15 минут',
        tone: 'red',
      },
      {
        title: 'Напечатать фото',
        description: 'Обычные фотографии, холст или подарок с печатью. Подскажем размер и бумагу.',
        icon: 'photo_library',
        route: '/pechat-foto',
        badge: 'печать',
        metric: 'от 20 ₽',
        tone: 'sky',
      },
      {
        title: 'Улучшить снимок',
        description: 'Ретушь, восстановление старого фото и подготовка изображения для печати.',
        icon: 'auto_fix_high',
        route: '/retush',
        badge: 'мастер',
        metric: 'ручная работа',
        tone: 'violet',
      },
    ],
    study: [
      {
        title: 'Учебные документы',
        description: 'Фото для студенческого, справок, анкет и пропусков с быстрым повтором заказа.',
        icon: 'school',
        route: '/foto-na-document',
        badge: 'учёба',
        metric: 'без очереди',
        tone: 'red',
      },
      {
        title: 'Печать и переплёт',
        description: 'А4 от 3 ₽ и переплёт на пластиковую пружину за 10 ₽ для подтверждённых образовательных клиентов.',
        icon: 'print',
        route: '/pereplet-na-plastikovuyu-pruzhinu',
        badge: 'A4',
        metric: '3 ₽ + 10 ₽',
        tone: 'mint',
      },
      {
        title: 'Учебная подписка',
        description: 'Подтверждение статуса закрепляет учебные цены на печать, переплёт и фотопечать.',
        icon: 'workspace_premium',
        route: '/education',
        badge: 'подписка',
        metric: '199 ₽/мес',
        tone: 'blue',
      },
    ],
    business: [
      {
        title: 'Профиль компании',
        description: 'Оформите кабинет для заказов сотрудников, повторных документов и общей истории.',
        icon: 'business_center',
        route: '/business',
        badge: 'кабинет',
        metric: 'для команды',
        tone: 'dark',
      },
      {
        title: 'Товары и карточки',
        description: 'Съёмка, инфографика и контент для маркетплейсов без отдельного брифа каждый раз.',
        icon: 'inventory_2',
        route: '/tovarnaya-sjomka',
        badge: 'контент',
        metric: 'от 400 ₽',
        tone: 'sky',
      },
      {
        title: 'Печать для офиса',
        description: 'Визитки, документы, ламинирование и материалы для выдачи клиентам.',
        icon: 'corporate_fare',
        route: '/vizitki',
        badge: 'офис',
        metric: 'в одном месте',
        tone: 'peach',
      },
    ],
  };

  readonly processSteps: readonly ProcessStep[] = [
    {
      icon: 'chat',
      title: 'Расскажите задачу',
      description: 'Через профиль или чат: что нужно, когда забрать, есть ли файл или требования.',
    },
    {
      icon: 'fact_check',
      title: 'Получите маршрут',
      description: 'Покажем конкретную услугу, формат, срок и следующий шаг без просмотра всего каталога.',
    },
    {
      icon: 'verified',
      title: 'Закажите и повторяйте',
      description: 'Сохраняем историю и упрощаем повторные документы, печать и бизнес-заказы.',
    },
  ];

  /** FAQ */
  readonly faqItems: readonly FaqItem[] = [
    {
      question: 'Можно сразу перейти к конкретной услуге?',
      answer: 'Да. Популярные услуги вынесены в быстрые карточки, а ниже остаётся поиск и полный каталог по задачам. Если вы знаете точное название, используйте поиск.',
    },
    {
      question: 'Что даёт профиль клиента?',
      answer: 'Профиль помогает хранить историю заказов, быстрее повторять печать или документы, видеть статусы и пользоваться условиями для себя, учёбы или бизнеса.',
    },
    {
      question: 'Если задача нестандартная, куда нажимать?',
      answer: 'Нажмите «Рассказать задачу» или напишите в чат. Мы уточним формат, файл, срок и предложим подходящий вариант без лишнего выбора из каталога.',
    },
    {
      question: 'Онлайн-заказы тоже подходят для этой страницы?',
      answer: 'Да. Онлайн-ретушь, реставрация, фото на документы и нейрофотосессия доступны по всей России. На карточках и в поиске есть отдельные онлайн-направления.',
    },
  ];

  /** Все услуги с реальными ценами из pricing engine */
  private readonly enrichedServices = computed(() =>
    this.landingPrices.enrichServiceCards(SERVICES),
  );

  readonly activeScenarioOffers = computed(() =>
    this.scenarioOffers[this.activeAudienceId()],
  );

  readonly featuredServices = computed<FeaturedService[]>(() => {
    const all = this.enrichedServices();
    const serviceById = new Map(all.map(service => [service.id, service]));
    const cards: readonly {
      id: string;
      badge: string;
      result: string;
      tone: ServicesTone;
      description?: string;
      icon: string;
    }[] = [
      {
        id: 'foto-na-document',
        badge: 'самый частый старт',
        result: 'для паспорта, визы и анкет',
        tone: 'red',
        icon: 'badge',
      },
      {
        id: 'pechat-foto',
        badge: 'печать',
        result: 'фото, холсты и подарки',
        tone: 'sky',
        icon: 'print',
      },
      {
        id: 'retush-online',
        badge: 'онлайн',
        result: 'без визита в студию',
        tone: 'violet',
        icon: 'auto_fix_high',
      },
      {
        id: 'tovarnaya-sjomka',
        badge: 'для продаж',
        result: 'карточки и контент',
        tone: 'mint',
        description: 'Съёмка товара и визуальная подготовка для маркетплейсов.',
        icon: 'camera_alt',
      },
    ];

    return cards.flatMap(card => {
      const service = serviceById.get(card.id);
      if (!service) {
        return [];
      }

      return [{
        title: service.title,
        description: card.description ?? service.description,
        icon: card.icon,
        route: `/${service.slug}`,
        badge: card.badge,
        result: card.result,
        price: service.price,
        tone: card.tone,
      }];
    });
  });

  /** Секции по потребностям клиента */
  readonly sections = computed<ServiceSection[]>(() => {
    const all = this.enrichedServices();
    return [
      {
        id: 'documents',
        title: 'Документы и анкеты',
        subtitle: 'Фото на паспорт, визу, студенческий и требования разных стран',
        icon: 'badge',
        services: all.filter(service => service.displayCategory === 'documents'),
      },
      {
        id: 'print',
        title: 'Печать и офисные задачи',
        subtitle: 'Фотографии, документы, копии, сканы, ламинирование и визитки',
        icon: 'print',
        services: all.filter(service =>
          service.displayCategory === 'print' || service.displayCategory === 'technical',
        ),
      },
      {
        id: 'retouch',
        title: 'Обработка и восстановление',
        subtitle: 'Ретушь, реставрация и подготовка снимков к печати',
        icon: 'auto_fix_high',
        services: all.filter(service =>
          service.displayCategory === 'retouch' || service.displayCategory === 'restoration',
        ),
      },
      {
        id: 'online',
        title: 'Онлайн по всей России',
        subtitle: 'Отправьте файл, получите готовый результат удалённо',
        icon: 'language',
        services: all.filter(service => service.displayCategory === 'online'),
      },
      {
        id: 'business',
        title: 'Для бизнеса',
        subtitle: 'Товары, карточки, контент и материалы для офиса',
        icon: 'business_center',
        services: all.filter(service => service.displayCategory === 'business'),
      },
    ];
  });

  /** Поиск */
  readonly filteredResults = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) {
      return null;
    }

    return this.enrichedServices().filter(service =>
      service.title.toLowerCase().includes(query) ||
      service.description.toLowerCase().includes(query) ||
      service.features?.some(feature => feature.toLowerCase().includes(query)),
    );
  });

  readonly isSearching = computed(() => this.searchQuery().trim() !== '');

  ngOnInit(): void {
    this.landingPrices.init();
    this.setupSeo();
  }

  selectAudience(id: ServicesAudienceId): void {
    this.activeAudienceId.set(id);
  }

  openChat(): void {
    this.chatService.openChat();
  }

  onSearchInput(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  private setupSeo(): void {
    const title = 'Услуги Своё Фото, подобрать задачу, оформить профиль и заказать онлайн';
    const description = 'Посадочная страница Своё Фото: начните с задачи, оформите профиль клиента, выберите фото на документы, печать, ретушь, онлайн-услуги или бизнес-заказ.';
    const image = 'https://svoefoto.ru/assets/static/promo/pechat-foto.webp';

    this.seoService.setAllMetaData(title, description, image);
    this.seoService.setLocalSeoMeta();

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      'name': 'Услуги фотостудии Своё Фото',
      'description': 'Фото, печать, ретушь, онлайн-услуги и бизнес-заказы Своё Фото',
      'itemListElement': this.enrichedServices().map((service, index) => ({
        '@type': 'ListItem',
        'position': index + 1,
        'item': {
          '@type': 'Service',
          'name': service.title,
          'description': service.description,
          'provider': {
            '@type': 'LocalBusiness',
            'name': 'Своё Фото',
            'url': 'https://svoefoto.ru',
          },
          'areaServed': 'Ростов-на-Дону',
          'serviceType': 'Photography',
          ...(service.price && {
            offers: {
              '@type': 'Offer',
              'price': service.price,
              'priceCurrency': 'RUB',
            },
          }),
        },
      })),
    });

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': this.faqItems.map(item => ({
        '@type': 'Question',
        'name': item.question,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': item.answer,
        },
      })),
    });

    this.seoService.setBreadcrumbJsonLd([
      { name: 'Главная', url: 'https://svoefoto.ru/' },
      { name: 'Услуги', url: 'https://svoefoto.ru/services' },
    ]);
  }
}
