import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { OfflineQueueService } from '../../services/offline-queue.service';

@Component({
  selector: 'app-queue-indicator',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    @if (queue.pendingCount() > 0 || queue.failedCount() > 0) {
      <div class="qi"
           [class.qi--syncing]="queue.syncStatus() === 'syncing'"
           [class.qi--failed]="queue.failedCount() > 0 && queue.syncStatus() !== 'syncing'">
        @if (queue.syncStatus() === 'syncing') {
          <span class="qi-spinner"></span>
        } @else if (queue.failedCount() > 0) {
          <mat-icon class="qi-icon">error_outline</mat-icon>
        } @else {
          <mat-icon class="qi-icon">cloud_queue</mat-icon>
        }
        <span class="qi-count">
          {{ queue.failedCount() > 0 ? queue.failedCount() : queue.pendingCount() }}
        </span>
      </div>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      bottom: 8px;
      right: 16px;
      z-index: 1050;
      pointer-events: none;
    }

    .qi {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      background: var(--ed-surface-container, #1e1e1e);
      color: var(--ed-on-surface-variant, #a0a0a0);
      border: 1px solid var(--ed-outline, #333);
      opacity: 0.85;
      pointer-events: auto;
      cursor: default;

      &--syncing {
        color: #93c5fd;
        border-color: rgba(147, 197, 253, 0.3);
      }

      &--failed {
        color: #f87171;
        border-color: rgba(248, 113, 113, 0.3);
      }
    }

    .qi-spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 1.5px solid rgba(255, 255, 255, 0.2);
      border-top-color: currentColor;
      border-radius: 50%;
      animation: qi-spin 0.75s linear infinite;
    }

    @keyframes qi-spin {
      to { transform: rotate(360deg); }
    }

    .qi-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .qi-count {
      line-height: 1;
    }
  `]
})
export class QueueIndicatorComponent {
  protected readonly queue = inject(OfflineQueueService);
}
