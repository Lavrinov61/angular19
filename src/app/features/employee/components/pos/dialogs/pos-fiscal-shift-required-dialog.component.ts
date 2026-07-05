import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface PosFiscalShiftRequiredDialogData {
  mode: 'open-fiscal' | 'open-pos-and-fiscal';
  paymentLabel: string;
  studioName: string;
}

@Component({
  selector: 'app-pos-fiscal-shift-required-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatDialogModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>receipt_long</mat-icon>
      Нужна фискальная смена
    </h2>
    <mat-dialog-content>
      @if (data.mode === 'open-pos-and-fiscal') {
        <p>
          Для оплаты {{ data.paymentLabel }} нужно открыть POS-смену и фискальную смену на АТОЛ27Ф.
          Наличные при открытии будут указаны как 0\u20BD.
        </p>
      } @else {
        <p>
          Для оплаты {{ data.paymentLabel }} нужно открыть фискальную смену на АТОЛ27Ф в текущей POS-смене.
        </p>
      }
      <div class="studio">
        <mat-icon>store</mat-icon>
        {{ data.studioName }}
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="false">Отмена</button>
      <button mat-flat-button [mat-dialog-close]="true">
        <mat-icon>login</mat-icon>
        Открыть ФР
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2 {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 0;
      mat-icon {
        color: var(--crm-status-warning, #f59e0b);
      }
    }
    p {
      margin: 8px 0 16px;
      line-height: 1.45;
    }
    .studio {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--mat-sys-on-surface-variant);
      font-size: 13px;
      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }
  `],
})
export class PosFiscalShiftRequiredDialogComponent {
  readonly data = inject<PosFiscalShiftRequiredDialogData>(MAT_DIALOG_DATA);
}
