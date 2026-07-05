import {
  Component, ChangeDetectionStrategy, input, output, signal, inject, PLATFORM_ID,
  ElementRef, viewChild
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { DragDropDirective } from '../../../../../../shared/directives/drag-drop.directive';
import {
  FormatConfig, PaperPriceTier, PRINT_TIER_ORDER, paperPriceTier,
  printTierLabel, printTiersForPaperTypes
} from '../../models/format-config';
import { PrintItem } from '../../services/photo-print-store.service';

const VISIBLE_UPLOAD_ROWS = 40;

@Component({
  selector: 'app-format-upload-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatProgressBarModule, DragDropDirective],
  templateUrl: './format-upload-card.component.html',
  styleUrl: './format-upload-card.component.scss',
})
export class FormatUploadCardComponent {
  readonly format = input.required<FormatConfig>();
  readonly items = input<PrintItem[]>([]);
  /** Отображаемая цена от X₽ */
  readonly priceLabel = input<string>('');
  /** Показать детальную панель */
  readonly viewDetails = output<void>();
  /** Добавлены файлы */
  readonly filesAdded = output<FileList | File[]>();
  /** Повторить загрузку конкретного файла */
  readonly retryUpload = output<string>();
  /** Применить тип печати ко всем фото в формате */
  readonly printTierSelected = output<PaperPriceTier>();

  private readonly platformId = inject(PLATFORM_ID);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  readonly isDragOver = signal(false);

  get uploadedCount(): number {
    return this.items().filter(i => i.status === 'uploaded').length;
  }

  get errorCount(): number {
    return this.items().filter(i => i.status === 'error').length;
  }

  get totalCount(): number {
    return this.items().length;
  }

  get totalQty(): number {
    return this.items().reduce((s, i) => s + i.quantity, 0);
  }

  get visibleUploadItems(): PrintItem[] {
    const items = this.items();
    const priorityItems = items.filter(i => i.status === 'error' || i.status === 'uploading' || i.status === 'pending');
    return (priorityItems.length > 0 ? priorityItems : items).slice(0, VISIBLE_UPLOAD_ROWS);
  }

  get hiddenUploadItemsCount(): number {
    return Math.max(0, this.items().length - this.visibleUploadItems.length);
  }

  get uploadProgressPercent(): number {
    if (!this.hasItems) return 0;

    const totalProgress = this.items().reduce((sum, item) => {
      if (item.status === 'uploaded') return sum + 100;
      return sum + this.itemUploadPercent(item);
    }, 0);

    return Math.round(totalProgress / this.items().length);
  }

  get hasActiveUploads(): boolean {
    return this.items().some(i => i.status === 'uploading' || i.status === 'pending');
  }

  get uploadStatusTitle(): string {
    if (this.errorCount > 0 && !this.hasActiveUploads) {
      return `${this.errorCount} не загрузилось`;
    }

    if (this.hasActiveUploads) {
      return `Загрузка ${this.uploadedCount} из ${this.totalCount}`;
    }

    return `${this.uploadedCount} фото готово`;
  }

  get uploadStatusHint(): string {
    if (this.errorCount > 0) {
      return 'Можно повторить проблемные файлы';
    }

    if (this.hasActiveUploads) {
      return 'Можно добавлять ещё фото, загрузка продолжится';
    }

    return 'Фото можно проверить и настроить';
  }

  get uploadStatusIcon(): string {
    if (this.errorCount > 0 && !this.hasActiveUploads) return 'error_outline';
    if (this.hasActiveUploads) return 'cloud_sync';
    return 'check_circle';
  }

  get hasItems(): boolean {
    return this.items().length > 0;
  }

  get hasPaperChoice(): boolean {
    return this.hasItems && this.printTierOptions.length > 1;
  }

  get printTierOptions(): PaperPriceTier[] {
    const availableTiers = printTiersForPaperTypes(this.format().paperTypes);
    return PRINT_TIER_ORDER.filter(tier => availableTiers.includes(tier));
  }

  triggerFilePicker(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.fileInput().nativeElement.click();
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.filesAdded.emit(input.files);
      input.value = '';
    }
  }

  onFilesDropped(files: FileList): void {
    this.isDragOver.set(false);
    if (files.length) this.filesAdded.emit(files);
  }

  onDragOver(): void {
    this.isDragOver.set(true);
  }

  onDragLeave(): void {
    this.isDragOver.set(false);
  }

  onViewDetails(event: Event): void {
    event.preventDefault();
    this.viewDetails.emit();
  }

  onRetryUpload(event: Event, id: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.retryUpload.emit(id);
  }

  onApplyPrintTier(event: Event, tier: PaperPriceTier): void {
    event.preventDefault();
    event.stopPropagation();
    this.printTierSelected.emit(tier);
  }

  printTierLabel(tier: PaperPriceTier): string {
    return printTierLabel(tier);
  }

  printTierCount(tier: PaperPriceTier): number {
    return this.items().filter(item => paperPriceTier(item.paperType) === tier).length;
  }

  isPrintTierAppliedToAll(tier: PaperPriceTier): boolean {
    const items = this.items();
    return items.length > 0 && items.every(item => paperPriceTier(item.paperType) === tier);
  }

  itemUploadPercent(item: PrintItem): number {
    if (item.status === 'uploaded') return 100;
    return Math.min(100, Math.max(0, item.uploadProgress));
  }

  itemStatusLabel(item: PrintItem): string {
    switch (item.status) {
      case 'pending':
        return 'Ожидает очереди';
      case 'uploading':
        return 'Загружается';
      case 'uploaded':
        return 'Готово';
      case 'error':
        return item.errorMessage || 'Ошибка загрузки';
    }
  }

  itemStatusIcon(item: PrintItem): string {
    switch (item.status) {
      case 'pending':
        return 'schedule';
      case 'uploading':
        return 'cloud_upload';
      case 'uploaded':
        return 'check_circle';
      case 'error':
        return 'error_outline';
    }
  }
}
