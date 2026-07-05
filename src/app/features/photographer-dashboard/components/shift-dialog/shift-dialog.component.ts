import { Component, ChangeDetectionStrategy, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatTimepickerModule } from '@angular/material/timepicker';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';

import { ScheduleShift, ShiftType, StudioEmployee } from '../../models/studio-schedule.models';

export interface ShiftDialogData {
  shift?: ScheduleShift;
  date?: Date;
  employees: StudioEmployee[];
  studioId: string;
}

@Component({
  selector: 'app-shift-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatTimepickerModule,
    MatSlideToggleModule,
    MatIconModule
  ],
  template: `
    <div class="shift-dialog">
      <h2 mat-dialog-title>
        {{ isEditing() ? 'Редактировать смену' : 'Создать смену' }}
      </h2>

      <form [formGroup]="shiftForm" (ngSubmit)="onSubmit()">
        <mat-dialog-content class="dialog-content">
          <!-- Дата смены -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Дата смены</mat-label>
            <input matInput [matDatepicker]="datePicker" formControlName="date" readonly>
            <mat-datepicker-toggle matIconSuffix [for]="datePicker"></mat-datepicker-toggle>
            <mat-datepicker #datePicker></mat-datepicker>
            @if (shiftForm.get('date')?.hasError('required')) {
              <mat-error>
                Выберите дату смены
              </mat-error>
            }
          </mat-form-field>

          <!-- Время начала и окончания -->
          <div class="time-fields">
            <mat-form-field appearance="outline">
              <mat-label>Время начала</mat-label>
              <input matInput type="time" formControlName="startTime">
              @if (shiftForm.get('startTime')?.hasError('required')) {
                <mat-error>
                  Укажите время начала
                </mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Время окончания</mat-label>
              <input matInput type="time" formControlName="endTime">
              @if (shiftForm.get('endTime')?.hasError('required')) {
                <mat-error>
                  Укажите время окончания
                </mat-error>
              }
              @if (shiftForm.get('endTime')?.hasError('timeRange')) {
                <mat-error>
                  Время окончания должно быть позже времени начала
                </mat-error>
              }
            </mat-form-field>
          </div>

          <!-- Тип смены -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Тип смены</mat-label>
            <mat-select formControlName="type">
              <mat-option value="regular">Обычная смена</mat-option>
              <mat-option value="extended">Удлиненная смена</mat-option>
              <mat-option value="short">Короткая смена</mat-option>
              <mat-option value="night">Ночная смена</mat-option>
              <mat-option value="holiday">Праздничная смена</mat-option>
            </mat-select>
          </mat-form-field>

          <!-- Назначенный сотрудник -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Назначенный сотрудник</mat-label>
            <mat-select formControlName="employeeId">
              <mat-option value="">Не назначен</mat-option>
              @for (employee of data.employees; track employee.id || $index) {
                <mat-option [value]="employee.id">
                  {{ employee.name }} ({{ getRoleLabel(employee.role) }})
                </mat-option>
              }
            </mat-select>
          </mat-form-field>

          <!-- Максимальная загрузка -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Максимальное количество записей</mat-label>
            <input matInput type="number" formControlName="maxCapacity" min="1" max="20">
            <mat-hint>Максимальное количество клиентов, которых можно записать на эту смену</mat-hint>
          </mat-form-field>

          <!-- Заметки -->
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Заметки</mat-label>
            <textarea matInput formControlName="notes" rows="3" 
                      placeholder="Дополнительная информация о смене..."></textarea>
          </mat-form-field>

          <!-- Дополнительные настройки -->
          <div class="additional-settings">
            <h3>Дополнительные настройки</h3>
            
            <!-- Активность смены -->
            <div class="setting-row">
              <mat-slide-toggle formControlName="isActive">
                Смена активна
              </mat-slide-toggle>
              <span class="setting-description">
                Неактивные смены не отображаются клиентам для записи
              </span>
            </div>
          </div>
        </mat-dialog-content>

        <mat-dialog-actions align="end" class="dialog-actions">
          <button mat-button type="button" (click)="onCancel()">
            Отмена
          </button>
          @if (isEditing()) {
            <button mat-button color="warn" type="button" 
                    (click)="onDelete()">
              <mat-icon>delete</mat-icon>
              Удалить
            </button>
          }
          <button mat-raised-button color="primary" 
                  type="submit"
                  [disabled]="shiftForm.invalid || isSubmitting()">
            <mat-icon>{{ isEditing() ? 'save' : 'add' }}</mat-icon>
            {{ isEditing() ? 'Сохранить' : 'Создать' }}
          </button>
        </mat-dialog-actions>
      </form>
    </div>
  `,
  styleUrls: ['./shift-dialog.component.scss']
})
export class ShiftDialogComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<ShiftDialogComponent>);
  readonly data = inject<ShiftDialogData>(MAT_DIALOG_DATA);

  shiftForm!: FormGroup;
  protected isSubmitting = signal(false);
  protected isEditing = signal(false);

  constructor() {
    this.isEditing.set(!!this.data.shift);
    this.initForm();
  }

  ngOnInit() {
    if (this.data.shift) {
      this.populateForm(this.data.shift);
    } else if (this.data.date) {
      this.shiftForm.patchValue({
        date: this.data.date
      });
    }
  }

  private initForm() {
    this.shiftForm = this.fb.group({
      date: [new Date(), Validators.required],
      startTime: ['09:00', Validators.required],
      endTime: ['18:00', Validators.required],
      type: ['regular' as ShiftType, Validators.required],
      employeeId: [''],
      maxCapacity: [8, [Validators.required, Validators.min(1), Validators.max(20)]],
      notes: [''],
      isActive: [true]
    }, { validators: this.timeRangeValidator });
  }

  private populateForm(shift: ScheduleShift) {
    this.shiftForm.patchValue({
      date: shift.date,
      startTime: shift.startTime,
      endTime: shift.endTime,
      type: shift.type,
      employeeId: shift.employeeId || '',
      maxCapacity: shift.maxCapacity,
      notes: shift.notes || '',
      isActive: shift.status !== 'cancelled'
    });
  }

  // Валидатор времени
  private timeRangeValidator(form: FormGroup) {
    const startTime = form.get('startTime')?.value;
    const endTime = form.get('endTime')?.value;
    
    if (!startTime || !endTime) {
      return null;
    }

    const start = new Date(`2000-01-01 ${startTime}`);
    const end = new Date(`2000-01-01 ${endTime}`);

    return start < end ? null : { timeRange: true };
  }

  getRoleLabel(role: string): string {
    const labels: Record<string, string> = {
      'photographer': 'Фотограф',
      'administrator': 'Администратор',
      'assistant': 'Ассистент'
    };
    return labels[role] || role;
  }

  onSubmit() {
    if (this.shiftForm.valid && !this.isSubmitting()) {
      this.isSubmitting.set(true);
      
      const formValue = this.shiftForm.value;
      const shiftData: Partial<ScheduleShift> = {
        ...formValue,
        studioId: this.data.studioId,
        status: formValue.isActive ? 'scheduled' : 'cancelled',
        currentBookings: this.data.shift?.currentBookings || 0
      };

      if (this.isEditing()) {
        shiftData.id = this.data.shift!.id;
      }

      this.dialogRef.close({
        action: this.isEditing() ? 'update' : 'create',
        data: shiftData
      });
    }
  }

  onDelete() {
    if (this.data.shift) {
      this.dialogRef.close({
        action: 'delete',
        data: this.data.shift
      });
    }
  }

  onCancel() {
    this.dialogRef.close();
  }
}
