import {
  Component,
  input,
  signal,
  ChangeDetectionStrategy,
  PLATFORM_ID,
  inject,
  ElementRef,
  DestroyRef,
  afterNextRender
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-before-after-slider',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="before-after-container" #container>
      <div class="comparison-wrapper">
        <!-- After image (background) -->
        <div class="image-layer after-layer">
          <img [src]="after()" [alt]="'После: ' + label()" loading="lazy">
          <span class="image-label after-label">После</span>
        </div>

        <!-- Before image (foreground, clipped) -->
        <div 
          class="image-layer before-layer"
          [style.clip-path]="'inset(0 ' + (100 - sliderPosition()) + '% 0 0)'"
        >
          <img [src]="before()" [alt]="'До: ' + label()" loading="lazy">
          <span class="image-label before-label">До</span>
        </div>

        <!-- Slider handle -->
        <div 
          class="slider-handle"
          [style.left.%]="sliderPosition()"
          (mousedown)="startDrag($event)"
          (touchstart)="startDrag($event)"
        >
          <div class="handle-line"></div>
          <div class="handle-circle">
            <mat-icon>compare_arrows</mat-icon>
          </div>
          <div class="handle-line"></div>
        </div>
      </div>

      @if (label()) {
        <div class="comparison-label">
          <span>{{ label() }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .before-after-container {
      position: relative;
      width: 100%;
      max-width: 400px;
      margin: 0 auto;
      user-select: none;
    }

    .comparison-wrapper {
      position: relative;
      width: 100%;
      aspect-ratio: 3 / 4;
      border-radius: var(--ed-border-radius-lg, 16px);
      overflow: hidden;
      box-shadow: var(--ed-shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.5));
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .image-layer {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
    }

    .image-layer img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .before-layer { z-index: 2; }
    .after-layer { z-index: 1; }

    .image-label {
      position: absolute;
      bottom: 12px;
      padding: 6px 16px;
      border-radius: 20px;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 0.875rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .before-label {
      left: 12px;
      background: rgba(10, 10, 10, 0.85);
      color: var(--ed-on-surface, #f5f5f5);
      backdrop-filter: blur(8px);
    }

    .after-label {
      right: 12px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
    }

    .slider-handle {
      position: absolute;
      top: 0;
      bottom: 0;
      z-index: 10;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transform: translateX(-50%);
      cursor: ew-resize;
      touch-action: none;
    }

    .handle-line {
      flex: 1;
      width: 3px;
      background: var(--ed-accent, #f59e0b);
      box-shadow: 0 0 12px rgba(245, 158, 11, 0.3);
    }

    .handle-circle {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--ed-accent, #f59e0b);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: var(--ed-shadow-accent, 0 4px 24px rgba(245, 158, 11, 0.3));
      transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .handle-circle:hover {
      transform: scale(1.1);
    }

    .handle-circle mat-icon {
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 24px;
      width: 24px;
      height: 24px;
    }

    .comparison-label {
      text-align: center;
      margin-top: 16px;
    }

    .comparison-label span {
      display: inline-block;
      padding: 8px 24px;
      background: var(--ed-surface-container-high, #1e1e1e);
      color: var(--ed-on-surface, #f5f5f5);
      border-radius: 20px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      font-weight: 500;
      font-size: 0.9rem;
    }

    @media (max-width: 480px) {
      .before-after-container { max-width: 100%; }

      .handle-circle {
        width: 40px;
        height: 40px;
      }

      .handle-circle mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .image-label {
        font-size: 0.75rem;
        padding: 4px 12px;
      }
    }
  `]
})
export class BeforeAfterSliderComponent {
  before = input.required<string>();
  after = input.required<string>();
  label = input<string>('');

  sliderPosition = signal(50);

  private platformId = inject(PLATFORM_ID);
  private elementRef = inject(ElementRef);
  private destroyRef = inject(DestroyRef);
  private isDragging = false;

  private readonly boundOnDrag = this.onDrag.bind(this);
  private readonly boundStopDrag = this.stopDrag.bind(this);

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => {
        this.setupGlobalListeners();
      });
    }
  }

  private setupGlobalListeners(): void {
    document.addEventListener('mousemove', this.boundOnDrag);
    document.addEventListener('mouseup', this.boundStopDrag);
    document.addEventListener('touchmove', this.boundOnDrag, { passive: false });
    document.addEventListener('touchend', this.boundStopDrag);

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('mousemove', this.boundOnDrag);
      document.removeEventListener('mouseup', this.boundStopDrag);
      document.removeEventListener('touchmove', this.boundOnDrag);
      document.removeEventListener('touchend', this.boundStopDrag);
    });
  }

  startDrag(event: MouseEvent | TouchEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  private onDrag(event: MouseEvent | TouchEvent): void {
    if (!this.isDragging) return;

    event.preventDefault();

    const container = this.elementRef.nativeElement.querySelector('.comparison-wrapper');
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    
    let position = ((clientX - rect.left) / rect.width) * 100;
    position = Math.max(0, Math.min(100, position));
    
    this.sliderPosition.set(position);
  }

  private stopDrag(): void {
    this.isDragging = false;
  }
}
