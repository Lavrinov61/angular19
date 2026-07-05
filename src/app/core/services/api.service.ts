import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginationParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  /** Index signature to allow intersection with Record<string, unknown> */
  [key: string]: unknown;
}

/** Allowed value types for API query parameters */
export type ApiParamValue = string | number | boolean | string[] | number[];
export type ApiParams = Record<string, ApiParamValue | undefined | null>;

/** Build HttpParams from a generic params object */
function buildHttpParams(params?: Record<string, unknown>): HttpParams {
  let httpParams = new HttpParams();
  if (params) {
    Object.keys(params).forEach(key => {
      const value = params[key];
      if (value !== null && value !== undefined) {
        if (Array.isArray(value)) {
          httpParams = httpParams.set(key, value.join(','));
        } else {
          httpParams = httpParams.set(key, String(value));
        }
      }
    });
  }
  return httpParams;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Базовый API Service для работы с backend
 * Предоставляет общие методы для HTTP запросов
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  
  // Signals для состояния
  private isLoadingSignal = signal<boolean>(false);
  private errorSignal = signal<string>('');
  
  // Readonly signals
  public readonly isLoading = this.isLoadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();
  
  /**
   * Health check запрос (без /api префикса)
   */
  getHealth<T>(endpoint: string): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
    
    return this.http.get<ApiResponse<T>>(endpoint)
      .pipe(
        catchError(error => this.handleError<T>(error)),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * Общий GET запрос
   */
  get<T>(endpoint: string, params?: Record<string, unknown>): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();

    const httpParams = buildHttpParams(params);
      return this.http.get<ApiResponse<T>>(`/api${endpoint}`, { params: httpParams })
      .pipe(
        catchError(error => this.handleError<T>(error)),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * Общий POST запрос
   */
  post<T>(endpoint: string, data: unknown): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
      return this.http.post<ApiResponse<T>>(`/api${endpoint}`, data)
      .pipe(
        catchError(error => this.handleError<T>(error)),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * Общий PUT запрос
   */
  put<T>(endpoint: string, data: unknown): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
      return this.http.put<ApiResponse<T>>(`/api${endpoint}`, data)
      .pipe(
        catchError(error => this.handleError<T>(error)),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * Общий PATCH запрос
   */
  patch<T>(endpoint: string, data: unknown): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
      return this.http.patch<ApiResponse<T>>(`/api${endpoint}`, data)
      .pipe(
        catchError(error => this.handleError<T>(error)),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * Общий DELETE запрос
   */
  delete<T>(endpoint: string): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
      return this.http.delete<ApiResponse<T>>(`/api${endpoint}`)
      .pipe(
        catchError(error => this.handleError<T>(error)),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * GET запрос с пагинацией
   */
  getPaginated<T>(endpoint: string, params?: Record<string, unknown>): Observable<PaginatedResponse<T>> {
    this.setLoading(true);
    this.clearError();

    const httpParams = buildHttpParams(params);
      return this.http.get<PaginatedResponse<T>>(`/api${endpoint}`, { params: httpParams })
      .pipe(
        catchError(error => this.handlePaginatedError<T>(error)),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * Специальный метод для health check - не логирует ожидаемые 401 ошибки
   */
  healthCheck<T>(endpoint: string): Observable<ApiResponse<T>> {
    this.setLoading(true);
    
    return this.http.get<T>(`/api${endpoint}`)
      .pipe(
        map(data => ({ success: true, data })),
        catchError(error => {
          const errorMessage = error.error?.message || error.message || 'Неизвестная ошибка';
          this.setError(errorMessage);
          
          return of({
            success: false,
            error: errorMessage,
            status: error.status
          });
        }),
        tap(() => this.setLoading(false))
      );
  }
  
  /**
   * Обработка ошибок для обычных запросов
   */
  private handleError<T>(error: HttpErrorResponse): Observable<ApiResponse<T>> {
    const errorMessage = (error.error as Record<string, unknown>)?.['message'] as string || error.message || 'Неизвестная ошибка';
    this.setError(errorMessage);
    
    return of({
      success: false,
      error: errorMessage
    });
  }
  
  /**
   * Обработка ошибок для пагинированных запросов
   */
  private handlePaginatedError<T>(error: HttpErrorResponse): Observable<PaginatedResponse<T>> {
    const errorMessage = (error.error as Record<string, unknown>)?.['message'] as string || error.message || 'Неизвестная ошибка';
    this.setError(errorMessage);
    
    return of({
      success: false,
      data: [],
      pagination: {
        page: 1,
        limit: 10,
        total: 0,
        totalPages: 0
      }
    });
  }
  
  /**
   * Установка состояния загрузки
   */
  private setLoading(loading: boolean): void {
    this.isLoadingSignal.set(loading);
  }
  
  /**
   * Установка ошибки
   */
  private setError(error: string): void {
    this.errorSignal.set(error);
  }
  
  /**
   * Очистка ошибки
   */
  private clearError(): void {
    this.errorSignal.set('');
  }
  
  /**
   * Получение полного URL для endpoint'а
   */
  getFullUrl(endpoint: string): string {
    return `/api${endpoint}`;
  }
}
