import { Component, input, inject, PLATFORM_ID, computed, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { GalleryService } from '../../../core/services/gallery.service';
import { LoggerService } from '../../../core/services/logger.service';
import { GalleryPhoto } from '../../models/gallery.model';
import { ScrollRevealDirective } from '../../directives/scroll-reveal.directive';

// Интерфейсы для типизации данных галереи
export interface GalleryStat {
  icon: string;
  value: string;
  label: string;
}

export interface GalleryData {
  images: string[];
  stats: GalleryStat[];
}

export interface GalleryConfig {
  showStats?: boolean;
  showCta?: boolean;
  maxItems?: number;
  compactMode?: boolean;
}

@Component({
  selector: 'app-gallery-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    RouterLink,
    ScrollRevealDirective
  ],
  templateUrl: './gallery-section.component.html',
  styleUrls: ['./gallery-section.component.scss']
})
export class GallerySectionComponent {
  private galleryService = inject(GalleryService);
  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);

  /** Опыт студии в годах (с 1999), вычисляется автоматически */
  protected readonly yearsOfExperience = new Date().getFullYear() - 1999;
  
  // Фотографии из сервиса (конвертированы в signal)
  readonly galleryPhotos: ReturnType<typeof toSignal<GalleryPhoto[]>>;
  
  constructor() {
    // Конвертируем Observable в signal в constructor (injection context)
    this.galleryPhotos = toSignal(this.galleryService.getFeaturedPhotos(), { initialValue: [] as GalleryPhoto[] });
  }
  
  // Входные данные (для обратной совместимости)
  galleryData = input<GalleryData>({
    images: [],
    stats: [
      { icon: 'photo_library', value: '9000+', label: 'Личных фотографий' },
      { icon: 'people', value: '20000+', label: 'Клиентов' },
      { icon: 'star', value: '5.0', label: 'Рейтинг' },
      { icon: 'access_time', value: String(new Date().getFullYear() - 1999), label: 'Лет опыта' }
    ]
  });
  
  config = input<GalleryConfig>({
    showStats: true,
    showCta: true,
    maxItems: 4, // Уменьшили до 4 как просил пользователь
    compactMode: false
  });
  
  // Responsive flags
  isMobile = input<boolean>(false);
  isTablet = input<boolean>(false);
  isDesktop = input<boolean>(false);
  // Получаем обрезанный список изображений (для обратной совместимости)
  protected displayImages = computed(() => {
    const maxItems = this.config().maxItems || 4;
    return this.galleryData().images.slice(0, maxItems);
  });

  // Gallery helper methods
  openGalleryModal(photo: GalleryPhoto, index: number): void {
    // TODO: Implement gallery modal/lightbox
    this.log.debug('Opening gallery modal for photo:', photo.title, index);
  }

  getImagePosition(index: number): string {
    const positions = ['center', 'top', 'bottom', 'left', 'right'];
    return positions[index % positions.length];
  }
  scrollToContacts(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return; // Скролл доступен только в браузере
    }
    
    const contactsSection = document.querySelector('.contacts-section');
    if (contactsSection) {
      contactsSection.scrollIntoView({ behavior: 'smooth' });
    }
  }
}


