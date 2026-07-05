import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
  type ElementRef,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import { SeoService } from '../../../../core/services/seo.service';
import { ResponsiveLayoutService } from '../../../../core/services/responsive-layout.service';
import { CONTACTS } from '../../../../core/data/contacts.data';
import { ADDRESSES } from '../../../../core/data/address.data';
import {
  ContactsData,
  ContactsSectionComponent,
} from '../../../../shared/components/contacts-section/contacts-section.component';
import { TestimonialsComponent } from '../../../../shared/components/testimonials/testimonials.component';
import { DragDropDirective } from '../../../../shared/directives/drag-drop.directive';
import { ScrollRevealDirective } from '../../../../shared/directives/scroll-reveal.directive';

interface HeroStat {
  readonly value: string;
  readonly label: string;
}

interface HandoffOption {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface RestorationCapability {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface ComplexityTier {
  readonly title: string;
  readonly price: string;
  readonly description: string;
  readonly points: readonly string[];
}

interface ChecklistItem {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface ProcessStep {
  readonly number: string;
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface MayFormat {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

type RestorationSectionId = 'restoration-order' | 'complexity' | 'process' | 'result' | 'faq' | 'contacts';

interface RestorationPageTab {
  readonly id: RestorationSectionId;
  readonly label: string;
}

type RestorationUploadState = 'idle' | 'uploading' | 'ready' | 'error';
type UploadFileStatus = 'queued' | 'uploading' | 'done' | 'error';
type RestorationOutputTargetId = 'digital' | '10x15' | '15x21' | '20x30' | 'a4' | 'custom';

const uploadProgressByStatus: Record<UploadFileStatus, number> = {
  queued: 0,
  uploading: 50,
  done: 100,
  error: 0,
};

interface RestorationUploadRow {
  readonly id: string;
  readonly name: string;
  readonly sizeLabel: string;
  readonly status: UploadFileStatus;
}

interface RestorationPresignUpload {
  readonly s3Key: string;
  readonly uploadUrl: string;
  readonly contentType: string;
}

interface RestorationPresignResponse {
  readonly success: boolean;
  readonly data?: {
    readonly uploads: readonly RestorationPresignUpload[];
  };
  readonly error?: string;
}

interface RestorationFileCompletePayload {
  readonly s3Key: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly fileSize: number;
  readonly width?: number;
  readonly height?: number;
}

interface RestorationDigitalOutputTarget {
  readonly kind: 'digital';
  readonly label: string;
}

interface RestorationPrintOutputTarget {
  readonly kind: 'print';
  readonly widthCm: number;
  readonly heightCm: number;
  readonly dpi: number;
  readonly label: string;
}

type RestorationOutputTarget = RestorationDigitalOutputTarget | RestorationPrintOutputTarget;

interface OutputTargetOption {
  readonly id: RestorationOutputTargetId;
  readonly icon: string;
  readonly title: string;
  readonly description: string;
  readonly target?: RestorationOutputTarget;
}

interface RestorationAnalysisScores {
  readonly scratches: number;
  readonly tears: number;
  readonly missingAreas: number;
  readonly fadingContrast: number;
  readonly stains: number;
  readonly blurDetail: number;
  readonly faceDamage: number;
  readonly reconstruction: number;
  readonly outputScale: number;
}

interface RestorationSourceMetrics {
  readonly sourceWidthPx: number | null;
  readonly sourceHeightPx: number | null;
  readonly targetWidthPx: number | null;
  readonly targetHeightPx: number | null;
  readonly scaleFactor: number | null;
  readonly score: number;
}

interface RestorationEstimate {
  readonly tier: string;
  readonly title: string;
  readonly price: number | null;
  readonly priceLabel: string;
  readonly leadTime: string;
  readonly reason: string;
  readonly clientReason?: string;
  readonly confidence?: number;
  readonly humanReviewRequired?: boolean;
  readonly automaticPaymentAllowed?: boolean;
  readonly scores?: RestorationAnalysisScores;
  readonly outputTarget?: RestorationOutputTarget;
  readonly sourceMetrics?: RestorationSourceMetrics;
}

interface RestorationCompleteResponse {
  readonly success: boolean;
  readonly data?: {
    readonly orderId: string;
    readonly paymentUrl: string | null;
    readonly estimate: RestorationEstimate;
  };
  readonly error?: string;
}

type RestorationLoadLevel = 'normal' | 'busy' | 'heavy' | 'surge';
type RestorationTier = 'simple' | 'medium' | 'complex' | 'pro';

interface RestorationWorkload {
  readonly activeOrders: number;
  readonly activeRetouchTasks: number;
  readonly activeWorkUnits: number;
  readonly completedToday: number;
  readonly dayCapacity: number;
  readonly currentDayLoad: number;
  readonly loadLevel: RestorationLoadLevel;
  readonly leadTimeLabel: string;
  readonly message: string;
  readonly updatedAt: string;
  readonly leadTimeByTier: Record<RestorationTier, string>;
}

interface RestorationWorkloadResponse {
  readonly success: boolean;
  readonly data?: RestorationWorkload;
  readonly error?: string;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

@Component({
  selector: 'app-restavratsiya-foto',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatExpansionModule,
    MatIconModule,
    MatProgressBarModule,
    ContactsSectionComponent,
    TestimonialsComponent,
    DragDropDirective,
    ScrollRevealDirective,
  ],
  templateUrl: './restavratsiya-foto.component.html',
  styleUrls: ['./restavratsiya-foto.component.scss'],
})
export class RestavratsiyaFotoComponent implements OnInit, OnDestroy {
  private readonly seoService = inject(SeoService);
  private readonly layout = inject(ResponsiveLayoutService);
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('restorationFileInput');
  private readonly allowedUploadTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/x-tiff', 'image/heic', 'image/heif']);
  private readonly uploadTypeByExtension = new Map([
    ['jpg', 'image/jpeg'],
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
    ['tif', 'image/tiff'],
    ['tiff', 'image/tiff'],
    ['heic', 'image/heic'],
    ['heif', 'image/heif'],
  ]);
  private readonly maxUploadFiles = 5;
  private readonly maxUploadFileSize = 50 * 1024 * 1024;
  private sectionObserver: IntersectionObserver | null = null;

  protected readonly addresses = ADDRESSES;
  protected readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });
  protected readonly isTablet = toSignal(this.layout.isTablet$, { initialValue: false });
  protected readonly isDesktop = toSignal(this.layout.isDesktop$, { initialValue: false });
  protected readonly uploadState = signal<RestorationUploadState>('idle');
  protected readonly uploadRows = signal<readonly RestorationUploadRow[]>([]);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly isDragOver = signal(false);
  protected readonly estimate = signal<RestorationEstimate | null>(null);
  protected readonly paymentUrl = signal<string | null>(null);
  protected readonly orderId = signal<string | null>(null);
  protected readonly workload = signal<RestorationWorkload | null>(null);
  protected readonly workloadUnavailable = signal(false);
  protected readonly activeSection = signal<RestorationSectionId>('restoration-order');
  protected readonly selectedOutputTargetId = signal<RestorationOutputTargetId>('10x15');
  protected readonly customOutputWidthCm = signal(18);
  protected readonly customOutputHeightCm = signal(24);
  protected readonly outputTargetError = signal<string | null>(null);
  protected readonly isUploading = computed(() => this.uploadState() === 'uploading');
  protected readonly hasUploadResult = computed(() => this.uploadRows().length > 0 || this.uploadState() !== 'idle');
  protected readonly uploadedCount = computed(() => this.uploadRows().filter(row => row.status === 'done').length);
  protected readonly uploadErrorCount = computed(() => this.uploadRows().filter(row => row.status === 'error').length);
  protected readonly hasActiveUploadRows = computed(() => this.uploadRows().some(row => (
    row.status === 'queued' || row.status === 'uploading'
  )));
  protected readonly isAnalyzingUpload = computed(() => (
    this.uploadState() === 'uploading'
    && this.uploadRows().length > 0
    && !this.hasActiveUploadRows()
    && this.uploadErrorCount() === 0
  ));
  protected readonly uploadProgressPercent = computed(() => {
    const rows = this.uploadRows();
    if (rows.length === 0) {
      return 0;
    }

    const totalProgress = rows.reduce((sum, row) => sum + uploadProgressByStatus[row.status], 0);
    return Math.round(totalProgress / rows.length);
  });
  protected readonly uploadStatusTitle = computed(() => {
    const total = this.uploadRows().length;
    if (total === 0) {
      return 'Файлы не выбраны';
    }

    if (this.isAnalyzingUpload()) {
      return 'AI анализирует фото';
    }

    if (this.uploadErrorCount() > 0 && !this.hasActiveUploadRows()) {
      return `${this.uploadErrorCount()} не загрузилось`;
    }

    if (this.hasActiveUploadRows()) {
      return `Загрузка ${this.uploadedCount()} из ${total}`;
    }

    return `${this.uploadedCount()} фото отправлено`;
  });
  protected readonly uploadStatusHint = computed(() => {
    if (this.uploadErrorCount() > 0) {
      return 'Попробуйте выбрать файл ещё раз или пришлите его в мессенджер';
    }

    if (this.isAnalyzingUpload()) {
      return 'Определяем повреждения, масштаб результата и сложность реставрации';
    }

    if (this.hasActiveUploadRows()) {
      return 'Дождитесь завершения, оценка продолжится автоматически';
    }

    return 'Мы получили исходник и подготовили предварительную оценку';
  });
  protected readonly uploadStatusIcon = computed(() => {
    if (this.uploadErrorCount() > 0 && !this.hasActiveUploadRows()) {
      return 'error_outline';
    }

    if (this.isAnalyzingUpload()) {
      return 'psychology';
    }

    if (this.hasActiveUploadRows()) {
      return 'cloud_sync';
    }

    return 'check_circle';
  });
  protected readonly uploadProgressLabel = computed(() => (
    this.isAnalyzingUpload() ? 'анализ' : `${this.uploadProgressPercent()}%`
  ));
  protected readonly workloadLeadTime = computed(() => this.workload()?.leadTimeLabel ?? 'в течение дня');
  protected readonly workloadMessage = computed(() => {
    const workload = this.workload();
    if (workload) {
      return workload.message;
    }
    if (this.workloadUnavailable()) {
      return 'Показываем базовый срок; после загрузки уточним его по текущей очереди.';
    }
    return 'Сейчас показываем базовый срок, а точный срок подтвердим после оценки исходника.';
  });
  protected readonly workloadSummary = computed(() => {
    const workload = this.workload();
    if (!workload) {
      return 'загрузка уточняется';
    }
    return `${workload.currentDayLoad}% текущей загрузки`;
  });
  protected readonly workloadTone = computed<RestorationLoadLevel>(() => this.workload()?.loadLevel ?? 'normal');
  protected readonly canPayEstimate = computed(() => {
    const estimate = this.estimate();
    return Boolean(this.paymentUrl())
      && Boolean(estimate)
      && estimate?.automaticPaymentAllowed !== false
      && estimate?.humanReviewRequired !== true
      && estimate?.price !== null;
  });
  protected readonly estimateActionHint = computed(() => {
    const estimate = this.estimate();
    if (!estimate) {
      return 'Загрузите фото, чтобы получить оценку по исходнику.';
    }
    if (!this.canPayEstimate()) {
      return 'Стоимость подтвердит ретушёр до начала работы.';
    }
    return 'Можно оплатить и передать заказ ретушёру.';
  });
  protected readonly estimateReason = computed(() => {
    const quote = this.estimate();
    return quote?.clientReason || quote?.reason || '';
  });
  protected readonly outputScaleSummary = computed(() => {
    const metrics = this.estimate()?.sourceMetrics;
    if (!metrics) {
      return null;
    }
    if (!metrics.targetWidthPx || !metrics.targetHeightPx) {
      return metrics.sourceWidthPx && metrics.sourceHeightPx
        ? `исходник ${metrics.sourceWidthPx}x${metrics.sourceHeightPx} px`
        : 'цифровой файл без увеличения';
    }
    if (!metrics.sourceWidthPx || !metrics.sourceHeightPx || metrics.scaleFactor === null) {
      return `цель ${metrics.targetWidthPx}x${metrics.targetHeightPx} px, исходный размер уточняем`;
    }
    return `исходник ${metrics.sourceWidthPx}x${metrics.sourceHeightPx} px -> цель ${metrics.targetWidthPx}x${metrics.targetHeightPx} px, увеличение x${metrics.scaleFactor}`;
  });
  protected readonly analysisChips = computed<readonly string[]>(() => {
    const scores = this.estimate()?.scores;
    if (!scores) {
      return [];
    }
    return [
      this.scoreChip('царапины', scores.scratches),
      this.scoreChip('разрывы', scores.tears),
      this.scoreChip('утраты', scores.missingAreas),
      this.scoreChip('тон', scores.fadingContrast),
      this.scoreChip('пятна', scores.stains),
      this.scoreChip('детали', scores.blurDetail),
      this.scoreChip('лицо', scores.faceDamage),
      this.scoreChip('дорисовка', scores.reconstruction),
      this.scoreChip('масштаб', scores.outputScale),
    ].filter((chip): chip is string => Boolean(chip));
  });

  protected readonly contactsData: ContactsData = {
    title: CONTACTS.title,
    prompt: 'Принесите старые фото в студию или пришлите скан через удобный мессенджер для оценки',
    links: CONTACTS.links,
  };

  protected readonly pageTabs: readonly RestorationPageTab[] = [
    { id: 'restoration-order', label: 'Заказ реставрации' },
    { id: 'complexity', label: 'Стоимость' },
    { id: 'process', label: 'Этапы' },
    { id: 'result', label: 'Результат' },
    { id: 'faq', label: 'Вопросы' },
    { id: 'contacts', label: 'Контакты' },
  ];

  protected readonly outputTargetOptions: readonly OutputTargetOption[] = [
    {
      id: '10x15',
      icon: 'crop_3_2',
      title: '10x15 см',
      description: 'классическая печать',
      target: { kind: 'print', widthCm: 10, heightCm: 15, dpi: 300, label: '10x15 см' },
    },
    {
      id: '15x21',
      icon: 'crop_portrait',
      title: '15x21 см',
      description: 'портрет и рамка',
      target: { kind: 'print', widthCm: 15, heightCm: 21, dpi: 300, label: '15x21 см' },
    },
    {
      id: '20x30',
      icon: 'crop_5_4',
      title: '20x30 см',
      description: 'крупная печать',
      target: { kind: 'print', widthCm: 20, heightCm: 30, dpi: 300, label: '20x30 см' },
    },
    {
      id: 'a4',
      icon: 'article',
      title: 'A4',
      description: 'альбомный лист',
      target: { kind: 'print', widthCm: 21, heightCm: 29.7, dpi: 300, label: 'A4' },
    },
    {
      id: 'digital',
      icon: 'download',
      title: 'Файл',
      description: 'без печатного размера',
      target: { kind: 'digital', label: 'Цифровой файл' },
    },
    {
      id: 'custom',
      icon: 'straighten',
      title: 'Свой размер',
      description: 'укажите итог в см',
    },
  ];

  protected readonly heroStats = computed<readonly HeroStat[]>(() => [
    { value: 'приехать', label: 'с бумажными фото в студию' },
    { value: 'мессенджер', label: 'любой удобный способ связи' },
    { value: 'от 900₽', label: 'простая реставрация' },
    { value: this.workloadLeadTime(), label: 'обычный срок после оценки' },
  ]);

  protected readonly handoffOptions: readonly HandoffOption[] = [
    {
      icon: 'storefront',
      title: 'Принесите фото в студию',
      description: 'Можно прийти со старыми фотографиями, альбомом или отдельными снимками. Подскажем, что лучше сканировать.',
    },
    {
      icon: 'chat',
      title: 'Пришлите через мессенджер',
      description: 'Отправьте скан или фото с телефона в любой мессенджер. Мы оценим сложность, цену и срок.',
    },
  ];

  protected readonly capabilities: readonly RestorationCapability[] = [
    {
      icon: 'healing',
      title: 'Повреждения',
      description: 'Убираем царапины, заломы, пятна, следы клея, скотча и трещины на бумаге.',
    },
    {
      icon: 'texture',
      title: 'Разрывы и утраты',
      description: 'Собираем порванные части, дорисовываем фон и аккуратно восстанавливаем недостающие детали.',
    },
    {
      icon: 'contrast',
      title: 'Выцветание',
      description: 'Возвращаем контраст, плотность, свет и читаемость лиц на старых и слабых снимках.',
    },
    {
      icon: 'palette',
      title: 'Цвет и тон',
      description: 'Можем оставить историчный чёрно-белый вид или сделать деликатную колоризацию.',
    },
    {
      icon: 'person_search',
      title: 'Архивный портрет',
      description: 'Готовим выразительный портрет по старому фото и дополнительным референсам.',
    },
    {
      icon: 'print',
      title: 'Файл и печать',
      description: 'Подготавливаем результат под экран, публикацию, открытку или печать в студии.',
    },
  ];

  protected readonly complexityTiers: readonly ComplexityTier[] = [
    {
      title: 'Простая',
      price: 'от 900₽',
      description: 'Фото читаемое, лицо и основные детали сохранены.',
      points: ['небольшие царапины', 'пыль и пятна', 'лёгкая коррекция тона'],
    },
    {
      title: 'Средняя',
      price: 'от 1600₽',
      description: 'Есть заметные повреждения, выцветание или несколько проблем сразу.',
      points: ['заломы и разрывы', 'потеря контраста', 'локальное восстановление фона'],
    },
    {
      title: 'Сложная',
      price: 'от 2800₽',
      description: 'Нужна ручная работа по лицу, одежде, фону и деталям.',
      points: ['сильные утраты', 'сложный фон', 'подготовка крупного портрета'],
    },
    {
      title: 'Профи',
      price: 'от 4000₽',
      description: 'Исходник сильно разрушен или результата нужно добиться почти с нуля.',
      points: ['сборка из фрагментов', 'дорисовка деталей', 'индивидуальное согласование'],
    },
  ];

  protected readonly checklist: readonly ChecklistItem[] = [
    {
      icon: 'scanner',
      title: 'Лучше скан',
      description: 'Для старых фото оптимально 600 dpi и выше. Так сохраняются детали лица, формы и фактуры бумаги.',
    },
    {
      icon: 'photo_camera',
      title: 'Можно фото с телефона',
      description: 'Снимайте без вспышки, ровно сверху, при дневном свете. Если есть блики, сделайте несколько кадров.',
    },
    {
      icon: 'collections',
      title: 'Помогают референсы',
      description: 'Другие фотографии человека, награды, форма или подписи помогают восстановить портрет точнее.',
    },
    {
      icon: 'task_alt',
      title: 'Сразу скажите задачу',
      description: 'Напишите, нужен файл для архива, печати, публикации или памятного макета.',
    },
  ];

  protected readonly processSteps: readonly ProcessStep[] = [
    {
      number: '01',
      icon: 'photo_camera',
      title: 'Получаем исходник',
      description: 'Вы приносите старое фото в студию или присылаете скан через мессенджер, загрузку на сайте или чат.',
    },
    {
      number: '02',
      icon: 'search',
      title: 'Оцениваем работу',
      description: 'Смотрим повреждения, качество исходника, нужный формат и честно называем цену и срок.',
    },
    {
      number: '03',
      icon: 'brush',
      title: 'Реставрируем вручную',
      description: 'Работаем с царапинами, разрывами, тоном, деталями лица, одеждой и фоном.',
    },
    {
      number: '04',
      icon: 'fact_check',
      title: 'Показываем результат',
      description: 'Отправляем предпросмотр, вносим правки и готовим финальный файл под нужный формат.',
    },
  ];

  protected readonly mayFormats: readonly MayFormat[] = [
    {
      icon: 'portrait',
      title: 'Архивный портрет',
      description: 'Аккуратно восстановим лицо и детали для семейного архива.',
    },
    {
      icon: 'palette',
      title: 'Деликатная колоризация',
      description: 'По желанию добавим цвет, сохранив историчный вид снимка.',
    },
    {
      icon: 'crop',
      title: 'Подготовка под печать',
      description: 'Сделаем файл в нужном размере и пропорциях для печати.',
    },
    {
      icon: 'local_printshop',
      title: 'Печать в студии',
      description: 'Распечатаем восстановленное фото или готовый макет у нас.',
    },
  ];

  protected readonly faqItems: readonly FaqItem[] = [
    {
      question: 'Можно ли восстановить очень повреждённое фото?',
      answer: 'Часто можно, но точный результат зависит от того, сохранились ли лицо, контуры и важные детали. Мы сначала оцениваем исходник и честно говорим, что реально сделать.',
    },
    {
      question: 'Нужно приносить оригинал или достаточно скана?',
      answer: 'Подойдут оба варианта. Можно приехать в студию со старой фотографией, альбомом или фрагментами. Если уже есть хороший скан или фото с телефона, пришлите его через любой удобный мессенджер.',
    },
    {
      question: 'Можно ли сделать реставрацию полностью онлайн?',
      answer: 'Да. Пришлите скан или качественное фото через мессенджер либо загрузите файл на этой странице. Мы оценим исходник и подскажем дальнейшие шаги.',
    },
    {
      question: 'Делаете ли колоризацию чёрно-белых фотографий?',
      answer: 'Да, делаем деликатную колоризацию. Если важна историческая точность, лучше прислать референсы формы, наград, одежды или похожие семейные фотографии.',
    },
    {
      question: 'Можно ли подготовить фото для публикации или печати?',
      answer: 'Да. Помимо реставрации можем сделать портрет, макет, открытку, пост для соцсетей и файл для печати.',
    },
  ];

  constructor() {
    afterNextRender(() => {
      if (!isPlatformBrowser(this.platformId)) {
        return;
      }

      this.setupSectionObserver();

      const hashSection = this.sectionIdFromHash(this.document.defaultView?.location.hash ?? '');
      if (hashSection) {
        this.scrollToElement(hashSection, { updateHash: false, behavior: 'instant' });
        return;
      }

      this.scrollToPageTop();
    });
  }

  ngOnInit(): void {
    const title = 'Реставрация фото любой сложности в Ростове и онлайн | Своё Фото';
    const description = 'Профессионально восстановим старые, порванные, выцветшие и архивные фотографии. Можно приехать в студию с бумажными снимками или прислать скан через мессенджер.';

    this.seoService.clearJsonLd();
    this.seoService.setAllMetaData(
      title,
      description,
      'https://svoefoto.ru/assets/static/promo/restavratsiya-foto.webp',
      '/restavratsiya-foto',
      'реставрация фото, восстановление старых фотографий, реставрация фото Ростов, восстановить старое фото, реставрация фото онлайн',
    );

    this.seoService.addJsonLd({
      '@context': 'https://schema.org',
      '@type': 'Service',
      'name': 'Реставрация фотографий',
      'serviceType': 'Реставрация старых и повреждённых фотографий',
      'description': description,
      'image': 'https://svoefoto.ru/assets/static/promo/restavratsiya-foto.webp',
      'provider': {
        '@type': 'LocalBusiness',
        'name': 'Своё Фото',
        'url': 'https://svoefoto.ru',
        'address': {
          '@type': 'PostalAddress',
          'addressLocality': 'Ростов-на-Дону',
          'addressCountry': 'RU',
        },
      },
      'areaServed': [
        { '@type': 'City', 'name': 'Ростов-на-Дону' },
        { '@type': 'Country', 'name': 'Россия' },
      ],
      'offers': {
        '@type': 'Offer',
        'price': '900',
        'priceCurrency': 'RUB',
        'availability': 'https://schema.org/InStock',
        'url': 'https://svoefoto.ru/restavratsiya-foto',
      },
    });
    this.seoService.setBreadcrumbJsonLd([
      { name: 'Главная', url: 'https://svoefoto.ru/' },
      { name: 'Услуги', url: 'https://svoefoto.ru/services' },
      { name: 'Реставрация фото', url: 'https://svoefoto.ru/restavratsiya-foto' },
    ]);
    this.seoService.setFAQPageJsonLd([...this.faqItems]);
    void this.loadWorkload();
  }

  ngOnDestroy(): void {
    this.sectionObserver?.disconnect();
    this.sectionObserver = null;
  }

  protected startQuickUpload(): void {
    if (!isPlatformBrowser(this.platformId) || this.isUploading()) {
      return;
    }

    this.uploadError.set(null);
    this.fileInput()?.nativeElement.click();
  }

  protected onUploadKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.startQuickUpload();
  }

  protected onUploadDragOver(): void {
    if (!this.isUploading()) {
      this.isDragOver.set(true);
    }
  }

  protected onUploadDragLeave(): void {
    this.isDragOver.set(false);
  }

  protected onFilesDropped(files: FileList): void {
    this.isDragOver.set(false);
    if (this.isUploading() || files.length === 0) {
      return;
    }

    void this.uploadSelectedFiles(Array.from(files));
  }

  protected onFilesPicked(event: Event): void {
    const input = event.target;
    if (this.isUploading() || !(input instanceof HTMLInputElement) || !input.files?.length) {
      return;
    }

    const files = Array.from(input.files);
    input.value = '';
    void this.uploadSelectedFiles(files);
  }

  protected goToPayment(): void {
    const url = this.paymentUrl();
    if (!url || !this.canPayEstimate() || !isPlatformBrowser(this.platformId)) {
      return;
    }

    window.location.href = url;
  }

  protected scrollToSection(event: Event, id: RestorationSectionId): void {
    event.preventDefault();
    this.scrollToElement(id);
  }

  protected scrollToComplexity(): void {
    this.scrollToElement('complexity-tiers');
  }

  protected scrollToContacts(): void {
    this.scrollToElement('contacts');
  }

  protected selectOutputTarget(id: RestorationOutputTargetId): void {
    this.selectedOutputTargetId.set(id);
    this.outputTargetError.set(null);
  }

  protected onCustomOutputSizeInput(dimension: 'width' | 'height', event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const normalized = Number.parseFloat(input.value.replace(',', '.'));
    const value = Number.isFinite(normalized) ? normalized : 0;
    if (dimension === 'width') {
      this.customOutputWidthCm.set(value);
    } else {
      this.customOutputHeightCm.set(value);
    }
    this.outputTargetError.set(null);
  }

  protected uploadRowPercent(row: RestorationUploadRow): number {
    return uploadProgressByStatus[row.status];
  }

  protected uploadRowStatusLabel(row: RestorationUploadRow): string {
    switch (row.status) {
      case 'queued':
        return 'Ожидает очереди';
      case 'uploading':
        return 'Загружается';
      case 'done':
        return 'Готово';
      case 'error':
        return 'Ошибка загрузки';
    }
  }

  protected uploadRowStatusIcon(row: RestorationUploadRow): string {
    switch (row.status) {
      case 'queued':
        return 'schedule';
      case 'uploading':
        return 'cloud_upload';
      case 'done':
        return 'check_circle';
      case 'error':
        return 'error_outline';
    }
  }

  protected confidencePercent(value: number): number {
    return Math.round(value * 100);
  }

  private scrollToElement(
    id: string,
    options: { readonly updateHash?: boolean; readonly behavior?: ScrollBehavior } = {},
  ): void {
    const sectionId = this.sectionIdFromString(id);
    if (sectionId) {
      this.activeSection.set(sectionId);
    }

    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const windowRef = this.document.defaultView;
    const target = this.document.getElementById(id);
    if (!windowRef || !target) {
      return;
    }

    const behavior = options.behavior ?? 'smooth';
    const scrollHost = this.document.querySelector('mat-sidenav-content');
    if (scrollHost instanceof windowRef.HTMLElement) {
      const hostRect = scrollHost.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const offset = windowRef.innerWidth <= 720 ? 116 : 132;
      const top = scrollHost.scrollTop + targetRect.top - hostRect.top - offset;

      scrollHost.scrollTo({ top: Math.max(0, top), behavior });
    } else {
      target.scrollIntoView({ behavior, block: 'start' });
    }

    if (sectionId && options.updateHash !== false) {
      const nextUrl = `${windowRef.location.pathname}${windowRef.location.search}#${sectionId}`;
      windowRef.history.replaceState(null, '', nextUrl);
    }
  }

  private async uploadSelectedFiles(files: readonly File[]): Promise<void> {
    try {
      this.buildOutputTargetPayload();
      const preparedFiles = this.validateFiles(files);
      this.uploadState.set('uploading');
      this.uploadError.set(null);
      this.outputTargetError.set(null);
      this.estimate.set(null);
      this.paymentUrl.set(null);
      this.orderId.set(null);
      this.uploadRows.set(preparedFiles.map((file, index) => ({
        id: this.createRowId(index),
        name: file.name,
        sizeLabel: this.formatBytes(file.size),
        status: 'queued',
      })));
      this.scrollToElement('restoration-quick-upload');

      const uploads = await this.presignUploads(preparedFiles);
      const completedFiles: RestorationFileCompletePayload[] = [];

      for (let index = 0; index < preparedFiles.length; index += 1) {
        const file = preparedFiles[index];
        const upload = uploads[index];
        if (!file || !upload) {
          throw new Error('Не удалось подготовить загрузку файла');
        }

        this.patchUploadRow(index, { status: 'uploading' });
        const dimensions = await this.readImageDimensions(file);
        await this.uploadToStorage(upload, file);
        this.patchUploadRow(index, { status: 'done' });
        completedFiles.push({
          s3Key: upload.s3Key,
          fileName: file.name,
          contentType: this.contentTypeForFile(file) ?? upload.contentType,
          fileSize: file.size,
          ...dimensions,
        });
      }

      const result = await this.completeUpload(completedFiles);
      this.estimate.set(result.estimate);
      this.paymentUrl.set(result.paymentUrl);
      this.orderId.set(result.orderId);
      this.uploadState.set('ready');
    } catch (error) {
      this.uploadState.set('error');
      this.uploadError.set(this.messageFromError(error));
      const rows = this.uploadRows();
      const uploadingIndex = rows.findIndex(row => row.status === 'uploading' || row.status === 'queued');
      if (uploadingIndex >= 0) {
        this.patchUploadRow(uploadingIndex, { status: 'error' });
      }
    }
  }

  private validateFiles(files: readonly File[]): readonly File[] {
    if (files.length === 0) {
      throw new Error('Выберите фото для оценки');
    }
    if (files.length > this.maxUploadFiles) {
      throw new Error(`Можно загрузить до ${this.maxUploadFiles} файлов за раз`);
    }

    for (const file of files) {
      if (!this.contentTypeForFile(file)) {
        throw new Error('Поддерживаются JPG, PNG, WEBP, TIFF, HEIC и HEIF');
      }
      if (file.size > this.maxUploadFileSize) {
        throw new Error('Один файл должен быть не больше 50 МБ');
      }
    }

    return files;
  }

  private async presignUploads(files: readonly File[]): Promise<readonly RestorationPresignUpload[]> {
    const response = await firstValueFrom(this.http.post<RestorationPresignResponse>(
      '/api/restoration-orders/upload/presign',
      {
        files: files.map(file => ({
          fileName: file.name,
          contentType: this.contentTypeForFile(file) ?? file.type,
          fileSize: file.size,
        })),
      },
    ));

    if (!response.success || !response.data?.uploads?.length) {
      throw new Error(response.error || 'Не удалось получить ссылку для загрузки');
    }
    return response.data.uploads;
  }

  private async uploadToStorage(upload: RestorationPresignUpload, file: File): Promise<void> {
    const response = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': upload.contentType || file.type },
      body: file,
    });

    if (!response.ok) {
      throw new Error('Не удалось загрузить файл в хранилище');
    }
  }

  private async completeUpload(files: readonly RestorationFileCompletePayload[]): Promise<{
    readonly orderId: string;
    readonly paymentUrl: string | null;
    readonly estimate: RestorationEstimate;
  }> {
    const outputTarget = this.buildOutputTargetPayload();
    const response = await firstValueFrom(this.http.post<RestorationCompleteResponse>(
      '/api/restoration-orders/upload/complete',
      { files, outputTarget, pageUrl: this.currentPageUrl() },
    ));

    if (!response.success || !response.data) {
      throw new Error(response.error || 'Не удалось создать заказ на реставрацию');
    }
    return response.data;
  }

  private async loadWorkload(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.workloadUnavailable.set(false);
    try {
      const response = await firstValueFrom(this.http.get<RestorationWorkloadResponse>('/api/restoration-orders/workload'));
      if (response.success && response.data) {
        this.workload.set(response.data);
      } else {
        this.workloadUnavailable.set(true);
      }
    } catch {
      this.workloadUnavailable.set(true);
    }
  }

  private readImageDimensions(file: File): Promise<{ readonly width?: number; readonly height?: number }> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve({});
    }

    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({});
      };
      image.src = url;
    });
  }

  private currentPageUrl(): string | undefined {
    return isPlatformBrowser(this.platformId) ? this.document.defaultView?.location.href : undefined;
  }

  private buildOutputTargetPayload(): RestorationOutputTarget {
    const selectedId = this.selectedOutputTargetId();
    if (selectedId === 'custom') {
      const widthCm = this.roundOutputCm(this.customOutputWidthCm());
      const heightCm = this.roundOutputCm(this.customOutputHeightCm());
      if (widthCm <= 0 || heightCm <= 0 || widthCm > 100 || heightCm > 100) {
        const message = 'Укажите нужный размер результата';
        this.outputTargetError.set(message);
        throw new Error(message);
      }
      return {
        kind: 'print',
        widthCm,
        heightCm,
        dpi: 300,
        label: `${this.formatOutputCm(widthCm)}x${this.formatOutputCm(heightCm)} см`,
      };
    }

    const option = this.outputTargetOptions.find(item => item.id === selectedId);
    if (!option?.target) {
      const message = 'Выберите нужный размер результата';
      this.outputTargetError.set(message);
      throw new Error(message);
    }
    return this.cloneOutputTarget(option.target);
  }

  private patchUploadRow(index: number, patch: Partial<Pick<RestorationUploadRow, 'status'>>): void {
    this.uploadRows.update(rows => rows.map((row, rowIndex) => (
      rowIndex === index ? { ...row, ...patch } : row
    )));
  }

  private createRowId(index: number): string {
    if (isPlatformBrowser(this.platformId) && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `restoration-upload-${Date.now()}-${index}`;
  }

  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  }

  private contentTypeForFile(file: File): string | null {
    if (this.allowedUploadTypes.has(file.type)) {
      return file.type;
    }
    const extension = file.name.split('.').pop()?.toLowerCase();
    return extension ? this.uploadTypeByExtension.get(extension) ?? null : null;
  }

  private messageFromError(error: unknown): string {
    const overloadedMessage =
      'Сервис перегружен, попробуйте ещё раз через минуту или напишите нам в мессенджер.';

    if (error instanceof HttpErrorResponse) {
      const payload: unknown = error.error;

      // 1) Полезное серверное сообщение из { error: '...' }: короткое и не похожее на HTML — отдаём как есть.
      if (this.isRecord(payload) && typeof payload['error'] === 'string') {
        const serverMessage = payload['error'].trim();
        if (serverMessage && serverMessage.length <= 300 && !this.looksLikeHtml(serverMessage)) {
          return serverMessage;
        }
      }

      // 2) Тело-строка: если это HTML-страница ошибки (50x от nginx/Node) или просто длинная — не показываем сырой HTML.
      if (typeof payload === 'string') {
        const body = payload.trim();
        if (body && body.length <= 300 && !this.looksLikeHtml(body)) {
          return body;
        }
      }

      // 3) Всё остальное (HTML-тело, длинный текст, 5xx, недоступность) — дружелюбный текст.
      return overloadedMessage;
    }

    // Наши собственные ошибки (валидация, «Не удалось загрузить файл в хранилище») — на русском.
    // Сырой сетевой сбой fetch даёт английский TypeError('Failed to fetch') — его клиенту не показываем.
    if (error instanceof Error) {
      const message = error.message.trim();
      if (message && !this.looksLikeHtml(message) && this.looksRussian(message)) {
        return message;
      }
    }

    return overloadedMessage;
  }

  private looksLikeHtml(value: string): boolean {
    return /<\s*(html|head|body|!doctype)/i.test(value);
  }

  private looksRussian(value: string): boolean {
    return /[а-яё]/i.test(value);
  }

  private isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null;
  }

  private cloneOutputTarget(target: RestorationOutputTarget): RestorationOutputTarget {
    if (target.kind === 'digital') {
      return { kind: 'digital', label: target.label };
    }
    return {
      kind: 'print',
      widthCm: target.widthCm,
      heightCm: target.heightCm,
      dpi: target.dpi,
      label: target.label,
    };
  }

  private roundOutputCm(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private formatOutputCm(value: number): string {
    return Number.isInteger(value) ? String(value) : String(this.roundOutputCm(value));
  }

  private scoreChip(label: string, score: number): string | null {
    if (score <= 0) {
      return null;
    }
    const level = score >= 3 ? 'сильно' : score >= 2 ? 'заметно' : 'немного';
    return `${label}: ${level}`;
  }

  private setupSectionObserver(): void {
    const windowRef = this.document.defaultView;
    if (!windowRef || !('IntersectionObserver' in windowRef)) {
      return;
    }

    this.sectionObserver?.disconnect();
    const scrollHost = this.document.querySelector('mat-sidenav-content');
    const root = scrollHost instanceof windowRef.HTMLElement ? scrollHost : null;

    this.sectionObserver = new windowRef.IntersectionObserver(entries => {
      const visibleEntries = entries
        .filter(entry => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio);
      const nextSection = this.sectionIdFromString(visibleEntries[0]?.target.id ?? '');
      if (nextSection) {
        this.activeSection.set(nextSection);
      }
    }, {
      root,
      rootMargin: '-40% 0px -55% 0px',
      threshold: [0, 0.2, 0.5, 0.8],
    });

    for (const tab of this.pageTabs) {
      const section = this.document.getElementById(tab.id);
      if (section) {
        this.sectionObserver.observe(section);
      }
    }
  }

  private scrollToPageTop(): void {
    const windowRef = this.document.defaultView;
    if (!windowRef) {
      return;
    }

    const scrollHost = this.document.querySelector('mat-sidenav-content');
    if (scrollHost instanceof windowRef.HTMLElement) {
      scrollHost.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      return;
    }

    windowRef.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  private sectionIdFromHash(hash: string): RestorationSectionId | null {
    return this.sectionIdFromString(hash.startsWith('#') ? hash.slice(1) : hash);
  }

  private sectionIdFromString(id: string): RestorationSectionId | null {
    for (const tab of this.pageTabs) {
      if (tab.id === id) {
        return tab.id;
      }
    }
    return null;
  }
}
