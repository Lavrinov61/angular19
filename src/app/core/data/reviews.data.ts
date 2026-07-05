export const REVIEWS_SECTION = {
  headline: 'Мнения наших клиентов',
  intro:    'От простого фото до сложного монтажа, Своё Фото оказывает потрясающее качество услуг.',
  rating:   { value: 5.0, text: 'Загружается...' } // Будет обновлено динамически
};

export interface ReviewDoc {
  author: string;
  city: string;
  rating: number;
  text: string;
  sourceName: string;
  sourceUrl: string;
  createdAt: string; // 8601
}

export const REVIEWS: ReviewDoc[] = [
  {
    author:'Виктория',
    city:'Ростов-на-Дону',
    rating:5,
    text:'Нашла вашу студию по отзывам, решила, что буду делать фото на паспорт здесь, и не прогадала! Обаятельные и вежливые сотрудники, уютная студия, доброжелательное отношение к клиенту! Замечательные фотографии получились, спасибо Вам огромное!',
    sourceName:'Google Maps',
    sourceUrl:'https://g.page/r/CdLAfLUuNAGrEBM/',
    createdAt:'2024-05-01T10:00:00+03:00'
  },
  {
    author:'Дарья',
    city:'Ростов-на-Дону',
    rating:5,
    text:'Отличная фотостудия, хорошее качество фотографий, приятные сотрудники. Проводят интересные конкурсы со стоящими призами!!!',
    sourceName:'2ГИС',
    sourceUrl:'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews',
    createdAt:'2024-04-20T14:00:00+03:00'
  },
  {
    author:'Ксения',
    city:'Ростов-на-Дону',
    rating:5,
    text:'Студия, просто супер! Фотограф Ксения, умничка! Учла все пожелания, сделала очень удачные и качественные фото. Я ушла с прекрасным настроением и отличными снимками 😊',
    sourceName:'Яндекс Карты',
    sourceUrl:'https://yandex.ru/maps/org/magnusfoto/50414539463/reviews/',
    createdAt:'2024-03-15T12:30:00+03:00'
  }
];
