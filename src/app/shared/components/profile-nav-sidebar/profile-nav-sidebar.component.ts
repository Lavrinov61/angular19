import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AuthService } from '../../../core/services/auth.service';
import { ProfileDashboardService } from '../../../core/services/profile-dashboard.service';
import { SubscriptionService } from '../../../core/services/subscription.service';

interface SidebarLink {
  route: string;
  icon: string;
  label: string;
  exact?: boolean;
  badge?: 'new' | 'dot';
}

interface SidebarGroup {
  links: SidebarLink[];
  label?: string;
}

@Component({
  selector: 'app-profile-nav-sidebar',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatButtonModule,
    MatProgressBarModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="sidebar-brand" routerLink="/user-profile" aria-label="На главную личного кабинета">
      <span class="brand-mark">
        <span class="brand-mark__logo">СФ</span>
        <mat-icon class="brand-mark__home">home</mat-icon>
      </span>
      <strong>Своё Фото</strong>
    </a>

    <div class="sidebar-user">
      <span class="avatar">
        @if (avatarUrl()) {
          <img [src]="avatarUrl()" [alt]="displayName()" />
        } @else {
          <mat-icon>person</mat-icon>
        }
      </span>
      <span class="user-text">
        <strong>{{ displayName() }}</strong>
        <small>{{ userEmail() }}</small>
      </span>
    </div>

    @if (levelInfo()) {
      <div class="level-card">
        <div class="level-card__top">
          <span>{{ levelInfo()!.levelName }}</span>
          <strong>{{ levelInfo()!.points }} Б</strong>
        </div>
        <mat-progress-bar mode="determinate" [value]="levelInfo()!.xpProgress" />
      </div>
    }

    <nav class="sidebar-nav" aria-label="Навигация кабинета">
      @for (group of groups; track group.label || $index) {
        @if (group.label) {
          <div class="group-label">{{ group.label }}</div>
        }
        @for (link of group.links; track link.route) {
          <a
            class="nav-link"
            [routerLink]="link.route"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: link.exact ?? false }"
          >
            <mat-icon>{{ link.icon }}</mat-icon>
            <span>{{ link.label }}</span>
            @if (link.badge === 'new' && !hasActiveSubscription()) {
              <em>NEW</em>
            }
            @if (link.badge === 'dot' && levelInfo()?.canClaimDaily) {
              <i matTooltip="Доступна ежедневная награда"></i>
            }
          </a>
        }
      }
    </nav>

    <div class="sidebar-footer">
      <a routerLink="/user-profile/account" class="footer-link">
        <mat-icon>settings</mat-icon>
        <span>Настройки профиля</span>
      </a>
      <button mat-button type="button" class="logout-button" (click)="logout()">
        <mat-icon>logout</mat-icon>
        <span>Выйти</span>
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      color-scheme: light;
      --side-bg: #f7f8fa;
      --side-text: #20242a;
      --side-muted: #737985;
      --side-line: #dfe3e8;
      --side-soft: #eceff3;
      --side-red: #ef3124;
      --side-brand: #ef3124;
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 76px;
      padding: 18px 16px 12px;
      color: var(--side-text);
      text-decoration: none;
      transition: background-color 0.16s ease;
    }

    .sidebar-brand:hover,
    .sidebar-brand:focus-visible {
      background: #eceff3;
      outline: none;
    }

    .brand-mark {
      position: relative;
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 8px;
      background: #20242a;
      color: var(--side-brand);
      font-weight: 900;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
      transition:
        background-color 0.16s ease,
        color 0.16s ease,
        box-shadow 0.16s ease;
    }

    .brand-mark__logo,
    .brand-mark__home {
      grid-area: 1 / 1;
      transition:
        opacity 0.16s ease,
        transform 0.16s ease;
    }

    .brand-mark__home {
      width: 24px;
      height: 24px;
      font-size: 24px;
      color: #ffffff;
      opacity: 0;
      transform: scale(0.7);
    }

    .sidebar-brand:hover .brand-mark,
    .sidebar-brand:focus-visible .brand-mark {
      background: var(--side-brand);
      color: #ffffff;
      box-shadow: 0 12px 28px rgba(239, 49, 36, 0.22);
    }

    .sidebar-brand:hover .brand-mark__logo,
    .sidebar-brand:focus-visible .brand-mark__logo {
      opacity: 0;
      transform: scale(0.7);
    }

    .sidebar-brand:hover .brand-mark__home,
    .sidebar-brand:focus-visible .brand-mark__home {
      opacity: 1;
      transform: scale(1);
    }

    .sidebar-brand strong {
      overflow: hidden;
      font-size: 17px;
      font-weight: 900;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sidebar-user {
      display: grid;
      grid-template-columns: 42px 1fr;
      gap: 10px;
      align-items: center;
      padding: 10px 16px 16px;
      border-bottom: 1px solid var(--side-line);
    }

    .avatar {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border-radius: 8px;
      overflow: hidden;
      background: #ffffff;
      color: var(--side-text);
    }

    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .user-text {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .user-text strong,
    .user-text small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .user-text strong {
      color: var(--side-text);
      font-size: 14px;
      font-weight: 800;
    }

    .user-text small {
      color: var(--side-muted);
      font-size: 12px;
    }

    .level-card {
      display: grid;
      gap: 8px;
      margin: 12px;
      padding: 12px;
      border: 1px solid #ffd2c9;
      border-radius: 8px;
      background: #fff0ed;
    }

    .level-card__top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      color: var(--side-text);
      font-size: 12px;
      font-weight: 800;
    }

    :host ::ng-deep .level-card .mdc-linear-progress__bar-inner {
      border-color: var(--side-red) !important;
    }

    .sidebar-nav {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 10px 4px 14px;
    }

    .group-label {
      padding: 18px 18px 7px;
      color: var(--side-muted);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
    }

    .nav-link {
      position: relative;
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 10px;
      align-items: center;
      min-height: 46px;
      margin: 0 4px;
      padding: 0 12px;
      border-radius: 8px;
      color: var(--side-text);
      font-size: 14px;
      font-weight: 800;
      text-decoration: none;
      transition:
        background-color 0.16s ease,
        color 0.16s ease;
    }

    .nav-link span,
    .footer-link span,
    .logout-button span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .nav-link mat-icon {
      color: #747a84;
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .nav-link:hover,
    .nav-link.active {
      background: #e8eaee;
    }

    .nav-link:focus-visible,
    .footer-link:focus-visible,
    .logout-button:focus-visible {
      outline: 2px solid var(--side-red);
      outline-offset: 2px;
    }

    .nav-link.active::before {
      position: absolute;
      left: -4px;
      width: 4px;
      height: 26px;
      border-radius: 0 4px 4px 0;
      background: var(--side-red);
      content: "";
    }

    .nav-link.active mat-icon {
      color: var(--side-red);
    }

    .nav-link em {
      padding: 3px 6px;
      border-radius: 6px;
      background: #fff0ed;
      color: var(--side-red);
      font-size: 10px;
      font-style: normal;
      font-weight: 900;
    }

    .nav-link i {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--side-red);
    }

    .sidebar-footer {
      display: grid;
      gap: 6px;
      padding: 12px;
      border-top: 1px solid var(--side-line);
    }

    .footer-link,
    .logout-button {
      display: grid;
      grid-template-columns: 28px 1fr;
      gap: 10px;
      align-items: center;
      min-height: 42px;
      padding: 0 10px;
      border-radius: 8px;
      color: var(--side-muted);
      font-size: 14px;
      font-weight: 800;
      text-align: left;
      text-decoration: none;
      transition:
        background-color 0.16s ease,
        color 0.16s ease;
    }

    .logout-button {
      border: 0;
      background: transparent;
      font: inherit;
      cursor: pointer;
    }

    .footer-link:hover,
    .logout-button:hover {
      background: var(--side-soft);
      color: var(--side-text);
    }

    @media (prefers-reduced-motion: reduce) {
      .nav-link,
      .sidebar-brand,
      .brand-mark,
      .brand-mark__logo,
      .brand-mark__home,
      .footer-link,
      .logout-button {
        transition: none;
      }
    }
  `],
})
export class ProfileNavSidebarComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly dashboardService = inject(ProfileDashboardService);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly user = this.authService.user;
  protected readonly hasActiveSubscription = this.subscriptionService.hasActiveSubscription;
  protected readonly loyaltySummary = this.dashboardService.loyaltySummary;

  protected readonly displayName = computed(
    () => this.user()?.displayName || this.user()?.display_name || 'Пользователь',
  );
  protected readonly avatarUrl = computed(() => this.user()?.photoURL || this.user()?.photo_url || null);
  protected readonly userEmail = computed(() => this.user()?.email || '');
  protected readonly levelInfo = computed(() => this.loyaltySummary());

  protected readonly groups: SidebarGroup[] = [
    {
      links: [
        { route: '/user-profile/services', icon: 'apps', label: 'Все услуги' },
        { route: '/user-profile/subscription', icon: 'percent', label: 'Выгодно', badge: 'new' },
        { route: '/user-profile/photo-locations', icon: 'storefront', label: 'Наши студии' },
        { route: '/chat', icon: 'chat_bubble', label: 'Чат с менеджером' },
      ],
    },
    {
      links: [
        { route: '/services', icon: 'add', label: 'Новый заказ' },
        { route: '/user-profile/orders', icon: 'receipt_long', label: 'История заказов' },
        { route: '/user-profile/bookings', icon: 'event_available', label: 'Записи на съёмку' },
        { route: '/user-profile/approvals', icon: 'fact_check', label: 'Выбор фото' },
        { route: '/user-profile/my-photos', icon: 'photo_library', label: 'Мои фотографии' },
      ],
    },
    {
      label: 'Аккаунт',
      links: [
        { route: '/user-profile/account', icon: 'manage_accounts', label: 'Профиль' },
      ],
    },
  ];

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.subscriptionService.ensureLoaded();
      this.dashboardService.loadDashboard();
    }
  }

  protected logout(): void {
    this.authService.logout().subscribe({
      complete: () => this.router.navigate(['/']),
      error: () => this.router.navigate(['/']),
    });
  }
}
