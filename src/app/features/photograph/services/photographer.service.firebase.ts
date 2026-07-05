import { Injectable, inject, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, map, of, catchError, tap } from 'rxjs';
import { Photographer } from '../models/photographer.improved.model';
import { ServiceCategory, StaffSpecialization } from '../../../shared/models/booking.shared.model';
import { 
  SharedPhotographer, 
  SharedPhotographerAvailability 
} from '../../../shared/models/photographer.shared.model';
import { PhotographerApiService, Photographer as ApiPhotographer } from '../../../core/services/photographer-api.service';

/**
 * Сервис для работы с данными фотографов через REST API
 * Адаптирует PhotographerApiService для использования с моделью Photographer из photographer.improved.model
 */
@Injectable({
  providedIn: 'root'
})
export class PhotographerServiceFirebase {
  // API сервис для доступа к данным
  private photographerApiService = inject(PhotographerApiService);

  // Signals для хранения состояния
  private _photographers = signal<Photographer[]>([]);
  private _sharedPhotographers = signal<SharedPhotographer[]>([]);

  // Публичные readonly signals
  readonly photographers = this._photographers.asReadonly();
  readonly sharedPhotographers = this._sharedPhotographers.asReadonly();

  // Computed signals
  readonly hasPhotographers = computed(() => this._photographers().length > 0);
  readonly hasSharedPhotographers = computed(() => this._sharedPhotographers().length > 0);

  // Legacy Observable API для обратной совместимости
  photographers$ = toObservable(this.photographers);
  sharedPhotographers$ = toObservable(this.sharedPhotographers);

  constructor() {
    this.loadInitialData();
  }

  /**
   * Конвертация ApiPhotographer в Photographer
   */
  private convertApiPhotographerToPhotographer(apiPhotographer: ApiPhotographer): Photographer {
    // Конвертируем portfolio в portfolioImages
    const portfolioImages = (apiPhotographer.portfolio || []).map(item => ({
      url: item.imageUrl,
      title: item.title,
      category: item.category,
      isCover: false
    }));

    // Конвертируем specializations в формат specialization
    const specialization = (apiPhotographer.specializations || []).map(spec => ({
      name: spec,
      description: undefined
    }));

    // Конвертируем availability в workingSchedule
    const workingHours = apiPhotographer.availability?.workingHours 
      ? Object.values(apiPhotographer.availability.workingHours)[0] 
      : undefined;

    return {
      id: apiPhotographer.id,
      slug: apiPhotographer.id, // Используем id как slug, если slug нет
      name: apiPhotographer.name,
      title: apiPhotographer.bio || '',
      profileImage: '', // Нет в API модели
      specialization,
      rating: apiPhotographer.rating?.average || 0,
      reviewCount: apiPhotographer.rating?.totalReviews || 0,
      isActive: apiPhotographer.availability?.isActive || false,
      staffType: StaffSpecialization.PHOTOGRAPHER, // По умолчанию
      workingSchedule: {
        type: 'fixed',
        workingHours: workingHours ? {
          start: workingHours.start,
          end: workingHours.end
        } : undefined
      },
      availability: {
        studioOnly: false,
        locationOnly: false,
        bothOptions: true
      },
      contact: {
        phone: apiPhotographer.phone,
        email: apiPhotographer.email,
        useStudioContacts: false
      },
      uniqueApproach: apiPhotographer.bio,
      experience: apiPhotographer.experience?.toString() || '',
      portfolioImages
    };
  }

  /**
   * Загрузка начальных данных из API
   */
  private loadInitialData(): void {
    // Загружаем фотографов
    this.photographerApiService.getPhotographers().pipe(
      map(response => response.data || []),
      map(photographers => photographers.map(p => this.convertApiPhotographerToPhotographer(p))),
      tap(photographers => this._photographers.set(photographers)),
      catchError(() => {
        return of([]);
      })
    ).subscribe();
  }

  /**
   * Получение всех фотографов
   */
  getAllPhotographers(): Observable<Photographer[]> {
    return this.photographerApiService.getPhotographers().pipe(
      map(response => (response.data || []).map(p => this.convertApiPhotographerToPhotographer(p)))
    );
  }

  /**
   * Получение общих данных фотографов для списка
   */
  getAllSharedPhotographers(): Observable<SharedPhotographer[]> {
    return this.photographerApiService.getPhotographers().pipe(
      map(response => (response.data || []).map(p => ({
        id: p.id,
        slug: p.id,
        name: p.name,
        title: p.bio || '',
        profileImage: '',
        specialization: p.specializations || [],
        rating: p.rating?.average || 0,
        isActive: p.availability?.isActive || false,
        reviewCount: p.rating?.totalReviews || 0,
        experience: p.experience,
        specializations: p.specializations?.map(s => s as ServiceCategory) || [],
        staffType: StaffSpecialization.PHOTOGRAPHER
      })))
    );
  }

  /**
   * Получение фотографа по ID
   */
  getPhotographerById(id: string): Observable<Photographer | null> {
    return this.photographerApiService.getPhotographerById(id).pipe(
      map(response => response.success && response.data 
        ? this.convertApiPhotographerToPhotographer(response.data)
        : null
      )
    );
  }

  /**
   * Получение фотографа по slug
   * TODO: Реализовать поиск по slug в API
   */
  getPhotographerBySlug(slug: string): Observable<Photographer | null> {
    // Пока используем поиск по ID, так как slug может совпадать с id
    return this.getPhotographerById(slug);
  }

  /**
   * Получение фотографов по категории услуг
   */
  getPhotographersByCategory(category: ServiceCategory): Observable<Photographer[]> {
    return this.photographerApiService.getPhotographersByCategory(category).pipe(
      map(response => (response.data || []).map(p => this.convertApiPhotographerToPhotographer(p)))
    );
  }

  /**
   * Получение доступности фотографа
   */
  getPhotographerAvailability(photographerId: string): Observable<SharedPhotographerAvailability | null> {
    return this.photographerApiService.getPhotographerSchedule(photographerId).pipe(
      map(response => {
        if (!response.success || !response.data) {
          return null;
        }
        const availability = response.data;
        return {
          photographerId,
          name: '',
          specializations: [],
          availableSlots: {},
          workingHours: availability.workingHours 
            ? Object.values(availability.workingHours)[0] 
            : undefined,
          studioOnly: false,
          locationOnly: false,
          rating: 0,
          reviewsCount: 0
        };
      })
    );
  }

  /**
   * Получение доступных временных слотов на определенную дату
   * TODO: Реализовать через BookingService
   */
  getAvailableTimeSlots(_photographerId: string, _date: Date): Observable<string[]> {
    // Пока возвращаем пустой массив, нужно реализовать через BookingService
    return of([]);
  }

  /**
   * Бронирование временного слота
   * TODO: Реализовать через BookingService
   */
  bookTimeSlot(_photographerId: string, _date: Date, _timeSlot: string, _userId?: string): Observable<boolean> {
    // Пока возвращаем false, нужно реализовать через BookingService
    return of(false);
  }

  /**
   * Добавление нового фотографа
   * TODO: Реализовать через PhotographerApiService
   */
  addPhotographer(_photographer: Omit<Photographer, 'id'>): Observable<string> {
    // Пока возвращаем пустую строку, нужно реализовать через PhotographerApiService
    return of('');
  }

  /**
   * Обновление данных фотографа
   * TODO: Реализовать через PhotographerApiService
   */
  updatePhotographer(_id: string, _data: Partial<Photographer>): Observable<void> {
    // Пока возвращаем void, нужно реализовать через PhotographerApiService
    return of(void 0);
  }

  /**
   * Удаление фотографа
   * TODO: Реализовать через PhotographerApiService
   */
  deletePhotographer(_id: string): Observable<void> {
    // Пока возвращаем void, нужно реализовать через PhotographerApiService
    return of(void 0);
  }
}
