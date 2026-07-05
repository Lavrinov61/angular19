import {
  Component,
  inject,
  input,
  output,
  signal,
  Signal,
  WritableSignal,
  computed,
  effect,
  untracked,
  ChangeDetectionStrategy,
  ElementRef,
  afterNextRender,
  PLATFORM_ID,
  viewChild,
  DestroyRef
} from '@angular/core';
import { isPlatformBrowser, SlicePipe } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRippleModule } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ActivatedRoute, Router } from '@angular/router';
import { CdkVirtualScrollViewport, CdkFixedSizeVirtualScroll, CdkVirtualForOf } from '@angular/cdk/scrolling';
import { AuthChatService, ChatMessage, ChatMessageMetadata, OrderContext, BotButton, BotInteractive, BotCard, ChatChannel, EntryContext, ApprovalGalleryPhoto } from '../../../core/services/auth-chat.service';
import { AuthService } from '../../../core/services/auth.service';
import { ChannelStatusService } from '../../../core/services/channel-status.service';
import { getFileIcon, isPdf } from '../../utils/file-helpers';
import { safeSubstring, safeStartsWith } from '../../utils/safe-string';
import { PhotoGalleryPanelComponent } from '../photo-gallery-panel/photo-gallery-panel.component';
import { EmojiPickerComponent } from '../../../features/employee/components/team-chat/emoji-picker.component';
import { ChatCtaPanelComponent } from './chat-cta-panel.component';

interface MessengerLink {
  label: string;
  href: string;
  icon: string;
  kind: 'max' | 'telegram' | 'whatsapp' | 'vk';
  notice?: string;
}

@Component({
  selector: 'app-chat-widget',
  imports: [
    FormsModule,
    SlicePipe,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatRippleModule,
    MatMenuModule,
    MatTooltipModule,
    PhotoGalleryPanelComponent,
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    EmojiPickerComponent,
    ChatCtaPanelComponent,
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.embedded-chat-host]': 'embedded()',
  },
  template: `
    <!-- FAB (только в popup-режиме) -->
    @if (!embedded() && !chatService.isOpen()) {
      <button
        mat-fab
        class="chat-fab"
        (click)="openChat()"
        [matBadge]="chatService.unreadCount()"
        [matBadgeHidden]="!chatService.hasUnread()"
        matBadgeColor="warn"
      >
        <mat-icon>chat</mat-icon>
      </button>
    }

    <!-- Chat window -->
    @if (embedded() || chatService.isOpen()) {
      <div class="chat-window"
           [class.minimized]="isMinimized()"
           [class.embedded]="embedded()"
           [class.cta-mode]="!authService.isAuthenticated()"
           [class.closing]="_closing()">

        @if (authService.isAuthenticated()) {
        @if (!embedded() && chatPanelMode() === 'home') {
          <div class="bank-chat-home">
            <span class="bank-drag-handle" aria-hidden="true">
              <i></i>
              <i></i>
            </span>

            <div class="bank-home-content">
              <h2>Связь со Своё Фото</h2>

              <div class="bank-quick-actions" aria-label="Быстрые действия">
                <button type="button" class="bank-action" (click)="openThread()">
                  <span><mat-icon>groups</mat-icon></span>
                  <strong>Менеджеры</strong>
                </button>
                <button type="button" class="bank-action" (click)="callStudio()">
                  <span><mat-icon>call</mat-icon></span>
                  <strong>Звонок</strong>
                </button>
                <button type="button" class="bank-action" (click)="openThread()">
                  <span><mat-icon>help</mat-icon></span>
                  <strong>Помощь</strong>
                </button>
              </div>

              <section class="bank-chat-list-card">
                <h3>Чаты</h3>
                <button type="button" class="bank-chat-row" (click)="openThread()">
                  <span class="bank-chat-row__icon"><mat-icon>chat_bubble</mat-icon></span>
                  <span class="bank-chat-row__body">
                    <strong>Чат с поддержкой</strong>
                    <em>Онлайн</em>
                    <small>Поможем с заказами, фото, записями и печатью</small>
                  </span>
                  <time>сейчас</time>
                  <mat-icon class="bank-chat-row__pin">push_pin</mat-icon>
                </button>

                <div class="messenger-strip" aria-label="Мессенджеры">
                  @for (link of messengerLinks(); track link.href) {
                    <a
                      [href]="link.href"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="messenger-chip"
                      [class.messenger-chip--max]="link.kind === 'max'"
                      [class.messenger-chip--telegram]="link.kind === 'telegram'"
                      [class.messenger-chip--whatsapp]="link.kind === 'whatsapp'"
                      [class.messenger-chip--vk]="link.kind === 'vk'"
                      [class.messenger-chip--notice]="link.notice"
                      [attr.aria-label]="link.notice ? link.label + ': ' + link.notice : link.label"
                    >
                      <span class="messenger-chip__icon" aria-hidden="true">
                        <mat-icon [svgIcon]="link.icon"></mat-icon>
                      </span>
                      <span class="messenger-chip__text">
                        <span>{{ link.label }}</span>
                        @if (link.notice) {
                          <small>{{ link.notice }}</small>
                        }
                      </span>
                    </a>
                  }
                </div>
              </section>
            </div>
          </div>
        } @else {
        <!-- Header (только в popup-режиме) -->
        @if (!embedded()) {
          <div class="bank-chat-thread-header">
            <button type="button" class="bank-header-icon" (click)="showContactHome()" aria-label="Назад">
              <mat-icon>arrow_back</mat-icon>
            </button>
            <div class="bank-thread-title">
              <strong>Чат с поддержкой</strong>
              <span>
                <mat-icon>bolt</mat-icon>
                @if (chatService.operatorTyping()) {
                  Печатает
                } @else if (chatService.isConnected()) {
                  На связи
                } @else {
                  Подключение
                }
              </span>
            </div>
            <button type="button" class="bank-header-icon" (click)="toggleSearch()" aria-label="Поиск">
              <mat-icon>search</mat-icon>
            </button>
          </div>
        }

        @if (chatService.sessionExpired()) {
          <div class="session-expired-banner" role="alert">
            <mat-icon>info</mat-icon>
            <div class="session-expired-text">
              Сессия истекла. Обновите страницу, чтобы начать новый диалог.
            </div>
            <button mat-button class="session-expired-btn" (click)="reloadForNewSession()">
              Обновить
            </button>
          </div>
        }
        @if (chatService.sessionClosed()) {
          <div class="session-expired-banner session-closed-banner" role="alert">
            <mat-icon>chat_bubble_outline</mat-icon>
            <div class="session-expired-text">
              Диалог завершён. Откройте новый, если нужна дальнейшая помощь.
            </div>
            <button mat-button class="session-expired-btn" (click)="startFreshDialog()">
              Начать новый
            </button>
          </div>
        }

        <!-- Search overlay -->
        @if (searchOpen()) {
          <div class="search-overlay">
            <div class="search-input-row">
              <mat-icon>search</mat-icon>
              <input
                type="text"
                class="search-input"
                [(ngModel)]="searchQuery"
                (ngModelChange)="onSearchInput($event)"
                placeholder="Поиск по сообщениям..."
              />
              @if (searchResults().length > 0) {
                <span class="search-count">{{ searchActiveIndex() + 1 }}/{{ searchResults().length }}</span>
              }
              <button mat-icon-button (click)="navigateSearch(-1)" [disabled]="searchResults().length === 0" title="Предыдущий">
                <mat-icon>keyboard_arrow_up</mat-icon>
              </button>
              <button mat-icon-button (click)="navigateSearch(1)" [disabled]="searchResults().length === 0" title="Следующий">
                <mat-icon>keyboard_arrow_down</mat-icon>
              </button>
              <button mat-icon-button (click)="closeSearch()" title="Закрыть">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          </div>
        }

        <!-- Order context -->
        @if (orderContext() && !isMinimized() && !embedded()) {
          <div class="order-context">
            <mat-icon>photo_camera</mat-icon>
            <div class="order-info">
              <strong>{{ orderContext()!.service }}</strong>
              <span>{{ orderContext()!.price }}₽</span>
            </div>
          </div>
        }

        <!-- Tabs -->
        @if (!isMinimized() && !hideGallery() && chatService.uploadedPhotos().length > 0) {
          <div class="chat-tabs">
            <button
              class="tab-btn"
              [class.active]="activeTab() === 'chat'"
              (click)="activeTab.set('chat')"
            >
              <mat-icon>chat</mat-icon>
              <span>Чат</span>
            </button>
            <button
              class="tab-btn"
              [class.active]="activeTab() === 'photos'"
              (click)="activeTab.set('photos')"
            >
              <mat-icon>photo_library</mat-icon>
              <span>Фото ({{ chatService.uploadedPhotos().length }})</span>
            </button>
          </div>
        }

        <!-- Gallery -->
        @if (!isMinimized() && !hideGallery() && activeTab() === 'photos') {
          <div class="chat-gallery">
            <app-photo-gallery-panel (uploadMore)="triggerFileUpload()" />
          </div>
        }

        <!-- Messages -->
        @if (!isMinimized() && activeTab() === 'chat') {
          @if (chatService.isLoading()) {
            <div class="chat-messages-loading">
              <div class="state-empty">
                <mat-spinner diameter="32" />
                <span>Загрузка чата...</span>
              </div>
            </div>
          } @else if (chatService.messages().length === 0) {
            <div class="welcome-block">
              <div class="welcome-icon">
                <img src="/assets/static/logo-white.webp" alt="СФ" />
              </div>
              <div class="welcome-title">Здравствуйте!</div>
              <div class="welcome-subtitle">Чем можем помочь?</div>
              <div class="welcome-chips">
                @for (chip of welcomeChips(); track chip.value) {
                  <button class="welcome-chip" (click)="sendWelcomeChip(chip)">{{ chip.label }}</button>
                }
              </div>
            </div>
          } @else {
            <cdk-virtual-scroll-viewport
              itemSize="80"
              [minBufferPx]="400"
              [maxBufferPx]="800"
              class="chat-messages"
              #messagesViewport
            >
              <div
                *cdkVirtualFor="let message of chatService.messages(); trackBy: trackById"
                class="message-wrapper"
              >
                @if (dateGroupFirstIds().get(message.id); as dateLabel) {
                  <div class="date-separator">
                    <span>{{ dateLabel }}</span>
                  </div>
                }
                <div
                  class="message"
                  [class.visitor]="message.sender_type === 'visitor'"
                  [class.studio]="message.sender_type === 'bot' || message.sender_type === 'operator'"
                  [attr.data-message-id]="message.id"
                >
                @if (message.sender_type !== 'visitor') {
                  <div class="message-avatar">
                    <img src="/assets/static/logo-white.webp" alt="СФ" />
                  </div>
                }
                <div class="message-content">
                  @if (message.is_forwarded) {
                    <div class="forwarded-badge">
                      <mat-icon>shortcut</mat-icon> Переслано{{ message.forwarded_from_name ? ' от ' + message.forwarded_from_name : '' }}
                    </div>
                  }
                  @if (message.reply_to_content) {
                    <div class="reply-quote" (click)="scrollToMessage(message.reply_to_message_id!)" (keydown.enter)="scrollToMessage(message.reply_to_message_id!)" tabindex="0">
                      @if (message.reply_to_sender_name) {
                        <span class="reply-quote-sender">{{ message.reply_to_sender_name }}</span>
                      }
                      <span class="reply-quote-text">{{ message.reply_to_content | slice:0:100 }}</span>
                    </div>
                  }
                  @if (message.sender_type !== 'visitor' && message.sender_name) {
                    <span class="message-sender">{{ message.sender_name }}</span>
                  }
                  @if (getGalleryUrls(message).length > 0) {
                    <div class="message-gallery">
                      @for (imageUrl of getGalleryUrls(message); track imageUrl) {
                        <button type="button" class="gallery-thumb" (click)="openImage(imageUrl)">
                          <img [src]="imageUrl" [alt]="message.content" loading="lazy" decoding="async" />
                        </button>
                      }
                    </div>
                    @if (message.content) {
                      <div class="message-bubble caption" [innerHTML]="formatMessage(message.content)"></div>
                    }
                  } @else if (message.message_type === 'image' && message.attachment_url) {
                    <div class="message-image" (click)="openImage(message.attachment_url)" (keydown.enter)="openImage(message.attachment_url)" tabindex="0">
                      @if (!imageLoaded(message.id)()) {
                        <div class="media-skeleton">
                          <mat-icon>image</mat-icon>
                        </div>
                      }
                      <img
                        [src]="message.attachment_url"
                        [alt]="message.content"
                        loading="lazy"
                        decoding="async"
                        [style.display]="imageLoaded(message.id)() ? 'block' : 'none'"
                        [class.media-loaded]="imageLoaded(message.id)()"
                        (load)="onImageLoad(message.id)"
                      />
                      @if (isUploading(message.id)) {
                        <div class="upload-overlay">
                          <mat-progress-spinner mode="determinate" [value]="getUploadPercent(message.id)" diameter="48" strokeWidth="4" />
                        </div>
                      }
                      <div class="image-overlay">
                        <mat-icon>zoom_in</mat-icon>
                      </div>
                    </div>
                    @if (message.content && message.content !== '📷 Фото') {
                      <div class="message-bubble caption" [innerHTML]="formatMessage(message.content)"></div>
                    }
                  } @else if (message.message_type === 'file' && message.attachment_url) {
                    @if (isPdfFile(message.attachment_url)) {
                      <div class="message-pdf">
                        <iframe [src]="sanitize(message.attachment_url)" class="pdf-frame"></iframe>
                        <a [href]="message.attachment_url" target="_blank" class="pdf-link">
                          <mat-icon>open_in_new</mat-icon> Открыть PDF
                        </a>
                      </div>
                    } @else {
                      <div class="message-file">
                        <a [href]="message.attachment_url" target="_blank" download>
                          <mat-icon>{{ getIcon(message.attachment_url) }}</mat-icon>
                          <span>{{ message.content || 'Скачать файл' }}</span>
                          <mat-icon>download</mat-icon>
                        </a>
                      </div>
                    }
                  } @else if (message.message_type === 'video' && message.attachment_url) {
                    <div class="message-video">
                      @if (!videoLoaded(message.id)()) {
                        <div class="media-skeleton">
                          <mat-icon>videocam</mat-icon>
                        </div>
                      }
                      <video
                        controls
                        preload="metadata"
                        [src]="message.attachment_url"
                        [style.display]="videoLoaded(message.id)() ? 'block' : 'none'"
                        [class.media-loaded]="videoLoaded(message.id)()"
                        (loadedmetadata)="onVideoLoad(message.id)"
                      >
                        Ваш браузер не поддерживает видео
                      </video>
                      @if (isUploading(message.id)) {
                        <div class="upload-overlay">
                          <mat-progress-spinner mode="determinate" [value]="getUploadPercent(message.id)" diameter="48" strokeWidth="4" />
                        </div>
                      }
                    </div>
                  } @else if (message.message_type === 'audio' && message.attachment_url) {
                    <div class="message-audio">
                      <mat-icon>mic</mat-icon>
                      <audio controls preload="metadata" [src]="message.attachment_url"></audio>
                    </div>
                  } @else {
                    @let gallery = getApprovalGallery(message);
                    @if (gallery) {
                    <div class="approval-gallery-card">
                      <div class="ag-header">
                        <mat-icon>photo_camera</mat-icon>
                        <span>Согласование фото</span>
                      </div>
                      @if (gallery.photos.length) {
                        <div class="ag-thumbs">
                          @for (photo of gallery.photos.slice(0, 4); track photo.id) {
                            <img [src]="photo.thumbnailUrl || photo.retouchedUrl" alt="Фото" loading="lazy" />
                          }
                          @if (gallery.photos.length > 4) {
                            <div class="ag-more">+{{ gallery.photos.length - 4 }}</div>
                          }
                        </div>
                      }
                      <div class="ag-info">{{ gallery.photos.length }} фото для просмотра</div>
                      @if (gallery.reviewUrl) {
                        <a class="ag-link" [href]="gallery.reviewUrl" target="_blank">
                          <mat-icon>open_in_new</mat-icon> Посмотреть и выбрать
                        </a>
                      }
                    </div>
                  } @else {
                    <div class="message-bubble" [innerHTML]="formatMessage(message.content)"></div>
                  }
                  }

                  @if (getInlineCards(message); as cards) {
                    @if (cards.length > 0) {
                      <div class="inline-cards">
                        @for (card of cards; track card.title + '-' + $index) {
                          <div class="chat-card" [class.chat-card--payment]="hasPaymentButton(card)" [class.chat-card--paid]="isCardPaid(card)">
                            <div class="chat-card-header">
                              @if (card.icon) {
                                <mat-icon>{{ card.icon }}</mat-icon>
                              }
                              <div class="chat-card-title-wrap">
                                <div class="chat-card-title">{{ card.title }}</div>
                                @if (card.subtitle) {
                                  <div class="chat-card-subtitle">{{ card.subtitle }}</div>
                                }
                              </div>
                            </div>

                            @if (card.items?.length) {
                              <div class="chat-card-items">
                                @for (item of card.items!; track item.label + '-' + $index) {
                                  <div class="chat-card-item">
                                    <span>{{ item.label }}</span>
                                    <strong>{{ item.value }}</strong>
                                  </div>
                                }
                              </div>
                            }

                            @if (card.price) {
                              <div class="chat-card-price">{{ card.price }}</div>
                            }

                            @if (isCardPaid(card)) {
                              <div class="chat-card-paid-badge">
                                <mat-icon>check_circle</mat-icon>
                                Оплачено
                              </div>
                            } @else if (card.buttons?.length) {
                              <div class="chat-card-actions">
                                @for (btn of card.buttons!; track btn.id) {
                                  <button
                                    class="chat-card-btn"
                                    [class.payment]="btn.value === 'pay_online_widget' || btn.value === 'pay_order'"
                                    (click)="onInteractiveButtonClick(btn)"
                                  >
                                    {{ btn.label }}
                                  </button>
                                  @if (btn.value === 'pay_online_widget' || btn.value === 'pay_order') {
                                    <div class="chat-card-trust">🔒 Безопасная оплата</div>
                                  }
                                }
                              </div>
                            }
                          </div>
                        }
                      </div>
                    }
                  }

                  <span class="message-time">
                    {{ formatTime(message.created_at) }}
                    @if (message.sender_type === 'visitor' && message.delivery_status) {
                      @switch (message.delivery_status) {
                        @case ('pending') { <mat-icon class="delivery-icon pending">schedule</mat-icon> }
                        @case ('sending') { <mat-icon class="delivery-icon sending">hourglass_top</mat-icon> }
                        @case ('sent') { <mat-icon class="delivery-icon sent">check</mat-icon> }
                        @case ('delivered') { <mat-icon class="delivery-icon delivered">done_all</mat-icon> }
                        @case ('read') { <mat-icon class="delivery-icon read">done_all</mat-icon> }
                        @case ('failed') {
                          <button class="retry-btn" (click)="retryMessage(message.client_message_id!)">
                            <mat-icon class="delivery-icon failed">error_outline</mat-icon>
                          </button>
                        }
                      }
                    }
                  </span>

                  @if (message.message_type !== 'system' && message.message_type !== 'interactive') {
                    <div class="message-actions">
                      <button class="action-btn" (click)="setReplyTo(message)" title="Ответить">
                        <mat-icon>reply</mat-icon>
                      </button>
                      @if (message.sender_type === 'visitor') {
                        <button class="action-btn delete-btn" (click)="deleteMessage(message)" title="Удалить">
                          <mat-icon>delete_outline</mat-icon>
                        </button>
                      }
                    </div>
                  }

                  @if (message.id === lastMessageId() && message.sender_type !== 'visitor' && getQuickRepliesForMessage(message).length > 0) {
                    <div class="inline-quick-replies">
                      @for (btn of getQuickRepliesForMessage(message); track btn.id) {
                        <button
                          class="quick-reply-chip"
                          [class.payment]="btn.value === 'pay_online_widget' || btn.value === 'pay_order'"
                          (click)="onInteractiveButtonClick(btn)"
                        >
                          {{ btn.label }}
                        </button>
                      }
                    </div>
                  }
                </div>
              </div>
              </div>

              @if (chatService.operatorTyping()) {
                <div class="message studio typing-message">
                  <div class="message-avatar">
                    <img src="/assets/static/logo-white.webp" alt="СФ" />
                  </div>
                  <div class="message-content">
                    <div class="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  </div>
                </div>
              }
            </cdk-virtual-scroll-viewport>

            <!-- Scroll-to-bottom FAB -->
            @if (showScrollFab()) {
              <button class="scroll-fab" (click)="scrollToBottom()" title="Вниз">
                <mat-icon>keyboard_arrow_down</mat-icon>
                @if (chatService.unreadCount() > 0) {
                  <span class="scroll-fab-badge">{{ chatService.unreadCount() }}</span>
                }
              </button>
            }
          }

          <!-- Fullscreen image viewer -->
          @if (fullscreenImage(); as imgUrl) {
            <div
              class="fs-overlay"
              (click)="closeFullscreen()"
              (keydown.escape)="closeFullscreen()"
              tabindex="0"
            >
              <button class="fs-close" (click)="closeFullscreen()">
                <mat-icon>close</mat-icon>
              </button>
              <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
              <img
                [src]="imgUrl"
                alt="Fullscreen"
                class="fs-image"
                (click)="$event.stopPropagation()"
                (touchstart)="onFsTouchStart($event)"
                (touchmove)="onFsTouchMove($event)"
                (touchend)="onFsTouchEnd($event)"
                draggable="false"
              />
            </div>
          }

          <!-- Drop zone -->
          <div
            class="photo-drop-zone"
            [class.drag-over]="isDragOver()"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)"
            (drop)="onDrop($event)"
          >
            <mat-icon>upload_file</mat-icon>
            <span>Перетащите фото, видео или PDF сюда</span>
          </div>

          <!-- Upload progress -->
          @if (chatService.uploadProgress(); as progress) {
            <div class="upload-progress">
              <mat-progress-bar [mode]="chatService.uploadProgressPercent() === 0 ? 'indeterminate' : 'determinate'" [value]="chatService.uploadProgressPercent()" />
              <div class="upload-progress-row">
                <span class="upload-progress-text">{{ chatService.uploadProgressText() }}</span>
                <button class="upload-cancel-btn" (click)="chatService.cancelUpload()" title="Отменить">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            </div>
          }

          <!-- Upload / validation error -->
          @if (displayError(); as error) {
            <div class="upload-error">
              <mat-icon>error_outline</mat-icon>
              <span>{{ error }}</span>
              @if (chatService.failedUploads().length > 0) {
                <button class="retry-upload-btn" (click)="retryFailedUpload()">Повторить</button>
                <button class="dismiss-upload-btn" (click)="dismissFailedUpload()">
                  <mat-icon>close</mat-icon>
                </button>
              }
            </div>
          }

          <!-- Reply preview -->
          @if (replyingTo(); as reply) {
            <div class="reply-preview">
              <div class="reply-preview-info">
                <span class="reply-preview-sender">{{ reply.sender_name || (reply.sender_type === 'visitor' ? 'Вы' : 'Оператор') }}</span>
                <span class="reply-preview-text">{{ safeSub(reply.content, 0, 80) }}</span>
              </div>
              <button class="reply-preview-close" (click)="clearReplyTo()">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          }

          <!-- Input -->
          <div class="chat-input">
            <input
              type="file"
              #fileInput
              multiple
              style="display: none"
              (change)="onFileSelected($event)"
            />
            <button
              mat-icon-button
              class="attach-btn"
              [disabled]="chatService.isUploading()"
              (click)="triggerFileUpload()"
              matTooltip="Прикрепить"
            >
              @if (chatService.isUploading()) {
                <mat-spinner diameter="20" />
              } @else {
                <mat-icon>attach_file</mat-icon>
              }
            </button>
            <div class="emoji-btn-wrap">
              <button
                mat-icon-button
                class="emoji-btn"
                (click)="showEmojiPicker.set(!showEmojiPicker())"
                matTooltip="Эмодзи"
              >
                <mat-icon>sentiment_satisfied_alt</mat-icon>
              </button>
              @if (showEmojiPicker()) {
                <app-emoji-picker
                  [recentEmojis]="recentEmojis()"
                  (emojiSelected)="insertEmoji($event)"
                  (closed)="showEmojiPicker.set(false)"
                />
              }
            </div>
            <input
              type="text"
              class="message-input"
              [(ngModel)]="messageText"
              (keyup.enter)="sendMessage()"
              (input)="onTyping()"
              (paste)="onPaste($event)"
              placeholder="Сообщение"
              [disabled]="chatService.isLoading()"
            />
            <button
              mat-icon-button
              (click)="sendMessage()"
              [disabled]="!messageText.trim() || chatService.isLoading()"
              [class.send-active]="messageText.trim()"
            >
              <mat-icon>send</mat-icon>
            </button>
          </div>
        }
        }
        } @else {
          <app-chat-cta-panel (closed)="closeChat()" />
        }
      </div>
      @if (!embedded() && chatService.isOpen()) {
        <button mat-fab class="chat-fab chat-fab--close" (click)="closeChat()" aria-label="Закрыть чат">
          <mat-icon>close</mat-icon>
        </button>
      }
    }
  `,
  styles: [`
    // ======== Host ========
    :host {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 1001;
      pointer-events: none;
    }

    // Embedded: заполняет контейнер родителя
    :host-context(.embedded-chat-host) {
      position: static;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      z-index: auto;
    }

    @media (max-width: 599px) {
      :host:not(.embedded-chat-host) {
        left: 0;
        right: 0;
        bottom: calc(80px + env(safe-area-inset-bottom, 0px));
        display: flex;
        justify-content: flex-end;
        padding-inline: 16px;
        box-sizing: border-box;
      }
    }

    // ======== FAB ========
    .chat-fab {
      pointer-events: auto;
      --mat-fab-container-color: #f59e0b;
      --mat-fab-foreground-color: #0a0a0a;
      box-shadow:
        0 4px 16px rgba(245, 158, 11, 0.3),
        0 2px 6px rgba(0, 0, 0, 0.4);
      transition: box-shadow 0.3s, transform 0.3s;

      &:hover {
        box-shadow:
          0 6px 24px rgba(245, 158, 11, 0.4),
          0 2px 8px rgba(0, 0, 0, 0.5);
        transform: scale(1.05);
      }

      @media (max-width: 599px) {
        flex: 0 0 auto;
      }
    }

    // ======== Chat Window ========
    .chat-window {
      pointer-events: auto;
      position: relative;
      width: 440px;
      max-width: calc(100vw - 32px);
      height: 650px;
      max-height: calc(100dvh - 80px);
      background-color: var(--ed-surface, #0a0a0a);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 28px;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.5),
        0 4px 8px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: windowSlideUp 0.3s cubic-bezier(0.2, 0, 0, 1);

      &.minimized {
        height: auto;
      }

      &.cta-mode:not(.embedded) {
        width: 424px;
        height: auto;
        max-height: calc(100dvh - 80px);
        background: transparent;
        border: 0;
        border-radius: 8px;
        box-shadow: none;
        overflow: visible;
      }

      &.cta-mode:not(.embedded) app-chat-cta-panel {
        display: block;
        border-radius: 8px;
        box-shadow: 0 18px 46px rgba(0, 0, 0, 0.32);
      }

      // Embedded: без попапа, заполняет контейнер
      &.embedded {
        position: static;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100%;
        border-radius: 0;
        box-shadow: none;
        animation: none;
        flex: 1;
        min-height: 0;
      }
    }

    @media (max-width: 599px) {
      .chat-window:not(.embedded) {
        position: fixed;
        inset: 0;
        width: 100%;
        max-width: 100%;
        height: 100%;
        max-height: 100%;
        border-radius: 0;

        // Popup fullscreen (no bottom-nav) → safe-area on chat-input
        .chat-input {
          padding-bottom: calc(6px + env(safe-area-inset-bottom, 0px));
        }
      }

      .chat-window.cta-mode:not(.embedded) {
        inset: auto 12px calc(72px + env(safe-area-inset-bottom, 0px)) 12px;
        width: auto;
        max-width: none;
        height: auto;
        max-height: calc(100dvh - 96px);
        border-radius: 8px;
      }
    }

    @keyframes windowSlideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @keyframes windowSlideDown {
      from { opacity: 1; transform: translateY(0); }
      to { opacity: 0; transform: translateY(20px); }
    }

    .chat-window.closing {
      animation: windowSlideDown 0.25s cubic-bezier(0.4, 0, 1, 1) forwards;
    }

    // ======== Header ========
    .chat-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 8px 12px 16px;
      background: var(--ed-surface-container-high, #1e1e1e);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      color: var(--ed-on-surface, #f5f5f5);
      flex-shrink: 0;
    }

    .header-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: contain;
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid rgba(245, 158, 11, 0.25);
      padding: 7px;
      box-sizing: border-box;
      flex-shrink: 0;
    }

    .header-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .header-title {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .header-status {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 12px;
      opacity: 0.9;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
      flex-shrink: 0;
    }

    .typing-dots {
      display: inline-flex;
      gap: 2px;

      span {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        animation: dotPulse 1.4s infinite;

        &:nth-child(2) { animation-delay: 0.2s; }
        &:nth-child(3) { animation-delay: 0.4s; }
      }
    }

    @keyframes dotPulse {
      0%, 60%, 100% { opacity: 0.3; }
      30% { opacity: 1; }
    }

    .header-actions {
      display: flex;
      gap: 2px;

      button { color: inherit; }
    }

    // ======== Session Expired Banner ========
    .session-expired-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background-color: var(--ed-error-container, #7f1d1d);
      color: var(--ed-on-error-container, #fee2e2);
      flex-shrink: 0;

      mat-icon { flex-shrink: 0; }
    }

    .session-expired-text {
      flex: 1;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      line-height: 1.35;
    }

    .session-expired-btn {
      flex-shrink: 0;
      color: inherit;
    }

    .session-closed-banner {
      background-color: var(--ed-primary-container, #1e3a8a);
      color: var(--ed-on-primary-container, #dbeafe);
    }

    // ======== Order Context ========
    .order-context {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background-color: var(--ed-accent-container, #451a03);
      color: var(--ed-on-accent-container, #fef3c7);
      flex-shrink: 0;

      mat-icon { flex-shrink: 0; }
    }

    .order-info {
      flex: 1;
      display: flex;
      flex-direction: column;

      strong {
        font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
        font-size: 0.875rem;
        font-weight: 600;
      }

      span {
        font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
        font-size: 0.8125rem;
      }
    }

    // ======== Tabs ========
    .chat-tabs {
      display: flex;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      background-color: var(--ed-surface-container, #1a1a1a);
      flex-shrink: 0;
    }

    .tab-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px;
      border: none;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.875rem; font-weight: 500;
      cursor: pointer;
      position: relative;
      transition: color 0.2s;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &.active {
        color: var(--ed-accent, #f59e0b);

        &::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 16px;
          right: 16px;
          height: 3px;
          border-radius: 3px 3px 0 0;
          background-color: var(--ed-accent, #f59e0b);
        }
      }
    }

    // ======== Gallery ========
    .chat-gallery {
      flex: 1;
      overflow: hidden;
      display: flex;

      app-photo-gallery-panel {
        flex: 1;
        display: flex;
      }
    }

    // ======== Messages ========
    .chat-messages {
      flex: 1;
      min-height: 0;
      background-color: var(--ed-surface, #0a0a0a);
    }

    // CDK virtual scroll content wrapper, flex column with gap for messages
    :host ::ng-deep .chat-messages .cdk-virtual-scroll-content-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
    }

    .chat-messages-loading {
      flex: 1;
      display: flex;
      background-color: var(--ed-surface, #0a0a0a);
    }

    .state-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.875rem;
    }

    .welcome-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 24px 16px;
      text-align: center;
      gap: 8px;
      background-color: var(--ed-surface, #0a0a0a);
    }
    .welcome-icon img { width: 48px; height: 48px; border-radius: 50%; }
    .welcome-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--ed-on-surface, #fff);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
    }
    .welcome-subtitle {
      font-size: 14px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
    }
    .welcome-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: center;
      margin-top: 12px;
    }
    .welcome-chip {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #333);
      border-radius: 18px;
      padding: 8px 16px;
      font-size: 13px;
      color: var(--ed-on-surface, #fff);
      cursor: pointer;
      transition: background 0.2s;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
    }
    .welcome-chip:hover { background: var(--ed-surface-container-high, #2a2a2a); }

    // ======== Date Separator ========
    .message-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: messageFadeIn 200ms ease-out;
    }

    @keyframes messageFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .date-separator {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px 0;
      align-self: stretch;
      max-width: 100%;

      span {
        font-size: 12px;
        font-weight: 500;
        color: var(--ed-on-surface-variant, #a0a0a0);
        background: var(--ed-surface-container, #1a1a1a);
        padding: 4px 12px;
        border-radius: 12px;
      }
    }

    // ======== Message ========
    .message {
      display: flex;
      gap: 8px;
      max-width: 85%;
      position: relative;

      &.visitor {
        align-self: flex-end;
        flex-direction: row-reverse;

        .message-bubble {
          background-color: var(--ed-accent-container, #451a03);
          color: var(--ed-on-accent-container, #fef3c7);
          border-radius:
            16px
            16px
            8px
            16px;
        }

        .message-time { text-align: right; }
      }

      &.studio {
        align-self: flex-start;

        .message-bubble {
          background-color: var(--ed-surface-container-high, #1e1e1e);
          color: var(--ed-on-surface, #f5f5f5);
          border-radius:
            16px
            16px
            16px
            8px;
        }
      }
    }

    .message-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      overflow: hidden;
      flex-shrink: 0;
      background: var(--ed-surface-container-high, #1e1e1e);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      display: flex;
      align-items: center;
      justify-content: center;

      img {
        width: 24px;
        height: 24px;
        object-fit: contain;
      }
    }

    .message-content {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .message-sender {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.75rem; font-weight: 500;
      color: var(--ed-accent, #f59e0b);
      padding-left: 4px;
    }

    .message-bubble {
      padding: 10px 14px;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;

      &.caption {
        margin-top: 4px;
        padding: 8px 12px;
        font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.8125rem;
      }
    }

    :host ::ng-deep .message-bubble a {
      color: inherit;
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 2px;
      overflow-wrap: anywhere;
    }

    :host ::ng-deep .message.studio .message-bubble a {
      color: var(--ed-accent, #f59e0b);
    }

    .message-time {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.75rem; font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
      padding-left: 4px;
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }

    .delivery-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      line-height: 14px;
      vertical-align: middle;

      &.pending, &.sending { color: #a0a0a0; }
      &.sent { color: #a0a0a0; }
      &.delivered { color: #a0a0a0; }
      &.read { color: #3b82f6; }
      &.failed { color: #f44336; cursor: pointer; }
    }

    .retry-btn {
      background: none;
      border: none;
      padding: 0;
      margin: 0;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
    }

    // ======== Message Image ========
    .message-image {
      position: relative;
      max-width: 220px;
      border-radius: 16px;
      overflow: hidden;
      cursor: pointer;

      img {
        width: 100%;
        height: auto;
        display: block;
      }

      .image-overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.2s;

        mat-icon {
          color: white;
          font-size: 28px;
          width: 28px;
          height: 28px;
        }
      }

      &:hover .image-overlay { opacity: 1; }
    }

    .media-skeleton {
      width: 220px;
      height: 165px;
      border-radius: 16px;
      background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
      background-size: 200% 100%;
      animation: shimmerSkeleton 1.8s infinite;
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
        opacity: 0.3;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    @keyframes shimmerSkeleton {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .media-loaded {
      animation: mediaFadeIn 200ms ease;
    }

    @keyframes mediaFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .upload-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.5);
      border-radius: 16px;
      z-index: 2;

      mat-progress-spinner {
        --mdc-circular-progress-active-indicator-color: #fff;
      }
    }

    .message-image:has(.upload-overlay) .image-overlay {
      display: none;
    }

    .message-gallery {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      max-width: 240px;
    }

    .gallery-thumb {
      border: 0;
      padding: 0;
      border-radius: 10px;
      overflow: hidden;
      cursor: pointer;
      background: rgba(255, 255, 255, 0.06);

      img {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        display: block;
      }
    }

    // ======== Message PDF ========
    .message-pdf {
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      margin: 4px 0;

      .pdf-frame {
        width: 100%;
        height: 200px;
        border: none;
        display: block;
        background: white;
      }

      .pdf-link {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px;
        font-size: 12px;
        color: var(--ed-primary, #667eea);
        text-decoration: none;
        background: var(--ed-surface-container, #1a1a1a);

        mat-icon { font-size: 14px; width: 14px; height: 14px; }
        &:hover { text-decoration: underline; }
      }
    }

    // ======== Message File ========
    .message-file {
      a {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 12px;
        background: var(--ed-surface-container, #1a1a1a);
        color: var(--ed-accent, #f59e0b);
        text-decoration: none;
        font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.875rem;
        transition: background 0.2s;

        &:hover {
          background: var(--ed-surface-container-high, #1e1e1e);
        }

        mat-icon {
          font-size: 20px;
          width: 20px;
          height: 20px;
        }

        span {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    }

    // ======== Message Video ========
    .message-video {
      position: relative;
      max-width: 260px;
      border-radius: 16px;
      overflow: hidden;

      video {
        width: 100%;
        height: auto;
        display: block;
        background: var(--ed-surface-container, #1a1a1a);
      }
    }

    // ======== Message Audio ========
    .message-audio {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--ed-surface-container, #1a1a1a);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--ed-accent, #f59e0b);
        flex-shrink: 0;
      }

      audio {
        flex: 1;
        height: 36px;
        min-width: 0;
      }
    }

    // ======== Approval Gallery Card ========
    .approval-gallery-card {
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 12px;
      border: 1px solid var(--ed-outline-variant, rgba(255,255,255,.08));
      overflow: hidden;
    }
    .ag-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: rgba(245,158,11,.08);
      font-size: 13px;
      font-weight: 500;
      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-accent, #f59e0b);
      }
    }
    .ag-thumbs {
      display: flex;
      gap: 4px;
      padding: 10px 12px 4px;
      img {
        width: 52px;
        height: 52px;
        object-fit: cover;
        border-radius: 6px;
        border: 1px solid var(--ed-outline-variant, rgba(255,255,255,.08));
      }
    }
    .ag-more {
      width: 52px;
      height: 52px;
      border-radius: 6px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, rgba(255,255,255,.08));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 600;
      color: var(--ed-text-secondary, #aaa);
    }
    .ag-info {
      padding: 4px 12px;
      font-size: 12px;
      color: var(--ed-text-secondary, #aaa);
    }
    .ag-link {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      margin: 4px 10px 10px;
      border-radius: 8px;
      background: var(--ed-accent, #f59e0b);
      color: #000;
      font-size: 13px;
      font-weight: 500;
      text-decoration: none;
      justify-content: center;
      transition: opacity .15s;
      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      &:hover { opacity: .85; }
    }

    // ======== Typing Indicator ========
    .typing-indicator {
      display: flex;
      gap: 4px;
      padding: 12px 16px;

      span {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background-color: var(--ed-accent, #f59e0b);
        animation: typingBounce 1.4s infinite;

        &:nth-child(2) { animation-delay: 0.2s; }
        &:nth-child(3) { animation-delay: 0.4s; }
      }
    }

    @keyframes typingBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-5px); }
    }

    // ======== Drop Zone ========
    .photo-drop-zone {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px;
      margin: 0 12px 8px;
      border: 2px dashed var(--ed-outline-variant, #2a2a2a);
      border-radius: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif); font-size: 0.8125rem;

      &.drag-over {
        display: flex;
        border-color: var(--ed-accent, #f59e0b);
        background-color: var(--ed-accent-container, #451a03);
        color: var(--ed-on-accent-container, #fef3c7);
      }
    }

    // ======== Upload Progress ========
    .upload-progress {
      padding: 6px 12px;
      background: var(--ed-surface-container, #1a1a1a);
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }
    .upload-progress-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 4px;
    }
    .upload-progress-text { font-size: 11px; color: var(--ed-on-surface-variant, #a0a0a0); }
    .upload-cancel-btn {
      background: none;
      border: none;
      padding: 2px;
      cursor: pointer;
      color: var(--ed-on-surface-variant, #a0a0a0);
      display: inline-flex;
      align-items: center;
      border-radius: 50%;
      transition: background 0.2s;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { background: rgba(255, 255, 255, 0.1); }
    }

    // ======== Upload Error ========
    .upload-error {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px 12px;
      background: #3b1515;
      border-top: 1px solid #7f2020;
      color: #ff6b6b;
      font-size: 13px;
      animation: fadeIn 150ms ease;
      mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; }
      span { flex: 1; min-width: 0; }
    }
    .retry-upload-btn {
      margin-left: auto;
      background: rgba(255, 107, 107, 0.15);
      color: #ff6b6b;
      border: 1px solid rgba(255, 107, 107, 0.3);
      border-radius: 8px;
      padding: 6px 14px;
      min-height: 36px;
      font-size: 13px;
      cursor: pointer;
      white-space: nowrap;
      -webkit-tap-highlight-color: transparent;
      &:hover { background: rgba(255, 107, 107, 0.25); }
      &:active { background: rgba(255, 107, 107, 0.35); }
    }
    .dismiss-upload-btn {
      background: none;
      border: none;
      color: #ff6b6b;
      cursor: pointer;
      padding: 8px;
      min-width: 36px;
      min-height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
      &:active { background: rgba(255, 107, 107, 0.15); }
    }
    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

    // ======== Input ========
    .chat-input {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      background-color: var(--ed-surface, #0a0a0a);
      flex-shrink: 0;
    }

    .attach-btn {
      color: var(--ed-on-surface-variant, #a0a0a0);
      flex-shrink: 0;
    }

    .message-input {
      flex: 1;
      padding: 10px 16px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 28px;
      background-color: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;

      &:focus {
        border-color: var(--ed-accent, #f59e0b);
      }

      &::placeholder {
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .send-active {
      color: var(--ed-accent, #f59e0b) !important;
    }

    .inline-cards {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
      max-width: 320px;
    }

    .chat-card {
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 10px;
      background: rgba(255, 255, 255, 0.03);
    }

    .chat-card-header {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 8px;
    }

    .chat-card-header mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--ed-accent, #f59e0b);
    }

    .chat-card-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
      line-height: 1.3;
    }

    .chat-card-subtitle {
      margin-top: 2px;
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.3;
    }

    .chat-card-items {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 8px 0;
    }

    .chat-card-item {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .chat-card-item strong {
      color: var(--ed-on-surface, #f5f5f5);
      font-weight: 600;
      text-align: right;
    }

    .chat-card-price {
      margin-top: 4px;
      font-size: 14px;
      font-weight: 700;
      color: #22c55e;
    }

    .chat-card-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .chat-card-btn {
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 999px;
      background: transparent;
      color: var(--ed-on-surface, #f5f5f5);
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
    }

    .chat-card--payment {
      border-left: 3px solid #22c55e;
      background: linear-gradient(135deg, rgba(34,197,94,0.08), transparent);
    }

    .chat-card--paid {
      border-left-color: #22c55e;
      border-color: rgba(34, 197, 94, 0.3);
      opacity: 0.85;
      transition: all 0.3s ease;
    }

    .chat-card-paid-badge {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(34, 197, 94, 0.15);
      color: #22c55e;
      font-size: 12px;
      font-weight: 600;
      width: fit-content;
    }

    .chat-card-paid-badge mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      animation: bounce 0.5s ease;
    }

    @keyframes bounce {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.2); }
    }

    .chat-card-actions,
    .chat-card-paid-badge {
      transition: opacity 0.3s ease;
    }

    .chat-card-trust {
      font-size: 11px;
      color: #9ca3af;
      text-align: center;
      margin-top: 4px;
    }

    .chat-card-btn.payment {
      position: relative;
      overflow: hidden;
      background: linear-gradient(90deg, #22c55e 0%, #4ade80 50%, #22c55e 100%);
      background-size: 200% 100%;
      animation: shimmer-bg 2.5s ease infinite;
      color: white;
      border: none;
      font-weight: 600;
    }

    .chat-card-btn.payment::after {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
      animation: shimmer 2s infinite;
    }

    @keyframes shimmer {
      to { left: 100%; }
    }

    @keyframes shimmer-bg {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }

    .inline-quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
      max-height: 72px;
      overflow: hidden;
      animation: quickRepliesFadeIn 0.2s ease;
    }

    .quick-reply-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 14px;
      min-height: 32px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 18px;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: all 0.2s ease;

      &:hover {
        background: rgba(245, 158, 11, 0.1);
        border-color: rgba(245, 158, 11, 0.35);
        color: #f59e0b;
      }

      &.payment {
        border-color: rgba(34, 197, 94, 0.45);
        background: rgba(34, 197, 94, 0.12);
        color: #86efac;
      }
    }

    @keyframes quickRepliesFadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 400px) {
      .inline-quick-replies .quick-reply-chip:nth-child(n+6) {
        display: none;
      }
    }

    // ======== Reply Quote (inside message bubble) ========
    .reply-quote {
      display: flex;
      flex-direction: column;
      gap: 1px;
      padding: 4px 8px;
      margin-bottom: 4px;
      border-left: 2px solid var(--ed-accent, #f59e0b);
      border-radius: 2px;
      background: rgba(245, 158, 11, 0.08);
      cursor: pointer;
    }
    .reply-quote-sender {
      font-size: 11px;
      font-weight: 600;
      color: var(--ed-accent, #f59e0b);
    }
    .reply-quote-text {
      font-size: 12px;
      color: var(--ed-on-surface-variant, rgba(255,255,255,0.5));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 240px;
    }

    // ======== Forwarded Badge ========
    .forwarded-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      font-style: italic;
      color: var(--ed-on-surface-variant, rgba(255,255,255,0.4));
      margin-bottom: 4px;
      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    // ======== Reply Preview Bar (above input) ========
    .reply-preview {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-left: 2px solid var(--ed-accent, #f59e0b);
      background: rgba(245, 158, 11, 0.06);
      flex-shrink: 0;
      animation: fadeIn 150ms ease;
    }
    .reply-preview-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .reply-preview-sender {
      font-size: 12px;
      font-weight: 600;
      color: var(--ed-accent, #f59e0b);
    }
    .reply-preview-text {
      font-size: 12px;
      color: var(--ed-on-surface-variant, rgba(255,255,255,0.5));
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .reply-preview-close {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--ed-on-surface-variant, rgba(255,255,255,0.4));
      padding: 4px;
      flex-shrink: 0;
      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    // ======== Message Actions (reply + delete, on hover) ========
    .message-actions {
      display: none;
      position: absolute;
      top: 4px;
      gap: 4px;
    }
    .action-btn {
      background: var(--ed-surface-container-high, #1e1e1e);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 50%;
      width: 28px;
      height: 28px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition: background 0.15s, color 0.15s;
      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
      &:hover {
        background: rgba(245, 158, 11, 0.1);
        color: var(--ed-accent, #f59e0b);
      }
    }
    .delete-btn:hover {
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
    }
    .message.visitor .message-actions { left: -64px; }
    .message.studio .message-actions { right: -64px; }
    .message:hover .message-actions { display: flex; }

    // ======== Highlight animation (scroll to quoted message) ========
    .message.highlight-message {
      animation: highlightPulse 1.5s ease;
    }
    @keyframes highlightPulse {
      0% { background: rgba(245, 158, 11, 0.2); }
      100% { background: transparent; }
    }

    // ======== Scroll-to-bottom FAB ========
    .scroll-fab {
      position: absolute;
      bottom: 72px;
      right: 16px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container-high, #1e1e1e);
      color: var(--ed-on-surface, #f5f5f5);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
      z-index: 10;
      animation: fabFadeIn 0.2s ease;
      transition: background 0.15s;

      mat-icon {
        font-size: 22px;
        width: 22px;
        height: 22px;
      }

      &:hover {
        background: var(--ed-surface-container, #2a2a2a);
      }
    }

    .scroll-fab-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: #f59e0b;
      color: #000;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    @keyframes fabFadeIn {
      from { opacity: 0; transform: scale(0.8) translateY(8px); }
      to { opacity: 1; transform: scale(1) translateY(0); }
    }

    // ======== Emoji Button ========
    .emoji-btn-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .emoji-btn {
      color: var(--ed-on-surface-variant, #a0a0a0);
      &:hover { color: var(--ed-accent, #f59e0b); }
    }

    // ======== Search Overlay ========
    .search-overlay {
      background: var(--ed-surface-container-high, #1e1e1e);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      padding: 8px 12px;
      flex-shrink: 0;
      animation: searchSlideDown 200ms ease;
    }
    @keyframes searchSlideDown {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .search-input-row {
      display: flex;
      align-items: center;
      gap: 6px;
      mat-icon:first-child {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        flex-shrink: 0;
      }
    }
    .search-input {
      flex: 1;
      background: none;
      border: none;
      outline: none;
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 14px;
      min-width: 0;
      &::placeholder { color: var(--ed-on-surface-variant, #a0a0a0); }
    }
    .search-count {
      font-size: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      white-space: nowrap;
      flex-shrink: 0;
    }

    // ======== Alfa-like popup redesign ========
    .chat-fab--close {
      margin-top: 18px;
      margin-left: auto;
      --mat-fab-container-color: #20242a;
      --mat-fab-foreground-color: #ffffff;
      box-shadow: 0 12px 34px rgba(15, 23, 42, 0.28);
    }

    .chat-window:not(.embedded) {
      width: 400px;
      max-width: calc(100vw - 32px);
      height: 616px;
      max-height: calc(100dvh - 116px);
      overflow: hidden;
      border: 0;
      border-radius: 22px;
      background: #f1f2f4;
      color: #20242a;
      font-family: Inter, "Plus Jakarta Sans", system-ui, sans-serif;
      box-shadow: 0 22px 70px rgba(15, 23, 42, 0.26);
    }

    .bank-chat-home {
      position: relative;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      background: #f1f2f4;
    }

    .bank-drag-handle {
      position: absolute;
      top: 8px;
      left: 10px;
      display: grid;
      gap: 3px;
      width: 20px;
      transform: rotate(-45deg);
    }

    .bank-drag-handle i {
      display: block;
      height: 2px;
      border-radius: 2px;
      background: #c9ced6;
    }

    .bank-home-content {
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 28px;
      height: 100%;
      padding: 34px 20px 20px;
    }

    .bank-home-content h2 {
      margin: 0;
      color: #20242a;
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 0;
    }

    .bank-quick-actions {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .bank-action {
      display: grid;
      justify-items: center;
      gap: 8px;
      min-width: 0;
      border: 0;
      background: transparent;
      color: #20242a;
      cursor: pointer;
      font: inherit;
    }

    .bank-action span {
      display: grid;
      width: 48px;
      height: 48px;
      place-items: center;
      border-radius: 14px;
      background: #ffffff;
      color: #20242a;
    }

    .bank-action strong {
      max-width: 100%;
      overflow: hidden;
      color: #3b3f46;
      font-size: 12px;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bank-chat-list-card {
      display: grid;
      align-content: start;
      gap: 18px;
      min-height: 0;
      padding: 28px 20px 22px;
      overflow-y: auto;
      border-radius: 22px;
      background: #ffffff;
    }

    .bank-chat-list-card h3 {
      margin: 0;
      color: #20242a;
      font-size: 20px;
      font-weight: 900;
    }

    .bank-chat-row {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      grid-template-areas:
        "icon body time"
        "icon body pin";
      gap: 0 12px;
      align-items: start;
      width: 100%;
      border: 0;
      background: transparent;
      color: #20242a;
      cursor: pointer;
      font: inherit;
      text-align: left;
    }

    .bank-chat-row__icon {
      grid-area: icon;
      display: grid;
      width: 48px;
      height: 48px;
      place-items: center;
      border-radius: 14px;
      background: #eef0f4;
      color: #20242a;
    }

    .bank-chat-row__body {
      grid-area: body;
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .bank-chat-row__body strong,
    .bank-chat-row__body small {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .bank-chat-row__body strong {
      color: #20242a;
      font-size: 15px;
      font-weight: 800;
      white-space: nowrap;
    }

    .bank-chat-row__body em {
      color: #7b828e;
      font-size: 12px;
      font-style: normal;
      font-weight: 700;
    }

    .bank-chat-row__body small {
      display: -webkit-box;
      color: #3b3f46;
      font-size: 13px;
      line-height: 1.35;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .bank-chat-row time {
      grid-area: time;
      color: #858b96;
      font-size: 12px;
      white-space: nowrap;
    }

    .bank-chat-row__pin {
      grid-area: pin;
      justify-self: end;
      color: #858b96;
      font-size: 18px;
      width: 18px;
      height: 18px;
      transform: rotate(35deg);
    }

    .messenger-strip {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      padding-top: 8px;
      border-top: 1px solid #edf0f3;
    }

    .messenger-chip {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 8px;
      align-items: center;
      min-height: 42px;
      padding: 0 12px;
      border-radius: 12px;
      color: #ffffff;
      font-size: 13px;
      font-weight: 800;
      text-decoration: none;
    }

    .messenger-chip__icon {
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: #ffffff;
    }

    .messenger-chip__text {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .messenger-chip__text > span,
    .messenger-chip__text small {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .messenger-chip__text small {
      font-size: 10px;
      font-weight: 800;
      line-height: 1.1;
      opacity: 0.92;
    }

    .messenger-chip mat-icon {
      width: 18px;
      height: 18px;
    }

    .messenger-chip--max { background: #168de2; }
    .messenger-chip--telegram { background: #26a5e4; }
    .messenger-chip--whatsapp { background: #25d366; }
    .messenger-chip--vk { background: #0077ff; }
    .messenger-chip--notice { background: #ef3124; }

    .bank-chat-thread-header {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) 48px;
      gap: 8px;
      align-items: center;
      flex-shrink: 0;
      min-height: 72px;
      padding: 10px 16px;
      background: #ffffff;
      border-bottom: 1px solid #dfe3e8;
      color: #20242a;
    }

    .bank-header-icon {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: #eef0f4;
      color: #737985;
      cursor: pointer;
    }

    .bank-header-icon:hover,
    .bank-header-icon:focus-visible {
      background: #e3e6eb;
      color: #20242a;
    }

    .bank-thread-title {
      display: grid;
      justify-items: center;
      gap: 2px;
      min-width: 0;
      text-align: center;
    }

    .bank-thread-title strong {
      max-width: 100%;
      overflow: hidden;
      color: #20242a;
      font-size: 16px;
      font-weight: 900;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .bank-thread-title span {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: #7b828e;
      font-size: 12px;
      font-weight: 700;
    }

    .bank-thread-title mat-icon {
      width: 14px;
      height: 14px;
      color: #20c26b;
      font-size: 14px;
    }

    .chat-window:not(.embedded) .search-overlay,
    .chat-window:not(.embedded) .chat-input,
    .chat-window:not(.embedded) .reply-preview,
    .chat-window:not(.embedded) .session-expired-banner,
    .chat-window:not(.embedded) .chat-tabs,
    .chat-window:not(.embedded) .order-context {
      background: #ffffff;
      color: #20242a;
      border-color: #dfe3e8;
    }

    .chat-window:not(.embedded) .search-input {
      color: #20242a;
    }

    .chat-window:not(.embedded) .search-input::placeholder {
      color: #858b96;
    }

    .chat-window:not(.embedded) .chat-messages,
    .chat-window:not(.embedded) .chat-messages-loading,
    .chat-window:not(.embedded) .welcome-block,
    .chat-window:not(.embedded) .chat-gallery {
      background: #ffffff;
      color: #20242a;
    }

    :host ::ng-deep .chat-window:not(.embedded) .chat-messages .cdk-virtual-scroll-content-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 18px;
    }

    .chat-window:not(.embedded) .welcome-icon,
    .chat-window:not(.embedded) .message-avatar {
      background: #20242a;
      border-color: #20242a;
    }

    .chat-window:not(.embedded) .welcome-title,
    .chat-window:not(.embedded) .message-sender {
      color: #20242a;
    }

    .chat-window:not(.embedded) .welcome-subtitle,
    .chat-window:not(.embedded) .message-time,
    .chat-window:not(.embedded) .forwarded-badge,
    .chat-window:not(.embedded) .reply-preview-text,
    .chat-window:not(.embedded) .reply-quote-text {
      color: #737985;
    }

    .chat-window:not(.embedded) .welcome-chip,
    .chat-window:not(.embedded) .quick-reply-chip {
      border-color: #dfe3e8;
      background: #f1f2f4;
      color: #20242a;
    }

    .chat-window:not(.embedded) .message.studio .message-bubble,
    .chat-window:not(.embedded) .approval-gallery-card,
    .chat-window:not(.embedded) .chat-card {
      border: 1px solid #dfe3e8;
      background: #ffffff;
      color: #20242a;
      box-shadow: none;
    }

    .chat-window:not(.embedded) .message.visitor .message-bubble {
      background: #edf0f4;
      color: #20242a;
    }

    .chat-window:not(.embedded) .message-bubble,
    .chat-window:not(.embedded) .message.studio .message-bubble {
      border-radius: 18px 18px 18px 8px;
    }

    .chat-window:not(.embedded) .message.visitor .message-bubble {
      border-radius: 18px 18px 8px 18px;
    }

    .chat-window:not(.embedded) .message-file a,
    .chat-window:not(.embedded) .message-audio,
    .chat-window:not(.embedded) .reply-quote {
      background: #f1f2f4;
      color: #20242a;
      border-color: #dfe3e8;
    }

    .chat-window:not(.embedded) .chat-input {
      gap: 8px;
      padding: 12px 14px 14px;
      border-top: 1px solid #dfe3e8;
    }

    .chat-window:not(.embedded) .emoji-btn-wrap {
      display: none;
    }

    .chat-window:not(.embedded) .attach-btn,
    .chat-window:not(.embedded) .chat-input button:not(.attach-btn) {
      color: #737985;
    }

    .chat-window:not(.embedded) .message-input {
      height: 48px;
      padding: 0 12px;
      border: 1.5px solid #9298a1;
      border-radius: 10px;
      background: #ffffff;
      color: #20242a;
      font-size: 15px;
    }

    .chat-window:not(.embedded) .message-input::placeholder {
      color: #9aa0aa;
    }

    .chat-window:not(.embedded) .send-active {
      color: #ef3124 !important;
    }

    .chat-window:not(.embedded) .scroll-fab {
      border-color: #dfe3e8;
      background: #ffffff;
      color: #20242a;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.18);
    }

    .chat-window.embedded {
      background: #ffffff;
      border: 0;
      color: #20242a;
      font-family: Inter, "Plus Jakarta Sans", system-ui, sans-serif;
    }

    .chat-window.embedded .search-overlay,
    .chat-window.embedded .chat-input,
    .chat-window.embedded .reply-preview,
    .chat-window.embedded .session-expired-banner,
    .chat-window.embedded .chat-tabs,
    .chat-window.embedded .order-context {
      background: #ffffff;
      color: #20242a;
      border-color: #dfe3e8;
    }

    .chat-window.embedded .search-input {
      color: #20242a;
    }

    .chat-window.embedded .search-input::placeholder {
      color: #858b96;
    }

    .chat-window.embedded .chat-messages,
    .chat-window.embedded .chat-messages-loading,
    .chat-window.embedded .welcome-block,
    .chat-window.embedded .chat-gallery {
      background: #ffffff;
      color: #20242a;
    }

    :host ::ng-deep .chat-window.embedded .chat-messages .cdk-virtual-scroll-content-wrapper {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 18px;
    }

    .chat-window.embedded .date-separator span {
      background: #f1f2f4;
      color: #737985;
    }

    .chat-window.embedded .welcome-icon,
    .chat-window.embedded .message-avatar {
      background: #20242a;
      border-color: #20242a;
    }

    .chat-window.embedded .welcome-title,
    .chat-window.embedded .message-sender,
    .chat-window.embedded .chat-card-title,
    .chat-window.embedded .chat-card-item strong {
      color: #20242a;
    }

    .chat-window.embedded .welcome-subtitle,
    .chat-window.embedded .message-time,
    .chat-window.embedded .forwarded-badge,
    .chat-window.embedded .reply-preview-text,
    .chat-window.embedded .reply-quote-text,
    .chat-window.embedded .chat-card-subtitle,
    .chat-window.embedded .chat-card-item,
    .chat-window.embedded .chat-card-trust {
      color: #737985;
    }

    .chat-window.embedded .welcome-chip,
    .chat-window.embedded .quick-reply-chip {
      border-color: #dfe3e8;
      background: #f7f8fa;
      color: #20242a;
    }

    .chat-window.embedded .welcome-chip:hover,
    .chat-window.embedded .quick-reply-chip:hover {
      border-color: #ef3124;
      background: #fff4f2;
      color: #ef3124;
    }

    .chat-window.embedded .message.studio .message-bubble,
    .chat-window.embedded .approval-gallery-card,
    .chat-window.embedded .chat-card {
      border: 1px solid #dfe3e8;
      background: #ffffff;
      color: #20242a;
      box-shadow: none;
    }

    .chat-window.embedded .message.visitor .message-bubble {
      background: #ef3124;
      color: #ffffff;
    }

    .chat-window.embedded .message {
      max-width: 88%;
      gap: 7px;
    }

    .chat-window.embedded .message-avatar {
      width: 30px;
      height: 30px;
    }

    .chat-window.embedded .message-avatar img {
      width: 22px;
      height: 22px;
    }

    .chat-window.embedded .message-bubble,
    .chat-window.embedded .message.studio .message-bubble {
      border-radius: 18px 18px 18px 8px;
      padding: 11px 14px;
      font-size: 15px;
      line-height: 1.45;
    }

    .chat-window.embedded .message.visitor .message-bubble {
      border-radius: 18px 18px 8px 18px;
    }

    .chat-window.embedded .message-sender {
      font-size: 12px;
    }

    .chat-window.embedded .message-time {
      font-size: 12px;
    }

    .chat-window.embedded .message-file a,
    .chat-window.embedded .message-audio,
    .chat-window.embedded .reply-quote,
    .chat-window.embedded .action-btn {
      background: #f1f2f4;
      color: #20242a;
      border-color: #dfe3e8;
    }

    .chat-window.embedded .photo-drop-zone {
      border-color: #dfe3e8;
      color: #737985;
    }

    .chat-window.embedded .upload-progress,
    .chat-window.embedded .reply-preview {
      background: #f7f8fa;
      border-color: #dfe3e8;
    }

    .chat-window.embedded .chat-input {
      gap: 8px;
      padding: 12px 14px 14px;
      border-top: 1px solid #dfe3e8;
    }

    .chat-window.embedded .attach-btn,
    .chat-window.embedded .emoji-btn,
    .chat-window.embedded .chat-input button:not(.attach-btn):not(.emoji-btn) {
      color: #737985;
    }

    .chat-window.embedded .message-input {
      height: 48px;
      padding: 0 12px;
      border: 1.5px solid #9298a1;
      border-radius: 10px;
      background: #ffffff;
      color: #20242a;
      font-size: 15px;
    }

    .chat-window.embedded .message-input:focus {
      border-color: #ef3124;
    }

    .chat-window.embedded .message-input::placeholder {
      color: #9aa0aa;
    }

    .chat-window.embedded .send-active {
      color: #ef3124 !important;
    }

    .chat-window.embedded .scroll-fab {
      border-color: #dfe3e8;
      background: #ffffff;
      color: #20242a;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.18);
    }

    .chat-window.embedded .chat-card-btn {
      border-color: #dfe3e8;
      background: #ffffff;
      color: #20242a;
    }

    @media (max-width: 600px) {
      :host ::ng-deep .chat-window.embedded .chat-messages .cdk-virtual-scroll-content-wrapper {
        gap: 11px;
        padding: 14px 16px;
      }

      .chat-window.embedded .chat-input {
        gap: 7px;
        padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
      }

      .chat-window.embedded .message-input {
        height: 46px;
        font-size: 15px;
      }
    }

    .chat-window.embedded .chat-card-btn.payment {
      background: #20c26b;
      background-image: none;
      color: #ffffff;
      border: 0;
      animation: none;
    }

    .chat-window.embedded .chat-card-btn.payment::after {
      display: none;
    }

    // ======== Fullscreen Image Viewer ========
    .fs-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 150ms ease;
      cursor: pointer;
      touch-action: none;
    }

    .fs-close {
      position: absolute;
      top: max(12px, env(safe-area-inset-top, 12px));
      right: 12px;
      z-index: 10000;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(8px);
    }

    .fs-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      cursor: default;
      will-change: transform;
      transition: transform 0.1s ease;
      user-select: none;
      -webkit-user-drag: none;
    }
  `]
})
export class ChatWidgetComponent {
  protected safeSub(s: unknown, start: number, end?: number): string {
    return safeSubstring(s, start, end);
  }
  protected safeStarts(s: unknown, prefix: string): boolean {
    return safeStartsWith(s, prefix);
  }

  // Inputs
  orderContext = input<OrderContext | undefined>(undefined);
  autoOpen = input(false);
  /** @deprecated Use entryContext instead. Kept for backward compat. */
  channel = input<ChatChannel>('studio');
  /** Phase 2: entry context for channel unification */
  entryContext = input<EntryContext | undefined>(undefined);
  /** Встроенный режим: без FAB, без header, чат всегда открыт, заполняет контейнер */
  embedded = input(false);
  /** Скрыть галерею фото (для embedded в лендингах) */
  hideGallery = input(false);

  // Outputs
  chatOpened = output<void>();
  chatClosed = output<void>();

  // Services
  chatService = inject(AuthChatService);
  protected authService = inject(AuthService);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dialog = inject(MatDialog);
  private readonly sanitizerSvc = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly channelStatus = inject(ChannelStatusService);

  // State
  messageText = '';
  isMinimized = signal(false);
  isDragOver = signal(false);
  protected readonly chatPanelMode = signal<'home' | 'thread'>('home');
  protected readonly messengerLinks = computed<readonly MessengerLink[]>(() => [
    { label: 'МАКС', href: 'https://max.ru/id262603741214_bot', icon: 'channel-max', kind: 'max' },
    { label: 'Telegram', href: 'https://t.me/FmagnusBot', icon: 'channel-telegram', kind: 'telegram' },
    { label: 'WhatsApp', href: 'https://wa.me/+79014178668', icon: 'channel-whatsapp', kind: 'whatsapp', notice: this.channelStatus.whatsappNotice() },
    { label: 'VK', href: 'https://vk.com/im?sel=-68371131', icon: 'channel-vk', kind: 'vk' },
  ]);
  activeTab = signal<'chat' | 'photos'>('chat');
  readonly uploadError = signal<string | null>(null);
  readonly displayError = computed(() => this.uploadError() || this.chatService.uploadError());

  /** Order is paid when status transitions to processing/completed (legacy global) */
  readonly isOrderPaid = computed(() => {
    const status = this.chatService.orderStatus();
    return status === 'processing' || status === 'completed';
  });

  /** Per-card paid check, uses orderId from payment button data */
  isCardPaid(card: BotCard): boolean {
    if (!this.hasPaymentButton(card)) return false;
    const payBtn = card.buttons?.find(b => b.value === 'pay_online_widget' || b.value === 'pay_order');
    const orderId = payBtn?.data?.['orderId'];
    if (typeof orderId !== 'string' || !orderId) return this.isOrderPaid();
    return this.chatService.isOrderPaidById(orderId);
  }

  // Welcome, chips map to bot engine button values for interactive flow
  readonly welcomeChips = computed<{ label: string; value: string }[]>(() => {
    const ctx = this.entryContext();
    if (ctx?.category === 'photo-docs') {
      return [
        { label: 'Заказать онлайн', value: 'order_photo' },
        { label: 'Узнать цену', value: 'view_prices' },
        { label: 'Другие услуги', value: 'other_services' },
        { label: 'Задать вопрос', value: 'ask_question' },
      ];
    }
    return [
      { label: 'Фото на документы', value: 'order_photo' },
      { label: 'Печать фото', value: 'studio_print_photos' },
      { label: 'Другие услуги', value: 'other_services' },
      { label: 'Задать вопрос', value: 'ask_question' },
    ];
  });

  sendWelcomeChip(chip: { label: string; value: string }): void {
    this.openChat();
    this.openThread();
    const button: BotButton = { id: chip.value, label: chip.label, value: chip.value };
    setTimeout(() => this.chatService.sendButtonClick(button), 300);
  }

  // Emoji Picker
  showEmojiPicker = signal(false);
  recentEmojis = signal<string[]>([]);

  // Search
  searchOpen = signal(false);
  searchQuery = '';
  searchResults = signal<ChatMessage[]>([]);
  searchActiveIndex = signal(0);
  private _searchDebounce: ReturnType<typeof setTimeout> | null = null;

  // Reply
  replyingTo = signal<ChatMessage | null>(null);

  readonly messagesViewport = viewChild<CdkVirtualScrollViewport>('messagesViewport');
  readonly fileInputRef = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  private typingTimeout: ReturnType<typeof setTimeout> | null = null;

  // Scroll-to-bottom FAB
  readonly showScrollFab = signal(false);
  private _scrollCleanup: (() => void) | null = null;

  // Fullscreen image viewer
  readonly fullscreenImage = signal<string | null>(null);
  private _fsScale = 1;
  private _fsPanX = 0;
  private _fsPanY = 0;
  private _fsStartDistance = 0;
  private _fsStartScale = 1;
  private _fsTouchStartY = 0;
  private _fsTouchStartTime = 0;
  private _fsDismissY = 0;
  private _fsLastTap = 0;

  // Sound + vibration
  readonly soundEnabled = signal(false);
  private _audioCtx: AudioContext | null = null;
  private _audioCtxUnlocked = false;
  private _prevMessageCount = 0;

  // Image skeleton loader state
  private _imageLoaded = new Map<string, WritableSignal<boolean>>();

  imageLoaded(messageId: string): Signal<boolean> {
    let s = this._imageLoaded.get(messageId);
    if (!s) {
      s = signal(false);
      this._imageLoaded.set(messageId, s);
    }
    return s;
  }

  onImageLoad(messageId: string): void {
    let s = this._imageLoaded.get(messageId);
    if (!s) {
      s = signal(true);
      this._imageLoaded.set(messageId, s);
    } else {
      s.set(true);
    }
  }

  // Video skeleton loader state
  private _videoLoaded = new Map<string, WritableSignal<boolean>>();

  videoLoaded(messageId: string): Signal<boolean> {
    let s = this._videoLoaded.get(messageId);
    if (!s) {
      s = signal(false);
      this._videoLoaded.set(messageId, s);
    }
    return s;
  }

  onVideoLoad(messageId: string): void {
    let s = this._videoLoaded.get(messageId);
    if (!s) {
      s = signal(true);
      this._videoLoaded.set(messageId, s);
    } else {
      s.set(true);
    }
  }

  // Upload overlay helpers
  isUploading(messageId: string): boolean {
    return this.chatService.getFileUploadPercent(messageId) >= 0;
  }

  getUploadPercent(messageId: string): number {
    const pct = this.chatService.getFileUploadPercent(messageId);
    return pct >= 0 ? pct : 0;
  }

  // Close animation
  protected _closing = signal(false);

  // Memoization caches, invalidated via effect when messages signal changes
  private _galleryCache = new Map<string, string[]>();
  private _inlineCardsCache = new Map<string, BotCard[]>();
  private _quickRepliesCache = new Map<string, BotButton[]>();
  private _approvalGalleryCache = new Map<string, { photos: ApprovalGalleryPhoto[]; reviewUrl: string } | null>();
  private _formatCache = new Map<string, string>();

  /** Базовый набор quick-replies из последнего interactive-сообщения. */
  readonly inlineQuickReplyButtons = computed<BotButton[]>(() =>
    this.chatService.activeButtons()
      .filter(button => this.isVisibleToVisitor(button) && button.value !== 'send_photo')
      .slice(0, 8)
  );

  /** ID последнего сообщения, для quick replies (CDK last != last in data) */
  readonly lastMessageId = computed(() => {
    const msgs = this.chatService.messages();
    return msgs.length > 0 ? msgs[msgs.length - 1].id : '';
  });

  /** Set of message IDs that are the first in their date group */
  readonly dateGroupFirstIds = computed(() => {
    const msgs = this.chatService.messages();
    const result = new Map<string, string>();
    let lastDateKey = '';
    for (const msg of msgs) {
      const d = new Date(msg.created_at);
      const dateKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (dateKey !== lastDateKey) {
        result.set(msg.id, this.formatDateLabel(d));
        lastDateKey = dateKey;
      }
    }
    return result;
  });

  private formatDateLabel(date: Date): string {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = today.getTime() - msgDay.getTime();
    if (diff === 0) return 'Сегодня';
    if (diff === 86400000) return 'Вчера';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }

  /** trackBy для *cdkVirtualFor */
  trackById(_index: number, message: ChatMessage): string {
    return message.id;
  }

  constructor() {
    // Invalidate memoization caches when messages or active buttons change
    effect(() => {
      this.chatService.messages();
      this.chatService.activeButtons();
      this._galleryCache.clear();
      this._inlineCardsCache.clear();
      this._quickRepliesCache.clear();
      this._formatCache.clear();
      this._approvalGalleryCache.clear();
    });

    // Auth-state reactivity: авто-открытие чата после OAuth callback (?chat=1)
    effect(() => {
      const isAuth = this.authService.isAuthenticated();
      untracked(() => {
        if (!isPlatformBrowser(this.platformId)) return;
        const wantChat = this.route.snapshot.queryParamMap.get('chat') === '1';
        if (isAuth && wantChat && !this.chatService.isOpen()) {
          this.openChat();
          this.router.navigate([], {
            queryParams: { chat: null },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        }
      });
    });

    if (isPlatformBrowser(this.platformId)) {
      // Init sound preference from localStorage
      this.soundEnabled.set(localStorage.getItem('sf_chat_sound') === 'true');

      // Load recent emojis
      try {
        const stored = localStorage.getItem('sf_chat_recent_emojis');
        if (stored) this.recentEmojis.set(JSON.parse(stored));
      } catch { /* noop */ }

      afterNextRender(() => {
        if (this.embedded() || this.autoOpen()) {
          // Если ChatPageComponent уже инициировал чат (ensureChatOpen), не дублируем openChat
          if (!this.chatService.isOpen()) {
            this.openChat();
          } else {
            this.chatService.markAsRead();
            this.scrollToBottom();
          }
        }
        this._prevMessageCount = this.chatService.messages().length;
      });

      effect(() => {
        const viewport = this.messagesViewport();
        const messages = this.chatService.messages();
        const isOpen = this.chatService.isOpen();

        if (viewport && messages.length > 0 && (isOpen || this.embedded())) {
          this.scrollToBottom();
        }
      });

      // Scroll FAB: attach scroll listener when viewport becomes available
      effect(() => {
        const viewport = this.messagesViewport();
        this._scrollCleanup?.();
        this._scrollCleanup = null;
        if (!viewport) return;

        const el = viewport.elementRef.nativeElement;
        const onScroll = () => {
          const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          this.showScrollFab.set(distFromBottom > 240);
        };
        el.addEventListener('scroll', onScroll, { passive: true });
        this._scrollCleanup = () => el.removeEventListener('scroll', onScroll);
      });

      // Incoming message sound + vibration
      effect(() => {
        const messages = this.chatService.messages();
        const count = messages.length;
        if (count > this._prevMessageCount && this._prevMessageCount > 0) {
          const lastMsg = messages[count - 1];
          if (lastMsg.sender_type !== 'visitor') {
            this.playTink();
            navigator.vibrate?.(50);
          }
        }
        this._prevMessageCount = count;
      });
    }

    this.destroyRef.onDestroy(() => {
      this.chatService.cancelUpload();
    });
  }

  openChat(): void {
    const ctx = this.orderContext() || {} as Partial<OrderContext>;
    const channel: ChatChannel = ctx.channel || this.channel() || 'studio';
    const entryCtx: EntryContext = ctx.entryContext
      || this.entryContext()
      || (channel === 'online' ? { category: 'photo-docs', delivery: 'electronic' as const } : {});

    const ctxWithChannel: OrderContext = {
      service: ctx.service || '',
      price: ctx.price || 0,
      pageUrl: ctx.pageUrl || (typeof window !== 'undefined' ? window.location.href : ''),
      channel,
      entryContext: entryCtx,
    };
    this.chatService.openChat(ctxWithChannel);
    if (!this.embedded()) {
      this.chatPanelMode.set('home');
      this.searchOpen.set(false);
    }
    this.chatService.markAsRead();
    this.chatOpened.emit();
    this.scrollToBottom();
  }

  protected openThread(): void {
    this.chatPanelMode.set('thread');
    this.activeTab.set('chat');
    this.searchOpen.set(false);
    setTimeout(() => this.scrollToBottom(), 80);
  }

  protected showContactHome(): void {
    if (this.embedded()) return;
    this.chatPanelMode.set('home');
    this.searchOpen.set(false);
  }

  protected callStudio(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.location.href = 'tel:+78633226575';
  }

  closeChat(): void {
    this._closing.set(true);
    setTimeout(() => {
      this._closing.set(false);
      this.chatService.closeChat();
      this.chatPanelMode.set('home');
      this.chatClosed.emit();
    }, 250);
  }

  requestNotifications(): void {
    this.chatService.requestNotifications();
  }

  async openNotificationGuide(): Promise<void> {
    const { NotificationGuideDialogComponent } = await import(
      '../notification-guide-dialog/notification-guide-dialog.component'
    );
    this.dialog.open(NotificationGuideDialogComponent, {
      width: '480px',
      maxWidth: '95vw',
      data: { permission: this.chatService.notificationPermission() },
    });
  }

  disableNotifications(): void {
    this.chatService.unsubscribeFromPush();
  }

  reloadForNewSession(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.location.reload();
  }

  startFreshDialog(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    window.location.reload();
  }

  openInNewTab(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const sessionId = this.chatService.getSessionId();
    const url = sessionId ? `/chat?session=${sessionId}` : '/chat';
    window.open(url, '_blank');
  }

  triggerFileUpload(): void {
    if (!this.embedded()) {
      this.openThread();
    }
    this.activeTab.set('chat');
    setTimeout(() => {
      this.fileInputRef()?.nativeElement?.click();
    }, 50);
  }


  goToOnlineServices(): void {
    this.router.navigate(['/online-services']);
    this.closeChat();
  }

  toggleMinimize(): void {
    this.isMinimized.update(v => !v);
  }

  sendMessage(): void {
    if (!this.messageText.trim()) return;
    if (!this.embedded()) {
      this.openThread();
    }

    const reply = this.replyingTo();
    if (reply) {
      const replyToSender = reply.sender_name || (reply.sender_type === 'visitor' ? 'Вы' : 'Оператор');
      this.chatService.sendMessage(
        this.messageText.trim(),
        'text',
        undefined,
        reply.id,
        reply.content?.substring(0, 200),
        replyToSender,
      );
      this.replyingTo.set(null);
    } else {
      this.chatService.sendMessage(this.messageText.trim());
    }
    this.messageText = '';
    this.playSwoosh();
    navigator.vibrate?.(10);
    this.scrollToBottom();
  }

  setReplyTo(msg: ChatMessage): void {
    this.replyingTo.set(msg);
  }

  clearReplyTo(): void {
    this.replyingTo.set(null);
  }

  // ======== Emoji Picker ========

  insertEmoji(emoji: string): void {
    this.messageText += emoji;
    this.showEmojiPicker.set(false);
    this.updateRecentEmojis(emoji);
  }

  private updateRecentEmojis(emoji: string): void {
    this.recentEmojis.update(prev => {
      const filtered = prev.filter(e => e !== emoji);
      const updated = [emoji, ...filtered].slice(0, 24);
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('sf_chat_recent_emojis', JSON.stringify(updated));
      }
      return updated;
    });
  }

  // ======== Message Delete ========

  deleteMessage(message: ChatMessage): void {
    this.chatService.deleteMessage(message.id);
  }

  // ======== Search ========

  toggleSearch(): void {
    if (!this.embedded()) {
      this.chatPanelMode.set('thread');
    }
    this.searchOpen.update(v => !v);
    if (!this.searchOpen()) this.closeSearch();
  }

  closeSearch(): void {
    this.searchOpen.set(false);
    this.searchQuery = '';
    this.searchResults.set([]);
    this.searchActiveIndex.set(0);
  }

  onSearchInput(query: string): void {
    if (this._searchDebounce) clearTimeout(this._searchDebounce);
    this._searchDebounce = setTimeout(() => this.executeSearch(query), 300);
  }

  private executeSearch(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.searchResults.set([]);
      this.searchActiveIndex.set(0);
      return;
    }
    const results = this.chatService.messages().filter(
      m => m.content?.toLowerCase().includes(q)
    );
    this.searchResults.set(results);
    this.searchActiveIndex.set(0);
    if (results.length > 0) {
      this.scrollToMessage(results[0].id);
    }
  }

  navigateSearch(direction: number): void {
    const results = this.searchResults();
    if (results.length === 0) return;
    const current = this.searchActiveIndex();
    const next = (current + direction + results.length) % results.length;
    this.searchActiveIndex.set(next);
    this.scrollToMessage(results[next].id);
  }

  scrollToMessage(messageId: string): void {
    const viewport = this.messagesViewport();
    if (!viewport) return;
    const el = viewport.elementRef.nativeElement.querySelector(`[data-message-id="${messageId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('highlight-message');
      setTimeout(() => el.classList.remove('highlight-message'), 1500);
    }
  }

  onTyping(): void {
    this.chatService.setTyping(true);

    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.typingTimeout = setTimeout(() => {
      this.chatService.setTyping(false);
    }, 1000);
  }

  handleQuickAction(action: string): void {
    switch (action) {
      case 'upload':
        this.triggerFileUpload();
        break;
      case 'examples':
        this.chatService.sendMessage('Хочу посмотреть примеры ваших работ');
        break;
      case 'prices':
        this.chatService.sendMessage('Расскажите о ценах на фото на документы');
        break;
      case 'question':
        break;
    }
  }

  onInteractiveButtonClick(button: BotButton): void {
    if (button.value === 'send_photo') {
      this.triggerFileUpload();
      return;
    }
    const paymentOrderId = this.getPaymentButtonOrderId(button);
    if (button.value === 'pay_online_widget' && paymentOrderId) {
      void this.router.navigate(['/pay', paymentOrderId]);
      return;
    }
    if (button.url) {
      window.open(button.url, '_blank', 'noopener');
      return;
    }
    // Legacy payment flow without an existing backend order: put it into the cart first.
    if ((button.value === 'pay_online_widget' || button.value === 'pay_order') && button.data) {
      window.dispatchEvent(new CustomEvent('chat:orderFinalized', {
        detail: {
          orderId: button.data['orderId'] || button.data['categorySlug'] || 'order',
          price: button.data['price'],
          description: button.data['tariff'] || button.data['description'] || 'Заказ',
          categorySlug: button.data['categorySlug'],
          selectedOptions: button.data['selectedOptions'],
          photoCount: button.data['photoCount'],
        },
      }));
      window.dispatchEvent(new CustomEvent('cart:open'));
      return;
    }
    // Добавить услугу в корзину
    if (button.value === 'add_to_cart' && button.data) {
      window.dispatchEvent(new CustomEvent('cart:addItem', {
        detail: button.data,
      }));
      return;
    }
    // Открыть корзину
    if (button.value === 'open_cart') {
      window.dispatchEvent(new CustomEvent('cart:open'));
      return;
    }

    this.chatService.sendButtonClick(button);
    this.scrollToBottom();
  }

  private getPaymentButtonOrderId(button: BotButton): string | null {
    const orderId = button.data?.['orderId'];
    return typeof orderId === 'string' && orderId.trim() ? orderId.trim() : null;
  }

  private showUploadError(msg: string): void {
    this.uploadError.set(msg);
    setTimeout(() => this.uploadError.set(null), 5000);
  }

  private validateFiles(files: File[]): File[] {
    const CLIENT_BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.php', '.js', '.msi', '.dmg', '.apk', '.vbs', '.ps1', '.jar', '.py', '.rb'];
    const CLIENT_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

    const blocked: string[] = [];
    const oversized: string[] = [];

    const valid = files.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (CLIENT_BLOCKED_EXTENSIONS.includes(ext)) {
        blocked.push(file.name);
        return false;
      }
      if (file.size > CLIENT_MAX_FILE_SIZE) {
        oversized.push(file.name);
        return false;
      }
      return true;
    });

    if (blocked.length) {
      this.showUploadError(`Этот формат не поддерживается: ${blocked.join(', ')}`);
    } else if (oversized.length) {
      this.showUploadError(`Слишком большой файл (макс. 50 МБ)`);
    }

    return valid;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const files = this.validateFiles(Array.from(input.files));
    if (files.length) {
      this.chatService.uploadImages(files, this.messageText.trim() || undefined);
      this.messageText = '';
      this.scrollToBottom();
    }
    input.value = '';
  }

  retryFailedUpload(): void {
    this.chatService.retryFailedUpload(0);
  }

  dismissFailedUpload(): void {
    this.chatService.clearFailedUploads();
  }

  // Drag & Drop
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    const dtFiles = event.dataTransfer?.files;
    if (!dtFiles?.length) return;

    const validFiles = this.validateFiles(Array.from(dtFiles));
    if (validFiles.length === 0) return;

    this.chatService.uploadImages(validFiles);
    this.scrollToBottom();
  }

  onPaste(event: ClipboardEvent): void {
    const items = event.clipboardData?.items;
    if (!items) return;

    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length === 0) return;
    event.preventDefault();

    const validFiles = this.validateFiles(files);
    if (validFiles.length === 0) return;

    this.chatService.uploadImages(validFiles, this.messageText.trim() || undefined);
    this.messageText = '';
    this.scrollToBottom();
  }

  openImage(url: string): void {
    if (isPlatformBrowser(this.platformId)) {
      this.fullscreenImage.set(url);
      this._fsScale = 1;
      this._fsPanX = 0;
      this._fsPanY = 0;
      this._fsDismissY = 0;
    }
  }

  closeFullscreen(): void {
    this.fullscreenImage.set(null);
  }

  onFsTouchStart(e: TouchEvent): void {
    if (e.touches.length === 2) {
      this._fsStartDistance = this.getTouchDistance(e.touches);
      this._fsStartScale = this._fsScale;
    } else if (e.touches.length === 1) {
      this._fsTouchStartY = e.touches[0].clientY;
      this._fsTouchStartTime = Date.now();
      this._fsDismissY = 0;

      // Double-tap detection
      const now = Date.now();
      if (now - this._fsLastTap < 300) {
        e.preventDefault();
        this._fsScale = this._fsScale > 1.5 ? 1 : 2.5;
        this._fsPanX = 0;
        this._fsPanY = 0;
        this.applyFsTransform(e.target as HTMLElement);
      }
      this._fsLastTap = now;
    }
  }

  onFsTouchMove(e: TouchEvent): void {
    e.preventDefault();
    const imgEl = e.target as HTMLElement;

    if (e.touches.length === 2) {
      const dist = this.getTouchDistance(e.touches);
      this._fsScale = Math.min(5, Math.max(0.5, this._fsStartScale * (dist / this._fsStartDistance)));
      this.applyFsTransform(imgEl);
    } else if (e.touches.length === 1 && this._fsScale <= 1.05) {
      // Swipe down to dismiss
      this._fsDismissY = e.touches[0].clientY - this._fsTouchStartY;
      const opacity = Math.max(0.2, 1 - Math.abs(this._fsDismissY) / 400);
      const container = imgEl.closest('.fs-overlay') as HTMLElement | null;
      if (container) {
        container.style.opacity = String(opacity);
      }
      imgEl.style.transform = `translateY(${this._fsDismissY}px) scale(${this._fsScale})`;
    } else if (e.touches.length === 1 && this._fsScale > 1.05) {
      // Pan when zoomed
      this._fsPanX += e.touches[0].clientX - (this._fsTouchStartY ? 0 : e.touches[0].clientX);
      this.applyFsTransform(imgEl);
    }
  }

  onFsTouchEnd(e: TouchEvent): void {
    if (e.touches.length === 0 && this._fsScale <= 1.05) {
      const elapsed = Date.now() - this._fsTouchStartTime;
      const velocity = Math.abs(this._fsDismissY) / Math.max(elapsed, 1);
      if (Math.abs(this._fsDismissY) > 120 || velocity > 0.5) {
        this.closeFullscreen();
        return;
      }
      // Reset position
      const container = (e.target as HTMLElement).closest('.fs-overlay') as HTMLElement | null;
      if (container) container.style.opacity = '1';
      (e.target as HTMLElement).style.transform = `scale(${this._fsScale})`;
      this._fsDismissY = 0;
    }
  }

  private getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private applyFsTransform(el: HTMLElement): void {
    el.style.transform = `translate(${this._fsPanX}px, ${this._fsPanY}px) scale(${this._fsScale})`;
  }

  // ======== Sound ========

  toggleSound(): void {
    const next = !this.soundEnabled();
    this.soundEnabled.set(next);
    localStorage.setItem('sf_chat_sound', String(next));
    // Unlock AudioContext on user gesture (iOS Safari requirement)
    if (next && !this._audioCtx) {
      this._audioCtx = new AudioContext();
      this._audioCtxUnlocked = true;
    }
  }

  private ensureAudioCtx(): AudioContext | null {
    if (!this.soundEnabled()) return null;
    if (!this._audioCtx) {
      this._audioCtx = new AudioContext();
      this._audioCtxUnlocked = true;
    }
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
    return this._audioCtx;
  }

  private playSwoosh(): void {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    // White noise burst with frequency sweep, "swoosh"
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(400, now + 0.2);
    filter.Q.value = 1;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + 0.2);
  }

  private playTink(): void {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Short sine "tink" at 880Hz
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.05);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  isPdfFile(url: string): boolean { return isPdf(url); }
  getIcon(url: string): string { return getFileIcon(url); }
  sanitize(url: string): SafeResourceUrl { return this.sanitizerSvc.bypassSecurityTrustResourceUrl(url); }

  formatMessage(content: string): string {
    const cached = this._formatCache.get(content);
    if (cached !== undefined) return cached;

    let result = '';
    let lastIndex = 0;
    const urlRegex = /(?:(?:https?:\/\/|www\.)[^\s<>"'`*]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#][^\s<>"'`*]*)?)/gi;

    for (const match of content.matchAll(urlRegex)) {
      const rawMatch = match[0];
      const matchIndex = match.index ?? 0;
      if (content[matchIndex - 1] === '@') {
        continue;
      }
      const { url, trailing } = this.splitLinkTrailingPunctuation(rawMatch);

      result += this.formatMessageText(content.slice(lastIndex, matchIndex));
      result += this.formatLink(url);
      result += this.formatMessageText(trailing);
      lastIndex = matchIndex + rawMatch.length;
    }

    result += this.formatMessageText(content.slice(lastIndex));
    this._formatCache.set(content, result);
    return result;
  }

  private formatMessageText(content: string): string {
    return this.escapeHtml(content)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  private formatLink(rawUrl: string): string {
    const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

    if (!this.isSafeChatLink(href)) {
      return this.formatMessageText(rawUrl);
    }

    return `<a href="${this.escapeHtmlAttribute(href)}" target="_blank" rel="noopener noreferrer">${this.escapeHtml(rawUrl)}</a>`;
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

  private isSafeChatLink(href: string): boolean {
    try {
      const url = new URL(href);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private escapeHtml(content: string): string {
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private escapeHtmlAttribute(content: string): string {
    return this.escapeHtml(content)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  retryMessage(clientMessageId: string): void {
    this.chatService.retryMessage(clientMessageId);
  }

  formatTime(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  private parseMessageMetadata(metadata: ChatMessage['metadata']): ChatMessageMetadata | null {
    if (!metadata) return null;
    if (typeof metadata !== 'string') return metadata;

    try {
      const parsed: unknown = JSON.parse(metadata);
      return this.isChatMessageMetadata(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private isChatMessageMetadata(value: unknown): value is ChatMessageMetadata {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  getGalleryUrls(message: ChatMessage): string[] {
    const cached = this._galleryCache.get(message.id);
    if (cached !== undefined) return cached;

    let result: string[];
    if (Array.isArray(message.gallery_urls)) {
      result = message.gallery_urls;
    } else {
      const gallery = this.parseMessageMetadata(message.metadata)?.gallery;
      result = Array.isArray(gallery)
        ? gallery.filter((url): url is string => typeof url === 'string' && url.length > 0)
        : [];
    }
    this._galleryCache.set(message.id, result);
    return result;
  }

  getInlineCards(message: ChatMessage): BotCard[] {
    const cached = this._inlineCardsCache.get(message.id);
    if (cached !== undefined) return cached;

    const interactive = this.getMessageInteractive(message);
    let result: BotCard[];
    if (!interactive) {
      result = [];
    } else if (Array.isArray(interactive.cards) && interactive.cards.length > 0) {
      result = interactive.cards;
    } else {
      result = this.buildFallbackCards(message, interactive);
    }
    this._inlineCardsCache.set(message.id, result);
    return result;
  }

  hasPaymentButton(card: BotCard): boolean {
    return !!card.buttons?.some(b => b.value === 'pay_online_widget' || b.value === 'pay_order');
  }

  getApprovalGallery(message: ChatMessage): { photos: ApprovalGalleryPhoto[]; reviewUrl: string } | null {
    const cached = this._approvalGalleryCache.get(message.id);
    if (cached !== undefined) return cached;

    const interactive = this.getMessageInteractive(message);
    if (!interactive || interactive.type !== 'approval_gallery') {
      this._approvalGalleryCache.set(message.id, null);
      return null;
    }

    const result = {
      photos: Array.isArray(interactive.photos) ? interactive.photos : [],
      reviewUrl: interactive.reviewUrl || '',
    };
    this._approvalGalleryCache.set(message.id, result);
    return result;
  }

  private getMessageInteractive(message: ChatMessage): BotInteractive | null {
    if (message.interactive) {
      return message.interactive;
    }

    return this.parseMessageMetadata(message.metadata)?.interactive ?? null;
  }

  private buildFallbackCards(message: ChatMessage, interactive: BotInteractive): BotCard[] {
    if (message.sender_type === 'visitor') return [];

    const lines = message.content
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^•\s*/, '').replace(/\*\*/g, ''));

    const detailLines = lines.filter(line => line.includes(':'));
    const items = detailLines
      .map(line => {
        const dividerIndex = line.indexOf(':');
        if (dividerIndex <= 0) return null;
        return {
          label: line.slice(0, dividerIndex).trim(),
          value: line.slice(dividerIndex + 1).trim(),
        };
      })
      .filter((item): item is { label: string; value: string } => !!item);

    const paymentButton = interactive.buttons?.find(btn => btn.value === 'pay_order' || btn.value === 'pay_online_widget');
    const actionButtons = this.getPrimaryActionButtons(interactive.buttons || []);
    const hasUploadButton = interactive.buttons?.some(btn => btn.value === 'send_photo');
    const bookingButton = interactive.buttons?.find(btn => btn.value?.startsWith('b24_'));
    const priceMatch = message.content.match(/\*\*(\d+\s*₽)\*\*|\b(\d+\s*₽)\b/);
    const priceText = priceMatch?.[1] || priceMatch?.[2] || undefined;

    if (paymentButton && items.length > 0) {
      return [{
        title: 'Итог заказа',
        subtitle: 'Проверьте данные перед оплатой',
        icon: 'receipt_long',
        items,
        price: priceText,
        buttons: actionButtons,
      }];
    }

    if (hasUploadButton) return [];

    if (bookingButton) {
      return [{
        title: 'Запись в студию',
        subtitle: 'Выберите удобный слот',
        icon: 'event_available',
        buttons: actionButtons,
      }];
    }

    if (interactive.step === 'order_confirmed' && items.length > 0) {
      return [{
        title: 'Заказ подтверждён',
        icon: 'check_circle',
        items,
        price: priceText,
        buttons: actionButtons,
      }];
    }

    return [];
  }

  private getPrimaryActionButtons(buttons: BotButton[]): BotButton[] {
    const primaryValues = new Set(['pay_order', 'pay_online_widget', 'add_to_cart', 'open_cart', 'b24_check_slots', 'b24_create_booking']);
    return buttons.filter(button => this.isVisibleToVisitor(button) && (primaryValues.has(button.value) || !!button.url));
  }

  getQuickRepliesForMessage(message: ChatMessage): BotButton[] {
    const cached = this._quickRepliesCache.get(message.id);
    if (cached !== undefined) return cached;

    const quickReplies = this.inlineQuickReplyButtons();
    if (quickReplies.length === 0) {
      this._quickRepliesCache.set(message.id, []);
      return [];
    }

    const cardButtons = this.getInlineCards(message).flatMap(card => card.buttons || []);
    if (cardButtons.length === 0) {
      this._quickRepliesCache.set(message.id, quickReplies);
      return quickReplies;
    }

    const renderedInCards = new Set(cardButtons.map(button => `${button.value}|${button.label}`));
    const result = quickReplies
      .filter(button => this.isVisibleToVisitor(button))
      .filter(button => !renderedInCards.has(`${button.value}|${button.label}`));
    this._quickRepliesCache.set(message.id, result);
    return result;
  }

  private isVisibleToVisitor(button: BotButton): boolean {
    return button.visibleTo !== 'operator';
  }

  scrollToBottom(): void {
    const viewport = this.messagesViewport();
    if (!viewport) return;

    const count = this.chatService.messages().length;
    if (count === 0) return;

    // Scroll to last item via CDK API
    viewport.scrollToIndex(count - 1, 'smooth');

    // Fine-tune: CDK estimation may be off for variable-height items
    const el = viewport.elementRef.nativeElement;
    setTimeout(() => { el.scrollTop = el.scrollHeight; }, 120);
    setTimeout(() => { el.scrollTop = el.scrollHeight; }, 320);

    let attempts = 0;
    const retryScroll = () => {
      attempts += 1;
      el.scrollTop = el.scrollHeight;
      if (attempts < 5) {
        requestAnimationFrame(retryScroll);
      }
    };
    requestAnimationFrame(retryScroll);
  }
}
