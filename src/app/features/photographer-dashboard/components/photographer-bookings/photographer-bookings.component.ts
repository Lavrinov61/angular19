import { Component, ChangeDetectionStrategy, OnInit, inject, signal, computed } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTableModule } from '@angular/material/table';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatBadgeModule } from '@angular/material/badge';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { firstValueFrom } from 'rxjs';

import { BookingService } from '../../../booking/services/booking.service';
import { AuthService } from '../../../../core/services/auth.service';
import { LoggerService } from '../../../../core/services/logger.service';
import { Booking, BookingStatus, PaymentStatus } from '../../../../core/models/booking.model';

@Component({
  selector: 'app-photographer-bookings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DatePipe,
    RouterModule,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatTabsModule,
    MatTableModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatMenuModule,
    MatTooltipModule,
    MatBadgeModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatDividerModule
  ],
  template: `
    <div class="photographer-bookings-container">
      <!-- Header -->
      <div class="bookings-header">
        <div class="header-info">
          <h1>
            <mat-icon>event</mat-icon>
            Мои бронирования
          </h1>
          <p class="header-subtitle">
            Управление записями и расписанием
          </p>
        </div>

        <div class="header-actions">
          <mat-form-field appearance="outline" class="date-filter">
            <mat-label>Период</mat-label>
            <input 
              matInput 
              [matDatepicker]="picker"
              [(ngModel)]="selectedDate"
              (dateChange)="onDateFilterChange($event)">
            <mat-datepicker-toggle matSuffix [for]="picker"></mat-datepicker-toggle>
            <mat-datepicker #picker></mat-datepicker>
          </mat-form-field>

          <button 
            mat-raised-button 
            color="primary"
            (click)="refreshBookings()">
            <mat-icon>refresh</mat-icon>
            Обновить
          </button>
        </div>
      </div>

      <!-- Quick Stats -->
      <div class="quick-stats">
        <mat-card class="stat-card today">
          <mat-card-content>
            <div class="stat-icon">
              <mat-icon>today</mat-icon>
            </div>
            <div class="stat-info">
              <div class="stat-number">{{ todayStats().total }}</div>
              <div class="stat-label">Сегодня</div>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card pending">
          <mat-card-content>
            <div class="stat-icon">
              <mat-icon matBadge="{{ pendingBookings().length }}" matBadgeColor="warn">schedule</mat-icon>
            </div>
            <div class="stat-info">
              <div class="stat-number">{{ pendingBookings().length }}</div>
              <div class="stat-label">Ожидают</div>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card confirmed">
          <mat-card-content>
            <div class="stat-icon">
              <mat-icon>check_circle</mat-icon>
            </div>
            <div class="stat-info">
              <div class="stat-number">{{ confirmedBookings().length }}</div>
              <div class="stat-label">Подтверждены</div>
            </div>
          </mat-card-content>
        </mat-card>

        <mat-card class="stat-card earnings">
          <mat-card-content>
            <div class="stat-icon">
              <mat-icon>payments</mat-icon>
            </div>
            <div class="stat-info">
              <div class="stat-number">{{ weeklyEarnings() | currency:'RUB':'symbol':'1.0-0' }}</div>
              <div class="stat-label">За неделю</div>
            </div>
          </mat-card-content>
        </mat-card>
      </div>

      <!-- Loading State -->
      @if (isLoading()) {
        <div class="loading-container">
          <mat-progress-spinner mode="indeterminate"></mat-progress-spinner>
          <p>Загрузка бронирований...</p>
        </div>
      }

      <!-- Bookings Tabs -->
      @if (!isLoading()) {
        <mat-tab-group class="bookings-tabs">
        <!-- Today's Bookings -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>today</mat-icon>
            Сегодня
            @if (todayBookings().length > 0) {
              <span class="tab-badge">{{ todayBookings().length }}</span>
            }
          </ng-template>
          
          <div class="tab-content">
            @if (todayBookings().length === 0) {
              <div class="empty-state">
                <mat-icon>event_available</mat-icon>
                <h3>Нет записей на сегодня</h3>
                <p>Отличный день для отдыха или работы над портфолио!</p>
              </div>
            } @else {
              <div class="bookings-timeline">
                @for (booking of todayBookings(); track booking.id || $index) {
                  <div 
                    class="timeline-item"
                    [class.completed]="booking.status === 'completed'"
                    [class.pending]="booking.status === 'pending'">
                
                  <div class="timeline-time">
                    <div class="time">{{ booking.timeSlot.startTime }}</div>
                    <div class="duration">{{ booking.timeSlot.duration }}мин</div>
                  </div>

                  <div class="timeline-content">
                  <mat-card class="booking-card">
                    <mat-card-header>
                      <mat-card-title>
                        {{ booking.clientInfo.firstName }} {{ booking.clientInfo.lastName }}
                      </mat-card-title>
                      <mat-card-subtitle>
                        {{ getServiceName(booking.serviceId) }}
                      </mat-card-subtitle>
                    </mat-card-header>
                    
                    <mat-card-content>
                      <div class="booking-details">
                        <div class="detail-item">
                          <mat-icon>schedule</mat-icon>
                          <span>{{ booking.timeSlot.startTime }} - {{ booking.timeSlot.endTime }}</span>
                        </div>
                        
                        <div class="detail-item">
                          <mat-icon>people</mat-icon>
                          <span>{{ booking.persons }} чел.</span>
                        </div>
                        
                        <div class="detail-item">
                          <mat-icon>payments</mat-icon>
                          <span>{{ booking.totalPrice | currency:'RUB':'symbol':'1.0-0' }}</span>
                        </div>
                        
                        @if (booking.clientInfo.phone) {
                          <div class="detail-item">
                            <mat-icon>phone</mat-icon>
                            <span>{{ booking.clientInfo.phone }}</span>
                          </div>
                        }
                      </div>

                      <div class="booking-status">
                        <mat-chip 
                          [color]="getStatusColor(booking.status)"
                          [class]="'status-' + booking.status">
                          {{ getStatusLabel(booking.status) }}
                        </mat-chip>
                        
                        <mat-chip 
                          [color]="getPaymentStatusColor(booking.paymentStatus)"
                          [class]="'payment-' + booking.paymentStatus">
                          {{ getPaymentStatusLabel(booking.paymentStatus) }}
                        </mat-chip>
                      </div>

                      @if (booking.comments) {
                        <div class="booking-comments">
                          <mat-icon>comment</mat-icon>
                          <span>{{ booking.comments }}</span>
                        </div>
                      }
                    </mat-card-content>
                    
                    <mat-card-actions align="end">
                      <button 
                        mat-button 
                        [matMenuTriggerFor]="bookingActionsMenu"
                        [matMenuTriggerData]="{booking: booking}">
                        <mat-icon>more_vert</mat-icon>
                        Действия
                      </button>
                    </mat-card-actions>
                  </mat-card>
                  </div>
                </div>
                }
              </div>
            }
          </div>
        </mat-tab>

        <!-- All Bookings -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>event</mat-icon>
            Все записи
            @if (allBookings().length > 0) {
              <span class="tab-badge">{{ allBookings().length }}</span>
            }
          </ng-template>
          
          <div class="tab-content">
            <div class="bookings-list">
              @for (booking of allBookings(); track booking.id || $index) {
                <mat-card 
                  class="booking-list-item">
                
                <mat-card-header>
                  <div mat-card-avatar class="booking-avatar">
                    <mat-icon>person</mat-icon>
                  </div>
                  
                  <mat-card-title>
                    {{ booking.clientInfo.firstName }} {{ booking.clientInfo.lastName }}
                  </mat-card-title>
                  
                  <mat-card-subtitle>
                    {{ booking.date | date:'dd MMMM yyyy, EEEE':'ru' }} в {{ booking.timeSlot.startTime }}
                  </mat-card-subtitle>
                </mat-card-header>
                
                <mat-card-content>
                  <div class="booking-summary">
                    <div class="summary-item">
                      <span class="label">Услуга:</span>
                      <span class="value">{{ getServiceName(booking.serviceId) }}</span>
                    </div>
                    
                    <div class="summary-item">
                      <span class="label">Участники:</span>
                      <span class="value">{{ booking.persons }} чел.</span>
                    </div>
                    
                    <div class="summary-item">
                      <span class="label">Стоимость:</span>
                      <span class="value">{{ booking.totalPrice | currency:'RUB':'symbol':'1.0-0' }}</span>
                    </div>
                    
                    <div class="summary-item">
                      <span class="label">Статус:</span>
                      <mat-chip [color]="getStatusColor(booking.status)">
                        {{ getStatusLabel(booking.status) }}
                      </mat-chip>
                    </div>
                  </div>
                </mat-card-content>
                
                <mat-card-actions align="end">
                  <button mat-button color="primary" (click)="viewBookingDetails(booking)">
                    <mat-icon>visibility</mat-icon>
                    Подробнее
                  </button>
                  
                  <button 
                    mat-button 
                    [matMenuTriggerFor]="bookingActionsMenu"
                    [matMenuTriggerData]="{booking: booking}">
                    <mat-icon>more_vert</mat-icon>
                  </button>
                </mat-card-actions>
              </mat-card>
              }
            </div>
          </div>
        </mat-tab>

        <!-- Calendar View -->
        <mat-tab>
          <ng-template mat-tab-label>
            <mat-icon>calendar_month</mat-icon>
            Календарь
          </ng-template>
          
          <div class="tab-content">
            <div class="calendar-placeholder">
              <mat-icon>calendar_month</mat-icon>
              <h3>Календарь бронирований</h3>
              <p>Здесь будет календарный вид всех ваших записей</p>
              <button mat-raised-button color="primary">
                Открыть календарь
              </button>
            </div>
          </div>
        </mat-tab>
        </mat-tab-group>
      }

      <!-- Booking Actions Menu -->
      <mat-menu #bookingActionsMenu="matMenu">
        <ng-template matMenuContent let-booking="booking">
          @if (booking.status === 'pending') {
            <button mat-menu-item (click)="confirmBooking(booking)">
              <mat-icon>check</mat-icon>
              <span>Подтвердить</span>
            </button>
          }
          
          @if (booking.status === 'confirmed') {
            <button mat-menu-item (click)="completeBooking(booking)">
              <mat-icon>done_all</mat-icon>
              <span>Завершить</span>
            </button>
          }
          
          <button mat-menu-item (click)="rescheduleBooking(booking)">
            <mat-icon>schedule</mat-icon>
            <span>Перенести</span>
          </button>
          
          <button mat-menu-item (click)="callClient(booking)">
            <mat-icon>phone</mat-icon>
            <span>Позвонить клиенту</span>
          </button>
          
          <button mat-menu-item (click)="sendMessage(booking)">
            <mat-icon>message</mat-icon>
            <span>Написать сообщение</span>
          </button>
          
          <mat-divider></mat-divider>
          
          <button mat-menu-item (click)="cancelBooking(booking)" class="warn-action">
            <mat-icon>cancel</mat-icon>
            <span>Отменить</span>
          </button>
        </ng-template>
      </mat-menu>
    </div>
  `,
  styleUrl: './photographer-bookings.component.scss'
})
export class PhotographerBookingsComponent implements OnInit {
  private bookingService = inject(BookingService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private log = inject(LoggerService);

  // Signals
  protected isLoading = signal(false);
  allBookings = signal<Booking[]>([]);
  selectedDate = new Date();

  // Computed
  protected todayBookings = computed(() => {
    const today = new Date().toDateString();
    return this.allBookings().filter(booking => 
      new Date(booking.date).toDateString() === today
    ).sort((a, b) => 
      a.timeSlot.startTime.localeCompare(b.timeSlot.startTime)
    );
  });

  protected pendingBookings = computed(() => 
    this.allBookings().filter(booking => booking.status === BookingStatus.PENDING)
  );

  protected confirmedBookings = computed(() => 
    this.allBookings().filter(booking => booking.status === BookingStatus.CONFIRMED)
  );

  protected todayStats = computed(() => {
    const today = this.todayBookings();
    return {
      total: today.length,
      completed: today.filter(b => b.status === BookingStatus.COMPLETED).length,
      pending: today.filter(b => b.status === BookingStatus.PENDING).length,
      confirmed: today.filter(b => b.status === BookingStatus.CONFIRMED).length
    };
  });

  protected weeklyEarnings = computed(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    return this.allBookings()
      .filter(booking => 
        new Date(booking.date) >= weekAgo && 
        booking.paymentStatus === PaymentStatus.PAID
      )
      .reduce((total, booking) => total + booking.totalPrice, 0);
  });

  ngOnInit() {
    this.loadBookings();
  }

  private async loadBookings() {
    this.isLoading.set(true);
    
    try {
      // In real app, filter by photographer ID
      const bookings = await firstValueFrom(this.bookingService.getBookings());
      this.allBookings.set(bookings);
    } catch (error) {
      this.log.error('Error loading bookings:', error);
      this.snackBar.open('Ошибка загрузки бронирований', 'Закрыть', { duration: 3000 });
    } finally {
      this.isLoading.set(false);
    }
  }

  refreshBookings() {
    this.loadBookings();
    this.snackBar.open('Данные обновлены', 'Закрыть', { duration: 2000 });
  }

  onDateFilterChange(event: unknown) {
    // TODO: Implement date filtering
    this.log.debug('Date filter changed:', event);
  }

  // Booking Actions
  async confirmBooking(booking: Booking) {
    try {
      // TODO: Implement booking confirmation
      this.log.debug('Confirming booking:', booking.id);
      this.snackBar.open('Бронирование подтверждено', 'Закрыть', { duration: 2000 });
    } catch (_error) {
      this.snackBar.open('Ошибка подтверждения', 'Закрыть', { duration: 3000 });
    }
  }

  async completeBooking(booking: Booking) {
    try {
      // TODO: Implement booking completion
      this.log.debug('Completing booking:', booking.id);
      this.snackBar.open('Фотосессия завершена', 'Закрыть', { duration: 2000 });
    } catch (_error) {
      this.snackBar.open('Ошибка завершения', 'Закрыть', { duration: 3000 });
    }
  }

  rescheduleBooking(booking: Booking) {
    // TODO: Open reschedule dialog
    this.log.debug('Reschedule booking:', booking.id);
    this.snackBar.open('Функция переноса в разработке', 'Закрыть', { duration: 2000 });
  }

  cancelBooking(booking: Booking) {
    // TODO: Implement booking cancellation
    this.log.debug('Cancel booking:', booking.id);
    this.snackBar.open('Бронирование отменено', 'Закрыть', { duration: 2000 });
  }

  callClient(booking: Booking) {
    if (booking.clientInfo.phone) {
      window.open(`tel:${booking.clientInfo.phone}`);
    } else {
      this.snackBar.open('Номер телефона не указан', 'Закрыть', { duration: 2000 });
    }
  }

  sendMessage(booking: Booking) {
    // TODO: Open message dialog
    this.log.debug('Send message to:', booking.clientInfo);
    this.snackBar.open('Функция сообщений в разработке', 'Закрыть', { duration: 2000 });
  }

  viewBookingDetails(booking: Booking) {
    // TODO: Open booking details dialog
    this.log.debug('View booking details:', booking);
  }

  // Helper methods
  getServiceName(_serviceId: string): string {
    // TODO: Get from services data
    return 'Фотосессия'; // Placeholder
  }

  getStatusLabel(status: BookingStatus): string {
    const labels = {
      [BookingStatus.PENDING]: 'Ожидает',
      [BookingStatus.CONFIRMED]: 'Подтверждено',
      [BookingStatus.COMPLETED]: 'Завершено',
      [BookingStatus.CANCELLED]: 'Отменено',
      [BookingStatus.NO_SHOW]: 'Не явился',
      [BookingStatus.RESCHEDULED]: 'Перенесено'
    };
    return labels[status] || status;
  }

  getStatusColor(status: BookingStatus): string {
    switch (status) {
      case BookingStatus.CONFIRMED:
        return 'primary';
      case BookingStatus.COMPLETED:
        return 'accent';
      case BookingStatus.CANCELLED:
      case BookingStatus.NO_SHOW:
        return 'warn';
      default:
        return '';
    }
  }

  getPaymentStatusLabel(status: PaymentStatus): string {
    const labels = {
      [PaymentStatus.PENDING]: 'Ожидает оплаты',
      [PaymentStatus.PAID]: 'Оплачено',
      [PaymentStatus.PARTIALLY_PAID]: 'Частично оплачено',
      [PaymentStatus.REFUNDED]: 'Возвращено',
      [PaymentStatus.FAILED]: 'Ошибка оплаты'
    };
    return labels[status] || status;
  }

  getPaymentStatusColor(status: PaymentStatus): string {
    switch (status) {
      case PaymentStatus.PAID:
        return 'accent';
      case PaymentStatus.FAILED:
        return 'warn';
      default:
        return '';
    }
  }

}
