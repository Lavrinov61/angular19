import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

interface ReceiptItem {
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
}

@Component({
  selector: 'app-pos-production-prompt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule],
  host: { class: 'pos-production-prompt' },
  template: `
    <mat-icon>factory</mat-icon>
    <span>Отправить {{ receiptItems().length }} поз. в типографию?</span>
    <button mat-flat-button color="primary" class="production-prompt-btn" (click)="sendRequested.emit()">
      Отправить
    </button>
    <button mat-icon-button (click)="dismissed.emit()">
      <mat-icon>close</mat-icon>
    </button>
  `,
  styles: [`
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      margin: 8px 12px;
      background: #e8f5e9;
      border: 1px solid #a5d6a7;
      border-radius: 10px;
      font-size: 13px;
      color: #2e7d32;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }
    .production-prompt-btn { font-size: 12px; height: 32px; }
  `],
})
export class PosProductionPromptComponent {
  readonly receiptItems = input.required<ReceiptItem[]>();
  readonly sendRequested = output();
  readonly dismissed = output();
}
