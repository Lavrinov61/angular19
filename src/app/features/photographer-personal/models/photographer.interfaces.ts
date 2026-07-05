// Интерфейсы для персональной страницы фотографа

export interface PhotographerPersonalProfile {
  id: string;
  slug: string;
  name: string;
  title: string;
  avatar: string;
  coverImage: string;
  bio: string;
  experience: string;
  specializations: string[];
  location: string;
  rating: number;
  reviewsCount: number;
  
  // AIDA Content
  attention: {
    headline: string;
    subheadline: string;
    tagline: string;
  };
  
  interest: {
    whyChooseMe: {
      experience: string;
      style: string;
      flexibility: string;
    };
    achievements: string[];
    workingAreas: string[];
  };
  
  desire: {
    emotionalText: string;
    mainPackages: MainPackage[];
    additionalServices: AdditionalService[];
    specialOffers: SpecialOffer[];
    whyChooseUs: string[];
  };
  
  action: {
    ctaText: string;
    ctaSubtext?: string;
    onlineDiscount: number;
    bonusOffer: string;
    contactMethods: ContactMethod[];
  };
  
  // Additional Info
  portfolio: PortfolioItem[];
  testimonials: TestimonialItem[];
  availability: AvailabilityInfo;
  pricing: PricingInfo;
  
  // Social & Contact
  social: {
    instagram?: string;
    telegram?: string;
    vk?: string;
    phone?: string;
    email?: string;
  };
  
  // SEO
  seo: {
    title: string;
    description: string;
    keywords: string[];
    ogImage: string;
  };
}

export interface ServicePackage {
  id: string;
  name: string;
  description: string;
  features: string[];
  price?: number;
  duration?: string;
  icon: string;
  isPopular?: boolean;
  discount?: number;
}

export interface MainPackage {
  id: string;
  name: string;
  emoji: string;
  description: string;
  features: string[];
  price: number;
  duration: string;
  highlighted?: boolean;
}

export interface AdditionalService {
  id: string;
  name: string;
  description: string;
  icon: string;
  isPremium?: boolean;
}

export interface SpecialOffer {
  id: string;
  emoji: string;
  title: string;
  description: string;
  conditions?: string;
}

export interface GalleryItem {
  id: string;
  src: string;
  thumbnail: string;
  title: string;
  category: string;
  description?: string;
}

export interface ContactMethod {
  type: 'phone' | 'vk' | 'telegram' | 'email' | 'instagram';
  value: string;
  label: string;
  icon: string;
  isPrimary?: boolean;
}

export interface PortfolioItem {
  id: string;
  title: string;
  category: string;
  image: string; // Основное изображение
  images?: string[]; // Дополнительные изображения (для совместимости)
  description: string;
  date: string;
  clientType?: string;
}

export interface TestimonialItem {
  id: string;
  clientName: string;
  clientAvatar?: string;
  rating: number;
  text: string;
  date: string;
  eventType: string;
  images?: string[];
}

export interface AvailabilityInfo {
  isAvailable: boolean;
  nextAvailableDate?: string;
  workingDays: string[];
  workingHours: {
    start: string;
    end: string;
  };
  busyDates: string[];
}

export interface PricingInfo {
  startingPrice: number;
  currency: string;
  priceRange: {
    min: number;
    max: number;
  };
  packages: ServicePackage[];
}

// Fallback data type for development
export type PhotographerFallbackData = Record<string, PhotographerPersonalProfile>;
