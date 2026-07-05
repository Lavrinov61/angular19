import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ToastService } from '../../../../core/services/toast.service';

export interface OrderDelayDialogData {
  orderId: string;
  contactName?: string;
}

export interface OrderDelayResult {
  success: boolean;
  bonusAmount?: number;
}

const DELAY_REASONS = [
  { value: 'processing', label: 'Загруженность' },
  { value: 'equipment', label: 'Оборудование' },
  { value: 'materials', label: 'Материалы' },
  { value: 'quality_check', label: 'Доработка / Проверка качества' },
  { value: 'other', label: 'Другое' },
] as const;

@Component({
  selector: 'app-order-delay-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>schedule_send</mat-icon>
      Заказ задерживается
    </h2>

    <mat-dialog-content>
      <p class="delay-hint">Клиент будет уведомлён о задержке и получит бонусы в качестве компенсации.</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Причина задержки</mat-label>
        <mat-select [(ngModel)]="reason" required>
          @for (r of reasons; track r.value) {
            <mat-option [value]="r.value">{{ r.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Сумма компенсации (бонусы)</mat-label>
        <input matInput type="number" [(ngModel)]="compensation"
               min="0" max="500" placeholder="0-500\u20BD">
        <span matTextSuffix>\u20BD</span>
        <mat-hint>Максимум 500\u20BD бонусами</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Комментарий</mat-label>
        <textarea matInput [(ngModel)]="comment" rows="3"
                  placeholder="Дополнительная информация (необязательно)"></textarea>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="null" [disabled]="sending()">Отменить</button>
      <button mat-flat-button color="warn"
              [disabled]="!reason || sending()"
              (click)="submit()">
        @if (sending()) {
          <mat-spinner diameter="18" />
        } @else {
          <mat-icon>schedule_send</mat-icon>
        }
        Подтвердить задержку
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    mat-dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      color: var(--ed-on-surface, #f5f5f5);

      mat-icon { color: var(--mat-sys-error, #ef4444); }
    }

    .delay-hint {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 16px;
    }

    .full-width { width: 100%; }

    mat-dialog-content {
      min-width: 360px;
    }

    mat-dialog-actions button mat-spinner {
      display: inline-block;
      margin-right: 4px;
    }
  `],
})
export class OrderDelayDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly dialogRef = inject<MatDialogRef<OrderDelayDialogComponent>>(MatDialogRef);
  private readonly data = inject<OrderDelayDialogData>(MAT_DIALOG_DATA);
  private readonly toast = inject(ToastService);

  readonly reasons = DELAY_REASONS;
  reason = '';
  compensation = 0;
  comment = '';
  readonly sending = signal(false);

  submit(): void {
    if (!this.reason) return;
    this.sending.set(true);

    this.http.post<{ success: boolean; data?: { bonus_amount?: number } }>(
      `/api/order-delay/${this.data.orderId}`,
      {
        reason: this.reason,
        compensation_amount: Math.min(Math.max(this.compensation || 0, 0), 500),
        comment: this.comment.trim() || undefined,
      },
    ).subscribe({
      next: (res) => {
        this.sending.set(false);
        if (res.success) {
          const bonus = res.data?.bonus_amount ?? this.compensation;
          this.toast.success(
            bonus > 0
              ? `Клиент уведомлён, начислено ${bonus}\u20BD бонусов`
              : 'Клиент уведомлён о задержке',
          );
          this.dialogRef.close({ success: true, bonusAmount: bonus } satisfies OrderDelayResult);
        } else {
          this.toast.error('Не удалось оформить задержку');
        }
      },
      error: () => {
        this.sending.set(false);
        this.toast.error('Ошибка при оформлении задержки');
      },
    });
  }
}
