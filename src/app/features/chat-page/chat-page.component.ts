import {
  Component,
  inject,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';

import { ChatWidgetComponent } from '../../shared/components/chat-widget/chat-widget.component';
import { MediaGalleryComponent } from './components/media-gallery/media-gallery.component';
import { ServiceOption, SubscriptionPlan } from './components/service-selector/service-selector.component';
import { SubscriptionCheckoutComponent } from './components/subscription-checkout/subscription-checkout.component';
import { UserSidebarComponent } from './components/user-sidebar/user-sidebar.component';
import { CartService } from './services/cart.service';
import { OrderActivityService } from './services/order-activity.service';
import { OrderHubComponent } from './components/order-hub/order-hub.component';
import { ProfileNavSidebarComponent } from '../../shared/components/profile-nav-sidebar/profile-nav-sidebar.component';
import { AuthChatService, type EntryContext } from '../../core/services/auth-chat.service';
import { NavigationService } from '../../core/services/navigation.service';
import { SeoService } from '../../core/services/seo.service';
import { AuthService } from '../../core/services/auth.service';
import { KeyboardLayoutService } from '../../core/services/keyboard-layout.service';
import { getInitialMobileChatMode, type MobileChatMode } from './utils/mobile-chat-flow';

type RightPanelTab = 'chat' | 'media' | 'support';
type SupportCategoryId = 'general' | 'orders' | 'print' | 'documents' | 'retouch' | 'business';

interface SupportCategory {
  readonly id: SupportCategoryId;
  readonly icon: string;
  readonly label: string;
  readonly description: string;
  readonly group: string;
  readonly prompt: string;
}

@Component({
  selector: 'app-chat-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    ChatWidgetComponent,
    MediaGalleryComponent,
    SubscriptionCheckoutComponent,
    UserSidebarComponent,
    OrderHubComponent,
    ProfileNavSidebarComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="online-services-page">
      @if (showOrderAcceptedNotice()) {
        <div class="order-submitted-banner">
          <mat-icon>check_circle</mat-icon>
          <span>Заказ принят. Продолжайте оформление в чате.</span>
        </div>
      }

      @if (isMobile()) {
        <!-- ================================================================ -->
        <!-- MOBILE: контактный экран + отдельный поток чата                  -->
        <!-- ================================================================ -->
        <div
          class="mobile-content"
          [class.mobile-content--home]="mobilePanel() === 'home'"
          [style.padding-bottom.px]="keyboardLayout.keyboardOffset()"
        >
          @if (mobilePanel() === 'home') {
            <section class="mobile-contact-home" aria-label="Связь с поддержкой">
              <header class="mobile-contact-home__head">
                <span class="mobile-contact-home__logo">СФ</span>
                <div>
                  <p>Связь со студией</p>
                  <h1>Чат и менеджеры</h1>
                </div>
              </header>

              <div class="mobile-contact-actions" aria-label="Быстрые действия">
                <button type="button" class="mobile-contact-action" (click)="openMobileSupportCategories()">
                  <span><mat-icon>support_agent</mat-icon></span>
                  <strong>Менеджеры</strong>
                </button>
                <a class="mobile-contact-action" href="tel:+78633226575">
                  <span><mat-icon>call</mat-icon></span>
                  <strong>Звонок</strong>
                </a>
                <button type="button" class="mobile-contact-action" (click)="openMobileThread()">
                  <span><mat-icon>help</mat-icon></span>
                  <strong>Помощь</strong>
                </button>
              </div>

              <section class="mobile-chat-list" aria-label="Чаты">
                <h2>Чаты</h2>
                <button type="button" class="mobile-chat-row" (click)="openMobileThread()">
                  <span class="mobile-chat-row__icon"><mat-icon>chat_bubble</mat-icon></span>
                  <span class="mobile-chat-row__content">
                    <strong>Чат с поддержкой</strong>
                    <small>Фото, заказы, печать и документы</small>
                  </span>
                  <span class="mobile-chat-row__meta">
                    @if (chatService.unreadCount() > 0) {
                      <em>{{ chatService.unreadCount() }}</em>
                    } @else {
                      <mat-icon>chevron_right</mat-icon>
                    }
                  </span>
                </button>
              </section>
            </section>
          } @else {
            <div class="mobile-thread-head">
              <button type="button" class="mobile-thread-head__back" (click)="backToMobileHome()" aria-label="К списку чатов">
                <mat-icon>arrow_back</mat-icon>
              </button>
              <div class="mobile-thread-head__title">
                <strong>Чат с поддержкой</strong>
                <span><mat-icon>bolt</mat-icon> На связи</span>
              </div>
              @if (chatService.notificationPermission() === 'default') {
                <button class="mobile-thread-head__action" type="button" (click)="requestNotifications()" aria-label="Включить уведомления">
                  <mat-icon>notifications</mat-icon>
                </button>
              } @else if (chatService.notificationPermission() === 'denied') {
                <button class="mobile-thread-head__action" type="button" (click)="openNotificationGuide()" aria-label="Настройки уведомлений">
                  <mat-icon>notifications_off</mat-icon>
                </button>
              }
            </div>

            <!-- Info banner, только если чат пустой (нет сообщений) -->
            @if (authService.isAuthenticated() && chatService.messages().length === 0) {
              <div class="chat-onboarding">
                <div class="onboarding-tip">
                  <mat-icon class="tip-icon">lightbulb</mat-icon>
                  <span>
                    <strong>Как это работает:</strong>
                    Напишите в чат или выберите услугу ниже, результат появится в разделе «Мои фото»
                  </span>
                </div>
                <div class="quick-services">
                  <span class="quick-services-title">Популярные услуги:</span>
                  <div class="service-chips">
                    @for (service of quickServices; track service.slug) {
                      <button class="service-chip" (click)="sendQuickService(service)">
                        <mat-icon>{{ service.icon }}</mat-icon>
                        <span>{{ service.label }}</span>
                      </button>
                    }
                  </div>
                </div>
              </div>
            }
            @if (supportRequested()) {
              <div class="mobile-support-panel">
                <div class="mobile-support-panel__title">
                  <mat-icon>support_agent</mat-icon>
                  <span>Выберите менеджера</span>
                </div>
                <div class="support-list">
                  @for (category of supportCategories; track category.id) {
                    <button
                      class="support-card"
                      [class.active]="selectedSupportCategory() === category.id"
                      (click)="selectSupportCategory(category)"
                    >
                      <span class="support-card__icon">
                        <mat-icon>{{ category.icon }}</mat-icon>
                      </span>
                      <span class="support-card__content">
                        <strong>{{ category.label }}</strong>
                        <small>{{ category.description }}</small>
                      </span>
                    </button>
                  }
                </div>
              </div>
            }
            <div class="chat-container">
              <app-chat-widget [embedded]="true" channel="studio" />
            </div>
          }
        </div>

      } @else {
        <!-- ================================================================ -->
        <!-- DESKTOP: 3-зонный layout (sidebar | content | chat)              -->
        <!-- ================================================================ -->
        <div class="desktop-shell" [class.sidebar-open]="sidebarDrawerOpen()">

          <!-- ─── Sidebar backdrop (tablet drawer) ─── -->
          <div class="sidebar-backdrop" (click)="sidebarDrawerOpen.set(false)" (keydown.enter)="sidebarDrawerOpen.set(false)" tabindex="0"></div>

          <!-- ─── LEFT SIDEBAR: User panel ─── -->
          <aside class="left-sidebar">
            <!-- Close button (tablet drawer only) -->
            <button class="sidebar-close-btn" (click)="sidebarDrawerOpen.set(false)" aria-label="Закрыть">
              <mat-icon>close</mat-icon>
            </button>
            <div class="sidebar-body">
              @defer (on idle) {
                @if (authService.isAuthenticated()) {
                  <app-profile-nav-sidebar />
                } @else {
                  <app-user-sidebar />
                }
              } @placeholder {
                <div class="sidebar-placeholder"></div>
              }
            </div>
          </aside>

          <!-- ─── CENTER: Scrollable content ─── -->
          <main class="content-area">
            <div class="content-inner">
              @defer (on idle) {
                <app-order-hub (orderConfigured)="onOrderConfigured($event)" />
              } @placeholder {
                <div class="orderhub-placeholder"><div class="placeholder-shimmer"></div></div>
              }
            </div>
          </main>

          <!-- ─── RIGHT: Chat + Media ─── -->
          <aside class="right-panel">
            <!-- Right panel header -->
            <div class="right-header">
              <!-- Sidebar toggle (tablet mode only, shown via CSS) -->
              <button class="sidebar-toggle-btn" (click)="toggleSidebar()" aria-label="Боковая панель">
                <mat-icon>{{ sidebarDrawerOpen() ? 'close' : 'menu' }}</mat-icon>
              </button>
              <div class="right-tabs">
                <button
                  class="right-tab"
                  [class.active]="rightTab() === 'chat'"
                  (click)="rightTab.set('chat')"
                >
                  <mat-icon>chat</mat-icon>
                  <span>Чат</span>
                  @if (chatService.unreadCount() > 0) {
                    <span class="tab-badge">{{ chatService.unreadCount() }}</span>
                  }
                </button>
                <button
                  class="right-tab"
                  [class.active]="rightTab() === 'media'"
                  (click)="rightTab.set('media')"
                >
                  <mat-icon>photo_library</mat-icon>
                  <span>Фото</span>
                  @if (mediaCount() > 0) {
                    <span class="tab-badge">{{ mediaCount() }}</span>
                  }
                </button>
                <button
                  class="right-tab"
                  [class.active]="rightTab() === 'support'"
                  (click)="rightTab.set('support')"
                >
                  <mat-icon>support_agent</mat-icon>
                  <span>Менеджер</span>
                </button>
              </div>
              <div class="right-header-actions">
                @if (chatService.notificationPermission() === 'default') {
                  <button class="action-btn" (click)="requestNotifications()" title="Включить уведомления">
                    <mat-icon>notifications</mat-icon>
                  </button>
                } @else if (chatService.notificationPermission() === 'denied') {
                  <button class="action-btn" (click)="openNotificationGuide()" title="Уведомления заблокированы">
                    <mat-icon>notifications_off</mat-icon>
                  </button>
                }
                @if (cartService.itemCount() > 0) {
                  <button class="action-btn cart-header-btn" (click)="cartService.open()">
                    <mat-icon>shopping_cart</mat-icon>
                    <span class="badge">{{ cartService.itemCount() }}</span>
                  </button>
                }
              </div>
            </div>

            <!-- Right panel content -->
            <div class="right-content">
              @if (rightTab() === 'chat') {
                <app-chat-widget [embedded]="true" [hideGallery]="true" channel="studio" />
              } @else if (rightTab() === 'support') {
                <div class="support-panel">
                  <div class="support-panel__head">
                    <span class="support-panel__icon">
                      <mat-icon>support_agent</mat-icon>
                    </span>
                    <div>
                      <h4>Менеджеры</h4>
                      <p>Выберите направление, чтобы обращение попало к нужной команде.</p>
                    </div>
                  </div>

                  <div class="support-list">
                    @for (category of supportCategories; track category.id) {
                      <button
                        class="support-card"
                        [class.active]="selectedSupportCategory() === category.id"
                        (click)="selectSupportCategory(category)"
                      >
                        <span class="support-card__icon">
                          <mat-icon>{{ category.icon }}</mat-icon>
                        </span>
                        <span class="support-card__content">
                          <strong>{{ category.label }}</strong>
                          <small>{{ category.description }}</small>
                        </span>
                        <mat-icon class="support-card__chevron">chevron_right</mat-icon>
                      </button>
                    }
                  </div>
                </div>
              } @else {
                <div class="media-panel">
                  @if (mediaCount() === 0) {
                    <div class="media-placeholder">
                      <mat-icon class="placeholder-icon">image_search</mat-icon>
                      <h4>Здесь появятся ваши фото</h4>
                      <p>После обработки заказа результаты отобразятся в этом разделе.</p>
                      <div class="placeholder-steps">
                        <div class="step">
                          <span class="step-num">1</span>
                          <span>Выберите услугу</span>
                        </div>
                        <div class="step">
                          <span class="step-num">2</span>
                          <span>Отправьте фото в чат</span>
                        </div>
                        <div class="step">
                          <span class="step-num">3</span>
                          <span>Получите результат здесь</span>
                        </div>
                      </div>
                    </div>
                  } @else {
                    @defer (on idle) {
                      <app-media-gallery [messages]="chatService.messages()" />
                    } @placeholder {
                      <div class="placeholder-shimmer" style="height: 120px;"></div>
                    }
                  }
                </div>
              }
            </div>
          </aside>

        </div>
      }

      <!-- Оформление подписки (overlay) -->
      @defer (when selectedPlan()) {
        <app-subscription-checkout
          [plan]="selectedPlan()"
          (closed)="selectedPlan.set(null)"
          (success)="onSubscriptionSuccess($event)"
        />
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      color-scheme: light;
      background: #f1f2f4;
      color: #20242a;
      --ed-surface: #f1f2f4;
      --ed-surface-dim: #e9ecf1;
      --ed-surface-container: #ffffff;
      --ed-surface-container-high: #f7f8fa;
      --ed-surface-container-highest: #eef1f5;
      --ed-on-surface: #20242a;
      --ed-on-surface-variant: #737985;
      --ed-on-surface-muted: #9aa1ac;
      --ed-outline: #cbd2dc;
      --ed-outline-variant: #dfe3e8;
      --ed-accent: #ef3124;
      --ed-accent-hover: #d92b20;
      --ed-accent-dim: #b9231a;
      --ed-on-accent: #ffffff;
      --ed-accent-container: #ffe8e4;
      --ed-on-accent-container: #7a150f;
      --ed-success: #20c26b;
      --ed-on-success: #ffffff;
    }

    .online-services-page {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #f1f2f4;
    }

    .order-submitted-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: #e8f8ef;
      border-bottom: 1px solid #c7efd8;
      color: #17663a;
      font-size: 0.85rem;
      line-height: 1.35;
      flex-shrink: 0;

      mat-icon {
        color: #22c55e;
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
      }
    }

    /* ============================================================ */
    /* DESKTOP SHELL                                                  */
    /* ============================================================ */

    .desktop-shell {
      display: grid;
      grid-template-columns: 280px 1fr 380px;
      grid-template-rows: 100dvh;
      height: 100dvh;
      overflow: hidden;
      background: #f1f2f4;
    }

    /* ─── LEFT SIDEBAR ─── */
    .left-sidebar {
      display: flex;
      flex-direction: column;
      position: relative;
      background: #ffffff;
      border-right: 1px solid #dfe3e8;
      overflow: hidden;
    }

    .sidebar-body {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 0;

      scrollbar-width: thin;
      scrollbar-color: #cbd2dc transparent;

      &::-webkit-scrollbar {
        width: 4px;
      }
      &::-webkit-scrollbar-track {
        background: transparent;
      }
      &::-webkit-scrollbar-thumb {
        background: #cbd2dc;
        border-radius: 2px;
      }
    }

    /* ─── CENTER CONTENT ─── */
    .content-area {
      overflow-y: auto;
      overflow-x: hidden;
      background: #f1f2f4;
      padding: 0;

      scrollbar-width: thin;
      scrollbar-color: #cbd2dc transparent;

      &::-webkit-scrollbar {
        width: 6px;
      }
      &::-webkit-scrollbar-track {
        background: transparent;
      }
      &::-webkit-scrollbar-thumb {
        background: #cbd2dc;
        border-radius: 3px;
      }
    }

    /* Внутренний контейнер центральной области с padding */
    .content-inner {
      padding: 20px 28px 48px;
    }


    /* ─── RIGHT PANEL ─── */
    .right-panel {
      display: flex;
      flex-direction: column;
      background: #ffffff;
      border-left: 1px solid #dfe3e8;
      overflow: hidden;
    }

    .right-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid #dfe3e8;
      background: #ffffff;
      flex-shrink: 0;
      min-height: 56px;
    }

    .right-tabs {
      display: flex;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      padding: 4px;
      border-radius: 10px;
      background: #f1f2f4;
    }

    .right-tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #737985;
      font-size: 0.82rem;
      font-weight: 800;
      cursor: pointer;
      position: relative;
      transition: background 0.15s, color 0.15s;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        background: #ffffff;
        color: #20242a;
      }

      &.active {
        background: #ffffff;
        color: #ef3124;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
      }
    }

    .right-header-actions {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }

    .tab-badge {
      position: absolute;
      top: 2px;
      right: 2px;
      background: #ef3124;
      color: #ffffff;
      font-size: 0.6rem;
      padding: 1px 4px;
      border-radius: 100px;
      font-weight: 700;
      line-height: 1.4;
    }

    .right-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .right-content app-chat-widget {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .media-panel {
      flex: 1;
      overflow-y: auto;
    }

    .support-panel {
      flex: 1;
      overflow-y: auto;
      padding: 18px;
    }

    .support-panel__head {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 18px;
    }

    .support-panel__icon {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: #ffe8e4;
      color: #ef3124;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
    }

    .support-panel h4 {
      margin: 0 0 6px;
      font-size: 1.05rem;
      line-height: 1.2;
      color: #20242a;
    }

    .support-panel p {
      margin: 0;
      font-size: 0.82rem;
      line-height: 1.45;
      color: #737985;
    }

    .support-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .support-card {
      width: 100%;
      min-height: 72px;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
      gap: 12px;
      padding: 12px;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      background: #ffffff;
      color: #20242a;
      text-align: left;
      cursor: pointer;
      transition: border-color 0.18s ease, background 0.18s ease, transform 0.18s ease;

      &:hover,
      &.active {
        border-color: #ef3124;
        background: #fff4f2;
      }

      &:hover {
        transform: translateY(-1px);
      }
    }

    .support-card__icon {
      width: 42px;
      height: 42px;
      border-radius: 8px;
      background: #f1f2f4;
      color: #ef3124;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
      }
    }

    .support-card__content {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .support-card__content strong {
      font-size: 0.9rem;
      line-height: 1.2;
      color: #20242a;
    }

    .support-card__content small {
      font-size: 0.76rem;
      line-height: 1.35;
      color: #737985;
    }

    .support-card__chevron {
      color: #9aa1ac;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    /* ─── Action buttons (shared) ─── */
    .action-btn {
      position: relative;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 50%;
      background: #f1f2f4;
      color: #20242a;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover {
        background: #e3e6eb;
      }
    }

    .action-btn .badge {
      position: absolute;
      top: -2px;
      right: -2px;
      background: #ef3124;
      color: #ffffff;
      font-size: 0.6rem;
      padding: 1px 4px;
      border-radius: 100px;
      font-weight: 700;
    }

    .cart-header-btn {
      background: #ffe8e4;
      color: #ef3124;
    }

    /* ─── Media Placeholder ─── */
    .media-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 20px;
      text-align: center;
      height: 100%;
      min-height: 300px;
    }

    .placeholder-icon {
      font-size: 48px !important;
      width: 48px !important;
      height: 48px !important;
      color: #cbd2dc;
      margin-bottom: 16px;
    }

    .media-placeholder h4 {
      font-size: 0.95rem;
      font-weight: 600;
      color: #20242a;
      margin: 0 0 8px 0;
    }

    .media-placeholder p {
      font-size: 0.8rem;
      color: #737985;
      margin: 0 0 20px 0;
      line-height: 1.5;
    }

    .placeholder-steps {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      max-width: 200px;
    }

    .step {
      display: flex;
      align-items: center;
      gap: 8px;
      text-align: left;
      font-size: 0.8rem;
      color: #737985;
    }

    .step-num {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #ef3124;
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* ============================================================ */
    /* MOBILE                                                         */
    /* ============================================================ */


    .mobile-content {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: #f1f2f4;
    }

    .mobile-content--home {
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }

    .mobile-contact-home {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 26px;
      padding: calc(24px + env(safe-area-inset-top, 0px)) 20px 24px;
      background: #f1f2f4;
    }

    .mobile-contact-home__head {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
    }

    .mobile-contact-home__logo {
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border-radius: 50%;
      background: #ef3124;
      color: #ffffff;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
    }

    .mobile-contact-home__head p {
      margin: 0 0 2px;
      color: #737985;
      font-size: 13px;
      line-height: 1.25;
    }

    .mobile-contact-home__head h1 {
      margin: 0;
      color: #20242a;
      font-size: 30px;
      font-weight: 800;
      line-height: 1.12;
      letter-spacing: 0;
    }

    .mobile-contact-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .mobile-contact-action {
      min-width: 0;
      border: 0;
      background: transparent;
      color: #20242a;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      font: inherit;
    }

    .mobile-contact-action span {
      display: grid;
      width: 48px;
      height: 48px;
      margin: 0 auto 8px;
      place-items: center;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);

      mat-icon {
        color: #20242a;
        font-size: 23px;
        width: 23px;
        height: 23px;
      }
    }

    .mobile-contact-action strong {
      display: block;
      overflow: hidden;
      color: #3b4048;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mobile-chat-list {
      display: grid;
      gap: 10px;
      padding: 20px;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    .mobile-chat-list h2 {
      margin: 0;
      color: #20242a;
      font-size: 15px;
      font-weight: 800;
      line-height: 1.3;
    }

    .mobile-chat-row {
      width: 100%;
      display: grid;
      grid-template-columns: 42px minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 8px 0;
      border: 0;
      background: transparent;
      color: #20242a;
      text-align: left;
      cursor: pointer;
      font: inherit;
    }

    .mobile-chat-row__icon {
      display: grid;
      width: 38px;
      height: 38px;
      place-items: center;
      border-radius: 8px;
      background: #f1f2f4;
      color: #20242a;

      mat-icon {
        font-size: 21px;
        width: 21px;
        height: 21px;
      }
    }

    .mobile-chat-row__content {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .mobile-chat-row__content strong {
      overflow: hidden;
      color: #20242a;
      font-size: 15px;
      font-weight: 600;
      line-height: 1.3;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mobile-chat-row__content small {
      overflow: hidden;
      color: #737985;
      font-size: 13px;
      line-height: 1.35;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mobile-chat-row__meta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #9aa1ac;

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
      }

      em {
        min-width: 20px;
        padding: 2px 6px;
        border-radius: 999px;
        background: #ef3124;
        color: #ffffff;
        font-size: 11px;
        font-style: normal;
        font-weight: 800;
        line-height: 1.3;
        text-align: center;
      }
    }

    .mobile-thread-head {
      position: sticky;
      top: 0;
      z-index: 5;
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) 48px;
      align-items: center;
      min-height: 58px;
      padding: env(safe-area-inset-top, 0px) 8px 0;
      border-bottom: 1px solid #dfe3e8;
      background: #ffffff;
      color: #20242a;
      flex-shrink: 0;
    }

    .mobile-thread-head__back,
    .mobile-thread-head__action {
      display: grid;
      width: 40px;
      height: 40px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #20242a;
      cursor: pointer;
    }

    .mobile-thread-head__action {
      justify-self: end;
      color: #737985;
    }

    .mobile-thread-head__title {
      display: grid;
      gap: 2px;
      min-width: 0;
      text-align: center;
    }

    .mobile-thread-head__title strong {
      overflow: hidden;
      color: #20242a;
      font-size: 16px;
      font-weight: 800;
      line-height: 1.25;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .mobile-thread-head__title span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 3px;
      color: #737985;
      font-size: 12px;
      line-height: 1.2;

      mat-icon {
        color: #20c26b;
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    .scroll-container {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
    }

    .chat-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
    }

    .chat-container app-chat-widget {
      flex: 1;
      display: flex;
      min-height: 0;
    }

    .mobile-support-panel {
      flex-shrink: 0;
      padding: 12px 16px;
      background: #ffffff;
      border-bottom: 1px solid #dfe3e8;
    }

    .mobile-support-panel__title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      color: #20242a;
      font-size: 13px;
      font-weight: 700;

      mat-icon {
        color: #ef3124;
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .mobile-support-panel .support-card {
      grid-template-columns: auto minmax(0, 1fr);
      min-height: 64px;
    }

    /* ─── Chat Onboarding ─── */
    .chat-onboarding {
      flex-shrink: 0;
      padding: 12px 16px;
      background: #ffffff;
      border-bottom: 1px solid #dfe3e8;
    }

    .onboarding-tip {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 13px;
      color: #737985;
      line-height: 1.4;
      margin-bottom: 12px;
    }

    .onboarding-tip strong {
      color: #20242a;
    }

    .tip-icon {
      color: #ef3124;
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .quick-services-title {
      font-size: 12px;
      font-weight: 600;
      color: #737985;
      letter-spacing: 0;
      display: block;
      margin-bottom: 8px;
    }

    .service-chips {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .service-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1px solid #dfe3e8;
      border-radius: 8px;
      background: #ffffff;
      color: #20242a;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1)) 200ms,
                  border-color var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1)) 200ms;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: #ef3124;
      }

      &:hover {
        background: #fff4f2;
        border-color: #ef3124;
      }
    }

    /* ============================================================ */
    /* RESPONSIVE                                                     */
    /* ============================================================ */

    @media (max-width: 1400px) {
      .desktop-shell {
        grid-template-columns: 260px 1fr 360px;
      }
    }

    @media (max-width: 1200px) {
      .desktop-shell {
        grid-template-columns: 240px 1fr 340px;
      }
    }

    /* ─── Sidebar close button (hidden on desktop) ─── */
    .sidebar-close-btn {
      display: none;
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 2;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: 6px;
      background: #ffffff;
      color: #737985;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
      transition: background 0.15s;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        background: #f1f2f4;
        color: #20242a;
      }
    }

    /* ─── Sidebar toggle button (hidden on desktop) ─── */
    .sidebar-toggle-btn {
      display: none;
      width: 36px;
      height: 36px;
      border: none;
      border-radius: 8px;
      background: #f1f2f4;
      color: #20242a;
      cursor: pointer;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.15s;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover {
        background: #e3e6eb;
      }
    }

    /* ─── Sidebar backdrop (tablet drawer) ─── */
    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.35);
      z-index: 99;
      backdrop-filter: blur(2px);
      cursor: pointer;
    }

    /* ─── Tablet: sidebar → drawer (601px, 1100px) ─── */
    @media (max-width: 1100px) {
      .desktop-shell {
        grid-template-columns: 1fr 360px;
        position: relative;
      }

      .left-sidebar {
        position: fixed;
        left: 0;
        top: 0;
        height: 100dvh;
        z-index: 100;
        width: 280px;
        transform: translateX(-100%);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 12px 0 34px rgba(15, 23, 42, 0.18);
      }

      .sidebar-open .left-sidebar {
        transform: translateX(0);
      }

      .sidebar-open .sidebar-backdrop {
        display: block;
      }

      .sidebar-toggle-btn {
        display: flex;
      }

      .sidebar-close-btn {
        display: flex;
      }
    }

    @media (max-width: 800px) {
      .desktop-shell {
        grid-template-columns: 1fr 320px;
      }
    }

    .sidebar-placeholder {
      height: 100%;
      background: #ffffff;
    }

    .orderhub-placeholder {
      padding: 24px;
    }

    .placeholder-shimmer {
      height: 200px;
      border-radius: 8px;
      background: linear-gradient(90deg, #e9ecf1 25%, #f7f8fa 50%, #e9ecf1 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s infinite;
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `],
})
export class ChatPageComponent implements OnInit, OnDestroy {
  private platformId = inject(PLATFORM_ID);
  private seoService = inject(SeoService);
  private navigationService = inject(NavigationService);
  private route = inject(ActivatedRoute);
  chatService = inject(AuthChatService);
  cartService = inject(CartService);
  readonly authService = inject(AuthService);
  readonly keyboardLayout = inject(KeyboardLayoutService);
  readonly orderActivity = inject(OrderActivityService);
  private dialog = inject(MatDialog);

  rightTab = signal<RightPanelTab>('chat');
  sidebarDrawerOpen = signal(false);
  mobilePanel = signal<MobileChatMode>('home');
  readonly isMobile = computed(() => this.navigationService.isMobile());
  selectedService = signal<ServiceOption | null>(null);
  selectedPlan = signal<SubscriptionPlan | null>(null);
  showOrderAcceptedNotice = signal(false);
  selectedSupportCategory = signal<SupportCategoryId | null>(null);
  supportRequested = signal(false);

  mediaCount = computed(() => {
    return this.chatService.messages().filter(m => m.message_type === 'image').length;
  });

  readonly quickServices = [
    { slug: 'foto-na-documenty', icon: 'badge', label: 'Фото на документы' },
    { slug: 'retush', icon: 'auto_fix_high', label: 'Ретушь фото' },
    { slug: 'pechat', icon: 'print', label: 'Печать фото' },
    { slug: 'restavratsiya', icon: 'healing', label: 'Реставрация' },
  ];

  readonly supportCategories: readonly SupportCategory[] = [
    {
      id: 'general',
      icon: 'support_agent',
      label: 'Общий менеджер',
      description: 'Подбор услуги и оформление обращения',
      group: 'front-office',
      prompt: 'Нужен менеджер: помогите выбрать услугу и оформить заказ.',
    },
    {
      id: 'orders',
      icon: 'receipt_long',
      label: 'Заказы',
      description: 'Статус, сроки, детали оформления',
      group: 'orders',
      prompt: 'Нужен менеджер по заказу: хочу уточнить статус, сроки или детали оформления.',
    },
    {
      id: 'print',
      icon: 'print',
      label: 'Печать',
      description: 'Формат, бумага, тираж и готовность',
      group: 'print-lab',
      prompt: 'Нужен менеджер по печати: нужно подобрать формат, бумагу и тираж.',
    },
    {
      id: 'documents',
      icon: 'badge',
      label: 'Документы',
      description: 'Фото на документы, сканы и копии',
      group: 'documents',
      prompt: 'Нужен менеджер по документам: нужно подготовить фото, сканы или копии.',
    },
    {
      id: 'retouch',
      icon: 'auto_fix_high',
      label: 'Ретушь',
      description: 'Оценка обработки и восстановление фото',
      group: 'retouch',
      prompt: 'Нужен менеджер по ретуши: нужно оценить обработку фотографии.',
    },
    {
      id: 'business',
      icon: 'business_center',
      label: 'Бизнес',
      description: 'Регулярная печать и корпоративные задачи',
      group: 'business',
      prompt: 'Нужен менеджер для бизнес-задачи: регулярная печать, документы или корпоративный заказ.',
    },
  ];

  private cartOrderHandler?: (e: Event) => void;

  ngOnInit(): void {
    this.setupSEO();

    if (isPlatformBrowser(this.platformId)) {
      let hasAcceptedOrderNotice = false;
      try {
        if (sessionStorage.getItem('chatOrderSubmitted') === '1') {
          sessionStorage.removeItem('chatOrderSubmitted');
          // Загружаем заказы немедленно
          this.orderActivity.loadOrders();
          // Показываем баннер
          this.showOrderAcceptedNotice.set(true);
          hasAcceptedOrderNotice = true;
          setTimeout(() => this.showOrderAcceptedNotice.set(false), 8000);
        }
      } catch { void 0; }

      // Проверяем query param ?session= для открытия конкретной сессии
      const sessionId = this.route.snapshot.queryParamMap.get('session');
      const support = this.route.snapshot.queryParamMap.get('support');
      const initialMobileMode = getInitialMobileChatMode({
        isMobile: this.isMobileViewport(),
        hasAcceptedOrderNotice,
        sessionId,
        support,
      });
      this.mobilePanel.set(initialMobileMode);

      if (sessionId) {
        this.chatService.openChatWithSession(sessionId);
      } else if (initialMobileMode === 'thread') {
        // Fast path: UI мгновенно, сессия создаётся при первом сообщении
        this.chatService.ensureChatOpen();
      }

      if (support === 'manager') {
        this.openSupportCategories();
        const selectedCategory = this.findSupportCategory(this.route.snapshot.queryParamMap.get('topic'));
        if (selectedCategory) {
          this.selectedSupportCategory.set(selectedCategory.id);
        }
      }

      // Обработка заказа через чат из корзины
      this.cartOrderHandler = (e: Event) => {
        const message = (e as CustomEvent<string>).detail;
        if (message) {
          this.mobilePanel.set('thread');
          this.chatService.sendMessage(message);
        }
      };
      window.addEventListener('cart:orderViaChat', this.cartOrderHandler);
    }
  }

  ngOnDestroy(): void {
    this.chatService.closeChat();
    if (this.cartOrderHandler) {
      window.removeEventListener('cart:orderViaChat', this.cartOrderHandler);
    }
  }

  private setupSEO(): void {
    this.seoService.updateTitle('Онлайн-кабинет, заказ фото, чат со специалистом | Своё Фото');
    this.seoService.updateDescription('Онлайн-кабинет Своё Фото: закажите фото на документы, свяжитесь со специалистом в чате, получите результат онлайн.');
    this.seoService.updateCanonicalUrl('/chat');
  }

  private isMobileViewport(): boolean {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 599px)').matches
      : this.isMobile();
  }

  openMobileThread(): void {
    this.mobilePanel.set('thread');
    this.supportRequested.set(false);
    this.rightTab.set('chat');
    this.chatService.ensureChatOpen();
  }

  openMobileSupportCategories(): void {
    this.mobilePanel.set('thread');
    this.openSupportCategories();
    this.chatService.ensureChatOpen();
  }

  backToMobileHome(): void {
    this.supportRequested.set(false);
    this.mobilePanel.set('home');
  }

  onServiceSelected(service: ServiceOption): void {
    this.mobilePanel.set('thread');
    this.selectedService.set(service);
    const message = `Хочу заказать: ${service.name} за ${service.price}₽`;
    this.chatService.sendMessage(message);
  }

  onOrderConfigured(event: { categorySlug: string; message: string }): void {
    this.mobilePanel.set('thread');
    this.chatService.sendMessage(event.message);
    // Переключаем на таб чата чтобы пользователь видел что сообщение отправлено
    this.rightTab.set('chat');
  }

  onPlanSelected(plan: SubscriptionPlan): void {
    this.selectedPlan.set(plan);
  }

  onSubscriptionSuccess(subscriptionId: string): void {
    const plan = this.selectedPlan();
    if (plan) {
      this.mobilePanel.set('thread');
      this.chatService.sendMessage(
        `Оформлена подписка «${plan.name}» (${plan.base_price.toLocaleString('ru-RU')}₽/мес). ID: ${subscriptionId}`
      );
    }
    this.selectedPlan.set(null);
  }

  sendQuickService(service: { slug: string; label: string }): void {
    this.mobilePanel.set('thread');
    this.chatService.sendMessage(`Хочу заказать: ${service.label}`);
  }

  openSupportCategories(): void {
    this.mobilePanel.set('thread');
    this.supportRequested.set(true);
    this.rightTab.set('support');
  }

  async selectSupportCategory(category: SupportCategory): Promise<void> {
    this.selectedSupportCategory.set(category.id);
    this.supportRequested.set(false);
    this.rightTab.set('chat');
    this.mobilePanel.set('thread');

    const entryContext: EntryContext = {
      category: category.id,
      supportGroup: category.group,
      customerNote: category.prompt,
    };

    try {
      await this.chatService.openChat({
        service: `Поддержка: ${category.label}`,
        price: 0,
        pageUrl: '/chat',
        channel: 'studio',
        entryContext,
      });
    } catch {
      this.chatService.ensureChatOpen();
    }

    await this.chatService.sendMessage(category.prompt);
  }

  private findSupportCategory(categoryId: string | null): SupportCategory | undefined {
    return this.supportCategories.find(category => category.id === categoryId);
  }

  toggleSidebar(): void {
    this.sidebarDrawerOpen.set(!this.sidebarDrawerOpen());
  }

  requestNotifications(): void {
    this.chatService.requestNotifications();
  }

  async openNotificationGuide(): Promise<void> {
    const { NotificationGuideDialogComponent } = await import(
      '../../shared/components/notification-guide-dialog/notification-guide-dialog.component'
    );
    this.dialog.open(NotificationGuideDialogComponent, {
      width: '100vw',
      height: '100vh',
      maxWidth: '100vw',
      hasBackdrop: false,
      data: { permission: this.chatService.notificationPermission() },
    });
  }

  addChatOrderToCart(price: number, tariff?: string, document?: string, nextPrice?: number, openCart = true): void {
    if (!price || price <= 0) return;
    const name = tariff || 'Фото на документы';
    const serviceId = `photo-${(tariff || 'default').toLowerCase().replace(/[^a-zа-яё0-9]/gi, '-')}`;
    this.cartService.addItem({
      id: serviceId,
      name,
      description: document ? `Документ: ${document}` : 'Фото на документы',
      price,
      icon: 'photo_camera',
      nextPrice: nextPrice && nextPrice !== price ? nextPrice : undefined,
    });
    if (openCart) {
      this.cartService.open();
    }
  }
}
