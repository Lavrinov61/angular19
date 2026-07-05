import { Component, inject, input, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { StaffChatService } from '../../services/staff-chat.service';
import { StaffConversation, StaffParticipant } from '../../models/staff-chat.model';
import { AuthService } from '../../../../core/services/auth.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { MediaGalleryComponent } from './media-gallery.component';
import { PaymentsTabComponent } from '../shared/payments-tab/payments-tab.component';

@Component({
  selector: 'app-conversation-info-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatListModule, MatIconModule, MatButtonModule,
    MatDividerModule, MatFormFieldModule, MatInputModule, MatMenuModule,
    MediaGalleryComponent, PaymentsTabComponent,
  ],
  template: `
    @if (conversation(); as conv) {
      <div class="info-header">
        <span class="info-title">Информация</span>
        <button mat-icon-button (click)="closed.emit()" aria-label="Закрыть панель">
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <!-- Compact identity -->
      <div class="info-identity">
        <div class="info-avatar" [style.background]="avatarColor(conv.id)">
          {{ avatarInitials(chatService.getConversationDisplayName(conv)) }}
        </div>
        <div class="identity-text">
          <h3 class="info-name">{{ chatService.getConversationDisplayName(conv) }}</h3>
          <div class="info-type">
            @switch (conv.type) {
              @case ('general') { Общий канал }
              @case ('group') { Групповой чат }
              @case ('direct') { Личный чат }
            }
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="info-tabs">
        <button class="info-tab" [class.active]="activeSection() === 'info'" (click)="activeSection.set('info')">
          <mat-icon>info</mat-icon> Инфо
        </button>
        <button class="info-tab" [class.active]="activeSection() === 'members'" (click)="activeSection.set('members')">
          <mat-icon>group</mat-icon> {{ conv.participants?.length || 0 }}
        </button>
        <button class="info-tab" [class.active]="activeSection() === 'media'" (click)="onMediaTab()">
          <mat-icon>perm_media</mat-icon> Медиа
        </button>
        <button class="info-tab" [class.active]="activeSection() === 'payments'" (click)="activeSection.set('payments')">
          <mat-icon>payment</mat-icon> Платежи
        </button>
        <button class="info-tab" [class.active]="activeSection() === 'links'" (click)="onLinksTab()">
          <mat-icon>link</mat-icon> Ссылки
        </button>
        <button class="info-tab" [class.active]="activeSection() === 'bookmarks'" (click)="onBookmarksTab()">
          <mat-icon>bookmark</mat-icon> Избранное
        </button>
        <button class="info-tab" [class.active]="activeSection() === 'common'" (click)="activeSection.set('common')">
          <mat-icon>forum</mat-icon> Общие
        </button>
      </div>

      <!-- Scrollable body -->
      <div class="info-body">
        @switch (activeSection()) {
          @case ('info') {
            @if (isEditing()) {
              <div class="edit-title-area">
                <mat-form-field appearance="outline" class="edit-title-field">
                  <input matInput [(ngModel)]="editTitleValue" placeholder="Название чата"
                         (keydown.enter)="saveTitle(conv.id)" aria-label="Название чата" />
                </mat-form-field>
                <div class="edit-title-actions">
                  <button mat-icon-button (click)="saveTitle(conv.id)" aria-label="Сохранить">
                    <mat-icon>check</mat-icon>
                  </button>
                  <button mat-icon-button (click)="isEditing.set(false)" aria-label="Отмена">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              </div>
            } @else if (canManage(conv) && conv.type !== 'direct') {
              <button mat-button (click)="startEditTitle(conv)" class="rename-btn">
                <mat-icon>edit</mat-icon> Переименовать
              </button>
            }

            <div class="info-actions">
              <button mat-button (click)="toggleMute(conv.id)">
                <mat-icon>{{ isMuted(conv) ? 'notifications_active' : 'notifications_off' }}</mat-icon>
                {{ isMuted(conv) ? 'Включить уведомления' : 'Отключить уведомления' }}
              </button>
              @if (conv.type === 'group') {
                <button mat-button color="warn" (click)="chatService.leaveConversation(conv.id)">
                  <mat-icon>exit_to_app</mat-icon> Покинуть группу
                </button>
              }
            </div>
          }

          @case ('members') {
            <div class="section-header">
              <span>Участники ({{ conv.participants?.length || 0 }})</span>
              @if (canManage(conv) && conv.type === 'group') {
                <button mat-icon-button (click)="showAddMember.set(true)" aria-label="Добавить участника">
                  <mat-icon>person_add</mat-icon>
                </button>
              }
            </div>

            @if (showAddMember()) {
              <div class="add-member-area">
                <mat-form-field appearance="outline" class="add-member-field">
                  <input matInput placeholder="Поиск сотрудника..." [(ngModel)]="addMemberQuery"
                         aria-label="Поиск сотрудника" />
                </mat-form-field>
                @for (contact of filteredContacts(); track contact.user_id) {
                  <div class="add-member-item" (click)="addMember(conv.id, contact.user_id)" (keydown.enter)="addMember(conv.id, contact.user_id)" tabindex="0">
                    <mat-icon>person_add</mat-icon>
                    <span>{{ contact.display_name || contact.email }}</span>
                  </div>
                }
                <button mat-button (click)="showAddMember.set(false)">Отмена</button>
              </div>
            }

            <mat-nav-list dense class="participants-list">
              @for (p of conv.participants || []; track p.user_id) {
                <mat-list-item [class.deactivated]="p.is_active === false">
                  <div matListItemIcon class="participant-avatar-wrap">
                    <div class="participant-avatar" [style.background]="avatarColor(p.user_id)"
                         [class.deactivated-avatar]="p.is_active === false">
                      {{ avatarInitials(p.display_name || p.email) }}
                    </div>
                    @if (p.is_active !== false && isOnline(p.user_id)) {
                      <span class="online-dot-sm"></span>
                    }
                    @if (p.is_active === false) {
                      <span class="offline-dot-sm"></span>
                    }
                  </div>
                  <div matListItemTitle>
                    {{ p.display_name || p.email }}
                    @if (p.is_active === false) { <span class="role-badge deactivated">неактивен</span> }
                    @if (p.role === 'owner') { <span class="role-badge owner">владелец</span> }
                    @if (p.role === 'admin') { <span class="role-badge admin">админ</span> }
                    @if (p.user_id === currentUserId) { <span class="role-badge you">вы</span> }
                  </div>
                  @if (p.user_id !== currentUserId && p.is_active !== false && !isOnline(p.user_id) && p.last_seen_at) {
                    <span matListItemLine class="last-seen">{{ lastSeenLabel(p.last_seen_at) }}</span>
                  }
                  @if (canManage(conv) && p.user_id !== currentUserId && conv.type === 'group') {
                    <ng-container>
                      <button matListItemMeta mat-icon-button [matMenuTriggerFor]="memberMenu"
                              aria-label="Действия с участником">
                        <mat-icon>more_vert</mat-icon>
                      </button>
                      <mat-menu #memberMenu="matMenu">
                        <button mat-menu-item (click)="chatService.removeMember(conv.id, p.user_id)">
                          <mat-icon>person_remove</mat-icon> Удалить из чата
                        </button>
                      </mat-menu>
                    </ng-container>
                  }
                </mat-list-item>
              }
            </mat-nav-list>
          }

          @case ('media') {
            <app-media-gallery
              [mediaItems]="chatService.mediaItems()"
              [loading]="chatService.mediaLoading()" />
          }

          @case ('payments') {
            <app-payments-tab [conversationId]="conv.id" />
          }

          @case ('links') {
            @if (chatService.linksLoading()) {
              <div class="gallery-loading">Загрузка...</div>
            } @else {
              @for (link of chatService.linkItems(); track link.id) {
                <div class="link-item">
                  <div class="link-header">
                    <span class="link-sender">{{ link.sender_name }}</span>
                    <span class="link-date">{{ lastSeenLabel(link.created_at) }}</span>
                  </div>
                  @for (url of link.urls; track url) {
                    <a [href]="url" target="_blank" rel="noopener" class="link-url">
                      <mat-icon>open_in_new</mat-icon>
                      <span>{{ url }}</span>
                    </a>
                  }
                </div>
              } @empty {
                <div class="gallery-empty">
                  <mat-icon>link_off</mat-icon>
                  <span>Нет ссылок</span>
                </div>
              }
            }
          }

          @case ('bookmarks') {
            @if (chatService.bookmarksLoading()) {
              <div class="gallery-loading">Загрузка...</div>
            } @else {
              @for (item of chatService.bookmarks(); track item.bookmark_id) {
                <div class="bookmark-item">
                  <div class="bookmark-header">
                    <span class="bookmark-sender">{{ item.sender_name }}</span>
                    <span class="bookmark-date">{{ lastSeenLabel(item.created_at) }}</span>
                  </div>
                  <div class="bookmark-content">{{ item.content?.substring(0, 150) }}</div>
                  @if (item.attachment_url) {
                    <div class="bookmark-attachment">
                      <mat-icon>attach_file</mat-icon>
                      <span>{{ item.original_filename || 'Файл' }}</span>
                    </div>
                  }
                  <div class="bookmark-conv">
                    <mat-icon>forum</mat-icon>
                    <span>{{ item.conversation_title || 'Личный чат' }}</span>
                  </div>
                </div>
              } @empty {
                <div class="gallery-empty">
                  <mat-icon>bookmark_border</mat-icon>
                  <span>Нет избранных сообщений</span>
                </div>
              }
            }
          }

          @case ('common') {
            @for (c of commonConversations(); track c.id) {
              <div class="common-chat-item">
                <div class="common-avatar" [style.background]="avatarColor(c.id)">
                  {{ avatarInitials(chatService.getConversationDisplayName(c)) }}
                </div>
                <div class="common-info">
                  <span class="common-name">{{ chatService.getConversationDisplayName(c) }}</span>
                  <span class="common-members">{{ c.participants?.length || 0 }} участников</span>
                </div>
              </div>
            } @empty {
              <div class="gallery-empty">
                <mat-icon>forum</mat-icon>
                <span>Нет общих чатов</span>
              </div>
            }
          }
        }
      </div>
    }
  `,
  styles: [`
    @keyframes infoPanelSlide {
      from { opacity: 0; transform: translateX(16px); }
      to { opacity: 1; transform: translateX(0); }
    }

    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 300px;
      border-left: 1px solid var(--crm-glass-border);
      background: rgba(12, 11, 9, 0.85);
      backdrop-filter: blur(16px) saturate(180%);
      animation: infoPanelSlide 0.25s ease-out;
    }

    .info-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--crm-glass-border);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }
    .info-title {
      font-family: var(--crm-font-display, Oswald, sans-serif);
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--crm-text-secondary);
    }

    .info-identity {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      flex-shrink: 0;
    }
    .identity-text {
      min-width: 0;
      flex: 1;
    }

    .info-body {
      flex: 1;
      overflow-y: auto;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .info-avatar {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 16px;
      font-weight: 600;
      flex-shrink: 0;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      border: 3px solid rgba(255, 255, 255, 0.06);
    }

    .info-name {
      margin: 0;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .info-type {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .info-tabs {
      display: flex;
      border-bottom: 1px solid var(--crm-glass-border);
      padding: 0 8px;
      flex-shrink: 0;
    }
    .info-tab {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 10px 8px;
      font-size: 11px;
      font-family: var(--crm-font-display, Oswald, sans-serif);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--crm-text-muted);
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      transition: all 150ms ease;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover {
        color: var(--crm-text-secondary);
        background: rgba(255, 255, 255, 0.03);
      }
      &.active {
        color: var(--crm-accent);
        border-bottom-color: var(--crm-accent);
        background: rgba(245, 158, 11, 0.04);
      }
    }

    .rename-btn {
      font-size: 12px;
      color: var(--crm-accent);
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .edit-title-area { width: 100%; }
    .edit-title-field { width: 100%; }
    .edit-title-actions { display: flex; justify-content: center; gap: 4px; }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 12px 0 6px;
      font-family: var(--crm-font-display, Oswald, sans-serif);
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--crm-text-muted);
    }

    .participants-list { width: 100%; }

    .participant-avatar-wrap {
      position: relative;
      width: 34px;
      height: 34px;
      flex-shrink: 0;
    }

    .participant-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    }

    .online-dot-sm {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-status-success);
      border: 2px solid rgba(12, 11, 9, 0.85);
      box-shadow: 0 0 6px rgba(52, 211, 153, 0.4);
    }

    .role-badge {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 9px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 8px;
      margin-left: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      &.owner {
        background: rgba(96, 165, 250, 0.12);
        color: #60a5fa;
        border: 1px solid rgba(96, 165, 250, 0.2);
      }
      &.admin {
        background: rgba(192, 132, 252, 0.12);
        color: #c084fc;
        border: 1px solid rgba(192, 132, 252, 0.2);
      }
      &.you {
        background: var(--crm-glass-bg);
        color: var(--crm-text-muted);
        border: 1px solid var(--crm-glass-border);
      }
      &.deactivated {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.2);
      }
    }

    .deactivated-avatar {
      opacity: 0.4;
      filter: grayscale(100%);
    }

    .offline-dot-sm {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      border: 2px solid rgba(12, 11, 9, 0.85);
    }

    :host ::ng-deep .deactivated {
      opacity: 0.6;
    }

    .last-seen {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-text-muted);
      opacity: 0.7;
    }

    .add-member-area {
      width: 100%;
      padding: 8px 0;
    }
    .add-member-field { width: 100%; }
    .add-member-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      cursor: pointer;
      border-radius: 10px;
      font-size: 13px;
      transition: background 150ms;
      &:hover { background: rgba(245, 158, 11, 0.06); }
      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent); }
    }

    .info-actions {
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 0;
      button { justify-content: flex-start; }
    }

    .common-chat-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 4px;
      border-bottom: 1px solid var(--crm-glass-border);
    }
    .common-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }
    .common-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .common-name {
      font-size: 13px;
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .common-members {
      font-size: 11px;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: var(--crm-text-muted);
    }

    .link-item {
      padding: 10px 0;
      border-bottom: 1px solid var(--crm-glass-border);
    }

    .link-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .link-sender {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary);
    }

    .link-date {
      font-size: 10px;
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted);
    }

    .link-url {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 8px;
      color: var(--crm-status-info, #60a5fa);
      font-size: 13px;
      text-decoration: none;
      word-break: break-all;
      transition: background 150ms;

      mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; }

      &:hover {
        background: rgba(96, 165, 250, 0.08);
      }
    }

    .gallery-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 32px 16px;
      color: var(--crm-text-muted);
      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
      span { font-size: 12px; }
    }

    .bookmark-item {
      padding: 10px 0;
      border-bottom: 1px solid var(--crm-glass-border);
    }

    .bookmark-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .bookmark-sender {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-accent);
    }

    .bookmark-date {
      font-size: 10px;
      font-family: var(--crm-font-mono);
      color: var(--crm-text-muted);
    }

    .bookmark-content {
      font-size: 13px;
      color: var(--crm-text-primary);
      line-height: 1.4;
      margin-bottom: 4px;
    }

    .bookmark-attachment {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--crm-text-secondary);
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .bookmark-conv {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--crm-text-muted);
      margin-top: 4px;
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }
  `],
})
export class ConversationInfoPanelComponent {
  protected readonly chatService = inject(StaffChatService);
  private readonly authService = inject(AuthService);
  private readonly wsService = inject(WebSocketService);

  conversation = input.required<StaffConversation>();
  closed = output<void>();

  readonly isEditing = signal(false);
  readonly showAddMember = signal(false);
  readonly activeSection = signal<'info' | 'members' | 'media' | 'payments' | 'links' | 'bookmarks' | 'common'>('info');
  editTitleValue = '';
  addMemberQuery = '';

  readonly currentUserId = this.authService.currentUser()?.id || '';

  filteredContacts(): StaffParticipant[] {
    const conv = this.conversation();
    const participantIds = new Set(conv.participants?.map(p => p.user_id) || []);
    const q = this.addMemberQuery.toLowerCase().trim();
    return this.chatService.contacts().filter(c => {
      if (participantIds.has(c.user_id)) return false;
      if (!q) return true;
      return (c.display_name?.toLowerCase().includes(q) || c.email.toLowerCase().includes(q));
    });
  }

  readonly commonConversations = computed(() => {
    const conv = this.conversation();
    if (!conv || conv.type !== 'direct') return [];
    const currentUserId = this.authService.currentUser()?.id;
    const otherUserId = conv.participants?.find(p => p.user_id !== currentUserId)?.user_id;
    if (!otherUserId) return [];
    return this.chatService.conversations().filter(c =>
      c.id !== conv.id && c.type !== 'direct' &&
      c.participants?.some(p => p.user_id === otherUserId)
    );
  });

  onMediaTab(): void {
    this.activeSection.set('media');
    const conv = this.conversation();
    if (conv) {
      this.chatService.loadConversationMedia(conv.id);
    }
  }

  onLinksTab(): void {
    this.activeSection.set('links');
    const conv = this.conversation();
    if (conv) this.chatService.loadConversationLinks(conv.id);
  }

  onBookmarksTab(): void {
    this.activeSection.set('bookmarks');
    this.chatService.loadBookmarks();
  }

  canManage(conv: StaffConversation): boolean {
    const me = conv.participants?.find(p => p.user_id === this.currentUserId);
    return me?.role === 'owner' || me?.role === 'admin';
  }

  isOnline(userId: string): boolean {
    return this.wsService.isUserOnline(userId);
  }

  isMuted(conv: StaffConversation): boolean {
    const me = conv.participants?.find(p => p.user_id === this.currentUserId);
    if (!me?.muted_until) return false;
    return new Date(me.muted_until) > new Date();
  }

  startEditTitle(conv: StaffConversation): void {
    this.editTitleValue = conv.title || '';
    this.isEditing.set(true);
  }

  saveTitle(convId: string): void {
    if (this.editTitleValue.trim()) {
      this.chatService.renameConversation(convId, this.editTitleValue);
    }
    this.isEditing.set(false);
  }

  addMember(convId: string, userId: string): void {
    this.chatService.addMember(convId, userId);
    this.showAddMember.set(false);
    this.addMemberQuery = '';
  }

  toggleMute(convId: string): void {
    const conv = this.conversation();
    if (this.isMuted(conv)) {
      this.chatService.muteConversation(convId, null);
    } else {
      // Mute for 1 year (effectively "forever")
      const until = new Date();
      until.setFullYear(until.getFullYear() + 1);
      this.chatService.muteConversation(convId, until);
    }
  }

  avatarColor(id: string): string {
    const colors = ['#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#f57c00', '#0097a7', '#5d4037', '#455a64'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  avatarInitials(name: string): string {
    const parts = (name || '?').split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0][0] || '?').toUpperCase();
  }

  lastSeenLabel(dateStr: string): string {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'был(а) только что';
    if (diffMin < 60) return `был(а) ${diffMin} мин. назад`;

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `был(а) ${diffHours} ч. назад`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'был(а) вчера';
    if (diffDays < 7) return `был(а) ${diffDays} дн. назад`;

    return `был(а) ${new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
  }
}
