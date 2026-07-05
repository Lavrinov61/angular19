import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy, OnChanges,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface PhotoFeedback {
  photoId: string;
  url: string;
  rating: 'like' | 'dislike' | null;
  comment: string;
  isSelected: boolean;
}

export interface FeedbackSubmission {
  selectedPhotoId: string;
  allFeedback: PhotoFeedback[];
}

@Component({
  selector: 'app-photo-feedback',
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatBadgeModule,
    MatTooltipModule
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="photo-feedback">
      <!-- Header -->
      <div class="feedback-header">
        <div class="header-icon">
          <mat-icon>touch_app</mat-icon>
        </div>
        <div class="header-text">
          <h3>Выберите вариант</h3>
          <p>Оцените обработку и напишите пожелания</p>
        </div>
      </div>

      <!-- Photos Grid -->
      <div class="photos-grid">
        @for (photo of photos(); track photo.photoId; let i = $index) {
          <div 
            class="photo-card"
            [class.selected]="photo.isSelected"
            [class.liked]="photo.rating === 'like'"
            [class.disliked]="photo.rating === 'dislike'"
          >
            <!-- Photo -->
            <div class="photo-container" (click)="selectPhoto(photo.photoId)" (keydown.enter)="selectPhoto(photo.photoId)" tabindex="0">
              <img [src]="photo.url" [alt]="'Вариант ' + (i + 1)" />
              <div class="photo-number">{{ i + 1 }}</div>
              
              @if (photo.isSelected) {
                <div class="selected-overlay">
                  <mat-icon>check_circle</mat-icon>
                  <span>Выбрано</span>
                </div>
              }
            </div>

            <!-- Actions -->
            <div class="photo-actions">
              <button 
                class="action-btn like"
                [class.active]="photo.rating === 'like'"
                (click)="toggleRating(photo.photoId, 'like')"
                matTooltip="Нравится"
              >
                <mat-icon>{{ photo.rating === 'like' ? 'thumb_up' : 'thumb_up_off_alt' }}</mat-icon>
              </button>

              <button 
                class="action-btn dislike"
                [class.active]="photo.rating === 'dislike'"
                (click)="toggleRating(photo.photoId, 'dislike')"
                matTooltip="Не нравится"
              >
                <mat-icon>{{ photo.rating === 'dislike' ? 'thumb_down' : 'thumb_down_off_alt' }}</mat-icon>
              </button>

              <button 
                class="action-btn comment"
                [class.has-comment]="photo.comment.length > 0"
                (click)="toggleComment(photo.photoId)"
                matTooltip="Добавить пожелание"
                [matBadge]="photo.comment.length > 0 ? '!' : null"
                matBadgeSize="small"
              >
                <mat-icon>edit_note</mat-icon>
              </button>
            </div>

            <!-- Comment Input -->
            @if (activeCommentId() === photo.photoId) {
              <div class="comment-input" @slideDown>
                <textarea
                  [(ngModel)]="photo.comment"
                  placeholder="Ваши пожелания к этому варианту..."
                  rows="2"
                  (blur)="saveComment(photo)"
                ></textarea>
                <div class="comment-hints">
                  <button 
                    class="hint-chip" 
                    (click)="addHint(photo.photoId, 'Сделать ярче')"
                  >Сделать ярче</button>
                  <button 
                    class="hint-chip" 
                    (click)="addHint(photo.photoId, 'Убрать тень')"
                  >Убрать тень</button>
                  <button 
                    class="hint-chip" 
                    (click)="addHint(photo.photoId, 'Подправить волосы')"
                  >Волосы</button>
                  <button 
                    class="hint-chip" 
                    (click)="addHint(photo.photoId, 'Другой фон')"
                  >Другой фон</button>
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Summary & Submit -->
      @if (hasSelection()) {
        <div class="feedback-summary">
          <div class="summary-info">
            <mat-icon>check_circle</mat-icon>
            <span>Выбран вариант {{ selectedIndex() }}</span>
            @if (commentsCount() > 0) {
              <span class="comments-badge">+ {{ commentsCount() }} пожелания</span>
            }
          </div>
          <button 
            class="submit-btn"
            (click)="submitFeedback()"
          >
            <mat-icon>send</mat-icon>
            Подтвердить выбор
          </button>
        </div>
      } @else {
        <div class="feedback-hint">
          <mat-icon>info</mat-icon>
          <span>Нажмите на фото, чтобы выбрать финальный вариант</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .photo-feedback {
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 20px;
      padding: 16px;
      margin: 8px 0;
    }

    /* ============ Header ============ */
    .feedback-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }

    .header-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        color: white;
      }
    }

    .header-text {
      h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        color: var(--ed-on-surface, #f5f5f5);
      }

      p {
        margin: 2px 0 0;
        font-size: 0.8rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    /* ============ Photos Grid ============ */
    .photos-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
    }

    .photo-card {
      background: var(--ed-surface, #0a0a0a);
      border-radius: 16px;
      overflow: hidden;
      border: 2px solid transparent;
      transition: all 0.3s ease;

      &.selected {
        border-color: #667eea;
        box-shadow: 0 4px 20px rgba(102, 126, 234, 0.3);
      }

      &.liked {
        .photo-container::after {
          content: '';
          position: absolute;
          inset: 0;
          border: 3px solid #4ade80;
          border-radius: 14px;
          pointer-events: none;
        }
      }

      &.disliked {
        opacity: 0.6;
      }
    }

    .photo-container {
      position: relative;
      aspect-ratio: 3/4;
      cursor: pointer;
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.3s;
      }

      &:hover img {
        transform: scale(1.05);
      }
    }

    .photo-number {
      position: absolute;
      top: 8px;
      left: 8px;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      font-weight: 600;
      backdrop-filter: blur(10px);
    }

    .selected-overlay {
      position: absolute;
      inset: 0;
      background: rgba(102, 126, 234, 0.85);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: white;
      animation: fadeIn 0.3s ease;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
      }

      span {
        font-weight: 600;
      }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }

    /* ============ Actions ============ */
    .photo-actions {
      display: flex;
      justify-content: center;
      gap: 8px;
      padding: 10px;
    }

    .action-btn {
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      background: var(--ed-surface-container-high, #222);
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover {
        transform: scale(1.1);
      }

      &.like.active {
        background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
        color: white;
      }

      &.dislike.active {
        background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
        color: white;
      }

      &.comment.has-comment {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
    }

    /* ============ Comment Input ============ */
    .comment-input {
      padding: 0 10px 10px;
      animation: slideDown 0.3s ease;

      textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--ed-outline-variant, #2a2a2a);
        border-radius: 12px;
        background: var(--ed-surface, #0a0a0a);
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 0.85rem;
        resize: none;
        outline: none;
        font-family: inherit;

        &:focus {
          border-color: #667eea;
        }

        &::placeholder {
          color: var(--ed-on-surface-variant, #a0a0a0);
        }
      }
    }

    @keyframes slideDown {
      from { opacity: 0; max-height: 0; }
      to { opacity: 1; max-height: 200px; }
    }

    .comment-hints {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .hint-chip {
      padding: 4px 10px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 100px;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.7rem;
      cursor: pointer;
      transition: all 0.2s;

      &:hover {
        background: rgba(102, 126, 234, 0.1);
        border-color: #667eea;
        color: #667eea;
      }
    }

    /* ============ Summary ============ */
    .feedback-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 16px;
      padding: 12px 16px;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-radius: 14px;
    }

    .summary-info {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #667eea;
      font-size: 0.9rem;
      font-weight: 500;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .comments-badge {
      background: rgba(102, 126, 234, 0.2);
      padding: 2px 8px;
      border-radius: 100px;
      font-size: 0.75rem;
    }

    .submit-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      border: none;
      border-radius: 100px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
      }
    }

    .feedback-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-top: 12px;
      padding: 10px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.85rem;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    /* ============ Responsive ============ */
    @media (max-width: 400px) {
      .photos-grid {
        grid-template-columns: 1fr;
      }

      .feedback-summary {
        flex-direction: column;
        text-align: center;
      }
    }
  `],
})
export class PhotoFeedbackComponent implements OnChanges {
  // Input: list of photo URLs to rate
  photoUrls = input<string[]>([]);

  // Output: when user submits their selection
  feedbackSubmitted = output<FeedbackSubmission>();

  // Internal state
  photos = signal<PhotoFeedback[]>([]);
  activeCommentId = signal<string | null>(null);

  // Computed
  hasSelection = computed(() => this.photos().some(p => p.isSelected));
  selectedIndex = computed(() => {
    const index = this.photos().findIndex(p => p.isSelected);
    return index >= 0 ? index + 1 : 0;
  });
  commentsCount = computed(() => this.photos().filter(p => p.comment.trim().length > 0).length);

  constructor() {
    // Initialize photos when input changes
    // Using effect would be better but keeping it simple
  }

  ngOnChanges(): void {
    this.photos.set(
      this.photoUrls().map((url, i) => ({
        photoId: `photo-${i}`,
        url,
        rating: null,
        comment: '',
        isSelected: false,
      }))
    );
  }

  selectPhoto(photoId: string): void {
    this.photos.update(photos =>
      photos.map(p => ({
        ...p,
        isSelected: p.photoId === photoId,
      }))
    );
  }

  toggleRating(photoId: string, rating: 'like' | 'dislike'): void {
    this.photos.update(photos =>
      photos.map(p => {
        if (p.photoId !== photoId) return p;
        return {
          ...p,
          rating: p.rating === rating ? null : rating,
        };
      })
    );
  }

  toggleComment(photoId: string): void {
    this.activeCommentId.update(id => id === photoId ? null : photoId);
  }

  addHint(photoId: string, hint: string): void {
    this.photos.update(photos =>
      photos.map(p => {
        if (p.photoId !== photoId) return p;
        const separator = p.comment.trim() ? '. ' : '';
        return {
          ...p,
          comment: p.comment.trim() + separator + hint,
        };
      })
    );
  }

  saveComment(_photo: PhotoFeedback): void {
    // Comment is already bound via ngModel, just close the input
    this.activeCommentId.set(null);
  }

  submitFeedback(): void {
    const selected = this.photos().find(p => p.isSelected);
    if (!selected) return;

    this.feedbackSubmitted.emit({
      selectedPhotoId: selected.photoId,
      allFeedback: this.photos(),
    });
  }
}
