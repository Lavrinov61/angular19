import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { ReviewPhoto } from '../../../features/photo-review/photo-review.service';

@Component({
  selector: 'app-photo-annotations-layer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule],
  host: { class: 'photo-annotations-layer' },
  template: `
    <!-- Existing annotation pins -->
    @for (a of annotations(); track a.id; let i = $index) {
      @if (isPin(a)) {
        <div class="annotation-pin"
             [style.left.%]="a.annotation['x']"
             [style.top.%]="a.annotation['y']"
             [style.transform]="'translate(-50%, -100%) scale(' + (1 / zoomScale()) + ')'">
          <span class="pin-number">{{ i + 1 }}</span>
          <div class="pin-tooltip">{{ getAnnotationText(a) }}</div>
        </div>
      }
    }

    <!-- New pin placement -->
    @if (newPin(); as pin) {
      <div class="annotation-pin new-pin"
           [style.left.%]="pin.x"
           [style.top.%]="pin.y"
           [style.transform]="'translate(-50%, -100%) scale(' + (1 / zoomScale()) + ')'">
        <span class="pin-number">+</span>
      </div>

      <div class="annotation-input">
        <input type="text" [(ngModel)]="annotationText" placeholder="Комментарий к отметке..."
               (keydown.enter)="onSubmit()" />
        <button mat-icon-button (click)="onSubmit()" [disabled]="!annotationText.trim()">
          <mat-icon>send</mat-icon>
        </button>
        <button mat-icon-button (click)="onCancel()">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: absolute;
      inset: 0;
      pointer-events: none;
      z-index: 5;
    }

    .annotation-pin {
      position: absolute;
      transform: translate(-50%, -100%);
      z-index: 5;
      cursor: pointer;
      pointer-events: auto;

      .pin-number {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 50% 50% 50% 0;
        background: var(--ed-error, #ef4444);
        color: #fff;
        font-size: 11px;
        font-weight: 700;
        transform: rotate(-45deg);
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
      }

      &.new-pin .pin-number {
        background: var(--ed-accent, #f59e0b);
        animation: pin-pulse 1s infinite;
      }

      .pin-tooltip {
        display: none;
        position: absolute;
        bottom: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 6px 10px;
        border-radius: 8px;
        font-size: 12px;
        white-space: nowrap;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      &:hover .pin-tooltip { display: block; }
    }

    @keyframes pin-pulse {
      0%, 100% { transform: rotate(-45deg) scale(1); }
      50% { transform: rotate(-45deg) scale(1.15); }
    }

    .annotation-input {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 8px 12px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.3);
      border-radius: 12px;
      pointer-events: auto;

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
export class PhotoAnnotationsLayerComponent {
  readonly annotations = input.required<ReviewPhoto['annotations']>();
  readonly newPin = input<{ x: number; y: number } | null>(null);
  readonly zoomScale = input(1);

  readonly annotationSubmitted = output<{ x: number; y: number; comment: string }>();
  readonly annotationCancelled = output<void>();

  annotationText = '';

  isPin(a: ReviewPhoto['annotations'][number]): boolean {
    return a.annotation['type'] === 'pin' && a.annotation['x'] != null;
  }

  getAnnotationText(a: ReviewPhoto['annotations'][number]): string {
    return (a.annotation as Record<string, string>)['comment'] || '';
  }

  onSubmit(): void {
    const pin = this.newPin();
    const text = this.annotationText.trim();
    if (!pin || !text) return;
    this.annotationSubmitted.emit({ x: pin.x, y: pin.y, comment: text });
    this.annotationText = '';
  }

  onCancel(): void {
    this.annotationText = '';
    this.annotationCancelled.emit();
  }
}
