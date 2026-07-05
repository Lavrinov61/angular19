import { Injectable, signal, computed } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, of, map, delay } from 'rxjs';
import {
  Booking,
  BookingStatus,
  PaymentStatus,
  TimeSlot,
  Calendar,
  WorkingHours,
  BookingFilter
} from '../../../core/models/booking.model';
import { SERVICES } from '../../../core/data/services.data';

@Injectable({
  providedIn: 'root'
})
export class BookingService {
  // Signals для состояния
  private _bookings = signal<Booking[]>([]);
  
  // Публичный readonly signal
  readonly bookings = this._bookings.asReadonly();
  
  // Computed signals
  readonly hasBookings = computed(() => this._bookings().length > 0);
  readonly bookingsCount = computed(() => this._bookings().length);
  
  // Legacy Observable API для обратной совместимости
  public bookings$ = toObservable(this.bookings);

  // Рабочие часы фотостудии
  private workingHours: WorkingHours[] = [
    { dayOfWeek: 1, isWorkingDay: true, startTime: '09:00', endTime: '20:00', breakStart: '13:00', breakEnd: '14:00' }, // Понедельник
    { dayOfWeek: 2, isWorkingDay: true, startTime: '09:00', endTime: '20:00', breakStart: '13:00', breakEnd: '14:00' }, // Вторник
    { dayOfWeek: 3, isWorkingDay: true, startTime: '09:00', endTime: '20:00', breakStart: '13:00', breakEnd: '14:00' }, // Среда
    { dayOfWeek: 4, isWorkingDay: true, startTime: '09:00', endTime: '20:00', breakStart: '13:00', breakEnd: '14:00' }, // Четверг
    { dayOfWeek: 5, isWorkingDay: true, startTime: '09:00', endTime: '20:00', breakStart: '13:00', breakEnd: '14:00' }, // Пятница
    { dayOfWeek: 6, isWorkingDay: true, startTime: '10:00', endTime: '18:00' }, // Суббота
    { dayOfWeek: 0, isWorkingDay: false, startTime: '00:00', endTime: '00:00' }  // Воскресенье - выходной
  ];
  // Удалены тестовые данные бронирований в соответствии с требованиями проекта
  // Инициализируем пустой массив бронирований - в продакшн данные загружаются из Firebase

  /**
   * Получить все бронирования с возможностью фильтрации
   */
  getBookings(filter?: BookingFilter): Observable<Booking[]> {
    return this.bookings$.pipe(
      map(bookings => {
        if (!filter) return bookings;

        return bookings.filter(booking => {
          let matches = true;

          if (filter.dateFrom) {
            const bookingDate = new Date(booking.date);
            const filterDate = new Date(filter.dateFrom);
            matches = matches && bookingDate >= filterDate;
          }

          if (filter.dateTo) {
            const bookingDate = new Date(booking.date);
            const filterDate = new Date(filter.dateTo);
            matches = matches && bookingDate <= filterDate;
          }

          if (filter.status) {
            matches = matches && booking.status === filter.status;
          }

          if (filter.photographerId) {
            matches = matches && booking.photographerId === filter.photographerId;
          }

          if (filter.serviceId) {
            matches = matches && booking.serviceId === filter.serviceId;
          }

          return matches;
        });
      })
    );
  }

  /**
   * Получить бронирование по ID
   */
  getBookingById(id: string): Observable<Booking | undefined> {
    return this.bookings$.pipe(
      map(bookings => bookings.find(booking => booking.id === id))
    );
  }

  /**
   * Создать новое бронирование
   */  createBooking(bookingData: Partial<Booking>): Observable<Booking> {
    const newBooking: Booking = {
      id: this.generateId(),
      userId: bookingData.userId || 'guest',
      serviceId: bookingData.serviceId!,
      service: SERVICES.find(s => s.id === bookingData.serviceId),
      photographerId: bookingData.photographerId,
      photographerName: bookingData.photographerName,
      date: bookingData.date!,      startTime: bookingData.startTime || bookingData.timeSlot?.startTime || '09:00',
      endTime: bookingData.endTime || bookingData.timeSlot?.endTime || '10:00',
      timeSlot: bookingData.timeSlot!,
      status: BookingStatus.PENDING,
      persons: bookingData.persons || 1,
      totalPrice: bookingData.totalPrice || 0,
      clientInfo: bookingData.clientInfo!,
      paymentStatus: PaymentStatus.PENDING,
      comments: bookingData.comments,
      confirmationCode: this.generateConfirmationCode(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const currentBookings = this._bookings();
    this._bookings.set([...currentBookings, newBooking]);

    return of(newBooking).pipe(delay(500));
  }

  /**
   * Обновить бронирование
   */
  updateBooking(id: string, updates: Partial<Booking>): Observable<Booking | null> {
    const currentBookings = this._bookings();
    const bookingIndex = currentBookings.findIndex(b => b.id === id);

    if (bookingIndex === -1) {
      return of(null);
    }

    const updatedBooking = {
      ...currentBookings[bookingIndex],
      ...updates,
      updatedAt: new Date()
    };

    const updatedBookings = [...currentBookings];
    updatedBookings[bookingIndex] = updatedBooking;
    this._bookings.set(updatedBookings);

    return of(updatedBooking).pipe(delay(300));
  }

  /**
   * Отменить бронирование
   */
  cancelBooking(id: string, reason?: string): Observable<boolean> {
    return this.updateBooking(id, { 
      status: BookingStatus.CANCELLED, 
      comments: reason ? `Отменено: ${reason}` : 'Отменено'
    }).pipe(
      map(result => result !== null)
    );
  }

  /**
   * Подтвердить бронирование
   */
  confirmBooking(id: string): Observable<boolean> {
    return this.updateBooking(id, { status: BookingStatus.CONFIRMED }).pipe(
      map(result => result !== null)
    );
  }

  /**
   * Получить доступные временные слоты на дату
   */
  getAvailableTimeSlots(date: Date, serviceId: string, photographerId?: string): Observable<TimeSlot[]> {
    const dayOfWeek = date.getDay();
    const workingHoursForDay = this.workingHours.find(wh => wh.dayOfWeek === dayOfWeek);

    if (!workingHoursForDay || !workingHoursForDay.isWorkingDay) {
      return of([]);
    }

    const serviceDuration = this.getServiceDuration(serviceId);
    
    const timeSlots = this.generateTimeSlots(workingHoursForDay, serviceDuration);
    
    // Получаем занятые слоты на эту дату
    return this.getBookings().pipe(
      map(bookings => {
        const bookedSlots = bookings
          .filter(booking => {
            const bookingDate = new Date(booking.date);
            return bookingDate.toDateString() === date.toDateString() &&
                   booking.status !== BookingStatus.CANCELLED &&
                   (!photographerId || booking.photographerId === photographerId);
          })
          .map(booking => booking.timeSlot.startTime);

        return timeSlots.map(slot => ({
          ...slot,
          isAvailable: !bookedSlots.includes(slot.startTime)
        }));
      })
    );
  }

  /**
   * Получить календарь на месяц
   */
  getCalendarForMonth(year: number, month: number, serviceId?: string): Observable<Calendar[]> {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const calendars: Calendar[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      const dayOfWeek = date.getDay();
      const workingHoursForDay = this.workingHours.find(wh => wh.dayOfWeek === dayOfWeek);
      
      const calendar: Calendar = {
        date,
        timeSlots: [],
        isWorkingDay: workingHoursForDay?.isWorkingDay || false
      };

      if (calendar.isWorkingDay && serviceId) {
        const serviceDuration = this.getServiceDuration(serviceId);
        calendar.timeSlots = this.generateTimeSlots(workingHoursForDay!, serviceDuration);
      }

      calendars.push(calendar);
    }

    return of(calendars).pipe(delay(300));
  }

  /**
   * Получить статистику бронирований
   */
  getBookingStats(): Observable<{ total: number; confirmed: number; pending: number; cancelled: number; completed: number; totalRevenue: number }> {
    return this.bookings$.pipe(
      map(bookings => {
        const total = bookings.length;
        const confirmed = bookings.filter(b => b.status === BookingStatus.CONFIRMED).length;
        const pending = bookings.filter(b => b.status === BookingStatus.PENDING).length;
        const cancelled = bookings.filter(b => b.status === BookingStatus.CANCELLED).length;
        const completed = bookings.filter(b => b.status === BookingStatus.COMPLETED).length;

        const totalRevenue = bookings
          .filter(b => b.paymentStatus === PaymentStatus.PAID)
          .reduce((sum, b) => sum + b.totalPrice, 0);

        return {
          total,
          confirmed,
          pending,
          cancelled,
          completed,
          totalRevenue
        };
      })
    );
  }

  /**
   * Генерировать временные слоты для рабочего дня
   */
  private generateTimeSlots(workingHours: WorkingHours, serviceDuration: number): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const [startHour, startMinute] = workingHours.startTime.split(':').map(Number);
    const [endHour, endMinute] = workingHours.endTime.split(':').map(Number);

    let currentTime = startHour * 60 + startMinute; // В минутах
    const endTime = endHour * 60 + endMinute;
    
    // Обеденный перерыв (если есть)
    let breakStart: number | undefined;
    let breakEnd: number | undefined;
    
    if (workingHours.breakStart && workingHours.breakEnd) {
      const [breakStartHour, breakStartMinute] = workingHours.breakStart.split(':').map(Number);
      const [breakEndHour, breakEndMinute] = workingHours.breakEnd.split(':').map(Number);
      breakStart = breakStartHour * 60 + breakStartMinute;
      breakEnd = breakEndHour * 60 + breakEndMinute;
    }

    while (currentTime + serviceDuration <= endTime) {
      // Проверяем, не попадает ли слот на обеденный перерыв
      if (breakStart && breakEnd && 
          ((currentTime >= breakStart && currentTime < breakEnd) ||
           (currentTime < breakStart && currentTime + serviceDuration > breakStart))) {
        currentTime = breakEnd;
        continue;
      }

      const startTimeString = this.minutesToTimeString(currentTime);
      const endTimeString = this.minutesToTimeString(currentTime + serviceDuration);

      slots.push({
        startTime: startTimeString,
        endTime: endTimeString,
        duration: serviceDuration,
        isAvailable: true
      });

      currentTime += serviceDuration;
    }

    return slots;
  }

  /**
   * Получить длительность услуги в минутах
   */
  private getServiceDuration(serviceId: string): number {
    // Базовые длительности для разных типов услуг
    const durations: Record<string, number> = {
      'foto-na-document': 15,
      'passport-photo': 15,
      'portrait-session': 60,
      'family-session': 90,
      'wedding-session': 180,
      'business-portraits': 45,
      'children-session': 60,
      'couple-session': 60,
      'maternity-session': 90,
      'graduation-session': 45
    };

    return durations[serviceId] || 60; // По умолчанию 60 минут
  }

  /**
   * Конвертировать минуты в строку времени
   */
  private minutesToTimeString(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /**
   * Генерировать уникальный ID
   */
  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Генерировать код подтверждения
   */
  private generateConfirmationCode(): string {
    return 'MF' + Date.now().toString().slice(-6);
  }
}
