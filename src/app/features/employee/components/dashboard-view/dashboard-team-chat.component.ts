import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
  effect, ElementRef, viewChild, DestroyRef, untracked,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { StaffChatService } from '../../services/staff-chat.service';
import { StaffChatMediaService, type StaffChatMediaItem } from '../../services/staff-chat-media.service';
import { StaffMessage } from '../../models/staff-chat.model';
import { AuthService } from '../../../../core/services/auth.service';

interface PendingFile {
  file: File;
  previewUrl: string | null;
  isImage: boolean;
}

interface LightboxImage {
  url: string;
  message: StaffMessage;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const QUICK_EMOJIS = ['👍', '❤️', '😂', '🔥', '👏', '😢'];

@Component({
  selector: 'app-dashboard-team-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule, MatMenuModule],
  host: {
    '(dragover)': 'onDragOver($event)',
    '(dragleave)': 'onDragLeave($event)',
    '(drop)': 'onDrop($event)',
  },
  template: `
    @if (isDragOver()) {
      <div class="drag-overlay">
        <mat-icon>cloud_upload</mat-icon>
        <span>Перетащите файл сюда</span>
      </div>
    }

    <!-- Header -->
    <div class="chat-header">
      @if (searchMode()) {
        <mat-icon class="header-icon">search</mat-icon>
        <input
          class="search-input"
          type="text"
          placeholder="Поиск по чату..."
          [value]="searchQuery()"
          (input)="onSearchInput(asInput($event).value)"
          #searchInput
        />
        <button class="icon-btn" (click)="closeSearch()" aria-label="Закрыть поиск">
          <mat-icon>close</mat-icon>
        </button>
      } @else {
        <mat-icon class="header-icon">forum</mat-icon>
        <span class="header-title">Командный чат</span>
        @if (chatService.generalUnread(); as unread) {
          <span class="unread-badge">{{ unread }}</span>
        }
        <button class="icon-btn" (click)="chatService.toggleSoundMuted()" [attr.aria-label]="chatService.soundMuted() ? 'Включить звук' : 'Выключить звук'">
          <mat-icon>{{ chatService.soundMuted() ? 'volume_off' : 'volume_up' }}</mat-icon>
        </button>
        <button class="icon-btn" (click)="openSearch()" aria-label="Поиск">
          <mat-icon>search</mat-icon>
        </button>
      }
    </div>

    <!-- Messages -->
    <div class="chat-messages"
         #scrollContainer
         (scroll)="onScroll()">


      @if (searchMode() && searchQuery().length >= 2 && !chatService.searching()) {
        @if (chatService.searchResults().length === 0) {
          <div class="empty">Ничего не найдено</div>
        }
      }

      @for (msg of displayMessages(); track msg.id; let i = $index) {
        <!-- Date divider -->
        @if (showDateDivider(i)) {
          <div class="date-divider">
            <span>{{ dateDividerLabel(msg.created_at) }}</span>
          </div>
        }
        @let grouped = isGrouped(i);
        <div class="msg"
             [class.own]="msg.sender_id === currentUserId()"
             [class.grouped]="grouped"
             (contextmenu)="onContextMenu($event, msg)">
          @if (!grouped) {
            <span class="msg-avatar" [style.background]="avatarColor(msg.sender_name)">
              {{ msg.sender_name[0] || '?' }}
            </span>
          } @else {
            <span class="msg-avatar-spacer"></span>
          }
          <div class="msg-body">
            @if (!grouped) {
              <div class="msg-meta">
                <span class="msg-name">{{ msg.sender_name }}</span>
                <span class="msg-time">{{ formatTime(msg.created_at) }}</span>
              </div>
            }

            <!-- Hover actions toolbar -->
            @if (!msg.deleted_at) {
              <div class="msg-hover-actions" [class.left]="msg.sender_id !== currentUserId()">
                <button class="hover-action-btn" (click)="setReplyTo(msg)" matTooltip="Ответить">
                  <mat-icon>reply</mat-icon>
                </button>
                <button class="hover-action-btn" [matMenuTriggerFor]="emojiMenu" (menuOpened)="activeEmojiMsgId.set(msg.id)" matTooltip="Реакция">
                  <mat-icon>add_reaction</mat-icon>
                </button>
                <button class="hover-action-btn" (click)="copyText(msg)" matTooltip="Копировать">
                  <mat-icon>content_copy</mat-icon>
                </button>
                @if (msg.attachment_url) {
                  <button class="hover-action-btn" (click)="downloadMessageMedia(msg)" matTooltip="Скачать">
                    <mat-icon>download</mat-icon>
                  </button>
                }
                @if (msg.sender_id === currentUserId() && !msg.attachment_url) {
                  <button class="hover-action-btn" (click)="startEdit(msg)" matTooltip="Редактировать">
                    <mat-icon>edit</mat-icon>
                  </button>
                }
                @if (msg.sender_id === currentUserId()) {
                  <button class="hover-action-btn hover-action-danger" (click)="deleteMessage(msg.id)" matTooltip="Удалить">
                    <mat-icon>delete</mat-icon>
                  </button>
                }
              </div>
            }

            <!-- Reply quote -->
            @if (msg.reply_to_message_id || msg.reply_to_content) {
              <div class="reply-quote">
                @if (msg.reply_to_sender_name) {
                  <span class="reply-quote-sender">{{ msg.reply_to_sender_name }}</span>
                }
                <span class="reply-quote-line">
                  @if (replyPreviewItem(msg); as replyItem) {
                    <img class="reply-quote-thumb" [src]="media.imagePreviewUrl(replyItem)"
                         [alt]="replySummary(msg)" loading="lazy" />
                  } @else if (replyIcon(msg); as icon) {
                    <mat-icon class="reply-quote-icon">{{ icon }}</mat-icon>
                  }
                  <span class="reply-quote-text">{{ replySummary(msg) }}</span>
                </span>
              </div>
            }

            <!-- Forwarded badge -->
            @if (msg.is_forwarded) {
              <div class="forwarded-badge">
                <mat-icon>reply</mat-icon>
                Переслано{{ msg.forwarded_from_name ? ' от ' + msg.forwarded_from_name : '' }}
              </div>
            }

            <div class="msg-content">
              @if (msg.deleted_at) {
                <em class="deleted">Сообщение удалено</em>
              } @else if (editingMsgId() === msg.id) {
                <input class="edit-input"
                       type="text"
                       [value]="editText()"
                       (input)="editText.set(asInput($event).value)"
                       (keydown.enter)="confirmEdit(msg.id)"
                       (keydown.escape)="cancelEdit()" />
                <div class="edit-actions">
                  <button class="edit-action-btn" (click)="confirmEdit(msg.id)">
                    <mat-icon>check</mat-icon>
                  </button>
                  <button class="edit-action-btn" (click)="cancelEdit()">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              } @else if (msg.message_type === 'image' && msg.attachment_url) {
                <div class="msg-img-wrap">
                  <img class="msg-img" [src]="imagePreviewUrl(msg)" [alt]="msg.original_filename || 'Фото'" loading="lazy" tabindex="0" role="button" (click)="openImage(msg)" (keydown.enter)="openImage(msg)" />
                  <div class="msg-img-actions">
                    <button class="img-action-btn" (click)="downloadMessageMedia(msg)" matTooltip="Скачать">
                      <mat-icon>download</mat-icon>
                    </button>
                    <button class="img-action-btn" (click)="openMessageMedia($event, msg)" matTooltip="Новая вкладка">
                      <mat-icon>open_in_new</mat-icon>
                    </button>
                  </div>
                </div>
                @if (msg.content && msg.content !== msg.original_filename && !msg.content.startsWith('[')) {
                  <span class="msg-caption">{{ msg.content }}</span>
                }
              } @else if (msg.attachment_url) {
                <button class="msg-file" (click)="downloadMessageMedia(msg)">
                  <mat-icon>{{ fileIcon(msg.message_type) }}</mat-icon>
                  <span>{{ msg.original_filename || 'Файл' }}</span>
                  <mat-icon class="dl-icon">download</mat-icon>
                </button>
              } @else {
                @if (searchMode() && searchQuery()) {
                  <span [innerHTML]="highlightSearch(msg.content)"></span>
                } @else {
                  <span [innerHTML]="formatMentions(msg.content)"></span>
                }
                @if (msg.edited_at) {
                  <span class="edited-mark">(ред.)</span>
                }
              }
            </div>

            <!-- Reactions display -->
            @if (msg.reactions?.length) {
              <div class="reactions-row">
                @for (r of msg.reactions; track r.emoji) {
                  <button class="reaction-chip" [class.my]="r.myReaction" (click)="toggleReaction(msg.id, r.emoji)">
                    {{ r.emoji }} {{ r.count }}
                  </button>
                }
              </div>
            }
          </div>
        </div>
      } @empty {
        @if (!searchMode()) {
          <div class="empty">Пока нет сообщений</div>
        }
      }

      @if (typingText()) {
        <div class="typing-indicator">{{ typingText() }}</div>
      }
    </div>

    <!-- New messages badge -->
    @if (hasNewBelow()) {
      <button class="new-messages-btn" (click)="scrollToBottom()">
        <mat-icon>keyboard_arrow_down</mat-icon> Новые
      </button>
    }

    <!-- Reply preview -->
    @if (replyTo()) {
      <div class="reply-preview">
        @if (messagePreviewItem(replyTo()!); as replyItem) {
          <img class="reply-preview-thumb" [src]="media.imagePreviewUrl(replyItem)"
               [alt]="messagePreviewLabel(replyTo()!)" loading="lazy" />
        } @else if (messageIcon(replyTo()!); as icon) {
          <mat-icon class="reply-preview-icon">{{ icon }}</mat-icon>
        } @else {
          <mat-icon class="reply-preview-icon">reply</mat-icon>
        }
        <div class="reply-preview-body">
          <span class="reply-preview-name">{{ replyTo()!.sender_name }}</span>
          <span class="reply-preview-text">{{ messagePreviewLabel(replyTo()!) }}</span>
        </div>
        <button class="icon-btn" (click)="cancelReply()" aria-label="Отменить ответ">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }

    <!-- File preview -->
    @if (pendingFile()) {
      <div class="file-preview">
        @if (pendingFile()!.isImage && pendingFile()!.previewUrl) {
          <img class="file-thumb" [src]="pendingFile()!.previewUrl" alt="Превью" />
        } @else {
          <mat-icon class="file-thumb-icon">description</mat-icon>
        }
        <div class="file-info">
          <span class="file-name">{{ pendingFile()!.file.name }}</span>
          <span class="file-size">{{ formatSize(pendingFile()!.file.size) }}</span>
        </div>
        <button class="icon-btn" (click)="cancelFile()" aria-label="Отменить">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }

    <!-- Input -->
    @if (!searchMode()) {
      <div class="chat-input">
        <button class="icon-btn attach-btn" (click)="fileInput.click()" [disabled]="!chatService.generalId() || chatService.uploading()" aria-label="Прикрепить файл">
          <mat-icon>attach_file</mat-icon>
        </button>
        <input
          #fileInput
          type="file"
          class="hidden-file"
          (change)="onFileSelected($event)"
        />
        <input
          type="text"
          [placeholder]="replyTo() ? 'Ответить...' : 'Сообщение...'"
          [value]="inputText()"
          (input)="onTextInput(asInput($event).value)"
          (keydown.enter)="send()"
          [disabled]="!chatService.generalId() || chatService.uploading()"
        />
        <button class="icon-btn send-btn" (click)="send()" [disabled]="(!inputText().trim() && !pendingFile()) || !chatService.generalId() || chatService.uploading()" aria-label="Отправить">
          @if (chatService.uploading()) {
            <mat-icon class="spin">sync</mat-icon>
          } @else {
            <mat-icon>send</mat-icon>
          }
        </button>
      </div>
    }

    <!-- No general chat -->
    @if (noGeneral()) {
      <div class="no-chat">
        <span>Общий чат не создан</span>
        @if (isAdmin()) {
          <button class="create-btn" (click)="createGeneral()">Создать</button>
        }
      </div>
    }

    <!-- Emoji quick picker menu -->
    <mat-menu #emojiMenu="matMenu" class="emoji-picker-menu">
      <div class="emoji-picker" role="toolbar" tabindex="0" (click)="$event.stopPropagation()" (keydown.enter)="$event.stopPropagation()">
        @for (emoji of quickEmojis; track emoji) {
          <button class="emoji-btn" (click)="onEmojiPick(emoji)">{{ emoji }}</button>
        }
      </div>
    </mat-menu>

    <!-- Context menu -->
    <div style="visibility:hidden;position:fixed"
         [style.left]="ctxPosition().x"
         [style.top]="ctxPosition().y"
         [matMenuTriggerFor]="ctxMenu"
         #ctxMenuTrigger="matMenuTrigger">
    </div>
    <mat-menu #ctxMenu="matMenu" class="msg-context-menu">
      @if (ctxTarget()) {
        <button mat-menu-item (click)="setReplyTo(ctxTarget()!)">
          <mat-icon>reply</mat-icon> Ответить
        </button>
        <button mat-menu-item (click)="copyText(ctxTarget()!)">
          <mat-icon>content_copy</mat-icon> Копировать
        </button>
        @if (ctxTarget()!.attachment_url) {
          <button mat-menu-item (click)="downloadMessageMedia(ctxTarget()!)">
            <mat-icon>download</mat-icon> Скачать
          </button>
        }
        @if (ctxTarget()!.sender_id === currentUserId() && !ctxTarget()!.attachment_url) {
          <button mat-menu-item (click)="startEdit(ctxTarget()!)">
            <mat-icon>edit</mat-icon> Редактировать
          </button>
        }
        @if (ctxTarget()!.sender_id === currentUserId()) {
          <button mat-menu-item (click)="deleteMessage(ctxTarget()!.id)">
            <mat-icon>delete</mat-icon> Удалить
          </button>
        }
      }
    </mat-menu>

    <!-- Photo popup -->
    @if (lightboxUrl()) {
      <div class="popup-backdrop" (click)="closeLightbox()" (keydown.escape)="closeLightbox()" tabindex="0">
        <div class="popup-window" role="dialog" tabindex="0" (click)="$event.stopPropagation()" (keydown.escape)="closeLightbox()" (keydown.arrowLeft)="lightboxPrev()" (keydown.arrowRight)="lightboxNext()">
          <div class="popup-header">
            <span class="popup-title">Просмотр фото</span>
            @if (lightboxImages().length > 1) {
              <span class="popup-counter">{{ lightboxIndex() + 1 }} / {{ lightboxImages().length }}</span>
            }
            <span class="popup-spacer"></span>
            <button class="popup-action-btn" (click)="downloadLightboxImage()" matTooltip="Скачать">
              <mat-icon>download</mat-icon>
            </button>
            <button class="popup-action-btn" (click)="openLightboxInNewTab()" matTooltip="Новая вкладка">
              <mat-icon>open_in_new</mat-icon>
            </button>
            <button class="popup-action-btn" (click)="closeLightbox()" matTooltip="Закрыть">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="popup-body">
            @if (lightboxImages().length > 1 && lightboxIndex() > 0) {
              <button class="popup-nav popup-nav-left" (click)="lightboxPrev()">
                <mat-icon>chevron_left</mat-icon>
              </button>
            }
            <img class="popup-img" [src]="lightboxUrl()!" alt="Просмотр" />
            @if (lightboxImages().length > 1 && lightboxIndex() < lightboxImages().length - 1) {
              <button class="popup-nav popup-nav-right" (click)="lightboxNext()">
                <mat-icon>chevron_right</mat-icon>
              </button>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      position: relative;
      font-family: 'Plus Jakarta Sans', sans-serif;
      color: var(--crm-text-primary, #ececec);
    }

    /* -- Animations -- */
    @keyframes msgSlideIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-4px); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* -- Header -- */
    .chat-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 4px 10px;
      border-bottom: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      margin-bottom: 8px;
      flex-shrink: 0;
      background: rgba(12,11,9,0.85);
      backdrop-filter: blur(16px) saturate(180%);
      -webkit-backdrop-filter: blur(16px) saturate(180%);
      border-radius: 0;
    }
    .header-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-accent, #f59e0b);
      opacity: .7;
    }
    .header-title {
      font-family: 'Oswald', sans-serif;
      font-size: 13px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--crm-text-secondary, #a0a0a0);
    }
    .unread-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      background: var(--crm-accent, #f59e0b);
      color: #000;
      border-radius: 10px;
      padding: 1px 7px;
      font-weight: 700;
      margin-left: -4px;
      animation: msgSlideIn 200ms ease-out;
    }
    .search-input {
      flex: 1;
      background: transparent;
      border: none;
      color: var(--crm-text-primary, #ececec);
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      outline: none;
    }
    .search-input::placeholder { color: var(--crm-text-muted, #7a7a7a); }

    .icon-btn {
      background: rgba(255,255,255,0.03);
      border: none;
      color: var(--crm-text-secondary, #a0a0a0);
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      border-radius: 6px;
      transition: background 150ms, color 150ms;
    }
    .icon-btn:hover:not(:disabled) {
      background: rgba(255,255,255,0.08);
      color: var(--crm-text-primary, #ececec);
    }
    .icon-btn:disabled { opacity: .15; cursor: default; }
    .icon-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    /* -- Messages -- */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 4px 4px 0;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,.08) transparent;
      position: relative;
    }

    .msg {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      position: relative;
      animation: msgSlideIn 200ms ease-out;
    }
    .msg.grouped { gap: 8px; margin-top: -4px; }
    .msg.own { flex-direction: row-reverse; }
    .msg.own .msg-body { align-items: flex-end; }
    .msg.own .msg-meta { flex-direction: row-reverse; }

    .msg-avatar {
      flex-shrink: 0;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Oswald', sans-serif;
      font-size: 12px;
      font-weight: 700;
      color: #000;
      text-transform: uppercase;
    }
    .msg-avatar-spacer { width: 26px; flex-shrink: 0; }

    .msg-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      max-width: 85%;
      position: relative;
    }

    .msg-meta { display: flex; align-items: baseline; gap: 6px; }
    .msg-name {
      font-size: 11px;
      font-weight: 700;
      color: var(--crm-accent, #f59e0b);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 120px;
    }
    .msg-time {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: var(--crm-text-muted, #7a7a7a);
    }

    /* -- Message content bubbles -- */
    .msg-content {
      font-size: 13px;
      line-height: 1.4;
      word-break: break-word;
      padding: 6px 12px;
      color: var(--crm-text-primary, #ececec);
      background: var(--crm-surface-raised, #1b1a17);
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 4px 16px 16px 16px;
    }
    .msg.own .msg-content {
      background: linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.10) 100%);
      border-color: rgba(245,158,11,0.2);
      border-radius: 16px 4px 16px 16px;
    }
    .msg-content .deleted {
      color: var(--crm-text-muted, #7a7a7a);
      font-size: 12px;
    }

    /* -- Hover actions toolbar -- */
    .msg-hover-actions {
      position: absolute;
      top: -14px;
      right: 0;
      display: flex;
      gap: 1px;
      opacity: 0;
      pointer-events: none;
      background: rgba(12,11,9,0.9);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 8px;
      padding: 2px;
      z-index: 5;
      box-shadow: 0 4px 16px rgba(0,0,0,.4);
      transition: opacity 150ms ease;
    }
    .msg-hover-actions.left { right: auto; left: 0; }
    .msg:hover .msg-hover-actions { opacity: 1; pointer-events: auto; }
    .hover-action-btn {
      background: none;
      border: none;
      color: var(--crm-text-secondary, #a0a0a0);
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      transition: color 150ms, background 150ms;
    }
    .hover-action-btn:hover {
      color: var(--crm-text-primary, #ececec);
      background: rgba(255,255,255,.08);
    }
    .hover-action-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* -- Reply quote -- */
    .reply-quote {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding: 4px 8px;
      border-left: 2px solid var(--crm-accent, #f59e0b);
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border-radius: 0 6px 6px 0;
      font-size: 11px;
      margin-bottom: 2px;
    }
    .reply-quote-sender {
      font-weight: 700;
      font-size: 10px;
      color: var(--crm-accent, #f59e0b);
    }
    .reply-quote-line {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .reply-quote-thumb {
      width: 34px;
      height: 34px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
      background: var(--crm-surface-overlay, #272520);
    }
    .reply-quote-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-text-muted, #7a7a7a);
      flex-shrink: 0;
    }
    .reply-quote-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 250px;
      min-width: 0;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    /* -- Forwarded badge -- */
    .forwarded-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: var(--crm-text-muted, #7a7a7a);
      font-style: italic;
      margin-bottom: 2px;
    }
    .forwarded-badge mat-icon { font-size: 12px; width: 12px; height: 12px; transform: scaleX(-1); }

    /* -- Reactions -- */
    .reactions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
    }
    .reaction-chip {
      display: flex;
      align-items: center;
      gap: 3px;
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 12px;
      padding: 1px 8px;
      font-size: 12px;
      cursor: pointer;
      transition: background 150ms, border-color 150ms;
    }
    .reaction-chip:hover { background: rgba(255,255,255,.08); }
    .reaction-chip.my {
      border-color: var(--crm-accent, #f59e0b);
      background: rgba(245,158,11,0.15);
    }

    /* -- Date dividers -- */
    .date-divider {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
    }
    .date-divider::before, .date-divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--crm-glass-border, rgba(255,255,255,0.08));
    }
    .date-divider span {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: var(--crm-text-muted, #7a7a7a);
      white-space: nowrap;
    }

    /* -- Edited mark -- */
    .edited-mark {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: var(--crm-text-muted, #7a7a7a);
      margin-left: 4px;
    }

    /* -- Edit inline -- */
    .edit-input {
      width: 100%;
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-accent, #f59e0b);
      border-radius: 8px;
      padding: 4px 8px;
      color: var(--crm-text-primary, #ececec);
      font: inherit;
      font-size: 13px;
      outline: none;
    }
    .edit-actions { display: flex; gap: 4px; margin-top: 4px; }
    .edit-action-btn {
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 6px;
      padding: 3px;
      cursor: pointer;
      color: var(--crm-text-secondary, #a0a0a0);
      display: flex;
      transition: background 150ms, color 150ms;
    }
    .edit-action-btn:hover {
      background: rgba(255,255,255,.08);
      color: var(--crm-text-primary, #ececec);
    }
    .edit-action-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* -- Images -- */
    .msg-img-wrap { position: relative; display: inline-block; }
    .msg-img {
      max-width: 200px;
      max-height: 150px;
      border-radius: 10px;
      display: block;
      cursor: pointer;
      transition: filter 150ms;
    }
    .msg-img-wrap:hover .msg-img { filter: brightness(0.85); }
    .msg-img-actions {
      position: absolute;
      top: 6px;
      right: 6px;
      display: flex;
      gap: 4px;
      opacity: 0;
      transition: opacity 150ms;
    }
    .msg-img-wrap:hover .msg-img-actions { opacity: 1; }
    .img-action-btn {
      background: rgba(0,0,0,.65);
      backdrop-filter: blur(8px);
      border: none;
      border-radius: 6px;
      padding: 4px;
      cursor: pointer;
      color: #fff;
      display: flex;
      align-items: center;
      transition: background 150ms;
    }
    .img-action-btn:hover { background: rgba(0,0,0,.85); }
    .img-action-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .msg-caption {
      font-size: 12px;
      margin-top: 4px;
      display: block;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    /* -- File cards -- */
    .msg-file {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 10px;
      padding: 6px 10px;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      color: var(--crm-text-primary, #ececec);
      transition: background 150ms, border-color 150ms;
    }
    .msg-file:hover {
      background: rgba(255,255,255,.06);
      border-color: rgba(255,255,255,.12);
    }
    .msg-file mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-accent, #f59e0b);
    }
    .msg-file .dl-icon {
      color: var(--crm-text-muted, #7a7a7a);
      margin-left: auto;
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .hover-action-danger:hover { color: #ef4444 !important; }

    /* -- Typing indicator -- */
    .typing-indicator {
      font-size: 11px;
      color: var(--crm-text-muted, #7a7a7a);
      font-style: italic;
      padding: 4px 34px;
      animation: typingBounce 1.2s ease-in-out infinite;
    }

    .empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--crm-text-muted, #7a7a7a);
      font-size: 13px;
    }

    /* -- Drag overlay -- */
    .drag-overlay {
      position: absolute;
      inset: 0;
      background: rgba(245,158,11,0.1);
      border: 2px dashed var(--crm-accent, #f59e0b);
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      z-index: 10;
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-accent, #f59e0b);
      backdrop-filter: blur(4px);
    }
    .drag-overlay mat-icon { font-size: 32px; width: 32px; height: 32px; }

    /* -- New messages badge -- */
    .new-messages-btn {
      position: absolute;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--crm-accent, #f59e0b);
      color: #000;
      border: none;
      border-radius: 16px;
      padding: 4px 14px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      box-shadow: 0 4px 16px rgba(245,158,11,0.3);
      z-index: 5;
      transition: box-shadow 150ms;
    }
    .new-messages-btn:hover { box-shadow: 0 4px 20px rgba(245,158,11,0.45); }
    .new-messages-btn mat-icon { font-size: 16px; width: 16px; height: 16px; }

    /* -- Reply preview -- */
    .reply-preview {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border-left: 2px solid var(--crm-accent, #f59e0b);
      border-radius: 0 8px 8px 0;
      margin-top: 4px;
      flex-shrink: 0;
    }
    .reply-preview-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-text-muted, #7a7a7a);
      flex-shrink: 0;
    }
    .reply-preview-thumb {
      width: 34px;
      height: 34px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
      background: var(--crm-surface-overlay, #272520);
    }
    .reply-preview-body { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .reply-preview-name {
      font-size: 11px;
      font-weight: 700;
      color: var(--crm-accent, #f59e0b);
    }
    .reply-preview-text {
      font-size: 12px;
      color: var(--crm-text-secondary, #a0a0a0);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* -- File preview -- */
    .file-preview {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 10px;
      margin-top: 4px;
      flex-shrink: 0;
    }
    .file-thumb { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; }
    .file-thumb-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--crm-text-muted, #7a7a7a);
    }
    .file-info { flex: 1; display: flex; flex-direction: column; min-width: 0; }
    .file-name {
      font-size: 12px;
      color: var(--crm-text-primary, #ececec);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .file-size {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      color: var(--crm-text-muted, #7a7a7a);
    }

    /* -- Input -- */
    .chat-input {
      display: flex;
      gap: 6px;
      align-items: center;
      padding-top: 10px;
      border-top: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      margin-top: 6px;
      flex-shrink: 0;
    }
    .chat-input input[type="text"] {
      flex: 1;
      background: var(--crm-glass-bg, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 20px;
      padding: 7px 14px;
      color: var(--crm-text-primary, #ececec);
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 13px;
      outline: none;
      transition: border-color 200ms, box-shadow 200ms;
    }
    .chat-input input[type="text"]:focus {
      border-color: var(--crm-accent, #f59e0b);
      box-shadow: 0 0 0 2px rgba(245,158,11,0.15);
    }
    .chat-input input[type="text"]::placeholder { color: var(--crm-text-muted, #7a7a7a); }
    .hidden-file { display: none; }

    .send-btn {
      background: var(--crm-accent, #f59e0b) !important;
      color: #000 !important;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 !important;
      transition: box-shadow 200ms, background 200ms;
    }
    .send-btn:hover:not(:disabled) {
      background: var(--crm-accent-hover, #fbbf24) !important;
      box-shadow: 0 0 12px rgba(245,158,11,0.4);
    }
    .send-btn:disabled {
      background: rgba(255,255,255,0.06) !important;
      color: var(--crm-text-muted, #7a7a7a) !important;
      box-shadow: none;
    }
    .send-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .attach-btn {
      color: var(--crm-text-muted, #7a7a7a) !important;
      opacity: 1 !important;
    }
    .attach-btn:hover:not(:disabled) { color: var(--crm-text-secondary, #a0a0a0) !important; }

    .spin { animation: spin 1s linear infinite; }

    /* -- No chat -- */
    .no-chat {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: var(--crm-text-muted, #7a7a7a);
      font-size: 13px;
    }
    .create-btn {
      background: var(--crm-accent, #f59e0b);
      color: #000;
      border: none;
      border-radius: 8px;
      padding: 6px 16px;
      font-family: 'Plus Jakarta Sans', sans-serif;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 200ms, box-shadow 200ms;
    }
    .create-btn:hover {
      background: var(--crm-accent-hover, #fbbf24);
      box-shadow: 0 0 12px rgba(245,158,11,0.3);
    }

    /* -- Search highlight -- */
    :host ::ng-deep .search-hl {
      background: rgba(245,158,11,0.35);
      border-radius: 2px;
      padding: 0 1px;
    }

    :host ::ng-deep .mention-hl {
      color: #60a5fa;
      font-weight: 600;
    }
    :host ::ng-deep .msg.own .mention-hl {
      color: #fbbf24;
    }
    :host ::ng-deep .message-link {
      color: #60a5fa;
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
      overflow-wrap: anywhere;
    }
    :host ::ng-deep .message-link:hover {
      color: #93c5fd;
    }

    /* -- Emoji picker -- */
    .emoji-picker {
      display: flex;
      gap: 4px;
      padding: 6px 8px;
    }
    .emoji-btn {
      font-size: 20px;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      transition: background 150ms, transform 150ms;
      line-height: 1;
    }
    .emoji-btn:hover {
      background: rgba(255,255,255,.08);
      transform: scale(1.15);
    }

    /* -- Photo popup -- */
    .popup-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.65);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .popup-window {
      background: var(--crm-surface-overlay, #272520);
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      border-radius: 12px;
      box-shadow: 0 16px 64px rgba(0,0,0,.6);
      max-width: 700px;
      max-height: 80vh;
      width: 90vw;
      display: flex;
      flex-direction: column;
      cursor: default;
      overflow: hidden;
    }
    .popup-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--crm-glass-border, rgba(255,255,255,0.08));
      flex-shrink: 0;
      background: rgba(12,11,9,0.5);
    }
    .popup-title {
      font-family: 'Oswald', sans-serif;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--crm-text-secondary, #a0a0a0);
    }
    .popup-counter {
      font-family: 'JetBrains Mono', monospace;
      font-size: 11px;
      color: var(--crm-text-muted, #7a7a7a);
    }
    .popup-spacer { flex: 1; }
    .popup-action-btn {
      background: rgba(255,255,255,0.03);
      border: none;
      color: var(--crm-text-secondary, #a0a0a0);
      cursor: pointer;
      padding: 4px;
      border-radius: 6px;
      display: flex;
      transition: background 150ms, color 150ms;
    }
    .popup-action-btn:hover {
      background: rgba(255,255,255,.08);
      color: var(--crm-text-primary, #ececec);
    }
    .popup-action-btn mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .popup-body {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      min-height: 200px;
      overflow: hidden;
    }
    .popup-img {
      max-width: 100%;
      max-height: 65vh;
      border-radius: 8px;
      object-fit: contain;
    }
    .popup-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(0,0,0,.5);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 50%;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #fff;
      transition: background 200ms;
      z-index: 2;
    }
    .popup-nav:hover { background: rgba(0,0,0,.8); }
    .popup-nav mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .popup-nav-left { left: 8px; }
    .popup-nav-right { right: 8px; }
  `],
})
export class DashboardTeamChatComponent {
  protected readonly chatService = inject(StaffChatService);
  protected readonly media = inject(StaffChatMediaService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scrollRef = viewChild<ElementRef<HTMLDivElement>>('scrollContainer');
  private readonly ctxMenuTriggerRef = viewChild<MatMenuTrigger>('ctxMenuTrigger');

  readonly quickEmojis = QUICK_EMOJIS;

  // Local UI state
  readonly inputText = signal('');
  readonly isDragOver = signal(false);
  readonly pendingFile = signal<PendingFile | null>(null);
  readonly hasNewBelow = signal(false);
  readonly replyTo = signal<StaffMessage | null>(null);
  readonly activeEmojiMsgId = signal<string | null>(null);
  readonly lightboxImages = signal<LightboxImage[]>([]);
  readonly lightboxIndex = signal(0);
  readonly lightboxCurrent = computed(() => {
    const imgs = this.lightboxImages();
    const idx = this.lightboxIndex();
    return imgs[idx] ?? null;
  });
  readonly lightboxUrl = computed(() => {
    return this.lightboxCurrent()?.url ?? null;
  });
  readonly editingMsgId = signal<string | null>(null);
  readonly editText = signal('');

  // Context menu
  readonly ctxPosition = signal({ x: '0px', y: '0px' });
  readonly ctxTarget = signal<StaffMessage | null>(null);

  // Search (local UI state, results from service)
  readonly searchMode = signal(false);
  readonly searchQuery = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  // Typing
  readonly typingText = signal('');
  private typingThrottleTimer: ReturnType<typeof setTimeout> | null = null;
  private typingClearTimer: ReturnType<typeof setTimeout> | null = null;

  readonly currentUserId = computed(() => this.auth.currentUser()?.id ?? '');

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role;
    return role === 'admin' || role === 'manager';
  });

  readonly noGeneral = computed(() =>
    !this.chatService.loading() && !this.chatService.generalConversation()
  );

  readonly displayMessages = computed(() =>
    this.searchMode() && this.searchQuery().length >= 2
      ? this.chatService.searchResults()
      : this.chatService.generalMessages()
  );

  private readonly imagePreviewEffect = effect(() => {
    const messages = this.displayMessages();
    const replyItems = messages
      .map(msg => this.replyPreviewItem(msg))
      .filter((item): item is StaffChatMediaItem => item !== null);
    untracked(() => {
      this.media.ensureImagePreviews([...messages, ...replyItems]);
    });
  });

  // Scroll to bottom when general messages arrive
  private initialScrollDone = false;
  private prevMessageCount = 0;

  private readonly scrollOnNewMsg = effect(() => {
    const msgs = this.chatService.generalMessages();
    if (msgs.length === 0) return;

    // First load — instant scroll, wait for DOM via MutationObserver
    if (!this.initialScrollDone) {
      this.initialScrollDone = true;
      this.prevMessageCount = msgs.length;
      this.waitForDomAndScroll();
      return;
    }

    // New messages arrived after initial load
    if (msgs.length <= this.prevMessageCount) {
      this.prevMessageCount = msgs.length;
      return;
    }
    this.prevMessageCount = msgs.length;

    const el = this.scrollRef()?.nativeElement;
    if (!el) return;

    const lastMsg = msgs[msgs.length - 1];
    const isOwn = lastMsg.sender_id === this.currentUserId();

    if (el.scrollHeight - el.scrollTop - el.clientHeight > 80) {
      if (!isOwn) {
        this.hasNewBelow.set(true);
      } else {
        this.smoothScrollToBottom();
      }
    } else {
      this.smoothScrollToBottom();
    }
  });

  /** Wait for message DOM nodes to render, then scroll to bottom instantly. */
  private waitForDomAndScroll(): void {
    const tryScroll = () => {
      const el = this.scrollRef()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    };
    // Multiple attempts: images/layout may shift after initial render
    requestAnimationFrame(tryScroll);
    setTimeout(tryScroll, 50);
    setTimeout(tryScroll, 200);
    setTimeout(tryScroll, 500);
    setTimeout(tryScroll, 1000);
  }

  // Typing indicator from WS
  private readonly typingWsEffect = effect(() => {
    const typers = this.chatService.typingUsers();
    const generalId = this.chatService.generalId();
    if (!generalId) {
      this.typingText.set('');
      return;
    }
    const convTypers = typers.get(generalId);
    if (!convTypers || convTypers.size === 0) {
      this.typingText.set('');
      return;
    }
    const names = [...convTypers.values()];
    this.typingText.set(names.length === 1 ? 'Печатает...' : `${names.length} печатают...`);
  });

  // Init: load general messages when generalId becomes available and mark as read
  private readonly initEffect = effect(() => {
    const generalId = this.chatService.generalId();
    if (generalId) {
      this.chatService.loadGeneralMessages();
      this.chatService.markGeneralRead();
      // Load saved draft
      const draft = this.chatService.getDraft(generalId);
      if (draft) this.inputText.set(draft);
    }
  });

  constructor() {
    this.chatService.init();
    this.chatService.setGeneralChatVisible(true);

    this.destroyRef.onDestroy(() => {
      this.chatService.setGeneralChatVisible(false);
      if (this.searchTimer) clearTimeout(this.searchTimer);
      if (this.typingThrottleTimer) clearTimeout(this.typingThrottleTimer);
      if (this.typingClearTimer) clearTimeout(this.typingClearTimer);
      const pending = this.pendingFile();
      if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    });
  }

  // -- Reply --

  setReplyTo(msg: StaffMessage): void {
    this.replyTo.set(msg);
  }

  cancelReply(): void {
    this.replyTo.set(null);
  }

  // -- Reactions --

  toggleReaction(messageId: string, emoji: string): void {
    this.chatService.toggleGeneralReaction(messageId, emoji);
  }

  onEmojiPick(emoji: string): void {
    const msgId = this.activeEmojiMsgId();
    if (msgId) {
      this.chatService.toggleGeneralReaction(msgId, emoji);
      this.activeEmojiMsgId.set(null);
    }
  }

  // -- Context menu --

  onContextMenu(event: MouseEvent, msg: StaffMessage): void {
    if (msg.deleted_at) return;
    event.preventDefault();
    this.ctxPosition.set({ x: `${event.clientX}px`, y: `${event.clientY}px` });
    this.ctxTarget.set(msg);
    setTimeout(() => this.ctxMenuTriggerRef()?.openMenu());
  }

  // -- Copy --

  copyText(msg: StaffMessage): void {
    if (msg.content) {
      navigator.clipboard.writeText(msg.content);
    }
  }

  // -- Send text --

  send(): void {
    if (this.pendingFile()) {
      this.uploadFile();
      return;
    }

    const text = this.inputText().trim();
    if (!text || !this.chatService.generalId()) return;

    const replyId = this.replyTo()?.id;
    this.chatService.sendGeneralMessage(text, replyId);
    this.inputText.set('');
    this.replyTo.set(null);
    this.smoothScrollToBottom();

    // Clear draft after sending
    const gid = this.chatService.generalId();
    if (gid) this.chatService.clearDraft(gid);
  }

  // -- File upload --

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) this.setPendingFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.setPendingFile(file);
  }

  private setPendingFile(file: File): void {
    if (file.size > MAX_FILE_SIZE) return;
    const prev = this.pendingFile();
    if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);

    const isImage = file.type.startsWith('image/');
    this.pendingFile.set({
      file,
      previewUrl: isImage ? URL.createObjectURL(file) : null,
      isImage,
    });
  }

  cancelFile(): void {
    const prev = this.pendingFile();
    if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
    this.pendingFile.set(null);
  }

  private uploadFile(): void {
    const pending = this.pendingFile();
    if (!pending || !this.chatService.generalId()) return;

    const caption = this.inputText().trim();
    const replyId = this.replyTo()?.id;
    const previewUrl = pending.previewUrl;
    this.chatService.uploadGeneralFile(pending.file, caption || undefined, replyId);
    this.inputText.set('');
    this.replyTo.set(null);
    this.pendingFile.set(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    this.smoothScrollToBottom();
  }

  // -- Search --

  openSearch(): void {
    this.searchMode.set(true);
  }

  closeSearch(): void {
    this.searchMode.set(false);
    this.searchQuery.set('');
    this.chatService.clearSearch();
    if (this.searchTimer) clearTimeout(this.searchTimer);
  }

  onSearchInput(value: string): void {
    this.searchQuery.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (value.trim().length < 2) {
      this.chatService.clearSearch();
      return;
    }
    this.searchTimer = setTimeout(() => this.chatService.searchGeneralMessages(value.trim()), 400);
  }

  highlightSearch(text: string): string {
    const q = this.searchQuery().trim();
    if (!q) return this.formatMessageHtml(text);
    return this.formatMessageHtml(text, q);
  }

  formatMentions(content: string): string {
    return this.formatMessageHtml(content);
  }

  private formatMessageHtml(content: string, highlightQuery = ''): string {
    if (!content) return '';

    const urlRegex = /(?:(?:https?:\/\/|www\.)[^\s<>"'`*]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s<>"'`*]*)?)/gi;
    let result = '';
    let lastIndex = 0;

    for (const match of content.matchAll(urlRegex)) {
      const rawMatch = match[0];
      const matchIndex = match.index ?? 0;

      if (content[matchIndex - 1] === '@') {
        continue;
      }

      const { url, trailing } = this.splitLinkTrailingPunctuation(rawMatch);
      result += this.formatMessageText(content.slice(lastIndex, matchIndex), highlightQuery);
      result += this.formatLink(url);
      result += this.formatMessageText(trailing, highlightQuery);
      lastIndex = matchIndex + rawMatch.length;
    }

    result += this.formatMessageText(content.slice(lastIndex), highlightQuery);
    return result;
  }

  private formatMessageText(text: string, highlightQuery: string): string {
    const escaped = this.escapeHtml(text);
    if (!highlightQuery) {
      return this.formatMentionsInEscapedText(escaped);
    }

    const q = highlightQuery.trim();
    if (!q) return escaped;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escaped.replace(regex, '<span class="search-hl">$1</span>');
  }

  private formatMentionsInEscapedText(escaped: string): string {
    return escaped.replace(
      /@([\p{L}\w]+(?:\s[\p{L}\w]+)?)/gu,
      '<span class="mention-hl">@$1</span>',
    );
  }

  private formatLink(rawUrl: string): string {
    if (!rawUrl) return '';

    const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    if (!this.isSafeMessageLink(href)) {
      return this.formatMessageText(rawUrl, '');
    }

    return `<a class="message-link" href="${this.escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">`
      + `${this.escapeHtml(rawUrl)}</a>`;
  }

  private splitLinkTrailingPunctuation(rawUrl: string): { url: string; trailing: string } {
    const match = rawUrl.match(/[.,!?;:)\]}]+$/);
    if (!match?.[0]) {
      return { url: rawUrl, trailing: '' };
    }

    const trailing = match[0];
    return {
      url: rawUrl.slice(0, -trailing.length),
      trailing,
    };
  }

  private isSafeMessageLink(href: string): boolean {
    try {
      const url = new URL(href);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeHtmlAttribute(str: string): string {
    return this.escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // -- Typing indicator --

  onTextInput(value: string): void {
    this.inputText.set(value);

    // Persist draft
    const gid = this.chatService.generalId();
    if (gid) this.chatService.saveDraft(gid, value);

    if (!gid || !value.trim()) return;
    if (!this.typingThrottleTimer) {
      this.chatService.sendGeneralTyping(true);
      this.typingThrottleTimer = setTimeout(() => {
        this.typingThrottleTimer = null;
      }, 2000);
    }
  }

  // -- Scroll --

  onScroll(): void {
    const el = this.scrollRef()?.nativeElement;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 30) {
      this.hasNewBelow.set(false);
    }
  }

  scrollToBottom(): void {
    this.hasNewBelow.set(false);
    this.smoothScrollToBottom();
  }

  private smoothScrollToBottom(): void {
    requestAnimationFrame(() => {
      const el = this.scrollRef()?.nativeElement;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }

  createGeneral(): void {
    this.chatService.createGeneralConversation();
  }

  // -- Message grouping --

  isGrouped(index: number): boolean {
    const msgs = this.displayMessages();
    if (index === 0) return false;
    const prev = msgs[index - 1];
    const curr = msgs[index];
    if (prev.sender_id !== curr.sender_id) return false;
    const diff = new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime();
    return diff < 120_000; // 2 min
  }

  // -- Time formatting --

  formatTime(isoStr: string): string {
    const d = new Date(isoStr);
    const now = new Date();
    const hhmm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

    if (d.toDateString() === now.toDateString()) return hhmm;

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Вчера ${hhmm}`;

    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' + hhmm;
  }

  // -- Helpers --

  fileIcon(type: string): string {
    switch (type) {
      case 'video': return 'videocam';
      case 'audio': return 'mic';
      default: return 'description';
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  imagePreviewUrl(msg: StaffMessage): string {
    return this.media.imagePreviewUrl(msg);
  }

  replyPreviewItem(msg: StaffMessage): StaffChatMediaItem | null {
    if (msg.reply_to_message_type !== 'image' || !msg.reply_to_message_id || !msg.reply_to_attachment_url) {
      return null;
    }
    return {
      id: msg.reply_to_message_id,
      conversation_id: msg.conversation_id,
      message_type: 'image',
      attachment_url: msg.reply_to_attachment_url,
      original_filename: msg.reply_to_original_filename ?? null,
    };
  }

  messagePreviewItem(msg: StaffMessage): StaffChatMediaItem | null {
    if (msg.message_type !== 'image' || !msg.attachment_url) return null;
    return this.mediaItemFromMessage(msg);
  }

  replySummary(msg: StaffMessage): string {
    return this.previewLabel(
      msg.reply_to_message_type ?? (msg.reply_to_attachment_url ? 'file' : 'text'),
      msg.reply_to_content,
      msg.reply_to_original_filename,
      msg.reply_to_attachment_url ?? null,
    );
  }

  messagePreviewLabel(msg: StaffMessage): string {
    return this.previewLabel(msg.message_type, msg.content, msg.original_filename, msg.attachment_url);
  }

  replyIcon(msg: StaffMessage): string {
    return this.iconForMessageType(
      msg.reply_to_message_type ?? (msg.reply_to_attachment_url ? 'file' : 'text'),
      msg.reply_to_attachment_url ?? null,
    );
  }

  messageIcon(msg: StaffMessage): string {
    return this.iconForMessageType(msg.message_type, msg.attachment_url);
  }

  downloadMessageMedia(msg: StaffMessage): void {
    void this.media.downloadMessageMedia(msg);
  }

  downloadLightboxImage(): void {
    const current = this.lightboxCurrent();
    if (current) this.downloadMessageMedia(current.message);
  }

  openMessageMedia(event: Event, msg: StaffMessage): void {
    event.stopPropagation();
    void this.media.openMessageMedia(msg);
  }

  openLightboxInNewTab(): void {
    const current = this.lightboxCurrent();
    if (current) void this.media.openMessageMedia(current.message);
  }

  openImage(msg: StaffMessage): void {
    if (!msg.attachment_url) return;

    const current: LightboxImage = {
      url: this.media.imagePreviewUrl(msg),
      message: msg,
    };
    let images = this.chatService.generalMessages()
      .filter(m => m.message_type === 'image' && m.attachment_url)
      .map(m => ({
        url: this.media.imagePreviewUrl(m),
        message: m,
      }));
    let idx = images.findIndex(item => item.message.id === msg.id);
    if (idx < 0) {
      images = [current, ...images.filter(item => item.message.id !== msg.id)];
      idx = 0;
    }
    this.lightboxImages.set(images);
    this.lightboxIndex.set(idx);
  }

  private previewLabel(
    messageType: StaffMessage['message_type'],
    rawContent: string | null | undefined,
    rawFilename: string | null | undefined,
    attachmentUrl: string | null,
  ): string {
    const content = rawContent?.trim() ?? '';
    const filename = rawFilename?.trim() ?? '';
    const hasCaption = content.length > 0 && content !== filename;

    if (messageType === 'image') return hasCaption ? content : 'Фото';
    if (messageType === 'video') return hasCaption ? content : 'Видео';
    if (messageType === 'audio') return hasCaption ? content : 'Аудио';
    if (attachmentUrl) return hasCaption ? content : filename || 'Файл';
    return content || 'Сообщение';
  }

  private iconForMessageType(messageType: StaffMessage['message_type'], attachmentUrl: string | null): string {
    if (messageType === 'video') return 'videocam';
    if (messageType === 'audio') return 'mic';
    if (messageType === 'file' || attachmentUrl) return 'description';
    return '';
  }

  private mediaItemFromMessage(msg: StaffMessage): StaffChatMediaItem {
    return {
      id: msg.id,
      conversation_id: msg.conversation_id,
      attachment_url: msg.attachment_url,
      original_filename: msg.original_filename,
      message_type: msg.message_type,
    };
  }

  closeLightbox(): void {
    this.lightboxImages.set([]);
    this.lightboxIndex.set(0);
  }

  lightboxPrev(): void {
    const idx = this.lightboxIndex();
    if (idx > 0) this.lightboxIndex.set(idx - 1);
  }

  lightboxNext(): void {
    const idx = this.lightboxIndex();
    if (idx < this.lightboxImages().length - 1) this.lightboxIndex.set(idx + 1);
  }

  // -- Edit / Delete --

  startEdit(msg: StaffMessage): void {
    this.editingMsgId.set(msg.id);
    this.editText.set(msg.content);
  }

  cancelEdit(): void {
    this.editingMsgId.set(null);
    this.editText.set('');
  }

  confirmEdit(msgId: string): void {
    const text = this.editText().trim();
    if (!text) return;
    this.chatService.editGeneralMessage(msgId, text);
    this.editingMsgId.set(null);
    this.editText.set('');
  }

  deleteMessage(msgId: string): void {
    this.chatService.deleteGeneralMessage(msgId);
  }

  // -- Date dividers --

  showDateDivider(index: number): boolean {
    const msgs = this.displayMessages();
    if (index === 0) return true;
    const curr = new Date(msgs[index].created_at).toDateString();
    const prev = new Date(msgs[index - 1].created_at).toDateString();
    return curr !== prev;
  }

  dateDividerLabel(isoStr: string): string {
    const d = new Date(isoStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Сегодня';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  avatarColor(name: string): string {
    const colors = ['#e57373','#f06292','#ba68c8','#9575cd','#7986cb','#64b5f6','#4fc3f7','#4dd0e1','#4db6ac','#81c784','#aed581','#dce775','#fff176','#ffd54f','#ffb74d','#ff8a65'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  asInput(event: Event): HTMLInputElement {
    return event.target as HTMLInputElement;
  }
}
