import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { channelIcon, channelLabel } from '../../utils/crm-helpers';
import type { OperatorChatMessage } from '../../services/operator-chat.service';

interface ForwardTarget {
  id: string;
  clientName: string | null;
  clientPhone: string | null;
  channel: string;
  preview: string;
  status: string;
}

interface ForwardDialogData {
  message: OperatorChatMessage;
  currentSessionId: string;
}

interface InboxResponse {
  success: boolean;
  data: {
    id: string;
    clientName: string | null;
    clientPhone: string | null;
    channel?: string;
    preview: string;
    status: string;
    type: string;
  }[];
}

interface ForwardResponse {
  success: boolean;
  data: unknown;
}

@Component({
  selector: 'app-forward-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>shortcut</mat-icon> Переслать сообщение
    </h2>
    <mat-dialog-content>
      <div class="forward-preview">
        <div class="forward-preview-sender">{{ data.message.sender_name || 'Неизвестный' }}</div>
        <div class="forward-preview-text">{{ (data.message.content || '').substring(0, 120) }}</div>
        @if (data.message.attachment_url) {
          <div class="forward-preview-attach">
            <mat-icon>attach_file</mat-icon> Файл
          </div>
        }
      </div>

      <mat-form-field appearance="outline" class="full-width search-field">
        <mat-label>Поиск чата...</mat-label>
        <input matInput [(ngModel)]="searchQuery" (ngModelChange)="onSearch($event)" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="24" /></div>
      } @else if (filteredSessions().length === 0) {
        <div class="empty-state">
          <mat-icon>search_off</mat-icon>
          <span>Чатов не найдено</span>
        </div>
      } @else {
        <div class="sessions-list">
          @for (session of filteredSessions(); track session.id) {
            <button class="session-item"
                    [class.selected]="selectedSession() === session.id"
                    (click)="selectSession(session)">
              <mat-icon class="channel-icon">{{ channelIcon(session.channel) }}</mat-icon>
              <div class="session-info">
                <span class="session-name">{{ session.clientName || 'Посетитель' }}</span>
                @if (session.clientPhone) {
                  <span class="session-phone">{{ session.clientPhone }}</span>
                }
                <span class="session-preview">{{ session.preview }}</span>
              </div>
              <span class="session-status" [class]="'status-' + session.status">
                {{ session.status === 'active' ? 'Активен' : session.status === 'open' ? 'Открыт' : session.status }}
              </span>
            </button>
          }
        </div>
      }

      @if (forwarding()) {
        <div class="forwarding-overlay">
          <mat-spinner diameter="24" />
          <span>Пересылаем...</span>
        </div>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary"
              [disabled]="!selectedSession() || forwarding()"
              (click)="forward()">
        Переслать
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2 { display: flex; align-items: center; gap: 8px; }
    .full-width { width: 100%; }
    .loading, .empty-state { display: flex; justify-content: center; align-items: center; gap: 8px; padding: 24px; color: #888; }
    mat-dialog-content { min-width: 360px; max-height: 60vh; }

    .forward-preview {
      background: #f5f5f5; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px;
      border-left: 3px solid #1976d2;
    }
    .forward-preview-sender { font-weight: 500; font-size: 13px; color: #1976d2; margin-bottom: 2px; }
    .forward-preview-text { font-size: 13px; color: #555; white-space: pre-wrap; word-break: break-word; }
    .forward-preview-attach { font-size: 12px; color: #888; display: flex; align-items: center; gap: 4px; margin-top: 4px; }
    .forward-preview-attach mat-icon { font-size: 16px; width: 16px; height: 16px; }

    .search-field { margin-top: 8px; }

    .sessions-list { display: flex; flex-direction: column; gap: 2px; max-height: 320px; overflow-y: auto; }
    .session-item {
      display: flex; align-items: center; gap: 10px; padding: 10px 12px;
      border: 1px solid transparent; border-radius: 8px; cursor: pointer;
      background: none; text-align: left; width: 100%; transition: background 0.15s;
    }
    .session-item:hover { background: #f0f4ff; }
    .session-item.selected { background: #e3f2fd; border-color: #1976d2; }
    .channel-icon { color: #888; font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; }
    .session-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .session-name { font-weight: 500; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-phone { font-size: 12px; color: #888; }
    .session-preview { font-size: 12px; color: #aaa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .session-status { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #eee; color: #666; flex-shrink: 0; }
    .status-active { background: #e8f5e9; color: #2e7d32; }
    .status-open { background: #fff3e0; color: #e65100; }

    .forwarding-overlay {
      position: absolute; inset: 0; background: rgba(255,255,255,0.85);
      display: flex; align-items: center; justify-content: center; gap: 8px;
      z-index: 1; border-radius: 8px;
    }
  `],
})
export class ForwardDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly dialogRef = inject(MatDialogRef<ForwardDialogComponent>);
  readonly data = inject<ForwardDialogData>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly forwarding = signal(false);
  readonly sessions = signal<ForwardTarget[]>([]);
  readonly selectedSession = signal<string | null>(null);
  readonly channelIcon = channelIcon;
  readonly channelLabel = channelLabel;

  searchQuery = '';
  private searchDebounce: ReturnType<typeof setTimeout> | null = null;

  readonly filteredSessions = computed(() => {
    const query = this.searchQuery.toLowerCase().trim();
    const all = this.sessions();
    if (!query) return all;
    return all.filter(s =>
      (s.clientName?.toLowerCase().includes(query)) ||
      (s.clientPhone?.includes(query)) ||
      (s.preview?.toLowerCase().includes(query))
    );
  });

  constructor() {
    this.loadSessions();
  }

  private loadSessions(): void {
    this.http.get<InboxResponse>('/api/crm/inbox?filter=all&sort=time&limit=50').subscribe({
      next: (res) => {
        if (res.success) {
          this.sessions.set(
            res.data
              .filter(item => item.type === 'chat' && item.id !== this.data.currentSessionId)
              .map(item => ({
                id: item.id,
                clientName: item.clientName,
                clientPhone: item.clientPhone,
                channel: item.channel || 'web',
                preview: item.preview || '',
                status: item.status,
              }))
          );
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearch(query: string): void {
    // Filtering is computed, no need for debounce on local filter
    this.searchQuery = query;
  }

  selectSession(session: ForwardTarget): void {
    this.selectedSession.set(session.id);
  }

  forward(): void {
    const targetId = this.selectedSession();
    if (!targetId) return;

    this.forwarding.set(true);
    this.http.post<ForwardResponse>(`/api/visitor-chat/admin/sessions/${targetId}/forward`, {
      messageId: this.data.message.id,
    }).subscribe({
      next: (res) => {
        this.forwarding.set(false);
        if (res.success) {
          const target = this.sessions().find(s => s.id === targetId);
          this.dialogRef.close({
            success: true,
            targetName: target?.clientName || 'Посетитель',
          });
        }
      },
      error: () => {
        this.forwarding.set(false);
      },
    });
  }
}
