
export interface PhotoSelection {
  id: string;
  sessionId: string;
  userId: string;
  selectedPhotos: SelectedPhoto[];
  totalPrice: number;
  status: PhotoSelectionStatus;
  createdAt: Date;
  updatedAt: Date;
  paymentInfo?: PaymentInfo;
}

export interface SelectedPhoto {
  id: string;
  photoId: string;
  thumbnailUrl: string;
  originalUrl: string;
  price: number;
  format: PhotoFormat;
  isRetouched: boolean;
  retouchingOptions?: RetouchingOption[];
}

export interface PaymentInfo {
  id: string;
  amount: number;
  currency: 'RUB';
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: Date;
  paidAt?: Date;
  transactionId?: string;
  description: string;
}

export interface RetouchingOption {
  id: string;
  name: string;
  description: string;
  price: number;
  category: RetouchingCategory;
}

export enum PhotoSelectionStatus {
  DRAFT = 'draft',
  PENDING_PAYMENT = 'pending_payment',
  PAID = 'paid',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled'
}

export enum PhotoFormat {
  DIGITAL_HD = 'digital_hd',
  DIGITAL_4K = 'digital_4k',
  PRINT_10X15 = 'print_10x15',
  PRINT_20X30 = 'print_20x30',
  PRINT_A4 = 'print_a4',
  PRINT_A3 = 'print_a3'
}

export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded'
}

export enum PaymentMethod {
  CARD = 'card',
  CASH = 'cash',
  BANK_TRANSFER = 'bank_transfer',
  QR_PAY = 'qr_pay',
  SBERPAY = 'sberpay'
}

export enum RetouchingCategory {
  BASIC = 'basic',
  PORTRAIT = 'portrait',
  SKIN = 'skin',
  COLOR = 'color',
  BACKGROUND = 'background',
  EFFECTS = 'effects'
}

// Вспомогательные типы для отображения
export interface PhotoFormatInfo {
  format: PhotoFormat;
  name: string;
  description: string;
  basePrice: number;
  dimensions?: string;
  dpi?: number;
}

export interface RetouchingPackage {
  id: string;
  name: string;
  description: string;
  options: RetouchingOption[];
  totalPrice: number;
  discountPercent?: number;
}

// Конфигурация цен
export const PHOTO_FORMATS: PhotoFormatInfo[] = [
  {
    format: PhotoFormat.DIGITAL_HD,
    name: 'Цифровая HD',
    description: 'Высокое качество для социальных сетей',
    basePrice: 500,
    dimensions: '1920x1080'
  },
  {
    format: PhotoFormat.DIGITAL_4K,
    name: 'Цифровая 4K',
    description: 'Максимальное качество для печати',
    basePrice: 1000,
    dimensions: '3840x2160'
  },
  {
    format: PhotoFormat.PRINT_10X15,
    name: 'Печать 10x15',
    description: 'Стандартный размер фотографии',
    basePrice: 200,
    dimensions: '10x15 см',
    dpi: 300
  },
  {
    format: PhotoFormat.PRINT_20X30,
    name: 'Печать 20x30',
    description: 'Большой размер для дома',
    basePrice: 800,
    dimensions: '20x30 см',
    dpi: 300
  },
  {
    format: PhotoFormat.PRINT_A4,
    name: 'Печать A4',
    description: 'Формат A4 для документов',
    basePrice: 500,
    dimensions: '21x29.7 см',
    dpi: 300
  },
  {
    format: PhotoFormat.PRINT_A3,
    name: 'Печать A3',
    description: 'Большой формат для постеров',
    basePrice: 1500,
    dimensions: '29.7x42 см',
    dpi: 300
  }
];

export const RETOUCHING_OPTIONS: RetouchingOption[] = [
  // Базовая обработка
  {
    id: 'basic-correction',
    name: 'Базовая коррекция',
    description: 'Коррекция цвета, контраста и яркости',
    price: 300,
    category: RetouchingCategory.BASIC
  },
  {
    id: 'crop-straighten',
    name: 'Кадрирование',
    description: 'Обрезка и выравнивание кадра',
    price: 200,
    category: RetouchingCategory.BASIC
  },
  
  // Портретная ретушь
  {
    id: 'skin-smoothing',
    name: 'Смягчение кожи',
    description: 'Деликатное смягчение кожи с сохранением текстуры',
    price: 800,
    category: RetouchingCategory.SKIN
  },
  {
    id: 'blemish-removal',
    name: 'Удаление недостатков',
    description: 'Удаление прыщей, пятен, мелких дефектов',
    price: 600,
    category: RetouchingCategory.SKIN
  },
  {
    id: 'eye-enhancement',
    name: 'Усиление глаз',
    description: 'Осветление белков, усиление цвета радужки',
    price: 500,
    category: RetouchingCategory.PORTRAIT
  },
  {
    id: 'teeth-whitening',
    name: 'Отбеливание зубов',
    description: 'Естественное отбеливание зубов',
    price: 400,
    category: RetouchingCategory.PORTRAIT
  },
  
  // Цветокоррекция
  {
    id: 'color-grading',
    name: 'Цветокоррекция',
    description: 'Профессиональная настройка цветов',
    price: 700,
    category: RetouchingCategory.COLOR
  },
  {
    id: 'vintage-effect',
    name: 'Винтажный эффект',
    description: 'Стилизация под винтажную фотографию',
    price: 600,
    category: RetouchingCategory.EFFECTS
  },
  {
    id: 'bw-conversion',
    name: 'Чёрно-белая обработка',
    description: 'Художественный перевод в ч/б',
    price: 500,
    category: RetouchingCategory.EFFECTS
  },
  
  // Фон
  {
    id: 'background-blur',
    name: 'Размытие фона',
    description: 'Художественное размытие заднего плана',
    price: 900,
    category: RetouchingCategory.BACKGROUND
  },
  {
    id: 'background-replace',
    name: 'Замена фона',
    description: 'Полная замена фона на выбранный',
    price: 1500,
    category: RetouchingCategory.BACKGROUND
  }
];

export const RETOUCHING_PACKAGES: RetouchingPackage[] = [
  {
    id: 'basic-package',
    name: 'Базовый пакет',
    description: 'Основная обработка для всех фотографий',
    options: [
      RETOUCHING_OPTIONS.find(o => o.id === 'basic-correction')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'crop-straighten')!
    ],
    totalPrice: 400,
    discountPercent: 20
  },
  {
    id: 'portrait-package',
    name: 'Портретный пакет',
    description: 'Полная ретушь для портретных фотографий',
    options: [
      RETOUCHING_OPTIONS.find(o => o.id === 'basic-correction')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'skin-smoothing')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'blemish-removal')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'eye-enhancement')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'teeth-whitening')!
    ],
    totalPrice: 2000,
    discountPercent: 25
  },
  {
    id: 'premium-package',
    name: 'Премиум пакет',
    description: 'Максимальная обработка с художественными эффектами',
    options: [
      RETOUCHING_OPTIONS.find(o => o.id === 'basic-correction')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'skin-smoothing')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'blemish-removal')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'eye-enhancement')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'color-grading')!,
      RETOUCHING_OPTIONS.find(o => o.id === 'background-blur')!
    ],
    totalPrice: 3500,
    discountPercent: 30
  }
];
