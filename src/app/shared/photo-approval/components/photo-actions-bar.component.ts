import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-photo-actions-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  host: { class: 'photo-actions-bar' },
  template: `
    @if (status() === 'pending' || status() === 'changes_requested') {
      <div class="action-buttons">
        <button mat-flat-button class="approve-btn" (click)="approved.emit()"
                [disabled]="actionLoading()">
          @if (actionLoading()) {
            <mat-icon class="spin-icon">sync</mat-icon>
          } @else {
            <mat-icon>check_circle</mat-icon>
          }
          Мне нравится!
        </button>
        <button mat-stroked-button class="changes-btn" (click)="changesRequested.emit()"
                [disabled]="actionLoading()">
          <mat-icon>edit_note</mat-icon> Хочу изменения
        </button>
      </div>
    } @else if (status() === 'approved' || status() === 'rejected') {
      <div class="status-display">
        @if (status() === 'approved') {
          <div class="status-chip approved-chip"><mat-icon>check</mat-icon> Одобрено</div>
        } @else {
          <div class="status-chip rejected-chip"><mat-icon>close</mat-icon> На доработке</div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }

    .action-buttons {
      display: flex;
      gap: 12px;

      button {
        flex: 1;
        height: 48px;
        font-size: 15px;
        min-height: 44px;
      }
    }

    .approve-btn {
      background: #22c55e !important;
      color: #0a0a0a !important;
      font-weight: 600;
    }

    .changes-btn {
      color: var(--ed-on-surface-variant, #a0a0a0) !important;
      border-color: var(--ed-outline-variant, #2a2a2a) !important;
    }

    .spin-icon {
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .status-display { text-align: center; padding: 8px 0; }

    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 20px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &.approved-chip { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
      &.rejected-chip { background: rgba(239, 68, 68, 0.15); color: var(--ed-error, #ef4444); }
    }
  `,
})
export class PhotoActionsBarComponent {
  readonly status = input.required<string>();
  readonly actionLoading = input(false);

  readonly approved = output<void>();
  readonly changesRequested = output<void>();
}
