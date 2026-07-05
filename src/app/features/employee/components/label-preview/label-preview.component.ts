import {
  Component, ChangeDetectionStrategy, input, viewChild,
  ElementRef, effect, inject, PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Component({
  selector: 'app-label-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #labelCanvas [width]="canvasW" [height]="canvasH" class="label-canvas"></canvas>`,
  styles: [`
    :host { display: block; }
    .label-canvas {
      border: 1px solid var(--mat-sys-outline-variant, #ccc);
      border-radius: 4px;
      background: #fff;
    }
  `],
})
export class LabelPreviewComponent {
  readonly orderNumber = input.required<string>();
  readonly customerName = input<string>('');
  readonly itemCount = input<number>(0);
  readonly date = input<string>('');
  readonly trackingUrl = input<string>('');

  /** 62x29mm at 3x scale */
  readonly canvasW = 186;
  readonly canvasH = 87;

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('labelCanvas');
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    effect(() => {
      const order = this.orderNumber();
      const name = this.customerName();
      const count = this.itemCount();
      const dt = this.date();
      const url = this.trackingUrl();
      this.draw(order, name, count, dt, url);
    });
  }

  private draw(orderNum: string, name: string, count: number, date: string, trackingUrl: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    // QR placeholder (left side)
    const qrSize = h - 12;
    const qrX = 6;
    const qrY = 6;
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(qrX, qrY, qrSize, qrSize);
    ctx.strokeStyle = '#bdbdbd';
    ctx.lineWidth = 1;
    ctx.strokeRect(qrX, qrY, qrSize, qrSize);

    // QR placeholder text
    ctx.fillStyle = '#999';
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QR', qrX + qrSize / 2, qrY + qrSize / 2 - 6);
    ctx.font = '7px sans-serif';
    const shortNum = orderNum.length > 8 ? orderNum.slice(-8) : orderNum;
    ctx.fillText(shortNum, qrX + qrSize / 2, qrY + qrSize / 2 + 6);

    // Right side: text content
    const textX = qrX + qrSize + 8;
    const maxTextW = w - textX - 4;
    let textY = 14;

    // Customer name (bold)
    ctx.fillStyle = '#212121';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const truncName = this.truncateText(ctx, name || '---', maxTextW);
    ctx.fillText(truncName, textX, textY);
    textY += 15;

    // Order number
    ctx.fillStyle = '#424242';
    ctx.font = '9px sans-serif';
    ctx.fillText(`#${orderNum}`, textX, textY);
    textY += 12;

    // Date
    if (date) {
      ctx.fillStyle = '#757575';
      ctx.font = '8px sans-serif';
      ctx.fillText(date, textX, textY);
      textY += 11;
    }

    // Item count
    if (count > 0) {
      ctx.fillStyle = '#757575';
      ctx.font = '8px sans-serif';
      ctx.fillText(`${count} поз.`, textX, textY);
    }

    // Bottom: tracking URL (small)
    if (trackingUrl) {
      ctx.fillStyle = '#9e9e9e';
      ctx.font = '6px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const truncUrl = this.truncateText(ctx, trackingUrl, w - 12);
      ctx.fillText(truncUrl, w / 2, h - 3);
    }

    // Outer border
    ctx.strokeStyle = '#bdbdbd';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  private truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 0 && ctx.measureText(truncated + '...').width > maxWidth) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
  }
}
