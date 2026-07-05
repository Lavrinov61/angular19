import { DecimalPipe, isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  STUDIO_PHONE,
  STUDIO_PHONE_HREF,
} from '../../../../../../core/data/address.data';
import {
  DOCUMENT_PRINT_ACCEPT,
  DocumentPrintStoreService,
  type DocumentColorMode,
  type DocumentFinishing,
  type DocumentPaperSize,
  type DocumentPrintItem,
  type DocumentSides,
} from '../../services/document-print-store.service';

type OrderWidgetIntent = 'documents' | 'binding';

interface WidgetOption<T extends string> {
  readonly id: T;
  readonly icon: string;
  readonly label: string;
  readonly description: string;
}

const PAPER_OPTIONS: readonly WidgetOption<DocumentPaperSize>[] = [
  { id: 'a4', icon: 'description', label: 'A4', description: 'документы, учебные работы' },
  { id: 'a3', icon: 'dashboard', label: 'A3', description: 'таблицы, схемы, плакаты' },
];

const BINDING_PAPER_OPTIONS: readonly WidgetOption<DocumentPaperSize>[] = [
  { id: 'a4', icon: 'description', label: 'A4', description: 'формат для пластиковой пружины' },
];

const COLOR_OPTIONS: readonly WidgetOption<DocumentColorMode>[] = [
  { id: 'bw', icon: 'format_align_left', label: 'Ч/б', description: 'текстовые документы' },
  { id: 'color', icon: 'palette', label: 'Цвет', description: 'таблицы, схемы, презентации' },
];

const SIDE_OPTIONS: readonly WidgetOption<DocumentSides>[] = [
  { id: 'single', icon: 'looks_one', label: 'Односторонняя', description: 'каждая страница отдельно' },
  { id: 'double', icon: 'flip', label: 'Двусторонняя', description: 'печать с двух сторон' },
];

const FINISHING_OPTIONS: readonly WidgetOption<DocumentFinishing>[] = [
  { id: 'none', icon: 'remove', label: 'Без скрепления', description: 'только распечатать' },
  { id: 'staple', icon: 'attach_file', label: 'Скоба', description: 'соберём степлером' },
  { id: 'clip', icon: 'inventory_2', label: 'Скрепка', description: 'закрепим стопку' },
  { id: 'plastic_spring', icon: 'article', label: 'Пластиковая пружина', description: 'для курсовых и ВКР' },
];

@Component({
  selector: 'app-document-print-order-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
  ],
  providers: [DocumentPrintStoreService],
  templateUrl: './document-print-order-widget.component.html',
  styleUrl: './document-print-order-widget.component.scss',
})
export class DocumentPrintOrderWidgetComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly store = inject(DocumentPrintStoreService);
  readonly intent = input<OrderWidgetIntent>('documents');
  protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  protected readonly acceptedFileTypes = DOCUMENT_PRINT_ACCEPT;
  protected readonly studioPhone = STUDIO_PHONE;
  protected readonly studioPhoneHref = STUDIO_PHONE_HREF;
  protected readonly loginQueryParams = { returnUrl: '/user-profile/orders' };
  protected readonly isDragging = signal(false);
  protected readonly submitMessage = signal<string | null>(null);

  protected readonly paperOptions = computed(() => (
    this.intent() === 'binding' ? BINDING_PAPER_OPTIONS : PAPER_OPTIONS
  ));
  protected readonly colorOptions = COLOR_OPTIONS;
  protected readonly sideOptions = SIDE_OPTIONS;
  protected readonly finishingOptions = FINISHING_OPTIONS;
  protected readonly paymentLink = computed(() => {
    const orderId = this.store.orderId();
    return orderId ? ['/pay', orderId] : ['/pay'];
  });

  protected readonly widgetCopy = computed(() => {
    if (this.intent() === 'binding') {
      return {
        kicker: 'Заказ переплёта',
        title: 'Загрузите файл или приезжайте с листами',
        lead: 'Файл загрузится сразу в заказ. Мы проверим страницы, распечатаем А4 при необходимости и соберём работу на пластиковую пружину.',
        primary: 'Загрузить файл',
        summaryTitle: 'Переплёт на пластиковую пружину',
        submit: 'Создать заказ на переплёт',
      };
    }

    return {
      kicker: 'Печать документов',
      title: 'Загрузите файл и выберите параметры',
      lead: 'PDF, Word, Excel, презентации и изображения. Заказ создаётся без входа в аккаунт, а кабинет можно подключить после оформления.',
      primary: 'Загрузить файлы',
      summaryTitle: 'Печать документов',
      submit: 'Создать заказ',
    };
  });

  protected readonly educationEstimate = computed(() => {
    const settings = this.store.settings();
    if (settings.paperSize !== 'a4') {
      return null;
    }

    const pagePrice = settings.colorMode === 'bw' ? 3 : 4;
    const bindingPrice = settings.finishing === 'plastic_spring' ? 10 * settings.copies : 0;
    return this.store.totalPrintedSides() * pagePrice + bindingPrice;
  });

  protected readonly canShowEducationEstimate = computed(() => (
    this.educationEstimate() !== null && (this.store.hasItems() || this.intent() === 'binding')
  ));

  ngOnInit(): void {
    this.applyIntentDefaults();
    void this.store.ensurePickupLocationsLoaded();
  }

  protected openFileDialog(): void {
    if (this.store.isAnyUploading()) return;
    this.fileInput()?.nativeElement.click();
  }

  protected onFileInputChange(event: Event): void {
    const inputElement = event.target;
    if (!(inputElement instanceof HTMLInputElement) || !inputElement.files) return;

    this.store.addFiles(inputElement.files);
    inputElement.value = '';
  }

  protected onDropzoneKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openFileDialog();
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.store.isAnyUploading()) {
      this.isDragging.set(true);
    }
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);

    if (!event.dataTransfer?.files?.length) return;
    this.store.addFiles(event.dataTransfer.files);
  }

  protected removeItem(id: string): void {
    this.store.removeItem(id);
  }

  protected retryUpload(id: string): void {
    this.store.retryUpload(id);
  }

  protected setPaperSize(paperSize: DocumentPaperSize): void {
    this.store.updateSettings({ paperSize });
  }

  protected setColorMode(colorMode: DocumentColorMode): void {
    this.store.updateSettings({ colorMode });
  }

  protected setSides(sides: DocumentSides): void {
    this.store.updateSettings({ sides });
  }

  protected setFinishing(finishing: DocumentFinishing): void {
    this.store.updateSettings({ finishing });
  }

  protected updateCopies(event: Event): void {
    this.store.updateSettings({ copies: this.numberFromEvent(event, 1) });
  }

  protected updatePageCount(id: string, event: Event): void {
    this.store.updateItemPageCount(id, this.numberFromEvent(event, 1));
  }

  protected updateName(event: Event): void {
    this.store.updateContact({ name: this.textFromEvent(event) });
  }

  protected updatePhone(event: Event): void {
    this.store.updateContact({ phone: this.textFromEvent(event) });
  }

  protected updateEmail(event: Event): void {
    this.store.updateContact({ email: this.textFromEvent(event) });
  }

  protected updateComments(event: Event): void {
    this.store.updateContact({ comments: this.textFromEvent(event) });
  }

  protected selectPickupLocation(id: string): void {
    this.store.selectPickupLocation(id);
  }

  protected async submitOrder(): Promise<void> {
    this.submitMessage.set(null);

    const result = await firstValueFrom(this.store.submitOrder());
    if (!result.success) {
      this.submitMessage.set(result.error || 'Не удалось создать заказ');
      return;
    }

    this.submitMessage.set(result.message || 'Заказ создан');
    this.scrollToSuccess();
  }

  protected newOrder(): void {
    this.store.clearOrder();
    this.submitMessage.set(null);
    this.applyIntentDefaults();
    void this.store.ensurePickupLocationsLoaded();
  }

  protected trackItem(_index: number, item: DocumentPrintItem): string {
    return item.id;
  }

  protected statusLabel(item: DocumentPrintItem): string {
    switch (item.status) {
      case 'pending':
        return 'в очереди';
      case 'uploading':
        return `загрузка ${item.uploadProgress}%`;
      case 'uploaded':
        return 'загружен';
      case 'error':
        return item.errorMessage || 'ошибка';
    }
  }

  protected fileIcon(item: DocumentPrintItem): string {
    if (item.contentType.includes('pdf')) return 'picture_as_pdf';
    if (item.contentType.startsWith('image/')) return 'image';
    if (item.contentType.includes('spreadsheet') || item.contentType.includes('excel') || item.contentType.includes('csv')) return 'table_chart';
    if (item.contentType.includes('presentation') || item.contentType.includes('powerpoint')) return 'co_present';
    return 'description';
  }

  private applyIntentDefaults(): void {
    if (this.intent() !== 'binding') return;

    this.store.updateSettings({
      paperSize: 'a4',
      finishing: 'plastic_spring',
    });
  }

  private numberFromEvent(event: Event, fallback: number): number {
    const value = this.textFromEvent(event);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private textFromEvent(event: Event): string {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return target.value;
    }
    return '';
  }

  private scrollToSuccess(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.fileInput()?.nativeElement
      .closest('.doc-widget')
      ?.querySelector('.doc-widget-success')
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}
