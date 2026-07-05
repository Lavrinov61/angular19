import { Injectable, signal, computed, inject } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavItem, MAIN_MENU, PHOTOGRAPHER_DASHBOARD_MENU, CLIENT_CABINET_MENU } from '../data/nav.data';
import { AuthService } from './auth.service';

export enum WindowSizeClass {
  Compact = 'compact',
  Medium = 'medium',
  Expanded = 'expanded',
  Large = 'large',
  XLarge = 'xlarge'
}

@Injectable({
  providedIn: 'root'
})
export class NavigationService {
  private breakpointObserver = inject(BreakpointObserver);
  private router = inject(Router);
  private authService = inject(AuthService);

  // --- Internal state ---
  private _windowSizeClass = signal(WindowSizeClass.Compact);
  private _sidenavOpened = signal(false);
  private _sidenavExpanded = signal(false);

  // --- Public readonly signals ---
  readonly currentUrl = signal('');

  readonly windowSizeClass = this._windowSizeClass.asReadonly();

  readonly isMobile = computed(() => this._windowSizeClass() === WindowSizeClass.Compact);

  readonly sidenavMode = computed<'over' | 'side'>(() =>
    this.isMobile() ? 'over' : 'side'
  );

  readonly sidenavOpened = computed(() =>
    this.isMobile() ? this._sidenavOpened() : true
  );

  readonly sidenavExpanded = computed(() =>
    this.isMobile() ? true : this._sidenavExpanded()
  );

  readonly sidenavWidth = computed(() => {
    if (this.isMobile()) return 280;
    return this._sidenavExpanded() ? 280 : 72;
  });

  // --- Centralized menu logic ---
  // Гибридное меню: авторизованные клиенты видят MAIN_MENU + CLIENT_CABINET_MENU
  readonly menuItems = computed<NavItem[]>(() => {
    const user = this.authService.user();
    const profile = this.authService.profile();

    if (!user) return MAIN_MENU;
    if (profile?.role === 'photographer') return PHOTOGRAPHER_DASHBOARD_MENU;
    // Клиенты всегда видят основную навигацию
    return MAIN_MENU;
  });

  readonly secondaryMenuItems = computed<NavItem[]>(() => {
    const user = this.authService.user();
    const profile = this.authService.profile();

    if (!user) return [];

    const extras: NavItem[] = [];

    if (profile?.role === 'admin') {
      extras.push({
        label: 'Админ-панель',
        href: '/admin',
        icon: 'admin_panel_settings_outlined',
        activeIcon: 'admin_panel_settings'
      });
    }

    if (profile?.role === 'employee') {
      extras.push({
        label: 'ФотоПульт',
        href: '/employee',
        icon: 'badge_outlined',
        activeIcon: 'badge'
      });
    }

    return extras;
  });

  /** Раздел «Мой кабинет» для авторизованных клиентов */
  readonly cabinetMenuItems = computed<NavItem[]>(() => {
    const user = this.authService.user();
    const profile = this.authService.profile();

    if (!user) return [];
    if (profile?.role && profile.role !== 'client') return [];

    return CLIENT_CABINET_MENU;
  });

  constructor() {
    // Track breakpoints
    this.breakpointObserver
      .observe([
        '(max-width: 599px)',
        '(min-width: 600px) and (max-width: 839px)',
        '(min-width: 840px) and (max-width: 1199px)',
        '(min-width: 1200px) and (max-width: 1599px)',
        '(min-width: 1600px)'
      ])
      .pipe(takeUntilDestroyed())
      .subscribe(result => {
        const bp = result.breakpoints;
        if (bp['(max-width: 599px)']) {
          this._windowSizeClass.set(WindowSizeClass.Compact);
        } else if (bp['(min-width: 600px) and (max-width: 839px)']) {
          this._windowSizeClass.set(WindowSizeClass.Medium);
        } else if (bp['(min-width: 840px) and (max-width: 1199px)']) {
          this._windowSizeClass.set(WindowSizeClass.Expanded);
        } else if (bp['(min-width: 1200px) and (max-width: 1599px)']) {
          this._windowSizeClass.set(WindowSizeClass.Large);
        } else if (bp['(min-width: 1600px)']) {
          this._windowSizeClass.set(WindowSizeClass.XLarge);
        }

        // Auto-expand sidenav on XLarge, collapse on smaller
        this._sidenavExpanded.set(
          this._windowSizeClass() === WindowSizeClass.XLarge
        );

        // Close mobile sidenav when resizing to desktop
        if (!this.isMobile() && this._sidenavOpened()) {
          this._sidenavOpened.set(false);
        }
      });

    // Track current URL
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(event => {
        this.currentUrl.set(event.urlAfterRedirects);
      });
  }

  // --- Methods ---

  openSidenav(): void {
    this._sidenavOpened.set(true);
  }

  closeSidenav(): void {
    this._sidenavOpened.set(false);
  }

  toggleSidenav(): void {
    this._sidenavOpened.update(v => !v);
  }

  toggleExpanded(): void {
    this._sidenavExpanded.update(v => !v);
  }

  isActive(href: string): boolean {
    const path = this.currentUrl();
    if (href === '/' && path === '/') return true;
    return href !== '/' && path.startsWith(href);
  }
}
