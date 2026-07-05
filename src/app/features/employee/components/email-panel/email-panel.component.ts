import {
  Component, inject, signal, input, output,
  ChangeDetectionStrategy, OnDestroy, OnInit
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../../core/services/toast.service';
import { CRM_MAIL_ACCOUNTS, EmailMessage } from '../../models/email.model';

type EmailFolder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'starred';
type EmailMailboxFilter = 'all' | (typeof CRM_MAIL_ACCOUNTS)[number]['address'];

interface EmailFolderTab {
  id: EmailFolder;
  label: string;
  shortLabel: string;
  icon: string;
}

interface EmailMailboxCount {
  address: string;
  unread: number;
  total: number;
}

@Component({
  selector: 'app-email-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatCheckboxModule,
    DatePipe,
  ],
  host: {
    '(document:keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="email-panel">

      <!-- Header -->
      <div class="ep-header">
        <div class="ep-heading">
          <mat-icon class="ep-icon">mail</mat-icon>
          <div class="ep-heading-text">
            <span class="ep-title">Почта</span>
            <span class="ep-account">{{ mailAccountAddress }}</span>
          </div>
          @if (unreadCount() > 0) {
            <span class="ep-badge">{{ unreadCount() }}</span>
          }
        </div>
        <div class="ep-actions">
          <button class="ep-compose-btn" type="button" (click)="onCompose()" aria-label="Написать письмо">
            <mat-icon>edit</mat-icon>
            <span>Написать</span>
          </button>
          <button class="ep-refresh-btn" type="button" (click)="refreshMessages()"
                  [disabled]="loading()" matTooltip="Обновить почту" aria-label="Обновить почту">
            @if (loading()) {
              <mat-progress-spinner diameter="16" mode="indeterminate" />
            } @else {
              <mat-icon>refresh</mat-icon>
            }
          </button>
        </div>
      </div>

      <!-- Tabs -->
      <div class="ep-tabs">
        @for (folder of folders; track folder.id) {
          <button class="ep-tab" type="button"
                  [class.ep-tab--active]="activeFolder() === folder.id"
                  [matTooltip]="folder.label"
                  [attr.aria-label]="folder.label"
                  (click)="setFolder(folder.id)">
            <mat-icon>{{ folder.icon }}</mat-icon>
            <span class="ep-tab-label">{{ folder.shortLabel }}</span>
            @if (folder.id === 'inbox' && unreadCount() > 0) {
              <span class="ep-tab-badge">{{ unreadCount() }}</span>
            }
          </button>
        }
      </div>

      <div class="ep-mailboxes" role="group" aria-label="Ящики почты">
        <button class="ep-mailbox-btn" type="button"
                [class.ep-mailbox-btn--active]="activeMailbox() === 'all'"
                (click)="setMailbox('all')">
          <span>Все</span>
          @if (unreadCount() > 0) {
            <span class="ep-mailbox-badge">{{ unreadCount() }}</span>
          }
        </button>
        @for (account of mailAccounts; track account.address) {
          <button class="ep-mailbox-btn" type="button"
                  [class.ep-mailbox-btn--active]="activeMailbox() === account.address"
                  [matTooltip]="account.address"
                  (click)="setMailbox(account.address)">
            <span>{{ account.shortLabel }}</span>
            @if (mailboxUnread(account.address) > 0) {
              <span class="ep-mailbox-badge">{{ mailboxUnread(account.address) }}</span>
            }
          </button>
        }
      </div>

      <!-- Bulk bar -->
      @if (selectedIds().length > 0) {
        <div class="ep-bulk-bar">
          <span class="ep-bulk-count">Выбрано: {{ selectedIds().length }}</span>
          <button mat-button (click)="bulkAction('read')">
            <mat-icon>drafts</mat-icon> Прочитано
          </button>
          <button mat-button (click)="bulkAction('archive')">
            <mat-icon>archive</mat-icon> В архив
          </button>
        </div>
      }

      <!-- Search -->
      <div class="ep-search">
        <div class="ep-search-inner">
          <mat-icon class="ep-search-icon">search</mat-icon>
          <input
            type="text"
            [(ngModel)]="searchQuery"
            (input)="onSearchInput()"
            placeholder="Поиск по теме, отправителю, тексту..."
            class="ep-search-input"
          >
        </div>
      </div>

      <div class="ep-list-tools">
        <mat-checkbox
          [checked]="selectAll()"
          [indeterminate]="selectedIds().length > 0 && !selectAll()"
          (change)="toggleSelectAll()"
          class="ep-select-all"
        >
          <span>Все</span>
        </mat-checkbox>
        <span class="ep-folder-hint">{{ currentFolderLabel() }}</span>
      </div>

      <!-- Email list -->
      <div class="ep-list">
        @if (loading()) {
          <div class="ep-loading">
            <mat-progress-spinner diameter="24" mode="indeterminate" />
          </div>
        } @else if (messages().length === 0) {
          <div class="ep-empty">
            <mat-icon class="ep-empty-icon">mail_outline</mat-icon>
            <div class="ep-empty-text">Писем нет</div>
          </div>
        } @else {
          @for (msg of messages(); track msg.id) {
            <div class="ep-item"
                 [class.ep-item--unread]="msg.status === 'received'"
                 [class.ep-item--active]="selectedId() === msg.id"
                 (click)="selectEmail(msg)"
                 (keydown.enter)="selectEmail(msg)"
                 tabindex="0">
              <div class="ep-item-row">
                <mat-checkbox
                  [checked]="isSelected(msg.id)"
                  (change)="toggleSelect(msg.id)"
                  (click)="$event.stopPropagation()"
                  class="ep-item-checkbox"
                />
                <button mat-icon-button class="ep-star-btn" [class.starred]="msg.is_starred" (click)="toggleStar(msg, $event)">
                  <mat-icon>{{ msg.is_starred ? 'star' : 'star_border' }}</mat-icon>
                </button>
                <span class="ep-item-from">
                  {{ participantLabel(msg) }}
                </span>
                <span class="ep-item-date">{{ msg.created_at | date:'dd.MM HH:mm' }}</span>
              </div>
              <div class="ep-item-subject">{{ msg.subject || '(без темы)' }}</div>
              <div class="ep-item-preview">{{ msg.body_text }}</div>
              <div class="ep-item-meta">
                @if (msg.status === 'received') {
                  <span class="ep-badge ep-badge--new">новое</span>
                }
                @if (msg.status === 'replied') {
                  <span class="ep-meta-tag">↩ отвечено</span>
                }
                @if (msg.status === 'failed') {
                  <span class="ep-meta-tag ep-meta-tag--error">✗ ошибка</span>
                }
                @if (msg.mailbox_address) {
                  <span class="ep-mailbox-tag">{{ mailboxShortLabel(msg.mailbox_address) }}</span>
                }
                @if (msg.has_attachments) {
                  <mat-icon class="ep-attach-icon">attach_file</mat-icon>
                }
                @if (msg.customer_phone) {
                  <span class="ep-meta-tag">📞 {{ msg.customer_phone }}</span>
                }
              </div>
            </div>
          }
          @if (hasMore()) {
            <div class="ep-load-more">
              <button mat-button class="ep-load-btn" (click)="loadMore()">
                Загрузить ещё
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; }

    .email-panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--crm-bg, var(--crm-surface-base));
      overflow: hidden;
    }

    .ep-header {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;
    }

    .ep-heading,
    .ep-actions {
      display: flex;
      align-items: center;
      width: 100%;
      min-width: 0;
    }

    .ep-heading {
      gap: 8px;
    }

    .ep-actions {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 34px;
      gap: 8px;
    }

    .ep-icon {
      color: var(--crm-accent);
      font-size: 17px;
      width: 17px;
      height: 17px;
    }

    .ep-heading-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .ep-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary);
      font-family: var(--crm-font-sans);
    }

    .ep-account {
      font-size: 11px;
      color: var(--crm-text-muted);
      line-height: 1.15;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: var(--crm-font-sans);
    }

    .ep-badge {
      background: var(--crm-accent);
      color: var(--crm-on-accent);
      border-radius: 10px;
      padding: 1px 7px;
      font-size: 11px;
      font-weight: 700;
      line-height: 1.4;

      &--new {
        font-size: 10px;
        padding: 1px 5px;
        border-radius: 3px;
      }
    }

    .ep-compose-btn {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 32px;
      min-width: 0;
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 7px;
      background: var(--crm-accent);
      color: var(--crm-on-accent);
      font-size: 12px;
      font-weight: 700;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: background var(--crm-transition-fast), transform var(--crm-transition-fast);

      mat-icon {
        font-size: 15px;
        width: 15px;
        height: 15px;
      }

      &:hover { background: var(--crm-accent-hover); transform: translateY(-1px); }
      &:active { transform: translateY(0); }
    }

    .ep-refresh-btn {
      width: 34px;
      height: 32px;
      border: 1px solid var(--crm-border);
      border-radius: 7px;
      color: var(--crm-text-secondary);
      background: var(--crm-surface-raised);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: color var(--crm-transition-fast), border-color var(--crm-transition-fast), background var(--crm-transition-fast);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover:not(:disabled) {
        color: var(--crm-text-primary);
        border-color: rgba(245, 158, 11, 0.35);
        background: var(--crm-surface-hover);
      }

      &:disabled {
        cursor: progress;
        opacity: 0.78;
      }
    }

    .ep-tabs {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;
      overflow: visible;
      background: var(--crm-surface-base);
    }

    .ep-tab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 28px;
      min-width: 0;
      width: 100%;
      padding: 5px 6px;
      font-size: 11px;
      border: 1px solid transparent;
      border-radius: 7px;
      cursor: pointer;
      font-family: var(--crm-font-sans);
      background: transparent;
      color: var(--crm-text-secondary);
      white-space: nowrap;
      transition: color var(--crm-transition-fast), border-color var(--crm-transition-fast), background var(--crm-transition-fast);

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }

      &:hover { color: var(--crm-text-primary); background: var(--crm-surface-hover); }

      &--active {
        color: var(--crm-accent);
        border-color: rgba(245, 158, 11, 0.32);
        background: rgba(245, 158, 11, 0.08);
        font-weight: 600;
      }
    }

    .ep-tab-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ep-tab-badge {
      background: var(--crm-accent);
      color: var(--crm-on-accent);
      border-radius: 10px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 700;
      margin-left: 4px;
    }

    .ep-mailboxes {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      padding: 6px 8px 8px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
    }

    .ep-mailbox-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-width: 0;
      height: 26px;
      padding: 0 7px;
      border: 1px solid var(--crm-border);
      border-radius: 7px;
      background: var(--crm-surface-raised);
      color: var(--crm-text-secondary);
      font-family: var(--crm-font-sans);
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      transition: color var(--crm-transition-fast), border-color var(--crm-transition-fast), background var(--crm-transition-fast);

      span:first-child {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:hover {
        color: var(--crm-text-primary);
        background: var(--crm-surface-hover);
      }

      &--active {
        color: var(--crm-accent);
        border-color: rgba(245, 158, 11, 0.35);
        background: rgba(245, 158, 11, 0.08);
      }
    }

    .ep-mailbox-badge {
      min-width: 16px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--crm-accent);
      color: var(--crm-on-accent);
      font-size: 9px;
      line-height: 15px;
      font-weight: 700;
      flex-shrink: 0;
    }

    .ep-bulk-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: var(--crm-surface-raised);
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;

      button {
        font-size: 12px;
        color: var(--crm-text-secondary);
        mat-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 2px; }
      }
    }

    .ep-bulk-count {
      font-size: 12px;
      color: var(--crm-accent);
      font-weight: 600;
      font-family: var(--crm-font-sans);
    }

    .ep-search {
      padding: 8px 12px 6px;
      flex-shrink: 0;
    }

    .ep-search-inner {
      display: flex;
      align-items: center;
      gap: 6px;
      background: var(--crm-surface-hover);
      border-radius: 6px;
      padding: 4px 10px;
    }

    .ep-search-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-text-secondary);
    }

    .ep-search-input {
      border: none;
      background: transparent;
      outline: none;
      font-size: 12px;
      color: var(--crm-text-primary);
      flex: 1;
      font-family: var(--crm-font-sans);

      &::placeholder { color: var(--crm-text-muted); }
    }

    .ep-list-tools {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 12px 8px;
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;
      color: var(--crm-text-muted);
      font-family: var(--crm-font-sans);
      font-size: 11px;
    }

    .ep-select-all {
      min-width: 0;
      font-size: 11px;
      color: var(--crm-text-secondary);
    }

    .ep-folder-hint {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ep-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }

    .ep-loading {
      display: flex;
      justify-content: center;
      padding: 40px;
    }

    .ep-empty {
      padding: 40px 20px;
      text-align: center;
      color: var(--crm-text-secondary);
    }

    .ep-empty-icon {
      font-size: 36px;
      width: 36px;
      height: 36px;
      display: block;
      margin: 0 auto 8px;
      color: var(--crm-text-muted);
    }

    .ep-empty-text {
      font-size: 13px;
      font-family: var(--crm-font-sans);
    }

    .ep-item {
      padding: 10px 14px;
      cursor: pointer;
      border-bottom: 1px solid var(--crm-border);
      background: transparent;
      transition: background var(--crm-transition-fast);
      position: relative;

      &::before {
        content: '';
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 2px;
        background: transparent;
        transition: background var(--crm-transition-fast);
      }

      &:hover { background: var(--crm-surface-hover); }

      &--unread { background: rgba(245, 158, 11, 0.05); }

      &--active {
        background: var(--crm-surface-active);
        &::before { background: var(--crm-accent); }
      }
    }

    .ep-item-row {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-bottom: 3px;
    }

    .ep-item-checkbox {
      flex-shrink: 0;
    }

    .ep-item-from {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-primary);
      flex: 1;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ep-item-date {
      font-size: 10px;
      color: var(--crm-text-secondary);
      flex-shrink: 0;
      margin-left: auto;
    }

    .ep-item-subject {
      font-size: 12px;
      color: var(--crm-text-primary);
      margin-bottom: 2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;

      .ep-item--unread & { font-weight: 600; }
    }

    .ep-item-preview {
      font-size: 11px;
      color: var(--crm-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ep-item-meta {
      display: flex;
      gap: 4px;
      margin-top: 4px;
      align-items: center;
      flex-wrap: wrap;
    }

    .ep-meta-tag {
      font-size: 10px;
      color: var(--crm-text-secondary);

      &--error { color: var(--crm-status-error); }
    }

    .ep-mailbox-tag {
      max-width: 110px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 1px solid rgba(245, 158, 11, 0.28);
      border-radius: 4px;
      padding: 1px 5px;
      color: var(--crm-accent);
      font-size: 10px;
      line-height: 1.35;
      font-weight: 600;
      font-family: var(--crm-font-sans);
    }

    .ep-attach-icon {
      font-size: 11px;
      width: 11px;
      height: 11px;
      color: var(--crm-text-secondary);
    }

    .ep-load-more {
      padding: 10px;
      text-align: center;
    }

    .ep-load-btn {
      font-size: 12px;
      color: var(--crm-accent);
    }

    .ep-star-btn {
      width: 24px !important;
      height: 24px !important;
      line-height: 24px !important;
      color: var(--crm-text-muted);
      flex-shrink: 0;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .ep-star-btn.starred { color: #f59e0b; }
  `],
})
export class EmailPanelComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  selectedId = input<number | null>(null);

  emailSelected = output<EmailMessage>();
  composeRequested = output<void>();
  unreadCountChanged = output<number>();

  protected readonly mailAccounts = CRM_MAIL_ACCOUNTS;
  protected readonly mailAccountAddress = CRM_MAIL_ACCOUNTS.map(account => account.address).join(' · ');

  protected readonly folders: readonly EmailFolderTab[] = [
    { id: 'inbox', label: 'Входящие', shortLabel: 'Входящие', icon: 'inbox' },
    { id: 'sent', label: 'Отправленные', shortLabel: 'Отпр.', icon: 'send' },
    { id: 'drafts', label: 'Черновики', shortLabel: 'Чернов.', icon: 'drafts' },
    { id: 'archive', label: 'Архив', shortLabel: 'Архив', icon: 'archive' },
    { id: 'starred', label: 'Важные', shortLabel: 'Важные', icon: 'star' },
  ];

  activeFolder = signal<EmailFolder>('inbox');
  activeMailbox = signal<EmailMailboxFilter>('all');
  messages = signal<EmailMessage[]>([]);
  loading = signal(false);
  hasMore = signal(false);
  unreadCount = signal(0);
  mailboxCounts = signal<readonly EmailMailboxCount[]>([]);
  searchQuery = '';

  // Bulk selection
  selectedIds = signal<readonly number[]>([]);
  selectAll = signal(false);
  selectedIndex = signal(0);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private offset = 0;
  private readonly PAGE_SIZE = 30;

  ngOnInit(): void {
    this.loadMessages();
    this.loadCounts();
  }

  ngOnDestroy(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  setFolder(folder: EmailFolder): void {
    this.activeFolder.set(folder);
    this.offset = 0;
    this.messages.set([]);
    this.selectedIds.set([]);
    this.selectAll.set(false);
    this.loadMessages();
  }

  setMailbox(mailbox: EmailMailboxFilter): void {
    if (this.activeMailbox() === mailbox) return;
    this.activeMailbox.set(mailbox);
    this.offset = 0;
    this.messages.set([]);
    this.selectedIds.set([]);
    this.selectAll.set(false);
    this.loadMessages();
  }

  currentFolderLabel(): string {
    return this.folders.find(folder => folder.id === this.activeFolder())?.label ?? 'Почта';
  }

  participantLabel(message: EmailMessage): string {
    return message.direction === 'outbound' ? message.to_address : message.from_address;
  }

  mailboxShortLabel(address: string): string {
    return this.mailAccounts.find(account => account.address === address)?.shortLabel
      || address.split('@')[1]
      || address;
  }

  mailboxUnread(address: string): number {
    return this.mailboxCounts().find(mailbox => mailbox.address === address)?.unread ?? 0;
  }

  onSearchInput(): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.offset = 0;
      this.messages.set([]);
      this.loadMessages();
    }, 350);
  }

  loadMessages(): void {
    this.loading.set(true);
    const folder = this.activeFolder();
    const params = new URLSearchParams({
      limit: String(this.PAGE_SIZE),
      offset: String(this.offset),
    });

    // Map folder to API params
    switch (folder) {
      case 'inbox':
        params.set('direction', 'inbound');
        break;
      case 'sent':
        params.set('direction', 'outbound');
        break;
      case 'drafts':
        params.set('direction', 'outbound');
        params.set('status', 'draft');
        break;
      case 'archive':
        params.set('direction', 'all');
        params.set('status', 'archived');
        break;
      case 'starred':
        params.set('direction', 'all');
        params.set('starred', 'true');
        break;
    }

    if (this.searchQuery.trim()) params.set('search', this.searchQuery.trim());
    if (this.activeMailbox() !== 'all') params.set('mailbox', this.activeMailbox());

    this.http.get<{ success: boolean; data: EmailMessage[]; total: number }>(
      `/api/crm/email?${params}`
    ).subscribe({
      next: r => {
        if (this.offset === 0) {
          this.messages.set(r.data);
        } else {
          this.messages.update(prev => [...prev, ...r.data]);
        }
        this.hasMore.set(this.messages().length < r.total);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить письма');
      },
    });
  }

  loadMore(): void {
    this.offset += this.PAGE_SIZE;
    this.loadMessages();
  }

  refreshMessages(): void {
    this.offset = 0;
    this.messages.set([]);
    this.selectedIds.set([]);
    this.selectAll.set(false);
    this.loadMessages();
    this.loadCounts();
  }

  loadCounts(): void {
    this.http.get<{ success: boolean; data: { unread: number; mailboxes: EmailMailboxCount[] } }>('/api/crm/email/counts').subscribe({
      next: r => {
        this.unreadCount.set(r.data.unread);
        this.mailboxCounts.set(r.data.mailboxes || []);
        this.unreadCountChanged.emit(r.data.unread);
      },
      error: () => undefined,
    });
  }

  // Bulk selection
  isSelected(id: number): boolean {
    return this.selectedIds().includes(id);
  }

  toggleSelect(id: number): void {
    this.selectedIds.update(prev => (
      prev.includes(id)
        ? prev.filter(selectedId => selectedId !== id)
        : [...prev, id]
    ));
    this.selectAll.set(this.messages().length > 0 && this.selectedIds().length === this.messages().length);
  }

  toggleSelectAll(): void {
    if (this.selectAll()) {
      this.selectedIds.set([]);
      this.selectAll.set(false);
    } else {
      this.selectedIds.set(this.messages().map(e => e.id));
      this.selectAll.set(true);
    }
  }

  async bulkAction(action: 'archive' | 'read' | 'unread'): Promise<void> {
    const ids = [...this.selectedIds()];
    if (!ids.length) return;
    try {
      await firstValueFrom(this.http.post('/api/crm/email/bulk', { ids, action }));
      this.selectedIds.set([]);
      this.selectAll.set(false);
      this.loadMessages();
      if (action === 'read' || action === 'archive') this.loadCounts();
    } catch {
      this.toast.error('Ошибка массового действия');
    }
  }

  markAsRead(id: number): void {
    let wasUnread = false;
    let mailboxAddress: string | null = null;
    this.messages.update(msgs => msgs.map(m => {
      if (m.id === id && m.status === 'received') {
        wasUnread = true;
        mailboxAddress = m.mailbox_address;
        return { ...m, status: 'read' as const };
      }
      return m;
    }));
    if (wasUnread) {
      this.unreadCount.update(n => Math.max(0, n - 1));
      if (mailboxAddress) {
        this.mailboxCounts.update(counts => counts.map(count =>
          count.address === mailboxAddress
            ? { ...count, unread: Math.max(0, count.unread - 1) }
            : count
        ));
      }
      this.unreadCountChanged.emit(this.unreadCount());
    }
  }

  markAsReplied(id: number): void {
    this.messages.update(msgs => msgs.map(m =>
      m.id === id ? { ...m, status: 'replied' as const } : m
    ));
  }

  removeMessage(id: number): void {
    this.messages.update(msgs => msgs.filter(m => m.id !== id));
  }

  onCompose(): void {
    this.composeRequested.emit();
  }

  selectEmail(msg: EmailMessage): void {
    const idx = this.messages().indexOf(msg);
    if (idx >= 0) this.selectedIndex.set(idx);
    if (msg.status === 'received') {
      this.markAsRead(msg.id);
      this.emailSelected.emit({ ...msg, status: 'read' });
      return;
    }
    this.emailSelected.emit(msg);
  }

  async toggleStar(email: EmailMessage, event: Event): Promise<void> {
    event.stopPropagation();
    const newState = !email.is_starred;
    try {
      await firstValueFrom(this.http.patch(`/api/crm/email/${email.id}/star`, { starred: newState }));
      this.messages.update(list => list.map(e => e.id === email.id ? { ...e, is_starred: newState } : e));
    } catch {
      this.toast.error('Ошибка обновления');
    }
  }

  onKeydown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (event.target as HTMLElement).isContentEditable) return;

    const emails = this.messages();
    const currentIdx = this.selectedIndex();

    switch (event.key) {
      case 'j':
        if (currentIdx < emails.length - 1) {
          this.selectEmail(emails[currentIdx + 1]);
        }
        break;
      case 'k':
        if (currentIdx > 0) {
          this.selectEmail(emails[currentIdx - 1]);
        }
        break;
      case 'x':
        if (emails[currentIdx]) this.toggleSelect(emails[currentIdx].id);
        break;
      case 'e':
        if (this.selectedIds().length > 0) this.bulkAction('archive');
        break;
    }
  }
}
