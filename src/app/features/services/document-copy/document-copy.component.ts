import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { ServicesSectionComponent } from '../../../shared/components/services-section/services-section.component';
import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { ServiceCtaComponent, CtaButton } from '../../../shared/components/service-cta/service-cta.component';
import { ServiceProcessComponent, ProcessStep } from '../../../shared/components/service-process/service-process.component';
import { ServicePricingComponent, PriceItem } from '../../../shared/components/service-pricing/service-pricing.component';
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESSES, ADDRESS_INFO } from '../../../core/data/address.data';
import { SERVICES } from '../../../core/data/services.data';
import { ABOUT_DATA } from '../../../core/data/about.data';

@Component({
  selector: 'app-document-copy',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDividerModule,
    ContactsSectionComponent,
    ServicesSectionComponent,
    TestimonialsComponent,
    ServiceCtaComponent,
    ServiceProcessComponent,
    ServicePricingComponent
],
  templateUrl: './document-copy.component.html',
  styleUrls: ['./document-copy.component.scss']
})
export class DocumentCopyComponent implements OnInit {

  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  layout = inject(ResponsiveLayoutService);

  constructor() {
    this.seoService.updateCanonicalUrl('/document-copy');
  }

  // Data
  contacts = CONTACTS;
  addresses = ADDRESSES;
  addressInfo = ADDRESS_INFO;
  services = SERVICES;
  aboutData = ABOUT_DATA;
  // Document copy specific data
  documentCopyData = {
    // AIDA: Attention - Привлекаем внимание
    title: 'Ксерокопия документов в Ростове-на-Дону',
    subtitle: 'Срочно нужна копия? Всего 3 рубля за лист!',
    description: 'Профессиональная ксерокопия документов в Своё Фото. Высокое качество, доступные цены, быстрое обслуживание в центре Ростова-на-Дону.',
    price: 'от 3 рублей за лист',

    // AIDA: Interest - Вызываем интерес
    benefits: [
      'Копирование за 30 секунд',
      'Качество как у оригинала',
      'Без очередей и ожидания',
      'Работаем без выходных',
      'В центре города, рядом с метро',
      'Принимаем любые документы'
    ],

    // AIDA: Desire - Формируем желание
    features: [
      {
        icon: 'flash_on',
        title: 'Мгновенная готовность',
        description: 'Ваши копии готовы уже через 30 секунд'
      },
      {
        icon: 'high_quality',
        title: 'Идеальное качество',
        description: 'Современное оборудование Canon - четкость как у оригинала'
      },
      {
        icon: 'attach_money',
        title: 'Честные цены',
        description: 'Всего 3 рубля за лист А4, без скрытых доплат'
      },
      {
        icon: 'shield',
        title: 'Полная конфиденциальность',
        description: 'Ваши документы в безопасности - не храним копии'
      },
      {
        icon: 'location_on',
        title: 'Удобное расположение',
        description: 'Центр города, 2 минуты от станции метро'
      },
      {
        icon: 'schedule',
        title: 'Работаем для вас',
        description: 'Без выходных, с 9:00 до 21:00 каждый день'
      }
    ],

    // AIDA: Action - Призыв к действию
    urgency: {
      title: 'Нужна копия прямо сейчас?',
      subtitle: 'Приходите к нам - сделаем за минуту!',
      cta: 'Позвонить и узнать детали'
    },

    documentTypes: [
      'Паспорта и удостоверения',
      'Дипломы и аттестаты',
      'Справки любого типа',
      'Медицинские документы',
      'Трудовые книжки',
      'Договоры и соглашения',
      'Технические документы',
      'Чертежи и схемы'
    ],

    workingHours: this.addressInfo.workHours,
    location: this.addressInfo.address,
    phone: this.addressInfo.phone
  };

  // CTA данные
  ctaButtons: CtaButton[] = [
    { text: 'Позвонить сейчас', icon: 'phone', action: 'call', primary: true, phone: '+78633226575' },
    { text: 'Проложить маршрут', icon: 'directions', action: 'route' }
  ];

  // Процесс работы
  processSteps: ProcessStep[] = [
    {
      title: 'Приходите к нам',
      description: 'Принесите документы, которые нужно скопировать',
      icon: 'person_pin_circle',
      duration: '1 минута'
    },
    {
      title: 'Быстрое копирование',
      description: 'Наш специалист делает качественные копии',
      icon: 'content_copy',
      duration: '30 секунд'
    },
    {
      title: 'Получите результат',
      description: 'Забираете готовые копии и оплачиваете',
      icon: 'check_circle',
      duration: '1 минута'
    }
  ];

  // Цены
  priceItems: PriceItem[] = [
    {
      title: 'Копия А4',
      price: '3 ₽',
      note: 'за лист',
      features: [
        'Черно-белая копия',
        'Высокое качество 600 dpi',
        'Готовность 30 секунд',
        'Любые документы'
      ],
      popular: true
    },
    {
      title: 'Копия А3',
      price: '15 ₽',
      note: 'за лист',
      features: [
        'Большой формат',
        'Черно-белая копия',
        'Чертежи и схемы',
        'Готовность 1 минута'
      ]
    },
    {
      title: 'Цветная копия А4',
      price: '25 ₽',
      note: 'за лист',
      features: [
        'Полноцветная печать',
        'Фотографическое качество',
        'Документы с логотипами',
        'Готовность 1 минута'
      ]
    }
  ];// Responsive properties
  get isMobile() {
    return this.layout.isMobile$;
  }
  get isTablet() {
    return this.layout.isTablet$;
  }
  get isDesktop() {
    return this.layout.isDesktop$;
  }

  ngOnInit() {
    this.setupSEO();
  }
  private setupSEO() {
    const title = 'Ксерокопия документов в Ростове-на-Дону | Своё Фото';
    const description = 'Ксерокопия документов в Ростове-на-Дону. Быстрое и аккуратное копирование любых бумаг за 3 рубля. Высокое качество, быстрое обслуживание в центре города.';
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    this.seoService.setOpenGraph(title, description, 'https://svoefoto.ru/static/copy.webp');

    // JSON-LD structured data
    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Product',
      'name': 'Ксерокопия документов',
      'image': 'https://svoefoto.ru/static/copy.webp',
      'description': 'Ксерокопия документов за 3 рубля в Своё Фото, Ростов-на-Дону. Быстрое и аккуратное копирование любых бумаг.',
      'brand': {
        '@type': 'Brand',
        'name': 'Своё Фото'
      },
      'offers': {
        '@type': 'Offer',
        'url': 'https://svoefoto.ru/document-copy',
        'priceCurrency': 'RUB',
        'price': '3',
        'priceValidUntil': '2026-12-31',
        'itemCondition': 'https://schema.org/NewCondition',
        'availability': 'https://schema.org/InStock'
      },
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': '5.0',
        'reviewCount': '482'
      },
      'areaServed': {
        '@type': 'Place',
        'address': {
          '@type': 'PostalAddress',
          'addressLocality': 'Ростов-на-Дону',
          'streetAddress': 'переулок Соборный, 21',
          'addressCountry': 'RU'
        }
      }
    });
  }
  onBookService() {
    if (isPlatformBrowser(this.platformId)) {
      // Переход на страницу онлайн бронирования Контур.Маркет
      window.open('/booking', '_self');
    }
  }
  onCallPhone() {
    if (isPlatformBrowser(this.platformId)) {
      // Извлекаем номер телефона из первого звонка в контактах
      const phoneLink = this.contacts.links.find(link => link.icon === 'call');
      if (phoneLink) {
        window.open(phoneLink.href, '_self');
      } else {
        // Fallback на номер из адресной информации
        window.open(`tel:${this.addressInfo.phone.replace(/\D/g, '')}`, '_self');
      }
    }
  }

  onGetDirections() {
    if (isPlatformBrowser(this.platformId)) {
      const address = encodeURIComponent(this.addressInfo.address);
      window.open(`https://maps.google.com/maps?q=${address}`, '_blank');
    }
  }

  // Navigation methods
  scrollToServices() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('services-section');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  scrollToContacts() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('contacts-section');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  scrollToReviews() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('reviews-section');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  // Обработчик CTA кнопок
  onCtaButtonClick(button: CtaButton): void {
    switch (button.action) {
      case 'call':
        if (button.phone) {
          window.location.href = `tel:${button.phone}`;
        }
        break;
      case 'route': {
        const address = encodeURIComponent(this.addressInfo.address);
        window.open(`https://yandex.ru/maps/?text=${address}`, '_blank');
        break;
      }
      case 'book':
        this.scrollToContacts();
        break;
      default:
        this.scrollToContacts();
        break;
    }
  }
}
