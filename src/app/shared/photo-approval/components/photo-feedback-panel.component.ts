import { Component, ChangeDetectionStrategy, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-photo-feedback-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule],
  host: { class: 'photo-feedback-panel' },
  template: `
    <div class="feedback-label">
      <mat-icon>edit_note</mat-icon>
      <span>Что бы вы хотели изменить?</span>
    </div>

    <div class="feedback-chips">
      @for (chip of feedbackChips; track chip) {
        <button class="chip" (click)="addChip(chip)">{{ chip }}</button>
      }
    </div>

    <textarea [(ngModel)]="commentText"
              placeholder="Например: сделать кожу теплее, убрать фон..."
              rows="3"
              [class.needs-comment]="needsComment()"
              (input)="needsComment.set(false)"></textarea>

    @if (needsComment()) {
      <p class="needs-comment-hint">Введите текст пожелания</p>
    }

    <div class="feedback-actions">
      <button mat-flat-button class="send-feedback-btn" (click)="onSubmit()"
              [disabled]="actionLoading()">
        @if (actionLoading()) {
          <mat-icon class="spin-icon">sync</mat-icon>
        } @else {
          <mat-icon>send</mat-icon>
        }
        Отправить пожелания
      </button>
      <button mat-stroked-button (click)="cancelled.emit()">
        Отмена
      </button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 12px;
      background: rgba(245, 158, 11, 0.06);
      border: 1px solid rgba(245, 158, 11, 0.25);
      border-radius: 14px;

      &:has(.needs-comment) {
        border-color: var(--ed-error, #ef4444);
        animation: shake 0.4s ease;
      }
    }

    .feedback-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #f59e0b;
      margin-bottom: 8px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .feedback-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .chip {
      padding: 4px 12px;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.06);
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;

      &:hover {
        background: rgba(245, 158, 11, 0.15);
        border-color: rgba(245, 158, 11, 0.3);
        color: #f59e0b;
      }
    }

    textarea {
      width: 100%;
      min-height: 72px;
      resize: vertical;
      border: none;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 14px;
      color: var(--ed-on-surface, #f5f5f5);
      outline: none;
      margin-bottom: 10px;
      box-sizing: border-box;

      &::placeholder { color: var(--ed-on-surface-variant, #a0a0a0); }

      &.needs-comment {
        border: 1px solid var(--ed-error, #ef4444);
      }
    }

    .needs-comment-hint {
      font-size: 12px;
      color: var(--ed-error, #ef4444);
      margin: -6px 0 8px 4px;
    }

    .feedback-actions {
      display: flex;
      gap: 8px;

      button { flex: 1; height: 40px; }
    }

    .send-feedback-btn {
      background: #f59e0b !important;
      color: #0a0a0a !important;
      font-weight: 600;
    }

    .spin-icon {
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-4px); }
      40% { transform: translateX(4px); }
      60% { transform: translateX(-3px); }
      80% { transform: translateX(3px); }
    }
  `,
})
export class PhotoFeedbackPanelComponent {
  readonly actionLoading = input(false);

  readonly feedbackSubmitted = output<string>();
  readonly cancelled = output<void>();

  readonly feedbackChips = ['Кожа', 'Цвет', 'Фон', 'Глаза', 'Волосы'] as const;
  readonly needsComment = signal(false);
  commentText = '';

  addChip(chip: string): void {
    this.commentText = this.commentText
      ? `${this.commentText}, ${chip.toLowerCase()}`
      : chip;
  }

  onSubmit(): void {
    const text = this.commentText.trim();
    if (!text) {
      this.needsComment.set(true);
      return;
    }
    this.feedbackSubmitted.emit(text);
    this.commentText = '';
    this.needsComment.set(false);
  }
}
