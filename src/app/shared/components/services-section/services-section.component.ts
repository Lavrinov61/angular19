import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
// import { MatChipsModule } from '@angular/material/chips'; // Удалено - чипы больше не используются
import { RouterLink } from '@angular/router';
import { ServiceDoc } from '../../../core/data/services.data';

// Интерфейсы для типизации данных услуг
export interface ServicesConfig {
  showHeader?: boolean;
  showCta?: boolean;
  maxItems?: number;
  compactMode?: boolean;
  gridColumns?: 'auto' | 1 | 2 | 3 | 4;
}

export interface ServicesSection {
  title?: string;
  subtitle?: string;
  badge?: {
    icon: string;
    text: string;
  };
  ctaButton?: {
    text: string;
    link: string;
    icon?: string;
  };
}

@Component({
  selector: 'app-services-section',
  
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    RouterLink
],
  templateUrl: './services-section.component.html',
  styleUrls: ['./services-section.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ServicesSectionComponent {
  // Входные данные
  readonly services = input<ServiceDoc[]>([]);
  readonly sectionData = input<ServicesSection>({
    title: 'Наши услуги',
    subtitle: 'От мгновенных портретов до художественных концепций, создаём незабываемые кадры для любого повода',
    badge: {
      icon: 'camera_alt',
      text: 'Наши услуги'
    },
    ctaButton: {
      text: 'Все услуги',
      link: '/',
      icon: 'navigate_next'
    }
  });
  
  readonly config = input<ServicesConfig>({
    showHeader: true,
    showCta: true,
    maxItems: 6,
    compactMode: false,
    gridColumns: 'auto'
  });
  
  // Responsive flags
  readonly isMobile = input<boolean>(false);
  readonly isTablet = input<boolean>(false);
  readonly isDesktop = input<boolean>(false);

  // Получаем обрезанный список услуг
  protected displayServices = computed(() => {
    const maxItems = this.config().maxItems || this.services().length;
    return this.services().slice(0, maxItems);
  });

  // Получаем класс для grid columns
  protected gridColumnsClass = computed(() => {
    const gridColumns = this.config().gridColumns;
    if (gridColumns === 'auto') return '';
    return `grid-cols-${gridColumns}`;
  });

  // Метод для получения текста чипа (не используется - чипы удалены)
  // getChipText(tag: string): string {
  //   switch (tag) {
  //     case 'popular': return 'Популярно';
  //     case 'new': return 'Новинка';
  //     case 'sale': return 'Акция';
  //     default: return tag;
  //   }
  // }

  // Метод для получения цвета чипа (не используется - чипы удалены)
  // getChipColor(tag: string): string {
  //   switch (tag) {
  //     case 'popular': return 'primary';
  //     case 'new': return 'tertiary';
  //     case 'sale': return 'secondary';
  //     default: return 'primary';
  //   }
  // }
}







