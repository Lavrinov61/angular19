import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { switchMap, of, map } from 'rxjs';
import { BookingService } from '../../services/booking.service';
import { BOOKING_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '../../../../core/models/booking.model';
import { LoggerService } from '../../../../core/services/logger.service';

@Component({
  selector: 'app-booking-confirmation',
  
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    RouterLink
],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="confirmation-container">
      @if (booking(); as booking) {
        <mat-card class="confirmation-card">
          <mat-card-header>
            <div class="success-icon">
              <mat-icon>check_circle</mat-icon>
            </div>
            <mat-card-title>Запись успешно создана!</mat-card-title>
            <mat-card-subtitle>
              Код подтверждения: <strong>{{ booking.confirmationCode }}</strong>
            </mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            <div class="booking-details">
              <div class="detail-section">
                <h3>
                  <mat-icon>photo_camera</mat-icon>
                  Услуга
                </h3>
                <p><strong>{{ booking.service?.title }}</strong></p>
                <p>{{ booking.service?.description }}</p>
                @if (booking.totalPrice > 0) {
                  <p class="price">Стоимость: <strong>{{ booking.totalPrice }}₽</strong></p>
                }
              </div>

              <mat-divider />

              <div class="detail-section">
                <h3>
                  <mat-icon>event</mat-icon>
                  Дата и время
                </h3>
                <p><strong>{{ formatDate(booking.date) }}</strong></p>
                <p>{{ booking.timeSlot.startTime }} - {{ booking.timeSlot.endTime }}</p>
                <p>Длительность: {{ booking.timeSlot.duration }} минут</p>
              </div>

              <mat-divider />

              <div class="detail-section">
                <h3>
                  <mat-icon>person</mat-icon>
                  Контактные данные
                </h3>
                <p><strong>{{ booking.clientInfo.firstName }} {{ booking.clientInfo.lastName }}</strong></p>
                <p>Телефон: {{ booking.clientInfo.phone }}</p>
                <p>Email: {{ booking.clientInfo.email }}</p>
                <p>Количество человек: {{ booking.persons }}</p>
                @if (booking.comments) {
                  <p>Комментарий: {{ booking.comments }}</p>
                }
              </div>

              <mat-divider />

              <div class="detail-section">
                <h3>
                  <mat-icon>info</mat-icon>
                  Статус записи
                </h3>
                <div class="status-info">
                  <div class="status-badge" [class.pending]="booking.status === 'pending'" 
                       [class.confirmed]="booking.status === 'confirmed'">
                    {{ getStatusLabel(booking.status) }}
                  </div>
                  <div class="payment-status">
                    Оплата: {{ getPaymentStatusLabel(booking.paymentStatus) }}
                  </div>
                </div>
              </div>
            </div>

            <div class="next-steps">
              <h3>Что дальше?</h3>
              <div class="steps-list">
                <div class="step">
                  <mat-icon>notifications</mat-icon>
                  <div class="step-content">
                    <h4>Ожидайте подтверждения</h4>
                    <p>Мы свяжемся с вами в течение 1-2 часов для подтверждения записи</p>
                  </div>
                </div>
                
                <div class="step">
                  <mat-icon>payment</mat-icon>
                  <div class="step-content">
                    <h4>Оплата</h4>
                    <p>Оплата производится в студии наличными или картой</p>
                  </div>
                </div>
                
                <div class="step">
                  <mat-icon>camera_alt</mat-icon>
                  <div class="step-content">
                    <h4>Фотосессия</h4>
                    <p>Приходите в назначенное время. Мы вас ждем!</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="contact-info">
              <h3>Контакты студии</h3>
              <div class="contacts-grid">
                <div class="contact-item">
                  <mat-icon>phone</mat-icon>
                  <div>
                    <strong>Телефон</strong>
                    <p>+7 (999) 123-45-67</p>
                  </div>
                </div>
                  <div class="contact-item">
                  <mat-icon>location_on</mat-icon>
                  <div>
                    <strong>Адрес</strong>
                    <p>г. Ростов-на-Дону, ул. Примерная, д. 123</p>
                  </div>
                </div>
                
                <div class="contact-item">
                  <mat-icon>schedule</mat-icon>
                  <div>
                    <strong>Режим работы</strong>
                    <p>Пн-Пт: 9:00-20:00<br>Сб: 10:00-18:00</p>
                  </div>
                </div>
              </div>
            </div>
          </mat-card-content>

          <mat-card-actions>
            <button mat-button routerLink="/">
              <mat-icon>home</mat-icon>
              На главную
            </button>
            <button mat-button routerLink="/services">
              <mat-icon>photo_camera</mat-icon>
              Другие услуги
            </button>
            <button mat-raised-button color="primary" (click)="downloadConfirmation()">
              <mat-icon>download</mat-icon>
              Скачать подтверждение
            </button>
          </mat-card-actions>
        </mat-card>
      } @else {
        <mat-card class="error-card">
          <mat-card-header>
            <div class="error-icon">
              <mat-icon>error</mat-icon>
            </div>
            <mat-card-title>Запись не найдена</mat-card-title>
            <mat-card-subtitle>
              Возможно, ссылка устарела или запись была удалена
            </mat-card-subtitle>
          </mat-card-header>
          
          <mat-card-actions>
            <button mat-raised-button color="primary" routerLink="/booking">
              <mat-icon>add</mat-icon>
              Создать новую запись
            </button>
            <button mat-button routerLink="/">
              <mat-icon>home</mat-icon>
              На главную
            </button>
          </mat-card-actions>
        </mat-card>
      }
    </div>
  `,
  styleUrl: './booking-confirmation.component.scss'
})
export class BookingConfirmationComponent {
  private route = inject(ActivatedRoute);
  private bookingService = inject(BookingService);
  private log = inject(LoggerService);

  // Преобразуем queryParams в signal реактивно
  private bookingId = toSignal(
    this.route.queryParams.pipe(
      map(params => params['id'] || null)
    ),
    { initialValue: null }
  );

  // Преобразуем Observable в signal
  booking = toSignal(
    toObservable(this.bookingId).pipe(
      switchMap(id => id ? this.bookingService.getBookingById(id) : of(undefined))
    ),
    { initialValue: undefined }
  );

  formatDate(date: Date | string): string {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(dateObj);
  }

  getStatusLabel(status: string): string {
    return BOOKING_STATUS_LABELS[status as keyof typeof BOOKING_STATUS_LABELS] || status;
  }

  getPaymentStatusLabel(status: string): string {
    return PAYMENT_STATUS_LABELS[status as keyof typeof PAYMENT_STATUS_LABELS] || status;
  }

  downloadConfirmation() {
    // TODO: Implement PDF generation
    this.log.debug('Download confirmation PDF');
  }
}
