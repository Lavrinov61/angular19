import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatRippleModule } from '@angular/material/core';

import { BookingApiService, MyBookingRecord } from '../../../../core/services/booking-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-user-bookings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatRippleModule,
  ],
  templateUrl: './user-bookings.component.html',
  styleUrl: './user-bookings.component.scss',
})
export class UserBookingsComponent {
  private readonly bookingApi = inject(BookingApiService);
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  protected readonly loading = signal(true);
  protected readonly bookings = signal<MyBookingRecord[]>([]);
  protected readonly expandedBookingId = signal<string | null>(null);

  protected readonly upcoming = computed(() => {
    const now = new Date();
    return this.bookings()
      .filter(b => new Date(b.start_time) >= now && b.status !== 'cancelled' && b.status !== 'no-show')
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  });

  protected readonly past = computed(() => {
    const now = new Date();
    return this.bookings()
      .filter(b => (new Date(b.start_time) < now && b.status !== 'cancelled') || b.status === 'completed')
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());
  });

  protected readonly cancelled = computed(() =>
    this.bookings()
      .filter(b => b.status === 'cancelled')
      .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()),
  );

  constructor() {
    this.loadBookings();
  }

  private loadBookings(): void {
    this.loading.set(true);
    this.bookingApi.getMyBookings().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.bookings.set(res.data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Не удалось загрузить записи', 'OK', { duration: 4000 });
        this.loading.set(false);
      },
    });
  }

  protected formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      timeZone: 'Europe/Moscow',
    });
  }

  protected formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Moscow',
    });
  }

  protected timeRange(b: MyBookingRecord): string {
    return `${this.formatTime(b.start_time)}, ${this.formatTime(b.end_time)}`;
  }

  protected statusLabel(s: string): string {
    const map: Record<string, string> = {
      pending: 'Ожидает',
      confirmed: 'Подтверждена',
      completed: 'Завершена',
      cancelled: 'Отменена',
      'no-show': 'Не явился',
    };
    return map[s] ?? s;
  }

  protected statusIcon(s: string): string {
    const map: Record<string, string> = {
      pending: 'schedule',
      confirmed: 'check_circle',
      completed: 'task_alt',
      cancelled: 'cancel',
      'no-show': 'person_off',
    };
    return map[s] ?? 'help';
  }

  protected isUpcoming(b: MyBookingRecord): boolean {
    return new Date(b.start_time) > new Date() && b.status !== 'cancelled' && b.status !== 'no-show';
  }

  protected getStudioAddress(b: MyBookingRecord): string {
    return b.studio_address || '';
  }

  protected showDetails(b: MyBookingRecord): void {
    this.expandedBookingId.set(
      this.expandedBookingId() === b.id ? null : b.id,
    );
  }

  protected cancelBooking(b: MyBookingRecord): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Отмена записи',
        message: `Отменить запись на ${this.formatDate(b.start_time)}, ${this.formatTime(b.start_time)}?`,
        confirmText: 'Отменить запись',
        confirmColor: 'warn',
      },
    });

    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.bookingApi.cancelBooking(b.id).subscribe({
        next: () => {
          this.snackBar.open('Запись отменена', 'OK', { duration: 3000 });
          this.loadBookings();
        },
        error: () => {
          this.snackBar.open('Не удалось отменить запись', 'OK', { duration: 4000 });
        },
      });
    });
  }
}
