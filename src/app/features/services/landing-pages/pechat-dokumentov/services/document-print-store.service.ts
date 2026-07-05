import {
  Injectable, OnDestroy, PLATFORM_ID, computed, inject, signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import { ADDRESSES } from '../../../../../core/data/address.data';

export type DocumentUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'error';
export type DocumentPaperSize = 'a4' | 'a3';
export type DocumentColorMode = 'bw' | 'color';
export type DocumentSides = 'single' | 'double';
export type DocumentFinishing = 'none' | 'staple' | 'clip' | 'plastic_spring';
export type PickupLocationStatus = 'open' | 'closed' | 'maintenance';

export interface DocumentPrintItem {
  id: string;
  file: File;
  fileName: string;
  contentType: string;
  fileSize: number;
  sizeLabel: string;
  uploadedUrl?: string;
  s3Key?: string;
  pageCount: number;
  status: DocumentUploadStatus;
  uploadProgress: number;
  errorMessage?: string;
}

export type DocumentPrintFileItem = DocumentPrintItem;

export interface DocumentPrintSettings {
  paperSize: DocumentPaperSize;
  colorMode: DocumentColorMode;
  sides: DocumentSides;
  copies: number;
  finishing: DocumentFinishing;
}

export interface DocumentPrintContact {
  name: string;
  phone: string;
  email?: string;
  comments?: string;
}

export interface PickupLocationHour {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isOpen: boolean;
}

export interface PickupLocation {
  id: string;
  studioId?: string;
  name: string;
  address: string;
  status: PickupLocationStatus;
  statusMessage?: string | null;
  statusUntil?: string | null;
  workHours: string;
  hours: PickupLocationHour[];
}

export interface DocumentPrintOrderResult {
  success: boolean;
  orderId?: string;
  paymentUrl?: string | null;
  totalPrice?: number;
  message?: string;
  error?: string;
}

interface PickupLocationsResponse {
  success: boolean;
  data?: PickupLocation[];
  error?: string;
}

interface DirectUploadTarget {
  s3Key: string;
  uploadUrl: string;
  contentType: string;
}

interface DirectPresignResponse {
  success: boolean;
  data?: {
    uploads: DirectUploadTarget[];
  };
  error?: string;
}

interface DirectCompleteFile {
  uploadedUrl?: string;
  url?: string;
  s3Key: string;
  fileName: string;
  contentType?: string;
  fileSize?: number;
}

interface DirectCompleteResponse {
  success: boolean;
  data?: {
    files: DirectCompleteFile[];
    count: number;
  };
  error?: string;
}

interface DirectUploadPlan {
  item: DocumentPrintItem;
  uploadTarget: DirectUploadTarget;
}

interface CompletedUpload {
  itemId: string;
  file: File;
  uploadTarget: DirectUploadTarget;
  contentType: string;
}

interface CreateDocumentPrintOrderResponse {
  success: boolean;
  data?: {
    orderId: string;
    totalPrice: number;
    paymentUrl?: string | null;
    message?: string;
  };
  error?: string;
}

export const DOCUMENT_PRINT_UNIT_PRICES: Record<DocumentPaperSize, Record<DocumentColorMode, number>> = {
  a4: { bw: 10, color: 15 },
  a3: { bw: 20, color: 30 },
};

export const DOCUMENT_PRINT_FINISHING_PRICES: Record<DocumentFinishing, number> = {
  none: 0,
  staple: 0,
  clip: 0,
  plastic_spring: 100,
};

export const DOCUMENT_PRINT_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.rtf',
  '.odt',
  '.ods',
  '.odp',
  '.txt',
  '.csv',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.tif',
  '.tiff',
  '.bmp',
].join(',');

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const DIRECT_UPLOAD_BATCH_SIZE = 20;
const DIRECT_UPLOAD_CONCURRENCY = 3;
const DEFAULT_SETTINGS: DocumentPrintSettings = {
  paperSize: 'a4',
  colorMode: 'bw',
  sides: 'single',
  copies: 1,
  finishing: 'none',
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  bmp: 'image/bmp',
};

const ALLOWED_CONTENT_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const FALLBACK_PICKUP_LOCATIONS: PickupLocation[] = ADDRESSES.map(address => ({
  id: address.id,
  name: address.name,
  address: address.address,
  status: 'open',
  statusMessage: null,
  statusUntil: null,
  workHours: address.workHours,
  hours: [],
}));

function isPhysicalPickupLocation(location: PickupLocation): boolean {
  const id = location.id.toLowerCase();
  const studioId = location.studioId?.toLowerCase() ?? '';
  const name = location.name.toLowerCase();

  return ![id, studioId, name].some(value => value.includes('online') || value.includes('онлайн'));
}

function documentPrintPickupLocations(locations: readonly PickupLocation[]): PickupLocation[] {
  const physicalLocations = locations.filter(isPhysicalPickupLocation);
  return physicalLocations.length > 0 ? physicalLocations : FALLBACK_PICKUP_LOCATIONS;
}

function generateId(): string {
  return `doc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function fileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
}

function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${Math.round(size / 1024 / 102.4) / 10} МБ`;
  }
  return `${Math.max(1, Math.round(size / 1024))} КБ`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function uploadErrorMessage(error: unknown, fallback: string): string {
  if (isRecord(error)) {
    const nested = error['error'];
    if (typeof nested === 'string' && nested.trim()) {
      return nested;
    }

    if (isRecord(nested)) {
      const nestedError = nested['error'];
      if (typeof nestedError === 'string' && nestedError.trim()) {
        return nestedError;
      }

      const nestedMessage = nested['message'];
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage;
      }
    }

    const status = error['status'];
    if (typeof status === 'number' && status > 0) {
      return `${fallback}: HTTP ${status}`;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

@Injectable()
export class DocumentPrintStoreService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly uploadQueue: DocumentPrintItem[] = [];
  private isProcessingUploadQueue = false;

  private readonly _items = signal<DocumentPrintItem[]>([]);
  private readonly _settings = signal<DocumentPrintSettings>({ ...DEFAULT_SETTINGS });
  private readonly _contact = signal<DocumentPrintContact>({ name: '', phone: '' });
  private readonly _isSubmitting = signal(false);
  private readonly _submitError = signal<string | null>(null);
  private readonly _orderId = signal<string | null>(null);
  private readonly _paymentUrl = signal<string | null>(null);
  private readonly _pickupLocations = signal<PickupLocation[]>(FALLBACK_PICKUP_LOCATIONS);
  private readonly _selectedPickupLocationId = signal<string | null>(FALLBACK_PICKUP_LOCATIONS[0]?.id ?? null);
  private readonly _pickupLocationsError = signal<string | null>(null);
  private readonly _isLoadingPickupLocations = signal(false);

  readonly items = this._items.asReadonly();
  readonly settings = this._settings.asReadonly();
  readonly contact = this._contact.asReadonly();
  readonly isSubmitting = this._isSubmitting.asReadonly();
  readonly submitError = this._submitError.asReadonly();
  readonly orderId = this._orderId.asReadonly();
  readonly paymentUrl = this._paymentUrl.asReadonly();
  readonly pickupLocations = this._pickupLocations.asReadonly();
  readonly selectedPickupLocationId = this._selectedPickupLocationId.asReadonly();
  readonly pickupLocationsError = this._pickupLocationsError.asReadonly();
  readonly isLoadingPickupLocations = this._isLoadingPickupLocations.asReadonly();
  readonly isSuccess = computed(() => !!this._orderId());
  readonly hasItems = computed(() => this._items().length > 0);
  readonly totalFiles = computed(() => this._items().length);
  readonly totalPages = computed(() => this._items().reduce((sum, item) => sum + item.pageCount, 0));
  readonly totalPrintedSides = computed(() => this.totalPages() * this._settings().copies);
  readonly uploadedItemsCount = computed(() => this._items().filter(item => item.status === 'uploaded').length);
  readonly isAnyUploading = computed(() => this._items().some(item => item.status === 'pending' || item.status === 'uploading'));
  readonly allUploaded = computed(() => this._items().length > 0 && this._items().every(item => item.status === 'uploaded'));
  readonly unitPrice = computed(() => {
    const settings = this._settings();
    return DOCUMENT_PRINT_UNIT_PRICES[settings.paperSize][settings.colorMode];
  });
  readonly totalPrice = computed(() => this.totalPrintedSides() * this.unitPrice());
  readonly finishingPrice = computed(() => DOCUMENT_PRINT_FINISHING_PRICES[this._settings().finishing] * this._settings().copies);
  readonly estimatedTotalPrice = computed(() => this.totalPrice() + this.finishingPrice());
  readonly selectedPickupLocation = computed(() => {
    const selectedId = this._selectedPickupLocationId();
    return this._pickupLocations().find(location => location.id === selectedId && location.status === 'open') ?? null;
  });
  readonly uploadProgressPercent = computed(() => {
    const items = this._items();
    if (items.length === 0) return 0;

    const totalProgress = items.reduce((sum, item) => {
      if (item.status === 'uploaded') return sum + 100;
      return sum + Math.min(100, Math.max(0, item.uploadProgress));
    }, 0);

    return Math.round(totalProgress / items.length);
  });
  readonly canSubmit = computed(() => {
    const contact = this._contact();
    return (
      !this._isSubmitting()
      && this.allUploaded()
      && !!this.selectedPickupLocation()
      && contact.name.trim().length >= 2
      && contact.phone.replace(/\D/g, '').length >= 10
    );
  });

  addFiles(files: FileList | File[]): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const arr = Array.from(files);
    const newItems = arr
      .map(file => this.createItem(file))
      .filter((item): item is DocumentPrintItem => item !== null);

    if (newItems.length === 0) return;

    this._items.update(items => [...items, ...newItems]);
    this.enqueueUploads(newItems);
  }

  retryUpload(id: string): void {
    const item = this._items().find(candidate => candidate.id === id);
    if (!item || item.status !== 'error') return;

    this.patchItem(id, { status: 'pending', uploadProgress: 0, errorMessage: undefined });
    this.enqueueUploads([item]);
  }

  removeItem(id: string): void {
    this._items.update(items => items.filter(item => item.id !== id));
  }

  updateItemPageCount(id: string, pageCount: number): void {
    const nextPageCount = Math.min(2000, Math.max(1, Math.round(pageCount || 1)));
    this.patchItem(id, { pageCount: nextPageCount });
  }

  updateSettings(patch: Partial<DocumentPrintSettings>): void {
    this._settings.update(settings => ({
      ...settings,
      ...patch,
      copies: Math.min(999, Math.max(1, Math.round(patch.copies ?? settings.copies))),
    }));
  }

  updatePrintSettings(patch: Partial<DocumentPrintSettings>): void {
    this.updateSettings(patch);
  }

  updateContact(updates: Partial<DocumentPrintContact>): void {
    this._contact.update(contact => ({ ...contact, ...updates }));
  }

  async ensurePickupLocationsLoaded(): Promise<void> {
    if (this._isLoadingPickupLocations()) return;

    this._isLoadingPickupLocations.set(true);
    this._pickupLocationsError.set(null);

    try {
      const response = await firstValueFrom(
        this.http.get<PickupLocationsResponse>('/api/studios/pickup-locations'),
      );
      const locations = response.success && response.data?.length
        ? documentPrintPickupLocations(response.data)
        : FALLBACK_PICKUP_LOCATIONS;

      this._pickupLocations.set(locations);
      this._pickupLocationsError.set(response.success
        ? null
        : response.error || 'Не удалось обновить список точек самовывоза');
    } catch {
      this._pickupLocations.set(FALLBACK_PICKUP_LOCATIONS);
      this._pickupLocationsError.set('Показываем точки из справочника. При создании заказа проверим доступность.');
    } finally {
      this.ensureSelectedPickupLocation();
      this._isLoadingPickupLocations.set(false);
    }
  }

  selectPickupLocation(id: string): void {
    const location = this._pickupLocations().find(item => item.id === id);
    if (!location || location.status !== 'open') return;
    this._selectedPickupLocationId.set(id);
  }

  submitOrder(): Observable<DocumentPrintOrderResult> {
    const pickupLocation = this.selectedPickupLocation();
    if (!pickupLocation) {
      return of({ success: false, error: 'Выберите точку самовывоза' });
    }

    if (!this.canSubmit()) {
      return of({ success: false, error: 'Заполните контакты и дождитесь загрузки файлов' });
    }

    this._isSubmitting.set(true);
    this._submitError.set(null);

    const payload = {
      contact: this._contact(),
      pickupLocationId: pickupLocation.id,
      print: this._settings(),
      files: this._items().map(item => ({
        fileName: item.fileName,
        contentType: item.contentType,
        fileSize: item.fileSize,
        s3Key: item.s3Key,
        uploadedUrl: item.uploadedUrl,
        pageCount: item.pageCount,
      })),
      source: 'website',
    };

    return this.http.post<CreateDocumentPrintOrderResponse>('/api/orders/document-print', payload).pipe(
      map(response => {
        if (response.success && response.data) {
          this._orderId.set(response.data.orderId);
          this._paymentUrl.set(response.data.paymentUrl ?? null);
          return {
            success: true,
            orderId: response.data.orderId,
            paymentUrl: response.data.paymentUrl ?? null,
            totalPrice: response.data.totalPrice,
            message: response.data.message || 'Заказ создан. Оплатите онлайн, и мы начнём печать.',
          };
        }
        return { success: false, error: response.error || 'Ошибка при создании заказа' };
      }),
      catchError((error: unknown) => of({
        success: false,
        error: uploadErrorMessage(error, 'Ошибка при создании заказа'),
      })),
      tap(result => {
        if (!result.success) {
          this._submitError.set(result.error || null);
        }
      }),
      finalize(() => this._isSubmitting.set(false)),
    );
  }

  clearOrder(): void {
    this.uploadQueue.length = 0;
    this._items.set([]);
    this._settings.set({ ...DEFAULT_SETTINGS });
    this._contact.set({ name: '', phone: '' });
    this._orderId.set(null);
    this._paymentUrl.set(null);
    this._submitError.set(null);
    this.ensureSelectedPickupLocation();
  }

  ngOnDestroy(): void {
    this.uploadQueue.length = 0;
    this._items.set([]);
  }

  private createItem(file: File): DocumentPrintItem | null {
    const contentType = this.contentTypeForFile(file);
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      return null;
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return null;
    }

    return {
      id: generateId(),
      file,
      fileName: file.name,
      contentType,
      fileSize: file.size,
      sizeLabel: formatFileSize(file.size),
      pageCount: 1,
      status: 'pending',
      uploadProgress: 0,
    };
  }

  private contentTypeForFile(file: File): string {
    if (file.type && ALLOWED_CONTENT_TYPES.has(file.type)) {
      return file.type;
    }

    return MIME_BY_EXTENSION[fileExtension(file.name)] ?? '';
  }

  private enqueueUploads(items: readonly DocumentPrintItem[]): void {
    this.uploadQueue.push(...items);
    if (this.isProcessingUploadQueue) return;

    this.isProcessingUploadQueue = true;
    void this.processUploadQueue();
  }

  private async processUploadQueue(): Promise<void> {
    try {
      while (this.uploadQueue.length > 0) {
        const batch = this.uploadQueue
          .splice(0, DIRECT_UPLOAD_BATCH_SIZE)
          .filter(item => this.isPendingUploadItem(item.id));

        if (batch.length === 0) continue;
        await this.uploadItemsBatch(batch);
      }
    } finally {
      this.isProcessingUploadQueue = false;
      if (this.uploadQueue.length > 0) {
        this.enqueueUploads([]);
      }
    }
  }

  private async uploadItemsBatch(batch: readonly DocumentPrintItem[]): Promise<void> {
    const items = batch.filter(item => this.isPendingUploadItem(item.id));
    if (items.length === 0) return;

    const itemIds = items.map(item => item.id);
    this.patchItems(itemIds, {
      status: 'uploading',
      uploadProgress: 0,
      errorMessage: undefined,
    });

    let uploadTargets: DirectUploadTarget[];
    try {
      const presign = await firstValueFrom(
        this.http.post<DirectPresignResponse>('/api/orders/document-print/direct-upload/presign', {
          files: items.map(item => ({
            fileName: item.fileName,
            contentType: item.contentType,
            fileSize: item.fileSize,
          })),
        }),
      );

      uploadTargets = presign.data?.uploads ?? [];
      if (!presign.success || uploadTargets.length !== items.length) {
        throw new Error(presign.error || 'Не удалось подготовить загрузку файлов');
      }
    } catch (error: unknown) {
      this.patchItems(itemIds, {
        status: 'error',
        errorMessage: uploadErrorMessage(error, 'Не удалось подготовить загрузку файлов'),
      });
      return;
    }

    const uploadPlans: DirectUploadPlan[] = [];
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const uploadTarget = uploadTargets[index];
      if (item && uploadTarget) {
        uploadPlans.push({ item, uploadTarget });
      }
    }

    const completedUploads: CompletedUpload[] = [];
    await this.runWithConcurrency(uploadPlans, DIRECT_UPLOAD_CONCURRENCY, async plan => {
      if (!this.hasItem(plan.item.id)) return;

      try {
        this.patchItem(plan.item.id, { uploadProgress: 3 });
        await this.uploadToStorage(plan.item.id, plan.item.file, plan.uploadTarget);
        this.patchItem(plan.item.id, { uploadProgress: 96 });
        completedUploads.push({
          itemId: plan.item.id,
          file: plan.item.file,
          uploadTarget: plan.uploadTarget,
          contentType: plan.item.contentType,
        });
      } catch (error: unknown) {
        this.patchItem(plan.item.id, {
          status: 'error',
          errorMessage: uploadErrorMessage(error, 'Ошибка загрузки файла'),
        });
      }
    });

    const currentUploads = completedUploads.filter(upload => this.hasItem(upload.itemId));
    if (currentUploads.length === 0) return;

    try {
      const complete = await firstValueFrom(
        this.http.post<DirectCompleteResponse>('/api/orders/document-print/direct-upload/complete', {
          files: currentUploads.map(upload => ({
            s3Key: upload.uploadTarget.s3Key,
            fileName: upload.file.name,
            contentType: upload.uploadTarget.contentType || upload.contentType,
            fileSize: upload.file.size,
          })),
        }),
      );

      if (!complete.success) {
        throw new Error(complete.error || 'Не удалось завершить загрузку файлов');
      }

      const uploadedFiles = new Map((complete.data?.files ?? []).map(file => [file.s3Key, file]));
      for (const upload of currentUploads) {
        const uploadedFile = uploadedFiles.get(upload.uploadTarget.s3Key);
        const uploadedUrl = uploadedFile?.uploadedUrl ?? uploadedFile?.url;
        if (uploadedUrl) {
          this.patchItem(upload.itemId, {
            uploadedUrl,
            s3Key: upload.uploadTarget.s3Key,
            status: 'uploaded',
            uploadProgress: 100,
            errorMessage: undefined,
          });
        } else {
          this.patchItem(upload.itemId, {
            status: 'error',
            errorMessage: 'Не удалось завершить загрузку файла',
          });
        }
      }
    } catch (error: unknown) {
      this.patchItems(currentUploads.map(upload => upload.itemId), {
        status: 'error',
        errorMessage: uploadErrorMessage(error, 'Не удалось завершить загрузку файлов'),
      });
    }
  }

  private uploadToStorage(id: string, file: File, uploadTarget: DirectUploadTarget): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadTarget.uploadUrl, true);
      xhr.setRequestHeader('Content-Type', uploadTarget.contentType || file.type);

      xhr.upload.onprogress = event => {
        if (!event.lengthComputable) return;
        const storageProgress = Math.round((event.loaded / event.total) * 92);
        this.patchItem(id, { uploadProgress: Math.min(95, Math.max(3, 3 + storageProgress)) });
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(new Error(`Ошибка загрузки файла: ${xhr.status}`));
      };

      xhr.onerror = () => reject(new Error('Сеть прервала загрузку файла'));
      xhr.onabort = () => reject(new Error('Загрузка файла отменена'));
      xhr.send(file);
    });
  }

  private patchItem(id: string, patch: Partial<DocumentPrintItem>): void {
    this._items.update(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  private patchItems(ids: readonly string[], patch: Partial<DocumentPrintItem>): void {
    const idSet = new Set(ids);
    this._items.update(items => items.map(item => idSet.has(item.id) ? { ...item, ...patch } : item));
  }

  private hasItem(id: string): boolean {
    return this._items().some(item => item.id === id);
  }

  private isPendingUploadItem(id: string): boolean {
    return this._items().some(item => item.id === id && item.status === 'pending');
  }

  private ensureSelectedPickupLocation(): void {
    const selected = this._selectedPickupLocationId();
    const openLocations = this._pickupLocations().filter(location => location.status === 'open');
    if (selected && openLocations.some(location => location.id === selected)) return;
    this._selectedPickupLocationId.set(openLocations[0]?.id ?? null);
  }

  private async runWithConcurrency<T>(
    entries: readonly T[],
    concurrency: number,
    worker: (entry: T) => Promise<void>,
  ): Promise<void> {
    let nextIndex = 0;
    const workerCount = Math.min(concurrency, entries.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const index = nextIndex;
        nextIndex += 1;
        const entry = entries[index];
        if (entry) {
          await worker(entry);
        }
      }
    }));
  }
}
