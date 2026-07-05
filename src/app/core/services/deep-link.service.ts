import { Injectable, inject, PLATFORM_ID, computed, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FingerprintService } from './fingerprint.service';
import { LoggerService } from './logger.service';
import { TrackingService } from './tracking.service';
import { STUDIO_PHONE_HREF } from '../data/address.data';
import { WHATSAPP_UNAVAILABLE_NOTICE } from '../data/contacts.data';

/**
 * Сервис для генерации deep links с fingerprint для мессенджеров.
 * 
 * Используется для связывания посетителей сайта с их аккаунтами
 * в мессенджерах через систему сквозной аналитики.
 * 
 * Формат Telegram deep link: t.me/FmagnusBot?start=fp_{fingerprint}_{tracking_id}
 */
@Injectable({
  providedIn: 'root'
})
export class DeepLinkService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly fingerprintService = inject(FingerprintService);
  private readonly trackingService = inject(TrackingService);
  private log = inject(LoggerService);

  // Конфигурация
  private readonly TELEGRAM_BOT_USERNAME = 'FmagnusBot';
  private readonly VK_GROUP_ID = '-68371131';
  private readonly MAX_BOT_URL = 'https://max.ru/id262603741214_bot';
  
  // Сигнал готовности (fingerprint загружен)
  private readonly _isReady = signal(false);
  readonly isReady = computed(() => this._isReady());
  
  constructor() {
    // Отслеживаем готовность fingerprint
    if (isPlatformBrowser(this.platformId)) {
      this.checkReadiness();
    }
  }
  
  /**
   * Проверяет готовность fingerprint (с ожиданием до 3 сек)
   */
  private async checkReadiness(): Promise<void> {
    try {
      await Promise.race([
        this.fingerprintService.ready,
        new Promise<void>(resolve => setTimeout(resolve, 3000)),
      ]);
    } catch { /* noop */ }
    this._isReady.set(true);
  }
  
  /**
   * Получить текущий tracking_id из URL или сгенерировать
   */
  private getTrackingId(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    
    // Пробуем получить из URL параметров
    const urlParams = new URLSearchParams(window.location.search);
    const trackingId = urlParams.get('tracking_id') || urlParams.get('tracking');
    
    if (trackingId) {
      return trackingId.substring(0, 8); // Ограничиваем длину для deep link
    }
    
    // Пробуем получить из localStorage (сохранённый ранее)
    const storedTracking = localStorage.getItem('tracking_id');
    if (storedTracking) {
      return storedTracking.substring(0, 8);
    }
    
    return null;
  }
  
  /**
   * Генерирует Telegram deep link с fingerprint.
   *
   * Формат: t.me/FmagnusBot?start=fp_{fingerprint}_{tracking}
   * 
   * @returns URL для кнопки Telegram
   */
  getTelegramLink(): string {
    // SSR - базовая ссылка (при гидрации обновится)
    if (!isPlatformBrowser(this.platformId)) {
      return `https://t.me/${this.TELEGRAM_BOT_USERNAME}`;
    }
    
    const visitorId = this.fingerprintService.visitorId();
    const trackingId = this.getTrackingId();
    
    // Fingerprint определяется ВСЕГДА в браузере
    // Формат: fp_{fingerprint}_{tracking} (ограничение 64 символа для Telegram)
    let startParam = `fp_${visitorId}`;
    
    if (trackingId) {
      startParam += `_${trackingId}`;
    }
    
    // Telegram deep link ограничен 64 символами
    if (startParam.length > 64) {
      startParam = startParam.substring(0, 64);
    }
    
    this.log.debug('📊 Generated Telegram deep link:', startParam);
    return `https://t.me/${this.TELEGRAM_BOT_USERNAME}?start=${startParam}`;
  }
  
  /**
   * Генерирует VK ссылку с fingerprint в ref параметре.
   * 
   * VK поддерживает передачу ref параметра для групп:
   * Формат: https://vk.com/im?sel=-68371131&ref=fp_{fingerprint}_{tracking}
   * 
   * @returns URL для кнопки VK
   */
  getVkLink(): string {
    // SSR - базовая ссылка
    if (!isPlatformBrowser(this.platformId)) {
      return `https://vk.com/im?sel=${this.VK_GROUP_ID}`;
    }
    
    const visitorId = this.fingerprintService.visitorId();
    const trackingId = this.getTrackingId();
    
    // Базовая ссылка на сообщения группы
    const baseUrl = `https://vk.com/im?sel=${this.VK_GROUP_ID}`;
    
    // Fingerprint всегда есть - добавляем ref параметр
    let refParam = `fp_${visitorId}`;
    
    if (trackingId) {
      refParam += `_${trackingId}`;
    }
    
    // Ограничиваем длину ref
    if (refParam.length > 50) {
      refParam = refParam.substring(0, 50);
    }
    
    this.log.debug('📊 Generated VK link with ref:', refParam);
    return `${baseUrl}&ref=${encodeURIComponent(refParam)}`;
  }
  
  /**
   * Генерирует МАКС ссылку с fingerprint в start параметре.
   * 
   * МАКС поддерживает передачу payload через start параметр:
   * Формат: https://max.ru/id262603741214_bot?start=fp_{fingerprint}_{tracking}
   * 
   * @returns URL для кнопки МАКС
   */
  getMaxLink(): string {
    // SSR - базовая ссылка
    if (!isPlatformBrowser(this.platformId)) {
      return this.MAX_BOT_URL;
    }
    
    const visitorId = this.fingerprintService.visitorId();
    const trackingId = this.getTrackingId();
    
    // Fingerprint всегда есть - добавляем ref параметр
    let refParam = `fp_${visitorId}`;
    
    if (trackingId) {
      refParam += `_${trackingId}`;
    }
    
    // Ограничиваем длину ref
    if (refParam.length > 50) {
      refParam = refParam.substring(0, 50);
    }
    
    this.log.debug('📊 Generated МАКС link with start:', refParam);
    return `${this.MAX_BOT_URL}?start=${encodeURIComponent(refParam)}`;
  }
  
  /**
   * Генерирует WhatsApp ссылку.
   * WhatsApp не поддерживает start/ref параметры — используется простой wa.me.
   */
  getWhatsAppLink(): string {
    return 'https://wa.me/+79014178668';
  }

  /**
   * Получить телефонную ссылку
   */
  getPhoneLink(): string {
    return STUDIO_PHONE_HREF;
  }
  
  /**
   * Получить все контактные ссылки с fingerprint.
   * 
   * Используется для компонента контактов.
   */
  getContactLinks(): {label: string; href: string; icon: string; notice?: string}[] {
    return [
      {
        label: 'МАКС',
        href: this.getMaxLink(),
        icon: 'max'
      },
      {
        label: 'Telegram',
        href: this.getTelegramLink(),
        icon: 'telegram'
      },
      {
        label: 'WhatsApp',
        href: this.getWhatsAppLink(),
        icon: 'whatsapp',
        notice: WHATSAPP_UNAVAILABLE_NOTICE
      },
      {
        label: 'ВКонтакте', 
        href: this.getVkLink(), 
        icon: 'vk' 
      },
      { 
        label: 'Позвонить', 
        href: this.getPhoneLink(), 
        icon: 'call' 
      }
    ];
  }
  
  /**
   * Обновить ссылку с текущим fingerprint (вызывать при клике).
   * 
   * Полезно если fingerprint загрузился после первого рендера.
   */
  refreshLink(type: 'telegram' | 'vk' | 'whatsapp' | 'phone' | 'max'): string {
    switch (type) {
      case 'max':
        return this.getMaxLink();
      case 'telegram':
        return this.getTelegramLink();
      case 'whatsapp':
        return this.getWhatsAppLink();
      case 'vk':
        return this.getVkLink();
      case 'phone':
        return this.getPhoneLink();
      default:
        return '';
    }
  }
}
