import { Component, inject, signal, computed, effect, ChangeDetectionStrategy, PLATFORM_ID, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService, type UserProfile } from '../../../../core/services/auth.service';
import { OfflineQueueService } from '../../../../core/services/offline-queue.service';
import { ShiftsApiService, type EmployeeShift } from '../../services/shifts-api.service';
import { InboxService } from '../../services/inbox.service';
import { CrmNotificationsService } from '../../services/crm-notifications.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { TelephonyService } from '../../services/telephony.service';
import { CrmSearchService, SearchResult } from '../../services/crm-search.service';
import { StaffChatService } from '../../services/staff-chat.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { OnlineStaffService } from '../../services/online-staff.service';
import { IncomingCallPopupComponent } from '../incoming-call-popup/incoming-call-popup.component';
import { ActiveCallBarComponent } from '../active-call-bar/active-call-bar.component';
import { QuickDialPopoverComponent } from '../quick-dial-popover/quick-dial-popover.component';
import { shiftStatusLabel } from '../../utils/crm-helpers';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { HasPermissionDirective } from '../../../../shared/directives/has-permission.directive';
import { ChatNotificationToastComponent } from '../team-chat/chat-notification-toast.component';
import {
  WorkdayWelcomeDialogComponent,
  type WorkdayWelcomeDialogData,
  type WorkdayWelcomeDialogResult,
} from '../workday-welcome-dialog/workday-welcome-dialog.component';

export interface WorkdayWelcomeGateState {
  isBrowser: boolean;
  workdayLoaded: boolean;
  dialogOpen: boolean;
  workdayStartSkipped: boolean;
  hasShiftManagePermission: boolean;
  canStartWorkday: boolean;
  hasUser: boolean;
}

export function shouldOpenWorkdayWelcome(state: WorkdayWelcomeGateState): boolean {
  return state.isBrowser
    && state.workdayLoaded
    && !state.dialogOpen
    && !state.workdayStartSkipped
    && state.hasShiftManagePermission
    && state.canStartWorkday
    && state.hasUser;
}

@Component({
  selector: 'app-workspace-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatMenuModule,
    MatDividerModule,
    MatTooltipModule,
    IncomingCallPopupComponent,
    ActiveCallBarComponent,
    QuickDialPopoverComponent,
    HasPermissionDirective,
    ChatNotificationToastComponent,
  ],
  template: `
    <app-incoming-call-popup />
    <app-active-call-bar />

    <!-- Desktop top bar -->
    @if (isDesktop()) {
      <mat-toolbar class="ws-toolbar">
        <a class="ws-logo" routerLink="/employee">
          <span class="logo-brand">Своё Фото</span>
          <span class="logo-sub">CRM</span>
        </a>

        <nav class="ws-nav">
          <a routerLink="/employee" routerLinkActive="active"
             [routerLinkActiveOptions]="{ exact: true }" class="nav-tab">
            <mat-icon [matBadge]="inboxService.totalCount()" matBadgeSize="small"
                      matBadgeColor="warn" [matBadgeHidden]="!inboxService.totalCount()">
              inbox
            </mat-icon>
            <span>Пульт</span>
            <span class="hotkey-hint">&#8963;1</span>
          </a>
          <a routerLink="/employee/pos" routerLinkActive="active" class="nav-tab">
            <mat-icon>point_of_sale</mat-icon>
            <span>Касса</span>
            <span class="hotkey-hint">&#8963;2</span>
          </a>
          <a routerLink="/employee/team" routerLinkActive="active" class="nav-tab">
            <mat-icon [matBadge]="staffChatUnread()" matBadgeSize="small"
                      matBadgeColor="primary" [matBadgeHidden]="!staffChatUnread()">
              chat
            </mat-icon>
            <span>Чат</span>
            <span class="hotkey-hint">&#8963;4</span>
          </a>
          <a routerLink="/employee/more" routerLinkActive="active" class="nav-tab"
             [routerLinkActiveOptions]="{ exact: false }">
            <mat-icon>more_horiz</mat-icon>
            <span>Ещё</span>
          </a>
          <a routerLink="/employee/print-center" routerLinkActive="active" class="nav-tab">
            <mat-icon [matBadge]="activePrintJobCount()" matBadgeSize="small"
                      matBadgeColor="accent" [matBadgeHidden]="!activePrintJobCount()">
              print
            </mat-icon>
            <span>Печать</span>
            <span class="hotkey-hint">&#8963;3</span>
          </a>
          <a routerLink="/employee/retouch-queue" routerLinkActive="active" class="nav-tab">
            <mat-icon>brush</mat-icon>
            <span>Ретушь</span>
            <span class="hotkey-hint">&#8963;5</span>
          </a>
          <a routerLink="/employee/knowledge" routerLinkActive="active" class="nav-tab">
            <mat-icon>menu_book</mat-icon>
            <span>Инструкции</span>
          </a>
          <a routerLink="/employee" [queryParams]="{action: 'new-order'}" class="nav-tab new-order-tab">
            <mat-icon [matBadge]="unpaidCount()" matBadgeSize="small"
                      matBadgeColor="warn" [matBadgeHidden]="!unpaidCount()">
              add_circle
            </mat-icon>
            <span>Новый заказ</span>
            <span class="hotkey-hint">&#8963;&#8679;N</span>
          </a>
        </nav>

        <!-- Search -->
        <div class="ws-search">
          @if (searchExpanded()) {
            <div class="search-input-wrap">
              <mat-icon class="search-icon">search</mat-icon>
              <input class="search-input" placeholder="Поиск задач, клиентов, заказов..."
                     [ngModel]="searchQuery()" (ngModelChange)="onSearchInput($event)"
                     (blur)="onSearchBlur()" (keydown.escape)="closeSearch()" #searchInput>
              <button mat-icon-button class="search-close" (click)="closeSearch()">
                <mat-icon>close</mat-icon>
              </button>
            </div>

            @if (searchResults().length) {
              <div class="search-dropdown">
                @for (r of searchResults(); track r.id) {
                  <a class="search-result" (mousedown)="goToResult(r)">
                    <mat-icon class="sr-icon">{{ r.icon }}</mat-icon>
                    <div class="sr-content">
                      <span class="sr-title">{{ r.title }}</span>
                      <span class="sr-subtitle">{{ r.subtitle }}</span>
                    </div>
                    <span class="sr-type">{{ resultTypeLabel(r.type) }}</span>
                  </a>
                }
              </div>
            }
          } @else {
            <button class="cmd-bar-trigger" (click)="openSearch()">
              <mat-icon>search</mat-icon>
              <span class="trigger-text">Поиск...</span>
              <span class="kbd">⌘K</span>
            </button>
          }
        </div>

        <span class="spacer"></span>

        @if (offlineQueue.pendingCount()) {
          <span class="offline-chip">
            <mat-icon>cloud_off</mat-icon>
            {{ offlineQueue.pendingCount() }} в очереди
          </span>
        }

        @if (activePrintJobCount() > 0) {
          <span class="print-badge" routerLink="/employee/print-queue"
                matTooltip="Активных заданий печати: {{ activePrintJobCount() }}">
            <mat-icon>print</mat-icon>
            <span class="badge-count">{{ activePrintJobCount() }}</span>
          </span>
        }

        <button mat-icon-button matTooltip="Быстрый звонок"
                (click)="toggleDialer($event)" [class.dialer-active]="dialerOpen()">
          <mat-icon>phone</mat-icon>
        </button>

        @if (dialerOpen()) {
          <div class="dialer-popover" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="0">
            <app-quick-dial-popover (closed)="dialerOpen.set(false)" />
          </div>
        }

        <ng-container *appHasPermission="'reports:view'">
          @if (todayRevenue() !== null) {
            <div class="revenue-chip" [class.revenue-empty]="!todayRevenue()"
                 routerLink="/employee/reports"
                 [matTooltip]="!todayRevenue() ? 'Пока нет выручки за сегодня' : ''">
              <mat-icon>payments</mat-icon>
              @if (todayRevenue()) {
                <span>{{ formatRevenue(todayRevenue()!) }}₽</span>
                @if (todayReceipts()) {
                  <span class="rev-count">{{ todayReceipts() }}</span>
                }
              }
            </div>
          }
        </ng-container>

        @if (shiftStatus()) {
          <span class="shift-chip"
                [class.active]="shiftStatus() === 'active'"
                [class.scheduled]="shiftStatus() === 'scheduled'">
            <mat-icon>location_on</mat-icon>
            @if (shiftStudio()) {
              {{ shiftStudio() }} —
            }
            {{ getShiftLabel() }}
          </span>
        }

        <div class="toolbar-user-zone">
          <button mat-icon-button [matMenuTriggerFor]="soundMenu"
                  [attr.aria-label]="crmNotifications.dndActive() ? 'Не беспокоить' : 'Звук'">
            <mat-icon>{{ crmNotifications.dndActive() ? 'do_not_disturb_on' : crmNotifications.soundEnabled() ? 'volume_up' : 'volume_off' }}</mat-icon>
          </button>
          <mat-menu #soundMenu="matMenu">
            <button mat-menu-item (click)="crmNotifications.toggleSound()">
              <mat-icon>{{ crmNotifications.soundEnabled() ? 'volume_off' : 'volume_up' }}</mat-icon>
              <span>{{ crmNotifications.soundEnabled() ? 'Выключить звук' : 'Включить звук' }}</span>
            </button>
            <mat-divider />
            @if (crmNotifications.dndActive()) {
              <button mat-menu-item (click)="crmNotifications.disableDnd()">
                <mat-icon>notifications_active</mat-icon>
                <span>Отключить DND {{ crmNotifications.dndLabel() ? '(' + crmNotifications.dndLabel() + ')' : '' }}</span>
              </button>
            } @else {
              <button mat-menu-item (click)="crmNotifications.enableDnd(30)">
                <mat-icon>do_not_disturb_on</mat-icon>
                <span>Не беспокоить 30 мин</span>
              </button>
              <button mat-menu-item (click)="crmNotifications.enableDnd(60)">
                <mat-icon>do_not_disturb_on</mat-icon>
                <span>Не беспокоить 1 час</span>
              </button>
              <button mat-menu-item (click)="crmNotifications.enableDnd(120)">
                <mat-icon>do_not_disturb_on</mat-icon>
                <span>Не беспокоить 2 часа</span>
              </button>
              <button mat-menu-item (click)="crmNotifications.enableDnd(480)">
                <mat-icon>do_not_disturb_on</mat-icon>
                <span>До конца смены</span>
              </button>
            }
          </mat-menu>

          <div class="online-staff" [matMenuTriggerFor]="onlineMenu" style="cursor: pointer">
            @for (member of onlineStaffService.staff(); track member.id; let i = $index) {
              @if (i < 4) {
                <span class="staff-avatar" [class]="'role-' + member.role">
                  {{ member.display_name[0] || '?' }}
                </span>
              }
            }
            @if (onlineStaffService.staff().length > 4) {
              <span class="staff-more">+{{ onlineStaffService.staff().length - 4 }}</span>
            }
            @if (!onlineStaffService.staff().length) {
              <span class="staff-avatar role-empty">
                <mat-icon style="font-size: 14px; width: 14px; height: 14px">person_off</mat-icon>
              </span>
            }
          </div>

          <mat-menu #onlineMenu="matMenu" class="online-staff-menu">
            <div class="os-header" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="-1">
              <mat-icon>group</mat-icon>
              <span>Онлайн — {{ onlineStaffService.staff().length }}</span>
            </div>
            <mat-divider />
            @for (member of onlineStaffService.staff(); track member.id) {
              <button mat-menu-item class="os-member" routerLink="/employee/team-management">
                <span class="os-avatar" [class]="'role-' + member.role">
                  {{ member.display_name[0] || '?' }}
                </span>
                <span class="os-name">{{ member.display_name }}</span>
                <span class="os-role-badge" [class]="'role-' + member.role">{{ getRoleLabel(member.role) }}</span>
              </button>
            }
            @if (!onlineStaffService.staff().length) {
              <div class="os-empty" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()" tabindex="-1">
                <mat-icon>person_off</mat-icon>
                <span>Нет коллег онлайн</span>
              </div>
            }
          </mat-menu>

          <span class="tz-sep"></span>

          <button class="user-trigger" [matMenuTriggerFor]="userMenu">
            <span class="user-initial" [class]="'role-' + (authService.userRole() || 'employee')">
              {{ getUserInitial() }}
            </span>
            <span class="user-short-name">{{ getShortName() }}</span>
            <mat-icon class="user-chevron">expand_more</mat-icon>
          </button>
        </div>
        <mat-menu #userMenu="matMenu">
          <div class="user-info-menu">
            <span class="user-name-menu">{{ getUserName() }}</span>
            <span class="user-role-menu">{{ getUserRole() }}</span>
          </div>
          <mat-divider />
          <button mat-menu-item routerLink="/employee/my-profile">
            <mat-icon>person</mat-icon>
            <span>Мой профиль</span>
          </button>
          <button mat-menu-item routerLink="/">
            <mat-icon>home</mat-icon>
            <span>На сайт</span>
          </button>
          <button mat-menu-item (click)="onLogout()">
            <mat-icon>logout</mat-icon>
            <span>Выйти</span>
          </button>
        </mat-menu>
      </mat-toolbar>
    }

    <div class="ws-content" [class.mobile]="!isDesktop()">
      <router-outlet />
    </div>

    <!-- Mobile bottom nav -->
    @if (!isDesktop()) {
      <nav class="ws-bottom-nav">
        <a routerLink="/employee" routerLinkActive="active"
           [routerLinkActiveOptions]="{ exact: true }" class="bn-item">
          <mat-icon [matBadge]="inboxService.totalCount()" matBadgeSize="small"
                    matBadgeColor="warn" [matBadgeHidden]="!inboxService.totalCount()">
            inbox
          </mat-icon>
          <span>Пульт</span>
        </a>
        <a routerLink="/employee/pos" routerLinkActive="active" class="bn-item">
          <mat-icon>point_of_sale</mat-icon>
          <span>Касса</span>
        </a>
        <a routerLink="/employee/team" routerLinkActive="active" class="bn-item">
          <mat-icon [matBadge]="staffChatUnread()" matBadgeSize="small"
                    matBadgeColor="primary" [matBadgeHidden]="!staffChatUnread()">
            chat
          </mat-icon>
          <span>Чат</span>
        </a>
        <a routerLink="/employee" [queryParams]="{action: 'new-order'}" class="bn-item new-order-bn">
          <mat-icon>add_circle</mat-icon>
          <span>Заказ</span>
        </a>
        <button class="bn-item" (click)="openMobileSearch()">
          <mat-icon>search</mat-icon>
          <span>Поиск</span>
        </button>
        <a routerLink="/employee/more" routerLinkActive="active" class="bn-item"
           [routerLinkActiveOptions]="{ exact: false }">
          <mat-icon>more_horiz</mat-icon>
          <span>Ещё</span>
        </a>
      </nav>
    }

    <app-chat-notification-toast />

    <!-- Mobile search overlay -->
    @if (mobileSearchOpen()) {
      <div class="mobile-search-overlay">
        <div class="mobile-search-header">
          <button mat-icon-button (click)="closeMobileSearch()">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <input class="mobile-search-input"
                 placeholder="Задачи, клиенты, заказы..."
                 [ngModel]="searchQuery()" (ngModelChange)="onSearchInput($event)"
                 (keydown.escape)="closeMobileSearch()">
          @if (searchQuery()) {
            <button mat-icon-button (click)="clearMobileSearch()">
              <mat-icon>close</mat-icon>
            </button>
          }
        </div>
        <div class="mobile-search-results">
          @for (r of searchResults(); track r.id) {
            <a class="search-result" (click)="goToMobileResult(r)" (keydown.enter)="goToMobileResult(r)" tabindex="0">
              <mat-icon class="sr-icon">{{ r.icon }}</mat-icon>
              <div class="sr-content">
                <span class="sr-title">{{ r.title }}</span>
                <span class="sr-subtitle">{{ r.subtitle }}</span>
              </div>
              <span class="sr-type">{{ resultTypeLabel(r.type) }}</span>
            </a>
          }
          @if (!searchQuery()) {
            <div class="mobile-search-hint">
              <mat-icon>search</mat-icon>
              <p>Начните вводить для поиска</p>
            </div>
          } @else if (searchQuery().length >= 2 && !searchResults().length) {
            <div class="mobile-search-hint">
              <mat-icon>search_off</mat-icon>
              <p>Ничего не найдено</p>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes crmFadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

    :host { display: flex; flex-direction: column; height: 100vh; height: 100dvh; font-family: var(--crm-font-sans); }

    .ws-toolbar {
      height: 44px;
      padding: 0 12px;
      background: rgba(12, 11, 9, 0.85);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border-bottom: 1px solid var(--crm-glass-border);
      display: flex;
      align-items: center;
      gap: 4px;
      position: relative;
      z-index: 10;
    }

    .ws-logo {
      display: flex;
      align-items: baseline;
      gap: 6px;
      margin-right: 16px;
      text-decoration: none;
      cursor: pointer;
    }

    .logo-brand {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 18px;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: var(--crm-accent);
    }

    .logo-sub {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 9px;
      font-weight: 700;
      color: var(--crm-text-muted);
      padding: 1px 5px;
      border: 1px solid var(--crm-glass-border);
      border-radius: 4px;
    }

    .ws-nav { display: flex; gap: 1px; }

    .nav-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: var(--crm-radius-md);
      text-decoration: none;
      color: var(--crm-text-secondary);
      font-size: var(--crm-text-base);
      font-weight: 500;
      position: relative;
      transition: color var(--crm-transition-fast), background var(--crm-transition-fast);

      &:hover {
        color: var(--crm-text-primary);
        background: rgba(255, 255, 255, 0.04);
      }
      &.active {
        color: var(--crm-text-primary);
        font-weight: 600;
        background: rgba(255, 255, 255, 0.04);
      }
      &.active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 12px;
        right: 12px;
        height: 2px;
        background: var(--crm-accent);
        border-radius: 1px 1px 0 0;
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.4);
      }
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .new-order-tab {
      margin-left: 4px;
      color: var(--crm-accent);
      font-weight: 600;

      &:hover { background: var(--crm-accent-muted); color: var(--crm-accent); }
      &.active { background: var(--crm-accent-muted); color: var(--crm-accent); }
    }

    .hotkey-hint {
      font-size: 9px;
      opacity: 0;
      transition: opacity 0.2s;
      margin-left: 4px;
      color: var(--mat-sys-on-surface-variant, var(--crm-text-secondary));
    }
    .nav-tab:hover .hotkey-hint {
      opacity: 0.5;
    }

    .new-order-bn {
      color: var(--crm-accent);
      mat-icon { color: var(--crm-accent); }
    }

    /* Command bar trigger */
    .cmd-bar-trigger {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: 8px;
      padding: 0 12px;
      height: 30px;
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-lg);
      background: rgba(255, 255, 255, 0.03);
      color: var(--crm-text-muted);
      font-size: var(--crm-text-sm);
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: all var(--crm-transition-fast);
      min-width: 180px;

      &:hover {
        border-color: rgba(245, 158, 11, 0.3);
        background: rgba(255, 255, 255, 0.05);
        box-shadow: 0 0 12px rgba(245, 158, 11, 0.08);
      }

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
      .trigger-text { flex: 1; }
    }

    .kbd {
      display: inline-flex;
      align-items: center;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--crm-kbd-bg);
      border: 1px solid var(--crm-kbd-border);
      font-size: var(--crm-text-xs);
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted);
      line-height: 1.4;
    }

    .ws-search {
      position: relative;
      flex: 1;
      max-width: 400px;
    }

    .search-input-wrap {
      display: flex;
      align-items: center;
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      padding: 0 4px 0 12px;
      height: 34px;
      transition: border-color var(--crm-transition-fast), box-shadow var(--crm-transition-fast);

      &:focus-within {
        border-color: var(--crm-border-focus);
        box-shadow: var(--crm-shadow-accent);
      }
    }

    .search-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); margin-right: 8px; }

    .search-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: var(--crm-text-base);
      font-family: var(--crm-font-sans);
      color: var(--crm-text-primary);
      outline: none;
      min-width: 0;

      &::placeholder { color: var(--crm-text-muted); }
    }

    .search-close {
      width: 28px;
      height: 28px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .search-dropdown {
      position: absolute;
      top: 40px;
      left: 0;
      right: 0;
      background: var(--crm-surface-overlay);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      box-shadow: var(--crm-shadow-lg);
      overflow: hidden;
      z-index: var(--crm-z-overlay);
      max-height: 320px;
      overflow-y: auto;
      animation: crmFadeIn 150ms ease;
    }

    .search-result {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      cursor: pointer;
      text-decoration: none;
      color: var(--crm-text-primary);
      transition: background var(--crm-transition-fast);

      &:hover { background: var(--crm-surface-hover); }
    }

    .sr-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); flex-shrink: 0; }

    .sr-content { flex: 1; min-width: 0; }

    .sr-title {
      display: block;
      font-size: var(--crm-text-base);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sr-subtitle {
      display: block;
      font-size: var(--crm-text-sm);
      color: var(--crm-text-secondary);
    }

    .sr-type {
      font-size: var(--crm-text-xs);
      color: var(--crm-text-muted);
      white-space: nowrap;
      flex-shrink: 0;
    }

    .spacer { flex: 1; }

    .dialer-active { color: var(--crm-accent) !important; }

    .dialer-popover {
      position: absolute;
      top: calc(var(--crm-toolbar-height, 44px) + 4px);
      right: 0;
      z-index: var(--crm-z-overlay);
    }

    .revenue-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      color: var(--crm-text-primary);
      font-size: var(--crm-text-base);
      font-weight: 600;
      font-family: var(--crm-font-mono);
      cursor: pointer;
      margin-right: 4px;
      transition: background var(--crm-transition-fast);

      &:hover { background: var(--crm-surface-overlay); }

      mat-icon { font-size: 15px; width: 15px; height: 15px; color: var(--crm-accent); }
    }

    .rev-count {
      font-size: var(--crm-text-sm);
      font-weight: 400;
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted);
      margin-left: 2px;
    }

    .revenue-chip.revenue-empty {
      background: transparent;
      padding: 4px 6px;
      mat-icon { color: var(--crm-text-muted); }
    }

    .next-booking-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: var(--crm-radius-md);
      background: var(--crm-accent-muted);
      color: var(--crm-accent);
      font-size: var(--crm-text-sm);
      font-weight: 500;
      cursor: pointer;
      margin-right: 4px;
      max-width: 200px;
      transition: background var(--crm-transition-fast);
      overflow: hidden;

      &:hover { background: var(--crm-surface-overlay); }

      mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; }
    }

    .nb-time {
      font-family: var(--crm-font-mono);
      font-variant-numeric: tabular-nums;
      font-weight: 600;
      flex-shrink: 0;
    }

    .nb-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-primary);
    }

    .shift-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      font-size: var(--crm-text-sm);
      font-weight: 500;
      height: 24px;
      margin-right: 8px;
      border-radius: var(--crm-radius-sm);
      background: var(--crm-surface-raised);
      color: var(--crm-text-secondary);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.active {
        background: var(--crm-status-success-container);
        color: var(--crm-status-success);
      }
      &.scheduled {
        background: var(--crm-status-warning-container);
        color: var(--crm-status-warning);
      }
    }

    .offline-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      font-size: var(--crm-text-sm);
      font-weight: 500;
      height: 24px;
      margin-right: 8px;
      border-radius: var(--crm-radius-sm);
      background: var(--crm-status-warning-container);
      color: var(--crm-status-warning);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .print-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      font-size: var(--crm-text-sm);
      font-weight: 600;
      height: 24px;
      margin-right: 4px;
      border-radius: var(--crm-radius-sm);
      background: var(--crm-status-info-container);
      color: var(--crm-status-info);
      cursor: pointer;
      transition: background var(--crm-transition-fast);

      &:hover { background: var(--crm-surface-overlay); }

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      .badge-count {
        font-family: var(--crm-font-mono);
        font-variant-numeric: tabular-nums;
      }
    }

    .online-staff {
      display: flex;
      align-items: center;
      margin-right: 4px;
    }

    .staff-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      font-size: var(--crm-text-sm);
      font-weight: 600;
      color: white;
      margin-left: -4px;
      border: 2px solid var(--crm-surface-base);
      position: relative;

      &::after {
        content: '';
        position: absolute;
        bottom: -1px;
        right: -1px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--crm-status-success);
        border: 1.5px solid var(--crm-surface-base);
        animation: onlinePulse 2s ease-in-out infinite;
      }

      &.role-admin { background: var(--crm-accent); }
      &.role-manager { background: #0ea5e9; }
      &.role-employee { background: var(--crm-status-info); }
      &.role-photographer { background: var(--crm-status-warning); }
    }

    .staff-more {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      font-size: var(--crm-text-xs);
      font-weight: 600;
      background: var(--crm-surface-overlay);
      color: var(--crm-text-secondary);
      margin-left: -4px;
      border: 2px solid var(--crm-surface-base);
    }

    .toolbar-user-zone {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px 2px 2px 4px;
      border-radius: var(--crm-radius-md);
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.04);
    }

    .tz-sep {
      width: 1px;
      height: 20px;
      background: var(--crm-border);
      margin: 0 4px;
    }

    .user-trigger {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px 3px 3px;
      border-radius: var(--crm-radius-md);
      background: transparent;
      border: none;
      cursor: pointer;
      transition: background var(--crm-transition-fast);

      &:hover { background: rgba(255, 255, 255, 0.04); }
    }

    .user-initial {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 11px;
      font-weight: 700;
      color: white;

      &.role-admin { background: var(--crm-accent); }
      &.role-employee { background: var(--crm-status-info); }
      &.role-photographer { background: var(--crm-status-warning); }
    }

    .user-short-name {
      font-family: var(--crm-font-sans);
      font-size: 12px;
      font-weight: 500;
      color: var(--crm-text-primary);
      max-width: 80px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .user-chevron {
      font-size: 14px !important;
      width: 14px !important;
      height: 14px !important;
      color: var(--crm-text-muted);
    }

    .user-info-menu {
      padding: 12px 16px 8px;
      display: flex;
      flex-direction: column;
    }
    .user-name-menu { font-size: var(--crm-text-base); font-weight: 500; }
    .user-role-menu { font-size: 12px; color: var(--crm-text-muted); }

    .ws-content {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
      background: var(--crm-surface-base);

      &.mobile { padding-bottom: 56px; }
    }

    .ws-bottom-nav {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      height: 52px;
      display: flex;
      background: rgba(12, 11, 9, 0.88);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border-top: 1px solid var(--crm-glass-border);
      z-index: var(--crm-z-dropdown);
    }

    .bn-item {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      text-decoration: none;
      color: var(--crm-text-muted);
      font-size: var(--crm-text-xs);
      transition: color var(--crm-transition-fast);

      &.active {
        color: var(--crm-accent);
        mat-icon { color: var(--crm-accent); }
      }

      mat-icon { font-size: 22px; width: 22px; height: 22px; }
    }

    /* Mobile search overlay */
    .mobile-search-overlay {
      position: fixed;
      inset: 0;
      z-index: var(--crm-z-overlay);
      background: var(--crm-surface);
      display: flex;
      flex-direction: column;
    }

    .mobile-search-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;
    }

    .mobile-search-input {
      flex: 1;
      border: none;
      background: transparent;
      font-size: var(--crm-text-lg);
      font-family: var(--crm-font-sans);
      color: var(--crm-text-primary);
      outline: none;
      min-width: 0;

      &::placeholder { color: var(--crm-text-muted); }
    }

    .mobile-search-results {
      flex: 1;
      overflow-y: auto;
    }

    .mobile-search-hint {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 24px;
      color: var(--crm-text-muted);
      gap: 8px;

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.2; }
      p { margin: 0; font-size: var(--crm-text-md); }
    }

    @keyframes onlinePulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
      50% { box-shadow: 0 0 0 3px rgba(34, 197, 94, 0); }
    }

    /* Online staff menu */
    .os-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px 8px;
      font-size: var(--crm-text-base);
      font-weight: 600;
      color: var(--crm-text-primary);

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent); }
    }

    .os-member {
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
    }

    .os-avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 600;
      color: white;
      flex-shrink: 0;
      position: relative;

      &::after {
        content: '';
        position: absolute;
        bottom: 0;
        right: 0;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--crm-status-success);
        border: 2px solid var(--crm-surface-overlay);
      }

      &.role-admin { background: var(--crm-accent); }
      &.role-manager { background: #0ea5e9; }
      &.role-employee { background: var(--crm-status-info); }
      &.role-photographer { background: var(--crm-status-warning); }
    }

    .os-name {
      flex: 1;
      font-size: var(--crm-text-base);
      font-weight: 500;
      color: var(--crm-text-primary);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .os-role-badge {
      font-size: var(--crm-text-xs);
      font-weight: 600;
      padding: 1px 6px;
      border-radius: var(--crm-radius-sm);
      flex-shrink: 0;

      &.role-admin { background: var(--crm-accent-muted); color: var(--crm-accent); }
      &.role-manager { background: rgba(14, 165, 233, 0.15); color: #0ea5e9; }
      &.role-employee { background: var(--crm-status-info-container); color: var(--crm-status-info); }
      &.role-photographer { background: var(--crm-status-warning-container); color: var(--crm-status-warning); }
    }

    .os-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 16px;
      color: var(--crm-text-muted);
      font-size: var(--crm-text-sm);

      mat-icon { font-size: 24px; width: 24px; height: 24px; opacity: 0.3; }
    }

    .role-empty {
      background: var(--crm-surface-overlay) !important;
      color: var(--crm-text-muted) !important;

      &::after { display: none; }
    }
  `],
})
export class WorkspaceLayoutComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly router = inject(Router);
  protected readonly authService = inject(AuthService);
  protected readonly inboxService = inject(InboxService);
  private readonly shiftsApi = inject(ShiftsApiService);
  protected readonly crmNotifications = inject(CrmNotificationsService);
  private readonly pushService = inject(PushNotificationService);
  private readonly telephonyService = inject(TelephonyService);
  private readonly searchService = inject(CrmSearchService);
  private readonly staffChatService = inject(StaffChatService);
  protected readonly onlineStaffService = inject(OnlineStaffService);
  protected readonly offlineQueue = inject(OfflineQueueService);
  private readonly dashData = inject(DashboardDataService);
  private readonly dialog = inject(MatDialog);

  isDesktop = signal(true);
  shiftStatus = signal<string | null>(null);
  shiftStudio = signal<string | null>(null);
  // Выручка дня берётся из общего dashData.dailySummary (один запрос
  // /crm/reports/daily-summary), чтобы не дублировать его собственным loadRevenue.
  // Permission-гейт reports:view соблюдается внутри dashData.loadDailySummary
  // (при отсутствии прав dailySummary = null → здесь null/0).
  readonly todayRevenue = computed(() => this.dashData.dailySummary()?.today.net ?? null);
  readonly todayReceipts = computed(() => this.dashData.dailySummary()?.today.receipts ?? 0);

  searchExpanded = signal(false);
  searchQuery = signal('');
  searchResults = signal<SearchResult[]>([]);
  mobileSearchOpen = signal(false);
  dialerOpen = signal(false);

  readonly staffChatUnread = computed(() => this.staffChatService.totalUnread());
  readonly unpaidCount = computed(() => this.inboxService.counts().unpaid);
  readonly activePrintJobCount = computed(() => {
    const jobs = this.wsService.activePrintJobs();
    return jobs.filter(j => j.status === 'queued' || j.status === 'sending' || j.status === 'printing').length;
  });

  private readonly wsService = inject(WebSocketService);
  private readonly snackBar = inject(MatSnackBar);


  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private workdayWelcomeDialogOpen = false;
  private readonly workdayStartSkipped = signal(false);

  // Toast notification for team chat messages
  private readonly staffChatToastEffect = effect(() => {
    const evt = this.wsService.staffChatMessage();
    if (!evt) return;
    const msg = evt.message;
    const senderId = typeof msg['sender_id'] === 'string' ? msg['sender_id'] : '';
    const senderName = typeof msg['sender_name'] === 'string' ? msg['sender_name'] : 'Сотрудник';
    const content = typeof msg['content'] === 'string' ? msg['content'] : '';
    const messageType = typeof msg['message_type'] === 'string' ? msg['message_type'] : 'text';
    const currentUserId = this.authService.currentUser()?.id;
    if (!senderId || senderId === currentUserId) return;

    // Build informative preview
    const preview = messageType === 'text'
      ? (content.length > 80 ? content.substring(0, 80) + '...' : content)
      : messageType === 'image' ? '📷 Фото'
      : messageType === 'video' ? '🎬 Видео'
      : messageType === 'audio' ? '🎵 Аудио'
      : '📎 Файл';

    // Add conversation context for group/general chats
    const conv = this.staffChatService.conversations().find(c => c.id === evt.conversationId);
    const convLabel = conv?.type === 'general' ? 'Общий чат'
      : conv?.type === 'group' ? (conv.title || 'Группа')
      : null;
    const toastText = convLabel
      ? `${convLabel} — ${senderName}: ${preview}`
      : `${senderName}: ${preview}`;

    const ref = this.snackBar.open(toastText, 'Открыть', {
      duration: 6000,
      horizontalPosition: 'right',
      verticalPosition: 'bottom',
      panelClass: 'staff-chat-toast',
    });
    ref.onAction().subscribe(() => this.router.navigate(['/employee/team']));
  });

  // Toast notification for print job status changes (completed/failed)
  private readonly printJobToastEffect = effect(() => {
    const update = this.wsService.printJobUpdate();
    if (!update) return;
    if (update.status === 'completed') {
      this.snackBar.open('Печать завершена', '', {
        duration: 3000, horizontalPosition: 'right', verticalPosition: 'top',
        panelClass: 'print-success-toast',
      });
    } else if (update.status === 'failed') {
      this.snackBar.open('Ошибка печати', 'Очередь', {
        duration: 6000, horizontalPosition: 'right', verticalPosition: 'top',
        panelClass: 'print-error-toast',
      }).onAction().subscribe(() => this.router.navigate(['/employee/print-queue']));
    }
  });

  private readonly workdayWelcomeEffect = effect(() => {
    const workday = this.dashData.workday();
    const user = this.authService.currentUser();

    if (!shouldOpenWorkdayWelcome({
      isBrowser: isPlatformBrowser(this.platformId),
      workdayLoaded: this.dashData.workdayLoaded(),
      dialogOpen: this.workdayWelcomeDialogOpen,
      workdayStartSkipped: this.workdayStartSkipped(),
      hasShiftManagePermission: this.authService.hasPermission('shifts:manage'),
      canStartWorkday: !!workday?.can_start_workday,
      hasUser: !!user,
    })) return;

    if (!user) return;

    this.workdayWelcomeDialogOpen = true;
    queueMicrotask(() => this.openWorkdayWelcome(user));
  });

  // Toast notification for auto-print trigger
  private readonly autoPrintToastEffect = effect(() => {
    const evt = this.wsService.printAutoTriggered();
    if (!evt) return;
    this.snackBar.open(
      `Автопечать: заказ ${evt.orderId} — ${evt.jobCount} фото отправлено на ${evt.printerName || 'принтер'}`,
      'OK',
      { duration: 6000, horizontalPosition: 'right', verticalPosition: 'top', panelClass: 'auto-print-toast' },
    );
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // CRM overlay scoping — add crm-active class for CDK overlays
      this.document.documentElement.classList.add('crm-active');
      this.destroyRef.onDestroy(() => {
        this.document.documentElement.classList.remove('crm-active');
      });

      this.breakpointObserver.observe('(min-width: 840px)')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(result => {
          this.isDesktop.set(result.matches);
        });
      this.loadShiftStatus();
      this.inboxService.loadCounts();
      // Выручка (todayRevenue/todayReceipts) теперь computed от
      // dashData.dailySummary — отдельный loadRevenue() и его 5-минутный таймер
      // убраны как дубль. Обновление покрыто dashData (WS-события + failsafe 15 мин).
      this.dashData.init();
      this.crmNotifications.init();
      this.staffChatService.init();
      this.pushService.subscribe();
      this.onlineStaffService.init();

      // Keyboard shortcuts
      const onKeydown = (e: KeyboardEvent) => {
        // Ctrl+K / Cmd+K — search
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
          e.preventDefault();
          if (this.isDesktop()) {
            this.openSearch();
          } else {
            this.openMobileSearch();
          }
          return;
        }

        // Skip if focused on input/textarea/contenteditable
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('[contenteditable]')) return;

        // Navigation shortcuts (Ctrl+1..5)
        if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
          const navRoutes: Record<string, string> = {
            '1': '/employee',
            '2': '/employee/pos',
            '3': '/employee/print-center',
            '4': '/employee/team',
            '5': '/employee/retouch-queue',
          };
          if (navRoutes[e.key]) {
            e.preventDefault();
            this.router.navigate([navRoutes[e.key]]);
            return;
          }
        }

        // Ctrl+Shift+N — new order
        if (e.ctrlKey && e.shiftKey && e.key === 'N') {
          e.preventDefault();
          this.router.navigate(['/employee'], { queryParams: { action: 'new-order' } });
        }
      };
      document.addEventListener('keydown', onKeydown);

      this.destroyRef.onDestroy(() => {
        document.removeEventListener('keydown', onKeydown);
      });
    }
  }

  private loadShiftStatus(): void {
    this.shiftsApi.getDashboard().subscribe({
      next: (res) => {
        if (res.success) {
          const shift = res.data?.shift ?? null;
          this.shiftStatus.set(shift?.status ?? null);
          this.shiftStudio.set(shift ? this.shiftLocationLabel(shift) : null);
        }
      },
      error: () => undefined,
    });
  }

  getShiftLabel(): string {
    const status = this.shiftStatus();
    if (status === 'scheduled') return 'Рабочий день не начат';
    if (status === 'active') return 'Рабочий день активен';
    return status ? shiftStatusLabel(status) : '';
  }

  private shiftLocationLabel(shift: EmployeeShift): string | null {
    if (shift.is_virtual || shift.shift_kind === 'virtual') return 'Пульт';
    return this.compactAddress(shift.studio_address ?? null)
      || this.locationAddress(shift.location_code ?? null)
      || this.stripStudioBrand(shift.studio_name ?? '')
      || null;
  }

  private locationAddress(locationCode: string | null): string {
    switch (locationCode) {
      case 'barrikadnaya-4':
        return '2-ая Баррикадная 4';
      case 'soborny':
      case 'soborny-21':
        return 'Соборный 21';
      default:
        return '';
    }
  }

  private compactAddress(address: string | null): string {
    if (!address) return '';
    return address
      .split(',')[0]
      ?.trim()
      .replace(/^(ул\.?|улица|пер\.?|переулок)\s+/i, '')
      .trim() ?? '';
  }

  private stripStudioBrand(name: string): string {
    return name
      .replace(/^\s*сво[ёе]\s*фото\s*[—–-]?\s*/i, '')
      .trim();
  }

  private openWorkdayWelcome(user: UserProfile): void {
    const dialogRef = this.dialog.open<WorkdayWelcomeDialogComponent, WorkdayWelcomeDialogData, WorkdayWelcomeDialogResult>(
      WorkdayWelcomeDialogComponent,
      {
        data: { name: this.getWorkdayWelcomeName(user), userId: user.id },
        width: '100vw',
        maxWidth: '100vw',
        height: '100vh',
        maxHeight: '100vh',
        disableClose: true,
        closeOnNavigation: false,
        autoFocus: false,
        restoreFocus: false,
        panelClass: ['crm-dialog', 'print-fullscreen-dialog-panel', 'workday-dialog-panel'],
      },
    );

    dialogRef.afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        this.workdayWelcomeDialogOpen = false;

        if (result?.action === 'started') {
          this.workdayStartSkipped.set(false);
          this.loadShiftStatus();
          return;
        }

        if (result?.action === 'skipped') {
          this.workdayStartSkipped.set(true);
        }
      });
  }

  private getWorkdayWelcomeName(user: UserProfile): string {
    const raw = user.first_name || user.display_name || user.displayName || user.email || '';
    const first = raw.trim().split(/\s+/)[0] ?? '';
    return first && !first.includes('@') ? first : 'коллега';
  }

  getUserName(): string {
    const user = this.authService.currentUser();
    return user?.display_name || user?.email || 'Сотрудник';
  }

  getUserRole(): string {
    const role = this.authService.userRole();
    const labels: Record<string, string> = {
      admin: 'Администратор', employee: 'Сотрудник', photographer: 'Фотограф',
    };
    return labels[role || ''] || 'Пользователь';
  }

  getUserInitial(): string {
    const name = this.authService.currentUser()?.display_name || '';
    return name.charAt(0).toUpperCase() || '?';
  }

  getShortName(): string {
    const name = this.authService.currentUser()?.display_name || '';
    return name.split(' ')[0] || '';
  }

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      admin: 'Админ', manager: 'Менеджер', employee: 'Сотрудник', photographer: 'Фотограф',
    };
    return labels[role] || role;
  }

  onLogout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/']);
    });
  }

  formatBookingTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  formatRevenue(value: number): string {
    if (value >= 1000) {
      return Math.round(value).toLocaleString('ru-RU');
    }
    return String(Math.round(value));
  }

  openSearch(): void {
    this.searchExpanded.set(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.search-input');
      input?.focus();
    }, 50);
  }

  closeSearch(): void {
    this.searchExpanded.set(false);
    this.searchQuery.set('');
    this.searchResults.set([]);
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);

    if (value.length < 2) {
      this.searchResults.set([]);
      return;
    }

    this.searchTimeout = setTimeout(() => {
      this.searchService.search(value).subscribe({
        next: (results) => this.searchResults.set(results),
        error: () => this.searchResults.set([]),
      });
    }, 300);
  }

  onSearchBlur(): void {
    // Delay to allow click on results
    setTimeout(() => {
      if (this.searchExpanded() && !this.searchQuery()) {
        this.closeSearch();
      }
      this.searchResults.set([]);
    }, 200);
  }

  goToResult(result: SearchResult): void {
    this.closeSearch();
    this.router.navigateByUrl(result.route);
  }

  resultTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      task: 'Задача', booking: 'Запись', order: 'Заказ', client: 'Клиент',
      chat: 'Чат', note: 'Заметка',
    };
    return labels[type] || type;
  }

  // Mobile search
  openMobileSearch(): void {
    this.mobileSearchOpen.set(true);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.mobile-search-input');
      input?.focus();
    }, 50);
  }

  closeMobileSearch(): void {
    this.mobileSearchOpen.set(false);
    this.searchQuery.set('');
    this.searchResults.set([]);
  }

  clearMobileSearch(): void {
    this.searchQuery.set('');
    this.searchResults.set([]);
  }

  goToMobileResult(result: SearchResult): void {
    this.closeMobileSearch();
    this.router.navigateByUrl(result.route);
  }

  toggleDialer(event: Event): void {
    event.stopPropagation();
    this.dialerOpen.update(v => !v);
    if (this.dialerOpen()) {
      // Close on outside click
      const handler = () => {
        this.dialerOpen.set(false);
        document.removeEventListener('click', handler);
      };
      setTimeout(() => document.addEventListener('click', handler), 0);
    }
  }
}
