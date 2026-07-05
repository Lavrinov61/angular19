import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, catchError, of, map } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { ContactInfo, ContactMessage } from '../models/contact.model';
import { ADDRESSES, STUDIO_PHONE } from '../../../core/data/address.data';
import { LoggerService } from '../../../core/services/logger.service';

/**
 * Полноценный HTTP API сервис для работы с контактными данными и формой обратной связи
 * Заменяет Firebase на серверное решение Node.js
 */
@Injectable({
  providedIn: 'root'
})
export class ContactService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly log = inject(LoggerService);
  private readonly apiUrl = '/api';
  
  // Signals для управления состоянием
  isLoading = signal<boolean>(false);
  error = signal<string | null>(null);
  lastContactsUpdate = signal<Date | null>(null);
  
  constructor() {
    this.log.debug('ContactService: Инициализирован с HTTP API');
  }

  /**
   * Получение контактных данных студии через HTTP API
   */
  getStudioContacts(): Observable<ContactInfo> {
    // В SSR режиме возвращаем fallback данные
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('SSR: Используем fallback контактные данные');
      return of(this.getFallbackContacts());
    }

    this.isLoading.set(true);
    this.error.set(null);
    
    return this.http.get<ContactInfo>(`${this.apiUrl}/contacts/studio`).pipe(
      map(contacts => {
        this.log.debug('Контактные данные загружены с сервера');
        this.lastContactsUpdate.set(new Date());
        this.isLoading.set(false);
        return contacts;
      }),
      catchError(error => {
        this.log.error('Ошибка загрузки контактных данных:', error);
        this.error.set(error.message || 'Ошибка загрузки контактных данных');
        this.isLoading.set(false);
        // Возвращаем fallback данные при ошибке
        return of(this.getFallbackContacts());
      })
    );
  }

  /**
   * Отправка сообщения из формы обратной связи через HTTP API
   */
  sendContactMessage(message: ContactMessage): Observable<{ success: boolean; message?: string }> {
    // В SSR режиме не отправляем сообщения
    if (!isPlatformBrowser(this.platformId)) {
      this.log.warn('SSR: Отправка сообщений недоступна на сервере');
      return of({ success: false, error: 'Server-side sending not supported' });
    }

    this.isLoading.set(true);
    this.error.set(null);

    // Добавляем timestamp и статус
    const messageWithMetadata = {
      ...message,
      createdAt: new Date().toISOString(),
      status: 'new',
      userAgent: navigator.userAgent,
      ip: null // IP будет определен на сервере
    };

    return this.http.post<{ messageId: string }>(`${this.apiUrl}/contacts/messages`, messageWithMetadata).pipe(
      map(response => {
        this.log.debug('Сообщение отправлено успешно:', response.messageId);
        this.isLoading.set(false);
        return {
          success: true,
          messageId: response.messageId,
          message: 'Сообщение отправлено успешно'
        };
      }),
      catchError(error => {
        this.log.error('Ошибка отправки сообщения:', error);
        this.error.set(error.message || 'Ошибка отправки сообщения');
        this.isLoading.set(false);
        throw error;
      })
    );
  }

  /**
   * Получить список всех сообщений (для администраторов)
   */
  getAllMessages(page = 1, limit = 50): Observable<{ messages: ContactMessage[], total: number }> {
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('SSR: Пропускаем загрузку списка сообщений');
      return of({ messages: [], total: 0 });
    }

    this.isLoading.set(true);
    this.error.set(null);

    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString()
    });

    return this.http.get<{ messages: ContactMessage[], total: number }>(`${this.apiUrl}/contacts/messages?${params}`).pipe(
      map(response => {
        this.isLoading.set(false);
        return response;
      }),
      catchError(error => {
        this.log.error('Ошибка загрузки списка сообщений:', error);
        this.error.set(error.message || 'Ошибка загрузки списка сообщений');
        this.isLoading.set(false);
        return of({ messages: [], total: 0 });
      })
    );
  }

  /**
   * Получить сообщение по ID
   */
  getMessageById(messageId: string): Observable<ContactMessage | null> {
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('SSR: Пропускаем загрузку сообщения по ID');
      return of(null);
    }

    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<ContactMessage>(`${this.apiUrl}/contacts/messages/${messageId}`).pipe(
      map(message => {
        this.isLoading.set(false);
        return message;
      }),
      catchError(error => {
        this.log.error('Ошибка загрузки сообщения:', error);
        this.error.set(error.message || 'Ошибка загрузки сообщения');
        this.isLoading.set(false);
        return of(null);
      })
    );
  }

  /**
   * Обновить статус сообщения (для администраторов)
   */
  updateMessageStatus(messageId: string, status: 'new' | 'read' | 'replied' | 'archived'): Observable<ContactMessage> {
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('SSR: Пропускаем обновление статуса сообщения');
      return of({} as ContactMessage);
    }

    this.isLoading.set(true);
    this.error.set(null);

    return this.http.patch<ContactMessage>(`${this.apiUrl}/contacts/messages/${messageId}/status`, { status }).pipe(
      map(message => {
        this.isLoading.set(false);
        return message;
      }),
      catchError(error => {
        this.log.error('Ошибка обновления статуса сообщения:', error);
        this.error.set(error.message || 'Ошибка обновления статуса сообщения');
        this.isLoading.set(false);
        throw error;
      })
    );
  }

  /**
   * Удалить сообщение (для администраторов)
   */
  deleteMessage(messageId: string): Observable<void> {
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('SSR: Пропускаем удаление сообщения');
      return of();
    }

    this.isLoading.set(true);
    this.error.set(null);

    return this.http.delete<void>(`${this.apiUrl}/contacts/messages/${messageId}`).pipe(
      map(() => {
        this.isLoading.set(false);
      }),
      catchError(error => {
        this.log.error('Ошибка удаления сообщения:', error);
        this.error.set(error.message || 'Ошибка удаления сообщения');
        this.isLoading.set(false);
        throw error;
      })
    );
  }

  /**
   * Получить статистику сообщений (для администраторов)
   */
  getMessagesStats(): Observable<Record<string, unknown>> {
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('SSR: Пропускаем загрузку статистики сообщений');
      return of({});
    }

    return this.http.get<Record<string, unknown>>(`${this.apiUrl}/contacts/messages/stats`).pipe(
      catchError(error => {
        this.log.error('Ошибка загрузки статистики сообщений:', error);
        return of({});
      })
    );
  }

  /**
   * Обновить контактные данные студии (для администраторов)
   */
  updateStudioContacts(contacts: ContactInfo): Observable<ContactInfo> {
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('SSR: Пропускаем обновление контактных данных');
      return of(contacts);
    }

    this.isLoading.set(true);
    this.error.set(null);

    return this.http.put<ContactInfo>(`${this.apiUrl}/contacts/studio`, contacts).pipe(
      map(updatedContacts => {
        this.lastContactsUpdate.set(new Date());
        this.isLoading.set(false);
        return updatedContacts;
      }),
      catchError(error => {
        this.log.error('Ошибка обновления контактных данных:', error);
        this.error.set(error.message || 'Ошибка обновления контактных данных');
        this.isLoading.set(false);
        throw error;
      })
    );
  }

  /**
   * Проверить валидность email адреса
   */
  validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Проверить валидность телефона (российские номера)
   */
  validatePhone(phone: string): boolean {
    const phoneRegex = /^(\+7|7|8)?[\s-]?\(?[489][0-9]{2}\)?[\s-]?[0-9]{3}[\s-]?[0-9]{2}[\s-]?[0-9]{2}$/;
    return phoneRegex.test(phone.replace(/[\s-()]/g, ''));
  }

  /**
   * Форматировать телефон к стандартному виду
   */
  formatPhone(phone: string): string {
    const cleanPhone = phone.replace(/[\s-()]/g, '');
    
    if (cleanPhone.startsWith('8')) {
      return '+7' + cleanPhone.substring(1);
    } else if (cleanPhone.startsWith('7')) {
      return '+' + cleanPhone;
    } else if (cleanPhone.startsWith('+7')) {
      return cleanPhone;
    }
    
    return phone; // Возвращаем как есть, если не удалось распознать формат
  }

  /**
   * Резервные контактные данные на случай недоступности API
   */
  private getFallbackContacts(): ContactInfo {
    // Используем ADDRESSES для fallback данных
    const firstAddress = ADDRESSES[0];
    
    const phones = [STUDIO_PHONE];
    
    return {
      phone: phones[0], // Обратная совместимость - первый телефон
      email: 'info@svoefoto.ru',
      address: firstAddress.address, // Обратная совместимость - первый адрес
      workingHours: firstAddress.workHours, // Обратная совместимость - часы работы первого адреса
      coordinates: firstAddress.coordinates,
      socialLinks: [
        { name: 'Telegram', url: 'https://t.me/magnus_photo', icon: 'telegram' },
        { name: 'ВКонтакте', url: 'https://vk.com/im?sel=-68371131', icon: 'vk' },
        { name: 'Instagram', url: 'https://www.instagram.com/foto.magnus/', icon: 'instagram' },
        { name: 'Facebook', url: 'https://www.facebook.com/photo.magnus/?locale=ru_RU', icon: 'facebook' },
        { name: 'Одноклассники', url: 'https://ok.ru/group/53912248057971', icon: 'odnoklassniki' }
      ],
      mapLinks: [
        { name: '2 ГИС', url: firstAddress.mapLinks?.['2gis'] || 'https://2gis.ru/rostov-on-don/firm/70000001006548410' },
        { name: 'Google Maps', url: firstAddress.mapLinks?.google || 'https://www.google.com/maps/place/%D0%9C%D0%B0%D0%B3%D0%BD%D1%83%D1%81%D0%A4%D0%BE%D1%82%D0%BE/@47.219706,39.7081892,17z/data=!3m1!4b1!4m6!3m5!1s0x40e3b90cf93276db:0xab01342eb57cc0d2!8m2!3d47.219706!4d39.7107641!16s%2Fg%2F11b5pjcn7m' },
        { name: 'Яндекс Карты', url: firstAddress.mapLinks?.yandex || 'https://yandex.ru/maps/-/CHaIjZP9' }
      ],
      // Новый формат - массив адресов
      addresses: ADDRESSES,
      // Новый формат - массив телефонов
      phones: phones
    };
  }

  // Utility methods
  clearError(): void {
    this.error.set(null);
  }

  reset(): void {
    this.isLoading.set(false);
    this.error.set(null);
    this.lastContactsUpdate.set(null);
  }
}
