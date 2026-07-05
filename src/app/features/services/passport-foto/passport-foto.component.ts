import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID, afterNextRender, signal } from '@angular/core';
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
import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESS_INFO, ADDRESSES } from '../../../core/data/address.data';

@Component({
  selector: 'app-passport-foto',
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
  templateUrl: './passport-foto.component.html',
  styleUrls: ['./passport-foto.component.scss']
})
export class PassportFotoComponent implements OnInit {

  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private layout = inject(ResponsiveLayoutService);
  private testimonialService = inject(TestimonialService);
  private visitorChatService = inject(AuthChatService);

  inlineChatVisible = signal(false);

  constructor() {
    this.seoService.updateCanonicalUrl('/foto-na-pasport');

    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        if (window.innerWidth >= 1024) {
          this.inlineChatVisible.set(true);
          this.visitorChatService.openChat({
            service: 'Фото на паспорт',
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

  readonly bookingLink = '/booking';

  // Photo samples
  photoSamples = [
    { src: '/assets/images/passport-photo (1).webp', alt: 'Фото на паспорт РФ - образец 1', description: 'Паспорт РФ' },
    { src: '/assets/images/passport-photo (2).webp', alt: 'Фото на паспорт РФ - образец 2', description: 'Паспорт РФ' },
    { src: '/assets/images/passport-photo (7).webp', alt: 'Фото на паспорт - образец 3', description: 'Загранпаспорт' },
    { src: '/assets/images/passport-photo (4).webp', alt: 'Фото на паспорт - образец 4', description: 'Паспорт РФ' },
    { src: '/assets/images/passport 3 (4).webp', alt: 'Фото на паспорт - образец 5', description: 'Паспорт РФ' },
    { src: '/assets/images/passport 3 (2).webp', alt: 'Фото на паспорт - образец 6', description: 'Загранпаспорт' },
  ];

  // Process steps
  processSteps: ProcessStep[] = [
    { number: 1, title: 'Приходите без записи', description: 'Работаем ежедневно 9:00-19:30. Просто приходите в студию на Соборном', icon: 'directions_walk', details: ['Без предварительной записи', 'Ежедневно без выходных', 'Адрес в центре'] },
    { number: 2, title: 'Фотограф настраивает свет', description: 'Студийное освещение настраивается индивидуально под ваше лицо', icon: 'wb_sunny', details: ['Студийный свет без теней', 'Подбор ракурса', 'Помощь с позой'] },
    { number: 3, title: 'Несколько кадров на выбор', description: 'Делаем несколько дублей, выбираете тот, на котором вы себе нравитесь', icon: 'camera_alt', details: ['3-5 вариантов', 'Просмотр на экране', 'Ваш выбор'] },
    { number: 4, title: 'Обработка художником', description: 'Индивидуальная ретушь с вашими пожеланиями, не фильтр, а ручная работа', icon: 'brush', details: ['Естественная ретушь', 'Учёт пожеланий', 'Согласование результата'] },
    { number: 5, title: 'Печать и готово', description: 'Печатаем на профессиональной фотобумаге. Весь процесс, 15 минут', icon: 'print', details: ['Качественная фотобумага', 'Нужное количество', 'Готово за 15 мин'] },
  ];

  // Advantages
  advantages = [
    { icon: 'person', title: 'Профессиональный фотограф', description: 'Портретист с опытом, а не автомат или продавец' },
    { icon: 'brush', title: 'Обработка художником', description: 'Ручная ретушь с вашими пожеланиями, не AI-фильтр' },
    { icon: 'photo_library', title: 'Выбор лучшего кадра', description: 'Несколько дублей, платите только за понравившийся' },
    { icon: 'verified', title: 'Гарантия приёма', description: 'Примут в любом отделении МВД или переделаем бесплатно' },
    { icon: 'schedule', title: 'Готово за 15 минут', description: 'Съёмка, обработка и печать, всё за один визит' },
    { icon: 'camera_enhance', title: 'Студийное оборудование', description: 'Профессиональный свет и камера, ровный тон без теней' },
  ];

  // Passport requirements
  passportRequirements = [
    'Размер 35×45 мм, лицо занимает 70-80%',
    'Белый или светло-серый фон',
    'Анфас, взгляд прямо в камеру',
    'Нейтральное выражение лица',
    'Без головных уборов (кроме религиозных)',
    'Очки допускаются без тонировки и бликов',
    'Чёткое изображение без размытости',
    'Печать на матовой фотобумаге',
  ];

  // FAQ
  faqItems = [
    { question: 'Сколько фотографий я получу?', answer: 'Для паспорта РФ, 4 фотографии 35×45 мм на матовой бумаге. Для загранпаспорта, 4 фотографии. Дополнительные комплекты можно заказать на месте.' },
    { question: 'Нужна ли предварительная запись?', answer: 'Нет! Мы работаем без записи ежедневно с 9:00 до 19:30. Просто приходите в студию на Соборном.' },
    { question: 'Что если фото не примут в МВД?', answer: 'Мы гарантируем соответствие всем требованиям ГУВМ МВД. Если фото не примут по нашей вине, переснимем бесплатно.' },
    { question: 'Делаете ли вы ретушь?', answer: 'Да, каждое фото обрабатывается художником вручную. Мы учитываем ваши пожелания: выравниваем тон кожи, убираем мелкие несовершенства. При этом фото остаётся естественным и соответствует требованиям.' },
    { question: 'Можно ли выбрать лучший кадр?', answer: 'Обязательно! Мы делаем несколько дублей и показываем результат на экране. Вы сами выбираете кадр, который нравится больше всего.' },
    { question: 'Подходят ли ваши фото для Госуслуг?', answer: 'Да. Помимо печатных фото мы можем отправить электронную версию в нужном формате для загрузки на Госуслуги.' },
  ];

  ngOnInit() {
    this.setupSEO();
  }

  private async setupSEO() {
    const title = 'Фото на паспорт в Ростове-на-Дону | Своё Фото, без записи, за 15 минут';
    const description = 'Профессиональное фото на паспорт РФ и загранпаспорт в студии Своё Фото. Индивидуальная обработка художником. Гарантия приёма в МВД. Без записи ежедневно 9:00-19:30.';
    this.seoService.clearJsonLd();
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    this.seoService.setOpenGraph(title, description, 'https://svoefoto.ru/assets/images/passport-photo (1).jpg');

    try {
      const testimonialsData = await this.testimonialService.getTestimonials();

      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': 'Фото на паспорт',
        'alternateName': 'Паспортные фотографии',
        'image': 'https://svoefoto.ru/assets/images/passport-photo (1).jpg',
        'description': 'Профессиональное фото на паспорт РФ и загранпаспорт. Индивидуальная обработка художником, выбор лучшего кадра. Гарантия приёма в МВД.',
        'serviceType': 'Паспортная фотография',
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
          'url': 'https://svoefoto.ru/foto-na-pasport',
          'priceCurrency': 'RUB',
          'price': '490',
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
        'name': 'Фото на паспорт',
        'image': 'https://svoefoto.ru/assets/images/passport-photo (1).jpg',
        'description': 'Профессиональное фото на паспорт РФ и загранпаспорт в студии Своё Фото.',
        'provider': {
          '@type': 'LocalBusiness',
          'name': 'Своё Фото',
          'address': { '@type': 'PostalAddress', 'addressLocality': 'Ростов-на-Дону', 'streetAddress': 'переулок Соборный, 21', 'addressCountry': 'RU' },
          'telephone': this.addressInfo.phone,
          'url': 'https://svoefoto.ru'
        },
        'offers': {
          '@type': 'Offer',
          'url': 'https://svoefoto.ru/foto-na-pasport',
          'priceCurrency': 'RUB',
          'price': '490',
          'priceValidUntil': '2026-12-31',
          'availability': 'https://schema.org/InStock'
        },
        'aggregateRating': { '@type': 'AggregateRating', 'ratingValue': '5.0', 'reviewCount': '482', 'bestRating': '5', 'worstRating': '1' }
      });
    }

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': 'https://svoefoto.ru/' },
        { '@type': 'ListItem', 'position': 2, 'name': 'Услуги', 'item': 'https://svoefoto.ru/services' },
        { '@type': 'ListItem', 'position': 3, 'name': 'Фото на паспорт', 'item': 'https://svoefoto.ru/foto-na-pasport' }
      ]
    });
  }

  openPhotoModal(index: number) {
    if (isPlatformBrowser(this.platformId)) {
      const photo = this.photoSamples[index];
      const newWindow = window.open('', '_blank', 'width=600,height=800');
      if (newWindow) {
        newWindow.document.write(`
          <html>
            <head><title>${photo.alt}</title>
              <style>body{margin:0;padding:20px;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh}img{max-width:100%;max-height:100%;object-fit:contain}p{color:#fff;text-align:center;margin-top:10px}</style>
            </head>
            <body><div><img src="${photo.src}" alt="${photo.alt}" /><p>${photo.description}</p></div></body>
          </html>
        `);
      }
    }
  }

  onBookOnline() {
    if (isPlatformBrowser(this.platformId)) {
      if ('gtag' in window && typeof window.gtag === 'function') {
        window.gtag('event', 'conversion', {
          'send_to': 'AW-CONVERSION_ID/PASSPORT_BOOKING',
          'value': 200.0,
          'currency': 'RUB'
        });
      }
      window.open(this.bookingLink, '_blank');
    }
  }

  openStudioChat(): void {
    if (isPlatformBrowser(this.platformId) && this.inlineChatVisible()) {
      const hero = document.querySelector('.hero-section');
      hero?.scrollIntoView({ behavior: 'smooth' });
    } else {
      this.visitorChatService.openChat({
        service: 'Фото на паспорт',
        price: 0,
        pageUrl: isPlatformBrowser(this.platformId) ? window.location.href : '/foto-na-pasport',
        channel: 'studio',
      });
    }
  }
}
