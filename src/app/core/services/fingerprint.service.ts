import { Injectable, PLATFORM_ID, inject, signal, computed } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FingerprintCollectorService } from './fingerprint-collector.service';

/**
 * Сервис идентификации посетителей.
 *
 * Использует FingerprintCollectorService для получения sf_ visitor ID
 * от собственного Rust fingerprint-сервера (37 browser signals → стабильный ID).
 *
 * Публичный API сохранён для обратной совместимости с:
 * - visitor-chat.service.ts
 * - tracking.service.ts
 * - deep-link.service.ts
 */
@Injectable({ providedIn: 'root' })
export class FingerprintService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly collector = inject(FingerprintCollectorService);
  private readonly http = inject(HttpClient);

  private readonly STORAGE_KEY = 'sf_visitor_id';
  private readonly PREV_ID_KEY = 'sf_prev_id';
  private readonly MIGRATED_KEY = 'sf_migrated';
  private readonly CACHE_KEY = 'fp_visitor_cache';
  private readonly MIGRATE_URL = '/api/fingerprint/migrate';

  private _visitorId = signal<string | null>(null);
  private _requestId: string | null = null;
  private _isLoading = signal(false);
  private _error = signal<string | null>(null);

  private _readyResolve!: () => void;
  readonly ready = new Promise<void>(resolve => { this._readyResolve = resolve; });

  readonly visitorId = computed(() => this._visitorId());
  readonly isReady = computed(() => this._visitorId() !== null);
  readonly isLoading = computed(() => this._isLoading());
  readonly error = computed(() => this._error());

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      // Set immediate ID from localStorage (sync, no flicker)
      this._visitorId.set(this.resolveStoredId());
      // Then upgrade to real fingerprint asynchronously
      this.initFingerprint();
    }
  }

  /** Load stored ID synchronously for immediate availability. */
  private resolveStoredId(): string | null {
    try {
      const existing = localStorage.getItem(this.STORAGE_KEY);
      if (existing && !existing.startsWith('anon_')) return existing;

      // Миграция: подхватить старый FP Pro кеш
      const fpCache = localStorage.getItem(this.CACHE_KEY);
      if (fpCache) {
        const { visitorId } = JSON.parse(fpCache) as { visitorId: string };
        if (typeof visitorId === 'string' && visitorId.length > 0) {
          localStorage.setItem(this.STORAGE_KEY, visitorId);
          return visitorId;
        }
      }
    } catch { /* localStorage недоступен */ }

    // No anon_ fallback — wait for real sf_ fingerprint from Rust server
    return null;
  }

  /** Call collector to get real sf_ fingerprint, update signal reactively. */
  private async initFingerprint(): Promise<void> {
    this._isLoading.set(true);
    this._error.set(null);

    try {
      const result = await this.collector.collect();

      if (result.visitor_id && result.visitor_id !== '') {
        const currentId = this._visitorId();

        // Migration: if current ID is fp_ (legacy), save it and migrate DB references
        if (currentId && currentId.startsWith('fp_')) {
          try {
            if (!localStorage.getItem(this.PREV_ID_KEY)) {
              localStorage.setItem(this.PREV_ID_KEY, currentId);
            }
          } catch { /* noop */ }
          this.migrateVisitorId(currentId, result.visitor_id);
        }

        // Persist visitor ID on first identification (null/fp_ → sf_)
        // Once a stable sf_/fp_ ID is assigned, it stays — fingerprint drift must not break session lookup
        const storedId = (() => { try { return localStorage.getItem(this.STORAGE_KEY) || ''; } catch { return ''; } })();
        const isStable = storedId.startsWith('sf_') || storedId.startsWith('fp_');

        if (!isStable) {
          try { localStorage.setItem(this.STORAGE_KEY, result.visitor_id); } catch { /* noop */ }
        } else if (storedId !== result.visitor_id) {
          // Fingerprint drifted — save drifted ID but keep stable storedId
          this.appendDriftedId(result.visitor_id);
        }
        // Signal always reflects STABLE storedId (no drift)
        this._visitorId.set(isStable ? storedId : result.visitor_id);
        this._requestId = result.request_id;
      }
    } catch (err) {
      this._error.set(err instanceof Error ? err.message : 'Fingerprint collection failed');
      // Keep whatever ID we already have (cached sf_ or null)
    } finally {
      this._isLoading.set(false);
      this._readyResolve();
    }
  }

  /** Возвращает visitor ID (обёрнут в Promise для совместимости). */
  getVisitorId(_forceRefresh = false): Promise<string | null> {
    return Promise.resolve(this._visitorId());
  }

  getTrackingData(): {
    fingerprint_visitor_id: string | null;
    fingerprint_request_id: string | null;
    fingerprint_linked_id: string | null;
  } {
    return {
      fingerprint_visitor_id: this._visitorId(),
      fingerprint_request_id: this._requestId,
      fingerprint_linked_id: null,
    };
  }

  getLastRequestId(): string | null { return this._requestId; }

  /** Fire-and-forget: tell Rust server to migrate old_id → new_id in DB tables. */
  private migrateVisitorId(oldId: string, newId: string): void {
    try {
      if (localStorage.getItem(this.MIGRATED_KEY) === `${oldId}:${newId}`) return;
    } catch { /* noop */ }

    firstValueFrom(
      this.http.post<{ success: boolean; rows_affected: number }>(
        this.MIGRATE_URL,
        { old_id: oldId, new_id: newId },
      ),
    ).then(resp => {
      if (resp.success) {
        try { localStorage.setItem(this.MIGRATED_KEY, `${oldId}:${newId}`); } catch { /* noop */ }
      }
    }).catch(() => { /* best effort — will retry on next visit */ });
  }

  /** Wait for fingerprint to be ready, then return the stable visitor ID. */
  async getStableVisitorId(): Promise<string> {
    await this.ready;
    return this._visitorId() ?? '';
  }

  /** Save a drifted fingerprint ID to localStorage (max 10 entries). */
  appendDriftedId(id: string): void {
    try {
      const raw = localStorage.getItem('sf_drifted_ids');
      const arr: string[] = raw ? JSON.parse(raw) : [];
      if (!arr.includes(id)) {
        arr.push(id);
        if (arr.length > 10) arr.shift();
      }
      localStorage.setItem('sf_drifted_ids', JSON.stringify(arr));
    } catch { /* noop */ }
  }

  /** Return all drifted fingerprint IDs from localStorage. */
  getDriftedIds(): string[] {
    try {
      const raw = localStorage.getItem('sf_drifted_ids');
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  // Stubs — FP Pro tagging API больше не используется
  async getVisitorIdWithTag(_opts: unknown): Promise<null> { return null; }
  async tagAdClick(_data: unknown): Promise<null> { return null; }
  async tagConversion(_data: unknown): Promise<null> { return null; }
  async tagPageView(_data: unknown): Promise<null> { return null; }
  async getVisitorData(): Promise<null> { return null; }
}
