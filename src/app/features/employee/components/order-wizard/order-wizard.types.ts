// ── Order Wizard Types ───────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'card' | 'sbp' | 'online' | 'later';

export type DetailsVariant = 'document' | 'form-substitution' | 'simple';

export interface WizardServiceType {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly categorySlug: string;
  readonly detailsVariant: DetailsVariant;
  readonly fileRequired: boolean;
  readonly priceRange: string;
  readonly fallbackPriceRange: string;
}

export interface WizardDocumentType {
  readonly slug: string;
  readonly name: string;
  readonly icon: string;
  readonly templateSlug: string;
  readonly requiresCountry: boolean;
  readonly defaultSize: string;
  readonly fallbackSize: string;
}

export interface DocumentTemplate {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly category: string;
  readonly country_code: string | null;
  readonly photo_width_mm: number;
  readonly photo_height_mm: number;
  readonly head_height_mm: number | null;
  readonly background: string | null;
  readonly photos_per_sheet: number | null;
  readonly sort_order: number;
}

export interface ProcessingTier {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly price: number;
  readonly popular: boolean;
}

export interface UploadFile {
  readonly id: string;
  readonly file: File;
  readonly name: string;
  readonly previewUrl: string;
  readonly isImage: boolean;
}

export interface WizardEmployee {
  readonly id: string;
  readonly display_name: string;
  readonly photo_url: string | null;
  readonly role: string;
}

// ── Static Configs ───────────────────────────────────────────────────────────

export const WIZARD_SERVICE_TYPE_CONFIGS: readonly WizardServiceType[] = [
  {
    slug: 'photo-docs',
    name: 'Фото на документы',
    description: 'Паспорт, виза, права и другие документы',
    icon: 'badge',
    categorySlug: 'photo-docs',
    detailsVariant: 'document',
    fileRequired: true,
    priceRange: 'от 700 ₽',
    fallbackPriceRange: '700–950 ₽',
  },
  {
    slug: 'form-substitution',
    name: 'Подставка формы',
    description: 'Замена одежды на форму на фото',
    icon: 'checkroom',
    categorySlug: 'form-substitution',
    detailsVariant: 'form-substitution',
    fileRequired: true,
    priceRange: 'от 350 ₽',
    fallbackPriceRange: '350–990 ₽',
  },
  {
    slug: 'photo-print',
    name: 'Печать фото',
    description: 'Печать фотографий различных форматов',
    icon: 'print',
    categorySlug: 'photo-print',
    detailsVariant: 'simple',
    fileRequired: true,
    priceRange: 'от 15 ₽',
    fallbackPriceRange: '15–300 ₽',
  },
  {
    slug: 'scanning',
    name: 'Сканирование',
    description: 'Сканирование документов и фото',
    icon: 'scanner',
    categorySlug: 'scanning',
    detailsVariant: 'simple',
    fileRequired: false,
    priceRange: 'от 50 ₽',
    fallbackPriceRange: '50–200 ₽',
  },
  {
    slug: 'copy',
    name: 'Копирование',
    description: 'Копии документов, ч/б и цветные',
    icon: 'content_copy',
    categorySlug: 'copy',
    detailsVariant: 'simple',
    fileRequired: false,
    priceRange: 'от 15 ₽',
    fallbackPriceRange: '15–50 ₽',
  },
  {
    slug: 'other',
    name: 'Другое',
    description: 'Реставрация, коллажи, фотосъёмка',
    icon: 'auto_awesome',
    categorySlug: 'other',
    detailsVariant: 'simple',
    fileRequired: false,
    priceRange: 'от 200 ₽',
    fallbackPriceRange: '200–3000 ₽',
  },
] as const;

export const WIZARD_DOCUMENT_TYPE_CONFIGS: readonly WizardDocumentType[] = [
  {
    slug: 'passport-rf',
    name: 'Паспорт РФ',
    icon: 'credit_card',
    templateSlug: 'passport-rf',
    requiresCountry: false,
    defaultSize: '35x45',
    fallbackSize: '35x45',
  },
  {
    slug: 'zagranpassport',
    name: 'Загранпаспорт',
    icon: 'flight',
    templateSlug: 'zagranpassport',
    requiresCountry: false,
    defaultSize: '35x45',
    fallbackSize: '35x45',
  },
  {
    slug: 'visa',
    name: 'Виза',
    icon: 'public',
    templateSlug: 'visa',
    requiresCountry: true,
    defaultSize: '35x45',
    fallbackSize: '35x45',
  },
  {
    slug: 'voditelskie-prava',
    name: 'Водительские права',
    icon: 'directions_car',
    templateSlug: 'voditelskie-prava',
    requiresCountry: false,
    defaultSize: '30x40',
    fallbackSize: '30x40',
  },
  {
    slug: 'voennyj-bilet',
    name: 'Военный билет',
    icon: 'military_tech',
    templateSlug: 'voennyj-bilet',
    requiresCountry: false,
    defaultSize: '30x40',
    fallbackSize: '30x40',
  },
  {
    slug: 'studencheskij',
    name: 'Студенческий',
    icon: 'school',
    templateSlug: 'studencheskij',
    requiresCountry: false,
    defaultSize: '30x40',
    fallbackSize: '30x40',
  },
  {
    slug: 'medknizhka',
    name: 'Медкнижка',
    icon: 'local_hospital',
    templateSlug: 'medknizhka',
    requiresCountry: false,
    defaultSize: '30x40',
    fallbackSize: '30x40',
  },
  {
    slug: 'other',
    name: 'Другой документ',
    icon: 'description',
    templateSlug: 'other',
    requiresCountry: false,
    defaultSize: '35x45',
    fallbackSize: '35x45',
  },
] as const;
