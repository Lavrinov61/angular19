import {
  Component,
  inject,
  signal,
  computed,
  PLATFORM_ID,
  ChangeDetectionStrategy,
  ViewChild,
  ElementRef,
  OnDestroy
} from '@angular/core';
import { CommonModule, isPlatformBrowser, SlicePipe } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { DragDropDirective } from '../../../../../../shared/directives/drag-drop.directive';
import { PhoneMaskDirective } from '../../../../../../shared/directives/phone-mask.directive';
import { PhotoPrintOrderService } from '../../services/photo-print-order.service';
import {
  PhotoFormat,
  PaperType,
  OrderMode,
  MarginOption,
  BorderOption,
  DeadlineOption,
  FORMAT_OPTIONS,
  PAPER_OPTIONS,
  MARGIN_OPTIONS,
  BORDER_OPTIONS,
  DEADLINE_OPTIONS,
  FILE_VALIDATION
} from '../../models/photo-print-order.model';

@Component({
  selector: 'app-photo-upload',
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatButtonToggleModule,
    MatCardModule,
    MatSnackBarModule,
    MatCheckboxModule,
    DragDropDirective,
    PhoneMaskDirective,
    SlicePipe,
  ],
  templateUrl: './photo-upload.component.html',
  styleUrls: ['./photo-upload.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PhotoUploadComponent implements OnDestroy {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private readonly platformId = inject(PLATFORM_ID);
  private readonly fb = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  readonly orderService = inject(PhotoPrintOrderService);

  // Form for contact info
  contactForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.pattern(/^\+?[0-9]{10,15}$/)]],
    email: ['', Validators.email],
    comments: ['']
  });

  // Local UI state
  readonly isDragOver = signal(false);
  readonly showBatchSettings = signal(false);
  readonly orderSuccess = signal(false);
  readonly successOrderId = signal<string | null>(null);

  // Batch settings for custom mode
  readonly batchFormat = signal<PhotoFormat>('10x15');
  readonly batchPaper = signal<PaperType>('premium');
  readonly batchQuantity = signal<number>(1);
  readonly batchMargins = signal<MarginOption>('none');
  readonly batchBorder = signal<BorderOption>('none');

  // External sources state
  readonly showLinkInput = signal(false);
  readonly selectedSource = signal<'yandex' | 'vk' | 'ok' | null>(null);
  externalLink = '';
  readonly externalLinks = signal<{ source: 'yandex' | 'vk' | 'ok'; url: string }[]>([]);

  // Options for selects
  readonly formatOptions = FORMAT_OPTIONS;
  readonly paperOptions = PAPER_OPTIONS;
  readonly marginOptions = MARGIN_OPTIONS;
  readonly borderOptions = BORDER_OPTIONS;
  readonly deadlineOptions = DEADLINE_OPTIONS;
  readonly fileValidation = FILE_VALIDATION;

  // Computed from service
  readonly items = this.orderService.items;
  readonly mode = this.orderService.mode;
  readonly hasItems = this.orderService.hasItems;
  readonly itemCount = this.orderService.itemCount;
  readonly totalQuantity = this.orderService.totalQuantity;
  readonly totalPrice = this.orderService.totalPrice;
  readonly minPrice = this.orderService.minPrice;
  readonly isUploading = this.orderService.isUploading;
  readonly allUploaded = this.orderService.allUploaded;
  readonly hasUploadErrors = this.orderService.hasUploadErrors;
  readonly canSubmit = this.orderService.canSubmit;
  readonly isSubmitting = this.orderService.isSubmitting;
  readonly submitError = this.orderService.submitError;
  readonly deadline = this.orderService.deadline;
  readonly options = this.orderService.options;

  // Check if form is valid
  readonly isFormValid = computed(() => this.contactForm.valid);

  ngOnDestroy(): void {
    // Clean up on destroy
    this.orderService.clearOrder();
  }

  /**
   * Handle file drop from drag-drop directive
   */
  onFilesDropped(files: FileList): void {
    this.isDragOver.set(false);
    this.addFiles(files);
  }

  /**
   * Handle file selection from input
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFiles(input.files);
      // Reset input to allow selecting same files again
      input.value = '';
    }
  }

  /**
   * Trigger file input click
   */
  openFileDialog(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.fileInput.nativeElement.click();
    }
  }

  /**
   * Add files to order with validation
   */
  private addFiles(files: FileList): void {
    const invalidFiles: string[] = [];
    const validFiles: File[] = [];

    Array.from(files).forEach(file => {
      if (!FILE_VALIDATION.allowedTypes.includes(file.type)) {
        invalidFiles.push(`${file.name}: неподдерживаемый формат`);
      } else if (file.size > FILE_VALIDATION.maxSizeBytes) {
        invalidFiles.push(`${file.name}: файл слишком большой (макс. ${FILE_VALIDATION.maxSizeMB}МБ)`);
      } else {
        validFiles.push(file);
      }
    });

    if (invalidFiles.length > 0) {
      this.snackBar.open(
        invalidFiles.length === 1 
          ? invalidFiles[0] 
          : `${invalidFiles.length} файлов отклонено`,
        'OK',
        { duration: 5000 }
      );
    }

    if (validFiles.length > 0) {
      this.orderService.addFiles(validFiles);
    }
  }

  /**
   * Set order mode
   */
  setMode(mode: OrderMode): void {
    this.orderService.setMode(mode);
  }

  /**
   * Remove a photo from order
   */
  removePhoto(itemId: string): void {
    this.orderService.removeItem(itemId);
  }

  /**
   * Update photo format
   */
  updateFormat(itemId: string, format: PhotoFormat): void {
    this.orderService.updateItem(itemId, { format });
  }

  /**
   * Update photo paper type
   */
  updatePaper(itemId: string, paperType: PaperType): void {
    this.orderService.updateItem(itemId, { paperType });
  }

  /**
   * Update photo quantity
   */
  updateQuantity(itemId: string, quantity: number): void {
    if (quantity >= 1 && quantity <= 99) {
      this.orderService.updateItem(itemId, { quantity });
    }
  }

  /**
   * Increment quantity
   */
  incrementQuantity(itemId: string, currentQuantity: number): void {
    if (currentQuantity < 99) {
      this.orderService.updateItem(itemId, { quantity: currentQuantity + 1 });
    }
  }

  /**
   * Decrement quantity
   */
  decrementQuantity(itemId: string, currentQuantity: number): void {
    if (currentQuantity > 1) {
      this.orderService.updateItem(itemId, { quantity: currentQuantity - 1 });
    }
  }

  /**
   * Retry failed upload
   */
  retryUpload(itemId: string): void {
    this.orderService.retryUpload(itemId);
  }

  /**
   * Toggle batch settings panel
   */
  toggleBatchSettings(): void {
    this.showBatchSettings.update(v => !v);
  }

  /**
   * Apply batch settings to all photos
   */
  applyBatchSettings(): void {
    this.orderService.applyToAll({
      format: this.batchFormat(),
      paperType: this.batchPaper(),
      quantity: this.batchQuantity(),
      margins: this.batchMargins(),
      border: this.batchBorder()
    });
    this.showBatchSettings.set(false);
    this.snackBar.open('Настройки применены ко всем фото', 'OK', { duration: 2000 });
  }

  /**
   * Set deadline option
   */
  setDeadline(deadline: DeadlineOption): void {
    this.orderService.setDeadline(deadline);
  }

  /**
   * Toggle auto enhance option
   */
  toggleAutoEnhance(checked: boolean): void {
    this.orderService.updateOptions({ autoEnhance: checked });
  }

  /**
   * Toggle red eye removal option
   */
  toggleRedEyeRemoval(checked: boolean): void {
    this.orderService.updateOptions({ removeRedEyes: checked });
  }

  /**
   * Update margins for a single photo
   */
  updateMargins(itemId: string, margins: MarginOption): void {
    this.orderService.updateItem(itemId, { margins });
  }

  /**
   * Update border for a single photo
   */
  updateBorder(itemId: string, border: BorderOption): void {
    this.orderService.updateItem(itemId, { border });
  }

  /**
   * Submit the order
   */
  submitOrder(): void {
    if (!this.contactForm.valid) {
      this.contactForm.markAllAsTouched();
      return;
    }

    // Build comments with external links
    let comments = this.contactForm.value.comments || '';
    const links = this.externalLinks();
    if (links.length > 0) {
      const linksText = links.map(link => {
        const sourceName = link.source === 'yandex' ? 'Яндекс Диск' : 
                          link.source === 'vk' ? 'ВКонтакте' : 'Одноклассники';
        return `${sourceName}: ${link.url}`;
      }).join('\n');
      
      comments = comments 
        ? `${comments}\n\n--- Ссылки на фото ---\n${linksText}`
        : `--- Ссылки на фото ---\n${linksText}`;
    }

    // Update contact info in service
    this.orderService.updateContact({
      name: this.contactForm.value.name,
      phone: this.contactForm.value.phone,
      email: this.contactForm.value.email || undefined,
      comments: comments || undefined
    });

    this.orderService.submitOrder().subscribe(result => {
      if (result.success) {
        this.orderSuccess.set(true);
        this.successOrderId.set(result.orderId || null);
        this.externalLinks.set([]); // Clear external links
        this.snackBar.open(result.message || 'Заказ отправлен!', 'OK', { duration: 5000 });
      } else {
        this.snackBar.open(result.error || 'Ошибка при отправке', 'OK', { duration: 5000 });
      }
    });
  }

  /**
   * Reset and start new order
   */
  startNewOrder(): void {
    this.orderService.clearOrder();
    this.contactForm.reset();
    this.orderSuccess.set(false);
    this.successOrderId.set(null);
    this.externalLinks.set([]);
    this.closeLinkInput();
  }

  /**
   * Check if order can be submitted
   * Allows submission if there are uploaded photos OR external links
   */
  readonly canSubmitOrder = computed(() => {
    const hasUploadedPhotos = this.allUploaded() && this.hasItems();
    const hasExternalLinks = this.externalLinks().length > 0;
    const isFormValid = this.contactForm.valid;
    const notSubmitting = !this.isSubmitting();
    
    return (hasUploadedPhotos || hasExternalLinks) && isFormValid && notSubmitting;
  });

  /**
   * Get price for specific format and paper
   */
  getPrice(format: PhotoFormat, paperType: PaperType): number {
    return this.orderService.getPrice(format, paperType);
  }

  /**
   * Format phone number for display
   */
  formatPhone(phone: string): string {
    // Basic formatting for Russian phone numbers
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11 && cleaned.startsWith('7')) {
      return `+7 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9)}`;
    }
    return phone;
  }

  /**
   * Open external source input
   */
  openExternalSource(source: 'yandex' | 'vk' | 'ok'): void {
    this.selectedSource.set(source);
    this.showLinkInput.set(true);
    this.externalLink = '';
  }

  /**
   * Close link input
   */
  closeLinkInput(): void {
    this.showLinkInput.set(false);
    this.selectedSource.set(null);
    this.externalLink = '';
  }

  /**
   * Add external link
   */
  addExternalLink(): void {
    const source = this.selectedSource();
    if (!source || !this.externalLink.trim()) return;

    // Validate URL
    const url = this.externalLink.trim();
    if (!this.isValidUrl(url)) {
      this.snackBar.open('Введите корректную ссылку', 'OK', { duration: 3000 });
      return;
    }

    // Validate source-specific URL
    const isValidForSource = this.validateSourceUrl(source, url);
    if (!isValidForSource) {
      const sourceName = source === 'yandex' ? 'Яндекс Диска' : 
                         source === 'vk' ? 'ВКонтакте' : 'Одноклассников';
      this.snackBar.open(`Ссылка не похожа на ссылку из ${sourceName}`, 'OK', { duration: 3000 });
      return;
    }

    // Check for duplicates
    const exists = this.externalLinks().some(link => link.url === url);
    if (exists) {
      this.snackBar.open('Эта ссылка уже добавлена', 'OK', { duration: 3000 });
      return;
    }

    // Add link
    this.externalLinks.update(links => [...links, { source, url }]);
    this.snackBar.open('Ссылка добавлена! Мы загрузим фото по этой ссылке.', 'OK', { duration: 3000 });
    this.closeLinkInput();
  }

  /**
   * Remove external link
   */
  removeExternalLink(url: string): void {
    this.externalLinks.update(links => links.filter(link => link.url !== url));
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate URL matches expected source
   */
  private validateSourceUrl(source: 'yandex' | 'vk' | 'ok', url: string): boolean {
    const lowerUrl = url.toLowerCase();
    
    switch (source) {
      case 'yandex':
        return lowerUrl.includes('disk.yandex') || lowerUrl.includes('yadi.sk');
      case 'vk':
        return lowerUrl.includes('vk.com') || lowerUrl.includes('vkontakte.ru');
      case 'ok':
        return lowerUrl.includes('ok.ru') || lowerUrl.includes('odnoklassniki.ru');
      default:
        return false;
    }
  }
}
