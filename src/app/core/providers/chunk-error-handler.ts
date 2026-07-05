import { ErrorHandler, Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService, ContextLogger } from '../services/logger.service';

const RELOAD_KEY = 'sf_chunk_reload';
const RELOAD_COOLDOWN_MS = 10_000;

@Injectable()
export class ChunkErrorHandler implements ErrorHandler {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly log: ContextLogger = inject(LoggerService).createChild('ChunkErrorHandler');

  handleError(error: unknown): void {
    if (!isPlatformBrowser(this.platformId)) {
      console.error(error);
      return;
    }

    if (this.isChunkLoadError(error) && this.canReload()) {
      this.log.warn('Chunk load failed — unregistering SW and reloading', {
        message: (error as Error)?.message,
      });
      this.markReload();
      this.nukeSwAndReload();
      return;
    }

    // Все необработанные ошибки Angular → remote logging
    const err = error as Error;
    this.log.error(err?.message || 'Unhandled error', {
      name: err?.name,
      stack: err?.stack?.slice(0, 2000),
    });
  }

  private isChunkLoadError(error: unknown): boolean {
    if (!error) return false;
    const msg = (error as { message?: string }).message ?? '';
    const name = (error as { name?: string }).name ?? '';
    return (
      name === 'ChunkLoadError' ||
      msg.includes('Loading chunk') ||
      msg.includes('ChunkLoadError') ||
      msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('error loading dynamically imported module') ||
      msg.includes('Importing a module script failed')
    );
  }

  private canReload(): boolean {
    try {
      const last = sessionStorage.getItem(RELOAD_KEY);
      if (!last) return true;
      return Date.now() - parseInt(last, 10) > RELOAD_COOLDOWN_MS;
    } catch {
      return true;
    }
  }

  private markReload(): void {
    try {
      sessionStorage.setItem(RELOAD_KEY, Date.now().toString());
    } catch { /* ignore */ }
  }

  private nukeSwAndReload(): void {
    const unregisterAll = navigator.serviceWorker
      ? navigator.serviceWorker.getRegistrations().then(regs =>
          Promise.all(regs.map(r => r.unregister())),
        )
      : Promise.resolve([]);

    const clearCaches = caches
      ? caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      : Promise.resolve([]);

    Promise.all([unregisterAll, clearCaches]).finally(() => {
      window.location.reload();
    });
  }
}
