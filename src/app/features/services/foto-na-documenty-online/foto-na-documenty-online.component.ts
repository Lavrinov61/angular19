import {
  Component,
  OnInit,
  inject,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  signal,
  computed,
  effect,
  untracked,
  afterNextRender,
  DestroyRef,
  viewChild,
  ElementRef
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';
import { Router, RouterModule } from '@angular/router';

import { SeoService } from '../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../core/services/responsive-layout.service';
import { RatingService, ClientStats } from '../../../core/services/rating.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TestimonialsComponent } from '../../../shared/components/testimonials/testimonials.component';
import { CartComponent } from '../../chat-page/components/cart/cart.component';
import { PhotoGalleryPanelComponent } from '../../../shared/components/photo-gallery-panel/photo-gallery-panel.component';
import { ProcessSliderComponent } from '../../../shared/components/process-slider/process-slider.component';
import { ContactsSectionComponent } from '../../../shared/components/contacts-section/contacts-section.component';
import { ScrollRevealDirective } from '../../../shared/directives/scroll-reveal.directive';
import { HttpClient } from '@angular/common/http';
import { AuthChatService, OrderContext, EntryContext } from '../../../core/services/auth-chat.service';
import { PricingConfiguratorComponent, OrderSelectedEvent } from '../../../shared/components/pricing-configurator/pricing-configurator.component';
import { PhotoUploadOverlayComponent, PhotoUploadSubmittedEvent } from '../../../shared/components/photo-upload-overlay/photo-upload-overlay.component';
import { CloudPaymentsService } from '../../../core/services/cloud-payments.service';
import type { CartItem } from '../../chat-page/services/cart.service';
import { QuickOrderComponent, type QuickOrderEvent } from './quick-order.component';
import { OrderConfirmationComponent } from '../../../shared/components/order-confirmation/order-confirmation.component';

import { CONTACTS } from '../../../core/data/contacts.data';
import { ADDRESSES } from '../../../core/data/address.data';
import {
  SEO_DATA,
  HERO_DATA,
  FORMAT_BENEFITS,
  RESULTS_GALLERY,
  FAQ_ITEMS,
  CONTACT_CTA,
  PROCESS_STEPS,
  DOCUMENT_SPECS,
  DELIVERABLES
} from './foto-na-documenty-online.data';

@Component({
  selector: 'app-foto-na-documenty-online',
  templateUrl: './foto-na-documenty-online.component.html',
  styleUrls: ['./foto-na-documenty-online.component.scss'],
  imports: [
    MatButtonModule,
    MatIconModule,
    MatExpansionModule,
    RouterModule,
    TestimonialsComponent,
    CartComponent,
    ProcessSliderComponent,
    ContactsSectionComponent,
    PhotoGalleryPanelComponent,
    ScrollRevealDirective,
    PricingConfiguratorComponent,
    PhotoUploadOverlayComponent,
    QuickOrderComponent,
    OrderConfirmationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FotoNaDocumentyOnlineComponent implements OnInit {
  private seoService = inject(SeoService);
  private platformId = inject(PLATFORM_ID);
  private layout = inject(ResponsiveLayoutService);
  private visitorChatService = inject(AuthChatService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private ratingService = inject(RatingService);
  private cloudPayments = inject(CloudPaymentsService);
  private http = inject(HttpClient);

  // Responsive
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });

  // Dynamic stats
  readonly yearsOfWork = new Date().getFullYear() - 1999;
  private readonly clientStats = signal<ClientStats | null>(null);

  /** "27 лет" / "21 год" / "22 года" */
  readonly yearsOfWorkLabel = computed(() =>
    `${this.yearsOfWork} ${this.pluralizeYears(this.yearsOfWork)}`
  );

  readonly heroStats = computed(() => {
    const clients = this.clientStats();
    const clientValue = clients?.clientCount
      ? `${this.formatClientCount(clients.clientCount)}+`
      : '224 000+';
    const photoValue = clients?.clientCount
      ? `${this.formatClientCount(clients.clientCount * 3)}+`
      : '673 000+';
    return [
      { value: photoValue, label: 'фото сделано' },
      { value: clientValue, label: 'клиентов' },
      { value: `${this.yearsOfWork} ${this.pluralizeYears(this.yearsOfWork)}`, label: 'опыта' },
    ];
  });

  readonly trustItems = computed(() => {
    const clients = this.clientStats();
    const clientValue = clients?.clientCount
      ? `${this.formatClientCount(clients.clientCount)}+`
      : '224 000+';
    return [
      { icon: 'verified', text: 'Гарантия приёма' },
      { icon: 'groups', text: `${clientValue} клиентов` },
      { icon: 'workspace_premium', text: `${this.yearsOfWorkLabel()} опыта` },
      { icon: 'public', text: 'По всей России' },
    ];
  });

  // Data
  readonly heroData = HERO_DATA;
  readonly formatBenefits = FORMAT_BENEFITS;
  readonly gallery = RESULTS_GALLERY;
  readonly faqItems = FAQ_ITEMS;
  readonly documentSpecs = DOCUMENT_SPECS;
  readonly deliverables = DELIVERABLES;
  readonly contactCta = CONTACT_CTA;
  readonly processStepsData = PROCESS_STEPS;
  readonly contactsData = CONTACTS;
  readonly studioAddresses = ADDRESSES;
  readonly isMultiDocument = computed(() =>
    this.pendingOrderConfig()?.selectedOptions?.some(option => option.option_slug === 'all-docs-bundle') ?? false
  );

  readonly chatSteps = [
    { n: '1', title: 'Настройте услугу', desc: 'Выберите нужные параметры' },
    { n: '2', title: 'Загрузите фото', desc: 'от 1 фото, мы выберем лучшее' },
    { n: '3', title: 'Результат готов', desc: 'Получите идеальное фото онлайн' },
  ];

  readonly montageFeatures = [
    {
      icon: 'military_tech',
      title: 'Подстановка формы и атрибутов',
      description: 'Добавим форму, погоны, медали и другие элементы по требованиям документа.',
    },
    {
      icon: 'style',
      title: 'Монтаж любого костюма',
      description: 'Подберём и смонтируем нужный образ, если нет подходящей одежды для съёмки.',
    },
    {
      icon: 'content_cut',
      title: 'Сложная ручная ретушь',
      description: 'Профессионально корректируем детали вручную, а не шаблонным автофильтром.',
    },
    {
      icon: 'wallpaper',
      title: 'Точный фон и посадка',
      description: 'Приводим фото к требуемому формату: фон, положение лица и пропорции.',
    },
  ];

  // View refs
  private readonly statsRef = viewChild<ElementRef>('statsRef');
  private readonly quickOrderRef = viewChild(QuickOrderComponent);

  // State
  chatOrderContext = signal<OrderContext | undefined>(undefined);
  inlineChatVisible = signal(false);
  isTelegramWebView = signal(false);
  currentUrl = signal('');
  showStickyCta = signal(false);
  hasUploadedPhotos = computed(() => this.visitorChatService.uploadedPhotos().length > 0);
  uploadOverlayOpen = signal(false);
  uploadSubmitError = signal<string | null>(null);
  pendingOrderConfig = signal<OrderSelectedEvent | null>(null);
  overlayPhase = signal<'upload' | 'payment' | 'success'>('upload');
  orderData = signal<{ orderId: string; total: number; description: string; photoCount: number } | null>(null);
  paymentLoading = signal(false);
  paymentSuccess = signal(false);
  paymentRedirectCountdown = signal(5);
  private redirectTimer: ReturnType<typeof setInterval> | null = null;

  /** Phase 2: entry context for online photo-docs flow */
  readonly onlineEntryContext: EntryContext = { category: 'photo-docs', delivery: 'electronic' };

  // Count-up
  readonly statsAnimated = signal(false);
  readonly animatedStatValues = signal<string[]>(['0', '0', '0']);
  private readonly statsInViewport = signal(false);

  constructor() {
    // Запускаем анимацию когда элемент видим И данные из API загружены
    effect(() => {
      const inView = this.statsInViewport();
      const hasData = this.clientStats() !== null;
      if (inView && hasData) {
        untracked(() => {
          if (!this.statsAnimated()) {
            this.statsAnimated.set(true);
            this.runCountUp();
          }
        });
      }
    });

    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });

        const ua = navigator.userAgent || '';
        const isTg = /Telegram/i.test(ua) || 'TelegramWebviewProxy' in window;
        this.isTelegramWebView.set(isTg);
        this.currentUrl.set(window.location.href);

        // Desktop: show inline chat section (1024px+)
        if (window.innerWidth >= 1024 && !isTg) {
          this.inlineChatVisible.set(true);
          this.visitorChatService.openChat({
            service: 'Фото на документы онлайн',
            price: 0,
            pageUrl: window.location.href,
            channel: 'online',
            entryContext: this.onlineEntryContext,
          });
        }

        // Sticky CTA
        const onScroll = () => this.showStickyCta.set(window.scrollY > 500);
        window.addEventListener('scroll', onScroll, { passive: true });
        this.destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));

        // Count-up
        this.setupCountUp();
      });
    }

    this.destroyRef.onDestroy(() => this.clearRedirectTimer());
  }

  ngOnInit(): void {
    this.setupSEO();
    this.ratingService.getClientCount()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(stats => this.clientStats.set(stats));
  }

  private formatClientCount(n: number): string {
    return n.toLocaleString('ru-RU');
  }

  private pluralizeYears(n: number): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 19) return 'лет';
    if (mod10 === 1) return 'год';
    if (mod10 >= 2 && mod10 <= 4) return 'года';
    return 'лет';
  }

  // ── Count-up ──

  private setupCountUp(): void {
    const el = this.statsRef()?.nativeElement;
    if (!el) return;

    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        this.statsInViewport.set(true);
        observer.unobserve(el);
      }
    }, { threshold: 0.3 });

    observer.observe(el);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  private runCountUp(): void {
    const duration = 2000;
    const start = performance.now();

    const parsed = this.heroStats().map(s => {
      const m = s.value.match(/^([\d\s]+)(.*)/);
      return m
        ? { target: parseInt(m[1].replace(/\s/g, ''), 10), suffix: m[2] }
        : { target: 0, suffix: s.value };
    });

    // Add space before Cyrillic suffix (e.g. "27" + " лет")
    const fmt = (n: number, suffix: string) => {
      const numStr = n >= 1000 ? n.toLocaleString('ru-RU') : String(n);
      const sep = suffix && /^[а-яёА-ЯЁ]/.test(suffix) ? ' ' : '';
      return numStr + sep + suffix;
    };

    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - (1 - t) ** 3;
      this.animatedStatValues.set(
        parsed.map(p => fmt(Math.round(p.target * ease), p.suffix))
      );
      if (t < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }

  // ── SEO ──

  private setupSEO(): void {
    this.seoService.updateTitle(SEO_DATA.metaTitle);
    this.seoService.updateDescription(SEO_DATA.metaDescription);
    this.seoService.updateCanonicalUrl(SEO_DATA.canonicalUrl);
    this.seoService.setOpenGraph(
      SEO_DATA.metaTitle,
      SEO_DATA.metaDescription,
      'https://svoefoto.ru/assets/static/promo/foto-na-pasport.webp',
      'website',
      `https://svoefoto.ru${SEO_DATA.canonicalUrl}`
    );
    this.seoService.clearJsonLd();

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': SEO_DATA.title,
      'description': SEO_DATA.metaDescription,
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Своё Фото',
        'address': {
          '@type': 'PostalAddress',
          'addressLocality': 'Ростов-на-Дону',
          'addressCountry': 'RU'
        },
        'url': 'https://svoefoto.ru'
      },
      'areaServed': { '@type': 'Country', 'name': 'Россия' },
      'offers': {
        '@type': 'AggregateOffer',
        'lowPrice': '100',
        'highPrice': '950',
        'priceCurrency': 'RUB',
        'availability': 'https://schema.org/InStock'
      },
      'serviceType': 'Фото на документы онлайн'
    });

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      'itemListElement': [
        { '@type': 'ListItem', 'position': 1, 'name': 'Главная', 'item': 'https://svoefoto.ru/' },
        { '@type': 'ListItem', 'position': 2, 'name': 'Услуги', 'item': 'https://svoefoto.ru/services' },
        { '@type': 'ListItem', 'position': 3, 'name': SEO_DATA.title, 'item': `https://svoefoto.ru${SEO_DATA.canonicalUrl}` }
      ]
    });

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      'mainEntity': FAQ_ITEMS.map(faq => ({
        '@type': 'Question',
        'name': faq.question,
        'acceptedAnswer': { '@type': 'Answer', 'text': faq.answer }
      }))
    });
  }

  // ── Actions ──

  openChat(message?: string): void {
    const pageUrl = isPlatformBrowser(this.platformId) ? window.location.href : '/foto-na-documenty-online';

    if (isPlatformBrowser(this.platformId) && this.inlineChatVisible()) {
      document.getElementById('inline-chat')?.scrollIntoView({ behavior: 'smooth' });
    }

    this.visitorChatService.openChat({
      service: 'Фото на документы онлайн',
      price: 0,
      pageUrl,
      channel: 'online',
      entryContext: this.onlineEntryContext,
    }).then(() => {
      if (message) {
        setTimeout(() => this.visitorChatService.sendMessage(message), 600);
      }
    });
  }

  scrollToPricing(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  scrollToPricingWithNotify(): void {
    this.scrollToPricing();
    if (isPlatformBrowser(this.platformId)) {
      this.visitorChatService.notifyLeadClick(window.location.href, 'Фото на документы онлайн');
    }
  }

  scrollToQuickOrder(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById('quick-order')?.scrollIntoView({ behavior: 'smooth' });
      this.visitorChatService.notifyLeadClick(window.location.href, 'Фото на документы онлайн');
    }
  }

  scrollToProcess(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.getElementById('process')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  scrollToContacts(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.querySelector('app-contacts-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  }

  onOrderClick(tariff: string): void {
    const pageUrl = isPlatformBrowser(this.platformId) ? window.location.href : '/foto-na-documenty-online';

    const orderContext: OrderContext = {
      service: tariff,
      price: 0,
      pageUrl,
      channel: 'online',
      entryContext: this.onlineEntryContext,
    };

    this.chatOrderContext.set(orderContext);

    if (isPlatformBrowser(this.platformId) && this.inlineChatVisible()) {
      document.getElementById('inline-chat')?.scrollIntoView({ behavior: 'smooth' });
    }

    this.visitorChatService.openChat(orderContext).then(() => {
      const orderMessage = `Хочу заказать фото на документы: ${tariff}`;
      setTimeout(() => this.visitorChatService.sendMessage(orderMessage), 600);
    });
  }

  /** Обработчик выбора из конфигуратора цен */
  onConfiguratorOrder(event: OrderSelectedEvent): void {
    this.pendingOrderConfig.set(event);
    this.uploadOverlayOpen.set(true);
  }

  /** Обработчик упрощённой формы заказа */
  async onQuickOrder(event: QuickOrderEvent): Promise<void> {
    const config: OrderSelectedEvent = {
      categorySlug: 'photo-docs',
      categoryName: 'Фото на документы',
      displayName: `Фото на документы, ${event.tierName}`,
      total: event.total,
      selectedOptions: event.selectedOptions,
      deliveryMethod: 'electronic',
    };
    const result = await this.submitOrderToChat(config, event.files, event.selectedDoc, undefined, event.customerNote);
    if (result.success && result.orderId) {
      this.quickOrderRef()?.resetForm();
      this.paymentSuccess.set(false);
      this.orderData.set({
        orderId: result.orderId,
        total: result.orderTotal || event.total,
        description: config.displayName,
        photoCount: event.files.length,
      });
      if (isPlatformBrowser(this.platformId)) {
        setTimeout(() => {
          document.getElementById('quick-order')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    } else {
      this.quickOrderRef()?.resetSubmitting(this.uploadSubmitError() ?? 'Не удалось отправить заказ. Попробуйте ещё раз.');
    }
  }

  onUploadOverlayClosed(): void {
    this.uploadOverlayOpen.set(false);
    this.pendingOrderConfig.set(null);
    this.overlayPhase.set('upload');
    this.orderData.set(null);
  }

  async onUploadSubmitted(event: PhotoUploadSubmittedEvent): Promise<void> {
    this.uploadSubmitError.set(null);
    const result = await this.submitOrderToChat(event.config, event.files, event.selectedDoc, event.selectedDocs, event.customerNote);
    if (result.success && result.orderId) {
      this.uploadOverlayOpen.set(false);
      this.overlayPhase.set('upload');
      this.pendingOrderConfig.set(null);
      this.paymentSuccess.set(false);
      this.orderData.set({
        orderId: result.orderId,
        total: result.orderTotal || event.config.total,
        description: event.config.displayName,
        photoCount: event.files.length,
      });
      if (isPlatformBrowser(this.platformId)) {
        setTimeout(() => {
          document.getElementById('quick-order')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    } else if (!this.uploadSubmitError()) {
      this.uploadSubmitError.set('Не удалось создать заказ. Попробуйте ещё раз.');
    }
  }

  async onPayClicked(): Promise<void> {
    const data = this.orderData();
    if (!data) return;
    this.paymentLoading.set(true);
    this.uploadSubmitError.set(null);
    try {
      const cartItem: CartItem = {
        service: { id: `backend-order-${data.orderId}`, name: data.description, description: '', price: data.total, icon: 'photo_camera' },
        quantity: 1,
        backendOrderId: data.orderId,
      };
      const result = await this.cloudPayments.pay(data.orderId, [cartItem]);
      if (result.success) {
        this.paymentSuccess.set(true);
        this.startRedirectCountdown();
      } else if (result.error && result.error !== 'Оплата отменена') {
        this.uploadSubmitError.set(result.error);
      }
    } finally {
      this.paymentLoading.set(false);
    }
  }

  goToChat(): void {
    this.clearRedirectTimer();
    this.uploadOverlayOpen.set(false);
    this.overlayPhase.set('upload');
    this.pendingOrderConfig.set(null);
    this.orderData.set(null);
    this.paymentSuccess.set(false);
    this.router.navigate(['/chat']);
  }

  onGoToChat(): void {
    this.goToChat();
  }

  onPayLater(): void {
    this.uploadOverlayOpen.set(false);
    this.overlayPhase.set('upload');
    this.pendingOrderConfig.set(null);
    this.orderData.set(null);
  }

  private startRedirectCountdown(): void {
    this.paymentRedirectCountdown.set(5);
    this.redirectTimer = setInterval(() => {
      const current = this.paymentRedirectCountdown();
      if (current <= 1) {
        this.goToChat();
      } else {
        this.paymentRedirectCountdown.set(current - 1);
      }
    }, 1000);
  }

  private clearRedirectTimer(): void {
    if (this.redirectTimer) {
      clearInterval(this.redirectTimer);
      this.redirectTimer = null;
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.visitorChatService.uploadImages(Array.from(input.files));
    input.value = '';
  }

  private async submitOrderToChat(
    config: OrderSelectedEvent,
    files: File[],
    selectedDoc?: string,
    selectedDocs?: string[],
    customerNote?: string,
  ): Promise<{ success: boolean; orderId?: string; orderTotal?: number }> {
    if (!isPlatformBrowser(this.platformId) || files.length === 0) return { success: false };

    const normalizedDocs = selectedDocs?.map(doc => doc.trim()).filter(Boolean) || [];
    const normalizedNote = customerNote?.trim();
    const resolvedDoc = selectedDoc
      || (normalizedDocs.length > 0 ? `Комплект документов: ${normalizedDocs.join(', ')}` : undefined)
      || (normalizedNote ? 'Документ указан в пожеланиях клиента' : undefined);

    const pageUrl = window.location.href;
    const orderContext: OrderContext = {
      service: config.displayName,
      price: config.total,
      pageUrl,
      channel: 'online',
      entryContext: {
        category: config.categorySlug,
        delivery: 'electronic',
        selectedOptions: config.selectedOptions,
        configuratorTotal: config.total,
        ...(resolvedDoc ? { selectedDoc: resolvedDoc } : {}),
        ...(normalizedDocs.length > 0 ? { selectedDocs: normalizedDocs } : {}),
        ...(normalizedNote ? { customerNote: normalizedNote } : {}),
      },
    };

    this.chatOrderContext.set(orderContext);
    const result = await this.visitorChatService.submitOrderBundle(files, orderContext);
    if (!result.success) {
      this.uploadSubmitError.set(result.error || 'Не удалось отправить заказ.');
      return { success: false };
    }

    return { success: true, orderId: result.orderId, orderTotal: result.orderTotal };
  }
}
