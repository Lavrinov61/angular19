import { LandingPageData, ProcessStep, Advantage } from '../landing-page.interface';

/**
 * Общие данные для страниц печати фотографий
 */

const PRINT_PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Загрузка фотографий',
    description: 'Принесите файлы на флешке или отправьте через мессенджер',
    icon: 'cloud_upload',
    details: ['Любой формат файлов', 'С телефона или камеры', 'Из соцсетей']
  },
  {
    number: 2,
    title: 'Консультация',
    description: 'Поможем выбрать размер и тип бумаги',
    icon: 'support_agent',
    details: ['Подбор формата', 'Выбор бумаги', 'Рекомендации']
  },
  {
    number: 3,
    title: 'Обработка',
    description: 'При необходимости корректируем яркость и цвета',
    icon: 'tune',
    details: ['Коррекция цвета', 'Кадрирование', 'Улучшение качества']
  },
  {
    number: 4,
    title: 'Печать',
    description: 'Печатаем на профессиональном оборудовании',
    icon: 'print',
    details: ['Точная цветопередача', 'Высокое разрешение', 'Качественные чернила']
  },
  {
    number: 5,
    title: 'Проверка качества',
    description: 'Проверяем каждую фотографию перед выдачей',
    icon: 'verified',
    details: ['Контроль цвета', 'Проверка резкости', 'Отсутствие дефектов']
  },
  {
    number: 6,
    title: 'Готово!',
    description: 'Забирайте ваши фотографии',
    icon: 'celebration',
    details: ['Быстрая выдача', 'Упаковка', 'Рекомендации по хранению']
  }
];

const PRINT_ADVANTAGES: Advantage[] = [
  {
    icon: 'high_quality',
    title: 'Профессиональное оборудование',
    description: 'Печать на оборудовании высокого класса'
  },
  {
    icon: 'palette',
    title: 'Точная цветопередача',
    description: 'Калиброванные мониторы и принтеры'
  },
  {
    icon: 'schedule',
    title: 'Быстро',
    description: 'Большинство заказов готово за 15-30 минут'
  },
  {
    icon: 'inventory_2',
    title: 'Разные форматы',
    description: 'От 10x15 до больших постеров'
  },
  {
    icon: 'eco',
    title: 'Качественная бумага',
    description: 'Фотобумага премиум-класса'
  },
  {
    icon: 'thumb_up',
    title: 'Гарантия качества',
    description: 'Перепечатаем бесплатно, если не понравится'
  }
];

const PRINT_PHOTO_SAMPLES = [
  { src: '/assets/static/services/print-sample-1.webp', alt: 'Печать фотографий - образец 1', description: 'Печать 10x15' },
  { src: '/assets/static/services/print-sample-2.webp', alt: 'Печать фотографий - образец 2', description: 'Печать 15x20' },
  { src: '/assets/static/services/print-sample-3.webp', alt: 'Печать фотографий - образец 3', description: 'Постер 30x40' },
  { src: '/assets/static/services/print-sample-4.webp', alt: 'Печать фотографий - образец 4', description: 'Фотохолст' }
];

/**
 * Печать фотографий (общая страница)
 */
export const PECHAT_FOTO: LandingPageData = {
  slug: 'pechat-foto',
  title: 'Печать фотографий',
  metaTitle: 'Печать фотографий в Ростове-на-Дону | от 20₽ | Своё Фото',
  metaDescription: 'Качественная печать фотографий любых форматов от 20₽. Премиум от 20₽, Супер от 36₽. 10x15, 15x20, 20x30, 30x40. Готово за 15 минут.',
  canonicalUrl: '/pechat-foto',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать фотографий',
  heroSubtitle: 'Качественная печать на профессиональной фотобумаге. Две линейки: Премиум от 20₽ и Супер от 36₽. Готово за 15 минут.',
  heroBenefits: [
    { icon: 'high_quality', text: 'Премиум бумага' },
    { icon: 'schedule', text: 'Готово за 15 минут' },
    { icon: 'savings', text: 'От 20₽' }
  ],
  heroCtaText: 'Заказать печать',
  heroImage: '/assets/static/promo/pechat-foto.webp',
  
  price: 20,
  priceLabel: 'Премиум 10x15',
  
  serviceType: 'Печать фотографий',
  specifications: [
    { label: '10x15 Премиум', value: '20₽' },
    { label: '10x15 Супер', value: '36₽' },
    { label: '15x20 Премиум', value: '49₽' },
    { label: '15x20 Супер', value: '70₽' },
    { label: '20x30 Премиум', value: '117₽' },
    { label: '20x30 Супер', value: '140₽' },
    { label: '30x40', value: '450₽' }
  ],
  requirements: [
    'Файлы JPG, PNG, TIFF',
    'Разрешение от 300 dpi для качественной печати',
    'Соотношение сторон 2:3 или 3:4',
    'Флешка, телефон или облако',
    'Минимальный заказ, 1 фото'
  ],
  
  photoSamples: PRINT_PHOTO_SAMPLES,
  galleryTitle: 'Примеры печати',
  
  processSteps: PRINT_PROCESS_STEPS,
  processTitle: 'Как это работает',
  
  advantages: PRINT_ADVANTAGES,
  advantagesTitle: 'Почему выбирают нас',
  advantagesSubtitle: 'Качественная печать фотографий',
  
  faqItems: [
    {
      question: 'На какой бумаге печатаете?',
      answer: 'Мы используем профессиональную фотобумагу премиум-класса. Есть глянцевая и матовая на выбор.'
    },
    {
      question: 'Можно ли печатать с телефона?',
      answer: 'Да! Можете отправить фото через Telegram, МАКС или принести на флешке.'
    },
    {
      question: 'Сколько ждать готовый заказ?',
      answer: 'Небольшие заказы (до 50 фото) готовы за 15-30 минут. Крупные заказы, в тот же день.'
    },
    {
      question: 'Делаете ли коррекцию фото?',
      answer: 'Да, бесплатно корректируем яркость и контраст. Сложная ретушь, отдельная услуга.'
    }
  ],
  
  relatedServices: [
    { title: 'Печать 10x15 Супер', url: '/pechat-foto-10x15', price: 36, icon: 'photo' },
    { title: 'Печать на холсте', url: '/pechat-foto-na-holste', price: 2200, icon: 'image' },
    { title: 'Ретушь фото', url: '/retush', price: 700, icon: 'brush' }
  ],

  schemaType: 'PrintService'
};

/**
 * Печать 10x15
 */
export const PECHAT_FOTO_10X15: LandingPageData = {
  slug: 'pechat-foto-10x15',
  title: 'Печать фото 10x15',
  metaTitle: 'Печать фото 10x15 в Ростове-на-Дону | от 20₽ | Своё Фото',
  metaDescription: 'Печать фотографий 10x15 от 20₽. Премиум, 20₽, Супер, 36₽. Классический формат для альбомов. Готово за 10 минут.',
  canonicalUrl: '/pechat-foto-10x15',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать фото 10x15',
  heroSubtitle: 'Классический формат для фотоальбомов и рамок. Премиум, 20₽, Супер, 36₽. Печать за 10 минут.',
  heroBenefits: [
    { icon: 'photo_album', text: 'Для альбомов' },
    { icon: 'schedule', text: 'За 10 минут' },
    { icon: 'savings', text: 'От 20₽' }
  ],
  heroCtaText: 'Заказать печать',
  heroImage: '/assets/static/promo/pechat-foto-10x15.webp',
  
  price: 20,
  priceLabel: 'Премиум 10x15',
  
  serviceType: 'Печать фото 10x15',
  specifications: [
    { label: 'Размер', value: '10×15 см' },
    { label: 'Премиум', value: '20₽' },
    { label: 'Супер', value: '36₽' },
    { label: 'Время', value: '10 минут' }
  ],
  requirements: [
    'Формат JPG, PNG',
    'Разрешение от 1800x1200 px',
    'Соотношение сторон 3:2',
    'Без рамок и полей для максимального качества'
  ],
  
  photoSamples: PRINT_PHOTO_SAMPLES,
  galleryTitle: 'Примеры печати',
  
  processSteps: PRINT_PROCESS_STEPS,
  processTitle: 'Как это работает',
  
  advantages: PRINT_ADVANTAGES,
  advantagesTitle: 'Почему выбирают нас',
  advantagesSubtitle: 'Качественная печать фотографий',
  
  faqItems: [
    {
      question: 'Какое минимальное разрешение нужно?',
      answer: 'Для качественной печати 10x15 рекомендуем разрешение от 1800x1200 пикселей (около 2 мегапикселей).'
    },
    {
      question: 'Глянцевая или матовая бумага лучше?',
      answer: 'Глянец даёт яркие насыщенные цвета. Матовая, более спокойные тона и не оставляет отпечатков пальцев.'
    },
    {
      question: 'Есть ли скидки на большое количество?',
      answer: 'Да, при заказе от 100 фото действует скидка. Уточняйте у консультанта.'
    }
  ],
  
  relatedServices: [
    { title: 'Печать 15x20 Премиум', url: '/pechat-foto', price: 49, icon: 'photo' },
    { title: 'Печать на холсте', url: '/pechat-foto-na-holste', price: 2200, icon: 'image' },
    { title: 'Ретушь фото', url: '/retush', price: 700, icon: 'brush' }
  ],

  schemaType: 'PrintService'
};

/**
 * Печать на холсте
 */
export const PECHAT_NA_HOLSTE: LandingPageData = {
  slug: 'pechat-foto-na-holste',
  title: 'Печать на холсте',
  metaTitle: 'Печать фото на холсте в Ростове | от 2200₽ | Своё Фото',
  metaDescription: 'Печать фотографий на холсте от 2200₽. Картины из ваших фото. Натяжка на подрамник. Готово за 1-2 дня.',
  canonicalUrl: '/pechat-foto-na-holste',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать на холсте',
  heroSubtitle: 'Любимое фото станет картиной на стене, холст на подрамнике живёт десятилетиями. Не тускнеет, не требует рамки, украшает любой интерьер.',
  heroBenefits: [
    { icon: 'brush', text: 'Художественный холст' },
    { icon: 'photo_frame', text: 'На подрамнике' },
    { icon: 'favorite', text: 'Отличный подарок' }
  ],
  heroCtaText: 'Заказать холст',
  heroImage: '/assets/static/promo/pechat-foto-na-holste.webp',
  
  price: 2200,
  priceLabel: 'Холст 30x40',
  
  serviceType: 'Печать на холсте',
  specifications: [
    { label: '30x40', value: '2200₽' },
    { label: '50x70', value: '3400₽' },
    { label: '70x100', value: '4300₽' },
    { label: 'Срок', value: '1-2 дня' }
  ],
  requirements: [
    'Разрешение от 3000x4000 px для 30x40',
    'Формат JPG, TIFF, PNG',
    'Хорошее качество исходника',
    'Возможна ретушь за доп. плату'
  ],
  
  photoSamples: [
    { src: '/assets/static/services/canvas-1.webp', alt: 'Холст - семейное фото', description: 'Семейный портрет' },
    { src: '/assets/static/services/canvas-2.webp', alt: 'Холст - пейзаж', description: 'Пейзаж' },
    { src: '/assets/static/services/canvas-3.webp', alt: 'Холст - свадьба', description: 'Свадебное фото' }
  ],
  processSteps: [
    {
      number: 1,
      title: 'Выбор фото',
      description: 'Приносите фото или отправляете онлайн',
      icon: 'add_photo_alternate',
      details: ['Консультация по выбору', 'Проверка качества', 'Помощь с кадрированием']
    },
    {
      number: 2,
      title: 'Обработка',
      description: 'При необходимости улучшаем качество',
      icon: 'auto_fix_high',
      details: ['Цветокоррекция', 'Ретушь', 'Кадрирование под размер']
    },
    {
      number: 3,
      title: 'Печать на холсте',
      description: 'Печатаем на художественном холсте',
      icon: 'print',
      details: ['Широкоформатная печать', 'Архивные чернила', 'Защитный лак']
    },
    {
      number: 4,
      title: 'Натяжка',
      description: 'Натягиваем холст на деревянный подрамник',
      icon: 'photo_frame',
      details: ['Галерейная натяжка', 'Качественный подрамник', 'Готово к подвешиванию']
    },
    {
      number: 5,
      title: 'Готово!',
      description: 'Забирайте вашу картину',
      icon: 'celebration',
      details: ['Проверка качества', 'Упаковка', 'Рекомендации по уходу']
    }
  ],
  advantages: [
    { icon: 'brush', title: 'Художественный холст', description: 'Настоящий хлопковый холст с текстурой' },
    { icon: 'wb_sunny', title: 'Защита от выцветания', description: 'Архивные чернила сохраняют цвет 50+ лет' },
    { icon: 'photo_frame', title: 'На подрамнике', description: 'Готово к подвешиванию без рамки' },
    { icon: 'verified', title: 'Гарантия качества', description: 'Переделаем бесплатно при браке' }
  ],
  
  faqItems: [
    {
      question: 'Какое разрешение нужно для холста 30x40?',
      answer: 'Рекомендуем от 3000x4000 пикселей. Но мы проверим ваше фото и скажем, подойдёт ли оно.'
    },
    {
      question: 'Можно ли напечатать из фото с телефона?',
      answer: 'Да, если фото хорошего качества. Современные смартфоны делают отличные снимки для холста.'
    },
    {
      question: 'Нужна ли рамка для холста?',
      answer: 'Нет, холст натянут на подрамник и готов к подвешиванию. Но при желании можно добавить багет.'
    },
    {
      question: 'Сколько прослужит холст?',
      answer: 'При использовании архивных чернил и защитного лака, более 50 лет без выцветания.'
    }
  ],
  
  relatedServices: [
    { title: 'Печать фото Премиум', url: '/pechat-foto', price: 20, icon: 'photo' },
    { title: 'Ретушь фото', url: '/retush', price: 700, icon: 'brush' },
    { title: 'Реставрация фото', url: '/restavratsiya-foto', price: 900, icon: 'healing' }
  ],
  
  schemaType: 'PrintService'
};

/**
 * Фото на памятник (керамика)
 */
export const FOTO_NA_PAMYATNIK: LandingPageData = {
  slug: 'foto-na-pamyatnik',
  title: 'Фото на памятник',
  metaTitle: 'Фото на памятник в Ростове-на-Дону | от 1000₽ | Своё Фото',
  metaDescription: 'Керамические фото на памятник от 1000₽. Высокое качество, устойчивость к погоде. Ретушь и реставрация старых фото.',
  canonicalUrl: '/foto-na-pamyatnik',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Фото на памятник',
  heroSubtitle: 'Фото на памятник, которое сохранится десятилетиями. Керамика не выцветает на солнце, не трескается на морозе, память навсегда.',
  heroBenefits: [
    { icon: 'wb_sunny', text: 'Устойчиво к погоде' },
    { icon: 'history', text: 'Служит десятилетия' },
    { icon: 'brush', text: 'Ретушь включена' }
  ],
  heroCtaText: 'Заказать фото',
  heroImage: '/assets/static/promo/foto-na-pamyatnik.webp',
  
  price: 1000,
  priceLabel: 'Керамическое фото',
  
  serviceType: 'Фото на памятник',
  specifications: [
    { label: 'Материал', value: 'Керамика' },
    { label: 'Форма', value: 'Овал/Прямоугольник' },
    { label: 'Срок', value: '3-5 дней' },
    { label: 'Гарантия', value: '10 лет' }
  ],
  requirements: [
    'Любое фото (даже старое и повреждённое)',
    'Можно принести оригинал или скан',
    'Ретушь и реставрация включены',
    'Подбор размера под памятник'
  ],
  
  photoSamples: [
    { src: '/assets/static/services/ceramic-sample-1.webp', alt: 'Керамика овальная', description: 'Овальная керамика' },
    { src: '/assets/static/services/ceramic-sample-2.webp', alt: 'Керамика прямоугольная', description: 'Прямоугольная керамика' }
  ],
  processSteps: [
    {
      number: 1,
      title: 'Приём фото',
      description: 'Принесите оригинал или скан фотографии',
      icon: 'add_photo_alternate',
      details: ['Любое состояние фото', 'Оригинал или копия', 'Консультация']
    },
    {
      number: 2,
      title: 'Ретушь и реставрация',
      description: 'Восстанавливаем и улучшаем качество фото',
      icon: 'auto_fix_high',
      details: ['Удаление дефектов', 'Цветокоррекция', 'Улучшение резкости']
    },
    {
      number: 3,
      title: 'Согласование',
      description: 'Показываем результат для утверждения',
      icon: 'check_circle',
      details: ['Предпросмотр', 'Корректировки', 'Выбор размера']
    },
    {
      number: 4,
      title: 'Печать на керамике',
      description: 'Изготавливаем керамическое фото',
      icon: 'print',
      details: ['Высокотемпературный обжиг', 'Защитное покрытие', 'Контроль качества']
    },
    {
      number: 5,
      title: 'Готово',
      description: 'Забирайте готовое изделие',
      icon: 'celebration',
      details: ['Упаковка', 'Инструкция по установке', 'Гарантия']
    }
  ],
  advantages: [
    { icon: 'wb_sunny', title: 'Устойчивость к погоде', description: 'Выдерживает дождь, снег, солнце' },
    { icon: 'history', title: 'Долговечность', description: 'Сохраняет качество 10+ лет' },
    { icon: 'brush', title: 'Ретушь включена', description: 'Бесплатная обработка и реставрация' },
    { icon: 'healing', title: 'Работаем с любыми фото', description: 'Восстановим даже повреждённые снимки' }
  ],
  
  faqItems: [
    {
      question: 'Можно ли сделать фото из старой повреждённой фотографии?',
      answer: 'Да, мы специализируемся на реставрации. Восстановим даже сильно повреждённые фото.'
    },
    {
      question: 'Сколько прослужит керамическое фото?',
      answer: 'При правильной установке, более 10 лет. Мы даём гарантию на изделие.'
    },
    {
      question: 'Какие размеры доступны?',
      answer: 'Стандартные размеры: 9x12, 13x18, 18x24 см. Возможны индивидуальные размеры.'
    },
    {
      question: 'Помогаете с установкой?',
      answer: 'Мы предоставляем подробную инструкцию. Установку производят мастера на кладбище.'
    }
  ],
  
  relatedServices: [
    { title: 'Реставрация фото', url: '/restavratsiya-foto', price: 900, icon: 'healing' },
    { title: 'Ретушь фото', url: '/retush', price: 700, icon: 'brush' },
    { title: 'Печать фото Премиум', url: '/pechat-foto', price: 20, icon: 'photo' }
  ],
  
  schemaType: 'PrintService'
};

// Экспорт всех данных группы "Печать фотографий"
export const PHOTO_PRINT_DATA: Record<string, LandingPageData> = {
  'pechat-foto': PECHAT_FOTO,
  'pechat-foto-10x15': PECHAT_FOTO_10X15,
  'pechat-foto-na-holste': PECHAT_NA_HOLSTE,
  'foto-na-pamyatnik': FOTO_NA_PAMYATNIK
};
