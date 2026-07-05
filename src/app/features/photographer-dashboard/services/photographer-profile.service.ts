import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, catchError, throwError, switchMap, forkJoin, of } from 'rxjs';
import {
  PhotographerProfile,
  ProfileUpdateRequest,
  AvatarUploadResponse,
  PortfolioUploadResponse,
  PortfolioItem
} from '../models/photographer-profile.models';
import { AuthService } from '../../../core/services/auth.service';
import { FileStorageService } from '../../../core/services/file-storage.service';
import { LoggerService } from '../../../core/services/logger.service';
// Firebase Firestore imports removed - using REST API instead

/** Raw shape of a MinIO portfolio item from the API */
interface MinioPortfolioItem {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  thumbnailUrl?: string;
  uploadDate?: string;
  fileName?: string;
  serviceId?: string | null;
  tags?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class PhotographerProfileService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly fileStorageService = inject(FileStorageService);
  private log = inject(LoggerService);
  private readonly apiUrl = `/api/photographers`;

  /**
   * Получение профиля текущего фотографа (БЕЗОПАСНО)
   */
  getProfile(): Observable<PhotographerProfile> {
    return this.http.get<{ success: boolean; data: PhotographerProfile }>(`${this.apiUrl}/me`).pipe(
      map(response => {
        this.log.debug('API Response:', response);
        return response.data;
      }),
      catchError(error => {
        this.log.error('Error fetching photographer profile:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Обновление профиля фотографа (БЕЗОПАСНО - только разрешенные поля)
   */
  updateProfile(profileData: ProfileUpdateRequest): Observable<PhotographerProfile> {
    return this.http.put<{ success: boolean; data: PhotographerProfile }>(`${this.apiUrl}/me/profile`, profileData).pipe(
      map(response => response.data),
      catchError(error => {
        this.log.error('Error updating photographer profile:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Загрузка аватара (БЕЗОПАСНО)
   */
  uploadAvatar(file: File): Observable<void> {
    const user = this.authService.getCurrentUser();
    if (!user) {
      return throwError(() => new Error('User not logged in.'));
    }
    const path = `avatars/${user.uid}/${file.name}`;
    return this.fileStorageService.uploadFile(path, file).pipe(
      switchMap(downloadURL => this.authService.updateProfilePhoto(downloadURL))
    );
  }
  /**
   * Удаление аватара (БЕЗОПАСНО)
   */
  deleteAvatar(): Observable<void> {
    const user = this.authService.getCurrentUser();
    if (!user || !user.photoURL) {
      return throwError(() => new Error('User has no avatar to delete.'));
    }
    // 1. Delete from storage
    return this.fileStorageService.deleteFileByUrl(user.photoURL).pipe(
      // 2. Clear the photoURL in Auth and Firestore
      switchMap(() => this.authService.clearProfilePhoto()),
      catchError(error => {
        this.log.error('Error deleting avatar:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Загрузка обложки (БЕЗОПАСНО)
   */
  uploadCover(file: File): Observable<void> {
    // Используем уже существующий метод uploadCoverImage через REST API
    return this.uploadCoverImage(file).pipe(
      map(() => void 0)
    );
  }

  /**
   * Удаление обложки (БЕЗОПАСНО)
   */
  deleteCover(): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/me/cover`).pipe(
      catchError(error => {
        this.log.error('Error deleting cover:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Загрузка фотографий в портфолио (БЕЗОПАСНО)
   */
  uploadPortfolioImages(files: File[], category?: string): Observable<PortfolioUploadResponse[]> {
    const formData = new FormData();
    files.forEach((file) => {
      formData.append('portfolio', file);
    });

    if (category) {
      formData.append('category', category);
    }

    return this.http.post<PortfolioUploadResponse[]>(`${this.apiUrl}/me/portfolio`, formData).pipe(
      catchError(error => {
        this.log.error('Error uploading portfolio images:', error);
        return throwError(() => error);
      })
    );
  }
  /**
   * Получение портфолио текущего фотографа (БЕЗОПАСНО)
   */
  getPortfolio(): Observable<PortfolioItem[]> {
    return this.http.get<{ success: boolean; data: MinioPortfolioItem[] }>(`${this.apiUrl}/me/portfolio`).pipe(
      map(response => {
        // Маппинг данных из MinIO в PortfolioItem
        return response.data.map((minioItem, index: number) => {
          // Создаем автоматическое название если его нет
          let title = minioItem.title;
          if (!title || title.trim() === '') {
            const uploadDate = new Date(minioItem.uploadDate || Date.now());
            const dateStr = uploadDate.toLocaleDateString('ru-RU');
            title = `Фотография от ${dateStr}`;
          }

          return {
            id: minioItem.id || minioItem.fileName || String(index),
            title: title,
            description: minioItem.description || '',
            imageUrl: minioItem.url || '',
            thumbnailUrl: minioItem.thumbnailUrl || '',
            category: 'general', // временно
            serviceId: minioItem.serviceId || null,
            tags: minioItem.tags || [],
            featured: false, // временно
            createdAt: new Date(minioItem.uploadDate || Date.now()),
            order: index // используем индекс как порядок
          } as PortfolioItem;
        });
      }),
      catchError(error => {
        this.log.error('Error loading portfolio:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Загрузка фотографий в портфолио с привязкой к услуге (БЕЗОПАСНО)
   */
  uploadPortfolioImagesWithService(files: File[], serviceId: string | null): Observable<void> {
    // Используем REST API метод uploadPortfolioImages
    return this.uploadPortfolioImages(files).pipe(
      switchMap(results => {
        // Обновляем каждый элемент портфолио с serviceId если нужно
        if (serviceId) {
          const updateTasks$ = results.map(item =>
            this.updatePortfolioItem(item.id, { serviceId })
          );
          return forkJoin(updateTasks$).pipe(map(() => void 0));
        }
        return of(void 0);
      })
    );
  }

  /**
   * Обновление элемента портфолио (БЕЗОПАСНО)
   */
  updatePortfolioItem(itemId: string, updates: Partial<PortfolioItem>): Observable<PortfolioItem> {
    return this.http.put<PortfolioItem>(`${this.apiUrl}/me/portfolio/${itemId}`, updates).pipe(
      catchError(error => {
        this.log.error('Error updating portfolio item:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Изменение порядка элементов портфолио (БЕЗОПАСНО)
   */
  reorderPortfolio(itemIds: string[]): Observable<void> {
    return this.http.put<void>(`${this.apiUrl}/me/portfolio/reorder`, { itemIds }).pipe(
      catchError(error => {
        this.log.error('Error reordering portfolio:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Загрузка обложки профиля (БЕЗОПАСНО)
   */
  uploadCoverImage(file: File): Observable<AvatarUploadResponse> {
    const formData = new FormData();
    formData.append('cover', file);

    return this.http.post<AvatarUploadResponse>(`${this.apiUrl}/me/cover`, formData).pipe(
      catchError(error => {
        this.log.error('Error uploading cover image:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Получение статистики профиля (БЕЗОПАСНО)
   */
  getProfileStats(): Observable<ProfileStats> {
    return this.http.get<{ success: boolean; data: ProfileStats }>(`${this.apiUrl}/me/stats`).pipe(
      map(response => response.data),
      catchError(error => {
        this.log.error('Error fetching profile stats:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Валидация файлов для загрузки
   */
  validateImageFile(file: File): { valid: boolean; error?: string } {
    const maxSize = 10 * 1024 * 1024; // 10MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

    if (!allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: 'Поддерживаются только форматы JPEG, PNG и WebP'
      };
    }

    if (file.size > maxSize) {
      return {
        valid: false,
        error: 'Размер файла не должен превышать 10MB'
      };
    }

    return { valid: true };
  }
  /**
   * Создание превью изображения
   */
  createImagePreview(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  /**
   * Удаление элемента портфолио (БЕЗОПАСНО)
   */
  deletePortfolioItem(item: PortfolioItem): Observable<void> {
    // Используем REST API для удаления портфолио
    return this.http.delete<void>(`${this.apiUrl}/me/portfolio/${item.id}`).pipe(
      switchMap(() => {
        // Удаляем файл из хранилища если нужно
        return this.fileStorageService.deleteFileByUrl(item.imageUrl).pipe(
          catchError(() => of(void 0)), // Игнорируем ошибки удаления файла
          map(() => void 0)
        );
      }),
      catchError(error => {
        this.log.error('Error deleting portfolio item:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Обновление настроек социальных сетей (БЕЗОПАСНО)
   */
  updateSocialMedia(socialMediaData: unknown): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`${this.apiUrl}/me/social-media`, socialMediaData).pipe(
      catchError(error => {
        this.log.error('Error updating social media:', error);
        return throwError(() => error);
      })
    );
  }

  /**
   * Обновление настроек приватности (БЕЗОПАСНО)
   */
  updatePrivacySettings(privacyData: unknown): Observable<{ success: boolean }> {
    return this.http.put<{ success: boolean }>(`${this.apiUrl}/me/privacy`, privacyData).pipe(
      catchError(error => {
        this.log.error('Error updating privacy settings:', error);
        return throwError(() => error);
      })
    );
  }
}

export interface ProfileStats {
  totalBookings: number;
  totalPhotos: number;
  averageRating: number;
  totalReviews: number;
  profileViews: number;
  portfolioViews: number;
  joinDate: Date;
  lastActive: Date;
}
