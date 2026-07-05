import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, map, catchError, of, tap } from 'rxjs';

/**
 * Слот онлайн-записи
 */
export interface BookingTimeSlot {
  time: string;     // "09:00"
  endTime: string;  // "09:30"
  duration: number; // минуты (вычислено из time/endTime)
  available: boolean;
}

export interface BookingResult {
  success: boolean;
  bookingId?: string;
  error?: string;
  suggestRegistration?: boolean;
}

export interface BookingPhoneCodeResult {
  success: boolean;
  expiresIn?: number;
  provider?: string;
  error?: string;
}

interface SlotsApiResponse {
  success: boolean;
  data: {
    date: string;
    studioId: string;
    studioName?: string;
    slots: { time: string; endTime: string; available: boolean }[];
  };
}

interface BookingPhoneCodeApiResponse {
  success: boolean;
  data?: {
    expiresIn: number;
    provider: string;
  };
  error?: string;
  message?: string;
}

interface BookingApiErrorResponse {
  error?: string;
  message?: string;
}

function parseDuration(time: string, endTime: string): number {
  const [h1, m1] = time.split(':').map(Number);
  const [h2, m2] = endTime.split(':').map(Number);
  return Math.max(30, (h2 * 60 + m2) - (h1 * 60 + m1));
}

function isBookingApiErrorResponse(value: unknown): value is BookingApiErrorResponse {
  return typeof value === 'object' && value !== null;
}

function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (isBookingApiErrorResponse(body)) {
      if (typeof body.error === 'string' && body.error) return body.error;
      if (typeof body.message === 'string' && body.message) return body.message;
    }
    return error.message || fallback;
  }
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

/**
 * Сервис онлайн-записи через /api/booking (Node.js + PostgreSQL).
 * Заменяет устаревший PHP-мост Bitrix24.
 */
@Injectable({
  providedIn: 'root',
})
export class Bitrix24BookingService {
  private http = inject(HttpClient);

  private _slots = signal<BookingTimeSlot[]>([]);
  private _loading = signal(false);
  private _error = signal<string | null>(null);

  readonly slots = this._slots.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  readonly availableSlots = computed(() =>
    this._slots().filter(s => s.available)
  );

  /**
   * Свободные слоты на дату для студии (studioId = location_code, напр. 'soborny').
   * serviceCategorySlug — для маркетплейс-услуг ограничивает слоты 18:00–19:30.
   */
  getSlots(date: string, _serviceId?: string, studioId?: string, serviceCategorySlug?: string): Observable<BookingTimeSlot[]> {
    this._loading.set(true);
    this._error.set(null);

    const params: Record<string, string> = { date };
    if (studioId) params['studio'] = studioId;
    if (serviceCategorySlug) params['service_category'] = serviceCategorySlug;

    return this.http.get<SlotsApiResponse>('/api/booking/slots', { params }).pipe(
      map(res => (res.data?.slots ?? []).map(s => ({
        ...s,
        duration: parseDuration(s.time, s.endTime),
      }))),
      tap(slots => {
        this._slots.set(slots);
        this._loading.set(false);
      }),
      catchError(err => {
        this._error.set(err.message || 'Не удалось загрузить слоты');
        this._loading.set(false);
        return of([]);
      }),
    );
  }

  /**
   * Запросить голосовой код подтверждения телефона для записи.
   */
  requestPhoneCode(phone: string): Observable<BookingPhoneCodeResult> {
    this._loading.set(true);
    this._error.set(null);

    return this.http.post<BookingPhoneCodeApiResponse>('/api/booking/phone-code', { phone }).pipe(
      map(res => {
        if (!res.success || !res.data) {
          return {
            success: false,
            error: res.error || res.message || 'Не удалось запустить звонок с кодом',
          };
        }
        return {
          success: true,
          expiresIn: res.data.expiresIn,
          provider: res.data.provider,
        };
      }),
      tap(() => this._loading.set(false)),
      catchError(error => {
        const message = getApiErrorMessage(error, 'Не удалось запустить звонок с кодом');
        this._error.set(message);
        this._loading.set(false);
        return of({ success: false, error: message });
      }),
    );
  }

  /**
   * Создать запись
   */
  createBooking(data: {
    studio: string;
    date: string;
    time: string;
    clientName: string;
    clientPhone: string;
    serviceName?: string;
    serviceCategorySlug?: string;
    partnerPromoCode?: string;
    phoneCode?: string;
  }): Observable<BookingResult> {
    this._loading.set(true);
    this._error.set(null);

    return this.http.post<BookingResult>('/api/booking/book', data).pipe(
      tap(() => this._loading.set(false)),
      catchError(err => {
        const message = getApiErrorMessage(err, 'Ошибка создания записи');
        this._error.set(message);
        this._loading.set(false);
        return of({ success: false, error: message });
      }),
    );
  }
}
