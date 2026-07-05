import { Injectable, inject, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, of, catchError } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import {
  Studio,
  StudioEmployee,
  StudioSchedule,
  StudioShift,
  ScheduleShift,
  EmployeeWorkStats,
  MODERN_SCHEDULE_TEMPLATES,
  ROTATION_PATTERNS,
  WorkScheduleType,
  RotationType
} from '../models/studio-schedule.models';
import { AuthService } from '../../../core/services/auth.service';
import { LoggerService } from '../../../core/services/logger.service';

/**
 * Сервис для управления студиями и расписанием (с реальным API)
 */
@Injectable({
  providedIn: 'root'
})
export class StudioScheduleService {
  private authService = inject(AuthService);
  private http = inject(HttpClient);
  private log = inject(LoggerService);
  
  // Signals для состояния
  private _studios = signal<Studio[]>([]);
  private _currentStudio = signal<Studio | null>(null);
  
  // Публичные readonly signals
  readonly studios = this._studios.asReadonly();
  readonly currentStudio = this._currentStudio.asReadonly();
  
  // Computed signals
  readonly hasStudios = computed(() => this._studios().length > 0);
  readonly studiosCount = computed(() => this._studios().length);
  
  // Legacy Observable API для обратной совместимости
  private currentStudio$ = toObservable(this.currentStudio);
  
  constructor() {
    // Загружаем студии при инициализации
    this.loadStudios();
  }

  private loadStudios(): void {
    this.getStudios().subscribe({
      next: (studios) => {
        this._studios.set(studios);
        if (studios.length > 0) {
          this.log.debug('Setting default studio:', studios[0]);
          this._currentStudio.set(studios[0]);
        }
      },
      error: (error) => {
        this.log.error('Error loading studios:', error);
      }
    });
  }

  /**
   * Получить все студии
   */
  getStudios(): Observable<Studio[]> {
    return this.http.get<{success: boolean, data: Studio[]}>(`/api/schedule/studios`)
      .pipe(
        map(response => response.data || []),
        catchError(error => {
          this.log.error('Error fetching studios:', error);
          return of([]);
        })
      );
  }

  /**
   * Получить конкретную студию
   */
  getStudio(studioId: string): Observable<Studio | undefined> {
    return this.http.get<{success: boolean, data: Studio}>(`/api/schedule/studios/${studioId}`)
      .pipe(
        map(response => response.data),
        catchError(error => {
          this.log.error('Error fetching studio:', error);
          return of(undefined);
        })
      );
  }

  /**
   * Получить расписание студии на месяц
   */
  getStudioSchedule(studioId: string, month: Date): Observable<StudioSchedule> {
    const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    
    return this.http.get<{success: boolean, data: StudioSchedule}>(`/api/schedule/studios/${studioId}/schedule/${monthStr}`)
      .pipe(
        map(response => response.data),
        catchError(error => {
          this.log.error('Error fetching studio schedule:', error);
          // Возвращаем пустое расписание в случае ошибки
          return of({
            studioId,
            month: monthStr,
            days: []
          });
        })
      );
  }

  /**
   * Сохранить расписание студии
   */
  saveStudioSchedule(schedule: StudioSchedule): Observable<boolean> {
    return this.http.put<{success: boolean}>(`/api/schedule/studios/${schedule.studioId}/schedule/${schedule.month}`, schedule)
      .pipe(
        map(response => response.success),
        catchError(error => {
          this.log.error('Error saving studio schedule:', error);
          return of(false);
        })
      );
  }

  /**
   * Добавить смену в день
   */
  addShiftToDay(studioId: string, date: string, shiftData: Partial<StudioShift>): Observable<boolean> {
    return this.http.post<{success: boolean, message: string}>(`/api/schedule/shift`, {
      studioId,
      date,
      shiftData
    }).pipe(
      map(response => response.success),
      catchError(error => {
        this.log.error('Error adding shift:', error);
        return of(false);
      })
    );
  }

  /**
   * Удалить смену
   */
  removeShift(shiftId: string): Observable<boolean> {
    return this.http.delete<{success: boolean, message: string}>(`/api/schedule/shift/${shiftId}`)
      .pipe(
        map(response => response.success),
        catchError(error => {
          this.log.error('Error removing shift:', error);
          return of(false);
        })
      );
  }
  /**
   * Назначить сотрудника на смену
   */
  assignEmployeeToShift(shiftId: string, employeeId: string): Observable<boolean> {
    return this.http.put<{success: boolean}>(`/api/schedule/shift/${shiftId}/assign`, {
      employeeId
    }).pipe(
      map(response => response.success),
      catchError(error => {
        this.log.error('Error assigning employee to shift:', error);
        return of(false);
      })
    );
  }
  /**
   * Убрать сотрудника со смены
   */
  unassignEmployeeFromShift(shiftId: string): Observable<boolean> {
    return this.http.put<{success: boolean}>(`/api/schedule/unassign-employee`, {
      shiftId
    }).pipe(
      map(response => response.success),
      catchError(error => {
        this.log.error('Error unassigning employee from shift:', error);
        return of(false);
      })
    );
  }
  /**
   * Обновить данные смены (старый метод - удален, используем новый)
   */

  /**
   * Установить рабочий/нерабочий день
   */
  setWorkingDay(studioId: string, date: string, isWorking: boolean): Observable<boolean> {
    return this.http.put<{success: boolean, message: string}>(`/api/schedule/working-day`, {
      studioId,
      date,
      isWorking
    }).pipe(
      map(response => response.success),
      catchError(error => {
        this.log.error('Error setting working day:', error);
        return of(false);
      })
    );
  }

  /**
   * Получить сотрудников студии
   */
  getStudioEmployees(studioId: string): Observable<StudioEmployee[]> {
    return this.http.get<{success: boolean, data: StudioEmployee[]}>(`/api/schedule/studios/${studioId}/employees`)
      .pipe(
        map(response => response.data || []),
        catchError(error => {
          this.log.error('Error fetching studio employees:', error);
          return of([]);
        })
      );
  }

  /**
   * Применить шаблон расписания
   */
  applyStandardTemplate(studioId: string, month: Date, templateName: string): Observable<boolean> {
    const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    
    return this.http.post<{success: boolean}>(`/api/schedule/studios/${studioId}/apply-template`, {
      month: monthStr,
      templateType: templateName
    }).pipe(
      map(response => response.success),
      catchError(error => {
        this.log.error('Error applying template:', error);
        return of(false);
      })
    );
  }

  /**
   * Получить текущую студию
   */
  getCurrentStudio(): Observable<Studio | null> {
    return this.currentStudio$;
  }

  /**
   * Установить текущую студию
   */
  setCurrentStudio(studioId: string): void {
    this.getStudio(studioId).subscribe(studio => {
      if (studio) {
        this._currentStudio.set(studio);
      }
    });
  }
  // ==================== МЕТОДЫ ДЛЯ СОВМЕСТИМОСТИ ====================
  
  /**
   * Получить статистику работы сотрудника через API
   */
  getEmployeeStats(employeeId: string, period: { start: Date; end: Date }): Observable<EmployeeWorkStats> {
    const params = {
      employeeId,
      startDate: period.start.toISOString().split('T')[0],
      endDate: period.end.toISOString().split('T')[0]
    };
      return this.http.get<{success: boolean, data: EmployeeWorkStats}>(`/api/photographer/stats`, { params }).pipe(
      map(response => response.data || {
        employeeId: employeeId,
        period: {
          start: period.start.toISOString().split('T')[0],
          end: period.end.toISOString().split('T')[0]
        },
        totalHours: 0,
        totalShifts: 0,
        completedShifts: 0,
        cancelledShifts: 0,
        averageHoursPerShift: 0,
        totalEarnings: 0,
        efficiency: 0,
        punctuality: 0,
        bookingStats: {
          totalBookings: 0,
          completedBookings: 0,
          cancelledBookings: 0,
          noShowBookings: 0
        }
      }),      catchError(error => {
        this.log.error('Ошибка получения статистики сотрудника:', error);
        return of({
          employeeId: employeeId,
          period: {
            start: period.start.toISOString().split('T')[0],
            end: period.end.toISOString().split('T')[0]
          },
          totalHours: 0,
          totalShifts: 0,
          completedShifts: 0,
          cancelledShifts: 0,
          averageHoursPerShift: 0,
          totalEarnings: 0,
          efficiency: 0,
          punctuality: 0,
          bookingStats: {
            totalBookings: 0,
            completedBookings: 0,
            cancelledBookings: 0,
            noShowBookings: 0
          }
        });
      })
    );
  }
  /**
   * Рассчитать статистику работы всех сотрудников через API
   */
  calculateAllEmployeesStats(studioId: string, month: Date): Observable<Record<string, EmployeeWorkStats>> {
    const params = {
      studioId,
      month: month.toISOString().split('T')[0]
    };
    
    return this.http.get<{success: boolean, data: Record<string, EmployeeWorkStats>}>(`/api/photographer/all-stats`, { params }).pipe(
      map(response => response.data || {}),
      catchError(error => {
        this.log.error('Ошибка получения статистики всех сотрудников:', error);
        return of({});
      })
    );
  }

  /**
   * Получить статистику работы сотрудника (новый метод)
   */
  getEmployeeWorkStats(employeeId: string, startDate: string, endDate: string): Observable<EmployeeWorkStats> {
    const period = {
      start: new Date(startDate),
      end: new Date(endDate)
    };
    return this.getEmployeeStats(employeeId, period);
  }

  /**
   * Применить шаблон к расписанию
   */
  applyTemplateToSchedule(studioId: string, month: string, templateId: string): Observable<boolean> {
    const monthDate = new Date(month + '-01');
    return this.applyStandardTemplate(studioId, monthDate, templateId);
  }

  // ==================== НОВЫЕ МЕТОДЫ ДЛЯ СОВРЕМЕННЫХ ГРАФИКОВ ====================

  /**
   * Получить доступные типы графиков
   */
  getAvailableScheduleTypes(): Observable<{ type: WorkScheduleType; name: string; description: string }[]> {
    return of([
      { type: 'flexible', name: 'Гибкий график', description: 'Свободный выбор смен сотрудниками' },
      { type: 'fixed-shifts', name: 'Фиксированные смены', description: 'Утренние и вечерние смены' },
      { type: 'rotation', name: 'Ротационный график', description: 'Работа/отдых по циклам' },
      { type: 'mixed', name: 'Смешанный график', description: 'Комбинация разных типов' }
    ]);
  }

  /**
   * Получить доступные ротационные паттерны
   */
  getRotationPatterns(): Observable<typeof ROTATION_PATTERNS> {
    return of(ROTATION_PATTERNS);
  }

  /**
   * Применить ротационный график к сотруднику
   */
  assignEmployeeToRotation(employeeId: string, rotationType: RotationType, startDate: string): Observable<boolean> {
    const pattern = ROTATION_PATTERNS[rotationType];
    if (!pattern) {
      this.log.error('Invalid rotation type:', rotationType);
      return of(false);
    }

    this.log.debug('Assigning employee to rotation:', {
      employeeId,
      rotationType,
      startDate,
      pattern
    });

    // TODO: Реализовать API для ротации
    return of(true);
  }

  /**
   * Рассчитать расписание на основе ротации
   */
  generateRotationSchedule(studioId: string, month: Date, rotationType: RotationType): Observable<StudioSchedule> {
    const pattern = ROTATION_PATTERNS[rotationType];
    if (!pattern) {
      throw new Error(`Invalid rotation type: ${rotationType}`);
    }

    // TODO: Переделать на API запрос
    // Пока возвращаем базовое расписание
    return this.getStudioSchedule(studioId, month);
  }

  /**
   * Получить современные шаблоны расписания
   */
  getModernScheduleTemplates(): Observable<typeof MODERN_SCHEDULE_TEMPLATES> {
    return of(MODERN_SCHEDULE_TEMPLATES);
  }

  /**
   * Применить современный шаблон расписания
   */
  applyModernTemplate(_studioId: string, templateId: keyof typeof MODERN_SCHEDULE_TEMPLATES): Observable<boolean> {
    const template = MODERN_SCHEDULE_TEMPLATES[templateId];
    if (!template) {
      this.log.error('Template not found:', templateId);
      return of(false);
    }

    this.log.debug('Applying modern template:', template);
    // TODO: Реализовать API для применения современных шаблонов
    return of(true);
  }

  /**
   * Получить смены за период
   */
  getShifts(studioId: string, startDate: Date, endDate: Date): Observable<ScheduleShift[]> {
    const params = {
      studioId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    };

    return this.http.get<{success: boolean, data: ScheduleShift[]}>(`/api/schedule/shifts`, { params })
      .pipe(
        map(response => response.data || []),
        catchError(error => {
          this.log.error('Error fetching shifts:', error);
          return of([]);
        })
      );
  }

  /**
   * Получить сотрудников студии
   */
  getEmployees(studioId: string): Observable<StudioEmployee[]> {
    return this.http.get<{success: boolean, data: StudioEmployee[]}>(`/api/schedule/studios/${studioId}/employees`)
      .pipe(
        map(response => response.data || []),
        catchError(error => {
          this.log.error('Error fetching employees:', error);
          return of([]);
        })
      );
  }

  /**
   * Создать новую смену
   */
  createShift(studioId: string, shiftData: unknown): Observable<unknown> {
    return this.http.post<{success: boolean, data: unknown}>(`/api/schedule/studios/${studioId}/shifts`, shiftData)
      .pipe(
        map(response => response.data),
        catchError(error => {
          this.log.error('Error creating shift:', error);
          throw error;
        })
      );
  }

  /**
   * Обновить смену
   */
  updateShift(studioId: string, shiftId: string, shiftData: unknown): Observable<unknown> {
    return this.http.patch<{success: boolean, data: unknown}>(`/api/schedule/studios/${studioId}/shifts/${shiftId}`, shiftData)
      .pipe(
        map(response => response.data),
        catchError(error => {
          this.log.error('Error updating shift:', error);
          throw error;
        })
      );
  }

  /**
   * Удалить смену
   */
  deleteShift(studioId: string, shiftId: string): Observable<boolean> {
    return this.http.delete<{success: boolean}>(`/api/schedule/studios/${studioId}/shifts/${shiftId}`)
      .pipe(
        map(response => response.success),
        catchError(error => {
          this.log.error('Error deleting shift:', error);
          return of(false);
        })
      );
  }
}
