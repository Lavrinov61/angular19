import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable } from 'rxjs';
import { tap, map } from 'rxjs/operators';
import { ApiService, ApiResponse, PaginatedResponse, PaginationParams } from './api.service';
import {
  PhotoLocation,
  LocationCategoryType as LocationCategory,
  LocationFilter,
  CreateLocationRequest
} from '../models/photo-location.model';

export interface LocationReview {
  id: string;
  locationId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  rating: number;
  comment: string;
  images?: string[];
  createdAt: string;
  updatedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class PhotoLocationsApiService {
  private apiService = inject(ApiService);

  // Сигналы состояния
  private locationsSignal = signal<PhotoLocation[]>([]);
  private popularLocationsSignal = signal<PhotoLocation[]>([]);
  private featuredLocationsSignal = signal<PhotoLocation[]>([]);
  private filtersSignal = signal<Partial<LocationFilter>>({});

  // Readonly signals
  public readonly locations = this.locationsSignal.asReadonly();
  public readonly popularLocations = this.popularLocationsSignal.asReadonly();
  public readonly featuredLocations = this.featuredLocationsSignal.asReadonly();
  public readonly filters = this.filtersSignal.asReadonly();
  public readonly isLoading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);

  // Computed свойства
  public readonly hasLocations = computed(() => this.locations().length > 0);
  public readonly activeLocations = computed(() => 
    this.locations().filter(location => location.isActive)
  );
  public readonly locationsByCategory = computed(() => {
    const locations = this.locations();
    const categories = {} as Record<LocationCategory, PhotoLocation[]>;
    
    locations.forEach(location => {
      if (!categories[location.category]) {
        categories[location.category] = [];
      }
      categories[location.category].push(location);
    });
    
    return categories;
  });

  /**
   * Получить все локации с фильтрацией через REST API
   */
  getLocations(params?: PaginationParams & LocationFilter): Observable<PaginatedResponse<PhotoLocation>> {
    return this.apiService.getPaginated<PhotoLocation>('/studios', params).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.locationsSignal.set(response.data);
        }
      })
    );
  }

  /**
   * Получить простой список локаций (без пагинации) через REST API
   */
  getAllLocations(filter?: Partial<LocationFilter>): Observable<ApiResponse<PhotoLocation[]>> {
    return this.apiService.get<PhotoLocation[]>('/studios', filter).pipe(
      map(response => {
        if (response.success && response.data) {
          this.locationsSignal.set(response.data);
        }
        return response;
      })
    );
  }

  /**
   * Получить популярные локации через REST API
   */
  getPopularLocations(limit = 6): Observable<ApiResponse<PhotoLocation[]>> {
    return this.apiService.get<PhotoLocation[]>('/studios', { isPopular: true, limit }).pipe(
      map(response => {
        if (response.success && response.data) {
          this.popularLocationsSignal.set(response.data);
        }
        return response;
      })
    );
  }

  /**
   * Получить рекомендуемые локации через REST API
   */
  getFeaturedLocations(limit = 6): Observable<ApiResponse<PhotoLocation[]>> {
    return this.apiService.get<PhotoLocation[]>('/studios', { isFeatured: true, limit }).pipe(
      map(response => {
        if (response.success && response.data) {
          this.featuredLocationsSignal.set(response.data);
        }
        return response;
      })
    );
  }

  /**
   * Получить локацию по ID через REST API
   */
  getLocationById(id: string): Observable<ApiResponse<PhotoLocation>> {
    return this.apiService.get<PhotoLocation>(`/studios/${id}`);
  }

  /**
   * Создать новую локацию через REST API
   */
  createLocation(locationData: CreateLocationRequest): Observable<ApiResponse<unknown>> {
    return this.apiService.post('/studios', locationData);
  }

  /**
   * Обновить локацию через REST API
   */
  updateLocation(id: string, locationData: Partial<CreateLocationRequest>): Observable<ApiResponse<unknown>> {
    return this.apiService.put(`/studios/${id}`, locationData);
  }

  /**
   * Удалить локацию через REST API
   */
  deleteLocation(id: string): Observable<ApiResponse<void>> {
    return this.apiService.delete(`/studios/${id}`);
  }

  /**
   * Поиск локаций через REST API
   */
  searchLocations(query: string, filter?: Partial<LocationFilter>): Observable<ApiResponse<PhotoLocation[]>> {
    return this.apiService.get<PhotoLocation[]>('/studios', { search: query, ...filter }).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.locationsSignal.set(response.data);
        }
      })
    );
  }

  /**
   * Получить отфильтрованные локации
   */
  getFilteredLocations(filter: Partial<LocationFilter>): Observable<ApiResponse<PhotoLocation[]>> {
    // Re-using the getLocations which now calls listStudios
    return this.getLocations(filter).pipe(map(response => ({ success: response.success, data: response.data })));
  }

  /**
   * Получить локации по району
   */
  getLocationsByDistrict(district: string): Observable<ApiResponse<PhotoLocation[]>> {
    return this.getLocations({ districts: [district] });
  }

  /**
   * Получить локации по категории
   */
  getLocationsByCategory(category: LocationCategory): Observable<ApiResponse<PhotoLocation[]>> {
    return this.getLocations({ categories: [category] });
  }

  /**
   * Получить отзывы о локации через REST API
   */
  getLocationReviews(locationId: string, params?: PaginationParams): Observable<PaginatedResponse<LocationReview>> {
    return this.apiService.getPaginated<LocationReview>(`/studios/${locationId}/reviews`, params);
  }

  /**
   * Добавить отзыв о локации через REST API
   */
  addLocationReview(locationId: string, review: {
    rating: number;
    comment: string;
    images?: string[];
  }): Observable<ApiResponse<LocationReview>> {
    return this.apiService.post(`/studios/${locationId}/reviews`, review);
  }

  /**
   * Получить статистику локаций через REST API
   */
  getLocationStats(): Observable<ApiResponse<{
    total: number;
    byCategory: Record<LocationCategory, number>;
    byDistrict: Record<string, number>;
    popular: number;
    featured: number;
    averageRating: number;
  }>> {
    return this.apiService.get('/studios/stats');
  }

  /**
   * Установить фильтры
   */
  setFilters(filters: Partial<LocationFilter>): void {
    this.filtersSignal.set(filters);
  }

  /**
   * Очистить фильтры
   */
  clearFilters(): void {
    this.filtersSignal.set({});
  }

  /**
   * Очистить состояние
   */
  clearState(): void {
    this.locationsSignal.set([]);
    this.popularLocationsSignal.set([]);
    this.featuredLocationsSignal.set([]);
    this.filtersSignal.set({});
  }

  /**
   * Получить локации поблизости (по координатам) через REST API
   */
  getNearbyLocations(lat: number, lng: number, radius = 10): Observable<ApiResponse<PhotoLocation[]>> {
    return this.apiService.get<PhotoLocation[]>('/studios', { lat, lng, radius });
  }

  /**
   * Переключить статус "популярная" через REST API
   */
  togglePopular(locationId: string): Observable<ApiResponse<PhotoLocation>> {
    return this.apiService.post<PhotoLocation>(`/studios/${locationId}/toggle-popular`, {});
  }

  /**
   * Переключить статус "рекомендуемая" через REST API
   */
  toggleFeatured(locationId: string): Observable<ApiResponse<PhotoLocation>> {
    return this.apiService.post<PhotoLocation>(`/studios/${locationId}/toggle-featured`, {});
  }
}
