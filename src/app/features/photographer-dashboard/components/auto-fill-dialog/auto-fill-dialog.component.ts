import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';

export interface AutoFillDialogData {
  selectedDaysCount: number;
}

export interface AutoFillDialogResult {
  startTime: string;
  endTime: string;
  minDuration: number;
  fillMode: 'all' | 'selected';
}

@Component({
  selector: 'app-auto-fill-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatSlideToggleModule
],
  template: `
    <div class="auto-fill-dialog">
      <h2 mat-dialog-title>
        <mat-icon>auto_fix_high</mat-icon>
        Автозаполнение расписания выездных фотосессий
      </h2>
      
      <mat-dialog-content>
        <form [formGroup]="form" class="auto-fill-form">
          <p class="dialog-description">
            Система создаст широкие периоды доступности между студийными сменами. 
            Буферное время будет учитываться при записи клиентов.
          </p>

          <div class="time-settings">
            <mat-form-field appearance="outline">
              <mat-label>Начало рабочего дня</mat-label>
              <input matInput type="time" formControlName="startTime" />
              <mat-icon matSuffix>schedule</mat-icon>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Конец рабочего дня</mat-label>
              <input matInput type="time" formControlName="endTime" />
              <mat-icon matSuffix>schedule</mat-icon>
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Минимальная длительность периода (минуты)</mat-label>
            <input matInput type="number" formControlName="minDuration" min="30" max="480" />
            <mat-icon matSuffix>timer</mat-icon>
            <mat-hint>Минимальная длительность создаваемых периодов доступности</mat-hint>
          </mat-form-field>

          @if (data.selectedDaysCount > 0) {
            <div class="fill-mode-section">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Режим заполнения</mat-label>
                <mat-select formControlName="fillMode">
                  <mat-option value="selected">
                    Только выбранные дни ({{data.selectedDaysCount}})
                  </mat-option>
                  <mat-option value="all">
                    Все дни в календаре
                  </mat-option>
                </mat-select>
                <mat-icon matSuffix>event</mat-icon>
              </mat-form-field>
            </div>
          }
        </form>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()">
          <mat-icon>close</mat-icon>
          Отмена
        </button>
        <button mat-raised-button color="primary" 
                [disabled]="!form.valid" 
                (click)="onConfirm()">
          <mat-icon>auto_fix_high</mat-icon>
          Автозаполнить
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .auto-fill-dialog {
      min-width: 480px;
      max-width: 600px;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 16px 0;
      color: var(--mat-sys-primary);
    }

    .dialog-description {
      margin: 0 0 24px 0;
      color: var(--mat-sys-on-surface-variant);
      font-size: 14px;
      line-height: 1.5;
      background: var(--mat-sys-surface-variant);
      padding: 12px 16px;
      border-radius: 8px;
      border-left: 4px solid var(--mat-sys-primary);
    }

    .auto-fill-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .time-settings {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }

    .full-width {
      width: 100%;
    }

    .fill-mode-section {
      padding: 16px;
      background: var(--mat-sys-surface-container-low);
      border-radius: 12px;
      border: 1px solid var(--mat-sys-outline-variant);
    }

    mat-dialog-actions {
      padding: 16px 0 0 0;
      margin: 0;
      gap: 8px;
    }

    button[mat-button] {
      color: var(--mat-sys-on-surface-variant);
    }

    button[mat-raised-button] {
      box-shadow: var(--mat-sys-level1);
    }

    mat-form-field {
      font-size: 16px;
    }

    .mat-mdc-form-field-subscript-wrapper {
      font-size: 12px;
    }
  `]
})
export class AutoFillDialogComponent {
  private fb = inject(FormBuilder);
  private dialogRef = inject<MatDialogRef<AutoFillDialogComponent>>(MatDialogRef);
  data = inject<AutoFillDialogData>(MAT_DIALOG_DATA);

  form: FormGroup;

  constructor() {
    const data = this.data;

    this.form = this.fb.group({
      startTime: ['07:00', [Validators.required, Validators.pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)]],
      endTime: ['22:00', [Validators.required, Validators.pattern(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)]],
      minDuration: [90, [Validators.required, Validators.min(30), Validators.max(480)]],
      fillMode: [data.selectedDaysCount > 0 ? 'selected' : 'all', Validators.required]
    });
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onConfirm(): void {
    if (this.form.valid) {
      const result: AutoFillDialogResult = {
        startTime: this.form.value.startTime,
        endTime: this.form.value.endTime,
        minDuration: this.form.value.minDuration,
        fillMode: this.form.value.fillMode
      };
      this.dialogRef.close(result);
    }
  }
}
