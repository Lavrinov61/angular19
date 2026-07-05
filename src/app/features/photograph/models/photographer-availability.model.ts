// Расширенная модель доступности фотографа для внутреннего использования в сервисе
export interface PhotographerAvailability {
  photographerId: string;
  name: string;
  specializations: string[]; // Здесь строковые значения для внутреннего использования
  workingDays: number[]; // 0-6, где 0 - воскресенье, 1 - понедельник, и т.д.
  workingHours: {
    start: string;
    end: string;
  };
  availableSlots: Record<string, string[]>;
  busySlots: Record<string, string[]>;
  studioOnly: boolean;
  locationOnly: boolean;
  maxTravelDistance: number;
  priceModifier: number;
  rating: number;
  reviewsCount: number;
  isTopRated: boolean;
  portfolioImages: string[];
  specialtyDescription: string;
}
