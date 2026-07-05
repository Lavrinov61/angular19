import { Injectable, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { LoggerService } from './logger.service';

/**
 * Message delivery statuses (Telegram-style):
 * - pending:   saved to IndexedDB, not yet sent to server
 * - sending:   HTTP request in-flight
 * - sent:      server confirmed (saved to DB)
 * - delivered: recipient received (WS delivered_at)
 * - read:      recipient opened (WS read_at)
 * - failed:    all retries exhausted, user can retry manually
 */
export type MessageDeliveryStatus = 'pending' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export interface OutboxEntry {
  clientMessageId: string;
  sessionId: string;
  content: string;
  messageType: 'text' | 'image' | 'file' | 'video' | 'audio';
  attachmentUrl?: string;
  visitorId: string;
  replyToMessageId?: string;
  status: MessageDeliveryStatus;
  retryCount: number;
  createdAt: number;
  lastAttemptAt: number | null;
  serverMessageId?: string;
  error?: string;
}

const DB_NAME = 'svoefoto_chat_outbox';
const DB_VERSION = 1;
const STORE_NAME = 'messages';
const MAX_RETRIES = 5;
const RETRY_DELAYS = [3000, 5000, 15000, 30000, 60000]; // exponential-ish backoff

@Injectable({ providedIn: 'root' })
export class MessageOutboxService {
  private readonly platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService).createChild('Outbox');

  private db: IDBDatabase | null = null;
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sendFn: ((entry: OutboxEntry) => Promise<string | null>) | null = null;

  /** Live map of outbox entries for UI binding */
  private readonly _entries = signal<Map<string, OutboxEntry>>(new Map());
  readonly entries = this._entries.asReadonly();

  /** True if any message is pending/sending */
  readonly hasPending = computed(() => {
    const map = this._entries();
    for (const e of map.values()) {
      if (e.status === 'pending' || e.status === 'sending') return true;
    }
    return false;
  });

  /** Count of unsent messages */
  readonly pendingCount = computed(() => {
    let count = 0;
    for (const e of this._entries().values()) {
      if (e.status === 'pending' || e.status === 'sending' || e.status === 'failed') count++;
    }
    return count;
  });

  /**
   * Register the actual send function (called by AuthChatService).
   * Returns server message ID on success, null on failure.
   */
  registerSender(fn: (entry: OutboxEntry) => Promise<string | null>): void {
    this.sendFn = fn;
  }

  /** Open IndexedDB and flush any pending entries from previous session */
  async init(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      this.db = await this.openDb();
      await this.loadEntries();
      this.pruneFailed();
      this.pruneStale();
      this.flushPending();
    } catch (err) {
      this.log.error('IndexedDB init failed, outbox disabled:', err);
    }
  }

  /**
   * Persist a message to outbox BEFORE sending.
   * Returns the clientMessageId.
   */
  async enqueue(entry: Omit<OutboxEntry, 'status' | 'retryCount' | 'createdAt' | 'lastAttemptAt'>): Promise<string> {
    const full: OutboxEntry = {
      ...entry,
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
      lastAttemptAt: null,
    };

    // Persist to IndexedDB
    if (this.db) {
      await this.putEntry(full);
    }

    // Update signal
    this._entries.update(map => {
      const next = new Map(map);
      next.set(full.clientMessageId, full);
      return next;
    });

    // Start send
    this.attemptSend(full.clientMessageId);

    return full.clientMessageId;
  }

  /**
   * Mark a message as sent (server confirmed).
   * Called by AuthChatService after successful REST response.
   */
  async markSent(clientMessageId: string, serverMessageId: string): Promise<void> {
    await this.updateStatus(clientMessageId, 'sent', serverMessageId);
  }

  /**
   * Mark as delivered (WS callback from server).
   */
  async markDelivered(clientMessageId: string): Promise<void> {
    await this.updateStatus(clientMessageId, 'delivered');
  }

  /**
   * Mark as read (WS callback from server).
   */
  async markRead(clientMessageId: string): Promise<void> {
    await this.updateStatus(clientMessageId, 'read');
  }

  /**
   * User manually retries a failed message.
   */
  retryFailed(clientMessageId: string): void {
    const entry = this._entries().get(clientMessageId);
    if (!entry || entry.status !== 'failed') return;

    this._entries.update(map => {
      const next = new Map(map);
      next.set(clientMessageId, { ...entry, status: 'pending', retryCount: 0, error: undefined });
      return next;
    });

    if (this.db) {
      const updated = this._entries().get(clientMessageId);
      if (updated) this.putEntry(updated).catch(() => { /* noop */ });
    }

    this.attemptSend(clientMessageId);
  }

  /**
   * Remove a confirmed (sent/delivered/read) message from outbox.
   * Called after server confirmation to keep IndexedDB clean.
   */
  async remove(clientMessageId: string): Promise<void> {
    this.clearTimer(clientMessageId);

    if (this.db) {
      await this.deleteEntry(clientMessageId);
    }

    this._entries.update(map => {
      const next = new Map(map);
      next.delete(clientMessageId);
      return next;
    });
  }

  /**
   * Remove failed entries older than maxAgeMs (default 7 days).
   */
  pruneFailed(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    const toRemove: string[] = [];
    for (const [id, e] of this._entries()) {
      if (e.status === 'failed' && e.createdAt < cutoff) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.remove(id);
    }
  }

  /**
   * Remove stale entries (any status) older than maxAgeMs (default 30 days).
   */
  pruneStale(maxAgeMs = 30 * 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    const toRemove: string[] = [];
    for (const [id, e] of this._entries()) {
      if (e.createdAt < cutoff) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.remove(id);
    }
  }

  /**
   * Remove all confirmed entries (cleanup).
   */
  async pruneConfirmed(): Promise<void> {
    const toRemove: string[] = [];
    for (const [id, e] of this._entries()) {
      if (e.status === 'sent' || e.status === 'delivered' || e.status === 'read') {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      await this.remove(id);
    }
  }

  /** Get status for a specific clientMessageId */
  getStatus(clientMessageId: string): MessageDeliveryStatus | null {
    return this._entries().get(clientMessageId)?.status ?? null;
  }

  // ─── Private: Status Updates ──────────────────────────────────────

  private async updateStatus(clientMessageId: string, status: MessageDeliveryStatus, serverMessageId?: string): Promise<void> {
    const entry = this._entries().get(clientMessageId);
    if (!entry) return;

    const updated: OutboxEntry = { ...entry, status };
    if (serverMessageId) updated.serverMessageId = serverMessageId;

    this._entries.update(map => {
      const next = new Map(map);
      next.set(clientMessageId, updated);
      return next;
    });

    if (this.db) {
      await this.putEntry(updated).catch(() => { /* noop */ });
    }
  }

  /** Destroy: cancel all timers */
  destroy(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }

  // ─── Private ───────────────────────────────────────────────────────

  private async attemptSend(clientMessageId: string): Promise<void> {
    const entry = this._entries().get(clientMessageId);
    if (!entry || entry.status === 'sent' || entry.status === 'delivered' || entry.status === 'read') return;
    if (!this.sendFn) {
      this.log.warn('No sender registered, cannot send');
      return;
    }

    // Mark as sending
    this._entries.update(map => {
      const next = new Map(map);
      const current = next.get(clientMessageId);
      if (current) next.set(clientMessageId, { ...current, status: 'sending', lastAttemptAt: Date.now() });
      return next;
    });

    if (this.db) {
      const updated = this._entries().get(clientMessageId);
      if (updated) this.putEntry(updated).catch(() => { /* noop */ });
    }

    try {
      const serverMsgId = await this.sendFn(entry);
      if (serverMsgId) {
        await this.markSent(clientMessageId, serverMsgId);
        this.log.debug(`Message ${clientMessageId} sent, server ID: ${serverMsgId}`);
      } else {
        throw new Error('Server returned null');
      }
    } catch (err) {
      this.handleSendError(clientMessageId, err);
    }
  }

  private handleSendError(clientMessageId: string, err: unknown): void {
    const entry = this._entries().get(clientMessageId);
    if (!entry) return;

    const newRetryCount = entry.retryCount + 1;
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';

    if (newRetryCount > MAX_RETRIES) {
      // All retries exhausted
      this._entries.update(map => {
        const next = new Map(map);
        next.set(clientMessageId, { ...entry, status: 'failed', retryCount: newRetryCount, error: errorMsg });
        return next;
      });
      if (this.db) this.putEntry({ ...entry, status: 'failed', retryCount: newRetryCount, error: errorMsg }).catch(() => { /* noop */ });
      this.log.warn(`Message ${clientMessageId} failed after ${MAX_RETRIES} retries`);
      return;
    }

    // Schedule retry
    const delay = RETRY_DELAYS[Math.min(newRetryCount - 1, RETRY_DELAYS.length - 1)];
    this._entries.update(map => {
      const next = new Map(map);
      next.set(clientMessageId, { ...entry, status: 'pending', retryCount: newRetryCount, error: errorMsg });
      return next;
    });
    if (this.db) this.putEntry({ ...entry, status: 'pending', retryCount: newRetryCount, error: errorMsg }).catch(() => { /* noop */ });

    this.log.debug(`Message ${clientMessageId} retry ${newRetryCount}/${MAX_RETRIES} in ${delay}ms`);

    this.clearTimer(clientMessageId);
    this.retryTimers.set(
      clientMessageId,
      setTimeout(() => this.attemptSend(clientMessageId), delay),
    );
  }

  /** Flush all pending entries from previous session */
  private flushPending(): void {
    for (const [id, entry] of this._entries()) {
      if (entry.status === 'pending' || entry.status === 'sending') {
        // Reset sending → pending for retry
        if (entry.status === 'sending') {
          this._entries.update(map => {
            const next = new Map(map);
            next.set(id, { ...entry, status: 'pending' });
            return next;
          });
        }
        this.attemptSend(id);
      }
    }
  }

  private clearTimer(id: string): void {
    const timer = this.retryTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(id);
    }
  }

  // ─── IndexedDB Operations ─────────────────────────────────────────

  private openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'clientMessageId' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private loadEntries(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const entries = req.result as OutboxEntry[];
        const map = new Map<string, OutboxEntry>();
        for (const e of entries) {
          map.set(e.clientMessageId, e);
        }
        this._entries.set(map);
        this.log.debug(`Loaded ${entries.length} outbox entries`);
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  private putEntry(entry: OutboxEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private deleteEntry(clientMessageId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve();
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(clientMessageId);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
