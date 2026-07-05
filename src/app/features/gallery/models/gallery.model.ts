/**
 * Модели для галереи фотографий
 */

export interface GalleryPhoto {
  id: string;
  slug: string;
  url: string;
  title: string;
  description: string;
  category: GalleryCategory;
  tags: string[];
  photographerId?: string;
  photographer?: string;
  isPublic: boolean;
  isFeatured?: boolean;
  order?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface GalleryCollection {
  id: string;
  title: string;
  description: string;
  photos: GalleryPhoto[];
  category: GalleryCategory;
  isPublic: boolean;
  isFeatured?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export enum GalleryCategory {
  PORTRAIT = 'portrait',
  FAMILY = 'family',
  WEDDING = 'wedding',
  BUSINESS = 'business',
  CHILDREN = 'children',
  FASHION = 'fashion',
  ART = 'art',
  NATURE = 'nature',
  STUDIO = 'studio',
  EVENT = 'event',
  OTHER = 'other'
}

export interface GalleryFilters {
  category?: GalleryCategory;
  photographerId?: string;
  isPublic?: boolean;
  isFeatured?: boolean;
  limit?: number;
  orderBy?: 'createdAt' | 'updatedAt' | 'order';
  orderDirection?: 'asc' | 'desc';
}

// Статистика галереи для главной страницы
export interface GalleryStat {
  icon: string;
  value: string;
  label: string;
}

// Данные для компонента галереи на главной
export interface GalleryHomeData {
  photos: GalleryPhoto[];
  stats: GalleryStat[];
}
