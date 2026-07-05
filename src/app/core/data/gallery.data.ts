import { GalleryPhoto } from '../../shared/models/gallery.model';

export const GALLERY_SECTION_TITLE = 'Портфолио работ';

export const GALLERY_PREVIEW: string[] = [
  'assets/static/gallery/placeholder.jpg',
  'assets/static/gallery/placeholder.jpg',
  'assets/static/gallery/placeholder.jpg',
  'assets/static/gallery/placeholder.jpg'
];

// Резервные данные для галереи на основе наших услуг
export const GALLERY_FALLBACK: GalleryPhoto[] = [
  // Документные фото - commercial категория
  {
    id: 'gallery-document-1',
    slug: 'gallery-document-1',
    url: 'assets/images/passport 3 (2).webp',
    title: 'Фото на документы',
    description: 'Профессиональные фотографии для любых документов с мгновенной печатью',
    category: 'commercial',
    tags: ['документы', 'паспорт', 'виза', 'официальное фото']
  },  // Портретная фотография
  {
    id: 'gallery-portrait-1',
    slug: 'gallery-portrait-1',
    url: 'assets/static/services/portrait-photo.webp',
    title: 'Портретная фотосъёмка',
    description: 'Профессиональные портреты, передающие индивидуальность и характер',
    category: 'portrait',
    tags: ['портрет', 'студия', 'профессиональное фото', 'индивидуальность']
  },
  {
    id: 'gallery-business-1',
    slug: 'gallery-business-1',
    url: 'assets/static/services/business-portrait.webp',
    title: 'Деловые портреты',
    description: 'Профессиональные портреты для резюме, карьерных сайтов и корпоративного сайта',
    category: 'commercial',
    tags: ['деловой портрет', 'корпоративное фото', 'резюме', 'профессиональное']
  },
  {
    id: 'gallery-beauty-1',
    slug: 'gallery-beauty-1',
    url: 'assets/static/services/beauty-portrait.webp',
    title: 'Beauty-портреты',
    description: 'Красивые портреты с акцентом на красоту и гармонию образа',
    category: 'portrait',
    tags: ['beauty', 'красота', 'ретушь', 'студийное освещение']
  },
  {
    id: 'gallery-family-1',
    slug: 'gallery-family-1',
    url: 'assets/static/services/family-photo.webp',
    title: 'Семейная фотосъёмка',
    description: 'Тёплые семейные портреты, которые станут важной частью вашей истории',
    category: 'family',
    tags: ['семья', 'семейное фото', 'дети', 'родители']
  },
  {
    id: 'gallery-kids-1',
    slug: 'gallery-kids-1',
    url: 'assets/static/services/kids-photo.webp',
    title: 'Детская фотосъёмка',
    description: 'Волшебные детские фотографии, запечатлевающие самые яркие моменты детства',
    category: 'family',
    tags: ['дети', 'детское фото', 'игровые сценарии', 'детство']
  },
  // Свадебная фотография
  {
    id: 'gallery-wedding-1',
    slug: 'gallery-wedding-1',
    url: 'assets/static/services/wedding-photo.webp',
    title: 'Свадебная фотосъёмка',
    description: 'Полная свадебная фотосъёмка от сборов до торжества с живыми эмоциями',
    category: 'wedding',
    tags: ['свадьба', 'торжество', 'эмоции', 'репортаж']
  },
  {
    id: 'gallery-lovestory-1',
    slug: 'gallery-lovestory-1',
    url: 'assets/static/services/love-story-new.webp',
    title: 'Love Story фотосъёмка',
    description: 'Романтическая фотосессия для влюблённых в красивых локациях',    category: 'wedding',
    tags: ['love story', 'романтика', 'пара', 'любовь']
  },
  {
    id: 'gallery-engagement-1',
    slug: 'gallery-engagement-1',
    url: 'assets/static/services/engagement-photography.webp',
    title: 'Фотосъёмка помолвки',
    description: 'Запечатлеваем важный момент предложения руки и сердца',
    category: 'wedding',
    tags: ['помолвка', 'предложение', 'эмоции', 'важный момент']
  },
  // Художественная фотография
  {
    id: 'gallery-art-1',
    slug: 'gallery-art-1',
    url: 'assets/static/services/v3.webp',
    title: 'Художественная фотосъёмка',
    description: 'Создание уникальных художественных образов с использованием креативных техник',
    category: 'art',
    tags: ['художественное фото', 'креатив', 'концепция', 'искусство']
  },  {
    id: 'gallery-fashion-1',
    slug: 'gallery-fashion-1',
    url: 'assets/static/services/fashion-photo.webp',
    title: 'Fashion фотосъёмка',
    description: 'Модная фотосъёмка с акцентом на стиль, одежду и аксессуары',
    category: 'art',
    tags: ['мода', 'стиль', 'fashion', 'модельная съёмка']
  },{
    id: 'gallery-concept-1',
    slug: 'gallery-concept-1',
    url: 'assets/static/services/concept-photo.webp',
    title: 'Концептуальная фотосъёмка',
    description: 'Тематические фотосессии с проработкой концепции и сценария',
    category: 'art',
    tags: ['концепция', 'тематическая съёмка', 'творчество', 'сценарий']
  },
  // Событийная фотография
  {
    id: 'gallery-reportage-1',
    slug: 'gallery-reportage-1',
    url: 'assets/static/services/reportage-photography.webp',
    title: 'Репортажная фотосъёмка',
    description: 'Живые и эмоциональные фотографии с мероприятий, праздников и важных событий',
    category: 'event',
    tags: ['репортаж', 'события', 'мероприятия', 'эмоции']
  },
  {
    id: 'gallery-corporate-1',
    slug: 'gallery-corporate-1',
    url: 'assets/static/services/corporate-photo.webp',
    title: 'Корпоративная фотосъёмка',
    description: 'Фотосъёмка корпоративных мероприятий, конференций и деловых событий',
    category: 'commercial',
    tags: ['корпоратив', 'деловые события', 'конференция', 'команда']
  },
  {
    id: 'gallery-birthday-1',
    slug: 'gallery-birthday-1',
    url: 'assets/static/services/birthday-photo.webp',
    title: 'Фотосъёмка дня рождения',
    description: 'Праздничная фотосъёмка дней рождения и юбилеев с живыми эмоциями',
    category: 'event',
    tags: ['день рождения', 'праздник', 'юбилей', 'торжество']
  }
];
