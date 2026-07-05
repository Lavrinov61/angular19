/**
 * Интерфейсы для универсальных посадочных страниц услуг
 */

export interface LandingPageData {
  // SEO
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  
  // Hero Section
  heroTitle: string;
  heroHighlight: string;
  heroSubtitle: string;
  heroBenefits: HeroBenefit[];
  heroCtaText: string;
  heroImage?: string;
  heroVideo?: string;
  
  // Pricing
  price: number;
  priceLabel: string;
  urgentPrice?: number;
  urgentLabel?: string;
  
  // Service Details
  serviceType: string;
  specifications: Specification[];
  requirements: string[];
  requirementsTitle?: string; // "Что нужно для заказа" вместо "Требования к..."
  
  // Gallery (опционально - для услуг без фото)
  photoSamples: PhotoSample[];
  galleryTitle?: string;
  gallerySubtitle?: string;
  
  // Process Steps
  processSteps: ProcessStep[];
  processTitle?: string; // "Как это работает" вместо "Как проходит съёмка"
  
  // Advantages
  advantages: Advantage[];
  advantagesTitle?: string;
  advantagesSubtitle?: string;
  
  // FAQ
  faqItems: FaqItem[];
  
  // Related Services
  relatedServices: RelatedService[];
  
  // Quick Actions customization
  quickActions?: QuickActionsConfig;
  
  // Before/After comparison (editorial feature)
  beforeAfter?: BeforeAfterConfig;

  // CTA Section customization
  cta?: CtaConfig;
  
  // Schema.org type
  schemaType: 'PhotoService' | 'PrintService' | 'DesignService' | 'OnlineService';

  // Режим услуги: studio (офлайн) или online (по всей России)
  serviceMode?: 'studio' | 'online';
}

export interface HeroBenefit {
  icon: string;
  text: string;
}

export interface Specification {
  label: string;
  value: string;
}

export interface PhotoSample {
  src: string;
  alt: string;
  description: string;
}

export interface ProcessStep {
  number: number;
  title: string;
  description: string;
  icon: string;
  details?: string[];
}

export interface Advantage {
  icon: string;
  title: string;
  description: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface RelatedService {
  title: string;
  url: string;
  price: number;
  icon: string;
}

export interface BeforeAfterConfig {
  before: string;
  after: string;
  label?: string;
}

export interface QuickActionsConfig {
  primaryTitle: string;
  primaryDescription: string;
  primaryIcon: string;
  secondaryTitle: string;
  secondaryDescription: string;
  secondaryIcon: string;
  showBooking?: boolean; // показывать кнопку записи (для фото) или заказа (для печати)
}

export interface CtaConfig {
  title: string;
  subtitle: string;
  primaryButtonText: string;
  secondaryButtonText: string;
  urgencyText: string;
}

// Категории услуг для группировки
export type ServiceCategory =
  | 'document-photo'
  | 'photo-print'
  | 'portrait'
  | 'print-polygraphy'
  | 'souvenirs'
  | 'retouch'
  | 'online';

// Конфигурация категорий
export const SERVICE_CATEGORIES: Record<ServiceCategory, { title: string; icon: string }> = {
  'document-photo': { title: 'Фото на документы', icon: 'badge' },
  'photo-print': { title: 'Печать фотографий', icon: 'photo' },
  'portrait': { title: 'Портретная съёмка', icon: 'person' },
  'print-polygraphy': { title: 'Печать и полиграфия', icon: 'print' },
  'souvenirs': { title: 'Сувенирная продукция', icon: 'card_giftcard' },
  'retouch': { title: 'Ретушь и обработка', icon: 'brush' },
  'online': { title: 'Онлайн-услуги', icon: 'language' }
};
