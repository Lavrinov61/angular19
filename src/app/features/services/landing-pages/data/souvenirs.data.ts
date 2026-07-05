import { LandingPageData, ProcessStep, Advantage } from '../landing-page.interface';

/**
 * Группа 5: Сувенирная продукция
 */

const SOUVENIR_PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Выбор изображения',
    description: 'Приносите фото или выбираем дизайн вместе',
    icon: 'add_photo_alternate',
    details: ['Ваше фото', 'Логотип', 'Готовый дизайн']
  },
  {
    number: 2,
    title: 'Подготовка макета',
    description: 'Адаптируем изображение под изделие',
    icon: 'design_services',
    details: ['Кадрирование', 'Цветокоррекция', 'Макет']
  },
  {
    number: 3,
    title: 'Печать',
    description: 'Переносим изображение на изделие',
    icon: 'print',
    details: ['Сублимация', 'Термоперенос', 'Качественные краски']
  },
  {
    number: 4,
    title: 'Готово!',
    description: 'Забирайте ваш уникальный подарок',
    icon: 'card_giftcard',
    details: ['Упаковка', 'Проверка качества']
  }
];

const SOUVENIR_ADVANTAGES: Advantage[] = [
  { icon: 'palette', title: 'Яркие цвета', description: 'Сочные, не выцветающие изображения' },
  { icon: 'favorite', title: 'Уникальность', description: 'Ваш персональный дизайн' },
  { icon: 'card_giftcard', title: 'Отличный подарок', description: 'Порадуйте близких' },
  { icon: 'schedule', title: 'Быстро', description: 'Готово за 1-2 часа' }
];

/**
 * Печать на кружках
 */
export const PECHAT_NA_KRUZHKAH: LandingPageData = {
  slug: 'pechat-na-kruzhkah',
  title: 'Печать на кружках',
  metaTitle: 'Печать на кружках в Ростове-на-Дону | 390₽ | Своё Фото',
  metaDescription: 'Печать фото и логотипов на кружках за 390₽. Яркие цвета, стойкое изображение. Готово за 1 час. Отличный подарок!',
  canonicalUrl: '/pechat-na-kruzhkah',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать на кружках',
  heroSubtitle: 'Кружка с фото, подарок, который используют каждый день. Сублимационная печать: рисунок не смывается при стирке и выдерживает посудомоечную машину.',
  heroBenefits: [
    { icon: 'local_cafe', text: 'Качественная кружка' },
    { icon: 'palette', text: 'Яркие цвета' },
    { icon: 'schedule', text: 'Готово за 1 час' }
  ],
  heroCtaText: 'Заказать кружку',
  heroImage: '/assets/static/promo/pechat-na-kruzhkah.webp',
  
  price: 390,
  priceLabel: 'Кружка с печатью',
  
  serviceType: 'Печать на кружках',
  specifications: [
    { label: 'Кружка', value: '390₽' },
    { label: 'Объём', value: '330 мл' },
    { label: 'Цвет кружки', value: 'Белая' },
    { label: 'Срок', value: '1 час' }
  ],
  requirements: [
    'Фото или изображение хорошего качества',
    'Минимум 1000×1000 пикселей',
    'Можно логотип или текст'
  ],
  requirementsTitle: 'Что нужно для заказа',
  
  photoSamples: [],
  galleryTitle: 'Примеры кружек',
  
  processSteps: SOUVENIR_PROCESS_STEPS,
  processTitle: 'Как мы делаем кружки',
  advantages: SOUVENIR_ADVANTAGES,
  advantagesTitle: 'Почему заказывают у нас',
  advantagesSubtitle: 'Качественные подарки с душой',
  
  faqItems: [
    { question: 'Можно мыть в посудомойке?', answer: 'Рекомендуем ручную мойку для долгого сохранения изображения.' },
    { question: 'Изображение не смоется?', answer: 'Нет, мы используем сублимационную печать, изображение впечатывается в покрытие кружки.' },
    { question: 'Можно ли напечатать на двух сторонах?', answer: 'Да, можно разместить разные изображения с обеих сторон.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С фото или выберем на месте',
    primaryIcon: 'store',
    secondaryTitle: 'Отправить фото онлайн',
    secondaryDescription: 'Через Telegram или МАКС',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Хотите уникальную кружку?',
    subtitle: 'Приходите с фото или отправьте онлайн!',
    primaryButtonText: 'Заказать',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ 390₽, отличный персональный подарок!'
  },
  
  relatedServices: [
    { title: 'Печать на футболках', url: '/pechat-na-futbolkah', price: 590, icon: 'checkroom' },
    { title: 'Печать на подарках', url: '/pechat-na-podarki', price: 300, icon: 'card_giftcard' }
  ],
  
  schemaType: 'PrintService'
};

/**
 * Печать на футболках
 */
export const PECHAT_NA_FUTBOLKAH: LandingPageData = {
  slug: 'pechat-na-futbolkah',
  title: 'Печать на футболках',
  metaTitle: 'Печать на футболках в Ростове-на-Дону | 590₽ | Своё Фото',
  metaDescription: 'Печать на футболках за 590₽. Ваше фото, логотип или дизайн. Качественная печать, которая не стирается.',
  canonicalUrl: '/pechat-na-futbolkah',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать на футболках',
  heroSubtitle: 'Футболка с вашим дизайном или фото, готова за 1 день. Термоперенос высокого качества: рисунок не трескается и не линяет после стирок.',
  heroBenefits: [
    { icon: 'checkroom', text: 'Качественная футболка' },
    { icon: 'palette', text: 'Любой дизайн' },
    { icon: 'local_laundry_service', text: 'Выдерживает стирку' }
  ],
  heroCtaText: 'Заказать футболку',
  heroImage: '/assets/static/promo/pechat-na-futbolkah.webp',
  
  price: 590,
  priceLabel: 'Футболка с печатью',
  
  serviceType: 'Печать на футболках',
  specifications: [
    { label: 'Футболка', value: '590₽' },
    { label: 'Размеры', value: 'XS-3XL' },
    { label: 'Цвета', value: 'Белая/Чёрная' },
    { label: 'Срок', value: '1-2 часа' }
  ],
  requirements: [
    'Изображение высокого качества',
    'Минимум 2000×2000 px для большой печати',
    'Формат PNG с прозрачностью для сложных форм'
  ],
  requirementsTitle: 'Что нужно для заказа',
  
  photoSamples: [],
  galleryTitle: 'Примеры футболок',
  
  processSteps: SOUVENIR_PROCESS_STEPS,
  processTitle: 'Как мы делаем футболки',
  advantages: SOUVENIR_ADVANTAGES,
  advantagesTitle: 'Почему заказывают у нас',
  advantagesSubtitle: 'Качественные подарки с душой',
  
  faqItems: [
    { question: 'Можно стирать в машинке?', answer: 'Да, рекомендуем стирку при 30°C, вывернув наизнанку.' },
    { question: 'Какие размеры есть?', answer: 'От XS до 3XL. Можем подобрать по вашим меркам.' },
    { question: 'Можно со своей футболкой?', answer: 'Да, можете принести свою футболку, печать 400₽.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'Выбрать футболку и дизайн',
    primaryIcon: 'store',
    secondaryTitle: 'Отправить макет онлайн',
    secondaryDescription: 'Через Telegram или МАКС',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Хотите уникальную футболку?',
    subtitle: 'Приходите в студию или отправьте макет онлайн!',
    primaryButtonText: 'Заказать',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ 590₽, футболка с вашим дизайном!'
  },
  
  relatedServices: [
    { title: 'Печать на кружках', url: '/pechat-na-kruzhkah', price: 390, icon: 'local_cafe' },
    { title: 'Печать на подарках', url: '/pechat-na-podarki', price: 300, icon: 'card_giftcard' }
  ],
  
  schemaType: 'PrintService'
};

/**
 * Печать на подарках
 */
export const PECHAT_NA_PODARKI: LandingPageData = {
  slug: 'pechat-na-podarki',
  title: 'Печать на подарках',
  metaTitle: 'Печать на подарках в Ростове | Магниты, пазлы, подушки | Своё Фото',
  metaDescription: 'Печать на сувенирах от 300₽. Магниты, пазлы, подушки, чехлы для телефона. Уникальные подарки с вашими фото.',
  canonicalUrl: '/pechat-na-podarki',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать на подарках',
  heroSubtitle: 'Магниты, пазлы, подушки с семейными фото, подарки, которые вызывают настоящие эмоции. Готово за 1 день, от 300₽.',
  heroBenefits: [
    { icon: 'card_giftcard', text: 'Уникальные подарки' },
    { icon: 'favorite', text: 'С вашими фото' },
    { icon: 'celebration', text: 'На любой праздник' }
  ],
  heroCtaText: 'Выбрать подарок',
  heroImage: '/assets/static/promo/pechat-na-podarki.webp',
  
  price: 300,
  priceLabel: 'Магнит с фото',
  
  serviceType: 'Печать на подарках',
  specifications: [
    { label: 'Магнит', value: 'от 300₽' },
    { label: 'Пазл', value: 'от 500₽' },
    { label: 'Подушка', value: 'от 800₽' },
    { label: 'Срок', value: '1-3 дня' }
  ],
  requirements: [
    'Фото хорошего качества',
    'Чем больше изделие, тем выше разрешение',
    'Можно несколько фото для коллажа'
  ],
  requirementsTitle: 'Что нужно для заказа',
  
  photoSamples: [],
  processSteps: SOUVENIR_PROCESS_STEPS,
  processTitle: 'Как мы делаем подарки',
  advantages: SOUVENIR_ADVANTAGES,
  advantagesTitle: 'Почему заказывают у нас',
  advantagesSubtitle: 'Качественные подарки с душой',
  
  faqItems: [
    { question: 'Какие сувениры можете сделать?', answer: 'Магниты, пазлы, подушки, чехлы для телефона, брелоки, коврики для мыши и многое другое.' },
    { question: 'Можно сделать к определённой дате?', answer: 'Да, укажите нужную дату при заказе, и мы сделаем вовремя.' },
    { question: 'Есть ли скидки на несколько изделий?', answer: 'Да, при заказе от 5 штук действует скидка.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'Посмотреть образцы и выбрать',
    primaryIcon: 'store',
    secondaryTitle: 'Отправить фото онлайн',
    secondaryDescription: 'Через Telegram или МАКС',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Ищете уникальный подарок?',
    subtitle: 'Создадим персональный сувенир с вашими фото!',
    primaryButtonText: 'Заказать',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 300₽, подарок, который запомнится!'
  },
  
  relatedServices: [
    { title: 'Печать на кружках', url: '/pechat-na-kruzhkah', price: 390, icon: 'local_cafe' },
    { title: 'Печать на футболках', url: '/pechat-na-futbolkah', price: 590, icon: 'checkroom' },
    { title: 'Печать на холсте', url: '/pechat-foto-na-holste', price: 2200, icon: 'image' }
  ],
  
  schemaType: 'PrintService'
};

export const SOUVENIRS_DATA: Record<string, LandingPageData> = {
  'pechat-na-kruzhkah': PECHAT_NA_KRUZHKAH,
  'pechat-na-futbolkah': PECHAT_NA_FUTBOLKAH,
  'pechat-na-podarki': PECHAT_NA_PODARKI
};
