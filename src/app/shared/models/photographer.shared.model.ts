// Общие интерфейсы для фотографов, используемые в разных модулях
// Это позволит избежать циклических зависимостей между модулями photograph и booking
import { ServiceCategory, StaffSpecialization } from './booking.shared.model';

// Базовая модель данных фотографа для совместного использования
export interface SharedPhotographer {
  id: string;
  slug: string;
  name: string;
  title: string;
  profileImage: string;
  specialization: string[];
  rating: number;
  isActive: boolean;
  reviewCount?: number;
  experience?: number; // Добавляем поле опыта в годах
  specializations?: ServiceCategory[];
  staffType: StaffSpecialization;
}

// Для системы бронирования
export interface SharedPhotographerAvailability {
  photographerId: string;
  name: string;
  specializations: ServiceCategory[];
  availableSlots: Record<string, string[]>;
  workingDays?: number[];
  workingHours?: {
    start: string;
    end: string;
  };
  busySlots?: Record<string, string[]>;
  studioOnly?: boolean;
  locationOnly?: boolean;
  maxTravelDistance?: number;
  priceModifier?: number;
  rating?: number;
  reviewsCount?: number;
  isTopRated?: boolean;
  portfolioImages?: string[];
  specialtyDescription?: string;
}

// Общие типы для различных категорий
export type PhotographerCategoryType = 'wedding' | 'portrait' | 'family' | 'commercial' | 'event' | 'newborn' | 'fashion' | 'restoration' | 'art';

// Статус фотографа
export type PhotographerStatusType = 'active' | 'busy' | 'vacation' | 'inactive';
