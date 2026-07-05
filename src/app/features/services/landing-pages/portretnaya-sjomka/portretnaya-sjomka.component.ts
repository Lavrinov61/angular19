import {
  Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID,
  afterNextRender, DestroyRef, signal
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { SeoService } from '../../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../../core/services/responsive-layout.service';
import { ContactsSectionComponent, ContactsData } from '../../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../../shared/components/testimonials/testimonials.component';
import { TestimonialService } from '../../../../shared/components/testimonials/testimonial.service';
import { Testimonial } from '../../../../shared/components/testimonials/testimonial.model';
import { ProcessSliderComponent, ProcessStep } from '../../../../shared/components/process-slider/process-slider.component';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';
import { AuthChatService } from '../../../../core/services/auth-chat.service';
import { CONTACTS } from '../../../../core/data/contacts.data';
import { ADDRESS_INFO, ADDRESSES, STUDIO_PHONE, STUDIO_PHONE_HREF } from '../../../../core/data/address.data';

@Component({
  selector: 'app-portretnaya-sjomka',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    ContactsSectionComponent,
    TestimonialsComponent,
    ProcessSliderComponent,
    ScrollRevealDirective,
    RouterLink,
  ],
  templateUrl: './portretnaya-sjomka.component.html',
  styleUrls: ['./portretnaya-sjomka.component.scss']
})
export class PortretnayaSjomkaComponent implements OnInit {

  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private layout = inject(ResponsiveLayoutService);
  private testimonialService = inject(TestimonialService);
  private visitorChatService = inject(AuthChatService);
  private destroyRef = inject(DestroyRef);

  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  showStickyCta = signal(false);

  addresses = ADDRESSES;
  addressInfo = ADDRESS_INFO;

  get contactsData(): ContactsData {
    return {
      title: CONTACTS.title,
      prompt: 'Запишитесь на бесплатную фотосессию, ответим в течение нескольких минут',
      links: CONTACTS.links
    };
  }

  // ─── Process Steps ───────────────────────────────────────────────────────
  processSteps: ProcessStep[] = [
    {
      number: 1,
      title: 'Приходите',
      description: 'Без предоплаты. Фотосессия начнётся сразу, без ожидания.',
      icon: 'storefront',
      details: ['Без предоплаты', 'Запись онлайн или без записи', 'Пн-Вс 9:00-19:30']
    },
    {
      number: 2,
      title: 'Снимаем',
      description: 'Профессиональный фотограф, студийный свет, несколько образов.',
      icon: 'camera_alt',
      details: ['Профессиональный фотограф-портретист', 'Студийное освещение', 'Направляем позирование']
    },
    {
      number: 3,
      title: 'Выбираете',
      description: 'Просматриваете кадры на мониторе. Берёте только те, что нравятся.',
      icon: 'photo_library',
      details: ['Просмотр на большом мониторе', 'Только понравившиеся кадры', 'Никаких обязательств']
    },
    {
      number: 4,
      title: 'Платите за результат',
      description: '900₽ за выбранный кадр. Ретушь 700₽ (опционально).',
      icon: 'payments',
      details: ['900₽ за кадр', 'Ретушь 700₽ (дополнительно)', 'Переснимем бесплатно']
    }
  ];

  // ─── Benefits ────────────────────────────────────────────────────────────
  benefits = [
    {
      icon: 'camera',
      title: 'Профессиональный портрет',
      description: 'Студийный свет, камера высокого класса, фотограф-портретист. Не селфи и не фотокабина.'
    },
    {
      icon: 'wallpaper',
      title: 'Любой фон и интерьер',
      description: 'Нейтральный, офисный, природный, подставим что угодно. Реальная профессиональная фотография.'
    },
    {
      icon: 'style',
      title: '4 образа за 1 визит',
      description: 'Бизнес, знакомства, соцсети, арт, снимаем всё за одну сессию. Платите только за то, что нравится.'
    },
    {
      icon: 'brush',
      title: 'Ретушь художником',
      description: 'Не AI-фильтр, ручная работа художника. Убираем усталость, сохраняем уникальность (600₽).'
    }
  ];

  // ─── Goals ───────────────────────────────────────────────────────────────
  goals: { id: string; icon: string; title: string; subtitle: string; pain: string; description: string; tags: string[]; image: string | null }[] = [
    {
      id: 'business',
      icon: 'work',
      title: 'Карьера и Деньги',
      subtitle: 'Для резюме и Forbes',
      pain: 'Не зовут на собеседования. Не воспринимают как руководителя.',
      description: 'Повышает зарплатные ожидания с первого взгляда.',
      tags: ['Резюме', 'hh.ru', 'SuperJob', 'Визитка'],
      image: null
    },
    {
      id: 'dating',
      icon: 'favorite',
      title: 'Знакомства',
      subtitle: 'Для Tinder и Mamba',
      pain: 'Нет мэтчей. На фото хуже, чем в жизни.',
      description: 'Фото, которое хочется лайкнуть, а не пролистнуть.',
      tags: ['Tinder', 'Mamba', 'Bumble', 'VK Знакомства'],
      image: null
    },
    {
      id: 'expert',
      icon: 'auto_awesome',
      title: 'Личный бренд',
      subtitle: 'Контент для соцсетей',
      pain: 'Веду блог, но нечего постить кроме селфи.',
      description: 'Идеально под посты, сторис и обложки Reels.',
      tags: ['Instagram', 'Telegram', 'VK', 'YouTube'],
      image: null
    },
    {
      id: 'cinematic',
      icon: 'contrast',
      title: 'Психологический портрет',
      subtitle: 'Кинематографичный портрет',
      pain: 'Хочу увидеть себя настоящего.',
      description: 'Для тех, кто ценит глубину, а не только внешний лоск.',
      tags: ['ЧБ', 'Close-up', 'Арт', 'Для себя'],
      image: null
    }
  ];

  // ─── Photo samples ───────────────────────────────────────────────────────
  photoSamples: { src: string; alt: string; label: string }[] = [];

  // ─── FAQ ─────────────────────────────────────────────────────────────────
  faqItems = [
    {
      question: 'Фотосессия правда бесплатна?',
      answer: 'Да. Вы не платите за саму фотосессию, только за кадры, которые понравились. Не понравился ни один кадр? Ничего не платите. Но так не бывает, профессиональный фотограф знает, как сделать так, чтобы понравилось.'
    },
    {
      question: 'А если ни один кадр не понравится?',
      answer: 'Переснимем бесплатно, без вопросов. Профессиональный фотограф-портретист показывает промежуточные кадры и корректирует прямо в процессе. На практике такого почти не бывает.'
    },
    {
      question: 'Что надеть?',
      answer: '2-3 варианта одежды, лучше однотонная без крупных логотипов. Деловой стиль, smart-casual или что угодно другое. Остальное подскажем на месте: постановку, угол, выражение лица.'
    },
    {
      question: 'Можно подставить фон или интерьер?',
      answer: 'Да, любой фон и интерьер. Это реальная профессиональная фотография, а не обрезанный фон с паспортного фото. Студийная съёмка + монтаж = профессиональный, убедительный результат.'
    },
    {
      question: 'Сколько по времени?',
      answer: 'Съёмка занимает 15-30 минут. Выбор кадров, сразу на месте. Файлы без ретуши отдаём в тот же день. Если нужна ручная ретушь художником, готово на следующий день.'
    }
  ];

  constructor() {
    this.seoService.updateCanonicalUrl('/portretnaya-sjomka');

    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });

        const onScroll = () => this.showStickyCta.set(window.scrollY > 600);
        window.addEventListener('scroll', onScroll, { passive: true });
        this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
      });
    }
  }

  ngOnInit() {
    this.setupSEO();
  }

  onBookOnline() {
    if (isPlatformBrowser(this.platformId)) {
      window.open('/booking', '_self');
    }
  }

  onCallPhone() {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = STUDIO_PHONE_HREF;
    }
  }

  openChat() {
    this.visitorChatService.openChat({
      service: 'Портретная съёмка',
      price: 0,
      pageUrl: isPlatformBrowser(this.platformId) ? window.location.href : '/portretnaya-sjomka',
      channel: 'studio',
    });
  }

  private async setupSEO() {
    this.seoService.clearJsonLd();
    const title = 'Портретная съёмка в Ростове, фотосессия бесплатно, 900₽ за кадр | Своё Фото';
    const description = 'Фотосессия бесплатно, платите только за кадры, которые нравятся. 900₽ за кадр, ретушь 700₽. Любой фон. Для резюме, бизнеса, соцсетей. Переснимем бесплатно.';
    this.seoService.updateTitle(title);
    this.seoService.updateDescription(description);
    this.seoService.setOpenGraph(
      title,
      description,
      'https://svoefoto.ru/assets/static/promo/portrait-hero.webp',
      'website',
      'https://svoefoto.ru/portretnaya-sjomka'
    );

    try {
      const testimonialsData = await this.testimonialService.getTestimonials();

      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': 'Портретная съёмка',
        'image': 'https://svoefoto.ru/assets/static/promo/portrait-hero.webp',
        'description': description,
        'serviceType': 'Портретная фотография',
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
        'offers': [
          {
            '@type': 'Offer',
            'name': 'Фотосессия',
            'url': 'https://svoefoto.ru/portretnaya-sjomka',
            'priceCurrency': 'RUB',
            'price': '0',
            'description': 'Профессиональная портретная фотосессия, бесплатно',
            'priceValidUntil': '2026-12-31',
            'availability': 'https://schema.org/InStock'
          },
          {
            '@type': 'Offer',
            'name': 'Один кадр (без ретуши)',
            'priceCurrency': 'RUB',
            'price': '900',
            'priceValidUntil': '2026-12-31',
            'availability': 'https://schema.org/InStock'
          }
        ],
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
        'name': 'Портретная съёмка',
        'description': description,
        'provider': {
          '@type': 'LocalBusiness',
          'name': 'Своё Фото',
          'telephone': this.addressInfo.phone
        }
      });
    }

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': 'https://svoefoto.ru/' },
        { '@type': 'ListItem', 'position': 2, 'name': 'Услуги', 'item': 'https://svoefoto.ru/services' },
        { '@type': 'ListItem', 'position': 3, 'name': 'Портретная съёмка', 'item': 'https://svoefoto.ru/portretnaya-sjomka' }
      ]
    });

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': this.faqItems.map(f => ({
        '@type': 'Question',
        'name': f.question,
        'acceptedAnswer': { '@type': 'Answer', 'text': f.answer }
      }))
    });
  }
}
