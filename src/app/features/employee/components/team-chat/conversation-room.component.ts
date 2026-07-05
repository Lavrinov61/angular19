import {
  Component, inject, input, output, signal, effect, computed, untracked,
  ChangeDetectionStrategy, ElementRef, viewChild,
  DestroyRef, NgZone, afterNextRender, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TextFieldModule } from '@angular/cdk/text-field';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { StaffChatService } from '../../services/staff-chat.service';
import { StaffChatMediaService, type StaffChatMediaItem } from '../../services/staff-chat-media.service';
import { StaffMessage } from '../../models/staff-chat.model';
import { AuthService } from '../../../../core/services/auth.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { EmojiPickerComponent } from './emoji-picker.component';
import { MentionAutocompleteComponent } from './mention-autocomplete.component';
import { MediaLightboxComponent } from './media-lightbox.component';
import { VoiceRecorderComponent } from './voice-recorder.component';
import { ScrollToBottomFabComponent } from './scroll-to-bottom-fab.component';
import { safeSubstring } from '../../../../shared/utils/safe-string';

@Component({
  selector: 'app-conversation-room',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, TextFieldModule,
    MatButtonModule, MatIconModule, MatTooltipModule,
    MatProgressBarModule,
    EmojiPickerComponent, MentionAutocompleteComponent,
    MediaLightboxComponent, VoiceRecorderComponent,
    ScrollToBottomFabComponent,
  ],
  template: `
    @if (wsService.isOffline5s()) {
      <div class="ws-offline-banner" role="status" aria-live="polite">
        <mat-icon>cloud_off</mat-icon>
        <span>Нет связи. Переподключение…</span>
      </div>
    }
    @if (chatService.activeConversation(); as conv) {
      <div class="room-header">
        <div class="header-row-1">
          <button class="back-btn" (click)="onBack()" aria-label="Назад">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <div class="room-avatar" [style.background]="avatarColor(conv.id)">
            {{ avatarInitials(chatService.getConversationDisplayName(conv)) }}
          </div>
          <span class="room-title">{{ chatService.getConversationDisplayName(conv) }}</span>
          @if (conv.type === 'direct' && otherUserOnline()) {
            <span class="presence-dot"></span>
          }
          <div class="header-spacer"></div>
          <div class="header-pills">
            <button class="pill-btn" (click)="showSearch.set(!showSearch())"
                    [class.active]="showSearch()" matTooltip="Поиск" aria-label="Поиск по сообщениям">
              <mat-icon>search</mat-icon>
            </button>
            <button class="pill-btn" (click)="infoToggled.emit()"
                    matTooltip="Информация" aria-label="Информация о чате">
              <mat-icon>info_outline</mat-icon>
            </button>
            <button class="pill-btn" (click)="chatService.toggleSoundMuted()"
                    [matTooltip]="chatService.soundMuted() ? 'Включить звук' : 'Выключить звук'" aria-label="Звук уведомлений">
              <mat-icon>{{ chatService.soundMuted() ? 'volume_off' : 'volume_up' }}</mat-icon>
            </button>
            @if (chatService.pinnedMessages().length > 0) {
              <button class="pill-btn" (click)="showPinnedPanel.set(!showPinnedPanel())"
                      [class.active]="showPinnedPanel()" matTooltip="Закрепленные" aria-label="Закрепленные сообщения">
                <mat-icon>push_pin</mat-icon>
                <span class="pill-count">{{ chatService.pinnedMessages().length }}</span>
              </button>
            }
          </div>
        </div>
        <div class="header-row-2">
          <span class="meta-pill">
            @if (conv.type === 'direct') { Личный }
            @else if (conv.type === 'group') { Группа }
            @else { Общий }
          </span>
          @if (conv.type !== 'direct' && conv.participants.length) {
            <span class="meta-pill">
              <mat-icon>group</mat-icon> {{ conv.participants.length }}
            </span>
          }
          @if (conv.type !== 'direct' && onlineCount() > 0) {
            <span class="meta-pill online">
              <span class="online-dot"></span> {{ onlineCount() }} онлайн
            </span>
          }
          @if (conv.type === 'direct') {
            @if (otherUserOnline()) {
              <span class="meta-pill online"><span class="online-dot"></span> онлайн</span>
            } @else if (otherUserLastSeen()) {
              <span class="meta-pill">{{ otherUserLastSeen() }}</span>
            }
          }
        </div>
      </div>

      <!-- Search bar -->
      @if (showSearch()) {
        <div class="search-bar">
          <div class="search-input-wrap">
            <mat-icon class="search-icon">search</mat-icon>
            <input class="search-input" placeholder="Поиск сообщений..." [(ngModel)]="searchQuery"
                   (ngModelChange)="onSearchInput($event)" aria-label="Поиск сообщений" />
            <button class="search-close-btn" (click)="closeSearch()" aria-label="Закрыть поиск">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          @if (chatService.searching()) {
            <mat-progress-bar mode="indeterminate" />
          }
          @if (chatService.searchResults().length > 0) {
            <div class="search-results">
              @for (result of chatService.searchResults(); track result.id) {
                <div class="search-result-item" tabindex="0" (click)="scrollToMessage(result.id)" (keydown.enter)="scrollToMessage(result.id)">
                  <span class="search-result-sender">{{ result.sender_name }}</span>
                  <span class="search-result-text">{{ safeSub(result.content, 0, 80) }}</span>
                  <span class="search-result-date">{{ dateLabel(result.created_at) }}</span>
                </div>
              }
              @if (chatService.searchHasMore()) {
                <button class="search-load-more" (click)="chatService.loadMoreSearchResults()">
                  Ещё результаты
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- Pinned messages panel -->
      @if (showPinnedPanel()) {
        <div class="pinned-panel">
          <div class="pinned-panel-header">
            <mat-icon>push_pin</mat-icon>
            <span>Закрепленные ({{ chatService.pinnedMessages().length }})</span>
            <div class="header-spacer"></div>
            <button class="pill-btn" (click)="showPinnedPanel.set(false)" aria-label="Закрыть">
              <mat-icon>close</mat-icon>
            </button>
          </div>
          <div class="pinned-panel-list">
            @for (pin of chatService.pinnedMessages(); track pin.id) {
              <div class="pinned-item">
                <div class="pinned-item-body">
                  <span class="pinned-item-sender">{{ pin.sender_name }}</span>
                  <span class="pinned-item-text">{{ safeSub(pin.content, 0, 120) }}</span>
                  <span class="pinned-item-date">{{ timeLabel(pin.created_at) }}</span>
                </div>
                <div class="pinned-item-actions">
                  <button class="pill-btn" (click)="scrollToMessage(pin.id); showPinnedPanel.set(false)"
                          matTooltip="Перейти" aria-label="Перейти к сообщению">
                    <mat-icon>shortcut</mat-icon>
                  </button>
                  <button class="pill-btn" (click)="chatService.unpinMessage(pin.id)" matTooltip="Открепить"
                          aria-label="Открепить">
                    <mat-icon>push_pin</mat-icon>
                  </button>
                </div>
              </div>
            } @empty {
              <div class="pinned-empty">Нет закрепленных сообщений</div>
            }
          </div>
        </div>
      }

      @if (chatService.uploading()) {
        <mat-progress-bar mode="determinate" [value]="chatService.uploadProgress()" class="upload-bar" />
      }

      <!-- Error bar -->
      @if (chatService.lastError(); as error) {
        <div class="error-bar">
          <mat-icon>error_outline</mat-icon>
          <span>{{ error }}</span>
          <button class="pill-btn" (click)="chatService.clearError()" aria-label="Закрыть">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      <div class="messages" #messagesContainer role="log" aria-live="polite"
           (dragover)="onDragOver($event)" (dragleave)="isDragOver.set(false)"
           (drop)="onDrop($event)"
           [class.drag-over]="isDragOver()">

        @if (chatService.loadingOlder()) {
          <div class="loading-older">Загрузка...</div>
        }

        @if (chatService.messagesLoading() && !chatService.lastError()) {
          <div class="loading-msg">Загрузка...</div>
        } @else {
          @for (msg of chatService.groupedMessages(); track msg.id) {
            @if (msg._showDate) {
              <div class="date-divider"><span>{{ dateLabel(msg.created_at) }}</span></div>
            }

            @if (msg.deleted_at) {
              <div class="msg-row" [class.own]="msg._isOwn">
                <div class="bubble deleted" [class.own]="msg._isOwn"
                     [class.other]="!msg._isOwn">
                  <div class="deleted-label">
                    <mat-icon>block</mat-icon> Сообщение удалено
                    @if (canRestore(msg)) {
                      <button class="restore-btn" (click)="restoreMessage(msg)"
                              matTooltip="Восстановить" aria-label="Восстановить сообщение">
                        <mat-icon>restore</mat-icon>
                      </button>
                    }
                  </div>
                </div>
              </div>
            } @else {
              <div class="msg-row" [class.own]="msg._isOwn"
                   [class.grouped]="msg._isGrouped"
                   [class.selected]="selectedMessageIds().has(msg.id)">
                <!-- Selection checkbox -->
                @if (selectionMode()) {
                  <label class="select-checkbox">
                    <input type="checkbox" [checked]="selectedMessageIds().has(msg.id)"
                           (change)="toggleMessageSelection(msg.id)" />
                    <span class="checkmark"></span>
                  </label>
                }
                <!-- Avatar for .other messages -->
                @if (!msg._isOwn) {
                  @if (msg._showAvatar) {
                    <div class="msg-avatar" [style.background]="avatarColor(msg.sender_id)">
                      {{ avatarInitials(msg.sender_name) }}
                    </div>
                  } @else {
                    <div class="msg-avatar-spacer"></div>
                  }
                }

                <div class="bubble" [attr.data-msg-id]="msg.id"
                     [class.own]="msg._isOwn"
                     [class.other]="!msg._isOwn"
                     (contextmenu)="onContextMenu($event, msg)">

                  <!-- Forwarded badge -->
                  @if (msg.is_forwarded) {
                    <div class="forwarded-badge">
                      <mat-icon>shortcut</mat-icon> Переслано от {{ msg.forwarded_from_name }}
                    </div>
                  }

                  <!-- Reply-to -->
                  @if (msg.reply_to_message_id) {
                    <button type="button" class="reply-quote" (click)="openReplyReference($event, msg)"
                            [attr.aria-label]="'Перейти к сообщению от ' + (msg.reply_to_sender_name || 'сотрудника')">
                      <span class="reply-name">{{ msg.reply_to_sender_name || 'Сообщение' }}</span>
                      <span class="reply-preview-line">
                        @if (replyPreviewItem(msg); as replyItem) {
                          <img class="reply-thumb" [src]="media.imagePreviewUrl(replyItem)"
                               [alt]="replySummary(msg)" loading="lazy" />
                        } @else if (replyIcon(msg); as icon) {
                          <mat-icon class="reply-icon">{{ icon }}</mat-icon>
                        }
                        <span class="reply-text">{{ replySummary(msg) }}</span>
                        <mat-icon class="reply-jump-icon">keyboard_arrow_up</mat-icon>
                      </span>
                    </button>
                  }

                  @if (!msg._isOwn && msg._showAvatar) {
                    <div class="bubble-sender">{{ msg.sender_name }}</div>
                  }

                  <!-- Pinned indicator -->
                  @if (msg.pinned_at) {
                    <div class="pinned-indicator">
                      <mat-icon>push_pin</mat-icon> Закреплено
                    </div>
                  }

                  <!-- Attachment -->
                  @if (msg.attachment_url) {
                    @if (msg.message_type === 'image') {
                      <div class="media-shell">
                        <img [src]="media.imagePreviewUrl(msg)" [alt]="msg.original_filename || 'Фото'"
                             tabindex="0" class="msg-image" loading="lazy" (click)="openImage(msg)" (keydown.enter)="openImage(msg)" />
                        <button class="media-download-btn" (click)="downloadMessageMedia($event, msg)"
                                matTooltip="Скачать" aria-label="Скачать">
                          <mat-icon>download</mat-icon>
                        </button>
                      </div>
                    } @else if (msg.message_type === 'video') {
                      <div class="media-shell">
                        <video [src]="msg.attachment_url" controls preload="metadata" class="msg-video"></video>
                        <button class="media-download-btn" (click)="downloadMessageMedia($event, msg)"
                                matTooltip="Скачать" aria-label="Скачать">
                          <mat-icon>download</mat-icon>
                        </button>
                      </div>
                    } @else if (msg.message_type === 'audio') {
                      <div class="audio-shell">
                        <audio [src]="msg.attachment_url" controls preload="metadata"></audio>
                        <button class="audio-download-btn" (click)="downloadMessageMedia($event, msg)"
                                matTooltip="Скачать" aria-label="Скачать">
                          <mat-icon>download</mat-icon>
                        </button>
                      </div>
                    } @else {
                      <button type="button" class="file-link" (click)="downloadMessageMedia($event, msg)">
                        <mat-icon>description</mat-icon>
                        <span>{{ msg.original_filename || 'Файл' }}</span>
                        <mat-icon class="file-download-icon">download</mat-icon>
                      </button>
                    }
                  }

                  <!-- Inline edit mode -->
                  @if (chatService.editingMessageId() === msg.id) {
                    <div class="edit-area">
                      <textarea [(ngModel)]="editText" (keydown)="onEditKeydown($event, msg.id)"
                                rows="1" cdkTextareaAutosize cdkAutosizeMinRows="1" cdkAutosizeMaxRows="6"
                                class="edit-input"></textarea>
                      <div class="edit-actions">
                        <button class="pill-btn" (click)="confirmEdit(msg.id)" matTooltip="Сохранить"
                                [disabled]="!editText.trim()" aria-label="Сохранить">
                          <mat-icon>check</mat-icon>
                        </button>
                        <button class="pill-btn" (click)="chatService.cancelEditing()" matTooltip="Отмена"
                                aria-label="Отмена">
                          <mat-icon>close</mat-icon>
                        </button>
                      </div>
                    </div>
                  } @else {
                    @if (msg.content && (msg.message_type === 'text' || !msg.attachment_url)) {
                      <div class="bubble-body" [innerHTML]="formatMentions(msg.content)"></div>
                    } @else if (msg.content && msg.content !== msg.original_filename) {
                      <div class="bubble-caption" [innerHTML]="formatMentions(msg.content)"></div>
                    }
                    @if (extractUrls(msg.content); as urls) {
                      @if (urls.length > 0) {
                        @for (url of urls; track url) {
                          <a [href]="url" target="_blank" rel="noopener" class="link-card">
                            <mat-icon>link</mat-icon>
                            <span class="link-card-url">{{ formatUrl(url) }}</span>
                            <mat-icon class="link-card-arrow">open_in_new</mat-icon>
                          </a>
                        }
                      }
                    }
                  }

                  <!-- Reactions row -->
                  @if (msg.reactions?.length) {
                    <div class="reactions-row">
                      @for (reaction of msg.reactions; track reaction.emoji) {
                        <button class="reaction-chip" [class.my-reaction]="reaction.myReaction"
                                (click)="chatService.toggleReaction(msg.id, reaction.emoji)"
                                [matTooltip]="reaction.count + ' ' + reaction.emoji">
                          {{ reaction.emoji }} {{ reaction.count }}
                        </button>
                      }
                    </div>
                  }

                  <div class="bubble-footer">
                    @if (msg.edited_at) {
                      <span class="edited-label">изм.</span>
                    }
                    <span class="bubble-time">{{ timeLabel(msg.created_at) }}</span>
                    @if (msg._isOwn) {
                      @let readState = chatService.getMessageReadState(msg.id, msg.created_at);
                      @switch (readState) {
                        @case ('read') {
                          <mat-icon class="read-check read" aria-label="Прочитано">done_all</mat-icon>
                        }
                        @case ('delivered') {
                          <mat-icon class="read-check delivered" aria-label="Доставлено">done_all</mat-icon>
                        }
                        @default {
                          <mat-icon class="read-check sent" aria-label="Отправлено">done</mat-icon>
                        }
                      }
                    }
                  </div>
                </div>

                <!-- Floating hover actions -->
                <div class="msg-hover-actions" [class.left]="!msg._isOwn">
                  @if (msg.attachment_url) {
                    <button class="hover-action-btn" (click)="downloadMessageMedia($event, msg)"
                            matTooltip="Скачать" aria-label="Скачать">
                      <mat-icon>download</mat-icon>
                    </button>
                  }
                  <button class="hover-action-btn" (click)="setReply(msg)" matTooltip="Ответить" aria-label="Ответить">
                    <mat-icon>reply</mat-icon>
                  </button>
                  @if (msg._isOwn && canEdit(msg)) {
                    <button class="hover-action-btn" (click)="startEdit(msg)" matTooltip="Редактировать" aria-label="Редактировать">
                      <mat-icon>edit</mat-icon>
                    </button>
                  }
                  <button class="hover-action-btn" (click)="startForward(msg)" matTooltip="Переслать" aria-label="Переслать">
                    <mat-icon>shortcut</mat-icon>
                  </button>
                  <button class="hover-action-btn" (click)="togglePin(msg)" [matTooltip]="msg.pinned_at ? 'Открепить' : 'Закрепить'"
                          aria-label="Закрепить/открепить">
                    <mat-icon>push_pin</mat-icon>
                  </button>
                  @if (canDelete(msg)) {
                    <button class="hover-action-btn" (click)="chatService.deleteMessage(msg.id)" matTooltip="Удалить" aria-label="Удалить">
                      <mat-icon>delete_outline</mat-icon>
                    </button>
                  }
                  <button class="hover-action-btn" (click)="toggleBookmark(msg)"
                          [matTooltip]="chatService.isBookmarked(msg.id) ? 'Убрать из избранного' : 'В избранное'"
                          [class.bookmarked]="chatService.isBookmarked(msg.id)"
                          aria-label="Избранное">
                    <mat-icon>{{ chatService.isBookmarked(msg.id) ? 'bookmark' : 'bookmark_border' }}</mat-icon>
                  </button>
                  <button class="hover-action-btn" (click)="copyText(msg.content)" matTooltip="Копировать" aria-label="Копировать текст">
                    <mat-icon>content_copy</mat-icon>
                  </button>
                  <button class="hover-action-btn" (click)="enterSelectionMode(msg.id)" matTooltip="Выбрать" aria-label="Выбрать">
                    <mat-icon>check_box_outline_blank</mat-icon>
                  </button>
                </div>
              </div>
            }
          } @empty {
            <div class="empty-room">
              <mat-icon>chat_bubble_outline</mat-icon>
              <p>Напишите первое сообщение</p>
            </div>
          }
          @if (typingLabel()) {
            <div class="typing">
              <span class="typing-dots">
                <span></span><span></span><span></span>
              </span>
              {{ typingLabel() }}
            </div>
          }
        }

        <!-- Drag overlay -->
        @if (isDragOver()) {
          <div class="drag-overlay">
            <mat-icon>cloud_upload</mat-icon>
            <span>Перетащите файлы сюда</span>
          </div>
        }
      </div>

      <!-- Selection toolbar -->
      @if (selectionMode()) {
        <div class="selection-bar">
          <span class="selection-count">{{ selectedMessageIds().size }} выбрано</span>
          <div class="selection-actions">
            <button class="selection-action-btn" (click)="forwardSelected()" [disabled]="selectedMessageIds().size === 0"
                    matTooltip="Переслать" aria-label="Переслать выбранные">
              <mat-icon>shortcut</mat-icon> Переслать
            </button>
            <button class="selection-action-btn delete" (click)="deleteSelected()" [disabled]="selectedMessageIds().size === 0"
                    matTooltip="Удалить" aria-label="Удалить выбранные">
              <mat-icon>delete_outline</mat-icon> Удалить
            </button>
            <button class="selection-action-btn" (click)="exitSelectionMode()"
                    aria-label="Отмена">
              <mat-icon>close</mat-icon> Отмена
            </button>
          </div>
        </div>
      }

      <!-- Forward dialog (inline) — for both single and multi-forward -->
      @if (forwardingMessage() || forwardingSelection()) {
        <div class="forward-bar">
          <span class="forward-label">Переслать{{ forwardingSelection() ? ' (' + selectedMessageIds().size + ')' : '' }} в:</span>
          <div class="forward-list">
            @for (conv of chatService.conversations(); track conv.id) {
              @if (conv.id !== chatService.activeConversationId()) {
                <button class="forward-target" (click)="confirmForward(conv.id)">
                  {{ chatService.getConversationDisplayName(conv) }}
                </button>
              }
            }
          </div>
          <button class="pill-btn" (click)="cancelForward()" aria-label="Отмена">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      @if (!isNearBottom()) {
        <app-scroll-to-bottom-fab [count]="unreadBelowCount()" (clicked)="jumpToBottom()" />
      }

      <!-- Reply bar -->
      @if (chatService.replyTo(); as replyMsg) {
        <div class="reply-bar">
          <div class="reply-bar-content">
            @if (messagePreviewItem(replyMsg); as replyItem) {
              <img class="reply-bar-thumb" [src]="media.imagePreviewUrl(replyItem)"
                   [alt]="messagePreviewLabel(replyMsg)" loading="lazy" />
            } @else if (messageIcon(replyMsg); as icon) {
              <mat-icon class="reply-bar-icon">{{ icon }}</mat-icon>
            }
            <span class="reply-bar-copy">
              <span class="reply-bar-name">{{ replyMsg.sender_name }}</span>
              <span class="reply-bar-text">{{ messagePreviewLabel(replyMsg) }}</span>
            </span>
          </div>
          <button class="pill-btn" (click)="chatService.setReplyTo(null)" aria-label="Отменить ответ">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      <div class="compose-area">
        <input type="file" #fileInput hidden multiple (change)="onFileSelected($event)" />
        <button class="pill-btn attach-btn" (click)="fileInput.click()" matTooltip="Прикрепить файл" aria-label="Прикрепить файл">
          <mat-icon>attach_file</mat-icon>
        </button>
        <textarea class="compose-input" placeholder="Сообщение..." [(ngModel)]="replyText"
                  (keydown)="onKeydown($event)" (input)="onInput($event)" (paste)="onPaste($event)"
                  rows="1" cdkTextareaAutosize cdkAutosizeMinRows="1" cdkAutosizeMaxRows="4"
                  aria-label="Написать сообщение"></textarea>
        <div class="compose-tools">
          <button class="pill-btn" (click)="reactionPickerMsg.set(null); showEmojiPicker.set(!showEmojiPicker())"
                  matTooltip="Эмодзи" aria-label="Выбрать эмодзи">
            <mat-icon>sentiment_satisfied_alt</mat-icon>
          </button>
        </div>
        @if (showEmojiPicker()) {
          <app-emoji-picker
            [recentEmojis]="recentEmojis()"
            (emojiSelected)="insertEmoji($event)"
            (closed)="showEmojiPicker.set(false)" />
        }
        @if (showMentionDropdown()) {
          <app-mention-autocomplete
            [query]="mentionQuery()"
            [participants]="chatService.activeConversation()?.participants || []"
            (selected)="insertMention($event)"
            (closed)="showMentionDropdown.set(false)" />
        }
        <app-voice-recorder [conversationId]="conversationId()" (voiceSent)="onVoiceSent()" />
        <button class="send-btn" [disabled]="!replyText.trim()" (click)="send()"
                matTooltip="Отправить" aria-label="Отправить сообщение">
          <mat-icon>send</mat-icon>
        </button>
      </div>

      @if (showImageLightbox()) {
        <app-media-lightbox
          [items]="lightboxImages()"
          [startIndex]="lightboxStartIndex()"
          (closed)="showImageLightbox.set(false)" />
      }
    } @else {
      <div class="no-room">
        <mat-icon>forum</mat-icon>
        <p>Выберите чат</p>
      </div>
    }
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100%; position: relative; }

    /* === Offline banner === */
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

    /* === Header === */
    .room-header {
      background: linear-gradient(180deg, rgba(12, 11, 9, 0.95) 0%, rgba(12, 11, 9, 0.85) 100%);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .header-row-1 {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .back-btn {
      display: none;
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      color: var(--crm-text-secondary);
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
      &:hover { color: var(--crm-text-primary); }
    }
    /* CRM desktop only — mobile breakpoint removed */

    .room-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      flex-shrink: 0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      border: 2px solid rgba(255, 255, 255, 0.06);
    }

    .room-title {
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 16px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-primary);
    }

    .presence-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--crm-status-success);
      box-shadow: 0 0 6px var(--crm-status-success);
      flex-shrink: 0;
    }

    .header-spacer { flex: 1; }

    .header-pills {
      display: flex;
      gap: 2px;
    }

    .pill-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: 8px;
      color: var(--crm-text-secondary);
      display: inline-flex;
      align-items: center;
      gap: 2px;
      transition: color 150ms, background 150ms, transform 100ms;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &:hover { color: var(--crm-accent); background: rgba(245, 158, 11, 0.08); transform: scale(1.05); }
      &:active { transform: scale(0.95); }
      &.active { color: var(--crm-accent); }
      &:disabled { opacity: 0.3; cursor: default; }
    }

    .pill-count {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-accent);
    }

    .header-row-2 {
      display: flex;
      gap: 6px;
      padding-left: 40px;
    }

    .meta-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-text-muted);
      padding: 1px 8px;
      border-radius: 10px;
      border: 1px solid var(--crm-glass-border);
      background: var(--crm-glass-bg);
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
      &.online { color: var(--crm-status-success); border-color: rgba(52, 211, 153, 0.2); }
    }

    .online-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--crm-status-success);
    }

    /* === Search === */
    .search-bar {
      padding: 6px 14px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--crm-glass-border);
    }

    .search-input-wrap {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-glass-border);
      border-radius: 20px;
      padding: 6px 12px;
      &:focus-within { border-color: rgba(245, 158, 11, 0.3); }
    }

    .search-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);
    }

    .search-input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--crm-text-primary);
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      font-size: 13px;
      &::placeholder { color: var(--crm-text-muted); }
    }

    .search-close-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 2px;
      color: var(--crm-text-muted);
      display: flex;
      align-items: center;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { color: var(--crm-text-primary); }
    }

    .search-results {
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid var(--crm-glass-border);
      border-radius: 8px;
      margin-top: 6px;
      background: var(--crm-surface-raised);
    }

    .search-result-item {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid var(--crm-glass-border);
      &:last-child { border-bottom: none; }
      &:hover { background: var(--crm-surface-overlay); }
    }

    .search-result-sender { font-size: 11px; font-weight: 500; color: var(--crm-accent); }
    .search-result-text { font-size: 12px; color: var(--crm-text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .search-result-date {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-text-muted);
    }

    .search-load-more {
      display: block;
      width: 100%;
      padding: 8px;
      border: none;
      background: none;
      color: var(--crm-accent);
      font-size: 12px;
      cursor: pointer;
      text-align: center;
      transition: background 150ms ease;

      &:hover { background: rgba(245, 158, 11, 0.06); }
    }

    .upload-bar { flex-shrink: 0; }

    /* === Pinned Panel === */
    .pinned-panel {
      border-bottom: 1px solid var(--crm-glass-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;
      max-height: 240px;
      display: flex;
      flex-direction: column;
    }
    .pinned-panel-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--crm-glass-border);
      font-size: 12px;
      font-weight: 500;
      color: var(--crm-accent);
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }
    .pinned-panel-list {
      overflow-y: auto;
      padding: 4px 0;
    }
    .pinned-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-bottom: 1px solid var(--crm-glass-border);
      &:last-child { border-bottom: none; }
      &:hover { background: var(--crm-surface-overlay); }
    }
    .pinned-item-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .pinned-item-sender {
      font-size: 11px;
      font-weight: 500;
      color: var(--crm-accent);
    }
    .pinned-item-text {
      font-size: 12px;
      color: var(--crm-text-primary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .pinned-item-date {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-text-muted);
    }
    .pinned-item-actions {
      display: flex;
      gap: 2px;
      flex-shrink: 0;
    }
    .pinned-empty {
      text-align: center;
      padding: 16px;
      font-size: 13px;
      color: var(--crm-text-muted);
    }

    /* === Error === */
    .error-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      background: rgba(239, 68, 68, 0.1);
      border-bottom: 1px solid rgba(239, 68, 68, 0.15);
      color: #ef4444;
      font-size: 13px;
      flex-shrink: 0;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      span { flex: 1; }
    }

    /* === Messages === */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
    }

    .messages.drag-over {
      background: rgba(245, 158, 11, 0.03);
    }

    /* === Message Row === */
    .msg-row {
      display: flex;
      align-items: flex-end;
      gap: 10px;
      position: relative;
      max-width: 85%;
      padding: 0 4px;
      animation: msgSlideIn 0.2s ease-out;
      &.own { align-self: flex-end; flex-direction: row-reverse; }
      &:not(.own) { align-self: flex-start; }
      &.grouped { margin-top: -4px; }
      &:not(.grouped) { margin-top: 4px; }
      &:hover .msg-hover-actions { opacity: 1; pointer-events: auto; }
    }

    @keyframes msgSlideIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .msg-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
      border: 2px solid rgba(255, 255, 255, 0.05);
    }

    .msg-avatar-spacer {
      width: 32px;
      flex-shrink: 0;
    }

    /* === Bubbles === */
    .bubble {
      padding: 10px 14px;
      max-width: 680px;
      position: relative;
      word-wrap: break-word;
      transition: transform 150ms ease, box-shadow 150ms ease;

      &.own {
        border-radius: 18px 4px 18px 18px;
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(245, 158, 11, 0.10));
        border: 1px solid rgba(245, 158, 11, 0.25);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        align-self: flex-end;

        &:hover {
          box-shadow: 0 4px 16px rgba(245, 158, 11, 0.2);
          transform: translateY(-1px);
        }
      }
      &.other {
        border-radius: 4px 18px 18px 18px;
        background: var(--crm-surface-raised, #1b1a17);
        border: 1px solid var(--crm-glass-border);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);

        &:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          transform: translateY(-1px);
        }
      }
      &.deleted {
        opacity: 0.5;
        font-style: italic;
      }
    }

    .deleted-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--crm-text-muted);
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .bubble-sender {
      font-size: 12px;
      font-weight: 700;
      color: var(--crm-accent);
      margin-bottom: 4px;
      letter-spacing: 0.02em;
    }

    .bubble-body { white-space: pre-wrap; word-break: break-word; color: var(--crm-text-primary); }
    .bubble-caption { font-size: 13px; margin-top: 4px; color: var(--crm-text-secondary); }
    :host ::ng-deep .mention-highlight {
      color: #60a5fa;
      font-weight: 600;
      cursor: pointer;
    }
    :host ::ng-deep .bubble.own .mention-highlight {
      color: #fbbf24;
    }

    .bubble-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 4px;
    }

    .edited-label {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-text-muted);
      font-style: italic;
    }

    .read-check {
      font-size: 14px;
      width: 14px;
      height: 14px;
      margin-left: 2px;
      transition: color 180ms ease;
      &.sent { color: var(--crm-text-muted); }
      &.delivered { color: var(--crm-text-muted); }
      &.read { color: var(--crm-status-info); }
    }

    .bubble-time {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 11px;
      color: var(--crm-text-muted);
      opacity: 0.7;
    }

    /* === Hover Actions (floating toolbar) === */
    .msg-hover-actions {
      position: absolute;
      top: -14px;
      right: 8px;
      display: flex;
      gap: 2px;
      padding: 4px;
      background: var(--crm-surface-raised, #1b1a17);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(12px);
      z-index: 5;
      animation: hoverActionsIn 150ms ease;
      &.left { right: auto; left: 40px; }
    }

    @keyframes hoverActionsIn {
      from { opacity: 0; transform: translateY(4px) scale(0.95); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    .hover-action-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 3px;
      border-radius: 8px;
      color: var(--crm-text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 100ms ease;
      mat-icon { font-size: 15px; width: 15px; height: 15px; }
      &:hover { color: var(--crm-accent); background: rgba(245, 158, 11, 0.12); transform: scale(1.1); }
    }

    .reaction-quick { font-size: 13px; line-height: 1; }

    .hover-action-btn.bookmarked {
      color: var(--crm-accent);
    }

    /* === Link card === */
    .link-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      margin-top: 6px;
      border-radius: 10px;
      background: rgba(96, 165, 250, 0.06);
      border: 1px solid rgba(96, 165, 250, 0.12);
      text-decoration: none;
      color: var(--crm-status-info, #60a5fa);
      font-size: 12px;
      transition: all 150ms;
      overflow: hidden;

      mat-icon { font-size: 14px; width: 14px; height: 14px; flex-shrink: 0; opacity: 0.7; }
      .link-card-url { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .link-card-arrow { opacity: 0; transition: opacity 150ms; }

      &:hover {
        background: rgba(96, 165, 250, 0.1);
        border-color: rgba(96, 165, 250, 0.2);
        .link-card-arrow { opacity: 0.7; }
      }
    }

    /* === Reply quote === */
    .reply-quote {
      display: block;
      width: 100%;
      border-left: 2px solid var(--crm-accent);
      border-top: none;
      border-right: none;
      border-bottom: none;
      padding: 4px 8px;
      margin-bottom: 4px;
      font-size: 12px;
      font-family: inherit;
      text-align: left;
      color: inherit;
      background: rgba(245, 158, 11, 0.06);
      border-radius: 0 4px 4px 0;
      cursor: pointer;
      transition: background 150ms, border-color 150ms;

      &:hover,
      &:focus-visible {
        background: rgba(245, 158, 11, 0.1);
        border-left-color: #fbbf24;
        outline: none;
      }
    }
    .reply-name { font-weight: 500; display: block; color: var(--crm-accent); }
    .reply-preview-line {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .reply-thumb {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
      background: var(--crm-surface-overlay);
    }
    .reply-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }
    .reply-text {
      display: block;
      min-width: 0;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 250px;
    }
    .reply-jump-icon {
      margin-left: auto;
      font-size: 16px;
      width: 16px;
      height: 16px;
      color: var(--crm-text-muted);
      opacity: 0;
      transition: opacity 150ms;
      flex-shrink: 0;
    }
    .reply-quote:hover .reply-jump-icon,
    .reply-quote:focus-visible .reply-jump-icon {
      opacity: 0.75;
    }

    /* === Reply bar === */
    .reply-bar {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      border-left: 3px solid var(--crm-accent);
      background: rgba(245, 158, 11, 0.06);
      border-radius: 0 8px 8px 0;
      margin: 0 16px;
      flex-shrink: 0;
    }
    .reply-bar-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .reply-bar-thumb {
      width: 36px;
      height: 36px;
      border-radius: 6px;
      object-fit: cover;
      flex-shrink: 0;
      background: var(--crm-surface-overlay);
    }
    .reply-bar-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }
    .reply-bar-copy {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .reply-bar-name { font-size: 12px; font-weight: 500; color: var(--crm-accent); display: block; }
    .reply-bar-text {
      font-size: 12px;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* === Media === */
    .media-shell {
      position: relative;
      display: inline-block;
      max-width: 100%;
    }

    .msg-image {
      max-width: 300px;
      max-height: 300px;
      border-radius: 8px;
      cursor: pointer;
      display: block;
    }

    .msg-video {
      max-width: 300px;
      max-height: 240px;
      border-radius: 8px;
      display: block;
    }

    .media-download-btn,
    .audio-download-btn {
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(0, 0, 0, 0.58);
      color: rgba(255, 255, 255, 0.88);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 150ms, background 150ms;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &:hover { background: rgba(0, 0, 0, 0.78); }
    }

    .media-download-btn {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      opacity: 0.86;
    }

    .media-shell:hover .media-download-btn,
    .media-download-btn:focus-visible {
      opacity: 1;
    }

    .audio-shell {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .audio-download-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    audio { max-width: 100%; }

    .file-link {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 6px 8px;
      border-radius: 8px;
      background: var(--crm-glass-bg);
      border: 1px solid var(--crm-glass-border);
      color: var(--crm-accent);
      font-size: 13px;
      transition: background 150ms;
      cursor: pointer;
      text-align: left;
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
      span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }
      &:hover { background: var(--crm-surface-raised); }
    }

    .file-download-icon {
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }

    /* === Badges === */
    .forwarded-badge {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--crm-text-muted);
      font-style: italic;
      margin-bottom: 2px;
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }

    .pinned-indicator {
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 10px;
      color: var(--crm-accent);
      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }

    /* === Reactions === */
    .reactions-row {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
    }

    .reaction-chip {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: 13px;
      border: 1px solid var(--crm-glass-border);
      background: var(--crm-glass-bg);
      cursor: pointer;
      color: var(--crm-text-primary);
      transition: all 150ms ease;
      &:hover { background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.2); transform: scale(1.05); }
      &.my-reaction {
        background: rgba(245, 158, 11, 0.12);
        border-color: rgba(245, 158, 11, 0.3);
      }
    }

    /* === Date Divider === */
    .date-divider {
      text-align: center;
      margin: 16px 0;
      position: relative;
      span {
        background: var(--crm-surface-base, #0c0b09);
        padding: 4px 16px;
        font-size: 11px;
        color: var(--crm-text-muted);
        border-radius: 12px;
        border: 1px solid var(--crm-glass-border);
        font-family: var(--crm-font-mono);
        letter-spacing: 0.04em;
        text-transform: uppercase;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
      }
    }

    .highlight {
      animation: highlightFade 2s ease;
    }
    @keyframes highlightFade {
      0%, 30% { background: rgba(245, 158, 11, 0.15); }
      100% { background: transparent; }
    }

    /* === Forward bar === */
    .forward-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 14px;
      border-top: 1px solid var(--crm-glass-border);
      background: var(--crm-surface-raised);
      border-left: 2px solid var(--crm-accent);
      flex-shrink: 0;
    }
    .forward-label { font-size: 13px; font-weight: 500; white-space: nowrap; color: var(--crm-text-secondary); }
    .forward-list {
      display: flex;
      gap: 4px;
      overflow-x: auto;
      flex: 1;
    }
    .forward-target {
      white-space: nowrap;
      padding: 4px 12px;
      border-radius: 16px;
      border: 1px solid var(--crm-glass-border);
      background: transparent;
      color: var(--crm-text-primary);
      cursor: pointer;
      font-size: 12px;
      transition: background 150ms, border-color 150ms;
      &:hover { background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.2); }
    }

    /* === Typing indicator === */
    .typing {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      font-size: 12px;
      color: var(--crm-text-muted);
    }

    .typing-dots {
      display: flex;
      gap: 3px;
      span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--crm-text-muted);
        animation: typingBounce 1.2s ease-in-out infinite;
        &:nth-child(1) { animation-delay: -0.24s; }
        &:nth-child(2) { animation-delay: -0.12s; }
        &:nth-child(3) { animation-delay: 0s; }
      }
    }

    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-6px); opacity: 1; }
    }

    .loading-older { text-align: center; padding: 8px; font-size: 12px; color: var(--crm-text-muted); }
    .loading-msg { text-align: center; padding: 24px; color: var(--crm-text-muted); }

    /* === Edit area === */
    .edit-area {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .edit-input {
      width: 100%;
      border: 1px solid var(--crm-glass-border);
      border-radius: 8px;
      padding: 8px;
      font-size: 14px;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      resize: none;
      background: var(--crm-surface-raised);
      color: var(--crm-text-primary);
      &:focus { outline: none; border-color: rgba(245, 158, 11, 0.3); }
    }
    .edit-actions { display: flex; justify-content: flex-end; gap: 4px; }

    /* === Compose area === */
    .compose-area {
      display: flex;
      align-items: flex-end;
      gap: 12px;
      padding: 12px 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      background: linear-gradient(180deg, rgba(12, 11, 9, 0.9) 0%, rgba(12, 11, 9, 0.7) 100%);
      backdrop-filter: blur(12px);
      flex-shrink: 0;
      box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.15);
    }

    .attach-btn {
      flex-shrink: 0;
      margin-bottom: 6px;
    }

    .compose-tools {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      margin-bottom: 6px;
    }

    .compose-input {
      flex: 1;
      background: var(--crm-surface-overlay, #272520);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 24px;
      padding: 10px 18px;
      min-height: 42px;
      box-sizing: border-box;
      color: var(--crm-text-primary, #ececec);
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      resize: none;
      outline: none;
      line-height: 1.5;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
      transition: border-color 150ms, box-shadow 150ms;
      &:focus {
        border-color: rgba(245, 158, 11, 0.5);
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2), 0 0 12px rgba(245, 158, 11, 0.15);
      }
      &::placeholder { color: rgba(160, 160, 160, 0.5); }
    }

    .send-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #000;
      flex-shrink: 0;
      transition: all 200ms ease;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
      mat-icon { font-size: 20px; width: 20px; height: 20px; }
      &:hover:not(:disabled) { transform: scale(1.1) translateY(-2px); box-shadow: 0 8px 20px rgba(245, 158, 11, 0.4); }
      &:active:not(:disabled) { transform: scale(0.95); box-shadow: 0 2px 6px rgba(245, 158, 11, 0.2); }
      &:disabled { opacity: 0.3; cursor: default; background: var(--crm-surface-raised); box-shadow: none; color: var(--crm-text-muted); }
    }

    /* === Drag overlay === */
    .drag-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: rgba(245, 158, 11, 0.06);
      border: 2px dashed var(--crm-accent);
      border-radius: 12px;
      z-index: 10;
      gap: 10px;
      box-shadow: inset 0 0 40px rgba(245, 158, 11, 0.08);
      mat-icon { font-size: 56px; width: 56px; height: 56px; color: var(--crm-accent); opacity: 0.7; }
      span { font-size: 14px; color: var(--crm-text-secondary); }
    }

    /* === Empty / No room === */
    .no-room, .empty-room {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--crm-text-muted);
      gap: 8px;
      mat-icon { font-size: 48px; width: 48px; height: 48px; opacity: 0.2; }
      p { font-size: 14px; }
    }

    /* === Restore button === */
    .restore-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-left: 8px;
      padding: 2px 6px;
      border: 1px solid var(--crm-glass-border);
      border-radius: 6px;
      background: none;
      color: var(--crm-text-muted);
      cursor: pointer;
      font-size: 11px;
      transition: color 150ms, background 150ms;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
      &:hover { color: var(--crm-accent); background: rgba(245, 158, 11, 0.08); }
    }

    /* === Selection mode === */
    .select-checkbox {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      cursor: pointer;
      position: relative;
      width: 20px;
      height: 20px;
      input { opacity: 0; width: 0; height: 0; position: absolute; }
      .checkmark {
        width: 18px;
        height: 18px;
        border-radius: 4px;
        border: 2px solid var(--crm-glass-border);
        background: transparent;
        transition: all 150ms;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      input:checked + .checkmark {
        background: var(--crm-accent);
        border-color: var(--crm-accent);
        &::after {
          content: '';
          width: 5px;
          height: 9px;
          border: solid #000;
          border-width: 0 2px 2px 0;
          transform: rotate(45deg);
          margin-bottom: 2px;
        }
      }
    }

    .msg-row.selected .bubble {
      background: rgba(245, 158, 11, 0.15) !important;
      border-color: rgba(245, 158, 11, 0.3) !important;
    }

    .selection-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px;
      border-top: 1px solid var(--crm-glass-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;
    }

    .selection-count {
      font-size: 13px;
      font-weight: 500;
      color: var(--crm-accent);
    }

    .selection-actions { display: flex; gap: 6px; }

    .selection-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      border-radius: 8px;
      border: 1px solid var(--crm-glass-border);
      background: transparent;
      color: var(--crm-text-primary);
      cursor: pointer;
      font-size: 12px;
      transition: background 150ms, border-color 150ms;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { background: rgba(245, 158, 11, 0.08); border-color: rgba(245, 158, 11, 0.2); }
      &:disabled { opacity: 0.4; cursor: default; }
      &.delete:hover { background: rgba(239, 68, 68, 0.08); border-color: rgba(239, 68, 68, 0.2); color: #ef4444; }
    }
  `],
})
export class ConversationRoomComponent {
  protected readonly chatService = inject(StaffChatService);
  protected readonly media = inject(StaffChatMediaService);
  private readonly authService = inject(AuthService);
  protected readonly wsService = inject(WebSocketService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly platformId = inject(PLATFORM_ID);

  protected safeSub(s: unknown, start: number, end?: number): string {
    return safeSubstring(s, start, end);
  }

  conversationId = input.required<string>();

  replyText = '';
  editText = '';
  searchQuery = '';
  private typingTimeout: ReturnType<typeof setTimeout> | null = null;
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;
  private scrollHeightBeforeLoad = 0;

  // Scroll state
  private _rafPending = false;
  private _prevMsgLen = 0;
  private _wasNearBottom = true;

  readonly isNearBottom = signal(true);
  readonly unreadBelowCount = signal(0);

  readonly infoToggled = output<void>();
  readonly currentUserId = signal<string>('');
  readonly isDragOver = signal(false);
  readonly showSearch = signal(false);
  readonly showPinnedPanel = signal(false);
  readonly forwardingMessage = signal<StaffMessage | null>(null);
  readonly selectionMode = signal(false);
  readonly selectedMessageIds = signal<ReadonlySet<string>>(new Set<string>());
  readonly forwardingSelection = signal(false);
  readonly showEmojiPicker = signal(false);
  readonly recentEmojis = signal<string[]>([]);
  readonly showMentionDropdown = signal(false);
  readonly mentionQuery = signal('');
  readonly reactionPickerMsg = signal<StaffMessage | null>(null);
  readonly showImageLightbox = signal(false);
  readonly lightboxImages = signal<StaffChatMediaItem[]>([]);
  readonly lightboxStartIndex = signal(0);

  readonly messagesContainer = viewChild<ElementRef<HTMLElement>>('messagesContainer');

  readonly typingLabel = computed(() => {
    const map = this.chatService.typingUsers();
    const convId = this.chatService.activeConversationId();
    if (!convId) return '';
    const typers = map.get(convId);
    if (!typers || typers.size === 0) return '';
    const names = [...typers.values()];
    if (names.length === 1) return `Печатает`;
    return `${names.length} печатают`;
  });

  readonly otherUserOnline = computed(() => {
    const conv = this.chatService.activeConversation();
    if (!conv || conv.type !== 'direct') return false;
    const other = conv.participants?.find(p => p.user_id !== this.currentUserId());
    return other ? this.wsService.isUserOnline(other.user_id) : false;
  });

  readonly otherUserLastSeen = computed(() => {
    const conv = this.chatService.activeConversation();
    if (!conv || conv.type !== 'direct') return '';
    const other = conv.participants?.find(p => p.user_id !== this.currentUserId());
    if (!other?.last_seen_at || this.wsService.isUserOnline(other.user_id)) return '';
    const now = Date.now();
    const then = new Date(other.last_seen_at).getTime();
    const diffMin = Math.floor((now - then) / 60000);
    if (diffMin < 1) return 'был(а) только что';
    if (diffMin < 60) return `был(а) ${diffMin} мин. назад`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `был(а) ${diffHours} ч. назад`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'был(а) вчера';
    if (diffDays < 7) return `был(а) ${diffDays} дн. назад`;
    return `был(а) ${new Date(other.last_seen_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
  });

  readonly onlineCount = computed(() => {
    const conv = this.chatService.activeConversation();
    if (!conv?.participants) return 0;
    return conv.participants.filter(p =>
      p.user_id !== this.currentUserId() && this.wsService.isUserOnline(p.user_id)
    ).length;
  });

  private previousConversationId: string | null = null;

  private readonly sessionEffect = effect(() => {
    const id = this.conversationId();
    if (!id) return;
    // untracked: signals прочитанные внутри selectConversation/loadPinnedMessages/getDraft
    // не должны становиться dependency этого effect — иначе каждый http.get.set превращается
    // в infinite loop (10 req/sec).
    untracked(() => {
      if (this.previousConversationId && this.replyText.trim()) {
        this.chatService.saveDraft(this.previousConversationId, this.replyText);
      } else if (this.previousConversationId) {
        this.chatService.clearDraft(this.previousConversationId);
      }
      this.previousConversationId = id;

      this.chatService.selectConversation(id);
      this.chatService.loadPinnedMessages();
      this._prevMsgLen = 0;
      this._wasNearBottom = true;
      this.isNearBottom.set(true);
      this.unreadBelowCount.set(0);
      this.editText = '';
      this.showPinnedPanel.set(false);

      this.replyText = this.chatService.getDraft(id);
    });
  });

  private readonly userEffect = effect(() => {
    const user = this.authService.currentUser();
    if (user?.id) this.currentUserId.set(user.id);
  });

  private readonly mediaPreviewEffect = effect(() => {
    const messages = this.chatService.messages();
    untracked(() => {
      const replyItems = messages
        .map(msg => this.replyPreviewItem(msg))
        .filter((item): item is StaffChatMediaItem => item !== null);
      this.media.ensureImagePreviews([...messages, ...replyItems]);
    });
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        const stored = localStorage.getItem('staff-chat-recent-emojis');
        if (stored) this.recentEmojis.set(JSON.parse(stored));
      } catch { /* ignore */ }
    }

    // Auto-scroll on new messages + unread-below counter when scrolled up
    effect(() => {
      const msgs = this.chatService.groupedMessages();
      const len = msgs.length;
      if (len > this._prevMsgLen) {
        const added = len - this._prevMsgLen;
        const prevLen = this._prevMsgLen;
        this._prevMsgLen = len;
        // Don't auto-scroll when prepending older messages
        if (this.chatService.loadingOlder()) return;
        if (this.isNearBottom() || prevLen === 0) {
          this.scheduleScrollToBottom();
        } else {
          const myId = this.currentUserId();
          const newInbound = msgs.slice(-added).filter(m => m.sender_id !== myId).length;
          if (newInbound > 0) this.unreadBelowCount.update(c => c + newInbound);
        }
      } else if (len < this._prevMsgLen) {
        // Reset on conversation switch / messages clear
        this._prevMsgLen = len;
      }
    });

    // ResizeObserver + scroll listener bound after first render (browser only)
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const el = this.messagesContainer()?.nativeElement;
      if (!el) return;

      const ro = new ResizeObserver(() => {
        if (this._wasNearBottom) this.scheduleScrollToBottom();
      });
      ro.observe(el);
      this.destroyRef.onDestroy(() => ro.disconnect());

      const scrollListener = () => this.onScrollNative(el);
      this.ngZone.runOutsideAngular(() => {
        el.addEventListener('scroll', scrollListener, { passive: true });
      });
      this.destroyRef.onDestroy(() => el.removeEventListener('scroll', scrollListener));
    });
  }

  private scheduleScrollToBottom(): void {
    if (this._rafPending || !isPlatformBrowser(this.platformId)) return;
    this._rafPending = true;
    this.ngZone.runOutsideAngular(() => {
      requestAnimationFrame(() => {
        this._rafPending = false;
        const el = this.messagesContainer()?.nativeElement;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    });
  }

  private onScrollNative(el: HTMLElement): void {
    const nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 120;
    this._wasNearBottom = nearBottom;
    if (this.isNearBottom() !== nearBottom) {
      this.ngZone.run(() => {
        this.isNearBottom.set(nearBottom);
        if (nearBottom) this.unreadBelowCount.set(0);
      });
    }

    // Infinite scroll: load older when near top
    if (el.scrollTop < 80 && !this.chatService.loadingOlder() && this.chatService.hasOlder()) {
      this.scrollHeightBeforeLoad = el.scrollHeight;
      this.ngZone.run(() => {
        this.chatService.loadOlderMessages();
      });
      // Preserve scroll position after prepending older messages
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const newHeight = el.scrollHeight;
          el.scrollTop = newHeight - this.scrollHeightBeforeLoad;
        });
      });
    }
  }

  jumpToBottom(): void {
    this.scheduleScrollToBottom();
    this.unreadBelowCount.set(0);
  }

  send(): void {
    if (!this.replyText.trim()) return;
    this.chatService.sendMessage(this.replyText);
    this.replyText = '';
    this.chatService.sendTyping(false);
    const convId = this.chatService.activeConversationId();
    if (convId) this.chatService.clearDraft(convId);
  }

  onVoiceSent(): void {
    // Сообщения обновятся через WebSocket автоматически
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.showMentionDropdown()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === 'Escape') {
        return; // Let MentionAutocompleteComponent handle these via HostListener
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  onInput(event?: Event): void {
    this.chatService.sendTyping(true);
    if (this.typingTimeout) clearTimeout(this.typingTimeout);
    this.typingTimeout = setTimeout(() => {
      this.chatService.sendTyping(false);
    }, 2000);

    const cursorPos = event?.target instanceof HTMLTextAreaElement
      ? event.target.selectionStart
      : this.replyText.length;
    const textBefore = this.replyText.substring(0, cursorPos);
    const mentionMatch = textBefore.match(/@([\p{L}\w]*)$/u);
    if (mentionMatch) {
      this.mentionQuery.set(mentionMatch[1]);
      this.showMentionDropdown.set(true);
    } else {
      this.showMentionDropdown.set(false);
    }
  }

  onBack(): void {
    const convId = this.chatService.activeConversationId();
    if (convId) this.chatService.saveDraft(convId, this.replyText);
    this.chatService.deselectConversation();
  }

  setReply(msg: StaffMessage): void {
    this.chatService.setReplyTo(msg);
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
    const content = msg.reply_to_content?.trim() ?? '';
    const filename = msg.reply_to_original_filename?.trim() ?? '';
    return this.previewLabel(
      msg.reply_to_message_type ?? (msg.reply_to_attachment_url ? 'file' : 'text'),
      content,
      filename,
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

  openReplyReference(event: Event, msg: StaffMessage): void {
    event.preventDefault();
    event.stopPropagation();
    const messageId = msg.reply_to_message_id;
    if (!messageId) return;
    if (this.scrollToMessage(messageId)) return;

    const item = this.replyPreviewItem(msg);
    if (item) {
      this.openImageItem(item);
    }
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

  // Edit
  startEdit(msg: StaffMessage): void {
    this.editText = msg.content;
    this.chatService.startEditing(msg.id);
  }

  confirmEdit(messageId: string): void {
    if (this.editText.trim()) {
      this.chatService.editMessage(messageId, this.editText);
    }
  }

  onEditKeydown(event: KeyboardEvent, messageId: string): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.confirmEdit(messageId);
    }
    if (event.key === 'Escape') {
      this.chatService.cancelEditing();
    }
  }

  canEdit(msg: StaffMessage): boolean {
    if (msg.deleted_at) return false;
    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    return ageMs < 24 * 60 * 60 * 1000;
  }

  canDelete(msg: StaffMessage): boolean {
    if (msg.deleted_at) return false;
    if (msg.sender_id === this.currentUserId()) return true;
    // Owner/admin can delete any message in group
    const conv = this.chatService.activeConversation();
    if (!conv) return false;
    const myParticipant = conv.participants?.find(p => p.user_id === this.currentUserId());
    return myParticipant?.role === 'owner' || myParticipant?.role === 'admin';
  }

  toggleBookmark(msg: StaffMessage): void {
    const convId = this.chatService.activeConversationId();
    if (convId) this.chatService.toggleBookmark(convId, msg.id);
  }

  private urlRegex = /https?:\/\/[^\s<>"')\]]+/g;

  extractUrls(content: string): string[] {
    if (!content) return [];
    return content.match(this.urlRegex) || [];
  }

  formatUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname + (u.pathname !== '/' ? u.pathname : '');
    } catch {
      return url.substring(0, 50);
    }
  }

  copyText(text: string): void {
    navigator.clipboard.writeText(text).catch(() => { /* clipboard write failed */ });
  }

  formatMentions(content: string): string {
    if (!content) return '';
    const escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped.replace(
      /@([\p{L}\w]+(?:\s[\p{L}\w]+)?)/gu,
      '<span class="mention-highlight">@$1</span>',
    );
  }

  onContextMenu(_event: MouseEvent, _msg: StaffMessage): void {
    // Use built-in hover actions instead of context menu
  }

  // Search
  onSearchInput(value: string): void {
    if (this.searchDebounce) clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.chatService.searchMessages(value);
    }, 400);
  }

  closeSearch(): void {
    this.showSearch.set(false);
    this.searchQuery = '';
    this.chatService.clearSearch();
  }

  scrollToMessage(messageId: string): boolean {
    const el = this.messagesContainer()?.nativeElement;
    if (!el) return false;
    const msgEl = el.querySelector(`[data-msg-id="${messageId}"]`);
    if (msgEl) {
      msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      msgEl.classList.add('highlight');
      setTimeout(() => msgEl.classList.remove('highlight'), 2000);
      return true;
    }
    return false;
  }

  // Pin
  togglePin(msg: StaffMessage): void {
    if (msg.pinned_at) {
      this.chatService.unpinMessage(msg.id);
    } else {
      this.chatService.pinMessage(msg.id);
    }
  }

  // Forward (single + multi)
  startForward(msg: StaffMessage): void {
    this.forwardingMessage.set(msg);
    this.forwardingSelection.set(false);
  }

  confirmForward(targetConversationId: string): void {
    if (this.forwardingSelection()) {
      // Multi-forward from selection
      const convId = this.chatService.activeConversationId();
      if (convId) {
        this.chatService.forwardMessages(convId, targetConversationId, [...this.selectedMessageIds()]);
      }
      this.exitSelectionMode();
      this.forwardingSelection.set(false);
    } else {
      const msg = this.forwardingMessage();
      if (msg) {
        this.chatService.forwardMessage(msg.id, targetConversationId);
      }
    }
    this.forwardingMessage.set(null);
  }

  cancelForward(): void {
    this.forwardingMessage.set(null);
    this.forwardingSelection.set(false);
  }

  // Selection mode
  enterSelectionMode(initialMessageId: string): void {
    this.selectionMode.set(true);
    this.selectedMessageIds.set(new Set([initialMessageId]));
  }

  exitSelectionMode(): void {
    this.selectionMode.set(false);
    this.selectedMessageIds.set(new Set());
    this.forwardingSelection.set(false);
  }

  toggleMessageSelection(messageId: string): void {
    this.selectedMessageIds.update(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }

  forwardSelected(): void {
    if (this.selectedMessageIds().size === 0) return;
    this.forwardingSelection.set(true);
    this.forwardingMessage.set(null);
  }

  deleteSelected(): void {
    const convId = this.chatService.activeConversationId();
    if (!convId || this.selectedMessageIds().size === 0) return;
    this.chatService.batchDeleteMessages(convId, [...this.selectedMessageIds()]);
    this.exitSelectionMode();
  }

  // Restore deleted message
  canRestore(msg: StaffMessage): boolean {
    if (!msg.deleted_at) return false;
    const conv = this.chatService.activeConversation();
    if (!conv) return false;
    const isOwn = msg.sender_id === this.currentUserId();
    if (isOwn) return true;
    const myParticipant = conv.participants?.find(p => p.user_id === this.currentUserId());
    return myParticipant?.role === 'owner' || myParticipant?.role === 'admin';
  }

  restoreMessage(msg: StaffMessage): void {
    const convId = this.chatService.activeConversationId();
    if (convId) {
      this.chatService.restoreMessage(convId, msg.id);
    }
  }

  // File handling
  onFileSelected(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    if (!input.files?.length) return;
    for (const file of Array.from(input.files)) {
      this.chatService.uploadFile(file);
    }
    input.value = '';
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      this.chatService.uploadFile(file);
    }
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          this.chatService.uploadFile(file);
          return;
        }
      }
    }
  }

  downloadMessageMedia(event: Event, msg: StaffMessage): void {
    event.stopPropagation();
    void this.media.downloadMessageMedia(msg);
  }

  openImage(msg: StaffMessage): void {
    if (!msg.attachment_url) return;
    this.openImageItem(this.mediaItemFromMessage(msg));
  }

  private openImageItem(item: StaffChatMediaItem): void {
    if (!item.attachment_url) return;
    const images = this.chatService.messages()
      .filter(m => m.message_type === 'image' && m.attachment_url)
      .map(m => this.mediaItemFromMessage(m));
    let idx = images.findIndex(image => image.id === item.id);
    if (idx < 0) {
      images.unshift(item);
      idx = 0;
    }
    this.media.ensureImagePreviews(images);
    this.lightboxImages.set(images);
    this.lightboxStartIndex.set(idx);
    this.showImageLightbox.set(true);
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

  // Emoji & Mention
  insertEmoji(emoji: string): void {
    const reactionMsg = this.reactionPickerMsg();
    if (reactionMsg) {
      this.chatService.toggleReaction(reactionMsg.id, emoji);
      this.reactionPickerMsg.set(null);
    } else {
      this.replyText += emoji;
    }
    this.showEmojiPicker.set(false);
    this.recentEmojis.update(prev => {
      const next = [emoji, ...prev.filter(e => e !== emoji)].slice(0, 24);
      try { localStorage.setItem('staff-chat-recent-emojis', JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  insertMention(participant: { user_id: string; display_name: string | null; email: string }): void {
    const text = this.replyText;
    const lastAt = text.lastIndexOf('@');
    if (lastAt >= 0) {
      const name = participant.display_name || participant.email;
      this.replyText = text.substring(0, lastAt) + '@' + name + ' ' + text.substring(lastAt + 1 + this.mentionQuery().length);
    }
    this.showMentionDropdown.set(false);
  }

  openReactionPicker(_event: MouseEvent, msg: StaffMessage): void {
    this.reactionPickerMsg.set(msg);
    this.showEmojiPicker.set(true);
  }

  // Helpers
  timeLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  dateLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Сегодня';
    const y = new Date(today); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Вчера';
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
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
}
