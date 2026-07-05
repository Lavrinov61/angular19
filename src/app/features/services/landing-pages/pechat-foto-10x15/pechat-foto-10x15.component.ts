import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { BaseLandingComponent } from '../base-landing/base-landing.component';
import { PECHAT_FOTO_10X15 } from '../data/photo-print.data';
import { PricesService } from '../../../../core/services/prices.service';
import { LandingPageData } from '../landing-page.interface';

@Component({
  selector: 'app-pechat-foto-10x15',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BaseLandingComponent],
  template: `<app-base-landing [data]="pageData()" />`,
})
export class PechatFoto10x15Component {
  private pricesService = inject(PricesService);
  
  // Base data from static file
  private baseData = PECHAT_FOTO_10X15;
  
  // Reactive page data with dynamic prices
  pageData = computed<LandingPageData>(() => {
    const prices = this.pricesService.prices();
    const superPrice = prices.super_10x15;
    
    return {
      ...this.baseData,
      // Update meta with dynamic price
      metaTitle: `Печать фото 10x15 в Ростове-на-Дону | ${superPrice}₽ | Своё Фото`,
      metaDescription: `Печать фотографий 10x15 за ${superPrice}₽. Классический формат для альбомов. Готово за 10 минут. Премиум фотобумага.`,
      
      // Update price
      price: superPrice,
      
      // Update benefits with dynamic price
      heroBenefits: [
        { icon: 'photo_album', text: 'Для альбомов' },
        { icon: 'schedule', text: 'За 10 минут' },
        { icon: 'savings', text: `${superPrice}₽` }
      ],
      
      // Update FAQ with dynamic prices
      faqs: [
        { 
          question: 'Сколько стоит печать фото 10x15?', 
          answer: `Супер печать 10×15, ${superPrice}₽, Премиум печать 10×15, ${prices.premium_10x15}₽.` 
        },
        { 
          question: 'Какое качество печати?', 
          answer: 'Мы используем профессиональное оборудование и качественную фотобумагу. Результат порадует вас!'
        },
        { 
          question: 'Как быстро будут готовы фото?', 
          answer: 'Печать 10×15 занимает всего 10-15 минут.'
        }
      ]
    };
  });
}
