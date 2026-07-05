import { 
  Component, 
  signal, 
  computed, 
  inject, 
  PLATFORM_ID,
  DestroyRef,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  afterNextRender,
  OnInit
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';

import { GalleryService } from '../services/gallery.service';
import { SeoService } from '../../../core/services/seo.service';
import { LoggerService } from '../../../core/services/logger.service';
import { GalleryPhoto, GalleryCategory } from '../interfaces/gallery.interfaces';
import { PhotoDetailDialogComponent } from '../components/photo-detail-dialog.component';

// Modern standalone component with signals and SSR support
@Component({
  selector: 'app-gallery-modern',
  
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [
    RouterModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    ScrollingModule
],  
  template: `
    <div class="gallery-modern" 
         [class.compact]="isMobile()" 
         [class.medium]="isTablet()" 
         [class.expanded]="!isMobile() && !isTablet()"
         [attr.data-theme]="currentTheme()">
      
      <!-- Background elements -->
      <div class="gallery-background">
        <div class="bg-circle-1"></div>
        <div class="bg-circle-2"></div>
        <div class="bg-pattern"></div>
      </div>

      <!-- Hero Header Section -->
      <section class="gallery-hero">
        <div class="hero-container">
          <div class="hero-content">
            <div class="hero-tag">Портфолио</div>
            <h1 class="hero-title">
              <span class="title-highlight">Галерея работ</span> 
              <span class="accent-text"> Своё Фото</span>
            </h1>
            <p class="hero-subtitle">
              Откройте для себя <mark>лучшие работы</mark> наших талантливых фотографов
            </p>
          </div>
        </div>
      </section>

      <!-- Empty State / Under Construction -->
      <div class="empty-state under-construction">
        <div class="container">
          <div class="empty-content">
            <div class="empty-icon-wrapper construction-icon">
              <mat-icon class="empty-icon large-icon">construction</mat-icon>
            </div>
            <h2 class="construction-title">В разработке</h2>
            <p class="construction-message">
              Мы работаем над созданием красивой галереи наших лучших работ. 
              Скоро здесь появятся фотографии из различных категорий: портреты, 
              семейные фотосессии, свадьбы и многое другое.
            </p>
            
            <div class="construction-features">
              <div class="feature-item">
                <mat-icon>photo_library</mat-icon>
                <span>Портфолио фотографов</span>
              </div>
              <div class="feature-item">
                <mat-icon>category</mat-icon>
                <span>Фильтры по категориям</span>
              </div>
              <div class="feature-item">
                <mat-icon>fullscreen</mat-icon>
                <span>Просмотр в полном размере</span>
              </div>
            </div>
            
            <div class="construction-actions">
              <a mat-raised-button color="primary" routerLink="/" class="cta-button primary-cta">
                <mat-icon>home</mat-icon>
                Вернуться на главную
              </a>
              <a mat-raised-button routerLink="/services" class="cta-button">
                <mat-icon>photo_camera</mat-icon>
                Наши услуги
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styleUrl: './gallery-modern.component.scss'
})
export class GalleryModernComponent implements OnInit {
  // Dependency injection
  private readonly galleryService = inject(GalleryService);
  private readonly seoService = inject(SeoService);
  private readonly dialog = inject(MatDialog);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly log = inject(LoggerService);
  // Core state signals - делаем публичными для использования в шаблоне
  readonly allPhotos = signal<GalleryPhoto[]>([]);
  readonly allCategories = signal<GalleryCategory[]>([]);
  
  readonly activeCategory = signal<string>('all');
  readonly isLoading = signal<boolean>(true);
  readonly isLoadingMore = signal<boolean>(false);
  readonly currentTheme = signal<'light' | 'dark'>('light');
  readonly showScrollTop = signal<boolean>(false);
  
  // Pagination
  readonly photosPerPage = signal<number>(20);
  readonly currentPage = signal<number>(1);

  // Responsive layout
  readonly isMobile = signal<boolean>(false);
  readonly isTablet = signal<boolean>(false);

  // Grid customization
  readonly customGridColumns = signal<number>(0); // 0 = auto, 1, 2, etc.

  // Helper to access Math in template
  readonly Math = Math;

  // Computed values
  readonly filteredPhotos = computed(() => {
    const category = this.activeCategory();
    const photos = this.allPhotos();
    
    if (category === 'all') {
      return photos;
    }
    
    return photos.filter(photo => photo.category === category);
  });

  readonly visiblePhotos = computed(() => {
    const filtered = this.filteredPhotos();
    const perPage = this.photosPerPage();
    const page = this.currentPage();
    
    return filtered.slice(0, perPage * page);
  });

  readonly hasMorePhotos = computed(() => {
    const filtered = this.filteredPhotos();
    const visible = this.visiblePhotos();
    
    return visible.length < filtered.length;
  });

  readonly categoriesWithCount = computed(() => {
    const photos = this.allPhotos();
    const categories = this.allCategories();
    
    return categories.map(category => ({
      ...category,
      count: category.filter === 'all' 
        ? photos.length 
        : photos.filter(photo => photo.category === category.filter).length
    }));
  });
  readonly gridColumns = computed(() => {
    const custom = this.customGridColumns();
    const isMobile = this.isMobile();
    const isTablet = this.isTablet();
    
    // Пользовательский выбор имеет приоритет
    if (custom === 1) {
      return 'repeat(1, 1fr)';
    } else if (custom === 0 || custom > 1) {
      // Автоматический режим или множественные колонки
      if (isMobile) {
        return 'repeat(2, 1fr)';
      } else if (isTablet) {
        return 'repeat(3, 1fr)';
      } else {
        return 'repeat(auto-fill, minmax(300px, 1fr))';
      }
    }
    
    // Дефолтный автоматический режим
    if (isMobile) {
      return 'repeat(1, 1fr)';
    } else if (isTablet) {
      return 'repeat(2, 1fr)';
    } else {
      return 'repeat(auto-fill, minmax(300px, 1fr))';
    }
  });

  constructor() {
    // Setup responsive layout observation
    this.setupResponsiveLayout();
    
    // Setup data loading
    this.setupDataSubscriptions();
    
    // Client-side only effects
    afterNextRender(() => {
      this.setupClientSideFeatures();
    });
  }

  ngOnInit(): void {
    this.setupSEO();
    this.loadInitialData();
  }

  // Public methods
  selectCategory(category: string): void {
    this.activeCategory.set(category);
    this.currentPage.set(1); // Reset pagination
    this.updateSEOForCategory(category);
  }

  loadMorePhotos(): void {
    if (this.hasMorePhotos() && !this.isLoadingMore()) {
      this.isLoadingMore.set(true);
      
      // Simulate loading delay for UX
      setTimeout(() => {
        this.currentPage.update(page => page + 1);
        this.isLoadingMore.set(false);
      }, 500);
    }
  }

  openPhotoDialog(photo: GalleryPhoto): void {
    this.dialog.open(PhotoDetailDialogComponent, {
      data: { photo },
      maxWidth: '95vw',
      maxHeight: '95vh',
      panelClass: 'photo-dialog'
    });
  }

  // Grid methods
  setGridColumns(columns: number): void {
    this.customGridColumns.set(columns);
  }

  getGridTitle(): string {
    const category = this.activeCategory();
    const count = this.filteredPhotos().length;
    
    if (category === 'all') {
      return `Все фотографии (${count})`;
    } else {
      const categoryName = this.getCategoryName(category);
      return `${categoryName} (${count})`;
    }
  }

  scrollToTop(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
  handleImageError(event: Event, photo: GalleryPhoto): void {
    const img = event.target as HTMLImageElement;
    if (img && photo.src && photo.src !== photo.thumbnailSrc) {
      // Fallback to main image if thumbnail fails
      img.src = photo.src;
    } else {
      // Show placeholder if all images fail
      img.style.display = 'none';
      const placeholder = img.parentElement?.querySelector('.image-loading-placeholder');
      if (placeholder) {
        (placeholder as HTMLElement).style.display = 'block';
      }
    }
  }

  getCategoryName(categoryFilter: string): string {
    const category = this.allCategories().find(cat => cat.filter === categoryFilter);
    return category?.name || 'Все фотографии';
  }

  getAspectRatio(_photo: GalleryPhoto): string {
    // Default aspect ratio, can be enhanced with actual image dimensions
    return '4/3';
  }

  // Private methods
  private setupResponsiveLayout(): void {
    if (isPlatformBrowser(this.platformId)) {
      // Observe breakpoint changes
      this.breakpointObserver
        .observe([Breakpoints.Handset, Breakpoints.Tablet])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(result => {
          this.isMobile.set(result.breakpoints[Breakpoints.Handset]);
          this.isTablet.set(result.breakpoints[Breakpoints.Tablet]);
        });
    }
  }
  private setupDataSubscriptions(): void {
    // Subscribe to gallery service data and convert to GalleryPhoto format
    this.galleryService.photos$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(photos => {
        // Convert PhotoItem[] to GalleryPhoto[]
        const galleryPhotos: GalleryPhoto[] = photos.map(photo => ({
          id: photo.id,
          title: photo.title || `Фотография от ${new Date().toLocaleDateString()}`,
          alt: photo.alt || photo.title || 'Фотография',
          src: photo.src,
          thumbnailSrc: photo.thumbnailSrc || photo.src, // Use thumbnailSrc from PhotoItem or fallback to src
          category: photo.category || 'other',
          tags: photo.tags || [],
          photographer: photo.photographerId,
          description: photo.description
        }));
        
        this.log.debug('Gallery photos updated:', galleryPhotos.length);
        this.allPhotos.set(galleryPhotos);
        this.log.debug('Setting isLoading to false, photos count:', this.allPhotos().length);
        this.isLoading.set(false);
      });

    this.galleryService.categories$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(categories => {
        this.log.debug('Gallery categories updated:', categories.length);
        this.allCategories.set(categories);
      });
  }

  private setupClientSideFeatures(): void {
    // Client-side only features like intersection observer, theme detection, etc.
    this.detectTheme();
    this.setupScrollListener();
  }
  private setupScrollListener(): void {
    if (isPlatformBrowser(this.platformId)) {
      const scrollHandler = () => {
        const shouldShow = window.scrollY > 500;
        this.showScrollTop.set(shouldShow);
      };

      window.addEventListener('scroll', scrollHandler, { passive: true });
      
      // Cleanup on destroy
      this.destroyRef.onDestroy(() => {
        window.removeEventListener('scroll', scrollHandler);
      });
    }
  }

  private loadInitialData(): void {
    // Trigger data loading from service
    this.galleryService.refreshGallery();
    
    // The data will be automatically available through the subscriptions
    // set up in setupDataSubscriptions()
  }

  private setupSEO(): void {
    const description = 'Галерея лучших работ фотостудии Своё Фото - портреты, семейные фотосессии, художественная съемка. Посмотрите примеры наших фотографий и убедитесь в высоком качестве.';
    
    this.seoService.setGalleryPageMeta({
      title: 'Галерея Своё Фото',
      description: description,
      images: [{
        url: 'https://svoefoto.ru/static/gallery-cover-svoe-foto.jpg',
        alt: 'Галерея работ Своё Фото'
      }],
      category: 'Фотография'
    });
  }

  private updateSEOForCategory(category: string): void {
    // Update meta tags for better SEO when category changes
    if (isPlatformBrowser(this.platformId)) {
      const categoryName = this.getCategoryName(category);
      const title = category === 'all' 
        ? 'Галерея работ Своё Фото - Все фотографии'
        : `${categoryName} - Галерея Своё Фото`;
      
      document.title = title;
      
      // Update meta description
      const metaDescription = document.querySelector('meta[name="description"]');
      if (metaDescription) {
        const description = category === 'all'
          ? 'Откройте для себя лучшие работы наших талантливых фотографов в галерее Своё Фото'
          : `Просмотрите фотографии в категории ${categoryName} от профессиональных фотографов Своё Фото`;
        metaDescription.setAttribute('content', description);
      }
    }
  }

  private detectTheme(): void {
    if (isPlatformBrowser(this.platformId)) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.currentTheme.set(prefersDark ? 'dark' : 'light');
      
      // Listen for theme changes
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', (e) => {
          this.currentTheme.set(e.matches ? 'dark' : 'light');
        });
    }
  }
}
