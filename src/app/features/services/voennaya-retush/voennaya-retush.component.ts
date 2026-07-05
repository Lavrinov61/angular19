import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';

import { STUDIO_PHONE_E164, STUDIO_PHONE_SCHEMA } from '../../../core/data/address.data';
import { AuthService } from '../../../core/services/auth.service';
import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { AuthChatService, type EntryContext, type OrderContext } from '../../../core/services/auth-chat.service';
import { DeepLinkService } from '../../../core/services/deep-link.service';
import { CartComponent } from '../../chat-page/components/cart/cart.component';
import {
  MilitaryQuickOrderComponent,
  type MilitaryGuestMessengerLink,
  type MilitaryQuickOrderEvent,
} from './military-quick-order.component';
import {
  APPROVAL_STEPS,
  BENEFITS,
  CLARIFICATION_ITEMS,
  CONTACT_CTA,
  FAQ_ITEMS,
  HERO_DATA,
  PAYMENT_POINTS,
  PRINT_SCENARIOS,
  RESULTS_GALLERY,
  SEO_DATA,
  SUMMARY_EXAMPLE,
  TRUST_MARKERS,
  UNKNOWN_NAME_PROMPTS,
} from './voennaya-retush.data';

@Component({
  selector: 'app-voennaya-retush',
  templateUrl: './voennaya-retush.component.html',
  styleUrls: ['./voennaya-retush.component.scss'],
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    CartComponent,
    MilitaryQuickOrderComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoennayaRetushComponent implements OnInit {
  private readonly seoService = inject(SeoService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly layout = inject(ResponsiveLayoutService);
  private readonly visitorChatService = inject(AuthChatService);
  private readonly authService = inject(AuthService);
  private readonly deepLinkService = inject(DeepLinkService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly quickOrderRef = viewChild(MilitaryQuickOrderComponent);

  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });
  readonly isAuthenticated = this.authService.isAuthenticated;

  readonly heroData = HERO_DATA;
  readonly trustMarkers = TRUST_MARKERS;
  readonly gallery = RESULTS_GALLERY;
  readonly unknownNamePrompts = UNKNOWN_NAME_PROMPTS;
  readonly clarificationItems = CLARIFICATION_ITEMS;
  readonly summaryExample = SUMMARY_EXAMPLE;
  readonly paymentPoints = PAYMENT_POINTS;
  readonly approvalSteps = APPROVAL_STEPS;
  readonly printScenarios = PRINT_SCENARIOS;
  readonly benefits = BENEFITS;
  readonly faqItems = FAQ_ITEMS;
  readonly contactCta = CONTACT_CTA;

  readonly isTelegramWebView = signal(false);
  readonly currentUrl = signal('');
  readonly showStickyCta = signal(false);
  readonly requestSent = signal(false);
  readonly uploadSubmitError = signal<string | null>(null);
  readonly chatOrderContext = signal<OrderContext | undefined>(undefined);
  readonly orderCtaIcon = computed(() => 'cloud_upload');
  readonly orderCtaLabel = computed(() => this.isAuthenticated() ? 'Отправить фото в чат' : 'Загрузить на сайте');
  readonly orderCtaAriaLabel = computed(() => this.isAuthenticated()
    ? 'Отправить фото в чат'
    : 'Загрузить фото на сайте после входа по телефону');
  readonly guestMessengerLinks = computed<readonly MilitaryGuestMessengerLink[]>(() => {
    this.deepLinkService.isReady();

    return [
      {
        id: 'max',
        label: 'МАКС',
        href: this.deepLinkService.getMaxLink(),
        icon: 'channel-max',
      },
      {
        id: 'vk',
        label: 'ВКонтакте',
        href: this.deepLinkService.getVkLink(),
        icon: 'channel-vk',
      },
    ];
  });

  readonly onlineEntryContext: EntryContext = {
    category: 'voennaya-retush',
    delivery: 'electronic',
    requestMode: 'brief-first',
  };

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });

        const ua = navigator.userAgent || '';
        const isTg = /Telegram/i.test(ua) || 'TelegramWebviewProxy' in window;
        this.isTelegramWebView.set(isTg);
        this.currentUrl.set(window.location.href);

        const onScroll = () => this.showStickyCta.set(window.scrollY > 320);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));
      });
    }
  }

  ngOnInit(): void {
    this.setupSEO();
  }

  scrollToQuickOrder(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    document.getElementById('quick-order')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.visitorChatService.notifyLeadClick(window.location.href, 'Военная ретушь');
  }

  scrollToExamples(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    document.getElementById('examples')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  scrollToFlow(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    document.getElementById('flow')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  openChat(message?: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const pageUrl = window.location.href;
    const orderContext: OrderContext = {
      service: 'Военная ретушь',
      price: 0,
      pageUrl,
      channel: 'online',
      entryContext: this.onlineEntryContext,
    };

    this.chatOrderContext.set(orderContext);
    const canSendMessage = this.authService.isAuthenticated();
    this.visitorChatService.openChat(orderContext).then(() => {
      if (message && canSendMessage) {
        setTimeout(() => {
          this.visitorChatService.sendMessage(message);
        }, 600);
      }
    });
  }

  async onMilitaryQuickOrder(event: MilitaryQuickOrderEvent): Promise<void> {
    this.uploadSubmitError.set(null);
    this.requestSent.set(false);

    if (!this.authService.isAuthenticated()) {
      const authMessage = 'Чтобы загрузить фото на сайте, войдите по телефону.';
      this.uploadSubmitError.set(authMessage);
      this.openPhoneAuthForMilitaryRetouch();
      this.quickOrderRef()?.resetSubmitting(authMessage);
      return;
    }

    const result = await this.submitRequestToChat(event.files, event.customerNote);
    if (result.success) {
      this.quickOrderRef()?.resetForm();
      this.requestSent.set(true);
      return;
    }

    const error = this.uploadSubmitError() ?? 'Не удалось отправить заявку. Попробуйте ещё раз.';
    this.quickOrderRef()?.resetSubmitting(error);
  }

  openPhoneAuthForMilitaryRetouch(): void {
    this.requestSent.set(false);
    if (!isPlatformBrowser(this.platformId)) return;

    void this.router.navigate(['/auth/login'], {
      queryParams: { returnUrl: this.getQuickOrderReturnUrl() },
    });
  }

  trackGuestMessengerClick(label: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.visitorChatService.notifyLeadClick(window.location.href, `Военная ретушь - ${label}`);
  }

  private setupSEO(): void {
    const pageUrl = `https://svoefoto.ru${SEO_DATA.canonicalUrl}`;
    const imageUrls = RESULTS_GALLERY.map(item => `https://svoefoto.ru${item.src}`);
    const primaryImageUrl = imageUrls[0] ?? 'https://svoefoto.ru/assets/images/military-retush-1.webp';
    const keywords = SEO_DATA.keywords.join(', ');
    const pageTopics = SEO_DATA.keywords.map(name => ({
      '@type': 'Thing',
      name,
    }));
    const potentialActions = [
      {
        '@type': 'OrderAction',
        name: 'Загрузить фото на сайте',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${pageUrl}#quick-order`,
          inLanguage: 'ru-RU',
        },
      },
      {
        '@type': 'ContactAction',
        name: 'Отправить фото в МАКС без входа на сайт',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://max.ru/id262603741214_bot',
          inLanguage: 'ru-RU',
        },
      },
      {
        '@type': 'ContactAction',
        name: 'Отправить фото во ВКонтакте без входа на сайт',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: 'https://vk.com/im?sel=-68371131',
          inLanguage: 'ru-RU',
        },
      },
    ];

    this.seoService.updateTitle(SEO_DATA.metaTitle);
    this.seoService.updateDescription(SEO_DATA.metaDescription);
    this.seoService.updateCanonicalUrl(SEO_DATA.canonicalUrl);
    this.seoService.setOpenGraph(
      SEO_DATA.metaTitle,
      SEO_DATA.metaDescription,
      primaryImageUrl,
      'website',
      pageUrl,
    );
    this.seoService.clearJsonLd();

    this.seoService.addJsonLd([
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        url: pageUrl,
        name: SEO_DATA.metaTitle,
        description: SEO_DATA.metaDescription,
        inLanguage: 'ru-RU',
        dateModified: SEO_DATA.dateModified,
        keywords,
        about: pageTopics,
        isPartOf: {
          '@type': 'WebSite',
          '@id': 'https://svoefoto.ru/#website',
          name: 'Своё Фото',
          url: 'https://svoefoto.ru/',
        },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: primaryImageUrl,
          caption: 'Пример военной ретуши и подстановки формы по фото',
        },
        mainEntity: { '@id': `${pageUrl}#service` },
        breadcrumb: { '@id': `${pageUrl}#breadcrumb` },
        potentialAction: potentialActions,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Service',
        '@id': `${pageUrl}#service`,
        name: SEO_DATA.title,
        alternateName: [
          'Военная ретушь онлайн',
          'Подстановка военной формы по фото',
          'Фото в военной форме из обычного снимка',
        ],
        url: pageUrl,
        image: imageUrls,
        description: SEO_DATA.metaDescription,
        dateModified: SEO_DATA.dateModified,
        keywords,
        about: pageTopics,
        mainEntityOfPage: { '@id': `${pageUrl}#webpage` },
        audience: {
          '@type': 'Audience',
          audienceType: 'Клиенты, которым нужно получить портрет в военной или служебной форме по обычной фотографии',
        },
        provider: {
          '@type': 'LocalBusiness',
          '@id': 'https://svoefoto.ru/#localbusiness',
          name: 'Своё Фото',
          url: 'https://svoefoto.ru/',
          telephone: STUDIO_PHONE_E164,
          email: 'info@svoefoto.ru',
          sameAs: [
            'https://max.ru/id262603741214_bot',
            'https://vk.com/im?sel=-68371131',
            'https://t.me/magnus_photo',
            'https://www.instagram.com/foto.magnus/',
            'https://ok.ru/group/53912248057971',
          ],
          contactPoint: {
            '@type': 'ContactPoint',
            telephone: STUDIO_PHONE_SCHEMA,
            contactType: 'customer support',
            areaServed: 'RU',
            availableLanguage: 'ru-RU',
          },
          knowsAbout: SEO_DATA.keywords,
          address: {
            '@type': 'PostalAddress',
            streetAddress: 'переулок Соборный 21',
            addressLocality: 'Ростов-на-Дону',
            addressCountry: 'RU',
          },
          location: [
            {
              '@type': 'Place',
              name: 'Своё Фото на Соборном',
              address: {
                '@type': 'PostalAddress',
                streetAddress: 'переулок Соборный 21',
                addressLocality: 'Ростов-на-Дону',
                addressCountry: 'RU',
              },
            },
          ],
        },
        areaServed: [
          { '@type': 'City', name: 'Ростов-на-Дону' },
          { '@type': 'Country', name: 'Россия' },
        ],
        serviceType: 'Военная ретушь, подстановка формы, звания, знаков и медалей по фото',
        category: 'Фоторетушь',
        termsOfService: 'Стоимость и состав работы подтверждаются до оплаты после уточнения задачи.',
        availableChannel: [
          {
            '@type': 'ServiceChannel',
            name: 'Онлайн-чат на сайте',
            serviceUrl: pageUrl,
            availableLanguage: 'ru-RU',
          },
          {
            '@type': 'ServiceChannel',
            name: 'МАКС',
            serviceUrl: 'https://max.ru/id262603741214_bot',
            availableLanguage: 'ru-RU',
          },
          {
            '@type': 'ServiceChannel',
            name: 'ВКонтакте',
            serviceUrl: 'https://vk.com/im?sel=-68371131',
            availableLanguage: 'ru-RU',
          },
        ],
        potentialAction: potentialActions,
        offers: {
          '@type': 'Offer',
          url: pageUrl,
          priceCurrency: 'RUB',
          availability: 'https://schema.org/InStock',
          eligibleRegion: { '@type': 'Country', name: 'Россия' },
          description: 'Стоимость подтверждаем в чате после уточнения формы, звания, знаков, медалей, размера и срока.',
        },
        hasOfferCatalog: {
          '@type': 'OfferCatalog',
          name: 'Сценарии военной ретуши',
          itemListElement: [
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Подстановка военной формы по фото',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Добавление звания, знаков и медалей',
              },
            },
            {
              '@type': 'Offer',
              itemOffered: {
                '@type': 'Service',
                name: 'Подготовка файла для документа или печати',
              },
            },
          ],
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Главная', item: 'https://svoefoto.ru/' },
          { '@type': 'ListItem', position: 2, name: 'Услуги', item: 'https://svoefoto.ru/services' },
          { '@type': 'ListItem', position: 3, name: 'Военная ретушь', item: pageUrl },
        ],
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        '@id': `${pageUrl}#faq`,
        inLanguage: 'ru-RU',
        isPartOf: { '@id': `${pageUrl}#webpage` },
        mainEntity: FAQ_ITEMS.map(faq => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ]);
  }

  private async submitRequestToChat(
    files: File[],
    customerNote: string,
  ): Promise<{ success: boolean }> {
    if (!isPlatformBrowser(this.platformId) || files.length === 0) {
      return { success: false };
    }

    if (!this.authService.isAuthenticated()) {
      this.uploadSubmitError.set('Чтобы загрузить фото на сайте, войдите по телефону.');
      this.openPhoneAuthForMilitaryRetouch();
      return { success: false };
    }

    const normalizedNote = customerNote.trim();
    const pageUrl = window.location.href;
    const orderContext: OrderContext = {
      service: 'Военная ретушь - заявка на оценку',
      price: 0,
      pageUrl,
      channel: 'online',
      entryContext: {
        ...this.onlineEntryContext,
        customerNote: normalizedNote,
      },
    };

    this.chatOrderContext.set(orderContext);
    const result = await this.visitorChatService.submitOrderBundle(files, orderContext);
    if (!result.success) {
      this.uploadSubmitError.set(result.error || 'Не удалось отправить заявку.');
      return { success: false };
    }

    await this.visitorChatService.sendMessage(this.buildCustomerBriefMessage(normalizedNote, files.length));
    return { success: true };
  }

  private buildCustomerBriefMessage(customerNote: string, fileCount: number): string {
    const photoWord = fileCount === 1 ? 'фото' : 'фото';
    return [
      `Задача по военной ретуши: ${fileCount} ${photoWord}.`,
      customerNote,
      'Прошу уточнить детали, стоимость и оплату в чате.',
    ].join('\n');
  }

  private getQuickOrderReturnUrl(): string {
    if (!isPlatformBrowser(this.platformId)) {
      return `${SEO_DATA.canonicalUrl}#quick-order`;
    }

    return `${window.location.pathname}${window.location.search}#quick-order`;
  }
}
