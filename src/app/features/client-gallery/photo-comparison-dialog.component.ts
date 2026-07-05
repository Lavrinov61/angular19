import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { PhotoApiService } from '../../core/services/photo-api.service';
import { Photo, PhotoComparison } from './types';

interface DialogData {
  photo?: Photo;
  comparison?: PhotoComparison;
}

@Component({
  selector: 'app-photo-comparison-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatSliderModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSnackBarModule
  ],
  template: `
    <div class="comparison-dialog">
      <div class="dialog-header">
        <h2 mat-dialog-title>
          {{ data.comparison ? 'Сравнение версий' : 'Просмотр фото' }}
        </h2>
        <button mat-icon-button mat-dialog-close>
          <mat-icon>close</mat-icon>
        </button>
      </div>

      <div mat-dialog-content class="dialog-content">
        @if (data.comparison) {
          <!-- Детальное сравнение -->
          <div class="comparison-container">
            <!-- Контролы сравнения -->
            <div class="comparison-controls">
              <mat-button-toggle-group 
                [value]="comparisonMode()" 
                (change)="setComparisonMode($event.value)"
                class="mode-toggle">
                <mat-button-toggle value="side-by-side">
                  <mat-icon>view_column</mat-icon>
                  Рядом
                </mat-button-toggle>
                <mat-button-toggle value="overlay">
                  <mat-icon>layers</mat-icon>
                  Наложение
                </mat-button-toggle>
                <mat-button-toggle value="slider">
                  <mat-icon>compare</mat-icon>
                  Слайдер
                </mat-button-toggle>
              </mat-button-toggle-group>

              <!-- Выбор версий для сравнения -->
              <div class="version-selector">
                <mat-button-toggle-group 
                  [value]="selectedVersion()" 
                  (change)="setSelectedVersion($event.value)">
                  <mat-button-toggle value="original">
                    Оригинал
                  </mat-button-toggle>
                  @for (processed of data.comparison.processed; track processed.id) {
                    <mat-button-toggle [value]="processed.id">
                      {{ getProcessingType(processed) }}
                    </mat-button-toggle>
                  }
                </mat-button-toggle-group>
              </div>
            </div>

            <!-- Область сравнения -->
            <div class="comparison-area" [class]="comparisonMode()">
              @switch (comparisonMode()) {
                @case ('side-by-side') {
                  <div class="side-by-side">
                    <div class="image-panel">
                      <h4>Оригинал</h4>
                      <img [src]="data.comparison.original.originalUrl" alt="Оригинал" />
                    </div>                    <div class="image-panel">
                      <h4>{{ getCurrentProcessedPhoto() ? getProcessingType(getCurrentProcessedPhoto()!) : 'Обработанная версия' }}</h4>
                      <img [src]="getCurrentProcessedPhoto()?.processedUrl" alt="Обработанная версия" />
                    </div>
                  </div>
                }
                @case ('overlay') {
                  <div class="overlay-container">
                    <div class="overlay-controls">                      <input 
                        type="range"
                        min="0" 
                        max="100" 
                        step="1" 
                        [value]="overlayOpacity()"
                        (input)="setOverlayOpacity($any($event.target).value || 0)"
                        class="opacity-slider">
                      <span class="opacity-label">Прозрачность: {{ overlayOpacity() }}%</span>
                    </div>
                    <div class="overlay-images">
                      <img [src]="data.comparison.original.originalUrl" alt="Оригинал" class="base-image" />
                      <img 
                        [src]="getCurrentProcessedPhoto()?.processedUrl" 
                        alt="Обработанная версия" 
                        class="overlay-image"
                        [style.opacity]="overlayOpacity() / 100" />
                    </div>
                  </div>
                }
                @case ('slider') {
                  <div class="slider-container">
                    <div class="slider-images" 
                         [style.--slider-position]="sliderPosition() + '%'">
                      <img [src]="data.comparison.original.originalUrl" alt="Оригинал" class="before-image" />
                      <img [src]="getCurrentProcessedPhoto()?.processedUrl" alt="Обработанная версия" class="after-image" />
                      <div class="slider-handle" 
                           (mousedown)="startSliderDrag($event)"
                           (touchstart)="startSliderDrag($event)">
                        <div class="slider-line"></div>
                        <div class="slider-button">
                          <mat-icon>drag_indicator</mat-icon>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              }
            </div>

            <!-- Форма обратной связи -->
            <div class="feedback-section">
              <h3>Оценка и комментарии</h3>
              
              <!-- Рейтинг -->
              <div class="rating-section">
                <span aria-label="Оцените результат обработки">Оцените результат обработки:</span>
                <div class="rating-stars">
                  @for (star of [1,2,3,4,5]; track star) {
                    <mat-icon 
                      [class.filled]="star <= rating()" 
                      (click)="setRating(star)"
                      class="star">
                      star
                    </mat-icon>
                  }
                </div>
              </div>

              <!-- Комментарий -->
              <mat-form-field class="full-width">
                <mat-label>Комментарий (необязательно)</mat-label>
                <textarea 
                  matInput 
                  [(ngModel)]="comment"
                  placeholder="Поделитесь своими впечатлениями от обработки..."
                  rows="3">
                </textarea>
              </mat-form-field>

              <!-- Предпочтения -->
              <div class="preferences-section">
                <span aria-label="Что вам больше всего понравилось">Что вам больше всего понравилось?</span>
                <mat-button-toggle-group multiple [value]="preferences()">
                  <mat-button-toggle value="colors" (change)="togglePreference('colors', $event.source.checked)">
                    Цветокоррекция
                  </mat-button-toggle>
                  <mat-button-toggle value="lighting" (change)="togglePreference('lighting', $event.source.checked)">
                    Освещение
                  </mat-button-toggle>
                  <mat-button-toggle value="contrast" (change)="togglePreference('contrast', $event.source.checked)">
                    Контрастность
                  </mat-button-toggle>
                  <mat-button-toggle value="sharpness" (change)="togglePreference('sharpness', $event.source.checked)">
                    Резкость
                  </mat-button-toggle>
                  <mat-button-toggle value="overall" (change)="togglePreference('overall', $event.source.checked)">
                    Общее впечатление
                  </mat-button-toggle>
                </mat-button-toggle-group>
              </div>
            </div>
          </div>
        } @else if (data.photo) {
          <!-- Простой просмотр фото -->
          <div class="single-photo-view">
            <img [src]="data.photo.originalUrl || data.photo.thumbnailUrl" [alt]="'Фото ' + data.photo.id" />
          </div>
        }
      </div>

      <div mat-dialog-actions class="dialog-actions">
        @if (data.comparison) {
          <button mat-button (click)="selectVersion()">
            Выбрать эту версию
          </button>
          <button mat-raised-button color="primary" (click)="saveFeedback()">
            Сохранить отзыв
          </button>
        }
        <button mat-raised-button color="accent" (click)="download()">
          <mat-icon>download</mat-icon>
          Скачать
        </button>
        <button mat-button mat-dialog-close>Закрыть</button>
      </div>
    </div>
  `,
  styleUrl: './photo-comparison-dialog.component.scss'
})
export class PhotoComparisonDialogComponent {
  private dialogRef = inject(MatDialogRef<PhotoComparisonDialogComponent>);
  private photoService = inject(PhotoApiService);
  private snackBar = inject(MatSnackBar);

  // Состояние компонента
  comparisonMode = signal<'side-by-side' | 'overlay' | 'slider'>('side-by-side');
  selectedVersion = signal<string>('original');
  protected overlayOpacity = signal(50);
  protected sliderPosition = signal(50);
  protected rating = signal(0);
  comment = '';
  preferences = signal<string[]>([]);
  readonly data = inject<DialogData>(MAT_DIALOG_DATA);

  constructor() {
    const data = this.data;
    if (data.comparison) {
      // Инициализируем первую обработанную версию как выбранную
      if (data.comparison.processed.length > 0) {
        this.selectedVersion.set(data.comparison.processed[0].id);
      }
      
      // Загружаем существующую обратную связь
      if (data.comparison.clientFeedback) {
        this.rating.set(data.comparison.clientFeedback.rating || 0);
        this.comment = data.comparison.clientFeedback.comment || '';
        this.preferences.set(data.comparison.clientFeedback.preferences || []);
      }
    }
  }

  setComparisonMode(mode: 'side-by-side' | 'overlay' | 'slider') {
    this.comparisonMode.set(mode);
  }

  setSelectedVersion(version: string) {
    this.selectedVersion.set(version);
  }

  setOverlayOpacity(opacity: number) {
    this.overlayOpacity.set(opacity);
  }

  getCurrentProcessedPhoto(): Photo | undefined {
    if (!this.data.comparison) return undefined;
    return this.data.comparison.processed.find(p => p.id === this.selectedVersion());
  }

  getProcessingType(photo: Photo): string {
    const versions = photo.processing?.versions;
    if (!versions) return 'Обработанное';
    
    if (versions.portrait) return 'Портретная';
    if (versions.vintage) return 'Винтажная';
    if (versions.bw) return 'Ч/Б';
    if (versions.color) return 'Цветокоррекция';
    
    return 'Обработанное';
  }

  setRating(stars: number) {
    this.rating.set(stars);
  }

  togglePreference(preference: string, checked: boolean) {
    const current = this.preferences();
    if (checked) {
      this.preferences.set([...current, preference]);
    } else {
      this.preferences.set(current.filter(p => p !== preference));
    }
  }

  startSliderDrag(event: MouseEvent | TouchEvent) {
    event.preventDefault();
    
    const container = (event.target as HTMLElement).closest('.slider-images') as HTMLElement;
    if (!container) return;

    const updatePosition = (clientX: number) => {
      const rect = container.getBoundingClientRect();
      const position = ((clientX - rect.left) / rect.width) * 100;
      this.sliderPosition.set(Math.max(0, Math.min(100, position)));
    };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      updatePosition(clientX);
    };

    const handleEnd = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleEnd);

    // Устанавливаем начальную позицию
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    updatePosition(clientX);
  }

  async selectVersion() {
    if (!this.data.comparison) return;

    try {
      const selectedPhoto = this.getCurrentProcessedPhoto();
      if (selectedPhoto) {
        await this.photoService.selectPhotoVersion(selectedPhoto.id);
        this.snackBar.open('Версия выбрана', 'Закрыть', { duration: 3000 });
      }
    } catch {
      this.snackBar.open('Ошибка выбора версии', 'Закрыть', { duration: 3000 });
    }
  }

  async saveFeedback() {
    if (!this.data.comparison) return;

    try {
      const feedback = {
        rating: this.rating(),
        comment: this.comment.trim() || undefined,
        preferences: this.preferences()
      };

      await this.photoService.savePhotoFeedback(this.data.comparison.original.id, feedback);
      this.snackBar.open('Отзыв сохранен', 'Закрыть', { duration: 3000 });
      this.dialogRef.close();
    } catch {
      this.snackBar.open('Ошибка сохранения отзыва', 'Закрыть', { duration: 3000 });
    }
  }

  async download() {
    try {
      if (this.data.comparison) {
        const selectedPhoto = this.getCurrentProcessedPhoto();
        if (selectedPhoto) {
          await this.photoService.downloadPhoto(selectedPhoto.id);
        }
      } else if (this.data.photo) {
        await this.photoService.downloadPhoto(this.data.photo.id);
      }
      
      this.snackBar.open('Загрузка началась', 'Закрыть', { duration: 3000 });
    } catch {
      this.snackBar.open('Ошибка скачивания', 'Закрыть', { duration: 3000 });
    }  }
}
