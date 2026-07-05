/**
 * LandingPricesService — обогащает LandingPageData реальными ценами из PricingApiService.
 *
 * Маппинг: landing slug → pricing category slug + опциональный option slug.
 * При загрузке из API подставляет реальные price/urgentPrice и обновляет specifications.
 */

import { Injectable, inject, signal } from '@angular/core';
import { PricingApiService, PricingCategory, PricingServiceOption } from './pricing-api.service';
import { LandingPageData, Specification, RelatedService } from '../../features/services/landing-pages/landing-page.interface';
import { ServiceDoc } from '../data/services.data';

// ============================================================================
// Маппинг landing slug → pricing engine
// ============================================================================

interface PricingMapping {
  /** slug категории в pricing engine */
  categorySlug: string;
  /**
   * Как извлечь "главную" цену для hero-секции:
   * - 'min-online'  → минимальная price_online из required groups
   * - 'min-studio'  → минимальная price_studio из required groups
   * - 'min-base'    → минимальная base_price из required groups
   * - 'option:slug' → цена конкретной опции
   */
  priceStrategy: string;
  /** Стратегия для urgentPrice (если есть) */
  urgentPriceStrategy?: string;
  /** Маппинг spec label → option slug для автообновления specifications */
  specMappings?: Record<string, string>;
}

/**
 * Полный маппинг: ключ = slug лендинга, значение = как достать цену
 */
const LANDING_PRICE_MAP: Record<string, PricingMapping> = {
  // ── Фото на документы ──
  'foto-na-pasport': {
    categorySlug: 'photo-docs',
    priceStrategy: 'option:processing-basic', // online processing от 700₽
    urgentPriceStrategy: 'option:passport-rf', // в студии 700₽
  },
  'foto-na-zagran': {
    categorySlug: 'photo-docs',
    priceStrategy: 'option:processing-basic',
    urgentPriceStrategy: 'option:passport-zagran',
  },
  'foto-na-vizu': {
    categorySlug: 'photo-docs',
    priceStrategy: 'option:processing-basic',
    urgentPriceStrategy: 'option:photo-visa',
  },
  'foto-na-green-card': {
    categorySlug: 'photo-docs',
    priceStrategy: 'option:processing-extended', // online 950₽
    urgentPriceStrategy: 'option:photo-greencard', // студия 900₽
  },
  'foto-na-studencheskiy': {
    categorySlug: 'photo-docs',
    priceStrategy: 'option:processing-basic',
    urgentPriceStrategy: 'option:photo-student',
  },

  // ── Печать фотографий ──
  'pechat-foto': {
    categorySlug: 'photo-print',
    priceStrategy: 'min-base',
    specMappings: {
      '10x15 Премиум': '10x15-premium',
      '10x15 Супер': '10x15-super',
      '15x20 Премиум': '15x20-premium',
      '15x20 Супер': '15x20-super',
      '20x30 Премиум': '20x30-premium',
      '20x30 Супер': '20x30-super',
      '30x40': '30x40',
    },
  },
  'pechat-foto-10x15': {
    categorySlug: 'photo-print',
    priceStrategy: 'option:10x15-premium',
    specMappings: {
      'Премиум': '10x15-premium',
      'Супер': '10x15-super',
    },
  },
  'pechat-foto-na-holste': {
    categorySlug: 'frames-souvenirs',
    priceStrategy: 'option:km-печать-на-холсте-30x40',
    specMappings: {
      '30x40': 'km-печать-на-холсте-30x40',
      '50x70': 'km-печать-на-холсте-50x70',
      '70x100': 'km-печать-на-холсте-70x100',
    },
  },
  'foto-na-pamyatnik': {
    categorySlug: 'studio-special',
    priceStrategy: 'option:memorial-photo',
  },

  // ── Ретушь и реставрация ──
  'retush': {
    categorySlug: 'retouch',
    priceStrategy: 'option:studio-retouch-basic',
  },
  'retush-online': {
    categorySlug: 'retouch',
    priceStrategy: 'option:portfolio-retouch',
  },
  'restavratsiya-foto': {
    categorySlug: 'restoration',
    priceStrategy: 'option:km-реставрация-фото-простая',
  },
  'restavratsiya-online': {
    categorySlug: 'photo-restore',
    priceStrategy: 'option:restore-simple',
  },

  // ── Печать и полиграфия ──
  'pechat-dokumentov': {
    categorySlug: 'copy-print',
    priceStrategy: 'option:km-а4-печать-документа',
  },
  'pereplet-na-plastikovuyu-pruzhinu': {
    categorySlug: 'copy-print',
    priceStrategy: 'option:binding-spring-a4',
  },
  'kserokopiya': {
    categorySlug: 'copy-print',
    priceStrategy: 'option:km-а4-ксерокопия',
  },
  'laminirovanie': {
    categorySlug: 'scan-services',
    priceStrategy: 'option:lamination',
  },
  'skanirovanie': {
    categorySlug: 'scan-services',
    priceStrategy: 'option:scan-manual',
  },
  'vizitki': {
    categorySlug: 'polygraphy',
    priceStrategy: 'option:км-визитки-бумага-100-шт',
  },

  // ── Сувенирная продукция ──
  'pechat-na-kruzhkah': {
    categorySlug: 'souvenirs',
    priceStrategy: 'option:mug-print',
  },
  'pechat-na-futbolkah': {
    categorySlug: 'frames-souvenirs',
    priceStrategy: 'option:tshirt-print',
  },

  // ── Онлайн-услуги ──
  'neyrofotosessiya': {
    categorySlug: 'neuro-photo',
    priceStrategy: 'option:neuro-mini',
  },
  'voennaya-retush': {
    categorySlug: 'voennaya-retush',
    priceStrategy: 'min-base',
  },

  // ── Портретная съёмка ──
  'portretnaya-sjomka': {
    categorySlug: 'studio-special',
    priceStrategy: 'option:portrait-photo',
  },

  // ── Маркетплейсы ──
  'tovarnaya-sjomka': {
    categorySlug: 'marketplace-photo',
    priceStrategy: 'option:360-photo',
  },
  'infografika-kartochek': {
    categorySlug: 'infographics',
    priceStrategy: 'option:single-card',
  },
  'smm-content': {
    categorySlug: 'smm-content',
    priceStrategy: 'option:single-reels',
  },
  'super-paket-prodayushiy': {
    categorySlug: 'selling-pack',
    priceStrategy: 'option:selling-standard',
  },

  // ── ServiceDoc карточки (дополнительные, не покрытые выше) ──
  'foto-na-document': {
    categorySlug: 'photo-docs',
    priceStrategy: 'option:processing-basic',
  },
  'foto-na-documenty-online': {
    categorySlug: 'photo-docs',
    priceStrategy: 'option:processing-basic',
  },
  'pechat-na-podarki': {
    categorySlug: 'souvenirs',
    priceStrategy: 'option:polaroid',
  },
};

// ============================================================================
// Сервис
// ============================================================================

@Injectable({ providedIn: 'root' })
export class LandingPricesService {
  private readonly pricingApi = inject(PricingApiService);

  private readonly _ready = signal(false);
  readonly ready = this._ready.asReadonly();

  /** Инициализировать загрузку каталога (idempotent) */
  init(): void {
    this.pricingApi.loadCategories();
    // Подписываемся на загрузку через computed effect-like check
    const checkReady = () => {
      if (this.pricingApi.categories().length > 0) {
        this._ready.set(true);
      }
    };
    // Первоначальная проверка
    checkReady();
    // Если ещё не готово — запланируем повторную проверку через 100ms
    if (!this._ready()) {
      const interval = setInterval(() => {
        checkReady();
        if (this._ready()) clearInterval(interval);
      }, 100);
      // Safety: не более 10 секунд
      setTimeout(() => clearInterval(interval), 10_000);
    }
  }

  /**
   * Получить реальную цену для лендинга по slug.
   * Возвращает null, если маппинг не найден или каталог ещё не загружен.
   */
  getPrice(landingSlug: string): number | null {
    const mapping = LANDING_PRICE_MAP[landingSlug];
    if (!mapping) return null;
    return this.resolvePrice(mapping.categorySlug, mapping.priceStrategy);
  }

  /**
   * Получить urgentPrice для лендинга.
   */
  getUrgentPrice(landingSlug: string): number | null {
    const mapping = LANDING_PRICE_MAP[landingSlug];
    if (!mapping?.urgentPriceStrategy) return null;
    return this.resolvePrice(mapping.categorySlug, mapping.urgentPriceStrategy);
  }

  /**
   * Обогатить LandingPageData реальными ценами.
   * Возвращает новый объект (не мутирует оригинал).
   */
  enrichLandingData(data: LandingPageData): LandingPageData {
    const mapping = LANDING_PRICE_MAP[data.slug];
    if (!mapping || this.pricingApi.categories().length === 0) {
      return data;
    }

    const price = this.resolvePrice(mapping.categorySlug, mapping.priceStrategy);
    const urgentPrice = mapping.urgentPriceStrategy
      ? this.resolvePrice(mapping.categorySlug, mapping.urgentPriceStrategy)
      : null;

    // Обновить specifications с ценами
    let specifications = data.specifications;
    if (mapping.specMappings) {
      specifications = this.enrichSpecifications(
        data.specifications,
        mapping.categorySlug,
        mapping.specMappings,
      );
    }

    // Обновить relatedServices цены
    const relatedServices = this.enrichRelatedServices(data.relatedServices);

    return {
      ...data,
      price: price ?? data.price,
      urgentPrice: urgentPrice ?? data.urgentPrice,
      specifications,
      relatedServices,
    };
  }

  /**
   * Обогатить массив ServiceDoc (карточки на /services) реальными ценами.
   */
  enrichServiceCards(services: ServiceDoc[]): ServiceDoc[] {
    if (this.pricingApi.categories().length === 0) return services;
    return services.map(svc => {
      const price = this.getPrice(svc.slug);
      if (price == null) return svc;
      return { ...svc, price: Math.ceil(price) };
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private resolvePrice(categorySlug: string, strategy: string): number | null {
    const category = this.pricingApi.getCategoryBySlug(categorySlug);
    if (!category) return null;

    if (strategy === 'min-online') {
      return this.pricingApi.getMinOnlinePrice(categorySlug);
    }
    if (strategy === 'min-studio') {
      return this.pricingApi.getMinStudioPrice(categorySlug);
    }
    if (strategy === 'min-base') {
      return this.getMinBasePrice(category);
    }
    if (strategy.startsWith('option:')) {
      const optionSlug = strategy.substring(7);
      const option = this.findOption(category, optionSlug);
      if (!option) return null;
      // Предпочитаем online > studio > base
      return option.price_online ?? option.price_studio ?? option.base_price;
    }
    return null;
  }

  private getMinBasePrice(category: PricingCategory): number | null {
    const prices: number[] = [];
    for (const group of category.optionGroups) {
      for (const opt of group.options) {
        if (opt.base_price > 0) prices.push(opt.base_price);
      }
    }
    return prices.length ? Math.min(...prices) : null;
  }

  private findOption(category: PricingCategory, slug: string): PricingServiceOption | null {
    for (const group of category.optionGroups) {
      const opt = group.options.find(o => o.slug === slug);
      if (opt) return opt;
    }
    return null;
  }

  private enrichSpecifications(
    specs: Specification[],
    categorySlug: string,
    specMappings: Record<string, string>,
  ): Specification[] {
    const category = this.pricingApi.getCategoryBySlug(categorySlug);
    if (!category) return specs;

    return specs.map(spec => {
      const optionSlug = specMappings[spec.label];
      if (!optionSlug) return spec;

      const option = this.findOption(category, optionSlug);
      if (!option) return spec;

      const price = option.price_studio ?? option.base_price;
      return { ...spec, value: `${this.formatPrice(price)}₽` };
    });
  }

  private enrichRelatedServices(services: RelatedService[]): RelatedService[] {
    return services.map(svc => {
      // Извлечь slug из URL (e.g. '/foto-na-pasport' → 'foto-na-pasport')
      const slug = svc.url.replace(/^\//, '');
      const price = this.getPrice(slug);
      if (price == null) return svc;
      return { ...svc, price: Math.ceil(price) };
    });
  }

  private formatPrice(price: number): string {
    // Целое число — без дробной части, иначе округляем
    return price % 1 === 0 ? String(price) : String(Math.ceil(price));
  }
}
