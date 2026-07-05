import { LandingPageData, ProcessStep, Advantage } from '../landing-page.interface';

/**
 * Группа 6: Ретушь и обработка
 */

const RETOUCH_PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Приём фото',
    description: 'Приносите фото или отправляете онлайн',
    icon: 'add_photo_alternate',
    details: ['Любой формат', 'Оригинал или скан', 'Консультация']
  },
  {
    number: 2,
    title: 'Оценка и согласование',
    description: 'Определяем объём работ и стоимость',
    icon: 'assignment',
    details: ['Анализ состояния', 'Обсуждение пожеланий', 'Согласование цены']
  },
  {
    number: 3,
    title: 'Обработка',
    description: 'Выполняем ретушь или реставрацию',
    icon: 'brush',
    details: ['Профессиональная обработка', 'Внимание к деталям', 'Контроль качества']
  },
  {
    number: 4,
    title: 'Согласование результата',
    description: 'Показываем результат, вносим правки',
    icon: 'check_circle',
    details: ['Предпросмотр', 'Корректировки', 'Финальное утверждение']
  },
  {
    number: 5,
    title: 'Готово!',
    description: 'Получаете обработанное фото',
    icon: 'celebration',
    details: ['Электронный файл', 'Печать по желанию', 'Возврат оригинала']
  }
];

const RETOUCH_ADVANTAGES: Advantage[] = [
  { icon: 'brush', title: 'Профессионалы', description: 'Опытные ретушёры-художники' },
  { icon: 'tune', title: 'Естественность', description: 'Без "пластикового" эффекта' },
  { icon: 'history', title: 'Сохранение памяти', description: 'Восстановим даже старые фото' },
  { icon: 'verified', title: 'Гарантия', description: 'Работаем до полного одобрения' }
];

/**
 * Ретушь фотографий
 */
export const RETUSH: LandingPageData = {
  slug: 'retush',
  title: 'Ретушь фотографий',
  metaTitle: 'Ретушь фотографий в Ростове-на-Дону | 700₽ | Своё Фото',
  metaDescription: 'Профессиональная ретушь фотографий за 700₽. Естественная обработка без "пластика". Портреты, фото на документы, события.',
  canonicalUrl: '/retush',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Ретушь фотографий',
  heroSubtitle: 'Ретушь, которая не превращает вас в куклу. Художник убирает только то, что мешает, кожа остаётся живой, лицо, настоящим.',
  heroBenefits: [
    { icon: 'brush', text: 'Профессиональная ретушь' },
    { icon: 'face', text: 'Естественный результат' },
    { icon: 'schedule', text: 'Готово за 1-2 дня' }
  ],
  heroCtaText: 'Заказать ретушь',
  heroImage: '/assets/static/promo/retush.webp',
  
  price: 700,
  priceLabel: 'Ретушь фото',

  serviceType: 'Ретушь фотографий',
  specifications: [
    { label: 'Базовая ретушь', value: '700₽' },
    { label: 'Сложная ретушь', value: 'от 1000₽' },
    { label: 'Срок', value: '1-2 дня' },
    { label: 'Формат', value: 'JPG/TIFF' }
  ],
  requirements: [
    'Исходный файл высокого качества',
    'Описание желаемого результата',
    'Примеры (если есть)'
  ],
  requirementsTitle: 'Что нужно для заказа',
  
  photoSamples: [],
  galleryTitle: 'Примеры ретуши',
  
  processSteps: RETOUCH_PROCESS_STEPS,
  processTitle: 'Как мы работаем',
  advantages: RETOUCH_ADVANTAGES,
  advantagesTitle: 'Почему доверяют нам',
  advantagesSubtitle: 'Качественная обработка с душой',
  
  faqItems: [
    { question: 'Что входит в базовую ретушь?', answer: 'Выравнивание тона кожи, удаление мелких недостатков, коррекция освещения, небольшая цветокоррекция.' },
    { question: 'Можно ли убрать лишних людей с фото?', answer: 'Да, это входит в сложную ретушь. Стоимость зависит от сложности.' },
    { question: 'Как долго хранится исходник?', answer: 'Храним исходники 30 дней после выполнения заказа.' },
    { question: 'Работаете с RAW-файлами?', answer: 'Да, работаем со всеми популярными форматами, включая RAW.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С фото для обработки',
    primaryIcon: 'store',
    secondaryTitle: 'Отправить фото онлайн',
    secondaryDescription: 'Через Telegram или МАКС',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Нужна профессиональная ретушь?',
    subtitle: 'Отправьте фото, сделаем красиво!',
    primaryButtonText: 'Связаться',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 700₽, естественная обработка без "пластика"!'
  },
  
  relatedServices: [
    { title: 'Ретушь онлайн', url: '/retush-online', price: 350, icon: 'brush' },
    { title: 'Реставрация фото', url: '/restavratsiya-foto', price: 900, icon: 'healing' },
    { title: 'Печать фото', url: '/pechat-foto', price: 40, icon: 'photo' }
  ],

  schemaType: 'DesignService'
};

/**
 * Реставрация старых фото
 */
export const RESTAVRATSIYA_FOTO: LandingPageData = {
  slug: 'restavratsiya-foto',
  title: 'Реставрация фото',
  metaTitle: 'Реставрация старых фотографий в Ростове | от 900₽ | Своё Фото',
  metaDescription: 'Реставрация старых и повреждённых фотографий от 900₽. Восстановление царапин, разрывов, выцветших участков. Сохраним семейную память.',
  canonicalUrl: '/restavratsiya-foto',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Реставрация фото',
  heroSubtitle: 'Восстановим семейную память, вернём к жизни порванные, выцветшие, повреждённые снимки. Реставрируем даже сильно утраченные фрагменты.',
  heroBenefits: [
    { icon: 'healing', text: 'Восстановление повреждений' },
    { icon: 'history', text: 'Работаем со старыми фото' },
    { icon: 'favorite', text: 'Сохраняем память' }
  ],
  heroCtaText: 'Заказать реставрацию',
  heroImage: '/assets/static/promo/restavratsiya-foto.webp',
  
  price: 900,
  priceLabel: 'Простая реставрация',
  
  serviceType: 'Реставрация фотографий',
  specifications: [
    { label: 'Простая', value: '900₽' },
    { label: 'Средняя', value: '1600₽' },
    { label: 'Сложная', value: '2800₽' },
    { label: 'Профи', value: '4000₽' }
  ],
  requirements: [
    'Оригинал или качественный скан (от 600 dpi)',
    'Чем лучше исходник, тем лучше результат',
    'Дополнительные фото того же человека (если есть)'
  ],
  requirementsTitle: 'Что нужно для заказа',
  
  photoSamples: [],
  galleryTitle: 'Примеры реставрации',
  
  processSteps: RETOUCH_PROCESS_STEPS,
  processTitle: 'Как мы работаем',
  advantages: [
    { icon: 'healing', title: 'Восстановление', description: 'Удаляем царапины, разрывы, пятна' },
    { icon: 'palette', title: 'Цветокоррекция', description: 'Восстанавливаем выцветшие цвета' },
    { icon: 'auto_fix_high', title: 'Улучшение качества', description: 'Повышаем резкость и детализацию' },
    { icon: 'history', title: 'Опыт', description: 'Работаем с фото любого возраста' }
  ],
  advantagesTitle: 'Что мы можем',
  advantagesSubtitle: 'Сохраним семейную память на годы',
  
  faqItems: [
    {
      question: 'Что такое "простая" и "сложная" реставрация?',
      answer: 'Простая, небольшие царапины и пятна. Средняя, заметные повреждения, выцветание. Сложная, серьёзные разрывы, утраченные фрагменты. Профи, восстановление практически с нуля.'
    },
    {
      question: 'Можете восстановить полностью порванное фото?',
      answer: 'Да, если есть все части. Чем больше сохранилось, тем лучше результат.'
    },
    {
      question: 'Можно ли раскрасить чёрно-белое фото?',
      answer: 'Да, колоризация старых фото, отдельная услуга. Уточняйте стоимость у консультанта.'
    },
    {
      question: 'Как передать оригинал?',
      answer: 'Можете принести лично или отправить качественный скан (600 dpi минимум). Оригиналы возвращаем в целости.'
    }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С фото для реставрации',
    primaryIcon: 'store',
    secondaryTitle: 'Отправить скан онлайн',
    secondaryDescription: 'Через Telegram или МАКС',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Есть старые фото, которые хотите восстановить?',
    subtitle: 'Принесите или отправьте скан, мы вернём им жизнь!',
    primaryButtonText: 'Связаться',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 900₽, сохраним семейную память!'
  },
  
  relatedServices: [
    { title: 'Реставрация онлайн', url: '/restavratsiya-online', price: 450, icon: 'healing' },
    { title: 'Ретушь фото', url: '/retush', price: 700, icon: 'brush' },
    { title: 'Фото на памятник', url: '/foto-na-pamyatnik', price: 1000, icon: 'church' }
  ],
  
  schemaType: 'DesignService'
};

export const RETOUCH_DATA: Record<string, LandingPageData> = {
  'retush': RETUSH,
  'restavratsiya-foto': RESTAVRATSIYA_FOTO
};
