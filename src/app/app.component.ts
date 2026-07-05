import { Component, computed, inject, signal, afterNextRender, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { RouterOutlet, Router, NavigationStart, NavigationEnd, NavigationCancel, NavigationError } from '@angular/router';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { SidenavContentComponent } from './core/components/sidenav-content/sidenav-content.component';
import { FlexibleNavBarComponent } from './core/components/flexible-nav-bar/flexible-nav-bar.component';
import { UnifiedAppBarComponent } from './core/components/unified-app-bar/unified-app-bar.component';
import { NavigationService } from './core/services/navigation.service';
import { ThemeService } from './core/services/theme.service';
import { ThemeSyncDirective } from './core/directives/theme-sync.directive';
import { APP_VERSION, BUILD_TIMESTAMP } from './core/constants/version';
import { TrackingService } from './core/services/tracking.service';
import { ReferralTrackingService } from './core/services/referral-tracking.service';
import { BehaviorTrackingService } from './core/services/behavior-tracking.service';
import { FooterComponent } from './core/components/footer/footer.component';
import { CartComponent } from './features/chat-page/components/cart/cart.component';
import { AuthChatService } from './core/services/auth-chat.service';
import { DesktopNavComponent } from './core/components/desktop-nav/desktop-nav.component';
import { WindowSizeClass } from './core/services/navigation.service';
import { NetworkBannerComponent } from './core/components/network-banner/network-banner.component';
import { StudioClosureBannerComponent } from './core/components/studio-closure-banner/studio-closure-banner.component';
import { PwaInstallPromptComponent } from './features/chat-page/components/pwa-install-prompt/pwa-install-prompt.component';
import { SiteMobileMenuComponent } from './core/components/site-mobile-menu/site-mobile-menu.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    MatSidenavModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    SidenavContentComponent,
    FlexibleNavBarComponent,
    UnifiedAppBarComponent,
    ThemeSyncDirective,
    FooterComponent,
    CartComponent,
    DesktopNavComponent,
    NetworkBannerComponent,
    StudioClosureBannerComponent,
    PwaInstallPromptComponent,
    SiteMobileMenuComponent,
  ],
  template: `
    @if (!hideGlobalChrome()) {
      <app-pwa-install-prompt />
      <app-network-banner [section]="dataSection()" />
    }
    @if (isNavigating()) {
      <mat-progress-bar mode="indeterminate" class="nav-progress" />
    }
    <mat-sidenav-container class="app-container" appThemeSync
      [style.--app-sidenav-width]="sidenavCssWidth()">
      @if (!isEmployeeRoute() && !isDesktop() && !hideGlobalChrome()) {
        <mat-sidenav
          [mode]="navigationService.sidenavMode()"
          [opened]="navigationService.sidenavOpened()"
          (openedChange)="onSidenavOpenedChange($event)"
          [style.width.px]="navigationService.sidenavWidth()"
          class="app-sidenav"
          [class.collapsed]="!navigationService.sidenavExpanded()">
          <app-sidenav-content />
        </mat-sidenav>
      }

      <mat-sidenav-content class="app-content-container" [attr.data-section]="dataSection()">
        @if (!isEmployeeRoute() && !isChatRoute() && !hideGlobalChrome()) {
          <app-desktop-nav />
        }
        @if (!isEmployeeRoute() && !isChatRoute() && !hideGlobalChrome()) {
          <app-unified-app-bar
            [mode]="isSubPage() ? 'sub-page' : 'primary'"
            [title]="pageTitle()"
            (menuClick)="openSiteMobileMenu()"
          />
        }

        <main class="main-content"
              [class.has-app-bar]="!isEmployeeRoute() && !isChatRoute() && !hideGlobalChrome() && navigationService.isMobile()"
              [class.has-topnav]="!isEmployeeRoute() && !isChatRoute() && !hideGlobalChrome() && isDesktop()"
              [class.has-bottom-nav]="showMobileBottomNav()"
              [class.crm-mode]="isEmployeeRoute()"
              [class.chat-mode]="isChatRoute()">
          @if (!isEmployeeRoute() && !hideGlobalChrome()) {
            <app-studio-closure-banner />
          }
          <router-outlet />
          @if (showFooter() && !hideGlobalChrome()) {
            <app-footer />
          }
        </main>

        @defer (on idle) {
          @if (!isEmployeeRoute() && !hideGlobalChrome()) {
            <app-cart />
          }
        }

        <app-flexible-nav-bar
          [hidden]="!showMobileBottomNav()"
          [surface]="isProfileRoute() ? 'light' : 'dark'"
        />

        <app-site-mobile-menu
          [open]="siteMobileMenuOpen()"
          (closed)="closeSiteMobileMenu()"
        />

        @if (!hideGlobalChrome()) {
          <div class="version-indicator">v{{ appVersion }}</div>
        }
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .app-container {
      position: absolute;
      inset: 0;
      background: transparent;
    }

    .app-sidenav {
      background: var(--ed-surface-dim, #111111);
      border-right: 1px solid var(--ed-outline-variant, #2a2a2a);
      transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1);
      overflow-x: hidden;
    }

    .app-content-container {
      display: flex;
      flex-direction: column;
      min-height: 100vh;
      min-height: 100dvh;
    }

    .main-content {
      flex: 1;

      /* Mobile: space for M3E FlexibleNavBar (64px) + safe area */
      &.has-bottom-nav {
        padding-bottom: calc(64px + env(safe-area-inset-bottom, 0px));
      }

      /* Mobile: space for UnifiedAppBar (56px) */
      &.has-app-bar {
        padding-top: 56px;
      }

      /* Desktop: space for fixed top-bar */
      &.has-topnav {
        padding-top: 64px;
      }

      /* CRM mode: full screen, no padding */
      &.crm-mode {
        padding: 0;
      }

      /* Chat mode: flex column for chat page, padding от app-bar/bottom-nav сохраняется */
      &.chat-mode {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
    }

    .main-content.chat-mode app-studio-closure-banner {
      position: static;
      top: auto;
      z-index: auto;
      flex-shrink: 0;
    }

    .version-indicator {
      position: fixed;
      bottom: 8px;
      left: 8px;
      font-size: 10px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      opacity: 0.4;
      padding: 2px 4px;
      border-radius: 4px;
      z-index: 1000;
      pointer-events: none;
    }

    .nav-progress {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1100;
      height: 3px;
    }
`]
})
export class AppComponent {
  title = 'Своё Фото';
  appVersion = BUILD_TIMESTAMP && BUILD_TIMESTAMP !== '__BUILD_TIMESTAMP__'
    ? `${APP_VERSION} (${BUILD_TIMESTAMP})`
    : APP_VERSION;

  protected navigationService = inject(NavigationService);
  private themeService = inject(ThemeService);
  private matIconRegistry = inject(MatIconRegistry);
  private domSanitizer = inject(DomSanitizer);
  private trackingService = inject(TrackingService);
  private referralTracking = inject(ReferralTrackingService);
  // Инициализирует запись экрана (rrweb) и поведенческие события для аналитики
  private behaviorTracking = inject(BehaviorTrackingService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private document = inject(DOCUMENT);
  private chatService = inject(AuthChatService);
  protected isEmployeeRoute = signal(false);
  protected isChatRoute = signal(false);
  protected isFullscreenRoute = signal(false);
  protected isProfileRoute = signal(false);
  protected isMarketingLandingRoute = signal(false);
  protected isNavigating = signal(false);
  protected siteMobileMenuOpen = signal(false);
  protected hideMarketingMobileChrome = computed(() =>
    this.isMarketingLandingRoute() && this.navigationService.isMobile(),
  );
  protected hideGlobalChrome = computed(() =>
    this.isFullscreenRoute() || this.hideMarketingMobileChrome() || this.isProfileRoute(),
  );
  protected showMobileBottomNav = computed(() =>
    this.navigationService.isMobile()
    && !this.isFullscreenRoute()
    && !this.isBackOfficeRoute(this.currentUrl()),
  );
  /** Sub-page mode для UnifiedAppBar (back button + title) */
  protected isSubPage = computed(() => {
    const url = this.currentUrl();
    if (!url || url === '/') return false;
    return this.isChatRoute() || this.isProfileRoute();
  });
  /** Динамический заголовок для UnifiedAppBar sub-page mode */
  protected pageTitle = computed(() => {
    const url = this.currentUrl().split('?')[0].split('#')[0];
    const titles: Record<string, string> = {
      '/chat': 'Чат',
      '/user-profile': 'Мой профиль',
      '/user-profile/orders': 'Заказы',
      '/user-profile/bookings': 'Мои записи',
      '/user-profile/approvals': 'Согласование фото',
      '/user-profile/my-photos': 'Мои фотографии',
      '/user-profile/loyalty': 'Бонусы',
      '/user-profile/subscription': 'Выгодно',
      '/user-profile/account': 'Аккаунт',
    };
    if (titles[url]) return titles[url];
    if (url.startsWith('/user-profile/orders/')) return 'Детали заказа';
    if (url.startsWith('/user-profile/photo-selector/')) return 'Фотосессия';
    if (url.startsWith('/user-profile')) return 'Мой профиль';
    return '';
  });
  /** Показываем footer только на публичных сайтовых страницах */
  protected showFooter = computed(() =>
    !this.isEmployeeRoute() && !this.isChatRoute() && !this.isProfileRoute()
  );
  /** Текущий URL для computed-сигналов */
  private currentUrl = signal('/');
  /** Секция для scoping editorial дизайн-токенов (public vs crm) */
  protected dataSection = computed(() => this.isEmployeeRoute() ? 'crm' : 'public');
  /** Desktop (600px+), top-bar вместо sidenav */
  protected isDesktop = computed(() => {
    const wsc = this.navigationService.windowSizeClass();
    return wsc !== WindowSizeClass.Compact;
  });
  /** CSS-переменная для margin-left контента (обход бага Angular Material, не обновляет margin при смене ширины sidenav) */
  protected sidenavCssWidth = computed(() => {
    if (this.isEmployeeRoute() || this.navigationService.isMobile() || this.isDesktop()) return '0px';
    return `${this.navigationService.sidenavWidth()}px`;
  });

  constructor() {
    this.updateRouteState(this.router.url);
    this.registerIcons();

    this.router.events.subscribe(e => {
      if (e instanceof NavigationStart) {
        this.isNavigating.set(true);
      } else if (e instanceof NavigationEnd) {
        this.isNavigating.set(false);
        this.siteMobileMenuOpen.set(false);
        this.updateRouteState(e.urlAfterRedirects);
        // mat-sidenav-content, фактический контейнер скролла (не window)
        if (isPlatformBrowser(this.platformId)) {
          (this.document.querySelector('.mat-drawer-content') as HTMLElement)?.scrollTo(0, 0);
        }
      } else if (e instanceof NavigationCancel || e instanceof NavigationError) {
        this.isNavigating.set(false);
      }
    });

    afterNextRender(() => {
      this.trackingService.retryFailedRequests();
      // Capture partner, loyalty referral, and promo params from URL.
      this.referralTracking.captureFromUrl();
    });
  }

  private updateRouteState(url: string): void {
    const normalizedUrl = url || '/';
    const path = normalizedUrl.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    this.currentUrl.set(normalizedUrl);
    this.isEmployeeRoute.set(path.startsWith('/employee'));
    this.isChatRoute.set(path.startsWith('/chat'));
    this.isFullscreenRoute.set(
      path === '/photo-review'
      || path.startsWith('/photo-review/')
      || path === '/auth'
      || path.startsWith('/auth/')
      // Подтверждение очной студ-верификации — отдельная фокус-страница (своя
      // вёрстка на 100vh): прячем шапку/баннер/футер, чтобы не было пустого
      // провала и лишней навигации над карточкой.
      || path === '/education/in-person'
    );
    this.isProfileRoute.set(
      path.startsWith('/user-profile')
      || path.startsWith('/profile')
    );
    this.isMarketingLandingRoute.set(
      path === '/education' || path === '/business' || path === '/personal',
    );
  }

  private registerIcons(): void {
    const icons = ['google-logo', 'apple-logo', 'vk-logo', 'telegram-logo'];
    for (const icon of icons) {
      this.matIconRegistry.addSvgIcon(
        icon,
        this.domSanitizer.bypassSecurityTrustResourceUrl(`../assets/icons/${icon}.svg`)
      );
    }

    // Channel brand icons (CRM inbox / chat detail)
    const channelIcons = ['channel-telegram', 'channel-vk', 'channel-whatsapp', 'channel-instagram', 'channel-max'];
    for (const icon of channelIcons) {
      this.matIconRegistry.addSvgIcon(
        icon,
        this.domSanitizer.bypassSecurityTrustResourceUrl(`../assets/icons/${icon}.svg`)
      );
    }

    // Loyalty system icons
    const loyaltyIcons = [
      'level-sprout', 'level-camera', 'level-target', 'level-star', 'level-crown',
      'ach-wave', 'ach-shutter', 'ach-frame', 'ach-heart', 'ach-trophy', 'ach-flame', 'ach-link',
    ];
    for (const icon of loyaltyIcons) {
      this.matIconRegistry.addSvgIcon(
        icon,
        this.domSanitizer.bypassSecurityTrustResourceUrl(`../assets/icons/loyalty/${icon}.svg`)
      );
    }
  }

  onSidenavOpenedChange(opened: boolean): void {
    if (!opened && this.navigationService.isMobile()) {
      this.navigationService.closeSidenav();
    }
  }

  protected openSiteMobileMenu(): void {
    this.navigationService.closeSidenav();
    this.siteMobileMenuOpen.set(true);
  }

  protected closeSiteMobileMenu(): void {
    this.siteMobileMenuOpen.set(false);
  }

  private isBackOfficeRoute(url: string): boolean {
    const path = url.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    return path.startsWith('/employee')
      || path.startsWith('/admin')
      || path.startsWith('/analytics')
      || path.startsWith('/photographer-dashboard')
      || path.startsWith('/partner-dashboard');
  }
}
