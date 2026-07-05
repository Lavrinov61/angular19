import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID, afterNextRender, signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { TestimonialService } from '../../../shared/components/testimonials/testimonial.service';
import { Testimonial } from '../../../shared/components/testimonials/testimonial.model';
import { ProcessSliderComponent, ProcessStep } from '../../../shared/components/process-slider/process-slider.component';
import { AdvantagesSectionComponent } from '../../../shared/components/advantages-section/advantages-section.component';
import { AuthChatService } from '../../../core/services/auth-chat.service';
import { PricesService } from '../../../core/services/prices.service';
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESS_INFO, ADDRESSES } from '../../../core/data/address.data';

@Component({
  selector: 'app-pechat-foto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatExpansionModule,
    ContactsSectionComponent,
    TestimonialsComponent,
    ProcessSliderComponent,
    AdvantagesSectionComponent,
  ],
  templateUrl: './pechat-foto.component.html',
  styleUrls: ['./pechat-foto.component.scss']
})
export class PechatFotoComponent implements OnInit {

  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private layout = inject(ResponsiveLayoutService);
  private testimonialService = inject(TestimonialService);
  private visitorChatService = inject(AuthChatService);
  private pricesService = inject(PricesService);

  inlineChatVisible = signal(false);

  constructor() {
    this.seoService.updateCanonicalUrl('/pechat-foto');

    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        if (window.innerWidth >= 1024) {
          this.inlineChatVisible.set(true);
          this.visitorChatService.openChat({
            service: 'Печать фотографий',
            price: 0,
            pageUrl: window.location.href,
            channel: 'studio',
          });
        }
      });
    }
  }

  // Data
  contacts = CONTACTS;
  addressInfo = ADDRESS_INFO;
  addresses = ADDRESSES;

  // Responsive signals
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Dynamic prices
  readonly prices = this.pricesService.prices;
  readonly minPrice = computed(() => Math.ceil(this.pricesService.minPrice()));

  // Price table
  readonly priceTable = computed(() => {
    const p = this.prices();
    return [
      { format: '10×15', premium: p.premium_10x15, super: p.super_10x15 },
      { format: '15×20', premium: p.premium_15x20, super: p.super_15x20 },
      { format: '20×30', premium: p.premium_20x30, super: p.super_20x30 },
    ];
  });

  // Process steps
  processSteps: ProcessStep[] = [
    { number: 1, title: 'Принесите или отправьте фото', description: 'Приходите с флешкой, телефоном, или отправьте файлы в чат', icon: 'cloud_upload', details: ['С телефона или камеры', 'Флешка или облако', 'Через Telegram/МАКС'] },
    { number: 2, title: 'Подберём формат и бумагу', description: 'Поможем выбрать размер, тип бумаги и количество', icon: 'support_agent', details: ['Глянцевая или матовая', 'Любой формат', 'Консультация бесплатно'] },
    { number: 3, title: 'Корректировка цвета', description: 'При необходимости подправим яркость, контраст и цвета', icon: 'tune', details: ['Коррекция яркости', 'Кадрирование', 'Бесплатно'] },
    { number: 4, title: 'Печать на профессиональном оборудовании', description: 'Печатаем на фотобумаге премиум-класса с точной цветопередачей', icon: 'print', details: ['Бумага премиум-класса', 'Калиброванный цвет', '300+ dpi'] },
    { number: 5, title: 'Проверка и выдача', description: 'Проверяем каждый снимок и упаковываем. Готово за 15 минут', icon: 'verified', details: ['Контроль качества', 'Аккуратная упаковка', 'Готово за 15 мин'] },
  ];

  // Advantages
  advantages = [
    { icon: 'high_quality', title: 'Профессиональное оборудование', description: 'Печать на фотолабе, не на офисном принтере' },
    { icon: 'palette', title: 'Точная цветопередача', description: 'Калиброванные мониторы и оборудование' },
    { icon: 'eco', title: 'Фотобумага премиум-класса', description: 'Премиум-бумага с насыщенными цветами на десятилетия' },
    { icon: 'schedule', title: 'Готово за 15 минут', description: 'Небольшие заказы печатаем при вас' },
    { icon: 'inventory_2', title: 'Любые форматы', description: 'От 10×15 до больших постеров и холстов' },
    { icon: 'thumb_up', title: 'Гарантия качества', description: 'Перепечатаем бесплатно, если вас что-то не устроит' },
  ];

  // FAQ
  faqItems = computed(() => {
    const p = this.prices();
    return [
      { question: 'Сколько стоит печать фото 10×15?', answer: `Премиум печать 10×15, ${p.premium_10x15}₽, Супер печать, ${p.super_10x15}₽ за штуку. Минимального заказа нет, можно напечатать даже одно фото.` },
      { question: 'Чем отличается Премиум от Супер?', answer: 'Обе линейки используют профессиональную фотобумагу. Супер, это усиленная бумага с более плотной основой и повышенной стойкостью цвета. Премиум, отличное качество по доступной цене.' },
      { question: 'Можно ли напечатать фото с телефона?', answer: 'Да! Самый простой способ, отправить фото нам в Telegram. Или приходите с телефоном, скинем через AirDrop/Bluetooth.' },
      { question: 'Как быстро будет готов заказ?', answer: 'Небольшие заказы (до 50 фото), 15-30 минут. Крупные тиражи, в тот же день.' },
      { question: 'Делаете ли коррекцию фото перед печатью?', answer: 'Да, бесплатно корректируем яркость и контраст. Если нужна серьёзная ретушь, это отдельная услуга.' },
      { question: 'Какие форматы файлов принимаете?', answer: 'JPG, PNG, TIFF, HEIC (iPhone). Разрешение от 300 dpi для лучшего результата, но мы проверим ваши файлы и подскажем.' },
    ];
  });

  ngOnInit() {
    this.setupSEO();
  }

  private async setupSEO() {
    const mp = this.minPrice();
    const title = `Печать фотографий в Ростове-на-Дону | от ${mp}₽ | Своё Фото`;
    const description = `Качественная печать фотографий на профессиональной бумаге премиум-класса от ${mp}₽. Форматы 10×15, 15×20, 20×30, постеры. Готово за 15 минут. Без записи ежедневно.`;
    this.seoService.clearJsonLd();
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    this.seoService.setOpenGraph(title, description, 'https://svoefoto.ru/static/pechat-foto-og.webp');

    try {
      const testimonialsData = await this.testimonialService.getTestimonials();

      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': 'Печать фотографий',
        'description': `Профессиональная печать фотографий на бумаге премиум-класса от ${mp}₽. Любые форматы, готово за 15 минут.`,
        'serviceType': 'Печать фотографий',
        'category': 'Фотоуслуги',
        'provider': {
          '@type': 'LocalBusiness',
          'name': 'Своё Фото',
          'address': { '@type': 'PostalAddress', 'addressLocality': 'Ростов-на-Дону', 'streetAddress': 'переулок Соборный, 21', 'addressCountry': 'RU' },
          'telephone': this.addressInfo.phone,
          'url': 'https://svoefoto.ru'
        },
        'offers': {
          '@type': 'Offer',
          'url': 'https://svoefoto.ru/pechat-foto',
          'priceCurrency': 'RUB',
          'price': mp.toString(),
          'priceValidUntil': '2026-12-31',
          'availability': 'https://schema.org/InStock'
        },
        'aggregateRating': {
          '@type': 'AggregateRating',
          'ratingValue': testimonialsData.overallRating.toString(),
          'reviewCount': testimonialsData.reviewCount.toString(),
          'bestRating': '5',
          'worstRating': '1'
        },
        'review': testimonialsData.testimonials.slice(0, 3).map((t: Testimonial) => ({
          '@type': 'Review',
          'author': { '@type': 'Person', 'name': t.author },
          'reviewRating': { '@type': 'Rating', 'ratingValue': t.rating.toString(), 'bestRating': '5' },
          'reviewBody': t.content
        }))
      });
    } catch {
      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': 'Печать фотографий',
        'provider': { '@type': 'LocalBusiness', 'name': 'Своё Фото', 'telephone': this.addressInfo.phone },
        'offers': { '@type': 'Offer', 'priceCurrency': 'RUB', 'price': mp.toString() }
      });
    }

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': 'https://svoefoto.ru/' },
        { '@type': 'ListItem', 'position': 2, 'name': 'Услуги', 'item': 'https://svoefoto.ru/services' },
        { '@type': 'ListItem', 'position': 3, 'name': 'Печать фотографий', 'item': 'https://svoefoto.ru/pechat-foto' }
      ]
    });
  }

  openStudioChat(): void {
    if (isPlatformBrowser(this.platformId) && this.inlineChatVisible()) {
      // Desktop: скроллим к hero где уже открыт чат
      const hero = document.querySelector('.hero-section');
      hero?.scrollIntoView({ behavior: 'smooth' });
    } else {
      // Mobile: открываем чат-виджет
      this.visitorChatService.openChat({
        service: 'Печать фотографий',
        price: 0,
        pageUrl: isPlatformBrowser(this.platformId) ? window.location.href : '/pechat-foto',
        channel: 'studio',
      });
    }
  }

  scrollToContacts() {
    if (isPlatformBrowser(this.platformId)) {
      const el = document.querySelector('.contacts-section, #contacts');
      el?.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
