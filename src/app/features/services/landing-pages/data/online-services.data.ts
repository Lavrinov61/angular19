import { LandingPageData, ProcessStep } from '../landing-page.interface';

/**
 * Онлайн-услуги, работаем по всей России
 */

const ONLINE_PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Отправьте фото',
    description: 'Загрузите фото через чат на сайте или мессенджер',
    icon: 'add_photo_alternate',
    details: ['Чат на сайте', 'Telegram', 'МАКС']
  },
  {
    number: 2,
    title: 'Обсудим детали',
    description: 'Уточним пожелания и согласуем стоимость',
    icon: 'chat',
    details: ['Консультация', 'Пожелания', 'Стоимость']
  },
  {
    number: 3,
    title: 'Обработка',
    description: 'Наши специалисты выполнят работу',
    icon: 'brush',
    details: ['Профессиональная обработка', 'Контроль качества']
  },
  {
    number: 4,
    title: 'Результат',
    description: 'Получите готовые файлы и внесём правки при необходимости',
    icon: 'check_circle',
    details: ['Предпросмотр', 'Корректировки', 'Готовые файлы']
  }
];

// ============================================================================
// Нейрофотосессия
// ============================================================================

const NEURO_PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Отправьте селфи',
    description: 'Загрузите 5-10 чётких фото вашего лица',
    icon: 'selfie',
    details: ['Разные ракурсы', 'Хорошее освещение', 'Без фильтров']
  },
  {
    number: 2,
    title: 'Выберите стиль',
    description: 'Обсудим желаемый образ и стилистику',
    icon: 'style',
    details: ['Бизнес', 'Fashion', 'Арт', 'Ваш референс']
  },
  {
    number: 3,
    title: 'AI-генерация',
    description: 'Нейросеть создаёт уникальные фотографии',
    icon: 'auto_awesome',
    details: ['Обучение на ваших фото', 'Генерация образов', 'Отбор лучших']
  },
  {
    number: 4,
    title: 'Результат',
    description: 'Получите готовые фото в высоком разрешении',
    icon: 'photo_library',
    details: ['Высокое разрешение', 'Ретушь при необходимости', 'Все файлы ваши']
  }
];

export const NEYROFOTOSESSIYA: LandingPageData = {
  slug: 'neyrofotosessiya',
  title: 'Нейрофотосессия',
  metaTitle: 'Нейрофотосессия онлайн | AI-фото из вашего селфи | от 450₽ | Своё Фото',
  metaDescription: 'Закажите AI-генерацию уникальных фото из вашего селфи. Нейросеть создаёт профессиональные образы: бизнес, fashion, арт. От 450₽, результат за 1-2 часа.',
  canonicalUrl: '/neyrofotosessiya',
  serviceMode: 'online',

  heroTitle: 'от Своё Фото',
  heroHighlight: 'Нейрофотосессия',
  heroSubtitle: 'AI-фотосессия без выхода из дома: загружаете 10 фото, получаете 50+ профессиональных портретов в разных образах. Результат за 2 часа, от 450₽.',
  heroBenefits: [
    { icon: 'auto_awesome', text: 'AI-генерация' },
    { icon: 'public', text: 'По всей России' },
    { icon: 'schedule', text: 'Результат за 1-2 часа' }
  ],
  heroCtaText: 'Заказать нейрофотосессию',
  heroImage: '/assets/static/promo/neyrofotosessiya.webp',

  price: 450,
  priceLabel: 'Мини (1 фото)',

  serviceType: 'Нейрофотосессия',
  specifications: [
    { label: 'Мини (1 фото, 1 образ)', value: '450₽' },
    { label: 'Стандарт (4 фото, 1 образ)', value: '990₽' },
    { label: 'Полный (10-15 фото, 2-3 образа)', value: '3 000₽' },
    { label: 'Срок выполнения', value: '1-2 часа' }
  ],
  requirements: [
    '5-10 чётких фото вашего лица (селфи, портреты)',
    'Разный ракурс и освещение для лучшего результата',
    'Описание желаемого образа или стиля',
    'Референсы (примеры), по желанию'
  ],
  requirementsTitle: 'Что нужно для заказа',

  photoSamples: [],
  galleryTitle: 'Примеры нейрофотосессий',

  processSteps: NEURO_PROCESS_STEPS,
  processTitle: 'Как это работает',
  advantages: [
    { icon: 'auto_awesome', title: 'Технологии AI', description: 'Современные нейросети для генерации реалистичных фото' },
    { icon: 'palette', title: 'Любой стиль', description: 'Бизнес, fashion, арт, фэнтези, без ограничений' },
    { icon: 'home', title: 'Из дома', description: 'Нужно только селфи, никуда ехать не нужно' },
    { icon: 'savings', title: 'Доступно', description: 'В 5-10 раз дешевле обычной фотосессии' }
  ],
  advantagesTitle: 'Почему нейрофотосессия',
  advantagesSubtitle: 'Профессиональные фото без студии',

  faqItems: [
    { question: 'Что такое нейрофотосессия?', answer: 'Это создание профессиональных фотографий с помощью искусственного интеллекта. Нейросеть обучается на ваших селфи и генерирует фото в выбранном стиле, как будто вы были на настоящей фотосессии.' },
    { question: 'Какие селфи нужны?', answer: 'Нужно 5-10 чётких фото лица с разных ракурсов. Без фильтров, без очков (если не хотите их на итоговых фото), хорошее освещение. Подойдут обычные селфи с телефона.' },
    { question: 'Какие стили доступны?', answer: 'Практически любые: бизнес-портрет для карьерных сайтов, fashion, арт, фэнтези, исторические образы, аниме-стиль. Можете прислать свой референс.' },
    { question: 'Фото выглядят реалистично?', answer: 'Да, современные нейросети создают очень реалистичные изображения. При необходимости наш ретушёр дополнительно доработает результат.' },
    { question: 'Можно использовать для документов?', answer: 'Нейрофото не подходят для официальных документов. Для документов используйте нашу услугу «Фото на документы онлайн».' },
    { question: 'Сколько по времени?', answer: 'Мини-пакет (1 фото), около 1 часа. Стандарт (4 фото), 1-2 часа. Полный пакет (10-15 фото), до 24 часов.' }
  ],

  quickActions: {
    primaryTitle: 'Написать в чат',
    primaryDescription: 'Обсудим стиль и оформим заказ',
    primaryIcon: 'chat',
    secondaryTitle: 'Написать в мессенджер',
    secondaryDescription: 'Telegram, МАКС, VK',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Хотите профессиональные фото без студии?',
    subtitle: 'Отправьте селфи, AI сделает остальное!',
    primaryButtonText: 'Заказать',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 450₽, нейрофотосессия по всей России!'
  },

  relatedServices: [
    { title: 'Фото на документы онлайн', url: '/foto-na-documenty-online', price: 100, icon: 'badge' },
    { title: 'Ретушь онлайн', url: '/retush-online', price: 350, icon: 'brush' },
    { title: 'Реставрация онлайн', url: '/restavratsiya-online', price: 450, icon: 'healing' }
  ],

  schemaType: 'OnlineService'
};

// ============================================================================
// Реставрация фото онлайн
// ============================================================================

export const RESTAVRATSIYA_ONLINE: LandingPageData = {
  slug: 'restavratsiya-online',
  title: 'Реставрация фото онлайн',
  metaTitle: 'Реставрация фото онлайн по всей России | от 450₽ | Своё Фото',
  metaDescription: 'Реставрация старых и повреждённых фотографий онлайн от 450₽. Восстановление царапин, разрывов, выцветших участков. Работаем по всей России.',
  canonicalUrl: '/restavratsiya-online',
  serviceMode: 'online',

  heroTitle: 'от Своё Фото',
  heroHighlight: 'Реставрация фото онлайн',
  heroSubtitle: 'Отправьте скан старого фото, вернём к жизни удалённо, по всей России. Реставрируем даже сильно повреждённые снимки за 1-2 дня.',
  heroBenefits: [
    { icon: 'healing', text: 'Восстановление повреждений' },
    { icon: 'public', text: 'По всей России' },
    { icon: 'verified', text: 'Гарантия качества' }
  ],
  heroCtaText: 'Заказать реставрацию',
  heroImage: '/assets/static/promo/restavratsiya-online.webp',

  price: 450,
  priceLabel: 'Простая реставрация',

  serviceType: 'Реставрация фотографий онлайн',
  specifications: [
    { label: 'Простая', value: '450₽' },
    { label: 'Средняя', value: '900₽' },
    { label: 'Сложная', value: '1 500₽' },
    { label: 'Профессиональная', value: '1 800₽' },
    { label: 'Срок', value: '1-5 дней' }
  ],
  requirements: [
    'Скан оригинала (от 600 dpi для лучшего результата)',
    'Или качественное фото оригинала при хорошем свете',
    'Дополнительные фото того же человека (если есть)',
    'Описание пожеланий, что восстановить'
  ],
  requirementsTitle: 'Что нужно для заказа',

  photoSamples: [],
  galleryTitle: 'Примеры реставрации',

  processSteps: ONLINE_PROCESS_STEPS,
  processTitle: 'Как это работает',
  advantages: [
    { icon: 'healing', title: 'Восстановление', description: 'Удаляем царапины, разрывы, пятна, заломы' },
    { icon: 'palette', title: 'Цветокоррекция', description: 'Восстанавливаем выцветшие и пожелтевшие цвета' },
    { icon: 'auto_fix_high', title: 'Улучшение качества', description: 'Повышаем резкость и детализацию' },
    { icon: 'home', title: 'Из дома', description: 'Отправьте скан, не нужно приносить оригинал' }
  ],
  advantagesTitle: 'Что мы можем',
  advantagesSubtitle: 'Сохраним семейную память',

  faqItems: [
    { question: 'Что такое простая и сложная реставрация?', answer: 'Простая, небольшие царапины и пятна. Средняя, заметные повреждения, выцветание. Сложная, серьёзные разрывы, утраченные фрагменты. Профессиональная, восстановление с серьёзными утратами.' },
    { question: 'Как отправить фото?', answer: 'Сделайте качественный скан (600 dpi минимум) или сфотографируйте оригинал при хорошем освещении. Отправьте через чат на сайте, Telegram или МАКС.' },
    { question: 'Можно раскрасить чёрно-белое фото?', answer: 'Да, колоризация старых фото, отдельная услуга. Стоимость обсуждается индивидуально.' },
    { question: 'Как оплатить?', answer: 'Оплата после согласования результата. Принимаем карты, СБП, переводы.' },
    { question: 'Сколько по времени?', answer: 'Простая реставрация, 1-2 дня. Сложная, до 5 дней. Точный срок обсудим при оценке.' }
  ],

  quickActions: {
    primaryTitle: 'Написать в чат',
    primaryDescription: 'Отправьте скан, оценим бесплатно',
    primaryIcon: 'chat',
    secondaryTitle: 'Написать в мессенджер',
    secondaryDescription: 'Telegram, МАКС, VK',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Есть старые фото, которые хотите восстановить?',
    subtitle: 'Отправьте скан, оценим бесплатно, восстановим качественно!',
    primaryButtonText: 'Отправить фото',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 450₽, реставрация онлайн по всей России!'
  },

  relatedServices: [
    { title: 'Ретушь онлайн', url: '/retush-online', price: 350, icon: 'brush' },
    { title: 'Нейрофотосессия', url: '/neyrofotosessiya', price: 450, icon: 'auto_awesome' },
    { title: 'Реставрация в студии', url: '/restavratsiya-foto', price: 900, icon: 'healing' }
  ],

  schemaType: 'OnlineService'
};

// ============================================================================
// Ретушь фото онлайн
// ============================================================================

export const RETUSH_ONLINE: LandingPageData = {
  slug: 'retush-online',
  title: 'Ретушь фото онлайн',
  metaTitle: 'Ретушь фото онлайн по всей России | от 350₽ | Своё Фото',
  metaDescription: 'Профессиональная ретушь фотографий онлайн от 350₽. Естественная обработка портретов, коррекция кожи, цветокоррекция. Работаем по всей России.',
  canonicalUrl: '/retush-online',
  serviceMode: 'online',

  heroTitle: 'от Своё Фото',
  heroHighlight: 'Ретушь фото онлайн',
  heroSubtitle: 'Пришлите фото, через 12 часов получите профессиональную ретушь. Естественный результат: кожа живая, лицо узнаваемо. По всей России от 350₽.',
  heroBenefits: [
    { icon: 'brush', text: 'Профессиональная ретушь' },
    { icon: 'public', text: 'По всей России' },
    { icon: 'savings', text: 'От 350₽' }
  ],
  heroCtaText: 'Заказать ретушь',
  heroImage: '/assets/static/promo/retush-online.webp',

  price: 350,
  priceLabel: 'Базовая ретушь',

  serviceType: 'Ретушь фотографий онлайн',
  specifications: [
    { label: 'Базовая ретушь', value: '350₽' },
    { label: 'Расширенная ретушь', value: '700₽' },
    { label: 'Премиум-обработка', value: '1 000₽' },
    { label: 'Срок', value: '1-2 дня' },
    { label: 'Формат результата', value: 'JPG / TIFF' }
  ],
  requirements: [
    'Исходный файл высокого качества (оригинал без фильтров)',
    'Описание пожеланий, что именно обработать',
    'Примеры желаемого стиля обработки (если есть)'
  ],
  requirementsTitle: 'Что нужно для заказа',

  photoSamples: [],
  galleryTitle: 'Примеры ретуши',

  processSteps: ONLINE_PROCESS_STEPS,
  processTitle: 'Как это работает',
  advantages: [
    { icon: 'brush', title: 'Профессионалы', description: 'Опытные ретушёры с художественным образованием' },
    { icon: 'tune', title: 'Естественность', description: 'Подчёркиваем красоту без «пластикового» эффекта' },
    { icon: 'home', title: 'Из дома', description: 'Отправьте фото, получите результат онлайн' },
    { icon: 'verified', title: 'Гарантия', description: 'Бесплатные правки до полного одобрения' }
  ],
  advantagesTitle: 'Почему доверяют нам',
  advantagesSubtitle: 'Качественная обработка с душой',

  faqItems: [
    { question: 'Что входит в базовую ретушь?', answer: 'Выравнивание тона кожи, удаление мелких недостатков (прыщи, покраснения), коррекция освещения, лёгкая цветокоррекция.' },
    { question: 'Что входит в расширенную ретушь?', answer: 'Всё из базовой + пластика лица (сужение, овал), коррекция фигуры, замена фона, удаление лишних объектов/людей.' },
    { question: 'Что входит в премиум?', answer: 'Полная художественная обработка: стилизация, сложный композитинг, beauty-ретушь журнального уровня.' },
    { question: 'Работаете с RAW?', answer: 'Да, принимаем RAW, PSD, TIFF, JPG, PNG и другие популярные форматы.' },
    { question: 'Как оплатить?', answer: 'Оплата после согласования результата. Карты, СБП, переводы.' }
  ],

  quickActions: {
    primaryTitle: 'Написать в чат',
    primaryDescription: 'Обсудим обработку вашего фото',
    primaryIcon: 'chat',
    secondaryTitle: 'Написать в мессенджер',
    secondaryDescription: 'Telegram, МАКС, VK',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Нужна профессиональная ретушь?',
    subtitle: 'Отправьте фото, сделаем красиво!',
    primaryButtonText: 'Отправить фото',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 350₽, естественная ретушь по всей России!'
  },

  relatedServices: [
    { title: 'Реставрация онлайн', url: '/restavratsiya-online', price: 450, icon: 'healing' },
    { title: 'Нейрофотосессия', url: '/neyrofotosessiya', price: 450, icon: 'auto_awesome' },
    { title: 'Ретушь в студии', url: '/retush', price: 700, icon: 'brush' }
  ],

  schemaType: 'OnlineService'
};

export const ONLINE_SERVICES_DATA: Record<string, LandingPageData> = {
  'neyrofotosessiya': NEYROFOTOSESSIYA,
  'restavratsiya-online': RESTAVRATSIYA_ONLINE,
  'retush-online': RETUSH_ONLINE
};
