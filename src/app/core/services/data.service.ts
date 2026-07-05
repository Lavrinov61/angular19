import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID, TransferState, makeStateKey } from '@angular/core';

// Интерфейсы для данных
export interface Photographer {
  id: string;
  name: string;
  email: string;
  phone: string;
  bio: string;
  location: string;
  experience: number;
  specializations: string[];
  portfolio: string[];
  availability: boolean;
  rating: number;
  reviewsCount: number;
  priceRange: {
    min: number;
    max: number;
  };
  services: string[];
  equipment: string[];
  socialMedia: {
    instagram?: string;
    facebook?: string;
    website?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface Gallery {
  id: string;
  title: string;
  description: string;
  category: string;
  images: string[];
  photographerId: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  duration: number;
  photographerId: string;
  isActive: boolean;
  requirements: string[];
  deliverables: string[];
  createdAt: Date;
  updatedAt: Date;
}

// State keys для SSR
const PHOTOGRAPHERS_KEY = makeStateKey<Photographer[]>('photographers');
const GALLERIES_KEY = makeStateKey<Gallery[]>('galleries');
const SERVICES_KEY = makeStateKey<Service[]>('services');

@Injectable({
  providedIn: 'root'
})
export class ServerDataService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly transferState = inject(TransferState);
  private isServer: boolean;
  private baseUrl = '/api'; // API endpoints для данных

  constructor() {
    this.isServer = isPlatformServer(this.platformId);
  }

  // Получение фотографов
  getPhotographers(): Observable<Photographer[]> {
    // Проверяем, есть ли данные в TransferState (SSR)
    const photographers = this.transferState.get(PHOTOGRAPHERS_KEY, null);
    if (photographers) {
      this.transferState.remove(PHOTOGRAPHERS_KEY);
      return of(photographers);
    }

    // Получаем данные через HTTP API
    return this.http.get<Photographer[]>(`${this.baseUrl}/photographers`).pipe(
      map(data => {
        if (this.isServer) {
          // На сервере сохраняем данные в TransferState
          this.transferState.set(PHOTOGRAPHERS_KEY, data);
        }
        return data;
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  // Получение фотографа по ID
  getPhotographer(id: string): Observable<Photographer | null> {
    return this.http.get<Photographer>(`${this.baseUrl}/photograph/${id}`).pipe(
      catchError(() => {
        return of(null);
      })
    );
  }

  // Получение галерей
  getGalleries(): Observable<Gallery[]> {
    const galleries = this.transferState.get(GALLERIES_KEY, null);
    if (galleries) {
      this.transferState.remove(GALLERIES_KEY);
      return of(galleries);
    }

    return this.http.get<Gallery[]>(`${this.baseUrl}/galleries`).pipe(
      map(data => {
        if (this.isServer) {
          this.transferState.set(GALLERIES_KEY, data);
        }
        return data;
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  // Получение галерей фотографа
  getPhotographerGalleries(photographerId: string): Observable<Gallery[]> {
    return this.http.get<Gallery[]>(`${this.baseUrl}/photograph/${photographerId}/galleries`).pipe(
      catchError(() => {
        return of([]);
      })
    );
  }

  // Получение услуг
  getServices(): Observable<Service[]> {
    const services = this.transferState.get(SERVICES_KEY, null);
    if (services) {
      this.transferState.remove(SERVICES_KEY);
      return of(services);
    }

    return this.http.get<Service[]>(`${this.baseUrl}/services`).pipe(
      map(data => {
        if (this.isServer) {
          this.transferState.set(SERVICES_KEY, data);
        }
        return data;
      }),
      catchError(() => {
        return of([]);
      })
    );
  }

  // Получение услуг фотографа
  getPhotographerServices(photographerId: string): Observable<Service[]> {
    return this.http.get<Service[]>(`${this.baseUrl}/photograph/${photographerId}/services`).pipe(
      catchError(() => {
        return of([]);
      })
    );
  }

  // Поиск фотографов
  searchPhotographers(query: string): Observable<Photographer[]> {
    return this.http.get<Photographer[]>(`${this.baseUrl}/photograph/search?q=${encodeURIComponent(query)}`).pipe(
      catchError(() => {
        return of([]);
      })
    );
  }

  // Фильтрация фотографов
  filterPhotographers(filters: Record<string, unknown>): Observable<Photographer[]> {
    const params = new URLSearchParams();
    Object.keys(filters).forEach(key => {
      if (filters[key] !== null && filters[key] !== undefined) {
        params.append(key, filters[key].toString());
      }
    });

    return this.http.get<Photographer[]>(`${this.baseUrl}/photograph/filter?${params.toString()}`).pipe(
      catchError(() => {
        return of([]);
      })
    );
  }
}
