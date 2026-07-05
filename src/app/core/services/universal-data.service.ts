import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { LoggerService } from './logger.service';

// Import types from proper locations
import type { SharedPhotographer } from '../../shared/models/photographer.shared.model';
import type { ServiceDoc } from '../data/services.data';

// Define interfaces for server data that might not have client equivalents
export interface Gallery {
  id: string;
  title: string;
  description: string;
  photographerId: string;
  category: string;
  photos: string[];
  tags: string[];
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PhotoService {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: number;
  category: string;
  isActive: boolean;
  image: string;
  photographerTypes: string[];
  equipment: string[];
  deliveryTime: number;
  maxPhotos: number;
  includes: string[];
}

/**
 * Universal Data Service
 * 
 * Provides data fetching capabilities for both server and client environments:
 * - Server: Uses internal API endpoints to fetch data directly 
 * - Client: Uses HTTP requests to API endpoints
 * 
 * This architecture ensures complete separation between server and client code,
 * preventing Node.js modules from being bundled in the client.
 */
@Injectable({
  providedIn: 'root'
})
export class UniversalDataService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  private readonly isServer = isPlatformServer(this.platformId);
  /**
   * Get all photographers
   */
  getPhotographers(): Observable<SharedPhotographer[]> {
    const apiEndpoint = this.isServer ? '/api/photographers-data' : '/api/photographers';
    
    return this.http.get<SharedPhotographer[]>(apiEndpoint).pipe(
      tap(photographers => {
        if (this.isServer) {
          this.log.debug(`[Server] Fetched ${photographers.length} photographers`);
        }
      }),
      catchError(error => {
        this.log.error(`Error fetching photographers from ${apiEndpoint}:`, error);
        return of([]);
      })
    );
  }

  /**
   * Get photographer by ID
   */
  getPhotographerById(id: string): Observable<SharedPhotographer | null> {
    const apiEndpoint = `/api/photograph/${id}`;
    
    return this.http.get<SharedPhotographer>(apiEndpoint).pipe(
      tap(photographer => {
        if (this.isServer) {
          this.log.debug(`[Server] Fetched photographer: ${photographer.name}`);
        }
      }),
      catchError(error => {
        this.log.error(`Error fetching photographer ${id}:`, error);
        return of(null);
      })
    );
  }

  /**
   * Get all galleries
   */
  getGalleries(): Observable<Gallery[]> {
    const apiEndpoint = this.isServer ? '/api/galleries-data' : '/api/galleries';
    
    return this.http.get<Gallery[]>(apiEndpoint).pipe(
      tap(galleries => {
        if (this.isServer) {
          this.log.debug(`[Server] Fetched ${galleries.length} galleries`);
        }
      }),
      catchError(error => {
        this.log.error(`Error fetching galleries from ${apiEndpoint}:`, error);
        return of([]);
      })
    );
  }

  /**
   * Get gallery by ID
   */
  getGalleryById(id: string): Observable<Gallery | null> {
    const apiEndpoint = `/api/galleries/${id}`;
    
    return this.http.get<Gallery>(apiEndpoint).pipe(
      tap(gallery => {
        if (this.isServer) {
          this.log.debug(`[Server] Fetched gallery: ${gallery.title}`);
        }
      }),
      catchError(error => {
        this.log.error(`Error fetching gallery ${id}:`, error);
        return of(null);
      })
    );
  }

  /**
   * Get all photo services
   */
  getPhotoServices(): Observable<PhotoService[]> {
    const apiEndpoint = this.isServer ? '/api/services-data' : '/api/services';
    
    return this.http.get<PhotoService[]>(apiEndpoint).pipe(
      tap(services => {
        if (this.isServer) {
          this.log.debug(`[Server] Fetched ${services.length} photo services`);
        }
      }),
      catchError(error => {
        this.log.error(`Error fetching photo services from ${apiEndpoint}:`, error);
        return of([]);
      })
    );
  }

  /**
   * Get photo service by ID
   */
  getPhotoServiceById(id: string): Observable<PhotoService | null> {
    const apiEndpoint = `/api/services/${id}`;
    
    return this.http.get<PhotoService>(apiEndpoint).pipe(
      tap(service => {
        if (this.isServer) {
          this.log.debug(`[Server] Fetched photo service: ${service.name}`);
        }
      }),
      catchError(error => {
        this.log.error(`Error fetching photo service ${id}:`, error);
        return of(null);
      })
    );
  }
  /**
   * Server-side method to check if Firebase is available
   * Only used during SSR for debugging
   */
  private isFirebaseAvailable(): boolean {
    return this.isServer && (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production');
  }
}

// Re-export types for convenience
export type { SharedPhotographer, ServiceDoc };
