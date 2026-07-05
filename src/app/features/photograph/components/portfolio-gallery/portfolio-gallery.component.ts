import { Component, ChangeDetectionStrategy, input, inject, OnInit } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { PhotographerPortfolioImage } from '../../models/photographer.model';
import { LoggerService } from '../../../../core/services/logger.service';

interface PortfolioCategory {
  id: string;
  name: string;
  count: number;
}

@Component({
  selector: 'app-portfolio-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDialogModule
],
  templateUrl: './portfolio-gallery.component.html',
  styleUrl: './portfolio-gallery.component.scss'
})
export class PortfolioGalleryComponent implements OnInit {
  portfolioImages = input<PhotographerPortfolioImage[]>([]);
  readonly photographerName = input('');

  filteredImages: PhotographerPortfolioImage[] = [];
  categories: PortfolioCategory[] = [];
  selectedCategory = 'all';
  isLoading = false;

  private dialog = inject(MatDialog);
  private log = inject(LoggerService);

  ngOnInit(): void {
    this.initializeGallery();
  }

  private initializeGallery(): void {
    this.log.debug('🎨 Initializing portfolio gallery with images:', this.portfolioImages());
    
    // Генерируем категории на основе реальных данных
    this.generateCategories();
    
    // Показываем все изображения по умолчанию
    this.filteredImages = [...this.portfolioImages()];
  }

  private generateCategories(): void {
    // Создаем карту категорий из реальных данных
    const categoryMap = new Map<string, number>();
    
    // Добавляем категорию "Все"
    categoryMap.set('all', this.portfolioImages().length);
    
    // Подсчитываем изображения по категориям
    this.portfolioImages().forEach(image => {
      const category = image.category || 'Общее';
      categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
    });

    // Преобразуем в массив категорий
    this.categories = Array.from(categoryMap.entries()).map(([name, count]) => ({
      id: name === 'all' ? 'all' : name.toLowerCase().replace(/\s+/g, '-'),
      name: name === 'all' ? 'Все работы' : name,
      count
    }));

    this.log.debug('📁 Generated categories:', this.categories);
  }

  filterByCategory(categoryId: string): void {
    this.selectedCategory = categoryId;
    
    if (categoryId === 'all') {
      this.filteredImages = [...this.portfolioImages()];
    } else {
      // Находим категорию по ID и фильтруем изображения
      const categoryName = this.categories.find(cat => cat.id === categoryId)?.name;
      this.filteredImages = this.portfolioImages().filter(image => 
        image.category === categoryName
      );
    }

    this.log.debug(`🔍 Filtered images for category "${categoryId}":`, this.filteredImages.length);
  }

  openImageModal(image: PhotographerPortfolioImage, _index: number): void {
    // TODO: Implement image modal/lightbox
    this.log.debug('📸 Opening image modal:', image);
  }

  // Определяем, есть ли изображения для отображения
  get hasImages(): boolean {
    return this.portfolioImages().length > 0;
  }

  // Получаем сообщение когда нет изображений
  get noImagesMessage(): string {
    if (this.selectedCategory === 'all') {
      return 'У фотографа пока нет работ в портфолио';
    } else {
      const categoryName = this.categories.find(cat => cat.id === this.selectedCategory)?.name;
      return `Нет работ в категории "${categoryName}"`;
    }
  }
}
