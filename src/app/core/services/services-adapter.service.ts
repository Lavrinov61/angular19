import { Injectable } from '@angular/core';
import { ServiceDoc, SERVICES } from '../data/services.data';
import {
  ServiceOption,
  ServiceType,
  ServiceCategory,
  ServiceAddon,
  PaymentOption
} from '../models/enhanced-booking.model';

@Injectable({
  providedIn: 'root'
})
export class ServicesAdapterService {

  /**
   * Преобразует ServiceDoc в ServiceOption для системы бронирования
   */
  private adaptServiceDocToServiceOption(serviceDoc: ServiceDoc, serviceType: ServiceType): ServiceOption {
    const category = this.mapServiceIdToCategory(serviceDoc.id);
    
    return {
      id: serviceDoc.id,
      name: serviceDoc.title,
      title: serviceDoc.title,
      description: serviceDoc.description,
      basePrice: serviceDoc.price || 0,
      priceType: 'fixed' as const,
      duration: this.getServiceDuration(serviceDoc.id),
      preparationTime: this.getPreparationTime(serviceDoc.id),
      photosIncluded: this.getPhotosIncluded(serviceDoc.id),
      maxPersons: this.getMaxPersons(serviceDoc.id),
      minPersons: 1,
      category,
      type: serviceType,
      isActive: true,
      isPopular: serviceDoc.tag === 'popular',
      features: serviceDoc.features || [],
      image: serviceDoc.image,
      gallery: [],
      icon: serviceDoc.icon || 'photo_camera',
      color: serviceDoc.colorAccent || 'var(--ed-accent, #f59e0b)',
      includes: this.getServiceIncludes(serviceDoc.id),
      excludes: this.getServiceExcludes(serviceDoc.id),
      tags: this.getServiceTags(serviceDoc.id, category),
      availablePhotographers: this.getAvailablePhotographers(serviceDoc.id),
      requiresSpecificPhotographer: this.requiresSpecificPhotographer(serviceDoc.id),
      photographerSelectionAllowed: this.allowsPhotographerSelection(serviceDoc.id),
      allowCustomLocation: serviceType === ServiceType.ON_LOCATION,
      paymentOptions: this.getPaymentOptions(serviceDoc.id),
      addons: this.getServiceAddons(serviceDoc.id)
    };
  }

  /**
   * Получает все студийные услуги из services.data.ts
   */
  getStudioServices(): ServiceOption[] {
    return SERVICES
      .filter(service => this.isStudioService(service.id))
      .map(service => this.adaptServiceDocToServiceOption(service, ServiceType.STUDIO));
  }

  /**
   * Получает все выездные услуги из services.data.ts
   */
  getOnLocationServices(): ServiceOption[] {
    return SERVICES
      .filter(service => this.isOnLocationService(service.id))
      .map(service => this.adaptServiceDocToServiceOption(service, ServiceType.ON_LOCATION));
  }

  /**
   * Получает услуги по типу
   */
  getServicesByType(type: ServiceType): ServiceOption[] {
    return type === ServiceType.STUDIO 
      ? this.getStudioServices() 
      : this.getOnLocationServices();
  }

  /**
   * Получает услуги по категории
   */
  getServicesByCategory(category: ServiceCategory, type?: ServiceType): ServiceOption[] {
    let services = SERVICES.filter(service => 
      this.mapServiceIdToCategory(service.id) === category
    );

    if (type) {
      services = services.filter(service => 
        type === ServiceType.STUDIO 
          ? this.isStudioService(service.id)
          : this.isOnLocationService(service.id)
      );
    }

    return services.map(service => 
      this.adaptServiceDocToServiceOption(
        service, 
        type || (this.isStudioService(service.id) ? ServiceType.STUDIO : ServiceType.ON_LOCATION)
      )
    );
  }

  // Вспомогательные методы для маппинга данных
  private isStudioService(serviceId: string): boolean {
    // Студийные услуги - только то, что делается в помещении Своё Фото
    // с 2 фонами (черный и белый)
    const studioServices = [
      'foto-na-document',   // Фото на документы
      'passport-photo',     // Фото на паспорт  
      'visa-photo',         // Фото на визу
      'portrait-photo',     // Портретная фотосъёмка (классическая, 1-2 человека)
      'business-portrait'   // Деловые портреты (в студии Своё Фото)
    ];
    return studioServices.includes(serviceId);
  }

  private isOnLocationService(serviceId: string): boolean {
    // Выездные услуги - все остальные (художественные студии, локации)
    const onLocationServices = [
      'beauty-portrait',    // Beauty-портреты (в арендованной студии)
      'family-photo',       // Семейная фотосъёмка
      'kids-photo',         // Детская фотосъёмка
      'newborn-photo',      // Фотосъёмка новорождённых
      'wedding-photo',      // Свадебная фотосъёмка
      'love-story',         // Love Story
      'engagement-photo',   // Фотосъёмка помолвки
      'art-photo',          // Художественная фотосъёмка
      'fashion-photo',      // Fashion фотосъёмка
      'concept-photo',      // Концептуальная фотосъёмка
      'reportage-photo',    // Репортажная фотосъёмка
      'corporate-photo',    // Корпоративная фотосъёмка
      'birthday-photo'      // Фотосъёмка дня рождения
    ];
    return onLocationServices.includes(serviceId);
  }
  private mapServiceIdToCategory(serviceId: string): ServiceCategory {
    const categoryMap: Record<string, ServiceCategory> = {
      // Документы
      'foto-na-document': ServiceCategory.DOCUMENTS,
      'passport-photo': ServiceCategory.DOCUMENTS,
      'visa-photo': ServiceCategory.DOCUMENTS,
      
      // Портреты
      'portrait-photo': ServiceCategory.PORTRAIT,
      'business-portrait': ServiceCategory.BUSINESS,
      'beauty-portrait': ServiceCategory.BEAUTY,
      
      // Семейные
      'family-photo': ServiceCategory.FAMILY,
      'kids-photo': ServiceCategory.KIDS,
      'newborn-photo': ServiceCategory.NEWBORN,
      
      // Свадебные/романтические
      'wedding-photo': ServiceCategory.WEDDING,
      'love-story': ServiceCategory.LOVE_STORY,
      'engagement-photo': ServiceCategory.COUPLE,
        // Художественные
      'art-photo': ServiceCategory.PORTRAIT,
      'fashion-photo': ServiceCategory.FASHION,
      'concept-photo': ServiceCategory.PORTRAIT,
      
      // Корпоративные/события
      'reportage-photo': ServiceCategory.EVENT,
      'corporate-photo': ServiceCategory.BUSINESS,
      'birthday-photo': ServiceCategory.EVENT
    };
    return categoryMap[serviceId] || ServiceCategory.PORTRAIT;
  }
  private getServiceDuration(serviceId: string): number {
    const durations: Record<string, number> = {
      // Документы (быстро)
      'foto-na-document': 15,
      'passport-photo': 15,
      'visa-photo': 15,
      
      // Студийные портреты
      'portrait-photo': 60,
      'business-portrait': 45,
      
      // Выездные
      'beauty-portrait': 90,
      'family-photo': 60,
      'kids-photo': 60,
      'newborn-photo': 120,
      'love-story': 120,
      'engagement-photo': 90,
      'wedding-photo': 480, // 8 часов
      'art-photo': 120,
      'fashion-photo': 150,
      'concept-photo': 180,
      'reportage-photo': 240,   // 4 часа
      'corporate-photo': 120,
      'birthday-photo': 180
    };
    return durations[serviceId] || 60;
  }

  private getPreparationTime(serviceId: string): number {
    const documentServices = ['foto-na-document', 'passport-photo', 'visa-photo'];
    return documentServices.includes(serviceId) ? 5 : 15;
  }
  private getPhotosIncluded(serviceId: string): number {
    const photosMap: Record<string, number> = {
      // Документы
      'foto-na-document': 4,
      'passport-photo': 2,
      'visa-photo': 2,
      
      // Студийные портреты
      'portrait-photo': 20,
      'business-portrait': 15,
      
      // Выездные
      'beauty-portrait': 25,
      'family-photo': 30,
      'kids-photo': 25,
      'newborn-photo': 30,
      'love-story': 40,
      'engagement-photo': 25,
      'wedding-photo': 200,
      'art-photo': 30,
      'fashion-photo': 35,
      'concept-photo': 25,
      'reportage-photo': 100,
      'corporate-photo': 50,
      'birthday-photo': 60
    };
    return photosMap[serviceId] || 20;
  }

  private getMaxPersons(serviceId: string): number {
    const maxPersonsMap: Record<string, number> = {
      'foto-na-document': 1,
      'passport-photo': 1,
      'visa-photo': 1,
      'portrait-photo': 2,
      'business-portrait': 1,
      'beauty-portrait': 1,
      'family-photo': 8,
      'couple-photo': 2,
      'love-story': 2,
      'wedding-photo': 100,
      'event-photo': 100,
      'maternity-photo': 2,
      'newborn-photo': 3,
      'kids-photo': 5,
      'commercial-photo': 10
    };
    return maxPersonsMap[serviceId] || 4;
  }

  private getServiceIncludes(serviceId: string): string[] {
    const includesMap: Record<string, string[]> = {
      'foto-na-document': ['Съёмка', 'Печать 4 фото', 'Базовая ретушь'],
      'passport-photo': ['Съёмка', 'Печать фото', 'Базовая ретушь'],
      'visa-photo': ['Съёмка', 'Печать фото', 'Ретушь по требованиям'],
      'portrait-photo': ['Съёмка', 'Ретушь', 'Цифровые копии'],
      'business-portrait': ['Съёмка', 'Профессиональная ретушь', 'Цифровые файлы'],
      'beauty-portrait': ['Съёмка', 'Глубокая ретушь', 'Цифровые копии'],
      'family-photo': ['Съёмка', 'Ретушь всех фото', 'Галерея'],
      'couple-photo': ['Съёмка', 'Ретушь', 'Цифровая галерея'],
      'wedding-photo': ['Полный день съёмки', 'Ретушь', 'Онлайн-галерея']
    };
    return includesMap[serviceId] || ['Съёмка', 'Базовая ретушь', 'Цифровые копии'];
  }

  private getServiceExcludes(serviceId: string): string[] {
    const excludesMap: Record<string, string[]> = {
      'foto-na-document': ['Дополнительные копии', 'Срочное изготовление'],
      'passport-photo': ['Дополнительные копии', 'Экспресс-изготовление'],
      'portrait-photo': ['Макияж', 'Дополнительные образы'],
      'wedding-photo': ['Видеосъёмка', 'Второй фотограф']
    };
    return excludesMap[serviceId] || [];
  }

  private getServiceTags(serviceId: string, category: ServiceCategory): string[] {
    const baseTags = [category.toString()];
    
    const tagsMap: Record<string, string[]> = {
      'foto-na-document': ['документы', 'быстро', 'студия'],
      'passport-photo': ['документы', 'паспорт', 'студия'],
      'visa-photo': ['документы', 'виза', 'студия'],
      'portrait-photo': ['портрет', 'студия', 'профессионально'],
      'wedding-photo': ['свадьба', 'выезд', 'полный день']
    };
    
    return [...baseTags, ...(tagsMap[serviceId] || [])];
  }

  private getAvailablePhotographers(serviceId: string): string[] {
    const documentServices = ['foto-na-document', 'passport-photo', 'visa-photo'];
    if (documentServices.includes(serviceId)) {
      return []; // Документы могут снимать все
    }
    return ['photographer-1', 'photographer-2']; // Для остальных - специальные фотографы
  }

  private requiresSpecificPhotographer(serviceId: string): boolean {
    const documentServices = ['foto-na-document', 'passport-photo', 'visa-photo'];
    return !documentServices.includes(serviceId);
  }

  private allowsPhotographerSelection(serviceId: string): boolean {
    return this.requiresSpecificPhotographer(serviceId);
  }

  private getPaymentOptions(serviceId: string): PaymentOption[] {
    const documentServices = ['foto-na-document', 'passport-photo', 'visa-photo'];
    
    if (documentServices.includes(serviceId)) {
      return [{
        type: 'full',
        name: 'Полная оплата',
        description: 'Оплата при получении',
        percentage: 100,
        dueDate: 'after_session'
      }];
    }
    
    return [{
      type: 'deposit',
      name: 'Предоплата 50%',
      description: 'Оплата 50% при бронировании',
      percentage: 50,
      dueDate: 'booking'
    }];
  }

  private getServiceAddons(serviceId: string): ServiceAddon[] {
    // Базовые дополнения для всех услуг
    const baseAddons: ServiceAddon[] = [
      {
        id: 'rush-delivery',
        name: 'Срочное изготовление',
        description: 'Готовность за 1 час',
        price: 500,
        isOptional: true,
        category: 'delivery'
      }
    ];

    const addonsMap: Record<string, ServiceAddon[]> = {
      'portrait-photo': [
        ...baseAddons,
        {
          id: 'extra-retouching',
          name: 'Расширенная ретушь',
          description: 'Глубокая обработка всех фото',
          price: 1000,
          isOptional: true,
          category: 'processing'
        }
      ]
    };

    return addonsMap[serviceId] || baseAddons;
  }
}
