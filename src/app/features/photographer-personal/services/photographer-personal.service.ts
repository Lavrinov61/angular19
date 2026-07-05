import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { PhotographerPersonalProfile, PortfolioItem } from '../models/photographer.interfaces';
import { FALLBACK_PHOTOGRAPHERS } from '../data/fallback-data';
import { LoggerService } from '../../../core/services/logger.service';

/** Shape of data returned by the photographer public API */
interface PhotographerApiData {
  id: string;
  username?: string;
  name: string;
  bio?: string;
  avatarUrl?: string;
  location?: { city?: string };
  rating?: { average?: number; totalReviews?: number };
  experience?: number;
  specializations?: string[];
  hourlyRate?: number;
  email?: string;
  socialMedia?: { instagram?: string; vk?: string; telegram?: string };
  portfolio?: PhotographerApiPortfolioItem[];
}

interface PhotographerApiPortfolioItem {
  id?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  serviceName?: string;
  description?: string;
  category?: string;
  serviceCategory?: string;
  createdAt?: string;
}

/** Shape of items returned by the portfolio endpoint */
interface MinioPortfolioRawItem {
  id?: string;
  title?: string;
  category?: string;
  imageUrl?: string;
  url?: string;
  image?: string;
  images?: string[];
  description?: string;
  date?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PhotographerPersonalService {
  private readonly http = inject(HttpClient);
  private log = inject(LoggerService);
  private readonly cacheData = new Map<string, PhotographerPersonalProfile>();

  /**
   * Получить профиль фотографа по slug
   */
  getPhotographerProfile(slug: string): Observable<PhotographerPersonalProfile> {
    // Проверяем кэш
    if (this.cacheData.has(slug)) {
      return of(this.cacheData.get(slug)!);
    }

    // Используем правильный endpoint для публичного API
    return this.http.get<{success: boolean, data: PhotographerApiData}>(`/api/public/photographers/${slug}`)
      .pipe(
        map(response => {
          if (!response.success || !response.data) {
            throw new Error('Фотограф не найден');
          }
          
          const profile = this.adaptApiDataToProfile(response.data);
          this.cacheData.set(slug, profile);
          return profile;
        }),
        catchError(error => {
          this.log.debug(`API недоступен для фотографа ${slug}, используем fallback данные:`, error);
          
          // Если API недоступен, используем fallback данные (но галерея будет пустая)
          const fallbackData = FALLBACK_PHOTOGRAPHERS[slug];
          if (fallbackData) {
            // У fallback данных очищаем галерею, так как она должна приходить только из API
            const fallbackWithEmptyPortfolio = { ...fallbackData, portfolio: [] };
            this.cacheData.set(slug, fallbackWithEmptyPortfolio);
            return of(fallbackWithEmptyPortfolio);
          }
          
          // Если нет fallback данных, возвращаем ошибку
          return throwError(() => new Error(`Фотограф с slug "${slug}" не найден`));
        })
      );
  }

  /**
   * Адаптирует данные от API к нашему интерфейсу
   */
  private adaptApiDataToProfile(apiData: PhotographerApiData): PhotographerPersonalProfile {
    return {
      id: apiData.id,
      slug: apiData.id || apiData.username || '', // Используем employee_id (id) как slug, это правильный идентификатор
      name: apiData.name,
      title: 'Профессиональный фотограф',
      bio: apiData.bio || '',
      avatar: apiData.avatarUrl || '/assets/images/default-avatar.jpg',
      coverImage: '/assets/images/photographer-cover.jpg',
      location: `${apiData.location?.city || 'Ростов-на-Дону'}`,
      rating: apiData.rating?.average || 5.0,
      reviewsCount: apiData.rating?.totalReviews || 0,
      experience: `${apiData.experience || 5}+ лет`,
      specializations: apiData.specializations || [],
      
      // AIDA секции
      attention: {
        headline: `Сохрани эмоции важного дня вместе с ${apiData.name}`,
        subheadline: 'Профессиональная фотосъёмка с выездом в любую точку города',
        tagline: 'Твои лучшие моменты достойны быть запечатлёнными профессионально'
      },
      
      interest: {
        whyChooseMe: {
          experience: `${apiData.experience || 5}+ лет профессионального опыта`,
          style: 'Авторский стиль и индивидуальный подход',
          flexibility: 'Выезд на любое мероприятие в удобное время'
        },
        achievements: [
          'Более 500 довольных клиентов',
          'Участник профессиональных выставок',
          'Сертифицированный фотограф'
        ],
        workingAreas: ['Ростов-на-Дону', 'Ростовская область', 'Выезд по договоренности']
      },
      
      desire: {
        emotionalText: 'Доверь нам самые важные моменты, и ты получишь не просто фотографии, а истории, наполненные теплом, радостью и нежностью. Каждый снимок будет отражать уникальную атмосферу твоего события.',
        mainPackages: [
          {
            id: 'warm-memories',
            name: 'Тёплые воспоминания',
            emoji: '✨',
            description: 'Идеально для небольших мероприятий',
            features: [
              'Выезд фотографа на место мероприятия',
              'Фотосессия продолжительностью от 1 часа',
              'Профессиональная обработка всех лучших кадров',
              'Экспресс-анонс (до 5 фотографий) уже в день мероприятия',
              'Онлайн-галерея для удобного скачивания и обмена снимками'
            ],
            price: apiData.hourlyRate || 3000,
            duration: '1 час'
          },
          {
            id: 'celebration-complete',
            name: 'Праздник под ключ',
            emoji: '🎉',
            description: 'Популярный выбор для торжеств',
            features: [
              'Всё, что входит в пакет «Тёплые воспоминания»',
              'Печать 20 лучших фото формата 10 × 15 прямо на месте мероприятия',
              'Ручная ретушь 10 избранных фотографий с особым вниманием к деталям'
            ],
            price: (apiData.hourlyRate || 3000) * 2,
            duration: '2-3 часа',
            highlighted: true
          },
          {
            id: 'premium-story',
            name: 'Премиум-история',
            emoji: '💎',
            description: 'Эксклюзивный пакет для особых событий',
            features: [
              'Всё из пакета «Праздник под ключ»',
              'Эксклюзивный фотокнига-альбом с авторским оформлением',
              'Полная ручная ретушь избранных фотографий',
              'Персональная консультация фотографа по стилю и атмосфере'
            ],
            price: (apiData.hourlyRate || 3000) * 4,
            duration: '4+ часа'
          }
        ],
        additionalServices: [
          {
            id: 'guest-portraits',
            name: 'Мини-портрет гостям',
            description: 'Каждый гость получит персональный портрет с ручной ретушью прямо во время мероприятия',
            icon: 'portrait',
            isPremium: true
          },
          {
            id: 'express-retouch',
            name: 'Экспресс-ретушь и анонс фото',
            description: 'Получи 5 профессионально отредактированных фотографий уже в день мероприятия для соцсетей',
            icon: 'flash_on'
          },
          {
            id: 'hand-retouch',
            name: 'Ручная ретушь избранных кадров',
            description: 'Эксклюзивная услуга которая подчеркнёт твою красоту и естественность без лишнего глянца',
            icon: 'brush',
            isPremium: true
          },
          {
            id: 'instant-print',
            name: 'Печать любимых кадров на месте',
            description: 'Услуга мгновенной печати фотографий формата 10×15 или 20×30 непосредственно во время мероприятия',
            icon: 'print'
          }
        ],
        specialOffers: [
          {
            id: 'studio-certificate',
            emoji: '🎀',
            title: 'Подарочный сертификат на студийную фотосессию',
            description: 'для всех клиентов, оформивших заказ онлайн с полной оплатой заранее'
          },
          {
            id: 'repeat-discount',
            emoji: '🥂',
            title: 'Скидка 20% на повторную съёмку',
            description: 'идеальное решение для постоянных клиентов и семей, выбирающих нас снова и снова'
          },
          {
            id: 'photo-calendar',
            emoji: '📅',
            title: 'Календарь с твоим фото',
            description: 'в подарок при бронировании выездной фотосессии продолжительностью от 3 часов и онлайн-оплате заранее'
          }
        ],
        whyChooseUs: [
          'Ручная ретушь, это не просто слова. Мы сохраняем индивидуальность каждого клиента, подчёркивая естественную красоту',
          'Мобильность и оперативность, мы приезжаем вовремя, работаем незаметно и создаём кадры, которые по-настоящему живые и искренние',
          'Прозрачные и фиксированные цены, никаких скрытых платежей и дополнительных сюрпризов',
          'Индивидуальный подход, твои пожелания становятся основой нашей работы'
        ]
      },
      
      action: {
        ctaText: 'Забронируй фотосессию прямо сейчас!',
        onlineDiscount: 20,
        bonusOffer: 'Скидка 20% при онлайн-оплате',
        contactMethods: [
          { type: 'phone', value: '+78633226575', label: 'Позвонить', icon: 'phone' },
          { type: 'vk', value: 'https://vk.com/im?sel=-68371131', label: 'ВКонтакте', icon: 'vk' },
          { type: 'telegram', value: 'magnus_photo', label: 'Telegram', icon: 'telegram' },
          { type: 'email', value: apiData.email || 'photo@example.com', label: 'Email', icon: 'email' }
        ]
      },
      
      portfolio: apiData.portfolio?.map((item) => ({
        id: item.id || String(Math.random()),
        image: item.imageUrl || '',
        title: item.title || item.serviceName || 'Фотография',
        description: item.description || '',
        category: item.category || item.serviceCategory || 'portfolio',
        date: item.createdAt || ''
      })) || [], // Если портфолио пустое, возвращаем пустой массив
      
      testimonials: [],
      
      // Дополнительные поля
      availability: {
        isAvailable: true,
        workingHours: { start: '09:00', end: '21:00' },
        workingDays: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
        busyDates: []
      },
      
      pricing: {
        startingPrice: apiData.hourlyRate || 3000,
        currency: 'RUB',
        priceRange: {
          min: apiData.hourlyRate || 3000,
          max: (apiData.hourlyRate || 3000) * 3
        },
        packages: [
          {
            id: '1',
            name: 'Базовый пакет',
            description: 'Идеально для небольших мероприятий',
            price: apiData.hourlyRate || 3000,
            duration: '1 час',
            features: ['20 обработанных фото', 'Быстрая ретушь', 'Цифровая галерея'],
            icon: 'camera_alt'
          }
        ]
      },
      
      social: {
        instagram: apiData.socialMedia?.instagram || '',
        vk: apiData.socialMedia?.vk || '',
        telegram: apiData.socialMedia?.telegram || ''
      },
      
      seo: {
        title: `${apiData.name} - Профессиональный фотограф в Ростове-на-Дону`,
        description: `Профессиональная фотосъёмка от ${apiData.name}. ${apiData.bio || 'Качественные фотографии для ваших важных моментов.'}`,
        keywords: ['фотограф', 'фотосессия', 'Ростов-на-Дону', ...apiData.specializations || []],
        ogImage: apiData.avatarUrl || '/assets/images/default-og.jpg'
      }
    };
  }

  /**
   * Получить список всех фотографов (краткая информация)
   */
  getAllPhotographers(): Observable<PhotographerPersonalProfile[]> {
    return this.http.get<{success: boolean, data: PhotographerPersonalProfile[]}>(`/api/public/photographers`)
      .pipe(
        map(response => {
          if (!response.success) {
            throw new Error('Ошибка получения списка фотографов');
          }
          return response.data || [];
        }),
        catchError(error => {
          this.log.error('Error loading photographers list:', error);
          throw error;
        })
      );
  }

  /**
   * Отправить заявку на бронирование к фотографу
   */
  submitBookingRequest(photographerId: string, bookingData: Record<string, unknown>): Observable<{success: boolean, message: string}> {
    return this.http.post<{success: boolean, message: string}>(`/api/photographer/booking-request`, {
      photographerId,
      ...bookingData
    }).pipe(
      catchError(error => {
        this.log.error('Ошибка при отправке заявки:', error);
        // В случае ошибки возвращаем имитацию успеха для демо
        return of({
          success: true,
          message: 'Заявка отправлена! Фотограф свяжется с вами в ближайшее время.'
        });
      })
    );
  }

  /**
   * Получить доступность фотографа на конкретную дату
   */
  checkAvailability(photographerId: string, date: string): Observable<{available: boolean, reason?: string}> {
    return this.http.get<{available: boolean, reason?: string}>(`/api/photographer/availability/${photographerId}?date=${date}`)
      .pipe(
        catchError(error => {
          this.log.debug('API недоступен для проверки доступности, используем fallback:', error);
          
          // Fallback логика для проверки доступности
          const photographer = Object.values(FALLBACK_PHOTOGRAPHERS).find(p => p.id === photographerId);
          if (photographer && photographer.availability.busyDates.includes(date)) {
            return of({ available: false, reason: 'Дата уже занята' });
          }
          
          return of({ available: true });
        })
      );
  }

  /**
   * Получить отзывы о фотографе
   */
  getPhotographerReviews(photographerId: string, limit = 10): Observable<unknown[]> {
    return this.http.get<{success: boolean, data: unknown[]}>(`/api/public/photographers/${photographerId}/reviews?limit=${limit}`)
      .pipe(
        map(response => response.data),
        catchError(error => {
          this.log.debug('API недоступен для отзывов, используем fallback данные:', error);
          
          // Возвращаем fallback отзывы
          const photographer = Object.values(FALLBACK_PHOTOGRAPHERS).find(p => p.id === photographerId);
          return of(photographer?.testimonials || []);
        })
      );
  }

  /**
   * Отправить сообщение фотографу
   */
  sendMessage(photographerId: string, messageData: {name: string, contact: string, message: string}): Observable<{success: boolean, message: string}> {
    return this.http.post<{success: boolean, message: string}>(`/api/photographer/message`, {
      photographerId,
      ...messageData
    }).pipe(
      catchError(error => {
        this.log.error('Ошибка при отправке сообщения:', error);
        // В случае ошибки возвращаем имитацию успеха для демо
        return of({
          success: true,
          message: 'Сообщение отправлено! Фотограф ответит вам в ближайшее время.'
        });
      })
    );
  }

  /**
   * Получить портфолио фотографа из MinIO
   */
  getPhotographerPortfolio(slug: string): Observable<PortfolioItem[]> {
    return this.http.get<{success: boolean, data: { portfolio?: MinioPortfolioRawItem[] }}>(`/api/public/photographers/${slug}/portfolio`)
      .pipe(
        map(response => {
          if (response.success && response.data) {
            // Преобразуем данные в нужный формат
            return (response.data.portfolio || []).map((item) => ({
              id: item.id || String(Math.random()),
              title: item.title || 'Фотография',
              category: item.category || 'Общее',
              image: item.imageUrl || item.url || item.image || '',
              images: item.images || [],
              description: item.description || '',
              date: item.date || new Date().toISOString()
            }));
          }
          this.log.warn('API вернул пустое портфолио для', slug);
          return [];
        }),
        catchError(error => {
          this.log.error('Ошибка загрузки портфолио:', error);
          return of([]);
        })
      );
  }
}
