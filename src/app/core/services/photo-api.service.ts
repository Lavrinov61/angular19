import { Injectable, inject, signal, computed, WritableSignal } from '@angular/core';
import { Observable, of, firstValueFrom } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { PhotoPermission, PermissionStatus } from '../models/photo-permission.model';
import { PhotoSelection, SelectedPhoto, PhotoSelectionStatus } from '../models/photo-selection.model';
import { ApiService, ApiResponse } from './api.service';
import { Photo } from '../models/photo.model';
import { LoggerService } from './logger.service';

// Re-export Photo for convenience
export type { Photo };

export interface ClientPhotoSession {
  id: string;
  title: string;
  date: string;
  status: 'processing' | 'ready' | 'delivered';
  photoCount: number;
  thumbnailUrl?: string;
  sessionType: string;
  photographer: string;
  clientId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoSessionDownload {
  sessionId: string;
  downloadUrl?: string;
  error?: string;
}

export interface DownloadablePhoto {
  id: string;
  url: string;
  file_name: string | null;
}

export interface PhotoDownloadResponse {
  photos: DownloadablePhoto[];
}

@Injectable({
  providedIn: 'root'
})
export class PhotoApiService {
  private readonly apiService = inject(ApiService);
  private log = inject(LoggerService);
  private photoSessionsSignal = signal<ClientPhotoSession[]>([]);
  private sessionPhotosSignal = signal<Photo[]>([]);
  private selectedPhotosSignal = signal<Photo[]>([]);
  private permissionsSignal = signal<PhotoPermission[]>([]);
  private photoSelectionsSignal = signal<PhotoSelection[]>([]);
  private cartItemsSignal = signal<SelectedPhoto[]>([]);
  
  // Readonly signals
  public readonly photoSessions = this.photoSessionsSignal.asReadonly();
  public readonly sessionPhotos = this.sessionPhotosSignal.asReadonly();
  public readonly selectedPhotos = this.selectedPhotosSignal.asReadonly();
  public readonly permissions = this.permissionsSignal.asReadonly();
  public readonly photoSelections = this.photoSelectionsSignal.asReadonly();
  public readonly cartItems = this.cartItemsSignal.asReadonly();
  public readonly isLoading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);  // Computed свойства
  public readonly hasPhotoSessions = computed(() => this.photoSessions().length > 0);
  public readonly hasSelectedPhotos = computed(() => this.selectedPhotos().length > 0);
  public readonly processingSessionsCount = computed(() =>
    this.photoSessions().filter(session => session.status === 'processing').length
  );
  public readonly readySessionsCount = computed(() =>
    this.photoSessions().filter(session => session.status === 'ready').length
  );
  public readonly cartTotal = computed(() =>
    this.cartItems().reduce((total, item) => total + item.price, 0)
  );
  public readonly cartCount = computed(() => this.cartItems().length);
  public readonly isCartEmpty = computed(() => this.cartItems().length === 0);
  public readonly pendingPermissionsCount = computed(() =>
    this.permissions().filter(p => p.status === PermissionStatus.PENDING).length
  );
  /**
   * Получить фотосессии клиента через REST API
   */
  getClientPhotoSessions(_clientId: string): Observable<ApiResponse<ClientPhotoSession[]>> {
    this.isLoading.set(true);
    this.error.set(null);
    
    return this.apiService.get<ClientPhotoSession[]>('/photos/sessions').pipe(
      tap(response => {
        if (response.success && response.data) {
          this.photoSessionsSignal.set(response.data);
        }
        this.isLoading.set(false);
      }),
      catchError(error => {
        this.error.set(error.error?.message || 'Ошибка загрузки фотосессий');
        this.isLoading.set(false);
        return of({ success: false, error: error.error?.message || 'Ошибка загрузки фотосессий' });
      })
    );
  }
  /**
   * Получить фотографии конкретной сессии через REST API
   */
  getSessionPhotos(sessionId: string): Observable<ApiResponse<Photo[]>> {
    this.isLoading.set(true);
    this.error.set(null);
    
    return this.apiService.get<Photo[]>(`/photos/sessions/${sessionId}/photos`).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.sessionPhotosSignal.set(response.data);
          // Обновляем selectedPhotos из данных
          const selected = response.data.filter(p => p.selected);
          this.selectedPhotosSignal.set(selected);
        }
        this.isLoading.set(false);
      }),
      catchError(error => {
        this.error.set(error.error?.message || 'Ошибка загрузки фотографий');
        this.isLoading.set(false);
        return of({ success: false, error: error.error?.message || 'Ошибка загрузки фотографий' });
      })
    );
  }
  /**
   * Получить выбранные клиентом фотографии через REST API
   * Фильтрует фотографии сессии по selected=true
   */
  getSelectedPhotos(sessionId: string): Observable<ApiResponse<Photo[]>> {
    return this.getSessionPhotos(sessionId).pipe(
      map(response => {
        if (response.success && response.data) {
          const selected = response.data.filter(p => p.selected);
          this.selectedPhotosSignal.set(selected);
          return { ...response, data: selected };
        }
        return response;
      })
    );
  }
  /**
   * Выбрать/отменить выбор фотографии через REST API
   */
  togglePhotoSelection(_sessionId: string, photoId: string, selected: boolean): Observable<ApiResponse<Photo>> {
    this.isLoading.set(true);
    this.error.set(null);
    
    return this.apiService.put<Photo>(`/photos/${photoId}/select`, { selected }).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updatePhotoInList(response.data, this.sessionPhotosSignal);
          if (selected) {
            this.selectedPhotosSignal.update(photos => {
              const exists = photos.find(p => p.id === photoId);
              return exists ? photos : [...photos, response.data!];
            });
          } else {
            this.selectedPhotosSignal.update(photos => photos.filter(p => p.id !== photoId));
          }
        }
        this.isLoading.set(false);
      }),
      catchError(error => {
        this.error.set(error.error?.message || 'Ошибка изменения выбора фотографии');
        this.isLoading.set(false);
        return of({ success: false, error: error.error?.message || 'Ошибка изменения выбора фотографии' });
      })
    );
  }
  /**
   * Получить signed download URLs для фотографий сессии
   */
  getDownloadUrls(sessionId: string): Observable<ApiResponse<PhotoDownloadResponse>> {
    return this.apiService.get<PhotoDownloadResponse>(`/photos/sessions/${sessionId}/download`);
  }

  /**
   * Скачать архив фотографий сессии (legacy stub — используйте getDownloadUrls)
   */
  downloadSessionPhotos(sessionId: string): Observable<ApiResponse<PhotoSessionDownload>> {
    this.log.warn('downloadSessionPhotos: use getDownloadUrls() instead');
    return of({
      success: false,
      error: 'Use getDownloadUrls()',
      data: { sessionId, error: 'Use getDownloadUrls()' }
    });
  }

  /**
   * Скачать выбранные фотографии
   */
  downloadSelectedPhotos(sessionId: string): Observable<ApiResponse<PhotoDownloadResponse>> {
    return this.apiService.get<PhotoDownloadResponse>(`/photos/sessions/${sessionId}/download-selected`);
  }

  /**
   * Получить статистику фотографий клиента
   */
  getPhotoStats(_clientId: string): Observable<ApiResponse<{ totalSessions: number; totalPhotos: number; selectedPhotos: number; deliveredSessions: number }>> {
    return this.apiService.get('/photos/stats');
  }

  /**
   * Оставить отзыв о фотосессии
   */
  submitSessionReview(sessionId: string, rating: number, comment: string): Observable<ApiResponse<void>> {
    return this.apiService.post(`/photos/sessions/${sessionId}/review`, { rating, comment });
  }
  
  /**
   * Запросить повторную обработку фотографий
   */
  requestReprocessing(sessionId: string, photoIds: string[], instructions?: string): Observable<ApiResponse<void>> {
    return this.apiService.post(`/photos/sessions/${sessionId}/reprocess`, { photoIds, instructions });
  }

  /**
   * Получить детали конкретной фотосессии
   * Фильтрует из списка фотосессий
   */
  getSessionDetails(sessionId: string): Observable<ApiResponse<ClientPhotoSession>> {
    const sessions = this.photoSessions();
    const session = sessions.find(s => s.id === sessionId);
    
    if (session) {
      return of({ success: true, data: session });
    }
    
    // Если не найдено в кеше, загружаем все сессии
    return this.getClientPhotoSessions('').pipe(
      map(response => {
        if (response.success && response.data) {
          const found = response.data.find(s => s.id === sessionId);
          if (found) {
            return { success: true, data: found } as ApiResponse<ClientPhotoSession>;
          }
          return { success: false, error: 'Session not found' } as ApiResponse<ClientPhotoSession>;
        }
        return { success: false, error: 'Failed to load sessions' } as ApiResponse<ClientPhotoSession>;
      })
    );
  }

  // Утилиты
  private updatePhotoInList(updatedPhoto: Photo, photoSignal: WritableSignal<Photo[]>) {
    photoSignal.update((photos: Photo[]) =>
      photos.map(photo => photo.id === updatedPhoto.id ? updatedPhoto : photo)
    );
  }  /**
   * Очистить состояние
   */
  clearState(): void {
    this.photoSessionsSignal.set([]);
    this.sessionPhotosSignal.set([]);
    this.selectedPhotosSignal.set([]);
    this.permissionsSignal.set([]);
    this.photoSelectionsSignal.set([]);
    this.cartItemsSignal.set([]);
  }

  /**
   * Обновить статус сессии
   */
  updateSessionStatus(sessionId: string, status: ClientPhotoSession['status']): void {
    this.photoSessionsSignal.update(sessions =>
      sessions.map(session =>
        session.id === sessionId ? { ...session, status } : session
      )
    );
  }

  // =============================================================================
  // PHOTO PERMISSIONS METHODS
  // =============================================================================

  /**
   * Получить все разрешения пользователя
   */
  getUserPermissions(_userId: string): Observable<ApiResponse<PhotoPermission[]>> {
    return this.apiService.get<PhotoPermission[]>('/photos/permissions').pipe(
      tap(response => {
        if (response.success && response.data) {
          this.permissionsSignal.set(response.data);
        }
      })
    );
  }

  /**
   * Получить разрешение по ID
   */
  getPermissionById(permissionId: string): Observable<ApiResponse<PhotoPermission>> {
    return this.apiService.get<PhotoPermission>(`/photos/permissions/${permissionId}`);
  }

  /**
   * Создать новое разрешение
   */
  createPermission(permission: Omit<PhotoPermission, 'id' | 'createdAt' | 'status'>): Observable<ApiResponse<PhotoPermission>> {
    return this.apiService.post<PhotoPermission>('/photos/permissions', permission).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.permissionsSignal.update(permissions => [...permissions, response.data!]);
        }
      })
    );
  }

  /**
   * Обновить статус разрешения
   */
  updatePermissionStatus(permissionId: string, status: PermissionStatus, comments?: string): Observable<ApiResponse<PhotoPermission>> {
    return this.apiService.put<PhotoPermission>(`/photos/permissions/${permissionId}/status`, { status, comments }).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updatePermissionInList(response.data);
        }
      })
    );
  }

  /**
   * Подписать разрешение
   */
  signPermission(permissionId: string, signatureImage: string): Observable<ApiResponse<PhotoPermission>> {
    return this.apiService.post<PhotoPermission>(`/photos/permissions/${permissionId}/sign`, { signatureImage }).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updatePermissionInList(response.data);
        }
      })
    );
  }

  /**
   * Отозвать разрешение
   */
  revokePermission(permissionId: string, reason?: string): Observable<ApiResponse<PhotoPermission>> {
    return this.apiService.post<PhotoPermission>(`/photos/permissions/${permissionId}/revoke`, { reason }).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updatePermissionInList(response.data);
        }
      })
    );
  }

  // =============================================================================
  // PHOTO SELECTION METHODS
  // =============================================================================

  /**
   * Получить все выборы пользователя
   */
  getUserPhotoSelections(_userId: string): Observable<ApiResponse<PhotoSelection[]>> {
    return this.apiService.get<PhotoSelection[]>('/photos/selections').pipe(
      tap(response => {
        if (response.success && response.data) {
          this.photoSelectionsSignal.set(response.data);
        }
      })
    );
  }

  /**
   * Получить выбор по ID
   */
  getPhotoSelectionById(selectionId: string): Observable<ApiResponse<PhotoSelection>> {
    return this.apiService.get<PhotoSelection>(`/photos/selections/${selectionId}`);
  }

  /**
   * Создать новый выбор фотографий
   */
  createPhotoSelection(selection: Omit<PhotoSelection, 'id' | 'createdAt' | 'updatedAt'>): Observable<ApiResponse<PhotoSelection>> {
    return this.apiService.post<PhotoSelection>('/photos/selections', selection).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.photoSelectionsSignal.update(selections => [...selections, response.data!]);
        }
      })
    );
  }

  /**
   * Обновить выбор фотографий
   */
  updatePhotoSelection(selectionId: string, updates: Partial<PhotoSelection>): Observable<ApiResponse<PhotoSelection>> {
    return this.apiService.put<PhotoSelection>(`/photos/selections/${selectionId}`, updates).pipe(
      tap(response => {
        if (response.success && response.data) {
          this.updateSelectionInList(response.data);
        }
      })
    );
  }

  /**
   * Добавить фотографию в корзину
   */
  addToCart(photo: SelectedPhoto): void {
    this.cartItemsSignal.update(items => {
      const existingIndex = items.findIndex(item => item.photoId === photo.photoId);
      if (existingIndex >= 0) {
        // Заменить существующий элемент
        const updatedItems = [...items];
        updatedItems[existingIndex] = photo;
        return updatedItems;
      } else {
        // Добавить новый элемент
        return [...items, photo];
      }
    });
  }

  /**
   * Удалить фотографию из корзины
   */
  removeFromCart(photoId: string): void {
    this.cartItemsSignal.update(items => items.filter(item => item.photoId !== photoId));
  }

  /**
   * Очистить корзину
   */
  clearCart(): void {
    this.cartItemsSignal.set([]);
  }

  /**
   * Обновить фотографию в корзине
   */
  updateCartItem(photoId: string, updates: Partial<SelectedPhoto>): void {
    this.cartItemsSignal.update(items =>
      items.map(item =>
        item.photoId === photoId ? { ...item, ...updates } : item
      )
    );
  }

  /**
   * Оформить заказ из корзины
   */
  checkoutCart(sessionId: string, userId: string): Observable<ApiResponse<PhotoSelection>> {
    const cartItems = this.cartItems();
    if (cartItems.length === 0) {
      throw new Error('Корзина пуста');
    }

    const selection: Omit<PhotoSelection, 'id' | 'createdAt' | 'updatedAt'> = {
      sessionId,
      userId,
      selectedPhotos: cartItems,
      totalPrice: this.cartTotal(),
      status: PhotoSelectionStatus.PENDING_PAYMENT
    };

    return this.createPhotoSelection(selection).pipe(
      tap(() => {
        this.clearCart();
      })
    );
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private updatePermissionInList(updatedPermission: PhotoPermission): void {
    this.permissionsSignal.update(permissions =>
      permissions.map(permission =>
        permission.id === updatedPermission.id ? updatedPermission : permission
      )
    );
  }

  private updateSelectionInList(updatedSelection: PhotoSelection): void {
    this.photoSelectionsSignal.update(selections =>
      selections.map(selection =>
        selection.id === updatedSelection.id ? updatedSelection : selection
      )
    );
  }

  /**
   * Выбрать версию фото
   */
  async selectPhotoVersion(photoId: string): Promise<void> {
    await firstValueFrom(this.apiService.put(`/photos/${photoId}/select`, { selected: true }));
  }

  /**
   * Сохранить отзыв о фото
   */
  async savePhotoFeedback(photoId: string, feedback: { rating: number; comment?: string; preferences: string[] }): Promise<void> {
    await firstValueFrom(this.apiService.post(`/photos/${photoId}/feedback`, feedback));
  }

  /**
   * Скачать фото (открывает signed URL)
   */
  async downloadPhoto(photoId: string): Promise<void> {
    const photos = this.sessionPhotos();
    const photo = photos.find(p => p.id === photoId);
    if (!photo) {
      this.log.warn('downloadPhoto: photo not found in current session');
      return;
    }
    if (photo.originalUrl || photo.processedUrl) {
      window.open(photo.originalUrl || photo.processedUrl, '_blank');
    }
  }

  /**
   * Получить сессии пользователя
   */
  async getUserSessions(): Promise<ClientPhotoSession[]> {
    const response = await firstValueFrom(this.apiService.get<ClientPhotoSession[]>('/photos/sessions'));
    if (response?.success && response.data) {
      this.photoSessionsSignal.set(response.data);
      return response.data;
    }
    return [];
  }

  /**
   * Получить новые обработанные сессии (ready status)
   */
  async getNewProcessedSessions(): Promise<ClientPhotoSession[]> {
    const sessions = await this.getUserSessions();
    return sessions.filter(s => s.status === 'ready');
  }

  /**
   * Скачать сессию (получает signed URLs и открывает)
   */
  async downloadSession(sessionId: string): Promise<void> {
    const response = await firstValueFrom(this.apiService.get<PhotoDownloadResponse>(`/photos/sessions/${sessionId}/download`));
    if (response?.success && response.data?.photos?.length) {
      for (const photo of response.data.photos) {
        window.open(photo.url, '_blank');
      }
    }
  }
}
