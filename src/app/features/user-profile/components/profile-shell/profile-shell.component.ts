import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { AuthService } from '../../../../core/services/auth.service';
import { NotificationMessage, NotificationService } from '../../../../core/services/notification.service';
import { ChatWidgetComponent } from '../../../../shared/components/chat-widget/chat-widget.component';
import { ProfileNavSidebarComponent } from '../../../../shared/components/profile-nav-sidebar/profile-nav-sidebar.component';

@Component({
  selector: 'app-profile-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatIconModule,
    ProfileNavSidebarComponent,
    ChatWidgetComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="profile-shell">
      <aside class="desktop-sidebar">
        <app-profile-nav-sidebar />
      </aside>

      <div class="workspace">
        <header class="topbar">
          <button class="topbar-icon" type="button" aria-label="Поиск" (click)="openSearch()">
            <mat-icon>search</mat-icon>
          </button>

          <nav class="topbar-nav" aria-label="Верхнее меню">
            <a routerLink="/user-profile" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
              <mat-icon>explore</mat-icon>
              С чего начать
            </a>
            <a routerLink="/user-profile/orders" routerLinkActive="active">
              <mat-icon>receipt_long</mat-icon>
              Заказы
            </a>
          </nav>

          <button class="topbar-icon topbar-icon--badge" type="button" aria-label="Уведомления" (click)="openNotifications()">
            <mat-icon>notifications</mat-icon>
            @if (headerNotificationCount() > 0) {
              <span>{{ headerNotificationCount() }}</span>
            }
          </button>

          <button class="profile-button" type="button" (click)="openProfilePanel()">
            <span class="profile-avatar">
              @if (avatarUrl()) {
                <img [src]="avatarUrl()" [alt]="displayName()" />
              } @else {
                <mat-icon>person</mat-icon>
              }
            </span>
            <span class="profile-button__text">
              <strong>{{ displayName() }}</strong>
              <small>Личный кабинет</small>
            </span>
            <mat-icon>expand_more</mat-icon>
          </button>
        </header>

        <main class="profile-content">
          <router-outlet />
        </main>
      </div>

      @if (hasOpenOverlay()) {
        <button class="shell-backdrop" type="button" aria-label="Закрыть" (click)="closeOverlays()"></button>
      }

      @if (notificationsOpen()) {
        <aside class="shell-drawer shell-drawer--notifications" role="dialog" aria-modal="true" aria-label="Центр уведомлений">
          <div class="drawer-header">
            <h2>Центр уведомлений</h2>
            <span class="drawer-spacer"></span>
            <button class="drawer-icon" type="button" aria-label="Настройки уведомлений" routerLink="/user-profile/account" (click)="closeOverlays()">
              <mat-icon>settings</mat-icon>
            </button>
            <button class="drawer-icon drawer-icon--close" type="button" aria-label="Закрыть" (click)="closeOverlays()">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <div class="notifications-list">
            @if (notificationGroups().length > 0) {
              @for (group of notificationGroups(); track group.label) {
                <section class="notification-group">
                  <h3>{{ group.label }}</h3>
                  @for (notification of group.items; track notification.id) {
                    <button
                      type="button"
                      class="notification-card"
                      [class.notification-card--unread]="!notification.read"
                      (click)="handleNotification(notification)"
                    >
                      <span class="notification-card__icon">
                        <mat-icon>{{ notificationIcon(notification.type) }}</mat-icon>
                      </span>
                      <span class="notification-card__body">
                        <strong>{{ notification.title }}</strong>
                        <small>{{ notification.body }}</small>
                        @if (notification.data?.actionUrl || notification.data?.url) {
                          <em>Открыть</em>
                        }
                      </span>
                      <time>{{ formatNotificationTime(notification.timestamp || notification.createdAt) }}</time>
                    </button>
                  }
                </section>
              }
              <button type="button" class="read-all-button" (click)="markAllNotificationsRead()">Прочитать все</button>
            } @else {
              <div class="empty-drawer-state">
                <span><mat-icon>notifications_none</mat-icon></span>
                <strong>Нет новых уведомлений</strong>
                <small>Когда появятся новости по заказам, записям или фото, они будут здесь.</small>
              </div>
            }
          </div>
        </aside>
      }

      @if (profilePanelOpen()) {
        <aside class="shell-drawer shell-drawer--profile" role="dialog" aria-modal="true" aria-label="Профиль">
          <div class="drawer-header">
            <h2>{{ displayName() }}</h2>
            <span class="drawer-spacer"></span>
            <button class="drawer-icon drawer-icon--close" type="button" aria-label="Закрыть" (click)="closeOverlays()">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <section class="profile-panel-card profile-panel-card--hero">
            <span class="profile-panel-avatar">
              @if (avatarUrl()) {
                <img [src]="avatarUrl()" [alt]="displayName()" />
              } @else {
                <mat-icon>person</mat-icon>
              }
            </span>
            <div>
              <small>Аккаунт</small>
              <strong>{{ displayName() }}</strong>
              <p>{{ userEmail() || 'Email не указан' }}</p>
            </div>
          </section>

          <section class="profile-panel-card">
            <div class="profile-company">
              <span>
                <small>Профиль</small>
                <strong>{{ userRoleLabel() }}</strong>
              </span>
              <span class="profile-company__icon"><mat-icon>business_center</mat-icon></span>
            </div>
            <p>ID {{ user()?.id || 'не указан' }}</p>
            <p>Телефон {{ userPhone() || 'не указан' }}</p>
            <a routerLink="/user-profile/account" (click)="closeOverlays()">
              <span>
                Профиль
                <small>Личные данные, контакты, настройки</small>
              </span>
              <mat-icon>chevron_right</mat-icon>
            </a>
            <a routerLink="/user-profile/subscription" (click)="closeOverlays()">
              <span>
                Выгодно
                <small>Бонусы, доступы и пакеты печати</small>
              </span>
              <mat-icon>chevron_right</mat-icon>
            </a>
          </section>

          <a class="profile-panel-link" routerLink="/user-profile/services" (click)="closeOverlays()">
            <span>Приложение и сервисы</span>
            <mat-icon>open_in_new</mat-icon>
          </a>

          <button type="button" class="profile-panel-logout" (click)="logout()">
            <mat-icon>logout</mat-icon>
            Выйти
          </button>
        </aside>
      }

      @if (searchOpen()) {
        <section class="search-modal" role="dialog" aria-modal="true" aria-label="Поиск по личному кабинету">
          <button class="search-close" type="button" aria-label="Закрыть поиск" (click)="closeOverlays()">
            <mat-icon>close</mat-icon>
          </button>

          <div class="search-modal__inner">
            <form class="cabinet-search" (submit)="submitSearch($event)">
              <label>
                <mat-icon>search</mat-icon>
                <input
                  type="search"
                  [value]="searchQuery()"
                  (input)="updateSearchQuery($event)"
                  placeholder="Что будем искать?"
                  autocomplete="off"
                />
              </label>
              <button type="submit">Найти</button>
            </form>

            <div class="search-chips" aria-label="Быстрые запросы">
              @for (chip of searchChips; track chip) {
                <button type="button" (click)="useSearchChip(chip)">{{ chip }}</button>
              }
            </div>

            <section class="neuro-help">
              <h2>Спросите Нейропомощника</h2>
              <div>
                @for (prompt of searchPrompts; track prompt) {
                  <button type="button" (click)="useSearchChip(prompt)">
                    <span><mat-icon>auto_awesome</mat-icon></span>
                    {{ prompt }}
                  </button>
                }
              </div>
            </section>
          </div>
        </section>
      }

    </div>

    @if (showChat()) {
      <app-chat-widget channel="studio" />
    }
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      color-scheme: light;
      --shell-bg: #f1f2f4;
      --shell-card: #ffffff;
      --shell-text: #20242a;
      --shell-muted: #737985;
      --shell-line: #dfe3e8;
      --shell-red: #ef3124;
    }

    .profile-shell {
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      min-height: 100vh;
      background: var(--shell-bg);
      color: var(--shell-text);
      font-family: Inter, "Plus Jakarta Sans", system-ui, sans-serif;
    }

    .desktop-sidebar {
      position: sticky;
      top: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: #f7f8fa;
      border-right: 1px solid var(--shell-line);
    }

    .workspace {
      min-width: 0;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 40;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      height: 72px;
      padding: 0 28px;
      background: rgba(247, 248, 250, 0.95);
      border-bottom: 1px solid var(--shell-line);
      backdrop-filter: blur(12px);
    }

    .topbar-icon,
    .profile-button,
    .topbar-nav a {
      border: 0;
      border-radius: 8px;
      color: var(--shell-text);
      font: inherit;
      transition:
        background-color 0.16s ease,
        color 0.16s ease,
        box-shadow 0.16s ease;
    }

    .topbar-icon {
      position: relative;
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      background: transparent;
      cursor: pointer;
    }

    .topbar-icon mat-icon {
      color: #7b828e;
    }

    .topbar-icon:hover,
    .topbar-icon:focus-visible {
      background: #eceff3;
    }

    .topbar-icon:focus-visible,
    .profile-button:focus-visible,
    .topbar-nav a:focus-visible {
      outline: 2px solid var(--shell-red);
      outline-offset: 2px;
    }

    .topbar-icon--badge span {
      position: absolute;
      top: 4px;
      right: 4px;
      display: grid;
      min-width: 18px;
      height: 18px;
      place-items: center;
      border-radius: 50%;
      background: var(--shell-red);
      color: #ffffff;
      font-size: 11px;
      font-weight: 800;
    }

    .topbar-nav {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 0 12px;
      border-inline: 1px solid var(--shell-line);
    }

    .topbar-nav a {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 42px;
      padding: 0 14px;
      color: var(--shell-muted);
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
    }

    .topbar-nav a.active,
    .topbar-nav a:hover {
      background: #eceff3;
      color: var(--shell-text);
    }

    .topbar-nav mat-icon {
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .profile-button {
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) 20px;
      gap: 10px;
      align-items: center;
      min-width: 256px;
      max-width: 360px;
      min-height: 50px;
      padding: 4px 10px 4px 4px;
      background: transparent;
      cursor: pointer;
      text-align: left;
    }

    .profile-button:hover {
      background: #eceff3;
    }

    .profile-avatar {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border-radius: 8px;
      overflow: hidden;
      background: #ffd093;
      color: var(--shell-text);
    }

    .profile-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .profile-button__text {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .profile-button__text strong,
    .profile-button__text small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .profile-button__text strong {
      color: var(--shell-text);
      font-size: 14px;
      font-weight: 800;
    }

    .profile-button__text small {
      color: var(--shell-muted);
      font-size: 12px;
    }

    .profile-content {
      min-width: 0;
      background: var(--shell-bg);
    }

    .shell-backdrop {
      position: fixed;
      inset: 0;
      z-index: 120;
      border: 0;
      background: rgba(0, 0, 0, 0.62);
      cursor: default;
    }

    .shell-drawer {
      position: fixed;
      top: 12px;
      right: 12px;
      bottom: 12px;
      z-index: 140;
      width: min(500px, calc(100vw - 24px));
      overflow-y: auto;
      border-radius: 22px;
      background: #ffffff;
      box-shadow: 0 22px 70px rgba(15, 23, 42, 0.26);
      color: var(--shell-text);
    }

    .shell-drawer--notifications {
      width: min(492px, calc(100vw - 24px));
      padding: 28px 32px 28px;
      background: #f1f2f4;
    }

    .shell-drawer--profile {
      padding: 28px 32px;
    }

    .drawer-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }

    .drawer-header h2 {
      margin: 0;
      color: var(--shell-text);
      font-size: clamp(22px, 2.1vw, 30px);
      font-weight: 900;
      letter-spacing: 0;
    }

    .drawer-spacer {
      flex: 1;
    }

    .drawer-icon {
      display: grid;
      width: 48px;
      height: 48px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--shell-text);
      cursor: pointer;
      text-decoration: none;
    }

    .drawer-icon:hover,
    .drawer-icon:focus-visible {
      background: #e5e7eb;
    }

    .drawer-icon--close {
      background: #f4f5f7;
    }

    .notifications-list {
      display: grid;
      gap: 22px;
    }

    .notification-group {
      display: grid;
      gap: 12px;
    }

    .notification-group h3 {
      margin: 0;
      color: #40444c;
      font-size: 16px;
      font-weight: 900;
    }

    .notification-card {
      display: grid;
      grid-template-columns: 44px minmax(0, 1fr) auto;
      gap: 14px;
      align-items: start;
      width: 100%;
      min-height: 108px;
      padding: 20px;
      border: 0;
      border-radius: 14px;
      background: #ffffff;
      color: var(--shell-text);
      cursor: pointer;
      text-align: left;
      box-shadow: none;
    }

    .notification-card:hover,
    .notification-card:focus-visible {
      background: #fbfbfc;
      outline: 2px solid #d7dbe2;
      outline-offset: 0;
    }

    .notification-card--unread {
      box-shadow: inset 4px 0 0 var(--shell-red);
    }

    .notification-card__icon {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 12px;
      background: #eef0f4;
      color: #8d929b;
    }

    .notification-card__body {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .notification-card__body strong {
      color: var(--shell-text);
      font-size: 17px;
      font-weight: 900;
      line-height: 1.2;
    }

    .notification-card__body small {
      color: #666c76;
      font-size: 14px;
      line-height: 1.35;
    }

    .notification-card__body em {
      justify-self: start;
      padding: 8px 18px;
      border-radius: 8px;
      background: #e7e9ed;
      color: #3b3f46;
      font-size: 13px;
      font-style: normal;
      font-weight: 800;
    }

    .notification-card time {
      color: #858b96;
      font-size: 13px;
      white-space: nowrap;
    }

    .read-all-button {
      width: 100%;
      min-height: 48px;
      border: 0;
      border-radius: 10px;
      background: #d9dde3;
      color: #3b3f46;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
    }

    .empty-drawer-state {
      display: grid;
      justify-items: center;
      gap: 10px;
      padding: 80px 24px;
      text-align: center;
    }

    .empty-drawer-state span {
      display: grid;
      width: 72px;
      height: 72px;
      place-items: center;
      border-radius: 50%;
      background: #ffffff;
      color: #8d929b;
    }

    .empty-drawer-state strong {
      font-size: 20px;
      font-weight: 900;
    }

    .empty-drawer-state small {
      max-width: 300px;
      color: var(--shell-muted);
      font-size: 14px;
      line-height: 1.45;
    }

    .profile-panel-card,
    .profile-panel-link {
      border-radius: 14px;
      background: #f1f2f4;
    }

    .profile-panel-card {
      display: grid;
      gap: 18px;
      padding: 20px;
      margin-bottom: 12px;
    }

    .profile-panel-card--hero {
      grid-template-columns: 62px minmax(0, 1fr);
      align-items: center;
      background: #ffffff;
      border: 1px solid #e2e5ea;
    }

    .profile-panel-avatar,
    .profile-company__icon {
      display: grid;
      place-items: center;
      overflow: hidden;
      border-radius: 14px;
      background: #ffffff;
      color: var(--shell-text);
    }

    .profile-panel-avatar {
      width: 62px;
      height: 62px;
    }

    .profile-panel-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .profile-panel-card small,
    .profile-panel-card p,
    .profile-panel-link mat-icon {
      color: var(--shell-muted);
    }

    .profile-panel-card strong {
      display: block;
      margin-top: 4px;
      color: var(--shell-text);
      font-size: 17px;
      font-weight: 900;
      overflow-wrap: anywhere;
    }

    .profile-panel-card p {
      margin: 4px 0 0;
      font-size: 14px;
      overflow-wrap: anywhere;
    }

    .profile-company {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding-bottom: 18px;
      border-bottom: 1px solid #d2d6dd;
    }

    .profile-company__icon {
      width: 48px;
      height: 48px;
      background: #20242a;
      color: #ffffff;
    }

    .profile-panel-card a,
    .profile-panel-link,
    .profile-panel-logout {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-height: 58px;
      color: var(--shell-text);
      text-decoration: none;
    }

    .profile-panel-card a {
      border-top: 1px solid #d2d6dd;
      padding-top: 16px;
    }

    .profile-panel-card a span,
    .profile-panel-link span {
      display: grid;
      gap: 4px;
      min-width: 0;
      font-size: 15px;
      font-weight: 800;
    }

    .profile-panel-card a small {
      font-size: 13px;
      font-weight: 500;
    }

    .profile-panel-link {
      min-height: 66px;
      padding: 0 20px;
      margin-top: 12px;
      font-weight: 800;
    }

    .profile-panel-logout {
      width: 100%;
      min-height: 54px;
      margin-top: 18px;
      padding: 0 20px;
      border: 0;
      border-radius: 12px;
      background: #20242a;
      color: #ffffff;
      cursor: pointer;
      font: inherit;
      font-weight: 900;
    }

    .search-modal {
      position: fixed;
      inset: 86px 0 0;
      z-index: 150;
      overflow-y: auto;
      border-radius: 22px 22px 0 0;
      background: #ffffff;
      color: var(--shell-text);
      box-shadow: 0 -18px 60px rgba(15, 23, 42, 0.18);
    }

    .search-close {
      position: absolute;
      top: 28px;
      right: 34px;
      display: grid;
      width: 48px;
      height: 48px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--shell-text);
      cursor: pointer;
    }

    .search-close:hover,
    .search-close:focus-visible {
      background: #f0f2f5;
    }

    .search-modal__inner {
      width: min(1020px, calc(100vw - 40px));
      margin: 68px auto 120px;
    }

    .cabinet-search {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 128px;
      gap: 16px;
      align-items: center;
    }

    .cabinet-search label {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      height: 58px;
      padding: 0 16px;
      border: 2px solid #9ea3ad;
      border-radius: 8px;
      background: #ffffff;
    }

    .cabinet-search label mat-icon {
      color: #858b96;
    }

    .cabinet-search input {
      width: 100%;
      border: 0;
      outline: 0;
      color: var(--shell-text);
      font: inherit;
      font-size: 17px;
    }

    .cabinet-search input::placeholder {
      color: #a0a6b0;
    }

    .cabinet-search button[type="submit"] {
      height: 58px;
      border: 0;
      border-radius: 9px;
      background: var(--shell-red);
      color: #ffffff;
      cursor: pointer;
      font: inherit;
      font-size: 16px;
      font-weight: 900;
    }

    .search-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin: 28px 0 56px;
    }

    .search-chips button {
      min-height: 40px;
      padding: 0 18px;
      border: 0;
      border-radius: 18px;
      background: #e8eaee;
      color: #3b3f46;
      cursor: pointer;
      font: inherit;
      font-weight: 700;
    }

    .neuro-help {
      display: grid;
      gap: 20px;
    }

    .neuro-help h2 {
      margin: 0;
      color: var(--shell-text);
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .neuro-help div {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 22px 80px;
    }

    .neuro-help button {
      display: inline-grid;
      grid-template-columns: 40px minmax(0, 1fr);
      gap: 16px;
      align-items: center;
      justify-self: start;
      min-height: 44px;
      border: 0;
      background: transparent;
      color: #3b3f46;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .neuro-help button span {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border-radius: 10px;
      background: #ebe8ff;
      color: #8a79ff;
    }

    @media (max-width: 900px) {
      .profile-shell {
        display: block;
      }

      .desktop-sidebar,
      .topbar {
        display: none;
      }

      .shell-drawer {
        inset: 0;
        width: 100vw;
        border-radius: 0;
      }

      .search-modal {
        inset: 0;
        border-radius: 0;
      }

      .search-modal__inner {
        width: min(100% - 24px, 720px);
        margin: 82px auto 120px;
      }

      .cabinet-search {
        grid-template-columns: minmax(0, 1fr);
      }

      .neuro-help div {
        grid-template-columns: 1fr;
        gap: 14px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .topbar-icon,
      .profile-button,
      .topbar-nav a {
        transition: none;
      }
    }
  `],
})
export class ProfileShellComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly notificationService = inject(NotificationService);
  private readonly router = inject(Router);

  protected readonly user = this.authService.currentUser;
  protected readonly notifications = this.notificationService.recentNotifications;
  protected readonly notificationsOpen = signal(false);
  protected readonly profilePanelOpen = signal(false);
  protected readonly searchOpen = signal(false);
  protected readonly searchQuery = signal('');
  protected readonly showChat = computed(() => isPlatformBrowser(this.platformId));
  protected readonly displayName = computed(() => {
    const user = this.user();
    return user?.displayName || user?.display_name || user?.email || 'Клиент';
  });
  protected readonly avatarUrl = computed(() => this.user()?.photoURL || this.user()?.photo_url || null);
  protected readonly userEmail = computed(() => this.user()?.email || '');
  protected readonly userPhone = computed(() => this.user()?.phone || '');
  protected readonly userRoleLabel = computed(() => {
    switch (this.user()?.role) {
      case 'admin':
        return 'Администратор';
      case 'manager':
        return 'Менеджер';
      case 'employee':
        return 'Сотрудник';
      case 'photographer':
        return 'Фотограф';
      default:
        return 'Клиент';
    }
  });
  protected readonly headerNotificationCount = computed(() => {
    const unreadCount = this.notificationService.unreadCount();
    return unreadCount > 0 ? unreadCount : (this.user()?.pendingApprovals ?? 0);
  });
  protected readonly hasOpenOverlay = computed(() =>
    this.notificationsOpen() || this.profilePanelOpen() || this.searchOpen(),
  );
  protected readonly notificationGroups = computed(() => {
    const groups: { label: string; items: NotificationMessage[] }[] = [];
    for (const notification of this.notifications()) {
      const label = this.notificationDayLabel(notification.timestamp || notification.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.label === label) {
        lastGroup.items = [...lastGroup.items, notification];
      } else {
        groups.push({ label, items: [notification] });
      }
    }
    return groups;
  });

  protected readonly searchChips = ['Фото на документы', 'Печать A4', 'Записи', 'Скидки', 'Бонусы'];
  protected readonly searchPrompts = [
    'Найти ближайшую студию',
    'Проверить статус заказа',
    'Как использовать бонусы',
    'Показать мои записи',
  ];

  protected openSearch(): void {
    this.notificationsOpen.set(false);
    this.profilePanelOpen.set(false);
    this.searchOpen.set(true);
  }

  protected openNotifications(): void {
    this.searchOpen.set(false);
    this.profilePanelOpen.set(false);
    this.notificationsOpen.set(true);
    if (!isPlatformBrowser(this.platformId)) return;
    this.notificationService.getNotifications({ page: 1, limit: 20 }).subscribe({
      error: () => {
        // Сервис уже сохраняет ошибку в состояние уведомлений.
      },
    });
  }

  protected openProfilePanel(): void {
    this.searchOpen.set(false);
    this.notificationsOpen.set(false);
    this.profilePanelOpen.set(true);
  }

  protected closeOverlays(): void {
    this.notificationsOpen.set(false);
    this.profilePanelOpen.set(false);
    this.searchOpen.set(false);
  }

  protected updateSearchQuery(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.searchQuery.set(target.value);
    }
  }

  protected useSearchChip(value: string): void {
    this.searchQuery.set(value);
  }

  protected submitSearch(event: Event): void {
    event.preventDefault();
    const query = this.searchQuery().trim();
    if (!query) return;
    this.closeOverlays();
    this.router.navigate(['/user-profile/services'], { queryParams: { search: query } });
  }

  protected handleNotification(notification: NotificationMessage): void {
    if (!notification.read) {
      this.notificationService.markAsRead(notification.id).subscribe({
        error: () => {
          // Не блокируем переход из-за сетевой ошибки отметки.
        },
      });
    }

    const actionUrl = notification.data?.actionUrl || notification.data?.url;
    if (!actionUrl) return;

    this.closeOverlays();
    if (actionUrl.startsWith('http')) {
      if (isPlatformBrowser(this.platformId)) {
        window.open(actionUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    this.router.navigateByUrl(actionUrl);
  }

  protected markAllNotificationsRead(): void {
    this.notificationService.markAllAsRead().subscribe({
      error: () => {
        // Сервис уже обработает состояние ошибки.
      },
    });
  }

  protected notificationIcon(type: NotificationMessage['type']): string {
    switch (type) {
      case 'warning':
      case 'booking_reminder':
      case 'shift_reminder':
        return 'notifications_active';
      case 'error':
      case 'task_urgent':
        return 'priority_high';
      case 'success':
      case 'photo_ready':
      case 'session_uploaded':
      case 'retouch_approval':
        return 'task_alt';
      case 'special_offer':
        return 'local_offer';
      case 'booking_confirmation':
      case 'booking_update':
        return 'event_available';
      case 'order_status':
        return 'receipt_long';
      default:
        return 'info';
    }
  }

  protected formatNotificationTime(dateValue: string): string {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  private notificationDayLabel(dateValue: string): string {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return 'Ранее';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const diff = today - day;

    if (diff === 0) return 'Сегодня';
    if (diff === 86_400_000) return 'Вчера';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  protected logout(): void {
    this.closeOverlays();
    this.authService.logout().subscribe({
      complete: () => this.router.navigate(['/']),
      error: () => this.router.navigate(['/']),
    });
  }
}
