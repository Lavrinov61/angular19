import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, throwError, of } from 'rxjs';
import { map, timeout, catchError } from 'rxjs/operators';

export interface UserPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export interface GeolocationError {
  code: number;
  message: string;
  type: 'PERMISSION_DENIED' | 'PERMISSION_PERMANENTLY_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'NOT_SUPPORTED';
  helpText?: string;
}

export interface GeolocationState {
  isLoading: boolean;
  position: UserPosition | null;
  error: GeolocationError | null;
  hasPermission: boolean | null;
}

@Injectable({
  providedIn: 'root'
})
export class GeolocationService {
  private readonly TIMEOUT_MS = 10000; // 10 seconds
  private readonly CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  
  // Signal для состояния
  private _state = signal<GeolocationState>({
    isLoading: false,
    position: null,
    error: null,
    hasPermission: null
  });

  // Публичный readonly signal
  readonly state = this._state.asReadonly();
  
  // Computed signals
  readonly isLoading = computed(() => this._state().isLoading);
  readonly position = computed(() => this._state().position);
  readonly error = computed(() => this._state().error);
  readonly hasPermission = computed(() => this._state().hasPermission);
  
  // Legacy Observable API для обратной совместимости
  public readonly state$ = toObservable(this.state);
  private platformId = inject(PLATFORM_ID);
  
  constructor() {
    this.checkGeolocationSupport();
  }  /**
   * Check if geolocation is supported by the browser
   * @returns Whether geolocation is supported
   */
  checkGeolocationSupport(): boolean {
    if (!isPlatformBrowser(this.platformId)) {
      // SSR - not in browser, consider as not supported
      return false;
    }
    
    if (!navigator.geolocation) {
      const error: GeolocationError = {
        code: 0,
        message: 'Геолокация не поддерживается браузером',
        type: 'NOT_SUPPORTED'
      };
      this.updateState({ error });
      return false;
    }
    return true;
  }
  /**
   * Request current position from the user
   */
  getCurrentPosition(): Observable<UserPosition> {
    if (!this.checkGeolocationSupport()) {
      return throwError(() => this._state().error);
    }

    // Check if we have a recent cached position
    const currentState = this._state();
    if (currentState.position && this.isPositionFresh(currentState.position)) {
      return of(currentState.position);
    }

    this.updateState({ isLoading: true, error: null });

    return new Observable<UserPosition>(observer => {
      const options: PositionOptions = {
        enableHighAccuracy: true,
        timeout: this.TIMEOUT_MS,
        maximumAge: this.CACHE_DURATION_MS
      };

      const successCallback = (position: GeolocationPosition) => {
        const geoPosition: UserPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: position.timestamp
        };

        this.updateState({ 
          isLoading: false, 
          position: geoPosition, 
          hasPermission: true,
          error: null 
        });

        observer.next(geoPosition);
        observer.complete();
      };

      const errorCallback = (error: GeolocationPositionError) => {
        const geoError = this.mapGeolocationError(error);
        
        this.updateState({ 
          isLoading: false, 
          error: geoError,
          hasPermission: error.code === error.PERMISSION_DENIED ? false : null
        });

        observer.error(geoError);
      };

      navigator.geolocation.getCurrentPosition(
        successCallback,
        errorCallback,
        options
      );
    }).pipe(
      timeout(this.TIMEOUT_MS),
      catchError((error) => {
        if (error.name === 'TimeoutError') {
          const timeoutError: GeolocationError = {
            code: 3,
            message: 'Время ожидания получения местоположения истекло',
            type: 'TIMEOUT'
          };
          this.updateState({ isLoading: false, error: timeoutError });
          return throwError(() => timeoutError);
        }
        return throwError(() => error);
      })
    );
  }
  /**
   * Request permission for geolocation
   */
  async requestPermission(): Promise<PermissionState> {
    if (!isPlatformBrowser(this.platformId)) {
      return 'denied';
    }
    
    if (!navigator.permissions) {
      // Fallback for browsers without Permissions API
      return this.getCurrentPosition().pipe(
        map(() => 'granted' as PermissionState),
        catchError(() => of('denied' as PermissionState))
      ).toPromise() as Promise<PermissionState>;
    }

    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      this.updateState({ hasPermission: permission.state === 'granted' });
      return permission.state;
    } catch {
      return 'prompt';
    }
  }
  /**
   * Generate Google Maps directions URL with user's location
   */  getDirectionsUrl(destination: string, userPosition?: UserPosition): string {
    const baseUrl = 'https://www.google.com/maps/dir/';
    
    if (userPosition) {
      // Используем правильный формат для передачи координат в Google Maps
      const origin = `${userPosition.latitude},${userPosition.longitude}`;
      // Формат с origin/destination лучше работает для геолокации
      return `${baseUrl}${origin}/${encodeURIComponent(destination)}`;
    }
    
    // Если местоположение не получено, используем специальный параметр 
    // !4e2 - признак того, что нужно запросить текущее местоположение
    return `${baseUrl}/${encodeURIComponent(destination)}/data=!4m6!4m5!1m1!4e2!1m2!1m1!1s0`;
  }

  /**
   * Clear cached position and reset state
   */
  clearCache(): void {
    this.updateState({
      position: null,
      error: null,
      isLoading: false
    });
  }

  /**
   * Get current state snapshot
   */
  getCurrentState(): GeolocationState {
    return this._state();
  }

  private updateState(partial: Partial<GeolocationState>): void {
    this._state.update(state => ({ ...state, ...partial }));
  }
  private mapGeolocationError(error: GeolocationPositionError): GeolocationError {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        // Check for Chrome's permanent block message in the error
        if (error.message && (
            error.message.includes('User denied Geolocation') || 
            error.message.includes('Permission denied') ||
            error.message.includes('blocked') ||
            error.message.includes('ignored the permission prompt several times')
          )) {
          return {
            code: error.code,
            message: 'Доступ к местоположению был заблокирован в браузере.',
            type: 'PERMISSION_PERMANENTLY_DENIED',
            helpText: 'Для разблокировки: нажмите на значок 🔒 или ⚙️ рядом с URL сайта и разрешите доступ к местоположению в настройках сайта.'
          };
        }
        return {
          code: error.code,
          message: 'Доступ к местоположению запрещен пользователем',
          type: 'PERMISSION_DENIED'
        };
      case error.POSITION_UNAVAILABLE:
        return {
          code: error.code,
          message: 'Местоположение недоступно',
          type: 'POSITION_UNAVAILABLE'
        };
      case error.TIMEOUT:
        return {
          code: error.code,
          message: 'Время ожидания получения местоположения истекло',
          type: 'TIMEOUT'
        };
      default:
        return {
          code: error.code,
          message: error.message || 'Неизвестная ошибка при получении местоположения',
          type: 'POSITION_UNAVAILABLE'
        };
    }
  }
  private isPositionFresh(position: UserPosition): boolean {
    const now = Date.now();
    return (now - position.timestamp) < this.CACHE_DURATION_MS;
  }
}
