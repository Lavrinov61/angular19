import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

export interface WorkdayEndReminderDialogData {
  shiftId: string;
  studioName: string;
  endTime: string;
  cashAtClose?: number | null;
  cashlessAtClose?: boolean;
  /** Активна ли у студии смены фискальная касса (из БД) — плашка про Z-отчёт показывается только при true. */
  fiscalEnabled?: boolean;
  /** Имя кассы/точки из БД (agents.name) для текста плашки. null, если фискалки нет. */
  fiscalDeviceLabel?: string | null;
}

export type WorkdayEndReminderDialogResult =
  | { action: 'close_workday'; cashAtClose: number }
  | { action: 'snooze'; minutes: number };

const SNOOZE_OPTIONS: readonly number[] = [5, 10, 15, 20, 25, 30, 45, 60];

@Component({
  selector: 'app-workday-end-reminder-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <section class="reminder-shell" aria-labelledby="workday-end-title">
      <header class="reminder-header">
        <span class="warning-mark">
          <mat-icon>priority_high</mat-icon>
        </span>
        <div>
          <span class="eyebrow">Рабочий день окончен</span>
          <h2 id="workday-end-title">Закройте смену</h2>
        </div>
      </header>

      @if (cashlessAtClose) {
        <p class="reminder-copy">
          В {{ data.endTime }} нужно закрыть рабочий день без пересчёта наличных
          по адресу <strong>{{ data.studioName }}</strong>.
        </p>
      } @else {
        <p class="reminder-copy">
          В {{ data.endTime }} нужно пересчитать фактическую наличку в кассе и закрыть рабочий день
          по адресу <strong>{{ data.studioName }}</strong>.
        </p>

        <mat-form-field appearance="outline">
          <mat-label>Фактически наличных в кассе</mat-label>
          <input
            matInput
            type="number"
            inputmode="decimal"
            min="0"
            step="1"
            autocomplete="off"
            [formControl]="cashAtCloseControl"
            (keydown.enter)="checkout()"
          >
          <span matSuffix class="currency-suffix">₽</span>
          @if (cashAtCloseControl.hasError('required')) {
            <mat-error>Обязательное поле</mat-error>
          } @else if (cashAtCloseControl.hasError('min')) {
            <mat-error>Сумма не может быть отрицательной</mat-error>
          }
        </mat-form-field>
      }

      @if (cashlessAtClose) {
        <p class="fiscal-note fiscal-note--online">
          <mat-icon>cloud_done</mat-icon>
          <span>Это онлайн-смена без кассы. Фискального регистратора закрывать не нужно, закрывается только рабочий день.</span>
        </p>
      } @else if (fiscalEnabled) {
        <p class="fiscal-note">
          <mat-icon>receipt_long</mat-icon>
          <span>При закрытии рабочего дня автоматически закроется и фискальная смена
            @if (fiscalDeviceLabel) { на кассе <strong>{{ fiscalDeviceLabel }}</strong> }
            (Z-отчёт). Отдельно закрывать смену на кассе не нужно.</span>
        </p>
      }

      <button mat-flat-button type="button" class="checkout-btn" (click)="checkout()">
        <mat-icon>logout</mat-icon>
        Закрыть рабочий день
      </button>

      <div class="snooze-block">
        <span>Напомнить через</span>
        <div class="snooze-grid">
          @for (minutes of snoozeOptions; track minutes) {
            <button mat-stroked-button type="button" class="snooze-btn" (click)="snooze(minutes)">
              Через {{ minutes }} мин
            </button>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      color: var(--crm-text-primary, #f8fafc);
    }

    .reminder-shell {
      display: grid;
      gap: 18px;
      padding: 22px;
      border: 1px solid rgba(248, 113, 113, 0.38);
      border-radius: 8px;
      background: var(--crm-surface, #111827);
      box-shadow: 0 22px 60px rgba(0, 0, 0, 0.38);
    }

    .reminder-header {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .warning-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      color: #fff;
      background: rgba(239, 68, 68, 0.88);
      box-shadow: 0 0 0 1px rgba(248, 113, 113, 0.45);
      flex: 0 0 auto;
    }

    .warning-mark mat-icon {
      font-size: 26px;
      width: 26px;
      height: 26px;
    }

    .eyebrow {
      display: block;
      margin-bottom: 3px;
      color: #fca5a5;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    h2 {
      margin: 0;
      font-family: var(--crm-font-display, 'Oswald', sans-serif);
      font-size: 30px;
      font-weight: 500;
      line-height: 1.1;
      letter-spacing: 0;
    }

    .reminder-copy {
      margin: 0;
      color: var(--crm-text-secondary, #cbd5e1);
      font-size: 15px;
      line-height: 1.55;
    }

    .reminder-copy strong {
      color: var(--crm-text-primary, #f8fafc);
      font-weight: 800;
    }

    .fiscal-note {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0;
      padding: 12px 14px;
      border: 1px solid rgba(56, 189, 248, 0.32);
      border-radius: 8px;
      background: rgba(56, 189, 248, 0.10);
      color: var(--crm-text-secondary, #cbd5e1);
      font-size: 13.5px;
      line-height: 1.5;
    }

    .fiscal-note mat-icon {
      flex: 0 0 auto;
      color: #38bdf8;
      font-size: 20px;
      width: 20px;
      height: 20px;
    }

    .fiscal-note strong {
      color: var(--crm-text-primary, #f8fafc);
      font-weight: 800;
    }

    .fiscal-note--online {
      border-color: rgba(74, 222, 128, 0.32);
      background: rgba(74, 222, 128, 0.10);
    }

    .fiscal-note--online mat-icon {
      color: #4ade80;
    }

    .checkout-btn {
      justify-self: start;
      min-height: 44px;
      padding-inline: 18px;
      border-radius: 8px;
      background: #ef4444;
      color: #fff;
      font-weight: 800;
    }

    .checkout-btn mat-icon {
      margin-right: 6px;
    }

    mat-form-field {
      width: 100%;
    }

    .currency-suffix {
      padding-right: 2px;
      color: var(--crm-text-muted, #94a3b8);
      font-weight: 800;
    }

    .snooze-block {
      display: grid;
      gap: 10px;
      padding-top: 4px;
    }

    .snooze-block > span {
      color: var(--crm-text-muted, #94a3b8);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .snooze-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
    }

    .snooze-btn {
      min-height: 38px;
      border-radius: 8px;
      border-color: rgba(245, 158, 11, 0.34);
      color: var(--crm-accent, #f59e0b);
      background: rgba(245, 158, 11, 0.07);
      font-weight: 700;
      white-space: nowrap;
    }

    @media (max-width: 560px) {
      .reminder-shell {
        padding: 18px;
      }

      h2 {
        font-size: 26px;
      }

      .checkout-btn {
        width: 100%;
      }

      .snooze-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `],
})
export class WorkdayEndReminderDialogComponent {
  protected readonly data = inject<WorkdayEndReminderDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<WorkdayEndReminderDialogComponent, WorkdayEndReminderDialogResult>>(MatDialogRef);
  protected readonly snoozeOptions = SNOOZE_OPTIONS;
  protected readonly cashlessAtClose = this.data.cashlessAtClose === true;
  protected readonly fiscalEnabled = this.data.fiscalEnabled === true;
  protected readonly fiscalDeviceLabel = this.data.fiscalDeviceLabel ?? null;
  protected readonly cashAtCloseControl = new FormControl<number | null>(this.data.cashAtClose ?? null, {
    validators: this.cashlessAtClose ? [] : [Validators.required, Validators.min(0)],
  });

  protected checkout(): void {
    if (this.cashlessAtClose) {
      this.dialogRef.close({ action: 'close_workday', cashAtClose: 0 });
      return;
    }

    if (this.cashAtCloseControl.invalid) {
      this.cashAtCloseControl.markAsTouched();
      return;
    }

    const cashAtClose = Number(this.cashAtCloseControl.value);
    if (!Number.isFinite(cashAtClose) || cashAtClose < 0) {
      this.cashAtCloseControl.setErrors({ min: true });
      this.cashAtCloseControl.markAsTouched();
      return;
    }

    this.dialogRef.close({ action: 'close_workday', cashAtClose: Math.round(cashAtClose * 100) / 100 });
  }

  protected snooze(minutes: number): void {
    this.dialogRef.close({ action: 'snooze', minutes });
  }
}
