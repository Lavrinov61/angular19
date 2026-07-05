/**
 * Shared interfaces for Gallery feature module
 */

export interface GalleryPhoto {
  id: string;
  title: string;
  src?: string;           // Основное изображение
  alt?: string;
  category?: string;
  tags?: string[];
  photographer?: string;
  date?: Date;
  description?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;   // Для virtual scrolling
  thumbnailSrc?: string;  // Миниатюра
  originalSrc?: string;
  url?: string;           // Альтернативное поле для основного изображения
  imageUrl?: string;      // Поле от API 
  thumbnailUrl?: string;  // Поле от API
  uploadDate?: string;    // Поле от API
  location?: string;
}

export interface GalleryCategory {
  id?: string;
  name: string;
  description?: string;
  imageCount?: number;
  coverPhoto?: string;
  isActive?: boolean;
  filter: string; // Used for filtering
  icon?: string; // Material icon name
  count?: number; // Added for the category count display
  photoCount?: number; // Added for service compatibility
}

export interface GalleryFilter {
  key: string;
  value: string;
  label: string;
  icon?: string;
  count?: number;
}
