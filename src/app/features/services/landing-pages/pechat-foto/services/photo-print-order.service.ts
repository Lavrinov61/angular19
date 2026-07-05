import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, tap, finalize } from 'rxjs/operators';
import {
  PhotoPrintItem,
  PhotoPrintOrder,
  OrderContactInfo,
  PhotoFormat,
  PaperType,
  OrderMode,
  PhotoPrintPrices,
  DEFAULT_PRINT_PRICES,
  FILE_VALIDATION,
  createPhotoPrintItem,
  MarginOption,
  BorderOption,
  DeadlineOption,
  PrintOptions,
  DEFAULT_PRINT_OPTIONS,
  DEADLINE_OPTIONS
} from '../models/photo-print-order.model';
import { FileStorageService } from '../../../../../core/services/file-storage.service';
import { PricesService } from '../../../../../core/services/prices.service';

export interface OrderSubmitResult {
  success: boolean;
  orderId?: string;
  message?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PhotoPrintOrderService {
  private readonly http = inject(HttpClient);
  private readonly fileStorage = inject(FileStorageService);
  private readonly pricesService = inject(PricesService);
  private readonly platformId = inject(PLATFORM_ID);

  // State signals
  private readonly itemsSignal = signal<PhotoPrintItem[]>([]);
  private readonly modeSignal = signal<OrderMode>('simple');
  private readonly contactSignal = signal<OrderContactInfo>({ name: '', phone: '' });
  private readonly deadlineSignal = signal<DeadlineOption>('standard');
  private readonly optionsSignal = signal<PrintOptions>(DEFAULT_PRINT_OPTIONS);
  private readonly isSubmittingSignal = signal<boolean>(false);
  private readonly submitErrorSignal = signal<string | null>(null);

  // Public readonly signals
  readonly items = this.itemsSignal.asReadonly();
  readonly mode = this.modeSignal.asReadonly();
  readonly contact = this.contactSignal.asReadonly();
  readonly deadline = this.deadlineSignal.asReadonly();
  readonly options = this.optionsSignal.asReadonly();
  readonly isSubmitting = this.isSubmittingSignal.asReadonly();
  readonly submitError = this.submitErrorSignal.asReadonly();

  // Computed signals
  readonly itemCount = computed(() => this.itemsSignal().length);
  readonly hasItems = computed(() => this.itemsSignal().length > 0);
  readonly allUploaded = computed(() => 
    this.itemsSignal().length > 0 && 
    this.itemsSignal().every(item => item.status === 'uploaded')
  );
  readonly hasUploadErrors = computed(() => 
    this.itemsSignal().some(item => item.status === 'error')
  );
  readonly isUploading = computed(() => 
    this.itemsSignal().some(item => item.status === 'uploading')
  );
  readonly totalQuantity = computed(() => 
    this.itemsSignal().reduce((sum, item) => sum + item.quantity, 0)
  );

  // Price calculation
  readonly prices = computed<PhotoPrintPrices>(() => {
    const apiPrices = this.pricesService.prices();
    return {
      premium: {
        '10x15': apiPrices.premium_10x15 || DEFAULT_PRINT_PRICES.premium['10x15'],
        '15x20': apiPrices.premium_15x20 || DEFAULT_PRINT_PRICES.premium['15x20'],
        '20x30': apiPrices.premium_20x30 || DEFAULT_PRINT_PRICES.premium['20x30'],
        '30x40': DEFAULT_PRINT_PRICES.premium['30x40']
      },
      super: {
        '10x15': apiPrices.super_10x15 || DEFAULT_PRINT_PRICES.super['10x15'],
        '15x20': apiPrices.super_15x20 || DEFAULT_PRINT_PRICES.super['15x20'],
        '20x30': apiPrices.super_20x30 || DEFAULT_PRINT_PRICES.super['20x30'],
        '30x40': DEFAULT_PRINT_PRICES.super['30x40']
      }
    };
  });

  readonly totalPrice = computed(() => {
    const mode = this.modeSignal();
    const items = this.itemsSignal();
    const prices = this.prices();
    const deadline = this.deadlineSignal();
    
    // Get deadline multiplier
    const deadlineOption = DEADLINE_OPTIONS.find(d => d.value === deadline);
    const multiplier = deadlineOption?.multiplier || 1;

    let basePrice = 0;
    
    if (mode === 'simple') {
      // In simple mode, show estimated price (10x15 premium as default)
      const pricePerPhoto = prices.premium['10x15'];
      basePrice = items.reduce((sum, item) => sum + pricePerPhoto * item.quantity, 0);
    } else {
      // In custom mode, calculate exact price
      basePrice = items.reduce((sum, item) => {
        if (item.format === 'auto' || item.paperType === 'auto') {
          // Use default for auto selections
          return sum + prices.premium['10x15'] * item.quantity;
        }
        const price = prices[item.paperType][item.format];
        return sum + price * item.quantity;
      }, 0);
    }
    
    return Math.round(basePrice * multiplier);
  });

  readonly minPrice = computed(() => this.prices().premium['10x15']);

  // Check if order is ready to submit
  readonly canSubmit = computed(() => {
    const contact = this.contactSignal();
    const items = this.itemsSignal();
    const isSubmitting = this.isSubmittingSignal();

    return (
      !isSubmitting &&
      items.length > 0 &&
      items.every(item => item.status === 'uploaded') &&
      contact.name.trim().length >= 2 &&
      contact.phone.trim().length >= 10
    );
  });

  /**
   * Set the order mode (simple or custom)
   */
  setMode(mode: OrderMode): void {
    this.modeSignal.set(mode);
  }

  /**
   * Update contact information
   */
  updateContact(contact: Partial<OrderContactInfo>): void {
    this.contactSignal.update(current => ({ ...current, ...contact }));
  }

  /**
   * Set deadline option
   */
  setDeadline(deadline: DeadlineOption): void {
    this.deadlineSignal.set(deadline);
  }

  /**
   * Update print options
   */
  updateOptions(options: Partial<PrintOptions>): void {
    this.optionsSignal.update(current => ({ ...current, ...options }));
  }

  /**
   * Add files to the order
   */
  addFiles(files: FileList | File[]): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const fileArray = Array.from(files);
    const validFiles = fileArray.filter(file => this.validateFile(file));

    validFiles.forEach(file => {
      const previewUrl = URL.createObjectURL(file);
      const item = createPhotoPrintItem(file, previewUrl);
      
      this.itemsSignal.update(items => [...items, item]);
      
      // Start upload immediately
      this.uploadFile(item.id);
    });
  }

  /**
   * Remove a photo from the order
   */
  removeItem(itemId: string): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const item = this.itemsSignal().find(i => i.id === itemId);
    if (item) {
      // Revoke blob URL to free memory
      URL.revokeObjectURL(item.previewUrl);
      this.itemsSignal.update(items => items.filter(i => i.id !== itemId));
    }
  }

  /**
   * Update item options (format, paper, quantity, margins, border)
   */
  updateItem(itemId: string, updates: Partial<Pick<PhotoPrintItem, 'format' | 'paperType' | 'quantity' | 'margins' | 'border'>>): void {
    this.itemsSignal.update(items => 
      items.map(item => 
        item.id === itemId ? { ...item, ...updates } : item
      )
    );
  }

  /**
   * Apply settings to all items
   */
  applyToAll(settings: { format?: PhotoFormat; paperType?: PaperType; quantity?: number; margins?: MarginOption; border?: BorderOption }): void {
    this.itemsSignal.update(items => 
      items.map(item => ({ ...item, ...settings }))
    );
  }

  /**
   * Retry upload for a failed item
   */
  retryUpload(itemId: string): void {
    const item = this.itemsSignal().find(i => i.id === itemId);
    if (item && item.status === 'error') {
      this.updateItemStatus(itemId, 'pending', 0);
      this.uploadFile(itemId);
    }
  }

  /**
   * Clear all items and reset order
   */
  clearOrder(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    // Revoke all blob URLs
    this.itemsSignal().forEach(item => {
      URL.revokeObjectURL(item.previewUrl);
    });

    this.itemsSignal.set([]);
    this.contactSignal.set({ name: '', phone: '' });
    this.deadlineSignal.set('standard');
    this.optionsSignal.set(DEFAULT_PRINT_OPTIONS);
    this.submitErrorSignal.set(null);
  }

  /**
   * Submit the order to the backend
   */
  submitOrder(): Observable<OrderSubmitResult> {
    if (!this.canSubmit()) {
      return of({ success: false, error: 'Заполните все обязательные поля' });
    }

    this.isSubmittingSignal.set(true);
    this.submitErrorSignal.set(null);

    const order: PhotoPrintOrder = {
      mode: this.modeSignal(),
      items: this.itemsSignal(),
      contact: this.contactSignal(),
      deadline: this.deadlineSignal(),
      options: this.optionsSignal(),
      totalPrice: this.totalPrice()
    };

    // Prepare order data for API
    const orderData = {
      mode: order.mode,
      items: order.items.map(item => ({
        uploadedUrl: item.uploadedUrl,
        format: item.format,
        paperType: item.paperType,
        quantity: item.quantity,
        margins: item.margins,
        border: item.border
      })),
      contact: order.contact,
      deadline: order.deadline,
      options: order.options,
      totalPrice: order.totalPrice
    };

    return this.http.post<{ success: boolean; data?: { orderId: string }; error?: string }>(
      '/api/orders/photo-print',
      orderData
    ).pipe(
      map(response => {
        if (response.success && response.data) {
          return {
            success: true,
            orderId: response.data.orderId,
            message: 'Заказ успешно отправлен!'
          };
        }
        return { success: false, error: response.error || 'Ошибка при отправке заказа' };
      }),
      catchError(() => {
        return of({ success: false, error: 'Ошибка при отправке заказа. Попробуйте позже.' });
      }),
      tap(result => {
        if (!result.success) {
          this.submitErrorSignal.set(result.error || 'Неизвестная ошибка');
        }
      }),
      finalize(() => {
        this.isSubmittingSignal.set(false);
      })
    );
  }

  /**
   * Validate a file before adding
   */
  private validateFile(file: File): boolean {
    // Check file type
    if (!FILE_VALIDATION.allowedTypes.includes(file.type)) {
      return false;
    }

    if (file.size > FILE_VALIDATION.maxSizeBytes) {
      return false;
    }

    return true;
  }

  /**
   * Upload a single file
   */
  private uploadFile(itemId: string): void {
    const item = this.itemsSignal().find(i => i.id === itemId);
    if (!item) return;

    this.updateItemStatus(itemId, 'uploading', 0);

    const path = `photo-print/${Date.now()}-${item.file.name}`;

    this.fileStorage.uploadFileWithProgress(path, item.file).subscribe({
      next: (result) => {
        if (typeof result === 'string') {
          // Upload complete, result is the URL
          this.itemsSignal.update(items =>
            items.map(i =>
              i.id === itemId
                ? { ...i, uploadedUrl: result, status: 'uploaded' as const, uploadProgress: 100 }
                : i
            )
          );
        } else {
          // Progress update
          this.updateItemStatus(itemId, 'uploading', result.progress);
        }
      },
      error: (error) => {
        this.itemsSignal.update(items =>
          items.map(i =>
            i.id === itemId
              ? { ...i, status: 'error' as const, errorMessage: error.message || 'Ошибка загрузки' }
              : i
          )
        );
      }
    });
  }

  /**
   * Update item upload status
   */
  private updateItemStatus(itemId: string, status: PhotoPrintItem['status'], progress: number): void {
    this.itemsSignal.update(items =>
      items.map(item =>
        item.id === itemId
          ? { ...item, status, uploadProgress: progress }
          : item
      )
    );
  }

  /**
   * Get price for a specific format and paper type
   */
  getPrice(format: PhotoFormat, paperType: PaperType): number {
    if (format === 'auto' || paperType === 'auto') {
      return this.prices().premium['10x15'];
    }
    return this.prices()[paperType][format];
  }
}
