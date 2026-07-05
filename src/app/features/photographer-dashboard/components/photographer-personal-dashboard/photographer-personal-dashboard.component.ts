import { Component, ChangeDetectionStrategy, inject, signal, computed, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { AuthService } from '../../../../core/services/auth.service';
import { PhotographerApiService } from '../../../../core/services/photographer-api.service';
import { firstValueFrom } from 'rxjs';

interface PhotographerStats {
  photographerId?: string;
  period?: string;
  bookings?: {
    total: number;
    completed: number;
    cancelled: number;
    completionRate: number;
  };
  revenue?: {
    total: number;
    average: number;
    currency: string;
  };
  schedule?: {
    studio: {
      totalShifts: number;
      bookedShifts: number;
    };
    event: {
      totalShifts: number;
      bookedShifts: number;
    };
  };
  // Простая структура для compatibility
  totalBookings?: number;
  completedBookings?: number;
  monthlyRevenue?: number;
  confirmedBookings?: number;
  cancelledBookings?: number;
  // Дополнительные поля из template
  activeServices?: number;
  totalRevenue?: number;
  averageRating?: number;
  totalReviews?: number;
  totalServices?: number;
}

@Component({
  selector: 'app-photographer-personal-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterModule,
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule
  ],
  template: `
    <div class="photographer-dashboard">
      <!-- Проверка авторизации -->
      @if (!isAuthorized()) {
        <div class="unauthorized-message">
          <mat-card appearance="outlined">
            <mat-card-header>
              <div mat-card-avatar class="error-avatar">
                <mat-icon>lock</mat-icon>
              </div>
              <mat-card-title>Доступ ограничен</mat-card-title>
              <mat-card-subtitle>Данная страница доступна только авторизованным фотографам</mat-card-subtitle>
            </mat-card-header>
            <mat-card-actions>
              <button mat-raised-button color="primary" routerLink="/auth/login">
                <mat-icon>login</mat-icon>
                Войти в систему
              </button>
            </mat-card-actions>
          </mat-card>
        </div>
      } @else {
        <!-- Загрузка -->
        @if (isLoading()) {
          <div class="loading-container">
            <mat-progress-spinner diameter="50" />
            <p>Загрузка данных...</p>
          </div>
        }

        <!-- Основной контент -->
        @if (!isLoading()) {
          <div class="dashboard-content">
          <!-- Заголовок с информацией о фотографе -->
          <mat-card class="welcome-card" appearance="outlined">
            <mat-card-header>
              <div mat-card-avatar class="photographer-avatar">
                <mat-icon>camera_alt</mat-icon>
              </div>
              <mat-card-title>Добро пожаловать, {{ currentUser()?.displayName }}!</mat-card-title>
              <mat-card-subtitle>
                Личный кабинет фотографа
                <mat-chip class="role-chip">{{ userRole() }}</mat-chip>
              </mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              <p>Здесь вы можете управлять своими услугами, расписанием и профилем.</p>
            </mat-card-content>
          </mat-card>

          <!-- Статистика -->
          <div class="stats-grid">
            <mat-card class="stat-card" appearance="outlined">
              <mat-card-content>
                <div class="stat-icon">
                  <mat-icon>business_center</mat-icon>
                </div>
                <div class="stat-info">                  <div class="stat-number">{{ stats()?.totalBookings || 0 }}</div>
                  <div class="stat-label">Всего смен</div>
                </div>
              </mat-card-content>
            </mat-card>

            <mat-card class="stat-card" appearance="outlined">
              <mat-card-content>
                <div class="stat-icon">
                  <mat-icon>event</mat-icon>
                </div>
                <div class="stat-info">                  <div class="stat-number">{{ stats()?.totalBookings || 0 }}</div>
                  <div class="stat-label">Всего бронирований</div>
                </div>
              </mat-card-content>
            </mat-card>

            <mat-card class="stat-card" appearance="outlined">
              <mat-card-content>
                <div class="stat-icon">
                  <mat-icon>check_circle</mat-icon>
                </div>
                <div class="stat-info">                  <div class="stat-number">{{ stats()?.completedBookings || 0 }}</div>
                  <div class="stat-label">Выполнено</div>
                </div>
              </mat-card-content>
            </mat-card>            <mat-card class="stat-card" appearance="outlined">
              <mat-card-content>
                <div class="stat-icon">
                  <mat-icon>monetization_on</mat-icon>
                </div>
                <div class="stat-info">
                  <div class="stat-number">{{ stats()?.monthlyRevenue || 0 }}₽</div>
                  <div class="stat-label">Доход</div>
                </div>
              </mat-card-content>
            </mat-card>

            <mat-card class="stat-card" appearance="outlined">
              <mat-card-content>
                <div class="stat-icon">
                  <mat-icon>star</mat-icon>
                </div>
                <div class="stat-info">
                  <div class="stat-number">{{ ((stats()?.completedBookings || 0) / (stats()?.totalBookings || 1) * 100).toFixed(1) || '0.0' }}</div>
                  <div class="stat-label">Коэффициент выполнения</div>
                </div>
              </mat-card-content>
            </mat-card>

            <mat-card class="stat-card" appearance="outlined">
              <mat-card-content>
                <div class="stat-icon">
                  <mat-icon>rate_review</mat-icon>
                </div>
                <div class="stat-info">
                  <div class="stat-number">{{ stats()?.cancelledBookings || 0 }}</div>
                  <div class="stat-label">Отменённых</div>
                </div>
              </mat-card-content>
            </mat-card>
          </div>

          <!-- Быстрые действия -->
          <mat-card class="actions-card" appearance="outlined">
            <mat-card-header>
              <mat-card-title>Быстрые действия</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <div class="actions-grid">
                <button mat-raised-button color="primary" routerLink="./services">
                  <mat-icon>settings</mat-icon>
                  Управление услугами
                </button>
                <button mat-raised-button routerLink="./schedule">
                  <mat-icon>schedule</mat-icon>
                  Расписание
                </button>
                <button mat-raised-button routerLink="./profile">
                  <mat-icon>person</mat-icon>
                  Редактировать профиль
                </button>
                <button mat-raised-button routerLink="./bookings">
                  <mat-icon>list</mat-icon>
                  Список бронирований
                </button>
              </div>
            </mat-card-content>
          </mat-card>
          </div>
        }
      }
    </div>
  `,
  styleUrls: ['./photographer-personal-dashboard.component.scss']
})
export class PhotographerPersonalDashboardComponent implements OnInit {
  private authService = inject(AuthService);
  private photographerApiService = inject(PhotographerApiService);

  // Signals
  private isLoadingSignal = signal(false);
  private statsSignal = signal<PhotographerStats | null>(null);

  // Computed properties
  readonly currentUser = this.authService.currentUser;
  readonly userRole = this.authService.userRole;
  readonly isLoading = this.isLoadingSignal.asReadonly();
  readonly stats = this.statsSignal.asReadonly();

  readonly isAuthorized = computed(() => {
    const user = this.currentUser();
    return user?.role === 'photographer' && user.uid; // Check for uid to ensure user object is loaded
  });

  ngOnInit() {
    if (this.isAuthorized()) {
      this.loadPhotographerData();
    }
  }
  private async loadPhotographerData() {
    this.isLoadingSignal.set(true);
    try {
      const currentUser = this.currentUser();
      if (!currentUser?.uid) {
        throw new Error('No user found for current user');
      }      // Получаем статистику фотографа и услуги
      const [statsResponse, servicesResponse] = await Promise.all([
        firstValueFrom(this.photographerApiService.getPhotographerStats()).catch(() => null),
        firstValueFrom(this.photographerApiService.getPhotographerServicesForManagement()).catch(() => null)
      ]);

      // Подсчитываем статистику услуг
      let totalServices = 0;
      let activeServices = 0;
      
      if (servicesResponse?.success && servicesResponse.data) {
        const svcData = servicesResponse.data;
        const rawServices = svcData['services'];
        if (Array.isArray(rawServices)) {
          totalServices = rawServices.length;
          activeServices = rawServices.filter((service: Record<string, unknown>) => service['isEnabled']).length;
        }
      }      // Объединяем статистику
      const backendData: PhotographerStats | null = (statsResponse?.success && statsResponse.data) ? statsResponse.data : null;
      
      const stats: PhotographerStats = {
        // Данные из backend в новом формате (с вложенными объектами)
        photographerId: backendData?.photographerId || '',
        period: backendData?.period || 'month',
        bookings: backendData?.bookings || {
          total: 0,
          completed: 0,
          cancelled: 0,
          completionRate: 0
        },
        revenue: backendData?.revenue || {
          total: 0,
          average: 0,
          currency: 'RUB'
        },
        schedule: backendData?.schedule || {
          studio: { totalShifts: 0, bookedShifts: 0 },
          event: { totalShifts: 0, bookedShifts: 0 }
        },        // Плоская структура для обратной совместимости (извлекаем из вложенных объектов)
        totalBookings: backendData?.bookings?.total || backendData?.totalBookings || 0,
        completedBookings: backendData?.bookings?.completed || backendData?.completedBookings || 0,
        cancelledBookings: backendData?.bookings?.cancelled || backendData?.cancelledBookings || 0,
        monthlyRevenue: backendData?.revenue?.total || backendData?.monthlyRevenue || 0,
        confirmedBookings: backendData?.bookings ? (backendData.bookings.total - backendData.bookings.cancelled) : (backendData?.confirmedBookings || 0),
        // Дополнительные поля
        activeServices: activeServices,
        totalServices: totalServices,
        totalRevenue: backendData?.revenue?.total || backendData?.totalRevenue || 0,
        averageRating: backendData?.averageRating || 5.0,
        totalReviews: backendData?.totalReviews || 0      };
      
      this.statsSignal.set(stats);
    } catch {
      // Fallback defaults
      this.statsSignal.set({
        totalBookings: 0,
        completedBookings: 0,
        monthlyRevenue: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        activeServices: 0,
        totalServices: 0,
        totalRevenue: 0,
        averageRating: 5.0,
        totalReviews: 0,
        bookings: {
          total: 0,
          completed: 0,
          cancelled: 0,
          completionRate: 0
        },
        revenue: {
          total: 0,
          average: 0,
          currency: 'RUB'
        },
        schedule: {
          studio: { totalShifts: 0, bookedShifts: 0 },
          event: { totalShifts: 0, bookedShifts: 0 }
        }
      });
    } finally {
      this.isLoadingSignal.set(false);
    }
  }
}







