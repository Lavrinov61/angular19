import { Directive, ElementRef, input, OnInit, Renderer2, inject, PLATFORM_ID, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Директива для оптимизации изображений с поддержкой WebP
 * Автоматически создает теги picture и source для WebP и добавляет fallback для jpeg/png
 * Пример использования: <img appWebpSupport src="image.jpg" alt="Описание">
 */
@Directive({
  selector: 'img[appWebpSupport]',
  
})
export class WebpSupportDirective implements OnInit {
  readonly src = input.required<string>();
  
  private el = inject(ElementRef);
  private renderer = inject(Renderer2);
  private platformId = inject(PLATFORM_ID);
  
  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      // На сервере просто оставляем исходное изображение
      return;
    }
    
    // Используем effect для отслеживания изменений src
    effect(() => {
      const srcValue = this.src();
      if (!srcValue) {
        return;
      }
      
      // Создаем WebP версию пути
      const webpSrc = this.getWebpPath(srcValue);
    
    // Получаем исходный img элемент
    const imgElement = this.el.nativeElement;
    
    // Добавляем атрибуты для оптимизации
    this.renderer.setAttribute(imgElement, 'loading', 'lazy');
    this.renderer.setAttribute(imgElement, 'decoding', 'async');
    
    // Создаем элемент picture
    const pictureElement = this.renderer.createElement('picture');
    
    // Создаем source для WebP
    const sourceWebp = this.renderer.createElement('source');
    this.renderer.setAttribute(sourceWebp, 'srcset', webpSrc);
    this.renderer.setAttribute(sourceWebp, 'type', 'image/webp');
    
    // Клонируем атрибуты медиа-запросов если есть
    if (imgElement.getAttribute('srcset')) {
      const webpSrcset = this.convertSrcsetToWebp(imgElement.getAttribute('srcset'));
      this.renderer.setAttribute(sourceWebp, 'srcset', webpSrcset);
    }
    
    if (imgElement.getAttribute('sizes')) {
      this.renderer.setAttribute(sourceWebp, 'sizes', imgElement.getAttribute('sizes'));
    }
    
    // Отсоединяем img от родителя
    const parent = imgElement.parentNode;
    this.renderer.removeChild(parent, imgElement);
    
      // Добавляем элементы в правильном порядке
      this.renderer.appendChild(pictureElement, sourceWebp);
      this.renderer.appendChild(pictureElement, imgElement);
      this.renderer.appendChild(parent, pictureElement);
    });
  }
  
  /**
   * Преобразует путь изображения в WebP
   */
  private getWebpPath(src: string): string {
    // Получаем расширение файла
    const extension = src.split('.').pop()?.toLowerCase();
    
    // Поддерживаемые форматы для конвертации
    const supportedFormats = ['jpg', 'jpeg', 'png'];
    
    if (extension && supportedFormats.includes(extension)) {
      // Заменяем расширение на webp
      return src.replace(new RegExp(`\\.${extension}$`), '.webp');
    }
    
    // Если формат не поддерживается или нет расширения, возвращаем исходный путь
    return src;
  }
  
  /**
   * Преобразует набор srcset в WebP версии
   */
  private convertSrcsetToWebp(srcset: string): string {
    if (!srcset) return '';
    
    // Разбиваем srcset на отдельные элементы
    const srcsetParts = srcset.split(',');
    
    // Преобразуем каждый элемент в WebP
    const webpSrcsetParts = srcsetParts.map(part => {
      const [url, descriptor] = part.trim().split(/\s+/);
      return `${this.getWebpPath(url)} ${descriptor || ''}`.trim();
    });
    
    return webpSrcsetParts.join(', ');
  }
}
