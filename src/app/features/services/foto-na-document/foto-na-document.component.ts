import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID, signal, computed, afterNextRender, DestroyRef } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { RouterLink } from '@angular/router';
import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { TestimonialService } from '../../../shared/components/testimonials/testimonial.service';
import { Testimonial } from '../../../shared/components/testimonials/testimonial.model';
import { BeforeAfterSliderComponent } from '../../../shared/components/before-after-slider/before-after-slider.component';
import { ScrollRevealDirective } from '../../../shared/directives/scroll-reveal.directive';
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESS_INFO, ADDRESSES } from '../../../core/data/address.data';
import { PricingApiService } from '../../../core/services/pricing-api.service';

type FaqTabId = 'visit' | 'retouch' | 'price';

interface FaqTab {
  readonly id: FaqTabId;
  readonly label: string;
}

interface FaqItem {
  readonly category: FaqTabId;
  readonly question: string;
  readonly answer: string;
}

interface ProcessStep {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
}

interface PhotoSample {
  readonly src: string;
  readonly alt: string;
  readonly label: string;
}

interface StudioChoice {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly landmark: string;
  readonly workHours: string;
  readonly routeUrl: string | null;
}

const DOCUMENT_PHOTO_SAMPLES = [
  { src: '/assets/images/document-sample-passport-rf.webp', alt: 'Реальное фото на паспорт РФ', label: 'Паспорт РФ' },
  { src: '/assets/images/document-sample-zagranpassport.webp', alt: 'Реальное фото на загранпаспорт', label: 'Загранпаспорт' },
  { src: '/assets/images/document-sample-driving-license.webp', alt: 'Реальное фото на водительские права', label: 'Водительские права' },
  { src: '/assets/images/document-sample-visa.webp', alt: 'Реальное фото на визу', label: 'Виза' },
  { src: '/assets/images/document-sample-student-card.webp', alt: 'Реальное фото на студенческий билет', label: 'Студенческий билет' },
] as const satisfies readonly PhotoSample[];

@Component({
  selector: 'app-foto-na-document',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    ContactsSectionComponent,
    TestimonialsComponent,
    BeforeAfterSliderComponent,
    ScrollRevealDirective,
    RouterLink,
  ],
  templateUrl: './foto-na-document.component.html',
  styleUrls: ['./foto-na-document.component.scss']
})
export class FotoNaDocumentComponent implements OnInit {
  private readonly seoService = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly layout = inject(ResponsiveLayoutService);
  private readonly testimonialService = inject(TestimonialService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly pricing = inject(PricingApiService);

  protected readonly studioPrice = computed(() => this.pricing.getMinStudioPrice('photo-docs') ?? 700);
  protected readonly showStickyCta = signal(false);
  protected readonly documentContacts = {
    ...CONTACTS,
    title: 'Контакты и адрес студии',
    prompt: 'Напишите нам, позвоните или выберите студию на карте. На документное фото можно прийти без записи.',
  };
  protected readonly addressInfo = ADDRESS_INFO;
  protected readonly addresses = ADDRESSES;
  protected readonly telegramLink = CONTACTS.links.find(link => link.label === 'Telegram')?.href ?? 'https://t.me/FmagnusBot';
  protected readonly studioChoices: readonly StudioChoice[] = this.addresses.map(address => ({
    id: address.id,
    name: address.name,
    address: address.address,
    landmark: address.landmark ?? 'Ростов-на-Дону',
    workHours: address.workHours,
    routeUrl: address.mapLinks?.yandex ?? address.mapLinks?.google ?? address.mapLinks?.['2gis'] ?? null,
  }));
  protected readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  protected readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  protected readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });
  protected readonly bookingLink = '/booking';
  protected readonly ratingStars = [1, 2, 3, 4, 5] as const;
  protected readonly activeFaqTab = signal<FaqTabId>('visit');
  protected readonly heroPhotoSample = DOCUMENT_PHOTO_SAMPLES[0];
  protected readonly formatPreviewSample = DOCUMENT_PHOTO_SAMPLES[0];
  protected readonly darkCtaPhotoSample = DOCUMENT_PHOTO_SAMPLES[1];

  protected readonly heroFacts = [
    { icon: 'schedule', value: '15 минут', label: 'обычно занимает съемка и печать' },
    { icon: 'verified', value: 'ГОСТ', label: 'проверяем требования к документу' },
    { icon: 'child_care', value: '0+', label: 'фотографируем детей и взрослых' },
  ] as const;

  protected readonly featureCards = [
    {
      tone: 'mint',
      icon: 'badge',
      title: 'Под нужный документ',
      description: 'Сразу уточняем размер, фон и посадку под паспорт, визу, права, медкнижку или пропуск.',
      image: DOCUMENT_PHOTO_SAMPLES[0].src,
      alt: DOCUMENT_PHOTO_SAMPLES[0].alt,
    },
    {
      tone: 'sky',
      icon: 'photo_camera',
      title: 'Несколько дублей',
      description: 'Настраиваем свет, посадку и взгляд в студии. Вместе выбираем кадр, который пойдет в печать.',
      image: DOCUMENT_PHOTO_SAMPLES[1].src,
      alt: DOCUMENT_PHOTO_SAMPLES[1].alt,
    },
    {
      tone: 'lemon',
      icon: 'brush',
      title: 'Ретушь вручную',
      description: 'Ретушер аккуратно выравнивает тон кожи, свет и детали без пластиковой обработки.',
      image: '/assets/static/home/after-retouch.webp',
      alt: 'Пример ручной ретуши фото',
    },
    {
      tone: 'peach',
      icon: 'print',
      title: 'Печать и файл',
      description: 'Печатаем комплект на фотобумаге и по запросу готовим цифровой файл для анкеты или архива.',
      image: DOCUMENT_PHOTO_SAMPLES[3].src,
      alt: DOCUMENT_PHOTO_SAMPLES[3].alt,
    },
  ] as const;

  protected readonly retouchingLevels = [
    {
      slug: 'basic',
      icon: 'crop_original',
      title: 'Базовый',
      description: 'Кадрирование по стандарту, коррекция яркости и контраста.',
      features: ['Правильный размер', 'Базовая коррекция', 'Нейтральный фон'],
      popular: false,
    },
    {
      slug: 'retouch',
      icon: 'brush',
      title: 'С обработкой',
      description: 'Ручная ретушь: тон кожи, свет и аккуратные детали.',
      features: ['Ручная ретушь', 'Выбор кадра', 'Согласование перед печатью'],
      popular: true,
    },
    {
      slug: 'vip',
      icon: 'auto_awesome',
      title: 'Расширенный',
      description: 'Тщательная подготовка для виз, анкет и документов, где важна аккуратная подача.',
      features: ['Точная ручная ретушь', 'Работа со светом', 'Естественный результат'],
      popular: false,
    },
  ] as const;

  protected readonly documentTypes = [
    'Паспорт РФ',
    'Загранпаспорт',
    'Водительские права',
    'Виза',
    'Медицинская книжка',
    'Студенческий билет',
    'Военный билет',
    'Разрешение на работу',
    'Пропуск',
    'Любой другой документ',
  ] as const;

  protected readonly documentSpecs = [
    { value: '35x45', label: 'паспорт, виза, анкета' },
    { value: '3x4', label: 'пропуск, медкнижка, личное дело' },
    { value: 'Файл', label: 'цифровая версия по требованиям' },
  ] as const;

  protected readonly audienceCards = [
    {
      icon: 'child_care',
      title: 'Детям спокойно',
      description: 'Без спешки ловим нужный момент, помогаем родителям и не давим на ребенка.',
    },
    {
      icon: 'person',
      title: 'Взрослым уверенно',
      description: 'Подскажем посадку, взгляд и выражение лица, чтобы документное фото выглядело аккуратно.',
    },
  ] as const;

  protected readonly montageFeatures = [
    {
      icon: 'military_tech',
      title: 'Форма на фото',
      description: 'Подготовим кадр с нужной формой, если это допустимо для вашего документа.',
    },
    {
      icon: 'content_cut',
      title: 'Правка внешнего вида',
      description: 'Сделаем небольшие правки по запросу и заранее подскажем ограничения.',
    },
    {
      icon: 'wallpaper',
      title: 'Замена фона',
      description: 'Нейтральный фон под российские и зарубежные стандарты.',
    },
    {
      icon: 'collections',
      title: 'Комплект фото',
      description: 'Одна съемка для паспорта, прав, визы и других документов.',
    },
  ] as const;

  protected readonly photoSamples = DOCUMENT_PHOTO_SAMPLES;

  protected readonly processSteps: readonly ProcessStep[] = [
    {
      number: 1,
      title: 'Выбираете время',
      description: 'Записывайтесь онлайн или приходите в рабочее время без записи.',
      icon: 'event_available',
    },
    {
      number: 2,
      title: 'Снимаем серию',
      description: 'Делаем несколько дублей со студийным светом и подсказками по позе.',
      icon: 'photo_camera_front',
    },
    {
      number: 3,
      title: 'Ретушируем',
      description: 'Ретушер вручную доводит выбранный кадр до аккуратного вида.',
      icon: 'brush',
    },
    {
      number: 4,
      title: 'Печатаем комплект',
      description: 'Проверяем размеры, печатаем на фотобумаге и отдаем готовый результат.',
      icon: 'check_circle',
    },
  ];

  protected readonly faqTabs: readonly FaqTab[] = [
    { id: 'visit', label: 'Визит' },
    { id: 'retouch', label: 'Ретушь' },
    { id: 'price', label: 'Стоимость' },
  ];

  protected readonly faqItems = computed<readonly FaqItem[]>(() => {
    const price = this.studioPrice();

    return [
      {
        category: 'visit',
        question: 'Нужно ли записываться заранее?',
        answer: 'Необязательно - можете просто прийти в рабочее время. Запись онлайн нужна, если хотите закрепить удобное время и не ждать.',
      },
      {
        category: 'visit',
        question: 'Для каких документов делаете фото?',
        answer: 'Для паспорта РФ, загранпаспорта, водительских прав, виз, студенческого, медкнижки, военного билета, пропусков и других документов.',
      },
      {
        category: 'visit',
        question: 'Фотографируете детей?',
        answer: 'Да, фотографируем детей с рождения. Работаем спокойно, делаем несколько дублей и выбираем кадр, который подойдет под требования документа.',
      },
      {
        category: 'retouch',
        question: 'Какие уровни обработки есть?',
        answer: 'Есть базовая подготовка, ручная ретушь и расширенная обработка. Уровень можно выбрать под задачу и важность документа.',
      },
      {
        category: 'retouch',
        question: 'Можно заменить фон или подготовить форму?',
        answer: 'Да, по запросу заменим фон, подготовим вариант с формой и сделаем комплект под несколько документов. Сразу подскажем, что допустимо для вашего случая.',
      },
      {
        category: 'price',
        question: 'Сколько стоит фото на документы?',
        answer: `Студийное фото на документы - от ${price} рублей. Точная стоимость зависит от выбранного документа, печати, цифровой версии и уровня ретуши.`,
      },
      {
        category: 'price',
        question: 'Что входит в базовую стоимость?',
        answer: 'Съемка в студии, несколько дублей, подготовка размера под документ и печать комплекта. Дополнительную ретушь и цифровые файлы можно добавить при оформлении.',
      },
    ];
  });

  protected readonly filteredFaqItems = computed(() =>
    this.faqItems().filter(item => item.category === this.activeFaqTab())
  );

  constructor() {
    this.seoService.updateCanonicalUrl('/foto-na-document');

    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });

        const onScroll = () => {
          this.showStickyCta.set(window.scrollY > 520);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        this.destroyRef.onDestroy(() => {
          window.removeEventListener('scroll', onScroll);
        });
      });
    }
  }

  ngOnInit(): void {
    this.pricing.loadCategories();
    void this.setupSEO();
  }

  protected selectFaqTab(tabId: FaqTabId): void {
    this.activeFaqTab.set(tabId);
  }

  private async setupSEO(): Promise<void> {
    this.seoService.clearJsonLd();
    const price = this.studioPrice();
    const title = 'Фото на документы в Ростове-на-Дону - студийная съемка и ручная ретушь';
    const description = `Фото на документы в студии Своё Фото. Несколько дублей, ручная ретушь, печать комплекта и подготовка под требования документа. От ${price} рублей.`;
    const primaryImage = `https://svoefoto.ru${this.heroPhotoSample.src}`;
    const secondaryImage = `https://svoefoto.ru${this.darkCtaPhotoSample.src}`;
    this.seoService.setAllMetaData(title, description, primaryImage);

    try {
      const testimonialsData = await this.testimonialService.getTestimonials();

      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': 'Фото на документы с ручной ретушью',
        'alternateName': 'Фото на паспорт',
        'image': [
          primaryImage,
          secondaryImage
        ],
        'description': `Профессиональное фото на документы в Своё Фото. Ручная ретушь. Дети и взрослые. От ${price} рублей.`,
        'serviceType': 'Фото на документы',
        'category': 'Фотоуслуги',
        'provider': {
          '@type': 'LocalBusiness',
          'name': 'Своё Фото',
          'address': {
            '@type': 'PostalAddress',
            'addressLocality': 'Ростов-на-Дону',
            'streetAddress': 'переулок Соборный, 21',
            'addressCountry': 'RU'
          },
          'telephone': this.addressInfo.phone,
          'url': 'https://svoefoto.ru'
        },
        'offers': {
          '@type': 'Offer',
          'url': 'https://svoefoto.ru/foto-na-document',
          'priceCurrency': 'RUB',
          'price': price.toString(),
          'priceValidUntil': '2026-12-31',
          'itemCondition': 'https://schema.org/NewCondition',
          'availability': 'https://schema.org/InStock'
        },
        'aggregateRating': {
          '@type': 'AggregateRating',
          'ratingValue': testimonialsData.overallRating.toString(),
          'reviewCount': testimonialsData.reviewCount.toString(),
          'bestRating': '5',
          'worstRating': '1'
        },
        'review': testimonialsData.testimonials.slice(0, 3).map((testimonial: Testimonial) => ({
          '@type': 'Review',
          'author': { '@type': 'Person', 'name': testimonial.author },
          'reviewRating': { '@type': 'Rating', 'ratingValue': testimonial.rating.toString(), 'bestRating': '5', 'worstRating': '1' },
          'reviewBody': testimonial.content,
          'datePublished': new Date().toISOString().split('T')[0]
        })),
        'areaServed': {
          '@type': 'Place',
          'address': { '@type': 'PostalAddress', 'addressLocality': 'Ростов-на-Дону', 'addressCountry': 'RU' }
        }
      });
    } catch {
      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': 'Фото на документы с ручной ретушью',
        'image': primaryImage,
        'description': `Профессиональное фото на документы. Ручная ретушь. Дети и взрослые. От ${price} рублей.`,
        'provider': {
          '@type': 'LocalBusiness',
          'name': 'Своё Фото',
          'address': { '@type': 'PostalAddress', 'addressLocality': 'Ростов-на-Дону', 'streetAddress': 'переулок Соборный, 21', 'addressCountry': 'RU' },
          'telephone': this.addressInfo.phone,
          'url': 'https://svoefoto.ru'
        },
        'offers': {
          '@type': 'Offer',
          'url': 'https://svoefoto.ru/foto-na-document',
          'priceCurrency': 'RUB',
          'price': price.toString(),
          'priceValidUntil': '2026-12-31',
          'itemCondition': 'https://schema.org/NewCondition',
          'availability': 'https://schema.org/InStock'
        },
        'aggregateRating': { '@type': 'AggregateRating', 'ratingValue': '5.0', 'reviewCount': '482', 'bestRating': '5', 'worstRating': '1' },
        'areaServed': {
          '@type': 'Place',
          'address': { '@type': 'PostalAddress', 'addressLocality': 'Ростов-на-Дону', 'addressCountry': 'RU' }
        }
      });
    }

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': 'https://svoefoto.ru/' },
        { '@type': 'ListItem', 'position': 2, 'name': 'Услуги', 'item': 'https://svoefoto.ru/services' },
        { '@type': 'ListItem', 'position': 3, 'name': 'Фото на документы', 'item': 'https://svoefoto.ru/foto-na-document' }
      ]
    });
  }
}
