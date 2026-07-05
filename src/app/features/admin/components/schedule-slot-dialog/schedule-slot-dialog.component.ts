import { Component, ChangeDetectionStrategy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDatepickerModule } from '@angular/material/datepicker';

import { ScheduleService } from '../../../../core/services/schedule.service';
import { PhotographerSchedule, ScheduleSlot } from '../../../../shared/models/schedule.model';

export interface ScheduleSlotDialogData {
  schedule: PhotographerSchedule;
  slot?: ScheduleSlot;
  mode: 'view' | 'edit' | 'create';
}

@Component({
  selector: 'app-schedule-slot-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatDatepickerModule
  ],
  template: `
    <div class="dialog-container">
      <div mat-dialog-title class="dialog-title">
        <mat-icon>{{ getDialogIcon() }}</mat-icon>
        <span>{{ getDialogTitle() }}</span>
      </div>

      <mat-dialog-content class="dialog-content">
        @if (data.mode !== 'view') {
          <form [formGroup]="slotForm">
          <!-- Дата и время -->
          <div class="form-section">
            <h4>Дата и время</h4>
            <div class="form-row">
              <mat-form-field appearance="outline">
                <mat-label>Дата</mat-label>
                <input matInput [matDatepicker]="picker" formControlName="date" readonly>
                <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
                <mat-datepicker #picker></mat-datepicker>
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline">
                <mat-label>Время начала</mat-label>
                <input matInput type="time" formControlName="startTime">
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Время окончания</mat-label>
                <input matInput type="time" formControlName="endTime">
              </mat-form-field>
            </div>

            <mat-form-field appearance="outline">
              <mat-label>Продолжительность (минуты)</mat-label>
              <input matInput type="number" formControlName="duration" min="30" max="480">
            </mat-form-field>
          </div>

          <!-- Доступность -->
          <div class="form-section">
            <h4>Доступность</h4>
            <div class="checkbox-group">
              <mat-checkbox formControlName="isAvailable">
                Слот доступен для бронирования
              </mat-checkbox>
              <mat-checkbox formControlName="isBooked" [disabled]="true">
                Слот забронирован
              </mat-checkbox>
            </div>
          </div>

          <!-- Услуги -->
          <div class="form-section">
            <h4>Доступные услуги</h4>
            <mat-form-field appearance="outline">
              <mat-label>Типы услуг</mat-label>
              <mat-select formControlName="serviceTypes" multiple>
                <mat-option value="portrait">Портретная съемка</mat-option>
                <mat-option value="family">Семейная съемка</mat-option>
                <mat-option value="individual">Индивидуальная съемка</mat-option>
                <mat-option value="wedding">Свадебная съемка</mat-option>
                <mat-option value="event">Мероприятия</mat-option>
                <mat-option value="outdoor">Уличная съемка</mat-option>
                <mat-option value="commercial">Коммерческая съемка</mat-option>
              </mat-select>
            </mat-form-field>
          </div>

          <!-- Цена и локация -->
          <div class="form-section">
            <h4>Дополнительная информация</h4>
            <div class="form-row">
              <mat-form-field appearance="outline">
                <mat-label>Стоимость</mat-label>
                <input matInput type="number" formControlName="price" min="0">
                <span matSuffix>₽</span>
              </mat-form-field>

              @if (data.schedule.scheduleType === 'location') {
                <mat-form-field appearance="outline">
                  <mat-label>Локация</mat-label>
                  <input matInput formControlName="location" placeholder="Адрес или описание места">
                </mat-form-field>
              }
            </div>

            <mat-form-field appearance="outline">
              <mat-label>Примечания</mat-label>
              <textarea matInput formControlName="notes" rows="3" placeholder="Дополнительная информация..."></textarea>
            </mat-form-field>
          </div>
          </form>
        }

        <!-- Режим просмотра -->
        @if (data.mode === 'view' && data.slot) {
          <div class="slot-details">
          <div class="detail-section">
            <h4>Основная информация</h4>
            <div class="detail-row">
              <span class="label">Дата:</span>
              <span class="value">{{ formatDate(data.slot.date) }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Время:</span>
              <span class="value">{{ data.slot.startTime }} - {{ data.slot.endTime }}</span>
            </div>
            <div class="detail-row">
              <span class="label">Продолжительность:</span>
              <span class="value">{{ data.slot.duration }} минут</span>
            </div>
          </div>

          <div class="detail-section">
            <h4>Статус</h4>
            <div class="status-chips">
              <span class="status-chip" [class.available]="data.slot.isAvailable" [class.unavailable]="!data.slot.isAvailable">
                {{ data.slot.isAvailable ? 'Доступен' : 'Недоступен' }}
              </span>
              <span class="status-chip" [class.booked]="data.slot.isBooked" [class.free]="!data.slot.isBooked">
                {{ data.slot.isBooked ? 'Забронирован' : 'Свободен' }}
              </span>
            </div>
          </div>

          @if (data.slot.serviceTypes?.length) {
            <div class="detail-section">
              <h4>Доступные услуги</h4>
              <div class="service-chips">
                @for (service of data.slot.serviceTypes; track service || $index) {
                  <span class="service-chip">
                    {{ getServiceName(service) }}
                  </span>
                }
              </div>
            </div>
          }

          @if (data.slot.price) {
            <div class="detail-section">
              <h4>Стоимость</h4>
              <div class="detail-row">
                <span class="price">{{ data.slot.price }}₽</span>
              </div>
            </div>
          }

          @if (data.slot.location && data.schedule.scheduleType === 'location') {
            <div class="detail-section">
              <h4>Локация</h4>
              <div class="detail-row">
                <span class="value">{{ data.slot.location }}</span>
              </div>
            </div>
          }

          @if (data.slot.notes) {
            <div class="detail-section">
              <h4>Примечания</h4>
              <div class="detail-row">
                <span class="value">{{ data.slot.notes }}</span>
              </div>
            </div>
          }
          </div>
        }

        @if (loading()) {
          <div class="loading-overlay">
            <mat-spinner diameter="40"></mat-spinner>
            <p>Сохранение изменений...</p>
          </div>
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="cancel()">
          Отмена
        </button>

        @if (data.mode === 'view') {
          <button
            mat-button
            color="primary"
            (click)="switchToEdit()">
            <mat-icon>edit</mat-icon>
            Редактировать
          </button>
        }

        @if (data.mode !== 'view') {
          <button
            mat-raised-button
            color="primary"
            (click)="save()"
            [disabled]="slotForm.invalid || loading()">
            <mat-icon>save</mat-icon>
            {{ data.mode === 'create' ? 'Создать' : 'Сохранить' }}
          </button>
        }
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .dialog-container {
      min-width: 500px;
      max-width: 600px;
    }

    .dialog-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 20px;
      font-weight: 500;
      margin-bottom: 16px;
    }

    .dialog-content {
      max-height: 70vh;
      overflow-y: auto;
    }

    .form-section {
      margin-bottom: 24px;
    }

    .form-section h4 {
      margin: 0 0 16px 0;
      font-size: 16px;
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .form-row {
      display: flex;
      gap: 16px;
      margin-bottom: 16px;
    }

    .form-row mat-form-field {
      flex: 1;
    }

    .checkbox-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .detail-section {
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--crm-border);
    }

    .detail-section:last-child {
      border-bottom: none;
    }

    .detail-section h4 {
      margin: 0 0 12px 0;
      font-size: 16px;
      font-weight: 500;
      color: var(--crm-text-primary);
    }

    .detail-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }

    .detail-row .label {
      font-weight: 500;
      color: var(--crm-text-secondary);
      min-width: 140px;
    }

    .detail-row .value {
      color: var(--crm-text-primary);
    }

    .status-chips, .service-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .status-chip, .service-chip {
      padding: 4px 12px;
      border-radius: var(--crm-radius-md);
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
    }

    .status-chip.available {
      background: var(--crm-status-success-container);
      color: var(--crm-status-success);
    }

    .status-chip.unavailable {
      background: var(--crm-status-error-container);
      color: var(--crm-status-error);
    }

    .status-chip.booked {
      background: var(--crm-status-warning-container);
      color: var(--crm-status-warning);
    }

    .status-chip.free {
      background: var(--crm-status-info-container);
      color: var(--crm-status-info);
    }

    .service-chip {
      background-color: var(--mat-sys-surface-container-high);
      color: var(--crm-text-secondary);
    }

    .price {
      font-size: 24px;
      font-weight: 500;
      color: var(--crm-status-success);
      font-family: var(--crm-font-mono);
    }

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background-color: rgba(20, 20, 20, 0.85);
      z-index: 10;
    }

    .loading-overlay p {
      margin-top: 16px;
      color: var(--crm-text-secondary);
    }

    @media (max-width: 600px) {
      .dialog-container {
        min-width: auto;
        width: 100%;
      }

      .form-row {
        flex-direction: column;
      }
    }
  `]
})
export class ScheduleSlotDialogComponent {
  private readonly scheduleService = inject(ScheduleService);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<ScheduleSlotDialogComponent>);
  protected readonly data = inject<ScheduleSlotDialogData>(MAT_DIALOG_DATA);

  protected readonly loading = signal(false);
  protected readonly slotForm: FormGroup;

  private readonly serviceNames = {
    portrait: 'Портретная съемка',
    family: 'Семейная съемка',
    individual: 'Индивидуальная съемка',
    wedding: 'Свадебная съемка',
    event: 'Мероприятия',
    outdoor: 'Уличная съемка',
    commercial: 'Коммерческая съемка'
  };

  constructor() {
    this.slotForm = this.createForm();
    this.initializeForm();
  }

  private createForm(): FormGroup {
    return this.fb.group({
      date: ['', Validators.required],
      startTime: ['', Validators.required],
      endTime: ['', Validators.required],
      duration: [120, [Validators.required, Validators.min(30), Validators.max(480)]],
      isAvailable: [true],
      isBooked: [false],
      serviceTypes: [[], Validators.required],
      price: [0, Validators.min(0)],
      location: [''],
      notes: ['']
    });
  }

  private initializeForm(): void {
    if (this.data.slot) {
      this.slotForm.patchValue({
        date: this.data.slot.date,
        startTime: this.data.slot.startTime,
        endTime: this.data.slot.endTime,
        duration: this.data.slot.duration,
        isAvailable: this.data.slot.isAvailable,
        isBooked: this.data.slot.isBooked,
        serviceTypes: this.data.slot.serviceTypes || [],
        price: this.data.slot.price || 0,
        location: this.data.slot.location || '',
        notes: this.data.slot.notes || ''
      });
    }

    // Устанавливаем значения по умолчанию для новых слотов
    if (this.data.mode === 'create') {
      const defaultServices = this.data.schedule.scheduleType === 'studio'
        ? ['portrait', 'family', 'individual']
        : ['wedding', 'event', 'outdoor'];

      this.slotForm.patchValue({
        serviceTypes: defaultServices,
        location: this.data.schedule.scheduleType === 'studio' ? 'Студия Magnus' : ''
      });
    }
  }

  protected getDialogIcon(): string {
    switch (this.data.mode) {
      case 'create': return 'add_circle';
      case 'edit': return 'edit';
      case 'view': return 'visibility';
      default: return 'schedule';
    }
  }

  protected getDialogTitle(): string {
    switch (this.data.mode) {
      case 'create': return 'Создать новый слот';
      case 'edit': return 'Редактировать слот';
      case 'view': return 'Просмотр слота';
      default: return 'Слот расписания';
    }
  }

  protected formatDate(date: Date): string {
    return date.toLocaleDateString('ru-RU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  protected getServiceName(serviceCode: string): string {
    return this.serviceNames[serviceCode as keyof typeof this.serviceNames] || serviceCode;
  }

  protected switchToEdit(): void {
    this.data.mode = 'edit';
  }

  protected async save(): Promise<void> {
    if (this.slotForm.invalid) return;

    try {
      this.loading.set(true);
      const formValue = this.slotForm.value;

      if (this.data.mode === 'edit' && this.data.slot) {
        // Обновляем существующий слот
        await this.scheduleService.updateScheduleSlot(
          this.data.schedule.id,
          this.data.slot.id,
          formValue
        );

        this.snackBar.open('Слот обновлен успешно', 'Закрыть', { duration: 3000 });
      } else if (this.data.mode === 'create') {
        // Создаем новый слот (требует доработки в сервисе)
        this.snackBar.open('Создание новых слотов пока не поддерживается', 'Закрыть', { duration: 3000 });
      }

      this.dialogRef.close(true);

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
      this.snackBar.open(
        `Ошибка сохранения: ${message}`,
        'Закрыть',
        { duration: 5000 }
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected cancel(): void {
    this.dialogRef.close(false);
  }
}
