import {
  Component, input, inject, signal, effect, ElementRef, viewChild,
  ChangeDetectionStrategy, PLATFORM_ID, DestroyRef,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { OperatorChatMessage } from '../../services/operator-chat.service';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { AuthService } from '../../../../core/services/auth.service';

interface OrderMiniChatSessionInfo {
  channel: string;
  visitor_name: string | null;
}

interface OrderMiniChatSessionDetailResponse {
  success: boolean;
  data: OrderMiniChatSessionInfo;
}

@Component({
  selector: 'app-order-mini-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule],
  template: `
    <div class="mini-chat">
      <!-- Header -->
      <div class="mc-header">
        <mat-icon class="mc-header-icon">chat</mat-icon>
        <span class="mc-header-title">Чат с клиентом</span>
        @if (sessionInfo()) {
          <span class="mc-channel">{{ channelLabel(sessionInfo()!.channel) }}</span>
        }
      </div>

      <!-- Messages -->
      <div class="mc-messages" #messagesEl>
        @if (loading()) {
          <div class="mc-loading">
            <mat-icon>hourglass_empty</mat-icon>
          </div>
        } @else if (!messages().length) {
          <div class="mc-empty">Нет сообщений</div>
        } @else {
          @for (msg of messages(); track msg.id) {
            @if (msg.sender_type === 'internal_note') {
              <div class="mc-note">📝 {{ msg.content }}</div>
            } @else if (msg.sender_type === 'bot' && msg.message_type === 'system') {
              <div class="mc-system">
                <span class="mc-system-label">{{ botSenderLabel(msg) }}</span>
                {{ msg.content }}
              </div>
            } @else {
              <div class="mc-msg"
                   [class.mc-msg--out]="msg.sender_type === 'operator' || msg.sender_type === 'bot'"
                   [class.mc-msg--bot]="msg.sender_type === 'bot'">
                @if (msg.sender_type === 'bot') {
                  <span class="mc-sender mc-sender--bot">{{ botSenderLabel(msg) }}</span>
                }
                <div class="mc-bubble">
                  @if (msg.message_type === 'image' && msg.attachment_url) {
                    <a [href]="msg.attachment_url" target="_blank" class="mc-img-wrap">
                      <img [src]="msg.attachment_url" class="mc-img" [alt]="msg.content || 'Фото'" />
                    </a>
                    @if (msg.content) {
                      <span class="mc-text">{{ msg.content }}</span>
                    }
                  } @else if (msg.message_type === 'file' && msg.attachment_url) {
                    <a [href]="msg.attachment_url" target="_blank" class="mc-file">
                      <mat-icon>attach_file</mat-icon>
                      <span>{{ msg.content || 'Файл' }}</span>
                    </a>
                  } @else {
                    <span class="mc-text">{{ msg.content }}</span>
                  }
                </div>
                <span class="mc-time">{{ formatTime(msg.created_at) }}</span>
              </div>
            }
          }
        }
      </div>

      <!-- Reply input -->
      <div class="mc-footer">
        <textarea
          class="mc-input"
          #replyInput
          [value]="replyText()"
          (input)="replyText.set($any($event.target).value)"
          (keydown.enter)="onEnter($event)"
          placeholder="Написать клиенту..."
          rows="2">
        </textarea>
        <button mat-icon-button class="mc-send"
                [disabled]="!replyText().trim() || sending()"
                (click)="sendReply()">
          <mat-icon>send</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }

    .mini-chat {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background: var(--crm-surface-base);
    }

    /* Header */
    .mc-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface);
      flex-shrink: 0;

      .mc-header-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-accent); }
      .mc-header-title { font-size: 12px; font-weight: 600; flex: 1; }
      .mc-channel { font-size: 10px; color: var(--crm-text-muted); }
    }

    /* Messages */
    .mc-messages {
      flex: 1;
      overflow-y: auto;
      padding: 8px 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      scroll-behavior: smooth;
    }

    .mc-loading, .mc-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--crm-text-muted);
      font-size: 12px;
      mat-icon { opacity: 0.4; }
    }

    .mc-system {
      text-align: center;
      font-size: 10px;
      color: var(--crm-text-muted);
      padding: 2px 0;
    }

    .mc-system-label {
      display: block;
      margin-bottom: 2px;
      color: #93c5fd;
      font-weight: 600;
    }

    .mc-note {
      text-align: center;
      font-size: 10px;
      color: var(--crm-status-warning);
      background: var(--crm-status-warning-muted);
      border-radius: var(--crm-radius-sm);
      padding: 3px 8px;
      margin: 2px 0;
    }

    /* Message bubbles */
    .mc-msg {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 1px;
      max-width: 90%;

      &.mc-msg--out {
        align-self: flex-end;
        align-items: flex-end;

        .mc-bubble {
          background: var(--crm-accent-muted);
          color: var(--crm-text-primary);
          border-radius: 12px 2px 12px 12px;
        }
      }

      &.mc-msg--bot {
        .mc-bubble {
          background: rgba(37, 99, 235, 0.18);
          border: 1px solid rgba(96, 165, 250, 0.38);
          border-right: 3px solid #60a5fa;
        }
      }
    }

    .mc-bubble {
      background: var(--crm-surface-raised);
      border-radius: 2px 12px 12px 12px;
      padding: 6px 8px;
      max-width: 100%;
      word-break: break-word;
    }

    .mc-sender {
      font-size: 10px;
      font-weight: 600;
      line-height: 1.2;
      padding: 0 3px;
    }

    .mc-sender--bot {
      color: #93c5fd;
    }

    .mc-text {
      font-size: 12px;
      line-height: 1.4;
      white-space: pre-wrap;
    }

    .mc-img-wrap {
      display: block;
      margin-bottom: 2px;
    }

    .mc-img {
      max-width: 160px;
      max-height: 140px;
      border-radius: 6px;
      object-fit: cover;
      display: block;
      cursor: pointer;
    }

    .mc-file {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: var(--crm-accent);
      text-decoration: none;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .mc-time {
      font-size: 9px;
      color: var(--crm-text-muted);
      padding: 0 2px;
    }

    /* Footer */
    .mc-footer {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      padding: 6px 6px 6px 8px;
      border-top: 1px solid var(--crm-border);
      background: var(--crm-surface);
      flex-shrink: 0;
    }

    .mc-input {
      flex: 1;
      resize: none;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      padding: 6px 8px;
      font-size: 12px;
      font-family: var(--crm-font-sans);
      color: var(--crm-text-primary);
      background: var(--crm-surface-raised);
      outline: none;
      line-height: 1.4;
      transition: border-color 0.15s;
      min-height: 42px;
      max-height: 80px;

      &:focus { border-color: var(--crm-accent); }
      &::placeholder { color: var(--crm-text-muted); }
    }

    .mc-send {
      width: 32px;
      height: 32px;
      flex-shrink: 0;
      color: var(--crm-accent);

      mat-icon { font-size: 18px; }

      &:disabled { color: var(--crm-text-muted); }
    }
  `],
})
export class OrderMiniChatComponent {
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  sessionId = input.required<string>();

  messages = signal<OperatorChatMessage[]>([]);
  replyText = signal('');
  loading = signal(false);
  sending = signal(false);
  sessionInfo = signal<OrderMiniChatSessionInfo | null>(null);

  readonly messagesEl = viewChild<ElementRef<HTMLElement>>('messagesEl');

  constructor() {
    // Reload messages when sessionId changes
    effect(() => {
      const id = this.sessionId();
      if (id && isPlatformBrowser(this.platformId)) {
        this.loadSession(id);
        this.loadMessages(id);
      }
    });

    // Real-time: new visitor message
    effect(() => {
      const evt = this.wsService.visitorNewMessage();
      if (!evt || evt.sessionId !== this.sessionId()) return;
      this.loadMessages(this.sessionId());
    });
  }

  private loadSession(sessionId: string): void {
    this.http.get<OrderMiniChatSessionDetailResponse>(
      `/api/visitor-chat/admin/sessions/${sessionId}/detail`
    ).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.sessionInfo.set({ channel: res.data.channel, visitor_name: res.data.visitor_name });
        }
      },
      error: () => undefined,
    });
  }

  loadMessages(sessionId: string): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: OperatorChatMessage[] }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/messages`
    ).subscribe({
      next: res => {
        if (res.success) {
          this.messages.set(res.data ?? []);
          this.loading.set(false);
          this.scrollToBottom();
        } else {
          this.loading.set(false);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  private scrollToBottom(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => {
      const el = this.messagesEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  }

  sendReply(): void {
    const text = this.replyText().trim();
    const sessionId = this.sessionId();
    if (!text || this.sending()) return;

    // Optimistic message
    const tempId = `temp-${Date.now()}`;
    const operatorName = this.authService.currentUser()?.display_name || 'Оператор';
    const tempMsg: OperatorChatMessage = {
      id: tempId,
      session_id: sessionId,
      sender_type: 'operator',
      sender_name: operatorName,
      message_type: 'text',
      content: text,
      attachment_url: null,
      created_at: new Date().toISOString(),
      is_read: true,
    };
    this.messages.update(msgs => [...msgs, tempMsg]);
    this.replyText.set('');
    this.scrollToBottom();
    this.sending.set(true);

    // WebSocket for real-time delivery
    this.wsService.replyToVisitor(sessionId, text, operatorName);

    // REST for persistence
    this.http.post<{ success: boolean }>(
      `/api/visitor-chat/admin/sessions/${sessionId}/reply`,
      { content: text }
    ).subscribe({
      next: () => {
        this.sending.set(false);
        // Replace temp with real (reload)
        this.loadMessages(sessionId);
      },
      error: () => {
        // Remove temp message on error
        this.messages.update(msgs => msgs.filter(m => m.id !== tempId));
        this.sending.set(false);
        this.replyText.set(text);
      },
    });
  }

  onEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey) return; // Shift+Enter = newline
    ke.preventDefault();
    this.sendReply();
  }

  formatTime(ts: string): string {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  botSenderLabel(msg: OperatorChatMessage): string {
    return this.isAiAssistantMessage(msg) ? 'Искусственный интеллект' : 'Автоматическое сообщение';
  }

  private isAiAssistantMessage(msg: OperatorChatMessage): boolean {
    return msg.sender_type === 'bot'
      && (msg.metadata?.['kind'] === 'ai_agent_reply' || msg.sender_name === 'Ассистент');
  }

  channelLabel(channel: string): string {
    const map: Record<string, string> = {
      web: 'Сайт', telegram: 'Telegram', vk: 'VK',
      whatsapp: 'WhatsApp', instagram: 'Instagram',
    };
    return map[channel] ?? channel;
  }
}
