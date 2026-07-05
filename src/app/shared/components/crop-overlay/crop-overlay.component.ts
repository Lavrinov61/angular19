import {
  Component, ChangeDetectionStrategy, computed, effect, signal, input, output,
  ElementRef, viewChild, AfterViewInit,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

export interface CropRect {
  x: number;      // 0-1 (fraction of image)
  y: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-crop-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatTooltipModule],
  host: {
    '[class.crop-target-portrait]': 'paperAspect() < 1',
    '[class.crop-target-landscape]': 'paperAspect() >= 1',
  },
  template: `
    <div class="crop-container"
         [style.aspect-ratio]="containerAspect()"
         (mousedown)="onDragStart($event, 'pan')"
         #container>
      <div class="printable-frame"
           [style.left.%]="printableInset().left"
           [style.right.%]="printableInset().right"
           [style.top.%]="printableInset().top"
           [style.bottom.%]="printableInset().bottom"
           #printable>
        <img [src]="imageUrl()"
             [style.object-fit]="fitMode() === 'fill' ? 'cover' : 'contain'"
             [style.object-position]="imgObjectPosition()"
             [style.filter]="imageFilter()"
             class="crop-image"
             draggable="false"
             (load)="onImageLoad()"
             alt="Предпросмотр обрезки" />

        @if (fitMode() === 'fill') {
          @if (cropZones().top > 0) {
            <div class="crop-zone crop-top"
                 [style.height.%]="cropZones().top"></div>
          }
          @if (cropZones().bottom > 0) {
            <div class="crop-zone crop-bottom"
                 [style.height.%]="cropZones().bottom"></div>
          }
          @if (cropZones().left > 0) {
            <div class="crop-zone crop-left"
                 [style.width.%]="cropZones().left"
                 [style.top.%]="cropZones().top"
                 [style.bottom.%]="cropZones().bottom"></div>
          }
          @if (cropZones().right > 0) {
            <div class="crop-zone crop-right"
                 [style.width.%]="cropZones().right"
                 [style.top.%]="cropZones().top"
                 [style.bottom.%]="cropZones().bottom"></div>
          }

          <div class="crop-visible-area"
               [style.top.%]="cropZones().top"
               [style.bottom.%]="cropZones().bottom"
               [style.left.%]="cropZones().left"
               [style.right.%]="cropZones().right">
            <div class="crop-handle handle-tl"></div>
            <div class="crop-handle handle-tr"></div>
            <div class="crop-handle handle-bl"></div>
            <div class="crop-handle handle-br"></div>
            <div class="grid-line grid-v1"></div>
            <div class="grid-line grid-v2"></div>
            <div class="grid-line grid-h1"></div>
            <div class="grid-line grid-h2"></div>
          </div>
        }
      </div>

      @if (!borderless()) {
        <div class="margin-outline"
             [style.left.%]="printableInset().left"
             [style.right.%]="printableInset().right"
             [style.top.%]="printableInset().top"
             [style.bottom.%]="printableInset().bottom"></div>
      }
    </div>

    <div class="crop-footer">
      @if (showWarning()) {
        <span class="crop-warning">
          <mat-icon>warning</mat-icon>
          Обрезка: {{ cropPercentage() }}%
        </span>
      } @else if (!borderless()) {
        <span class="crop-info">
          <mat-icon class="crop-info-icon">crop_free</mat-icon>
          Поля: {{ printableMarginMm() }} мм
        </span>
      } @else if (fitMode() === 'fill' && cropPercentage() > 0) {
        <span class="crop-info">
          <mat-icon class="crop-info-icon">crop</mat-icon>
          Обрезка: {{ cropPercentage() }}%
          <span class="crop-hint">&mdash; перетащите для смещения</span>
        </span>
      }

      <button mat-icon-button
              class="toggle-btn"
              [matTooltip]="fitMode() === 'fill' ? 'Вписать (без обрезки)' : 'Заполнить (с обрезкой)'"
              (click)="toggleFitMode()">
        <mat-icon>{{ fitMode() === 'fill' ? 'fit_screen' : 'crop' }}</mat-icon>
      </button>

      @if (fitMode() === 'fill' && (offsetX() !== 0 || offsetY() !== 0)) {
        <button mat-icon-button
                class="reset-btn"
                matTooltip="Сбросить позицию"
                (click)="resetOffset()">
          <mat-icon>center_focus_strong</mat-icon>
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; max-width: 300px; }

    :host(.batch-crop-preview) {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      width: 100% !important;
      height: 100%;
      max-width: 100%;
      min-width: 0;
      min-height: 0;
      align-items: center;
      justify-items: center;
    }

    .crop-container {
      position: relative;
      overflow: hidden;
      border: 1px solid #ccc;
      border-radius: 6px;
      background: #fff;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    .crop-container:active { cursor: grabbing; }

    :host(.batch-crop-preview) .crop-container {
      align-self: center;
      justify-self: center;
      min-width: 0;
      min-height: 0;
      max-width: 100%;
      max-height: 100%;
    }

    :host(.batch-crop-preview.crop-target-portrait) .crop-container {
      width: auto;
      height: 100%;
    }

    :host(.batch-crop-preview.crop-target-landscape) .crop-container {
      width: 100%;
      height: auto;
    }

    .printable-frame {
      position: absolute;
      overflow: hidden;
      background: #f5f5f5;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.12);
    }

    .margin-outline {
      position: absolute;
      pointer-events: none;
      border: 1px dashed rgba(0, 0, 0, 0.28);
      z-index: 4;
    }

    .crop-image {
      display: block;
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .crop-zone {
      position: absolute;
      background: rgba(220, 38, 38, 0.25);
      pointer-events: none;
      z-index: 1;
      backdrop-filter: brightness(0.85);
    }
    .crop-top { top: 0; left: 0; right: 0; }
    .crop-bottom { bottom: 0; left: 0; right: 0; }
    .crop-left { left: 0; }
    .crop-right { right: 0; }

    .crop-visible-area {
      position: absolute;
      z-index: 2;
      pointer-events: none;
      border: 2px solid rgba(255, 255, 255, 0.85);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.3);
    }

    .crop-handle {
      position: absolute;
      width: 16px;
      height: 16px;
      pointer-events: none;
    }
    .crop-handle::before, .crop-handle::after {
      content: '';
      position: absolute;
      background: #fff;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.4);
    }
    .handle-tl { top: -2px; left: -2px; }
    .handle-tl::before { top: 0; left: 0; width: 16px; height: 3px; }
    .handle-tl::after { top: 0; left: 0; width: 3px; height: 16px; }
    .handle-tr { top: -2px; right: -2px; }
    .handle-tr::before { top: 0; right: 0; width: 16px; height: 3px; }
    .handle-tr::after { top: 0; right: 0; width: 3px; height: 16px; }
    .handle-bl { bottom: -2px; left: -2px; }
    .handle-bl::before { bottom: 0; left: 0; width: 16px; height: 3px; }
    .handle-bl::after { bottom: 0; left: 0; width: 3px; height: 16px; }
    .handle-br { bottom: -2px; right: -2px; }
    .handle-br::before { bottom: 0; right: 0; width: 16px; height: 3px; }
    .handle-br::after { bottom: 0; right: 0; width: 3px; height: 16px; }

    .grid-line {
      position: absolute;
      background: rgba(255, 255, 255, 0.3);
      pointer-events: none;
    }
    .grid-v1 { left: 33.33%; top: 0; bottom: 0; width: 1px; }
    .grid-v2 { left: 66.66%; top: 0; bottom: 0; width: 1px; }
    .grid-h1 { top: 33.33%; left: 0; right: 0; height: 1px; }
    .grid-h2 { top: 66.66%; left: 0; right: 0; height: 1px; }

    .crop-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 6px;
      min-height: 32px;
    }

    :host(.batch-crop-preview) .crop-footer {
      width: 100%;
      min-width: 0;
    }

    .crop-warning {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #dc2626;
      font-size: 12px;
      font-weight: 500;
    }
    .crop-warning mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .crop-info {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: rgba(0, 0, 0, 0.54);
    }
    .crop-info-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
    .crop-hint {
      font-size: 11px;
      color: rgba(0, 0, 0, 0.35);
    }

    .toggle-btn {
      margin-left: auto;
      width: 32px !important;
      height: 32px !important;
    }
    .toggle-btn mat-icon {
      font-size: 18px;
    }
    .reset-btn {
      width: 32px !important;
      height: 32px !important;
    }
    .reset-btn mat-icon {
      font-size: 18px;
    }
  `],
})
export class CropOverlayComponent implements AfterViewInit {
  // Inputs
  imageUrl = input.required<string>();
  paperWidth = input.required<number>();
  paperHeight = input.required<number>();
  imageNaturalWidth = input.required<number>();
  imageNaturalHeight = input.required<number>();
  imageFilter = input<string>('none');
  fitMode = input<'fit' | 'fill'>('fill');
  initialCropRect = input<CropRect | null>(null);
  resetKey = input<string | number | null>(null);
  borderless = input<boolean>(true);
  marginMm = input<number>(3);

  // Outputs
  cropRect = output<CropRect>();
  fitModeChange = output<'fit' | 'fill'>();

  // Internal
  private readonly printableRef = viewChild<ElementRef<HTMLDivElement>>('printable');
  readonly offsetX = signal(0); // -1..1 fraction from center
  readonly offsetY = signal(0);
  private dragMode: 'pan' | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartOffX = 0;
  private dragStartOffY = 0;
  private appliedResetKey: string | number | null | undefined;

  // Bound handlers for removeEventListener
  private readonly boundOnDragMove = this.onDragMove.bind(this);
  private readonly boundOnDragEnd = this.onDragEnd.bind(this);

  private readonly syncInitialCrop = effect(() => {
    const resetKey = this.resetKey();
    const initialCrop = this.initialCropRect();
    const fitMode = this.fitMode();
    const iw = this.imageNaturalWidth();
    const ih = this.imageNaturalHeight();
    const targetAspect = this.targetAspect();

    if (this.appliedResetKey === resetKey || !iw || !ih || !targetAspect) {
      return;
    }

    if (fitMode !== 'fill' || !initialCrop) {
      this.offsetX.set(0);
      this.offsetY.set(0);
      this.appliedResetKey = resetKey;
      return;
    }

    const imageAspect = iw / ih;
    if (Math.abs(imageAspect - targetAspect) < 0.01) {
      this.offsetX.set(0);
      this.offsetY.set(0);
      this.appliedResetKey = resetKey;
      return;
    }

    if (imageAspect > targetAspect) {
      const visibleWidth = targetAspect / imageAspect;
      const maxOffset = (1 - visibleWidth) / 2;
      const offset = maxOffset > 0 ? ((1 - visibleWidth) / 2 - initialCrop.x) / maxOffset : 0;
      this.offsetX.set(this.clampOffset(offset));
      this.offsetY.set(0);
    } else {
      const visibleHeight = imageAspect / targetAspect;
      const maxOffset = (1 - visibleHeight) / 2;
      const offset = maxOffset > 0 ? ((1 - visibleHeight) / 2 - initialCrop.y) / maxOffset : 0;
      this.offsetX.set(0);
      this.offsetY.set(this.clampOffset(offset));
    }

    this.appliedResetKey = resetKey;
  });

  readonly containerAspect = computed(() => {
    const pw = this.paperWidth();
    const ph = this.paperHeight();
    return pw && ph ? `${pw} / ${ph}` : '3 / 4';
  });

  readonly paperAspect = computed(() => {
    const pw = this.paperWidth();
    const ph = this.paperHeight();
    return pw && ph ? pw / ph : 0.75;
  });

  readonly printableMarginMm = computed(() => {
    if (this.borderless()) return 0;
    const paperMin = Math.min(this.paperWidth(), this.paperHeight());
    const maxMargin = Math.max(0, paperMin / 3);
    return Math.max(0, Math.min(this.marginMm(), maxMargin));
  });

  readonly printableInset = computed(() => {
    const pw = this.paperWidth();
    const ph = this.paperHeight();
    const margin = this.printableMarginMm();
    if (!pw || !ph || margin <= 0) {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    }
    return {
      left: (margin / pw) * 100,
      right: (margin / pw) * 100,
      top: (margin / ph) * 100,
      bottom: (margin / ph) * 100,
    };
  });

  readonly targetAspect = computed(() => {
    const pw = this.paperWidth();
    const ph = this.paperHeight();
    if (!pw || !ph) return 0;
    const margin = this.printableMarginMm();
    const printableW = Math.max(1, pw - margin * 2);
    const printableH = Math.max(1, ph - margin * 2);
    return printableW / printableH;
  });

  /**
   * Compute what % of the image area gets cropped in fill mode.
   */
  readonly cropPercentage = computed(() => {
    if (this.fitMode() !== 'fill') return 0;

    const iw = this.imageNaturalWidth();
    const ih = this.imageNaturalHeight();
    const targetAspect = this.targetAspect();
    if (!iw || !ih || !targetAspect) return 0;

    const imageAspect = iw / ih;

    if (Math.abs(imageAspect - targetAspect) < 0.01) return 0;

    let visibleFraction: number;
    if (imageAspect > targetAspect) {
      visibleFraction = targetAspect / imageAspect;
    } else {
      visibleFraction = imageAspect / targetAspect;
    }

    return Math.round((1 - visibleFraction) * 100);
  });

  readonly showWarning = computed(() => this.cropPercentage() > 25);

  /**
   * Compute the red overlay zones (in % of the container) for fill mode.
   */
  readonly cropZones = computed(() => {
    const zero = { top: 0, bottom: 0, left: 0, right: 0 };
    if (this.fitMode() !== 'fill') return zero;

    const iw = this.imageNaturalWidth();
    const ih = this.imageNaturalHeight();
    const targetAspect = this.targetAspect();
    if (!iw || !ih || !targetAspect) return zero;

    const imageAspect = iw / ih;

    if (Math.abs(imageAspect - targetAspect) < 0.01) return zero;

    const ox = this.offsetX();
    const oy = this.offsetY();

    if (imageAspect > targetAspect) {
      const visibleFrac = targetAspect / imageAspect;
      const cropFrac = 1 - visibleFrac;
      const leftFrac = (cropFrac / 2) * (1 - ox);
      const rightFrac = (cropFrac / 2) * (1 + ox);
      const leftPct = (leftFrac / (leftFrac + visibleFrac + rightFrac)) * 100;
      const rightPct = (rightFrac / (leftFrac + visibleFrac + rightFrac)) * 100;
      return { top: 0, bottom: 0, left: leftPct, right: rightPct };
    } else {
      const visibleFrac = imageAspect / targetAspect;
      const cropFrac = 1 - visibleFrac;
      const topFrac = (cropFrac / 2) * (1 - oy);
      const bottomFrac = (cropFrac / 2) * (1 + oy);
      const topPct = (topFrac / (topFrac + visibleFrac + bottomFrac)) * 100;
      const bottomPct = (bottomFrac / (topFrac + visibleFrac + bottomFrac)) * 100;
      return { top: topPct, bottom: bottomPct, left: 0, right: 0 };
    }
  });

  readonly imgObjectPosition = computed(() => {
    if (this.fitMode() !== 'fill') return '50% 50%';

    const iw = this.imageNaturalWidth();
    const ih = this.imageNaturalHeight();
    const targetAspect = this.targetAspect();
    if (!iw || !ih || !targetAspect) return '50% 50%';

    const imageAspect = iw / ih;
    const ox = this.offsetX();
    const oy = this.offsetY();

    if (imageAspect > targetAspect) {
      return `${50 - ox * 50}% 50%`;
    }
    return `50% ${50 - oy * 50}%`;
  });

  ngAfterViewInit(): void {
    this.emitCropRect();
  }

  onImageLoad(): void {
    this.emitCropRect();
  }

  toggleFitMode(): void {
    const next = this.fitMode() === 'fill' ? 'fit' : 'fill';
    this.fitModeChange.emit(next);
  }

  resetOffset(): void {
    this.offsetX.set(0);
    this.offsetY.set(0);
    this.emitCropRect();
  }

  onDragStart(event: MouseEvent, mode: 'pan'): void {
    if (this.fitMode() !== 'fill') return;
    event.preventDefault();
    this.dragMode = mode;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragStartOffX = this.offsetX();
    this.dragStartOffY = this.offsetY();

    document.addEventListener('mousemove', this.boundOnDragMove);
    document.addEventListener('mouseup', this.boundOnDragEnd);
  }

  private onDragMove(event: MouseEvent): void {
    if (!this.dragMode) return;
    const printable = this.printableRef()?.nativeElement;
    if (!printable) return;

    const dx = event.clientX - this.dragStartX;
    const dy = event.clientY - this.dragStartY;
    const rect = printable.getBoundingClientRect();

    const newOffX = this.clampOffset(this.dragStartOffX + (dx / rect.width) * 2);
    const newOffY = this.clampOffset(this.dragStartOffY + (dy / rect.height) * 2);

    this.offsetX.set(newOffX);
    this.offsetY.set(newOffY);
    this.emitCropRect();
  }

  private onDragEnd(): void {
    this.dragMode = null;
    document.removeEventListener('mousemove', this.boundOnDragMove);
    document.removeEventListener('mouseup', this.boundOnDragEnd);
  }

  private clampOffset(value: number): number {
    return Math.max(-1, Math.min(1, value));
  }

  private emitCropRect(): void {
    const iw = this.imageNaturalWidth();
    const ih = this.imageNaturalHeight();
    const targetAspect = this.targetAspect();
    if (!iw || !ih || !targetAspect) return;

    const imageAspect = iw / ih;

    if (this.fitMode() !== 'fill' || Math.abs(imageAspect - targetAspect) < 0.01) {
      this.cropRect.emit({ x: 0, y: 0, width: 1, height: 1 });
      return;
    }

    const ox = this.offsetX();
    const oy = this.offsetY();

    let x = 0, y = 0, w = 1, h = 1;

    if (imageAspect > targetAspect) {
      w = targetAspect / imageAspect;
      const maxOffset = (1 - w) / 2;
      x = (1 - w) / 2 - ox * maxOffset;
    } else {
      h = imageAspect / targetAspect;
      const maxOffset = (1 - h) / 2;
      y = (1 - h) / 2 - oy * maxOffset;
    }

    this.cropRect.emit({ x, y, width: w, height: h });
  }
}
