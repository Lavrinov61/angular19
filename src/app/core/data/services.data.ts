export interface ServiceDoc {
  id: string;
  slug: string;
  title: string;
  description: string;
  image: string;
  icon?: string;
  features?: string[];
  tag?: 'new' | 'popular' | 'sale';
  colorAccent?: string;
  price?: number;
  originalPrice?: number;
  discount?: number;
  // Дополнительные поля для системы бронирования
  basePrice?: number;
  duration?: number; // в минутах
  photosCount?: number;
  isActive?: boolean;
  // Категория услуги для умной логики кнопок
  category?: 'studio' | 'event' | 'service' | 'combined';
  // Категория отображения для фильтрации в UI
  displayCategory?: 'documents' | 'portraits' | 'family' | 'wedding' | 'artistic' | 'events' | 'restoration' | 'retouch' | 'print' | 'technical' | 'makeup' | 'online' | 'business';
}

/**
 * Список всех услуг с посадочными страницами
 * Каждая услуга имеет уникальную страницу и изображение
 */
export const SERVICES: ServiceDoc[] = [
  // ========================================
  // ФОТО НА ДОКУМЕНТЫ (объединённая карточка)
  // ========================================
  {
    id: 'foto-na-document',
    slug: 'foto-na-document',
    title: 'Фото на документы',
    description: 'Фото на документы онлайн от 700₽ или в студии от 700₽. Ручная ретушь художником, несколько дублей на выбор и согласование перед печатью. Фото в паспорт, за которое не стыдно 25 лет.',
    image: 'assets/static/promo/foto-na-pasport.webp',
    icon: 'badge',
    features: ['Паспорт РФ • Загранпаспорт • Виза', 'Грин-Карта • Студенческий билет', 'Готово за 15 минут'],
    tag: 'popular',
    price: 700,
    originalPrice: 900,
    discount: 22,
    category: 'studio',
    displayCategory: 'documents'
  },

  // ========================================
  // ПОРТРЕТНАЯ СЪЁМКА (объединённая карточка)
  // ========================================
  {
    id: 'portretnaya-sjomka',
    slug: 'portretnaya-sjomka',
    title: 'Портретная фотосъёмка',
    description: 'Профессиональная портретная съёмка в студии: деловые портреты, бизнес-фото, фото для резюме и карьерных сайтов. Индивидуальный подход и профессиональная ретушь.',
    image: 'assets/static/promo/portretnaya-sjomka.webp',
    icon: 'face',
    features: ['Бизнес-портрет • Фото для резюме', 'Деловой стиль • Карьерные сайты', 'Готово за 30 минут'],
    tag: 'popular',
    price: 900,
    category: 'studio',
    displayCategory: 'portraits'
  },

  // ========================================
  // ПЕЧАТЬ ФОТОГРАФИЙ
  // ========================================
  {
    id: 'pechat-foto',
    slug: 'pechat-foto',
    title: 'Печать фотографий',
    description: 'Качественная печать на профессиональной фотобумаге. Две линейки: Премиум от 20₽ и Супер от 36₽. Готово за 15 минут.',
    image: 'assets/static/promo/pechat-foto.webp',
    icon: 'print',
    features: ['Премиум бумага', 'Готово за 15 минут', 'От 20₽'],
    price: 20,
    category: 'service',
    displayCategory: 'print'
  },
  {
    id: 'pechat-foto-na-holste',
    slug: 'pechat-foto-na-holste',
    title: 'Печать на холсте',
    description: 'Превратите любимые фотографии в настоящие картины. Печать на художественном холсте с натяжкой на подрамник.',
    image: 'assets/static/promo/pechat-foto-na-holste.webp',
    icon: 'image',
    features: ['Художественный холст', 'На подрамнике', 'Отличный подарок'],
    price: 2200,
    category: 'service',
    displayCategory: 'print'
  },
  {
    id: 'foto-na-pamyatnik',
    slug: 'foto-na-pamyatnik',
    title: 'Фото на памятник',
    description: 'Керамические фотографии для памятников. Высочайшее качество изображения, устойчивость к погодным условиям на десятилетия.',
    image: 'assets/static/promo/foto-na-pamyatnik.webp',
    icon: 'photo_frame',
    features: ['Устойчиво к погоде', 'Служит десятилетия', 'Ретушь включена'],
    price: 1000,
    category: 'service',
    displayCategory: 'print'
  },

  // ========================================
  // ПОЛИГРАФИЯ И ТЕХНИЧЕСКИЕ УСЛУГИ
  // ========================================
  {
    id: 'vizitki',
    slug: 'vizitki',
    title: 'Визитки',
    description: 'Дизайн и печать визитных карточек в Ростове-на-Дону. Быстро, качественно, недорого. Готово за 1-2 дня.',
    image: 'assets/static/promo/vizitki.webp',
    icon: 'badge',
    features: ['Профессиональный дизайн', 'Быстрая печать', 'Разные форматы'],
    price: 600,
    category: 'service',
    displayCategory: 'technical'
  },
  {
    id: 'pechat-dokumentov',
    slug: 'pechat-dokumentov',
    title: 'Печать документов',
    description: 'Быстрая и качественная печать документов с различными параметрами. Черно-белая и цветная печать.',
    image: 'assets/static/promo/pechat-dokumentov.webp',
    icon: 'description',
    features: ['Черно-белая печать', 'Цветная печать', 'Различные форматы'],
    price: 10,
    category: 'service',
    displayCategory: 'technical'
  },
  {
    id: 'pereplet-na-plastikovuyu-pruzhinu',
    slug: 'pereplet-na-plastikovuyu-pruzhinu',
    title: 'Переплёт на пружину',
    description: 'Переплёт документов А4 на пластиковую пружину. Для курсовых, отчётов, методичек и ВКР, если такой вид оформления принимает вуз.',
    image: 'assets/static/education-smart/card-binding.webp',
    icon: 'article',
    features: ['Пластиковая пружина А4', 'Для учебных работ', 'Учебная цена 10 ₽'],
    price: 100,
    category: 'service',
    displayCategory: 'technical'
  },
  {
    id: 'kserokopiya',
    slug: 'kserokopiya',
    title: 'Ксерокопия',
    description: 'Качественное копирование любых типов документов с сохранением деталей. Быстро и недорого.',
    image: 'assets/static/promo/kserokopiya.webp',
    icon: 'content_copy',
    features: ['Быстрое копирование', 'Четкость и контраст', 'Разные форматы'],
    tag: 'sale',
    price: 10,
    category: 'service',
    displayCategory: 'technical'
  },
  {
    id: 'laminirovanie',
    slug: 'laminirovanie',
    title: 'Ламинирование',
    description: 'Защитное ламинирование документов и фотографий. Надёжная защита от влаги и повреждений.',
    image: 'assets/static/promo/laminirovanie.webp',
    icon: 'shield',
    features: ['Защита от влаги', 'Долговечность', 'Разные размеры'],
    price: 100,
    category: 'service',
    displayCategory: 'technical'
  },
  {
    id: 'skanirovanie',
    slug: 'skanirovanie',
    title: 'Сканирование',
    description: 'Профессиональное сканирование документов и фотографий с высоким разрешением. Цифровая архивация.',
    image: 'assets/static/promo/skanirovanie.webp',
    icon: 'scanner',
    features: ['Высокое разрешение', 'Оцифровка документов', 'Архивирование'],
    price: 50,
    category: 'service',
    displayCategory: 'technical'
  },

  // ========================================
  // СУВЕНИРНАЯ ПРОДУКЦИЯ
  // ========================================
  {
    id: 'pechat-na-kruzhkah',
    slug: 'pechat-na-kruzhkah',
    title: 'Печать на кружках',
    description: 'Печать фотографий и изображений на кружках. Отличный подарок для близких. Готово за 1 день.',
    image: 'assets/static/promo/pechat-na-kruzhkah.webp',
    icon: 'local_cafe',
    features: ['Качественная печать', 'Устойчивый рисунок', 'Отличный подарок'],
    price: 390,
    category: 'service',
    displayCategory: 'print'
  },
  {
    id: 'pechat-na-futbolkah',
    slug: 'pechat-na-futbolkah',
    title: 'Печать на футболках',
    description: 'Печать фотографий и дизайнов на футболках. Термоперенос высокого качества. Готово за 1-2 дня.',
    image: 'assets/static/promo/pechat-na-futbolkah.webp',
    icon: 'checkroom',
    features: ['Термоперенос', 'Качественная печать', 'Разные размеры'],
    price: 590,
    category: 'service',
    displayCategory: 'print'
  },
  {
    id: 'pechat-na-podarki',
    slug: 'pechat-na-podarki',
    title: 'Печать на подарках',
    description: 'Печать фотографий на различных подарках: пазлы, магниты, календари и многое другое.',
    image: 'assets/static/promo/pechat-na-podarki.webp',
    icon: 'redeem',
    features: ['Разные форматы', 'Качественная печать', 'Уникальные подарки'],
    price: 300,
    category: 'service',
    displayCategory: 'print'
  },

  // ========================================
  // РЕТУШЬ И РЕСТАВРАЦИЯ
  // ========================================
  {
    id: 'retush',
    slug: 'retush',
    title: 'Ретушь фотографий',
    description: 'Профессиональная ретушь портретов с сохранением естественности. Коррекция кожи, цветокоррекция, улучшение качества.',
    image: 'assets/static/promo/retush.webp',
    icon: 'tune',
    features: ['Естественная ретушь', 'Коррекция кожи', 'Цветокоррекция'],
    tag: 'popular',
    price: 700,
    category: 'service',
    displayCategory: 'retouch'
  },
  {
    id: 'restavratsiya-foto',
    slug: 'restavratsiya-foto',
    title: 'Реставрация фотографий',
    description: 'Профессиональное восстановление старых и повреждённых фотографий. Устранение царапин, восстановление цвета.',
    image: 'assets/static/promo/restavratsiya-foto.webp',
    icon: 'auto_fix_high',
    features: ['Устранение царапин', 'Восстановление цвета', 'Цифровая архивация'],
    tag: 'popular',
    price: 900,
    category: 'service',
    displayCategory: 'restoration'
  },

  // ========================================
  // ОНЛАЙН-УСЛУГИ
  // ========================================
  {
    id: 'neyrofotosessiya',
    slug: 'neyrofotosessiya',
    title: 'Нейрофотосессия',
    description: 'AI создаёт профессиональные фото из вашего селфи. Бизнес, fashion, арт, любой стиль. По всей России.',
    image: 'assets/static/promo/neyrofotosessiya.webp',
    icon: 'auto_awesome',
    features: ['AI-генерация', 'По всей России', 'Результат за 1-2 часа'],
    tag: 'new',
    price: 450,
    category: 'service',
    displayCategory: 'online'
  },
  {
    id: 'restavratsiya-online',
    slug: 'restavratsiya-online',
    title: 'Реставрация фото онлайн',
    description: 'Восстановление старых и повреждённых фотографий удалённо. Царапины, разрывы, выцветание, всё исправим.',
    image: 'assets/static/promo/restavratsiya-online.webp',
    icon: 'healing',
    features: ['Восстановление', 'По всей России', 'Гарантия качества'],
    price: 450,
    category: 'service',
    displayCategory: 'online'
  },
  {
    id: 'retush-online',
    slug: 'retush-online',
    title: 'Ретушь фото онлайн',
    description: 'Профессиональная обработка портретов с сохранением естественности. Без «пластикового» эффекта.',
    image: 'assets/static/promo/retush-online.webp',
    icon: 'brush',
    features: ['Естественная ретушь', 'По всей России', 'От 350₽'],
    price: 350,
    category: 'service',
    displayCategory: 'online'
  },
  {
    id: 'foto-na-documenty-online',
    slug: 'foto-na-documenty-online',
    title: 'Фото на документы онлайн',
    description: 'Отправьте селфи, получите фото на документы с ручной ретушью. По всей России, результат от 1 часа.',
    image: 'assets/static/services/foto-na-document.webp',
    icon: 'cloud_upload',
    features: ['По всей России', 'Ручная ретушь', 'От 700₽'],
    tag: 'popular',
    price: 700,
    category: 'service',
    displayCategory: 'online'
  },
  {
    id: 'voennaya-retush',
    slug: 'voennaya-retush',
    title: 'Военная ретушь',
    description: 'Подставим военную форму, звание, знаки и медали по обычному фото. Ручная ретушь с уточнением деталей до оплаты.',
    image: 'assets/static/promo/retush-online.webp',
    icon: 'military_tech',
    features: ['Ручная работа', 'Форма и медали', 'Согласование'],
    price: 990,
    category: 'service',
    displayCategory: 'online'
  },

  // ========================================
  // ДЛЯ БИЗНЕСА / МАРКЕТПЛЕЙСЫ
  // ========================================
  {
    id: 'tovarnaya-sjomka',
    slug: 'tovarnaya-sjomka',
    title: 'Товарная съёмка',
    description: 'Профессиональная товарная съёмка для маркетплейсов. Белый фон, стандарты WB/Ozon, результат в тот же день. Карточка выглядит продающе.',
    image: 'assets/static/services/infographics-marketplace.webp',
    icon: 'camera_alt',
    features: ['Стандарты WB и Ozon', 'Результат в тот же день', 'От 400₽ за товар'],
    tag: 'new',
    price: 400,
    category: 'service',
    displayCategory: 'business'
  },
  {
    id: 'infografika-kartochek',
    slug: 'infografika-kartochek',
    title: 'Инфографика карточек',
    description: 'Дизайн инфографики для карточек Wildberries и Ozon. Конвертирующие слайды, фирменный стиль, готово за 1-2 дня.',
    image: 'assets/static/services/infographics-marketplace.webp',
    icon: 'design_services',
    features: ['Стандарты WB и Ozon', '2 раунда правок', 'От 600₽ за слайд'],
    price: 600,
    category: 'service',
    displayCategory: 'business'
  },
  {
    id: 'smm-content',
    slug: 'smm-content',
    title: 'SMM-контент',
    description: 'Reels, сторис и карусели для Instagram, ВКонтакте, Telegram. Снимаем в студии с профессиональным светом. Весь пакет за один день.',
    image: 'assets/static/services/social-media-design.webp',
    icon: 'videocam',
    features: ['Reels + сторис + карусели', 'Студийный свет', 'От 2 500₽'],
    price: 2500,
    category: 'service',
    displayCategory: 'business'
  },
  {
    id: 'super-paket-prodayushiy',
    slug: 'super-paket-prodayushiy',
    title: 'Супер-пакет «Продающий»',
    description: 'Полный комплект визуального контента: товарные фото + инфографика + SMM. Один партнёр, один договор, один день съёмки. Экономия 30%.',
    image: 'assets/static/services/corporate-photo.webp',
    icon: 'star',
    features: ['Фото + инфографика + видео', 'Экономия 30%', 'От 18 000₽'],
    tag: 'popular',
    price: 18000,
    category: 'service',
    displayCategory: 'business'
  }
];

export const SERVICES_SECTION_TITLE = 'Наши услуги';
