import {
  Component,
  signal,
  computed,
  inject,
  OnInit,
  PLATFORM_ID,
  DestroyRef,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  afterNextRender
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';

// Angular Material imports
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';

// Services and models
import { PhotographerPersonalService } from '../../services/photographer-personal.service';
import { PhotographerPersonalProfile } from '../../models/photographer.interfaces';
import { LoggerService } from '../../../../core/services/logger.service';

// Components (будут созданы отдельно)
// import { BookingDialogComponent } from '../booking-dialog/booking-dialog.component';
// import { ContactDialogComponent } from '../contact-dialog/contact-dialog.component';
// import { GalleryDialogComponent } from '../components/gallery-dialog/gallery-dialog.component';

@Component({
  selector: 'app-photographer-personal-page',
  
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatExpansionModule,
    MatBadgeModule,
    MatTooltipModule
],
  template: `
    <div class="photographer-page" 
         [class.mobile]="isMobile()"
         [class.tablet]="isTablet()"
         [attr.data-theme]="currentTheme()">
      
      @if (isLoading()) {
        <!-- Loading State -->
        <div class="loading-container">
          <div class="loading-content">
            <mat-spinner diameter="60" strokeWidth="4" />
            <h2>Загружаем профиль фотографа...</h2>
            <p>Готовим для вас самую актуальную информацию</p>
          </div>
        </div>
      } @else if (photographer()) {
        
        <!-- Hero Section - ATTENTION -->
        <section class="hero-section" [style.background-image]="'linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url(' + photographer()!.coverImage + ')'">
          <div class="hero-container">
            <div class="hero-content">
              <!-- Photographer Avatar -->
              <div class="photographer-avatar-section">
                <img 
                  [src]="photographer()!.avatar" 
                  [alt]="photographer()!.name"
                  class="photographer-avatar"
                />
                <div class="photographer-basic-info">
                  <h1 class="photographer-name">{{ photographer()!.name }}</h1>
                  <p class="photographer-title">{{ photographer()!.title }}</p>
                  <div class="photographer-rating">
                    <div class="stars">
                      @for (star of getStarsArray(photographer()!.rating); track $index) {
                        <mat-icon [class.filled]="star">star</mat-icon>
                      }
                    </div>
                    <span class="rating-text">
                      5.0 · <a routerLink="/testimonials">Все отзывы настоящие</a>
                    </span>
                  </div>
                  <div class="photographer-location">
                    <mat-icon>location_on</mat-icon>
                    <span>{{ photographer()!.location }}</span>
                  </div>
                </div>
              </div>

              <!-- ATTENTION: Main Headlines -->
              <div class="attention-section">
                <h2 class="main-headline">{{ photographer()!.attention.headline }}</h2>
                <p class="sub-headline">{{ photographer()!.attention.subheadline }}</p>
                <p class="tagline">{{ photographer()!.attention.tagline }}</p>
              </div>

              <!-- Primary CTA - современные кнопки снизу -->
              <div class="hero-actions-bottom">
                <button 
                  class="modern-contact-button primary-action"
                  (click)="openBookingDialog()">
                  <mat-icon class="button-icon">event_available</mat-icon>
                  <span>Забронировать съемку</span>
                </button>
                <button 
                  class="modern-contact-button secondary-action"
                  (click)="openContactDialog()">
                  <mat-icon class="button-icon">message</mat-icon>
                  <span>Задать вопрос</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- INTEREST Section -->
        <section class="interest-section">
          <div class="container">
            <h2 class="section-title">Почему стоит выбрать именно меня?</h2>
            
            <div class="interest-grid">
              <!-- Experience Block -->
              <mat-card class="interest-card">
                <mat-card-header>
                  <mat-icon mat-card-avatar>workspace_premium</mat-icon>
                  <mat-card-title>Мастер своего дела</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  <p>{{ photographer()!.interest.whyChooseMe.experience }}</p>
                </mat-card-content>
              </mat-card>

              <!-- Style Block -->
              <mat-card class="interest-card">
                <mat-card-header>
                  <mat-icon mat-card-avatar>palette</mat-icon>
                  <mat-card-title>Стиль, который вдохновляет</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  <p>{{ photographer()!.interest.whyChooseMe.style }}</p>
                </mat-card-content>
              </mat-card>

              <!-- Flexibility Block -->
              <mat-card class="interest-card">
                <mat-card-header>
                  <mat-icon mat-card-avatar>schedule</mat-icon>
                  <mat-card-title>Всегда вовремя</mat-card-title>
                </mat-card-header>
                <mat-card-content>
                  <p>{{ photographer()!.interest.whyChooseMe.flexibility }}</p>
                </mat-card-content>
              </mat-card>
            </div>

            <!-- Achievements -->
            <div class="achievements-section">
              <h3>Достижения и опыт</h3>
              <div class="achievements-grid">
                @for (achievement of photographer()!.interest.achievements; track $index) {
                  <div class="achievement-item">
                    <mat-icon>verified</mat-icon>
                    <span>{{ achievement }}</span>
                  </div>
                }
              </div>
            </div>

            <!-- Portfolio Gallery Preview -->              @if (photographer()!.portfolio && photographer()!.portfolio.length > 0) {
              <div class="gallery-preview">
                <h3>Мои работы</h3>
                <div class="gallery-grid">
                  @for (item of photographer()!.portfolio.slice(0, showAllPhotos() ? undefined : 6); track item.id) {
                    <div class="gallery-item" tabindex="0" (click)="openGalleryDialog(item)" (keydown.enter)="openGalleryDialog(item)">
                      <img [src]="item.image" [alt]="item.title" class="gallery-image" />
                      <div class="gallery-overlay">
                        <h4>{{ item.title }}</h4>
                        <p>{{ item.description }}</p>
                        <mat-icon>fullscreen</mat-icon>
                      </div>
                    </div>
                  }
                </div>
              @if (photographer()!.portfolio.length > 6 && !showAllPhotos()) {
                <button mat-stroked-button class="view-all-gallery" (click)="toggleGalleryView()">
                  <mat-icon>photo_library</mat-icon>
                  Показать все {{ photographer()!.portfolio.length }} фото
                </button>
              }
              @if (showAllPhotos() && photographer()!.portfolio.length > 6) {
                <button mat-stroked-button class="view-all-gallery" (click)="toggleGalleryView()">
                  <mat-icon>unfold_less</mat-icon>
                  Свернуть галерею
                </button>
              }
              </div>
            }
          </div>
        </section>

        <!-- DESIRE Section -->
        <section class="desire-section">
          <div class="container">
            <!-- Emotional header -->
            <div class="desire-header">
              <h2 class="desire-title">💖 Сделай свои воспоминания по-настоящему особенными</h2>
              <p class="emotional-text">{{ photographer()!.desire.emotionalText }}</p>
            </div>

            <!-- Main Packages -->
            <div class="main-packages-section">
              <h3 class="section-title">🌟 Основные пакеты выездной фотосъёмки:</h3>
              <div class="packages-grid">
                @for (package of photographer()!.desire.mainPackages; track package.id) {
                  <mat-card class="package-card" [class.highlighted]="package.highlighted">
                    @if (package.highlighted) {
                      <div class="highlighted-badge">
                        <mat-icon>star</mat-icon>
                        <span>Хит продаж</span>
                      </div>
                    }
                    
                    <mat-card-header>
                      <div class="package-emoji" mat-card-avatar>{{ package.emoji }}</div>
                      <mat-card-title>{{ package.name }}</mat-card-title>
                      <mat-card-subtitle>{{ package.description }}</mat-card-subtitle>
                    </mat-card-header>
                    
                    <mat-card-content>
                      <div class="package-price">
                        <span class="price">{{ package.price }}₽</span>
                        <span class="duration">{{ package.duration }}</span>
                      </div>
                      
                      <ul class="package-features">
                        @for (feature of package.features; track $index) {
                          <li>
                            <mat-icon>check_circle</mat-icon>
                            <span>{{ feature }}</span>
                          </li>
                        }
                      </ul>
                    </mat-card-content>
                    
                    <mat-card-actions>
                      <button mat-raised-button 
                              color="primary" 
                              (click)="selectPackage(package)"
                              class="select-package-btn">
                        <mat-icon>event_available</mat-icon>
                        Выбрать пакет
                      </button>
                    </mat-card-actions>
                  </mat-card>
                }
              </div>
            </div>

            <!-- Additional Services -->
            <div class="additional-services-section">
              <h3 class="section-title">🎁 Дополнительные услуги:</h3>
              <p class="section-subtitle">Эти услуги доступны в любой момент при оформлении заказа или прямо на мероприятии:</p>
              <div class="services-grid">
                @for (service of photographer()!.desire.additionalServices; track service.id) {
                  <div class="service-card" [class.premium]="service.isPremium">
                    @if (service.isPremium) {
                      <div class="premium-badge">Premium</div>
                    }
                    <div class="service-icon">
                      <mat-icon>{{ service.icon }}</mat-icon>
                    </div>
                    <h4 class="service-name">{{ service.name }}</h4>
                    <p class="service-description">{{ service.description }}</p>
                  </div>
                }
              </div>
            </div>

            <!-- Special Offers -->
            <div class="special-offers-section">
              <h3 class="section-title">💌 Специальные бонусы и акции:</h3>
              <div class="offers-grid">
                @for (offer of photographer()!.desire.specialOffers; track offer.id) {
                  <div class="offer-card">
                    <div class="offer-emoji">{{ offer.emoji }}</div>
                    <div class="offer-content">
                      <h4 class="offer-title">{{ offer.title }}</h4>
                      <p class="offer-description">{{ offer.description }}</p>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Why Choose Us -->
            <div class="why-choose-us-section">
              <h3 class="section-title">💎 Почему выбирают именно нас:</h3>
              <div class="reasons-grid">
                @for (reason of photographer()!.desire.whyChooseUs; track $index) {
                  <div class="reason-card">
                    <mat-icon>verified</mat-icon>
                    <p>{{ reason }}</p>
                  </div>
                }
              </div>
            </div>
          </div>
        </section>

        <!-- ACTION Section -->
        <section class="action-section">
          <div class="container">
            <h2 class="action-title">{{ photographer()!.action.ctaText }}</h2>
            
            <div class="special-offer">
              <mat-icon>card_giftcard</mat-icon>
              <span>{{ photographer()!.action.bonusOffer }}</span>
            </div>

            <!-- Primary Booking Button -->
            <div class="primary-action">
              <button 
                class="modern-contact-button main-cta"
                (click)="openBookingDialog()">
                <mat-icon class="button-icon">event_available</mat-icon>
                <span>Записаться онлайн</span>
              </button>
            </div>

            <!-- Contact Cards Section -->
            <div class="contact-cards">
              <!-- МАКС Card -->
              <div class="contact-card max-card">
                <div class="contact-icon">
                  <mat-icon class="contact-logo" svgIcon="channel-max" />
                </div>

                <div class="contact-info">
                  <h4 class="contact-title">МАКС</h4>
                  <p class="contact-description">Быстрые сообщения и обмен фото</p>
                </div>

                <button class="contact-button"
                       (click)="contactVia({type: 'max', href: 'https://max.ru/id262603741214_bot', icon: 'channel-max', label: 'МАКС'})">
                  <span>Связаться</span>
                  <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>

              <!-- Telegram Card -->
              <div class="contact-card telegram-card">
                <div class="contact-icon">
                  <mat-icon class="contact-logo" svgIcon="channel-telegram" />
                </div>
                
                <div class="contact-info">
                  <h4 class="contact-title">Telegram</h4>
                  <p class="contact-description">Мгновенное общение и файлы</p>
                </div>
                
                <button class="contact-button"
                       (click)="contactVia({type: 'telegram', href: 'https://t.me/magnus_photo', icon: 'channel-telegram', label: 'Telegram'})">
                  <span>Связаться</span>
                  <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>

              <!-- Phone Call Card -->
              <div class="contact-card phone-card">
                <div class="contact-icon">
                  <mat-icon>call</mat-icon>
                </div>
                
                <div class="contact-info">
                  <h4 class="contact-title">Позвонить</h4>
                  <p class="contact-description">Прямой звонок для консультации</p>
                </div>
                
                <button class="contact-button"
                       (click)="contactVia({type: 'phone', href: 'tel:+78633226575', icon: 'call', label: 'Позвонить'})">
                  <span>Связаться</span>
                  <mat-icon>arrow_forward</mat-icon>
                </button>
              </div>
            </div>
          </div>
        </section>

      } @else {
        <!-- Error State -->
        <div class="error-container">
          <div class="error-content">
            <mat-icon class="error-icon">error_outline</mat-icon>
            <h2>Фотограф не найден</h2>
            <p>К сожалению, профиль фотографа с таким адресом не существует или временно недоступен.</p>
            <button mat-raised-button color="primary" routerLink="/photographers">
              <mat-icon>arrow_back</mat-icon>
              Вернуться к списку фотографов
            </button>
          </div>
        </div>
      }

      <!-- Scroll to top button -->
      @if (showScrollTop()) {
        <button 
          mat-fab 
          color="primary"
          class="scroll-top-button"
          (click)="scrollToTop()"
          matTooltip="Наверх">
          <mat-icon>keyboard_arrow_up</mat-icon>
        </button>
      }
    </div>
  `,
  styleUrl: './photographer-personal-page.component.scss'
})
export class PhotographerPersonalPageComponent implements OnInit {
  // Dependency injection
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly photographerService = inject(PhotographerPersonalService);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  private log = inject(LoggerService);

  // Signals for reactive state management
  readonly photographer = signal<PhotographerPersonalProfile | null>(null);
  readonly isLoading = signal<boolean>(true);
  readonly error = signal<string | null>(null);
  readonly currentTheme = signal<'light' | 'dark'>('light');
  readonly showScrollTop = signal<boolean>(false);
  readonly showAllPhotos = signal<boolean>(false);

  // Responsive signals
  readonly isMobile = signal<boolean>(false);
  readonly isTablet = signal<boolean>(false);

  // Computed properties
  readonly pageTitle = computed(() => {
    const p = this.photographer();
    return p ? `${p.name} - ${p.title} | Своё Фото` : 'Фотограф | Своё Фото';
  });

  constructor() {
    this.setupResponsiveLayout();
    this.setupClientSideFeatures();
  }

  ngOnInit(): void {
    this.loadPhotographerProfile();
  }

  private loadPhotographerProfile(): void {
    this.route.params
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const slug = params['slug'];
        if (slug) {
          this.isLoading.set(true);
          this.error.set(null);
          
          // Загружаем основной профиль
          this.photographerService.getPhotographerProfile(slug)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (profile) => {
                // Загружаем отдельно портфолио из MinIO
                this.photographerService.getPhotographerPortfolio(slug)
                  .subscribe({
                    next: (portfolio) => {
                      this.log.debug('✅ Получено портфолио:', portfolio);
                      // Проверяем наличие необходимых полей
                      const validPortfolio = portfolio.map(item => {
                        if (!item.image) {
                          this.log.warn('⚠️ Отсутствует поле image в элементе портфолио:', item);
                        }
                        return item;
                      });
                      
                      // Обновляем профиль с реальным портфолио
                      const updatedProfile = { ...profile, portfolio: validPortfolio };
                      this.log.debug('✅ Профиль обновлен с портфолио:', updatedProfile);
                      this.photographer.set(updatedProfile);
                      this.setupSEO(updatedProfile);
                      this.isLoading.set(false);
                    },
                    error: (portfolioError) => {
                      this.log.error('❌ Ошибка загрузки портфолио:', portfolioError);
                      // Даже если портфолио не загрузилось, показываем профиль
                      this.photographer.set(profile);
                      this.setupSEO(profile);
                      this.isLoading.set(false);
                    }
                  });
              },
              error: (error) => {
                this.log.error('Ошибка загрузки профиля фотографа:', error);
                this.error.set(error.message);
                this.isLoading.set(false);
              }
            });
        }
      });
  }

  private setupSEO(profile: PhotographerPersonalProfile): void {
    // Set page title
    this.titleService.setTitle(profile.seo.title);
    
    // Set meta tags
    this.metaService.updateTag({ name: 'description', content: profile.seo.description });
    this.metaService.updateTag({ name: 'keywords', content: profile.seo.keywords.join(', ') });
    
    // Open Graph tags
    this.metaService.updateTag({ property: 'og:title', content: profile.seo.title });
    this.metaService.updateTag({ property: 'og:description', content: profile.seo.description });
    this.metaService.updateTag({ property: 'og:image', content: profile.seo.ogImage });
    this.metaService.updateTag({ property: 'og:type', content: 'profile' });
    
    // Twitter Card tags
    this.metaService.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.metaService.updateTag({ name: 'twitter:title', content: profile.seo.title });
    this.metaService.updateTag({ name: 'twitter:description', content: profile.seo.description });
    this.metaService.updateTag({ name: 'twitter:image', content: profile.seo.ogImage });
    
    // Photographer specific meta
    this.metaService.updateTag({ name: 'author', content: profile.name });
    this.metaService.updateTag({ name: 'photographer', content: profile.name });
    this.metaService.updateTag({ name: 'location', content: profile.location });
  }

  private setupResponsiveLayout(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.breakpointObserver
        .observe([Breakpoints.Handset, Breakpoints.Tablet])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(result => {
          this.isMobile.set(result.breakpoints[Breakpoints.Handset]);
          this.isTablet.set(result.breakpoints[Breakpoints.Tablet]);
        });
    }
  }

  private setupClientSideFeatures(): void {
    afterNextRender(() => {
      this.detectTheme();
      this.setupScrollListener();
    });
  }

  private detectTheme(): void {
    if (isPlatformBrowser(this.platformId)) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.currentTheme.set(prefersDark ? 'dark' : 'light');
      
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', (e) => {
          this.currentTheme.set(e.matches ? 'dark' : 'light');
        });
    }
  }

  private setupScrollListener(): void {
    if (isPlatformBrowser(this.platformId)) {
      const scrollHandler = () => {
        const shouldShow = window.scrollY > 500;
        this.showScrollTop.set(shouldShow);
      };

      window.addEventListener('scroll', scrollHandler, { passive: true });
      
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', scrollHandler);
      });
    }
  }

  // Public methods for template
  getStarsArray(rating: number): boolean[] {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      stars.push(i <= Math.round(rating));
    }
    return stars;
  }

  getDiscountedPrice(originalPrice: number, discount: number): number {
    return Math.round(originalPrice * (100 - discount) / 100);
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  // Action methods
  openBookingDialog(): void {
    // Перенаправляем на существующую страницу записи
    this.router.navigate(['/booking']);
  }

  openContactDialog(): void {
    const photographer = this.photographer();
    if (photographer) {
      // Открываем МАКС напрямую с сообщением
      const message = `Здравствуйте! Меня интересует съемка у фотографа ${photographer.name}. Расскажите, пожалуйста, подробнее о ваших услугах.`;
      const encodedMessage = encodeURIComponent(message);
      const maxUrl = `https://max.ru/id262603741214_bot?text=${encodedMessage}`;

      if (isPlatformBrowser(this.platformId)) {
        window.open(maxUrl, '_blank');
      }
    }
  }

  openGalleryDialog(item: unknown): void {
    // TODO: Create GalleryDialogComponent
    this.log.debug('Opening gallery dialog for:', item);
    // this.dialog.open(GalleryDialogComponent, {
    //   data: { item, photographer: this.photographer() },
    //   maxWidth: '95vw',
    //   maxHeight: '95vh',
    //   panelClass: 'gallery-dialog'
    // });
  }

  selectPackage(_packageData: unknown): void {
    this.openBookingDialog();
    // Package will be pre-selected in the booking dialog
  }

  contactVia(method: { type: string; href: string; icon: string; label: string }): void {
    if (isPlatformBrowser(this.platformId)) {
      let url = '';
      switch (method.type) {
        case 'telegram':
          url = method.href;
          break;
        case 'phone':
          url = method.href;
          break;
        case 'max':
          url = method.href;
          break;
        case 'email':
          url = `mailto:${method.href}`;
          break;
        case 'instagram':
          url = method.href;
          break;
      }
      
      if (url) {
        window.open(url, '_blank');
      }
    }
  }

  viewAllGallery(): void {
    const photographer = this.photographer();
    if (photographer?.id) {
      this.toggleGalleryView();
    }
  }

  toggleGalleryView(): void {
    this.showAllPhotos.set(!this.showAllPhotos());
    
    // Плавная прокрутка к началу галереи при сворачивании
    if (!this.showAllPhotos() && isPlatformBrowser(this.platformId)) {
      const galleryElement = document.querySelector('.gallery-preview');
      if (galleryElement) {
        galleryElement.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }

  scrollToTop(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}
