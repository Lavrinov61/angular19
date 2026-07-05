import { Component, ChangeDetectionStrategy, OnInit, inject, PLATFORM_ID, input, afterNextRender, DestroyRef, signal, computed } from '@angular/core';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser, ViewportScroller } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatExpansionModule } from '@angular/material/expansion';
import { SeoService } from '../../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../../core/services/responsive-layout.service';
import { ContactsSectionComponent } from '../../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../../shared/components/testimonials/testimonials.component';
import { TestimonialService } from '../../../../shared/components/testimonials/testimonial.service';
import { Testimonial } from '../../../../shared/components/testimonials/testimonial.model';
import { ProcessSliderComponent, ProcessStep } from '../../../../shared/components/process-slider/process-slider.component';
import { AdvantagesSectionComponent } from '../../../../shared/components/advantages-section/advantages-section.component';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';
import { ParallaxDirective } from '../../../../shared/directives/parallax.directive';
import { AuthChatService } from '../../../../core/services/auth-chat.service';
import { LandingPricesService } from '../../../../core/services/landing-prices.service';
import { CONTACTS } from '../../../../core/data/contacts.data';
import { ADDRESSES, ADDRESS_INFO, STUDIO_PHONE, STUDIO_PHONE_HREF } from '../../../../core/data/address.data';
import { LandingPageData } from '../landing-page.interface';
import { ContactsData } from '../../../../shared/components/contacts-section/contacts-section.component';

@Component({
  selector: 'app-base-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatDividerModule,
    MatExpansionModule,
    ContactsSectionComponent,
    TestimonialsComponent,
    ProcessSliderComponent,
    AdvantagesSectionComponent,
    ScrollRevealDirective,
    ParallaxDirective,
],
  templateUrl: './base-landing.component.html',
  styleUrls: ['./base-landing.component.scss']
})
export class BaseLandingComponent implements OnInit {
  // Input data
  data = input.required<LandingPageData>();

  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  layout = inject(ResponsiveLayoutService);
  private testimonialService = inject(TestimonialService);
  private viewportScroller = inject(ViewportScroller);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private visitorChatService = inject(AuthChatService);
  private landingPrices = inject(LandingPricesService);

  /** data() обогащённый реальными ценами из pricing engine */
  readonly enrichedData = computed(() => this.landingPrices.enrichLandingData(this.data()));

  // Studio chat state
  inlineChatVisible = signal(false);

  // Data
  addresses = ADDRESSES;
  addressInfo = ADDRESS_INFO;
  
  // Contacts data с динамическим prompt
  get contactsData(): ContactsData {
    let prompt: string;
    if (this.isOnlineService()) {
      prompt = 'Напишите нам, оформим заказ онлайн через удобный мессенджер';
    } else if (this.isPhotoService()) {
      prompt = 'Выберите удобный способ связи для консультации и записи на фотосессию';
    } else {
      prompt = 'Выберите удобный способ связи для консультации и оформления заказа';
    }
    return {
      title: CONTACTS.title,
      prompt,
      links: CONTACTS.links
    };
  }

  // Responsive signals
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Map modal
  showMapModal = false;

  constructor() {
    // Scroll to top on load (browser only)
    if (isPlatformBrowser(this.platformId)) {
      const scrollToTop = () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        this.viewportScroller.scrollToPosition([0, 0]);
      };

      afterNextRender(() => {
        scrollToTop();
        // На десктопе (1024px+) открываем встроенный чат автоматически
        if (window.innerWidth >= 1024) {
          this.inlineChatVisible.set(true);
          const chatChannel = this.data().serviceMode === 'online' ? 'online' : 'studio';
          this.visitorChatService.openChat({
            service: this.data().title || 'Своё Фото',
            price: 0,
            pageUrl: window.location.href,
            channel: chatChannel,
          });
        }
        requestAnimationFrame(() => scrollToTop());
      });

      this.router.events
        .pipe(
          filter(event => event instanceof NavigationEnd),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe(() => {
          scrollToTop();
          setTimeout(() => scrollToTop(), 50);
        });
    }
  }

  ngOnInit() {
    // Инициализируем загрузку реальных цен из pricing engine
    this.landingPrices.init();

    const pageData = this.enrichedData();

    // Set canonical URL
    this.seoService.updateCanonicalUrl(pageData.canonicalUrl);

    // Setup SEO
    this.setupSEO(pageData);
  }

  private async setupSEO(pageData: LandingPageData) {
    this.seoService.clearJsonLd();
    this.seoService.updateTitle(pageData.metaTitle);
    this.seoService.updateDescription(pageData.metaDescription);
    this.seoService.setOpenGraph(
      pageData.metaTitle,
      pageData.metaDescription,
      pageData.heroImage ? `https://svoefoto.ru${pageData.heroImage}` : undefined,
      'website',
      `https://svoefoto.ru${pageData.canonicalUrl}`
    );

    try {
      const testimonialsData = await this.testimonialService.getTestimonials();

      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': pageData.title,
        'image': pageData.heroImage ? `https://svoefoto.ru${pageData.heroImage}` : undefined,
        'description': pageData.metaDescription,
        'serviceType': pageData.serviceType,
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
          'url': `https://svoefoto.ru${pageData.canonicalUrl}`,
          'priceCurrency': 'RUB',
          'price': pageData.price.toString(),
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
          'reviewRating': {
            '@type': 'Rating',
            'ratingValue': t.rating.toString(),
            'bestRating': '5'
          },
          'reviewBody': t.content
        })),
        'areaServed': this.isOnlineService()
          ? { '@type': 'Country', 'name': 'Россия' }
          : {
            '@type': 'Place',
            'address': {
              '@type': 'PostalAddress',
              'addressLocality': 'Ростов-на-Дону',
              'addressCountry': 'RU'
            }
          }
      });
    } catch {
      // Fallback schema
      this.seoService.addJsonLd({
        '@context': 'https://schema.org',
        '@type': 'Service',
        'name': pageData.title,
        'description': pageData.metaDescription,
        'provider': {
          '@type': 'LocalBusiness',
          'name': 'Своё Фото',
          'telephone': this.addressInfo.phone
        },
        'offers': {
          '@type': 'Offer',
          'priceCurrency': 'RUB',
          'price': pageData.price.toString()
        }
      });
    }

    // Breadcrumbs
    const parentCrumb = this.isOnlineService()
      ? { '@type': 'ListItem', 'position': 2, 'name': 'Онлайн-услуги', 'item': 'https://svoefoto.ru/online-uslugi' }
      : { '@type': 'ListItem', 'position': 2, 'name': 'Услуги', 'item': 'https://svoefoto.ru/services' };

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': 'https://svoefoto.ru/' },
        parentCrumb,
        { '@type': 'ListItem', 'position': 3, 'name': pageData.title, 'item': `https://svoefoto.ru${pageData.canonicalUrl}` }
      ]
    });

    // FAQPage schema для расширенных сниппетов в Google
    if (pageData.faqItems?.length) {
      this.seoService.setFAQPageJsonLd(pageData.faqItems);
    }
  }

  // Actions
  onBookOnline() {
    if (isPlatformBrowser(this.platformId)) {
      // Для онлайн-услуг - открываем чат, для фото - запись, для остальных - контакты
      if (this.isOnlineService()) {
        this.openLandingChat();
      } else if (this.isPhotoService()) {
        window.open('/booking', '_self');
      } else {
        this.scrollToContacts();
      }
    }
  }

  onCallPhone() {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = STUDIO_PHONE_HREF;
    }
  }

  showMapOptions() {
    this.showMapModal = true;
  }

  hideMapOptions() {
    this.showMapModal = false;
  }

  /** Открыть чат лендинга (канал зависит от serviceMode) */
  openLandingChat(): void {
    const channel = this.data().serviceMode === 'online' ? 'online' : 'studio';
    this.visitorChatService.openChat({
      service: this.data().title || 'Своё Фото',
      price: 0,
      pageUrl: isPlatformBrowser(this.platformId) ? window.location.href : '/',
      channel,
    });
  }

  scrollToContacts() {
    if (isPlatformBrowser(this.platformId)) {
      const element = document.querySelector('.contacts-section, #contacts');
      element?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  openPhotoModal(index: number) {
    if (isPlatformBrowser(this.platformId)) {
      const photo = this.data().photoSamples[index];
      const win = window.open('', '_blank', 'width=600,height=800');
      if (win) {
        win.document.write(`
          <html><head><title>${photo.alt}</title>
          <style>body{margin:0;padding:20px;background:#000;display:flex;justify-content:center;align-items:center;min-height:100vh}
          img{max-width:100%;max-height:100%;object-fit:contain}p{color:#fff;text-align:center;margin-top:10px}</style></head>
          <body><div><img src="${photo.src}" alt="${photo.alt}"/><p>${photo.description}</p></div></body></html>
        `);
      }
    }
  }

  // Convert ProcessStep for component
  get processStepsForSlider(): ProcessStep[] {
    return this.data().processSteps as ProcessStep[];
  }

  // Helper methods for template
  isOnlineService(): boolean {
    return this.data().serviceMode === 'online';
  }

  isPhotoService(): boolean {
    return this.data().schemaType === 'PhotoService';
  }

  getDefaultCtaTitle(): string {
    const title = this.data().title;
    if (this.isOnlineService()) {
      return `Заказать ${title.toLowerCase()} онлайн`;
    }
    if (this.isPhotoService()) {
      return `Нужно ${title.toLowerCase()}?`;
    }
    return `Заказать ${title.toLowerCase()}`;
  }

  getDefaultCtaSubtitle(): string {
    if (this.isOnlineService()) {
      return 'Отправьте фото, сделаем! Работаем по всей России.';
    }
    if (this.isPhotoService()) {
      return 'Запишитесь онлайн или приходите без записи!';
    }
    return 'Приходите в студию или отправьте файлы онлайн!';
  }

  getDefaultCtaButton(): string {
    if (this.isOnlineService()) {
      return 'Написать в чат';
    }
    if (this.isPhotoService()) {
      return 'Записаться';
    }
    return 'Заказать';
  }

  getDefaultCtaUrgency(): string {
    const price = this.enrichedData().price;
    if (this.isOnlineService()) {
      return `✨ От ${price}₽, работаем по всей России!`;
    }
    if (this.isPhotoService()) {
      return `✨ ${price}₽, профессиональная съёмка с ретушью!`;
    }
    return `✨ От ${price}₽, быстро и качественно!`;
  }
}
