import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { PECHAT_FOTO } from '../data/photo-print.data';
import { PricesService } from '../../../../core/services/prices.service';
import { LandingPageData } from '../landing-page.interface';

@Component({
  selector: 'app-pechat-foto',
  imports: [
    BaseLandingComponent
  ],
  templateUrl: './pechat-foto.component.html',
  styleUrls: ['./pechat-foto.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PechatFotoComponent {
  private pricesService = inject(PricesService);
  
  // Base data from static file
  private baseData = PECHAT_FOTO;
  
  // Reactive page data with dynamic prices
  pageData = computed<LandingPageData>(() => {
    const prices = this.pricesService.prices();
    const minPrice = this.pricesService.minPrice();
    
    // Create rounded display price (e.g., 19.5 -> 20)
    const displayMinPrice = Math.ceil(minPrice);
    
    return {
      ...this.baseData,
      // Update meta with dynamic price
      metaTitle: `Печать фотографий в Ростове-на-Дону | от ${displayMinPrice}₽ | Своё Фото`,
      metaDescription: `Качественная печать фотографий любых форматов от ${displayMinPrice}₽. 10x15, 15x20, 20x30, 30x40, постеры. Готово за 15 минут. Фотобумага премиум-класса.`,
      
      // Update price
      price: displayMinPrice,
      
      // Update benefits with dynamic price
      heroBenefits: [
        { icon: 'high_quality', text: 'Премиум бумага' },
        { icon: 'schedule', text: 'Готово за 15 минут' },
        { icon: 'savings', text: `от ${displayMinPrice}₽` }
      ],
      
      // Update services with dynamic prices
      services: [
        {
          icon: 'photo',
          title: 'Премиум печать',
          description: 'Высокое качество на профессиональной бумаге',
          price: prices.premium_10x15,
          priceLabel: 'от',
          features: ['10×15 см', '15×20 см', '20×30 см']
        },
        {
          icon: 'star',
          title: 'Супер печать',
          description: 'Экономичный вариант на качественной бумаге',
          price: prices.super_10x15,
          priceLabel: 'от',
          features: ['10×15 см', '15×20 см', '20×30 см']
        }
      ],
      
      // Update FAQ with dynamic prices
      faqs: [
        { 
          question: 'Сколько стоит печать фото 10x15?', 
          answer: `Премиум печать 10×15, ${prices.premium_10x15}₽, Супер печать 10×15, ${prices.super_10x15}₽.` 
        },
        { 
          question: 'Какие форматы фотографий вы печатаете?', 
          answer: `Печатаем все популярные форматы: 10×15 (от ${prices.premium_10x15}₽), 15×20 (от ${prices.premium_15x20}₽), 20×30 (от ${prices.premium_20x30}₽), а также 30×40, постеры и нестандартные размеры.`
        },
        { 
          question: 'Как быстро будут готовы фотографии?', 
          answer: 'Печать стандартных форматов занимает 10-15 минут. Большие тиражи или нестандартные размеры, от 1 часа.'
        },
        { 
          question: 'Можно ли печатать фото с телефона?', 
          answer: 'Да! Отправьте фото в наш Telegram, и мы напечатаем. Готовые фото заберёте в студии.'
        }
      ]
    };
  });
  
  // ngOnInit removed, prices load automatically in PricesService constructor
}
