export interface PhotographerProfile {
  // Основные данные из users таблицы
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  avatarUrl?: string;
  phone?: string;
  role: string;
  // Данные из employees таблицы
  employeeId?: string;
  name: string;
  bio?: string;  experience: number;
  careerStartDate?: string; // Дата начала карьеры в формате YYYY-MM-DD
  coverImageUrl?: string;   // URL обложки профиля
  specializations: string[];
  portfolio: PortfolioItem[];
  socialMedia: SocialMediaLinks;
  pricing: PricingInfo;
  verified: boolean;
  location: LocationInfo;    // Новые расширенные поля профиля
  education?: EducationInfo;
  professionalCertifications?: ProfessionalCertification[];
  languages?: string[];
  workStyle?: WorkStyleInfo;
  achievements?: string[];
  travelRadius?: number;
  signatureStyle?: string;
  collaborationPreferences?: CollaborationPreferences;
  
  // Настройки и предпочтения
  preferences: PhotographerPreferences;
  privacySettings: PrivacySettings;
  notificationSettings: NotificationSettings;
}

export interface PortfolioItem {
  id: string;
  title: string;
  description?: string;
  imageUrl: string;          // URL полноразмерного изображения
  thumbnailUrl: string;      // URL превью изображения 
  category: string;
  serviceId?: string | null; // ID услуги к которой привязано фото
  tags: string[];
  featured: boolean;
  createdAt: Date;
  order: number;
}

export interface SocialMediaLinks {
  instagram?: string;
  vk?: string;
  telegram?: string;
  whatsapp?: string;
  facebook?: string;
  behance?: string;
  website?: string;
}

export interface PricingInfo {
  currency: string;
  basePrice: number;
  pricePerHour: number;
  packages: PricingPackage[];
}

export interface PricingPackage {
  id: string;
  name: string;
  description: string;
  duration: number; // в минутах
  price: number;
  features: string[];
  popular?: boolean;
}

export interface LocationInfo {
  city: string;
  address?: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface PhotographerPreferences {
  theme?: 'light' | 'dark' | 'auto';
  language?: string;
  timezone?: string;
  profileVisibility?: 'public' | 'private' | 'clients-only';
  showContactInfo?: boolean;
  showPricing?: boolean;
  autoAcceptBookings?: boolean;
  workingDays?: string[];
  preferredShootingStyles?: string[];
  coverImageUrl?: string; // Добавляем URL обложки
}

export interface PrivacySettings {
  showEmail?: boolean;
  showPhone?: boolean;
  showSocialMedia?: boolean;
  allowDirectMessages?: boolean;
  showOnlineStatus?: boolean;
  allowReviews?: boolean;
}

export interface NotificationSettings {
  emailNotifications?: boolean;
  smsNotifications?: boolean;
  pushNotifications?: boolean;
  bookingNotifications?: boolean;
  reminderNotifications?: boolean;
  marketingNotifications?: boolean;
}

export interface ProfileUpdateRequest {
  displayName?: string;  bio?: string;
  careerStartDate?: string; // Дата начала карьеры в формате YYYY-MM-DD
  coverImageUrl?: string;   // URL обложки профиля
  specializations?: string[];
  socialMedia?: Partial<SocialMediaLinks>;
  pricing?: Partial<PricingInfo>;
  location?: Partial<LocationInfo>;
  preferences?: Partial<PhotographerPreferences>;
  privacySettings?: Partial<PrivacySettings>;
  notificationSettings?: Partial<NotificationSettings>;// Новые поля
  education?: EducationInfo;
  professionalCertifications?: ProfessionalCertification[];
  languages?: string[];
  workStyle?: WorkStyleInfo;
  achievements?: string[];
  travelRadius?: number;
  signatureStyle?: string;
  collaborationPreferences?: CollaborationPreferences;
}

export interface AvatarUploadResponse {
  url: string;
  thumbnailUrl?: string;
  size: number;
  mimeType: string;
}

export interface PortfolioUploadResponse {
  id: string;
  url: string;
  thumbnailUrl: string;
  size: number;
  mimeType: string;
  metadata: {
    width: number;
    height: number;
    exif?: unknown;
  };
}

// Новые интерфейсы для расширенного профиля
export interface EducationInfo {
  universities?: UniversityEducation[];
  courses?: CourseEducation[];
}

export interface UniversityEducation {
  name: string;
  degree: string;
  year: number;
  diplomaImageUrl?: string; // URL фотографии диплома
}

export interface CourseEducation {
  name: string;
  provider: string;
  year: number;
  certificateImageUrl?: string; // URL фотографии сертификата
}

export interface ProfessionalCertification {
  name: string;
  organization: string;
  year: number;
  imageUrl?: string; // URL фотографии профессионального сертификата
}

export interface WorkStyleInfo {
  pace?: 'fast' | 'moderate' | 'relaxed';
  approach?: 'artistic' | 'creative' | 'traditional' | 'modern';
  planning?: 'spontaneous' | 'flexible' | 'detailed' | 'structured';
  communication?: 'formal' | 'friendly' | 'professional' | 'casual';
}

export interface CollaborationPreferences {
  team_size?: 'solo' | 'small' | 'medium' | 'large';
  preparation_time?: '1_week' | '2_weeks' | '1_month' | 'flexible';
  backup_photographer?: boolean;
  client_communication?: 'minimal' | 'regular' | 'frequent' | 'constant';
}
