import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESSES } from '../../../core/data/address.data';
import { SERVICES } from '../../../core/data/services.data';

@Component({
  selector: 'app-immortal-polk-stander',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule,
    MatTabsModule,
    MatExpansionModule,
    ContactsSectionComponent,
    TestimonialsComponent
],
  templateUrl: './immortal-polk-stander.component.html',
  styleUrls: ['./immortal-polk-stander.component.scss']
})
export class ImmortalPolkStanderComponent implements OnInit {
  
  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  layout = inject(ResponsiveLayoutService);

  // Data
  contacts = CONTACTS;
  addresses = ADDRESSES;
  services = SERVICES;

  // Responsive signals (конвертированы из Observable)
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Basic properties for template
  price = 300;
  urgentPrice = 450;

  // Stander sizes for template
  standerSizes = [
    {
      icon: 'photo',
      title: 'Стандартный штендер',
      description: 'Классический размер для портрета',
      specifications: [
        { label: 'Размер', value: 'A4 (21×30 см)' },
        { label: 'Материал', value: 'Фотобумага премиум' },
        { label: 'Ламинирование', value: 'Глянцевое' },
        { label: 'Палочка', value: 'Деревянная, 50 см' }
      ],
      price: 300
    },
    {
      icon: 'photo_size_select_large',
      title: 'Большой штендер',
      description: 'Увеличенный размер для лучшей видимости',
      specifications: [
        { label: 'Размер', value: 'A3 (30×42 см)' },
        { label: 'Материал', value: 'Фотобумага премиум' },
        { label: 'Ламинирование', value: 'Матовое/глянцевое' },
        { label: 'Палочка', value: 'Деревянная, 60 см' }
      ],
      price: 450
    },
    {
      icon: 'photo_camera',
      title: 'Премиум штендер',
      description: 'Максимальное качество и долговечность',
      specifications: [
        { label: 'Размер', value: 'A2 (42×59 см)' },
        { label: 'Материал', value: 'Фотобумага люкс' },
        { label: 'Ламинирование', value: 'Антибликовое' },
        { label: 'Палочка', value: 'Бамбуковая, 70 см' }
      ],
      price: 650
    }
  ];

  // Process steps
  processSteps = [
    {
      title: 'Принесите фото',
      description: 'Приносите фотографию вашего героя или присылайте файл',
      icon: 'photo_library'
    },
    {
      title: 'Обработка',
      description: 'Обрабатываем изображение для печати высокого качества',
      icon: 'tune'
    },
    {
      title: 'Печать',
      description: 'Печатаем на профессиональном оборудовании',
      icon: 'print'
    },
    {
      title: 'Ламинирование',
      description: 'Защищаем фото от влаги и выцветания',
      icon: 'security'
    },
    {
      title: 'Сборка',
      description: 'Крепим к деревянной палочке профессионально',
      icon: 'build'
    },
    {
      title: 'Готово',
      description: 'Ваш штендер готов к участию в шествии',
      icon: 'done_all'
    }
  ];

  // Advantages
  advantages = [
    {
      icon: 'flash_on',
      title: 'Быстрое изготовление',
      description: 'Готов за 1 час при срочном заказе'
    },
    {
      icon: 'high_quality',
      title: 'Высокое качество',
      description: 'Профессиональная печать и материалы'
    },
    {
      icon: 'water_drop',
      title: 'Защита от влаги',
      description: 'Ламинирование защитит от дождя'
    },
    {
      icon: 'wb_sunny',
      title: 'Стойкость цвета',
      description: 'Не выгорает на солнце долгое время'
    },
    {
      icon: 'handyman',
      title: 'Прочное крепление',
      description: 'Надежная фиксация на деревянной палочке'
    },
    {
      icon: 'favorite',
      title: 'С заботой о памяти',
      description: 'Каждый штендер делаем с особым вниманием'
    }
  ];

  // Requirements
  photoRequirements = [
    'Хорошее качество исходного фото',
    'Разрешение не менее 300 DPI',
    'Четкое изображение лица',
    'Желательно портретная ориентация',
    'Форматы: JPG, PNG, TIFF',
    'Можем обработать старые фотографии'
  ];

  // Testimonials
  testimonials = [
    {
      id: '1',
      name: 'Людмила Петровна',
      text: 'Спасибо большое за качественный штендер моего деда! Получилось очень достойно, фото четкое, не промокло под дождем.',
      rating: 5,
      date: '2024-05-08',
      avatar: '/assets/images/testimonials/lyudmila-p.jpg'
    },
    {
      id: '2',
      name: 'Сергей Михайлович',
      text: 'Сделали штендер за час! Очень нужно было срочно. Качество отличное, палочка крепкая. Рекомендую!',
      rating: 5,
      date: '2024-05-07',
      avatar: '/assets/images/testimonials/sergey-m.jpg'
    },
    {
      id: '3',
      name: 'Анна Васильевна',
      text: 'Каждый год заказываю штендеры для всей семьи. Всегда высокое качество и бережное отношение к фотографиям наших героев.',
      rating: 5,
      date: '2024-05-06',
      avatar: '/assets/images/testimonials/anna-v.jpg'
    }
  ];

  // FAQ
  faqItems = [
    {
      question: 'Какого размера должно быть исходное фото?',
      answer: 'Для качественной печати рекомендуется разрешение не менее 300 DPI. Мы можем обработать и улучшить старые фотографии.'
    },
    {
      question: 'За какое время можно изготовить штендер?',
      answer: 'Обычный заказ готов в течение 2-3 часов. При срочном заказе - за 1 час с доплатой 150 рублей.'
    },
    {
      question: 'Можно ли заказать штендер онлайн?',
      answer: 'Да, присылайте фотографию через ВКонтакте или Telegram. Мы обработаем и подготовим штендер к вашему приходу.'
    },
    {
      question: 'Какая гарантия на штендер?',
      answer: 'Мы гарантируем качество печати и материалов. При правильном хранении штендер прослужит много лет.'
    },
    {
      question: 'Принимаете ли старые, поврежденные фото?',
      answer: 'Да, мы можем восстановить и улучшить качество старых фотографий перед печатью штендера.'
    }
  ];

  ngOnInit(): void {
    this.setupSEO();
  }

  private setupSEO(): void {
    this.seoService.setAllMetaData(
      'Штендер Бессмертный полк, Фото ветерана на палочке в Ростове-на-Дону от 300₽ | Своё Фото',
      'Изготовление штендеров для акции Бессмертный полк. Фотография ветерана на деревянной палочке A4 и A3. Печать за 30 минут, качество премиум. ☎️ +7(863)322-65-75',
      undefined,
      '/immortal-polk-stander',
      'штендер бессмертный полк, фото ветерана на палочке, портрет ветерана война, изготовление штендеров ростов-на-дону, акция бессмертный полк'
    );

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Штендер Бессмертный полк',
      'description': 'Изготовление штендеров для акции Бессмертный полк, фотографии ветеранов на деревянной палочке. Размеры A4 и A3, печать за 30 минут.',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Своё Фото',
        'address': {
          '@type': 'PostalAddress',
          'streetAddress': 'переулок Соборный, 21',
          'addressLocality': 'Ростов-на-Дону',
          'addressRegion': 'Ростовская область',
          'postalCode': '344006',
          'addressCountry': 'RU'
        },
        'telephone': '+7(863)322-65-75',
        'email': 'info@svoefoto.ru',
        'url': 'https://svoefoto.ru',
        'geo': {
          '@type': 'GeoCoordinates',
          'latitude': 47.219706,
          'longitude': 39.7107641
        },
        'openingHours': 'Mo-Su 09:00-19:30'
      },
      'offers': [
        {
          '@type': 'Offer',
          'name': 'Штендер A4',
          'price': '300',
          'priceCurrency': 'RUB',
          'description': 'Штендер Бессмертный полк размер A4 на деревянной палочке'
        },
        {
          '@type': 'Offer',
          'name': 'Штендер A3',
          'price': '450',
          'priceCurrency': 'RUB',
          'description': 'Штендер Бессмертный полк размер A3 на деревянной палочке'
        }
      ],
      'serviceType': 'Печать фотографий',
      'areaServed': {
        '@type': 'City',
        'name': 'Ростов-на-Дону'
      }
    });
  }

  // Navigation methods
  scrollToServices() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('services');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  scrollToContacts() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('contacts');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  callPhone() {
    if (isPlatformBrowser(this.platformId)) {
      const phoneLink = this.contacts.links.find(link => link.icon === 'call');
      if (phoneLink) {
        window.location.href = phoneLink.href;
      }
    }
  }
}






