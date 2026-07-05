import { Injectable, inject, signal, computed } from '@angular/core';
import { LoggerService } from '../../../core/services/logger.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { GalleryCategory } from '../interfaces/gallery.interfaces';
import { GALLERY_FALLBACK } from '../../../core/data/gallery.data';
import { GalleryPhoto } from '../../../shared/models/gallery.model';


export interface PhotoItem {
  id: string;
  src: string;
  thumbnailSrc?: string;
  alt: string;
  title: string;
  description?: string;
  category: string;
  photographerId?: string;
  tags: string[];
}

@Injectable({
  providedIn: 'root'
})
export class GalleryService {
  private log = inject(LoggerService);
  // Signals для состояния
  private _photos = signal<PhotoItem[]>([]);
  private _categories = signal<GalleryCategory[]>([]);
  private _loading = signal<boolean>(false);

  // Публичные readonly signals
  readonly photos = this._photos.asReadonly();
  readonly categories = this._categories.asReadonly();
  readonly loading = this._loading.asReadonly();
  
  // Computed signals
  readonly hasPhotos = computed(() => this._photos().length > 0);
  readonly hasCategories = computed(() => this._categories().length > 0);
  readonly photosCount = computed(() => this._photos().length);

  // Legacy Observable API для обратной совместимости
  photos$ = toObservable(this.photos);
  categories$ = toObservable(this.categories);
  loading$ = toObservable(this.loading);

  constructor() {
    this.loadInitialData();
  }

  /**
   * Load all portfolio images from static data
   */
  private loadInitialData(): void {
    this._loading.set(true);
    
    try {
      const staticPhotos = GALLERY_FALLBACK;
      const photos = this.convertGalleryPhotosToPhotoItems(staticPhotos);
      const categories = this.extractCategoriesFromPhotos(photos);

      this._photos.set(photos);
      this._categories.set(categories);
    } catch (error) {
      this.log.error('Error loading static gallery data:', error);
      this._photos.set([]);
      this._categories.set(this.getDefaultCategories());
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Convert GalleryPhoto array to PhotoItem array
   */
  private convertGalleryPhotosToPhotoItems(galleryPhotos: GalleryPhoto[]): PhotoItem[] {
    return galleryPhotos.map(photo => ({
      id: photo.id,
      src: photo.url,
      thumbnailSrc: photo.url,
      alt: photo.title,
      title: photo.title,
      description: photo.description,
      category: photo.category,
      photographerId: photo.photographerId, // Assuming photographerId is on GalleryPhoto
      tags: photo.tags || []
    }));
  }

  /**
   * Infer category from image data (tags, filename, etc.)
   */
  private inferCategoryFromData(image: PhotoItem): string {
    // First try to infer from tags
    if (image.tags && image.tags.length > 0) {
      const categoryFromTags = this.inferCategoryFromTags(image.tags);
      if (categoryFromTags !== 'other') {
        return categoryFromTags;
      }
    }
    
    // If no meaningful tags, try to infer from filename or title
    const filename = (image.title || '').toLowerCase();
    
    if (filename.includes('portrait') || filename.includes('портрет')) return 'portrait';
    if (filename.includes('wedding') || filename.includes('свадьба')) return 'wedding';
    if (filename.includes('family') || filename.includes('семья')) return 'family';
    if (filename.includes('event') || filename.includes('событие')) return 'event';
    if (filename.includes('nature') || filename.includes('природа')) return 'nature';
    if (filename.includes('architecture') || filename.includes('архитектура')) return 'architecture';
    if (filename.includes('studio') || filename.includes('студия')) return 'studio';
    if (filename.includes('street') || filename.includes('улица')) return 'street';
    
    // Default to 'portfolio' for portfolio images
    return 'portfolio';
  }

  /**
   * Infer category from tags
   */
  private inferCategoryFromTags(tags: string[]): string {
    if (!tags || tags.length === 0) return 'other';
    
    const categoryMap: Record<string, string> = {
      'портрет': 'portrait',
      'свадьба': 'wedding', 
      'семья': 'family',
      'событие': 'event',
      'природа': 'nature',
      'архитектура': 'architecture',
      'студия': 'studio',
      'улица': 'street'
    };
    
    for (const tag of tags) {
      const category = categoryMap[tag.toLowerCase()];
      if (category) return category;
    }
    
    return 'other';
  }

  /**
   * Extract categories from photos
   */
  private extractCategoriesFromPhotos(photos: PhotoItem[]): GalleryCategory[] {
    const categoryMap = new Map<string, GalleryCategory>();
    
    // Add "All" category
    categoryMap.set('all', {
      id: 'all',
      name: 'Все фотографии',
      description: 'Все фотографии галереи',
      photoCount: photos.length,
      filter: 'all',
      icon: 'photo_library'
    });

    photos.forEach(photo => {
      if (!categoryMap.has(photo.category)) {
        const categoryName = this.formatCategoryName(photo.category);
        categoryMap.set(photo.category, {
          id: photo.category,
          name: categoryName,
          description: `Фотографии в категории "${categoryName}"`,
          photoCount: 0,
          filter: photo.category,
          icon: this.getCategoryIcon(photo.category)
        });
      }
      
      const category = categoryMap.get(photo.category);
      if (category) {
        category.photoCount = (category.photoCount || 0) + 1;
      }
    });
    
    return Array.from(categoryMap.values());
  }

  /**
   * Get default categories when no photos available
   */
  private getDefaultCategories(): GalleryCategory[] {
    return [
      {
        id: 'all',
        name: 'Все фотографии',
        description: 'Все фотографии галереи',
        photoCount: 0,
        filter: 'all',
        icon: 'photo_library'
      }
    ];
  }  /**
   * Format category name for display
   */
  private formatCategoryName(category: string): string {
    const categoryNames: Record<string, string> = {
      'portfolio': 'Портфолио',
      'portrait': 'Портреты',
      'wedding': 'Свадьбы',
      'family': 'Семейные',
      'event': 'События',
      'nature': 'Природа',
      'architecture': 'Архитектура',
      'studio': 'Студийные',
      'street': 'Уличные',
      'commercial': 'Коммерческие',
      'art': 'Художественные',
      'other': 'Прочее'
    };
    
    return categoryNames[category.toLowerCase()] || category.charAt(0).toUpperCase() + category.slice(1);
  }

  /**
   * Get appropriate icon for category
   */
  private getCategoryIcon(category: string): string {
    const iconMap: Record<string, string> = {
      'portfolio': 'collections',
      'portrait': 'portrait',
      'wedding': 'favorite',
      'family': 'family_restroom',
      'event': 'event',
      'nature': 'landscape',
      'architecture': 'apartment',
      'studio': 'camera',
      'street': 'location_city'
    };
    
    return iconMap[category.toLowerCase()] || 'photo_library';
  }

  /**
   * Refresh gallery data
   */
  refreshGallery(): void {
    this.loadInitialData();
  }

  /**
   * Upload photo to gallery
   */
  async uploadPhoto(blob: Blob, filename: string): Promise<void> {
    this._loading.set(true);
    
    try {
      // Create FormData for upload
      const formData = new FormData();
      formData.append('file', blob, filename);
      formData.append('category', 'general');
      
      // In real implementation, this would upload to server/storage
      // For now, we'll simulate upload and add to local state
      const newPhoto: PhotoItem = {
        id: `upload_${Date.now()}`,
        src: URL.createObjectURL(blob),
        alt: filename,
        title: filename.replace(/\.[^/.]+$/, ''),
        category: 'general',
        tags: ['uploaded']
      };
      
      const currentPhotos = this._photos();
      this._photos.set([...currentPhotos, newPhoto]);
      
      this.log.debug('Photo uploaded successfully:', filename);
      
    } catch (error) {
      this.log.error('Error uploading photo:', error);
      throw error;
    } finally {
      this._loading.set(false);
    }
  }
  
  /**
   * Get categories as signal-compatible promise
   */
  async getCategoriesSignal(): Promise<GalleryCategory[]> {
    return new Promise((resolve) => {
      this.categories$.subscribe(categories => {
        resolve(categories);
      }).unsubscribe();
    });
  }  /**
   * Get photos as signal-compatible promise
   */
  async getPhotosSignal(category = 'all'): Promise<PhotoItem[]> {
    return new Promise((resolve) => {
      this.photos$.subscribe(photos => {
        if (category === 'all') {
          resolve(photos);
        } else {
          resolve(photos.filter(photo => photo.category === category));
        }
      }).unsubscribe();
    });
  }

  /**
   * Get current photos synchronously
   */
  getCurrentPhotos(): PhotoItem[] {
    return this._photos();
  }

  /**
   * Get current categories synchronously
   */
  getCurrentCategories(): GalleryCategory[] {
    return this._categories();
  }
}
