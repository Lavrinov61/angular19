import {
  Component, ChangeDetectionStrategy, input, output, signal, computed,
  inject, PLATFORM_ID, ElementRef, viewChild
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DragDropDirective } from '../../../../../../shared/directives/drag-drop.directive';
import {
  CUSTOM_CROP_FEE,
  CUSTOM_PRINT_SIZE_OPTIONS,
  CustomPrintSizePresetId,
  CustomPrintSizeSettings,
  customPrintSizeOptionById,
} from '../../models/format-config';
import { CustomSizeGroup, PrintItem } from '../../services/photo-print-store.service';

export interface CustomSizeFilesAddedEvent {
  files: FileList | File[];
  customSize: CustomPrintSizeSettings;
}

interface CustomSizeVariant {
  id: string;
  sizeLabel: string;
}

@Component({
  selector: 'app-custom-size-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, DragDropDirective],
  templateUrl: './custom-size-flow.component.html',
  styleUrl: './custom-size-flow.component.scss',
})
export class CustomSizeFlowComponent {
  readonly items = input<PrintItem[]>([]);
  readonly groups = input<CustomSizeGroup[]>([]);
  readonly priceLabel = input<string>('');

  readonly filesAdded = output<CustomSizeFilesAddedEvent>();
  readonly viewDetails = output<void>();

  private readonly platformId = inject(PLATFORM_ID);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  readonly options = CUSTOM_PRINT_SIZE_OPTIONS;
  readonly cropFee = CUSTOM_CROP_FEE;
  readonly isDragOver = signal(false);
  readonly selectedPresetId = signal<CustomPrintSizePresetId>('5x7_5');
  readonly customSizeText = signal('');
  readonly customSizeVariants = signal<CustomSizeVariant[]>([]);
  readonly selectedCustomSizeVariantId = signal<string | null>(null);
  readonly needsCropping = signal(false);

  readonly selectedOption = computed(() => customPrintSizeOptionById(this.selectedPresetId()));
  readonly isCustomPreset = computed(() => this.selectedPresetId() === 'custom');
  readonly normalizedCustomSizeText = computed(() => this.formatCustomSizeText(this.customSizeText()));
  readonly hasCustomSizeDraft = computed(() => this.normalizedCustomSizeText().length > 0);
  readonly hasCustomSizeVariants = computed(() => this.customSizeVariants().length > 0);
  readonly activeCustomSizeVariant = computed(() => {
    const selectedId = this.selectedCustomSizeVariantId();
    if (!selectedId) return null;
    return this.customSizeVariants().find(variant => variant.id === selectedId) ?? null;
  });
  readonly activeCustomSize = computed(() => this.buildCustomSizeSettings());
  readonly activeSizeSummary = computed(() => {
    const customSize = this.activeCustomSize();
    return `${customSize.label} · ${customSize.sizeLabel}`;
  });
  readonly canUploadSelectedSize = computed(() =>
    !this.isCustomPreset() || this.activeCustomSize().sizeLabel !== this.selectedOption().sizeLabel
  );

  private nextCustomSizeVariantId = 0;

  get totalCount(): number {
    return this.items().length;
  }

  get totalQty(): number {
    return this.items().reduce((sum, item) => sum + item.quantity, 0);
  }

  get uploadedCount(): number {
    return this.items().filter(item => item.status === 'uploaded').length;
  }

  get hasItems(): boolean {
    return this.items().length > 0;
  }

  get hasActiveUploads(): boolean {
    return this.items().some(item => item.status === 'uploading' || item.status === 'pending');
  }

  get uploadProgressPercent(): number {
    if (!this.hasItems) return 0;

    const totalProgress = this.items().reduce((sum, item) => {
      if (item.status === 'uploaded') return sum + 100;
      return sum + Math.min(100, Math.max(0, item.uploadProgress));
    }, 0);

    return Math.round(totalProgress / this.items().length);
  }

  selectPreset(id: CustomPrintSizePresetId): void {
    const option = customPrintSizeOptionById(id);
    this.selectedPresetId.set(id);
    this.needsCropping.set(option.defaultNeedsCropping);

    if (id === 'custom' && !this.activeCustomSizeVariant() && !this.hasCustomSizeDraft()) {
      const firstVariant = this.customSizeVariants()[0];
      if (firstVariant) {
        this.selectedCustomSizeVariantId.set(firstVariant.id);
      }
    }
  }

  toggleCropping(): void {
    this.needsCropping.update(value => !value);
  }

  onCustomSizeInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) {
      this.customSizeText.set(target.value);
      this.selectedCustomSizeVariantId.set(null);
    }
  }

  addCustomSizeVariant(): void {
    this.commitCustomSizeDraft();
  }

  selectCustomSizeVariant(id: string): void {
    const variant = this.customSizeVariants().find(item => item.id === id);
    if (!variant) return;

    this.selectedPresetId.set('custom');
    this.selectedCustomSizeVariantId.set(variant.id);
    this.customSizeText.set('');
  }

  triggerFilePicker(): void {
    if (!isPlatformBrowser(this.platformId) || !this.canUploadSelectedSize()) return;
    this.fileInput().nativeElement.click();
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files?.length) {
      this.filesAdded.emit({ files: input.files, customSize: this.currentCustomSizeForUpload() });
      input.value = '';
    }
  }

  onFilesDropped(files: FileList): void {
    this.isDragOver.set(false);
    if (files.length && this.canUploadSelectedSize()) {
      this.filesAdded.emit({ files, customSize: this.currentCustomSizeForUpload() });
    }
  }

  onDragOver(): void {
    this.isDragOver.set(true);
  }

  onDragLeave(): void {
    this.isDragOver.set(false);
  }

  openDetails(event: Event): void {
    event.preventDefault();
    this.viewDetails.emit();
  }

  private currentCustomSizeForUpload(): CustomPrintSizeSettings {
    if (this.isCustomPreset()) {
      this.commitCustomSizeDraft();
    }

    return this.activeCustomSize();
  }

  private buildCustomSizeSettings(): CustomPrintSizeSettings {
    const option = this.selectedOption();
    const isCustom = option.id === 'custom';
    const customSizeLabel = this.normalizedCustomSizeText()
      || this.activeCustomSizeVariant()?.sizeLabel
      || option.sizeLabel;

    return {
      presetId: option.id,
      label: isCustom ? 'Свой размер' : option.label,
      sizeLabel: isCustom ? customSizeLabel : option.sizeLabel,
      needsCropping: this.needsCropping(),
      whiteBorder: option.whiteBorder,
    };
  }

  private commitCustomSizeDraft(): CustomSizeVariant | null {
    const sizeLabel = this.normalizedCustomSizeText();
    if (!sizeLabel) return this.activeCustomSizeVariant();

    const existing = this.customSizeVariants().find(
      variant => this.sizeComparisonKey(variant.sizeLabel) === this.sizeComparisonKey(sizeLabel)
    );

    if (existing) {
      this.selectedCustomSizeVariantId.set(existing.id);
      this.customSizeText.set('');
      return existing;
    }

    const variant: CustomSizeVariant = {
      id: `custom-size-${++this.nextCustomSizeVariantId}`,
      sizeLabel,
    };

    this.customSizeVariants.update(variants => [...variants, variant]);
    this.selectedCustomSizeVariantId.set(variant.id);
    this.customSizeText.set('');
    return variant;
  }

  private formatCustomSizeText(value: string): string {
    const normalized = value
      .trim()
      .replace(/[xх]/gi, '×')
      .replace(/\s*×\s*/g, '×')
      .replace(/\s+/g, ' ');

    if (!normalized) return '';
    if (!/\d/.test(normalized) || /(см|cm|мм|mm)$/i.test(normalized)) return normalized;
    return `${normalized} см`;
  }

  private sizeComparisonKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[xх]/gi, '×')
      .replace(/\s+/g, '')
      .replace(/(см|cm|мм|mm)$/i, '');
  }
}
