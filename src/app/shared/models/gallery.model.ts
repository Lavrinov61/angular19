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
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export type GalleryCategory = 'portrait' | 'wedding' | 'family' | 'art' | 'event' | 'commercial' | 'nature' | 'other';

export interface GallerySection {
  title: string;
  photos: GalleryPhoto[];
}
