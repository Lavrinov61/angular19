import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID, computed } from '@angular/core';
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
import { PricesService } from '../../../core/services/prices.service';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESSES } from '../../../core/data/address.data';

@Component({
  selector: 'app-premium-print',
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
  templateUrl: './premium-print.component.html',
  styleUrls: ['./premium-print.component.scss']
})
export class PremiumPrintComponent implements OnInit {
  
  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private pricesService = inject(PricesService);
  layout = inject(ResponsiveLayoutService);

  constructor() {
    this.seoService.updateCanonicalUrl('/premium-print');
  }

  // Data
  contacts = CONTACTS;
  addresses = ADDRESSES;

  // Responsive signals (конвертированы из Observable)
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Dynamic prices from Contur.Market
  readonly prices = this.pricesService.prices;
  readonly minPrice = this.pricesService.minPrice;

  // Basic properties for template - computed from dynamic prices
  readonly basePrice = computed(() => Math.ceil(this.minPrice()));

  // Print services for template - computed with dynamic prices
  readonly printServices = computed(() => [
    {
      icon: 'star',
      title: 'Премиум печать',
      description: 'Качественная печать фотографий по доступной цене',
      formats: [
        { name: '10×15 см', price: this.prices().premium_10x15 },
        { name: '15×20 см', price: this.prices().premium_15x20 },
        { name: '20×30 см', price: this.prices().premium_20x30 }
      ],
      features: ['Глянцевая/матовая бумага', 'Срок изготовления: 15 минут', 'Цветокоррекция включена']
    },
    {
      icon: 'diamond',
      title: 'Супер печать',
      description: 'Профессиональная печать на бумаге высшего класса',
      formats: [
        { name: '10×15 см', price: this.prices().super_10x15 },
        { name: '15×20 см', price: this.prices().super_15x20 },
        { name: '20×30 см', price: this.prices().super_20x30 }
      ],
      features: ['Профессиональная бумага', 'Расширенная цветовая гамма', 'Индивидуальная цветокоррекция']
    },
    {
      icon: 'palette',
      title: 'Художественная печать',
      description: 'Печать на холсте и художественной бумаге',
      formats: [
        { name: '20×30 см', price: 350 },
        { name: '30×40 см', price: 550 },
        { name: '40×60 см', price: 850 },
        { name: '50×70 см', price: 1200 }
      ],
      features: ['Холст/акварельная бумага', 'Ручная доработка', 'Защитное покрытие']
    },
    {
      icon: 'photo_library',
      title: 'Большие форматы',
      description: 'Печать плакатов и постеров высокого качества',
      formats: [
        { name: 'A3 (30×42 см)', price: 250 },
        { name: 'A2 (42×59 см)', price: 450 },
        { name: 'A1 (59×84 см)', price: 750 },
        { name: 'A0 (84×119 см)', price: 1200 }
      ],
      features: ['Профессиональный принтер', 'Стойкие краски', 'Любые материалы']
    }
  ]);

  // Process steps
  processSteps = [
    {
      title: 'Отправка файлов',
      description: 'Присылайте фотографии через ВКонтакте, Email или приносите на флешке',
      icon: 'cloud_upload'
    },
    {
      title: 'Консультация',
      description: 'Обсуждаем формат, тип бумаги и особые пожелания',
      icon: 'support_agent'
    },
    {
      title: 'Цветокоррекция',
      description: 'Профессиональная обработка для идеального результата',
      icon: 'tune'
    },
    {
      title: 'Печать',
      description: 'Печатаем на профессиональном оборудовании',
      icon: 'print'
    },
    {
      title: 'Контроль качества',
      description: 'Проверяем каждую фотографию перед выдачей',
      icon: 'verified'
    },
    {
      title: 'Готово!',
      description: 'Забираете готовые фотографии или доставляем курьером',
      icon: 'done_all'
    }
  ];

  // Advantages
  advantages = [
    {
      icon: 'high_quality',
      title: 'Премиум качество',
      description: 'Профессиональные принтеры и материалы'
    },
    {
      icon: 'speed',
      title: 'Быстро',
      description: 'Стандартная печать за 30 минут'
    },
    {
      icon: 'palette',
      title: 'Идеальные цвета',
      description: 'Калиброванное оборудование и цветокоррекция'
    },
    {
      icon: 'inventory',
      title: 'Много форматов',
      description: 'От 10×15 см до плакатов А0'
    },
    {
      icon: 'recycling',
      title: 'Эко-материалы',
      description: 'Безопасные краски и бумага'
    },
    {
      icon: 'local_shipping',
      title: 'Доставка',
      description: 'Курьерская доставка по городу'
    }
  ];

  // FAQ items
  faqItems = [
    {
      question: 'Какие форматы файлов принимаете?',
      answer: 'Мы принимаем все популярные форматы: JPEG, PNG, TIFF, RAW, PSD. Для наилучшего качества рекомендуем TIFF или максимальное качество JPEG.'
    },
    {
      question: 'Какое разрешение должно быть у фотографий?',
      answer: 'Для печати 10×15 см достаточно 1800×1200 пикселей (300 dpi). Для больших форматов - соответственно больше. Мы поможем определить оптимальный размер печати для ваших файлов.'
    },
    {
      question: 'Можете ли вы улучшить качество старых фотографий?',
      answer: 'Да! Мы предлагаем услуги по реставрации и улучшению старых фотографий: устранение царапин, восстановление цвета, повышение резкости.'
    },
    {
      question: 'Как долго хранятся готовые фотографии?',
      answer: 'Готовые фотографии хранятся у нас 30 дней. Также мы можем отправить их курьером или почтой в любой город.'
    },
    {
      question: 'Делаете ли скидки при больших тиражах?',
      answer: 'Да! При заказе от 50 фотографий действует скидка 10%, от 100 фотографий - 15%, от 200 фотографий - 20%.'
    },
    {
      question: 'Можно ли заказать печать в рамках?',
      answer: 'Конечно! У нас большой выбор рамок и паспарту. Также делаем багетное оформление для художественных работ.'
    }
  ];

  ngOnInit(): void {
    this.setupSEO();
  }
  private setupSEO(): void {
    const title = 'Печать фотографий в Ростове-на-Дону от 20₽ | Своё Фото';
    const description = 'Печать фотографий в Ростове-на-Дону от 20₽. Премиум от 20₽, Супер от 36₽. Высокое качество, моментальная печать за 15 минут!';
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    this.seoService.setOpenGraph(title, description);

    // Add structured data
    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Печать фотографий',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Своё Фото',
        'address': {
          '@type': 'PostalAddress',
          'streetAddress': 'переулок Соборный, 21',
          'addressLocality': 'Ростов-на-Дону',
          'addressCountry': 'RU'
        }
      },
      'description': 'Печать фотографий в Ростове-на-Дону. Премиум от 20₽, Супер от 36₽. Высокое качество, моментальная печать за 15 минут.',
      'offers': [
        {
          '@type': 'Offer',
          'name': 'Премиум печать 10×15',
          'price': '20',
          'priceCurrency': 'RUB'
        },
        {
          '@type': 'Offer',
          'name': 'Супер печать 10×15',
          'price': '36',
          'priceCurrency': 'RUB'
        }
      ]
    });
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

  scrollToServices() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('services');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  scrollToPricing() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('pricing');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }
}
