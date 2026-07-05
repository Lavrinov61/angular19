import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Location } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { NavigationService } from '../../../core/services/navigation.service';
import { NotificationApiService } from '../../../core/services/notification-api.service';

const ROUTE_TITLES: ReadonlyMap<string, string> = new Map([
  ['/user-profile', 'Мой профиль'],
  ['/user-profile/bookings', 'Мои записи'],
  ['/user-profile/orders', 'Заказы'],
  ['/user-profile/my-photos', 'Мои фотографии'],
  ['/user-profile/approvals', 'Согласование фото'],
  ['/user-profile/subscription', 'Выгодно'],
  ['/user-profile/loyalty', 'Бонусы'],
  ['/user-profile/account', 'Аккаунт'],
  ['/user-profile/education', 'Проверка статуса'],
  ['/user-profile/photo-permissions', 'Разрешения'],
  ['/user-profile/photo-locations', 'Наши студии'],
]);

@Component({
  selector: 'app-mobile-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatBadgeModule,
    RouterLink,
  ],
  template: `
    <header class="mobile-header">
      <!-- Back button -->
      @if (showBack()) {
        <button class="header-back" (click)="goBack()" aria-label="Назад">
          <mat-icon>arrow_back</mat-icon>
        </button>
      } @else {
        <div class="header-back-spacer"></div>
      }

      <!-- Title -->
      <h1 class="header-title">{{ pageTitle() }}</h1>

      <!-- Notification badge -->
      <a
        class="header-notification"
        routerLink="/user-profile/account"
        aria-label="Уведомления">
        <mat-icon
          [matBadge]="unreadCount()"
          [matBadgeHidden]="unreadCount() === 0"
          matBadgeSize="small"
          matBadgeColor="warn">
          notifications
        </mat-icon>
      </a>
    </header>
  `,
  styles: [`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 998;
    }

    .mobile-header {
      display: flex;
      align-items: center;
      height: 60px;
      padding: 0 8px;
      background: rgba(10, 10, 10, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .header-back {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: none;
      border: none;
      color: var(--ed-on-surface, #f5f5f5);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
    }

    .header-back:active {
      background: rgba(255, 255, 255, 0.08);
    }

    .header-back mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .header-back-spacer {
      width: 44px;
      flex-shrink: 0;
    }

    .header-title {
      flex: 1;
      text-align: center;
      font-size: 16px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 4px;
    }

    .header-notification {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      text-decoration: none;
      color: var(--ed-on-surface-variant, #999);
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
    }

    .header-notification:active {
      background: rgba(255, 255, 255, 0.08);
    }

    .header-notification mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    @media (min-width: 768px) {
      :host {
        display: none;
      }
    }
  `],
})
export class MobileHeaderComponent {
  private readonly navigationService = inject(NavigationService);
  private readonly location = inject(Location);
  private readonly notificationApi = inject(NotificationApiService);

  readonly unreadCount = this.notificationApi.unreadCount;

  private readonly cleanUrl = computed(() => {
    const url = this.navigationService.currentUrl();
    return url.split('?')[0].split('#')[0];
  });

  readonly pageTitle = computed(() => {
    const url = this.cleanUrl();

    // Exact match first
    const exact = ROUTE_TITLES.get(url);
    if (exact) return exact;

    // Dynamic routes: check if URL starts with a known prefix
    if (url.startsWith('/user-profile/photo-approval/')) return 'Подтверждение фото';
    if (url.startsWith('/user-profile/photo-selector/')) return 'Выбор фотографий';
    if (url.startsWith('/user-profile/payment/')) return 'Оплата';
    if (url.startsWith('/user-profile/photo-locations/')) return 'Детали локации';

    return 'Мой профиль';
  });

  readonly showBack = computed(() => this.cleanUrl() !== '/user-profile');

  goBack(): void {
    this.location.back();
  }
}
