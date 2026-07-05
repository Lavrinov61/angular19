export interface PhotoLocation {
  id: string;
  name: string;
  description: string;
  shortDescription?: string; // Для совместимости с компонентом
  fullDescription?: string; // Для совместимости с шаблоном
  address: string;
  city: string;
  district: string;
  category: LocationCategoryType;
  coordinates: {
    lat: number;
    lng: number;
  };
  images: LocationImage[]; // Изменено с string[] на LocationImage[]
  coverImage: string;
  difficulty: LocationDifficultyType;
  accessibility: AccessibilityLevelType;
  bestTimeOfDay: TimeOfDayType[];
  bestTimeForPhotos?: TimeOfDayType[]; // Алиас для совместимости
  bestSeason: SeasonType[];
  features: string[];
  tags: string[];
  rating: number;
  reviewCount: number;
  reviewsCount?: number; // Алиас для совместимости
  isPopular: boolean;
  isFeatured: boolean;
  isActive: boolean;
  pricing?: {
    entryFee?: number;
    parkingFee?: number;
    permitRequired?: boolean;
    basePrice?: number; // Для совместимости
  };
  schedule?: {
    openTime?: string;
    closeTime?: string;
    isAlwaysOpen?: boolean;
    closedDays?: string[];
  };
  facilities: string[];
  photographer?: {
    id: string;
    name: string;
    avatar?: string;
  };
  // Дополнительные поля для совместимости с шаблонами
  transportAccess?: {
    metro?: {
      nearestStation: string;
      walkingTime: number;
    };
    bus?: {
      nearestStop: string;
      walkingTime: number;
    };
    car?: {
      parkingAvailable: boolean;
      parkingCost?: number;
    };
  };
  restrictions?: {
    type: string;
    description: string;
  }[];
  equipmentRecommendations?: string[];  availability?: {
    status: 'available' | 'unavailable' | 'limited';
    restrictions: {
      weatherDependent: boolean;
    };
  };
  createdAt: string;
  updatedAt: string;
}

export interface LocationImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  caption: string;
  photographer?: string;
  isMain: boolean;
  tags: string[];
  name?: string; // Для совместимости с шаблонами
}

export interface LocationFeature {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: FeatureCategory;
}

export interface LocationPricing {
  basePrice: number;
  hourlyRate?: number;
  peakTimeMultiplier?: number;
  groupDiscounts?: GroupDiscount[];
  seasonalPricing?: SeasonalPricing[];
  additionalFees?: AdditionalFee[];
}

export interface GroupDiscount {
  minPeople: number;
  maxPeople: number;
  discountPercent: number;
}

export interface SeasonalPricing {
  season: Season;
  priceMultiplier: number;
}

export interface AdditionalFee {
  name: string;
  amount: number;
  description: string;
  required: boolean;
}

export interface LocationAvailability {
  workingHours: WorkingHours;
  bookingAdvance: {
    minDays: number;
    maxDays: number;
  };
  restrictions: {
    weatherDependent: boolean;
    seasonRestrictions: Season[];
    timeRestrictions: TimeRestriction[];
  };
}

export interface WorkingHours {
  monday: DayHours;
  tuesday: DayHours;
  wednesday: DayHours;
  thursday: DayHours;
  friday: DayHours;
  saturday: DayHours;
  sunday: DayHours;
}

export interface DayHours {
  isOpen: boolean;
  openTime?: string; // HH:mm format
  closeTime?: string; // HH:mm format
  breaks?: TimeBreak[];
}

export interface TimeBreak {
  startTime: string;
  endTime: string;
  reason: string;
}

export interface TimeRestriction {
  startTime: string;
  endTime: string;
  reason: string;
  days: DayOfWeek[];
}

export interface TransportAccess {
  metro?: {
    nearestStation: string;
    walkingTime: number; // minutes
    walkingDifficulty: WalkingDifficulty;
  };
  bus?: {
    nearestStop: string;
    busNumbers: string[];
    walkingTime: number;
  };
  car?: {
    parkingAvailable: boolean;
    parkingCost?: number;
    parkingNotes?: string;
  };
  accessibility: AccessibilityLevel;
}

export interface LocationFacility {
  name: string;
  available: boolean;
  cost?: number;
  description?: string;
}

export interface LocationRestriction {
  type: RestrictionType;
  description: string;
  severity: RestrictionSeverity;
}

export interface LocationContact {
  phone?: string;
  email?: string;
  website?: string;
  socialMedia?: SocialMediaLinks;
}

export interface SocialMediaLinks {
  instagram?: string;
  vk?: string;
  telegram?: string;
}

// Enums
export enum LocationCategory {
  PARK = 'PARK',
  ARCHITECTURE = 'ARCHITECTURE',
  WATERFRONT = 'WATERFRONT',
  URBAN = 'URBAN',
  HISTORICAL = 'HISTORICAL',
  CULTURAL = 'CULTURAL',
  MODERN = 'MODERN',
  NATURE = 'NATURE',
  PANORAMIC = 'PANORAMIC',
  INDOOR = 'INDOOR'
}

export enum RostovDistrict {
  KIROVSKY = 'KIROVSKY',
  LENINSKY = 'LENINSKY',
  OKTYABRSKY = 'OKTYABRSKY',
  PERVOMAYSKY = 'PERVOMAYSKY',
  PROLETARSKY = 'PROLETARSKY',
  SOVETSKY = 'SOVETSKY',
  ZHELEZNODOROZHNY = 'ZHELEZNODOROZHNY'
}

export enum FeatureCategory {
  LIGHTING = 'LIGHTING',
  BACKGROUND = 'BACKGROUND',
  PROPS = 'PROPS',
  ATMOSPHERE = 'ATMOSPHERE',
  TECHNICAL = 'TECHNICAL'
}

export enum LocationDifficulty {
  EASY = 'EASY',
  MODERATE = 'MODERATE',
  CHALLENGING = 'CHALLENGING',
  EXPERT = 'EXPERT'
}

export enum TimeOfDay {
  SUNRISE = 'SUNRISE',
  MORNING = 'MORNING',
  NOON = 'NOON',
  AFTERNOON = 'AFTERNOON',
  GOLDEN_HOUR = 'GOLDEN_HOUR',
  SUNSET = 'SUNSET',
  BLUE_HOUR = 'BLUE_HOUR',
  NIGHT = 'NIGHT'
}

export enum Season {
  SPRING = 'SPRING',
  SUMMER = 'SUMMER',
  AUTUMN = 'AUTUMN',
  WINTER = 'WINTER'
}

export enum DayOfWeek {
  MONDAY = 'MONDAY',
  TUESDAY = 'TUESDAY',
  WEDNESDAY = 'WEDNESDAY',
  THURSDAY = 'THURSDAY',
  FRIDAY = 'FRIDAY',
  SATURDAY = 'SATURDAY',
  SUNDAY = 'SUNDAY'
}

export enum WalkingDifficulty {
  EASY = 'EASY',
  MODERATE = 'MODERATE',
  DIFFICULT = 'DIFFICULT'
}

export enum AccessibilityLevel {
  FULL = 'FULL',
  PARTIAL = 'PARTIAL',
  LIMITED = 'LIMITED',
  NONE = 'NONE'
}

export enum RestrictionType {
  PERMISSION_REQUIRED = 'PERMISSION_REQUIRED',
  TIME_LIMITED = 'TIME_LIMITED',
  WEATHER_DEPENDENT = 'WEATHER_DEPENDENT',
  CROWD_RESTRICTION = 'CROWD_RESTRICTION',
  EQUIPMENT_RESTRICTION = 'EQUIPMENT_RESTRICTION',
  NOISE_RESTRICTION = 'NOISE_RESTRICTION'
}

export enum RestrictionSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  STRICT = 'STRICT',
  FORBIDDEN = 'FORBIDDEN'
}

// Location filter interface
export interface LocationFilter {
  categories?: LocationCategoryType[];
  districts?: string[];
  difficulty?: LocationDifficultyType[];
  accessibility?: AccessibilityLevelType[];
  timeOfDay?: TimeOfDayType[];
  season?: SeasonType[];
  features?: string[];
  minRating?: number;
  hasParking?: boolean;
  isFree?: boolean;
  isPopular?: boolean;
  isFeatured?: boolean;
  search?: string;
  [key: string]: unknown;
}

// Constants for easy use
export const LOCATION_CATEGORIES = [
  { value: LocationCategory.PARK, label: 'Парки', icon: 'park' },
  { value: LocationCategory.ARCHITECTURE, label: 'Архитектура', icon: 'location_city' },
  { value: LocationCategory.WATERFRONT, label: 'Набережные', icon: 'waves' },
  { value: LocationCategory.URBAN, label: 'Городские локации', icon: 'apartment' },
  { value: LocationCategory.HISTORICAL, label: 'Исторические места', icon: 'account_balance' },
  { value: LocationCategory.CULTURAL, label: 'Культурные объекты', icon: 'museum' },
  { value: LocationCategory.MODERN, label: 'Современные здания', icon: 'business' },
  { value: LocationCategory.NATURE, label: 'Природа', icon: 'nature' },
  { value: LocationCategory.PANORAMIC, label: 'Панорамные виды', icon: 'landscape' },
  { value: LocationCategory.INDOOR, label: 'Интерьерные съемки', icon: 'home' }
];

export const ROSTOV_DISTRICTS = [
  { value: RostovDistrict.KIROVSKY, label: 'Кировский' },
  { value: RostovDistrict.LENINSKY, label: 'Ленинский' },
  { value: RostovDistrict.OKTYABRSKY, label: 'Октябрьский' },
  { value: RostovDistrict.PERVOMAYSKY, label: 'Первомайский' },
  { value: RostovDistrict.PROLETARSKY, label: 'Пролетарский' },
  { value: RostovDistrict.SOVETSKY, label: 'Советский' },
  { value: RostovDistrict.ZHELEZNODOROZHNY, label: 'Железнодорожный' }
];

export const TIME_OF_DAY_OPTIONS = [
  { value: TimeOfDay.SUNRISE, label: 'Рассвет', icon: 'wb_twilight' },
  { value: TimeOfDay.MORNING, label: 'Утро', icon: 'light_mode' },
  { value: TimeOfDay.NOON, label: 'Полдень', icon: 'wb_sunny' },
  { value: TimeOfDay.AFTERNOON, label: 'День', icon: 'sunny' },
  { value: TimeOfDay.GOLDEN_HOUR, label: 'Золотой час', icon: 'flare' },
  { value: TimeOfDay.SUNSET, label: 'Закат', icon: 'wb_twilight' },
  { value: TimeOfDay.BLUE_HOUR, label: 'Синий час', icon: 'nights_stay' },
  { value: TimeOfDay.NIGHT, label: 'Ночь', icon: 'dark_mode' }
];

export const DIFFICULTY_LEVELS = [
  { value: LocationDifficulty.EASY, label: 'Легко', icon: 'sentiment_satisfied', color: 'green' },
  { value: LocationDifficulty.MODERATE, label: 'Умеренно', icon: 'sentiment_neutral', color: 'orange' },
  { value: LocationDifficulty.CHALLENGING, label: 'Сложно', icon: 'sentiment_dissatisfied', color: 'red' },
  { value: LocationDifficulty.EXPERT, label: 'Экспертный', icon: 'warning', color: 'purple' }
];

export interface CreateLocationRequest {
  name: string;
  description: string;
  address: string;
  city: string;
  district: string;
  category: LocationCategoryType;
  coordinates: {
    lat: number;
    lng: number;
  };
  images?: string[];
  coverImage?: string;
  difficulty: LocationDifficultyType;
  accessibility: AccessibilityLevelType;
  bestTimeOfDay: TimeOfDayType[];
  bestSeason: SeasonType[];
  features: string[];
  tags: string[];
  pricing?: {
    entryFee?: number;
    parkingFee?: number;
    permitRequired?: boolean;
  };
  schedule?: {
    openTime?: string;
    closeTime?: string;
    isAlwaysOpen?: boolean;
    closedDays?: string[];
  };
  facilities: string[];
}

// Types для API (новая версия)
export type LocationCategoryType = 
  | 'nature' 
  | 'urban' 
  | 'historical' 
  | 'studio' 
  | 'beach' 
  | 'park' 
  | 'rooftop' 
  | 'interior' 
  | 'street' 
  | 'industrial';

export type LocationDifficultyType = 'easy' | 'moderate' | 'hard' | 'expert';
export type AccessibilityLevelType = 'full' | 'partial' | 'limited' | 'none';
export type TimeOfDayType = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'dusk' | 'night';
export type SeasonType = 'spring' | 'summer' | 'autumn' | 'winter' | 'all';

// Константы для использования в компонентах
export const LOCATION_CATEGORIES_NEW: {value: LocationCategoryType, label: string, icon: string}[] = [
  { value: 'nature', label: 'Природа', icon: 'nature' },
  { value: 'urban', label: 'Городские локации', icon: 'location_city' },
  { value: 'historical', label: 'Исторические места', icon: 'account_balance' },
  { value: 'studio', label: 'Студии', icon: 'photo_camera' },
  { value: 'beach', label: 'Пляжи', icon: 'beach_access' },
  { value: 'park', label: 'Парки', icon: 'park' },
  { value: 'rooftop', label: 'Крыши', icon: 'roofing' },
  { value: 'interior', label: 'Интерьеры', icon: 'home' },
  { value: 'street', label: 'Уличные локации', icon: 'traffic' },
  { value: 'industrial', label: 'Индустриальные', icon: 'factory' }
];

export const ROSTOV_DISTRICTS_NEW: {value: string, label: string}[] = [
  { value: 'kirovsky', label: 'Кировский' },
  { value: 'leninsky', label: 'Ленинский' },
  { value: 'oktyabrsky', label: 'Октябрьский' },
  { value: 'pervomaysky', label: 'Первомайский' },
  { value: 'proletarsky', label: 'Пролетарский' },
  { value: 'sovetsky', label: 'Советский' },
  { value: 'zheleznodorozhny', label: 'Железнодорожный' },
  { value: 'central', label: 'Центральный' }
];

export const TIME_OF_DAY_OPTIONS_NEW: {value: TimeOfDayType, label: string, icon: string}[] = [
  { value: 'dawn', label: 'Рассвет', icon: 'wb_twilight' },
  { value: 'morning', label: 'Утром', icon: 'light_mode' },
  { value: 'noon', label: 'Днем', icon: 'wb_sunny' },
  { value: 'afternoon', label: 'После обеда', icon: 'sunny' },
  { value: 'evening', label: 'Вечером', icon: 'flare' },
  { value: 'dusk', label: 'Закат', icon: 'wb_twilight' },
  { value: 'night', label: 'Ночью', icon: 'dark_mode' }
];

export const DIFFICULTY_LEVELS_NEW: {value: LocationDifficultyType, label: string, icon: string, color: string}[] = [
  { value: 'easy', label: 'Легко', icon: 'sentiment_satisfied', color: 'green' },
  { value: 'moderate', label: 'Умеренно', icon: 'sentiment_neutral', color: 'orange' },
  { value: 'hard', label: 'Сложно', icon: 'sentiment_dissatisfied', color: 'red' },
  { value: 'expert', label: 'Экспертный', icon: 'warning', color: 'purple' }
];
