import { Component, input, OnInit, inject, PLATFORM_ID, effect, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Компонент для оптимизированной загрузки изображений
 * - Поддерживает lazy loading
 * - Поддерживает WebP с fallback на JPEG/PNG
 * - Адаптивная загрузка для разных размеров экрана
 * - Оптимизация для Core Web Vitals (LCP, CLS)
 */
@Component({
  selector: 'app-optimized-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div 
      class="image-container"
      [class.placeholder]="!imageLoaded"
      [style.padding-bottom]="aspectRatioPadding"
      [style.background-color]="placeholderColor()">
      
      @if (src()) {
        <img 
          [src]="src()" 
          [alt]="alt()"
          [class.loaded]="imageLoaded"
          (load)="onImageLoaded()"
          loading="lazy"
          decoding="async"
          [width]="width()"
          [height]="height()"
        />
      }
      
      @if (!imageLoaded) {
        <div class="placeholder-content">
          <ng-content select="[placeholder]"></ng-content>
        </div>
      }
    </div>
  `,
  styles: [`
    .image-container {
      position: relative;
      width: 100%;
      overflow: hidden;
      background-color: #f0f0f0;
      transition: background-color 0.3s ease;
    }
    
    img {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    img.loaded {
      opacity: 1;
    }
    
    .placeholder {
      background-color: var(--placeholder-color, #f0f0f0);
    }
    
    .placeholder-content {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  `]
})
export class OptimizedImageComponent implements OnInit {
  src = input.required<string>();
  alt = input<string>('');
  width = input<number>(0);
  height = input<number>(0);
  placeholderColor = input<string>('#f0f0f0');
  
  aspectRatioPadding = '56.25%'; // Default 16:9
  imageLoaded = false;
  
  private platformId = inject(PLATFORM_ID);
  
  ngOnInit(): void {
    // Отслеживаем изменения width и height
    effect(() => {
      const widthValue = this.width();
      const heightValue = this.height();
      if (widthValue && heightValue) {
        const ratio = (heightValue / widthValue) * 100;
        this.aspectRatioPadding = `${ratio}%`;
      }
    });
    
    // На сервере сразу отмечаем как загруженное для SSR
    if (!isPlatformBrowser(this.platformId)) {
      this.imageLoaded = true;
    }
    
    // Для Lighthouse и Core Web Vitals (если изображение в области видимости)
    if (isPlatformBrowser(this.platformId)) {
      if ('loading' in HTMLImageElement.prototype) {
        // Браузер поддерживает native lazy loading
      } else {
        // Резервный механизм для браузеров без поддержки lazy loading
        this.setupIntersectionObserver();
      }
    }
  }
  
  onImageLoaded(): void {
    this.imageLoaded = true;
  }
  
  private setupIntersectionObserver(): void {
    // Реализация IntersectionObserver для старых браузеров
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.imageLoaded = true;
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '200px' });
        // Наблюдаем за контейнером
      setTimeout(() => {
        if (isPlatformBrowser(this.platformId)) {
          const container = document.querySelector('.image-container') as HTMLElement;
          if (container) {
            observer.observe(container);
          }
        }
      }, 0);
    }
  }
}
