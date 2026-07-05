import {
  Component, ChangeDetectionStrategy, input, output,
  OnInit, OnDestroy,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

export interface PrintableItem {
  product_name: string;
  quantity: number;
}

@Component({
  selector: 'app-pos-print-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule],
  host: { class: 'pos-print-prompt' },
  template: `
    <div class="prompt-content">
      <mat-icon class="prompt-icon">print</mat-icon>
      <div class="prompt-body">
        <span class="prompt-title">Напечатать?</span>
        <div class="prompt-items">
          @for (item of printableItems(); track item.product_name) {
            <span class="prompt-item">
              {{ item.product_name }}
              @if (item.quantity > 1) {
                <span class="qty">x{{ item.quantity }}</span>
              }
            </span>
          }
        </div>
      </div>
      <div class="prompt-actions">
        <button mat-button class="btn-skip" (click)="dismissed.emit()">
          Пропустить
        </button>
        <button mat-flat-button color="primary" class="btn-print" (click)="openPrint.emit()">
          Открыть печать
          <mat-icon iconPositionEnd>arrow_forward</mat-icon>
        </button>
      </div>
      <div class="dismiss-track">
        <div class="dismiss-fill" [style.animation-duration.s]="autoDismissSec()"></div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block; margin: 8px 12px; overflow: hidden;
      animation: slideDown 0.3s ease-out;
    }
    .prompt-content {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px;
      background: var(--mat-sys-tertiary-container);
      border: 1px solid color-mix(in srgb, var(--mat-sys-tertiary-container) 60%, var(--crm-border, rgba(255,255,255,0.12)));
      border-radius: 10px; font-size: 13px;
      color: var(--mat-sys-on-tertiary-container);
      position: relative;
    }
    .prompt-icon { font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; opacity: 0.85; }
    .prompt-body { flex: 1; min-width: 0; }
    .prompt-title { font-weight: 600; font-size: 13px; }
    .prompt-items { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
    .prompt-item {
      font-size: 11px; padding: 1px 6px;
      background: color-mix(in srgb, var(--mat-sys-on-tertiary-container) 10%, transparent);
      border-radius: 4px; white-space: nowrap;
      max-width: 160px; overflow: hidden; text-overflow: ellipsis;
    }
    .prompt-item .qty { font-weight: 600; opacity: 0.7; margin-left: 2px; }
    .prompt-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .btn-skip {
      font-size: 12px; min-height: 32px; padding: 0 10px;
      color: var(--mat-sys-on-tertiary-container); opacity: 0.7;
    }
    .btn-skip:hover { opacity: 1; }
    .btn-print {
      font-size: 12px; min-height: 32px; padding: 0 14px;
    }
    .btn-print mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .dismiss-track {
      position: absolute; bottom: 0; left: 0; right: 0; height: 3px;
      border-radius: 0 0 10px 10px; overflow: hidden;
    }
    .dismiss-fill {
      height: 100%;
      background: var(--mat-sys-on-tertiary-container); opacity: 0.2;
      animation: dismiss-countdown linear forwards;
    }
    @keyframes dismiss-countdown { from { width: 100%; } to { width: 0; } }
    @keyframes slideDown {
      from { max-height: 0; opacity: 0; margin-top: 0; margin-bottom: 0; }
      to { max-height: 120px; opacity: 1; }
    }
  `],
})
export class PosPrintPromptComponent implements OnInit, OnDestroy {
  readonly printableItems = input.required<PrintableItem[]>();
  readonly autoDismissSec = input<number>(30);

  readonly openPrint = output();
  readonly dismissed = output();

  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.timer = setTimeout(() => this.dismissed.emit(), this.autoDismissSec() * 1000);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
