import { Component, inject, signal, computed, ChangeDetectionStrategy, OnInit } from '@angular/core';

import { FormsModule, ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatTableModule } from '@angular/material/table';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DragDropModule } from '@angular/cdk/drag-drop';

import { ScheduleService } from '../../../core/services/schedule.service';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';
import {
  PhotographerSchedule,
  ScheduleSlot
} from '../../../shared/models/schedule.model';

export interface UnifiedScheduleConfig {
  mode: 'admin' | 'photographer' | 'studio';
  permissions: {
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
    canAssign: boolean;
  };
  features: {
    showAnalytics: boolean;
    showBulkActions: boolean;
    showTemplates: boolean;
    allowDragDrop: boolean;
  };
}

export interface CalendarDay {
  date: string;
  dayNumber: number;
  isOtherMonth: boolean;
  isWorkingDay: boolean;
  isToday: boolean;
  shifts: ScheduleSlot[];
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  avatar?: string;
  isAvailable: boolean;
}

/**
 * Унифицированный компонент управления расписанием
 * Поддерживает различные режимы: admin, photographer, studio
 * Построен на Angular 20 + Signals + Standalone Components
 */
@Component({
  selector: 'app-unified-schedule-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatIconModule,
    MatListModule,
    MatDividerModule,
    MatTableModule,
    MatCheckboxModule,
    MatSlideToggleModule,
    MatDialogModule,
    MatTooltipModule,
    MatBadgeModule,
    MatProgressBarModule,
    DragDropModule
],
  template: `
    <div class="unified-schedule-container">
      <!-- Header -->
      <mat-card class="schedule-header">
        <mat-card-header>
          <mat-card-title>
            <mat-icon>schedule</mat-icon>
            {{ getHeaderTitle() }}
          </mat-card-title>
          <mat-card-subtitle>{{ getHeaderSubtitle() }}</mat-card-subtitle>
        </mat-card-header>
        
        <!-- Controls -->
        <mat-card-content>
          <div class="schedule-controls">
            <!-- Month Navigation -->
            <div class="month-nav">
              <button mat-icon-button (click)="previousMonth()">
                <mat-icon>chevron_left</mat-icon>
              </button>
              <mat-form-field appearance="outline">
                <mat-label>Месяц</mat-label>
                <input matInput 
                       [matDatepicker]="monthPicker" 
                       [(ngModel)]="selectedMonth" 
                       (ngModelChange)="onMonthChange()"
                       readonly>
                <mat-datepicker-toggle matSuffix [for]="monthPicker" />
                <mat-datepicker #monthPicker 
                                startView="year" 
                                (monthSelected)="chosenMonthHandler($event, monthPicker)" />
              </mat-form-field>
              <button mat-icon-button (click)="nextMonth()">
                <mat-icon>chevron_right</mat-icon>
              </button>
            </div>
            
            <!-- View Toggle -->
            <mat-chip-listbox class="view-toggle">
              <mat-chip-option [selected]="currentView() === 'calendar'" (click)="currentView.set('calendar')">
                <mat-icon>calendar_view_month</mat-icon>
                Календарь
              </mat-chip-option>
              <mat-chip-option [selected]="currentView() === 'list'" (click)="currentView.set('list')">
                <mat-icon>list</mat-icon>
                Список
              </mat-chip-option>
              @if (config.features.showAnalytics) {
                <mat-chip-option [selected]="currentView() === 'analytics'" 
                                 (click)="currentView.set('analytics')">
                  <mat-icon>analytics</mat-icon>
                  Аналитика
                </mat-chip-option>
              }
            </mat-chip-listbox>
            
            <!-- Actions -->
            <div class="schedule-actions">
              @if (config.permissions.canCreate) {
                <button mat-raised-button color="primary" 
                        (click)="addShift()">
                  <mat-icon>add</mat-icon>
                  Добавить смену
                </button>
              }
              
              @if (config.features.showTemplates) {
                <button mat-stroked-button 
                        (click)="showTemplates()">
                  <mat-icon>library_books</mat-icon>
                  Шаблоны
                </button>
              }
              
              @if (config.features.showBulkActions) {
                <button mat-stroked-button 
                        (click)="bulkActions()">
                  <mat-icon>playlist_add</mat-icon>
                  Массовые действия
                </button>
              }
            </div>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Loading -->
      @if (isLoading()) {
        <div class="loading-state">
          <mat-spinner diameter="40" />
          <p>Загрузка расписания...</p>
        </div>
      }

      <!-- Calendar View -->
      @if (currentView() === 'calendar' && !isLoading()) {
        <div class="calendar-view">
          @if (showStats()) {
            <div class="calendar-stats">
          <div class="stat-item">
            <span class="stat-number">{{ totalShifts() }}</span>
            <span class="stat-label">смен</span>
          </div>
          <div class="stat-item success">
            <span class="stat-number">{{ assignedShifts() }}</span>
            <span class="stat-label">назначено</span>
          </div>
          <div class="stat-item warning">
            <span class="stat-number">{{ openShifts() }}</span>
            <span class="stat-label">свободно</span>
          </div>
          </div>
        }
        
        <div class="calendar-grid">
          <div class="weekdays">
            @for (day of weekdays; track day || $index) {
              <div class="weekday">{{ day }}</div>
            }
          </div>
          
          <div class="calendar-days">
            @for (day of calendarDays(); track trackByDay($index, day)) {
              <div class="day-cell" 
                   [class.other-month]="day.isOtherMonth"
                   [class.today]="day.isToday"
                   [class.working-day]="day.isWorkingDay"
                   [class.has-shifts]="day.shifts.length > 0"
                   [class.selected]="selectedDay() === day.date"
                   (click)="selectDay(day)"
                   (keydown.enter)="selectDay(day)"
                   tabindex="0">
                
                <div class="day-header">
                  <span class="day-number">{{ day.dayNumber }}</span>
                  @if (day.shifts.length > 0) {
                    <span class="shifts-count">{{ day.shifts.length }}</span>
                  }
                </div>
                
                <div class="shifts-list">
                  @for (shift of day.shifts; track trackByShift($index, shift)) {
                    <div class="shift-item" 
                         [class.assigned]="shift.isBooked"
                         [class.selected]="selectedShift() === shift.id"
                         (click)="selectShift(shift); $event.stopPropagation()"
                         (keydown.enter)="selectShift(shift); $event.stopPropagation()"
                         tabindex="0">
                      <div class="shift-time">{{ shift.startTime }}-{{ shift.endTime }}</div>
                      @if (shift.bookingId) {
                        <div class="shift-employee">
                          Забронировано
                        </div>
                      }
                      @if (!shift.bookingId) {
                        <div class="shift-open">Свободно</div>
                      }
                    </div>
                  }
                </div>
                
                @if (config.permissions.canCreate && day.isWorkingDay && !day.isOtherMonth) {
                  <button class="add-shift-btn" 
                          (click)="quickAddShift(day); $event.stopPropagation()"
                          mat-icon-button>
                    <mat-icon>add</mat-icon>
                  </button>
                }
              </div>
            }
          </div>
        </div>
        </div>
      }

      <!-- List View -->
      @if (currentView() === 'list' && !isLoading()) {
        <div class="list-view">
          @for (day of workingDays(); track trackByDay($index, day)) {
            <mat-card class="day-card">
              <mat-card-header>
                <mat-card-title>{{ formatDate(day.date) }}</mat-card-title>
                <mat-card-subtitle>{{ day.shifts.length }} смен</mat-card-subtitle>
              </mat-card-header>
              
              <mat-card-content>
                <div class="shifts-table">
                  @for (shift of day.shifts; track trackByShift($index, shift)) {
                    <div class="shift-row"
                         [class.selected]="selectedShift() === shift.id"
                         (click)="selectShift(shift)"
                         (keydown.enter)="selectShift(shift)"
                         tabindex="0">
                      <div class="shift-time">
                        <mat-icon>schedule</mat-icon>
                        {{ shift.startTime }} - {{ shift.endTime }}
                      </div>
                      <div class="shift-employee">
                        <mat-icon>person</mat-icon>
                        {{ shift.bookingId ? 'Забронировано' : 'Свободно' }}
                      </div>
                      <div class="shift-actions">
                        @if (config.permissions.canEdit) {
                          <button mat-icon-button 
                                  (click)="editShift(shift); $event.stopPropagation()">
                            <mat-icon>edit</mat-icon>
                          </button>
                        }
                        @if (config.permissions.canDelete) {
                          <button mat-icon-button 
                                  (click)="deleteShift(shift); $event.stopPropagation()">
                            <mat-icon>delete</mat-icon>
                          </button>
                        }
                      </div>
                    </div>
                  }
                </div>
              </mat-card-content>
            </mat-card>
          }
        </div>
      }

      <!-- Analytics View -->
      @if (currentView() === 'analytics' && !isLoading()) {
        <div class="analytics-view">
          <div class="analytics-grid">
            <mat-card class="analytics-card">
              <mat-card-header>
                <mat-card-title>Статистика месяца</mat-card-title>
              </mat-card-header>
              <mat-card-content>
                <div class="metrics">
                  <div class="metric">
                    <div class="metric-value">{{ totalShifts() }}</div>
                    <div class="metric-label">Всего смен</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">{{ totalHours() }}</div>
                    <div class="metric-label">Часов</div>
                  </div>
                  <div class="metric">
                    <div class="metric-value">{{ employeeCount() }}</div>
                    <div class="metric-label">Сотрудников</div>
                  </div>
                </div>
              </mat-card-content>
            </mat-card>
          </div>
        </div>
      }

      <!-- No Data State -->
      @if (!isLoading() && isEmpty()) {
        <div class="no-data-state">
          <mat-icon>event_busy</mat-icon>
          <h3>Нет расписания</h3>
          <p>Создайте первую смену для начала работы</p>
          @if (config.permissions.canCreate) {
            <button mat-raised-button color="primary" 
                    (click)="addShift()">
              <mat-icon>add</mat-icon>
              Создать смену
            </button>
          }
        </div>
      }
    </div>
  `,
  styleUrl: './unified-schedule-manager.component.scss'
})
export class UnifiedScheduleManagerComponent implements OnInit {  // Services
  private scheduleService = inject(ScheduleService);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private fb = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private log = inject(LoggerService);

  // Configuration
  config: UnifiedScheduleConfig = {
    mode: 'admin',
    permissions: {
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canAssign: true
    },
    features: {
      showAnalytics: true,
      showBulkActions: true,
      showTemplates: true,
      allowDragDrop: true
    }
  };

  // State
  protected isLoading = signal(false);
  currentView = signal<'calendar' | 'list' | 'analytics'>('calendar');
  selectedMonth = new Date();
  selectedDay = signal<string>('');
  selectedShift = signal<string>('');
  
  // Data
  schedule = signal<PhotographerSchedule | null>(null);
  employees = signal<Employee[]>([]);
  calendarDays = signal<CalendarDay[]>([]);
  weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  // Computed values
  protected totalShifts = computed(() => {
    const days = this.calendarDays();
    return days.reduce((total, day) => total + day.shifts.length, 0);
  });
  protected assignedShifts = computed(() => {
    const days = this.calendarDays();
    return days.reduce((total, day) => 
      total + day.shifts.filter(shift => shift.isBooked).length, 0
    );
  });

  protected openShifts = computed(() => {
    return this.totalShifts() - this.assignedShifts();
  });

  protected totalHours = computed(() => {
    const days = this.calendarDays();
    let minutes = 0;
    for (const day of days) {
      for (const shift of day.shifts) {
        const [sh, sm] = shift.startTime.split(':').map(Number);
        const [eh, em] = shift.endTime.split(':').map(Number);
        minutes += (eh * 60 + em) - (sh * 60 + sm);
      }
    }
    return Math.round(minutes / 60 * 10) / 10;
  });

  protected employeeCount = computed(() => {
    return this.employees().length;
  });

  protected workingDays = computed(() => {
    return this.calendarDays().filter(day => day.isWorkingDay && !day.isOtherMonth);
  });

  ngOnInit(): void {
    this.initializeComponent();
    this.loadSchedule();
  }

  private initializeComponent(): void {
    // Load configuration from route data if available
    const routeConfig = this.route.snapshot.data['scheduleConfig'];
    if (routeConfig) {
      this.config = { ...this.config, ...routeConfig };
    } else {
      // Set configuration based on user role and context
      const user = this.authService.user();
      if (user?.role === 'photographer') {
        this.config.mode = 'photographer';
        this.config.permissions.canDelete = false;
        this.config.features.showAnalytics = false;
        this.config.features.showBulkActions = false;
      } else if (user?.role === 'admin') {
        this.config.mode = 'admin';
      }
    }

    this.generateCalendarDays();
  }

  private loadSchedule(): void {
    const user = this.authService.user();
    if (!user?.id) {
      this.generateCalendarDays();
      return;
    }

    this.isLoading.set(true);
    const year = this.selectedMonth.getFullYear();
    const month = this.selectedMonth.getMonth() + 1;

    this.scheduleService.getPhotographerSchedules(user.id, year, month).subscribe({
      next: (schedules) => {
        // Берём первое расписание текущего месяца (если есть)
        const current = schedules.find(s => s.year === year && s.month === month) || null;
        this.schedule.set(current);
        this.generateCalendarDays(current?.availableSlots || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.snackBar.open('Ошибка загрузки расписания', 'Закрыть', { duration: 3000 });
        this.generateCalendarDays();
        this.isLoading.set(false);
      },
    });
  }

  private generateCalendarDays(slots: ScheduleSlot[] = []): void {
    const year = this.selectedMonth.getFullYear();
    const month = this.selectedMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const days: CalendarDay[] = [];

    // Индексируем слоты по дате
    const slotsByDate = new Map<string, ScheduleSlot[]>();
    for (const slot of slots) {
      const d = new Date(slot.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!slotsByDate.has(key)) slotsByDate.set(key, []);
      slotsByDate.get(key)!.push(slot);
    }

    // Add days from previous month to fill the week
    const firstDayOfWeek = (firstDay.getDay() + 6) % 7; // Monday = 0
    for (let i = firstDayOfWeek - 1; i >= 0; i--) {
      const date = new Date(firstDay);
      date.setDate(date.getDate() - i - 1);
      days.push(this.createCalendarDay(date, true, slotsByDate));
    }

    // Add days of current month
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(year, month, day);
      days.push(this.createCalendarDay(date, false, slotsByDate));
    }

    // Add days from next month to fill the week
    const remainingDays = 42 - days.length; // 6 weeks * 7 days
    for (let day = 1; day <= remainingDays; day++) {
      const date = new Date(year, month + 1, day);
      days.push(this.createCalendarDay(date, true, slotsByDate));
    }

    this.calendarDays.set(days);
  }

  private createCalendarDay(date: Date, isOtherMonth: boolean, slotsByDate?: Map<string, ScheduleSlot[]>): CalendarDay {
    const dateStr = date.toISOString().split('T')[0];
    const today = new Date();
    const isToday = date.toDateString() === today.toDateString();
    const isWorkingDay = date.getDay() !== 0 && date.getDay() !== 6;
    const shifts = slotsByDate?.get(dateStr) || [];

    return {
      date: dateStr,
      dayNumber: date.getDate(),
      isOtherMonth,
      isWorkingDay,
      isToday,
      shifts,
    };
  }

  // Event handlers
  previousMonth(): void {
    this.selectedMonth = new Date(this.selectedMonth.getFullYear(), this.selectedMonth.getMonth() - 1, 1);
    this.onMonthChange();
  }

  nextMonth(): void {
    this.selectedMonth = new Date(this.selectedMonth.getFullYear(), this.selectedMonth.getMonth() + 1, 1);
    this.onMonthChange();
  }

  onMonthChange(): void {
    this.loadSchedule();
  }

  chosenMonthHandler(normalizedMonth: Date, datepicker: { close(): void }): void {
    this.selectedMonth = normalizedMonth;
    this.onMonthChange();
    datepicker.close();
  }

  selectDay(day: CalendarDay): void {
    if (day.isOtherMonth) return;
    this.selectedDay.set(day.date);
  }

  selectShift(shift: ScheduleSlot): void {
    this.selectedShift.set(shift.id);
  }

  addShift(): void {
    // Open add shift dialog
    this.log.debug('Add shift');
  }

  quickAddShift(day: CalendarDay): void {
    this.selectedDay.set(day.date);
    this.addShift();
  }

  editShift(shift: ScheduleSlot): void {
    // Open edit shift dialog
    this.log.debug('Edit shift:', shift);
  }

  deleteShift(shift: ScheduleSlot): void {
    // Confirm and delete shift
    this.log.debug('Delete shift:', shift);
  }

  showTemplates(): void {
    // Show templates dialog
    this.log.debug('Show templates');
  }

  bulkActions(): void {
    // Show bulk actions dialog
    this.log.debug('Bulk actions');
  }

  // Utility methods
  getHeaderTitle(): string {
    switch (this.config.mode) {
      case 'admin': return 'Управление расписанием';
      case 'photographer': return 'Мое расписание';
      case 'studio': return 'Расписание студии';
      default: return 'Расписание';
    }
  }

  getHeaderSubtitle(): string {
    const monthName = this.selectedMonth.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
    return monthName.charAt(0).toUpperCase() + monthName.slice(1);
  }

  showStats(): boolean {
    return this.config.features.showAnalytics && this.currentView() === 'calendar';
  }

  isEmpty(): boolean {
    return this.totalShifts() === 0;
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long' 
    });
  }

  getEmployeeName(employeeId: string): string {
    const employee = this.employees().find(e => e.id === employeeId);
    return employee?.name || 'Неизвестный сотрудник';
  }

  // Track by functions for performance
  trackByDay(_index: number, day: CalendarDay): string {
    return day.date;
  }

  trackByShift(_index: number, shift: ScheduleSlot): string {
    return shift.id;
  }
}

