import {
  Component,
  OnInit,
  inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  signal,
  afterNextRender
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { RouterModule } from '@angular/router';

import { SeoService } from '../../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../../core/services/responsive-layout.service';
import { AuthChatService, OrderContext } from '../../../../core/services/auth-chat.service';
import { CONTACTS } from '../../../../core/data/contacts.data';

import { TestimonialsComponent } from '../../../../shared/components/testimonials/testimonials.component';
import { ProcessSliderComponent } from '../../../../shared/components/process-slider/process-slider.component';
import { CartComponent } from '../../../chat-page/components/cart/cart.component';
import { ContactsSectionComponent, ContactsData } from '../../../../shared/components/contacts-section/contacts-section.component';

import {
  SEO_DATA,
  HERO_DATA,
  FORMAT_BENEFITS,
  SERVICE_CARDS,
  PROCESS_STEPS,
  ADVANTAGES,
  FAQ_ITEMS,
  CONTACT_CTA
} from './online-services-hub.data';

@Component({
  selector: 'app-online-services-hub',
  templateUrl: './online-services-hub.component.html',
  styleUrls: ['./online-services-hub.component.scss'],
  imports: [
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    RouterModule,
    TestimonialsComponent,
    ProcessSliderComponent,
    CartComponent,
    ContactsSectionComponent
],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OnlineServicesHubComponent implements OnInit {
  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private layout = inject(ResponsiveLayoutService);
  private visitorChatService = inject(AuthChatService);

  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });

  // Data
  readonly heroData = HERO_DATA;
  readonly formatBenefits = FORMAT_BENEFITS;
  readonly serviceCards = SERVICE_CARDS;
  readonly processSteps = PROCESS_STEPS;
  readonly advantages = ADVANTAGES;
  readonly faqItems = FAQ_ITEMS;
  readonly contactCta = CONTACT_CTA;

  // Chat state
  chatOrderContext = signal<OrderContext | undefined>(undefined);
  inlineChatVisible = signal(false);

  // Telegram WebView
  isTelegramWebView = signal(false);
  currentUrl = signal('');

  // Contacts
  contactsData: ContactsData = {
    title: CONTACTS.title,
    prompt: 'Напишите нам, оформим заказ онлайн через удобный мессенджер',
    links: CONTACTS.links
  };

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });

        const ua = navigator.userAgent || '';
        const isTg = /Telegram/i.test(ua) || 'TelegramWebviewProxy' in window;
        this.isTelegramWebView.set(isTg);
        this.currentUrl.set(window.location.href);

        if (window.innerWidth >= 1024 && !isTg) {
          this.inlineChatVisible.set(true);
          this.visitorChatService.openChat({
            service: 'Онлайн-услуги Своё Фото',
            price: 0,
            pageUrl: window.location.href,
            channel: 'online'
          });
        }
      });
    }
  }

  ngOnInit(): void {
    this.setupSEO();
  }

  private setupSEO(): void {
    this.seoService.updateTitle(SEO_DATA.metaTitle);
    this.seoService.updateDescription(SEO_DATA.metaDescription);
    this.seoService.updateCanonicalUrl(SEO_DATA.canonicalUrl);
    this.seoService.setOpenGraph(
      SEO_DATA.metaTitle,
      SEO_DATA.metaDescription,
      'https://svoefoto.ru/assets/static/promo/neyrofotosessiya.webp',
      'website',
      `https://svoefoto.ru${SEO_DATA.canonicalUrl}`
    );
    this.seoService.clearJsonLd();

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      'name': SEO_DATA.title,
      'description': SEO_DATA.metaDescription,
      'numberOfItems': SERVICE_CARDS.length,
      'itemListElement': SERVICE_CARDS.map((s, i) => ({
        '@type': 'ListItem',
        'position': i + 1,
        'name': s.title,
        'url': `https://svoefoto.ru${s.url}`
      }))
    });

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': 'https://svoefoto.ru/' },
        { '@type': 'ListItem', 'position': 2, 'name': 'Онлайн-услуги', 'item': 'https://svoefoto.ru/online-uslugi' }
      ]
    });
  }

  openChat(): void {
    if (isPlatformBrowser(this.platformId) && this.inlineChatVisible()) {
      const chatEl = document.getElementById('inline-chat');
      chatEl?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    this.visitorChatService.openChat({
      service: 'Онлайн-услуги Своё Фото',
      price: 0,
      pageUrl: isPlatformBrowser(this.platformId) ? window.location.href : '/online-uslugi',
      channel: 'online'
    });
  }

  scrollToServices(event?: Event): void {
    event?.preventDefault();
    if (isPlatformBrowser(this.platformId)) {
      const element = document.getElementById('services');
      element?.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
