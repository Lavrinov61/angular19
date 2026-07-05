import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  input,
  OnInit,
  OnDestroy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from '../../services/auth.service';

interface NavTab {
  readonly route: string;
  readonly icon: string;
  readonly label: string;
  readonly exact: boolean;
  readonly requiresAuth?: boolean;
  readonly activePrefixes?: readonly string[];
}

@Component({
  selector: 'app-flexible-nav-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: {
    'role': 'navigation',
    'aria-label': 'Основная навигация',
    '[class.flexible-nav-bar--hidden]': 'hidden()',
    '[class.flexible-nav-bar--light]': 'surface() === "light"',
  },
  template: `
    <nav class="fnb">
      <!-- Sliding pill indicator -->
      @if (activeIndex() !== null) {
        <div
          class="fnb__pill"
          [style.transform]="'translateX(' + pillOffset() + 'px)'"
        ></div>
      }

      @for (tab of tabs; track tab.route; let i = $index) {
        <button
          class="fnb__tab"
          [class.fnb__tab--active]="activeIndex() === i"
          role="tab"
          [attr.aria-selected]="activeIndex() === i"
          [attr.aria-label]="tab.label"
          (click)="onTabClick(tab, i)"
        >
          <span class="fnb__icon-wrap">
            <mat-icon class="fnb__icon">{{ tab.icon }}</mat-icon>

            @if (tab.route === '/user-profile/orders' && ordersBadge() > 0) {
              <span
                class="fnb__badge"
                [attr.aria-label]="ordersBadge() + ' непрочитанных'"
              >{{ ordersBadge() > 99 ? '99+' : ordersBadge() }}</span>
            }
          </span>

          <span class="fnb__label">{{ tab.label }}</span>
        </button>
      }
    </nav>
  `,
  styles: [`
    :host {
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 100;
      padding-bottom: env(safe-area-inset-bottom);
      background: rgba(18, 18, 18, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    :host(.flexible-nav-bar--hidden) {
      display: none;
    }

    :host(.flexible-nav-bar--light) {
      background: rgba(255, 255, 255, 0.96);
      border-top: 1px solid #dfe3e8;
      box-shadow: 0 -8px 22px rgba(17, 24, 39, 0.08);
    }

    @media (min-width: 600px) {
      :host {
        display: none;
      }
    }

    .fnb {
      display: flex;
      align-items: center;
      justify-content: space-around;
      height: var(--m3e-nav-height, 64px);
      position: relative;
      max-width: 500px;
      margin: 0 auto;
    }

    /* Sliding pill */
    .fnb__pill {
      position: absolute;
      top: 50%;
      left: 0;
      width: var(--m3e-nav-pill-width, 56px);
      height: var(--m3e-nav-pill-height, 32px);
      margin-top: -24px; /* vertically center relative to icon area */
      border-radius: var(--m3e-corner-full, 9999px);
      background: var(--ed-accent-container, #451a03);
      transition: transform var(--m3e-spring-default-duration, 500ms) var(--m3e-spring-default, cubic-bezier(0.34, 1.40, 0.64, 1));
      pointer-events: none;
      z-index: 0;
    }

    .fnb__tab {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      flex: 1;
      height: 100%;
      border: none;
      background: none;
      padding: 0;
      cursor: pointer;
      position: relative;
      z-index: 1;
      -webkit-tap-highlight-color: transparent;
      outline: none;
    }

    .fnb__tab:focus-visible {
      outline: 2px solid var(--ed-accent, #f59e0b);
      outline-offset: -2px;
      border-radius: var(--m3e-corner-sm, 8px);
    }

    .fnb__icon-wrap {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: var(--m3e-nav-pill-width, 56px);
      height: var(--m3e-nav-pill-height, 32px);
    }

    .fnb__icon {
      font-size: var(--m3e-nav-icon-size, 24px);
      width: var(--m3e-nav-icon-size, 24px);
      height: var(--m3e-nav-icon-size, 24px);
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition: color var(--m3e-effect-fast-duration, 200ms) var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1));
    }

    .fnb__tab--active .fnb__icon {
      color: var(--ed-accent, #f59e0b);
    }

    :host(.flexible-nav-bar--light) .fnb__pill {
      background: #ffe4e0;
    }

    :host(.flexible-nav-bar--light) .fnb__icon {
      color: #777d88;
    }

    :host(.flexible-nav-bar--light) .fnb__tab--active .fnb__icon {
      color: #ef3124;
    }

    .fnb__label {
      font-size: var(--m3e-nav-label-size, 12px);
      font-weight: 500;
      line-height: 1;
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition: color var(--m3e-effect-fast-duration, 200ms) var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1)),
                  font-weight var(--m3e-effect-fast-duration, 200ms) var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1));
    }

    .fnb__tab--active .fnb__label {
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    :host(.flexible-nav-bar--light) .fnb__label {
      color: #777d88;
    }

    :host(.flexible-nav-bar--light) .fnb__tab--active .fnb__label {
      color: #20242a;
    }

    .fnb__badge {
      position: absolute;
      top: -4px;
      right: 2px;
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      background: #ef4444;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      line-height: 18px;
      text-align: center;
      padding: 0 4px;
      box-sizing: border-box;
      pointer-events: none;
    }
  `],
})
export class FlexibleNavBarComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private authService = inject(AuthService);
  private platformId = inject(PLATFORM_ID);

  /** Badge count on Orders tab */
  ordersBadge = input<number>(0);

  /** Hide the nav bar entirely (e.g. on employee routes) */
  hidden = input(false);

  /** Surface variant for public dark pages vs. light cabinet pages */
  surface = input<'dark' | 'light'>('dark');

  readonly tabs: readonly NavTab[] = [
    { route: '/', icon: 'home', label: 'Главная', exact: true },
    {
      route: '/user-profile/orders',
      icon: 'receipt_long',
      label: 'Заказы',
      exact: false,
      requiresAuth: true,
      activePrefixes: ['/user-profile/orders', '/orders'],
    },
    {
      route: '/user-profile/subscription',
      icon: 'percent',
      label: 'Скидки',
      exact: false,
      requiresAuth: true,
      activePrefixes: ['/user-profile/subscription', '/user-profile/education', '/user-profile/loyalty', '/subscriptions'],
    },
    {
      route: '/services',
      icon: 'apps',
      label: 'Услуги',
      exact: false,
      activePrefixes: ['/services', '/user-profile/services', '/online-uslugi'],
    },
    {
      route: '/user-profile',
      icon: 'person',
      label: 'Кабинет',
      exact: false,
      requiresAuth: true,
      activePrefixes: ['/user-profile', '/profile', '/chat'],
    },
  ];

  /** Current active tab index */
  readonly activeIndex = signal<number | null>(null);

  /** Pill translateX offset in px */
  readonly pillOffset = computed(() => {
    // The pill is centered on the active tab using the measured tab width.
    // We compute the center of the tab minus half the pill width.
    // offset = index * tabWidth + (tabWidth - pillWidth) / 2
    const tabWidth = this.tabWidth();
    const pillWidth = 56; // --m3e-nav-pill-width
    const activeIndex = this.activeIndex();
    if (activeIndex === null) {
      return 0;
    }

    return activeIndex * tabWidth + (tabWidth - pillWidth) / 2;
  });

  /** Measured tab width in px (recalculated on resize) */
  readonly tabWidth = signal(100); // default fallback

  private routerSub: Subscription | null = null;
  private resizeCleanup: (() => void) | null = null;

  ngOnInit(): void {
    // Detect active tab from current URL
    this.updateActiveIndex(this.router.url);

    // Listen for navigation changes
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.updateActiveIndex(e.urlAfterRedirects));

    // Measure tab width on the browser
    if (isPlatformBrowser(this.platformId)) {
      this.measureTabWidth();
      const onResize = () => this.measureTabWidth();
      window.addEventListener('resize', onResize, { passive: true });
      this.resizeCleanup = () => window.removeEventListener('resize', onResize);
    }
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.resizeCleanup?.();
  }

  onTabClick(tab: NavTab, index: number): void {
    // If clicking a protected tab while not authenticated, redirect to login
    if (tab.requiresAuth && !this.authService.isAuthenticated()) {
      this.router.navigate(['/auth/login'], { queryParams: { returnUrl: tab.route } });
      return;
    }

    this.activeIndex.set(index);
    this.router.navigate([tab.route]);
  }

  private updateActiveIndex(url: string): void {
    // Strip query params and fragments for matching
    const path = this.normalizePath(url);

    let matchedIndex: number | null = null;
    let matchedScore = -1;
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      const prefixes = tab.activePrefixes ?? [tab.route];
      for (const prefix of prefixes) {
        const normalizedPrefix = this.normalizePath(prefix);
        if (this.pathMatches(path, normalizedPrefix, tab.exact)) {
          const score = normalizedPrefix.length + (tab.exact ? 1000 : 0);
          if (score > matchedScore) {
            matchedScore = score;
            matchedIndex = i;
          }
        }
      }
    }

    this.activeIndex.set(matchedIndex);
  }

  private pathMatches(path: string, prefix: string, exact: boolean): boolean {
    if (exact || prefix === '/') {
      return path === prefix;
    }

    return path === prefix || path.startsWith(`${prefix}/`);
  }

  private normalizePath(url: string): string {
    return url.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
  }

  private measureTabWidth(): void {
    // Calculate based on actual nav container width
    const navEl = document.querySelector('.fnb') as HTMLElement | null;
    if (navEl) {
      this.tabWidth.set(navEl.offsetWidth / this.tabs.length);
    } else {
      // Fallback: use viewport width (capped at 500px max-width)
      const containerWidth = Math.min(window.innerWidth, 500);
      this.tabWidth.set(containerWidth / this.tabs.length);
    }
  }
}
