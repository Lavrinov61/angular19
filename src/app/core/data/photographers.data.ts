import { Photographer, TeamMember } from '../../features/photograph/models/photographer.model';
import { STUDIO_PHONE } from './address.data';

/**
 * Static data for photographers.
 * This is used as the single source of truth for photographer information.
 */
export const PHOTOGRAPHERS_DATA: Photographer[] = [
  {
    id: 'margarita',
    slug: 'margarita',
    name: 'Маргарита',
    title: 'Студийный фотограф',
    profileImage: '/assets/images/default-avatar.svg',
    specialization: [
      { id: 'studio', name: 'студийная фотосъемка', description: 'Профессиональная съемка в студии', icon: 'camera' }
    ],
    portfolioImages: [], // Placeholder
    heroTitle: 'Маргарита - Студийный фотограф',
    heroSubtitle: 'Фото на документы, портреты, печать и подготовка файлов',
    heroImage: '/assets/static/hero/hero-image.webp', // Placeholder
    experience: 'Съёмка и подготовка результата в студии',
    achievments: ['Фото на документы, портреты и печать'],
    uniqueApproach: 'Работа со светом, позой и требованиями к готовому результату',
    clientTestimonials: [],
    servicesOffered: [],
    priceRange: 'от 4000 руб/час',
    ctaTitle: 'Записаться в студию',
    ctaSubtitle: 'Выберите услугу и удобное время',
    bookingLink: '/booking',
    contactInfo: {
      phone: STUDIO_PHONE,
      email: 'info@svoefoto.ru',
      telegram: 'https://t.me/magnusphotorostov'
    },
    metaTitle: 'Маргарита - студийный фотограф в Ростове-на-Дону',
    metaDescription: 'Профессиональная студийная фотосъемка.',
    keywords: ['фотограф', 'студия', 'портрет', 'Ростов-на-Дону'],
    isActive: false,
    rating: 0,
    reviewsCount: 0,
    languages: ['Русский'],
    workingHours: 'пн-вс 10:00-19:00',
    location: 'Ростов-на-Дону',
    studioAvailable: true,
    locationAvailable: false,
    status: 'inactive'
  },
  {
    id: 'anna',
    slug: 'anna',
    name: 'Анна',
    title: 'Студийный фотограф',
    profileImage: '/assets/images/default-avatar.svg',
    specialization: [
      { id: 'studio', name: 'студийная фотосъемка', description: 'Профессиональная съемка в студии', icon: 'camera' }
    ],
    portfolioImages: [], // Placeholder
    heroTitle: 'Анна - Студийный фотограф',
    heroSubtitle: 'Фото на документы, портреты, печать и подготовка файлов',
    heroImage: '/assets/static/hero/hero-image.webp', // Placeholder
    experience: 'Съёмка и подготовка результата в студии',
    achievments: ['Фото на документы, портреты и печать'],
    uniqueApproach: 'Работа со светом, позой и требованиями к готовому результату',
    clientTestimonials: [],
    servicesOffered: [],
    priceRange: 'от 4000 руб/час',
    ctaTitle: 'Записаться в студию',
    ctaSubtitle: 'Выберите услугу и удобное время',
    bookingLink: '/booking',
    contactInfo: {
      phone: STUDIO_PHONE,
      email: 'info@svoefoto.ru',
      telegram: 'https://t.me/magnusphotorostov'
    },
    metaTitle: 'Анна - студийный фотограф в Ростове-на-Дону',
    metaDescription: 'Профессиональная студийная фотосъемка.',
    keywords: ['фотограф', 'студия', 'портрет', 'Ростов-на-Дону'],
    isActive: false,
    rating: 0,
    reviewsCount: 0,
    languages: ['Русский'],
    workingHours: 'пн-вс 10:00-19:00',
    location: 'Ростов-на-Дону',
    studioAvailable: true,
    locationAvailable: false,
    status: 'inactive'
  },
  {
    id: 'olga',
    slug: 'olga',
    name: 'Ольга',
    title: 'Студийный фотограф',
    profileImage: '/assets/images/default-avatar.svg',
    specialization: [
      { id: 'studio', name: 'студийная фотосъемка', description: 'Профессиональная съемка в студии', icon: 'camera' }
    ],
    portfolioImages: [],
    heroTitle: 'Ольга - Студийный фотограф',
    heroSubtitle: 'Фото на документы, портреты, печать и подготовка файлов',
    heroImage: '/assets/static/hero/hero-image.webp',
    experience: 'Съёмка и подготовка результата в студии',
    achievments: ['Фото на документы, портреты и печать'],
    uniqueApproach: 'Работа со светом, позой и требованиями к готовому результату',
    clientTestimonials: [],
    servicesOffered: [],
    priceRange: 'от 4000 руб/час',
    ctaTitle: 'Записаться в студию',
    ctaSubtitle: 'Выберите услугу и удобное время',
    bookingLink: '/booking',
    contactInfo: {
      phone: STUDIO_PHONE,
      email: 'info@svoefoto.ru',
      telegram: 'https://t.me/magnusphotorostov'
    },
    metaTitle: 'Ольга - студийный фотограф в Ростове-на-Дону',
    metaDescription: 'Профессиональная студийная фотосъемка.',
    keywords: ['фотограф', 'студия', 'портрет', 'Ростов-на-Дону'],
    isActive: true,
    rating: 0,
    reviewsCount: 0,
    languages: ['Русский'],
    workingHours: 'пн-вс 10:00-19:00',
    location: 'Ростов-на-Дону',
    studioAvailable: true,
    locationAvailable: false,
    status: 'active'
  }
];

/**
 * Gets photographer data by slug.
 */
export function getPhotographerFallbackBySlug(slug: string): Photographer | null {
  return PHOTOGRAPHERS_DATA.find(p => p.slug === slug) || null;
}

/**
 * Gets all photographer data.
 */
export function getAllPhotographersFallback(): Photographer[] {
  return PHOTOGRAPHERS_DATA;
}

// Compatibility functions
export function getPhotographers(): Photographer[] {
  return getAllPhotographersFallback();
}

export function getPhotographerById(id: string): Photographer | null {
  return PHOTOGRAPHERS_DATA.find(p => p.id === id) || null;
}

export function getActivePhotographers(): Photographer[] {
  return PHOTOGRAPHERS_DATA.filter(p => p.isActive);
}

export function getStudioPhotographers(): Photographer[] {
  return PHOTOGRAPHERS_DATA.filter(p => p.isActive && p.studioAvailable);
}

export function getLocationPhotographers(): Photographer[] {
  return PHOTOGRAPHERS_DATA.filter(p => p.isActive && p.locationAvailable);
}

// Данные для редакционной страницы команды
export const TEAM_MEMBERS: TeamMember[] = [
  {
    slug: 'olga',
    name: 'Ольга',
    role: 'Студийный фотограф',
    tagline: 'Фото на документы, портреты и печать в студии',
    portraitHero: '/assets/images/default-avatar.svg',
    portraitCard: '/assets/images/default-avatar.svg',
    experienceYears: 0,
    sessionsCompleted: 0,
    signature: 'Помогает с кадром, требованиями к документам, печатью и передачей готового файла.',
    specialties: ['Студийный портрет', 'Фото на документы', 'Семейные портреты'],
  },
];
