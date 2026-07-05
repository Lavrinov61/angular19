import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  signal,
  computed,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';

import { AuthService } from '../../core/services/auth.service';
import { ProfileDashboardService } from '../../core/services/profile-dashboard.service';
import { SubscriptionService } from '../../core/services/subscription.service';
import { NotificationApiService } from '../../core/services/notification-api.service';

interface MenuItem {
  readonly route: string;
  readonly icon: string;
  readonly label: string;
  readonly highlight?: boolean;
}

@Component({
  selector: 'app-profile-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatRippleModule,
  ],
  template: `
    <div class="profile-menu">

      <!-- ===== HERO SECTION ===== -->
      <section class="hero-card">
        <div class="hero-top">
          <div class="avatar">
            @if (avatarUrl()) {
              <img [src]="avatarUrl()" [alt]="displayName()" class="avatar-img" />
            } @else {
              <span class="avatar-letter">{{ avatarLetter() }}</span>
            }
          </div>
          <div class="hero-info">
            <span class="display-name">{{ displayName() }}</span>
            <span class="email">{{ email() }}</span>
          </div>
        </div>

        @if (loyaltySummary(); as ls) {
          <div class="hero-loyalty">
            <div class="level-row">
              <span class="level-badge">
                <mat-icon class="level-badge-icon">star</mat-icon>
                {{ ls.levelName }}
              </span>
              <span class="xp-label-inline">{{ ls.currentXp }} бонусов</span>
            </div>
            <div class="xp-bar-wrap">
              <div class="xp-bar-track">
                <div class="xp-bar-fill" [style.width.%]="ls.xpProgress"></div>
              </div>
              <div class="xp-bar-labels">
                <span>{{ ls.currentXp }} бонусов</span>
                @if (ls.level < 5) {
                  <span>{{ ls.nextLevelXp }} бонусов</span>
                } @else {
                  <span>MAX</span>
                }
              </div>
            </div>
            <div class="hero-stats-row">
              @if (ls.currentStreak > 0) {
                <span class="streak-info">
                  <mat-icon class="streak-fire">local_fire_department</mat-icon>
                  {{ ls.currentStreak }} {{ streakDaysLabel(ls.currentStreak) }} подряд
                </span>
              }
              <span class="points-info">{{ ls.points }} бонусов</span>
            </div>
          </div>
        }
      </section>

      <!-- ===== MENU ITEMS ===== -->
      <nav class="menu-list">
        @for (item of menuItems; track item.route) {
          <a
            class="menu-item"
            [routerLink]="item.route"
            [class.highlight]="item.highlight && !hasSubscription()"
            matRipple
          >
            <mat-icon class="menu-icon">{{ item.icon }}</mat-icon>
            <div class="menu-label-wrap">
              <span class="menu-label">{{ item.label }}</span>
              @if (item.highlight && !hasSubscription()) {
                <span class="menu-subtitle">Скидки до 30%</span>
              }
            </div>
            @if (item.route === '/user-profile/account' && unreadCount() > 0) {
              <span class="notif-badge">{{ unreadCount() > 99 ? '99+' : unreadCount() }}</span>
            }
            <mat-icon class="menu-chevron">chevron_right</mat-icon>
          </a>
        }
      </nav>

      <!-- ===== LOGOUT ===== -->
      <div class="logout-section">
        <button class="logout-btn" matRipple (click)="logout()">
          <mat-icon class="logout-icon">logout</mat-icon>
          <span>Выйти</span>
        </button>
      </div>

    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .profile-menu {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px 0;
      max-width: 480px;
      margin: 0 auto;
    }

    /* ===== HERO CARD, M3E surface-container ===== */
    .hero-card {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: var(--m3e-corner-xl, 28px);
      padding: 20px;
      margin: 0 16px;
    }

    .hero-top {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
    }

    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
      background: var(--ed-surface-container-high, #333);
    }

    .avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .avatar-letter {
      font-size: 22px;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      text-transform: uppercase;
    }

    .hero-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .display-name {
      font-size: 18px;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .email {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #999);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ===== LOYALTY ===== */
    .hero-loyalty {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .level-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .level-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #451a03;
      color: #fcd34d;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
    }

    .level-badge-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: #fcd34d;
    }

    .xp-label-inline {
      font-size: 12px;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #999);
    }

    .xp-bar-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .xp-bar-track {
      height: 8px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: var(--m3e-corner-full, 9999px);
      overflow: hidden;
    }

    .xp-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #f59e0b, #fbbf24);
      border-radius: var(--m3e-corner-full, 9999px);
      transition: width 0.5s ease;
    }

    .xp-bar-labels {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--ed-on-surface-variant, #999);
    }

    .hero-stats-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .streak-info {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--ed-on-surface-variant, #999);
    }

    .streak-fire {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: #f59e0b;
    }

    .points-info {
      font-size: 14px;
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
    }

    /* ===== MENU LIST ===== */
    .menu-list {
      display: flex;
      flex-direction: column;
      gap: var(--m3e-gap-sm, 8px);
      margin: 0 16px;
    }

    .menu-item {
      display: flex;
      align-items: center;
      height: 56px;
      padding: 0 16px;
      border-radius: var(--m3e-corner-md, 12px);
      background: transparent;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      transition:
        background var(--m3e-effect-fast-duration, 200ms) var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1)),
        transform var(--m3e-spring-fast-duration, 350ms) var(--m3e-spring-fast, cubic-bezier(0.34, 1.56, 0.64, 1));
    }

    .menu-item:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .menu-item:active {
      transform: scale(0.98);
      background: rgba(255, 255, 255, 0.08);
    }

    .menu-item.highlight {
      background: rgba(245, 158, 11, 0.06);
    }

    .menu-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--ed-on-surface-variant, #999);
      margin-right: 16px;
      flex-shrink: 0;
    }

    .menu-label-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .menu-label {
      font-size: 15px;
      font-weight: 500;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .menu-subtitle {
      font-size: 12px;
      color: var(--ed-accent, #f59e0b);
    }

    .notif-badge {
      min-width: 18px;
      height: 18px;
      border-radius: 9px;
      background: #ef4444;
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      margin-right: 4px;
    }

    .menu-chevron {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--ed-on-surface-variant, #999);
      opacity: 0.5;
      flex-shrink: 0;
    }

    /* ===== LOGOUT ===== */
    .logout-section {
      margin: 8px 16px 0;
    }

    .logout-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      width: 100%;
      height: 48px;
      border-radius: var(--m3e-corner-md, 12px);
      border: none;
      background: transparent;
      color: var(--ed-on-surface-variant, #999);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 200ms ease;
    }

    .logout-btn:hover {
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
    }

    .logout-btn:hover .logout-icon {
      color: #ef4444;
    }

    .logout-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--ed-on-surface-variant, #999);
      transition: color 200ms ease;
    }

    /* ===== RESPONSIVE ===== */
    @media (min-width: 600px) {
      .profile-menu {
        max-width: 480px;
        margin: 0 auto;
      }
    }
  `,
})
export class ProfileMenuComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly dashboardService = inject(ProfileDashboardService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly notificationApiService = inject(NotificationApiService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(false);

  readonly menuItems: readonly MenuItem[] = [
    { route: '/user-profile', icon: 'dashboard', label: 'Дашборд' },
    { route: '/user-profile/orders', icon: 'receipt_long', label: 'Заказы' },
    { route: '/user-profile/loyalty', icon: 'stars', label: 'Бонусы и уровни' },
    { route: '/user-profile/subscription', icon: 'card_membership', label: 'Подписка', highlight: true },
    { route: '/user-profile/account', icon: 'manage_accounts', label: 'Аккаунт' },
  ] as const;

  // ---- Computed ----

  readonly displayName = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return 'Пользователь';
    return user.displayName || user.display_name || user.first_name || 'Пользователь';
  });

  readonly email = computed(() => {
    const user = this.authService.currentUser();
    return user?.email ?? '';
  });

  readonly avatarUrl = computed(() => {
    const user = this.authService.currentUser();
    return user?.photoURL || user?.photo_url || null;
  });

  readonly avatarLetter = computed(() => {
    const name = this.displayName();
    return name.charAt(0).toUpperCase();
  });

  readonly loyaltySummary = computed(() => this.dashboardService.loyaltySummary());

  readonly hasSubscription = computed(() => this.subscriptionService.hasActiveSubscription());

  readonly unreadCount = computed(() => this.notificationApiService.unreadCount());

  // ---- Lifecycle ----

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.dashboardService.loadDashboard();
      this.subscriptionService.ensureLoaded();
      this.notificationApiService.getNotifications({ page: 1, limit: 50 }).subscribe();
    }
  }

  // ---- Actions ----

  logout(): void {
    this.authService.logout().subscribe();
  }

  // ---- Helpers ----

  streakDaysLabel(n: number): string {
    if (n % 10 === 1 && n % 100 !== 11) return 'день';
    if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дня';
    return 'дней';
  }
}
