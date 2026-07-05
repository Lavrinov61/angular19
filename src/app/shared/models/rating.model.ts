/**
 * Модели для рейтинга и отзывов
 */

export interface PlatformSummary {
  platform: string;
  rating: number;
  reviewCount: number;
  url: string;
}

export interface RatingStats {
  id: string;
  averageRating: number;
  totalReviews: number;
  lastUpdated: Date;
  platformSummary?: PlatformSummary[];
}

export interface Review {
  id: string;
  rating: number;
  comment: string;
  authorName: string;
  date: Date;
  isVerified?: boolean;
  isPublic?: boolean;
  photographerId?: string;
  serviceType?: string;
}

export interface HeroRatingData {
  rating: number;
  ratingText: string;
  ratingLabel: string;
  totalReviews: number;
}
