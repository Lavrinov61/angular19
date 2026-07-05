import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
  ElementRef,
  AfterViewInit,
  PLATFORM_ID,
  inject,
  viewChild
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-comparison-slider',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div 
      class="comparison-container"
      #container
      (mousedown)="startDrag($event)"
      (touchstart)="startDrag($event)"
    >
      @if (beforeImage() && afterImage()) {
        <!-- Before (background) -->
        <div class="before-container">
          <img [src]="beforeImage()" alt="До" class="comparison-image" />
          <span class="label before-label">До</span>
        </div>

        <!-- After (clipped) -->
        <div 
          class="after-container"
          [style.clip-path]="'inset(0 0 0 ' + sliderPosition() + '%)'"
        >
          <img [src]="afterImage()" alt="После" class="comparison-image" />
          <span class="label after-label">После</span>
        </div>

        <!-- Slider -->
        <div 
          class="slider-line"
          [style.left.%]="sliderPosition()"
        >
          <div class="slider-handle">
            <mat-icon>drag_handle</mat-icon>
          </div>
        </div>
      } @else {
        <div class="no-images">
          <mat-icon>compare</mat-icon>
          <p>Загрузите фото для сравнения</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .comparison-container {
      position: relative;
      width: 100%;
      aspect-ratio: 3/4;
      max-height: 400px;
      border-radius: 16px;
      overflow: hidden;
      cursor: ew-resize;
      user-select: none;
      background: var(--ed-surface-container, #1a1a1a);
    }

    .before-container,
    .after-container {
      position: absolute;
      inset: 0;
    }

    .comparison-image {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .label {
      position: absolute;
      bottom: 12px;
      padding: 6px 14px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      border-radius: 100px;
      font-size: 0.8rem;
      font-weight: 600;
      backdrop-filter: blur(10px);
    }

    .before-label {
      left: 12px;
    }

    .after-label {
      right: 12px;
    }

    .slider-line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 3px;
      background: white;
      box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
      transform: translateX(-50%);
    }

    .slider-handle {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: white;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;

      mat-icon {
        color: #667eea;
        transform: rotate(90deg);
      }
    }

    .no-images {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-align: center;
      gap: 8px;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        opacity: 0.5;
      }

      p {
        margin: 0;
        font-size: 0.9rem;
      }
    }
  `],
})
export class ComparisonSliderComponent implements AfterViewInit {
  beforeImage = input<string>();
  afterImage = input<string>();

  private platformId = inject(PLATFORM_ID);

  sliderPosition = signal(50);

  readonly container = viewChild<ElementRef<HTMLDivElement>>('container');

  private isDragging = false;

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      document.addEventListener('mousemove', this.onDrag.bind(this));
      document.addEventListener('mouseup', this.stopDrag.bind(this));
      document.addEventListener('touchmove', this.onDrag.bind(this));
      document.addEventListener('touchend', this.stopDrag.bind(this));
    }
  }

  startDrag(event: MouseEvent | TouchEvent): void {
    this.isDragging = true;
    this.updatePosition(event);
  }

  private onDrag(event: MouseEvent | TouchEvent): void {
    if (!this.isDragging) return;
    this.updatePosition(event);
  }

  private stopDrag(): void {
    this.isDragging = false;
  }

  private updatePosition(event: MouseEvent | TouchEvent): void {
    const container = this.container();
    if (!container) return;

    const rect = container.nativeElement.getBoundingClientRect();
    const clientX = 'touches' in event 
      ? event.touches[0]?.clientX || 0
      : event.clientX;
    
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    
    this.sliderPosition.set(percentage);
  }
}
