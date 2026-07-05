import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

export interface WorkdayCashCountDialogData {
  mode: 'open' | 'close';
  studioName?: string | null;
  initialAmount?: number | null;
}

export interface WorkdayCashCountDialogResult {
  amount: number;
}

@Component({
  selector: 'app-workday-cash-count-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <section class="cash-count-dialog" aria-labelledby="cash-count-title">
      <header class="dialog-header">
        <span class="dialog-mark">
          <mat-icon>payments</mat-icon>
        </span>
        <div>
          <span class="eyebrow">{{ data.mode === 'open' ? 'Начало дня' : 'Закрытие дня' }}</span>
          <h2 id="cash-count-title">{{ title() }}</h2>
          @if (data.studioName) {
            <p>{{ data.studioName }}</p>
          }
        </div>
      </header>

      <mat-form-field appearance="outline">
        <mat-label>{{ fieldLabel() }}</mat-label>
        <input
          matInput
          type="number"
          inputmode="decimal"
          min="0"
          step="1"
          autocomplete="off"
          [formControl]="amountControl"
          (keydown.enter)="submit()"
        >
        <span matSuffix class="currency-suffix">₽</span>
        @if (amountControl.hasError('required')) {
          <mat-error>Обязательное поле</mat-error>
        } @else if (amountControl.hasError('min')) {
          <mat-error>Сумма не может быть отрицательной</mat-error>
        }
      </mat-form-field>

      <footer class="dialog-actions">
        <button mat-stroked-button type="button" (click)="cancel()">Отмена</button>
        <button mat-flat-button type="button" class="submit-btn" (click)="submit()">
          <mat-icon>{{ data.mode === 'open' ? 'play_arrow' : 'logout' }}</mat-icon>
          {{ data.mode === 'open' ? 'Начать' : 'Закрыть день' }}
        </button>
      </footer>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      color: var(--crm-text-primary, #f8fafc);
    }

    .cash-count-dialog {
      display: grid;
      gap: 18px;
      padding: 22px;
      border: 1px solid rgba(245, 158, 11, 0.26);
      border-radius: 8px;
      background: var(--crm-surface, #111827);
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.36);
    }

    .dialog-header {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .dialog-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      color: #111827;
      background: var(--crm-accent, #f59e0b);
      flex: 0 0 auto;
    }

    .dialog-mark mat-icon {
      font-size: 26px;
      width: 26px;
      height: 26px;
    }

    .eyebrow {
      display: block;
      margin-bottom: 3px;
      color: var(--crm-accent, #f59e0b);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    h2 {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 28px;
      font-weight: 500;
      line-height: 1.1;
      letter-spacing: 0;
    }

    p {
      margin: 6px 0 0;
      color: var(--crm-text-secondary, #cbd5e1);
      font-size: 14px;
    }

    mat-form-field {
      width: 100%;
    }

    .currency-suffix {
      padding-right: 2px;
      color: var(--crm-text-muted, #94a3b8);
      font-weight: 800;
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .dialog-actions button {
      min-height: 40px;
      border-radius: 8px;
      font-weight: 800;
    }

    .submit-btn {
      background: var(--crm-accent, #f59e0b);
      color: #111827;
    }

    .submit-btn mat-icon {
      margin-right: 6px;
    }

    @media (max-width: 560px) {
      .cash-count-dialog {
        padding: 18px;
      }

      .dialog-actions {
        align-items: stretch;
        flex-direction: column-reverse;
      }
    }
  `],
})
export class WorkdayCashCountDialogComponent {
  protected readonly data = inject<WorkdayCashCountDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<WorkdayCashCountDialogComponent, WorkdayCashCountDialogResult>>(MatDialogRef);

  protected readonly amountControl = new FormControl<number | null>(this.data.initialAmount ?? null, {
    validators: [Validators.required, Validators.min(0)],
  });

  protected readonly title = computed(() =>
    this.data.mode === 'open'
      ? 'Наличка в кассе на старт'
      : 'Наличка в кассе на конец',
  );

  protected readonly fieldLabel = computed(() =>
    this.data.mode === 'open'
      ? 'Фактически в кассе перед стартом'
      : 'Фактически в кассе перед закрытием',
  );

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected submit(): void {
    if (this.amountControl.invalid) {
      this.amountControl.markAsTouched();
      return;
    }

    const amount = Number(this.amountControl.value);
    if (!Number.isFinite(amount) || amount < 0) {
      this.amountControl.setErrors({ min: true });
      this.amountControl.markAsTouched();
      return;
    }

    this.dialogRef.close({ amount: Math.round(amount * 100) / 100 });
  }
}
