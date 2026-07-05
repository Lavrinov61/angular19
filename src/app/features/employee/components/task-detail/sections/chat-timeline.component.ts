import { Component, inject, input, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { TasksApiService, ChatHistoryEntry, ChatMessage } from '../../../services/tasks-api.service';

@Component({
  selector: 'app-chat-timeline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatChipsModule],
  template: `
    @if (allChats().length > 0) {
      <mat-card class="chat-timeline-card">
        <mat-card-header>
          <mat-icon mat-card-avatar>forum</mat-icon>
          <mat-card-title>Переписка с клиентом</mat-card-title>
          <mat-card-subtitle>{{ totalMessages() }} сообщений</mat-card-subtitle>
        </mat-card-header>

        <!-- Filter chips -->
        <div class="filter-chips">
          <mat-chip (click)="setFilter('all')" [class.active-filter]="filter() === 'all'">Все</mat-chip>
          @for (src of sources(); track src) {
            <mat-chip (click)="setFilter(src)" [class.active-filter]="filter() === src">
              <mat-icon class="chip-icon">{{ sourceIcon(src) }}</mat-icon> {{ sourceLabel(src) }}
            </mat-chip>
          }
        </div>

        <mat-card-content>
          <div class="messages-list">
            @for (msg of filteredMessages(); track $index) {
              <div class="msg-row" [class.msg-in]="msg.direction === 'in'" [class.msg-out]="msg.direction === 'out'">
                <div class="msg-meta">
                  <mat-icon class="msg-source-icon">{{ sourceIcon(msg._source) }}</mat-icon>
                  <span class="msg-sender">{{ msg.sender }}</span>
                  <span class="msg-time">{{ formatTime(msg.timestamp) }}</span>
                </div>
                <div class="msg-bubble" [class.bubble-in]="msg.direction === 'in'" [class.bubble-out]="msg.direction === 'out'" [class.bubble-bot]="msg.sender === 'bot'">
                  {{ msg.content }}
                </div>
              </div>
            }
            @if (filteredMessages().length === 0) {
              <p class="no-msg">Нет сообщений</p>
            }
          </div>
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: [`
    .chat-timeline-card { margin-bottom: 12px; }
    .filter-chips { display: flex; gap: 6px; padding: 0 16px 8px; flex-wrap: wrap; cursor: pointer; }
    .active-filter { background: var(--mat-sys-primary) !important; color: var(--mat-sys-on-primary) !important; }
    .chip-icon { font-size: 14px; width: 14px; height: 14px; margin-right: 2px; }
    .messages-list { max-height: 400px; overflow-y: auto; padding: 8px 0; }
    .msg-row { margin-bottom: 8px; }
    .msg-meta { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--mat-sys-on-surface-variant); margin-bottom: 2px; }
    .msg-source-icon { font-size: 12px; width: 12px; height: 12px; }
    .msg-sender { font-weight: 500; }
    .msg-time { margin-left: auto; }
    .msg-bubble { padding: 8px 12px; border-radius: 12px; font-size: 13px; max-width: 85%; word-break: break-word; line-height: 1.4; }
    .bubble-in { background: var(--crm-surface-raised); color: var(--crm-text-primary); border-bottom-left-radius: 4px; }
    .bubble-out { background: var(--crm-accent-container); color: var(--crm-accent-hover); margin-left: auto; border-bottom-right-radius: 4px; }
    .bubble-bot { background: var(--crm-surface-overlay); color: var(--crm-accent); }
    .msg-in { text-align: left; }
    .msg-out { text-align: right; }
    .msg-out .msg-meta { justify-content: flex-end; }
    .no-msg { color: var(--mat-sys-on-surface-variant); font-style: italic; text-align: center; }
  `],
})
export class ChatTimelineComponent implements OnInit {
  private readonly tasksApi = inject(TasksApiService);

  taskId = input.required<string>();
  allChats = signal<ChatHistoryEntry[]>([]);
  filter = signal<string>('all');

  ngOnInit() {
    this.tasksApi.getClientContext(this.taskId()).subscribe({
      next: (res) => {
        if (res.data?.chat_history) {
          this.allChats.set(res.data.chat_history);
        }
      },
    });
  }

  sources(): string[] {
    return [...new Set(this.allChats().map(c => c.source))];
  }

  totalMessages(): number {
    return this.allChats().reduce((sum, c) => sum + c.messages.length, 0);
  }

  setFilter(f: string) {
    this.filter.set(f);
  }

  filteredMessages(): (ChatMessage & { _source: string })[] {
    const chats = this.filter() === 'all' ? this.allChats() : this.allChats().filter(c => c.source === this.filter());
    const all: (ChatMessage & { _source: string })[] = [];
    for (const chat of chats) {
      for (const msg of chat.messages) {
        all.push({ ...msg, _source: chat.source });
      }
    }
    all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return all.slice(-50);
  }

  sourceIcon(src: string): string {
    return { website: 'language', whatsapp: 'chat', telegram: 'send', max: 'forum' }[src] || 'chat';
  }

  sourceLabel(src: string): string {
    return { website: 'Сайт', whatsapp: 'WhatsApp', telegram: 'Telegram', max: 'МАКС' }[src] || src;
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
