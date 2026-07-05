import { Component, inject, signal, computed, viewChild, ChangeDetectionStrategy, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { BreakpointObserver } from '@angular/cdk/layout';
import { InboxService } from '../../services/inbox.service';
import { InboxItem } from '../../models/inbox.model';
import { EmailMessage } from '../../models/email.model';
import { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';
import { InboxPanelComponent } from '../inbox-panel/inbox-panel.component';
import { DetailPanelComponent } from '../detail-panel/detail-panel.component';
import { ClientProfilePanelComponent } from '../client-profile-panel/client-profile-panel.component';
import { DashboardSidebarComponent } from '../dashboard-view/dashboard-sidebar.component';
import { EmailPanelComponent } from '../email-panel/email-panel.component';
import { EmailDetailViewComponent } from '../email-panel/email-detail-view.component';
import { OrderMiniChatComponent } from '../detail-panel/order-mini-chat.component';
import { PosComponent } from '../pos/pos.component';
import { OrderCreationFormComponent } from '../order-creation-form/order-creation-form.component';
import { StudentVerificationReviewComponent } from '../student-verifications/student-verification-review.component';

type MobileTab = 'inbox' | 'email' | 'detail' | 'client';
type LeftView = 'inbox' | 'email' | 'order-chat';

interface PendingCartItemsEvent {
  readonly id: number;
  readonly items: SyncCartItem[];
}

@Component({
  selector: 'app-workspace',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatBadgeModule,
    InboxPanelComponent,
    DetailPanelComponent,
    ClientProfilePanelComponent,
    DashboardSidebarComponent,
    EmailPanelComponent,
    EmailDetailViewComponent,
    OrderMiniChatComponent,
    PosComponent,
    OrderCreationFormComponent,
    StudentVerificationReviewComponent,
  ],
  template: `
    <div
      class="workspace"
      [class.desktop]="isDesktop()"
      [class.chat-order-panel-open]="showChatOrderPanel()"
      [class.photo-workspace-focus]="photoWorkspaceFocus()">
      @if (isDesktop()) {
        <!-- Desktop: 3 columns -->
        <div class="col inbox-col" [class.inbox-col--collapsed]="leftCollapsed()">
          @if (leftCollapsed()) {
            <!-- Collapsed: just a toggle button -->
            <button class="collapsed-toggle" (click)="leftCollapsed.set(false); leftView.set('inbox')" matTooltip="Открыть входящие">
              <mat-icon>chevron_right</mat-icon>
              @if (inboxService.totalCount()) {
                <span class="lt-badge">{{ inboxService.totalCount() }}</span>
              }
            </button>
          } @else if (leftView() === 'order-chat' && orderChatSessionId()) {
            <!-- Mini-chat for the linked order -->
            <app-order-mini-chat [sessionId]="orderChatSessionId()!" />
          } @else {
            <!-- Left-panel toggle: Inbox / Email -->
            <div class="left-toggle">
              <button class="lt-btn" [class.lt-active]="leftView() === 'inbox'"
                      (click)="switchToInbox()">
                <mat-icon>inbox</mat-icon>
                <span>Входящие</span>
                @if (inboxService.totalCount()) {
                  <span class="lt-badge">{{ inboxService.totalCount() }}</span>
                }
              </button>
              <button class="lt-btn" [class.lt-active]="leftView() === 'email'"
                      (click)="leftView.set('email')">
                <mat-icon>mail</mat-icon>
                <span>Почта</span>
                @if (emailUnread()) {
                  <span class="lt-badge lt-badge--email">{{ emailUnread() }}</span>
                }
              </button>
            </div>
            @if (leftView() === 'inbox') {
              <app-inbox-panel
                [selectedId]="selectedItemId()"
                (itemSelected)="onItemSelected($event)" />
            } @else {
              <app-email-panel
                [selectedId]="selectedEmailId()"
                (emailSelected)="onEmailSelected($event)"
                (composeRequested)="onEmailComposeRequested()"
                (unreadCountChanged)="emailUnread.set($event)" />
            }
          }
        </div>

        <!-- Center column -->
        <div class="col detail-col">
          @if (showCreateOrder()) {
            <app-order-creation-form
              [dialogClientName]="selectedItem()?.clientName ?? ''"
              [dialogPhone]="activeClientPhone() ?? ''"
              [dialogSessionId]="activeSessionId() ?? ''"
              (closed)="showCreateOrder.set(false)" />
          } @else if (showPos()) {
            <div class="pos-inline-header">
              <button class="pos-back-btn" (click)="showPos.set(false)">
                <mat-icon>arrow_back</mat-icon>
                <span>Пульт</span>
              </button>
            </div>
            <app-pos />
          } @else if (showStudentVerification()) {
            <div class="pos-inline-header">
              <button class="pos-back-btn" (click)="showStudentVerification.set(false)">
                <mat-icon>arrow_back</mat-icon>
                <span>Пульт</span>
              </button>
            </div>
            <app-student-verification-review />
          } @else if (leftView() === 'email') {
            <app-email-detail-view
              [emailId]="selectedEmail()?.id ?? null"
              (back)="deselectEmail()"
              (clientPhoneResolved)="onClientPhone($event)"
              (emailArchived)="onEmailArchived($event)"
              (emailReplied)="onEmailReplied($event)"
              (composeClosed)="onEmailComposeClosed()" />
          } @else {
            <app-detail-panel
              [item]="selectedItem()"
              (clientPhoneResolved)="onClientPhone($event)"
              (clientUserIdResolved)="onClientUserId($event)"
              (clientContactIdResolved)="onClientContactId($event)"
              (back)="deselectItem()"
              (selectItem)="onDashboardSelectItem($event)"
              (createTask)="onCreateTask()"
              (createOrder)="onCreateOrder()"
              (openDialer)="onOpenDialer()"
              (openPos)="showPos.set(true)"
              (openStudentVerification)="showStudentVerification.set(true)"
              (orderChatSession)="onOrderChatSession($event)"
              (cartItemsToAdd)="onCartItems($event)"
              (createOrderFromChat)="onCreateOrderFromChat()"
              (photoWorkspaceFocusChange)="onPhotoWorkspaceFocusChange($event)" />
          }
        </div>

        <!-- Right column -->
        <div class="col client-col">
          @if (showChatOrderPanel() && selectedItem()?.type === 'chat') {
            <app-order-creation-form
              [dialogClientName]="selectedItem()?.clientName ?? ''"
              [dialogPhone]="activeClientPhone() ?? ''"
              [dialogSessionId]="activeSessionId() ?? ''"
              (closed)="closeChatOrderPanel()"
              (orderCreated)="closeChatOrderPanel()" />
          } @else if (selectedItem() || selectedEmail()) {
            <app-client-profile-panel
              [clientPhone]="activeClientPhone()"
              [clientUserId]="activeClientUserId()"
              [clientContactId]="activeClientContactId()"
              [sessionId]="activeSessionId()"
              [pendingCartItems]="pendingCartItems()" />
          } @else {
            <app-dashboard-sidebar />
          }
        </div>

      } @else {
        <!-- Mobile: tab-based -->
        <div class="mobile-content">
          @switch (activeTab()) {
            @case ('inbox') {
              <app-inbox-panel
                [selectedId]="selectedItemId()"
                (itemSelected)="onMobileItemSelected($event)" />
            }
            @case ('email') {
              <app-email-panel
                [selectedId]="selectedEmailId()"
                (emailSelected)="onMobileEmailSelected($event)"
                (composeRequested)="onEmailComposeRequested()"
                (unreadCountChanged)="emailUnread.set($event)" />
            }
            @case ('detail') {
              @if (selectedEmail() || emailComposeRequested()) {
                <app-email-detail-view
                  [emailId]="selectedEmail()?.id ?? null"
                  (back)="goBack()"
                  (clientPhoneResolved)="onClientPhone($event)"
                  (emailArchived)="onEmailArchived($event)"
                  (emailReplied)="onEmailReplied($event)"
                  (composeClosed)="onEmailComposeClosed()" />
              } @else {
                <div class="mobile-detail-header">
                  <button mat-icon-button (click)="goBack()">
                    <mat-icon>arrow_back</mat-icon>
                  </button>
                  <span class="mobile-detail-title">{{ selectedItem()?.clientName || selectedItem()?.preview || 'Детали' }}</span>
                  @if (activeClientPhone() || activeClientUserId()) {
                    <button mat-icon-button (click)="activeTab.set('client')">
                      <mat-icon>person</mat-icon>
                    </button>
                  }
                </div>
                <app-detail-panel
                  [item]="selectedItem()"
                  (clientPhoneResolved)="onClientPhone($event)"
                  (clientUserIdResolved)="onClientUserId($event)"
                  (clientContactIdResolved)="onClientContactId($event)"
                  (back)="deselectItem()"
                  (selectItem)="onDashboardSelectItem($event)"
                  (createTask)="onCreateTask()"
                  (createOrder)="onCreateOrder()"
                  (openDialer)="onOpenDialer()"
                  (cartItemsToAdd)="onCartItems($event)"
                  (createOrderFromChat)="onCreateOrderFromChat()"
                  (photoWorkspaceFocusChange)="onPhotoWorkspaceFocusChange($event)" />
              }
            }
            @case ('client') {
              @if (showChatOrderPanel() && selectedItem()?.type === 'chat') {
                <app-order-creation-form
                  [dialogClientName]="selectedItem()?.clientName ?? ''"
                  [dialogPhone]="activeClientPhone() ?? ''"
                  [dialogSessionId]="activeSessionId() ?? ''"
                  (closed)="closeChatOrderPanel()"
                  (orderCreated)="closeChatOrderPanel()" />
              } @else {
                <app-client-profile-panel
                  [clientPhone]="activeClientPhone()"
                  [clientUserId]="activeClientUserId()"
                  [clientContactId]="activeClientContactId()"
                  [sessionId]="activeSessionId()"
                  [pendingCartItems]="pendingCartItems()" />
              }
            }
          }
        </div>

        <!-- Mobile workspace tabs -->
        <nav class="ws-tabs" role="tablist" aria-label="Разделы рабочего пространства">
          <button class="ws-tab" role="tab" [attr.aria-selected]="activeTab() === 'inbox'"
                  [class.active]="activeTab() === 'inbox'"
                  (click)="activeTab.set('inbox')">
            <mat-icon>inbox</mat-icon>
            <span>Входящие</span>
          </button>
          <button class="ws-tab" role="tab" [attr.aria-selected]="activeTab() === 'email'"
                  [class.active]="activeTab() === 'email'"
                  (click)="activeTab.set('email')">
            <mat-icon [matBadge]="emailUnread()" matBadgeSize="small"
                      matBadgeColor="warn" [matBadgeHidden]="!emailUnread()">mail</mat-icon>
            <span>Почта</span>
          </button>
          <button class="ws-tab" role="tab" [attr.aria-selected]="activeTab() === 'detail'"
                  [class.active]="activeTab() === 'detail'"
                  [disabled]="!selectedItem() && !selectedEmail()"
                  (click)="activeTab.set('detail')">
            <mat-icon>article</mat-icon>
            <span>Детали</span>
          </button>
          <button class="ws-tab" role="tab" [attr.aria-selected]="activeTab() === 'client'"
                  [class.active]="activeTab() === 'client'"
                  [disabled]="!showChatOrderPanel() && !activeClientPhone() && !activeClientUserId()"
                  (click)="activeTab.set('client')">
            <mat-icon>person</mat-icon>
            <span>Клиент</span>
          </button>
        </nav>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .workspace {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .workspace.desktop {
      display: grid;
      grid-template-columns: minmax(320px, 380px) 1fr minmax(280px, 340px);
    }

    .workspace.desktop.photo-workspace-focus {
      grid-template-columns: minmax(0, 1fr);
    }

    .workspace.desktop.photo-workspace-focus .inbox-col,
    .workspace.desktop.photo-workspace-focus .client-col {
      display: none;
    }

    .workspace.desktop.chat-order-panel-open {
      grid-template-columns: minmax(300px, 360px) minmax(420px, 1fr) minmax(640px, 720px);
    }

    @media (max-width: 1100px) {
      .workspace.desktop:not(.chat-order-panel-open) {
        grid-template-columns: minmax(280px, 320px) 1fr;
      }
      .workspace.desktop:not(.chat-order-panel-open) .client-col { display: none; }
    }

    .col {
      overflow-y: auto;
      height: 100%;
      min-height: 0;
    }

    .inbox-col {
      border-right: 1px solid var(--crm-border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    app-inbox-panel, app-email-panel {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }

    /* Left panel toggle: Inbox / Email */
    .left-toggle {
      display: flex;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
    }

    .lt-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 7px 10px;
      border: none;
      background: none;
      color: var(--crm-text-secondary);
      font-size: var(--crm-text-sm);
      font-family: var(--crm-font-sans);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s, background 0.15s;

      mat-icon { font-size: 15px; width: 15px; height: 15px; }

      &:hover { color: var(--crm-text-primary); background: var(--crm-surface-hover); }

      &.lt-active {
        color: var(--crm-accent);
        border-bottom-color: var(--crm-accent);
        font-weight: 600;
      }
    }

    .lt-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 8px;
      background: var(--crm-status-error, #ef4444);
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      line-height: 1;

      &--email { background: var(--crm-accent); }
    }

    .detail-col {
      background: var(--crm-surface-base);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    app-email-detail-view {
      flex: 1;
      min-height: 0;
    }

    .pos-inline-header {
      display: flex;
      align-items: center;
      padding: 6px 12px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
    }

    .pos-back-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px 4px 6px;
      border: none;
      background: none;
      border-radius: var(--crm-radius-md);
      color: var(--crm-accent);
      font-size: 13px;
      font-weight: 500;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: background var(--crm-transition-fast);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { background: var(--crm-accent-muted); }
    }

    app-pos,
    app-student-verification-review {
      flex: 1;
      min-height: 0;
    }

    .client-col {
      border-left: 1px solid var(--crm-border);
      background: var(--crm-surface);
      display: flex;
      flex-direction: column;

      app-client-profile-panel,
      app-order-creation-form,
      app-dashboard-sidebar {
        flex: 1;
        min-height: 0;
      }
    }

    .mobile-content {
      flex: 1;
      overflow-y: auto;
    }

    .mobile-detail-header {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px 4px 4px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
    }

    .mobile-detail-title {
      flex: 1;
      font-size: var(--crm-text-md);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-primary);
    }

    .ws-tabs {
      display: flex;
      border-top: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
      position: sticky;
      bottom: 0;
      z-index: 10;
    }

    .ws-tab {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      padding: 6px 0;
      border: none;
      background: none;
      color: var(--crm-text-muted);
      font-size: var(--crm-text-xs);
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: color var(--crm-transition-fast);

      &.active {
        color: var(--crm-accent);
        mat-icon { color: var(--crm-accent); }
      }

      &:disabled {
        opacity: 0.38;
        cursor: default;
      }

      mat-icon { font-size: 20px; width: 20px; height: 20px; }
    }
  `],
})
export class WorkspaceComponent {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpointObserver = inject(BreakpointObserver);
  protected readonly inboxService = inject(InboxService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly emailDetailView = viewChild(EmailDetailViewComponent);

  isDesktop = signal(true);
  showPos = signal(false);
  showStudentVerification = signal(false);
  showChatOrderPanel = signal(false);
  photoWorkspaceFocus = signal(false);
  selectedItemId = signal<string | null>(null);
  selectedItem = signal<InboxItem | null>(null);
  selectedEmail = signal<EmailMessage | null>(null);
  activeClientPhone = signal<string | null>(null);
  activeClientUserId = signal<string | null>(null);
  activeClientContactId = signal<string | null>(null);
  activeTab = signal<MobileTab>('inbox');

  // Left panel state (desktop)
  leftView = signal<LeftView>('inbox');
  leftCollapsed = signal(false);
  orderChatSessionId = signal<string | null>(null);
  emailUnread = signal(0);
  emailComposeRequested = signal(false);
  pendingCartItems = signal<PendingCartItemsEvent | null>(null);
  private pendingCartItemsSeq = 0;

  readonly activeSessionId = computed(() => {
    const item = this.selectedItem();
    return item?.type === 'chat' ? item.id : null;
  });

  readonly selectedEmailId = computed(() => this.selectedEmail()?.id ?? null);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.breakpointObserver.observe('(min-width: 840px)')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(result => {
          this.isDesktop.set(result.matches);
        });
      this.inboxService.init();
      this.loadEmailUnread();

      // Handle ?action=new-order from nav button
      this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
        if (params['action'] === 'new-order') {
          this.showChatOrderPanel.set(false);
          this.showCreateOrder.set(true);
          this.router.navigate([], { queryParams: {}, replaceUrl: true });
        }
      });

      // Escape — деселект выбранного элемента
      const onKeydown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (this.selectedEmail()) {
            this.deselectEmail();
          } else if (this.selectedItem()) {
            this.deselectItem();
          }
        }
      };
      document.addEventListener('keydown', onKeydown);
      this.destroyRef.onDestroy(() => document.removeEventListener('keydown', onKeydown));
    }
  }

  private loadEmailUnread(): void {
    this.http.get<{ success: boolean; data: { unread: number } }>('/api/crm/email/counts').subscribe({
      next: r => this.emailUnread.set(r.data.unread),
      error: () => { /* noop */ },
    });
  }

  switchToInbox(): void {
    this.photoWorkspaceFocus.set(false);
    this.leftView.set('inbox');
    this.deselectEmail();
    this.emailComposeRequested.set(false);
  }

  onItemSelected(item: InboxItem): void {
    this.photoWorkspaceFocus.set(false);
    this.showChatOrderPanel.set(false);
    this.selectedItemId.set(item.id);
    this.selectedItem.set(item);
    this.selectedEmail.set(null);
    this.activeClientPhone.set(item.clientPhone);
    this.activeClientUserId.set(null);
    this.activeClientContactId.set(null);
  }

  onMobileItemSelected(item: InboxItem): void {
    this.onItemSelected(item);
    this.activeTab.set('detail');
  }

  onEmailSelected(email: EmailMessage): void {
    this.photoWorkspaceFocus.set(false);
    this.showChatOrderPanel.set(false);
    this.emailComposeRequested.set(false);
    this.selectedEmail.set(email);
    this.selectedItem.set(null);
    this.selectedItemId.set(null);
    this.activeClientPhone.set(email.customer_phone);
    this.activeClientUserId.set(null);
    this.activeClientContactId.set(null);
  }

  onMobileEmailSelected(email: EmailMessage): void {
    this.onEmailSelected(email);
    this.activeTab.set('detail');
  }

  onEmailComposeRequested(): void {
    this.photoWorkspaceFocus.set(false);
    this.showChatOrderPanel.set(false);
    this.selectedEmail.set(null);
    this.selectedItem.set(null);
    this.selectedItemId.set(null);
    this.activeClientPhone.set(null);
    this.activeClientUserId.set(null);
    this.activeClientContactId.set(null);
    this.leftView.set('email');
    this.emailComposeRequested.set(true);
    if (!this.isDesktop()) {
      this.activeTab.set('detail');
    }
    // Open compose overlay in the detail view after deselect
    queueMicrotask(() => this.emailDetailView()?.openCompose());
  }

  onEmailArchived(_emailId: number): void {
    this.loadEmailUnread();
    this.deselectEmail();
  }

  onEmailReplied(_emailId: number): void {
    // unread count doesn't change on reply, just feedback
  }

  deselectEmail(): void {
    this.photoWorkspaceFocus.set(false);
    this.showChatOrderPanel.set(false);
    this.emailComposeRequested.set(false);
    this.selectedEmail.set(null);
    this.activeClientPhone.set(null);
    this.activeClientUserId.set(null);
    this.activeClientContactId.set(null);
  }

  onClientPhone(phone: string | null): void {
    this.activeClientPhone.set(phone);
    this.activeClientUserId.set(null);
    this.activeClientContactId.set(null);
  }

  onClientUserId(userId: string): void {
    this.activeClientUserId.set(userId);
    this.activeClientPhone.set(null);
    this.activeClientContactId.set(null);
  }

  onClientContactId(contactId: string): void {
    this.activeClientContactId.set(contactId);
    this.activeClientPhone.set(null);
    this.activeClientUserId.set(null);
  }

  deselectItem(): void {
    this.photoWorkspaceFocus.set(false);
    this.showChatOrderPanel.set(false);
    this.selectedItemId.set(null);
    this.selectedItem.set(null);
    this.activeClientPhone.set(null);
    this.activeClientUserId.set(null);
    this.activeClientContactId.set(null);
    this.leftView.set('inbox');
    this.leftCollapsed.set(false);
    this.orderChatSessionId.set(null);
  }

  onOrderChatSession(sessionId: string | null): void {
    if (sessionId) {
      this.leftView.set('order-chat');
      this.orderChatSessionId.set(sessionId);
      this.leftCollapsed.set(false);
    } else if (this.selectedItem()?.type === 'order') {
      // Заказ без привязанного чата: НЕ схлопываем рейл, а показываем список
      // входящих — чтобы сотрудник видел чаты и мог привязать нужный.
      this.orderChatSessionId.set(null);
      this.leftCollapsed.set(false);
      this.leftView.set('inbox');
    }
  }

  onDashboardSelectItem(event: { type: string; id: string }): void {
    const item: InboxItem = {
      id: event.id,
      type: event.type as InboxItem['type'],
      clientName: null,
      clientPhone: null,
      preview: '',
      status: '',
      priority: 2,
      sortTime: new Date().toISOString(),
      metadata: {},
    };
    this.onItemSelected(item);
  }

  onCreateTask(): void {
    this.router.navigateByUrl('/employee/tasks/new');
  }

  showCreateOrder = signal(false);

  onCreateOrder(): void {
    this.photoWorkspaceFocus.set(false);
    this.showChatOrderPanel.set(false);
    this.showCreateOrder.set(true);
  }

  onCreateOrderFromChat(): void {
    if (this.selectedItem()?.type !== 'chat') return;
    this.photoWorkspaceFocus.set(false);
    this.showCreateOrder.set(false);
    this.showPos.set(false);
    this.showStudentVerification.set(false);
    this.showChatOrderPanel.set(true);
    if (!this.isDesktop()) {
      this.activeTab.set('client');
    }
  }

  closeChatOrderPanel(): void {
    this.showChatOrderPanel.set(false);
    if (!this.isDesktop() && this.selectedItem()?.type === 'chat') {
      this.activeTab.set('detail');
    }
  }

  onOpenDialer(): void {
    const el = document.querySelector<HTMLElement>('app-dashboard-quick-dialer input[type="tel"]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
    }
  }

  onCartItems(items: SyncCartItem[]): void {
    if (items.length === 0) return;
    this.pendingCartItems.set({
      id: ++this.pendingCartItemsSeq,
      items,
    });
  }

  onPhotoWorkspaceFocusChange(focused: boolean): void {
    this.photoWorkspaceFocus.set(focused);
  }

  goBack(): void {
    if (this.selectedEmail() || this.emailComposeRequested()) {
      this.deselectEmail();
      this.activeTab.set('email');
    } else {
      this.activeTab.set('inbox');
    }
  }

  onEmailComposeClosed(): void {
    this.emailComposeRequested.set(false);
    if (!this.selectedEmail() && !this.isDesktop()) {
      this.activeTab.set('email');
    }
  }
}
