import { Injectable, inject, signal, computed, afterNextRender, DestroyRef, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { FingerprintService } from './fingerprint.service';
import { LoggerService } from './logger.service';

interface TelegramWebAppWindow {
  Telegram?: { WebApp?: { initDataUnsafe?: { start_param?: string } } };
}

function isTelegramWebAppWindow(w: unknown): w is TelegramWebAppWindow {
  return typeof w === 'object' && w !== null && 'Telegram' in w;
}

const CDN_SAFE_TRACKING_COOKIE_PREFIX = 'sfv_';
const TRACKING_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPACT_UUID_PATTERN = /^[0-9a-f]{32}$/i;

function compactUuidToCanonical(value: string): string {
  const lower = value.toLowerCase();
  return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
}

function canonicalUuidToCompact(value: string): string {
  return value.replace(/-/g, '').toLowerCase();
}

/**
 * Параметры tracking из URL.
 */
interface TrackingParams {
  tracking_id: string;
  tracking: string;
  tracking_referrer: string;
  tracking_pos: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
}

/**
 * Данные о визите для отправки на сервер.
 */
interface VisitData {
  // Идентификаторы
  tracking_id: string;
  fingerprint_visitor_id: string | null;
  visitor_id: string;
  device_fingerprint: string;
  replay_session_id: string | null;
  
  // Tracking метки
  tracking: string;
  tracking_referrer: string;
  tracking_pos: string;
  
  // UTM метки
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  
  // Данные о визите
  landing_page: string;
  host: string;
  referrer: string;
  user_agent: string;
  first_visit_id: string;
  
  // Устройство
  device_is_mobile: boolean;
}

/**
 * TrackingService - Сервис отслеживания рекламных переходов.
 * 
 * Интегрирует:
 * - Fingerprint Pro (95-99% точность идентификации)
 * - Собственную систему tracking (сохранение в БД)
 * 
 * Собирает данные при переходе по рекламе и отправляет на сервер
 * для последующей multi-touch атрибуции.
 * 
 * ВАЖНО: Работает на ВСЕХ страницах, отслеживая изменения роута.
 */
@Injectable({
  providedIn: 'root'
})
export class TrackingService {
  private fingerprintService = inject(FingerprintService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  
  // API endpoint для сохранения кликов
  private readonly API_URL = ''; // Используем относительный путь для SSR proxy
  private readonly TRACKING_API = '/api/tracking/click';
  private readonly REPLAY_SESSION_STORAGE_KEY = 'sf_replay_session_id';
  private readonly REPLAY_SESSION_READY_EVENT = 'sf:replay-session-ready';
  private readonly VISITOR_ID_STORAGE_KEY = 'visitor_id';
  private readonly FIRST_VISIT_ID_STORAGE_KEY = 'first_visit_id';
  
  // Сигналы состояния
  private _isInitialized = signal(false);
  private _trackingParams = signal<TrackingParams | null>(null);
  private _visitorId = signal<string | null>(null);
  
  readonly isInitialized = computed(() => this._isInitialized());
  readonly hasTrackingParams = computed(() => this._trackingParams() !== null);
  
  // Флаг блокировки для предотвращения race condition (двойной вызов initTracking)
  private isTracking = false;

  // Множество отправленных tracking_id для предотвращения дубликатов (sessionStorage)
  private get sentTrackingIds(): Set<string> {
    try {
      const stored = sessionStorage.getItem('sent_tracking_ids');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  }

  private addSentTrackingId(trackingId: string): void {
    try {
      const ids = this.sentTrackingIds;
      ids.add(trackingId);
      // Храним только последние 100 для предотвращения роста
      sessionStorage.setItem('sent_tracking_ids', JSON.stringify([...ids].slice(-100)));
    } catch { /* noop */ }
  }

  constructor() {
    // Автоматическая инициализация после первого рендеринга (только в браузере)
    afterNextRender(() => {
      this.initTracking();
      
      // Подписываемся на изменения роута для отслеживания переходов на другие страницы
      const subscription = this.router.events
        .pipe(filter(event => event instanceof NavigationEnd))
        .subscribe(() => {
          // Проверяем есть ли tracking параметры в новом URL
          const params = this.extractTrackingParams();
          if (params.tracking_id || params.utm_source) {
            this.log.debug('📊 Route changed with tracking params, re-initializing...');
            this.initTracking();
          }
        });
      
      // Автоматическая очистка подписки при уничтожении сервиса (современный подход)
      this.destroyRef.onDestroy(() => {
        subscription.unsubscribe();
      });
    });
  }
  
  /**
   * Инициализация tracking.
   * Вызывается автоматически после первого рендеринга и при изменении роута с tracking параметрами.
   */
  async initTracking(): Promise<void> {
    // SSR защита - tracking работает только в браузере
    if (!isPlatformBrowser(this.platformId)) {
      this.log.debug('📊 SSR: skipping tracking initialization');
      this._isInitialized.set(true);
      return;
    }

    this.migrateLegacyTrackingCookies();

    // Re-entry guard: предотвращаем race condition при параллельных вызовах
    // (afterNextRender + NavigationEnd стреляют одновременно)
    if (this.isTracking) {
      this.log.debug('📊 initTracking already in progress, skipping');
      return;
    }
    this.isTracking = true;

    try {
      // 1. Извлекаем tracking параметры из URL
      const trackingParams = this.extractTrackingParams();
      this._trackingParams.set(trackingParams);

      // Проверяем QR-код параметр (qr=location_id)
      const qrLocation = this.extractQrParam();
      if (qrLocation) {
        this.log.debug('📱 QR scan detected:', qrLocation);
        await this.trackQrScan(qrLocation);
      }

      // Если нет tracking параметров - это не рекламный переход (но QR уже обработан выше)
      if (!trackingParams.tracking_id && !trackingParams.utm_source && !qrLocation) {
        this.log.debug('📊 No tracking params - organic visit');
        return;
      }

      // Если был только QR без других параметров - можно завершить
      if (qrLocation && !trackingParams.tracking_id && !trackingParams.utm_source) {
        return;
      }

      // 2. Получаем/создаём visitor_id
      const visitorId = this.getOrCreateVisitorId();
      this._visitorId.set(visitorId);

      // 3. Получаем Fingerprint visitorId (ждём готовность)
      await this.fingerprintService.ready;
      const fingerprintId = this.fingerprintService.visitorId();

      // Генерируем tracking_id из UTM если отсутствует (для дедупликации кликов из ЯД/VK).
      // visitor_id в суффиксе нужен, чтобы backend ON CONFLICT (tracking_id) DO UPDATE
      // не схлопывал разных пользователей одной кампании в один row.
      if (!trackingParams.tracking_id && trackingParams.utm_source) {
        trackingParams.tracking_id = `${trackingParams.utm_source}_${trackingParams.utm_campaign || ''}_${trackingParams.utm_content || ''}_${trackingParams.utm_term || ''}_${visitorId.slice(0, 12)}`;
      }

      // Проверяем на дубликаты - не отправляем повторно для одного tracking_id
      if (trackingParams.tracking_id && this.sentTrackingIds.has(trackingParams.tracking_id)) {
        this.log.debug('📊 Tracking already sent for this tracking_id, skipping');
        return;
      }

      this.log.debug('📊 Tracking params detected:', trackingParams);
      this.log.debug('📍 Current page:', window.location.href);

      // 4. Собираем данные о визите
      const replaySessionId = await this.waitForReplaySessionId(800);
      const visitData: VisitData = {
        // Идентификаторы
        tracking_id: trackingParams.tracking_id,
        fingerprint_visitor_id: fingerprintId,
        visitor_id: visitorId,
        device_fingerprint: this.createDeviceFingerprint(),
        replay_session_id: replaySessionId,

        // Tracking метки
        tracking: trackingParams.tracking,
        tracking_referrer: trackingParams.tracking_referrer,
        tracking_pos: trackingParams.tracking_pos,

        // UTM метки
        utm_source: trackingParams.utm_source,
        utm_medium: trackingParams.utm_medium,
        utm_campaign: trackingParams.utm_campaign,
        utm_content: trackingParams.utm_content,
        utm_term: trackingParams.utm_term,

        // Данные о визите
        landing_page: window.location.href,
        host: window.location.host,
        referrer: document.referrer,
        user_agent: navigator.userAgent,
        first_visit_id: this.getFirstVisitId(),

        // Устройство
        device_is_mobile: /Mobile|Android|iPhone|iPad/.test(navigator.userAgent),
      };

      // 5. Отправляем на сервер
      await this.sendClickToServer(visitData);

      // 6. Запоминаем, что отправили для этого tracking_id (в sessionStorage)
      if (trackingParams.tracking_id) {
        this.addSentTrackingId(trackingParams.tracking_id);
      }

      this.log.info('✅ Tracking initialized successfully');

    } catch {
      // tracking init failed silently
    } finally {
      this.isTracking = false;
      this._isInitialized.set(true);
    }
  }

  private readReplaySessionId(): string | null {
    try {
      return sessionStorage.getItem(this.REPLAY_SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  }

  private waitForReplaySessionId(timeoutMs: number): Promise<string | null> {
    if (!isPlatformBrowser(this.platformId)) return Promise.resolve(null);

    const existing = this.readReplaySessionId();
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve) => {
      let resolved = false;
      const finish = (value: string | null) => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener(this.REPLAY_SESSION_READY_EVENT, onReady as EventListener);
        clearTimeout(timer);
        resolve(value);
      };
      const onReady = (event: Event) => {
        const customEvent = event as CustomEvent<{ sessionId?: string }>;
        finish(customEvent.detail?.sessionId ?? this.readReplaySessionId());
      };
      const timer = window.setTimeout(() => finish(this.readReplaySessionId()), timeoutMs);
      window.addEventListener(this.REPLAY_SESSION_READY_EVENT, onReady as EventListener, { once: true });
    });
  }
  
  /**
   * Извлечение tracking параметров из URL с фильтрацией плейсхолдеров.
   */
  private extractTrackingParams(): TrackingParams {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return {
        tracking_id: '',
        tracking: '',
        tracking_referrer: '',
        tracking_pos: '',
        utm_source: '',
        utm_medium: '',
        utm_campaign: '',
        utm_content: '',
        utm_term: '',
      };
    }
    
    const params = new URLSearchParams(window.location.search);
    
    // Функция для очистки параметра от плейсхолдеров
    const cleanParam = (value: string | null): string => {
      if (!value) return '';
      
      // Игнорируем плейсхолдеры (содержат фигурные скобки)
      if (value.includes('{') || value.includes('}')) {
        return '';
      }
      
      return value;
    };
    
    let utm_source = cleanParam(params.get('utm_source'));
    let utm_medium = cleanParam(params.get('utm_medium'));
    let utm_campaign = cleanParam(params.get('utm_campaign'));
    let utm_content = cleanParam(params.get('utm_content'));
    let utm_term = cleanParam(params.get('utm_term'));

    // Авто-детекция рекламных платформ по click ID параметрам
    // Яндекс.Директ всегда добавляет yclid, даже если UTM не настроены
    if (!utm_source) {
      const yclid = params.get('yclid');
      const gclid = params.get('gclid');
      const fbclid = params.get('fbclid');

      if (yclid) {
        utm_source = 'yandex_direct';
        utm_medium = utm_medium || 'cpc';
        utm_campaign = utm_campaign || `yclid_${yclid.substring(0, 8)}`;
        this.log.debug('📊 Auto-detected Yandex Direct click via yclid');
      } else if (gclid) {
        utm_source = 'google';
        utm_medium = utm_medium || 'cpc';
        this.log.debug('📊 Auto-detected Google Ads click via gclid');
      } else if (fbclid) {
        utm_source = 'facebook';
        utm_medium = utm_medium || 'cpc';
        this.log.debug('📊 Auto-detected Facebook click via fbclid');
      }
    }

    const tgParam = isTelegramWebAppWindow(window)
      ? window.Telegram?.WebApp?.initDataUnsafe?.start_param
      : undefined;
    if (tgParam && !utm_source) {
      const parsed = this.parseTgStartParam(tgParam);
      utm_source = parsed.utm_source ?? 'telegram';
      utm_medium = parsed.utm_medium ?? 'messenger';
      utm_campaign = parsed.utm_campaign ?? utm_campaign;
      utm_content = parsed.utm_content ?? utm_content;
      utm_term = parsed.utm_term ?? utm_term;
      this.log.debug('📊 Auto-detected Telegram Mini App click via start_param');
    }

    return {
      tracking_id: cleanParam(params.get('tracking_id')),
      tracking: cleanParam(params.get('tracking')),
      tracking_referrer: cleanParam(params.get('tracking_referrer')),
      tracking_pos: cleanParam(params.get('tracking_pos')),
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
    };
  }

  private parseTgStartParam(payload: string): {
    utm_source?: string; utm_medium?: string; utm_campaign?: string;
    utm_content?: string; utm_term?: string;
  } {
    const trimmed = payload.trim();
    if (!trimmed) return {};
    if (trimmed.includes('-') && /[a-z]+-[\w\d]+/i.test(trimmed)) {
      const pairs = trimmed.split('_');
      const utm: Record<string, string> = {};
      for (const p of pairs) {
        const idx = p.indexOf('-');
        if (idx <= 0) continue;
        const k = p.slice(0, idx).toLowerCase();
        const v = p.slice(idx + 1);
        if (!v) continue;
        if (k === 'src' || k === 'source') utm['utm_source'] = v;
        else if (k === 'med' || k === 'medium') utm['utm_medium'] = v;
        else if (k === 'cmp' || k === 'campaign') utm['utm_campaign'] = v;
        else if (k === 'cnt' || k === 'content') utm['utm_content'] = v;
        else if (k === 'trm' || k === 'term') utm['utm_term'] = v;
      }
      if (utm['utm_campaign'] || utm['utm_source']) return utm;
    }
    return { utm_source: 'telegram', utm_medium: 'messenger', utm_campaign: trimmed.slice(0, 100) };
  }
  
  /**
   * Извлечь QR параметр из URL.
   * Формат: ?qr=location_id (например: ?qr=studio1)
   */
  private extractQrParam(): string | null {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    
    const params = new URLSearchParams(window.location.search);
    const qr = params.get('qr');
    
    if (qr && !qr.includes('{')) {  // Игнорируем плейсхолдеры
      return qr;
    }
    
    return null;
  }
  
  /**
   * Отправить информацию о сканировании QR-кода на сервер.
   */
  private async trackQrScan(locationId: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    try {
      // Получаем fingerprint
      await this.fingerprintService.ready;
      const fingerprintId = this.fingerprintService.visitorId();
      const trackingId = this.getOrCreateVisitorId().substring(0, 8);
      
      const response = await fetch(`${this.API_URL}/api/tracking/qr`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          location_id: locationId,
          fingerprint_visitor_id: fingerprintId,
          tracking_id: trackingId,
        }),
      });
      
      if (!response.ok) {
        return;
      }
      
      const result = await response.json();
      this.log.debug('📱 QR scan tracked:', result);
      
      // Сохраняем location в localStorage для дальнейшей корреляции
      localStorage.setItem('qr_location', locationId);
      localStorage.setItem('qr_scan_time', Date.now().toString());
      
    } catch {
      // QR scan tracking failed silently
    }
  }
  
  /**
   * Получить или создать visitor_id.
   */
  private getOrCreateVisitorId(): string {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return 'ssr-visitor-' + Date.now();
    }
    
    // Проверяем localStorage
    let visitorId = localStorage.getItem(this.VISITOR_ID_STORAGE_KEY);
    if (visitorId) {
      this.setTrackingCookie(this.VISITOR_ID_STORAGE_KEY, visitorId);
      return visitorId;
    }
    
    // Создаём новый
    visitorId = crypto.randomUUID();
    localStorage.setItem(this.VISITOR_ID_STORAGE_KEY, visitorId);
    this.setTrackingCookie(this.VISITOR_ID_STORAGE_KEY, visitorId);
    
    return visitorId;
  }
  
  /**
   * Получить ID первого визита (для мультиканальности).
   */
  private getFirstVisitId(): string {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return 'ssr-first-visit-' + Date.now();
    }
    
    let firstVisitId = localStorage.getItem(this.FIRST_VISIT_ID_STORAGE_KEY);
    if (firstVisitId) {
      this.setTrackingCookie(this.FIRST_VISIT_ID_STORAGE_KEY, firstVisitId);
      return firstVisitId;
    }
    
    firstVisitId = crypto.randomUUID();
    localStorage.setItem(this.FIRST_VISIT_ID_STORAGE_KEY, firstVisitId);
    this.setTrackingCookie(this.FIRST_VISIT_ID_STORAGE_KEY, firstVisitId);
    
    return firstVisitId;
  }
  
  /**
   * Создание простого device fingerprint.
   */
  private createDeviceFingerprint(): string {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return 'ssr-fingerprint-' + Date.now();
    }
    
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      new Date().getTimezoneOffset().toString(),
    ];
    
    // Простой хеш
    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return 'df_' + Math.abs(hash).toString(16);
  }
  
  /**
   * Отправка данных о клике на сервер.
   */
  private async sendClickToServer(data: VisitData): Promise<void> {
    try {
      // Отправляем через fetch для надёжности
      const response = await fetch(this.TRACKING_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      this.log.debug('📤 Click data sent to server');
      
    } catch {
      this.saveFailedRequest(data);
    }
  }
  
  /**
   * Сохранение неотправленного запроса для повторной отправки.
   */
  private saveFailedRequest(data: VisitData): void {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    try {
      const failed = JSON.parse(localStorage.getItem('tracking_failed') || '[]');
      failed.push({ data, timestamp: Date.now() });
      // Храним только последние 10 неотправленных
      localStorage.setItem('tracking_failed', JSON.stringify(failed.slice(-10)));
    } catch {
      // ignore localStorage errors
    }
  }
  
  /**
   * Повторная отправка неотправленных запросов.
   */
  async retryFailedRequests(): Promise<void> {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    try {
      const failed = JSON.parse(localStorage.getItem('tracking_failed') || '[]');
      if (failed.length === 0) return;
      
      const remaining = [];
      
      for (const item of failed) {
        try {
          await this.sendClickToServer(item.data);
        } catch {
          remaining.push(item);
        }
      }
      
      if (remaining.length > 0) {
        localStorage.setItem('tracking_failed', JSON.stringify(remaining));
      } else {
        localStorage.removeItem('tracking_failed');
      }
      
    } catch {
      // ignore retry errors
    }
  }
  
  // ========== Утилиты ==========

  private migrateLegacyTrackingCookies(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.migrateLegacyTrackingCookie(this.VISITOR_ID_STORAGE_KEY);
    this.migrateLegacyTrackingCookie(this.FIRST_VISIT_ID_STORAGE_KEY);
  }

  private migrateLegacyTrackingCookie(name: string): void {
    const cookieValue = this.getCookie(name);
    const storedValue = localStorage.getItem(name);
    const decodedCookieValue = cookieValue ? this.fromTrackingCookieValue(cookieValue) : null;

    if (decodedCookieValue && !storedValue) {
      localStorage.setItem(name, decodedCookieValue);
    }

    const trackingId = localStorage.getItem(name) ?? decodedCookieValue;
    if (!trackingId) {
      return;
    }

    this.expireCookie(name);
    this.setTrackingCookie(name, trackingId);
  }
  
  private getCookie(name: string): string | null {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
  }

  private fromTrackingCookieValue(value: string): string {
    const decodedValue = decodeURIComponent(value);
    if (decodedValue.startsWith(CDN_SAFE_TRACKING_COOKIE_PREFIX)) {
      const compactUuid = decodedValue.slice(CDN_SAFE_TRACKING_COOKIE_PREFIX.length);
      if (COMPACT_UUID_PATTERN.test(compactUuid)) {
        return compactUuidToCanonical(compactUuid);
      }
    }

    return decodedValue;
  }

  private toTrackingCookieValue(value: string): string {
    const decodedValue = this.fromTrackingCookieValue(value);
    if (UUID_PATTERN.test(decodedValue)) {
      return `${CDN_SAFE_TRACKING_COOKIE_PREFIX}${canonicalUuidToCompact(decodedValue)}`;
    }

    return encodeURIComponent(decodedValue);
  }

  private setTrackingCookie(name: string, value: string): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const secure = window.location.protocol === 'https:' ? ';Secure' : '';
    document.cookie = `${name}=${this.toTrackingCookieValue(value)};path=/;max-age=${TRACKING_COOKIE_MAX_AGE_SECONDS};SameSite=Lax${secure}`;
  }
  
  private expireCookie(name: string): void {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const expiredCookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;SameSite=Lax`;
    document.cookie = expiredCookie;

    const hostname = window.location.hostname;
    if (!hostname || hostname === 'localhost' || /^\d+(?:\.\d+){3}$/.test(hostname)) {
      return;
    }

    document.cookie = `${expiredCookie};domain=${hostname}`;

    const parts = hostname.split('.');
    if (parts.length > 2) {
      document.cookie = `${expiredCookie};domain=.${parts.slice(-2).join('.')}`;
    }
  }
  
  // ========== Публичные методы ==========
  
  /**
   * Получить текущие tracking данные для отправки с конверсией.
   */
  getTrackingDataForConversion(): {
    fingerprint_visitor_id: string | null;
    visitor_id: string | null;
    first_visit_id: string | null;
    tracking_params: TrackingParams | null;
  } {
    // SSR защита
    if (!isPlatformBrowser(this.platformId)) {
      return {
        fingerprint_visitor_id: null,
        visitor_id: null,
        first_visit_id: null,
        tracking_params: null,
      };
    }
    
    return {
      fingerprint_visitor_id: this.fingerprintService.visitorId(),
      visitor_id: this._visitorId(),
      first_visit_id: localStorage.getItem('first_visit_id'),
      tracking_params: this._trackingParams(),
    };
  }
}
