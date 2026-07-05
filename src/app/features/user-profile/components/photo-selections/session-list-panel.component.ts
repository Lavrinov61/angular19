import {
  Component, input, output, ChangeDetectionStrategy
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { ApprovalSession, ApprovalStats } from './photo-selections.types';

@Component({
  selector: 'app-session-list-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="panel">

      <!-- Panel header -->
      <div class="panel-header">
        <h2 class="panel-title">Мои заявки</h2>
        <button class="btn-order-new" (click)="orderNewClicked.emit()">
          <span>+</span> Заказать ещё
        </button>
      </div>

      <!-- Stats -->
      @if (stats()) {
        <div class="stats-bar">
          @if (stats()!.pending > 0) {
            <span class="stat-pill stat-amber">
              {{ stats()!.pending }} ожидают
            </span>
          }
          @if (stats()!.approved > 0) {
            <span class="stat-pill stat-green">{{ stats()!.approved }} ✓</span>
          }
          @if (stats()!.changes_requested > 0) {
            <span class="stat-pill stat-blue">{{ stats()!.changes_requested }} ↻</span>
          }
        </div>
      }

      <!-- Hint -->
      <div class="hint-strip">
        <span class="hint-dot"></span>
        Нажмите на заявку для просмотра и согласования
      </div>

      <!-- Session list -->
      <div class="sessions-list">
        @for (session of sessions(); track session.sessionId) {
          <button
            class="session-card"
            [class.is-active]="selectedSessionId() === session.sessionId"
            [class.s-pending]="session.overallStatus === 'pending'"
            [class.s-approved]="session.overallStatus === 'approved'"
            [class.s-rejected]="session.overallStatus === 'rejected'"
            [class.s-changes]="session.overallStatus === 'changes_requested' || session.overallStatus === 'mixed'"
            (click)="sessionSelected.emit(session.sessionId)"
          >
            <!-- Status accent line -->
            <div class="sc-line"></div>

            <!-- Header row -->
            <div class="sc-header">
              <span
                class="sc-status-dot"
                [class.dot-pending]="session.overallStatus === 'pending'"
                [class.dot-approved]="session.overallStatus === 'approved'"
                [class.dot-rejected]="session.overallStatus === 'rejected'"
                [class.dot-changes]="session.overallStatus === 'changes_requested' || session.overallStatus === 'mixed'"
              ></span>
              <span class="sc-name">{{ session.name }}</span>
              <span class="sc-photo-count">{{ session.items.length }} фото</span>
            </div>

            <!-- Status text -->
            <div class="sc-status-text" [class.st-action]="session.overallStatus === 'pending'">
              {{ statusText(session.overallStatus) }}
            </div>

            <!-- Thumbnail strip -->
            <div class="sc-thumbs">
              @for (item of session.items.slice(0, 4); track item.id) {
                <div class="sc-thumb">
                  @if (thumbUrl(item)) {
                    <img [src]="thumbUrl(item)" alt="" loading="lazy">
                  } @else {
                    <div class="sc-thumb-ph">
                      <mat-icon>photo_camera</mat-icon>
                    </div>
                  }
                  <span
                    class="sc-thumb-dot"
                    [class.dot-pending]="item.status === 'pending'"
                    [class.dot-approved]="item.status === 'approved'"
                    [class.dot-rejected]="item.status === 'rejected'"
                    [class.dot-changes]="item.status === 'changes_requested'"
                  ></span>
                </div>
              }
              @if (session.items.length > 4) {
                <div class="sc-thumb-more">+{{ session.items.length - 4 }}</div>
              }
            </div>

            <!-- Footer -->
            <div class="sc-footer">
              <span class="sc-view-hint">Открыть →</span>
              @if (session.pendingCount > 0) {
                <span class="sc-pending-badge">{{ session.pendingCount }} ожидает</span>
              }
            </div>
          </button>
        }
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; }

    .panel {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0;
    }

    /* ── Header ── */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 0 14px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      margin-bottom: 14px;
      flex-shrink: 0;
    }

    .panel-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 0.85rem;
      font-weight: 500;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0;
    }

    .btn-order-new {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 6px 14px;
      background: rgba(245,158,11,0.1);
      border: 1px solid rgba(245,158,11,0.3);
      border-radius: 999px;
      color: #f59e0b;
      font-size: 0.78rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
      white-space: nowrap;
    }

    .btn-order-new:hover {
      background: rgba(245,158,11,0.18);
      border-color: rgba(245,158,11,0.5);
    }

    /* ── Stats bar ── */
    .stats-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 10px;
      flex-shrink: 0;
    }

    .stat-pill {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 999px;
      letter-spacing: 0.03em;
    }

    .stat-amber { background: rgba(245,158,11,0.12); color: #f59e0b; }
    .stat-green { background: rgba(34,197,94,0.12); color: #22c55e; }
    .stat-blue  { background: rgba(59,130,246,0.12); color: #3b82f6; }

    /* ── Hint strip ── */
    .hint-strip {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.76rem;
      color: #f59e0b;
      background: rgba(245,158,11,0.06);
      border: 1px solid rgba(245,158,11,0.15);
      border-radius: 8px;
      padding: 7px 12px;
      margin-bottom: 12px;
      flex-shrink: 0;
    }

    .hint-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f59e0b;
      flex-shrink: 0;
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(245,158,11,0.5); }
      50%       { opacity: 0.7; box-shadow: 0 0 0 4px rgba(245,158,11,0); }
    }

    /* ── Sessions list ── */
    .sessions-list {
      flex: 1;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.08) transparent;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* ── Session card ── */
    .session-card {
      position: relative;
      display: block;
      width: 100%;
      text-align: left;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 11px;
      padding: 0;
      overflow: hidden;
      cursor: pointer;
      font-family: inherit;
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
    }

    .session-card:hover {
      border-color: rgba(245,158,11,0.3);
      transform: translateX(2px);
    }

    .session-card.is-active {
      border-color: rgba(245,158,11,0.5);
      background: var(--ed-surface-container-high, #222222);
      box-shadow: 0 0 0 1px rgba(245,158,11,0.2) inset;
    }

    /* Left accent line, changes color by status */
    .sc-line {
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      border-radius: 3px 0 0 3px;
      transition: background 0.2s;
    }

    .s-pending   .sc-line { background: #f59e0b; }
    .s-approved  .sc-line { background: #22c55e; }
    .s-rejected  .sc-line { background: #ef4444; }
    .s-changes   .sc-line { background: #3b82f6; }

    /* Card content */
    .sc-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 14px 6px 16px;
    }

    .sc-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .sc-name {
      font-size: 0.87rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .sc-photo-count {
      font-size: 0.72rem;
      color: var(--ed-on-surface-muted, #666);
      flex-shrink: 0;
    }

    .sc-status-text {
      font-size: 0.75rem;
      color: var(--ed-on-surface-muted, #666);
      padding: 0 14px 8px 16px;
      line-height: 1;
    }

    .sc-status-text.st-action {
      color: #f59e0b;
      opacity: 0.8;
    }

    /* Thumbnails */
    .sc-thumbs {
      display: flex;
      gap: 4px;
      padding: 4px 14px 8px 16px;
    }

    .sc-thumb {
      position: relative;
      width: 44px;
      height: 44px;
      border-radius: 6px;
      overflow: hidden;
      background: var(--ed-surface, #0a0a0a);
      flex-shrink: 0;
    }

    .sc-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .sc-thumb-ph {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      opacity: 0.3;
    }
    .sc-thumb-ph mat-icon { font-size: 18px; width: 18px; height: 18px; }

    .sc-thumb-dot {
      position: absolute;
      bottom: 2px;
      right: 2px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      border: 1.5px solid rgba(0,0,0,0.6);
    }

    .sc-thumb-more {
      width: 44px;
      height: 44px;
      border-radius: 6px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.06);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      color: var(--ed-on-surface-muted, #666);
      flex-shrink: 0;
    }

    .sc-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 14px 10px 16px;
      border-top: 1px solid rgba(255,255,255,0.04);
    }

    .sc-view-hint {
      font-size: 0.72rem;
      color: var(--ed-on-surface-muted, #666);
      transition: color 0.2s;
    }

    .session-card:hover .sc-view-hint {
      color: #f59e0b;
    }

    .sc-pending-badge {
      font-size: 0.68rem;
      font-weight: 700;
      color: #f59e0b;
      background: rgba(245,158,11,0.12);
      border-radius: 999px;
      padding: 2px 8px;
    }

    /* Status dot colors */
    .dot-pending { background: #f59e0b; }
    .dot-approved { background: #22c55e; }
    .dot-rejected { background: #ef4444; }
    .dot-changes { background: #3b82f6; }
  `
})
export class SessionListPanelComponent {
  readonly sessions = input.required<ApprovalSession[]>();
  readonly selectedSessionId = input<string | null>(null);
  readonly stats = input<ApprovalStats | null>(null);

  readonly sessionSelected = output<string>();
  readonly orderNewClicked = output<void>();

  statusText(status: ApprovalSession['overallStatus']): string {
    switch (status) {
      case 'pending':           return 'Ожидает вашего решения';
      case 'approved':          return 'Завершено, всё одобрено';
      case 'rejected':          return 'Отклонено';
      case 'changes_requested': return 'Запрошены правки';
      case 'mixed':             return 'Частично рассмотрено';
    }
  }

  thumbUrl(item: { originalPhotoUrl: string; retouchedPhotoUrl: string }): string {
    return item.retouchedPhotoUrl || item.originalPhotoUrl || '';
  }
}
