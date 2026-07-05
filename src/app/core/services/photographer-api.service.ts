import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService, ApiResponse, PaginationParams, PaginatedResponse } from './api.service';

export interface Photographer {
  id: string;
  userId: string;
  username?: string;  // Добавлено для совместимости с API
  name: string;
  display_name?: string;  // Добавлено для совместимости с API
  user_id?: string;  // Добавлено для совместимости с API
  email: string;
  phone?: string;
  bio?: string;
  location: {
    city: string;
    address?: string;
    studioName?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  experience: number; // в годах
  specializations: string[];
  portfolio: {
    id: string;
    title: string;
    description?: string;
    imageUrl: string;
    category: string;
  }[];
  availability: {
    isActive: boolean;
    workingHours: Record<string, { // день недели
        start: string;
        end: string;
        isAvailable: boolean;
      }>;
    timeOff: {
      startDate: string;
      endDate: string;
      reason?: string;
    }[];
  };
  rating: {
    average: number;
    totalReviews: number;
  };
  pricing: {
    basePrice: number;
    currency: string;
    pricePerHour?: number;
    packages?: {
      id: string;
      name: string;
      description: string;
      price: number;
      duration: number;
      features: string[];
    }[];
  };
  services: string[];
  equipment: string[];
  socialMedia: {
    instagram?: string;
    facebook?: string;
    website?: string;
    behance?: string;
  };
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePhotographerRequest {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  bio?: string;
  location: {
    city: string;
    address?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  experience: number;
  specializations: string[];
  services: string[];
  equipment?: string[];
  socialMedia?: {
    instagram?: string;
    facebook?: string;
    website?: string;
    behance?: string;
  };
  pricing: {
    basePrice: number;
    currency: string;
    pricePerHour?: number;
  };
}

export interface UpdatePhotographerRequest {
  name?: string;
  phone?: string;
  bio?: string;
  location?: {
    city: string;
    address?: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  experience?: number;
  specializations?: string[];
  services?: string[];
  equipment?: string[];
  socialMedia?: {
    instagram?: string;
    facebook?: string;
    website?: string;
    behance?: string;
  };
  pricing?: {
    basePrice: number;
    currency: string;
    pricePerHour?: number;
  };
}

export interface PhotographerFilters {
  city?: string;
  specializations?: string[];
  services?: string[];
  minRating?: number;
  maxPrice?: number;
  minPrice?: number;
  availability?: boolean;
  verified?: boolean;
  search?: string;
  [key: string]: unknown;
}

// Интерфейсы для управления услугами фотографа в личном кабинете
export interface ServiceForManagement {
  id: string;
  name: string;
  description?: string;
  category_name: string;
  base_studio_price: number;
  base_location_price: number;
  is_enabled: boolean;
  custom_studio_price?: number;
  custom_location_price?: number;
  created_at: string;
  updated_at: string;
}

export interface PhotographerServicesManagementResponse {
  services: ServiceForManagement[];
  total: number;
}

export interface UpdateServicesRequest {
  services: {
    serviceId: string;
    studioPrice?: number | null;
    locationPrice?: number | null;
  }[];
}

/**
 * Photographer API Service - современный сервис для работы с фотографами
 * Заменяет Firebase Photographer API на REST API
 */
@Injectable({
  providedIn: 'root'
})
export class PhotographerApiService {
  private apiService = inject(ApiService);
  
  // Signals для состояния
  private photographersSignal = signal<Photographer[]>([]);
  private currentPhotographerSignal = signal<Photographer | null>(null);
  
  // Readonly signals
  public readonly photographers = this.photographersSignal.asReadonly();
  public readonly currentPhotographer = this.currentPhotographerSignal.asReadonly();
  public readonly isLoading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);
  
  // Computed signals для удобства
  public readonly availablePhotographers = computed(() => 
    this.photographers().filter(photographer => photographer.availability.isActive)
  );
  
  public readonly verifiedPhotographers = computed(() => 
    this.photographers().filter(photographer => photographer.verified)
  );
  
  public readonly topRatedPhotographers = computed(() => 
    this.photographers()
      .filter(photographer => photographer.rating.average >= 4.5)
      .sort((a, b) => b.rating.average - a.rating.average)
  );
  
  /**
   * Получить всех фотографов с пагинацией через REST API
   */
  getPhotographers(params?: PaginationParams & PhotographerFilters): Observable<PaginatedResponse<Photographer>> {
    return this.apiService.getPaginated<Photographer>('/photographers', params).pipe(
      map(response => {
        if (response.success && response.data) {
          this.photographersSignal.set(response.data);
        }
        return response;
      })
    );
  }
  
  /**
   * Получить фотографа по ID через REST API
   */
  getPhotographerById(id: string): Observable<ApiResponse<Photographer>> {
    return this.apiService.get<Photographer>(`/photographers/${id}`).pipe(
      map(response => {
        if (response.success && response.data) {
          this.currentPhotographerSignal.set(response.data);
        }
        return response;
      })
    );
  }
  
  /**
   * Создать нового фотографа через REST API
   * TODO: Реализовать endpoint POST /photographers в backend
   */
  createPhotographer(photographerData: CreatePhotographerRequest): Observable<ApiResponse<Photographer>> {
    return this.apiService.post<Photographer>('/photographers', photographerData);
  }
  
  /**
   * Обновить фотографа (для админов) через REST API
   * TODO: Реализовать endpoint PUT /photographers/:id в backend
   */
  updatePhotographer(id: string, photographerData: UpdatePhotographerRequest): Observable<ApiResponse<Photographer>> {
    return this.apiService.put<Photographer>(`/photographers/${id}`, photographerData);
  }

  /**
   * Обновить профиль текущего авторизованного фотографа через REST API
   */
  updateCurrentPhotographerProfile(photographerData: Partial<UpdatePhotographerRequest>): Observable<ApiResponse<Photographer>> {
    return this.apiService.put<Photographer>('/photographers/me', photographerData).pipe(
      map(response => {
        if (response.success && response.data) {
          this.updateLocalPhotographer(response.data.id, response.data);
          // Also update the main signal for the current photographer
          if (this.currentPhotographerSignal()?.id === response.data.id) {
            this.currentPhotographerSignal.set(response.data);
          }
        }
        return response;
      })
    );
  }
  
  /**
   * Частичное обновление фотографа через REST API
   * TODO: Реализовать endpoint PATCH /photographers/:id в backend
   */
  patchPhotographer(id: string, photographerData: Partial<UpdatePhotographerRequest>): Observable<ApiResponse<Photographer>> {
    return this.apiService.patch<Photographer>(`/photographers/${id}`, photographerData);
  }
  
  /**
   * Удалить фотографа через REST API
   * TODO: Реализовать endpoint DELETE /photographers/:id в backend
   */
  deletePhotographer(id: string): Observable<ApiResponse<void>> {
    return this.apiService.delete(`/photographers/${id}`);
  }
  
  /**
   * Поиск фотографов через REST API (использует параметр search в getPhotographers)
   */
  searchPhotographers(query: string, params?: PaginationParams): Observable<PaginatedResponse<Photographer>> {
    return this.getPhotographers({ ...params, search: query });
  }
  
  /**
   * Получить фотографов по городу через REST API (использует параметр city в getPhotographers)
   */
  getPhotographersByCity(city: string, params?: PaginationParams): Observable<PaginatedResponse<Photographer>> {
    return this.getPhotographers({ ...params, city });
  }
  
  /**
   * Получить фотографов по специализации через REST API (использует параметр specializations в getPhotographers)
   */
  getPhotographersBySpecialization(specialization: string, params?: PaginationParams): Observable<PaginatedResponse<Photographer>> {
    return this.getPhotographers({ ...params, specializations: [specialization] });
  }

  /**
   * Получить фотографов по категории услуг через REST API
   * Конвертирует ServiceCategory в строку специализации для фильтрации
   */
  getPhotographersByCategory(category: string, params?: PaginationParams): Observable<PaginatedResponse<Photographer>> {
    return this.getPhotographers({ ...params, specializations: [category] });
  }
  
  /**
   * Получить портфолио фотографа через REST API
   * TODO: Реализовать endpoint /photographers/:id/portfolio в backend
   */
  getPhotographerPortfolio(id: string): Observable<ApiResponse<Photographer['portfolio']>> {
    // Пока возвращаем пустой массив, endpoint еще не реализован
    return this.apiService.get<Photographer['portfolio']>(`/photographers/${id}/portfolio`).pipe(
      map(response => response.success && response.data ? response : { success: false, error: 'Endpoint not implemented' })
    );
  }
  
  /**
   * Добавить работу в портфолио через REST API
   * TODO: Реализовать endpoint POST /photographers/:id/portfolio в backend
   */
  addPortfolioItem(id: string, portfolioItem: {
    title: string;
    description?: string;
    imageUrl: string;
    category: string;
  }): Observable<ApiResponse<Photographer['portfolio'][0]>> {
    return this.apiService.post<Photographer['portfolio'][0]>(`/photographers/${id}/portfolio`, portfolioItem);
  }
  
  /**
   * Удалить работу из портфолио через REST API
   * TODO: Реализовать endpoint DELETE /photographers/:id/portfolio/:itemId в backend
   */
  removePortfolioItem(photographerId: string, portfolioItemId: string): Observable<ApiResponse<void>> {
    return this.apiService.delete(`/photographers/${photographerId}/portfolio/${portfolioItemId}`);
  }
  
  /**
   * Получить расписание фотографа через REST API
   * TODO: Реализовать endpoint /photographers/:id/schedule в backend
   */
  getPhotographerSchedule(id: string): Observable<ApiResponse<Photographer['availability']>> {
    return this.apiService.get<Photographer['availability']>(`/photographers/${id}/schedule`);
  }
  
  /**
   * Обновить расписание фотографа через REST API
   * TODO: Реализовать endpoint PUT /photographers/:id/schedule в backend
   */
  updatePhotographerSchedule(id: string, schedule: Photographer['availability']): Observable<ApiResponse<Photographer['availability']>> {
    return this.apiService.put<Photographer['availability']>(`/photographers/${id}/schedule`, schedule);
  }
  
  /**
   * Получить отзывы о фотографе через REST API
   */
  getPhotographerReviews(id: string, params?: PaginationParams): Observable<PaginatedResponse<{
    id: string;
    clientId: string;
    rating: number;
    comment: string;
    createdAt: string;
    client: {
      name: string;
      avatar?: string;
    };
  }>> {
    return this.apiService.getPaginated(`/photographers/${id}/reviews`, params);
  }
  
  /**
   * Добавить отзыв о фотографе через REST API
   */
  addPhotographerReview(id: string, review: {
    rating: number;
    comment: string;
  }): Observable<ApiResponse<void>> {
    return this.apiService.post(`/photographers/${id}/reviews`, {
      rating: review.rating,
      comment: review.comment
    });
  }
  /**
   * Получить статистику текущего фотографа через REST API
   */
  getPhotographerStats(): Observable<ApiResponse<{
    totalBookings: number;
    completedBookings: number;
    confirmedBookings: number;
    cancelledBookings: number;
    monthlyRevenue: number;
    previousMonthRevenue: number;
    revenueChange: number;
    upcomingBookings: Record<string, unknown>[];
  }>> {
    return this.apiService.get('/photographers/me/stats');
  }
  
  /**
   * Верифицировать фотографа через REST API (только для админов)
   * TODO: Реализовать endpoint POST /photographers/:id/verify в backend
   */
  verifyPhotographer(id: string): Observable<ApiResponse<Photographer>> {
    return this.apiService.post<Photographer>(`/photographers/${id}/verify`, {});
  }
  
  /**
   * Получить данные текущего авторизованного фотографа через REST API
   */
  getCurrentPhotographer(): Observable<ApiResponse<Photographer>> {
    return this.apiService.get<Photographer>('/photographers/me').pipe(
      map(response => {
        if (response.success && response.data) {
          this.currentPhotographerSignal.set(response.data);
        }
        return response;
      })
    );
  }

  /**
   * Получить расписание текущего фотографа через REST API
   */
  getCurrentPhotographerSchedule(): Observable<ApiResponse<Photographer['availability']>> {
    return this.apiService.get<Photographer['availability']>('/photographers/me/schedule');
  }
  
  /**
   * Обновить расписание текущего фотографа через REST API
   */
  updateCurrentPhotographerSchedule(schedule: Photographer['availability']): Observable<ApiResponse<Photographer['availability']>> {
    return this.apiService.put<Photographer['availability']>('/photographers/me/schedule', schedule);
  }

  /**
   * Установить фотографов в локальное состояние
   */
  setPhotographers(photographers: Photographer[]): void {
    this.photographersSignal.set(photographers);
  }
  
  /**
   * Добавить фотографа в локальное состояние
   */
  addPhotographer(photographer: Photographer): void {
    this.photographersSignal.update(photographers => [...photographers, photographer]);
  }
  
  /**
   * Обновить фотографа в локальном состоянии
   */
  updateLocalPhotographer(id: string, photographerData: Partial<Photographer>): void {
    this.photographersSignal.update(photographers => 
      photographers.map(photographer => 
        photographer.id === id ? { ...photographer, ...photographerData } : photographer
      )
    );
  }
  
  /**
   * Удалить фотографа из локального состояния
   */
  removeLocalPhotographer(id: string): void {
    this.photographersSignal.update(photographers => photographers.filter(photographer => photographer.id !== id));
  }
    /**
   * Очистить локальное состояние
   */  clearPhotographers(): void {
    this.photographersSignal.set([]);
    this.currentPhotographerSignal.set(null);
  }

  // ========== МЕТОДЫ ДЛЯ УПРАВЛЕНИЯ УСЛУГАМИ ФОТОГРАФА ==========

  /**
   * Получить услуги фотографа для управления через REST API
   */
  getPhotographerServicesForManagement(): Observable<ApiResponse<Record<string, unknown>>> {
    return this.apiService.get<Record<string, unknown>>('/photographers/me/services');
  }

  /**
   * Обновить услуги фотографа через REST API
   */
  updatePhotographerServices(updateRequest: UpdateServicesRequest): Observable<void> {
    return this.apiService.put('/photographers/me/services', updateRequest).pipe(
      map(response => {
        if (!response.success) {
          throw new Error(response.error || 'Failed to update services');
        }
        return void 0;
      })
    );
  }
}
