import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PhotoApiService } from '../../core/services/photo-api.service';
import { NotificationService } from '../../core/services/notification.service';

export interface PhotoSession {
  id: string;
  title: string;
  date: string;
  status: 'processing' | 'ready' | 'delivered';
  photoCount: number;
  thumbnailUrl?: string;
  sessionType: string;
  photographer: string;
}

export interface Photo {
  id: string;
  sessionId: string;
  originalUrl: string;
  processedUrl?: string;
  thumbnailUrl: string;
  status: 'original' | 'processed' | 'selected';
  uploadedAt: string;
  processing?: {
    status: 'pending' | 'completed' | 'failed';
    processedAt?: string;
    versions?: {
      color?: string;
      bw?: string;
      vintage?: string;
      portrait?: string;
    };
  };
}

@Component({
  selector: 'app-client-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule
  ],
  template: `
    <div class="gallery-container">
      <div class="gallery-header">
        <div class="header-content">
          <h1>Моя галерея</h1>
          <p class="subtitle">Ваши фотосессии и обработанные снимки</p>
        </div>
        
        <!-- Уведомления о новых фото -->
        @if (notifications().length > 0) {
          <div class="notifications">
            <mat-icon class="notification-icon">notifications</mat-icon>
            <span>У вас {{ notifications().length }} новых обработанных фото</span>
            <button mat-button color="primary" (click)="markNotificationsRead()">
              Посмотреть
            </button>
          </div>
        }
      </div>

      <div class="gallery-content">
        @if (loading()) {
          <div class="loading-state">
            <mat-spinner diameter="50"></mat-spinner>
            <p>Загрузка ваших фотосессий...</p>
          </div>
        } @else if (sessions().length === 0) {
          <div class="empty-state">
            <mat-icon class="empty-icon">photo_library</mat-icon>
            <h3>Пока нет фотосессий</h3>
            <p>Ваши фотосессии появятся здесь после съемки</p>
            <button mat-raised-button color="primary" (click)="goToBooking()">
              Записаться на съемку
            </button>
          </div>
        } @else {
          <div class="sessions-grid">
            @for (session of sessions(); track session.id) {
              <mat-card class="session-card" [class]="'status-' + session.status">
                <div class="session-thumbnail">                  @if (session.thumbnailUrl) {
                    <img [src]="session.thumbnailUrl" [alt]="session.title" class="gallery-image" />
                  } @else {
                    <div class="placeholder-thumbnail">
                      <mat-icon>photo_camera</mat-icon>
                    </div>
                  }
                  
                  <!-- Статус обработки -->
                  <div class="status-badge">
                    @switch (session.status) {
                      @case ('processing') {
                        <mat-icon>hourglass_empty</mat-icon>
                        <span>Обрабатывается</span>
                      }
                      @case ('ready') {
                        <mat-icon>check_circle</mat-icon>
                        <span>Готово</span>
                      }
                      @case ('delivered') {
                        <mat-icon>download_done</mat-icon>
                        <span>Получено</span>
                      }
                    }
                  </div>
                </div>

                <mat-card-header>
                  <mat-card-title>{{ session.title }}</mat-card-title>
                  <mat-card-subtitle>
                    <div class="session-meta">
                      <span class="date">{{ formatDate(session.date) }}</span>
                      <span class="photographer">{{ session.photographer }}</span>
                    </div>
                  </mat-card-subtitle>
                </mat-card-header>

                <mat-card-content>
                  <div class="session-info">
                    <mat-chip-set>
                      <mat-chip>{{ session.sessionType }}</mat-chip>
                      <mat-chip>{{ session.photoCount }} фото</mat-chip>
                    </mat-chip-set>
                  </div>
                </mat-card-content>

                <mat-card-actions>
                  @if (session.status === 'ready' || session.status === 'delivered') {
                    <button mat-button color="primary" (click)="viewSession(session.id)">
                      Смотреть фото
                    </button>
                    <button mat-button (click)="downloadSession(session.id)">
                      <mat-icon>download</mat-icon>
                      Скачать
                    </button>
                  } @else {
                    <button mat-button disabled>
                      Ожидание обработки
                    </button>
                  }
                </mat-card-actions>
              </mat-card>
            }
          </div>
        }
      </div>
    </div>
  `,
  styleUrl: './client-gallery.component.scss'
})
export class ClientGalleryComponent implements OnInit {
  private authService = inject(AuthService);
  private photoService = inject(PhotoApiService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private notificationService = inject(NotificationService);

  // Состояние компонента
  protected loading = signal(true);
  sessions = signal<PhotoSession[]>([]);
  notifications = signal<PhotoSession[]>([]);

  user = this.authService.user;

  ngOnInit() {
    this.loadSessions();
    this.loadNotifications();
  }

  async loadSessions() {
    try {
      this.loading.set(true);
      const userSessions = await this.photoService.getUserSessions();
      this.sessions.set(userSessions);
    } catch {
      this.snackBar.open('Ошибка загрузки фотосессий', 'Закрыть', {
        duration: 3000
      });
    } finally {
      this.loading.set(false);
    }
  }

  async loadNotifications() {
    try {
      const newSessions = await this.photoService.getNewProcessedSessions();
      this.notifications.set(newSessions);
    } catch {
      // notifications load failed
    }
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  viewSession(sessionId: string) {
    this.router.navigate(['/client-gallery/session', sessionId]);
  }

  async downloadSession(sessionId: string) {
    try {
      await this.photoService.downloadSession(sessionId);
      this.snackBar.open('Загрузка началась', 'Закрыть', {
        duration: 3000
      });
    } catch {
      this.snackBar.open('Ошибка скачивания', 'Закрыть', {
        duration: 3000
      });
    }
  }

  markNotificationsRead() {
    this.notifications.set([]);
    this.notificationService.markAllAsRead().subscribe();
  }

  goToBooking() {
    this.router.navigate(['/booking']);
  }
}
