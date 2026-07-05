// Модель данных фотографа
export interface Photographer {
  id: string;
  slug: string; // URL slug для SEO (например: 'vitaliy-boiko')
  name: string;
  title: string; // Профессиональный титул
  specialization: PhotographerSpecialization[];
  profileImage: string;
  avatarImage?: string; // Аватар фотографа для админки и списков
  portfolioImages: PhotographerPortfolioImage[];
  
  // AIDA - Attention
  heroTitle: string;
  heroSubtitle: string;
  heroImage: string;
  attentionBadge?: string;
  // AIDA - Interest
  experience: string;
  achievments: string[];
  uniqueApproach: string;
  
  // AIDA - Desire
  clientTestimonials: ClientTestimonial[];
  servicesOffered: PhotographerService[];
  priceRange: string;
  
  // AIDA - Action
  ctaTitle: string;
  ctaSubtitle: string;
  bookingLink: string;
  contactInfo: ContactInfo;
  
  // SEO и метаданные
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
    // Дополнительная информация
  isActive: boolean;
  rating: number;
  reviewsCount: number;
  languages: string[];
  workingHours: string;
  location: string;
  
  // Интеграция с системой расписания
  scheduleSettings?: PhotographerScheduleSettings;
  studioAvailable: boolean; // Работает ли в студии Magnus
  locationAvailable: boolean; // Выездные съемки
  status: PhotographerStatus;
}

// Настройки расписания фотографа
export interface PhotographerScheduleSettings {
  workingDays: number[]; // 0-6 (воскресенье-суббота)
  workingHours: {
    start: string; // HH:MM
    end: string; // HH:MM
  };
  slotDuration: number; // стандартная продолжительность слота в минутах
  breakDuration: number; // перерыв между слотами в минутах
  studioServices: string[]; // услуги, доступные в студии
  locationServices: string[]; // услуги, доступные на выезде
  maxLocationDistance: number; // максимальное расстояние для выездных съемок в км
  autoAcceptBookings: boolean; // автоматически подтверждать бронирования
  advanceBookingDays: number; // за сколько дней можно бронировать
}

export interface PhotographerSpecialization {
  id: string;
  name: string;
  description: string;
  icon: string;
  isPopular?: boolean;
}

export interface PhotographerPortfolioImage {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string;
  title: string;
  category: string;
  description?: string;
  isHero?: boolean;
  tags?: string[];
}

export interface ClientTestimonial {
  id: string;
  clientName: string;
  authorName?: string;
  clientImage?: string;
  avatar?: string;
  rating: number;
  text: string;
  date: string;
  serviceType: string;
  verified?: boolean;
  photos?: {
    url: string;
    thumbnail?: string;
    description?: string;
  }[];
  likes?: number;
  liked?: boolean;
}

export interface PhotographerService {
  id: string;
  name: string;
  description: string;
  price: number;
  duration: string;
  isPopular?: boolean;
  includes: string[];
  category?: string;
  featured?: boolean;
  popular?: boolean;
  limitedOffer?: boolean;
  oldPrice?: number;
  discount?: number;
  photosIncluded?: number;
  bookingsCount?: number;
  slotsLeft?: number;
}

export interface ContactInfo {
  phone: string;
  email: string;
  telegram?: string;
  whatsapp?: string;
  instagram?: string;
}

// Категории фотографов для фильтрации
export type PhotographerCategory = 'wedding' | 'portrait' | 'family' | 'commercial' | 'event' | 'newborn' | 'fashion';

// Модель для редакционной страницы команды
export interface TeamMember {
  slug: string;
  name: string;
  role: string;
  tagline: string;
  portraitHero: string;
  portraitCard: string;
  experienceYears: number;
  sessionsCompleted: number;
  signature: string;
  specialties: string[];
  personalFact?: string;
}

// Статус фотографа
export type PhotographerStatus = 'active' | 'busy' | 'vacation' | 'inactive';
