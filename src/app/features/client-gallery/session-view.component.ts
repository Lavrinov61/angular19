import { Component, inject, signal, computed, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PhotoApiService, ClientPhotoSession } from '../../core/services/photo-api.service';
import { Photo, PhotoSession, PhotoComparison } from './types';
import { PhotoComparisonDialogComponent } from './photo-comparison-dialog.component';

@Component({
  selector: 'app-session-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatButtonToggleModule
  ],
  template: `
    <div class="session-view-container">
      @if (loading()) {
        <div class="loading-state">
          <mat-spinner diameter="50"></mat-spinner>
          <p>Загрузка фотосессии...</p>
        </div>
      } @else if (session()) {
        <!-- Заголовок сессии -->
        <div class="session-header">
          <button mat-icon-button (click)="goBack()" class="back-button">
            <mat-icon>arrow_back</mat-icon>
          </button>
          
          <div class="session-info">
            <h1>{{ session()!.title }}</h1>
            <div class="session-meta">
              <span class="date">{{ formatDate(session()!.date) }}</span>
              <span class="photographer">Фотограф: {{ session()!.photographer }}</span>
              <span class="photo-count">{{ photos().length }} фото</span>
            </div>
          </div>

          <div class="session-actions">
            <button mat-raised-button color="primary" (click)="downloadAll()">
              <mat-icon>download</mat-icon>
              Скачать все
            </button>
          </div>
        </div>

        <!-- Фильтры и настройки -->
        <div class="controls-panel">
          <mat-button-toggle-group 
            [value]="viewMode()" 
            (change)="setViewMode($event.value)"
            class="view-toggle">
            <mat-button-toggle value="grid">
              <mat-icon>grid_view</mat-icon>
              Сетка
            </mat-button-toggle>
            <mat-button-toggle value="comparison">
              <mat-icon>compare</mat-icon>
              Сравнение
            </mat-button-toggle>
          </mat-button-toggle-group>

          <mat-slide-toggle 
            [checked]="showOnlyProcessed()" 
            (change)="showOnlyProcessed.set($event.checked)"
            class="filter-toggle">
            Только обработанные
          </mat-slide-toggle>
        </div>

        <!-- Фотографии -->
        <div class="photos-content">
          @if (viewMode() === 'grid') {
            <!-- Сетка фотографий -->
            <div class="photos-grid">
              @for (photo of filteredPhotos(); track photo.id) {
                <div class="photo-card" [class.processed]="photo.status === 'processed'">
                  <div class="photo-container">
                    <img
                      [src]="photo.thumbnailUrl"
                      [alt]="'Фото ' + photo.id"
                      (click)="openPhotoComparison(photo)"
                      (keydown.enter)="openPhotoComparison(photo)"
                      tabindex="0"
                      loading="lazy"
                    />
                    
                    <!-- Статус обработки -->
                    <div class="photo-status">
                      @switch (photo.status) {
                        @case ('original') {
                          <mat-chip color="accent">Оригинал</mat-chip>
                        }
                        @case ('processed') {
                          <mat-chip color="primary">Обработано</mat-chip>
                        }
                        @case ('selected') {
                          <mat-chip color="primary">
                            <mat-icon>check_circle</mat-icon>
                            Выбрано
                          </mat-chip>
                        }
                      }
                    </div>

                    <!-- Действия с фото -->
                    <div class="photo-actions">
                      <button mat-mini-fab color="primary" (click)="downloadPhoto(photo)">
                        <mat-icon>download</mat-icon>
                      </button>
                      @if (photo.status === 'processed') {
                        <button mat-mini-fab color="accent" (click)="openPhotoComparison(photo)">
                          <mat-icon>compare</mat-icon>
                        </button>
                      }
                    </div>
                  </div>
                </div>
              }
            </div>
          } @else {
            <!-- Режим сравнения -->
            <div class="comparison-view">
              @for (comparison of photoComparisons(); track comparison.original.id) {
                <div class="comparison-card">
                  <div class="comparison-header">
                    <h3>Фото {{ comparison.original.id }}</h3>
                    @if (comparison.clientFeedback?.rating) {
                      <div class="rating">
                        @for (star of [1,2,3,4,5]; track star) {
                          <mat-icon [class.filled]="star <= comparison.clientFeedback!.rating!">
                            star
                          </mat-icon>
                        }
                      </div>
                    }
                  </div>

                  <div class="comparison-images">
                    <!-- Оригинал -->
                    <div class="image-container">
                      <h4>Оригинал</h4>
                      <img [src]="comparison.original.thumbnailUrl" alt="Оригинал" />
                    </div>

                    <!-- Обработанные версии -->
                    @for (processed of comparison.processed; track processed.id) {
                      <div class="image-container" [class.selected]="comparison.selectedVersion === processed.id">
                        <h4>{{ getProcessingType(processed) }}</h4>
                        <img [src]="processed.thumbnailUrl" alt="Обработанная версия" />
                        
                        @if (comparison.selectedVersion === processed.id) {
                          <div class="selection-badge">
                            <mat-icon>check_circle</mat-icon>
                            Выбрано
                          </div>
                        }
                      </div>
                    }
                  </div>
                  <div class="comparison-actions">
                    <button 
                      mat-raised-button 
                      color="primary"
                      (click)="openDetailedComparison(comparison)">
                      Подробное сравнение
                    </button>
                      @if (comparison.clientFeedback?.comment) {
                      <div class="feedback-comment">
                        <mat-icon>comment</mat-icon>
                        <span>{{ comparison.clientFeedback?.comment }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <div class="error-state">
          <mat-icon class="error-icon">error</mat-icon>
          <h3>Фотосессия не найдена</h3>
          <p>Возможно, ссылка неверна или у вас нет доступа к этой фотосессии</p>
          <button mat-raised-button color="primary" (click)="goBack()">
            Вернуться к галерее
          </button>
        </div>
      }
    </div>
  `,
  styleUrl: './session-view.component.scss'
})
export class SessionViewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private photoApiService = inject(PhotoApiService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  // Состояние компонента
  protected loading = signal(true);
  session = signal<PhotoSession | null>(null);
  photos = signal<Photo[]>([]);
  photoComparisons = signal<PhotoComparison[]>([]);
  viewMode = signal<'grid' | 'comparison'>('grid');
  protected showOnlyProcessed = signal(false);

  // Вычисляемые свойства
  protected filteredPhotos = computed(() => {
    const allPhotos = this.photos();
    return this.showOnlyProcessed() 
      ? allPhotos.filter(p => p.status === 'processed' || p.status === 'selected')
      : allPhotos;
  });

  sessionId = '';

  ngOnInit() {
    this.sessionId = this.route.snapshot.params['id'];
    this.loadSessionData();
  }

  async loadSessionData() {
    try {
      this.loading.set(true);
      
      // Получаем детали сессии и фотографии
      const [sessionResponse, photosResponse] = await Promise.all([
        firstValueFrom(this.photoApiService.getSessionDetails(this.sessionId)),
        firstValueFrom(this.photoApiService.getSessionPhotos(this.sessionId))
      ]);
      
      // Type guard для проверки данных
      if (sessionResponse.success && sessionResponse.data && photosResponse.success && photosResponse.data) {
        const sessionData: ClientPhotoSession = sessionResponse.data;
        const photosData: Photo[] = photosResponse.data;
        
        // Адаптируем ClientPhotoSession к PhotoSession
        // Преобразуем metadata для совместимости
        const adaptedPhotos: Photo[] = photosData.map((photo) => ({
          ...photo,
          metadata: photo.metadata ? {
            width: photo.metadata.width,
            height: photo.metadata.height,
            size: photo.metadata.size ?? photo.metadata.fileSize ?? 0,
            format: photo.metadata.format ?? 'unknown'
          } : undefined
        }));
        
        const adaptedSession: PhotoSession = {
          id: sessionData.id,
          title: sessionData.title,
          date: sessionData.date,
          photographer: sessionData.photographer,
          status: sessionData.status,
          photos: adaptedPhotos,
          processedPhotos: adaptedPhotos.filter((p: Photo) => p.status === 'processed').length,
          clientId: sessionData.clientId,
          photoCount: sessionData.photoCount
        };
        this.session.set(adaptedSession);
        this.photos.set(adaptedPhotos);
      }
      
      // Загружаем сравнения для обработанных фото
      await this.loadPhotoComparisons();
      
    } catch {
      this.snackBar.open('Ошибка загрузки фотосессии', 'Закрыть', {
        duration: 3000
      });
    } finally {
      this.loading.set(false);
    }
  }

  async loadPhotoComparisons() {
    try {
      // TODO: Реализовать получение сравнений фотографий
      // Пока устанавливаем пустой массив
      this.photoComparisons.set([]);
    } catch {
      // comparisons load failed
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

  setViewMode(mode: 'grid' | 'comparison') {
    this.viewMode.set(mode);
  }

  openPhotoComparison(photo: Photo) {
    const comparison = this.photoComparisons().find(c => c.original.id === photo.id);
    if (comparison) {
      this.openDetailedComparison(comparison);
    } else {
      // Открываем простой просмотр
      this.dialog.open(PhotoComparisonDialogComponent, {
        data: { photo },
        maxWidth: '90vw',
        maxHeight: '90vh'
      });
    }
  }

  openDetailedComparison(comparison: PhotoComparison) {
    this.dialog.open(PhotoComparisonDialogComponent, {
      data: { comparison },
      maxWidth: '95vw',
      maxHeight: '95vh'
    });
  }

  getProcessingType(photo: Photo): string {
    // Определяем тип обработки по processing.versions
    const versions = photo.processing?.versions;
    if (!versions) return 'Обработанное';
    
    if (versions.portrait) return 'Портретная';
    if (versions.vintage) return 'Винтажная';
    if (versions.bw) return 'Ч/Б';
    if (versions.color) return 'Цветокоррекция';
    
    return 'Обработанное';
  }

  async downloadPhoto(photo: Photo) {
    try {
      await this.photoApiService.downloadPhoto(photo.id);
      this.snackBar.open('Загрузка началась', 'Закрыть', {
        duration: 3000
      });
    } catch {
      this.snackBar.open('Ошибка скачивания', 'Закрыть', {
        duration: 3000
      });
    }
  }

  async downloadAll() {
    try {
      await this.photoApiService.downloadSession(this.sessionId);
      this.snackBar.open('Загрузка всех фото началась', 'Закрыть', {
        duration: 3000
      });
    } catch {
      this.snackBar.open('Ошибка скачивания', 'Закрыть', {
        duration: 3000
      });
    }
  }

  goBack() {
    this.router.navigate(['/client-gallery']);
  }
}
