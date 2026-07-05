import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit, PLATFORM_ID } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, FormGroup, FormArray, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../../../core/services/auth.service';
import { PhotographerApiService, Photographer } from '../../../../core/services/photographer-api.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { AutoFillDialogComponent, AutoFillDialogResult } from '../auto-fill-dialog/auto-fill-dialog.component';
import { firstValueFrom } from 'rxjs';
import { isPlatformBrowser } from '@angular/common';

// Интерфейсы для работы с расписанием фотографа
interface PhotographerAvailability {
  workingHours: Record<string, {
      isAvailable: boolean;
      start: string;
      end: string;
    }>;
  timeOff: {
    startDate: string;
    endDate: string;
    reason?: string;
  }[];
  customDays?: Record<string, {
      isWorking: boolean;
      timeSlots: TimeSlot[];
    }>;
  eventWorkingDays?: Record<string, {
      isEventWorking: boolean;
      eventTimeSlots: EventTimeSlot[];
      notes?: string;
    }>;
  bufferSettings?: BufferSettings; // Настройки буферного времени
  isActive: boolean;
}

interface TimeSlot {
  start: string;
  end: string;
}

interface CustomScheduleDay {
  date: string;
  isWorking: boolean;
  timeSlots: TimeSlot[];
}

interface DailySchedule {
  date: string;
  isWorkingDay: boolean;
  workingHours?: {
    start: string;
    end: string;
  };
  shifts: ScheduleShift[];
  isCustomized: boolean;
}

interface ScheduleShift {
  id?: string;
  startTime: string;
  endTime: string;
  status: 'open' | 'assigned' | 'booked' | 'cancelled';
  bookings: ShiftBooking[];
  maxBookings: number;
  currentBookings: number;
}

interface ShiftBooking {
  id: string;
  startTime: string;
  endTime: string;
  clientName: string;
  clientNotes?: string;
  status: string;
}

interface StudioCalendarDay {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isWorking: boolean;
  isCustom: boolean;
  hasBookings: boolean;
  workingHours: string;
  timeSlots: { start: string; end: string; location?: string }[];
}

// Интерфейсы для event расписания
interface EventCalendarDay {
  date: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isEventWorkingDay: boolean;
  hasStudioConflict: boolean;
  hasEventBookings: boolean;
  isSelected: boolean;
  isCustom: boolean;
  eventWorkingHours?: string;
  eventTimeSlots: EventTimeSlot[];
  notes?: string;
}

interface EventTimeSlot {
  start: string;
  end: string;
  location?: string;
}

// Интерфейс для настроек буферного времени
interface BufferSettings {
  enabled: boolean;
  defaultBuffer: number; // в минутах
  locationChangeBuffer: number; // дополнительный буфер при смене локации
}

interface EventWorkingDay {
  date: string;
  isEventWorking: boolean;
  eventTimeSlots: EventTimeSlot[];
  notes?: string;
}

@Component({
  selector: 'app-photographer-schedule-editor-v2',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDialogModule,
    MatExpansionModule,
    MatToolbarModule,
    MatDividerModule,
    MatMenuModule
],
  template: `
    <div class="schedule-editor-container">
      <!-- Заголовок -->
      <mat-toolbar color="primary">
        <mat-icon>schedule</mat-icon>
        <span>Управление расписанием</span>
        <span class="spacer"></span>
        <button mat-icon-button (click)="refreshSchedule()" [disabled]="isLoading()">
          <mat-icon>refresh</mat-icon>
        </button>
      </mat-toolbar>

      <!-- Индикатор загрузки -->
      @if (isLoading()) {
        <div class="loading-container">
          <mat-progress-spinner mode="indeterminate" diameter="40" />
          <p>Загружаем расписание...</p>
        </div>
      }

      <!-- Основной контент -->
      @if (!isLoading()) {
        <div class="content-container">
        <!-- Вкладки управления -->
        <mat-tab-group [selectedIndex]="selectedTabIndex()" (selectedTabChange)="onTabChange($event)">
          
          <!-- Общие настройки доступности -->
          <mat-tab label="Общие настройки">
            <div class="tab-content">
              <mat-card>
                <mat-card-header>
                  <mat-card-title>Стандартное расписание работы</mat-card-title>
                  <mat-card-subtitle>Настройте обычные рабочие часы по дням недели</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                  <form [formGroup]="generalForm">
                    <!-- Активность -->
                    <div class="form-row">
                      <mat-slide-toggle 
                        formControlName="isActive" 
                        color="primary">
                        Принимать новые записи
                      </mat-slide-toggle>
                    </div>

                    <!-- Рабочие дни -->
                    <div class="working-days-section">
                      <h3>Рабочие дни</h3>
                      <div formArrayName="workingDays" class="working-days-grid">
                        @for (dayControl of workingDaysControls.controls; track $index; let i = $index) {
                          <div 
                            [formGroupName]="i"
                            class="working-day-card">
                            <mat-card>
                              <mat-card-content>
                                <div class="day-header">
                                  <h4>{{ getDayName(i) }}</h4>
                                  <mat-slide-toggle formControlName="isAvailable" color="primary">
                                    Работаю
                                  </mat-slide-toggle>
                                </div>
                                
                                @if (dayControl.get('isAvailable')?.value) {
                                  <div class="time-inputs">
                                    <mat-form-field appearance="outline">
                                      <mat-label>Начало</mat-label>
                                      <input matInput type="time" formControlName="start" min="06:00" max="23:59">
                                    </mat-form-field>
                                    <mat-form-field appearance="outline">
                                      <mat-label>Конец</mat-label>
                                      <input matInput type="time" formControlName="end" min="06:00" max="23:59">
                                    </mat-form-field>
                                  </div>
                                }
                              </mat-card-content>
                            </mat-card>
                          </div>
                        }
                      </div>                    </div>

                    <!-- Настройки буферного времени -->
                    <div class="buffer-settings-section">
                      <h3>Настройки буферного времени между выездными фотосессиями</h3>
                      <div formGroupName="bufferSettings" class="buffer-settings-form">
                        <div class="form-row">
                          <mat-slide-toggle 
                            formControlName="enabled" 
                            color="primary">
                            Использовать буферное время
                          </mat-slide-toggle>
                        </div>
                        
                        @if (generalForm.get('bufferSettings.enabled')?.value) {
                          <div class="buffer-inputs">
                            <mat-form-field appearance="outline">
                              <mat-label>Стандартный буфер (минуты)</mat-label>
                              <input matInput 
                                     type="number" 
                                     formControlName="defaultBuffer" 
                                     min="0" 
                                     max="180"
                                     placeholder="30">
                              <mat-hint>Минимальное время между фотосессиями</mat-hint>
                            </mat-form-field>
                            
                            <mat-form-field appearance="outline">
                              <mat-label>Дополнительный буфер при смене локации (минуты)</mat-label>
                              <input matInput 
                                     type="number" 
                                     formControlName="locationChangeBuffer" 
                                     min="0" 
                                     max="240"
                                     placeholder="60">
                              <mat-hint>Дополнительное время при переезде между локациями</mat-hint>
                            </mat-form-field>
                          </div>
                        }
                      </div>
                    </div>

                    <!-- Кнопки действий -->
                    <div class="form-actions">
                      <button 
                        mat-raised-button 
                        color="primary" 
                        (click)="saveGeneralSettings()"
                        [disabled]="!generalForm.valid || isSaving()">
                        <mat-icon>save</mat-icon>
                        Сохранить настройки
                      </button>
                      <button 
                        mat-button 
                        (click)="resetGeneralForm()">
                        Сбросить
                      </button>
                    </div>
                  </form>
                </mat-card-content>
              </mat-card>
            </div>
          </mat-tab>          <!-- Индивидуальные дни -->
          <mat-tab label="Индивидуальные дни">
            <div class="tab-content">
              <mat-card>
                <mat-card-header>
                  <mat-card-title>Особые дни работы</mat-card-title>
                  <mat-card-subtitle>Настройте индивидуальное расписание для конкретных дней</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>                  <!-- Календарь выбора месяца -->
                  <div class="month-selector">
                    <mat-form-field appearance="outline">
                      <mat-label>Выберите месяц</mat-label>
                      <input matInput [matDatepicker]="monthPicker" 
                             [value]="currentMonth()" 
                             (dateChange)="onMonthChange($event)"
                             readonly>
                      <mat-datepicker-toggle matSuffix [for]="monthPicker" />
                      <mat-datepicker #monthPicker startView="year" (monthSelected)="onMonthSelected($event)" />
                    </mat-form-field>
                    
                    <!-- Кнопки управления выделением -->
                    <div class="selection-controls">
                      <mat-slide-toggle 
                        [checked]="isMultiSelectMode()" 
                        (change)="toggleMultiSelectMode()"
                        color="primary">
                        Множественное выделение
                      </mat-slide-toggle>
                      @if (selectedDays().size > 0) {
                        <button 
                          mat-button 
                          (click)="clearSelection()">
                          Снять выделение ({{ selectedDays().size }})
                        </button>
                      }
                    </div>
                  </div>

                  <!-- Календарь дней -->
                  <div class="calendar-grid">
                    <div class="calendar-header">
                      <div class="day-name">Пн</div>
                      <div class="day-name">Вт</div>
                      <div class="day-name">Ср</div>
                      <div class="day-name">Чт</div>
                      <div class="day-name">Пт</div>
                      <div class="day-name">Сб</div>
                      <div class="day-name">Вс</div>
                    </div>
                    <div class="calendar-body">
                      @for (day of calendarDays(); track day.date || $index) {
                        <div 
                          class="calendar-day"
                          [class.other-month]="!day.isCurrentMonth"
                          [class.working-day]="day.isWorking && !day.isCustom"
                          [class.custom-day]="day.isCustom"
                          [class.has-bookings]="day.hasBookings"
                          [class.selected-day]="selectedDay()?.date === day.date"
                          [class.multi-selected]="selectedDays().has(day.date)"
                          (click)="handleDayClick(day)"
                          (keydown.enter)="handleDayClick(day)"
                          tabindex="0">
                          <div class="day-number">{{ day.dayNumber }}</div>
                          @if (day.workingHours) {
                            <div class="day-info">
                              <small>{{ day.workingHours }}</small>
                            </div>
                          }
                          @if (day.hasBookings) {
                            <div class="booking-indicator">
                              <mat-icon class="booking-icon">event</mat-icon>
                            </div>
                          }
                          @if (day.isCustom) {
                            <div class="custom-indicator">
                              <mat-icon class="custom-icon">edit</mat-icon>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </div>                  <!-- Настройка выбранного дня -->
                  @if (selectedDay() && !isMultiSelectMode()) {
                    <mat-card class="day-editor">
                    <mat-card-header>
                      <mat-card-title>
                        Настройка дня: {{ formatDate(selectedDay()!.date) }}
                      </mat-card-title>
                      <mat-card-subtitle>
                        {{ getDayOfWeekName(selectedDay()!.date) }}
                      </mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content>
                      <form [formGroup]="dayForm">
                        <div class="form-row">
                          <mat-slide-toggle formControlName="isWorking" color="primary">
                            Рабочий день (переопределяет общие настройки)
                          </mat-slide-toggle>
                        </div>

                        @if (dayForm.get('isWorking')?.value) {
                          <div class="time-slots-section">
                            <h4>
                              Временные слоты 
                              <mat-icon matTooltip="Вы можете создать несколько рабочих периодов в день">info</mat-icon>
                            </h4>
                            <div formArrayName="timeSlots">
                              @for (slot of timeSlotsControls.controls; track $index; let i = $index) {
                                <div 
                                  [formGroupName]="i"
                                  class="time-slot-row">
                              <mat-form-field appearance="outline">
                                <mat-label>Начало</mat-label>
                                <input matInput type="time" formControlName="start" min="06:00" max="23:59">
                              </mat-form-field>
                              <mat-form-field appearance="outline">
                                <mat-label>Конец</mat-label>
                                <input matInput type="time" formControlName="end" min="06:00" max="23:59">
                              </mat-form-field>
                              <button 
                                mat-icon-button 
                                color="warn" 
                                type="button"
                                (click)="removeTimeSlot(i)"
                                [disabled]="timeSlotsControls.controls.length <= 1"
                                matTooltip="Удалить временной слот">
                                  <mat-icon>delete</mat-icon>
                                </button>
                              </div>
                              }
                            </div>
                            
                            <button 
                              mat-button 
                              color="primary" 
                              type="button"
                              (click)="addTimeSlot()"
                              matTooltip="Добавить ещё один рабочий период">
                              <mat-icon>add</mat-icon>
                              Добавить слот
                            </button>
                          </div>
                        }

                        <div class="form-actions">
                          <button 
                            mat-raised-button 
                            color="primary" 
                            type="button"
                            (click)="saveDaySettings()"
                            [disabled]="!dayForm.valid || isSaving()">
                            <mat-icon>save</mat-icon>
                            Сохранить день
                          </button>
                          <button 
                            mat-button 
                            type="button"
                            (click)="resetDayToDefault()">
                            Сбросить к стандартному
                          </button>
                          @if (selectedDay()?.isCustom) {
                            <button 
                              mat-button 
                              color="warn"
                              type="button"
                              (click)="deleteCustomDay()">
                              <mat-icon>delete</mat-icon>
                              Удалить особый день
                            </button>
                          }
                        </div>
                      </form>
                    </mat-card-content>
                  </mat-card>
                  }
                  
                  <!-- Массовое редактирование -->
                  @if (isMultiSelectMode() && selectedDays().size > 0) {
                    <mat-card class="bulk-editor">
                    <mat-card-header>
                      <mat-card-title>
                        Массовая настройка ({{ selectedDays().size }} дней)
                      </mat-card-title>
                      <mat-card-subtitle>
                        Применить одинаковые настройки ко всем выделенным дням
                      </mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content>
                      <form [formGroup]="bulkEditForm">
                        <div class="form-row">
                          <mat-slide-toggle formControlName="isWorking" color="primary">
                            Рабочие дни
                          </mat-slide-toggle>
                        </div>

                        @if (bulkEditForm.get('isWorking')?.value) {
                          <div class="time-slots-section">
                            <h4>Временные слоты для всех выбранных дней</h4>
                            <div formArrayName="timeSlots">
                              @for (slot of bulkTimeSlotsControls.controls; track $index; let i = $index) {
                                <div 
                                  [formGroupName]="i"
                                  class="time-slot-row">
                              <mat-form-field appearance="outline">
                                <mat-label>Начало</mat-label>
                                <input matInput type="time" formControlName="start" min="06:00" max="23:59">
                              </mat-form-field>
                              <mat-form-field appearance="outline">
                                <mat-label>Конец</mat-label>
                                <input matInput type="time" formControlName="end" min="06:00" max="23:59">
                              </mat-form-field>
                              <button 
                                mat-icon-button 
                                color="warn" 
                                type="button"
                                (click)="removeBulkTimeSlot(i)"
                                [disabled]="bulkTimeSlotsControls.controls.length <= 1"
                                matTooltip="Удалить временной слот">
                                  <mat-icon>delete</mat-icon>
                                </button>
                              </div>
                              }
                            </div>
                            
                            <button 
                              mat-button 
                              color="primary" 
                              type="button"
                              (click)="addBulkTimeSlot()"
                              matTooltip="Добавить ещё один рабочий период">
                              <mat-icon>add</mat-icon>
                              Добавить слот
                            </button>
                          </div>
                        }

                        <div class="form-actions">
                          <button 
                            mat-raised-button 
                            color="primary" 
                            type="button"
                            (click)="applyBulkSettings()"
                            [disabled]="!bulkEditForm.valid || isSaving()">
                            <mat-icon>save</mat-icon>
                            Применить ко всем ({{ selectedDays().size }})
                          </button>
                          <button 
                            mat-button 
                            type="button"
                            (click)="clearSelection()">
                            Отменить выделение
                          </button>
                        </div>
                      </form>
                    </mat-card-content>
                  </mat-card>
                  }
                </mat-card-content>
              </mat-card>
            </div>
          </mat-tab>

          <!-- Отпуска и отгулы -->
          <mat-tab label="Отпуска">
            <div class="tab-content">
              <mat-card>
                <mat-card-header>
                  <mat-card-title>Периоды отсутствия</mat-card-title>
                  <mat-card-subtitle>Укажите дни, когда вы недоступны для записи</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                  <p>Функция в разработке. Скоро здесь будет управление отпусками.</p>
                </mat-card-content>
              </mat-card>
            </div>
          </mat-tab>

          <!-- Статистика и обзор -->          <mat-tab label="Выездные фотосессии">
            <div class="tab-content">
              <mat-card>
                <mat-card-header>
                  <mat-card-title>График выездных фотосессий</mat-card-title>
                  <mat-card-subtitle>Настройте доступность для съемок вне студии</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>                  <!-- Календарь выбора месяца (идентично индивидуальным дням) -->
                  <div class="month-selector">
                    <mat-form-field appearance="outline">
                      <mat-label>Выберите месяц</mat-label>
                      <input matInput [matDatepicker]="eventMonthPicker" 
                             [value]="currentEventMonth()" 
                             (dateChange)="onEventMonthChange($event)"
                             readonly>
                      <mat-datepicker-toggle matSuffix [for]="eventMonthPicker" />
                      <mat-datepicker #eventMonthPicker startView="year" (monthSelected)="onEventMonthSelected($event)" />
                    </mat-form-field>
                      <!-- Кнопки управления выделением (идентично индивидуальным дням) -->
                    <div class="selection-controls">
                      <mat-slide-toggle 
                        [checked]="isEventMultiSelectMode()" 
                        (change)="toggleEventMultiSelectMode()"
                        color="primary">
                        Множественное выделение
                      </mat-slide-toggle>
                      @if (selectedEventDays().size > 0) {
                        <button 
                          mat-button 
                          (click)="clearEventSelection()">
                          Снять выделение ({{ selectedEventDays().size }})
                        </button>
                      }
                      
                      <!-- Кнопка автозаполнения -->
                      <button 
                        mat-raised-button 
                        color="accent"
                        (click)="openAutoFillDialog()"
                        matTooltip="Автоматически заполнить доступные дни выездов">
                        <mat-icon>auto_fix_high</mat-icon>
                        Автозаполнение
                      </button>
                    </div>
                  </div><!-- Календарь выездного расписания (как в индивидуальных днях) -->
                  <div class="calendar-grid">
                    <div class="calendar-header">
                      <div class="day-name">Пн</div>
                      <div class="day-name">Вт</div>
                      <div class="day-name">Ср</div>
                      <div class="day-name">Чт</div>
                      <div class="day-name">Пт</div>
                      <div class="day-name">Сб</div>
                      <div class="day-name">Вс</div>
                    </div>
                    <div class="calendar-body">
                      @for (day of eventCalendarDays(); track trackByDate($index, day)) {
                        <div 
                          class="calendar-day"
                          [class.other-month]="!day.isCurrentMonth"
                          [class.working-day]="day.isEventWorkingDay && !day.isCustom"
                          [class.custom-day]="day.isCustom"
                          [class.has-bookings]="day.hasEventBookings"
                          [class.has-conflict]="day.hasStudioConflict"
                          [class.selected-day]="selectedEventDay()?.date === day.date"
                          [class.multi-selected]="selectedEventDays().has(day.date)"
                          (click)="handleEventDayClick(day)"
                          (keydown.enter)="handleEventDayClick(day)"
                          tabindex="0">
                          
                          <div class="day-number">{{ day.dayNumber }}</div>
                          @if (day.eventWorkingHours) {
                            <div class="day-info">
                              <small>{{ day.eventWorkingHours }}</small>
                            </div>
                          }
                          @if (day.hasEventBookings) {
                            <div class="booking-indicator">
                              <mat-icon class="booking-icon">event</mat-icon>
                            </div>
                          }
                          @if (day.isCustom) {
                            <div class="custom-indicator">
                              <mat-icon class="custom-icon">camera_outdoor</mat-icon>
                            </div>
                          }
                          @if (day.hasStudioConflict) {
                            <div class="conflict-indicator">
                              <mat-icon class="conflict-icon">warning</mat-icon>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                  <!-- Настройка выбранного дня (идентично индивидуальным дням) -->
                  @if (selectedEventDay() && !isEventMultiSelectMode()) {
                    <mat-card class="event-day-editor">
                    <mat-card-header>
                      <mat-card-title>
                        Настройка дня: {{ formatEventDate(selectedEventDay()!.date) }}
                      </mat-card-title>
                      <mat-card-subtitle>
                        Выездные фотосессии
                      </mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content>
                      <form [formGroup]="eventDayForm">
                        <div class="form-row">
                          <mat-slide-toggle formControlName="isEventWorking" color="primary">
                            Доступен для выездных фотосессий
                          </mat-slide-toggle>
                        </div>
                        <!-- Предупреждение о конфликтах -->
                        @if (selectedEventDay()?.hasStudioConflict) {
                          <div class="conflict-warning">
                            <mat-icon color="warn">warning</mat-icon>
                            <span>В этот день есть студийные смены. Выездное время должно быть ДО или ПОСЛЕ студийной работы.</span>
                          </div>
                        }

                        <!-- Информация о студийном времени -->
                        @if (eventDayForm.get('isEventWorking')?.value && getStudioTimeForDay(selectedEventDay()!.date)) {
                          <div class="studio-time-info">
                            <mat-card class="info-card">
                              <mat-card-content>
                                <h5><mat-icon>business</mat-icon> Время работы в студии:</h5>
                                <p><strong>{{ getStudioTimeForDay(selectedEventDay()!.date) }}</strong></p>
                                <small>Выездное время должно НЕ пересекаться со студийным расписанием</small>
                              </mat-card-content>
                            </mat-card>
                          </div>
                        }

                        @if (eventDayForm.get('isEventWorking')?.value) {
                          <div class="time-slots-section">
                            <h4>
                              Временные слоты 
                              <mat-icon matTooltip="Вы можете создать несколько периодов доступности в день">info</mat-icon>
                            </h4>
                            <div formArrayName="eventTimeSlots">
                              @for (slot of eventTimeSlotsControls.controls; track $index; let i = $index) {
                                <div 
                                  [formGroupName]="i"
                                  class="time-slot-row">
                              <mat-form-field appearance="outline">
                                <mat-label>Начало</mat-label>
                                <input matInput type="time" formControlName="start" min="06:00" max="23:59">
                              </mat-form-field>
                              <mat-form-field appearance="outline">
                                <mat-label>Конец</mat-label>
                                <input matInput type="time" formControlName="end" min="06:00" max="23:59">
                              </mat-form-field>
                              <mat-form-field appearance="outline">
                                <mat-label>Локация (опционально)</mat-label>
                                <input matInput 
                                       formControlName="location" 
                                       placeholder="Например: Центр города, Парк, Студия на выезде"
                                       matTooltip="Укажите локацию для расчета буферного времени">
                              </mat-form-field>
                              <button 
                                mat-icon-button 
                                color="warn" 
                                type="button"
                                (click)="removeEventTimeSlot(i)"
                                [disabled]="eventTimeSlotsControls.controls.length <= 1"
                                matTooltip="Удалить временной слот">
                                  <mat-icon>delete</mat-icon>
                                </button>
                              </div>
                              }
                            </div>
                            
                            <button 
                              mat-button 
                              color="primary" 
                              type="button"
                              (click)="addEventTimeSlot()"
                              matTooltip="Добавить ещё один период доступности">
                              <mat-icon>add</mat-icon>
                              Добавить слот
                            </button>
                          </div>
                        }

                        <!-- Примечания -->
                        @if (eventDayForm.get('isEventWorking')?.value) {
                          <div>
                          <mat-form-field appearance="outline">
                            <mat-label>Примечания</mat-label>
                            <textarea 
                              matInput 
                              formControlName="notes" 
                              placeholder="Особые условия, ограничения по выезду и т.д."
                              rows="3">
                            </textarea>
                          </mat-form-field>
                          </div>
                        }

                        <div class="form-actions">
                          <button 
                            mat-raised-button 
                            color="primary" 
                            type="button"
                            (click)="saveEventDay()"
                            [disabled]="!eventDayForm.valid || isSaving()">
                            <mat-icon>save</mat-icon>
                            Сохранить день
                          </button>
                          <button 
                            mat-button 
                            type="button"
                            (click)="resetEventDayForm()">
                            Сбросить к стандартному
                          </button>
                          @if (selectedEventDay()?.isEventWorkingDay) {
                            <button 
                              mat-button 
                              color="warn"
                              type="button"
                              (click)="clearEventDay()">
                              <mat-icon>delete</mat-icon>
                              Убрать доступность
                            </button>
                          }
                        </div>
                      </form>
                    </mat-card-content>
                  </mat-card>
                  }
                  
                  <!-- Массовое редактирование (идентично индивидуальным дням) -->
                  @if (isEventMultiSelectMode() && selectedEventDays().size > 0) {
                    <mat-card class="event-bulk-editor">
                    <mat-card-header>
                      <mat-card-title>
                        Массовая настройка ({{ selectedEventDays().size }} дней)
                      </mat-card-title>
                      <mat-card-subtitle>
                        Применить одинаковые настройки ко всем выделенным дням
                      </mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content>
                      <form [formGroup]="eventBulkEditForm">
                        <div class="form-row">
                          <mat-slide-toggle formControlName="isEventWorking" color="primary">
                            Доступен для выездных фотосессий
                          </mat-slide-toggle>
                        </div>

                        @if (eventBulkEditForm.get('isEventWorking')?.value) {
                          <div class="time-slots-section">
                            <h4>Временные слоты для всех выбранных дней</h4>
                            <div formArrayName="eventTimeSlots">
                              @for (slot of eventBulkTimeSlotsControls.controls; track $index; let i = $index) {
                                <div 
                                  [formGroupName]="i"
                                  class="time-slot-row">
                              <mat-form-field appearance="outline">
                                <mat-label>Начало</mat-label>
                                <input matInput type="time" formControlName="start" min="06:00" max="23:59">
                              </mat-form-field>
                              <mat-form-field appearance="outline">
                                <mat-label>Конец</mat-label>
                                <input matInput type="time" formControlName="end" min="06:00" max="23:59">
                              </mat-form-field>
                              <mat-form-field appearance="outline">
                                <mat-label>Локация (опционально)</mat-label>
                                <input matInput 
                                       formControlName="location" 
                                       placeholder="Например: Центр города, Парк, Студия на выезде"
                                       matTooltip="Укажите локацию для расчета буферного времени">
                              </mat-form-field>
                              <button 
                                mat-icon-button 
                                color="warn" 
                                type="button"
                                (click)="removeEventBulkTimeSlot(i)"
                                [disabled]="eventBulkTimeSlotsControls.controls.length <= 1"
                                matTooltip="Удалить временной слот">
                                  <mat-icon>delete</mat-icon>
                                </button>
                              </div>
                              }
                            </div>
                            
                            <button 
                              mat-button 
                              color="primary" 
                              type="button"
                              (click)="addEventBulkTimeSlot()"
                              matTooltip="Добавить ещё один период доступности">
                              <mat-icon>add</mat-icon>
                              Добавить слот
                            </button>
                          </div>
                        }

                        <div class="form-actions">
                          <button 
                            mat-raised-button 
                            color="primary" 
                            type="button"
                            (click)="applyEventBulkSettings()"
                            [disabled]="!eventBulkEditForm.valid || isSaving()">
                            <mat-icon>save</mat-icon>
                            Применить ко всем ({{ selectedEventDays().size }})
                          </button>
                          <button 
                            mat-button 
                            type="button"
                            (click)="clearEventSelection()">
                            Отменить выделение
                          </button>
                        </div>
                      </form>
                    </mat-card-content>
                  </mat-card>
                  }
                  
                  <!-- Краткая справка -->
                  <mat-card class="help-card">
                    <mat-card-content>                      <h4><mat-icon>info</mat-icon> Как это работает:</h4>                      <ul>
                        <li><strong>⚠️ ВАЖНО: Выездное время НЕ должно пересекаться со студийным!</strong></li>
                        <li><strong>📅 Доступные периоды (не слоты!):</strong> Система создаёт широкие временные окна, в которые клиент может записаться</li>
                        <li>Клиент сам выбирает нужную ему длительность при записи (30 мин, 60 мин, 90 мин, 2 часа и т.д.)</li>
                        <li><strong>🕐 Буферное время добавляется ПОСЛЕ записи:</strong> Когда клиент записывается на 14:00-15:30, следующий может записаться только с 16:00 (15:30 + 30 мин буфер)</li>
                        <li>Настройте буферное время в "Общих настройках" (по умолчанию 30 мин + 60 мин при смене локации)</li>
                        <li><strong>🚀 Интеллектуальное автозаполнение:</strong> Находит свободное время между студийными сменами</li>
                        <li><strong>Пример работы:</strong> Если студия 9:00-14:00, система создаст доступные периоды: 7:00-9:00, 14:30-22:00</li>
                        <li>Клиент может записаться на любое время внутри доступного периода на нужную ему длительность</li>
                        <li>Используйте множественное выделение для настройки сразу нескольких дней</li>
                      </ul>
                    </mat-card-content>
                  </mat-card>
                </mat-card-content>
              </mat-card>
            </div>
          </mat-tab>

          <mat-tab label="Статистика">
            <div class="tab-content">
              <mat-card>
                <mat-card-header>
                  <mat-card-title>Загруженность и статистика</mat-card-title>
                  <mat-card-subtitle>Аналитика вашей работы</mat-card-subtitle>
                </mat-card-header>
                <mat-card-content>
                  <p>Функция в разработке. Скоро здесь будет статистика работы.</p>
                </mat-card-content>
              </mat-card>
            </div>
          </mat-tab>
        </mat-tab-group>
        </div>
      }
    </div>
  `,
  styleUrl: './photographer-schedule-editor-v2.component.scss'
})
export class PhotographerScheduleEditorV2Component implements OnInit {  private readonly authService = inject(AuthService);
  private readonly photographerApiService = inject(PhotographerApiService);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  // Сигналы состояния
  readonly isLoading = signal(false);
  readonly isSaving = signal(false);
  readonly selectedTabIndex = signal(0);
  readonly photographerData = signal<Photographer | null>(null);
  readonly isDataLoaded = signal(false);  // Новый сигнал для отслеживания загрузки данных

  readonly availability = signal<PhotographerAvailability>({
    workingHours: {
      monday: { isAvailable: false, start: '09:00', end: '19:30' },
      tuesday: { isAvailable: false, start: '09:00', end: '19:30' },
      wednesday: { isAvailable: false, start: '09:00', end: '19:30' },
      thursday: { isAvailable: false, start: '09:00', end: '19:30' },
      friday: { isAvailable: false, start: '09:00', end: '19:30' },
      saturday: { isAvailable: false, start: '09:00', end: '19:30' },
      sunday: { isAvailable: false, start: '09:00', end: '19:30' }
    },
    timeOff: [],
    customDays: {},
    bufferSettings: {
      enabled: true,
      defaultBuffer: 30, // 30 минут стандартный буфер
      locationChangeBuffer: 60 // 60 минут дополнительно при смене локации
    },
    isActive: true
  });
  readonly currentMonth = signal(new Date());
  readonly selectedDay = signal<StudioCalendarDay | null>(null);
  readonly selectedDays = signal<Set<string>>(new Set()); // Множественное выделение
  readonly isMultiSelectMode = signal(false); // Режим множественного выделения
  readonly monthlySchedule = signal<DailySchedule[]>([]);
  readonly customDays = signal<Map<string, CustomScheduleDay>>(new Map());
  
  // Event расписание
  readonly currentEventMonth = signal(new Date());
  readonly selectedEventDay = signal<EventCalendarDay | null>(null);
  readonly selectedEventDays = signal<Set<string>>(new Set());
  readonly isEventMultiSelectMode = signal<boolean>(false);
  readonly eventWorkingDays = signal<Map<string, EventWorkingDay>>(new Map());
  readonly dayHeaders = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  
  // Формы
  generalForm!: FormGroup;
  dayForm!: FormGroup;
  bulkEditForm!: FormGroup; // Форма для массового редактирования индивидуальных дней
  timeOffForm!: FormGroup;
  eventDayForm!: FormGroup; // Форма для event дня
  eventBulkEditForm!: FormGroup; // Форма для массового редактирования event дней

  // Computed сигналы
  readonly calendarDays = computed(() => {
    return this.generateCalendarDays(this.currentMonth(), this.monthlySchedule(), this.customDays());
  });
  readonly eventCalendarDays = computed(() => {
    return this.generateEventCalendarDays(
      this.currentEventMonth(), 
      this.eventWorkingDays(), 
      this.monthlySchedule(),
      this.selectedEventDay(),
      this.selectedEventDays(),
      this.isEventMultiSelectMode()
    );
  });
  ngOnInit() {
    this.initializeForms();
    this.loadInitialData();
    this.initEventSchedule(); // Инициализируем event расписание
  }

  private async waitForDataLoad(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = 10000; // 10 секунд таймаут
      const startTime = Date.now();
      let checkCount = 0;
      
      const checkData = () => {
        checkCount++;
        const isLoaded = this.isDataLoaded();
        const photographer = this.photographerData();
        
        this.log.debug(`🔄 waitForDataLoad check #${checkCount}:`, {
          isDataLoaded: isLoaded,
          hasPhotographerData: !!photographer,
          photographerData: photographer,
          elapsed: Date.now() - startTime
        });
        
        if (isLoaded && photographer) {
          this.log.debug('✅ Data is loaded and photographer data is available');
          resolve();
        } else if (Date.now() - startTime > timeout) {
          this.log.error('❌ Timeout waiting for data to load');
          reject(new Error('Timeout waiting for data to load'));
        } else {
          setTimeout(checkData, 100);
        }
      };
      checkData();
    });
  }  private initializeForms() {
    // Общая форма настроек
    this.generalForm = this.fb.group({
      isActive: [true],
      workingDays: this.fb.array([
        this.createWorkingDayGroup('monday'),
        this.createWorkingDayGroup('tuesday'),
        this.createWorkingDayGroup('wednesday'),
        this.createWorkingDayGroup('thursday'),
        this.createWorkingDayGroup('friday'),
        this.createWorkingDayGroup('saturday'),
        this.createWorkingDayGroup('sunday')
      ]),
      bufferSettings: this.fb.group({
        enabled: [true],
        defaultBuffer: [30, [Validators.required, Validators.min(0), Validators.max(180)]],
        locationChangeBuffer: [60, [Validators.required, Validators.min(0), Validators.max(240)]]
      })
    });// Форма для отдельного дня
    this.dayForm = this.fb.group({
      isWorking: [false],
      timeSlots: this.fb.array([
        this.createTimeSlotGroup()
      ])
    });

    // Форма для массового редактирования
    this.bulkEditForm = this.fb.group({
      isWorking: [false],
      timeSlots: this.fb.array([
        this.createTimeSlotGroup()
      ])
    });    // Форма для отпусков
    this.timeOffForm = this.fb.group({
      startDate: ['', Validators.required],
      endDate: ['', Validators.required],
      reason: ['']
    });    // Форма для event дня
    this.eventDayForm = this.fb.group({
      isEventWorking: [false],
      eventTimeSlots: this.fb.array([
        this.createEventTimeSlotGroup()
      ]),
      notes: ['']
    });

    // Форма для массового редактирования event дней
    this.eventBulkEditForm = this.fb.group({
      isEventWorking: [false],
      eventTimeSlots: this.fb.array([
        this.createEventTimeSlotGroup()
      ])
    });
  }

  private createWorkingDayGroup(dayKey: string) {
    const availability = this.availability();
    const daySettings = availability.workingHours[dayKey] || { isAvailable: false, start: '09:00', end: '19:30' };
    
    return this.fb.group({
      dayKey: [dayKey],
      isAvailable: [daySettings.isAvailable],
      start: [daySettings.start, Validators.required],
      end: [daySettings.end, Validators.required]
    });  }
  
  private createTimeSlotGroup() {
    return this.fb.group({
      start: ['09:00', Validators.required],
      end: ['19:30', Validators.required]
    });
  }
  
  private createEventTimeSlotGroup() {
    return this.fb.group({
      start: ['09:00', Validators.required],
      end: ['19:30', Validators.required],
      location: [''] // Поле локации опционально
    });
  }

  get workingDaysControls() {
    return this.generalForm.get('workingDays') as FormArray;
  }

  get timeSlotsControls() {
    return this.dayForm.get('timeSlots') as FormArray;
  }
  get eventTimeSlotsControls() {
    return this.eventDayForm.get('eventTimeSlots') as FormArray;
  }

  get eventBulkTimeSlotsControls() {
    return this.eventBulkEditForm.get('eventTimeSlots') as FormArray;
  }

  get bulkTimeSlotsControls() {
    return this.bulkEditForm.get('timeSlots') as FormArray;
  }private async loadInitialData() {
    this.isLoading.set(true);
    this.isDataLoaded.set(false);
    
    try {
      this.log.debug('🔄 Starting loadInitialData...');
      
      const user = this.authService.getCurrentUser();
      if (!user?.uid) {
        this.log.error('❌ User not authenticated:', user);
        this.showError('Пользователь не авторизован');
        return;
      }

      this.log.debug('✅ User authenticated:', user.uid);

      // 🔐 Используем новый безопасный API endpoint
      this.log.debug('� Calling secure API: /api/photographers/me');
      const photographerResponse = await firstValueFrom(this.photographerApiService.getCurrentPhotographer());
      this.log.debug('� Photographer response:', photographerResponse);
      
      if (photographerResponse?.success && photographerResponse.data) {
        const photographer = photographerResponse.data;
        this.log.debug('✅ Photographer found via secure API:', photographer);
        
        this.photographerData.set(photographer);        this.availability.set(photographer.availability || this.availability());
        this.updateFormsFromData();
        this.loadCustomDaysFromAvailability();
        this.loadEventWorkingDaysFromAvailability(); // Загружаем event working days
        this.isDataLoaded.set(true);
        
        this.log.debug('✅ Data loaded successfully for photographer:', photographer.id || photographer.name);
        this.log.debug('🚀 isDataLoaded set to true, photographerData:', this.photographerData());
      } else {
        this.log.error('❌ Invalid photographer response:', photographerResponse);
        this.showError('Данные фотографа не найдены');
      }
    } catch (error) {
      this.log.error('❌ Error loading initial data:', error);
      this.showError('Ошибка загрузки данных');
    } finally {
      this.isLoading.set(false);
      this.log.debug('🏁 loadInitialData finished, isDataLoaded:', this.isDataLoaded());
    }
  }
  private updateFormsFromData() {
    const availability = this.availability();
    
    // Обновляем общую форму
    this.generalForm.patchValue({
      isActive: availability.isActive
    });
    
    // Обновляем настройки буфера
    if (availability.bufferSettings) {
      this.generalForm.get('bufferSettings')?.patchValue({
        enabled: availability.bufferSettings.enabled,
        defaultBuffer: availability.bufferSettings.defaultBuffer,
        locationChangeBuffer: availability.bufferSettings.locationChangeBuffer
      });
    }
    
    // Обновляем рабочие дни
    const workingDaysArray = this.workingDaysControls;
    Object.keys(availability.workingHours).forEach((dayKey, index) => {
      const daySettings = availability.workingHours[dayKey];
      if (workingDaysArray.at(index)) {
        workingDaysArray.at(index).patchValue({
          isAvailable: daySettings.isAvailable,
          start: daySettings.start,
          end: daySettings.end
        });
      }
    });
  }
  private loadCustomDaysFromAvailability() {
    const availability = this.availability();
    this.log.debug('🔄 Loading customDays from availability:', availability.customDays);
    
    if (availability.customDays) {
      const customDaysMap = new Map<string, CustomScheduleDay>();
      Object.entries(availability.customDays).forEach(([date, dayData]: [string, { isWorking: boolean; timeSlots?: { start: string; end: string }[] }]) => {
        customDaysMap.set(date, {
          date,
          isWorking: dayData.isWorking,
          timeSlots: dayData.timeSlots || []
        });
      });
      this.customDays.set(customDaysMap);
      this.log.debug('✅ CustomDays loaded:', customDaysMap.size, 'days');
    } else {
      this.log.debug('⚠️ No customDays found in availability');
    }
  }
  async saveGeneralSettings() {
    if (!this.generalForm.valid) return;
    
    this.isSaving.set(true);
    
    try {
      // Ждем загрузки данных перед сохранением
      if (!this.isDataLoaded()) {
        this.log.debug('🔄 Waiting for data to load before saving general settings...');
        await this.waitForDataLoad();
      }

      // Получаем токен из localStorage
      let token: string | null = null;
      if (isPlatformBrowser(this.platformId)) {
        token = localStorage.getItem('auth_token');
      }
      
      if (!token) {
        this.showError('Токен аутентификации не найден');
        return;
      }

      const formValue = this.generalForm.value;
      const photographer = this.photographerData();
      
      if (!photographer) {
        this.showError('Данные фотографа не найдены');
        return;
      }
        const updatedAvailability = {
        ...this.availability(),
        isActive: formValue.isActive,
        workingHours: {} as PhotographerAvailability['workingHours'],
        bufferSettings: formValue.bufferSettings
      };

      // Формируем рабочие часы из формы
      formValue.workingDays.forEach((day: { dayKey: string; isAvailable: boolean; start: string; end: string }) => {
        updatedAvailability.workingHours[day.dayKey] = {
          isAvailable: day.isAvailable,
          start: day.start,
          end: day.end
        };
      });      // Отправляем обновление через существующий API endpoint
      const response = await fetch(`/api/photographers/me/schedule`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          availability: updatedAvailability
        })
      });

      if (!response.ok) {
        throw new Error(`API call failed: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || 'API call failed');
      }
      
      this.availability.set(updatedAvailability);
      this.showSuccess('Настройки сохранены');
      
    } catch (error) {
      this.log.error('Error saving general settings:', error);
      this.showError('Ошибка сохранения настроек');
    } finally {
      this.isSaving.set(false);
    }
  }  private async makeApiCall(url: string, options: RequestInit = {}) {
    // Получаем токен из localStorage напрямую
    let token: string | null = null;
    if (isPlatformBrowser(this.platformId)) {
      token = localStorage.getItem('auth_token');
    }
    
    this.log.debug('🔑 Making API call:', { url, hasToken: !!token, options });
    
    if (!token) {
      this.log.error('❌ No authentication token found');
      throw new Error('No authentication token');
    }

    const response = await fetch(url, {
      headers:
       {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    this.log.debug('📡 API Response:', { 
      status: response.status, 
      statusText: response.statusText, 
      ok: response.ok 
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.log.error('❌ API call failed:', { 
        status: response.status, 
        statusText: response.statusText, 
        errorText 
      });
      throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    this.log.debug('📦 API Response data:', data);
    
    if (!data.success) {
      this.log.error('❌ API returned error:', data.message);
      throw new Error(data.message || 'API call failed');
    }

    return data.data;
  }
  onTabChange(event: { index: number }) {
    this.selectedTabIndex.set(event.index);

    // Инициализируем event расписание при переходе на соответствующую вкладку
    if (event.index === 3) { // Вкладка "Выездные фотосессии"
      this.initEventSchedule();
    }
  }

  resetGeneralForm() {
    this.updateFormsFromData();
  }

  async refreshSchedule() {
    await this.loadInitialData();
    this.showSuccess('Расписание обновлено');
  }

  getDayName(index: number): string {
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
    return days[index];
  }

  private showSuccess(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }

  private showError(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 5000,
      panelClass: ['error-snackbar']
    });
  }

  // Методы для работы с календарем и временными слотами
    private generateCalendarDays(month: Date, schedule: DailySchedule[], customDays: Map<string, CustomScheduleDay>): StudioCalendarDay[] {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    
    const firstDay = new Date(year, monthIndex, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - (firstDay.getDay() + 6) % 7);
    
    const days = [];
    const currentDate = new Date(startDate);
    
    for (let i = 0; i < 42; i++) {
      // Используем локальную дату без UTC смещения
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const scheduleDay = schedule.find(s => s.date === dateStr);
      const customDay = customDays.get(dateStr);
      
      // Определяем рабочие часы для дня
      let workingHours = '';
      let isWorking = false;
      let isCustom = false;
      
      if (customDay) {
        isCustom = true;
        isWorking = customDay.isWorking;
        if (customDay.isWorking && customDay.timeSlots.length > 0) {
          workingHours = customDay.timeSlots.map(slot => `${slot.start}-${slot.end}`).join(', ');
        }
      } else {
        // Используем стандартное расписание
        const dayOfWeek = currentDate.getDay();
        const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayKey = dayKeys[dayOfWeek];
        const availability = this.availability();
        const daySettings = availability.workingHours[dayKey];
        
        if (daySettings && daySettings.isAvailable) {
          isWorking = true;
          workingHours = `${daySettings.start}-${daySettings.end}`;
        }
      }
      
      days.push({
        date: dateStr,
        dayNumber: currentDate.getDate(),
        isCurrentMonth: currentDate.getMonth() === monthIndex,
        isWorking: isWorking,
        isCustom: isCustom,
        hasBookings: scheduleDay?.shifts.some(s => s.currentBookings > 0) || false,
        workingHours: workingHours,
        timeSlots: customDay?.timeSlots || []
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  }
  async onMonthChange(event: { value: Date }) {
    this.currentMonth.set(event.value);

    if (!this.isDataLoaded()) {
      await this.waitForDataLoad();
    }
    
    const photographer = this.photographerData();
    if (photographer) {
      this.loadMonthlySchedule(photographer.id);
    }
  }

  async onMonthSelected(date: Date) {
    this.currentMonth.set(date);
    
    if (!this.isDataLoaded()) {
      await this.waitForDataLoad();
    }
    
    const photographer = this.photographerData();
    if (photographer) {
      this.loadMonthlySchedule(photographer.id);
    }
  }
  async selectDay(day: StudioCalendarDay) {
    // Автосохранение предыдущего дня, если были изменения
    if (this.selectedDay() && this.dayForm.dirty) {
      await this.saveDaySettings(false); // false = без показа уведомления
    }
    
    this.selectedDay.set(day);
    
    // Настраиваем форму дня на основе выбранного дня
    this.dayForm.patchValue({
      isWorking: day.isWorking
    });
    
    // Очищаем и заполняем временные слоты
    const timeSlotsArray = this.timeSlotsControls;
    while (timeSlotsArray.length) {
      timeSlotsArray.removeAt(0);
    }
    
    if (day.timeSlots && day.timeSlots.length > 0) {
      day.timeSlots.forEach((slot: TimeSlot) => {
        timeSlotsArray.push(this.fb.group({
          start: [slot.start, Validators.required],
          end: [slot.end, Validators.required]
        }));
      });
    } else {
      timeSlotsArray.push(this.createTimeSlotGroup());
    }
    
    // Помечаем форму как нетронутую после инициализации
    this.dayForm.markAsPristine();
  }

  addTimeSlot() {
    this.timeSlotsControls.push(this.createTimeSlotGroup());
  }

  removeTimeSlot(index: number) {
    if (this.timeSlotsControls.length > 1) {
      this.timeSlotsControls.removeAt(index);
    }
  }  async saveDaySettings(showNotification = true) {
    if (!this.dayForm.valid || !this.selectedDay()) return;
    
    this.isSaving.set(true);
    
    try {
      const dayValue = this.dayForm.value;
      const selectedDay = this.selectedDay()!;
      
      const customDay: CustomScheduleDay = {
        date: selectedDay.date,
        isWorking: dayValue.isWorking,
        timeSlots: dayValue.isWorking ? dayValue.timeSlots : []
      };
      
      // Обновляем локальное состояние
      const customDays = this.customDays();
      customDays.set(selectedDay.date, customDay);
      this.customDays.set(new Map(customDays));
      
      // Синхронизируем с availability и сохраняем в БД
      await this.saveCustomDaysToDatabase();
      
      if (showNotification) {
        this.showSuccess('Настройки дня сохранены');
      }
      
      // Помечаем форму как сохраненную
      this.dayForm.markAsPristine();
      
    } catch (error) {
      this.log.error('Error saving day settings:', error);
      if (showNotification) {
        this.showError('Ошибка сохранения настроек дня');
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  resetDayToDefault() {
    const selectedDay = this.selectedDay();
    if (!selectedDay) return;
    
    const dayOfWeek = new Date(selectedDay.date).getDay();
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayKey = dayKeys[dayOfWeek];
    
    const availability = this.availability();
    const defaultSettings = availability.workingHours[dayKey];
    
    this.dayForm.patchValue({
      isWorking: defaultSettings.isAvailable
    });
    
    const timeSlotsArray = this.timeSlotsControls;
    while (timeSlotsArray.length) {
      timeSlotsArray.removeAt(0);
    }
    
    if (defaultSettings.isAvailable) {
      timeSlotsArray.push(this.fb.group({
        start: [defaultSettings.start, Validators.required],
        end: [defaultSettings.end, Validators.required]
      }));
    } else {
      timeSlotsArray.push(this.createTimeSlotGroup());
    }
  }
  async deleteCustomDay() {
    const selectedDay = this.selectedDay();
    if (!selectedDay || !selectedDay.isCustom) return;
    
    const customDays = this.customDays();
    customDays.delete(selectedDay.date);
    this.customDays.set(new Map(customDays));
    
    // Сохраняем изменения в БД
    try {
      await this.saveCustomDaysToDatabase();
      this.selectedDay.set(null);
      this.showSuccess('Особый день удален');
    } catch (error) {
      this.log.error('Error deleting custom day:', error);
      this.showError('Ошибка удаления особого дня');
    }
  }
  private async loadMonthlySchedule(photographerId: string) {
    try {
      // TODO: Временно отключаем загрузку расписания до исправления API
      this.log.debug('📝 loadMonthlySchedule temporarily disabled for photographerId:', photographerId);
      this.monthlySchedule.set([]);
      
      // Оригинальный код (временно закомментирован):
      // const month = this.formatMonth(this.currentMonth());
      // const scheduleData = await this.makeApiCall(`/api/photographers/${photographerId}/schedule?month=${month}`);
      // if (scheduleData && scheduleData.schedule) {
      //   this.monthlySchedule.set(scheduleData.schedule);
      // }
    } catch (error) {
      this.log.error('Error loading monthly schedule:', error);
    }
  }

  getDayOfWeekName(dateStr: string): string {
    const date = new Date(dateStr);
    const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
    return days[date.getDay()];
  }

  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('ru-RU');
  }  formatMonth(date: Date): string {
    return date.toISOString().substring(0, 7); // YYYY-MM format
  }

  // Новые методы для множественного выделения
  
  toggleMultiSelectMode() {
    this.isMultiSelectMode.set(!this.isMultiSelectMode());
    if (!this.isMultiSelectMode()) {
      this.clearSelection();
    }
  }

  clearSelection() {
    this.selectedDays.set(new Set());
  }

  handleDayClick(day: StudioCalendarDay) {
    if (this.isMultiSelectMode()) {
      this.toggleDaySelection(day);
    } else {
      this.selectDay(day);
    }
  }

  toggleDaySelection(day: StudioCalendarDay) {
    const selectedDays = new Set(this.selectedDays());
    if (selectedDays.has(day.date)) {
      selectedDays.delete(day.date);
    } else {
      selectedDays.add(day.date);
    }
    this.selectedDays.set(selectedDays);
  }

  addBulkTimeSlot() {
    this.bulkTimeSlotsControls.push(this.createTimeSlotGroup());
  }

  removeBulkTimeSlot(index: number) {
    if (this.bulkTimeSlotsControls.length > 1) {
      this.bulkTimeSlotsControls.removeAt(index);
    }
  }
  async applyBulkSettings() {
    if (!this.bulkEditForm.valid || this.selectedDays().size === 0) return;
    
    this.isSaving.set(true);
    
    try {
      const bulkValue = this.bulkEditForm.value;
      const customDays = this.customDays();
      
      // Применяем настройки ко всем выбранным дням
      this.selectedDays().forEach(dateStr => {
        const customDay: CustomScheduleDay = {
          date: dateStr,
          isWorking: bulkValue.isWorking,
          timeSlots: bulkValue.isWorking ? bulkValue.timeSlots : []
        };
        customDays.set(dateStr, customDay);
      });
      
      this.customDays.set(new Map(customDays));
      
      // Сохраняем в БД
      await this.saveCustomDaysToDatabase();
      
      this.showSuccess(`Настройки применены к ${this.selectedDays().size} дням`);
      this.clearSelection();
      
    } catch (error) {
      this.log.error('Error applying bulk settings:', error);
      this.showError('Ошибка применения массовых настроек');
    } finally {
      this.isSaving.set(false);
    }
  }  private async saveCustomDaysToDatabase() {
    try {
      this.log.debug('🔄 saveCustomDaysToDatabase called');
      this.log.debug('🔄 Current state: isDataLoaded:', this.isDataLoaded(), ', photographerData:', this.photographerData());
      
      // Ждем загрузки данных перед сохранением
      if (!this.isDataLoaded()) {
        this.log.debug('🔄 Waiting for data to load before saving...');
        try {
          await this.waitForDataLoad();
          this.log.debug('✅ Data load completed, proceeding...');
        } catch (timeoutError) {
          this.log.error('❌ Timeout waiting for data to load:', timeoutError);
          this.showError('Таймаут ожидания загрузки данных. Попробуйте перезагрузить страницу.');
          return;
        }
      }

      const photographer = this.photographerData();
      this.log.debug('🔍 Checking photographer data after wait:', photographer);
      
      if (!photographer) {
        this.log.error('❌ No photographer data available after waiting');
        this.log.error('❌ Debug info:', {
          isDataLoaded: this.isDataLoaded(),
          photographerDataValue: this.photographerData(),
          authService: this.authService.getCurrentUser()
        });
        this.showError('Данные фотографа не найдены. Попробуйте перезагрузить страницу.');
        return;
      }
      
      this.log.debug('✅ Photographer data available, proceeding with save:', photographer.id || photographer.name);
      
      // Подготавливаем обновленную availability
      const currentAvailability = this.availability();
      const customDaysMap = this.customDays();
      
      this.log.debug('🔄 Starting customDays save process:', {
        photographerId: photographer.id,
        photographerName: photographer.name,
        currentAvailability,
        customDaysMapSize: customDaysMap.size,
        customDaysMapEntries: Array.from(customDaysMap.entries())
      });
      
      // Конвертируем Map в объект для JSON
      const customDaysObject: Record<string, { isWorking: boolean; timeSlots: TimeSlot[] }> = {};
      customDaysMap.forEach((dayData, date) => {
        customDaysObject[date] = {
          isWorking: dayData.isWorking,
          timeSlots: dayData.timeSlots
        };
      });
      
      const updatedAvailability = {
        ...currentAvailability,
        customDays: customDaysObject
      };
        this.log.debug('🔄 Saving customDays to database:', {
        photographerId: photographer.id,
        customDaysCount: customDaysMap.size,
        customDaysObject,
        updatedAvailability
      });
        // Отправляем в БД через правильный API endpoint
      const response = await this.makeApiCall(`/api/photographers/me/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ availability: updatedAvailability })
      });
      
      this.log.debug('✅ CustomDays saved successfully:', response);
      
      // Обновляем локальное состояние
      this.availability.set(updatedAvailability);
      
    } catch (error) {      this.log.error('❌ Error saving customDays:', error);
      // Показываем ошибку пользователю
      if (error instanceof Error) {
        this.snackBar.open(`Ошибка сохранения: ${error.message}`, 'Закрыть', { duration: 5000 });
      }
    }
  }
  // ============================================================
  // МЕТОДЫ ДЛЯ EVENT РАСПИСАНИЯ (КАЛЕНДАРЬ ДОСТУПНОСТИ)
  // ============================================================
  /**
   * Генерация календарных дней для event расписания
   */
  private generateEventCalendarDays(
    month: Date, 
    eventWorkingDays: Map<string, EventWorkingDay>, 
    studioSchedule: DailySchedule[],
    selectedDay: EventCalendarDay | null = null,
    selectedDays = new Set<string>(),
    isMultiSelectMode = false
  ): EventCalendarDay[] {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    
    const firstDay = new Date(year, monthIndex, 1);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - (firstDay.getDay() + 6) % 7);
    
    const days: EventCalendarDay[] = [];
    const currentDate = new Date(startDate);
    const today = new Date();
    
    for (let i = 0; i < 42; i++) {
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const eventWorkingDay = eventWorkingDays.get(dateStr);
      const studioDay = studioSchedule.find(s => s.date === dateStr);
      
      // Проверяем конфликты со студийным расписанием
      const hasStudioConflict = this.checkStudioEventConflict(eventWorkingDay, studioDay);
      
      // Формируем строку с рабочими часами для event
      let eventWorkingHours = '';
      if (eventWorkingDay?.isEventWorking && eventWorkingDay.eventTimeSlots.length > 0) {
        eventWorkingHours = eventWorkingDay.eventTimeSlots
          .map(slot => `${slot.start}-${slot.end}`)
          .join(', ');
      }
      
      days.push({
        date: dateStr,
        dayNumber: currentDate.getDate(),
        isCurrentMonth: currentDate.getMonth() === monthIndex,
        isToday: this.isSameDay(currentDate, today),
        isEventWorkingDay: eventWorkingDay?.isEventWorking || false,
        hasStudioConflict: hasStudioConflict,
        hasEventBookings: false, // TODO: проверить наличие бронирований
        isSelected: isMultiSelectMode 
          ? selectedDays.has(dateStr) 
          : selectedDay?.date === dateStr,
        eventWorkingHours: eventWorkingHours,        eventTimeSlots: eventWorkingDay?.eventTimeSlots || [],
        notes: eventWorkingDay?.notes,
        isCustom: (eventWorkingDay?.eventTimeSlots?.length || 0) > 0
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  }

  /**
   * Проверка на конфликт между event и студийным расписанием
   */
  private checkStudioEventConflict(eventDay: EventWorkingDay | undefined, studioDay: DailySchedule | undefined): boolean {
    if (!eventDay?.isEventWorking || !studioDay?.isWorkingDay) {
      return false;
    }
    
    // Простая проверка - если есть и то, и другое в один день
    return true; // TODO: более точная проверка по времени
  }

  /**
   * Проверка, является ли день сегодняшним
   */
  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }
  /**
   * Загрузка event working days из availability
   */
  private loadEventWorkingDaysFromAvailability() {
    const availability = this.availability();
    const eventWorkingDaysMap = new Map<string, EventWorkingDay>();
    
    this.log.debug('Loading event working days from availability:', availability.eventWorkingDays);
    
    if (availability.eventWorkingDays) {
      Object.entries(availability.eventWorkingDays).forEach(([date, dayData]: [string, { isEventWorking: boolean; eventTimeSlots: EventTimeSlot[]; notes?: string }]) => {
        eventWorkingDaysMap.set(date, {
          date,
          isEventWorking: dayData.isEventWorking,
          eventTimeSlots: dayData.eventTimeSlots || [],
          notes: dayData.notes
        });
      });
      this.log.debug('✅ EventWorkingDays loaded:', eventWorkingDaysMap.size, 'days');
    } else {
      this.log.debug('⚠️ No eventWorkingDays found in availability');
    }
    
    this.eventWorkingDays.set(eventWorkingDaysMap);
  }
  /**
   * Методы выбора месяца для event расписания (идентично индивидуальным дням)
   */
  async onEventMonthChange(event: { value: Date }) {
    this.currentEventMonth.set(event.value);
    
    if (!this.isDataLoaded()) {
      await this.waitForDataLoad();
    }
    
    await this.loadEventSchedule();
  }

  async onEventMonthSelected(date: Date) {
    this.currentEventMonth.set(date);
    
    if (!this.isDataLoaded()) {
      await this.waitForDataLoad();
    }
    
    await this.loadEventSchedule();
  }
  /**
   * TrackBy функции для оптимизации @for (используется в track выражениях)
   */
  trackByDate(_index: number, item: EventCalendarDay): string {
    return item.date;
  }

  /**
   * Форматирование даты для event расписания
   */
  formatEventDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { 
      weekday: 'long',
      day: 'numeric', 
      month: 'long' 
    });
  }
  /**
   * Загрузка event расписания для текущего месяца
   */
  async loadEventSchedule() {
    if (!this.isDataLoaded()) {
      await this.waitForDataLoad();
    }

    const photographer = this.photographerData();
    if (!photographer) return;

    try {
      // Загружаем event working days из availability
      this.loadEventWorkingDaysFromAvailability();
      
      // Также загружаем студийное расписание для проверки конфликтов
      await this.loadMonthlySchedule(photographer.id);
      
    } catch (error) {
      this.log.error('Error loading event schedule:', error);
      this.showError('Ошибка загрузки выездного расписания');
    }
  }

  /**
   * Изменение состояния работы в event день
   */
  onEventWorkingChange() {
    const isWorking = this.eventDayForm.get('isEventWorking')?.value;
    
    if (!isWorking) {
      // Очищаем временные слоты, если день не рабочий
      const eventTimeSlotsArray = this.eventTimeSlotsControls;
      while (eventTimeSlotsArray.length) {
        eventTimeSlotsArray.removeAt(0);
      }
      eventTimeSlotsArray.push(this.createEventTimeSlotGroup());
    }
  }

  /**
   * Добавление временного слота для event
   */
  addEventTimeSlot() {
    this.eventTimeSlotsControls.push(this.createEventTimeSlotGroup());
  }

  /**
   * Удаление временного слота для event
   */
  removeEventTimeSlot(index: number) {
    if (this.eventTimeSlotsControls.length > 1) {
      this.eventTimeSlotsControls.removeAt(index);
    }
  }

  /**
   * Сброс формы event дня
   */
  resetEventDayForm() {
    const selectedDay = this.selectedEventDay();
    if (!selectedDay) return;

    // Сбрасываем к исходному состоянию
    this.selectEventDay(selectedDay);
  }

  /**
   * Очистка доступности для event дня
   */
  async clearEventDay() {
    const selectedDay = this.selectedEventDay();
    if (!selectedDay) return;

    const eventWorkingDays = this.eventWorkingDays();
    eventWorkingDays.delete(selectedDay.date);
    this.eventWorkingDays.set(new Map(eventWorkingDays));

    try {
      await this.saveEventWorkingDaysToDatabase();
      this.selectedEventDay.set(null);
      this.showSuccess('Доступность для выездного дня убрана');
    } catch (error) {
      this.log.error('Error clearing event day:', error);
      this.showError('Ошибка удаления доступности выездного дня');
    }
  }

  /**
   * Сохранение event working days в базу данных
   */
  private async saveEventWorkingDaysToDatabase() {
    try {
      if (!this.isDataLoaded()) {
        await this.waitForDataLoad();

      }

      const photographer = this.photographerData();
      if (!photographer) {
        this.showError('Данные фотографа не найдены');
        return;
      }

      // Подготавливаем обновленную availability
      const currentAvailability = this.availability();
      const eventWorkingDaysMap = this.eventWorkingDays();

      // Конвертируем Map в объект для JSON
      const eventWorkingDaysObject: Record<string, { isEventWorking: boolean; eventTimeSlots: EventTimeSlot[]; notes?: string }> = {};
      eventWorkingDaysMap.forEach((dayData, date) => {
        eventWorkingDaysObject[date] = {
          isEventWorking: dayData.isEventWorking,
          eventTimeSlots: dayData.eventTimeSlots,
          notes: dayData.notes
        };
      });

      const updatedAvailability = {
        ...currentAvailability,
        eventWorkingDays: eventWorkingDaysObject
      };      // Отправляем в БД через API endpoint
      await this.makeApiCall(`/api/photographers/me/schedule`, {
        method: 'PUT',
        body: JSON.stringify({ availability: updatedAvailability })
      });

      // Обновляем локальное состояние
      this.availability.set(updatedAvailability);

    } catch (error) {
      this.log.error('Error saving event working days:', error);
      throw error;
    }
  }

  /**
   * Инициализация event расписания при загрузке компонента
   */
  async initEventSchedule() {
    if (this.selectedTabIndex() === 3) { // Если открыта вкладка event расписания      await this.loadEventSchedule();

       }
  }

  /**
   * Интеллектуальное автозаполнение выездных дней с учетом буферного времени
   */
  private autoFillEventDaysWithBuffer(startTime: string, endTime: string, sessionDuration: number, defaultLocation: string) {
    const currentMonth = this.currentEventMonth();
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const bufferSettings = this.availability().bufferSettings;
    
    if (!bufferSettings?.enabled) {
      // Если буфер отключен, используем старый метод
      this.autoFillEventDays(startTime, endTime);
      return;
    }

    // Получаем все дни текущего месяца
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const eventWorkingDays = this.eventWorkingDays();
    let filledDays = 0;
    let totalSlots = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const studioTime = this.getStudioTimeForDay(dateStr);
      
      // Генерируем оптимальные слоты для этого дня
      const daySlots = this.generateOptimalEventSlots(
        startTime, 
        endTime, 
        sessionDuration, 
        studioTime, 
        bufferSettings, 
        defaultLocation
      );
      
      if (daySlots.length > 0) {
        const eventWorkingDay: EventWorkingDay = {
          date: dateStr,
          isEventWorking: true,
          eventTimeSlots: daySlots,
          notes: `Автозаполнение: ${daySlots.length} слотов по ${sessionDuration} мин`
        };
        
        eventWorkingDays.set(dateStr, eventWorkingDay);
        filledDays++;
        totalSlots += daySlots.length;
      }
    }

    this.eventWorkingDays.set(new Map(eventWorkingDays));

    // Сохраняем в БД
    this.saveEventWorkingDaysToDatabase()
      .then(() => {
        this.showSuccess(`Интеллектуальное автозаполнение завершено!\n📅 Заполнено дней: ${filledDays}\n⏰ Создано слотов: ${totalSlots}\n🕐 Учтено буферное время: ${bufferSettings.defaultBuffer} мин + ${bufferSettings.locationChangeBuffer} мин при смене локации`);
      })
      .catch(error => {
        this.log.error('Error saving auto-filled days:', error);
        this.showError('Ошибка сохранения автозаполнения');
      });
  }

  /**
   * Автозаполнение только выбранных дней
   */
  private autoFillSelectedEventDays(startTime: string, endTime: string, sessionDuration: number, defaultLocation: string) {
    const bufferSettings = this.availability().bufferSettings;
    
    if (!bufferSettings?.enabled) {
      // Если буфер отключен, используем простое заполнение
      this.autoFillSelectedEventDaysSimple(startTime, endTime, defaultLocation);
      return;
    }

    const selectedDays = this.selectedEventDays();
    if (selectedDays.size === 0) {
      this.showError('Не выбрано ни одного дня для автозаполнения');
      return;
    }

    const eventWorkingDays = this.eventWorkingDays();
    let filledDays = 0;
    let totalSlots = 0;

    selectedDays.forEach(dateStr => {
      const studioTime = this.getStudioTimeForDay(dateStr);
      
      // Генерируем оптимальные слоты для этого дня
      const daySlots = this.generateOptimalEventSlots(
        startTime, 
        endTime, 
        sessionDuration, 
        studioTime, 
        bufferSettings, 
        defaultLocation
      );
      
      if (daySlots.length > 0) {
        const eventWorkingDay: EventWorkingDay = {
          date: dateStr,
          isEventWorking: true,
          eventTimeSlots: daySlots,
          notes: `Автозаполнение: ${daySlots.length} слотов по ${sessionDuration} мин`
        };
        
        eventWorkingDays.set(dateStr, eventWorkingDay);
        filledDays++;
        totalSlots += daySlots.length;
      }
    });

    this.eventWorkingDays.set(new Map(eventWorkingDays));
    this.clearEventSelection(); // Очищаем выделение

    // Сохраняем в БД
    this.saveEventWorkingDaysToDatabase()
      .then(() => {
        this.showSuccess(`Автозаполнение завершено: ${filledDays} выбранных дней с ${totalSlots} доступными периодами`);
      })
      .catch(error => {
        this.log.error('Error saving auto-filled selected days:', error);
        this.showError('Ошибка сохранения автозаполнения выбранных дней');
      });
  }

  /**
   * Генерация оптимальных временных слотов для дня с учетом буфера
   */
  private generateOptimalEventSlots(
    startTime: string, 
    endTime: string, 
    sessionDuration: number, 
    studioTime: string | null, 
    bufferSettings: BufferSettings, 
    defaultLocation: string
  ): EventTimeSlot[] {
    const slots: EventTimeSlot[] = [];
    
    // Конвертируем время в минуты
    const dayStartMinutes = this.timeToMinutes(startTime);
    const dayEndMinutes = this.timeToMinutes(endTime);
    
    // Получаем занятые периоды (студийное время)
    const busyPeriods = this.parseStudioTime(studioTime);
    
    // Находим доступные периоды между занятыми
    const availablePeriods = this.findAvailablePeriods(dayStartMinutes, dayEndMinutes, busyPeriods);
    
    // Для каждого доступного периода создаем слоты
    availablePeriods.forEach(period => {
      const periodSlots = this.createSlotsInPeriod(period, sessionDuration, bufferSettings, defaultLocation);
      slots.push(...periodSlots);
    });
    
    return slots;
  }

  /**
   * Парсинг студийного времени в массив занятых периодов
   */
  private parseStudioTime(studioTime: string | null): { start: number; end: number }[] {
    if (!studioTime) return [];
    
    return studioTime.split(', ').map(timeRange => {
      const [start, end] = timeRange.split('-');
      return {
        start: this.timeToMinutes(start),
        end: this.timeToMinutes(end)
      };
    });
  }

  /**
   * Поиск доступных периодов между занятыми
   */
  private findAvailablePeriods(
    dayStart: number, 
    dayEnd: number, 
    busyPeriods: { start: number; end: number }[]
  ): { start: number; end: number }[] {
    const availablePeriods: { start: number; end: number }[] = [];
    
    // Сортируем занятые периоды по времени начала
    const sortedBusy = busyPeriods.sort((a, b) => a.start - b.start);
    
    let currentStart = dayStart;
    
    for (const busyPeriod of sortedBusy) {
      // Если есть промежуток до начала занятого периода
      if (currentStart < busyPeriod.start) {
        availablePeriods.push({
          start: currentStart,
          end: busyPeriod.start
        });
      }
      currentStart = Math.max(currentStart, busyPeriod.end);
    }
    
    // Добавляем период после последнего занятого времени до конца дня
    if (currentStart < dayEnd) {
      availablePeriods.push({
        start: currentStart,
        end: dayEnd
      });
    }
    
    return availablePeriods;
  }

  /**
   * Создание слотов в доступном периоде с учетом буфера
   */
  private createSlotsInPeriod(
    period: { start: number; end: number }, 
    sessionDuration: number, 
    bufferSettings: BufferSettings, 
    defaultLocation: string
  ): EventTimeSlot[] {
    const slots: EventTimeSlot[] = [];
    const totalBuffer = bufferSettings.defaultBuffer + (defaultLocation ? bufferSettings.locationChangeBuffer : 0);
    
    let currentTime = period.start;
    const periodEnd = period.end;
    
    while (currentTime + sessionDuration <= periodEnd) {
      const slotEnd = currentTime + sessionDuration;
      
      slots.push({
        start: this.minutesToTime(currentTime),
        end: this.minutesToTime(slotEnd),
        location: defaultLocation
      });
      
      // Переходим к следующему слоту с учетом буфера
      currentTime = slotEnd + totalBuffer;
    }
    
    return slots;
  }

  /**
   * Открытие диалога автозаполнения выездных дней
   */  openAutoFillDialog() {
    this.log.debug('🚀 Opening modern auto-fill dialog...');
    
    const selectedDaysCount = this.selectedEventDays().size;
    
    const dialogRef = this.dialog.open(AutoFillDialogComponent, {
      width: '520px',
      maxWidth: '90vw',
      disableClose: false,
      data: {
        selectedDaysCount
      }
    });

    dialogRef.afterClosed().subscribe((result: AutoFillDialogResult | undefined) => {
      if (result) {
        this.log.debug(`🚀 Auto-fill parameters from dialog:`, {
          startTime: result.startTime,
          endTime: result.endTime,
          minDuration: result.minDuration,
          fillMode: result.fillMode,
          selectedDaysCount
        });

        // Запускаем соответствующий метод автозаполнения
        if (result.fillMode === 'selected') {
          this.autoFillSelectedEventPeriodsOnly(result.startTime, result.endTime, result.minDuration);
        } else {
          this.autoFillEventPeriodsOnly(result.startTime, result.endTime, result.minDuration);
        }
      } else {
        this.log.debug('🚀 Auto-fill dialog cancelled by user');
      }
    });
  }

  /**
   * Новый метод: Автозаполнение ТОЛЬКО широких периодов доступности для всего месяца
   */
  private autoFillEventPeriodsOnly(startTime: string, endTime: string, minPeriodDuration: number) {
    this.log.debug('🚀 Starting autoFillEventPeriodsOnly...');
    
    const currentMonth = this.currentEventMonth();
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    const eventWorkingDays = this.eventWorkingDays();
    let filledDays = 0;
    let totalPeriods = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      // Генерируем доступные периоды для этого дня
      const availablePeriods = this.generateAvailablePeriodsForDay(dateStr, startTime, endTime, minPeriodDuration);
      
      if (availablePeriods.length > 0) {
        const eventWorkingDay: EventWorkingDay = {
          date: dateStr,
          isEventWorking: true,
          eventTimeSlots: availablePeriods,
          notes: 'Автозаполнение: доступные периоды'
        };
        
        eventWorkingDays.set(dateStr, eventWorkingDay);
        filledDays++;
        totalPeriods += availablePeriods.length;
        
        this.log.debug(`📅 Day ${dateStr}: Added ${availablePeriods.length} available periods:`, availablePeriods);
      }
    }

    this.eventWorkingDays.set(new Map(eventWorkingDays));

    // Сохраняем в БД
    this.saveEventWorkingDaysToDatabase()
      .then(() => {
        this.showSuccess(`✅ Автозаполнение завершено!\n📅 Заполнено дней: ${filledDays}\n⏰ Создано доступных периодов: ${totalPeriods}\n\n🎯 ВАЖНО: Созданы широкие периоды доступности, а не фиксированные слоты!`);
      })
      .catch(error => {
        this.log.error('Error saving auto-filled days:', error);
        this.showError('Ошибка сохранения автозаполнения');
      });
  }

  /**
   * Новый метод: Автозаполнение ТОЛЬКО широких периодов доступности для выбранных дней
   */
  private autoFillSelectedEventPeriodsOnly(startTime: string, endTime: string, minPeriodDuration: number) {
    this.log.debug('🚀 Starting autoFillSelectedEventPeriodsOnly...');
    
    const selectedDays = this.selectedEventDays();
    if (selectedDays.size === 0) {
      this.showError('Не выбрано ни одного дня для автозаполнения');
      return;
    }

    const eventWorkingDays = this.eventWorkingDays();
    let filledDays = 0;
    let totalPeriods = 0;

    selectedDays.forEach(dateStr => {
      // Генерируем доступные периоды для этого дня
      const availablePeriods = this.generateAvailablePeriodsForDay(dateStr, startTime, endTime, minPeriodDuration);
      
      if (availablePeriods.length > 0) {
        const eventWorkingDay: EventWorkingDay = {
          date: dateStr,
          isEventWorking: true,
          eventTimeSlots: availablePeriods,
          notes: 'Автозаполнение: доступные периоды'
        };
        
        eventWorkingDays.set(dateStr, eventWorkingDay);
        filledDays++;
        totalPeriods += availablePeriods.length;
        
        this.log.debug(`📅 Day ${dateStr}: Added ${availablePeriods.length} available periods:`, availablePeriods);
      }
    });

    this.eventWorkingDays.set(new Map(eventWorkingDays));
    this.clearEventSelection(); // Очищаем выделение

    // Сохраняем в БД
    this.saveEventWorkingDaysToDatabase()
      .then(() => {
        this.showSuccess(`✅ Автозаполнение выбранных дней завершено!\n📅 Заполнено дней: ${filledDays} из ${selectedDays.size}\n⏰ Создано доступных периодов: ${totalPeriods}\n\n🎯 ВАЖНО: Созданы широкие периоды доступности, а не фиксированные слоты!`);
      })
      .catch(error => {
        this.log.error('Error saving auto-filled selected periods:', error);
        this.showError('Ошибка сохранения автозаполнения выбранных дней');
      });
  }

  /**
   * Новый метод: Генерация доступных периодов для конкретного дня
   */
  private generateAvailablePeriodsForDay(dateStr: string, startTime: string, endTime: string, minPeriodDuration: number): EventTimeSlot[] {
    this.log.debug(`🔍 Generating available periods for ${dateStr}...`);
    
    // Получаем студийное время для этого дня
    const studioTime = this.getStudioTimeForDay(dateStr);
    this.log.debug(`🏢 Studio time for ${dateStr}:`, studioTime);
    
    // Если нет студийного времени, создаем один большой период
    if (!studioTime) {
      const period: EventTimeSlot = {
        start: startTime,
        end: endTime,
        location: 'Выездная фотосессия'
      };
      this.log.debug(`✅ No studio time, created full period:`, period);
      return [period];
    }

    // Парсим студийное время
    const studioSlots = this.parseStudioTimeSlots(studioTime);
    this.log.debug(`🔍 Parsed studio slots:`, studioSlots);
    
    // Находим свободные промежутки
    const availablePeriods = this.findAvailablePeriodsAroundStudio(
      startTime, 
      endTime, 
      studioSlots, 
      minPeriodDuration
    );
    
    this.log.debug(`✅ Found ${availablePeriods.length} available periods:`, availablePeriods);
    return availablePeriods;
  }

  /**
   * Парсинг студийного времени в массив временных слотов
   */
  private parseStudioTimeSlots(studioTime: string): { start: string, end: string }[] {
    // Пример: "09:00-14:00, 16:00-18:00" -> [{start: "09:00", end: "14:00"}, {start: "16:00", end: "18:00"}]
    const slots: { start: string, end: string }[] = [];
    
    if (!studioTime) return slots;
    
    const timeRanges = studioTime.split(',').map(range => range.trim());
    
    timeRanges.forEach(range => {
      const [start, end] = range.split('-').map(time => time.trim());
      if (start && end) {
        slots.push({ start, end });
      }
    });
    
    return slots;
  }

  /**
   * Поиск доступных периодов вокруг студийных смен
   */
  private findAvailablePeriodsAroundStudio(
    dayStart: string, 
    dayEnd: string, 
    studioSlots: { start: string, end: string }[], 
    minDuration: number
  ): EventTimeSlot[] {
    const periods: EventTimeSlot[] = [];
    
    // Сортируем студийные слоты по времени начала
    studioSlots.sort((a, b) => a.start.localeCompare(b.start));
    
    let currentTime = dayStart;

    studioSlots.forEach(studioSlot => {
      // Проверяем, есть ли время ДО студийной смены
      const minutesBefore = this.getMinutesDifference(currentTime, studioSlot.start);
      if (minutesBefore >= minDuration) {
        periods.push({
          start: currentTime,
          end: studioSlot.start,
          location: 'Выездная фотосессия'
        });
      }
      
      // Переходим к времени ПОСЛЕ студийной смены
      currentTime = studioSlot.end;
    });
    
    // Проверяем, есть ли время ПОСЛЕ всех студийных смен
    const minutesAfter = this.getMinutesDifference(currentTime, dayEnd);
    if (minutesAfter >= minDuration) {
      periods.push({
        start: currentTime,
        end: dayEnd,
        location: 'Выездная фотосессия'
      });
    }
    
    return periods;
  }

  /**
   * Получение разности времени в минутах
   */
  private getMinutesDifference(startTime: string, endTime: string): number {
    const [hours, minutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);
    const startTotalMinutes = hours * 60 + minutes;
    const endTotalMinutes = endHours * 60 + endMinutes;
    
    return endTotalMinutes - startTotalMinutes;
  }

  /**
   * Переход к следующему дню
   */
  private goToNextDay(currentDate: Date): Date {
    const nextDate = new Date(currentDate);
    nextDate.setDate(nextDate.getDate() + 1);
    return nextDate;
  }

  /**
   * Переход к предыдущему дню
   */
  private goToPreviousDay(currentDate: Date): Date {
    const prevDate = new Date(currentDate);
    prevDate.setDate(prevDate.getDate() - 1);
    return prevDate;
  }

  /**
   * Добавление минут к времени
   */
  private addMinutesToTime(time: string, minutes: number): string {
    const [hours, mins] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + mins + minutes;
    const newHours = Math.floor(totalMinutes / 60);
    const newMins = totalMinutes % 60;
    
    return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
  }

  /**
   * Конвертация времени в минуты
   */
  private timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }

  /**
   * Конвертация минут в время
   */
  private minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  }

  /**
   * Резервный метод автозаполнения без учета буфера
   */
  private autoFillEventDays(startTime: string, endTime: string) {
    const currentMonth = this.currentEventMonth();
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    
    // Получаем все дни текущего месяца
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const eventWorkingDays = this.eventWorkingDays();
    let filledDays = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const studioTime = this.getStudioTimeForDay(dateStr);
      
      // Если нет студийного времени или есть промежутки
      if (!studioTime) {
        const eventWorkingDay: EventWorkingDay = {
          date: dateStr,
          isEventWorking: true,
          eventTimeSlots: [{
            start: startTime,
            end: endTime,
            location: 'Выездная фотосессия'
          }],
          notes: 'Автозаполнение'
        };
        
        eventWorkingDays.set(dateStr, eventWorkingDay);
        filledDays++;
      }
    }

    this.eventWorkingDays.set(new Map(eventWorkingDays));
    this.showSuccess(`Автозаполнение: заполнено ${filledDays} дней`);
  }

  /**
   * Простое автозаполнение выбранных дней
   */
  private autoFillSelectedEventDaysSimple(startTime: string, endTime: string, defaultLocation: string) {
    const selectedDays = this.selectedEventDays();
    const eventWorkingDays = this.eventWorkingDays();
    let filledDays = 0;

    selectedDays.forEach(dateStr => {
      const studioTime = this.getStudioTimeForDay(dateStr);
      
      // Если нет студийного времени, добавляем event время
      if (!studioTime) {
        const eventWorkingDay: EventWorkingDay = {
          date: dateStr,
          isEventWorking: true,
          eventTimeSlots: [{
            start: startTime,
            end: endTime,
            location: defaultLocation
          }],
          notes: 'Автозаполнение выбранных дней'
        };
        
        eventWorkingDays.set(dateStr, eventWorkingDay);
        filledDays++;
      }
    });

    this.eventWorkingDays.set(new Map(eventWorkingDays));
    this.clearEventSelection();
      this.saveEventWorkingDaysToDatabase()
      .then(() => {
        this.showSuccess(`Автозаполнение выбранных дней завершено: заполнено ${filledDays} из ${selectedDays.size} дней`);
      })
      .catch(error => {
        this.log.error('Error saving simple auto-filled selected days:', error);
        this.showError('Ошибка сохранения автозаполнения');
      });
  }

  /**
   * Получение студийного времени для конкретного дня
   */
  getStudioTimeForDay(dateStr: string): string | null {
    const dayOfWeek = new Date(dateStr).getDay();
    const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const dayKey = dayKeys[dayOfWeek];
    
    const availability = this.availability();
    const customDay = this.customDays().get(dateStr);
    
    if (customDay && customDay.isWorking) {
      // Если есть индивидуальные настройки дня
      const timeSlots = customDay.timeSlots?.map(slot => `${slot.start}-${slot.end}`).join(', ');
      return timeSlots || null;
    }
    
    const daySettings = availability.workingHours[dayKey];
    if (daySettings && daySettings.isAvailable) {
      return `${daySettings.start}-${daySettings.end}`;
    }
    
    return null;
  }

  /**
   * Переключение множественного выбора для выездных дней
   */
  toggleEventMultiSelectMode() {
    this.isEventMultiSelectMode.set(!this.isEventMultiSelectMode());
    if (!this.isEventMultiSelectMode()) {
      this.clearEventSelection();
    }
  }

  /**
   * Добавление временного слота для массового редактирования выездных дней
   */
  addEventBulkTimeSlot() {
    this.eventBulkTimeSlotsControls.push(this.createEventTimeSlotGroup());
  }

  /**
   * Удаление временного слота для массового редактирования выездных дней
   */
  removeEventBulkTimeSlot(index: number) {
    if (this.eventBulkTimeSlotsControls.length > 1) {
      this.eventBulkTimeSlotsControls.removeAt(index);
    }
  }

  /**
   * Применение массовых настроек к выездным дням
   */
  async applyEventBulkSettings() {
    if (!this.eventBulkEditForm.valid || this.selectedEventDays().size === 0) return;
    
    this.isSaving.set(true);
    
    try {
      const bulkValue = this.eventBulkEditForm.value;
      const selectedDays = this.selectedEventDays();
      const eventWorkingDays = this.eventWorkingDays();
      
      selectedDays.forEach(dateStr => {
        const eventWorkingDay: EventWorkingDay = {
          date: dateStr,
          isEventWorking: bulkValue.isEventWorking,
          eventTimeSlots: bulkValue.isEventWorking ? bulkValue.eventTimeSlots : [],
          notes: 'Массовое редактирование'
        };
        
        eventWorkingDays.set(dateStr, eventWorkingDay);
      });
      
      this.eventWorkingDays.set(new Map(eventWorkingDays));
      this.clearEventSelection();
      
      // Сохраняем в БД
      await this.saveEventWorkingDaysToDatabase();
      
      this.showSuccess(`Массовые настройки применены к ${selectedDays.size} дням`);      
    } catch (error) {
      this.log.error('Error applying bulk event settings:', error);
      this.showError('Ошибка применения массовых настроек');
    } finally {
      this.isSaving.set(false);
    }
  }

  // ============================================================
  // ВСЕ НЕДОСТАЮЩИЕ МЕТОДЫ ДЛЯ ВЫЕЗДНОГО РАСПИСАНИЯ
  // ============================================================

  /**
   * Обработка клика по дню в календаре выездных фотосессий
   */
  handleEventDayClick(day: EventCalendarDay) {
    if (this.isEventMultiSelectMode()) {
      this.toggleEventDaySelection(day);
    } else {
      this.selectEventDay(day);
    }
  }

  /**
   * Выбор конкретного дня для выездной фотосессии
   */
  selectEventDay(day: EventCalendarDay) {
    this.selectedEventDay.set(day);
    
    // Обновляем форму event дня
    this.eventDayForm.patchValue({
      isEventWorking: day.isEventWorkingDay,
      notes: day.notes || ''
    });
    
    // Очищаем и заполняем временные слоты
    const eventTimeSlotsArray = this.eventTimeSlotsControls;
    while (eventTimeSlotsArray.length) {
      eventTimeSlotsArray.removeAt(0);
    }
    
    if (day.eventTimeSlots && day.eventTimeSlots.length > 0) {
      day.eventTimeSlots.forEach((slot: EventTimeSlot) => {
        eventTimeSlotsArray.push(this.fb.group({
          start: [slot.start, Validators.required],
          end: [slot.end, Validators.required],
          location: [slot.location || '']
        }));
      });
    } else {
      eventTimeSlotsArray.push(this.createEventTimeSlotGroup());
    }
    
    this.eventDayForm.markAsPristine();
  }

  /**
   * Очистка выбора выездных дней
   */
  clearEventSelection() {
    this.selectedEventDays.set(new Set());
  }

  /**
   * Переключение выбора дня в множественном режиме
   */
  toggleEventDaySelection(day: EventCalendarDay) {
    const selectedDays = new Set(this.selectedEventDays());
    if (selectedDays.has(day.date)) {
      selectedDays.delete(day.date);
    } else {
      selectedDays.add(day.date);
    }
    this.selectedEventDays.set(selectedDays);
  }

  /**
   * Сохранение настроек выездного дня
   */
  async saveEventDay() {
    if (!this.eventDayForm.valid || !this.selectedEventDay()) return;

    this.isSaving.set(true);
    
    try {
      const selectedDay = this.selectedEventDay()!;
      const formValue = this.eventDayForm.value;
      
      const eventWorkingDay: EventWorkingDay = {
        date: selectedDay.date,
        isEventWorking: formValue.isEventWorking,
        eventTimeSlots: formValue.isEventWorking ? formValue.eventTimeSlots : [],
        notes: formValue.notes
      };

      // Обновляем локальное состояние
      const eventWorkingDays = this.eventWorkingDays();
      eventWorkingDays.set(selectedDay.date, eventWorkingDay);
      this.eventWorkingDays.set(new Map(eventWorkingDays));

      // Сохраняем в БД
      await this.saveEventWorkingDaysToDatabase();
      
      this.showSuccess('Настройки выездного дня сохранены');
      this.eventDayForm.markAsPristine();
      
    } catch (error) {
      this.log.error('Error saving event day:', error);
      this.showError('Ошибка сохранения настроек выездного дня');
    } finally {
      this.isSaving.set(false);
    }
  }
}
