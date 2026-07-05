import { StudioAddress } from '../../../core/data/address.data';

/**
 * Модель для контактной информации студии
 * Поддерживает как один адрес (обратная совместимость), так и массив адресов
 */
export interface ContactInfo {
  phone: string; // Обратная совместимость - первый телефон
  email: string;
  address: string; // Обратная совместимость - первый адрес
  workingHours: string; // Обратная совместимость - часы работы первого адреса
  coordinates?: {
    lat: number;
    lng: number;
  };
  socialLinks?: SocialLink[];
  mapLinks?: MapLink[];
  // Новый формат - массив адресов
  addresses?: StudioAddress[];
  // Новый формат - массив телефонов
  phones?: string[];
}

/**
 * Модель для социальных сетей
 */
export interface SocialLink {
  name: string;
  url: string;
  icon: string;
}

/**
 * Модель для ссылок на карты
 */
export interface MapLink {
  name: string;
  url: string;
}

/**
 * Модель для сообщения от контактной формы
 */
export interface ContactMessage {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  createdAt?: Date;
}
