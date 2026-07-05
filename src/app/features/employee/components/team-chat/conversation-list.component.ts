import { Component, inject, output, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { DatePipe } from '@angular/common';
import { StaffChatService } from '../../services/staff-chat.service';
import { StaffConversation } from '../../models/staff-chat.model';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NewConversationDialogComponent } from './new-conversation-dialog.component';

@Component({
  selector: 'app-conversation-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatIconModule, MatButtonModule, MatBadgeModule, MatTooltipModule, DatePipe,
  ],
  template: `
    @if (wsService.isOffline5s()) {
      <div class="ws-offline-banner" role="status" aria-live="polite">
        <mat-icon>cloud_off</mat-icon>
        <span>Нет связи. Переподключение…</span>
      </div>
    }
    <div class="list-header">
      <span class="list-title">
        {{ chatService.showArchived() ? 'Архив' : 'Чат' }}
      </span>
      <div class="header-actions">
        <button class="new-chat-btn" [class.active]="chatService.showArchived()"
                (click)="chatService.toggleShowArchived()" aria-label="Архив"
                [matTooltip]="chatService.showArchived() ? 'Показать активные' : 'Показать архив'">
          <mat-icon>{{ chatService.showArchived() ? 'inbox' : 'archive' }}</mat-icon>
        </button>
        <button class="new-chat-btn" (click)="openNewConversation()" aria-label="Новый чат">
          <mat-icon>add</mat-icon>
        </button>
      </div>
    </div>

    <div class="search-bar">
      <div class="search-input-wrap">
        <mat-icon class="search-icon">search</mat-icon>
        <input type="text" class="search-input" placeholder="Поиск чатов..."
               [(ngModel)]="searchQuery" (ngModelChange)="onSearch($event)"
               aria-label="Поиск чатов" />
        @if (searchQuery) {
          <button class="search-clear" (click)="searchQuery = ''; onSearch('')"
                  aria-label="Очистить поиск">
            <mat-icon>close</mat-icon>
          </button>
        }
      </div>
    </div>

    <div class="conv-list">
      @for (conv of filteredConversations(); track conv.id; let i = $index) {
        <div class="conv-item" tabindex="0" role="button"
             [class.active]="conv.id === chatService.activeConversationId()"
             [style.animation-delay]="i * 30 + 'ms'"
             (click)="conversationSelected.emit(conv.id)"
             (keydown.enter)="conversationSelected.emit(conv.id)">
          <div class="conv-avatar-wrap">
            <div class="conv-avatar" [style.background]="avatarColor(conv.id)">
              {{ avatarInitials(chatService.getConversationDisplayName(conv)) }}
            </div>
            @if (isDirectOnline(conv)) {
              <span class="online-dot"></span>
            }
          </div>
          <div class="conv-body">
            <div class="conv-top-row">
              <span class="conv-title">
                {{ chatService.getConversationDisplayName(conv) }}
              </span>
              @if (conv.last_message_at) {
                <span class="conv-time">{{ conv.last_message_at | date:'HH:mm' }}</span>
              }
            </div>
            <div class="conv-bottom-row">
              <span class="conv-preview">
                {{ conv.last_message_preview || 'Нет сообщений' }}
              </span>
              @if (conv.unread_count > 0) {
                <span class="unread-badge">{{ conv.unread_count }}</span>
              }
            </div>
          </div>
          <button class="archive-btn" (click)="toggleArchive($event, conv)"
                  [attr.aria-label]="chatService.showArchived() ? 'Разархивировать' : 'Архивировать'"
                  [matTooltip]="chatService.showArchived() ? 'Разархивировать' : 'Архивировать'">
            <mat-icon>{{ chatService.showArchived() ? 'unarchive' : 'archive' }}</mat-icon>
          </button>
        </div>
      } @empty {
        @if (chatService.lastError()) {
          <div class="error-empty">
            <mat-icon class="empty-icon">error_outline</mat-icon>
            <p class="empty-text">{{ chatService.lastError() }}</p>
            <button mat-button color="primary" (click)="retry()">Повторить</button>
          </div>
        } @else {
          <div class="empty-list">
            @if (searchQuery) {
              <mat-icon class="empty-icon">search_off</mat-icon>
              <p class="empty-text">Ничего не найдено</p>
            } @else {
              <mat-icon class="empty-icon">forum</mat-icon>
              <p class="empty-text">Нет чатов</p>
              <p class="empty-hint">Начните общение с коллегой</p>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--crm-font-sans), sans-serif;
    }

    .ws-offline-banner {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 6px 12px;
      background: linear-gradient(180deg, #c2410c 0%, #9a3412 100%);
      color: #fff;
      font-size: 13px;
      font-weight: 500;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      z-index: 10;
    }
    .ws-offline-banner mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #fff;
    }

    .list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 12px;
      flex-shrink: 0;
      background: rgba(12, 11, 9, 0.85);
      backdrop-filter: blur(16px) saturate(180%);
      border-bottom: 1px solid var(--crm-glass-border);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    .list-title {
      font-family: var(--crm-font-display), sans-serif;
      font-size: 15px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--crm-text-primary);
    }

    .header-actions {
      display: flex;
      gap: 4px;
    }

    .new-chat-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      border: 1px solid var(--crm-glass-border);
      background: var(--crm-glass-bg);
      color: var(--crm-text-secondary);
      cursor: pointer;
      transition: all 150ms ease;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &.active {
        color: var(--crm-accent);
        border-color: rgba(245, 158, 11, 0.25);
        background: rgba(245, 158, 11, 0.08);
      }

      &:hover {
        background: var(--crm-glass-bg-hover);
        color: var(--crm-accent);
        border-color: rgba(245, 158, 11, 0.25);
        box-shadow: 0 0 12px rgba(245, 158, 11, 0.08);
      }
    }

    .search-bar {
      padding: 10px 12px 8px;
      flex-shrink: 0;
    }

    .search-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-icon {
      position: absolute;
      left: 10px;
      font-size: 17px;
      width: 17px;
      height: 17px;
      color: var(--crm-text-muted);
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      padding: 8px 34px 8px 34px;
      border-radius: 24px;
      border: 1px solid var(--crm-glass-border);
      background: var(--crm-glass-bg);
      color: var(--crm-text-primary);
      font-family: var(--crm-font-sans), sans-serif;
      font-size: 13px;
      outline: none;
      transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15);

      &::placeholder { color: var(--crm-text-muted); }

      &:focus {
        border-color: rgba(245, 158, 11, 0.4);
        background: var(--crm-glass-bg-hover);
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.15),
                    0 0 12px rgba(245, 158, 11, 0.12);
      }
    }

    .search-clear {
      position: absolute;
      right: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border: none;
      background: none;
      color: var(--crm-text-muted);
      cursor: pointer;
      border-radius: 50%;
      transition: color 150ms ease;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { color: var(--crm-text-secondary); }
    }

    .conv-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .conv-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--crm-glass-border);
      cursor: pointer;
      transition: background 150ms ease, transform 100ms ease;
      animation: slideIn 200ms ease both;

      &:hover {
        background: rgba(245, 158, 11, 0.06);
        transform: translateX(2px);
      }
      &:hover .archive-btn { opacity: 1; }

      &.active {
        background: rgba(245, 158, 11, 0.12);
        border-left: 3px solid var(--crm-accent);
        padding-left: 13px;
        box-shadow: inset 3px 0 8px rgba(245, 158, 11, 0.1);
      }
    }

    .archive-btn {
      opacity: 0;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: none;
      background: none;
      color: var(--crm-text-muted);
      cursor: pointer;
      transition: opacity 150ms, color 150ms, background 150ms;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { color: var(--crm-accent); background: rgba(245, 158, 11, 0.08); }
    }

    .conv-avatar-wrap {
      position: relative;
      width: 42px;
      height: 42px;
      flex-shrink: 0;
    }

    .conv-avatar {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.02em;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      border: 2px solid rgba(255, 255, 255, 0.06);
      transition: transform 200ms ease, box-shadow 200ms ease;
    }

    .online-dot {
      position: absolute;
      bottom: 0;
      right: 0;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--crm-status-success);
      border: 2px solid var(--crm-surface-raised);
      box-shadow: 0 0 8px rgba(52, 211, 153, 0.5);
      animation: onlinePulse 2s ease-in-out infinite;
    }

    @keyframes onlinePulse {
      0%, 100% { box-shadow: 0 0 8px rgba(52, 211, 153, 0.5); }
      50% { box-shadow: 0 0 14px rgba(52, 211, 153, 0.8); }
    }

    .conv-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .conv-top-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }

    .conv-title {
      font-family: var(--crm-font-sans), sans-serif;
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .conv-time {
      font-family: var(--crm-font-mono), monospace;
      font-size: 11px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }

    .conv-bottom-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .conv-preview {
      font-size: 13px;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
      line-height: 1.4;
    }

    .unread-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      background: var(--crm-accent);
      color: #000;
      font-size: 11px;
      font-weight: 700;
      padding: 0 6px;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(245, 158, 11, 0.4);
    }

    .empty-list {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 56px 16px;
      color: var(--crm-text-muted);
    }

    .error-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 56px 16px;
      gap: 8px;
      color: var(--crm-danger, #ef4444);
      text-align: center;
    }

    .error-empty .empty-icon { color: var(--crm-danger, #ef4444); opacity: 0.55; }
    .error-empty .empty-text { color: var(--crm-text-muted); max-width: 220px; }

    .empty-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      opacity: 0.15;
    }

    .empty-text {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--crm-text-muted);
    }

    .empty-hint {
      margin: 4px 0 0;
      font-size: 12px;
      color: var(--crm-text-muted);
      opacity: 0.6;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(-8px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
  `],
})
export class ConversationListComponent {
  protected readonly chatService = inject(StaffChatService);
  protected readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);

  conversationSelected = output<string>();
  searchQuery = '';
  private readonly _searchQuery = signal('');
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly filteredConversations = computed(() => {
    const q = this._searchQuery().toLowerCase().trim();
    const convs = this.chatService.conversations();
    if (!q) return convs;
    return convs.filter(c => {
      const name = this.chatService.getConversationDisplayName(c).toLowerCase();
      return name.includes(q);
    });
  });

  onSearch(value: string): void {
    this._searchQuery.set(value);
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.chatService.filterConversations(value);
    }, 300);
  }

  isDirectOnline(conv: StaffConversation): boolean {
    if (conv.type !== 'direct') return false;
    const currentUserId = this.authService.currentUser()?.id;
    const other = conv.participants?.find(p => p.user_id !== currentUserId);
    return other ? this.wsService.isUserOnline(other.user_id) : false;
  }

  avatarColor(id: string): string {
    const colors = ['#1976d2', '#388e3c', '#d32f2f', '#7b1fa2', '#f57c00', '#0097a7', '#5d4037', '#455a64'];
    let hash = 0;
    for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  avatarInitials(name: string): string {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (name[0] || '?').toUpperCase();
  }

  retry(): void {
    this.chatService.clearError();
    this.chatService.loadConversations();
  }

  toggleArchive(event: Event, conv: StaffConversation): void {
    event.stopPropagation();
    if (this.chatService.showArchived()) {
      this.chatService.unarchiveConversation(conv.id);
    } else {
      this.chatService.archiveConversation(conv.id);
    }
  }

  openNewConversation(): void {
    this.chatService.loadContacts();
    this.dialog.open(NewConversationDialogComponent, {
      width: '400px',
    }).afterClosed().subscribe(result => {
      if (result?.type === 'direct' && result.userId) {
        this.chatService.createDirect(result.userId);
      } else if (result?.type === 'group' && result.participantIds?.length && result.title) {
        this.chatService.createGroup(result.title, result.participantIds);
      }
    });
  }
}
