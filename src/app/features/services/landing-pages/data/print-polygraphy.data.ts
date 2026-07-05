import { LandingPageData, ProcessStep, Advantage } from '../landing-page.interface';

/**
 * Группа 4: Печать и полиграфия
 */

const OFFICE_PROCESS_STEPS: ProcessStep[] = [
  {
    number: 1,
    title: 'Приносите файл',
    description: 'На флешке, телефоне или отправляете онлайн',
    icon: 'upload_file',
    details: ['Любой формат', 'С любого устройства', 'Или принесите оригинал']
  },
  {
    number: 2,
    title: 'Проверка',
    description: 'Проверяем файл и настройки',
    icon: 'check_circle',
    details: ['Качество файла', 'Размер', 'Параметры печати']
  },
  {
    number: 3,
    title: 'Выполнение',
    description: 'Делаем работу на современном оборудовании',
    icon: 'print',
    details: ['Быстро', 'Качественно', 'Точно']
  },
  {
    number: 4,
    title: 'Готово!',
    description: 'Забирайте результат',
    icon: 'check',
    details: ['Проверка качества', 'Оплата']
  }
];

const OFFICE_ADVANTAGES: Advantage[] = [
  { icon: 'schedule', title: 'Быстро', description: 'Большинство заказов за 5-10 минут' },
  { icon: 'savings', title: 'Доступно', description: 'Честные цены без накруток' },
  { icon: 'location_on', title: 'Удобно', description: 'В центре города' },
  { icon: 'high_quality', title: 'Качественно', description: 'Современное оборудование' }
];

/**
 * Визитки
 */
export const VIZITKI: LandingPageData = {
  slug: 'vizitki',
  title: 'Визитки',
  metaTitle: 'Печать визиток в Ростове-на-Дону | от 600₽ за 100 шт | Своё Фото',
  metaDescription: 'Печать визиток от 600₽ за 100 штук. Бумажные и пластиковые. Дизайн, печать, готово за 1-2 дня.',
  canonicalUrl: '/vizitki',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать визиток',
  heroSubtitle: 'Визитки, которые оставляют на столе, а не выбрасывают. Профессиональный дизайн + качественная бумага, первый контакт запомнится.',
  heroBenefits: [
    { icon: 'business_center', text: 'Деловой имидж' },
    { icon: 'palette', text: 'Дизайн на выбор' },
    { icon: 'schedule', text: 'Готово за 1-2 дня' }
  ],
  heroCtaText: 'Заказать визитки',
  heroImage: '/assets/static/promo/vizitki.webp',
  
  price: 600,
  priceLabel: '100 шт бумажные',
  
  serviceType: 'Печать визиток',
  specifications: [
    { label: 'Бумага 100 шт', value: '600₽' },
    { label: 'Пластик 50 шт', value: '1000₽' },
    { label: 'Дизайн', value: 'от 500₽' },
    { label: 'Срок', value: '1-2 дня' }
  ],
  requirements: [
    'Готовый макет или закажите дизайн у нас',
    'Формат визитки 90×50 мм',
    'Файлы PDF, AI, PSD, CDR',
    'Текст желательно в кривых'
  ],
  requirementsTitle: 'Что нужно для заказа',
  
  photoSamples: [], // Нет фото для визиток
  galleryTitle: 'Примеры визиток',
  
  processSteps: [
    { number: 1, title: 'Макет', description: 'Приносите готовый или заказываете дизайн', icon: 'design_services', details: ['Готовый макет', 'Или создадим для вас'] },
    { number: 2, title: 'Согласование', description: 'Утверждаем макет перед печатью', icon: 'thumb_up', details: ['Проверка текста', 'Цветопроба'] },
    { number: 3, title: 'Печать', description: 'Печатаем на качественной бумаге или пластике', icon: 'print', details: ['Бумага 300 г/м²', 'Пластик'] },
    { number: 4, title: 'Резка', description: 'Точная резка на специальном оборудовании', icon: 'content_cut', details: ['Ровные края', 'Точный размер'] },
    { number: 5, title: 'Готово!', description: 'Забирайте ваши визитки', icon: 'check_circle', details: ['Упаковка', 'Проверка качества'] }
  ],
  processTitle: 'Как мы печатаем визитки',
  
  advantages: [
    { icon: 'high_quality', title: 'Качественная печать', description: 'Чёткие цвета и текст' },
    { icon: 'palette', title: 'Дизайн на выбор', description: 'Шаблоны или индивидуальный' },
    { icon: 'schedule', title: 'Быстро', description: 'Готово за 1-2 дня' },
    { icon: 'savings', title: 'Выгодно', description: 'От 6₽ за визитку' }
  ],
  advantagesTitle: 'Почему заказывают у нас',
  advantagesSubtitle: 'Качество и скорость для вашего бизнеса',
  
  faqItems: [
    { question: 'Можете сделать дизайн визитки?', answer: 'Да, создаём дизайн визиток от 500₽. Есть готовые шаблоны или сделаем индивидуальный дизайн.' },
    { question: 'Какой минимальный тираж?', answer: '50 штук для пластиковых, 100 штук для бумажных визиток.' },
    { question: 'Какая бумага используется?', answer: 'Мелованная бумага 300 г/м², плотная и презентабельная. Для пластиковых, ПВХ 0.76 мм.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С макетом или за консультацией',
    primaryIcon: 'store',
    secondaryTitle: 'Отправить макет онлайн',
    secondaryDescription: 'Через Telegram или МАКС',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Нужны визитки?',
    subtitle: 'Приходите в студию или отправьте макет онлайн!',
    primaryButtonText: 'Связаться с нами',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 600₽ за 100 штук, качественная печать за 1-2 дня!'
  },
  
  relatedServices: [
    { title: 'Печать документов', url: '/pechat-dokumentov', price: 10, icon: 'print' },
    { title: 'Ламинирование', url: '/laminirovanie', price: 100, icon: 'layers' }
  ],
  
  schemaType: 'PrintService'
};

/**
 * Печать документов
 */
export const PECHAT_DOKUMENTOV: LandingPageData = {
  slug: 'pechat-dokumentov',
  title: 'Печать документов',
  metaTitle: 'Печать документов А4 в Ростове | ЧБ 10₽, Цвет 15₽ | Своё Фото',
  metaDescription: 'Печать документов А4: чёрно-белая 10₽, цветная 15₽. С флешки, телефона, email. Быстро, в центре города.',
  canonicalUrl: '/pechat-dokumentov',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Печать документов',
  heroSubtitle: 'Печать документов в центре Ростова, с флешки, телефона или по email. Без записи, без очередей. От 10₽ за лист.',
  heroBenefits: [
    { icon: 'print', text: 'Любые документы' },
    { icon: 'schedule', text: 'За 5 минут' },
    { icon: 'savings', text: 'Всего от 10₽' }
  ],
  heroCtaText: 'Распечатать',
  heroImage: '/assets/static/promo/pechat-dokumentov.webp',
  
  price: 10,
  priceLabel: 'А4 чёрно-белая',
  
  serviceType: 'Печать документов',
  specifications: [
    { label: 'А4 ЧБ', value: '10₽' },
    { label: 'А4 Цвет', value: '15₽' },
    { label: 'А3 ЧБ', value: '20₽' },
    { label: 'А3 Цвет', value: '30₽' }
  ],
  requirements: [
    'Файлы PDF, DOC, DOCX, XLS, JPG',
    'С флешки, телефона или email',
    'Минимум 1 страница'
  ],
  requirementsTitle: 'Что принести',
  
  photoSamples: [],
  processSteps: OFFICE_PROCESS_STEPS,
  processTitle: 'Как это работает',
  advantages: OFFICE_ADVANTAGES,
  advantagesTitle: 'Наши преимущества',
  advantagesSubtitle: 'Быстро, удобно, качественно',
  
  faqItems: [
    { question: 'Можно распечатать с телефона?', answer: 'Да! Отправьте файл через Telegram или МАКС, мы распечатаем.' },
    { question: 'Есть ли двусторонняя печать?', answer: 'Да, двусторонняя печать доступна.' },
    { question: 'Какие форматы принимаете?', answer: 'PDF, Word, Excel, изображения. Практически любые офисные форматы.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С флешкой или распечатаем с телефона',
    primaryIcon: 'store',
    secondaryTitle: 'Отправить файл онлайн',
    secondaryDescription: 'Через Telegram или МАКС',
    secondaryIcon: 'send'
  },

  cta: {
    title: 'Нужно распечатать документы?',
    subtitle: 'Приходите, сделаем за 5 минут!',
    primaryButtonText: 'Как добраться',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 10₽ за страницу, быстро и качественно!'
  },
  
  relatedServices: [
    { title: 'Ксерокопия', url: '/kserokopiya', price: 10, icon: 'content_copy' },
    { title: 'Ламинирование', url: '/laminirovanie', price: 100, icon: 'layers' },
    { title: 'Сканирование', url: '/skanirovanie', price: 50, icon: 'scanner' }
  ],
  
  schemaType: 'PrintService'
};

/**
 * Переплёт на пластиковую пружину
 */
export const PEREPLET_NA_PLASTIKOVUYU_PRUZHINU: LandingPageData = {
  slug: 'pereplet-na-plastikovuyu-pruzhinu',
  title: 'Переплёт на пластиковую пружину А4',
  metaTitle: 'Печать А4 от 3 ₽ и переплёт на пластиковую пружину | Своё Фото',
  metaDescription: 'Печать А4 от 3 ₽ за страницу и переплёт документов на пластиковую пружину А4 в центре Ростова для подтверждённых образовательных клиентов. Курсовые, отчёты, методички и ВКР.',
  canonicalUrl: '/pereplet-na-plastikovuyu-pruzhinu',

  heroTitle: 'страницу А4',
  heroHighlight: 'Всего 3 ₽ за',
  heroSubtitle: 'Копеечная учебная цена для курсовых, отчётов, методичек и ВКР: печать А4 от 3 ₽ за страницу после подтверждения образовательного статуса. Переплёт на пластиковую пружину, 10 ₽.',
  heroBenefits: [
    { icon: 'print', text: 'Печать А4 от 3 ₽' },
    { icon: 'savings', text: 'Переплёт 10 ₽' },
    { icon: 'schedule', text: 'Около 10 минут' }
  ],
  heroCtaText: 'Загрузить файл',
  heroImage: '/assets/static/education-smart/card-binding.webp',

  price: 100,
  priceLabel: 'обычная цена',

  serviceType: 'Переплёт документов на пластиковую пружину А4',
  specifications: [
    { label: 'Печать для учёбы', value: 'А4 от 3 ₽/лист' },
    { label: 'Переплёт для учёбы', value: '10 ₽ за 1 переплёт' },
    { label: 'Обычная цена', value: 'от 100 ₽' },
    { label: 'Формат', value: 'А4, пластиковая пружина' },
    { label: 'Срок', value: 'около 10 минут' },
    { label: 'Доступ', value: 'после проверки статуса' }
  ],
  requirements: [
    'Файл PDF, DOC, DOCX или уже распечатанный комплект листов А4',
    'Страницы должны быть в нужном порядке',
    'Скажите заранее, нужна ли распечатка: односторонняя или двусторонняя',
    'Для ВКР и дипломных работ проверьте требования вашего вуза к виду оформления',
    'Учебная цена применяется к подтверждённому образовательному профилю'
  ],
  requirementsTitle: 'Что подготовить',

  photoSamples: [],
  processSteps: [
    {
      number: 1,
      title: 'Отправляете файл',
      description: 'Загрузите документ в заказ или принесите листы в студию.',
      icon: 'upload_file',
      details: ['PDF, Word или готовая пачка А4', 'От 1 экземпляра']
    },
    {
      number: 2,
      title: 'Проверяем листы',
      description: 'Уточняем порядок страниц, печать и толщину пружины.',
      icon: 'fact_check',
      details: ['А4', 'Пластиковая пружина', 'Обложка по наличию']
    },
    {
      number: 3,
      title: 'Переплетаем',
      description: 'Собираем документ на пластиковую пружину.',
      icon: 'article',
      details: ['Аккуратный край', 'Удобно листать']
    },
    {
      number: 4,
      title: 'Вы забираете',
      description: 'Готовую работу можно забрать в студии.',
      icon: 'task_alt',
      details: ['Обычно около 10 минут', 'Оплата при выдаче']
    }
  ],
  processTitle: 'Как оформить переплёт',

  advantages: [
    { icon: 'school', title: 'Под учебные работы', description: 'Курсовые, отчёты по практике, методички, ВКР и рефераты.' },
    { icon: 'print', title: 'А4 от 3 ₽ за страницу', description: 'Учебная цена для подтверждённых образовательных клиентов.' },
    { icon: 'payments', title: 'Переплёт 10 ₽', description: 'Один переплёт на пластиковую пружину за период доступа.' },
    { icon: 'location_on', title: 'Центр Ростова', description: 'Удобно забрать по пути на учёбу или работу.' }
  ],
  advantagesTitle: 'Почему удобно',
  advantagesSubtitle: 'Только пластиковая пружина А4 и понятные условия',

  faqItems: [
    {
      question: 'Сколько стоит переплёт?',
      answer: 'Обычная цена начинается от 100 ₽. Для подтверждённых образовательных клиентов с активным доступом один переплёт на пластиковую пружину стоит 10 ₽.'
    },
    {
      question: 'Какая цена печати для учёбы?',
      answer: 'В образовательном доступе ч/б А4 стоит от 3 ₽ за лист, цветной А4, от 4 ₽, страницы с плотной заливкой считаются по сетке 8/12/18 ₽.'
    },
    {
      question: 'Как получить учебную цену?',
      answer: 'Подтвердите образовательный статус в профиле. После проверки учебные цены применяются в заказах автоматически.'
    },
    {
      question: 'Можно переплести ВКР или дипломную работу?',
      answer: 'Да, если такой вид оформления принимает ваш вуз. Перед заказом уточните требования кафедры.'
    },
    {
      question: 'Можно принести уже распечатанные листы?',
      answer: 'Да. Проверьте порядок страниц и принесите комплект А4, мы соберём его на пластиковую пружину.'
    }
  ],

  quickActions: {
    primaryTitle: 'Загрузить файл',
    primaryDescription: 'Создать заказ на переплёт без входа в кабинет',
    primaryIcon: 'upload_file',
    secondaryTitle: 'Приехать в студию',
    secondaryDescription: 'С файлом или готовыми листами А4',
    secondaryIcon: 'store'
  },

  cta: {
    title: 'Распечатать и переплести?',
    subtitle: 'Загрузите файл в заказ или приезжайте с готовыми листами А4.',
    primaryButtonText: 'Загрузить файл',
    secondaryButtonText: 'Позвонить',
    urgencyText: 'Учебная цена: печать А4 от 3 ₽ за страницу, переплёт 10 ₽.'
  },

  relatedServices: [
    { title: 'Печать документов', url: '/pechat-dokumentov', price: 10, icon: 'print' },
    { title: 'Учебные цены', url: '/education', price: 3, icon: 'school' },
    { title: 'Ксерокопия', url: '/kserokopiya', price: 10, icon: 'content_copy' },
    { title: 'Сканирование', url: '/skanirovanie', price: 50, icon: 'scanner' }
  ],

  schemaType: 'PrintService',
  serviceMode: 'studio'
};

/**
 * Ксерокопия
 */
export const KSEROKOPIYA: LandingPageData = {
  slug: 'kserokopiya',
  title: 'Ксерокопия',
  metaTitle: 'Ксерокопия документов в Ростове | ЧБ 10₽, Цвет 15₽ | Своё Фото',
  metaDescription: 'Ксерокопия документов: чёрно-белая 10₽, цветная 15₽. Паспорта, документы, книги. Быстро и качественно.',
  canonicalUrl: '/kserokopiya',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Ксерокопия документов',
  heroSubtitle: 'Ксерокопия за 1 минуту, паспорта, договоры, книги. От 3₽ за страницу, запись не нужна, приходите прямо сейчас.',
  heroBenefits: [
    { icon: 'content_copy', text: 'Любые документы' },
    { icon: 'schedule', text: 'Моментально' },
    { icon: 'savings', text: 'Всего от 10₽' }
  ],
  heroCtaText: 'Сделать копию',
  heroImage: '/assets/static/promo/kserokopiya.webp',
  
  price: 10,
  priceLabel: 'А4 чёрно-белая',
  
  serviceType: 'Ксерокопия',
  specifications: [
    { label: 'А4 ЧБ', value: '10₽' },
    { label: 'А4 Цвет', value: '15₽' },
    { label: 'А3 ЧБ', value: '20₽' },
    { label: 'А3 Цвет', value: '30₽' }
  ],
  requirements: ['Оригинал документа', 'В хорошем состоянии'],
  requirementsTitle: 'Что принести',
  
  photoSamples: [],
  processSteps: OFFICE_PROCESS_STEPS,
  processTitle: 'Как это работает',
  advantages: OFFICE_ADVANTAGES,
  advantagesTitle: 'Наши преимущества',
  advantagesSubtitle: 'Быстро, удобно, качественно',
  
  faqItems: [
    { question: 'Можно скопировать паспорт?', answer: 'Да, делаем копии паспортов. Можем разместить разворот на одну страницу.' },
    { question: 'Есть ли увеличение/уменьшение?', answer: 'Да, можем изменить масштаб от 50% до 400%.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С документами для копирования',
    primaryIcon: 'store',
    secondaryTitle: 'Уточнить детали',
    secondaryDescription: 'По телефону или в мессенджере',
    secondaryIcon: 'chat'
  },
  
  cta: {
    title: 'Нужна ксерокопия?',
    subtitle: 'Приходите, сделаем моментально!',
    primaryButtonText: 'Как добраться',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 10₽ за страницу, быстро и качественно!'
  },
  
  relatedServices: [
    { title: 'Печать документов', url: '/pechat-dokumentov', price: 10, icon: 'print' },
    { title: 'Сканирование', url: '/skanirovanie', price: 50, icon: 'scanner' }
  ],
  
  schemaType: 'PrintService'
};

/**
 * Ламинирование
 */
export const LAMINIROVANIE: LandingPageData = {
  slug: 'laminirovanie',
  title: 'Ламинирование',
  metaTitle: 'Ламинирование документов в Ростове | 100₽ | Своё Фото',
  metaDescription: 'Ламинирование документов от 100₽. Защита от воды и износа. Готово за 5 минут.',
  canonicalUrl: '/laminirovanie',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Ламинирование',
  heroSubtitle: 'Защитите документ от воды, грязи и износа. Пропуск, диплом, свидетельство, заламинируем за 5 минут, сохранится как новый.',
  heroBenefits: [
    { icon: 'shield', text: 'Защита документа' },
    { icon: 'water_drop', text: 'Водостойкость' },
    { icon: 'schedule', text: 'За 5 минут' }
  ],
  heroCtaText: 'Заламинировать',
  heroImage: '/assets/static/promo/laminirovanie.webp',
  
  price: 100,
  priceLabel: 'А4 формат',
  
  serviceType: 'Ламинирование',
  specifications: [
    { label: 'А4', value: '100₽' },
    { label: 'А5', value: '70₽' },
    { label: 'А6', value: '50₽' },
    { label: 'Визитка', value: '30₽' }
  ],
  requirements: ['Документ или фото', 'Размер не больше А3'],
  requirementsTitle: 'Что можно заламинировать',
  
  photoSamples: [],
  processSteps: OFFICE_PROCESS_STEPS,
  processTitle: 'Как это работает',
  advantages: [
    { icon: 'shield', title: 'Защита', description: 'От воды, грязи, повреждений' },
    { icon: 'history', title: 'Долговечность', description: 'Документ сохранится надолго' },
    { icon: 'schedule', title: 'Быстро', description: 'Готово за 5 минут' },
    { icon: 'savings', title: 'Доступно', description: 'От 30₽' }
  ],
  advantagesTitle: 'Зачем ламинировать',
  advantagesSubtitle: 'Сохраните важные документы надолго',
  
  faqItems: [
    { question: 'Какие документы можно ламинировать?', answer: 'Практически любые: грамоты, справки, меню, ценники, инструкции, фотографии.' },
    { question: 'Можно ли потом внести изменения?', answer: 'Нет, ламинирование, необратимый процесс. Убедитесь в правильности документа перед ламинированием.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С документами для ламинирования',
    primaryIcon: 'store',
    secondaryTitle: 'Уточнить детали',
    secondaryDescription: 'По телефону или в мессенджере',
    secondaryIcon: 'chat'
  },
  
  cta: {
    title: 'Нужно заламинировать документ?',
    subtitle: 'Приходите, сделаем за 5 минут!',
    primaryButtonText: 'Как добраться',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ От 30₽, надёжная защита ваших документов!'
  },
  
  relatedServices: [
    { title: 'Печать документов', url: '/pechat-dokumentov', price: 10, icon: 'print' },
    { title: 'Ксерокопия', url: '/kserokopiya', price: 10, icon: 'content_copy' }
  ],
  
  schemaType: 'PrintService'
};

/**
 * Сканирование
 */
export const SKANIROVANIE: LandingPageData = {
  slug: 'skanirovanie',
  title: 'Сканирование',
  metaTitle: 'Сканирование документов в Ростове | 50₽ | Своё Фото',
  metaDescription: 'Сканирование документов 50₽. Высокое разрешение, отправка на email или флешку. Быстро и качественно.',
  canonicalUrl: '/skanirovanie',
  
  heroTitle: 'в Своё Фото',
  heroHighlight: 'Сканирование',
  heroSubtitle: 'Сканирование в высоком разрешении, и сразу на ваш email прямо из студии. Документы, фотоальбомы, книги любого формата.',
  heroBenefits: [
    { icon: 'scanner', text: 'Высокое качество' },
    { icon: 'email', text: 'Отправка на email' },
    { icon: 'schedule', text: 'Моментально' }
  ],
  heroCtaText: 'Отсканировать',
  heroImage: '/assets/static/promo/skanirovanie.webp',
  
  price: 50,
  priceLabel: 'За страницу',
  
  serviceType: 'Сканирование',
  specifications: [
    { label: 'А4', value: '50₽' },
    { label: 'А3', value: '80₽' },
    { label: 'Фото', value: '50₽' },
    { label: 'Формат', value: 'PDF/JPG' }
  ],
  requirements: ['Документ или фото', 'В хорошем состоянии'],
  requirementsTitle: 'Что можно отсканировать',
  
  photoSamples: [],
  processSteps: OFFICE_PROCESS_STEPS,
  processTitle: 'Как это работает',
  advantages: OFFICE_ADVANTAGES,
  advantagesTitle: 'Наши преимущества',
  advantagesSubtitle: 'Быстро, удобно, качественно',
  
  faqItems: [
    { question: 'В каком формате получу файл?', answer: 'PDF для документов, JPG для фото. Можем сделать любой нужный формат.' },
    { question: 'Какое разрешение сканирования?', answer: 'Стандарт, 300 dpi. Для фото можем сделать 600 dpi и выше.' },
    { question: 'Можно отправить на email?', answer: 'Да! Отправим файл сразу на вашу почту.' }
  ],
  
  quickActions: {
    primaryTitle: 'Приехать в студию',
    primaryDescription: 'С документами для сканирования',
    primaryIcon: 'store',
    secondaryTitle: 'Уточнить детали',
    secondaryDescription: 'По телефону или в мессенджере',
    secondaryIcon: 'chat'
  },
  
  cta: {
    title: 'Нужно отсканировать документы?',
    subtitle: 'Приходите, сделаем моментально!',
    primaryButtonText: 'Как добраться',
    secondaryButtonText: 'Позвонить',
    urgencyText: '✨ 50₽ за страницу, отправим на email!'
  },
  
  relatedServices: [
    { title: 'Печать документов', url: '/pechat-dokumentov', price: 10, icon: 'print' },
    { title: 'Ксерокопия', url: '/kserokopiya', price: 10, icon: 'content_copy' }
  ],
  
  schemaType: 'PrintService'
};

export const PRINT_POLYGRAPHY_DATA: Record<string, LandingPageData> = {
  'vizitki': VIZITKI,
  'pechat-dokumentov': PECHAT_DOKUMENTOV,
  'pereplet-na-plastikovuyu-pruzhinu': PEREPLET_NA_PLASTIKOVUYU_PRUZHINU,
  'kserokopiya': KSEROKOPIYA,
  'laminirovanie': LAMINIROVANIE,
  'skanirovanie': SKANIROVANIE
};
