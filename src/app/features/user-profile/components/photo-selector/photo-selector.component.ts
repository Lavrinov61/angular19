import { Component, inject, signal, computed, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBarModule, MatSnackBar } from '@angular/material/snack-bar';
import { MatBadgeModule } from '@angular/material/badge';
import { MatBottomSheetModule } from '@angular/material/bottom-sheet';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDividerModule } from '@angular/material/divider';
import { MatTooltipModule } from '@angular/material/tooltip';

import { PhotoApiService } from '../../../../core/services/photo-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SelectedPhoto, RetouchingOption, PhotoFormatInfo, PHOTO_FORMATS, RETOUCHING_OPTIONS } from '../../../../core/models/photo-selection.model';

interface PhotoSession {
  id: string;
  name: string;
  date: Date;
  photos: SessionPhoto[];
}

interface SessionPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  fileName: string;
  size: number;
  uploadDate: Date;
  tags: string[];
  metadata: {
    camera: string;
    lens: string;
    settings: string;
  };
}

@Component({
  selector: 'app-photo-selector',
  
  imports: [
    DatePipe,
    CurrencyPipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatBadgeModule,
    MatBottomSheetModule,
    MatSelectModule,
    MatFormFieldModule,
    MatDividerModule,
    MatTooltipModule
  ],
  templateUrl: './photo-selector.component.html',
  styleUrls: ['./photo-selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PhotoSelectorComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly photoApiService = inject(PhotoApiService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  
  // Signals
  readonly sessionId = signal<string>('');
  readonly session = signal<PhotoSession | null>(null);
  readonly loading = signal(true);
  readonly selectedPhotos = signal<Set<string>>(new Set());
  readonly photoFormats = signal<Map<string, PhotoFormatInfo>>(new Map());
  readonly retouchingOptions = signal<Map<string, RetouchingOption[]>>(new Map());

  // Computed
  readonly cartItems = computed(() => {
    return this.photoApiService.cartItems();
  });

  readonly cartTotal = computed(() => {
    return this.photoApiService.cartTotal();
  });

  readonly selectedCount = computed(() => {
    return this.selectedPhotos().size;
  });

  readonly canAddToCart = computed(() => {
    return this.selectedCount() > 0;
  });

  // Constants
  readonly photoFormatsData = PHOTO_FORMATS;
  readonly retouchingOptionsData = RETOUCHING_OPTIONS;

  constructor() {
    const sessionId = this.route.snapshot.paramMap.get('sessionId');
    if (sessionId) {
      this.sessionId.set(sessionId);
      this.loadPhotoSession(sessionId);
    } else {
      this.router.navigate(['/user-profile/photo-selections']);
    }
  }

  private async loadPhotoSession(sessionId: string) {
    try {
      this.loading.set(true);
      
      // Получаем фотографии для этой сессии
      const photosResponse = await this.photoApiService.getSessionPhotos(sessionId).toPromise();
      
      if (!photosResponse || !photosResponse.data) {
        throw new Error('Фотосессия не найдена');
      }
      
      const photos: SessionPhoto[] = photosResponse.data.map(photoData => ({
        id: photoData.id,
        url: photoData.originalUrl || photoData.processedUrl || '',
        thumbnailUrl: photoData.thumbnailUrl || '',
        fileName: photoData.metadata?.fileName || `photo-${photoData.id}.jpg`,
        size: photoData.metadata?.fileSize || 0,
        uploadDate: new Date(photoData.uploadedAt || Date.now()),
        tags: [], // Добавим теги позже если нужно
        metadata: {
          camera: 'Неизвестно',
          lens: 'Неизвестно',
          settings: 'Неизвестно'
        }
      }));
      
      const session: PhotoSession = {
        id: sessionId,
        name: 'Фотосессия', // Получим из API позже
        date: new Date(),
        photos: photos
      };

      this.session.set(session);
      
      // Инициализируем форматы и ретушь для каждой фотографии
      session.photos.forEach(photo => {
        this.photoFormats.update(formats => {
          formats.set(photo.id, this.photoFormatsData[0]); // По умолчанию первый формат
          return new Map(formats);
        });
        
        this.retouchingOptions.update(options => {
          options.set(photo.id, []);
          return new Map(options);
        });
      });
    } catch {
      this.snackBar.open('Ошибка загрузки фотосессии', 'Закрыть', { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  togglePhotoSelection(photoId: string) {
    const isSelected = this.selectedPhotos().has(photoId);
    const newSelectedState = !isSelected;
    const sessionId = this.sessionId();

    this.photoApiService.togglePhotoSelection(sessionId, photoId, newSelectedState)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.selectedPhotos.update(selected => {
            const newSelected = new Set(selected);
            if (newSelectedState) {
              newSelected.add(photoId);
            } else {
              newSelected.delete(photoId);
            }
            return newSelected;
          });
        },
        error: () => {
          this.snackBar.open('Ошибка при выборе фотографии', 'Закрыть', { duration: 3000 });
        }
      });
  }

  selectAll() {
    const session = this.session();
    if (!session) return;

    this.selectedPhotos.set(new Set(session.photos.map(p => p.id)));
  }

  deselectAll() {
    this.selectedPhotos.set(new Set());
  }
  updatePhotoFormat(photoId: string, format: PhotoFormatInfo) {
    this.photoFormats.update(formats => {
      formats.set(photoId, format);
      return new Map(formats);
    });
  }

  updateRetouchingOptions(photoId: string, options: RetouchingOption[]) {
    this.retouchingOptions.update(retouching => {
      retouching.set(photoId, options);
      return new Map(retouching);
    });
  }

  addSelectedToCart() {
    const session = this.session();
    const selectedIds = this.selectedPhotos();
    const formats = this.photoFormats();
    const retouchingOpts = this.retouchingOptions();

    if (!session || selectedIds.size === 0) return;

    const selectedPhotos: SelectedPhoto[] = [];

    selectedIds.forEach(photoId => {
      const photo = session.photos.find(p => p.id === photoId);
      if (photo) {
        const format = formats.get(photoId) || this.photoFormatsData[0];
        const retouching = retouchingOpts.get(photoId) || [];        selectedPhotos.push({
          id: `selection-${photo.id}`,
          photoId: photo.id,
          thumbnailUrl: photo.thumbnailUrl,
          originalUrl: photo.url,
          price: format.basePrice + retouching.reduce((sum, opt) => sum + opt.price, 0),
          format: format.format,
          isRetouched: retouching.length > 0,
          retouchingOptions: retouching
        });
      }
    });    selectedPhotos.forEach(photo => {
      this.photoApiService.addToCart(photo);
    });this.snackBar.open(
      `Добавлено в корзину: ${selectedPhotos.length} фото`,
      'Просмотреть корзину',
      { 
        duration: 4000
      }
    ).onAction().subscribe(() => {
      this.router.navigate(['/user-profile/photo-selections']);
    });

    // Сбрасываем выбор
    this.deselectAll();
  }

  goToCart() {
    this.router.navigate(['/user-profile/photo-selections']);
  }
  calculatePhotoPrice(photoId: string): number {
    const format = this.photoFormats().get(photoId);
    const retouching = this.retouchingOptions().get(photoId) || [];
    
    if (!format) return 0;
    
    return format.basePrice + retouching.reduce((sum, opt) => sum + opt.price, 0);
  }

  getPhotoRetouchingText(photoId: string): string {
    const options = this.retouchingOptions().get(photoId) || [];
    if (options.length === 0) return 'Без ретуши';
    
    return options.map(opt => opt.name).join(', ');
  }
}
