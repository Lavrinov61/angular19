import { Component, ChangeDetectionStrategy, inject, signal, OnInit, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatDialogModule } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { PhotoApiService } from '../../../core/services/photo-api.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

interface ThumbnailInfo {
  id: string;
  originalUrl: string;
  thumbnailUrl: string;
  fileName: string;
  size: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  createdAt: Date;
  dimensions: {
    width: number;
    height: number;
  };
}

@Component({
  selector: 'app-thumbnails-manager',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    MatDialogModule,
    MatChipsModule,
    HasPermissionDirective,
  ],
  template: `
    <div class="thumbnails-manager">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Управление миниатюрами</mat-card-title>
          <mat-card-subtitle>Создание и управление миниатюрами изображений</mat-card-subtitle>
        </mat-card-header>
        
        <mat-card-content>
          <div class="upload-section">
            <input 
              #fileInput 
              type="file" 
              multiple 
              accept="image/*"
              (change)="onFileSelect($event)"
              style="display: none"
            >
            <button 
              mat-raised-button 
              color="primary"
              (click)="fileInput.click()"
              [disabled]="isProcessing()"
            >
              <mat-icon>add_photo_alternate</mat-icon>
              Выбрать изображения
            </button>
            
            @if (selectedFiles().length > 0) {
              <div class="upload-info">
                <p>Выбrano файлов: {{ selectedFiles().length }}</p>
                <button 
                  mat-raised-button 
                  color="accent"
                  (click)="generateThumbnails()"
                  [disabled]="isProcessing()">
                  <mat-icon>image</mat-icon>
                  Создать миниатюры
                </button>
              </div>
            }
          </div>
          
          @if (isProcessing()) {
            <mat-progress-bar mode="determinate" 
              [value]="progress()" />
          }
          
          @if (thumbnails().length > 0) {
            <div class="thumbnails-grid">
            <h3>Миниатюры ({{ thumbnails().length }})</h3>
            
            <div class="filter-chips">
              <mat-chip-listbox>
                <mat-chip-option 
                  [selected]="selectedFilter() === 'all'"
                  (click)="setFilter('all')"
                >
                  Все
                </mat-chip-option>
                <mat-chip-option 
                  [selected]="selectedFilter() === 'completed'"
                  (click)="setFilter('completed')"
                >
                  Готовые
                </mat-chip-option>
                <mat-chip-option 
                  [selected]="selectedFilter() === 'processing'"
                  (click)="setFilter('processing')"
                >
                  Обработка
                </mat-chip-option>
                <mat-chip-option 
                  [selected]="selectedFilter() === 'error'"
                  (click)="setFilter('error')"
                >
                  Ошибки
                </mat-chip-option>
              </mat-chip-listbox>
            </div>
            
            <div class="thumbnails-list">
              @for (thumbnail of filteredThumbnails(); track thumbnail.id || thumbnail.fileName || $index) {
                <div 
                  class="thumbnail-item"
                  [class.processing]="thumbnail.status === 'processing'"
                  [class.error]="thumbnail.status === 'error'">
                  <div class="thumbnail-preview">
                    @if (thumbnail.status === 'completed') {
                      <img 
                        [src]="thumbnail.thumbnailUrl" 
                        [alt]="thumbnail.fileName"
                        loading="lazy">
                    }
                    @if (thumbnail.status === 'processing') {
                      <div class="processing-indicator">
                        <mat-icon>hourglass_empty</mat-icon>
                        <span>Обработка...</span>
                      </div>
                    }
                    @if (thumbnail.status === 'error') {
                      <div class="error-indicator">
                        <mat-icon>error</mat-icon>
                        <span>Ошибка</span>
                      </div>
                    }
                  </div>
                  
                  <div class="thumbnail-info">
                    <div class="file-name">{{ thumbnail.fileName }}</div>
                    <div class="file-details">
                      {{ formatFileSize(thumbnail.size) }} • 
                      {{ thumbnail.dimensions.width }}×{{ thumbnail.dimensions.height }}
                    </div>
                    <div class="file-date">
                      {{ thumbnail.createdAt | date:'dd.MM.yyyy HH:mm' }}
                    </div>
                  </div>
                  
                  <div class="thumbnail-actions">
                    @if (thumbnail.status === 'completed') {
                      <button 
                        mat-icon-button 
                        (click)="copyUrl(thumbnail.thumbnailUrl)"
                        matTooltip="Копировать URL">
                        <mat-icon>content_copy</mat-icon>
                      </button>
                    }
                    @if (thumbnail.status === 'completed') {
                      <button 
                        mat-icon-button 
                        (click)="downloadThumbnail(thumbnail)"
                        matTooltip="Скачать">
                        <mat-icon>download</mat-icon>
                      </button>
                    }
                    <button *appHasPermission="'catalog:manage'"
                      mat-icon-button
                      color="warn"
                      (click)="deleteThumbnail(thumbnail.id)"
                      matTooltip="Удалить">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
          }
          
          @if (thumbnails().length === 0 && !isProcessing()) {
            <div class="empty-state">
              <mat-icon>photo_library</mat-icon>
              <h3>Нет миниатюр</h3>
              <p>Выберите изображения для создания миниатюр</p>
            </div>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .thumbnails-manager {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    
    .upload-section {
      margin-bottom: 20px;
      display: flex;
      flex-direction: column;
      gap: 15px;
    }
    
    .upload-info {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    
    .filter-chips {
      margin: 20px 0;
    }
    
    .thumbnails-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 20px;
      margin-top: 20px;
    }
    
    .thumbnail-item {
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      overflow: hidden;
      transition: box-shadow var(--crm-transition-normal);
    }

    .thumbnail-item:hover {
      box-shadow: var(--crm-shadow-md);
    }

    .thumbnail-item.processing {
      border-color: var(--crm-status-warning);
    }

    .thumbnail-item.error {
      border-color: var(--crm-status-error);
    }

    .thumbnail-preview {
      height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--crm-surface-raised);
    }

    .thumbnail-preview img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .processing-indicator,
    .error-indicator {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      color: var(--crm-text-secondary);
    }

    .error-indicator {
      color: var(--crm-status-error);
    }

    .thumbnail-info {
      padding: 15px;
    }

    .file-name {
      font-weight: 500;
      margin-bottom: 5px;
      word-break: break-all;
    }

    .file-details {
      color: var(--crm-text-secondary);
      font-size: 0.9em;
      margin-bottom: 5px;
    }

    .file-date {
      color: var(--crm-text-muted);
      font-size: 0.8em;
      font-family: var(--crm-font-mono);
    }

    .thumbnail-actions {
      padding: 10px 15px;
      display: flex;
      gap: 5px;
      border-top: 1px solid var(--crm-border);
      background-color: var(--crm-surface-raised);
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--crm-text-secondary);
    }

    .empty-state mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      margin-bottom: 20px;
      color: var(--crm-text-muted);
    }
    
    .empty-state h3 {
      margin: 0 0 10px 0;
    }
    
    .empty-state p {
      margin: 0;
    }
  `]
})
export class ThumbnailsManagerComponent implements OnInit {
  private photoApiService = inject(PhotoApiService);
  private snackBar = inject(MatSnackBar);
  private platformId = inject(PLATFORM_ID);
  
  // Signals
  thumbnails = signal<ThumbnailInfo[]>([]);
  selectedFiles = signal<File[]>([]);
  isProcessing = signal<boolean>(false);
  progress = signal<number>(0);
  selectedFilter = signal<'all' | 'completed' | 'processing' | 'error'>('all');
  
  // Computed
  filteredThumbnails = signal<ThumbnailInfo[]>([]);
  
  ngOnInit(): void {
    this.loadThumbnails();
    this.updateFilteredThumbnails();
  }
  
  private updateFilteredThumbnails(): void {
    const filter = this.selectedFilter();
    const all = this.thumbnails();
    
    if (filter === 'all') {
      this.filteredThumbnails.set(all);
    } else {
      this.filteredThumbnails.set(all.filter(t => t.status === filter));
    }
  }
  
  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) {
      const files = Array.from(input.files);
      this.selectedFiles.set(files);
    }
  }
  
  async generateThumbnails(): Promise<void> {
    const files = this.selectedFiles();
    if (files.length === 0) return;
    
    this.isProcessing.set(true);
    this.progress.set(0);
    
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await this.processSingleFile(file);
        this.progress.set((i + 1) / files.length * 100);
      }
      
      this.snackBar.open(`Успешно создано ${files.length} миниатюр`, 'Закрыть', {
        duration: 3000
      });
      
      this.selectedFiles.set([]);
      await this.loadThumbnails();
      
    } catch {
      this.snackBar.open('Ошибка при создании миниатюр', 'Закрыть', {
        duration: 5000
      });
    } finally {
      this.isProcessing.set(false);
      this.progress.set(0);
    }
  }
    private async processSingleFile(file: File): Promise<void> {
    // Создаем временную запись для отображения прогресса
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const tempThumbnail: ThumbnailInfo = {
      id: tempId,
      originalUrl: '',
      thumbnailUrl: '',
      fileName: file.name,
      size: file.size,
      status: 'processing',
      createdAt: new Date(),
      dimensions: { width: 0, height: 0 }
    };
    
    this.thumbnails.update(thumbnails => [...thumbnails, tempThumbnail]);
    this.updateFilteredThumbnails();
    
    try {
      // Получаем размеры изображения
      const dimensions = await this.getImageDimensions(file);
      
      // Симуляция загрузки файла (замените на реальный API)
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
      
      // Создаем URL для превью
      const thumbnailUrl = URL.createObjectURL(file);
      
      // Обновляем запись с данными
      this.thumbnails.update(thumbnails => 
        thumbnails.map(t => 
          t.id === tempId 
            ? {
                ...t,
                id: `photo-${Date.now()}-${Math.random()}`,
                originalUrl: thumbnailUrl,
                thumbnailUrl: thumbnailUrl,
                status: 'completed' as const,
                dimensions
              }
            : t
        )
      );
      
    } catch (error) {
      // Обновляем статус на ошибку
      this.thumbnails.update(thumbnails => 
        thumbnails.map(t => 
          t.id === tempId 
            ? { ...t, status: 'error' as const }
            : t
        )
      );
      throw error;
    }
    
    this.updateFilteredThumbnails();
  }
  
  private getImageDimensions(file: File): Promise<{width: number, height: number}> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({
          width: img.naturalWidth,
          height: img.naturalHeight
        });
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
    private async loadThumbnails(): Promise<void> {
    try {
      // Используем существующий метод для получения сессий клиента
      // Для демонстрации создаем пустой массив
      const thumbnails: ThumbnailInfo[] = [];
      
      this.thumbnails.set(thumbnails);
      this.updateFilteredThumbnails();
    } catch {
      this.snackBar.open('Ошибка при загрузке миниатюр', 'Закрыть', {
        duration: 5000
      });
    }
  }
  
  setFilter(filter: 'all' | 'completed' | 'processing' | 'error'): void {
    this.selectedFilter.set(filter);
    this.updateFilteredThumbnails();
  }
  
  copyUrl(url: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    navigator.clipboard.writeText(url).then(() => {
      this.snackBar.open('URL скопирован в буфер обмена', 'Закрыть', {
        duration: 2000
      });
    }).catch(() => {
      this.snackBar.open('Не удалось скопировать URL', 'Закрыть', {
        duration: 3000
      });
    });
  }
  
  downloadThumbnail(thumbnail: ThumbnailInfo): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const link = document.createElement('a');
    link.href = thumbnail.thumbnailUrl;
    link.download = `thumb_${thumbnail.fileName}`;
    link.click();
  }
    async deleteThumbnail(id: string): Promise<void> {
    try {
      // Симуляция удаления (замените на реальный API)
      await new Promise(resolve => setTimeout(resolve, 500));
      
      this.thumbnails.update(thumbnails => 
        thumbnails.filter(t => t.id !== id)
      );
      this.updateFilteredThumbnails();
      
      this.snackBar.open('Миниатюра удалена', 'Закрыть', {
        duration: 2000
      });
    } catch {
      this.snackBar.open('Ошибка при удалении миниатюры', 'Закрыть', {
        duration: 3000
      });
    }
  }
  
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
