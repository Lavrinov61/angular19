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
import { Meta, Title } from '@angular/platform-browser';
import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESSES } from '../../../core/data/address.data';

@Component({
  selector: 'app-document-plus',
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
  templateUrl: './document-plus.component.html',
  styleUrls: ['./document-plus.component.scss']
})
export class DocumentPlusComponent implements OnInit {
  
  private seoService = inject(SeoService);
  private meta = inject(Meta);
  private title = inject(Title);
  private platformId = inject(PLATFORM_ID);
  layout = inject(ResponsiveLayoutService);

  constructor() {
    this.seoService.updateCanonicalUrl('/document-plus');
  }

  // Data
  contacts = CONTACTS;
  addresses = ADDRESSES;

  // Responsive signals (конвертированы из Observable)
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Basic properties for template
  price = 490;
  oldPrice = 650;
  savings = 160;

  // Package includes
  packageIncludes = [
    {
      icon: 'photo_camera',
      title: '4 фото на документы',
      description: 'Стандартные фото для паспорта или других документов в соответствии с ГОСТ',
      value: '200 ₽'
    },
    {
      icon: 'portrait',
      title: 'Мини-портрет',
      description: 'Красивый портрет для соцсетей с базовой ретушью',
      value: '250 ₽'
    },
    {
      icon: 'print',
      title: 'Печать 10×15',
      description: 'Качественная печать портрета на фотобумаге в подарок',
      value: '200 ₽'
    }
  ];

  // Process steps
  processSteps = [
    {
      title: 'Одна съёмка',
      description: 'Делаем фото на документы и портрет за одну сессию',
      icon: 'camera_alt'
    },
    {
      title: 'Обработка',
      description: 'Готовим фото по ГОСТ и делаем базовую ретушь портрета',
      icon: 'tune'
    },
    {
      title: 'Печать',
      description: 'Печатаем документальные фото и портрет 10×15',
      icon: 'print'
    },
    {
      title: 'Готово',
      description: 'Получаете всё готовое через 10-15 минут',
      icon: 'done_all'
    }
  ];

  // Advantages
  advantages = [
    {
      icon: 'savings',
      title: 'Экономия 160 ₽',
      description: 'Получаете всё сразу по специальной цене'
    },
    {
      icon: 'schedule',
      title: 'Быстро',
      description: 'Всё готово за 10-15 минут'
    },
    {
      icon: 'auto_fix_high',
      title: 'С ретушью',
      description: 'Портрет с базовой обработкой включён'
    },
    {
      icon: 'verified',
      title: 'ГОСТ стандарт',
      description: 'Фото на документы по всем требованиям'
    },
    {
      icon: 'card_giftcard',
      title: 'Печать в подарок',
      description: 'Красивый портрет 10×15 бесплатно'
    },
    {
      icon: 'person_add',
      title: 'Для соцсетей',
      description: 'Готовый аватар для профилей'
    }
  ];

  // Testimonials
  testimonials = [
    {
      name: 'Анна К.',
      text: 'Отличный пакет! Пришла за фото на паспорт, а получила ещё и красивый портрет. Очень довольна результатом!',
      rating: 5,
      date: '2025-05-15',
      avatar: '/assets/images/testimonials/anna-k.jpg'
    },
    {
      name: 'Дмитрий М.',
      text: 'Удобно и выгодно. За одну поездку решил все свои задачи с фотографиями. Качество отличное!',
      rating: 5,
      date: '2025-05-10',
      avatar: '/assets/images/testimonials/dmitry-m.jpg'
    },
    {
      name: 'Елена Р.',
      text: 'Супер предложение! Фото на документы нужны были срочно, а портрет получился как бонус. Всем рекомендую!',
      rating: 5,
      date: '2025-05-08',
      avatar: '/assets/images/testimonials/elena-r.jpg'
    }
  ];

  // FAQ
  faqItems = [
    {
      question: 'Что входит в комплект "Документы Плюс"?',
      answer: '4 фотографии на документы (35×45 мм), мини-портрет с базовой ретушью и печать портрета 10×15 см в подарок.'
    },
    {
      question: 'Сколько времени займёт съёмка?',
      answer: 'Весь процесс от съёмки до получения готовых фотографий занимает 10-15 минут.'
    },
    {
      question: 'Можно ли изменить размер фото на документы?',
      answer: 'Да, мы можем адаптировать размер под любые документы: паспорт, водительские права, студенческий билет и др.'
    },
    {
      question: 'Какая ретушь включена в портрет?',
      answer: 'Базовая ретушь включает коррекцию цвета, лёгкое сглаживание кожи и устранение мелких недостатков.'
    },
    {
      question: 'Можно ли получить файлы в электронном виде?',
      answer: 'Да, по желанию мы можем отправить файлы на вашу электронную почту за дополнительную плату.'
    },
    {
      question: 'Действуют ли скидки на этот пакет?',
      answer: 'Пакет "Документы Плюс" уже имеет специальную цену. Дополнительные скидки не суммируются.'
    }
  ];

  ngOnInit(): void {
    this.setupSEO();
  }

  private setupSEO(): void {
    this.title.setTitle('Документальный Комплект Плюс - Фото на документы + портрет | Своё Фото');
    
    this.meta.updateTag({
      name: 'description',
      content: 'Документальный Комплект Плюс в Ростове-на-Дону: фото на документы и мини-портрет. Быстро, качественно, с ретушью. Онлайн-запись!'
    });
    
    this.meta.updateTag({
      name: 'keywords',
      content: 'документы плюс, фото на документы, портрет, комплект, Ростов-на-Дону, Своё Фото'
    });

    this.meta.updateTag({ property: 'og:title', content: 'Документальный Комплект Плюс - Своё Фото' });
    this.meta.updateTag({ property: 'og:description', content: 'Фото на документы + мини-портрет с ретушью. Экономия 160 ₽ при заказе комплекта!' });
    this.meta.updateTag({ property: 'og:type', content: 'website' });
    this.meta.updateTag({ property: 'og:url', content: 'https://svoefoto.ru/document-plus' });
    this.meta.updateTag({ property: 'og:image', content: 'https://svoefoto.ru/assets/images/document-plus-hero.jpg' });    // Структурированные данные
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Документальный Комплект Плюс',
      'description': 'Комплексная услуга: фото на документы + мини-портрет с ретушью',
      'provider': {
        '@type': 'Organization',
        'name': 'Своё Фото',
        'address': {
          '@type': 'PostalAddress',
          'addressLocality': 'Ростов-на-Дону',
          'addressCountry': 'RU'
        }
      },
      'offers': {
        '@type': 'Offer',
        'price': '490',
        'priceCurrency': 'RUB',
        'availability': 'https://schema.org/InStock'
      },
      'aggregateRating': {
        '@type': 'AggregateRating',
        'ratingValue': '5.0',
        'reviewCount': '150'
      }
    };

    // Добавляем структурированные данные через JSON-LD script tag
    this.seoService.addJsonLd(structuredData);
  }

  // Navigation methods
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

  scrollToProcess() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('process');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  scrollToPackage() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('package');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }
}







