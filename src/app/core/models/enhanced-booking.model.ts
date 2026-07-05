// Расширенные модели для системы онлайн-записи с разделением на студийные и выездные услуги

// Типы услуг
export enum ServiceType {
  STUDIO = 'studio',        // Студийные услуги (в Своё Фото)
  ON_LOCATION = 'onLocation'  // Выездные услуги (на локации клиента)
}

// Для обратной совместимости
export type ServiceTypeString = 'studio' | 'onLocation';

// Алиасы для обратной совместимости
export type EnhancedService = ServiceOption;
export type Location = LocationOption;

// Категории услуг
export enum ServiceCategory {
  DOCUMENTS = 'documents',           // Фото на документы
  PORTRAIT = 'portrait',             // Портретная фотосъёмка
  FAMILY = 'family',                 // Семейная фотосъёмка
  WEDDING = 'wedding',               // Свадебная фотосъёмка
  LOVE_STORY = 'love_story',         // Love Story
  COUPLE = 'couple',                 // Парная фотосъёмка
  COMMERCIAL = 'commercial',         // Коммерческая съёмка
  EVENT = 'event',                   // Событийная съёмка
  NEWBORN = 'newborn',              // Фотосъёмка новорождённых
  KIDS = 'kids',                    // Детская фотосъёмка
  MATERNITY = 'maternity',          // Фотосъёмка беременности
  BUSINESS = 'business',            // Бизнес-портреты
  BEAUTY = 'beauty',                // Beauty-портреты
  FASHION = 'fashion',              // Fashion-съёмка
  PRODUCT = 'product'               // Предметная съёмка
}

// Упрощенные интерфейсы для компонентов выбора
export interface ServiceOption {
  id: string;
  name: string;
  title?: string; // Для обратной совместимости
  description: string;
  basePrice: number;
  priceType?: 'fixed' | 'hourly' | 'per_photo';
  duration: number;
  preparationTime?: number;
  photosIncluded: number;
  maxPersons?: number;
  minPersons?: number;
  category: ServiceCategory;
  type: ServiceType;
  isActive?: boolean;
  isPopular?: boolean;
  features: string[];
  image: string;
  gallery?: string[];
  icon?: string;
  color?: string;
  includes?: string[];
  excludes?: string[];
  tags?: string[];
  availablePhotographers?: string[];
  requiresSpecificPhotographer?: boolean;
  photographerSelectionAllowed?: boolean;
  allowCustomLocation?: boolean;
  availableLocations?: string[];
  paymentOptions?: PaymentOption[];
  addons?: ServiceAddon[];
  packages?: ServicePackage[];
}

export interface LocationOption {
  id: string;
  name: string;
  description: string;
  address: string;
  type: 'indoor' | 'outdoor' | 'mixed' | 'park' | 'historical' | 'urban' | 'waterfront' | 'exhibition' | 'custom'; // Расширенные типы
  additionalCost?: number;
  travelCost?: number;
  isPopular?: boolean;
  parkingAvailable?: boolean; // Добавлено для обратной совместимости
  weatherDependent?: boolean; // Зависимость от погоды
  specialRequirements?: string; // Особые требования
  images: string[];
  photos?: string[]; // Алиас для images
  features: string[];
  season?: string[]; // Сезонность локации
  priceModifier?: number; // Модификатор цены
  travelTime?: number; // Время в пути
  rating?: number; // Рейтинг локации
  reviewsCount?: number; // Количество отзывов
  bestTime?: string; // Лучшее время для съемки
  parkingInfo?: string; // Информация о парковке
  accessibility?: string; // Доступность
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface PhotographerOption {
  id: string;
  name: string;
  specialization: ServiceCategory[];
  rating: number;
  reviewsCount: number;
  isTopRated?: boolean;
  portfolioImages: string[];
  description: string;
  hourlyRate?: number;
  isAvailable: boolean;
  workingHours: {
    start: string;
    end: string;
  };
}

export interface PricingDetails {
  basePrice: number;
  addons: { name: string; price: number }[];
  totalPrice: number;
  discount?: number;
  finalPrice: number;
}

// Варианты оплаты
export interface PaymentOption {
  type: 'full' | 'deposit' | 'installments';
  name: string;
  description: string;
  amount?: number;
  percentage?: number;
  dueDate?: 'booking' | 'before_session' | 'after_session';
  installmentPlan?: {
    numberOfPayments: number;
    paymentSchedule: 'weekly' | 'monthly';
  };
}

// Дополнительные услуги
export interface ServiceAddon {
  id: string;
  name: string;
  description: string;
  price: number;
  duration?: number;
  photosIncluded?: number;
  isOptional: boolean;
  isPopular?: boolean;
  category: 'equipment' | 'processing' | 'delivery' | 'styling' | 'location';
  maxQuantity?: number;
  dependsOn?: string[];
  conflictsWith?: string[];
}

// Пакетные предложения
export interface ServicePackage {
  id: string;
  name: string;
  description: string;
  price: number;
  packagePrice?: number; // Алиас для price
  originalPrice?: number; // Первоначальная цена до скидки
  discount?: number; // Размер скидки
  savings: number;
  isPopular: boolean;
  includedAddons: ServiceAddon[];
  services?: string[]; // Список ID услуг в пакете
  validity?: {
    validFrom: Date;
    validTo: Date;
  };
}

// Временной слот
export interface TimeSlot {
  id?: string;
  startTime: string;
  endTime: string;
  date: Date | string;
  isAvailable: boolean;
  photographerId?: string;
  serviceType?: ServiceType;
  price?: number;
}

// Поток бронирования
export interface BookingFlow {
  id: string;
  currentStep: number;
  totalSteps: number;
  completedSteps: string[];
  data: {
    serviceType?: ServiceType;
    service?: ServiceOption;
    location?: LocationOption;
    photographer?: PhotographerOption;
    timeSlot?: TimeSlot;
    customerInfo?: {
      name: string;
      phone: string;
      email: string;
    };
  };
}

// Упрощенная модель бронирования
export interface EnhancedBooking {
  id: string;
  serviceType: ServiceType;
  service: ServiceOption;
  serviceId: string; // Добавлено для обратной совместимости
  location?: LocationOption;
  photographer: PhotographerOption;
  photographerId: string; // Добавлено для обратной совместимости
  timeSlot: TimeSlot;
  date: Date | string; // Добавлено для обратной совместимости
  customerInfo: {
    name: string;
    phone: string;
    email: string;
  };
  addons?: ServiceAddon[];
  totalPrice: number;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  createdAt: Date;
  updatedAt?: Date;
}

// Доступность фотографов для расширенной системы бронирования
export interface PhotographerAvailability {
  photographerId: string;
  name: string;
  specializations: ServiceCategory[];
  workingDays: number[]; // 0-6 (воскресенье-суббота)
  workingHours: {
    start: string; // HH:mm
    end: string;   // HH:mm
  };
  availableSlots: Record<string, string[]>; // дата -> массив доступных времен
  busySlots: Record<string, string[]>;      // дата -> массив занятых времен
  studioOnly: boolean;
  locationOnly: boolean;
  maxTravelDistance?: number; // км для выездных съемок
  priceModifier: number; // множитель цены (1.0 = базовая цена)
  rating: number;
  reviewsCount: number;
  isTopRated: boolean;
  portfolioImages: string[];
  specialtyDescription: string;
}
