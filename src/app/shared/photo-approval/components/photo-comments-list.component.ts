import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { ReviewPhoto } from '../../../features/photo-review/photo-review.service';

@Component({
  selector: 'app-photo-comments-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'photo-comments-list' },
  template: `
    @for (a of annotations(); track a.id; let i = $index) {
      <div class="comment-bubble"
           [class.pin-comment]="isPin(a)"
           [class.operator-comment]="isOperatorClarification(a)">
        @if (isOperatorClarification(a)) {
          <mat-icon>support_agent</mat-icon>
        } @else if (isPin(a)) {
          <span class="comment-pin-num">{{ i + 1 }}</span>
        } @else {
          <mat-icon>comment</mat-icon>
        }
        <span>{{ getAnnotationText(a) }}</span>
      </div>
    }
  `,
  styles: `
    :host { display: block; }

    .comment-bubble {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 8px 12px;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 12px;
      margin-bottom: 6px;
      font-size: 14px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        flex-shrink: 0;
        margin-top: 2px;
      }

      &.pin-comment {
        border-left: 3px solid var(--ed-error, #ef4444);
      }

      &.operator-comment {
        background: rgba(59, 130, 246, 0.1);
        border-left: 3px solid #3b82f6;
        mat-icon { color: #3b82f6; }
      }

      .comment-pin-num {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: var(--ed-error, #ef4444);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        flex-shrink: 0;
      }
    }
  `,
})
export class PhotoCommentsListComponent {
  readonly annotations = input.required<ReviewPhoto['annotations']>();

  isPin(a: ReviewPhoto['annotations'][number]): boolean {
    return a.annotation['type'] === 'pin' && a.annotation['x'] != null;
  }

  isOperatorClarification(a: ReviewPhoto['annotations'][number]): boolean {
    return a.annotation['type'] === 'operator_clarification';
  }

  getAnnotationText(a: ReviewPhoto['annotations'][number]): string {
    return (a.annotation as Record<string, string>)['comment'] || '';
  }
}
