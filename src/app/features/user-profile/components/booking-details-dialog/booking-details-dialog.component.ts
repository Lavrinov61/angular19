import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';

import { Booking, BookingStatus, PaymentStatus } from '../../../../core/models/booking.model';

export interface BookingDetailsDialogData {
  booking: Booking;
}

@Component({
  selector: 'app-booking-details-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatChipsModule
  ],
  template: `
    <div class="booking-details-dialog">
      <h2 mat-dialog-title>Детали бронирования</h2>
      
      <mat-dialog-content>
        <div class="dialog-content">          <div class="dialog-header">
            <h3 class="service-name">{{ booking.service && booking.service.title || 'Фотосессия' }}</h3>
            
            <div class="status-chip" [class]="getStatusClass(booking.status)">
              {{ getStatusText(booking.status) }}
            </div>
          </div>
          
          <mat-divider />
          
          <div class="details-section">
            <div class="detail-item">
              <mat-icon color="primary">event</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Дата</span>
                <span class="detail-value">{{ formatDate(booking.date) }}</span>
              </div>
            </div>
            
            <div class="detail-item">
              <mat-icon color="primary">schedule</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Время</span>
                <span class="detail-value">{{ formatTime(booking) }}</span>
              </div>
            </div>
            
            <div class="detail-item">
              <mat-icon color="primary">people</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Количество человек</span>
                <span class="detail-value">{{ booking.persons }}</span>
              </div>
            </div>
            
            <div class="detail-item">
              <mat-icon color="primary">photo_camera</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Фотограф</span>
                <span class="detail-value">{{ booking.photographerName || 'Не указан' }}</span>
              </div>
            </div>
          </div>
          
          <mat-divider />
          
          <div class="details-section payment-section">
            <div class="detail-item">
              <mat-icon color="primary">payments</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Стоимость</span>
                <span class="detail-value">{{ booking.totalPrice }} ₽</span>
              </div>
            </div>
            
            <div class="detail-item">
              <mat-icon color="primary">receipt</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Статус оплаты</span>
                <div class="payment-status-chip" [class]="getPaymentStatusClass(booking.paymentStatus)">
                  {{ getPaymentStatusText(booking.paymentStatus) }}
                </div>
              </div>
            </div>
            
            @if (booking.paymentMethod) {
              <div class="detail-item">
                <mat-icon color="primary">credit_card</mat-icon>
                <div class="detail-content">
                  <span class="detail-label">Способ оплаты</span>
                  <span class="detail-value">{{ getPaymentMethodText(booking.paymentMethod) }}</span>
                </div>
              </div>
            }
          </div>
          
          @if (booking.comments) {
            <mat-divider />
          }
          
          @if (booking.comments) {
            <div class="details-section">
              <div class="detail-item">
                <mat-icon color="primary">comment</mat-icon>
                <div class="detail-content">
                  <span class="detail-label">Комментарии</span>
                  <span class="detail-value comments">{{ booking.comments }}</span>
                </div>
              </div>
            </div>
          }
          
          <mat-divider />
          
          <div class="details-section client-info">
            <div class="detail-item">
              <mat-icon color="primary">person</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Клиент</span>
                <span class="detail-value">{{ getClientName() }}</span>
              </div>
            </div>
              <div class="detail-item">
              <mat-icon color="primary">phone</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Телефон</span>
                <span class="detail-value">{{ booking.clientInfo && booking.clientInfo.phone || 'Не указан' }}</span>
              </div>
            </div>
            
            <div class="detail-item">
              <mat-icon color="primary">email</mat-icon>
              <div class="detail-content">
                <span class="detail-label">Email</span>
                <span class="detail-value">{{ booking.clientInfo && booking.clientInfo.email || 'Не указан' }}</span>
              </div>
            </div>
          </div>
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions align="end">
        <button mat-button [mat-dialog-close]="false">Закрыть</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .booking-details-dialog {
      padding: 0;
    }
    
    .dialog-content {
      padding: 0;
    }
    
    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      
      .service-name {
        font-size: 1.25rem;
        font-weight: 500;
        margin: 0;
      }
    }
    
    .status-chip {
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 0.875rem;
      font-weight: 500;
      
      &.status-pending {
        background-color: #FFF8E1;
        color: #F57F17;
      }
      
      &.status-confirmed {
        background-color: #E8F5E9;
        color: #2E7D32;
      }
      
      &.status-completed {
        background-color: #E3F2FD;
        color: #1565C0;
      }
      
      &.status-cancelled {
        background-color: #FFEBEE;
        color: #C62828;
      }
    }
    
    .payment-status-chip {
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 0.875rem;
      font-weight: 500;
      display: inline-block;
      
      &.payment-paid {
        background-color: #E8F5E9;
        color: #2E7D32;
      }
      
      &.payment-pending {
        background-color: #FFF8E1;
        color: #F57F17;
      }
      
      &.payment-refunded {
        background-color: #E8EAF6;
        color: #3949AB;
      }
      
      &.payment-cancelled {
        background-color: #FFEBEE;
        color: #C62828;
      }
    }
    
    .details-section {
      padding: 16px 0;
    }
    
    .detail-item {
      display: flex;
      margin-bottom: 12px;
      
      &:last-child {
        margin-bottom: 0;
      }
      
      mat-icon {
        margin-right: 12px;
        color: var(--ed-accent, #f59e0b);
      }

      .detail-content {
        display: flex;
        flex-direction: column;
        
        .detail-label {
          font-size: 0.75rem;
          color: var(--ed-on-surface-variant, #a0a0a0);
          margin-bottom: 4px;
        }
        
        .detail-value {
          font-size: 1rem;
          
          &.comments {
            white-space: pre-line;
          }
        }
      }
    }
    
    mat-divider {
      margin: 0;
    }
  `]
})
export class BookingDetailsDialogComponent {
  dialogRef = inject<MatDialogRef<BookingDetailsDialogComponent>>(MatDialogRef);
  data = inject<BookingDetailsDialogData>(MAT_DIALOG_DATA);

  booking: Booking;
  
  constructor() {
    const data = this.data;

    this.booking = data.booking;
  }
  
  // Форматирование даты
  formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }
  
  // Форматирование времени
  formatTime(booking: Booking): string {
    const timeSlot = booking.timeSlot;
    return `${timeSlot.startTime} - ${timeSlot.endTime}`;
  }
  
  // Получение имени клиента
  getClientName(): string {
    if (!this.booking.clientInfo) return 'Не указано';
    
    const firstName = this.booking.clientInfo.firstName || '';
    const lastName = this.booking.clientInfo.lastName || '';
    
    if (firstName || lastName) {
      return `${firstName} ${lastName}`.trim();
    }
    
    return 'Не указано';
  }
  
  // Получение CSS класса для статуса бронирования
  getStatusClass(status: BookingStatus): string {
    switch(status) {
      case BookingStatus.PENDING:
        return 'status-pending';
      case BookingStatus.CONFIRMED:
        return 'status-confirmed';
      case BookingStatus.COMPLETED:
        return 'status-completed';
      case BookingStatus.CANCELLED:
        return 'status-cancelled';
      default:
        return '';
    }
  }
  
  // Получение текста статуса бронирования
  getStatusText(status: BookingStatus): string {
    switch(status) {
      case BookingStatus.PENDING:
        return 'Ожидает подтверждения';
      case BookingStatus.CONFIRMED:
        return 'Подтверждено';
      case BookingStatus.COMPLETED:
        return 'Завершено';
      case BookingStatus.CANCELLED:
        return 'Отменено';
      default:
        return 'Неизвестно';
    }
  }
  
  // Получение CSS класса для статуса оплаты
  getPaymentStatusClass(status: PaymentStatus): string {
    switch(status) {
      case PaymentStatus.PAID:
        return 'payment-paid';
      case PaymentStatus.PENDING:
        return 'payment-pending';
      case PaymentStatus.REFUNDED:
        return 'payment-refunded';
      default:
        return '';
    }
  }
  
  // Получение текста статуса оплаты
  getPaymentStatusText(status: PaymentStatus): string {
    switch(status) {
      case PaymentStatus.PAID:
        return 'Оплачено';
      case PaymentStatus.PENDING:
        return 'Ожидается оплата';
      case PaymentStatus.REFUNDED:
        return 'Возвращено';
      default:
        return 'Не оплачено';
    }
  }
  
  // Получение текста метода оплаты
  getPaymentMethodText(method: string): string {
    switch(method) {
      case 'card':
        return 'Банковская карта';
      case 'cash':
        return 'Наличные';
      case 'online':
        return 'Онлайн-оплата';
      default:
        return method || 'Не указан';
    }
  }
}
