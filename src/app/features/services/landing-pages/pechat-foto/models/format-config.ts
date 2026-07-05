/**
 * Конфигурация форматов фотопечати
 */

export type PrintFormatId = '10x15' | '15x20' | '20x30' | '30x40' | '40x50' | 'custom';
export type PaperType = 'matte' | 'glossy' | 'satin' | 'supergloss';
export type PaperPriceTier = 'premium' | 'super';
export type CustomPrintSizePresetId = '5x7_5' | 'half_10x15' | 'half_10x15_border' | '10_5_square' | 'custom';

export interface CustomPrintSizeOption {
  id: CustomPrintSizePresetId;
  label: string;
  shortLabel: string;
  sizeLabel: string;
  description: string;
  whiteBorder: boolean;
  defaultNeedsCropping: boolean;
}

export interface CustomPrintSizeSettings {
  presetId: CustomPrintSizePresetId;
  label: string;
  sizeLabel: string;
  needsCropping: boolean;
  whiteBorder: boolean;
}

export interface PrintTierOption {
  id: PaperPriceTier;
  label: string;
  shortLabel: string;
  description: string;
  preferredPaperType: PaperType;
}

export interface PaperOption {
  id: PaperType;
  label: string;
  shortLabel: string;
  priceTier: PaperPriceTier;
}

export const PAPER_OPTIONS: Record<PaperType, PaperOption> = {
  matte: {
    id: 'matte',
    label: 'Матовая',
    shortLabel: 'Матт',
    priceTier: 'premium',
  },
  glossy: {
    id: 'glossy',
    label: 'Глянцевая',
    shortLabel: 'Глянец',
    priceTier: 'premium',
  },
  satin: {
    id: 'satin',
    label: 'Сатин',
    shortLabel: 'Сатин',
    priceTier: 'super',
  },
  supergloss: {
    id: 'supergloss',
    label: 'Суперглянец',
    shortLabel: 'Суперглянец',
    priceTier: 'super',
  },
};

export const PRINT_TIER_OPTIONS: Record<PaperPriceTier, PrintTierOption> = {
  premium: {
    id: 'premium',
    label: 'Премиум',
    shortLabel: 'Премиум',
    description: 'Матовая или глянцевая база',
    preferredPaperType: 'matte',
  },
  super: {
    id: 'super',
    label: 'Супер',
    shortLabel: 'Супер',
    description: 'Сатин или суперглянец',
    preferredPaperType: 'supergloss',
  },
};

export const PRINT_TIER_ORDER: readonly PaperPriceTier[] = ['premium', 'super'];
export const STANDARD_PHOTO_PAPER_TYPES: readonly PaperType[] = ['matte', 'glossy', 'satin', 'supergloss'];
export const CUSTOM_CROP_FEE = 10;

export const CUSTOM_PRINT_SIZE_OPTIONS: readonly CustomPrintSizeOption[] = [
  {
    id: '5x7_5',
    label: '5×7,5',
    shortLabel: '5×7,5',
    sizeLabel: '5×7,5 см',
    description: 'Мини-отпечатки на листе 10×15',
    whiteBorder: false,
    defaultNeedsCropping: false,
  },
  {
    id: 'half_10x15',
    label: 'Половина 10×15',
    shortLabel: 'Половина',
    sizeLabel: '7,5×10 см',
    description: 'Два кадра на стандартном листе',
    whiteBorder: false,
    defaultNeedsCropping: false,
  },
  {
    id: 'half_10x15_border',
    label: 'Половина с рамкой',
    shortLabel: 'С рамкой',
    sizeLabel: '7,5×10 см',
    description: 'Половина стандартного фото с белой рамкой',
    whiteBorder: true,
    defaultNeedsCropping: false,
  },
  {
    id: '10_5_square',
    label: '10,5×10,5',
    shortLabel: 'Квадрат',
    sizeLabel: '10,5×10,5 см',
    description: 'Квадратный отпечаток',
    whiteBorder: false,
    defaultNeedsCropping: false,
  },
  {
    id: 'custom',
    label: 'Свой размер',
    shortLabel: 'Свой',
    sizeLabel: 'указать вручную',
    description: 'Другой размер на минимальном подходящем листе',
    whiteBorder: false,
    defaultNeedsCropping: false,
  },
];

export const DEFAULT_CUSTOM_PRINT_SIZE = CUSTOM_PRINT_SIZE_OPTIONS[0];

export function customPrintSizeOptionById(id: CustomPrintSizePresetId): CustomPrintSizeOption {
  return CUSTOM_PRINT_SIZE_OPTIONS.find(option => option.id === id) ?? DEFAULT_CUSTOM_PRINT_SIZE;
}

export function paperOptionLabel(paperType: PaperType): string {
  return PAPER_OPTIONS[paperType].label;
}

export function paperOptionShortLabel(paperType: PaperType): string {
  return PAPER_OPTIONS[paperType].shortLabel;
}

export function paperPriceTier(paperType: PaperType): PaperPriceTier {
  return PAPER_OPTIONS[paperType].priceTier;
}

export function printTierLabel(tier: PaperPriceTier): string {
  return PRINT_TIER_OPTIONS[tier].label;
}

export function printTierDescription(tier: PaperPriceTier): string {
  return PRINT_TIER_OPTIONS[tier].description;
}

export function printTiersForPaperTypes(paperTypes: readonly PaperType[]): PaperPriceTier[] {
  return PRINT_TIER_ORDER.filter(tier => paperTypes.some(paperType => paperPriceTier(paperType) === tier));
}

export function preferredPaperTypeForTier(
  paperTypes: readonly PaperType[],
  tier: PaperPriceTier,
): PaperType | null {
  const preferred = PRINT_TIER_OPTIONS[tier].preferredPaperType;
  if (paperTypes.includes(preferred)) {
    return preferred;
  }

  return paperTypes.find(paperType => paperPriceTier(paperType) === tier) ?? null;
}

function standardBackendFormatKey(formatId: Extract<PrintFormatId, '10x15' | '15x20' | '20x30'>, paperType: PaperType): string {
  return `${formatId}_${paperType}`;
}

export interface FormatConfig {
  /** Идентификатор формата */
  id: PrintFormatId;
  /** Отображаемое название: "A6 (10×15)" */
  name: string;
  /** Размеры для отображения: "10 × 15 см" */
  displaySize: string;
  /** Краткое описание */
  description: string;
  /** Доступные типы бумаги */
  paperTypes: readonly PaperType[];
  /** Только с полями (15×20) */
  marginsRequired: boolean;
  /** Поддерживает загрузку фото */
  uploadEnabled: boolean;
  /** Масштаб для визуального сравнения (0..1) */
  sizeScale: number;
  /** Минимальное разрешение */
  minResolution: string;
  /** Backend-ключ формата по типу бумаги */
  backendFormatKey: (paperType: PaperType) => string;
  /** Фоллбэк цена (если PricesService не загрузился) */
  fallbackPriceMin: number;
  /** Единица: "руб./шт" */
  priceUnit: string;
}

export const PRINT_FORMATS: FormatConfig[] = [
  {
    id: 'custom',
    name: 'Нестандартный размер',
    displaySize: 'минимальный лист',
    description: 'Для мини-форматов, половинок, квадратов и других размеров',
    paperTypes: STANDARD_PHOTO_PAPER_TYPES,
    marginsRequired: false,
    uploadEnabled: true,
    sizeScale: 0.48,
    minResolution: '1200×1800 px',
    backendFormatKey: (p) => standardBackendFormatKey('10x15', p),
    fallbackPriceMin: 20,
    priceUnit: 'руб./шт',
  },
  {
    id: '10x15',
    name: 'A6 (10×15)',
    displaySize: '10 × 15 см',
    description: 'Классический формат для семейных альбомов и личных архивов',
    paperTypes: STANDARD_PHOTO_PAPER_TYPES,
    marginsRequired: false,
    uploadEnabled: true,
    sizeScale: 0.48,
    minResolution: '1200×1800 px',
    backendFormatKey: (p) => standardBackendFormatKey('10x15', p),
    fallbackPriceMin: 20,
    priceUnit: 'руб./шт',
  },
  {
    id: '15x20',
    name: 'A5 (15×20)',
    displaySize: '15 × 20 см',
    description: 'Только с полями. Идеально для портретов и пейзажей',
    paperTypes: STANDARD_PHOTO_PAPER_TYPES,
    marginsRequired: true,
    uploadEnabled: true,
    sizeScale: 0.64,
    minResolution: '1800×2400 px',
    backendFormatKey: (p) => standardBackendFormatKey('15x20', p),
    fallbackPriceMin: 49,
    priceUnit: 'руб./шт',
  },
  {
    id: '20x30',
    name: 'A4 (20×30)',
    displaySize: '20 × 30 см',
    description: 'Крупный формат для стильных отпечатков и подарков',
    paperTypes: STANDARD_PHOTO_PAPER_TYPES,
    marginsRequired: false,
    uploadEnabled: true,
    sizeScale: 0.82,
    minResolution: '2400×3600 px',
    backendFormatKey: (p) => standardBackendFormatKey('20x30', p),
    fallbackPriceMin: 117,
    priceUnit: 'руб./шт',
  },
  {
    id: '30x40',
    name: '30×40 см',
    displaySize: '30 × 40 см',
    description: 'Впечатляющий постер для украшения интерьера',
    paperTypes: ['matte'],
    marginsRequired: false,
    uploadEnabled: true,
    sizeScale: 1.0,
    minResolution: '3600×4800 px',
    backendFormatKey: (_) => '30x40',
    fallbackPriceMin: 450,
    priceUnit: 'руб./шт',
  },
  {
    id: '40x50',
    name: '40×50 см',
    displaySize: '40 × 50 см',
    description: 'Большой формат для галерейных отпечатков',
    paperTypes: ['matte'],
    marginsRequired: false,
    uploadEnabled: true,
    sizeScale: 1.2,
    minResolution: '4800×6000 px',
    backendFormatKey: (_) => '40x50',
    fallbackPriceMin: 600,
    priceUnit: 'руб./шт',
  },
];

/** Карта форматов для быстрого доступа */
export const FORMATS_MAP = new Map<PrintFormatId, FormatConfig>(
  PRINT_FORMATS.map(f => [f.id, f])
);

/** Только форматы с загрузкой фото */
export const UPLOAD_FORMATS = PRINT_FORMATS.filter(f => f.uploadEnabled);
