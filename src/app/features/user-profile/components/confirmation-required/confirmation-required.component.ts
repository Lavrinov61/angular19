import { Component, OnInit, OnDestroy, signal, computed, inject, ChangeDetectionStrategy } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { Subject } from 'rxjs';

import { BookingApiService } from '../../../../core/services/booking-api.service';
import { AuthService } from '../../../../core/services/auth.service';

interface PendingRetouch {
  id: string;
  clientName: string;
  sessionDate: Date;
  sessionType: string;
  previewImages: string[];
  totalImages: number;
  status: 'pending' | 'approved' | 'revision_requested';
  createdAt: Date;
  deadline: Date;
  notes?: string;
  clientComments?: string[];
  photographerNotes?: string;
  clientId?: string;
}



@Component({
  selector: 'app-confirmation-required',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTabsModule,
    MatBadgeModule,
    MatTooltipModule,
    MatDividerModule
],  templateUrl: './confirmation-required.component.html',
  styleUrls: ['./confirmation-required.component.scss']
})
export class ConfirmationRequiredComponent implements OnInit, OnDestroy {  // Инъекции
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private bookingApiService = inject(BookingApiService);
  private authService = inject(AuthService);
  private destroy$ = new Subject<void>();

  // Signals
  allRetouches = signal<PendingRetouch[]>([]);
  protected loading = signal(true);
  protected selectedTabIndex = signal(0);
  firebaseError = signal<string | null>(null);

  // Computed values
  protected pendingRetouches = computed(() =>
    this.allRetouches().filter(r => r.status === 'pending')
  );

  protected processedRetouches = computed(() =>
    this.allRetouches().filter(r => r.status !== 'pending')
  );

  protected pendingCount = computed(() => this.pendingRetouches().length);

  ngOnInit() {
    this.loadRetouches();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }  private async loadRetouches() {
    try {
      this.loading.set(true);
      this.firebaseError.set(null);

      // Получаем текущего пользователя
      const currentUser = this.authService.user();
      if (!currentUser) {
        this.firebaseError.set('Требуется авторизация');
        this.loading.set(false);
        return;
      }      // Получаем заявки на подтверждение через BookingApiService
      const response = await this.bookingApiService.getClientBookings(currentUser.id).toPromise();
      
      if (!response || !response.data) {
        this.firebaseError.set('Нет данных для отображения');
        this.loading.set(false);
        return;
      }      // Конвертируем данные API в формат компонента
      const retouches: PendingRetouch[] = response.data.map(booking => ({
        id: booking.id,
        clientName: 'Клиент',
        sessionDate: new Date(booking.date),
        sessionType: booking.service?.name || 'Фотосессия',
        previewImages: [], // Добавим позже если нужно
        totalImages: 0, // Добавим позже если нужно
        status: booking.status === 'pending' ? 'pending' : 'approved',
        createdAt: new Date(booking.createdAt),
        deadline: new Date(booking.date), // Используем дату сессии как дедлайн        notes: booking.comments || '',
        clientComments: [],
        photographerNotes: '',
        clientId: booking.id
      }));

      this.allRetouches.set(retouches);
      
      if (retouches.length === 0) {
        this.firebaseError.set('Нет данных для отображения');
      }
    } catch (error) {
      this.firebaseError.set(`Ошибка загрузки данных: ${(error as Error).message}`);
    } finally {
      this.loading.set(false);
    }
  }  onTabChange(index: number) {
    this.selectedTabIndex.set(index);
  }

  openDetailView(_retouch: PendingRetouch) {
    // TODO: Открыть модальное окно с детальным просмотром фотографий
    this.snackBar.open('Детальный просмотр будет реализован в следующей версии', 'Закрыть', { duration: 2000 });
  }
  async approveRetouch(retouch: PendingRetouch) {
    try {
      // Обновляем локальное состояние
      const updatedRetouches = this.allRetouches().map(r =>
        r.id === retouch.id ? { ...r, status: 'approved' as const } : r
      );
      this.allRetouches.set(updatedRetouches);

      // Подтверждаем бронирование через API
      await this.bookingApiService.confirmBooking(retouch.id).toPromise();

      this.snackBar.open(`Ретушь для ${retouch.clientName} одобрена`, 'Закрыть', { duration: 3000 });
    } catch {
      this.snackBar.open('Ошибка при обновлении статуса ретуши', 'Закрыть', { duration: 3000 });
    }
  }

  async requestRevision(retouch: PendingRetouch) {
    try {
      // Обновляем локальное состояние
      const updatedRetouches = this.allRetouches().map(r =>
        r.id === retouch.id ? { ...r, status: 'revision_requested' as const } : r
      );
      this.allRetouches.set(updatedRetouches);

      // Отменяем бронирование через API (как запрос на пересмотр)
      await this.bookingApiService.cancelBooking(retouch.id).toPromise();

      this.snackBar.open(`Запрошены изменения для ${retouch.clientName}`, 'Закрыть', { duration: 3000 });
    } catch {
      this.snackBar.open('Ошибка при запросе изменений', 'Закрыть', { duration: 3000 });
    }
  }

  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  }

  getStatusColor(status: string): 'primary' | 'accent' | 'warn' {
    switch (status) {
      case 'approved': return 'primary';
      case 'revision_requested': return 'warn';
      default: return 'accent';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'approved': return 'check_circle';
      case 'revision_requested': return 'edit';
      default: return 'pending';
    }
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'approved': return 'Одобрено';
      case 'revision_requested': return 'Требуются изменения';
      default: return 'Ожидает';
    }
  }
}
