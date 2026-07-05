import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Location } from '@angular/common';
import { Observable, throwError, of } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { GeolocationService, UserPosition } from './geolocation.service';
import { GoalTrackingService } from './goal-tracking.service';
import { ADDRESSES } from '../data/address.data';

export interface RouteRequest {
  destination: string;
  destinationName?: string;
}

export interface RouteResult {
  url: string;
  hasUserLocation: boolean;
  userPosition?: UserPosition;
  destination: string;
}

@Injectable({
  providedIn: 'root'
})
export class RouteService {
  private geolocationService = inject(GeolocationService);
  private goalTrackingService = inject(GoalTrackingService, { optional: true });
  private location = inject(Location);
  private platformId = inject(PLATFORM_ID);

  // Default destination from address.data.ts - используем первый адрес из массива
  private readonly DEFAULT_DESTINATION = ADDRESSES.length > 0 
    ? ADDRESSES[0].address 
    : 'магнус фото, переулок Соборный 21, Ростов-на-Дону';
  /**
   * Request route to destination with optional geolocation
   */
  requestRoute(destination?: string): Observable<RouteResult> {
    const targetDestination = destination || this.DEFAULT_DESTINATION;
    
    this.goalTrackingService?.trackCustomEvent('route_request_started', {
      destination: targetDestination,
    });
    
    return this.geolocationService.getCurrentPosition().pipe(
      switchMap((position: UserPosition) => {
        // Success - we have user location
        this.goalTrackingService?.trackLocationPermission(true);
        this.goalTrackingService?.trackRouteRequest(true);
        
        const url = this.geolocationService.getDirectionsUrl(targetDestination, position);
        
        return of({
          url,
          hasUserLocation: true,
          userPosition: position,
          destination: targetDestination
        });
      }),      catchError(() => {
        // Failed to get location - provide fallback
        this.goalTrackingService?.trackLocationPermission(false);
        this.goalTrackingService?.trackRouteRequest(false);

        const url = this.geolocationService.getDirectionsUrl(targetDestination);

        return of({
          url,
          hasUserLocation: false,
          destination: targetDestination
        });
      })
    );
  }

  /**
   * Open route in new tab/window
   */  openRoute(destination?: string): Observable<RouteResult> {
    return this.requestRoute(destination).pipe(
      switchMap((result: RouteResult) => {        // Open the URL only in browser
        if (isPlatformBrowser(this.platformId)) {
          // Для внешних URL (Google Maps) мы открываем их в новой вкладке
          // Нормализуем URL с помощью Location
          const normalizedUrl = this.location.normalize(result.url);
          window.open(normalizedUrl, '_blank', 'noopener,noreferrer');
        }
        
        this.goalTrackingService?.trackCustomEvent('route_opened', {
          destination: result.destination,
          has_user_location: result.hasUserLocation,
          url: result.url,
        });
        
        return of(result);
      }),
      catchError((error) => {
        this.goalTrackingService?.trackCustomEvent('route_error', {
          destination: destination || this.DEFAULT_DESTINATION,
          error: (error as Error).message || 'Unknown error',
        });
        
        return throwError(() => error);
      })
    );
  }

  /**
   * Get route URL without opening it
   */
  getRouteUrl(destination?: string): Observable<string> {
    return this.requestRoute(destination).pipe(
      switchMap((result: RouteResult) => of(result.url))
    );
  }

  /**
   * Check if geolocation is available and get permission status
   */
  checkGeolocationStatus(): Observable<{
    isSupported: boolean;
    hasPermission: boolean | null;
    isLoading: boolean;
  }> {
    return this.geolocationService.state$.pipe(
      switchMap((state) => of({
        isSupported: state.error?.type !== 'NOT_SUPPORTED',
        hasPermission: state.hasPermission,
        isLoading: state.isLoading
      }))
    );
  }
  /**
   * Preload user location (for better UX)
   */
  preloadLocation(): void {
    this.geolocationService.getCurrentPosition().subscribe({
      next: () => {
        this.goalTrackingService?.trackCustomEvent('location_preloaded');
      },
      error: () => {
        // Silent fail for preload
      }
    });
  }

  /**
   * Clear cached location data
   */
  clearLocationCache(): void {
    this.geolocationService.clearCache();
    this.goalTrackingService?.trackCustomEvent('location_cache_cleared');
  }
}
