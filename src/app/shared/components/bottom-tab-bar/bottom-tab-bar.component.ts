import {
  Component,
  ChangeDetectionStrategy,
  inject,
  TemplateRef,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { AuthService } from '../../../core/services/auth.service';

interface TabItem {
  readonly label: string;
  readonly icon: string;
  readonly route: string;
}

@Component({
  selector: 'app-bottom-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    MatRippleModule,
    MatBottomSheetModule,
  ],
  template: `
    <nav class="tab-bar" aria-label="Навигация личного кабинета">
      @for (tab of tabs; track tab.route) {
        <a
          class="tab-item"
          [routerLink]="tab.route"
          routerLinkActive="active"
          [routerLinkActiveOptions]="{ exact: tab.route === '/user-profile' }"
          matRipple
          [matRippleCentered]="true"
          [matRippleRadius]="24"
          [attr.aria-label]="tab.label">
          <mat-icon class="tab-icon">{{ tab.icon }}</mat-icon>
          <span class="tab-label">{{ tab.label }}</span>
        </a>
      }

      <!-- "Ещё" tab -->
      <button
        class="tab-item"
        (click)="openMore()"
        matRipple
        [matRippleCentered]="true"
        [matRippleRadius]="24"
        aria-label="Ещё">
        <mat-icon class="tab-icon">more_horiz</mat-icon>
        <span class="tab-label">Ещё</span>
      </button>
    </nav>

    <!-- Bottom sheet template -->
    <ng-template #moreSheet>
      <div class="more-sheet">
        <div class="more-sheet-header">
          <span class="more-sheet-title">Ещё</span>
        </div>
        <nav class="more-sheet-nav">
          @for (item of moreItems; track item.route) {
            <a
              class="more-sheet-item"
              [routerLink]="item.route"
              (click)="closeSheet()"
              matRipple>
              <mat-icon>{{ item.icon }}</mat-icon>
              <span>{{ item.label }}</span>
            </a>
          }
          <div class="more-sheet-divider"></div>
          <a
            class="more-sheet-item"
            routerLink="/"
            (click)="closeSheet()"
            matRipple>
            <mat-icon>arrow_back</mat-icon>
            <span>На сайт</span>
          </a>
          <button
            class="more-sheet-item more-sheet-logout"
            (click)="logout()"
            matRipple>
            <mat-icon>logout</mat-icon>
            <span>Выйти</span>
          </button>
        </nav>
      </div>
    </ng-template>
  `,
  styles: [`
    :host {
      display: block;
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 1000;
    }

    .tab-bar {
      display: flex;
      justify-content: space-around;
      align-items: center;
      height: 64px;
      background: rgba(10, 10, 10, 0.78);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding-bottom: env(safe-area-inset-bottom, 0px);
    }

    .tab-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      height: 100%;
      min-width: 0;
      max-width: 96px;
      padding: 6px 4px;
      background: none;
      border: none;
      cursor: pointer;
      font: inherit;
      text-decoration: none;
      color: var(--ed-on-surface-muted, #666);
      -webkit-tap-highlight-color: transparent;
      transition: color 200ms cubic-bezier(0.16, 1, 0.3, 1);
      border-radius: 12px;
      min-height: 44px;
    }

    .tab-item:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .tab-item.active {
      color: var(--ed-accent, #f59e0b);
    }

    .tab-icon {
      font-size: 24px;
      width: 24px;
      height: 24px;
      margin-bottom: 2px;
    }

    .tab-label {
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.02em;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      width: 100%;
      max-width: 72px;
    }

    /* ─── Bottom Sheet ─── */
    .more-sheet {
      padding: 8px 0 env(safe-area-inset-bottom, 8px);
    }

    .more-sheet-header {
      padding: 12px 20px 8px;
    }

    .more-sheet-title {
      font-size: 16px;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .more-sheet-nav {
      display: flex;
      flex-direction: column;
    }

    .more-sheet-item {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 20px;
      background: none;
      border: none;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      color: var(--ed-on-surface, #f5f5f5);
      text-decoration: none;
      min-height: 48px;
      -webkit-tap-highlight-color: transparent;
      width: 100%;
      text-align: left;
    }

    .more-sheet-item mat-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
      color: var(--ed-on-surface-variant, #999);
      flex-shrink: 0;
    }

    .more-sheet-divider {
      height: 1px;
      background: var(--ed-outline-variant, #2a2a2a);
      margin: 4px 16px;
    }

    .more-sheet-logout {
      color: #ef4444;
    }

    .more-sheet-logout mat-icon {
      color: #ef4444;
    }

    @media (min-width: 768px) {
      :host {
        display: none;
      }
    }
  `],
})
export class BottomTabBarComponent {
  private readonly bottomSheet = inject(MatBottomSheet);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly moreSheetRef = viewChild.required<TemplateRef<unknown>>('moreSheet');

  readonly tabs: readonly TabItem[] = [
    { label: 'Заказы', icon: 'receipt_long', route: '/user-profile/orders' },
    { label: 'Записи', icon: 'event', route: '/user-profile/bookings' },
    { label: 'Фото', icon: 'photo_library', route: '/user-profile/my-photos' },
    { label: 'Скидки', icon: 'percent', route: '/user-profile/subscription' },
  ];

  readonly moreItems: readonly TabItem[] = [
    { label: 'Дашборд', icon: 'dashboard', route: '/user-profile' },
    { label: 'Согласование', icon: 'compare', route: '/user-profile/approvals' },
    { label: 'Бонусы и уровни', icon: 'stars', route: '/user-profile/loyalty' },
    { label: 'Аккаунт', icon: 'manage_accounts', route: '/user-profile/account' },
    { label: 'Онлайн-кабинет', icon: 'chat_bubble', route: '/chat' },
  ];

  openMore(): void {
    this.bottomSheet.open(this.moreSheetRef(), {
      panelClass: 'more-bottom-sheet',
    });
  }

  closeSheet(): void {
    this.bottomSheet.dismiss();
  }

  logout(): void {
    this.bottomSheet.dismiss();
    this.authService.logout().subscribe({
      complete: () => this.router.navigate(['/']),
      error: () => this.router.navigate(['/']),
    });
  }
}
