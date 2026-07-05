import {
  Component, ChangeDetectionStrategy, inject, signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { PosApiService, PosReceipt } from '../../../services/pos-api.service';

export interface VoidConfirmDialogData {
  receipt: PosReceipt;
  shiftId: string;
}

@Component({
  selector: 'app-pos-void-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, FormsModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon class="void-icon">block</mat-icon>
      Аннулирование чека
    </h2>

    <mat-dialog-content>
      <div class="void-info">
        <div class="info-row">
          <span>Чек:</span>
          <strong>{{ data.receipt.receipt_number }}</strong>
        </div>
        <div class="info-row">
          <span>Сумма:</span>
          <strong>{{ data.receipt.total }}\u20BD</strong>
        </div>
      </div>

      @if (data.receipt.items.length > 0) {
        <div class="void-items">
          @for (item of data.receipt.items; track $index) {
            <div class="void-item">
              <span>{{ item.product_name }}</span>
              <span>\u00D7{{ item.quantity }} &middot; {{ item.total }}\u20BD</span>
            </div>
          }
        </div>
      }

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Причина аннулирования</mat-label>
        <textarea matInput [(ngModel)]="reason" rows="2"
                  placeholder="Минимум 5 символов"></textarea>
      </mat-form-field>

      @if (error()) {
        <div class="void-error">{{ error() }}</div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="processing()">Отмена</button>
      <button mat-flat-button color="warn"
              [disabled]="reason.trim().length < 5 || processing()"
              (click)="confirmVoid()">
        @if (processing()) {
          <mat-icon class="spin">sync</mat-icon>
        } @else {
          <mat-icon>block</mat-icon>
        }
        Аннулировать
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .void-icon { color: var(--mat-sys-error); }
    .full-width { width: 100%; }

    .void-info {
      margin-bottom: 12px;
      .info-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 14px;
      }
    }

    .void-items {
      margin-bottom: 12px;
      padding: 8px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-low);
    }
    .void-item {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      padding: 2px 0;
      color: var(--mat-sys-on-surface-variant);
    }

    .void-error {
      color: var(--mat-sys-error);
      font-size: 12px;
      margin-bottom: 8px;
    }

    .spin {
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class PosVoidConfirmDialogComponent {
  readonly data = inject<VoidConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PosVoidConfirmDialogComponent>);
  private readonly posApi = inject(PosApiService);

  reason = '';
  readonly processing = signal(false);
  readonly error = signal<string | null>(null);

  confirmVoid(): void {
    if (this.reason.trim().length < 5) return;

    this.processing.set(true);
    this.error.set(null);

    this.posApi.voidReceipt(this.data.receipt.id, {
      shift_id: this.data.shiftId,
      reason: this.reason.trim(),
    }).subscribe({
      next: () => {
        this.processing.set(false);
        this.dialogRef.close(true);
      },
      error: (err: { error?: { error?: string } }) => {
        this.processing.set(false);
        this.error.set(err.error?.error || 'Не удалось аннулировать чек');
      },
    });
  }
}
