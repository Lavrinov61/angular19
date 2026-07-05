import {
  Component, ChangeDetectionStrategy, input, output,
  ElementRef, viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-photo-compare-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  host: { class: 'photo-compare-viewer' },
  template: `
    @if (compareMode() === 'slider' && originalUrl()) {
      <!-- Slider comparison -->
      <div class="compare-container"
           (mousemove)="onSliderMove($event)"
           (touchmove)="onSliderMove($event)">
        <img [src]="originalUrl()!" class="compare-img" alt="Оригинал" />
        <img [src]="retouchedUrl()" class="compare-img compare-retouched" alt="Ретушь"
             [style.clip-path]="'inset(0 ' + (100 - sliderPosition()) + '% 0 0)'" />
        <div class="compare-slider" [style.left.%]="sliderPosition()">
          <div class="slider-handle">
            <mat-icon>drag_indicator</mat-icon>
          </div>
        </div>
        <span class="compare-label compare-label-left">Исходник</span>
        <span class="compare-label compare-label-right">Обработка</span>
      </div>
    } @else {
      <!-- Tap-toggle mode -->
      <div class="tap-toggle-area"
           [class.placing-pin]="placingAnnotation()"
           (click)="onAreaClick($event)"
           (keydown.enter)="onAreaClick($event)"
           tabindex="0"
           role="button">
        <img [src]="retouchedUrl()" alt="Просмотр" class="stories-image"
             [class.toggled-away]="showingOriginal()"
             [class.transitioning]="transitioning()" />

        @if (originalUrl()) {
          <img [src]="originalUrl()!" alt="Ваше фото"
               class="stories-image original-layer"
               [class.toggled-visible]="showingOriginal()"
               [class.transitioning]="transitioning()" />
        }

        @if (originalUrl()) {
          <div class="compare-state-badge" [class.showing-original]="showingOriginal()">
            <mat-icon>{{ showingOriginal() ? 'photo_camera' : 'auto_fix_high' }}</mat-icon>
            <span>{{ showingOriginal() ? 'Ваше фото' : 'Обработка' }}</span>
          </div>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      width: 100%;
    }

    .tap-toggle-area {
      position: relative;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;

      &.placing-pin { cursor: crosshair; }
    }

    .stories-image {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      height: auto;
      object-fit: contain;
      user-select: none;
      -webkit-user-drag: none;
      will-change: opacity;
      transition: opacity 300ms ease;
      display: block;

      &.toggled-away { opacity: 0; }
      &.transitioning { transition: opacity 150ms ease; }
    }

    .original-layer {
      position: absolute;
      inset: 0;
      max-width: 100%;
      max-height: 100%;
      margin: auto;
      opacity: 0;
      transition: opacity 300ms ease;
      pointer-events: none;
      z-index: 3;

      &.toggled-visible { opacity: 1; }
      &.transitioning { transition: opacity 150ms ease; }
    }

    .compare-state-badge {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border-radius: 16px;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: rgba(255, 255, 255, 0.8);
      font-size: 11px;
      font-weight: 500;
      pointer-events: none;
      transition: background 0.3s, color 0.3s;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.showing-original {
        background: rgba(245, 158, 11, 0.75);
        color: #fff;
      }
    }

    /* Slider comparison */
    .compare-container {
      position: relative;
      cursor: ew-resize;
      user-select: none;
      touch-action: none;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
    }

    .compare-img {
      width: 100%;
      object-fit: contain;
      display: block;
      user-select: none;
    }

    .compare-retouched {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
    }

    .compare-slider {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 3px;
      background: #fff;
      transform: translateX(-50%);
      z-index: 2;

      .slider-handle {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: #333;
          transform: rotate(90deg);
        }
      }
    }

    .compare-label {
      position: absolute;
      bottom: 8px;
      padding: 4px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      z-index: 3;

      &-left { left: 8px; }
      &-right { right: 8px; }
    }
  `,
})
export class PhotoCompareViewerComponent {
  private readonly hostRef = viewChild<ElementRef<HTMLElement>>('tapToggleArea');

  readonly retouchedUrl = input.required<string>();
  readonly originalUrl = input<string | null>(null);
  readonly showingOriginal = input(false);
  readonly compareMode = input<'tap-toggle' | 'slider'>('tap-toggle');
  readonly sliderPosition = input(50);
  readonly placingAnnotation = input(false);
  readonly transitioning = input(false);

  readonly originalToggled = output<void>();
  readonly sliderMoved = output<number>();
  readonly imageClicked = output<{ x: number; y: number }>();

  onAreaClick(event: Event): void {
    if (this.placingAnnotation() && event instanceof MouseEvent) {
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      this.imageClicked.emit({ x, y });
      return;
    }
    this.originalToggled.emit();
  }

  onSliderMove(event: MouseEvent | TouchEvent): void {
    const target = (event.currentTarget as HTMLElement);
    const rect = target.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : (event as MouseEvent).clientX;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    this.sliderMoved.emit(pct);
  }
}
