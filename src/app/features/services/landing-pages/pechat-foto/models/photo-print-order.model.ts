/**
 * Models for photo print order functionality
 */

/** Available photo print formats */
export type PhotoFormat = '10x15' | '15x20' | '20x30' | '30x40' | 'auto';

/** Available paper types */
export type PaperType = 'premium' | 'super' | 'auto';

/** Order mode - simple (studio decides) or custom (user selects options) */
export type OrderMode = 'simple' | 'custom';

/** Upload status for individual photo */
export type UploadStatus = 'pending' | 'uploading' | 'uploaded' | 'error';

/** Margin options for printing */
export type MarginOption = 'none' | '3mm' | '5mm';

/** Border options for printing */
export type BorderOption = 'none' | 'white' | 'black';

/** Deadline options for order execution */
export type DeadlineOption = 'standard' | 'urgent' | 'express';

/** Individual photo item in the print order */
export interface PhotoPrintItem {
  /** Unique identifier for tracking */
  id: string;
  /** Original file object */
  file: File;
  /** Local preview URL (blob URL) */
  previewUrl: string;
  /** Server URL after upload */
  uploadedUrl?: string;
  /** Selected format */
  format: PhotoFormat;
  /** Selected paper type */
  paperType: PaperType;
  /** Number of copies */
  quantity: number;
  /** Margin/padding around photo */
  margins: MarginOption;
  /** Border around photo */
  border: BorderOption;
  /** Upload status */
  status: UploadStatus;
  /** Upload progress (0-100) */
  uploadProgress: number;
  /** Error message if upload failed */
  errorMessage?: string;
}

/** Additional print options */
export interface PrintOptions {
  /** Auto-enhance colors and brightness */
  autoEnhance: boolean;
  /** Remove red-eye effect */
  removeRedEyes: boolean;
}

/** Contact information for the order */
export interface OrderContactInfo {
  name: string;
  phone: string;
  email?: string;
  comments?: string;
}

/** Complete photo print order */
export interface PhotoPrintOrder {
  /** Order mode */
  mode: OrderMode;
  /** Photos in the order */
  items: PhotoPrintItem[];
  /** Contact information */
  contact: OrderContactInfo;
  /** Global format setting (for simple mode or batch apply) */
  globalFormat?: PhotoFormat;
  /** Global paper type setting (for simple mode or batch apply) */
  globalPaperType?: PaperType;
  /** Execution deadline */
  deadline: DeadlineOption;
  /** Additional print options */
  options: PrintOptions;
  /** Total price in rubles */
  totalPrice: number;
}

/** Price configuration for photo printing */
export interface PhotoPrintPrices {
  premium: Record<Exclude<PhotoFormat, 'auto'>, number>;
  super: Record<Exclude<PhotoFormat, 'auto'>, number>;
}

/** Default prices (fallback if API is unavailable) */
export const DEFAULT_PRINT_PRICES: PhotoPrintPrices = {
  premium: {
    '10x15': 20,
    '15x20': 49,
    '20x30': 117,
    '30x40': 450
  },
  super: {
    '10x15': 36,
    '15x20': 70,
    '20x30': 140,
    '30x40': 450
  }
};

/** Format options for display */
export const FORMAT_OPTIONS: { value: PhotoFormat; label: string; minResolution: string }[] = [
  { value: '10x15', label: '10×15 см', minResolution: '1200×1800 px' },
  { value: '15x20', label: '15×20 см', minResolution: '1800×2400 px' },
  { value: '20x30', label: '20×30 см', minResolution: '2400×3600 px' },
  { value: '30x40', label: '30×40 см', minResolution: '3600×4800 px' }
];

/** Paper type options for display */
export const PAPER_OPTIONS: { value: PaperType; label: string; description: string }[] = [
  { value: 'premium', label: 'Премиум', description: 'Глянцевая профессиональная бумага' },
  { value: 'super', label: 'Супер', description: 'Матовая бумага высокого качества' }
];

/** Margin options for display */
export const MARGIN_OPTIONS: { value: MarginOption; label: string }[] = [
  { value: 'none', label: 'Без полей' },
  { value: '3mm', label: '3 мм' },
  { value: '5mm', label: '5 мм' }
];

/** Border options for display */
export const BORDER_OPTIONS: { value: BorderOption; label: string }[] = [
  { value: 'none', label: 'Без рамки' },
  { value: 'white', label: 'Белая' },
  { value: 'black', label: 'Чёрная' }
];

/** Deadline options for display */
export const DEADLINE_OPTIONS: { value: DeadlineOption; label: string; description: string; multiplier: number }[] = [
  { value: 'standard', label: 'Стандарт', description: '2-3 дня', multiplier: 1 },
  { value: 'urgent', label: 'Срочно', description: '1 день (+50%)', multiplier: 1.5 },
  { value: 'express', label: 'Экспресс', description: '2-3 часа (+100%)', multiplier: 2 }
];

/** File validation constants */
export const FILE_VALIDATION = {
  maxSizeBytes: 50 * 1024 * 1024, // 50MB
  maxSizeMB: 50,
  allowedTypes: ['image/jpeg', 'image/png', 'image/tiff'],
  allowedExtensions: ['jpg', 'jpeg', 'png', 'tiff', 'tif']
};

/** Generate unique ID for photo item */
export function generatePhotoId(): string {
  return `photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** Create a new photo print item from a file */
export function createPhotoPrintItem(file: File, previewUrl: string): PhotoPrintItem {
  return {
    id: generatePhotoId(),
    file,
    previewUrl,
    format: '10x15',
    paperType: 'premium',
    quantity: 1,
    margins: 'none',
    border: 'none',
    status: 'pending',
    uploadProgress: 0
  };
}

/** Default print options */
export const DEFAULT_PRINT_OPTIONS: PrintOptions = {
  autoEnhance: false,
  removeRedEyes: false
};
