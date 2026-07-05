/**
 * Общий телефон студии
 */
export const STUDIO_PHONE = '+7 (863) 322-65-75';
export const STUDIO_PHONE_E164 = '+78633226575';
export const STUDIO_PHONE_HREF = `tel:${STUDIO_PHONE_E164}`;
export const STUDIO_PHONE_SCHEMA = '+7 863 322-65-75';
export const STUDIO_PHONE_AVAILABLE = true;
export const STUDIO_PHONE_UNAVAILABLE_LABEL = 'телефон временно недоступен';

/**
 * Интерфейс для адреса студии
 */
export interface StudioAddress {
  id: string;
  name: string;
  address: string;
  landmark?: string; // Ориентир/район для быстрого понимания
  workHours: string;
  capacity?: number; // Максимальное количество человек
  mapImage: {
    src: string;
    alt: string;
  };
  coordinates?: {
    lat: number;
    lng: number;
  };
  mapLinks?: {
    yandex?: string;
    google?: string;
    '2gis'?: string;
  };
  openingDate?: string; // Дата открытия для новых локаций
}

/**
 * Массив адресов студии
 */
export const ADDRESSES: StudioAddress[] = [
  {
    id: 'soborny',
    name: 'Студия на Соборном',
    address: 'г. Ростов-на-Дону, переулок Соборный 21',
    landmark: 'Центр, рядом с Большой Садовой',
    workHours: 'Понедельник, Воскресенье: 09:00-19:30',
    capacity: 2, // До 2 человек
    mapImage: {
      src: 'assets/static/services/beauty-portrait.webp',
      alt: 'Схема проезда: Ростов-на-Дону, переулок Соборный 21'
    },
    coordinates: {
      lat: 47.219706,
      lng: 39.7107641
    },
    mapLinks: {
      yandex: 'https://yandex.ru/maps/-/CHaIjZP9',
      google: 'https://www.google.com/maps/place/47.219706,39.7107641',
      '2gis': 'https://2gis.ru/rostov-on-don/firm/70000001006548410'
    }
  }
];

/**
 * Обратная совместимость: первый адрес по умолчанию
 * @deprecated Используйте ADDRESSES[0] или ADDRESSES.find() для получения конкретного адреса
 * 
 * Тип совместим с AddressInfo интерфейсом из contacts-section.component.ts
 */
export const ADDRESS_INFO: {
  workHours: string;
  address: string;
  phone: string;
  mapImage: {
    src: string;
    alt: string;
  };
} = {
  workHours: ADDRESSES[0].workHours,
  address: ADDRESSES[0].address,
  phone: STUDIO_PHONE,
  mapImage: ADDRESSES[0].mapImage
};
