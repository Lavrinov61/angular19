import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatNativeDateModule } from '@angular/material/core';

import { StudioScheduleService } from '../../services/studio-schedule.service';
import { BookingService } from '../../../booking/services/booking.service';
import { ShiftDialogComponent } from '../shift-dialog/shift-dialog.component';
import {
  Studio,
  StudioEmployee,
  ScheduleShift,
  TimeSlot,
  ShiftType
} from '../../models/studio-schedule.models';
import { Booking } from '../../../../core/models/booking.model';
import { LoggerService } from '../../../../core/services/logger.service';

export interface WeekView {
  weekStart: Date;
  weekEnd: Date;
  days: DaySchedule[];
}

export interface DaySchedule {
  date: Date;
  dayName: string;
  shifts: ScheduleShift[];
  bookings: Booking[];
  availableSlots: TimeSlot[];
  totalRevenue: number;
  occupancyPercentage: number;
}

@Component({
  selector: 'app-schedule-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTabsModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatDialogModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatChipsModule,
    MatNativeDateModule
  ],
  template: `
    <div class="schedule-management-container">
      <!-- Заголовок -->
      <div class="management-header">
        <div class="header-info">
          <h1>Управление расписанием</h1>
          @if (currentStudio()) {
            <p>{{ currentStudio()?.name }}</p>
          }
        </div>
        <div class="header-actions">
          <button mat-raised-button color="primary" (click)="openShiftDialog()">
            <mat-icon>add</mat-icon>
            Добавить смену
          </button>
          <button mat-stroked-button (click)="openTemplateDialog()">
            <mat-icon>schedule</mat-icon>
            Шаблоны
          </button>
        </div>
      </div>

      <!-- Навигация по неделям -->
      <div class="week-navigation">
        <button mat-icon-button (click)="previousWeek()">
          <mat-icon>chevron_left</mat-icon>
        </button>
        <div class="week-info">
          <span class="week-range">
            {{ formatDateRange(currentWeek().weekStart, currentWeek().weekEnd) }}
          </span>
        </div>
        <button mat-icon-button (click)="nextWeek()">
          <mat-icon>chevron_right</mat-icon>
        </button>
        <button mat-button (click)="goToToday()">Сегодня</button>
      </div>

      <!-- Загрузка -->
      @if (isLoading()) {
        <div class="loading-container">
          <mat-progress-spinner mode="indeterminate"></mat-progress-spinner>
        </div>
      }

      <!-- Расписание по дням -->
      @if (!isLoading()) {
        <div class="schedule-grid">
          @for (day of currentWeek().days; track day.date.getTime() || $index) {
            <div 
              class="day-card"
              [class.today]="isToday(day.date)"
              [class.weekend]="isWeekend(day.date)"
            >
          <!-- Заголовок дня -->
          <div class="day-header">
            <div class="day-info">
              <span class="day-name">{{ day.dayName }}</span>
              <span class="day-date">{{ formatDate(day.date) }}</span>
            </div>
            <div class="day-stats">
              @if (day.totalRevenue > 0) {
                <span class="revenue">
                  {{ day.totalRevenue | currency:'RUB':'symbol':'1.0-0' }}
                </span>
              }
              <span class="occupancy" [class.high]="day.occupancyPercentage > 80">
                {{ day.occupancyPercentage }}%
              </span>
            </div>
          </div>

          <!-- Смены дня -->
          <div class="day-shifts">
            @for (shift of day.shifts; track shift.id || $index) {
              <div
                class="shift-item"
                tabindex="0"
                [class.active]="shift.status === 'scheduled'"
                [class.inactive]="shift.status === 'cancelled'"
                (click)="editShift(shift)"
                (keydown.enter)="editShift(shift)"
              >
                <div class="shift-time">
                  {{ formatTime(shift.startTime) }} - {{ formatTime(shift.endTime) }}
                </div>
                @if (shift.employeeName) {
                  <div class="shift-employee">
                    {{ shift.employeeName }}
                  </div>
                }
                <div class="shift-type">{{ getShiftTypeLabel(shift.type) }}</div>
                @if (getShiftBookings(shift, day.bookings).length > 0) {
                  <div class="shift-bookings">
                    {{ getShiftBookings(shift, day.bookings).length }} записей
                  </div>
                }
              <button 
                mat-icon-button 
                class="shift-actions"
                (click)="deleteShift(shift, $event)"
              >
                <mat-icon>delete</mat-icon>
              </button>
              </div>
            }

            <!-- Добавить смену для дня -->
            <button 
              mat-stroked-button 
              class="add-shift-btn"
              (click)="openShiftDialog(day.date)"
            >
              <mat-icon>add</mat-icon>
              Добавить смену
            </button>
          </div>

          <!-- Доступные слоты -->
          @if (day.availableSlots.length > 0) {
            <div class="available-slots">
              <h4>Свободные слоты:</h4>
              <div class="slots-list">
                @for (slot of day.availableSlots; track slot.startTime || $index) {
                  <span 
                    class="slot-chip"
                    [class.premium]="slot.isPremium"
                  >
                    {{ formatTime(slot.startTime) }}
                  </span>
                }
              </div>
            </div>
          }
          </div>
        }
        </div>
      }

      <!-- Статистика недели -->
      @if (!isLoading()) {
        <div class="week-stats">
        <mat-card>
          <mat-card-header>
            <mat-card-title>Статистика недели</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="stats-grid">
              <div class="stat-item">
                <span class="stat-value">{{ weekStats().totalShifts }}</span>
                <span class="stat-label">Смен запланировано</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">{{ weekStats().totalBookings }}</span>
                <span class="stat-label">Записей</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">{{ weekStats().totalRevenue | currency:'RUB':'symbol':'1.0-0' }}</span>
                <span class="stat-label">Выручка</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">{{ weekStats().averageOccupancy }}%</span>
                <span class="stat-label">Средняя загрузка</span>
              </div>
            </div>
          </mat-card-content>
        </mat-card>
        </div>
      }
    </div>
  `,
  styleUrls: ['./schedule-management.component.scss']
})
export class ScheduleManagementComponent implements OnInit {
  private scheduleService = inject(StudioScheduleService);
  private bookingService = inject(BookingService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private fb = inject(FormBuilder);
  private log = inject(LoggerService);

  // Signals
  public isLoading = signal(true);
  public currentStudio = signal<Studio | null>(null);
  public currentDate = signal(new Date());
  public shifts = signal<ScheduleShift[]>([]);
  public bookings = signal<Booking[]>([]);
  public employees = signal<StudioEmployee[]>([]);

  // Computed signals
  public currentWeek = computed(() => this.getWeekView(this.currentDate()));
  
  public weekStats = computed(() => {
    const week = this.currentWeek();
    const totalShifts = week.days.reduce((sum, day) => sum + day.shifts.length, 0);
    const totalBookings = week.days.reduce((sum, day) => sum + day.bookings.length, 0);
    const totalRevenue = week.days.reduce((sum, day) => sum + day.totalRevenue, 0);
    const averageOccupancy = week.days.length > 0 
      ? Math.round(week.days.reduce((sum, day) => sum + day.occupancyPercentage, 0) / week.days.length)
      : 0;

    return {
      totalShifts,
      totalBookings,
      totalRevenue,
      averageOccupancy
    };
  });

  ngOnInit() {
    this.loadInitialData();
    this.setupDataRefresh();
  }

  private async loadInitialData() {
    try {
      this.isLoading.set(true);
      
      // Загружаем данные студии (в реальном приложении - из состояния пользователя)
      const studios = await this.scheduleService.getStudios().toPromise();
      if (studios && studios.length > 0) {
        this.currentStudio.set(studios[0]);
      }

      await this.loadWeekData();
    } catch (error) {
      this.log.error('Error loading initial data:', error);
      this.showError('Ошибка загрузки данных');
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadWeekData() {
    const studio = this.currentStudio();
    if (!studio) return;

    const weekStart = this.getWeekStart(this.currentDate());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    try {
      // Загружаем смены
      const shiftsData = await this.scheduleService.getShifts(
        studio.id, 
        weekStart, 
        weekEnd
      ).toPromise();
      this.shifts.set(shiftsData || []);

      // Загружаем бронирования
      const bookingsData = await this.bookingService.getBookings({
        dateFrom: weekStart.toISOString(),
        dateTo: weekEnd.toISOString()
      }).toPromise();
      this.bookings.set(bookingsData || []);

      // Загружаем сотрудников
      const employeesData = await this.scheduleService.getEmployees(studio.id).toPromise();
      this.employees.set(employeesData || []);
    } catch (error) {
      this.log.error('Error loading week data:', error);
      this.showError('Ошибка загрузки данных недели');
    }
  }

  private setupDataRefresh() {
    // Эффект для перезагрузки данных при изменении недели
    effect(() => {
      const _date = this.currentDate();
      this.loadWeekData();
    });
  }

  private getWeekView(date: Date): WeekView {
    const weekStart = this.getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const days: DaySchedule[] = [];
    
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(weekStart);
      dayDate.setDate(dayDate.getDate() + i);
      
      const dayShifts = this.shifts().filter(shift => 
        this.isSameDate(shift.date, dayDate)
      );
      
      const dayBookings = this.bookings().filter(booking => 
        this.isSameDate(new Date(booking.date), dayDate)
      );

      const availableSlots = this.calculateAvailableSlots(dayShifts, dayBookings);
      const totalRevenue = dayBookings.reduce((sum, booking) => sum + (booking.totalPrice || 0), 0);
      const occupancyPercentage = this.calculateOccupancyPercentage(dayShifts, dayBookings);

      days.push({
        date: dayDate,
        dayName: this.getDayName(dayDate),
        shifts: dayShifts,
        bookings: dayBookings,
        availableSlots,
        totalRevenue,
        occupancyPercentage
      });
    }

    return { weekStart, weekEnd, days };
  }

  // Navigation methods
  previousWeek() {
    const current = this.currentDate();
    current.setDate(current.getDate() - 7);
    this.currentDate.set(new Date(current));
  }

  nextWeek() {
    const current = this.currentDate();
    current.setDate(current.getDate() + 7);
    this.currentDate.set(new Date(current));
  }

  goToToday() {
    this.currentDate.set(new Date());
  }
  // Shift management
  openShiftDialog(date?: Date) {
    const dialogRef = this.dialog.open(ShiftDialogComponent, {
      width: '500px',
      data: {
        date: date,
        employees: this.employees(),
        studioId: this.currentStudio()?.id || ''
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.handleShiftDialogResult(result);
      }
    });
  }

  openTemplateDialog() {
    // TODO: Implement template dialog
    this.log.debug('Open template dialog');
  }

  editShift(shift: ScheduleShift) {
    // TODO: Implement shift editing
    this.log.debug('Edit shift:', shift);
  }

  deleteShift(shift: ScheduleShift, event: Event) {
    event.stopPropagation();
    // TODO: Implement shift deletion
    this.log.debug('Delete shift:', shift);
  }

  // Handler for shift dialog results
  private async handleShiftDialogResult(result: { action: string; data: Partial<ScheduleShift> & { id?: string } }) {
    const studio = this.currentStudio();
    if (!studio) return;

    try {
      switch (result.action) {
        case 'create':
          await this.scheduleService.createShift(studio.id, result.data).toPromise();
          this.showSuccess('Смена успешно создана');
          break;
        case 'update':
          if (result.data.id) {
            await this.scheduleService.updateShift(studio.id, result.data.id, result.data).toPromise();
            this.showSuccess('Смена успешно обновлена');
          }
          break;
        case 'delete':
          if (result.data.id) {
            await this.scheduleService.deleteShift(studio.id, result.data.id).toPromise();
            this.showSuccess('Смена успешно удалена');
          }
          break;
      }
      
      // Reload data after operation
      await this.loadWeekData();
    } catch (error) {
      this.log.error('Error handling shift operation:', error);
      this.showError('Ошибка при выполнении операции');
    }
  }

  // Helper methods
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Понедельник как начало недели
    return new Date(d.setDate(diff));
  }

  private isSameDate(date1: Date, date2: Date): boolean {
    return date1.toDateString() === date2.toDateString();
  }

  private getDayName(date: Date): string {
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    return days[date.getDay()];
  }

  private calculateAvailableSlots(_shifts: ScheduleShift[], _bookings: Booking[]): TimeSlot[] {
    // TODO: Implement available slots calculation
    return [];
  }

  private calculateOccupancyPercentage(shifts: ScheduleShift[], bookings: Booking[]): number {
    if (shifts.length === 0) return 0;
    
    // Простой расчет - процент занятых слотов от общего количества
    const totalHours = shifts.reduce((sum, shift) => {
      const start = new Date(`2000-01-01 ${shift.startTime}`);
      const end = new Date(`2000-01-01 ${shift.endTime}`);
      return sum + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    }, 0);

    const bookedHours = bookings.reduce((sum, booking) => {
      const start = new Date(`2000-01-01 ${booking.startTime}`);
      const end = new Date(`2000-01-01 ${booking.endTime}`);
      return sum + (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    }, 0);

    return totalHours > 0 ? Math.round((bookedHours / totalHours) * 100) : 0;
  }  // Helper method to get bookings for a shift
  getShiftBookings(shift: ScheduleShift, dayBookings: Booking[]): Booking[] {
    return dayBookings.filter(booking => {
      const bookingStart = booking.startTime;
      const bookingEnd = booking.endTime;
      return bookingStart >= shift.startTime && bookingEnd <= shift.endTime;
    });
  }

  // Formatting methods
  formatDate(date: Date): string {
    return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  }

  formatDateRange(start: Date, end: Date): string {
    const startStr = start.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    const endStr = end.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
    return `${startStr} - ${endStr}`;
  }

  formatTime(time: string): string {
    return time.substring(0, 5);
  }

  getShiftTypeLabel(type: ShiftType): string {
    const labels: Record<ShiftType, string> = {
      'regular': 'Обычная',
      'extended': 'Удлиненная',
      'short': 'Короткая',
      'night': 'Ночная',
      'holiday': 'Праздничная'
    };
    return labels[type] || 'Неизвестно';
  }

  // Status checks
  isToday(date: Date): boolean {
    return this.isSameDate(date, new Date());
  }

  isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  private showError(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 5000,
      horizontalPosition: 'center',
      verticalPosition: 'top'
    });
  }

  private showSuccess(message: string) {
    this.snackBar.open(message, 'Закрыть', {
      duration: 3000,
      panelClass: ['success-snackbar']
    });
  }
}
