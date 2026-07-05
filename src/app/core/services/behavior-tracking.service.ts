/**
 * BehaviorTrackingService — SSR-safe сервис записи сессий (rrweb) и поведенческих событий.
 *
 * Записываются:
 *  - rrweb DOM-снепшоты → /api/replay/chunks (каждые 30с + NavigationEnd + beforeunload)
 *  - Поведенческие события → /api/replay/events (батч каждые 10с)
 *
 * Не работает на /employee/* страницах.
 * Скип если navigator.connection.saveData или deviceMemory < 2.
 */

import { Injectable, inject, PLATFORM_ID, afterNextRender, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FingerprintService } from './fingerprint.service';

interface BehaviorEvent {
  session_id: string;
  visitor_id: string;
  fingerprint_visitor_id: string | null;
  event_type: string;
  event_category?: string;
  page_path?: string;
  page_title?: string;
  element_selector?: string;
  element_text?: string;
  value_numeric?: number;
  value_text?: string;
  properties?: Record<string, unknown>;
  click_x?: number;
  click_y?: number;
  viewport_width?: number;
  viewport_height?: number;
  time_on_page_ms?: number;
}

const REPLAY_SESSION_STORAGE_KEY = 'sf_replay_session_id';
const REPLAY_SESSION_READY_EVENT = 'sf:replay-session-ready';

@Injectable({ providedIn: 'root' })
export class BehaviorTrackingService {
  private readonly platformId         = inject(PLATFORM_ID);
  private readonly router             = inject(Router);
  private readonly destroyRef         = inject(DestroyRef);
  private readonly fingerprintService = inject(FingerprintService);

  private sessionId: string | null = null;
  private visitorId: string | null = null;
  private chunkIndex = 0;
  private rrwebStop: (() => void) | null | undefined = null;
  private rrwebBuffer: unknown[] = [];
  private eventBuffer: BehaviorEvent[] = [];
  private chunkFlushTimer: ReturnType<typeof setInterval> | null = null;
  private eventFlushTimer: ReturnType<typeof setInterval> | null = null;
  private pageStartTime = 0;
  private currentPath = '';
  private totalPages = 0;
  private totalClicks = 0;
  private clickTimes: number[] = []; // для rage-click
  private lastClickX = 0;
  private lastClickY = 0;
  private onSubmitCapture: ((e: SubmitEvent) => void) | null = null;
  private scrollDepthsFired = new Set<number>();
  private scrollMaxDepth = 0;

  constructor() {
    afterNextRender(() => {
      if (!this.shouldRecord()) return;
      this.init();
    });
  }

  // ─── Guards ──────────────────────────────────────────────────────────────────

  private shouldRecord(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    // Не записываем CRM
    if (window.location.pathname.startsWith('/employee')) return false;

    // Экономим трафик на медленных соединениях
    const nav = navigator as Navigator & { connection?: { saveData?: boolean }; deviceMemory?: number };
    if (nav.connection?.saveData) return false;
    if (nav.deviceMemory != null && nav.deviceMemory < 2) return false;

    return true;
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    this.visitorId = this.getVisitorId();
    this.currentPath = window.location.pathname;
    this.pageStartTime = Date.now();

    // Создаём сессию на бэкенде
    try {
      const resp = await fetch('/api/replay/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitor_id: this.visitorId,
          fingerprint_visitor_id: this.fingerprintService.visitorId() ?? null,
          landing_page: window.location.pathname,
          user_agent: navigator.userAgent,
          screen_width: screen.width,
          screen_height: screen.height,
        }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      this.sessionId = data.session_id;
      this.persistReplaySessionId(this.sessionId);
    } catch {
      return; // сервер недоступен — тихо пропускаем
    }

    // Запускаем rrweb (dynamic import)
    this.startRrweb();

    // Поведенческие события
    this.attachEventListeners();

    // Таймеры flush
    this.chunkFlushTimer = setInterval(() => this.flushChunk(), 30_000);
    this.eventFlushTimer = setInterval(() => this.flushEvents(), 10_000);

    // Навигация
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((e: NavigationEnd) => this.onNavigation(e));

    // beforeunload
    const onUnload = () => {
      this.flushChunk(true);
      this.flushEvents(true);
      this.endSession();
    };
    window.addEventListener('beforeunload', onUnload);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeunload', onUnload);
      this.cleanup();
    });

    // Первый page_view
    this.pushEvent({
      event_type: 'page_view',
      event_category: 'navigation',
      page_path: this.currentPath,
      page_title: document.title,
    });
    this.totalPages++;
  }

  // ─── rrweb ───────────────────────────────────────────────────────────────────

  private async startRrweb(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const { record } = await import('rrweb');
      this.rrwebStop = record({
        emit: (event: unknown) => this.rrwebBuffer.push(event),
        maskAllInputs: true,
        blockSelector: '.rrweb-block, input[type="password"], input[type="tel"]',
        sampling: {
          scroll: 100,
          input: 'last' as const,
        },
        checkoutEveryNms: 30_000,
      });
    } catch {
      // rrweb не загружен — продолжаем без записи видео
    }
  }

  private async flushChunk(sync = false): Promise<void> {
    if (!this.sessionId || this.rrwebBuffer.length === 0) return;
    const events = this.rrwebBuffer.splice(0);
    const payload = {
      session_id: this.sessionId,
      visitor_id: this.visitorId,
      fingerprint_visitor_id: this.fingerprintService.visitorId() ?? null,
      chunk_index: this.chunkIndex++,
      events,
      event_count: events.length,
      start_time: (events[0] as Record<string, unknown>)?.['timestamp'],
      end_time: (events[events.length - 1] as Record<string, unknown>)?.['timestamp'],
    };
    const body = JSON.stringify(payload);
    if (sync && navigator.sendBeacon) {
      navigator.sendBeacon('/api/replay/chunks', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/replay/chunks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => { /* noop */ });
    }
  }

  // ─── Поведенческие события ───────────────────────────────────────────────────

  private attachEventListeners(): void {
    // Клики
    const onClickCapture = (e: MouseEvent) => this.onGlobalClick(e);
    document.addEventListener('click', onClickCapture, { capture: true, passive: true });

    // Scroll depth (depthsFired/maxDepth — поля класса, сбрасываются при навигации)
    const depths = [25, 50, 75, 100];
    const onScroll = () => {
      const h = document.documentElement;
      const depth = Math.round(((window.scrollY + window.innerHeight) / h.scrollHeight) * 100);
      if (depth > this.scrollMaxDepth) {
        this.scrollMaxDepth = depth;
        for (const d of depths) {
          if (depth >= d && !this.scrollDepthsFired.has(d)) {
            this.scrollDepthsFired.add(d);
            this.pushEvent({
              event_type: 'scroll_depth',
              event_category: 'engagement',
              page_path: this.currentPath,
              value_numeric: d,
              viewport_width: window.innerWidth,
              viewport_height: window.innerHeight,
            });
          }
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // JS errors
    const onError = (e: ErrorEvent) => {
      this.pushEvent({
        event_type: 'js_error',
        event_category: 'error',
        page_path: this.currentPath,
        value_text: `${e.message} @ ${e.filename}:${e.lineno}`,
      });
    };
    const onUnhandled = (e: PromiseRejectionEvent) => {
      this.pushEvent({
        event_type: 'js_error',
        event_category: 'error',
        page_path: this.currentPath,
        value_text: String(e.reason),
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandled);

    // Form submit
    this.onSubmitCapture = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      this.pushEvent({
        event_type: 'form_submit',
        event_category: 'conversion',
        page_path: this.currentPath,
        element_selector: this.getSelector(form),
      });
    };
    document.addEventListener('submit', this.onSubmitCapture, { capture: true, passive: true });

    this.destroyRef.onDestroy(() => {
      document.removeEventListener('click', onClickCapture, { capture: true });
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandled);
      if (this.onSubmitCapture) {
        document.removeEventListener('submit', this.onSubmitCapture, { capture: true });
      }
    });
  }

  private onGlobalClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const now = Date.now();

    // rage-click: 3+ кликов за 1с в радиусе 100px
    this.clickTimes = this.clickTimes.filter(t => now - t < 1000);
    this.clickTimes.push(now);
    const dx = Math.abs(e.clientX - this.lastClickX);
    const dy = Math.abs(e.clientY - this.lastClickY);
    const sameArea = dx < 100 && dy < 100;
    if (this.clickTimes.length >= 3 && sameArea) {
      this.pushEvent({
        event_type: 'rage_click',
        event_category: 'engagement',
        page_path: this.currentPath,
        click_x: Math.round(e.clientX),
        click_y: Math.round(e.clientY),
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        element_selector: this.getSelector(target),
      });
    }
    this.lastClickX = e.clientX;
    this.lastClickY = e.clientY;

    this.totalClicks++;
    this.pushEvent({
      event_type: 'click',
      event_category: 'engagement',
      page_path: this.currentPath,
      click_x: Math.round(e.clientX),
      // clientY + scrollY = координата от верха документа (page-relative, не viewport-relative)
      click_y: Math.round(e.clientY + window.scrollY),
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      element_selector: this.getSelector(target),
      element_text: (target.innerText || target.getAttribute('aria-label') || '').substring(0, 200).trim() || undefined,
      time_on_page_ms: Date.now() - this.pageStartTime,
    });
  }

  private onNavigation(e: NavigationEnd): void {
    const newPath = e.urlAfterRedirects.split('?')[0];
    if (newPath === this.currentPath) return;

    // Если пользователь перешёл в CRM — останавливаем запись
    if (newPath.startsWith('/employee')) {
      this.cleanup();
      return;
    }

    // Flush накопленных данных при смене страницы
    this.flushChunk();
    this.flushEvents();

    // Сбрасываем scroll depth для новой страницы
    this.scrollDepthsFired.clear();
    this.scrollMaxDepth = 0;

    this.currentPath = newPath;
    this.pageStartTime = Date.now();
    this.totalPages++;

    this.pushEvent({
      event_type: 'page_view',
      event_category: 'navigation',
      page_path: newPath,
      page_title: document.title,
    });
  }

  private pushEvent(ev: Omit<BehaviorEvent, 'session_id' | 'visitor_id' | 'fingerprint_visitor_id'>): void {
    if (!this.sessionId || !this.visitorId) return;
    this.eventBuffer.push({
      session_id: this.sessionId,
      visitor_id: this.visitorId,
      fingerprint_visitor_id: this.fingerprintService.visitorId() ?? null,
      ...ev,
    });
  }

  private async flushEvents(sync = false): Promise<void> {
    if (!this.sessionId || this.eventBuffer.length === 0) return;
    const events = this.eventBuffer.splice(0);
    const body = JSON.stringify({
      events,
      fingerprint_visitor_id: this.fingerprintService.visitorId() ?? null,
    });
    if (sync && navigator.sendBeacon) {
      navigator.sendBeacon('/api/replay/events', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/replay/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => { /* noop */ });
    }
  }

  // ─── Session end ──────────────────────────────────────────────────────────────

  private endSession(): void {
    if (!this.sessionId) return;
    const payload = JSON.stringify({
      total_pages: this.totalPages,
      total_clicks: this.totalClicks,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        `/api/replay/sessions/${this.sessionId}/end`,
        new Blob([payload], { type: 'application/json' })
      );
    } else {
      fetch(`/api/replay/sessions/${this.sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => { /* noop */ });
    }
  }

  private cleanup(): void {
    if (this.chunkFlushTimer) clearInterval(this.chunkFlushTimer);
    if (this.eventFlushTimer) clearInterval(this.eventFlushTimer);
    this.rrwebStop?.();
  }

  // ─── Публичные хуки (вызываются другими сервисами) ───────────────────────────

  /** Хук: открыт чат */
  trackChatOpen(): void {
    this.pushEvent({
      event_type: 'chat_open',
      event_category: 'conversion',
      page_path: this.currentPath,
    });
    this.flushEvents();
  }

  /** Хук: клик по мессенджеру в CTA-панели чата */
  trackChatMessengerClick(channel: 'telegram' | 'vk' | 'max' | 'whatsapp'): void {
    this.pushEvent({
      event_type: 'chat_messenger_click',
      event_category: 'conversion',
      page_path: this.currentPath,
      value_text: channel,
    });
    this.flushEvents();
  }

  /** Хук: клик по OAuth-провайдеру в CTA-панели чата */
  trackChatOAuthClick(providerId: string): void {
    this.pushEvent({
      event_type: 'chat_oauth_click',
      event_category: 'conversion',
      page_path: this.currentPath,
      value_text: providerId,
    });
    this.flushEvents();
  }

  /** Хук: шаг конфигуратора */
  trackConfiguratorStep(step: string, value?: string): void {
    this.pushEvent({
      event_type: 'configurator_step',
      event_category: 'engagement',
      page_path: this.currentPath,
      value_text: step,
      properties: { value },
    });
  }

  /** Хук: добавление в корзину */
  trackCartAdd(productName: string, price: number): void {
    this.pushEvent({
      event_type: 'cart_add',
      event_category: 'conversion',
      page_path: this.currentPath,
      value_text: productName,
      value_numeric: price,
    });
    this.flushEvents();
  }

  // ─── Utils ────────────────────────────────────────────────────────────────────

  private getVisitorId(): string {
    try {
      let id = localStorage.getItem('visitor_id');
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem('visitor_id', id);
      }
      return id;
    } catch {
      return 'anon_' + Math.random().toString(36).slice(2);
    }
  }

  private persistReplaySessionId(sessionId: string | null): void {
    if (!sessionId) return;
    try {
      sessionStorage.setItem(REPLAY_SESSION_STORAGE_KEY, sessionId);
      window.dispatchEvent(new CustomEvent(REPLAY_SESSION_READY_EVENT, {
        detail: { sessionId },
      }));
    } catch {
      // ignore storage/event failures
    }
  }

  private getSelector(el: HTMLElement | null, depth = 0): string {
    if (!el || el === document.body || depth > 4) return '';
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
      : '';
    return `${tag}${id}${cls}`;
  }
}
