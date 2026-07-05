/**
 * Сервис для работы с галереей через HTTP API
 * Обеспечивает загрузку фотографий с поддержкой SSR и сигналами состояния
 */

import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, catchError, map, tap } from 'rxjs';
import { GalleryPhoto, GalleryCategory, GalleryFilters, GalleryHomeData, GalleryStat } from '../models/gallery.model';

export interface GalleryApiResponse {
  success: boolean;
  data: GalleryPhoto[];
  total?: number;
  page?: number;
  limit?: number;
}

@Injectable({
  providedIn: 'root'
})
export class GalleryService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private readonly baseUrl = `/api/gallery`;

  // Сигналы для состояния
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _homeGallery = signal<GalleryHomeData | null>(null);
  private readonly _photos = signal<GalleryPhoto[]>([]);

  // Публичные сигналы (readonly)
  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly homeGallery = this._homeGallery.asReadonly();
  readonly photos = this._photos.asReadonly();

  // Computed сигналы
  readonly featuredPhotos = computed(() => 
    this.photos().filter(photo => photo.isFeatured)
  );

  // Mock-данные для SSR fallback
  private readonly MOCK_GALLERY_PHOTOS: GalleryPhoto[] = [
    {
      id: 'mock-photo-1',
      slug: 'portrait-1',
      url: 'assets/static/gallery/placeholder.jpg',
      title: 'Портретная фотография',
      description: 'Профессиональная портретная фотосессия',
      category: GalleryCategory.PORTRAIT,
      tags: ['портрет', 'студия', 'профессиональное фото'],
      isPublic: true,
      isFeatured: true,
      order: 1,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01')
    },
    {
      id: 'mock-photo-2',
      slug: 'family-1',
      url: 'assets/static/gallery/placeholder.jpg',
      title: 'Семейная фотосессия',
      description: 'Семейная фотосессия на природе',
      category: GalleryCategory.FAMILY,
      tags: ['семья', 'природа', 'лето'],
      isPublic: true,
      isFeatured: true,
      order: 2,
      createdAt: new Date('2024-01-02'),
      updatedAt: new Date('2024-01-02')
    },
    {
      id: 'mock-photo-3',
      slug: 'business-1',
      url: 'assets/static/gallery/placeholder.jpg',
      title: 'Деловой портрет',
      description: 'Профессиональная деловая фотосессия',
      category: GalleryCategory.BUSINESS,
      tags: ['деловой портрет', 'студия', 'корпоративное фото'],
      isPublic: true,
      isFeatured: true,
      order: 3,
      createdAt: new Date('2024-01-03'),
      updatedAt: new Date('2024-01-03')
    },
    {
      id: 'mock-photo-4',
      slug: 'wedding-1',
      url: 'assets/static/gallery/placeholder.jpg',
      title: 'Свадебная фотосессия',
      description: 'Свадебная фотосессия в парке',
      category: GalleryCategory.WEDDING,
      tags: ['свадьба', 'пара', 'любовь'],
      isPublic: true,
      isFeatured: true,
      order: 4,
      createdAt: new Date('2024-01-04'),
      updatedAt: new Date('2024-01-04')
    }
  ];

  private readonly MOCK_GALLERY_STATS: GalleryStat[] = [
    { icon: 'photo_library', value: '9000+', label: 'Личных фотографий' },
    { icon: 'people', value: '20000+', label: 'Клиентов' },
    { icon: 'star', value: '5.0', label: 'Рейтинг' },
    { icon: 'access_time', value: String(new Date().getFullYear() - 1999), label: 'Лет опыта' }
  ];

  /**
   * Получить фотографии для главной страницы (только избранные)
   */
  getHomeGallery(): Observable<GalleryHomeData> {
    // Если данные уже загружены, возвращаем их
    const cachedData = this._homeGallery();
    if (cachedData) {
      return of(cachedData);
    }

    // Если не браузер (SSR), возвращаем mock-данные
    if (!isPlatformBrowser(this.platformId)) {
      const mockData: GalleryHomeData = {
        photos: this.MOCK_GALLERY_PHOTOS,
        stats: this.MOCK_GALLERY_STATS
      };
      this._homeGallery.set(mockData);
      return of(mockData);
    }

    // Загружаем данные из HTTP API
    this._isLoading.set(true);
    this._error.set(null);

    const filters: GalleryFilters = {
      isPublic: true,
      isFeatured: true,
      limit: 4,
      orderBy: 'order',
      orderDirection: 'asc'
    };

    return this.loadPhotosFromApi(filters).pipe(
      map(photos => {
        const galleryData: GalleryHomeData = {
          photos: photos.length > 0 ? photos : this.MOCK_GALLERY_PHOTOS,
          stats: this.MOCK_GALLERY_STATS
        };
        this._homeGallery.set(galleryData);
        this._isLoading.set(false);
        return galleryData;
      }),
      catchError(() => {
        this._error.set('Ошибка загрузки галереи');
        this._isLoading.set(false);
        
        const fallbackData: GalleryHomeData = {
          photos: this.MOCK_GALLERY_PHOTOS,
          stats: this.MOCK_GALLERY_STATS
        };
        this._homeGallery.set(fallbackData);
        return of(fallbackData);
      })
    );
  }

  /**
   * Получить все фотографии с фильтрами
   */
  getPhotos(filters?: GalleryFilters): Observable<GalleryPhoto[]> {
    // Если не браузер (SSR), возвращаем mock-данные
    if (!isPlatformBrowser(this.platformId)) {
      return of(this.MOCK_GALLERY_PHOTOS);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.loadPhotosFromApi(filters).pipe(
      tap(photos => {
        this._photos.set(photos);
        this._isLoading.set(false);
      }),
      catchError(() => {
        this._error.set('Ошибка загрузки фотографий');
        this._isLoading.set(false);
        return of(this.MOCK_GALLERY_PHOTOS);
      })
    );
  }

  /**
   * Получить фотографию по ID
   */
  getPhotoById(id: string): Observable<GalleryPhoto | null> {
    // Если не браузер (SSR), возвращаем mock-данные
    if (!isPlatformBrowser(this.platformId)) {
      const mockPhoto = this.MOCK_GALLERY_PHOTOS.find(p => p.id === id) || null;
      return of(mockPhoto);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ success: boolean; data: GalleryPhoto }>(`${this.baseUrl}/${id}`).pipe(
      map(response => {
        this._isLoading.set(false);
        return response.success ? response.data : null;
      }),
      catchError(() => {
        this._error.set('Ошибка загрузки фотографии');
        this._isLoading.set(false);
        
        // Fallback - попробовать найти в уже загруженных фото
        const existingPhoto = this.photos().find(p => p.id === id) || null;
        return of(existingPhoto);
      })
    );
  }

  /**
   * Получить фотографию по slug
   */
  getPhotoBySlug(slug: string): Observable<GalleryPhoto | null> {
    // Если не браузер (SSR), возвращаем mock-данные
    if (!isPlatformBrowser(this.platformId)) {
      const mockPhoto = this.MOCK_GALLERY_PHOTOS.find(p => p.slug === slug) || null;
      return of(mockPhoto);
    }

    this._isLoading.set(true);
    this._error.set(null);

    return this.http.get<{ success: boolean; data: GalleryPhoto }>(`${this.baseUrl}/slug/${slug}`).pipe(
      map(response => {
        this._isLoading.set(false);
        return response.success ? response.data : null;
      }),
      catchError(() => {
        this._error.set('Ошибка загрузки фотографии');
        this._isLoading.set(false);
        
        // Fallback - попробовать найти в уже загруженных фото
        const existingPhoto = this.photos().find(p => p.slug === slug) || null;
        return of(existingPhoto);
      })
    );
  }

  /**
   * Загрузить фотографии из HTTP API с фильтрами
   */
  private loadPhotosFromApi(filters?: GalleryFilters): Observable<GalleryPhoto[]> {
    let params = new HttpParams();

    if (filters) {
      if (filters.category) {
        params = params.set('category', filters.category);
      }
      if (filters.photographerId) {
        params = params.set('photographerId', filters.photographerId);
      }
      if (filters.isPublic !== undefined) {
        params = params.set('isPublic', filters.isPublic.toString());
      }
      if (filters.isFeatured !== undefined) {
        params = params.set('isFeatured', filters.isFeatured.toString());
      }
      if (filters.limit) {
        params = params.set('limit', filters.limit.toString());
      }
      if (filters.orderBy) {
        params = params.set('orderBy', filters.orderBy);
      }
      if (filters.orderDirection) {
        params = params.set('orderDirection', filters.orderDirection);
      }
    }

    return this.http.get<GalleryApiResponse>(`${this.baseUrl}/photos`, { params }).pipe(
      map(response => {
        if (response.success && response.data) {
          // Преобразуем даты из строк в Date объекты
          return response.data.map(photo => ({
            ...photo,
            createdAt: new Date(photo.createdAt),
            updatedAt: new Date(photo.updatedAt)
          }));
        }
        return [];
      })
    );
  }

  // Fallback-список категорий для SSR и при ошибке API
  private readonly CATEGORY_LABELS: Record<string, string> = {
    portrait:  'Портреты',
    family:    'Семейные',
    wedding:   'Свадебные',
    business:  'Деловые',
    children:  'Детские',
    fashion:   'Fashion',
    art:       'Арт',
    nature:    'Природа',
    studio:    'Студийные',
    event:     'Событийные',
    other:     'Прочее',
  };

  private readonly FALLBACK_CATEGORIES: { value: GalleryCategory; label: string }[] = [
    { value: GalleryCategory.PORTRAIT,  label: 'Портреты' },
    { value: GalleryCategory.FAMILY,    label: 'Семейные' },
    { value: GalleryCategory.WEDDING,   label: 'Свадебные' },
    { value: GalleryCategory.BUSINESS,  label: 'Деловые' },
    { value: GalleryCategory.CHILDREN,  label: 'Детские' },
    { value: GalleryCategory.FASHION,   label: 'Fashion' },
    { value: GalleryCategory.ART,       label: 'Арт' },
    { value: GalleryCategory.NATURE,    label: 'Природа' },
    { value: GalleryCategory.STUDIO,    label: 'Студийные' },
    { value: GalleryCategory.EVENT,     label: 'Событийные' },
    { value: GalleryCategory.OTHER,     label: 'Прочее' },
  ];

  /**
   * Получить категории галереи из API (SSR → fallback)
   */
  getCategories(): Observable<{ value: GalleryCategory; label: string }[]> {
    if (!isPlatformBrowser(this.platformId)) {
      return of(this.FALLBACK_CATEGORIES);
    }

    return this.http.get<{ success: boolean; categories: { value: string; count: number }[] }>(
      `${this.baseUrl}/categories`
    ).pipe(
      map(response => {
        if (!response.success || !response.categories.length) {
          return this.FALLBACK_CATEGORIES;
        }
        return response.categories.map(c => ({
          value: (c.value as GalleryCategory) ?? GalleryCategory.OTHER,
          label: this.CATEGORY_LABELS[c.value] ?? c.value,
        }));
      }),
      catchError(() => of(this.FALLBACK_CATEGORIES))
    );
  }

  /**
   * Очистить кэш
   */
  clearCache(): void {
    this._homeGallery.set(null);
    this._photos.set([]);
    this._error.set(null);
  }

  /**
   * Обновить состояние ошибки
   */
  clearError(): void {
    this._error.set(null);
  }
}
