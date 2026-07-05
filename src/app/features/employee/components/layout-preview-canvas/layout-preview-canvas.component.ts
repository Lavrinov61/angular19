import {
  Component, ChangeDetectionStrategy, input, computed, viewChild,
  ElementRef, effect, DestroyRef, inject, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LayoutCalcResult, TemplateMode, BRANDED_FOOTER, POLAROID_600_TEMPLATE } from '../../data/photo-size-presets';

@Component({
  selector: 'app-layout-preview-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #layoutCanvas [width]="canvasW()" [height]="canvasH()" class="layout-sheet"></canvas>`,
  styles: [`
    :host { display: block; }
    .layout-sheet {
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 6px;
      background: #f0f0f0;
    }
  `],
})
export class LayoutPreviewCanvasComponent {
  readonly layout = input.required<LayoutCalcResult>();
  readonly paperW = input.required<number>();
  readonly paperH = input.required<number>();
  readonly maxCanvasW = input<number>(200);
  readonly maxCanvasH = input<number>(280);
  readonly templateMode = input<TemplateMode>('none');
  readonly imageUrl = input<string | null>(null);
  readonly imageUrls = input<readonly string[]>([]);

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('layoutCanvas');
  private readonly platformId = inject(PLATFORM_ID);
  private previewImages: (HTMLImageElement | null)[] = [];
  private previewImageUrlsKey = '';

  readonly scale = computed(() => {
    const pw = this.paperW();
    const ph = this.paperH();
    return Math.min(this.maxCanvasW() / pw, this.maxCanvasH() / ph);
  });

  readonly canvasW = computed(() => Math.round(this.paperW() * this.scale()));
  readonly canvasH = computed(() => Math.round(this.paperH() * this.scale()));

  private drawTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    effect(() => {
      const l = this.layout();
      const s = this.scale();
      const tm = this.templateMode();
      const urls = this.imageUrls();
      const singleUrl = this.imageUrl();
      this.loadPreviewImages(urls.length ? urls : singleUrl ? [singleUrl] : []);
      this.queueDraw(l, s, tm);
    });
    this.destroyRef.onDestroy(() => {
      if (this.drawTimer) clearTimeout(this.drawTimer);
    });
  }

  private queueDraw(layout: LayoutCalcResult, scale: number, tplMode: TemplateMode): void {
    if (this.drawTimer) clearTimeout(this.drawTimer);
    this.drawTimer = setTimeout(() => {
      this.drawTimer = null;
      this.draw(layout, scale, tplMode);
    }, 50);
  }

  private loadPreviewImages(urls: readonly string[]): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const key = urls.join('|');
    if (this.previewImageUrlsKey === key) return;
    this.previewImageUrlsKey = key;
    this.previewImages = urls.map(() => null);
    if (!urls.length) return;

    urls.forEach((url, index) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (this.previewImageUrlsKey !== key) return;
        this.previewImages[index] = img;
        this.queueDraw(this.layout(), this.scale(), this.templateMode());
      };
      img.onerror = () => {
        if (this.previewImageUrlsKey === key) {
          this.previewImages[index] = null;
        }
      };
      img.src = url;
    });
  }

  private draw(layout: LayoutCalcResult, scale: number, tplMode: TemplateMode = 'none'): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Paper background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    const margin = layout.cutMarginMm * scale;
    const cellW = layout.photoCellW * scale;
    const cellH = layout.photoCellH * scale;

    const isPassport = tplMode === 'passport' || layout.templateMode === 'passport';
    const isPolaroid = layout.templateMode === 'polaroid' && layout.photoAreaH && layout.bottomPaddingMm;
    const isCollage = tplMode === 'collage' || layout.templateMode === 'collage';
    const photoAreaH = isPolaroid ? layout.photoAreaH! * scale : cellH;
    const bottomPad = isPolaroid ? layout.bottomPaddingMm! * scale : 0;
    const footerH = layout.brandedFooter ? BRANDED_FOOTER.heightMm * scale : 0;
    const contentH = h - footerH;
    const gridW = layout.cols * cellW + Math.max(0, layout.cols - 1) * margin;
    const gridH = layout.rows * cellH + Math.max(0, layout.rows - 1) * margin;
    const startX = isPolaroid ? 0 : Math.max(0, (w - gridW) / 2);
    const startY = isPolaroid ? 0 : Math.max(0, (contentH - gridH) / 2);

    const collagePalette = ['#e3f2fd', '#fce4ec', '#e8f5e9', '#fff8e1'];

    // Draw photo cells
    for (let r = 0; r < layout.rows; r++) {
      for (let c = 0; c < layout.cols; c++) {
        const x = startX + c * (cellW + margin);
        const y = startY + r * (cellH + margin);
        const idx = r * layout.cols + c;
        const cellImage = this.previewImages[idx] ?? null;

        if (isCollage) {
          if (cellImage) {
            this.drawImageCell(ctx, cellImage, x, y, cellW, cellH);
          } else {
            ctx.fillStyle = collagePalette[idx % collagePalette.length];
            ctx.fillRect(x, y, cellW, cellH);
          }
          ctx.strokeStyle = '#bdbdbd';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellW, cellH);

          if (!cellImage) {
            ctx.fillStyle = '#424242';
            ctx.font = 'bold 14px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), x + cellW / 2, y + cellH / 2);
          }
        } else if (isPolaroid) {
          const borderSide = POLAROID_600_TEMPLATE.borderSideMm * scale;
          const borderTop = POLAROID_600_TEMPLATE.borderTopMm * scale;
          const photoSize = POLAROID_600_TEMPLATE.photoSizeMm * scale;
          const cardH = photoAreaH + bottomPad;

          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x, y, cellW, cardH);

          if (cellImage) {
            this.drawImageCell(ctx, cellImage, x + borderSide, y + borderTop, photoSize, photoSize);
          } else {
            ctx.fillStyle = '#e3f2fd';
            ctx.fillRect(x + borderSide, y + borderTop, photoSize, photoSize);
          }
          ctx.strokeStyle = '#42A5F5';
          ctx.lineWidth = 1;
          ctx.strokeRect(x + borderSide, y + borderTop, photoSize, photoSize);

          if (!cellImage) {
            ctx.fillStyle = '#1976D2';
            ctx.font = `${Math.max(10, photoSize * 0.15)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), x + borderSide + photoSize / 2, y + borderTop + photoSize / 2);
          }
        } else if (isPassport) {
          // Passport document cell — tighter grid, neutral tones
          if (cellImage) {
            this.drawImageCell(ctx, cellImage, x, y, cellW, cellH);
          } else {
            ctx.fillStyle = '#f5f5f5';
            ctx.fillRect(x, y, cellW, cellH);
          }
          ctx.strokeStyle = '#78909C';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellW, cellH);

          // Cell number — small, top-left corner
          const numSize = Math.max(7, Math.min(cellW, cellH) * 0.12);
          ctx.fillStyle = '#546E7A';
          ctx.font = `${numSize}px sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(String(idx + 1), x + 2, y + 1);
        } else {
          // Standard cell
          if (cellImage) {
            this.drawImageCell(ctx, cellImage, x, y, cellW, cellH);
          } else {
            ctx.fillStyle = '#e3f2fd';
            ctx.fillRect(x, y, cellW, cellH);
          }
          ctx.strokeStyle = '#42A5F5';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, cellW, cellH);

          if (!cellImage) {
            ctx.fillStyle = '#1976D2';
            ctx.font = `${Math.max(10, cellW * 0.15)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(idx + 1), x + cellW / 2, y + cellH / 2);
          }
        }
      }
    }

    if (isPolaroid) {
      ctx.strokeStyle = '#c8c8c8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(startX + POLAROID_600_TEMPLATE.cardWidthMm * scale, 0);
      ctx.lineTo(startX + POLAROID_600_TEMPLATE.cardWidthMm * scale, h);
      ctx.moveTo(0, startY + POLAROID_600_TEMPLATE.cardHeightMm * scale);
      ctx.lineTo(w, startY + POLAROID_600_TEMPLATE.cardHeightMm * scale);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Cut marks — passport uses red dashed guides
    ctx.strokeStyle = isPassport ? '#dc2626' : '#333';
    ctx.lineWidth = isPassport ? 0.5 : 0.5;
    ctx.setLineDash(isPassport ? [3, 2] : [2, 2]);
    for (let r = 1; r < layout.rows; r++) {
      const y = startY + r * (cellH + margin) - margin / 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let c = 1; c < layout.cols; c++) {
      const x = startX + c * (cellW + margin) - margin / 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Branded footer for document photo sets
    if (layout.brandedFooter) {
      const footerH = BRANDED_FOOTER.heightMm * scale;
      const footerY = h - footerH;

      // Footer background — белый, как на печати (print-api рисует полосу на белом листе)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, footerY, w, footerH);

      // Divider line
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(4, footerY + 1);
      ctx.lineTo(w - 4, footerY + 1);
      ctx.stroke();

      // Logo text
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `bold ${Math.max(8, footerH * 0.32)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(BRANDED_FOOTER.logo, w / 2, footerY + 3);

      // Address lines (svoefoto.ru · +7 (863) 322-65-75 · адреса)
      ctx.font = `${Math.max(6, footerH * 0.2)}px sans-serif`;
      ctx.fillStyle = '#555555';
      BRANDED_FOOTER.lines.forEach((line, i) => {
        ctx.fillText(line, w / 2, footerY + 3 + footerH * 0.38 + i * (footerH * 0.24));
      });
    }

    // Paper border
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  private drawImageCell(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const cellRatio = w / h;
    let sx = 0;
    let sy = 0;
    let sw = img.naturalWidth;
    let sh = img.naturalHeight;

    if (imgRatio > cellRatio) {
      sw = img.naturalHeight * cellRatio;
      sx = (img.naturalWidth - sw) / 2;
    } else {
      sh = img.naturalWidth / cellRatio;
      sy = (img.naturalHeight - sh) / 2;
    }

    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }
}
