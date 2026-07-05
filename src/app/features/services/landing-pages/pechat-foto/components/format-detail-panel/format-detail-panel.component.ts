import {
  Component, ChangeDetectionStrategy, input, output, inject, computed
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import {
  FormatConfig, PaperPriceTier, PRINT_TIER_ORDER, paperPriceTier,
  printTierLabel, printTiersForPaperTypes, CUSTOM_PRINT_SIZE_OPTIONS,
  CustomPrintSizePresetId, CustomPrintSizeSettings, DEFAULT_CUSTOM_PRINT_SIZE,
  customPrintSizeOptionById, CUSTOM_CROP_FEE
} from '../../models/format-config';
import { PhotoPrintStoreService, PrintItem } from '../../services/photo-print-store.service';

@Component({
  selector: 'app-format-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatButtonModule, MatProgressBarModule],
  templateUrl: './format-detail-panel.component.html',
  styleUrl: './format-detail-panel.component.scss',
})
export class FormatDetailPanelComponent {
  readonly format = input.required<FormatConfig>();
  readonly closed = output<void>();

  readonly store = inject(PhotoPrintStoreService);
  readonly customSizeOptions = CUSTOM_PRINT_SIZE_OPTIONS;
  readonly customCropFee = CUSTOM_CROP_FEE;

  readonly items = computed(() => this.store.itemsByFormat(this.format().id));

  readonly totalQty = computed(() =>
    this.items().reduce((s, i) => s + i.quantity, 0)
  );

  close(): void {
    this.closed.emit();
  }

  removeItem(id: string): void {
    this.store.removeItem(id);
    if (this.items().length === 0) {
      this.closed.emit();
    }
  }

  incrementQty(item: PrintItem): void {
    this.store.updateItem(item.id, { quantity: item.quantity + 1 });
  }

  decrementQty(item: PrintItem): void {
    if (item.quantity > 1) {
      this.store.updateItem(item.id, { quantity: item.quantity - 1 });
    } else {
      this.removeItem(item.id);
    }
  }

  setPrintTier(item: PrintItem, tier: PaperPriceTier): void {
    this.store.updateItemPrintTier(item.id, tier);
  }

  applyPrintTierToAll(tier: PaperPriceTier): void {
    this.store.applyPrintTierToFormat(this.format().id, tier);
  }

  retryUpload(id: string): void {
    this.store.retryUpload(id);
  }

  isCustomFormat(): boolean {
    return this.format().id === 'custom';
  }

  setCustomSize(item: PrintItem, presetId: CustomPrintSizePresetId): void {
    const option = customPrintSizeOptionById(presetId);
    const current = this.customSizeForItem(item);
    this.store.updateItemCustomSize(item.id, {
      presetId: option.id,
      label: option.id === 'custom' ? 'Свой размер' : option.label,
      sizeLabel: option.id === 'custom' && current.presetId === 'custom' ? current.sizeLabel : option.sizeLabel,
      needsCropping: current.needsCropping,
      whiteBorder: option.whiteBorder,
    });
  }

  toggleCustomCropping(item: PrintItem): void {
    const current = this.customSizeForItem(item);
    this.store.updateItemCustomSize(item.id, {
      ...current,
      needsCropping: !current.needsCropping,
    });
  }

  updateCustomSizeText(item: PrintItem, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const customOption = customPrintSizeOptionById('custom');
    const current = this.customSizeForItem(item);
    this.store.updateItemCustomSize(item.id, {
      presetId: customOption.id,
      label: 'Свой размер',
      sizeLabel: this.formatCustomSizeText(target.value) || customOption.sizeLabel,
      needsCropping: current.needsCropping,
      whiteBorder: customOption.whiteBorder,
    });
  }

  hasPaperChoice(): boolean {
    return this.printTierOptions().length > 1;
  }

  printTierOptions(): PaperPriceTier[] {
    const availableTiers = printTiersForPaperTypes(this.format().paperTypes);
    return PRINT_TIER_ORDER.filter(tier => availableTiers.includes(tier));
  }

  printTierLabel(tier: PaperPriceTier): string {
    return printTierLabel(tier);
  }

  printTierCount(tier: PaperPriceTier): number {
    return this.items().filter(item => paperPriceTier(item.paperType) === tier).length;
  }

  isItemPrintTier(item: PrintItem, tier: PaperPriceTier): boolean {
    return paperPriceTier(item.paperType) === tier;
  }

  isPrintTierAppliedToAll(tier: PaperPriceTier): boolean {
    const items = this.items();
    return items.length > 0 && items.every(item => paperPriceTier(item.paperType) === tier);
  }

  isItemCustomSize(item: PrintItem, presetId: CustomPrintSizePresetId): boolean {
    return this.customSizeForItem(item).presetId === presetId;
  }

  customSizeForItem(item: PrintItem): CustomPrintSizeSettings {
    return item.customSize ?? {
      presetId: DEFAULT_CUSTOM_PRINT_SIZE.id,
      label: DEFAULT_CUSTOM_PRINT_SIZE.label,
      sizeLabel: DEFAULT_CUSTOM_PRINT_SIZE.sizeLabel,
      needsCropping: DEFAULT_CUSTOM_PRINT_SIZE.defaultNeedsCropping,
      whiteBorder: DEFAULT_CUSTOM_PRINT_SIZE.whiteBorder,
    };
  }

  customSizeInputValue(item: PrintItem): string {
    const current = this.customSizeForItem(item);
    const customOption = customPrintSizeOptionById('custom');
    return current.presetId === 'custom' && current.sizeLabel !== customOption.sizeLabel
      ? current.sizeLabel
      : '';
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
}
