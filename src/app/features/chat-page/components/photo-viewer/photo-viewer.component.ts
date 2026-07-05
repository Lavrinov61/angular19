import {
  Component,
  input,
  output,
  ChangeDetectionStrategy,
} from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-photo-viewer',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
    '(document:keydown.arrowLeft)': 'onArrowLeft()',
    '(document:keydown.arrowRight)': 'onArrowRight()',
  },
  template: `
    <div class="photo-viewer-overlay" (click)="onBackdropClick($event)" (keydown.enter)="onBackdropClick($event)" tabindex="0">
      <div class="viewer-container">
        <!-- Header -->
        <div class="viewer-header">
          <span class="counter">{{ currentIndex() + 1 }} / {{ allImages().length }}</span>
          <div class="header-actions">
            <button mat-icon-button (click)="download.emit()">
              <mat-icon>download</mat-icon>
            </button>
            <button mat-icon-button (click)="closed.emit()">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        </div>

        <!-- Image -->
        <div class="image-container">
          @if (allImages().length > 1) {
            <button class="nav-button prev" mat-icon-button (click)="navigate.emit('prev')">
              <mat-icon>chevron_left</mat-icon>
            </button>
          }

          <img 
            [src]="imageUrl()" 
            [alt]="caption() || 'Фото'" 
            class="main-image"
            (load)="imageLoaded = true"
          />

          @if (allImages().length > 1) {
            <button class="nav-button next" mat-icon-button (click)="navigate.emit('next')">
              <mat-icon>chevron_right</mat-icon>
            </button>
          }
        </div>

        <!-- Caption -->
        @if (caption()) {
          <div class="viewer-caption">
            {{ caption() }}
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .photo-viewer-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.95);
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .viewer-container {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    /* ============ Header ============ */
    .viewer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      color: white;
    }

    .counter {
      font-size: 0.9rem;
      opacity: 0.8;
    }

    .header-actions {
      display: flex;
      gap: 4px;

      button {
        color: white;
      }
    }

    /* ============ Image ============ */
    .image-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      padding: 0 60px;
      overflow: hidden;
    }

    .main-image {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 8px;
      animation: zoomIn 0.3s ease;
    }

    @keyframes zoomIn {
      from { transform: scale(0.9); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .nav-button {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 48px;
      height: 48px;
      background: rgba(255, 255, 255, 0.1);
      color: white;
      backdrop-filter: blur(10px);
      transition: all 0.2s;

      &:hover {
        background: rgba(255, 255, 255, 0.2);
      }

      mat-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
      }

      &.prev {
        left: 8px;
      }

      &.next {
        right: 8px;
      }
    }

    /* ============ Caption ============ */
    .viewer-caption {
      padding: 12px 16px;
      text-align: center;
      color: rgba(255, 255, 255, 0.8);
      font-size: 0.9rem;
    }

    /* ============ Mobile ============ */
    @media (max-width: 480px) {
      .image-container {
        padding: 0 16px;
      }

      .nav-button {
        width: 40px;
        height: 40px;

        mat-icon {
          font-size: 28px;
          width: 28px;
          height: 28px;
        }

        &.prev {
          left: 4px;
        }

        &.next {
          right: 4px;
        }
      }
    }
  `],
})
export class PhotoViewerComponent {
  imageUrl = input.required<string>();
  caption = input<string>();
  allImages = input<unknown[]>([]);
  currentIndex = input(0);

  closed = output<void>();
  navigate = output<'prev' | 'next'>();
  download = output<void>();

  imageLoaded = false;

  onEscape(): void {
    this.closed.emit();
  }

  onArrowLeft(): void {
    if (this.allImages().length > 1) {
      this.navigate.emit('prev');
    }
  }

  onArrowRight(): void {
    if (this.allImages().length > 1) {
      this.navigate.emit('next');
    }
  }

  onBackdropClick(event: Event): void {
    if ((event.target as HTMLElement).classList.contains('photo-viewer-overlay')) {
      this.closed.emit();
    }
  }
}
