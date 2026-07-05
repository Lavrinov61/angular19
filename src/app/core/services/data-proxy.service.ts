/**
 * DATA PROXY SERVICE - Universal Server/Client Data Access
 * 
 * This service provides a clean interface for data access that works
 * on both server and client without importing server-only modules.
 * 
 * ✅ NO direct imports of:
 * - firebase-admin
 * - @google-cloud/*
 * - Node.js built-ins
 * 
 * ✅ Uses:
 * - HTTP API calls on client
 * - Server dynamic imports on server (via serverData API)
 */
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformServer, isPlatformBrowser } from '@angular/common';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { LoggerService } from './logger.service';

export interface Photographer {
  id: string;
  name: string;
  specialization?: string;
  experience?: number;
  portfolio?: string[];
  about?: string;
  photoUrl?: string;
  rating?: number;
  contact?: {
    email?: string;
    phone?: string;
    social?: Record<string, string>;
  };
  price?: number;
  availability?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Service {
  id: string;
  title: string;
  description?: string;
  price?: number;
  duration?: number;
  category?: string;
  photoUrl?: string;
  details?: string[];
  [key: string]: unknown;
}

export interface Gallery {
  id: string;
  title: string;
  description?: string;
  photos?: string[];
  category?: string;
  photographerId?: string;
  date?: unknown;
  tags?: string[];
  [key: string]: unknown;
}

/**
 * Universal Data Proxy Service
 * 
 * Automatically routes data requests:
 * - Server: Direct server module access via dynamic imports
 * - Client: HTTP API calls
 */
@Injectable({
  providedIn: 'root'
})
export class DataProxyService {
  private platformId = inject(PLATFORM_ID);
  private http = inject(HttpClient);
  private log = inject(LoggerService);

  private isServer = isPlatformServer(this.platformId);
  private isBrowser = isPlatformBrowser(this.platformId);

  /**
   * Universal method to get photographers data
   */
  getPhotographers(): Observable<Photographer[]> {
    if (this.isServer) {
      return this.getServerData<Photographer[]>('photographers');
    } else {
      return this.http.get<Photographer[]>(`/api/photographers`).pipe(
        catchError(error => {
          this.log.error('Failed to fetch photographers:', error);
          return of([]);
        })
      );
    }
  }

  /**
   * Universal method to get photographer by ID
   */
  getPhotographer(id: string): Observable<Photographer | null> {
    if (this.isServer) {
      return this.getServerData<Photographer | null>('photographer', { id });
    } else {
      return this.http.get<Photographer>(`/api/public/photographers/${id}`).pipe(
        catchError(error => {
          this.log.error(`Failed to fetch photographer ${id}:`, error);
          return of(null);
        })
      );
    }
  }

  /**
   * Universal method to get services data
   */
  getServices(): Observable<Service[]> {
    if (this.isServer) {
      return this.getServerData<Service[]>('services');
    } else {
      return this.http.get<Service[]>(`/api/services`).pipe(
        catchError(error => {
          this.log.error('Failed to fetch services:', error);
          return of([]);
        })
      );
    }
  }

  /**
   * Universal method to get service by ID
   */
  getService(id: string): Observable<Service | null> {
    if (this.isServer) {
      return this.getServerData<Service | null>('service', { id });
    } else {
      return this.http.get<Service>(`/api/services/${id}`).pipe(
        catchError(error => {
          this.log.error(`Failed to fetch service ${id}:`, error);
          return of(null);
        })
      );
    }
  }

  /**
   * Universal method to get galleries data
   */
  getGalleries(): Observable<Gallery[]> {
    if (this.isServer) {
      return this.getServerData<Gallery[]>('galleries');
    } else {
      return this.http.get<Gallery[]>(`/api/galleries`).pipe(
        catchError(error => {
          this.log.error('Failed to fetch galleries:', error);
          return of([]);
        })
      );
    }
  }

  /**
   * Universal method to get gallery by ID
   */
  getGallery(id: string): Observable<Gallery | null> {
    if (this.isServer) {
      return this.getServerData<Gallery | null>('gallery', { id });
    } else {
      return this.http.get<Gallery>(`/api/galleries/${id}`).pipe(
        catchError(error => {
          this.log.error(`Failed to fetch gallery ${id}:`, error);
          return of(null);
        })
      );
    }
  }

  /**
   * Universal method to search data
   */
  searchData(query: string, type?: string): Observable<unknown[]> {
    if (this.isServer) {
      return this.getServerData<unknown[]>('search', { query, type });
    } else {
      const params = type ? `?type=${type}` : '';
      return this.http.get<unknown[]>(`/api/search/${encodeURIComponent(query)}${params}`).pipe(
        catchError(error => {
          this.log.error('Failed to search:', error);
          return of([]);
        })
      );
    }
  }

  /**
   * SERVER-ONLY: Direct access to isolated server data functions
   * Uses dynamic imports to avoid bundling server modules in client
   */
  private getServerData<T>(operation: string, params: Record<string, unknown> = {}): Observable<T> {
    if (!this.isServer) {
      return throwError(() => new Error('Server data access only available on server'));
    }

    return from(this.executeServerOperation(operation, params) as Promise<T>).pipe(
      catchError(error => {
        this.log.error(`Server operation ${operation} failed:`, error);
        return of(null as T);
      })
    );  }
  
  /**
   * Execute server operation - заглушка, данные загружаются через AngularFire
   */
  private async executeServerOperation(operation: string, _params: Record<string, unknown> = {}): Promise<unknown> {
    this.log.debug(`Заглушка для server operation: ${operation}. Данные загружаются через AngularFire.`);
    
    // Возвращаем пустые значения для всех операций
    // Реальные данные загружаются через AngularFire в соответствующих сервисах
    switch (operation) {
      case 'photographers':
      case 'services':
      case 'galleries':
      case 'search':
        return [];
      default:
        return null;
    }
  }
}
