import { PhotographerFallbackData } from '../models/photographer.interfaces';

export const FALLBACK_PHOTOGRAPHERS: PhotographerFallbackData = {
  'elena-sokolova': {
    id: 'elena-sokolova',
    slug: 'elena-sokolova',
    name: 'Елена Соколова',
    title: 'Свадебный фотограф',
    avatar: 'https://images.unsplash.com/photo-1494790108755-2616b612b5bb?w=300&h=300&fit=crop&crop=face',
    coverImage: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&h=600&fit=crop',
    bio: 'Профессиональный свадебный фотограф с 8-летним опытом. Специализируюсь на создании живых, эмоциональных кадров, которые расскажут историю вашего особенного дня.',
    experience: '8+ лет',
    specializations: ['Свадебная фотография', 'Love Story', 'Семейные фотосессии', 'Портретная съемка'],
    location: 'Ростов-на-Дону',
    rating: 4.9,
    reviewsCount: 127,

    attention: {
      headline: 'Сохрани эмоции важного дня вместе с профессиональным фотографом',
      subheadline: 'Профессиональная свадебная фотосъёмка с выездом в любую точку города',
      tagline: 'Твои лучшие моменты достойны быть запечатлёнными профессионально'
    },

    interest: {
      whyChooseMe: {
        experience: '8+ лет в свадебной фотографии, более 200 счастливых пар',
        style: 'Живые и естественные эмоции, художественный стиль обработки',
        flexibility: 'Выезд на любое мероприятие, работаю в удобное для вас время'
      },
      achievements: [
        'Победитель Wedding Awards 2023',
        'Более 200 проведенных свадеб',
        'Публикации в журнале "Свадебный мир"',
        'Рейтинг 4.9/5 на основе 127 отзывов'
      ],
      workingAreas: ['Ростов-на-Дону', 'Таганрог', 'Азов', 'Новочеркасск', 'Выезд за город']
    },

    desire: {
      emotionalText: 'Позволь себе проживать эмоции праздника, а фотографии я возьму на себя. Каждый кадр будет наполнен атмосферой именно твоего события!',
      mainPackages: [
        {
          id: 'warm-memories',
          name: 'Тёплые воспоминания',
          emoji: '💕',
          description: 'Классическая свадебная съемка на весь день',
          features: [
            'Съемка церемонии и банкета (8 часов)',
            '300+ обработанных фотографий',
            'Онлайн-галерея для гостей',
            'USB-флешка с фото в подарок'
          ],
          price: 25000,
          duration: '8 часов',
          highlighted: true
        },
        {
          id: 'premium-story',
          name: 'Премиум-история',
          emoji: '💎',
          description: 'Расширенный пакет с дополнительными услугами',
          features: [
            'Съемка церемонии и банкета (10 часов)',
            '500+ обработанных фотографий',
            'Love Story съемка в подарок',
            'Фотоальбом премиум-класса',
            'Печать 20 фото 15x20 см',
            'Онлайн-галерея для гостей'
          ],
          price: 35000,
          duration: '10 часов'
        },
        {
          id: 'holiday-package',
          name: 'Праздник под ключ',
          emoji: '🎉',
          description: 'Полное сопровождение вашего события',
          features: [
            'Фотосессия Love Story',
            'Съемка церемонии и банкета',
            'Второй фотограф',
            'Видеограф в команде',
            'Фотоальбом премиум',
            'Печать лучших кадров'
          ],
          price: 50000,
          duration: 'Весь день'
        }
      ],
      additionalServices: [
        {
          id: 'mini-portrait',
          name: 'Мини-портрет гостям',
          description: 'Индивидуальные портреты для каждого гостя',
          icon: 'person',
          isPremium: true
        },
        {
          id: 'express-retouch',
          name: 'Экспресс-ретушь',
          description: 'Быстрая обработка 10 лучших кадров в день события',
          icon: 'flash_on'
        },
        {
          id: 'photo-booth',
          name: 'Фотобудка',
          description: 'Интерактивная зона для веселых снимков гостей',
          icon: 'camera_alt'
        },
        {
          id: 'drone-shooting',
          name: 'Аэросъемка',
          description: 'Красивые кадры с высоты птичьего полета',
          icon: 'flight_takeoff',
          isPremium: true
        }
      ],
      specialOffers: [
        {
          id: 'gift-certificate',
          emoji: '🎁',
          title: 'Подарочный сертификат',
          description: 'Идеальный подарок для молодоженов'
        },
        {
          id: 'early-booking',
          emoji: '⏰',
          title: 'Скидка за раннее бронирование',
          description: 'До 25% скидка при записи за 6 месяцев',
          conditions: 'При оплате 50% стоимости'
        },
        {
          id: 'calendar-discount',
          emoji: '📅',
          title: 'Скидки по календарю',
          description: 'Специальные цены в будние дни'
        }
      ],
      whyChooseUs: [
        '8+ лет опыта в свадебной фотографии',
        'Более 200 счастливых пар доверили нам свой день',
        'Профессиональное оборудование и команда',
        'Индивидуальный подход к каждой паре',
        'Гарантия качества и соблюдения сроков'
      ]
    },

    action: {
      ctaText: 'Забронируй фотосессию прямо сейчас!',
      ctaSubtext: 'Скидка 20%',
      onlineDiscount: 20,
      bonusOffer: 'Скидка 20%',
      contactMethods: [
        {
          type: 'vk',
          value: 'https://vk.com/im?sel=-68371131',
          label: 'ВКонтакте',
          icon: 'vk',
          isPrimary: true
        },
        {
          type: 'telegram',
          value: '@elena_photo_rstv',
          label: 'Telegram',
          icon: 'telegram'
        },
        {
          type: 'phone',
          value: '+7 (988) 555-12-34',
          label: 'Телефон',
          icon: 'phone'
        },
        {
          type: 'instagram',
          value: '@elena.photo.rstv',
          label: 'Instagram',
          icon: 'camera_alt'
        }
      ]
    },

    portfolio: [
      {
        id: 'wedding-1',
        title: 'Свадьба в стиле прованс',
        category: 'Свадебная съемка',
        image: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&h=600&fit=crop',
        images: [
          'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&h=600&fit=crop',
          'https://images.unsplash.com/photo-1583939003579-730e3918a45a?w=800&h=600&fit=crop'
        ],
        description: 'Нежная свадебная церемония в загородном клубе',
        date: '2024-06-15',
        clientType: 'Частный клиент'
      }
    ],

    testimonials: [
      {
        id: 'review-1',
        clientName: 'Анна и Дмитрий',
        rating: 5,
        text: 'Елена - потрясающий фотограф! Смогла передать всю атмосферу нашего дня. Фотографии получились просто волшебными!',
        date: '2024-06-20',
        eventType: 'Свадьба',
        images: ['https://images.unsplash.com/photo-1519741497674-611481863552?w=300&h=200&fit=crop']
      },
      {
        id: 'review-2',
        clientName: 'Мария Петрова',
        rating: 5,
        text: 'Очень профессиональный подход, отличное качество фотографий. Рекомендую всем!',
        date: '2024-05-15',
        eventType: 'Love Story'
      }
    ],

    availability: {
      isAvailable: true,
      nextAvailableDate: '2024-07-15',
      workingDays: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
      workingHours: {
        start: '09:00',
        end: '22:00'
      },
      busyDates: ['2024-07-01', '2024-07-08', '2024-07-22']
    },

    pricing: {
      startingPrice: 8000,
      currency: 'RUB',
      priceRange: {
        min: 8000,
        max: 50000
      },
      packages: []
    },

    social: {
      instagram: '@elena.photo.rstv',
      telegram: '@elena_photo_rstv',
      vk: 'https://vk.com/im?sel=-68371131',
      phone: '+7 (988) 555-12-34'
    },

    seo: {
      title: 'Елена Соколова - Свадебный фотограф в Ростове-на-Дону | Своё Фото',
      description: 'Профессиональная свадебная фотосъемка от Елены Соколовой. 8+ лет опыта, 200+ счастливых пар. Забронируйте съемку со скидкой 20% при онлайн-оплате!',
      keywords: ['свадебный фотограф', 'Ростов-на-Дону', 'свадебная фотосъемка', 'Елена Соколова'],
      ogImage: 'https://images.unsplash.com/photo-1519741497674-611481863552?w=1200&h=630&fit=crop'
    }
  },

  'mikhail-volkov': {
    id: 'mikhail-volkov',
    slug: 'mikhail-volkov',
    name: 'Михаил Волков',
    title: 'Семейный и детский фотограф',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=300&h=300&fit=crop&crop=face',
    coverImage: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=1200&h=600&fit=crop',
    bio: 'Специализируюсь на семейной и детской фотографии. Умею находить общий язык с детьми и создавать естественные, живые кадры.',
    experience: '6+ лет',
    specializations: ['Семейная фотография', 'Детская фотосъемка', 'Фотосессии беременности', 'Портретная съемка'],
    location: 'Ростов-на-Дону',
    rating: 4.8,
    reviewsCount: 89,

    attention: {
      headline: 'Фотографии, которые расскажут историю твоей семьи',
      subheadline: 'Профессиональная семейная и детская фотосъёмка с выездом',
      tagline: 'Каждый момент детства важен и неповторим'
    },

    interest: {
      whyChooseMe: {
        experience: '6+ лет работы с семьями, особый подход к детям',
        style: 'Естественные эмоции, живые кадры без постановки',
        flexibility: 'Выезд на дом, в парк или студию - как удобно семье'
      },
      achievements: [
        'Специализация на детской фотографии',
        'Более 150 семейных фотосессий',
        'Сертификат детского психолога',
        'Рейтинг 4.8/5 среди родителей'
      ],
      workingAreas: ['Ростов-на-Дону', 'Выезд на дом', 'Парки города', 'Студия']
    },

    desire: {
      emotionalText: 'Дети растут так быстро! Давайте сохраним эти драгоценные моменты, которые больше никогда не повторятся. Ваши семейные фотографии станут настоящим сокровищем.',
      mainPackages: [
        {
          id: 'family-basic',
          name: 'Семейная фотосессия',
          emoji: '👨‍👩‍👧‍👦',
          description: 'Классическая семейная съемка',
          features: [
            'Фотосессия 1.5 часа',
            '40+ обработанных фотографий',
            'Выбор локации',
            'Онлайн-галерея'
          ],
          price: 6000,
          duration: '1.5 часа',
          highlighted: true
        },
        {
          id: 'kids-session',
          name: 'Детская фотосессия',
          emoji: '👶',
          description: 'Специальная съемка для малышей',
          features: [
            'Фотосессия 1 час',
            '30+ обработанных фотографий',
            'Игровой подход',
            'Мини-альбом в подарок'
          ],
          price: 5000,
          duration: '1 час'
        }
      ],
      additionalServices: [
        {
          id: 'home-session',
          name: 'Съемка дома',
          description: 'Уютная фотосессия в домашней обстановке',
          icon: 'home'
        },
        {
          id: 'playground-session',
          name: 'Съемка на детской площадке',
          description: 'Естественные кадры во время игры',
          icon: 'playground'
        },
        {
          id: 'pet-included',
          name: 'С домашними питомцами',
          description: 'Включаем в фотосессию ваших любимцев',
          icon: 'pets'
        }
      ],
      specialOffers: [
        {
          id: 'mini-album-gift',
          emoji: '📖',
          title: 'Мини-альбом в подарок',
          description: 'При записи через сайт'
        },
        {
          id: 'second-child-discount',
          emoji: '👶👶',
          title: 'Скидка за второго ребенка',
          description: '20% скидка при съемке двоих детей'
        }
      ],
      whyChooseUs: [
        '6+ лет работы с семьями',
        'Особый подход к детям любого возраста',
        'Сертификат детского психолога',
        'Естественные эмоции без постановки',
        'Гибкий график и выезд на дом'
      ]
    },

    action: {
      ctaText: 'Забронируй семейную фотосессию со скидкой 15%!',
      ctaSubtext: 'При записи через сайт - мини-альбом в подарок',
      onlineDiscount: 15,
      bonusOffer: 'Мини-альбом 20x20 см в подарок',
      contactMethods: [
        {
          type: 'vk',
          value: 'https://vk.com/im?sel=-68371131',
          label: 'ВКонтакте',
          icon: 'vk',
          isPrimary: true
        },
        {
          type: 'telegram',
          value: '@mikhail_family_photo',
          label: 'Telegram',
          icon: 'telegram'
        }
      ]
    },

    portfolio: [
      {
        id: 'family-1',
        title: 'Семейная фотосессия в парке',
        category: 'Семейная съемка',
        image: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800&h=600&fit=crop',
        images: [
          'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=800&h=600&fit=crop',
          'https://images.unsplash.com/photo-1546015720-b8b30df5aa27?w=800&h=600&fit=crop'
        ],
        description: 'Естественная семейная съемка в осеннем парке',
        date: '2024-05-20',
        clientType: 'Семья с детьми'
      },
      {
        id: 'kids-1',
        title: 'Детская фотосессия дома',
        category: 'Детская съемка',
        image: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&h=600&fit=crop',
        images: [
          'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?w=800&h=600&fit=crop',
          'https://images.unsplash.com/photo-1502086223501-7ea6ecd79368?w=800&h=600&fit=crop'
        ],
        description: 'Уютная домашняя съемка с малышом',
        date: '2024-04-15',
        clientType: 'Семья с новорожденным'
      }
    ],
    testimonials: [
      {
        id: 'review-1',
        clientName: 'Семья Петровых',
        rating: 5,
        text: 'Михаил отлично нашел подход к нашему трехлетнему сыну. Фотосессия прошла легко и весело!',
        date: '2024-05-20',
        eventType: 'Семейная фотосессия'
      }
    ],

    availability: {
      isAvailable: true,
      workingDays: ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'],
      workingHours: {
        start: '10:00',
        end: '19:00'
      },
      busyDates: []
    },

    pricing: {
      startingPrice: 5000,
      currency: 'RUB',
      priceRange: {
        min: 5000,
        max: 15000
      },
      packages: []
    },

    social: {
      instagram: '@mikhail.family.photo',
      telegram: '@mikhail_family_photo',
      vk: 'https://vk.com/im?sel=-68371131'
    },

    seo: {
      title: 'Михаил Волков - Семейный фотограф в Ростове-на-Дону | Своё Фото',
      description: 'Профессиональная семейная и детская фотосъемка от Михаила Волкова. Особый подход к детям, естественные эмоции. Скидка 15% при онлайн-записи!',
      keywords: ['семейный фотограф', 'детская фотосъемка', 'Ростов-на-Дону', 'Михаил Волков'],
      ogImage: 'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?w=1200&h=630&fit=crop'
    }
  }
};
