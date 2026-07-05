import { Component, ChangeDetectionStrategy, OnInit, inject, signal } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { BookingApiService, Booking as ApiBooking } from '../../../../core/services/booking-api.service';

interface BookingDisplay {
  id: string;
  clientName: string;
  clientEmail: string;
  service: string;
  startTime: string;
  endTime: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  photographerId?: string;
  date: string;
}

@Component({
  selector: 'app-booking-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, 
    MatButtonModule, 
    MatIconModule, 
    MatTableModule, 
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],  template: `
    <div class="booking-list">
      <mat-card>
        <mat-card-header>
          <mat-icon mat-card-avatar>event_note</mat-icon>
          <mat-card-title>Список бронирований</mat-card-title>
          <mat-card-subtitle>Управление бронированиями студии</mat-card-subtitle>
        </mat-card-header>
        
        <mat-card-content>
          <!-- Загрузка -->
          @if (isLoading()) {
            <div class="loading-container">
              <mat-spinner diameter="40" />
              <p>Загрузка бронирований...</p>
            </div>
          }
          
          <!-- Ошибка -->
          @if (error()) {
            <div class="error-container">
              <mat-icon color="warn">error</mat-icon>
              <p>{{ error() }}</p>
              <button mat-button (click)="loadBookings()">Попробовать снова</button>
            </div>
          }
          
          <!-- Список бронирований -->
          @if (!isLoading() && !error()) {
            <div class="bookings-container">
              @if (bookings().length === 0) {
                <div class="empty-state">
                  <mat-icon>event_busy</mat-icon>
                  <p>Нет бронирований для отображения</p>
                </div>
              } @else {
                @for (booking of bookings(); track booking.id || booking.clientName || $index) {
                  <div class="booking-item">
                    <div class="booking-header">
                      <div class="booking-time">
                        <mat-icon>schedule</mat-icon>
                        {{ formatTime(booking.startTime) }} - {{ formatTime(booking.endTime) }}
                      </div>
                      <mat-chip 
                        [class.status-pending]="booking.status === 'pending'"
                        [class.status-confirmed]="booking.status === 'confirmed'"
                        [class.status-completed]="booking.status === 'completed'"
                        [class.status-cancelled]="booking.status === 'cancelled'">
                        {{ getStatusText(booking.status) }}
                      </mat-chip>
                    </div>
                    
                    <div class="booking-details">
                      <div class="client-info">
                        <mat-icon>person</mat-icon>
                        <span>{{ booking.clientName }}</span>
                        <small>{{ booking.clientEmail }}</small>
                      </div>
                      
                      <div class="service-info">
                        <mat-icon>camera_alt</mat-icon>
                        <span>{{ booking.service }}</span>
                      </div>
                      
                      <div class="booking-date">
                        <mat-icon>event</mat-icon>
                        <span>{{ formatDate(booking.date) }}</span>
                      </div>
                    </div>
                    
                    <div class="booking-actions">
                      <button mat-icon-button (click)="editBooking(booking)" title="Редактировать">
                        <mat-icon>edit</mat-icon>
                      </button>
                      @if (booking.status === 'pending') {
                        <button mat-icon-button (click)="confirmBooking(booking)" title="Подтвердить">
                          <mat-icon>check_circle</mat-icon>
                        </button>
                      }
                      @if (booking.status !== 'cancelled') {
                        <button mat-icon-button (click)="cancelBooking(booking)" title="Отменить">
                          <mat-icon>cancel</mat-icon>
                        </button>
                      }
                    </div>
                  </div>
                }
              }
            </div>
          }
        </mat-card-content>
        
        <mat-card-actions>
          <button mat-raised-button color="primary" (click)="createBooking()">
            <mat-icon>add</mat-icon>
            Новое бронирование
          </button>
          <button mat-button (click)="refreshBookings()">
            <mat-icon>refresh</mat-icon>
            Обновить
          </button>
          <button mat-button (click)="exportBookings()">
            <mat-icon>file_download</mat-icon>
            Экспорт
          </button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,  styles: [`
    .booking-list {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .loading-container, .error-container, .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px;
      text-align: center;
    }
    
    .loading-container mat-icon, .error-container mat-icon, .empty-state mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      margin-bottom: 16px;
    }
    
    .bookings-container {
      margin-top: 20px;
    }
    
    .booking-item {
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      margin: 12px 0;
      padding: 16px;
      background: #fafafa;
      transition: box-shadow 0.2s;
    }
    
    .booking-item:hover {
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    
    .booking-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    
    .booking-time {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 500;
      color: #1976d2;
    }
    
    .booking-details {
      display: flex;
      flex-direction: column;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 12px;
    }

    .client-info, .service-info, .booking-date {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: auto;
    }
    
    .client-info small {
      color: #666;
      margin-left: 8px;
    }
    
    .booking-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    
    .status-pending {
      background-color: #fff3e0 !important;
      color: #e65100 !important;
    }
    
    .status-confirmed {
      background-color: #e8f5e8 !important;
      color: #2e7d32 !important;
    }
    
    .status-completed {
      background-color: #e3f2fd !important;
      color: #1976d2 !important;
    }
    
    .status-cancelled {
      background-color: #ffebee !important;
      color: #c62828 !important;
    }
    
    /* Mobile-first: base styles */
    .booking-details {
      flex-direction: column;
      gap: 8px;
    }

    .client-info, .service-info, .booking-date {
      min-width: auto;
    }

    /* Desktop styles */
    @media (min-width: 840px) {
      .booking-details {
        flex-direction: row;
        gap: 16px;
      }

      .client-info, .service-info, .booking-date {
        min-width: 200px;
      }
    }
  `]
})
export class BookingListComponent implements OnInit {
  private bookingApiService = inject(BookingApiService);
  private snackBar = inject(MatSnackBar);
    // Signals для состояния
  bookings = signal<BookingDisplay[]>([]);
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  
  ngOnInit(): void {
    this.loadBookings();
  }
  
  /**
   * Загрузка бронирований
   */
  loadBookings(): void {
    this.isLoading.set(true);
    this.error.set(null);
    
    this.bookingApiService.getBookings().subscribe({
      next: (response) => {
        if (response.success && response.data) {
          // Преобразуем API данные в формат для отображения
          const displayBookings: BookingDisplay[] = response.data.map((booking: ApiBooking) => ({
            id: booking.id,
            clientName: booking.clientId || 'Неизвестно', // Нужно будет получать из API клиентов
            clientEmail: booking.clientId || 'Неизвестно', // Нужно будет получать из API клиентов
            service: booking.serviceId || 'Неизвестно', // Нужно будет получать из API сервисов
            startTime: booking.startTime,
            endTime: booking.endTime,
            status: this.mapApiStatusToDisplay(booking.status),
            photographerId: booking.photographerId,
            date: booking.bookingDate
          }));
          this.bookings.set(displayBookings);
        } else {
          this.bookings.set([]);
        }
        this.isLoading.set(false);
      },
      error: () => {
        this.error.set('Ошибка при загрузке бронирований');
        this.isLoading.set(false);
      }
    });
  }
  
  /**
   * Преобразование статуса из API в статус для отображения
   */
  private mapApiStatusToDisplay(apiStatus: string): 'pending' | 'confirmed' | 'completed' | 'cancelled' {
    const statusMap: Record<string, 'pending' | 'confirmed' | 'completed' | 'cancelled'> = {
      'pending': 'pending',
      'confirmed': 'confirmed',
      'completed': 'completed',
      'cancelled': 'cancelled',
      'in_progress': 'confirmed'
    };
    return statusMap[apiStatus] || 'pending';
  }
  
  /**
   * Обновление списка бронирований
   */
  refreshBookings(): void {
    this.loadBookings();
  }
  
  /**
   * Создание нового бронирования
   */
  createBooking(): void {
    this.snackBar.open('Функция создания бронирования будет добавлена', 'Закрыть', { duration: 3000 });
  }
    /**
   * Редактирование бронирования
   */
  editBooking(booking: BookingDisplay): void {
    this.snackBar.open(`Редактирование бронирования ${booking.id}`, 'Закрыть', { duration: 3000 });
  }
  
  /**
   * Подтверждение бронирования
   */
  confirmBooking(booking: BookingDisplay): void {
    this.bookingApiService.updateBooking(booking.id, { status: 'confirmed' }).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open('Бронирование подтверждено', 'Закрыть', { duration: 3000 });
          this.loadBookings();
        } else {
          this.snackBar.open('Ошибка при подтверждении бронирования', 'Закрыть', { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open('Ошибка при подтверждении бронирования', 'Закрыть', { duration: 3000 });
      }
    });
  }
  
  /**
   * Отмена бронирования
   */
  cancelBooking(booking: BookingDisplay): void {
    this.bookingApiService.updateBooking(booking.id, { status: 'cancelled' }).subscribe({
      next: (response) => {
        if (response.success) {
          this.snackBar.open('Бронирование отменено', 'Закрыть', { duration: 3000 });
          this.loadBookings();
        } else {
          this.snackBar.open('Ошибка при отмене бронирования', 'Закрыть', { duration: 3000 });
        }
      },
      error: () => {
        this.snackBar.open('Ошибка при отмене бронирования', 'Закрыть', { duration: 3000 });
      }
    });
  }
  
  /**
   * Экспорт бронирований
   */
  exportBookings(): void {
    this.snackBar.open('Функция экспорта будет добавлена', 'Закрыть', { duration: 3000 });
  }
  
  /**
   * Форматирование времени
   */
  formatTime(time: string): string {
    return new Date(time).toLocaleTimeString('ru-RU', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }
  
  /**
   * Форматирование даты
   */
  formatDate(date: string): string {
    return new Date(date).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }
  
  /**
   * Получение текста статуса
   */
  getStatusText(status: string): string {
    const statusMap: Record<string, string> = {
      'pending': 'Ожидает',
      'confirmed': 'Подтверждено',
      'completed': 'Завершено',
      'cancelled': 'Отменено'
    };
    return statusMap[status] || status;
  }
}

