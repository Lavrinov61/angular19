import { User } from './user.model';
import { ServiceDoc } from '../data/services.data';

export interface Booking {
  id: string;
  userId: string;
  user?: User;
  serviceId: string;
  service?: ServiceDoc;
  photographerId?: string;
  photographerName?: string;
  date: Date | string;
  startTime: string; // Время начала записи
  endTime: string;   // Время окончания записи
  timeSlot: TimeSlot;
  status: BookingStatus;
  persons: number;
  totalPrice: number;
  pricing?: BookingPricing; // Добавляем информацию о ценообразовании
  clientInfo: ClientInfo;
  comments?: string;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  confirmationCode?: string;
  reminderSent?: boolean;
  createdAt: Date | string;
  updatedAt?: Date | string;
}

export interface BookingPricing {
  basePrice: number;           // Базовая цена услуги
  discountAmount: number;      // Размер скидки в рублях
  discountPercentage: number;  // Процент скидки
  discountReason?: string;     // Причина скидки
  finalPrice: number;          // Итоговая цена
  appliedDiscountId?: string;  // ID примененной скидки
}

export interface TimeSlot {
  startTime: string; // Формат: "10:00"
  endTime: string;   // Формат: "11:00"
  duration: number;  // В минутах
  isAvailable: boolean;
}

export interface ClientInfo {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  telegram?: string;
  vk?: string;
  whatsapp?: string;
}

export interface BookingFilter {
  dateFrom?: Date | string;
  dateTo?: Date | string;
  status?: BookingStatus;
  photographerId?: string;
  serviceId?: string;
  serviceCategory?: string;
}

export interface Calendar {
  date: Date | string;
  timeSlots: TimeSlot[];
  isWorkingDay: boolean;
  isHoliday?: boolean;
  specialNote?: string;
  // Добавляем дополнительную информацию для улучшенного календаря
  bookingCount?: number;       // Количество бронирований в этот день
  maxSlots?: number;          // Максимальное количество слотов в день
  isFullyBooked?: boolean;    // Полностью ли забронирован день
  isPast?: boolean;           // Прошла ли эта дата
}

export interface WorkingHours {
  dayOfWeek: number; // 0 = Воскресенье, 1 = Понедельник и т.д.
  isWorkingDay: boolean;
  startTime: string; // "09:00"
  endTime: string;   // "20:00"
  breakStart?: string; // "13:00"
  breakEnd?: string;   // "14:00"
}

export enum BookingStatus {
  PENDING = 'pending',           // Ожидает подтверждения
  CONFIRMED = 'confirmed',       // Подтверждено
  CANCELLED = 'cancelled',       // Отменено
  COMPLETED = 'completed',       // Завершено
  NO_SHOW = 'no-show',          // Клиент не явился
  RESCHEDULED = 'rescheduled'   // Перенесено
}

export enum PaymentStatus {
  PENDING = 'pending',           // Ожидает оплаты
  PAID = 'paid',                // Оплачено
  PARTIALLY_PAID = 'partially_paid', // Частично оплачено
  REFUNDED = 'refunded',        // Возвращено
  FAILED = 'failed'             // Ошибка оплаты
}

export enum PaymentMethod {
  CASH = 'cash',                // Наличные
  CARD = 'card',                // Банковская карта
  TRANSFER = 'transfer',        // Банковский перевод
  ONLINE = 'online',            // Онлайн оплата
  DEPOSIT = 'deposit',          // Предоплата/депозит
  SBP = 'sbp',                  // СБП (Система быстрых платежей)
  YANDEX_MONEY = 'yandex_money', // ЮMoney
  SBERBANK = 'sberbank'         // Сбербанк Онлайн
}

export const BOOKING_STATUS_LABELS = {
  [BookingStatus.PENDING]: 'Ожидает подтверждения',
  [BookingStatus.CONFIRMED]: 'Подтверждено',
  [BookingStatus.CANCELLED]: 'Отменено',
  [BookingStatus.COMPLETED]: 'Завершено',
  [BookingStatus.NO_SHOW]: 'Клиент не явился',
  [BookingStatus.RESCHEDULED]: 'Перенесено'
};

export const PAYMENT_STATUS_LABELS = {
  [PaymentStatus.PENDING]: 'Ожидает оплаты',
  [PaymentStatus.PAID]: 'Оплачено',
  [PaymentStatus.PARTIALLY_PAID]: 'Частично оплачено',
  [PaymentStatus.REFUNDED]: 'Возвращено',
  [PaymentStatus.FAILED]: 'Ошибка оплаты'
};

export const PAYMENT_METHOD_LABELS = {
  [PaymentMethod.CASH]: 'Наличные',
  [PaymentMethod.CARD]: 'Банковская карта',
  [PaymentMethod.TRANSFER]: 'Банковский перевод',
  [PaymentMethod.ONLINE]: 'Онлайн оплата',
  [PaymentMethod.DEPOSIT]: 'Предоплата',
  [PaymentMethod.SBP]: 'СБП (Система быстрых платежей)',
  [PaymentMethod.YANDEX_MONEY]: 'ЮMoney',
  [PaymentMethod.SBERBANK]: 'Сбербанк Онлайн'
};
