import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { ApiService, ApiResponse, PaginationParams, PaginatedResponse } from './api.service';

/** Запись из нового API /bookings/my (реальная структура БД) */
export interface MyBookingRecord {
  id: string;
  studio_name: string;
  studio_address?: string;
  client_name: string;
  client_phone: string;
  service_name: string | null;
  service_category_slug: string | null;
  start_time: string;
  end_time: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no-show';
  source: string;
  notes: string | null;
  created_at: string;
}

/** @deprecated — legacy booking interface, используй MyBookingRecord */
export interface Booking {
  id: string;
  clientId: string;
  photographerId: string;
  serviceId: string;
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'in_progress';
  bookingDate: string;
  startTime: string;
  endTime: string;
  location: {
    address: string;
    city: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  price: {
    basePrice: number;
    additionalCosts?: number;
    totalPrice: number;
    currency: string;
  };
  requirements?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
    // Поля для совместимости с шаблонами (алиасы)
  date: string; // Алиас для bookingDate
  persons: number; // Количество человек
  totalPrice: number; // Алиас для price.totalPrice
  paymentStatus: 'pending' | 'paid' | 'refunded' | 'failed';
  
  // Связанные данные
  client?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  };
  photographer?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  };
  service?: {
    id: string;
    name: string;    title?: string; // Алиас для name
    duration: number;
    basePrice: number;
  };
}

export interface CreateBookingRequest {
  photographerId: string;
  serviceId: string;
  bookingDate: string;
  startTime: string;
  endTime: string;
  location: {
    address: string;
    city: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  requirements?: string;
  notes?: string;
}

export interface UpdateBookingRequest {
  status?: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'in_progress';
  bookingDate?: string;
  startTime?: string;
  endTime?: string;
  location?: {
    address: string;
    city: string;
    coordinates?: {
      lat: number;
      lng: number;
    };
  };
  requirements?: string;
  notes?: string;
}

export interface BookingFilters {
  status?: string;
  photographerId?: string;
  clientId?: string;
  serviceId?: string;
  dateFrom?: string;
  dateTo?: string;
  location?: string;
  [key: string]: unknown;
}

/**
 * Booking API Service - Мигрирован на REST API
 */
@Injectable({
  providedIn: 'root'
})
export class BookingApiService {
  private apiService = inject(ApiService);
  
  // Signals для состояния
  private bookingsSignal = signal<Booking[]>([]);
  private currentBookingSignal = signal<Booking | null>(null);
  
  // Readonly signals
  public readonly bookings = this.bookingsSignal.asReadonly();
  public readonly currentBooking = this.currentBookingSignal.asReadonly();
  public readonly isLoading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);
  
  // Computed signals для удобства
  public readonly pendingBookings = computed(() => 
    this.bookings().filter(booking => booking.status === 'pending')
  );
  
  public readonly confirmedBookings = computed(() => 
    this.bookings().filter(booking => booking.status === 'confirmed')
  );
  
  public readonly completedBookings = computed(() => 
    this.bookings().filter(booking => booking.status === 'completed')
  );
  
  public readonly todayBookings = computed(() => {
    const today = new Date().toISOString().split('T')[0];
    return this.bookings().filter(booking => 
      booking.bookingDate.startsWith(today)
    );
  });
  
  /**
   * Получить все бронирования с пагинацией через REST API
   */
  getBookings(params?: PaginationParams & BookingFilters): Observable<PaginatedResponse<Booking>> {
    return this.apiService.getPaginated<Booking>('/bookings', params).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.bookingsSignal.set(response.data);
        }
      })
    );
  }
  
  /**
   * Получить бронирование по ID через REST API
   */
  getBookingById(id: string): Observable<ApiResponse<Booking>> {
    return this.apiService.get<Booking>(`/bookings/${id}`).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.currentBookingSignal.set(response.data);
        }
      })
    );
  }

  /**
   * Создать новое бронирование через REST API
   */
  createBooking(bookingData: CreateBookingRequest): Observable<ApiResponse<Booking>> {
    return this.apiService.post<Booking>('/bookings', bookingData).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.addBooking(response.data);
        }
      })
    );
  }
  
  /**
   * Обновить бронирование через REST API
   */
  updateBooking(id: string, bookingData: UpdateBookingRequest): Observable<ApiResponse<Booking>> {
    return this.apiService.put<Booking>(`/bookings/${id}`, bookingData).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updateLocalBooking(id, response.data);
        }
      })
    );
  }
  
  /**
   * Частичное обновление бронирования через REST API
   */
  patchBooking(id: string, bookingData: Partial<UpdateBookingRequest>): Observable<ApiResponse<Booking>> {
    return this.apiService.put<Booking>(`/bookings/${id}`, bookingData).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updateLocalBooking(id, response.data);
        }
      })
    );
  }
  
  /**
   * Обновить статус бронирования через REST API
   */
  private updateStatus(id: string, status: 'confirmed' | 'cancelled' | 'completed'): Observable<ApiResponse<Booking>> {
    return this.apiService.put<Booking>(`/bookings/${id}/status`, { status }).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updateLocalBooking(id, response.data);
        }
      })
    );
  }

  /**
   * Отменить бронирование через REST API
   */
  cancelBooking(id: string): Observable<ApiResponse<Booking>> {
    return this.updateStatus(id, 'cancelled');
  }
  
  /**
   * Подтвердить бронирование через REST API
   */
  confirmBooking(id: string): Observable<ApiResponse<Booking>> {
    return this.updateStatus(id, 'confirmed');
  }
  
  /**
   * Завершить бронирование через REST API
   */
  completeBooking(id: string): Observable<ApiResponse<Booking>> {
    return this.updateStatus(id, 'completed');
  }
  
  /**
   * Удалить бронирование через REST API
   */
  deleteBooking(id: string): Observable<ApiResponse<void>> {
    return this.apiService.delete<void>(`/bookings/${id}`).pipe(
      tap(response => {
        if (response.success) {
          this.removeLocalBooking(id);
        }
      })
    );
  }
  
  /**
   * Мои записи — ищет по client_id + телефону (гостевые записи тоже найдутся)
   */
  getMyBookings(): Observable<ApiResponse<MyBookingRecord[]>> {
    return this.apiService.get<MyBookingRecord[]>('/bookings/my');
  }

  /**
   * Получить бронирования клиента через REST API (legacy)
   */
  getClientBookings(clientId: string, params?: PaginationParams): Observable<PaginatedResponse<Booking>> {
    const queryParams = { clientId, ...params };
    return this.apiService.getPaginated<Booking>('/bookings', queryParams).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.bookingsSignal.set(response.data);
        }
      })
    );
  }
  
  /**
   * Получить бронирования фотографа через REST API
   */
  getPhotographerBookings(photographerId: string, params?: PaginationParams): Observable<PaginatedResponse<Booking>> {
    const queryParams = { photographerId, ...params };
    return this.apiService.getPaginated<Booking>('/bookings', queryParams).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.bookingsSignal.set(response.data);
        }
      })
    );
  }
  
  /**
   * Получить доступные слоты фотографа
   */
  getAvailableSlots(photographerId: string, date: string): Observable<ApiResponse<{
    date: string;
    availableSlots: {
      startTime: string;
      endTime: string;
      duration: number;
    }[];
  }>> {
    return this.apiService.get(`/bookings/available-slots`, { photographerId, date });
  }
  
  /**
   * Проверить доступность слота
   */
  checkSlotAvailability(photographerId: string, date: string, startTime: string, endTime: string): Observable<ApiResponse<{
    available: boolean;
    conflicts?: Booking[];
  }>> {
    return this.apiService.get(`/bookings/check-availability`, { photographerId, date, startTime, endTime });
  }
  
  /**
   * Поиск бронирований
   */
  searchBookings(params?: Record<string, string>): Observable<PaginatedResponse<Booking>> {
    return this.apiService.getPaginated<Booking>('/bookings/search', params);
  }
  
  /**
   * Получить статистику бронирований
   */
  getBookingStats(): Observable<ApiResponse<{
    total: number;
    byStatus: Record<string, number>;
    revenue: {
      total: number;
      period: number;
    };
    trends: {
      date: string;
      count: number;
      revenue: number;
    }[];
  }>> {
    return this.apiService.get('/bookings/stats');
  }
  
  /**
   * Получить бронирования по дате
   */
  getBookingsByDate(date: string): Observable<ApiResponse<Booking[]>> {
    return this.apiService.get<Booking[]>('/bookings/by-date', { date });
  }
  
  /**
   * Получить предстоящие бронирования
   */
  getUpcomingBookings(limit = 10): Observable<ApiResponse<Booking[]>> {
    return this.apiService.get<Booking[]>('/bookings/upcoming', { limit: String(limit) });
  }
  
  /**
   * Отправить напоминание о бронировании
   */
  sendBookingReminder(): Observable<ApiResponse<void>> {
    // This function doesn't exist yet, returning success for now.
    return of({ success: true });
  }
  
  /**
   * Установить бронирования в локальное состояние
   */
  setBookings(bookings: Booking[]): void {
    this.bookingsSignal.set(bookings);
  }
  
  /**
   * Добавить бронирование в локальное состояние
   */
  addBooking(booking: Booking): void {
    this.bookingsSignal.update(bookings => [...bookings, booking]);
  }
  
  /**
   * Обновить бронирование в локальном состоянии
   */
  updateLocalBooking(id: string, bookingData: Partial<Booking>): void {
    this.bookingsSignal.update(bookings => 
      bookings.map(booking => 
        booking.id === id ? { ...booking, ...bookingData } : booking
      )
    );
  }
  
  /**
   * Удалить бронирование из локального состояния
   */
  removeLocalBooking(id: string): void {
    this.bookingsSignal.update(bookings => bookings.filter(booking => booking.id !== id));
  }
  
  /**
   * Очистить локальное состояние
   */
  clearBookings(): void {
    this.bookingsSignal.set([]);
    this.currentBookingSignal.set(null);
  }
}
