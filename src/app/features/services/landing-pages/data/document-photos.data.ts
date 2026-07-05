import { LandingPageData, ProcessStep, Advantage } from '../landing-page.interface';

/**
 * Общие данные для всех страниц фото на документы
 */

const COMMON_PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Знакомство и консультация',
    description: 'Фотограф расскажет о процессе съёмки и обсудит все ваши пожелания',
    icon: 'handshake',
    details: ['Обсуждение требований', 'Рассказ о процессе', 'Ответы на вопросы']
  },
  {
    number: 2,
    title: 'Профессиональная подготовка',
    description: 'Настройка студийного света и оборудования специально для вас',
    icon: 'settings',
    details: ['Настройка освещения', 'Подготовка фона', 'Проверка оборудования']
  },
  {
    number: 3,
    title: 'Портретная съёмка',
    description: 'Фотограф создаёт несколько качественных вариантов',
    icon: 'camera_alt',
    details: ['Создание нескольких кадров', 'Разные ракурсы', 'Соблюдение требований']
  },
  {
    number: 4,
    title: 'Выбор лучшего портрета',
    description: 'Вместе выбираем самый удачный и красивый кадр',
    icon: 'photo_library',
    details: ['Просмотр вариантов', 'Выбор лучшего', 'Ваше решение']
  },
  {
    number: 5,
    title: 'Художественная обработка',
    description: 'Индивидуальная ретушь с учётом ваших пожеланий',
    icon: 'brush',
    details: ['Коррекция освещения', 'Ретушь кожи', 'Соответствие стандартам']
  },
  {
    number: 6,
    title: 'Печать и готовый результат',
    description: 'Высококачественная печать на профессиональной фотобумаге',
    icon: 'print',
    details: ['Печать на фотобумаге', 'Нужное количество', 'Проверка качества']
  }
];

const COMMON_ADVANTAGES: Advantage[] = [
  {
    icon: 'person',
    title: 'Профессиональный фотограф',
    description: 'Съёмка проводится опытным фотографом-портретистом'
  },
  {
    icon: 'brush',
    title: 'Художественная обработка',
    description: 'Индивидуальная ретушь с учётом ваших пожеланий'
  },
  {
    icon: 'camera_enhance',
    title: 'Профессиональное оборудование',
    description: 'Студийный свет и камеры высокого класса'
  },
  {
    icon: 'favorite',
    title: 'Красивый результат',
    description: 'Создаём портреты, которыми вы будете гордиться'
  },
  {
    icon: 'photo_library',
    title: 'Выбор лучшего кадра',
    description: 'Фотографируем несколько вариантов, выбираете лучший'
  },
  {
    icon: 'verified',
    title: 'Гарантия принятия',
    description: 'Принимают во всех учреждениях без вопросов'
  }
];

const COMMON_PHOTO_SAMPLES = [
  { src: '/assets/images/passport-photo (1).webp', alt: 'Фото на документы - образец 1', description: 'Профессиональное фото' },
  { src: '/assets/images/passport-photo (2).webp', alt: 'Фото на документы - образец 2', description: 'Качественная ретушь' },
  { src: '/assets/images/passport-photo (7).webp', alt: 'Фото на документы - образец 3', description: 'Идеальный свет' },
  { src: '/assets/images/passport 3 (4).webp', alt: 'Фото на документы - образец 4', description: 'Естественный результат' }
];

/**
 * Фото на паспорт РФ
 */
export const FOTO_NA_PASPORT: LandingPageData = {
  slug: 'foto-na-pasport',
  title: 'Фото на паспорт РФ',
  metaTitle: 'Фото на паспорт РФ в Ростове-на-Дону | Онлайн от 700₽, в студии 700₽ | Своё Фото',
  metaDescription: 'Красивое фото на паспорт РФ: онлайн от 700₽ или в студии за 700₽. Профессиональная съёмка, художественная ретушь, соответствие ГОСТ. Готово за 15 минут.',
  canonicalUrl: '/foto-na-pasport',

  heroTitle: 'в Своё Фото',
  heroHighlight: 'Фото на паспорт РФ',
  heroSubtitle: 'Профессиональная съёмка для российского паспорта с индивидуальной ретушью. Соответствие требованиям ГОСТ. Готово за 15 минут.',
  heroBenefits: [
    { icon: 'verified', text: '100% соответствие ГОСТ' },
    { icon: 'brush', text: 'Художественная ретушь' },
    { icon: 'schedule', text: 'Готово за 15 минут' }
  ],
  heroCtaText: 'Записаться на съёмку',
  heroImage: '/assets/static/promo/foto-na-pasport.webp',

  price: 700,
  priceLabel: 'Онлайн от',
  urgentPrice: 700,
  urgentLabel: 'В студии (комплект)',

  serviceType: 'Фото на паспорт РФ',
  specifications: [
    { label: 'Размер', value: '35×45 мм' },
    { label: 'Фон', value: 'Белый' },
    { label: 'Количество', value: '4 шт' },
    { label: 'Стандарт', value: 'ГОСТ Р 6.30-2003' }
  ],
  requirements: [
    'Белый фон без теней',
    'Размер 35×45 мм',
    'Лицо занимает 70-80% кадра',
    'Взгляд направлен в камеру',
    'Нейтральное выражение лица',
    'Без головных уборов (кроме религиозных)',
    'Чёткое изображение высокого качества',
    'Печать на матовой фотобумаге'
  ],

  photoSamples: COMMON_PHOTO_SAMPLES,
  galleryTitle: 'Наши работы',
  gallerySubtitle: 'Примеры красивых фото на документы',

  processSteps: COMMON_PROCESS_STEPS,
  processTitle: 'Как проходит съёмка',

  advantages: COMMON_ADVANTAGES,
  advantagesTitle: 'Почему выбирают нас',
  advantagesSubtitle: 'Профессиональный подход к каждой фотосессии',

  faqItems: [
    {
      question: 'Какие требования к фото на паспорт РФ?',
      answer: 'Размер 35×45 мм, белый фон, лицо занимает 70-80% кадра. Мы гарантируем полное соответствие требованиям ГОСТ.'
    },
    {
      question: 'Сколько фотографий нужно на паспорт?',
      answer: 'Для оформления паспорта РФ нужно 4 фотографии. Мы делаем именно это количество.'
    },
    {
      question: 'Можно ли фотографироваться в очках?',
      answer: 'Да, если вы постоянно носите очки. Но оправа не должна закрывать глаза, а линзы не должны бликовать.'
    },
    {
      question: 'Принимают ли ваши фото в МФЦ и паспортном столе?',
      answer: 'Да, мы гарантируем, что фото примут. Если по нашей вине не примут, переснимем бесплатно.'
    }
  ],

  relatedServices: [
    { title: 'Фото на загранпаспорт', url: '/foto-na-zagran', price: 700, icon: 'flight_takeoff' },
    { title: 'Фото на визу', url: '/foto-na-vizu', price: 700, icon: 'public' },
    { title: 'Фото на права', url: '/foto-na-document', price: 700, icon: 'directions_car' }
  ],

  schemaType: 'PhotoService'
};

/**
 * Фото на загранпаспорт
 */
export const FOTO_NA_ZAGRAN: LandingPageData = {
  slug: 'foto-na-zagran',
  title: 'Фото на загранпаспорт',
  metaTitle: 'Фото на загранпаспорт в Ростове-на-Дону | Онлайн от 700₽, в студии 700₽ | Своё Фото',
  metaDescription: 'Фото на загранпаспорт нового образца: онлайн от 700₽ или в студии за 700₽. Биометрические требования, профессиональная съёмка.',
  canonicalUrl: '/foto-na-zagran',

  heroTitle: 'в Своё Фото',
  heroHighlight: 'Фото на загранпаспорт',
  heroSubtitle: 'Биометрическое фото для загранпаспорта, которое примут с первого раза. Знаем стандарты МВД и Госдепартамента, без повторных визитов.',
  heroBenefits: [
    { icon: 'verified', text: 'Биометрические стандарты' },
    { icon: 'brush', text: 'Естественная ретушь' },
    { icon: 'flight_takeoff', text: 'Для любой страны' }
  ],
  heroCtaText: 'Записаться на съёмку',
  heroImage: '/assets/static/promo/foto-na-zagran.webp',

  price: 700,
  priceLabel: 'Онлайн от',
  urgentPrice: 700,
  urgentLabel: 'В студии (комплект)',

  serviceType: 'Фото на загранпаспорт',
  specifications: [
    { label: 'Размер', value: '35×45 мм' },
    { label: 'Фон', value: 'Белый' },
    { label: 'Количество', value: '4 шт' },
    { label: 'Стандарт', value: 'ICAO / ГОСТ' }
  ],
  requirements: [
    'Белый фон без теней',
    'Размер 35×45 мм (биометрический)',
    'Лицо в центре кадра',
    'Нейтральное выражение, рот закрыт',
    'Глаза открыты, видны полностью',
    'Без головных уборов',
    'Высокое разрешение',
    'Матовая фотобумага'
  ],

  photoSamples: COMMON_PHOTO_SAMPLES,
  galleryTitle: 'Наши работы',
  gallerySubtitle: 'Примеры красивых фото на документы',

  processSteps: COMMON_PROCESS_STEPS,
  processTitle: 'Как проходит съёмка',

  advantages: COMMON_ADVANTAGES,
  advantagesTitle: 'Почему выбирают нас',
  advantagesSubtitle: 'Профессиональный подход к каждой фотосессии',

  faqItems: [
    {
      question: 'Чем отличается фото на загранпаспорт от обычного?',
      answer: 'Загранпаспорт требует строгого соблюдения биометрических стандартов ICAO, точное положение головы, нейтральное выражение, определённые пропорции лица в кадре.'
    },
    {
      question: 'Подойдёт ли фото для загранпаспорта нового образца?',
      answer: 'Да, мы делаем фото, соответствующее требованиям как старого, так и нового (биометрического) загранпаспорта.'
    },
    {
      question: 'Можно ли использовать это фото для визы?',
      answer: 'Да, наше фото подходит для большинства виз. Но для некоторых стран (США, Китай) есть особые требования, уточните заранее.'
    }
  ],

  relatedServices: [
    { title: 'Фото на паспорт РФ', url: '/foto-na-pasport', price: 700, icon: 'assignment_ind' },
    { title: 'Фото на визу', url: '/foto-na-vizu', price: 700, icon: 'public' },
    { title: 'Фото на Грин-Карту', url: '/foto-na-green-card', price: 950, icon: 'card_membership' }
  ],

  schemaType: 'PhotoService'
};

/**
 * Фото на визу
 */
export const FOTO_NA_VIZU: LandingPageData = {
  slug: 'foto-na-vizu',
  title: 'Фото на визу',
  metaTitle: 'Фото на визу США, Шенген, Китай в Ростове | Онлайн от 700₽, в студии 700₽ | Своё Фото',
  metaDescription: 'Профессиональное фото на визу любой страны: США, Шенген, Китай, Великобритания. Знаем все требования. Онлайн от 700₽, в студии 700₽.',
  canonicalUrl: '/foto-na-vizu',

  heroTitle: 'в Своё Фото',
  heroHighlight: 'Фото на визу',
  heroSubtitle: 'Визовое фото без риска отказа из-за формата. Знаем требования 50+ стран, США, Шенген, Китай, Великобритания. Готово за 15 минут.',
  heroBenefits: [
    { icon: 'public', text: 'Любая страна мира' },
    { icon: 'verified', text: 'Знаем все требования' },
    { icon: 'replay', text: 'Гарантия принятия' }
  ],
  heroCtaText: 'Записаться на съёмку',
  heroImage: '/assets/static/promo/foto-na-vizu.webp',

  price: 700,
  priceLabel: 'Онлайн от',
  urgentPrice: 700,
  urgentLabel: 'В студии (комплект)',

  serviceType: 'Фото на визу',
  specifications: [
    { label: 'США', value: '51×51 мм' },
    { label: 'Шенген', value: '35×45 мм' },
    { label: 'Китай', value: '33×48 мм' },
    { label: 'UK', value: '35×45 мм' }
  ],
  requirements: [
    'Строгое соответствие требованиям страны',
    'Правильный размер и пропорции',
    'Нужный цвет фона (белый/светло-серый)',
    'Нейтральное выражение лица',
    'Качественная печать',
    'Электронная версия (при необходимости)'
  ],

  photoSamples: COMMON_PHOTO_SAMPLES,
  galleryTitle: 'Наши работы',
  gallerySubtitle: 'Примеры красивых фото на документы',

  processSteps: COMMON_PROCESS_STEPS,
  processTitle: 'Как проходит съёмка',

  advantages: COMMON_ADVANTAGES,
  advantagesTitle: 'Почему выбирают нас',
  advantagesSubtitle: 'Профессиональный подход к каждой фотосессии',

  faqItems: [
    {
      question: 'Какие требования к фото на визу США?',
      answer: 'Размер 51×51 мм (2×2 дюйма), белый фон, нейтральное выражение. Мы знаем все нюансы и гарантируем принятие.'
    },
    {
      question: 'Делаете ли электронную версию фото?',
      answer: 'Да, для онлайн-заявок на визу США и других стран мы предоставляем электронную версию нужного размера и формата.'
    },
    {
      question: 'Что если фото не примут в посольстве?',
      answer: 'Если фото не примут по нашей вине, переснимем бесплатно. За 10 лет работы таких случаев не было.'
    }
  ],

  relatedServices: [
    { title: 'Фото на загранпаспорт', url: '/foto-na-zagran', price: 700, icon: 'flight_takeoff' },
    { title: 'Фото на Грин-Карту', url: '/foto-na-green-card', price: 950, icon: 'card_membership' },
    { title: 'Фото на паспорт', url: '/foto-na-pasport', price: 700, icon: 'assignment_ind' }
  ],

  schemaType: 'PhotoService'
};

/**
 * Фото на Грин-Карту
 */
export const FOTO_NA_GREEN_CARD: LandingPageData = {
  slug: 'foto-na-green-card',
  title: 'Фото на Грин-Карту',
  metaTitle: 'Фото на Грин-Карту (Green Card) в Ростове | 950₽ онлайн, 700₽ в студии | Своё Фото',
  metaDescription: 'Фото на Грин-Карту США по требованиям Госдепартамента. Электронная версия для лотереи DV. 950₽ онлайн, 700₽ в студии.',
  canonicalUrl: '/foto-na-green-card',

  heroTitle: 'в Своё Фото',
  heroHighlight: 'Фото на Грин-Карту',
  heroSubtitle: 'Фото для Green Card точно по стандартам Госдепартамента США. Малейшая ошибка в размере или фоне, и заявку отклонят. Мы этого не допустим.',
  heroBenefits: [
    { icon: 'check_circle', text: 'Требования Госдепа США' },
    { icon: 'cloud_upload', text: 'Электронная версия' },
    { icon: 'verified', text: 'Проверка перед отправкой' }
  ],
  heroCtaText: 'Записаться на съёмку',
  heroImage: '/assets/static/promo/foto-na-vizu.webp',

  price: 950,
  priceLabel: 'Онлайн',
  urgentPrice: 700,
  urgentLabel: 'В студии (комплект)',

  serviceType: 'Фото на Грин-Карту',
  specifications: [
    { label: 'Размер', value: '600×600 px' },
    { label: 'Формат', value: 'JPEG' },
    { label: 'Размер файла', value: '≤240 КБ' },
    { label: 'Фон', value: 'Белый' }
  ],
  requirements: [
    'Размер 600×600 пикселей',
    'Формат JPEG, до 240 КБ',
    'Белый или почти белый фон',
    'Голова в центре кадра',
    'Нейтральное выражение',
    'Фото сделано в последние 6 месяцев'
  ],

  photoSamples: COMMON_PHOTO_SAMPLES,
  galleryTitle: 'Наши работы',
  gallerySubtitle: 'Примеры красивых фото на документы',

  processSteps: COMMON_PROCESS_STEPS,
  processTitle: 'Как проходит съёмка',

  advantages: COMMON_ADVANTAGES,
  advantagesTitle: 'Почему выбирают нас',
  advantagesSubtitle: 'Профессиональный подход к каждой фотосессии',

  faqItems: [
    {
      question: 'Какие точные требования к фото на Green Card?',
      answer: '600×600 пикселей, JPEG до 240 КБ, белый фон, голова занимает 50-69% высоты кадра, нейтральное выражение, сделано в последние 6 месяцев.'
    },
    {
      question: 'Получу ли я электронный файл?',
      answer: 'Да, вы получите файл в нужном формате для загрузки на сайт лотереи DV, а также печатную версию.'
    },
    {
      question: 'Проверяете ли фото перед отправкой?',
      answer: 'Да, мы проверяем фото специальным валидатором, чтобы гарантировать соответствие требованиям.'
    }
  ],

  relatedServices: [
    { title: 'Фото на визу США', url: '/foto-na-vizu', price: 700, icon: 'public' },
    { title: 'Фото на загранпаспорт', url: '/foto-na-zagran', price: 700, icon: 'flight_takeoff' },
    { title: 'Портретная съёмка', url: '/portretnaya-sjomka', price: 900, icon: 'person' }
  ],

  schemaType: 'PhotoService'
};

/**
 * Фото на студенческий билет
 */
export const FOTO_NA_STUDENCHESKIY: LandingPageData = {
  slug: 'foto-na-studencheskiy',
  title: 'Фото на студенческий билет',
  metaTitle: 'Фото на студенческий билет в Ростове | Онлайн от 700₽, в студии 700₽ | Своё Фото',
  metaDescription: 'Фото на студенческий билет, зачётку и пропуск: онлайн от 700₽ или съёмка в студии за 700₽. Несколько кадров, светлый фон и естественная ретушь.',
  canonicalUrl: '/foto-na-studencheskiy',

  heroTitle: 'которое выглядит аккуратно',
  heroHighlight: 'Фото на студенческий,',
  heroSubtitle: 'Для студенческого билета, зачётки, пропуска и личного дела. Делаем несколько кадров, подбираем свет, готовим нужный размер и печатаем комплект в студии.',
  heroBenefits: [
    { icon: 'school', text: 'Под требования вуза' },
    { icon: 'photo_camera', text: 'Несколько кадров' },
    { icon: 'brush', text: 'Естественная ретушь' }
  ],
  heroCtaText: 'Записаться на съёмку',
  heroImage: '/assets/static/promo/foto-na-studencheskiy.webp',

  price: 700,
  priceLabel: 'Онлайн от',
  urgentPrice: 700,
  urgentLabel: 'В студии',

  serviceType: 'Фото на студенческий билет',
  specifications: [
    { label: 'Размер', value: '30×40 мм' },
    { label: 'Фон', value: 'Светлый' },
    { label: 'Количество', value: '4 шт' },
    { label: 'Формат', value: 'Печать и файл' }
  ],
  requirements: [
    'Фото подходит для студенческого билета, зачётки, пропуска и личного дела',
    'Стандартный размер 30×40 мм или размер по требованиям вашего вуза',
    'Светлый однотонный фон без резких теней',
    'Спокойная одежда без крупных логотипов и ярких принтов',
    'Аккуратная кадрировка лица и плеч',
    'Естественная ретушь без эффекта фильтра'
  ],

  photoSamples: COMMON_PHOTO_SAMPLES,
  galleryTitle: 'Наши работы',
  gallerySubtitle: 'Примеры красивых фото на документы',

  processSteps: COMMON_PROCESS_STEPS,
  processTitle: 'Как проходит съёмка',

  advantages: COMMON_ADVANTAGES,
  advantagesTitle: 'Почему выбирают нас',
  advantagesSubtitle: 'Профессиональный подход к каждой фотосессии',

  faqItems: [
    {
      question: 'Какой дресс-код для фото на студенческий?',
      answer: 'Рекомендуем спокойную однотонную одежду без крупных логотипов и слишком ярких деталей. Для большинства вузов строгий деловой стиль не обязателен.'
    },
    {
      question: 'Подойдёт ли фото для любого вуза?',
      answer: 'Да, для стандартных требований подойдёт. Если учебное заведение прислало точный размер или фон, покажите требования перед съёмкой.'
    },
    {
      question: 'Сколько стоит фото на студенческий?',
      answer: 'Онлайн-подготовка фото на документы начинается от 700₽. Съёмка и печатный комплект в студии стоят 700₽.'
    },
    {
      question: 'Можно получить электронную версию?',
      answer: 'Да, можем подготовить файл для отправки в деканат, личный кабинет вуза или онлайн-анкету.'
    }
  ],

  relatedServices: [
    { title: 'Фото на паспорт', url: '/foto-na-pasport', price: 700, icon: 'assignment_ind' },
    { title: 'Портретная съёмка', url: '/portretnaya-sjomka', price: 900, icon: 'person' }
  ],

  schemaType: 'PhotoService'
};

// Экспорт всех данных группы "Фото на документы"
export const DOCUMENT_PHOTOS_DATA: Record<string, LandingPageData> = {
  'foto-na-pasport': FOTO_NA_PASPORT,
  'foto-na-zagran': FOTO_NA_ZAGRAN,
  'foto-na-vizu': FOTO_NA_VIZU,
  'foto-na-green-card': FOTO_NA_GREEN_CARD,
  'foto-na-studencheskiy': FOTO_NA_STUDENCHESKIY
};
