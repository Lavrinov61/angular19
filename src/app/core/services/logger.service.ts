import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { APP_VERSION } from '../constants/version';

interface RemoteLogEntry {
  level: string;
  message: string;
  service?: string;
  context?: Record<string, unknown>;
  url?: string;
  appVersion?: string;
  timestamp?: string;
  fingerprint?: string;
}

/**
 * ContextLogger — дочерний логгер с привязкой к сервису.
 *
 * Использование:
 *   private readonly log = inject(LoggerService).createChild('InboxService');
 *   this.log.error('Failed to load', { httpStatus: 500 });
 */
export class ContextLogger {
  constructor(
    readonly service: string,
    private readonly parent: LoggerService,
  ) {}

  debug(message: string, ...rest: unknown[]): void {
    this.parent.debug(`[${this.service}] ${message}`, ...rest);
  }

  info(message: string, ...rest: unknown[]): void {
    this.parent.info(`[${this.service}] ${message}`, ...rest);
  }

  warn(message: string, ...rest: unknown[]): void {
    this.parent.warn(`[${this.service}] ${message}`, ...rest);
    const meta = rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest[0] as Record<string, unknown> : undefined;
    this.parent.queueRemote('warn', message, meta, this.service);
  }

  error(message: string, ...rest: unknown[]): void {
    this.parent.error(`[${this.service}] ${message}`, ...rest);
    const meta = rest[0] && typeof rest[0] === 'object' && !Array.isArray(rest[0]) ? rest[0] as Record<string, unknown> : undefined;
    this.parent.queueRemote('error', message, meta, this.service);
  }
}

/**
 * LoggerService — централизованное логирование.
 *
 * - dev (ng serve): все уровни выводятся в консоль
 * - prod: только warn/error (для мониторинга реальных проблем)
 * - prod + localStorage.debug=true: все уровни (для отладки на проде)
 *
 * Использование:
 *   private readonly log = inject(LoggerService);
 *   this.log.info('Сообщение', data);
 *
 * Structured logging (рекомендуется для сервисов):
 *   private readonly log = inject(LoggerService).createChild('MyService');
 *   this.log.error('Ошибка', { httpStatus: 500, url: '/api/...' });
 */
@Injectable({ providedIn: 'root' })
export class LoggerService {
  private readonly enabled: boolean;
  private readonly isBrowser: boolean;
  private readonly logFn: (...args: unknown[]) => void;
  private readonly debugFn: (...args: unknown[]) => void;

  private readonly http = inject(HttpClient);
  private remoteBuffer: RemoteLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly sentFingerprints = new Set<string>();
  private readonly FLUSH_INTERVAL = 5_000;
  private readonly MAX_BUFFER = 20;
  private readonly DEDUP_WINDOW = 300_000; // 5 min

  constructor() {
    this.isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
    const debugOverride = this.isBrowser && localStorage.getItem('debug') === 'true';
    this.enabled = !environment.production || debugOverride;

    // Native console methods сохранены в main.ts до override
    if (this.isBrowser && (window as unknown as Record<string, unknown>)['__nativeLog']) {
      this.logFn = (window as unknown as Record<string, unknown>)['__nativeLog'] as (...args: unknown[]) => void;
      this.debugFn = (window as unknown as Record<string, unknown>)['__nativeDebug'] as (...args: unknown[]) => void;
    } else {
      this.logFn = console.log.bind(console);
      this.debugFn = console.debug.bind(console);
    }
  }

  /** Создать дочерний логгер с привязкой к сервису */
  createChild(service: string): ContextLogger {
    return new ContextLogger(service, this);
  }

  /** Детальная отладка (только dev / debug mode) */
  debug(...args: unknown[]): void {
    if (this.enabled) this.debugFn(...args);
  }

  /** Информационные сообщения (только dev / debug mode) */
  info(...args: unknown[]): void {
    if (this.enabled) this.logFn(...args);
  }

  /** Предупреждения (всегда видны) */
  warn(...args: unknown[]): void {
    console.warn(...args);
  }

  /** Ошибки (всегда видны) */
  error(...args: unknown[]): void {
    console.error(...args);
  }

  /**
   * Поставить лог в очередь на отправку на сервер.
   * Вызывается автоматически из ContextLogger для warn/error.
   */
  queueRemote(level: string, message: string, meta?: Record<string, unknown>, service?: string): void {
    if (!this.isBrowser) return;

    const fingerprint = this.computeFingerprint(message, service, meta?.['httpUrl'] as string);

    // WS events: bypass dedup so backend counters reflect true event frequency
    const isWsEvent = service === 'WebSocket' && (
      (typeof message === 'string' && message.startsWith('WS ')) ||
      (meta != null && typeof meta['event'] === 'string')
    );
    if (!isWsEvent) {
      if (this.sentFingerprints.has(fingerprint)) return;
      this.sentFingerprints.add(fingerprint);
      setTimeout(() => this.sentFingerprints.delete(fingerprint), this.DEDUP_WINDOW);
    }

    this.remoteBuffer.push({
      level,
      message,
      service,
      context: meta,
      url: window.location.pathname,
      appVersion: APP_VERSION,
      timestamp: new Date().toISOString(),
      fingerprint,
    });

    if (this.remoteBuffer.length >= this.MAX_BUFFER) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL);
    }
  }

  private flush(): void {
    if (this.remoteBuffer.length === 0) return;
    const batch = this.remoteBuffer.splice(0);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Fire-and-forget — логирование никогда не ломает приложение
    this.http.post('/api/app-logs/batch', { logs: batch }).subscribe({
      error: () => { /* silent */ },
    });
  }

  private computeFingerprint(message: string, service?: string, httpUrl?: string): string {
    const raw = `${service || ''}:${message}:${httpUrl || ''}`;
    // Simple hash (djb2) — достаточно для дедупликации
    let hash = 5381;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) + hash + raw.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }
}
