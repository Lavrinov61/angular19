import { Component, inject, signal, ChangeDetectionStrategy, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { StaffChatService } from '../../services/staff-chat.service';
import { ConversationListComponent } from './conversation-list.component';
import { ConversationRoomComponent } from './conversation-room.component';
import { ConversationInfoPanelComponent } from './conversation-info-panel.component';

@Component({
  selector: 'app-team-chat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ConversationListComponent, ConversationRoomComponent, ConversationInfoPanelComponent],
  template: `
    <div class="team-chat-layout" [class.has-active]="!!chatService.activeConversationId()"
         [class.has-info]="showInfo()">
      <div class="list-panel">
        <app-conversation-list (conversationSelected)="onSelect($event)" />
      </div>
      <div class="room-panel">
        @if (chatService.activeConversationId(); as convId) {
          <app-conversation-room [conversationId]="convId" (infoToggled)="showInfo.set(!showInfo())" />
        } @else {
          <div class="no-selection">
            <mat-icon>forum</mat-icon>
            <p>Выберите чат или начните новый</p>
          </div>
        }
      </div>
      @if (showInfo() && chatService.activeConversation(); as conv) {
        <app-conversation-info-panel [conversation]="conv" (closed)="showInfo.set(false)" />
      }
    </div>
  `,
  styles: [`
    @keyframes emptyFadeIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    :host { display: block; height: 100%; }

    .team-chat-layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      height: 100%;
      background: var(--crm-surface-base, #0c0b09);

      &.has-info { grid-template-columns: 320px 1fr 340px; }
    }

    .list-panel {
      border-right: 1px solid var(--crm-glass-border);
      overflow: hidden;
      background: rgba(12, 11, 9, 0.75);
      box-shadow: 2px 0 12px rgba(0, 0, 0, 0.15);
    }

    .room-panel {
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .no-selection {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--crm-text-muted);
      animation: emptyFadeIn 0.4s ease-out;
      mat-icon {
        font-size: 72px;
        width: 72px;
        height: 72px;
        opacity: 0.12;
        color: var(--crm-accent);
      }
      p {
        font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
        font-size: 14px;
        margin-top: 12px;
        letter-spacing: 0.01em;
      }
    }
  `],
})
export class TeamChatComponent {
  protected readonly chatService = inject(StaffChatService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly showInfo = signal(false);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.chatService.init();
    }
  }

  onSelect(conversationId: string): void {
    this.chatService.selectConversation(conversationId);
  }
}
