import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { StaffChatService, ChatNotification } from '../../services/staff-chat.service';

@Component({
  selector: 'app-chat-notification-toast',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (chatService.notifications().length > 0) {
      <div class="toast-container">
        @for (notif of chatService.notifications(); track notif.id) {
          <div class="toast-item">
            <div class="toast-icon">
              <mat-icon>chat</mat-icon>
            </div>
            <div class="toast-body" (click)="goToChat(notif)" (keydown.enter)="goToChat(notif)" tabindex="0" role="button">
              <div class="toast-header">
                <span class="toast-sender">{{ notif.senderName }}</span>
                <span class="toast-conv">{{ notif.conversationTitle }}</span>
              </div>
              <div class="toast-preview">
                @if (notif.messageType === 'image') {
                  <mat-icon class="toast-type-icon">image</mat-icon> Фото
                } @else if (notif.messageType === 'audio') {
                  <mat-icon class="toast-type-icon">mic</mat-icon> Голосовое сообщение
                } @else if (notif.messageType === 'video') {
                  <mat-icon class="toast-type-icon">videocam</mat-icon> Видео
                } @else if (notif.messageType === 'file') {
                  <mat-icon class="toast-type-icon">attach_file</mat-icon> Файл
                } @else {
                  {{ notif.preview }}
                }
              </div>
            </div>
            <button class="toast-close" (click)="dismiss(notif.id)" aria-label="Закрыть">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        }

        @if (chatService.notifications().length > 1) {
          <button class="toast-dismiss-all" (click)="dismissAll()">
            Закрыть все ({{ chatService.notifications().length }})
          </button>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      top: 56px;
      right: 16px;
      z-index: 1000;
      display: flex;
      flex-direction: column;
      gap: 8px;
      max-width: 380px;
      pointer-events: none;
    }

    .toast-container {
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: auto;
    }

    .toast-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      background: rgba(12, 11, 9, 0.95);
      backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(245, 158, 11, 0.2);
      border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5),
                  0 0 0 1px rgba(255, 255, 255, 0.04);
      animation: toastSlideIn 300ms ease;
      cursor: default;
      min-width: 300px;
    }

    @keyframes toastSlideIn {
      from {
        opacity: 0;
        transform: translateX(100%) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateX(0) scale(1);
      }
    }

    .toast-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(245, 158, 11, 0.08));
      border: 1px solid rgba(245, 158, 11, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-accent);
      }
    }

    .toast-body {
      flex: 1;
      min-width: 0;
      cursor: pointer;
      border-radius: 8px;
      padding: 2px 4px;
      transition: background 150ms;

      &:hover {
        background: rgba(255, 255, 255, 0.04);
      }
    }

    .toast-header {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 2px;
    }

    .toast-sender {
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
      font-size: 13px;
      font-weight: 600;
      color: var(--crm-text-primary);
    }

    .toast-conv {
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      font-size: 10px;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .toast-preview {
      font-size: 12px;
      color: var(--crm-text-secondary);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      display: flex;
      align-items: center;
      gap: 4px;
      line-height: 1.4;
    }

    .toast-type-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-text-muted);
    }

    .toast-close {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: none;
      background: none;
      color: var(--crm-text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 150ms;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
      }
    }

    .toast-dismiss-all {
      align-self: flex-end;
      padding: 4px 12px;
      border-radius: 8px;
      border: 1px solid var(--crm-glass-border);
      background: rgba(12, 11, 9, 0.9);
      backdrop-filter: blur(12px);
      color: var(--crm-text-muted);
      font-size: 11px;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: all 150ms;
      pointer-events: auto;

      &:hover {
        color: var(--crm-text-secondary);
        border-color: rgba(255, 255, 255, 0.1);
      }
    }
  `],
})
export class ChatNotificationToastComponent {
  protected readonly chatService = inject(StaffChatService);
  private readonly router = inject(Router);

  goToChat(notif: ChatNotification): void {
    this.chatService.selectConversation(notif.conversationId);
    this.chatService.dismissNotification(notif.id);
    this.router.navigate(['/employee/team']);
  }

  dismiss(id: string): void {
    this.chatService.dismissNotification(id);
  }

  dismissAll(): void {
    this.chatService.dismissAllNotifications();
  }
}
