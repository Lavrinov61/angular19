import {
  Component, ChangeDetectionStrategy, inject, input, output, signal,
  OnDestroy, effect, HostListener,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { PhotoApprovalStore } from '../photo-approval-store.service';
import { PhotoCompareViewerComponent } from './photo-compare-viewer.component';
import { PhotoAnnotationsLayerComponent } from './photo-annotations-layer.component';
import { PhotoVariantsGridComponent } from './photo-variants-grid.component';
import { PhotoCommentsListComponent } from './photo-comments-list.component';
import { PhotoFeedbackPanelComponent } from './photo-feedback-panel.component';
import { PhotoActionsBarComponent } from './photo-actions-bar.component';
import { PhotoToolbarComponent } from './photo-toolbar.component';

@Component({
  selector: 'app-photo-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    PhotoCompareViewerComponent, PhotoAnnotationsLayerComponent,
    PhotoVariantsGridComponent, PhotoCommentsListComponent,
    PhotoFeedbackPanelComponent, PhotoActionsBarComponent, PhotoToolbarComponent,
  ],
  host: { class: 'photo-detail-panel' },
  template: `
    @if (store.loading()) {
      <div class="panel-center">
        <mat-spinner diameter="40" />
        <p>Загружаем фотографии...</p>
      </div>
    } @else if (store.error()) {
      <div class="panel-center error-state">
        <mat-icon>error_outline</mat-icon>
        <h3>{{ store.error() }}</h3>
      </div>
    } @else if (store.completed()) {
      <div class="panel-center completed-state">
        <div class="completion-check">
          <svg viewBox="0 0 52 52" class="check-svg">
            <circle class="check-circle" cx="26" cy="26" r="25" fill="none"/>
            <path class="check-path" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
          </svg>
        </div>
        <h3>Отличный выбор!</h3>
        <p>Фотография уже в вашем личном кабинете</p>
      </div>
    } @else if (store.selectedPhoto()) {
      @if (store.selectedPhoto(); as photo) {
        <app-photo-toolbar
          [currentIndex]="store.currentPhotoIndex()"
          [totalCount]="store.photos().length"
          [hasOriginal]="!!photo.original_photo_url"
          [compareMode]="sliderMode()"
          [placingAnnotation]="placingAnnotation()"
          [fullscreen]="fullscreen()"
          (prevClicked)="store.prevPhoto()"
          (nextClicked)="store.nextPhoto()"
          (compareToggled)="toggleSliderMode()"
          (annotationStarted)="placingAnnotation.set(true)"
          (fullscreenToggled)="toggleFullscreen()" />

        <div class="image-area" [class.fullscreen-active]="fullscreen()">
          <app-photo-compare-viewer
            [retouchedUrl]="store.displayUrl() || ''"
            [originalUrl]="photo.original_photo_url"
            [showingOriginal]="showingOriginal()"
            [compareMode]="currentCompareMode()"
            [sliderPosition]="sliderPosition()"
            [placingAnnotation]="placingAnnotation()"
            (originalToggled)="toggleOriginal()"
            (sliderMoved)="sliderPosition.set($event)"
            (imageClicked)="onImageClick($event)" />

          <app-photo-annotations-layer
            [annotations]="photo.annotations"
            [newPin]="annotationPin()"
            (annotationSubmitted)="onAnnotationSubmit($event)"
            (annotationCancelled)="cancelAnnotation()" />
        </div>

        @if (photo.variants.length) {
          <app-photo-variants-grid
            [variants]="photo.variants"
            [selectedVariantId]="store.selectedVariant()?.id ?? null"
            (variantSelected)="store.selectVariant($event)" />
        }

        @if (photo.annotations.length) {
          <app-photo-comments-list [annotations]="photo.annotations" />
        }

        @if (feedbackMode()) {
          <app-photo-feedback-panel
            [actionLoading]="store.actionLoading()"
            (feedbackSubmitted)="onFeedback($event)"
            (cancelled)="feedbackMode.set(false)" />
        } @else {
          <div class="comment-input">
            <input type="text" [(ngModel)]="commentText" placeholder="Написать комментарий..."
                   (keydown.enter)="submitComment()" />
            <button mat-icon-button (click)="submitComment()" [disabled]="!commentText.trim()">
              <mat-icon>send</mat-icon>
            </button>
          </div>
        }

        <app-photo-actions-bar
          [status]="photo.status"
          [actionLoading]="store.actionLoading()"
          (approved)="onApprove()"
          (changesRequested)="feedbackMode.set(true)" />
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 14px;
      padding: 12px;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .panel-center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      min-height: 300px;

      p { color: var(--ed-on-surface-variant, #a0a0a0); margin-top: 12px; }
    }

    .error-state {
      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: var(--ed-error, #ef4444);
        margin-bottom: 12px;
      }
      h3 { margin: 0; }
    }

    .completed-state {
      h3 {
        margin: 0 0 8px;
        font-family: var(--ed-font-display, 'Oswald', sans-serif);
        font-size: 20px;
        font-weight: 700;
        text-transform: uppercase;
      }
      p { color: var(--ed-on-surface-variant, #a0a0a0); }
    }

    .completion-check { width: 52px; height: 52px; margin-bottom: 12px; }

    .check-svg { width: 52px; height: 52px; }

    .check-circle {
      stroke: #4ade80;
      stroke-width: 2;
      stroke-dasharray: 166;
      stroke-dashoffset: 166;
      animation: circleStroke 0.6s ease forwards;
    }

    .check-path {
      stroke: #4ade80;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 48;
      stroke-dashoffset: 48;
      animation: checkStroke 0.3s 0.4s ease forwards;
    }

    @keyframes circleStroke { to { stroke-dashoffset: 0; } }
    @keyframes checkStroke { to { stroke-dashoffset: 0; } }

    .image-area {
      position: relative;
      border-radius: 12px;
      overflow: hidden;
      background: #111;
      min-height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;

      &.fullscreen-active {
        position: fixed;
        inset: 0;
        z-index: 1000;
        border-radius: 0;
        background: #000;
        min-height: unset;
      }
    }

    .comment-input {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 12px;
      background: var(--ed-surface, #0a0a0a);
      border-radius: 24px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);

      input {
        flex: 1;
        border: none;
        background: transparent;
        outline: none;
        font-size: 14px;
        padding: 4px 0;
        color: var(--ed-on-surface, #f5f5f5);
      }
    }
  `,
})
export class PhotoDetailPanelComponent implements OnDestroy {
  readonly store = inject(PhotoApprovalStore);

  readonly token = input.required<string>();

  readonly photoReviewed = output<{ id: string; status: string }>();
  readonly sessionCompleted = output<void>();

  readonly sliderMode = signal(false);
  readonly sliderPosition = signal(50);
  readonly fullscreen = signal(false);
  readonly feedbackMode = signal(false);
  readonly placingAnnotation = signal(false);
  readonly annotationPin = signal<{ x: number; y: number } | null>(null);
  readonly showingOriginal = signal(false);

  commentText = '';

  readonly currentCompareMode = signal<'tap-toggle' | 'slider'>('tap-toggle');

  constructor() {
    effect(() => {
      const t = this.token();
      if (t) {
        this.store.loadSession(t);
      }
    });
  }

  ngOnDestroy(): void {
    this.store.reset();
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft') {
      this.store.prevPhoto();
    } else if (event.key === 'ArrowRight') {
      this.store.nextPhoto();
    } else if (event.key === 'Escape' && this.fullscreen()) {
      this.fullscreen.set(false);
    }
  }

  toggleFullscreen(): void {
    this.fullscreen.update(v => !v);
  }

  toggleOriginal(): void {
    const photo = this.store.selectedPhoto();
    if (!photo?.original_photo_url) return;
    this.showingOriginal.update(v => !v);
  }

  toggleSliderMode(): void {
    this.sliderMode.update(v => !v);
    this.currentCompareMode.set(this.sliderMode() ? 'slider' : 'tap-toggle');
    this.sliderPosition.set(50);
  }

  onImageClick(coords: { x: number; y: number }): void {
    this.annotationPin.set(coords);
    this.placingAnnotation.set(false);
  }

  onAnnotationSubmit(data: { x: number; y: number; comment: string }): void {
    this.store.addAnnotation(data.x, data.y, data.comment);
    this.annotationPin.set(null);
  }

  cancelAnnotation(): void {
    this.annotationPin.set(null);
    this.placingAnnotation.set(false);
  }

  onApprove(): void {
    this.store.approvePhoto();
    const photo = this.store.selectedPhoto();
    if (photo) {
      this.photoReviewed.emit({ id: photo.id, status: 'approved' });
    }
  }

  onFeedback(text: string): void {
    this.store.rejectPhoto(text);
    const photo = this.store.selectedPhoto();
    if (photo) {
      this.photoReviewed.emit({ id: photo.id, status: 'rejected' });
    }
    this.feedbackMode.set(false);
  }

  submitComment(): void {
    const text = this.commentText.trim();
    if (!text) return;
    this.store.addComment(text);
    this.commentText = '';
  }
}
