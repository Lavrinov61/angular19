import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, BehaviorSubject, of } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { ApiResponse } from './api.service';
import {
  PhotographerSchedule,
  ScheduleSlot,
  PhotographerSchedulePreference,
  ScheduleConflict,
  ScheduleGenerationOptions,
  ScheduleStats
} from '../../shared/models/schedule.model';

export interface ScheduleState {
  schedules: PhotographerSchedule[];
  selectedSchedule: PhotographerSchedule | null;
  loading: boolean;
  error: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `/api/schedule`;

  // Modern Angular 20 signals approach
  private readonly _state = signal<ScheduleState>({
    schedules: [],
    selectedSchedule: null,
    loading: false,
    error: null
  });

  // Public computed state
  readonly state = this._state.asReadonly();
  readonly schedules = computed(() => this.state().schedules);
  readonly selectedSchedule = computed(() => this.state().selectedSchedule);
  readonly loading = computed(() => this.state().loading);
  readonly error = computed(() => this.state().error);
  readonly isEmpty = computed(() => this.schedules().length === 0);

  // Legacy observables for backward compatibility
  private schedulesSubject = new BehaviorSubject<PhotographerSchedule[]>([]);
  public schedules$ = this.schedulesSubject.asObservable();

  constructor() {
    // Service initialized with REST API
  }

  /**
   * Получить расписания фотографа
   */
  getPhotographerSchedules(photographerId: string, year?: number, month?: number): Observable<PhotographerSchedule[]> {
    this._state.update(state => ({ ...state, loading: true, error: null }));

    let params = new HttpParams();
    if (year) params = params.set('year', year.toString());
    if (month) params = params.set('month', month.toString());

    return this.http.get<ApiResponse<PhotographerSchedule[]>>(
      `${this.apiUrl}/photographer/${photographerId}`,
      { params }
    ).pipe(
      tap(response => {
        if (response.success && response.data) {
          this._state.update(state => ({
            ...state,
            schedules: response.data!,
            loading: false
          }));
          this.schedulesSubject.next(response.data);
        }
      }),
      map(response => response.data || []),
      catchError(error => {
        this._state.update(state => ({
          ...state,
          loading: false,
          error: error.message || 'Failed to load schedules'
        }));
        return of([]);
      })
    );
  }

  /**
   * Загрузить расписания фотографа (алиас для обратной совместимости)
   */
  loadPhotographerSchedules(photographerId: string, year?: number, month?: number): Observable<PhotographerSchedule[]> {
    return this.getPhotographerSchedules(photographerId, year, month);
  }

  /**
   * Создать новое расписание
   */
  createSchedule(schedule: Omit<PhotographerSchedule, 'id'>): Observable<PhotographerSchedule> {
    this._state.update(state => ({ ...state, loading: true, error: null }));

    return this.http.post<ApiResponse<PhotographerSchedule>>(this.apiUrl, schedule).pipe(
      tap(response => {
        if (response.success && response.data) {
          this._state.update(state => ({
            ...state,
            schedules: [...state.schedules, response.data!],
            loading: false
          }));
        }
      }),
      map(response => response.data!),
      catchError(error => {
        this._state.update(state => ({
          ...state,
          loading: false,
          error: error.message || 'Failed to create schedule'
        }));
        throw error;
      })
    );
  }

  /**
   * Обновить расписание
   */
  updateSchedule(scheduleId: string, updates: Partial<PhotographerSchedule>): Observable<PhotographerSchedule> {
    this._state.update(state => ({ ...state, loading: true, error: null }));

    return this.http.put<ApiResponse<PhotographerSchedule>>(
      `${this.apiUrl}/${scheduleId}`,
      updates
    ).pipe(
      tap(response => {
        if (response.success && response.data) {
          this._state.update(state => ({
            ...state,
            schedules: state.schedules.map(s => s.id === scheduleId ? response.data! : s),
            loading: false
          }));
        }
      }),
      map(response => response.data!),
      catchError(error => {
        this._state.update(state => ({
          ...state,
          loading: false,
          error: error.message || 'Failed to update schedule'
        }));
        throw error;
      })
    );
  }

  /**
   * Удалить расписание
   */
  deleteSchedule(scheduleId: string): Observable<void> {
    this._state.update(state => ({ ...state, loading: true, error: null }));

    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/${scheduleId}`).pipe(
      tap(response => {
        if (response.success) {
          this._state.update(state => ({
            ...state,
            schedules: state.schedules.filter(s => s.id !== scheduleId),
            loading: false
          }));
        }
      }),
      map(() => void 0),
      catchError(error => {
        this._state.update(state => ({
          ...state,
          loading: false,
          error: error.message || 'Failed to delete schedule'
        }));
        throw error;
      })
    );
  }

  /**
   * Получить предпочтения расписания
   */
  getSchedulePreferences(photographerId: string): Observable<PhotographerSchedulePreference[]> {
    return this.http.get<ApiResponse<PhotographerSchedulePreference[]>>(
      `${this.apiUrl}/preferences/${photographerId}`
    ).pipe(
      map(response => response.data || []),
      catchError(() => {
        return of([]);
      })
    );
  }

  /**
   * Сохранить предпочтения расписания
   */
  saveSchedulePreferences(preferences: PhotographerSchedulePreference): Observable<PhotographerSchedulePreference> {
    return this.http.put<ApiResponse<PhotographerSchedulePreference>>(
      `${this.apiUrl}/preferences/${preferences.photographerId}`,
      preferences
    ).pipe(
      map(response => response.data!),
      catchError(error => {
        throw error;
      })
    );
  }

  /**
   * Обновить слот расписания
   */
  updateScheduleSlot(
    scheduleId: string,
    slotId: string,
    updates: Partial<ScheduleSlot>
  ): Observable<ScheduleSlot> {
    this._state.update(state => ({ ...state, loading: true, error: null }));

    return this.http.put<ApiResponse<ScheduleSlot>>(
      `${this.apiUrl}/${scheduleId}/slots/${slotId}`,
      updates
    ).pipe(
      tap(response => {
        if (response.success && response.data) {
          this._state.update(state => ({
            ...state,
            schedules: state.schedules.map(schedule => {
              if (schedule.id === scheduleId) {
                return {
                  ...schedule,
                  availableSlots: schedule.availableSlots.map((slot: ScheduleSlot) =>
                    slot.id === slotId ? response.data! : slot
                  )
                };
              }
              return schedule;
            }),
            loading: false
          }));
        }
      }),
      map(response => response.data!),
      catchError(error => {
        this._state.update(state => ({
          ...state,
          loading: false,
          error: error.message || 'Failed to update schedule slot'
        }));
        throw error;
      })
    );
  }

  /**
   * Получить статистику расписания
   */
  getScheduleStats(photographerId: string, startDate: Date, endDate: Date): Observable<ScheduleStats> {
    const params = new HttpParams()
      .set('startDate', startDate.toISOString())
      .set('endDate', endDate.toISOString());

    return this.http.get<ApiResponse<ScheduleStats>>(
      `${this.apiUrl}/stats/${photographerId}`,
      { params }
    ).pipe(
      map(response => response.data!),
      catchError(() => {
        return of({} as ScheduleStats);
      })
    );
  }

  /**
   * Генерировать расписание
   */
  generateSchedule(_photographerId: string, options: ScheduleGenerationOptions): Observable<PhotographerSchedule> {
    return this.http.post<ApiResponse<PhotographerSchedule>>(
      `${this.apiUrl}/generate`,
      options
    ).pipe(
      tap(response => {
        if (response.success && response.data) {
          this._state.update(state => ({
            ...state,
            schedules: [...state.schedules, response.data!]
          }));
        }
      }),
      map(response => response.data!),
      catchError(error => {
        throw error;
      })
    );
  }

  /**
   * Проверить конфликты расписания
   */
  checkScheduleConflicts(photographerId: string, slots: ScheduleSlot[]): Observable<ScheduleConflict[]> {
    return this.http.post<ApiResponse<ScheduleConflict[]>>(
      `${this.apiUrl}/conflicts`,
      { photographerId, slots }
    ).pipe(
      map(response => response.data || []),
      catchError(() => {
        return of([]);
      })
    );
  }

  // Utility methods
  setLoading(loading: boolean): void {
    this._state.update(state => ({ ...state, loading }));
  }

  setError(error: string | null): void {
    this._state.update(state => ({ ...state, error }));
  }

  selectSchedule(schedule: PhotographerSchedule | null): void {
    this._state.update(state => ({ ...state, selectedSchedule: schedule }));
  }

  clearError(): void {
    this.setError(null);
  }

  resetState(): void {
    this._state.set({
      schedules: [],
      selectedSchedule: null,
      loading: false,
      error: null
    });
  }
}
