/**
 * Интерфейсы для структуры услуг
 */

export interface ServiceOption {
  id: string;
  name: string;
  description: string;
  price: number;
  priceMax?: number;
  oldPrice?: number;
  /** Цена за 2-й и последующий экземпляры (если отличается от price) */
  nextPrice?: number;
  icon: string;
  popular?: boolean;
  features?: string[];
  image?: string; // Пример работы для услуги
}

export interface ServiceCategory {
  id: string;
  name: string;
  icon: string;
  description: string;
  priceRange: string;
  services: ServiceOption[];
}

/**
 * Онлайн-услуги (только те, которые можно выполнить удалённо)
 */
export const SERVICE_CATEGORIES: ServiceCategory[] = [
  // ========== 1. ФОТО НА ДОКУМЕНТЫ ==========
  {
    id: 'photo-docs',
    name: 'Фото на документы',
    icon: 'badge',
    description: 'Красивые фото из вашего селфи',
    priceRange: 'от 700₽',
    services: [
      {
        id: 'basic',
        name: 'Базовая обработка',
        description: 'Замена фона, обрезка, формат под документ',
        price: 700,
        icon: 'photo_camera',
        features: ['Замена фона', 'Обрезка и формат', '1 комплект'],
      },
      {
        id: 'retouch',
        name: 'Расширенная обработка',
        description: 'Профессиональная обработка кожи и волос',
        price: 950,
        icon: 'auto_fix_high',
        popular: true,
        features: ['Ручная ретушь', 'Замена фона', '1 комплект'],
      },
      {
        id: 'vip',
        name: 'Максимальная обработка',
        description: 'Премиальная ручная обработка с бесплатными правками',
        price: 1400,
        icon: 'bolt',
        features: ['4 варианта обработки', 'Приоритет', 'Премиум-качество'],
      },
      {
        id: 'vip-all-docs',
        name: 'VIP «Все документы»',
        description: '4 комплекта на любые документы',
        price: 2490,
        oldPrice: 3500,
        icon: 'folder_copy',
        features: ['4 комплекта', 'Все форматы', 'Премиальная ретушь'],
      },
    ],
  },

  // ========== 2. НЕЙРОФОТОСЕССИЯ ==========
  {
    id: 'neuro',
    name: 'Нейрофотосессия',
    icon: 'psychology',
    description: 'AI-генерация уникальных образов',
    priceRange: '450-3000₽',
    services: [
      {
        id: 'neuro-mini',
        name: 'Минимальный пакет',
        description: '1 фото, 1 образ',
        price: 450,
        icon: 'photo',
        features: ['1 фото', '1 образ'],
      },
      {
        id: 'neuro-standard',
        name: 'Стандарт',
        description: '4 фото, 1 образ, популярный выбор',
        price: 990,
        icon: 'collections',
        popular: true,
        features: ['4 фото', '1 образ'],
      },
      {
        id: 'neuro-full',
        name: 'Полный пакет',
        description: '10-15 фото, 2-3 образа',
        price: 3000,
        icon: 'auto_awesome',
        features: ['10-15 фото', '2-3 образа', 'Премиум'],
      },
    ],
  },

  // ========== 3. РЕСТАВРАЦИЯ ФОТО ==========
  {
    id: 'restore',
    name: 'Реставрация фотографий',
    icon: 'history',
    description: 'Восстановление старых снимков',
    priceRange: '450-1800₽',
    services: [
      {
        id: 'restore-simple',
        name: 'Простая реставрация',
        description: 'Удаление царапин и пятен',
        price: 450,
        icon: 'healing',
        features: ['Удаление дефектов'],
      },
      {
        id: 'restore-medium',
        name: 'Средняя сложность',
        description: 'Восстановление цвета и деталей',
        price: 900,
        icon: 'auto_fix_high',
        popular: true,
        features: ['Восстановление цвета', 'Детализация'],
      },
      {
        id: 'restore-complex',
        name: 'Сложная реставрация',
        description: 'Полная реконструкция повреждённых участков',
        price: 1800,
        icon: 'construction',
        features: ['Реконструкция', 'Любые повреждения'],
      },
    ],
  },

  // ========== 4. ИНФОГРАФИКА ДЛЯ МАРКЕТПЛЕЙСОВ ==========
  {
    id: 'infographics',
    name: 'Инфографика для маркетплейсов',
    icon: 'analytics',
    description: 'Карточки товаров для WB и Ozon',
    priceRange: '500-20 000₽',
    services: [
      {
        id: 'info-slide',
        name: 'Дополнительный слайд',
        description: 'Один слайд карточки',
        price: 500,
        priceMax: 800,
        icon: 'slideshow',
      },
      {
        id: 'info-main',
        name: 'Главный слайд (обложка)',
        description: 'Продающая обложка карточки',
        price: 1000,
        priceMax: 1500,
        icon: 'image',
        popular: true,
        features: ['Продающий дизайн'],
      },
      {
        id: 'info-card',
        name: 'Полная карточка (5-7 слайдов)',
        description: 'Готовая карточка под ключ',
        price: 3000,
        priceMax: 5000,
        icon: 'view_carousel',
        features: ['5-7 слайдов', 'Под ключ'],
      },
      {
        id: 'info-pack5',
        name: 'Пакет 5 карточек',
        description: 'Выгодное решение для селлеров',
        price: 12000,
        priceMax: 20000,
        icon: 'inventory_2',
        features: ['5 карточек', 'Скидка 20%'],
      },
      {
        id: 'info-combo',
        name: 'Комбо: Фото + Инфографика',
        description: 'Фото (5 шт.) + инфографика (5 слайдов)',
        price: 4000,
        priceMax: 6000,
        icon: 'stars',
        features: ['5 фото', '5 слайдов', 'За артикул'],
      },
    ],
  },

  // ========== 5. ОФОРМЛЕНИЕ СОЦСЕТЕЙ ==========
  {
    id: 'social',
    name: 'Оформление соцсетей',
    icon: 'share',
    description: 'Дизайн для ВК, Instagram, YouTube',
    priceRange: '5000-20 000₽',
    services: [
      {
        id: 'vk-basic',
        name: 'ВКонтакте: Базовое',
        description: 'Обложка и аватар',
        price: 5000,
        priceMax: 6000,
        icon: 'groups',
        features: ['Обложка', 'Аватар'],
      },
      {
        id: 'vk-full',
        name: 'ВКонтакте: Полное',
        description: 'Обложка, меню, шаблоны постов',
        price: 10000,
        priceMax: 15000,
        icon: 'groups',
        popular: true,
        features: ['Обложка', 'Меню', 'Шаблоны'],
      },
      {
        id: 'instagram',
        name: 'Instagram комплект',
        description: 'Посты, сторис, хайлайтс',
        price: 15000,
        priceMax: 20000,
        icon: 'photo_library',
        features: ['Посты', 'Сторис', 'Хайлайтс'],
      },
      {
        id: 'youtube',
        name: 'YouTube/RuTube оформление',
        description: 'Баннер, аватар, заставки',
        price: 8000,
        priceMax: 10000,
        icon: 'smart_display',
        features: ['Баннер', 'Аватар', 'Заставки'],
      },
    ],
  },

  // ========== 6. ПОЛИГРАФИЯ (ДИЗАЙН МАКЕТОВ) ==========
  {
    id: 'polygraphy',
    name: 'Дизайн полиграфии',
    icon: 'print',
    description: 'Макеты визиток, флаеров, буклетов',
    priceRange: '1500-15 000₽',
    services: [
      {
        id: 'business-card',
        name: 'Визитка',
        description: 'Дизайн визитной карточки',
        price: 1500,
        priceMax: 3000,
        icon: 'badge',
        popular: true,
        features: ['2 стороны', 'Готово к печати'],
        image: 'assets/static/services/vizitki-design.webp',
      },
      {
        id: 'flyer',
        name: 'Листовка / Флаер',
        description: 'Рекламный макет А5/А6',
        price: 2000,
        priceMax: 4000,
        icon: 'description',
        features: ['А5/А6', 'Печатный макет'],
        image: 'assets/static/services/flyer-design.webp',
      },
      {
        id: 'booklet',
        name: 'Буклет',
        description: 'Буклет 2-3 сгиба',
        price: 4000,
        priceMax: 8000,
        icon: 'menu_book',
        features: ['2-3 сгиба', 'Под ключ'],
        image: 'assets/static/services/booklet-design.webp',
      },
      {
        id: 'menu',
        name: 'Меню для кафе',
        description: 'Дизайн меню для ресторана/кафе',
        price: 5000,
        priceMax: 15000,
        icon: 'restaurant_menu',
        features: ['Любой формат', 'Фотосъёмка блюд'],
        image: 'assets/static/services/menu-design.webp',
      },
      {
        id: 'pricelist',
        name: 'Прайс-лист',
        description: 'Оформленный прайс-лист',
        price: 3000,
        priceMax: 6000,
        icon: 'receipt_long',
        features: ['Готово к печати'],
        image: 'assets/static/promo/pechat-dokumentov.webp',
      },
    ],
  },

  // ========== 7. ВЕКТОРИЗАЦИЯ ==========
  {
    id: 'vectorization',
    name: 'Векторизация',
    icon: 'gesture',
    description: 'Перевод в вектор, иконки',
    priceRange: '1000-10 000₽',
    services: [
      {
        id: 'vector-logo',
        name: 'Перевод логотипа в вектор',
        description: 'Векторизация растрового лого',
        price: 1000,
        priceMax: 2500,
        icon: 'transform',
      },
      {
        id: 'vector-complex',
        name: 'Векторизация сложного изображения',
        description: 'Детальная отрисовка',
        price: 2000,
        priceMax: 5000,
        icon: 'gesture',
      },
      {
        id: 'icons',
        name: 'Иконки (набор 10 шт.)',
        description: 'Уникальные иконки',
        price: 3000,
        priceMax: 6000,
        icon: 'grid_view',
        popular: true,
      },
      {
        id: 'illustration',
        name: 'Иллюстрация / Персонаж',
        description: 'Уникальная иллюстрация или персонаж',
        price: 3000,
        priceMax: 10000,
        icon: 'brush',
        features: ['Авторский стиль'],
      },
    ],
  },
];

/**
 * Пакеты "под ключ" (только онлайн-услуги)
 */
export const SERVICE_PACKAGES: ServiceOption[] = [
  {
    id: 'pack-startup',
    name: 'Старт для бизнеса',
    description: 'Логотип + визитка + фирменный бланк (дизайн)',
    price: 25000,
    icon: 'rocket_launch',
    popular: true,
    features: ['Логотип', 'Визитка', 'Бланк', 'Скидка 20%'],
  },
  {
    id: 'pack-seller',
    name: 'Селлер для маркетплейсов',
    description: 'Инфографика 5 карточек (25 слайдов) под ключ',
    price: 12000,
    priceMax: 20000,
    icon: 'storefront',
    popular: true,
    features: ['5 карточек', '25 слайдов', 'Под ключ'],
  },
  {
    id: 'pack-documents',
    name: 'Фото на все документы',
    description: 'Паспорт + загран + виза + водительское, 4 комплекта',
    price: 1050,
    oldPrice: 1600,
    icon: 'folder_copy',
    features: ['4 комплекта', 'Все форматы', 'Обработка'],
  },
];

/**
 * Тарифные планы (подписки)
 */
/** Subscription plan item, product included in plan */
export interface SubscriptionPlanItem {
  product_id: string;
  product_name: string;
  product_price: number;
  included_quantity: number;
}

/** Subscription plan, unified type matching DB schema */
export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string;
  base_price: number;
  billing_period: string;
  features: string[];
  icon: string;
  is_popular: boolean;
  savings_label: string | null;
  category: string;
  subscriber_discount_percent: number;
  credits_rollover_months: number;
  items: SubscriptionPlanItem[];
}

/** @deprecated Use API /api/subscriptions/plans?category=smm instead */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [];

/**
 * Получить категорию по ID
 */
export function getCategoryById(id: string): ServiceCategory | undefined {
  return SERVICE_CATEGORIES.find(c => c.id === id);
}
