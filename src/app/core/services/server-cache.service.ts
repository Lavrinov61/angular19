import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { getNumericEnvVariable } from '../utils/env-utils';
import { LoggerService } from './logger.service';

/**
 * Интерфейс для настройки кэша
 */
export interface CacheOptions {
  ttl?: number; // Time to live в миллисекундах
  maxSize?: number; // Максимальное количество элементов в кэше
}

/**
 * Интерфейс элемента кэша
 */
interface CacheItem<T> {
  value: T;
  expires: number;
}

/**
 * Сервис для кэширования данных на сервере
 * Оптимизирует производительность SSR для повторных запросов
 */
@Injectable({
  providedIn: 'root'
})
export class ServerCacheService {
  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  private cache = new Map<string, CacheItem<unknown>>();
  private maxSize: number;
  private defaultTTL: number;
  
  constructor() {
    // Получаем значения из переменных окружения
    this.maxSize = getNumericEnvVariable('SERVER_CACHE_MAX_SIZE', 1000);
    this.defaultTTL = getNumericEnvVariable('SERVER_CACHE_TTL', 5 * 60 * 1000); // 5 минут по умолчанию
    
    if (isPlatformServer(this.platformId)) {
      this.log.debug(`ServerCacheService initialized with maxSize=${this.maxSize}, defaultTTL=${this.defaultTTL}ms`);
    }
  }
  
  /**
   * Получает значение из кэша
   * @param key Ключ для поиска в кэше
   * @returns Значение из кэша или null, если не найдено или истекло
   */
  get<T>(key: string): T | null {
    // Кэширование доступно только на сервере
    if (!isPlatformServer(this.platformId)) {
      return null;
    }
    
    const item = this.cache.get(key);
    
    // Если элемент не найден или истек срок его действия
    if (!item || Date.now() > item.expires) {
      if (item) {
        this.cache.delete(key); // Удаляем истекший элемент
      }
      return null;
    }
    
    return item.value as T;
  }
  
  /**
   * Сохраняет значение в кэше
   * @param key Ключ для сохранения
   * @param value Значение для сохранения
   * @param options Опции кэширования (ttl, maxSize)
   */
  set<T>(key: string, value: T, options?: CacheOptions): void {
    // Кэширование доступно только на сервере
    if (!isPlatformServer(this.platformId)) {
      return;
    }
    
    // Проверяем, не превышен ли размер кэша
    if (this.cache.size >= (options?.maxSize || this.maxSize)) {
      // Если кэш переполнен, удаляем самый старый элемент
      const iterator = this.cache.keys();
      const firstItem = iterator.next();
      if (!firstItem.done && firstItem.value) {
        this.cache.delete(firstItem.value);
      }
    }
    
    // Устанавливаем TTL (время жизни)
    const ttl = options?.ttl || this.defaultTTL;
    
    // Сохраняем элемент в кэше
    this.cache.set(key, {
      value,
      expires: Date.now() + ttl
    });
  }
  
  /**
   * Удаляет элемент из кэша
   * @param key Ключ элемента для удаления
   */
  delete(key: string): boolean {
    // Кэширование доступно только на сервере
    if (!isPlatformServer(this.platformId)) {
      return false;
    }
    
    return this.cache.delete(key);
  }
  
  /**
   * Очищает весь кэш
   */
  clear(): void {
    // Кэширование доступно только на сервере
    if (!isPlatformServer(this.platformId)) {
      return;
    }
    
    this.cache.clear();
  }
  
  /**
   * Проверяет, есть ли элемент в кэше и не истек ли его срок действия
   * @param key Ключ для проверки
   * @returns true если элемент существует и актуален, иначе false
   */
  has(key: string): boolean {
    // Кэширование доступно только на сервере
    if (!isPlatformServer(this.platformId)) {
      return false;
    }
    
    const item = this.cache.get(key);
    return !!item && Date.now() <= item.expires;
  }
  
  /**
   * Получает размер кэша (количество элементов)
   */
  size(): number {
    return this.cache.size;
  }
}
