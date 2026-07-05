import {
  Component, inject, signal, computed, effect, ChangeDetectionStrategy,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder, Validators, ReactiveFormsModule,
} from '@angular/forms';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { StudioStatus } from '../../../../core/services/studio-alert.service';
import { StudioAdminService, StudioStatusValue } from '../../../../core/services/studio-admin.service';
import { ToastService } from '../../../../core/services/toast.service';
import { ConfirmDialogComponent, ConfirmDialogData } from '../shared/confirm-dialog.component';

export interface StudioStatusDialogData {
  studio: StudioStatus;
}

const MESSAGE_MAX = 500;
const RU_DATE_PIPE = new DatePipe('ru-RU');

function toIsoDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value}T00:00:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function startOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDisplayDate(date: Date): string {
  return RU_DATE_PIPE.transform(date, 'd MMMM y') ?? toIsoDate(date) ?? '';
}

@Component({
  selector: 'app-studio-status-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatDatepickerModule, MatNativeDateModule,
    MatIconModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title class="dialog-title">
      <mat-icon>location_on</mat-icon>
      {{ data.studio.name }}
    </h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Статус точки</mat-label>
          <mat-select formControlName="status">
            <mat-option value="open">Открыта</mat-option>
            <mat-option value="closed">Закрыта</mat-option>
            <mat-option value="maintenance">Тех. перерыв</mat-option>
          </mat-select>
        </mat-form-field>

        @if (statusValue() !== 'open') {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Сообщение на сайте</mat-label>
            <textarea matInput formControlName="status_message"
                      rows="3" [maxlength]="MESSAGE_MAX"
                      placeholder="Напр.: Точка временно закрыта до 9 мая. Ждём вас на Соборном 21!"></textarea>
            <mat-hint align="end">{{ statusMessageControl.value.length }}/{{ MESSAGE_MAX }}</mat-hint>
            @if (statusMessageControl.hasError('required')) {
              <mat-error>Напишите сообщение для клиентов</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Закрыто по дату включительно</mat-label>
            <input matInput [matDatepicker]="picker"
                   formControlName="status_until"
                   [min]="minDate">
            <mat-datepicker-toggle matIconSuffix [for]="picker" />
            <mat-datepicker #picker />
            <mat-hint>На следующий день точка откроется автоматически.</mat-hint>
            @if (statusUntilControl.hasError('required')) {
              <mat-error>Укажите последний день перерыва</mat-error>
            }
          </mat-form-field>

          <div class="date-summary">
            <mat-icon>event_available</mat-icon>
            <span>{{ closureSummary() }}</span>
          </div>
        }

        @if (error()) {
          <div class="error-message">{{ error() }}</div>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="submitting()">Отмена</button>
      @if (wasClosedOrMaintenance()) {
        <button mat-stroked-button color="primary"
                [disabled]="submitting()"
                (click)="reopenShortcut()">
          Открыть сейчас
        </button>
      }
      <button mat-flat-button color="primary"
              [disabled]="form.invalid || submitting()"
              (click)="submit()">
        @if (submitting()) {
          <mat-progress-spinner mode="indeterminate" diameter="18" />
        } @else {
          Сохранить
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-title {
      display: flex;
      align-items: center;
      gap: 8px;
      mat-icon { color: var(--mat-sys-primary); }
    }
    mat-dialog-content { min-width: 420px; }
    .form { display: flex; flex-direction: column; gap: 4px; padding-top: 8px; }
    .full-width { width: 100%; }
    .error-message {
      color: var(--mat-sys-error);
      font-size: 13px;
      padding: 4px 0;
    }
    .date-summary {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      color: var(--crm-text-secondary, var(--mat-sys-on-surface-variant));
      font-size: 13px;
      line-height: 1.4;
      padding: 0 2px 8px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--mat-sys-primary);
        flex-shrink: 0;
      }
    }
    @media (max-width: 600px) {
      mat-dialog-content { min-width: unset; }
    }
  `],
})
export class StudioStatusDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<StudioStatusDialogComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly svc = inject(StudioAdminService);
  private readonly toast = inject(ToastService);
  readonly data: StudioStatusDialogData = inject(MAT_DIALOG_DATA);

  readonly MESSAGE_MAX = MESSAGE_MAX;
  readonly minDate = startOfToday();

  readonly form = this.fb.group({
    status: this.fb.nonNullable.control<StudioStatusValue>(this.data.studio.status, Validators.required),
    status_message: this.fb.nonNullable.control(this.data.studio.status_message ?? ''),
    status_until: this.fb.control<Date | null>(parseDate(this.data.studio.status_until)),
  });
  readonly statusMessageControl = this.form.controls.status_message;
  readonly statusUntilControl = this.form.controls.status_until;

  readonly submitting = signal(false);
  readonly error = signal<string>('');

  private readonly statusValue$ = this.form.controls.status.valueChanges;
  readonly statusValue = toSignal(this.statusValue$, {
    initialValue: this.data.studio.status,
  });

  private readonly statusUntilValue$ = this.statusUntilControl.valueChanges;
  readonly statusUntilValue = toSignal(this.statusUntilValue$, {
    initialValue: this.statusUntilControl.value,
  });

  readonly wasClosedOrMaintenance = computed(() => this.data.studio.status !== 'open');
  readonly closureSummary = computed(() => {
    const date = this.statusUntilValue();
    if (!date) {
      return 'Дата нужна, чтобы запись на сайте открылась автоматически.';
    }
    const reopenDate = addDays(date, 1);
    return `Закрыто по ${formatDisplayDate(date)} включительно. Автооткрытие ${formatDisplayDate(reopenDate)}.`;
  });

  constructor() {
    effect(() => {
      this.syncStatusValidators(this.statusValue());
    });
  }

  reopenShortcut(): void {
    this.form.patchValue({
      status: 'open',
      status_message: '',
      status_until: null,
    });
    this.save();
  }

  submit(): void {
    const wasOpen = this.data.studio.status === 'open';
    const willBeClosed = this.form.controls.status.value !== 'open';

    if (wasOpen && willBeClosed) {
      const confirmData: ConfirmDialogData = {
        title: 'Закрыть студию?',
        message: `Клиенты не смогут бронировать «${this.data.studio.name}». Это действие будет видно на сайте.`,
        confirmLabel: 'Закрыть',
        cancelLabel: 'Отмена',
        icon: 'warning',
        warn: true,
      };
      this.dialog.open(ConfirmDialogComponent, { data: confirmData, width: '400px' })
        .afterClosed()
        .subscribe(ok => {
          if (ok) this.save();
        });
      return;
    }

    this.save();
  }

  private save(): void {
    const v = this.form.getRawValue();
    this.syncStatusValidators(v.status);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.error.set('');

    const payload = {
      status: v.status,
      status_message: v.status === 'open' ? null : (v.status_message?.trim() || null),
      status_until: v.status === 'open' ? null : toIsoDate(v.status_until),
    };

    this.svc.updateStatus(this.data.studio.id, payload).subscribe({
      next: () => {
        this.submitting.set(false);
        this.toast.success('Статус студии обновлён');
        this.dialogRef.close(true);
      },
      error: (err) => {
        this.submitting.set(false);
        const msg = err?.error?.error || err?.message || 'Не удалось обновить статус';
        this.error.set(msg);
        this.toast.error(msg);
      },
    });
  }

  private syncStatusValidators(status: StudioStatusValue): void {
    const msgCtrl = this.statusMessageControl;
    const untilCtrl = this.statusUntilControl;
    if (status !== 'open') {
      msgCtrl.setValidators([Validators.required, Validators.maxLength(MESSAGE_MAX)]);
      untilCtrl.setValidators([Validators.required]);
    } else {
      msgCtrl.clearValidators();
      untilCtrl.clearValidators();
    }
    msgCtrl.updateValueAndValidity({ emitEvent: false });
    untilCtrl.updateValueAndValidity({ emitEvent: false });
  }
}
