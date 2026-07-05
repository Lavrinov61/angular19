import { Injectable, signal, computed } from '@angular/core';
import { Observable, of } from 'rxjs';
import { GALLERY_FALLBACK as GALLERY_DATA } from '../data/gallery.data';
import { GalleryPhoto, GalleryCategory } from '../../shared/models/gallery.model';

export type { GalleryPhoto, GalleryCategory };

export interface GalleryFilters {
  category?: string;
  photographerId?: string;
  tags?: string[];
  search?: string;
  limit?: number;
  offset?: number;
}

@Injectable({
  providedIn: 'root'
})
export class GalleryService {
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  // Initialize with all photos
  private readonly _photos = signal<GalleryPhoto[]>(GALLERY_DATA);

  readonly isLoading = this._isLoading.asReadonly();
  readonly error = this._error.asReadonly();
  readonly photos = this._photos.asReadonly();

  readonly featuredPhotos = computed(() => {
    // Simple featured logic: take first photo from each category
    const featured = new Map<string, GalleryPhoto>();
    GALLERY_DATA.forEach(photo => {
      if (!featured.has(photo.category)) {
        featured.set(photo.category, photo);
      }
    });
    return Array.from(featured.values());
  });

  getPhotos(filters?: GalleryFilters): Observable<GalleryPhoto[]> {
    this._isLoading.set(true);
    let filteredPhotos = [...GALLERY_DATA];

    if (filters) {
      if (filters.category) {
        filteredPhotos = filteredPhotos.filter(p => p.category === filters.category);
      }
      if (filters.photographerId) {
        filteredPhotos = filteredPhotos.filter(p => p.photographerId === filters.photographerId);
      }
      if (filters.tags && filters.tags.length > 0) {
        filteredPhotos = filteredPhotos.filter(p => filters.tags!.every(tag => p.tags.includes(tag)));
      }
      if (filters.search) {
        const query = filters.search.toLowerCase();
        filteredPhotos = filteredPhotos.filter(p =>
          p.title.toLowerCase().includes(query) ||
          p.description.toLowerCase().includes(query) ||
          p.tags.some(t => t.toLowerCase().includes(query))
        );
      }
      if (filters.offset) {
        filteredPhotos = filteredPhotos.slice(filters.offset);
      }
      if (filters.limit) {
        filteredPhotos = filteredPhotos.slice(0, filters.limit);
      }
    }

    this._photos.set(filteredPhotos);
    this._isLoading.set(false);
    return of(filteredPhotos);
  }

  getPhotoById(id: string): Observable<GalleryPhoto | null> {
    const photo = GALLERY_DATA.find(p => p.id === id) || null;
    return of(photo);
  }

  getPhotoBySlug(slug: string): Observable<GalleryPhoto | null> {
    const photo = GALLERY_DATA.find(p => p.slug === slug) || null;
    return of(photo);
  }

  getFeaturedPhotos(limit?: number): Observable<GalleryPhoto[]> {
    return of(this.featuredPhotos().slice(0, limit || 8));
  }

  getPhotosByCategory(category: string, limit?: number): Observable<GalleryPhoto[]> {
    return this.getPhotos({ category, limit });
  }

  searchPhotos(query: string, filters?: Partial<GalleryFilters>): Observable<GalleryPhoto[]> {
    return this.getPhotos({ search: query, ...filters });
  }

  getCategories(): Observable<{ value: string; label: string; count?: number }[]> {
    const categoryCounts = GALLERY_DATA.reduce((acc, photo) => {
      acc[photo.category] = (acc[photo.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const categoryLabels: Record<string, string> = {
      portrait: 'Портреты',
      family: 'Семейные',
      wedding: 'Свадебные',
      commercial: 'Коммерческие',
      art: 'Арт',
      event: 'Событийные',
      nature: 'Природа',
      other: 'Другое'
    };

    return of(
      Object.entries(categoryCounts).map(([value, count]) => ({
        value,
        label: categoryLabels[value] || value,
        count
      }))
    );
  }

  clearError(): void {
    this._error.set(null);
  }
}
