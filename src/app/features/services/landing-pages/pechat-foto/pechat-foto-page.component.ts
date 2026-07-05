import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
  PLATFORM_ID, OnInit
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';

import { SeoService } from '../../../../core/services/seo.service';
import { PricesService } from '../../../../core/services/prices.service';
import { ContactsSectionComponent } from '../../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../../shared/components/testimonials/testimonials.component';
import { ProcessSliderComponent, ProcessStep } from '../../../../shared/components/process-slider/process-slider.component';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';
import { ADDRESSES, ADDRESS_INFO } from '../../../../core/data/address.data';

import { PhotoPrintStoreService } from './services/photo-print-store.service';
import { PRINT_FORMATS, PrintFormatId, FormatConfig, FORMATS_MAP } from './models/format-config';
import { FormatUploadCardComponent } from './components/format-upload-card/format-upload-card.component';
import {
  CustomSizeFlowComponent,
  CustomSizeFilesAddedEvent,
} from './components/custom-size-flow/custom-size-flow.component';
import { FormatDetailPanelComponent } from './components/format-detail-panel/format-detail-panel.component';
import { OrderSummaryBarComponent } from './components/order-summary-bar/order-summary-bar.component';

const FAQ_ITEMS = [
  {
    question: 'Какое разрешение нужно для качественной печати?',
    answer: 'Для формата 10×15 нужно минимум 1200×1800 пикселей. Современные смартфоны делают снимки с запасом, если фото хорошо выглядит на экране, оно отлично распечатается.'
  },
  {
    question: 'Какие типы печати можно выбрать?',
    answer: 'В заказе доступны два типа: Премиум по базовой цене и Супер по повышенному тарифу для более эффектных отпечатков. Выбранный тип можно применить ко всем фото сразу.'
  },
  {
    question: 'Можно заказать нестандартный размер?',
    answer: 'Да. Выберите блок нестандартных размеров, загрузите отдельную пачку для нужного размера и отметьте, нужна ли обрезка или подгонка.'
  },
  {
    question: 'Сколько времени занимает печать?',
    answer: 'Небольшие заказы (до 50 фото) готовы за 15-30 минут. Большие заказы, 1-2 часа. Точное время зависит от загрузки и формата.'
  },
  {
    question: 'Можно ли загрузить фото со смартфона?',
    answer: 'Да, можно загрузить фото прямо на этой странице с любого устройства. Принимаем JPG, PNG, TIFF.'
  },
  {
    question: 'Есть ли скидки на большие тиражи?',
    answer: 'Да, при заказе от 100 фотографий одного формата действуют оптовые скидки. Уточните условия у сотрудников студии или по телефону.'
  },
];

const PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Загрузите фото',
    description: 'Перетащите файлы в нужный формат прямо на этой странице или принесите на флешке',
    icon: 'cloud_upload',
    details: ['Со смартфона или компьютера', 'JPG, PNG, TIFF', 'До 50 МБ на файл']
  },
  {
    number: 2,
    title: 'Мы обработаем',
    description: 'При необходимости скорректируем яркость и цвета',
    icon: 'tune',
    details: ['Коррекция цвета', 'Кадрирование', 'Улучшение качества']
  },
  {
    number: 3,
    title: 'Печать',
    description: 'Профессиональная печать на оборудовании высокого класса',
    icon: 'print',
    details: ['Точная цветопередача', 'Качественные чернила', 'Проверка каждого фото']
  },
  {
    number: 4,
    title: 'Готово!',
    description: 'Заберите в студии или оформите доставку',
    icon: 'celebration',
    details: ['Быстрая выдача', 'Аккуратная упаковка', 'Рекомендации по хранению']
  }
];

@Component({
  selector: 'app-pechat-foto-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    MatExpansionModule,
    ContactsSectionComponent,
    TestimonialsComponent,
    ProcessSliderComponent,
    ScrollRevealDirective,
    FormatUploadCardComponent,
    CustomSizeFlowComponent,
    FormatDetailPanelComponent,
    OrderSummaryBarComponent,
  ],
  providers: [PhotoPrintStoreService],
  templateUrl: './pechat-foto-page.component.html',
  styleUrl: './pechat-foto-page.component.scss',
})
export class PechatFotoPageComponent implements OnInit {
  private readonly seo = inject(SeoService);
  readonly prices = inject(PricesService);
  readonly store = inject(PhotoPrintStoreService);
  private readonly platformId = inject(PLATFORM_ID);

  readonly formats = PRINT_FORMATS.filter(format => format.id !== 'custom');
  readonly customFormat = FORMATS_MAP.get('custom')!;
  readonly faqItems = FAQ_ITEMS;
  readonly processSteps = PROCESS_STEPS;
  readonly addresses = ADDRESSES;
  readonly addressInfo = ADDRESS_INFO;

  /** Какая панель детального просмотра открыта */
  readonly openDetailFormat = signal<PrintFormatId | null>(null);

  readonly openDetailConfig = computed<FormatConfig | null>(() => {
    const id = this.openDetailFormat();
    if (!id) return null;
    return FORMATS_MAP.get(id) ?? null;
  });

  /** Минимальная цена для hero */
  readonly minPrice = computed(() => this.prices.minPrice());

  ngOnInit(): void {
    const minP = this.prices.minPrice();
    const title = `Печать фотографий в Ростове | от ${minP}₽ | Своё Фото`;
    const description =
      `Профессиональная фотопечать в Ростове-на-Дону. Форматы A6, A5, A4, 30×40, 40×50. ` +
      `Загрузите фото прямо на сайте. Типы печати Премиум и Супер. Готово за 15 минут. От ${minP}₽.`;
    this.seo.updateTitle(title);
    this.seo.updateDescription(description);
    this.seo.updateCanonicalUrl('/pechat-foto');
    this.seo.setOpenGraph(
      title,
      description,
      'https://svoefoto.ru/assets/static/promo/pechat-foto.webp',
      'website',
      'https://svoefoto.ru/pechat-foto'
    );
  }

  /** Цена для карточки формата */
  priceLabel(format: FormatConfig): string {
    const p = this.prices.prices();
    if (format.id === '10x15') return `от ${Math.min(p.premium_10x15, p.super_10x15) || 19} ₽`;
    if (format.id === 'custom') return `от ${Math.min(p.premium_10x15, p.super_10x15) || format.fallbackPriceMin} ₽`;
    if (format.id === '15x20') return `от ${Math.min(p.premium_15x20, p.super_15x20) || 49} ₽`;
    if (format.id === '20x30') return `от ${Math.min(p.premium_20x30, p.super_20x30) || 117} ₽`;
    if (format.id === '30x40') return `450 ₽`;
    if (format.id === '40x50') return `600 ₽`;
    return '';
  }

  onFilesAdded(format: FormatConfig, files: FileList | File[]): void {
    const arr = files instanceof FileList ? Array.from(files) : files;
    this.store.addFiles(format.id, arr);
  }

  onCustomSizeFilesAdded(event: CustomSizeFilesAddedEvent): void {
    const arr = event.files instanceof FileList ? Array.from(event.files) : event.files;
    this.store.addFiles(this.customFormat.id, arr, { customSize: event.customSize });
  }

  customPriceLabel(): string {
    return `${this.priceLabel(this.customFormat)} за фото`;
  }

  openDetail(formatId: PrintFormatId): void {
    this.openDetailFormat.set(formatId);
    if (isPlatformBrowser(this.platformId)) {
      document.body.style.overflow = 'hidden';
    }
  }

  closeDetail(): void {
    this.openDetailFormat.set(null);
    if (isPlatformBrowser(this.platformId)) {
      document.body.style.overflow = '';
    }
  }

  scrollToFormats(): void {
    if (isPlatformBrowser(this.platformId)) {
      const el = document.getElementById('format-section');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  contactsData = {
    title: 'Приходите в студию',
    prompt: 'Печатаем в двух удобных локациях в Ростове-на-Дону',
    links: [
      { label: 'Позвонить', href: 'tel:+78633226575', icon: 'phone' },
      { label: 'Telegram', href: 'https://t.me/magnus_photo', icon: 'telegram' },
    ],
  };
}
