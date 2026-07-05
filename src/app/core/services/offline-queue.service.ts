import { Injectable, signal, computed, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type OfflineEntityType =
  | 'pos_receipt'
  | 'pos_pricing_receipt'
  | 'task_update'
  | 'note'
  | 'generic';

export interface QueuedRequest {
  id: number;
  entityType: OfflineEntityType;
  method: string;
  url: string;
  body: string | null;
  headers: Record<string, string>;
  timestamp: number;
  retryCount: number;
  lastError: string | null;
  label: string;
}

export type SyncStatus = 'idle' | 'syncing' | 'error';

const DB_NAME = 'offline_queue_db';
const STORE_NAME = 'requests';
const DB_VERSION = 2; // v2: added entityType, retryCount, lastError, label
const MAX_RETRIES = 3;

@Injectable({ providedIn: 'root' })
export class OfflineQueueService {
  private readonly platformId = inject(PLATFORM_ID);
  private db: IDBDatabase | null = null;

  readonly pendingCount = signal(0);
  readonly failedCount = signal(0);
  readonly syncStatus = signal<SyncStatus>('idle');
  readonly isNetworkOffline = signal(false);

  readonly hasIssues = computed(
    () => this.isNetworkOffline() || this.failedCount() > 0
  );

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.isNetworkOffline.set(!navigator.onLine);

      window.addEventListener('online', () => {
        this.isNetworkOffline.set(false);
        this.processQueue();
      });

      window.addEventListener('offline', () => {
        this.isNetworkOffline.set(true);
      });

      this.openDb().then(() => this.refreshCounts());
    }
  }

  private openDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        resolve();
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = request.result;
        // v1 → v2: drop old schema-less store, create new with indexes
        if ((event as IDBVersionChangeEvent).oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('entityType', 'entityType', { unique: false });
          store.createIndex('retryCount', 'retryCount', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async enqueue(
    entityType: OfflineEntityType,
    method: string,
    url: string,
    body: string | null,
    headers: Record<string, string>,
    label: string,
  ): Promise<void> {
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const item = {
        entityType,
        method,
        url,
        body,
        headers,
        label,
        timestamp: Date.now(),
        retryCount: 0,
        lastError: null,
      };
      const req = store.add(item);
      req.onsuccess = () => {
        this.refreshCounts();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async enqueuePosReceipt(
    receiptData: object,
    authToken: string,
    label: string,
  ): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    };
    await this.enqueue(
      'pos_receipt',
      'POST',
      '/api/pos/receipts',
      JSON.stringify(receiptData),
      headers,
      label,
    );
  }

  async processQueue(): Promise<void> {
    if (!this.db || !navigator.onLine) return;

    const items = await this.getAll();
    const actionable = items.filter(i => i.retryCount < MAX_RETRIES);
    if (actionable.length === 0) return;

    this.syncStatus.set('syncing');
    let hasError = false;

    for (const item of actionable) {
      try {
        const response = await fetch(item.url, {
          method: item.method,
          headers: item.headers,
          body: item.body,
        });

        if (response.ok) {
          await this.remove(item.id);
        } else {
          await this.updateRetry(item.id, item.retryCount + 1, `HTTP ${response.status}`);
          hasError = true;
        }
      } catch (err) {
        // Network down — stop processing
        await this.updateRetry(
          item.id,
          item.retryCount + 1,
          err instanceof Error ? err.message : 'Network error',
        );
        hasError = true;
        break;
      }
    }

    this.syncStatus.set(hasError ? 'error' : 'idle');
    this.refreshCounts();
  }

  private getAll(): Promise<QueuedRequest[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) { resolve([]); return; }
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as QueuedRequest[]);
      req.onerror = () => reject(req.error);
    });
  }

  private remove(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) { resolve(); return; }
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private updateRetry(id: number, retryCount: number, error: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) { resolve(); return; }
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result;
        if (!item) { resolve(); return; }
        const putReq = store.put({ ...item, retryCount, lastError: error });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  private refreshCounts(): void {
    if (!this.db) return;
    const tx = this.db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result as QueuedRequest[];
      this.pendingCount.set(all.filter(i => i.retryCount < MAX_RETRIES).length);
      this.failedCount.set(all.filter(i => i.retryCount >= MAX_RETRIES).length);
    };
  }
}
