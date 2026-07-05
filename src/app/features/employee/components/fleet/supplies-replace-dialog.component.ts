import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import {
  FormBuilder, Validators, ReactiveFormsModule,
} from '@angular/forms';
import {
  MatDialogModule, MatDialogRef, MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { toSignal } from '@angular/core/rxjs-interop';

import { FleetApiService } from './services/fleet-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { SUPPLY_TYPE_OPTIONS } from './models/fleet-p1.models';

export interface SuppliesReplaceDialogData {
  printerId: string;
  printerName: string;
}

export interface SuppliesReplaceDialogResult {
  auto_resolved_alerts: number;
}

const NOTE_MAX = 500;
const INDEX_OPTIONS = Array.from({ length: 20 }, (_, i) => i + 1);

@Component({
  selector: 'app-supplies-replace-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Замена расходника</h2>
    <mat-dialog-content>
      <p class="subtitle">{{ data.printerName }}</p>
      <form [formGroup]="form" class="form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Тип расходника</mat-label>
          <mat-select formControlName="supply_type" required>
            @for (opt of supplyOptions; track opt.value) {
              <mat-option [value]="opt.value">{{ opt.label }}</mat-option>
            }
          </mat-select>
          @if (form.controls.supply_type.hasError('required') && form.controls.supply_type.touched) {
            <mat-error>Выберите тип расходника</mat-error>
          }
        </mat-form-field>

        @if (needsIndex()) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Номер лотка</mat-label>
            <mat-select formControlName="supply_index">
              @for (idx of indexOptions; track idx) {
                <mat-option [value]="idx">Лоток {{ idx }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Заметка (необязательно)</mat-label>
          <textarea
            matInput
            formControlName="note"
            rows="3"
            [maxlength]="noteMax"
            placeholder="Например: поставлен новый картридж, серийный номер…"></textarea>
          <mat-hint align="end">{{ form.controls.note.value.length }} / {{ noteMax }}</mat-hint>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        type="button"
        mat-button
        [disabled]="loading()"
        (click)="cancel()">Отмена</button>
      <button
        type="button"
        mat-flat-button
        color="primary"
        [disabled]="loading() || form.invalid"
        (click)="submit()">
        @if (loading()) {
          <mat-spinner diameter="18"></mat-spinner>
        } @else {
          Сохранить
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    :host { display: block; }
    .subtitle {
      margin: 0 0 12px;
      color: #6b7280;
      font-size: 13px;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 440px;
    }
    .full-width { width: 100%; }
    mat-spinner { display: inline-block; }
  `]
})
export class SuppliesReplaceDialogComponent {
  private readonly fb = inject(FormBuilder);
  private readonly api = inject(FleetApiService);
  private readonly toast = inject(ToastService);
  private readonly dialogRef = inject<MatDialogRef<SuppliesReplaceDialogComponent, SuppliesReplaceDialogResult | null>>(MatDialogRef);
  readonly data = inject<SuppliesReplaceDialogData>(MAT_DIALOG_DATA);

  readonly supplyOptions = SUPPLY_TYPE_OPTIONS;
  readonly indexOptions = INDEX_OPTIONS;
  readonly noteMax = NOTE_MAX;
  readonly loading = signal(false);

  readonly form = this.fb.nonNullable.group({
    supply_type: this.fb.nonNullable.control<string>('', { validators: [Validators.required] }),
    supply_index: this.fb.control<number | null>(null),
    note: this.fb.nonNullable.control<string>('', { validators: [Validators.maxLength(NOTE_MAX)] }),
  });

  private readonly supplyTypeSignal = toSignal(this.form.controls.supply_type.valueChanges, { initialValue: this.form.controls.supply_type.value });

  readonly needsIndex = computed(() => {
    const v = this.supplyTypeSignal();
    return typeof v === 'string' && v.startsWith('paper_tray');
  });

  submit(): void {
    if (this.loading() || this.form.invalid) return;
    this.loading.set(true);
    const raw = this.form.getRawValue();
    const body: { supply_type: string; supply_index?: number; note?: string } = {
      supply_type: raw.supply_type,
    };
    if (this.needsIndex() && raw.supply_index !== null && raw.supply_index !== undefined) {
      body.supply_index = raw.supply_index;
    }
    if (raw.note && raw.note.trim().length > 0) {
      body.note = raw.note.trim();
    }

    this.api.replaceSupply(this.data.printerId, body).subscribe({
      next: (res) => {
        this.loading.set(false);
        const autoResolved = res.auto_resolved_alerts;
        const msg = autoResolved > 0
          ? `Замена записана, авто-закрыто алертов: ${autoResolved}`
          : 'Замена записана';
        this.toast.success(msg);
        this.dialogRef.close({ auto_resolved_alerts: autoResolved });
      },
      error: (err) => {
        this.loading.set(false);
        const msg = err?.error?.message ?? err?.message ?? 'Ошибка при записи замены';
        this.toast.error(msg);
      },
    });
  }

  cancel(): void {
    if (this.loading()) return;
    this.dialogRef.close(null);
  }
}
