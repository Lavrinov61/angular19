import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  errors?: Record<string, string[]>;
}

@Injectable({
  providedIn: 'root'
})
export class BaseApiService {
  protected http = inject(HttpClient);
  protected baseUrl = '/api';
  
  // Signals для общего состояния API
  private loadingSignal = signal<boolean>(false);
  private errorSignal = signal<string>('');
  
  public readonly loading = this.loadingSignal.asReadonly();
  public readonly error = this.errorSignal.asReadonly();
  
  protected setLoading(loading: boolean): void {
    this.loadingSignal.set(loading);
  }
  
  protected setError(error: string): void {
    this.errorSignal.set(error);
  }
  
  protected clearError(): void {
    this.errorSignal.set('');
  }
  
  /**
   * Обработка HTTP ошибок
   */
  protected handleError = (error: HttpErrorResponse): Observable<never> => {
    let errorMessage = 'Произошла ошибка';
    
    if (error.error instanceof ErrorEvent) {
      // Клиентская ошибка
      errorMessage = `Ошибка: ${error.error.message}`;
    } else {
      // Серверная ошибка
      switch (error.status) {
        case 400:
          errorMessage = error.error?.message || 'Неверные данные';
          break;
        case 401:
          errorMessage = 'Необходима авторизация';
          break;
        case 403:
          errorMessage = 'Доступ запрещен';
          break;
        case 404:
          errorMessage = 'Ресурс не найден';
          break;
        case 500:
          errorMessage = 'Ошибка сервера';
          break;
        default:
          errorMessage = `Ошибка ${error.status}: ${error.error?.message || 'Неизвестная ошибка'}`;
      }
    }
    
    this.setError(errorMessage);
    return throwError(() => new Error(errorMessage));
  };
  
  /**
   * GET запрос
   */
  protected get<T>(endpoint: string): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
    
    return this.http.get<ApiResponse<T>>(`${this.baseUrl}${endpoint}`)
      .pipe(
        tap(() => this.setLoading(false)),
        catchError((error) => {
          this.setLoading(false);
          return this.handleError(error);
        })
      );
  }
  
  /**
   * POST запрос
   */
  protected post<T>(endpoint: string, data: unknown): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
    
    return this.http.post<ApiResponse<T>>(`${this.baseUrl}${endpoint}`, data)
      .pipe(
        tap(() => this.setLoading(false)),
        catchError((error) => {
          this.setLoading(false);
          return this.handleError(error);
        })
      );
  }
  
  /**
   * PUT запрос
   */
  protected put<T>(endpoint: string, data: unknown): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
    
    return this.http.put<ApiResponse<T>>(`${this.baseUrl}${endpoint}`, data)
      .pipe(
        tap(() => this.setLoading(false)),
        catchError((error) => {
          this.setLoading(false);
          return this.handleError(error);
        })
      );
  }
  
  /**
   * DELETE запрос
   */
  protected delete<T>(endpoint: string): Observable<ApiResponse<T>> {
    this.setLoading(true);
    this.clearError();
    
    return this.http.delete<ApiResponse<T>>(`${this.baseUrl}${endpoint}`)
      .pipe(
        tap(() => this.setLoading(false)),
        catchError((error) => {
          this.setLoading(false);
          return this.handleError(error);
        })
      );
  }
}
