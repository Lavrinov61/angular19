import { Component, ChangeDetectionStrategy, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatBadgeModule } from '@angular/material/badge';
import { MatRippleModule } from '@angular/material/core';
import { LoggerService } from '../../../core/services/logger.service';

interface ServiceCard {
  id: number;
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  features: string[];
  category: string;
  duration: string;
  rating: number;
  reviews: number;
  popular?: boolean;
  new?: boolean;
  discount?: number;
}

@Component({
  selector: 'app-card-designs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatBadgeModule,
    MatRippleModule
  ],
  templateUrl: './card-designs.component.html',
  styleUrls: ['./card-designs.component.scss']
})
export class CardDesignsComponent {
  private log = inject(LoggerService);
  protected selectedDesign = signal(1);

  sampleService: ServiceCard = {
    id: 1,
    title: 'Портретная фотосессия',
    description: 'Профессиональная портретная съемка в студии с индивидуальным подходом к каждому клиенту.',
    price: 3500,
    originalPrice: 4500,
    features: [
      '1 час съемки',
      '20 обработанных фото',
      'Консультация по образу',
      'Быстрая обработка'    ],
    category: 'Портрет',
    duration: '1-2 часа',
    rating: 5.0,
    reviews: 127,
    popular: true,
    discount: 22
  };
  designs = [
    { id: 1, name: 'Glassmorphism Card', description: 'Стеклянный эффект с размытием' },
    { id: 2, name: 'Neumorphism Card', description: 'Мягкие тени и выпуклости' },
    { id: 3, name: 'Gradient Mesh Card', description: 'Сложные градиентные сетки' },
    { id: 4, name: 'Minimal Glass Card', description: 'Минимализм со стеклом' },
    { id: 5, name: 'Floating Action Card', description: 'Плавающие элементы действий' },
    { id: 6, name: 'Holographic Card', description: 'Голографические эффекты' },
    { id: 7, name: 'Retro Futurism Card', description: 'Ретро-футуристический стиль' },
    { id: 8, name: 'Organic Shapes Card', description: 'Органические формы' },
    { id: 9, name: 'Dark Mode Neon Card', description: 'Неоновые акценты для темной темы' },
    { id: 10, name: 'Premium Luxury Card', description: 'Премиум дизайн с золотом' },
    { id: 11, name: 'Cyber Matrix Card', description: 'Киберпанк стиль с матричными эффектами' },
    { id: 12, name: 'Material 3D Card', description: 'Объемный материальный дизайн' },
    { id: 13, name: 'Arctic Frost Card', description: 'Ледяные текстуры и холодные тона' },
    { id: 14, name: 'Liquid Motion Card', description: 'Плавные анимации и жидкие формы' },
    { id: 15, name: 'Vintage Paper Card', description: 'Винтажный дизайн с текстурой бумаги' },
    { id: 16, name: 'Neon Glow Card', description: 'Яркое неоновое свечение' },
    { id: 17, name: 'Marble Luxury Card', description: 'Мраморные текстуры и роскошь' },
    { id: 18, name: 'Cosmic Space Card', description: 'Космические паттерны и звезды' },
    { id: 19, name: 'Geometric Modern Card', description: 'Современные геометрические формы' },
    { id: 20, name: 'Watercolor Art Card', description: 'Акварельные переходы и мягкость' }
  ];

  selectDesign(designId: number) {
    this.selectedDesign.set(designId);
  }

  onBook() {
    this.log.debug('Booking service...');
    window.open('/booking', '_self');
  }

  onVK() {
    window.open('https://vk.com/im?sel=-68371131', '_blank');
  }

  onTelegram() {
    window.open('https://t.me/photostudioprofi', '_blank');
  }
}
