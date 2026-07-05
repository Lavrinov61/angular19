import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  computed,
  ElementRef,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { AuthService } from '../../services/auth.service';
import { AuthChatService } from '../../services/auth-chat.service';
import { NotificationApiService } from '../../services/notification-api.service';
import { CartService } from '../../../features/chat-page/services/cart.service';

@Component({
  selector: 'app-unified-app-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatBadgeModule,
    RouterLink,
  ],
  host: {
    'role': 'banner',
    '[attr.aria-label]': '"Панель приложения"',
  },
  template: `
    @switch (mode()) {
      @case ('primary') {
        <header class="app-bar primary">
          <!-- Hamburger -->
          <button
            class="icon-btn"
            (click)="onMenuClick()"
            aria-label="Открыть меню">
            <mat-icon>menu</mat-icon>
          </button>

          <!-- Search Pill -->
          @if (showSearch()) {
            <div
              class="search-pill"
              [class.focused]="searchFocused()"
              role="search"
              aria-label="Поиск"
              (click)="focusSearch()"
              (keydown.enter)="focusSearch()">
              <mat-icon class="search-icon">search</mat-icon>
              <input
                #searchInput
                class="search-input"
                type="text"
                placeholder="Поиск услуг..."
                [value]="searchValue()"
                (input)="onSearchInput($event)"
                (focus)="searchFocused.set(true)"
                (blur)="searchFocused.set(false)"
                aria-label="Поиск услуг" />
            </div>
          }

          <!-- Avatar / Login -->
          @if (authService.isAuthenticated()) {
            <a class="avatar-btn" routerLink="/profile" aria-label="Профиль">
              <span class="avatar-circle">{{ userInitial() }}</span>
            </a>
          } @else {
            <a class="icon-btn" routerLink="/auth/login" aria-label="Войти">
              <mat-icon>person</mat-icon>
            </a>
          }
        </header>

        <!-- Status indicator -->
        @if (chatService.isConnected()) {
          <div class="status-bar">
            <span class="status-dot"></span>
            <span class="status-text">Онлайн</span>
          </div>
        }
      }

      @case ('sub-page') {
        <header class="app-bar sub-page">
          <!-- Back button -->
          <button
            class="icon-btn"
            (click)="onBackClick()"
            aria-label="Назад">
            <mat-icon>arrow_back</mat-icon>
          </button>

          <!-- Title -->
          <h1 class="page-title">{{ title() }}</h1>

          <!-- Action icons -->
          <div class="action-icons">
            @if (showNotifications()) {
              <a
                class="icon-btn"
                routerLink="/profile/notifications"
                aria-label="Уведомления">
                @if (unreadCount() > 0) {
                  <span class="badge-wrapper">
                    <mat-icon>notifications</mat-icon>
                    <span class="badge">{{ badgeText(unreadCount()) }}</span>
                  </span>
                } @else {
                  <mat-icon>notifications_none</mat-icon>
                }
              </a>
            }

            @if (showCart()) {
              <button
                class="icon-btn"
                (click)="cartService.open()"
                aria-label="Корзина">
                @if (cartCount() > 0) {
                  <span class="badge-wrapper">
                    <mat-icon>shopping_cart</mat-icon>
                    <span class="badge">{{ badgeText(cartCount()) }}</span>
                  </span>
                } @else {
                  <mat-icon>shopping_cart_outlined</mat-icon>
                }
              </button>
            }
          </div>
        </header>
      }
    }
  `,
  styles: [`
    :host {
      display: block;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 100;
      padding-top: env(safe-area-inset-top);

      @media (min-width: 600px) {
        display: none;
      }
    }

    /* ── Shared App Bar ── */
    .app-bar {
      display: flex;
      align-items: center;
      height: 56px;
      padding: 0 16px;
      background: rgba(10, 10, 10, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      gap: 8px;
    }

    /* ── Icon button (48x48 touch target) ── */
    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      min-width: 48px;
      border-radius: var(--m3e-corner-md, 12px);
      background: none;
      border: none;
      color: var(--ed-on-surface, #f5f5f5);
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      text-decoration: none;
      flex-shrink: 0;
      transition: background 0.15s;
    }

    .icon-btn:active {
      background: rgba(255, 255, 255, 0.08);
    }

    .icon-btn mat-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    /* ── Search Pill (Primary mode) ── */
    .search-pill {
      display: flex;
      align-items: center;
      flex: 1;
      min-width: 0;
      height: 40px;
      padding: 0 16px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: var(--m3e-corner-full, 9999px);
      border: 1px solid transparent;
      gap: 12px;
      cursor: text;
      transition: border-color 0.2s, background 0.2s;
    }

    .search-pill.focused {
      border-color: var(--ed-accent, #f59e0b);
      background: rgba(255, 255, 255, 0.12);
    }

    .search-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      color: var(--ed-on-surface-variant, #999);
      flex-shrink: 0;
    }

    .search-input {
      flex: 1;
      height: 100%;
      background: none;
      border: none;
      outline: none;
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 14px;
      font-family: inherit;
      min-width: 0;
    }

    .search-input::placeholder {
      color: var(--ed-on-surface-variant, #999);
    }

    /* ── Avatar Circle ── */
    .avatar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      min-width: 48px;
      flex-shrink: 0;
      text-decoration: none;
      -webkit-tap-highlight-color: transparent;
    }

    .avatar-circle {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--m3e-corner-full, 9999px);
      background: var(--ed-accent, #f59e0b);
      color: #000;
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      line-height: 1;
    }

    /* ── Status Bar (below primary header) ── */
    .status-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 16px 6px;
      background: rgba(10, 10, 10, 0.85);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: var(--m3e-corner-full, 9999px);
      background: #22c55e;
      flex-shrink: 0;
    }

    .status-text {
      font-size: 11px;
      color: var(--ed-on-surface-variant, #999);
      line-height: 1;
    }

    /* ── Sub-page Title ── */
    .page-title {
      flex: 1;
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      padding: 0 4px;
    }

    /* ── Action Icons (sub-page right side) ── */
    .action-icons {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    /* ── Badge ── */
    .badge-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .badge {
      position: absolute;
      top: -4px;
      right: -6px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 8px;
      background: #ef4444;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
      pointer-events: none;
    }
  `],
})
export class UnifiedAppBarComponent {
  // ── Inputs ──
  readonly mode = input<'primary' | 'sub-page'>('primary');
  readonly title = input('');
  readonly showSearch = input(true);
  readonly showCart = input(true);
  readonly showNotifications = input(true);

  // ── Outputs ──
  readonly menuClick = output<void>();
  readonly searchQuery = output<string>();
  readonly backClick = output<void>();

  // ── Services ──
  readonly authService = inject(AuthService);
  readonly chatService = inject(AuthChatService);
  readonly cartService = inject(CartService);
  private readonly notificationApi = inject(NotificationApiService);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  // ── Internal state ──
  readonly searchFocused = signal(false);
  readonly searchValue = signal('');
  private readonly searchInputRef = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  // ── Computed ──
  readonly unreadCount = this.notificationApi.unreadCount;
  readonly cartCount = this.cartService.itemCount;

  readonly userInitial = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return '';

    const name = user.display_name
      || user.displayName
      || user.first_name
      || user.email
      || '';

    return name.charAt(0).toUpperCase();
  });

  // ── Methods ──
  onMenuClick(): void {
    this.menuClick.emit();
  }

  onBackClick(): void {
    this.backClick.emit();
    this.navigateBack();
  }

  private navigateBack(): void {
    const url = this.router.url;
    if (url.startsWith('/orders/')) {
      this.router.navigate(['/orders']);
    } else if (url.startsWith('/photos/')) {
      this.router.navigate(['/photos']);
    } else if (url.startsWith('/profile/')) {
      this.router.navigate(['/profile']);
    } else {
      this.location.back();
    }
  }

  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchValue.set(value);
    this.searchQuery.emit(value);
  }

  focusSearch(): void {
    const el = this.searchInputRef()?.nativeElement;
    if (el) {
      el.focus();
    }
  }

  badgeText(count: number): string {
    return count > 99 ? '99+' : String(count);
  }
}
